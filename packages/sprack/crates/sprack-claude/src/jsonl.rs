//! JSONL entry types and parsing for Claude Code session files.
//!
//! Provides serde structs for deserializing Claude Code's JSONL session
//! entries, and efficient tail-reading and incremental-reading functions
//! that avoid parsing entire session files.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Deserialize;

/// Default tail-read window: 32KB covers hundreds of JSONL entries.
const DEFAULT_TAIL_BYTES: u64 = 32 * 1024;

/// A single entry from a Claude Code JSONL session file.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct JsonlEntry {
    /// Entry type: "user", "assistant", "progress", "system", etc.
    #[serde(rename = "type", default)]
    pub entry_type: String,

    /// Session identifier.
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,

    /// ISO 8601 timestamp of the entry.
    #[serde(default)]
    pub timestamp: Option<String>,

    /// Whether this entry belongs to a sidechain (subagent).
    #[serde(rename = "isSidechain", default)]
    pub is_sidechain: Option<bool>,

    /// Parent tool use ID for sidechain entries.
    #[serde(rename = "parentToolUseID", default)]
    pub parent_tool_use_id: Option<String>,

    /// The assistant message payload (present on assistant entries).
    /// Uses lenient deserialization: returns None if the message shape
    /// does not match AssistantMessage (e.g., user entries have different structure).
    #[serde(default, deserialize_with = "deserialize_assistant_message")]
    pub message: Option<AssistantMessage>,

    /// Whether this is a compact summary re-statement (skipped during ingestion).
    #[serde(rename = "isCompactSummary", default)]
    pub is_compact_summary: Option<bool>,

    /// Auto-generated session slug (e.g., "swirling-swimming-hopper").
    #[serde(default)]
    pub slug: Option<String>,

    /// Progress data (present on progress entries).
    #[serde(default)]
    pub data: Option<ProgressData>,
}

/// Payload from an assistant-type JSONL entry.
#[derive(Debug, Clone, Deserialize)]
pub struct AssistantMessage {
    /// Model name (e.g., "claude-opus-4-6").
    #[serde(default)]
    pub model: Option<String>,

    /// Token usage for this message.
    #[serde(default)]
    pub usage: Option<TokenUsage>,

    /// Stop reason: null (thinking), "end_turn" (idle), "tool_use".
    #[serde(default)]
    pub stop_reason: Option<String>,

    /// Content blocks: text, tool_use, thinking.
    #[serde(default)]
    pub content: Option<Vec<ContentBlock>>,
}

/// Token usage from an assistant message.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct TokenUsage {
    /// Number of input tokens consumed.
    #[serde(default)]
    pub input_tokens: u64,

    /// Number of output tokens generated.
    #[serde(default)]
    pub output_tokens: u64,

    /// Tokens read from prompt cache.
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,

    /// Tokens written to prompt cache.
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
}

/// A single content block within an assistant message.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct ContentBlock {
    /// Block type: "text", "tool_use", "thinking".
    #[serde(rename = "type", default)]
    pub block_type: String,

    /// Tool name (present on tool_use blocks).
    #[serde(default)]
    pub name: Option<String>,

    /// Tool use ID (present on tool_use blocks).
    #[serde(default)]
    pub id: Option<String>,
}

/// Progress data from a progress-type JSONL entry.
#[derive(Debug, Clone, Deserialize)]
pub struct ProgressData {
    /// Progress type (e.g., "agent_progress").
    #[serde(rename = "type", default)]
    pub data_type: Option<String>,

    /// Tool use ID for agent progress tracking.
    #[serde(rename = "toolUseID", default)]
    pub tool_use_id: Option<String>,
}

/// Leniently deserializes the message field: returns None if the value
/// does not match the AssistantMessage shape (e.g., user entries).
fn deserialize_assistant_message<'de, D>(
    deserializer: D,
) -> Result<Option<AssistantMessage>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        Some(v) => Ok(serde_json::from_value::<AssistantMessage>(v).ok()),
        None => Ok(None),
    }
}

