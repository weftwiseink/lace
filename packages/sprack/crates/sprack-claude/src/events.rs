//! Hook event reader for Claude Code lifecycle events.
//!
//! Reads per-session event files written by the sprack-hook-bridge script.
//! Events provide task list progress, session summary, and subagent lifecycle
//! data that the JSONL session file cannot provide.
//!
//! Event files are at `~/.local/share/sprack/claude-events/<session_id>.jsonl`.
//! Each line is a JSON object with a common envelope (ts, event, session_id, cwd, data).

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::status::{TaskEntry, TaskStatus};

/// A parsed hook event from a per-session event file.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum HookEvent {
    SessionStart {
        session_id: String,
        cwd: String,
        model: Option<String>,
        transcript_path: Option<String>,
    },
    TaskCreated {
        task_id: Option<String>,
        subject: String,
        description: Option<String>,
    },
    TaskUpdated {
        task_id: Option<String>,
        status: Option<String>,
    },
    TaskCompleted {
        task_id: Option<String>,
        subject: String,
        description: Option<String>,
    },
    SubagentStart {
        agent_id: Option<String>,
        agent_type: Option<String>,
    },
    SubagentStop {
        agent_id: Option<String>,
        agent_type: Option<String>,
    },
    PostCompact {
        compact_summary: String,
    },
    SessionEnd {
        reason: Option<String>,
    },
}

/// Raw event line from the event file.
#[derive(Debug, Deserialize)]
struct RawEvent {
    #[serde(default)]
    event: String,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    data: serde_json::Value,
}

/// Reads new events from an event file since the last read position.
///
/// Uses the same byte-offset incremental pattern as `jsonl::incremental_read`.
pub fn read_events(path: &Path, position: &mut u64) -> Vec<HookEvent> {
    read_events_inner(path, position).unwrap_or_default()
}

fn read_events_inner(path: &Path, position: &mut u64) -> anyhow::Result<Vec<HookEvent>> {
    let mut file = std::fs::File::open(path)?;
    let file_length = file.metadata()?.len();

    if file_length < *position {
        *position = 0;
    }
    if file_length == *position {
        return Ok(Vec::new());
    }

    file.seek(SeekFrom::Start(*position))?;
    let mut buffer = String::new();
    file.read_to_string(&mut buffer)?;
    *position = file_length;

    let events = buffer
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let raw: RawEvent = serde_json::from_str(line).ok()?;
            parse_event(&raw)
        })
        .collect();

    Ok(events)
}

