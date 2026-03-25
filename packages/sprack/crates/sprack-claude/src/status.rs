//! Status extraction from parsed JSONL session entries.
//!
//! Derives activity state, context usage, subagent count, last tool,
//! and model information from the tail of a Claude Code session file.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use sprack_db::types::ProcessStatus;

use crate::jsonl::{AssistantMessage, JsonlEntry};

/// Structured summary written to the process_integrations.summary column.
///
/// The TUI parses this JSON to render width-adaptive status displays.
/// Fields from hook events (tasks, session_summary, session_purpose) are optional
/// and default to None when hooks are not configured.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaudeSummary {
    /// Activity state: "thinking", "tool_use", "idle", "waiting", "error".
    pub state: String,
    /// Model name (e.g., "claude-opus-4-6").
    pub model: Option<String>,
    /// Number of active subagents.
    pub subagent_count: u32,
    /// Context window usage as a percentage (0-100).
    pub context_percent: u8,
    /// Name of the last tool used.
    pub last_tool: Option<String>,
    /// Error message, if state is "error".
    pub error_message: Option<String>,
    /// ISO 8601 timestamp of the last assistant entry.
    pub last_activity: Option<String>,
    /// Task list with completion status (from hook events).
    #[serde(default)]
    pub tasks: Option<Vec<TaskEntry>>,
    /// Session summary from PostCompact hook event.
    #[serde(default)]
    pub session_summary: Option<String>,
    /// Session purpose (from PostCompact or cwd).
    #[serde(default)]
    pub session_purpose: Option<String>,
    /// Absolute token count: total input tokens consumed.
    #[serde(default)]
    pub tokens_used: Option<u64>,
    /// Absolute token count: model context window size.
    #[serde(default)]
    pub tokens_max: Option<u64>,
    /// Claude Code session name: `customTitle` from sessions-index.json (user-set via
    /// `/rename`), falling back to `slug` from JSONL entries (auto-generated).
    #[serde(default)]
    pub session_name: Option<String>,
}

/// A task entry from the Claude Code task list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskEntry {
    /// Task identifier.
    pub task_id: String,
    /// Short task name.
    pub subject: String,
    /// Longer description.
    pub description: Option<String>,
    /// Current task status.
    pub status: TaskStatus,
}

/// Status of a task in the Claude Code task list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskStatus {
    Created,
    InProgress,
    Completed,
}

/// Entry types that are skipped when determining the "last meaningful entry".
const SKIPPED_ENTRY_TYPES: &[&str] = &[
    "system",
    "last-prompt",
    "agent-name",
    "file-history-snapshot",
    "hook_progress",
];

/// Extracts the activity state from parsed JSONL entries.
///
/// Considers only non-sidechain entries. Skips system, meta, and hook entries.
/// The "last meaningful entry" determines state:
/// - assistant with stop_reason null -> Thinking
/// - assistant with stop_reason "tool_use" -> ToolUse
/// - assistant with stop_reason "end_turn" -> Idle
/// - user -> Waiting
/// - No meaningful entries -> Error
pub fn extract_activity_state(entries: &[JsonlEntry]) -> ProcessStatus {
    // Filter to non-sidechain, meaningful entries.
    let meaningful_entries: Vec<&JsonlEntry> = entries
        .iter()
        .filter(|entry| !entry.is_sidechain.unwrap_or(false))
        .filter(|entry| !SKIPPED_ENTRY_TYPES.contains(&entry.entry_type.as_str()))
        .collect();

    let last_entry = match meaningful_entries.last() {
        Some(entry) => entry,
        None => return ProcessStatus::Error,
    };

    match last_entry.entry_type.as_str() {
        "assistant" => {
            let stop_reason = last_entry
                .message
                .as_ref()
                .and_then(|message| message.stop_reason.as_deref());

            match stop_reason {
                None => ProcessStatus::Thinking,
                Some("tool_use") => ProcessStatus::ToolUse,
                Some("end_turn") => ProcessStatus::Idle,
                Some(_) => ProcessStatus::Idle,
            }
        }
        "user" => ProcessStatus::Waiting,
        _ => ProcessStatus::Error,
    }
}

