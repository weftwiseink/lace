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
    /// Total user turns from the session cache.
    #[serde(default)]
    pub user_turns: Option<u32>,
    /// Total assistant turns from the session cache.
    #[serde(default)]
    pub assistant_turns: Option<u32>,
    /// Top tool usage counts from the session cache, ordered by frequency descending.
    #[serde(default)]
    pub tool_counts: Option<Vec<(String, u32)>>,
    /// Context window usage trend: "rising", "falling", or "stable".
    #[serde(default)]
    pub context_trend: Option<String>,
    /// Current git branch name (e.g., "feat/inline-summaries").
    /// "HEAD" when detached.
    #[serde(default)]
    pub git_branch: Option<String>,
    /// Short commit hash (e.g., "a1b2c3d").
    #[serde(default)]
    pub git_commit_short: Option<String>,
    /// Other worktree branch names (excluding the current branch and detached HEADs).
    #[serde(default)]
    pub git_worktree_branches: Option<Vec<String>>,
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
/// Only "user" and "assistant" entries represent conversational state.
/// Everything else is metadata, progress, or infrastructure.
const SKIPPED_ENTRY_TYPES: &[&str] = &[
    "system",
    "last-prompt",
    "agent-name",
    "file-history-snapshot",
    "hook_progress",
    "progress",
    "custom-title",
    "queue-operation",
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

/// Extracts a session name from JSONL `custom-title` or `agent-name` entries.
///
/// Scans entries in reverse order for the most recent `custom-title` entry.
/// Falls back to the most recent `agent-name` entry if no `custom-title` exists.
/// These entry types are emitted by Claude on session resume and `/rename`.
pub fn extract_jsonl_custom_title(entries: &[JsonlEntry]) -> Option<String> {
    // Prefer custom-title entries (most authoritative JSONL name source).
    let title = entries
        .iter()
        .rev()
        .filter(|e| e.entry_type == "custom-title")
        .find_map(|e| e.custom_title.clone());
    if title.is_some() {
        return title;
    }

    // Fall back to agent-name entries.
    entries
        .iter()
        .rev()
        .filter(|e| e.entry_type == "agent-name")
        .find_map(|e| e.agent_name.clone())
}

/// Resolves the best available session name from available sources.
///
/// Priority: customTitle from sessions-index.json > customTitle from JSONL >
/// agentName from JSONL > slug (auto-generated) > None.
/// Returns None when no name source is available; callers display a fallback (e.g., "unnamed").
pub fn resolve_session_name(
    custom_title: Option<&str>,
    jsonl_title: Option<&str>,
    slug: Option<&str>,
) -> Option<String> {
    custom_title
        .or(jsonl_title)
        .map(|s| s.to_string())
        .or_else(|| slug.map(|s| s.to_string()))
}

/// Builds a complete ClaudeSummary from parsed entries.
///
/// `custom_title` is the user-set session name from `sessions-index.json` (`customTitle` field).
/// When provided, it takes precedence over the auto-generated slug from JSONL entries.
pub fn build_summary(entries: &[JsonlEntry], custom_title: Option<&str>) -> ClaudeSummary {
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

    let slug = extract_slug(entries);
    let jsonl_title = extract_jsonl_custom_title(entries);
    let session_name = resolve_session_name(
        custom_title,
        jsonl_title.as_deref(),
        slug.as_deref(),
    );

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
        user_turns: None,
        assistant_turns: None,
        tool_counts: None,
        context_trend: None,
        git_branch: None,
        git_commit_short: None,
        git_worktree_branches: None,
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
            custom_title: None,
            agent_name: None,
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
            custom_title: None,
            agent_name: None,
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
            custom_title: None,
            agent_name: None,
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
            user_turns: None,
            assistant_turns: None,
            tool_counts: None,
            context_trend: None,
            git_branch: None,
            git_commit_short: None,
            git_worktree_branches: None,
        };

        let json_string = serde_json::to_string(&summary).unwrap();
        let deserialized: ClaudeSummary = serde_json::from_str(&json_string).unwrap();

        assert_eq!(summary, deserialized);
    }

    #[test]
    fn test_resolve_session_name_prefers_custom_title() {
        let result = resolve_session_name(Some("My Session"), None, Some("auto-slug"));
        assert_eq!(result.as_deref(), Some("My Session"));
    }

    #[test]
    fn test_resolve_session_name_falls_back_to_slug() {
        let result = resolve_session_name(None, None, Some("auto-slug"));
        assert_eq!(result.as_deref(), Some("auto-slug"));
    }

    #[test]
    fn test_resolve_session_name_returns_none_when_all_absent() {
        let result = resolve_session_name(None, None, None);
        assert_eq!(result, None);
    }

    #[test]
    fn test_resolve_session_name_jsonl_title_over_slug() {
        let result = resolve_session_name(None, Some("JSONL Title"), Some("auto-slug"));
        assert_eq!(result.as_deref(), Some("JSONL Title"));
    }

    #[test]
    fn test_resolve_session_name_index_title_over_jsonl_title() {
        let result = resolve_session_name(
            Some("Index Title"),
            Some("JSONL Title"),
            Some("auto-slug"),
        );
        assert_eq!(result.as_deref(), Some("Index Title"));
    }

    #[test]
    fn test_build_summary_uses_custom_title_over_slug() {
        // Entry with a slug.
        let mut entry = make_assistant_entry(Some("end_turn"), "claude-opus-4-6");
        entry.slug = Some("auto-slug".to_string());

        let summary = build_summary(&[entry], Some("My Custom Title"));
        assert_eq!(summary.session_name.as_deref(), Some("My Custom Title"));
    }

    #[test]
    fn test_build_summary_uses_slug_when_no_custom_title() {
        let mut entry = make_assistant_entry(Some("end_turn"), "claude-opus-4-6");
        entry.slug = Some("auto-slug".to_string());

        let summary = build_summary(&[entry], None);
        assert_eq!(summary.session_name.as_deref(), Some("auto-slug"));
    }

    #[test]
    fn test_build_summary_session_name_none_when_no_sources() {
        let entry = make_assistant_entry(Some("end_turn"), "claude-opus-4-6");
        let summary = build_summary(&[entry], None);
        assert_eq!(summary.session_name, None);
    }

    #[test]
    fn test_extract_jsonl_custom_title_from_custom_title_entry() {
        let entries = vec![
            make_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
            JsonlEntry {
                entry_type: "custom-title".to_string(),
                session_id: None,
                timestamp: None,
                is_sidechain: None,
                parent_tool_use_id: None,
                is_compact_summary: None,
                slug: None,
                message: None,
                data: None,
                custom_title: Some("my-renamed-session".to_string()),
                agent_name: None,
            },
        ];
        let result = extract_jsonl_custom_title(&entries);
        assert_eq!(result.as_deref(), Some("my-renamed-session"));
    }

    #[test]
    fn test_extract_jsonl_custom_title_falls_back_to_agent_name() {
        let entries = vec![
            JsonlEntry {
                entry_type: "agent-name".to_string(),
                session_id: None,
                timestamp: None,
                is_sidechain: None,
                parent_tool_use_id: None,
                is_compact_summary: None,
                slug: None,
                message: None,
                data: None,
                custom_title: None,
                agent_name: Some("agent-display-name".to_string()),
            },
        ];
        let result = extract_jsonl_custom_title(&entries);
        assert_eq!(result.as_deref(), Some("agent-display-name"));
    }

    #[test]
    fn test_extract_jsonl_custom_title_prefers_custom_title_over_agent_name() {
        let entries = vec![
            JsonlEntry {
                entry_type: "agent-name".to_string(),
                session_id: None,
                timestamp: None,
                is_sidechain: None,
                parent_tool_use_id: None,
                is_compact_summary: None,
                slug: None,
                message: None,
                data: None,
                custom_title: None,
                agent_name: Some("agent-name".to_string()),
            },
            JsonlEntry {
                entry_type: "custom-title".to_string(),
                session_id: None,
                timestamp: None,
                is_sidechain: None,
                parent_tool_use_id: None,
                is_compact_summary: None,
                slug: None,
                message: None,
                data: None,
                custom_title: Some("custom-title-wins".to_string()),
                agent_name: None,
            },
        ];
        let result = extract_jsonl_custom_title(&entries);
        assert_eq!(result.as_deref(), Some("custom-title-wins"));
    }

    #[test]
    fn test_build_summary_uses_jsonl_custom_title_when_no_index_title() {
        let entries = vec![
            make_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
            JsonlEntry {
                entry_type: "custom-title".to_string(),
                session_id: None,
                timestamp: None,
                is_sidechain: None,
                parent_tool_use_id: None,
                is_compact_summary: None,
                slug: Some("auto-slug".to_string()),
                message: None,
                data: None,
                custom_title: Some("jsonl-title".to_string()),
                agent_name: None,
            },
        ];
        // No sessions-index.json title (custom_title param is None).
        let summary = build_summary(&entries, None);
        assert_eq!(summary.session_name.as_deref(), Some("jsonl-title"));
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