/// Reads the tail of a JSONL file, parsing entries from the last `max_bytes` bytes.
///
/// If the file is smaller than `max_bytes`, reads the entire file.
/// Discards the first partial line when starting mid-file.
pub fn tail_read(path: &Path, max_bytes: u64) -> Vec<JsonlEntry> {
    tail_read_inner(path, max_bytes).unwrap_or_default()
}

fn tail_read_inner(path: &Path, max_bytes: u64) -> anyhow::Result<Vec<JsonlEntry>> {
    let mut file = std::fs::File::open(path)?;
    let file_length = file.metadata()?.len();
    let start = file_length.saturating_sub(max_bytes);

    file.seek(SeekFrom::Start(start))?;

    let mut buffer = String::new();
    file.read_to_string(&mut buffer)?;

    // If we started mid-file, discard the first partial line.
    if start > 0 {
        if let Some(newline_position) = buffer.find('\n') {
            buffer = buffer[newline_position + 1..].to_string();
        }
    }

    let entries = buffer
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<JsonlEntry>(line).ok())
        .collect();

    Ok(entries)
}

/// Reads new entries appended to a JSONL file since the last read position.
///
/// Updates `position` to the new file size. If the file shrank (rotation),
/// resets position to 0 and reads from the beginning.
pub fn incremental_read(path: &Path, position: &mut u64) -> Vec<JsonlEntry> {
    incremental_read_inner(path, position).unwrap_or_default()
}

fn incremental_read_inner(path: &Path, position: &mut u64) -> anyhow::Result<Vec<JsonlEntry>> {
    let mut file = std::fs::File::open(path)?;
    let file_length = file.metadata()?.len();

    // File shrank: rotation detected, re-read from start.
    if file_length < *position {
        *position = 0;
    }

    // No new data.
    if file_length == *position {
        return Ok(Vec::new());
    }

    file.seek(SeekFrom::Start(*position))?;

    let mut buffer = String::new();
    file.read_to_string(&mut buffer)?;

    *position = file_length;

    let entries = buffer
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<JsonlEntry>(line).ok())
        .collect();

    Ok(entries)
}