/// Computes context window usage as a percentage.
///
/// Uses input_tokens + cache_read_input_tokens + cache_creation_input_tokens
/// divided by the model's context window size.
pub fn extract_context_percent(message: &AssistantMessage) -> u8 {
    let usage = match &message.usage {
        Some(usage) => usage,
        None => return 0,
    };

    let total_context_tokens = usage.input_tokens
        + usage.cache_read_input_tokens.unwrap_or(0)
        + usage.cache_creation_input_tokens.unwrap_or(0);

    let context_window = message
        .model
        .as_deref()
        .map(model_context_window)
        .unwrap_or(200_000);

    if context_window == 0 {
        return 0;
    }

    let percent = (total_context_tokens as f64 / context_window as f64 * 100.0) as u64;
    percent.min(100) as u8
}

/// Extracts absolute token counts: (tokens_used, tokens_max).
///
/// Uses the same computation as `extract_context_percent`:
/// input_tokens + cache_read_input_tokens + cache_creation_input_tokens
/// against the model's context window size.
pub fn extract_token_counts(message: &AssistantMessage) -> (Option<u64>, Option<u64>) {
    let usage = match &message.usage {
        Some(usage) => usage,
        None => return (None, None),
    };

    let total_context_tokens = usage.input_tokens
        + usage.cache_read_input_tokens.unwrap_or(0)
        + usage.cache_creation_input_tokens.unwrap_or(0);

    let context_window = message
        .model
        .as_deref()
        .map(model_context_window)
        .unwrap_or(200_000);

    (Some(total_context_tokens), Some(context_window))
}

/// Extracts the name of the last tool used from an assistant message's content blocks.
pub fn extract_last_tool(message: &AssistantMessage) -> Option<String> {
    let content = message.content.as_ref()?;
    content
        .iter()
        .rev()
        .find(|block| block.block_type == "tool_use")
        .and_then(|block| block.name.clone())
}

/// Extracts the model name from an assistant message.
pub fn extract_model(message: &AssistantMessage) -> Option<String> {
    message.model.clone()
}

/// Counts active subagents by collecting distinct toolUseIDs from agent_progress entries.
pub fn count_subagents(entries: &[JsonlEntry]) -> u32 {
    let mut unique_tool_use_ids: HashSet<&str> = HashSet::new();

    for entry in entries {
        if entry.entry_type != "progress" {
            continue;
        }
        let data = match &entry.data {
            Some(data) => data,
            None => continue,
        };
        if data.data_type.as_deref() != Some("agent_progress") {
            continue;
        }
        if let Some(tool_use_id) = &data.tool_use_id {
            unique_tool_use_ids.insert(tool_use_id.as_str());
        }
    }

    unique_tool_use_ids.len() as u32
}

/// Returns the context window size for a given model name.
///
/// Pattern-matches on model name substrings.
pub fn model_context_window(model: &str) -> u64 {
    if model.contains("opus") {
        1_000_000
    } else {
        // sonnet, haiku, and unknown models all use 200k context.
        200_000
    }
}

/// Finds the most recent assistant message from a list of entries.
///
/// Considers only non-sidechain entries.
pub fn find_last_assistant_message(entries: &[JsonlEntry]) -> Option<&AssistantMessage> {
    entries
        .iter()
        .rev()
        .filter(|entry| !entry.is_sidechain.unwrap_or(false))
        .find(|entry| entry.entry_type == "assistant")
        .and_then(|entry| entry.message.as_ref())
}

/// Extracts the auto-generated session slug from the most recent JSONL entry that has one.
pub fn extract_slug(entries: &[JsonlEntry]) -> Option<String> {
    entries
        .iter()
        .rev()
        .find_map(|entry| entry.slug.clone())
}