fn parse_event(raw: &RawEvent) -> Option<HookEvent> {
    match raw.event.as_str() {
        "SessionStart" => Some(HookEvent::SessionStart {
            session_id: raw.session_id.clone(),
            cwd: raw.cwd.clone(),
            model: raw.data.get("model").and_then(|v| v.as_str()).map(String::from),
            transcript_path: raw
                .data
                .get("transcript_path")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        "PostToolUse" => {
            let tool_name = raw.data.get("tool_name").and_then(|v| v.as_str())?;
            match tool_name {
                "TaskCreate" => {
                    let input = raw.data.get("tool_input")?;
                    let response = raw.data.get("tool_response");
                    Some(HookEvent::TaskCreated {
                        task_id: response
                            .and_then(|r| r.get("task_id"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        subject: input
                            .get("subject")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        description: input
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                }
                "TaskUpdate" => {
                    let response = raw.data.get("tool_response");
                    Some(HookEvent::TaskUpdated {
                        task_id: response
                            .and_then(|r| r.get("task_id"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        status: response
                            .and_then(|r| r.get("status"))
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                }
                _ => None,
            }
        }
        "TaskCompleted" => Some(HookEvent::TaskCompleted {
            task_id: raw
                .data
                .get("task_id")
                .and_then(|v| v.as_str())
                .map(String::from),
            subject: raw
                .data
                .get("task_subject")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            description: raw
                .data
                .get("task_description")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        "SubagentStart" => Some(HookEvent::SubagentStart {
            agent_id: raw.data.get("agent_id").and_then(|v| v.as_str()).map(String::from),
            agent_type: raw.data.get("agent_type").and_then(|v| v.as_str()).map(String::from),
        }),
        "SubagentStop" => Some(HookEvent::SubagentStop {
            agent_id: raw.data.get("agent_id").and_then(|v| v.as_str()).map(String::from),
            agent_type: raw.data.get("agent_type").and_then(|v| v.as_str()).map(String::from),
        }),
        "PostCompact" => {
            let summary = raw
                .data
                .get("compact_summary")
                .and_then(|v| v.as_str())?;
            Some(HookEvent::PostCompact {
                compact_summary: summary.to_string(),
            })
        }
        "SessionEnd" => Some(HookEvent::SessionEnd {
            reason: raw.data.get("reason").and_then(|v| v.as_str()).map(String::from),
        }),
        _ => None,
    }
}

/// Locates the event file for a session by its session_id.
///
/// Returns the path if the corresponding event file exists.
/// Used when a SessionStart event has been seen and the session_id is known.
pub fn find_event_file_by_session_id(event_dir: &Path, session_id: &str) -> Option<PathBuf> {
    let path = event_dir.join(format!("{session_id}.jsonl"));
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

/// Locates the event file for a pane by scanning the event directory for matching `cwd`.
///
/// Only matches event files whose most recent `cwd` field matches the pane's working directory.
/// Returns `None` if no exact cwd match is found (conservative: avoids matching the wrong
/// event file when multiple sessions share the same working directory).
pub fn find_event_file(event_dir: &Path, pane_cwd: &str) -> Option<PathBuf> {
    let read_dir = std::fs::read_dir(event_dir).ok()?;

    let mut candidates: Vec<(PathBuf, std::time::SystemTime)> = read_dir
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext == "jsonl")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();

    // Sort by mtime descending (most recent first).
    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    // Only return an exact cwd match. No fallback to most-recent file:
    // without a cwd match, we cannot be sure which session the file belongs to.
    for (path, _) in &candidates {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Some(last_line) = content.lines().rev().find(|l| !l.is_empty()) {
                if let Ok(raw) = serde_json::from_str::<RawEvent>(last_line) {
                    if raw.cwd == pane_cwd {
                        return Some(path.clone());
                    }
                }
            }
        }
    }

    None
}

/// Merges hook events into a ClaudeSummary, populating task list, session summary,
/// and session purpose fields.
///
/// Events are processed in order. Task state is tracked incrementally:
/// TaskCreated adds an entry, TaskUpdated changes status, TaskCompleted marks complete.
pub fn merge_hook_events(
    summary: &mut crate::status::ClaudeSummary,
    events: &[HookEvent],
) {
    let mut tasks: Vec<TaskEntry> = Vec::new();
    let mut session_summary: Option<String> = None;
    let mut session_purpose: Option<String> = None;
    // Track batch boundaries: each entry is the starting task index for a batch.
    // A new batch starts each time a TaskCreated event follows a non-TaskCreated event.
    let mut batch_starts: Vec<usize> = Vec::new();
    let mut last_was_create = false;

    for event in events {
        match event {
            HookEvent::SessionStart { cwd, .. } => {
                // Use the cwd as a basic session purpose until PostCompact provides a better one.
                if session_purpose.is_none() {
                    session_purpose = Some(cwd.clone());
                }
                last_was_create = false;
            }
            HookEvent::TaskCreated {
                task_id,
                subject,
                description,
            } => {
                if !last_was_create {
                    batch_starts.push(tasks.len());
                }
                tasks.push(TaskEntry {
                    task_id: task_id.clone().unwrap_or_default(),
                    subject: subject.clone(),
                    description: description.clone(),
                    status: TaskStatus::Created,
                });
                last_was_create = true;
            }
            HookEvent::TaskUpdated { task_id, status } => {
                if let Some(tid) = task_id {
                    if let Some(task) = tasks.iter_mut().find(|t| t.task_id == *tid) {
                        task.status = match status.as_deref() {
                            Some("in_progress") => TaskStatus::InProgress,
                            Some("completed") => TaskStatus::Completed,
                            _ => task.status.clone(),
                        };
                    }
                }
                last_was_create = false;
            }
            HookEvent::TaskCompleted {
                task_id, subject, ..
            } => {
                if let Some(tid) = task_id {
                    if let Some(task) = tasks.iter_mut().find(|t| t.task_id == *tid) {
                        task.status = TaskStatus::Completed;
                    } else {
                        // Task completed without a prior create event (possible if hooks
                        // were configured mid-session).
                        tasks.push(TaskEntry {
                            task_id: tid.clone(),
                            subject: subject.clone(),
                            description: None,
                            status: TaskStatus::Completed,
                        });
                    }
                }
                last_was_create = false;
            }
            HookEvent::PostCompact { compact_summary } => {
                // PostCompact provides a semantic summary of the session's work.
                // session_summary is the raw compact output.
                // session_purpose is derived: PostCompact > cwd fallback.
                session_summary = Some(compact_summary.clone());
                session_purpose = Some(compact_summary.clone());
                last_was_create = false;
            }
            _ => {
                last_was_create = false;
            }
        }
    }

    if !tasks.is_empty() {
        // Prune stale completed task batches. A "batch" is a consecutive group
        // of TaskCreated events (tasks created in the same Claude turn). If ALL
        // tasks in a batch are Completed, and there are newer batches after it,
        // remove the completed batch from the display. This prevents old
        // completed tasks from prior Claude turns from persisting forever.
        let prune_boundary = find_batch_prune_boundary(&tasks, &batch_starts);
        if prune_boundary > 0 {
            tasks.drain(..prune_boundary);
        }
        summary.tasks = Some(tasks);
    }
    if session_summary.is_some() {
        summary.session_summary = session_summary;
    }
    if session_purpose.is_some() {
        summary.session_purpose = session_purpose;
    }
}

/// Finds the prune boundary based on batch structure.
///
/// A batch is a consecutive group of TaskCreated events (identified by
/// `batch_starts`). If all tasks in a batch are Completed AND there is at
/// least one subsequent batch, the completed batch can be pruned.
///
/// Returns the task index to prune up to (0 if no pruning needed).
fn find_batch_prune_boundary(tasks: &[TaskEntry], batch_starts: &[usize]) -> usize {
    if batch_starts.len() <= 1 {
        // Single batch or no batches: nothing to prune.
        return 0;
    }

    let mut prune_up_to = 0;
    for window in batch_starts.windows(2) {
        let batch_start = window[0];
        let batch_end = window[1]; // start of next batch = end of this batch
        let batch_tasks = &tasks[batch_start..batch_end];

        if batch_tasks.iter().all(|t| t.status == TaskStatus::Completed) {
            // This batch is fully completed and there are later batches.
            prune_up_to = batch_end;
        } else {
            // Found a non-fully-completed batch: stop pruning.
            break;
        }
    }

    prune_up_to
}

/// Returns all event directories: per-project mounts first, then the legacy flat directory.
///
/// Per-project directories are at `~/.local/share/sprack/lace/*/claude-events/`.
/// The legacy flat directory is at `~/.local/share/sprack/claude-events/`.
/// Per-project directories are searched first (higher priority: more likely to be current).
#[allow(dead_code)]
pub fn event_dirs() -> Vec<PathBuf> {
    let home = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => return Vec::new(),
    };
    event_dirs_from_home(&home)
}

/// Discover event directories relative to a given home directory.
/// Separated from `event_dirs()` for testability.
pub fn event_dirs_from_home(home: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // Per-project: lace container mounts at ~/.local/share/sprack/lace/*/claude-events/.
    let container_mounts_dir = home.join(".local/share/sprack/lace");
    if let Ok(entries) = std::fs::read_dir(&container_mounts_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let events_dir = entry.path().join("claude-events");
            if events_dir.is_dir() {
                dirs.push(events_dir);
            }
        }
    }

    // Legacy/local: flat event directory for host-side sessions.
    let flat_dir = home.join(".local/share/sprack/claude-events");
    if flat_dir.is_dir() {
        dirs.push(flat_dir);
    }

    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_event_line(path: &Path, event: &str, session_id: &str, cwd: &str, data: &str) {
        use std::io::Write;
        let line = format!(
            r#"{{"ts":"2026-03-24T20:00:00Z","event":"{event}","session_id":"{session_id}","cwd":"{cwd}","data":{data}}}"#
        );
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        writeln!(file, "{line}").unwrap();
    }

    #[test]
    fn read_events_parses_session_start() {
        let dir = tempfile::tempdir().unwrap();
        let event_file = dir.path().join("test-session.jsonl");
        write_event_line(
            &event_file,
            "SessionStart",
            "abc-123",
            "/workspaces/lace",
            r#"{"model":"claude-opus-4-6","transcript_path":"/home/.claude/test.jsonl"}"#,
        );

        let mut pos = 0;
        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 1);
        match &events[0] {
            HookEvent::SessionStart {
                session_id,
                model,
                transcript_path,
                ..
            } => {
                assert_eq!(session_id, "abc-123");
                assert_eq!(model.as_deref(), Some("claude-opus-4-6"));
                assert!(transcript_path.is_some());
            }
            _ => panic!("Expected SessionStart"),
        }
    }

    #[test]
    fn read_events_parses_task_completed() {
        let dir = tempfile::tempdir().unwrap();
        let event_file = dir.path().join("test-tasks.jsonl");
        write_event_line(
            &event_file,
            "TaskCompleted",
            "abc-123",
            "/workspaces/lace",
            r#"{"task_id":"t1","task_subject":"Fix bug","task_description":"Fix the login bug"}"#,
        );

        let mut pos = 0;
        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 1);
        match &events[0] {
            HookEvent::TaskCompleted {
                task_id, subject, ..
            } => {
                assert_eq!(task_id.as_deref(), Some("t1"));
                assert_eq!(subject, "Fix bug");
            }
            _ => panic!("Expected TaskCompleted"),
        }
    }

    #[test]
    fn read_events_parses_post_compact() {
        let dir = tempfile::tempdir().unwrap();
        let event_file = dir.path().join("test-compact.jsonl");
        write_event_line(
            &event_file,
            "PostCompact",
            "abc-123",
            "/workspaces/lace",
            r#"{"compact_summary":"Working on sprack hook bridge implementation."}"#,
        );

        let mut pos = 0;
        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 1);
        match &events[0] {
            HookEvent::PostCompact { compact_summary } => {
                assert_eq!(compact_summary, "Working on sprack hook bridge implementation.");
            }
            _ => panic!("Expected PostCompact"),
        }
    }

    #[test]
    fn read_events_incremental() {
        let dir = tempfile::tempdir().unwrap();
        let event_file = dir.path().join("test-incremental.jsonl");
        write_event_line(
            &event_file,
            "SessionStart",
            "s1",
            "/work",
            r#"{"model":"opus"}"#,
        );

        let mut pos = 0;
        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 1);
        assert!(pos > 0);

        // Second read with no new data.
        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 0);

        // Append new event.
        write_event_line(
            &event_file,
            "TaskCompleted",
            "s1",
            "/work",
            r#"{"task_id":"t1","task_subject":"Done"}"#,
        );

        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 1);
        match &events[0] {
            HookEvent::TaskCompleted { subject, .. } => assert_eq!(subject, "Done"),
            _ => panic!("Expected TaskCompleted"),
        }
    }

    #[test]
    fn find_event_file_matches_by_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let event_dir = dir.path();

        // Create two event files with different cwds.
        let file_a = event_dir.join("session-a.jsonl");
        write_event_line(&file_a, "SessionStart", "a", "/workspaces/lace", r#"{}"#);

        let file_b = event_dir.join("session-b.jsonl");
        write_event_line(&file_b, "SessionStart", "b", "/workspaces/other", r#"{}"#);

        let result = find_event_file(event_dir, "/workspaces/lace");
        assert_eq!(result, Some(file_a));
    }

    #[test]
    fn find_event_file_by_session_id_returns_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let event_dir = dir.path();

        let file = event_dir.join("abc-123.jsonl");
        write_event_line(&file, "SessionStart", "abc-123", "/workspaces/lace", r#"{}"#);

        let result = find_event_file_by_session_id(event_dir, "abc-123");
        assert_eq!(result, Some(file));
    }

    #[test]
    fn find_event_file_by_session_id_returns_none_for_missing() {
        let dir = tempfile::tempdir().unwrap();
        let event_dir = dir.path();

        let result = find_event_file_by_session_id(event_dir, "nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn session_start_provides_transcript_path() {
        let dir = tempfile::tempdir().unwrap();
        let event_file = dir.path().join("sess-1.jsonl");
        write_event_line(
            &event_file,
            "SessionStart",
            "sess-1",
            "/workspaces/lace",
            r#"{"model":"opus","transcript_path":"/home/user/.claude/projects/-workspaces-lace/session-abc.jsonl"}"#,
        );

        let mut pos = 0;
        let events = read_events(&event_file, &mut pos);
        assert_eq!(events.len(), 1);

        // Extract session_id and transcript_path from the event.
        if let HookEvent::SessionStart {
            session_id,
            transcript_path,
            ..
        } = &events[0]
        {
            assert_eq!(session_id, "sess-1");
            assert_eq!(
                transcript_path.as_deref(),
                Some("/home/user/.claude/projects/-workspaces-lace/session-abc.jsonl")
            );
        } else {
            panic!("Expected SessionStart");
        }
    }

    #[test]
    fn merge_hook_events_builds_task_list() {
        let events = vec![
            HookEvent::TaskCreated {
                task_id: Some("t1".to_string()),
                subject: "First task".to_string(),
                description: None,
            },
            HookEvent::TaskCreated {
                task_id: Some("t2".to_string()),
                subject: "Second task".to_string(),
                description: Some("Details".to_string()),
            },
            HookEvent::TaskCompleted {
                task_id: Some("t1".to_string()),
                subject: "First task".to_string(),
                description: None,
            },
        ];

        let mut summary = crate::status::ClaudeSummary {
            state: "thinking".to_string(),
            model: None,
            subagent_count: 0,
            context_percent: 0,
            last_tool: None,
            error_message: None,
            last_activity: None,
            tasks: None,
            session_summary: None,
            session_purpose: None,
            tokens_used: None,
            tokens_max: None,
            session_name: None,
            user_turns: None,
            assistant_turns: None,
            tool_counts: None,
            context_trend: None,
            git_branch: None,
            git_commit_short: None,
            git_worktree_branches: None,
        };

        merge_hook_events(&mut summary, &events);

        let tasks = summary.tasks.unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].subject, "First task");
        assert_eq!(tasks[0].status, TaskStatus::Completed);
        assert_eq!(tasks[1].subject, "Second task");
        assert_eq!(tasks[1].status, TaskStatus::Created);
    }

    #[test]
    fn merge_hook_events_sets_session_summary() {
        let events = vec![HookEvent::PostCompact {
            compact_summary: "Implementing sprack features.".to_string(),
        }];

        let mut summary = crate::status::ClaudeSummary {
            state: "idle".to_string(),
            model: None,
            subagent_count: 0,
            context_percent: 0,
            last_tool: None,
            error_message: None,
            last_activity: None,
            tasks: None,
            session_summary: None,
            session_purpose: None,
            tokens_used: None,
            tokens_max: None,
            session_name: None,
            user_turns: None,
            assistant_turns: None,
            tool_counts: None,
            context_trend: None,
            git_branch: None,
            git_commit_short: None,
            git_worktree_branches: None,
        };

        merge_hook_events(&mut summary, &events);

        assert_eq!(
            summary.session_summary.as_deref(),
            Some("Implementing sprack features.")
        );
        assert_eq!(
            summary.session_purpose.as_deref(),
            Some("Implementing sprack features.")
        );
    }

    #[test]
    fn merge_hook_events_prunes_completed_batch_prefix() {
        // Simulate two batches: batch 1 is fully completed, batch 2 is in progress.
        // After merging, only batch 2 tasks should remain.
        let events = vec![
            // Batch 1: fully completed.
            HookEvent::TaskCreated {
                task_id: Some("t1".to_string()),
                subject: "Old task A".to_string(),
                description: None,
            },
            HookEvent::TaskCreated {
                task_id: Some("t2".to_string()),
                subject: "Old task B".to_string(),
                description: None,
            },
            HookEvent::TaskCompleted {
                task_id: Some("t1".to_string()),
                subject: "Old task A".to_string(),
                description: None,
            },
            HookEvent::TaskCompleted {
                task_id: Some("t2".to_string()),
                subject: "Old task B".to_string(),
                description: None,
            },
            // Batch 2: still in progress.
            HookEvent::TaskCreated {
                task_id: Some("t3".to_string()),
                subject: "Current task".to_string(),
                description: None,
            },
        ];

        let mut summary = crate::status::ClaudeSummary {
            state: "thinking".to_string(),
            model: None,
            subagent_count: 0,
            context_percent: 0,
            last_tool: None,
            error_message: None,
            last_activity: None,
            tasks: None,
            session_summary: None,
            session_purpose: None,
            tokens_used: None,
            tokens_max: None,
            session_name: None,
            user_turns: None,
            assistant_turns: None,
            tool_counts: None,
            context_trend: None,
            git_branch: None,
            git_commit_short: None,
            git_worktree_branches: None,
        };

        merge_hook_events(&mut summary, &events);

        let tasks = summary.tasks.unwrap();
        assert_eq!(tasks.len(), 1, "only current batch tasks should remain");
        assert_eq!(tasks[0].subject, "Current task");
        assert_eq!(tasks[0].status, TaskStatus::Created);
    }

    #[test]
    fn merge_hook_events_keeps_all_when_all_completed() {
        // When all tasks are completed (single batch), show them all rather
        // than pruning everything.
        let events = vec![
            HookEvent::TaskCreated {
                task_id: Some("t1".to_string()),
                subject: "Task A".to_string(),
                description: None,
            },
            HookEvent::TaskCreated {
                task_id: Some("t2".to_string()),
                subject: "Task B".to_string(),
                description: None,
            },
            HookEvent::TaskCompleted {
                task_id: Some("t1".to_string()),
                subject: "Task A".to_string(),
                description: None,
            },
            HookEvent::TaskCompleted {
                task_id: Some("t2".to_string()),
                subject: "Task B".to_string(),
                description: None,
            },
        ];

        let mut summary = crate::status::ClaudeSummary {
            state: "idle".to_string(),
            model: None,
            subagent_count: 0,
            context_percent: 0,
            last_tool: None,
            error_message: None,
            last_activity: None,
            tasks: None,
            session_summary: None,
            session_purpose: None,
            tokens_used: None,
            tokens_max: None,
            session_name: None,
            user_turns: None,
            assistant_turns: None,
            tool_counts: None,
            context_trend: None,
            git_branch: None,
            git_commit_short: None,
            git_worktree_branches: None,
        };

        merge_hook_events(&mut summary, &events);

        let tasks = summary.tasks.unwrap();
        assert_eq!(tasks.len(), 2, "all tasks shown when entire list is completed");
        assert!(tasks.iter().all(|t| t.status == TaskStatus::Completed));
    }

    #[test]
    fn find_batch_prune_boundary_single_batch_no_prune() {
        let tasks = vec![
            TaskEntry {
                task_id: "t1".to_string(),
                subject: "A".to_string(),
                description: None,
                status: TaskStatus::InProgress,
            },
            TaskEntry {
                task_id: "t2".to_string(),
                subject: "B".to_string(),
                description: None,
                status: TaskStatus::Created,
            },
        ];
        // Single batch: no pruning regardless of status.
        assert_eq!(find_batch_prune_boundary(&tasks, &[0]), 0);
    }

    #[test]
    fn find_batch_prune_boundary_completed_batch_then_active() {
        let tasks = vec![
            TaskEntry {
                task_id: "t1".to_string(),
                subject: "A".to_string(),
                description: None,
                status: TaskStatus::Completed,
            },
            TaskEntry {
                task_id: "t2".to_string(),
                subject: "B".to_string(),
                description: None,
                status: TaskStatus::Completed,
            },
            TaskEntry {
                task_id: "t3".to_string(),
                subject: "C".to_string(),
                description: None,
                status: TaskStatus::InProgress,
            },
        ];
        // Batch 1 (t1, t2) at index 0, Batch 2 (t3) at index 2.
        // Batch 1 is fully completed: prune up to index 2.
        assert_eq!(find_batch_prune_boundary(&tasks, &[0, 2]), 2);
    }

    #[test]
    fn find_batch_prune_boundary_mixed_batch_no_prune() {
        let tasks = vec![
            TaskEntry {
                task_id: "t1".to_string(),
                subject: "A".to_string(),
                description: None,
                status: TaskStatus::Completed,
            },
            TaskEntry {
                task_id: "t2".to_string(),
                subject: "B".to_string(),
                description: None,
                status: TaskStatus::Created,
            },
            TaskEntry {
                task_id: "t3".to_string(),
                subject: "C".to_string(),
                description: None,
                status: TaskStatus::InProgress,
            },
        ];
        // Batch 1 (t1, t2) has t2 not completed: no pruning.
        assert_eq!(find_batch_prune_boundary(&tasks, &[0, 2]), 0);
    }

    // ── event_dirs_from_home tests ──

    #[test]
    fn event_dirs_returns_empty_for_nonexistent_home() {
        let dir = tempfile::tempdir().unwrap();
        let fake_home = dir.path().join("nonexistent");
        let dirs = event_dirs_from_home(&fake_home);
        assert!(dirs.is_empty());
    }

    #[test]
    fn event_dirs_returns_legacy_flat_dir_only() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let flat_dir = home.join(".local/share/sprack/claude-events");
        std::fs::create_dir_all(&flat_dir).unwrap();

        let dirs = event_dirs_from_home(home);
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0], flat_dir);
    }

    #[test]
    fn event_dirs_returns_per_project_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let proj_a = home.join(".local/share/sprack/lace/project-a/claude-events");
        let proj_b = home.join(".local/share/sprack/lace/project-b/claude-events");
        std::fs::create_dir_all(&proj_a).unwrap();
        std::fs::create_dir_all(&proj_b).unwrap();

        let dirs = event_dirs_from_home(home);
        assert_eq!(dirs.len(), 2);
        // Both project dirs should be present (order depends on fs enumeration).
        assert!(dirs.contains(&proj_a));
        assert!(dirs.contains(&proj_b));
    }

    #[test]
    fn event_dirs_per_project_before_legacy() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let flat_dir = home.join(".local/share/sprack/claude-events");
        let proj_dir = home.join(".local/share/sprack/lace/my-project/claude-events");
        std::fs::create_dir_all(&flat_dir).unwrap();
        std::fs::create_dir_all(&proj_dir).unwrap();

        let dirs = event_dirs_from_home(home);
        assert_eq!(dirs.len(), 2);
        // Per-project directories come first, legacy flat dir last.
        assert_eq!(dirs[dirs.len() - 1], flat_dir);
        assert_eq!(dirs[0], proj_dir);
    }

    #[test]
    fn event_dirs_skips_projects_without_claude_events_subdir() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        // Create a project dir without the claude-events subdirectory.
        let proj_no_events = home.join(".local/share/sprack/lace/empty-project/metadata");
        std::fs::create_dir_all(&proj_no_events).unwrap();
        // Create a project dir WITH the claude-events subdirectory.
        let proj_with_events = home.join(".local/share/sprack/lace/active-project/claude-events");
        std::fs::create_dir_all(&proj_with_events).unwrap();

        let dirs = event_dirs_from_home(home);
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0], proj_with_events);
    }

    #[test]
    fn find_event_file_across_multiple_dirs() {
        let dir = tempfile::tempdir().unwrap();
        // Simulate two event directories (per-project and legacy).
        let proj_dir = dir.path().join("project-events");
        let legacy_dir = dir.path().join("legacy-events");
        std::fs::create_dir_all(&proj_dir).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();

        // Write an event in the project directory.
        let proj_file = proj_dir.join("sess-proj.jsonl");
        write_event_line(&proj_file, "SessionStart", "sess-proj", "/workspaces/lace", r#"{}"#);

        // Write an event in the legacy directory.
        let legacy_file = legacy_dir.join("sess-legacy.jsonl");
        write_event_line(&legacy_file, "SessionStart", "sess-legacy", "/home/user/code", r#"{}"#);

        // Search by session_id: should find in project dir.
        let found = find_event_file_by_session_id(&proj_dir, "sess-proj");
        assert_eq!(found, Some(proj_file));

        // Search by cwd in legacy dir.
        let found = find_event_file(&legacy_dir, "/home/user/code");
        assert_eq!(found, Some(legacy_file));
    }
}