/// Returns the default tail-read window size in bytes.
pub fn default_tail_bytes() -> u64 {
    DEFAULT_TAIL_BYTES
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn make_assistant_json(stop_reason: Option<&str>, model: &str) -> String {
        let stop_reason_json = match stop_reason {
            Some(reason) => format!("\"{reason}\""),
            None => "null".to_string(),
        };
        format!(
            r#"{{"type":"assistant","message":{{"model":"{model}","stop_reason":{stop_reason_json},"usage":{{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":200,"cache_creation_input_tokens":10}},"content":[{{"type":"text"}},{{"type":"tool_use","name":"Read","id":"tu_123"}}]}}}}"#
        )
    }

    fn make_progress_json(tool_use_id: &str) -> String {
        format!(
            r#"{{"type":"progress","data":{{"type":"agent_progress","toolUseID":"{tool_use_id}"}}}}"#
        )
    }

    fn make_user_json() -> String {
        r#"{"type":"user","message":{"role":"user","content":"hello"}}"#.to_string()
    }

    #[test]
    fn test_parse_assistant_entry() {
        let json = make_assistant_json(Some("end_turn"), "claude-opus-4-6");
        let entry: JsonlEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(entry.entry_type, "assistant");
        let message = entry.message.unwrap();
        assert_eq!(message.model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(message.stop_reason.as_deref(), Some("end_turn"));
        let usage = message.usage.unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_input_tokens, Some(200));
        assert_eq!(usage.cache_creation_input_tokens, Some(10));
        let content = message.content.unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[1].block_type, "tool_use");
        assert_eq!(content[1].name.as_deref(), Some("Read"));
    }

    #[test]
    fn test_parse_progress_entry() {
        let json = make_progress_json("tu_abc123");
        let entry: JsonlEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(entry.entry_type, "progress");
        let data = entry.data.unwrap();
        assert_eq!(data.data_type.as_deref(), Some("agent_progress"));
        assert_eq!(data.tool_use_id.as_deref(), Some("tu_abc123"));
    }

    #[test]
    fn test_parse_user_entry() {
        let json = make_user_json();
        let entry: JsonlEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(entry.entry_type, "user");
    }

    #[test]
    fn test_parse_malformed_line() {
        let result = serde_json::from_str::<JsonlEntry>("not valid json {{{");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_missing_fields() {
        let json = r#"{"type":"assistant"}"#;
        let entry: JsonlEntry = serde_json::from_str(json).unwrap();

        assert_eq!(entry.entry_type, "assistant");
        assert!(entry.message.is_none());
        assert!(entry.session_id.is_none());
        assert!(entry.timestamp.is_none());
        assert!(entry.is_sidechain.is_none());
        assert!(entry.data.is_none());
    }

    #[test]
    fn test_tail_read_small_file() {
        let temp_dir = std::env::temp_dir().join("sprack-claude-test-tail-small");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("small.jsonl");

        let lines = vec![
            make_user_json(),
            make_assistant_json(Some("end_turn"), "claude-opus-4-6"),
        ];
        std::fs::write(&file_path, lines.join("\n") + "\n").unwrap();

        // File is well under 32KB.
        let entries = tail_read(&file_path, DEFAULT_TAIL_BYTES);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].entry_type, "user");
        assert_eq!(entries[1].entry_type, "assistant");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_tail_read_large_file() {
        let temp_dir = std::env::temp_dir().join("sprack-claude-test-tail-large");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("large.jsonl");

        let mut file = std::fs::File::create(&file_path).unwrap();

        // Write enough data to exceed DEFAULT_TAIL_BYTES.
        // Each assistant line is ~200 bytes, so write 200 lines of padding.
        for _ in 0..200 {
            writeln!(
                file,
                r#"{{"type":"system","message":"padding to fill bytes and exceed the tail window size, this is filler content to ensure the file is larger than thirty two kilobytes so the tail read test works correctly for large file scenarios"}}"#
            )
            .unwrap();
        }

        // Write recognizable entries at the end.
        writeln!(file, "{}", make_user_json()).unwrap();
        writeln!(
            file,
            "{}",
            make_assistant_json(Some("end_turn"), "claude-opus-4-6")
        )
        .unwrap();
        drop(file);

        let file_size = std::fs::metadata(&file_path).unwrap().len();
        assert!(
            file_size > DEFAULT_TAIL_BYTES,
            "file should exceed tail window"
        );

        // Tail read with a small window should only get the last few entries.
        let entries = tail_read(&file_path, 1024);
        // The tail should contain at least the last two entries.
        assert!(!entries.is_empty());
        let last_entry = entries.last().unwrap();
        assert_eq!(last_entry.entry_type, "assistant");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_incremental_read() {
        let temp_dir = std::env::temp_dir().join("sprack-claude-test-incremental");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("incremental.jsonl");

        // Write initial content.
        let initial_line = make_user_json();
        std::fs::write(&file_path, format!("{initial_line}\n")).unwrap();

        // First read: position starts at 0, reads everything.
        let mut position: u64 = 0;
        let entries = incremental_read(&file_path, &mut position);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entry_type, "user");
        assert!(position > 0);

        // Second read with no new data: returns empty.
        let entries = incremental_read(&file_path, &mut position);
        assert!(entries.is_empty());

        // Append new content.
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&file_path)
            .unwrap();
        writeln!(
            file,
            "{}",
            make_assistant_json(Some("end_turn"), "claude-opus-4-6")
        )
        .unwrap();
        drop(file);

        // Third read: picks up only the new entry.
        let entries = incremental_read(&file_path, &mut position);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entry_type, "assistant");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