/// Builds a complete ClaudeSummary from parsed entries.
pub fn build_summary(entries: &[JsonlEntry]) -> ClaudeSummary {
    let state = extract_activity_state(entries);
    let last_assistant = find_last_assistant_message(entries);

    let model = last_assistant.and_then(extract_model);
    let context_percent = last_assistant.map(extract_context_percent).unwrap_or(0);
    let (tokens_used, tokens_max) = last_assistant
        .map(extract_token_counts)
        .unwrap_or((None, None));
    let last_tool = last_assistant.and_then(extract_last_tool);
    let subagent_count = count_subagents(entries);

    let last_activity = entries
        .iter()
        .rev()
        .filter(|entry| entry.entry_type == "assistant")
        .find(|entry| !entry.is_sidechain.unwrap_or(false))
        .and_then(|entry| entry.timestamp.clone());

    let state_string = state.to_string();

    let session_name = extract_slug(entries);

    ClaudeSummary {
        state: state_string,
        model,
        subagent_count,
        context_percent,
        last_tool,
        error_message: None,
        last_activity,
        tasks: None,
        session_summary: None,
        session_purpose: None,
        tokens_used,
        tokens_max,
        session_name,
    }
}

/// Maps a ClaudeSummary state to the process_integrations.status column value.
///
/// thinking and tool_use map to their respective ProcessStatus variants.
/// idle and waiting map to Idle and Waiting.
/// Everything else maps to Error.
pub fn summary_to_process_status(summary: &ClaudeSummary) -> ProcessStatus {
    match summary.state.as_str() {
        "thinking" => ProcessStatus::Thinking,
        "tool_use" => ProcessStatus::ToolUse,
        "idle" => ProcessStatus::Idle,
        "waiting" => ProcessStatus::Waiting,
        "error" => ProcessStatus::Error,
        _ => ProcessStatus::Error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsonl::{ContentBlock, ProgressData, TokenUsage};

    fn make_assistant_entry(stop_reason: Option<&str>, model: &str) -> JsonlEntry {
        JsonlEntry {
            entry_type: "assistant".to_string(),
            session_id: None,
            timestamp: Some("2026-03-22T10:00:00Z".to_string()),
            is_sidechain: None,
            parent_tool_use_id: None,
            is_compact_summary: None,
            slug: None,
            message: Some(AssistantMessage {
                model: Some(model.to_string()),
                usage: Some(TokenUsage {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_read_input_tokens: Some(200),
                    cache_creation_input_tokens: Some(10),
                }),
                stop_reason: stop_reason.map(|s| s.to_string()),
                content: Some(vec![
                    ContentBlock {
                        block_type: "text".to_string(),
                        name: None,
                        id: None,
                    },
                    ContentBlock {
                        block_type: "tool_use".to_string(),
                        name: Some("Read".to_string()),
                        id: Some("tu_123".to_string()),
                    },
                ]),
            }),
            data: None,
        }
    }

    fn make_user_entry() -> JsonlEntry {
        JsonlEntry {
            entry_type: "user".to_string(),
            session_id: None,
            timestamp: None,
            is_sidechain: None,
            parent_tool_use_id: None,
            is_compact_summary: None,
            slug: None,
            message: None,
            data: None,
        }
    }

    fn make_progress_entry(tool_use_id: &str) -> JsonlEntry {
        JsonlEntry {
            entry_type: "progress".to_string(),
            session_id: None,
            timestamp: None,
            is_sidechain: None,
            parent_tool_use_id: None,
            is_compact_summary: None,
            slug: None,
            message: None,
            data: Some(ProgressData {
                data_type: Some("agent_progress".to_string()),
                tool_use_id: Some(tool_use_id.to_string()),
            }),
        }
    }

    #[test]
    fn test_activity_state_thinking() {
        let entries = vec![make_assistant_entry(None, "claude-opus-4-6")];
        let state = extract_activity_state(&entries);
        assert_eq!(state, ProcessStatus::Thinking);
    }

    #[test]
    fn test_activity_state_idle() {
        let entries = vec![make_assistant_entry(Some("end_turn"), "claude-opus-4-6")];
        let state = extract_activity_state(&entries);
        assert_eq!(state, ProcessStatus::Idle);
    }

    #[test]
    fn test_activity_state_tool_use() {
        let entries = vec![make_assistant_entry(Some("tool_use"), "claude-opus-4-6")];
        let state = extract_activity_state(&entries);
        assert_eq!(state, ProcessStatus::ToolUse);
    }

    #[test]
    fn test_activity_state_waiting() {
        let entries = vec![
            make_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
            make_user_entry(),
        ];
        let state = extract_activity_state(&entries);
        assert_eq!(state, ProcessStatus::Waiting);
    }

    #[test]
    fn test_context_percent_opus() {
        let message = AssistantMessage {
            model: Some("claude-opus-4-6".to_string()),
            usage: Some(TokenUsage {
                input_tokens: 400_000,
                output_tokens: 0,
                cache_read_input_tokens: Some(50_000),
                cache_creation_input_tokens: Some(50_000),
            }),
            stop_reason: None,
            content: None,
        };
        let percent = extract_context_percent(&message);
        assert_eq!(percent, 50);
    }

    #[test]
    fn test_context_percent_sonnet() {
        let message = AssistantMessage {
            model: Some("claude-sonnet-4-20250514".to_string()),
            usage: Some(TokenUsage {
                input_tokens: 80_000,
                output_tokens: 0,
                cache_read_input_tokens: Some(10_000),
                cache_creation_input_tokens: Some(10_000),
            }),
            stop_reason: None,
            content: None,
        };
        let percent = extract_context_percent(&message);
        assert_eq!(percent, 50);
    }

    #[test]
    fn test_subagent_count() {
        let entries = vec![
            make_progress_entry("agent_1"),
            make_progress_entry("agent_2"),
            make_progress_entry("agent_3"),
            make_progress_entry("agent_1"), // duplicate: should not increase count
        ];
        let count = count_subagents(&entries);
        assert_eq!(count, 3);
    }

    #[test]
    fn test_last_tool_extraction() {
        let message = AssistantMessage {
            model: None,
            usage: None,
            stop_reason: Some("tool_use".to_string()),
            content: Some(vec![
                ContentBlock {
                    block_type: "text".to_string(),
                    name: None,
                    id: None,
                },
                ContentBlock {
                    block_type: "tool_use".to_string(),
                    name: Some("Bash".to_string()),
                    id: None,
                },
                ContentBlock {
                    block_type: "tool_use".to_string(),
                    name: Some("Read".to_string()),
                    id: None,
                },
            ]),
        };
        let last_tool = extract_last_tool(&message);
        assert_eq!(last_tool.as_deref(), Some("Read"));
    }

    #[test]
    fn test_summary_serialization() {
        let summary = ClaudeSummary {
            state: "thinking".to_string(),
            model: Some("claude-opus-4-6".to_string()),
            subagent_count: 2,
            context_percent: 42,
            last_tool: Some("Edit".to_string()),
            error_message: None,
            last_activity: Some("2026-03-22T10:00:00Z".to_string()),
            tasks: None,
            session_summary: None,
            session_purpose: None,
            tokens_used: Some(420_000),
            tokens_max: Some(1_000_000),
            session_name: None,
        };

        let json_string = serde_json::to_string(&summary).unwrap();
        let deserialized: ClaudeSummary = serde_json::from_str(&json_string).unwrap();

        assert_eq!(summary, deserialized);
    }

    #[test]
    fn test_summary_deserialization_backward_compatible() {
        // Old JSON without tasks/session_summary/session_purpose fields.
        let old_json = r#"{"state":"idle","model":"opus","subagent_count":0,"context_percent":50,"last_tool":null,"error_message":null,"last_activity":null}"#;
        let summary: ClaudeSummary = serde_json::from_str(old_json).unwrap();
        assert_eq!(summary.state, "idle");
        assert_eq!(summary.tasks, None);
        assert_eq!(summary.session_summary, None);
        assert_eq!(summary.session_purpose, None);
        assert_eq!(summary.tokens_used, None);
        assert_eq!(summary.tokens_max, None);
    }
}
