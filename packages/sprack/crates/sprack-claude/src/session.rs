//! Session file discovery for Claude Code projects.
//!
//! Resolves a Claude Code project directory to its active JSONL session file
//! using a two-tier strategy: parse sessions-index.json (primary), or list
//! root-level .jsonl files by mtime (fallback).

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Top-level structure of Claude Code's sessions-index.json file.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct SessionsIndex {
    /// Schema version.
    #[serde(default)]
    pub version: Option<u32>,

    /// Session entries.
    #[serde(default)]
    pub entries: Vec<SessionIndexEntry>,
}

/// An entry from Claude Code's sessions-index.json file.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct SessionIndexEntry {
    /// Full absolute path to the session file.
    #[serde(rename = "fullPath", default)]
    pub full_path: Option<String>,

    /// File modification time as a string (ISO 8601 or numeric).
    #[serde(rename = "fileMtime", default)]
    pub file_mtime: Option<serde_json::Value>,

    /// Whether this session is a sidechain (subagent session).
    #[serde(rename = "isSidechain", default)]
    pub is_sidechain: Option<bool>,

    /// Session identifier.
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,

    /// User-set session name via `/rename` command.
    #[serde(rename = "customTitle", default)]
    pub custom_title: Option<String>,
}

/// Cache key for session invalidation.
///
/// Local panes use the Claude PID (check `/proc/<pid>` existence).
/// Container panes use the session file path (check file existence + recent mtime).
#[derive(Debug, Clone)]
pub enum CacheKey {
    /// Local pane: PID of the Claude Code process.
    Pid(u32),
    /// Container pane: path to the session file (no PID available across PID namespace).
    ContainerSession(PathBuf),
}

/// Cached state for a resolved session file.
pub struct SessionFileState {
    /// Cache key for invalidation: PID for local panes, file path for container panes.
    pub cache_key: CacheKey,
    /// Path to the active session file.
    pub session_file: PathBuf,
    /// Last read position for incremental JSONL reads.
    pub file_position: u64,
    /// The most recent entries from the last JSONL read.
    pub last_entries: Vec<crate::jsonl::JsonlEntry>,
    /// Last read position for hook event file.
    pub event_file_position: u64,
    /// Accumulated hook events for this session.
    pub cached_hook_events: Vec<crate::events::HookEvent>,
    /// Claude Code session name: `customTitle` from sessions-index.json (user-set via
    /// `/rename`), falling back to `slug` from JSONL entries (auto-generated).
    pub session_name: Option<String>,
    /// Transcript path from a SessionStart hook event.
    /// When set, this is the exact JSONL session file for this specific Claude instance,
    /// bypassing the mtime-based heuristic that can conflate multiple instances in the
    /// same project directory.
    pub hook_transcript_path: Option<PathBuf>,
    /// Session ID from a SessionStart hook event.
    /// Used to locate the correct event file via `find_event_file_by_session_id`
    /// instead of the cwd-based `find_event_file` scan.
    pub hook_session_id: Option<String>,
    /// Resolved `.git` directory path (avoids re-walking parents each cycle).
    pub git_dir: Option<std::path::PathBuf>,
    /// Last observed mtime of `.git/HEAD` for cache invalidation.
    pub git_head_mtime: Option<std::time::SystemTime>,
    /// Cached branch name from `.git/HEAD`.
    pub git_branch: Option<String>,
    /// Cached short commit hash (7 characters).
    pub git_commit_short: Option<String>,
    /// Last observed mtime of the `worktrees/` directory for cache invalidation.
    pub git_worktrees_mtime: Option<std::time::SystemTime>,
    /// Cached worktree branch names (other branches, excluding current).
    pub git_worktree_branches: Option<Vec<String>>,
    /// Poll cycle counter for periodic tail_read refresh.
    /// Every N cycles, a full tail_read replaces incremental_read to catch
    /// state transitions that incremental reading may have missed.
    pub poll_cycle_count: u32,
}

/// Result of resolving a session file: the path and optional user-set session name.
pub struct ResolvedSession {
    /// Path to the active session file.
    pub path: PathBuf,
    /// User-set session name from sessions-index.json `customTitle` field.
    pub custom_title: Option<String>,
}

/// Finds the active session file for a Claude Code project directory.
///
/// Primary strategy: parse sessions-index.json, filter out sidechains,
/// and select the entry with the most recent file modification time.
/// Fallback: list root-level .jsonl files sorted by mtime descending.
pub fn find_session_file(project_dir: &Path) -> Option<ResolvedSession> {
    // Primary: parse sessions-index.json.
    if let Some(resolved) = find_via_sessions_index(project_dir) {
        return Some(resolved);
    }

    // Fallback: list root-level .jsonl files by mtime (no customTitle available).
    find_via_jsonl_listing(project_dir).map(|path| ResolvedSession {
        path,
        custom_title: None,
    })
}

/// Parses sessions-index.json and returns the most recent non-sidechain session file.
///
/// Handles both the versioned format `{version, entries}` and a flat array of entries.
fn find_via_sessions_index(project_dir: &Path) -> Option<ResolvedSession> {
    let index_path = project_dir.join("sessions-index.json");
    let index_content = std::fs::read_to_string(&index_path).ok()?;

    // Try versioned format first (`{version, entries}`), then flat array.
    let entries: Vec<SessionIndexEntry> =
        if let Ok(index) = serde_json::from_str::<SessionsIndex>(&index_content) {
            index.entries
        } else {
            serde_json::from_str(&index_content).ok()?
        };

    // Filter out sidechains.
    let non_sidechain_entries: Vec<&SessionIndexEntry> = entries
        .iter()
        .filter(|entry| !entry.is_sidechain.unwrap_or(false))
        .collect();

    if non_sidechain_entries.is_empty() {
        return None;
    }

    // Pick the entry with the most recent fileMtime.
    // fileMtime can be a number (epoch ms) or a string; compare as f64.
    let best_entry = non_sidechain_entries.into_iter().max_by(|a, b| {
        let mtime_a = extract_mtime_value(&a.file_mtime);
        let mtime_b = extract_mtime_value(&b.file_mtime);
        mtime_a
            .partial_cmp(&mtime_b)
            .unwrap_or(std::cmp::Ordering::Equal)
    })?;

    let full_path = best_entry.full_path.as_ref()?;
    let path = PathBuf::from(full_path);

    if path.exists() {
        Some(ResolvedSession {
            path,
            custom_title: best_entry.custom_title.clone(),
        })
    } else {
        None
    }
}

/// Extracts a numeric mtime value from a serde_json::Value.
fn extract_mtime_value(value: &Option<serde_json::Value>) -> f64 {
    match value {
        Some(serde_json::Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(serde_json::Value::String(string)) => string.parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// Lists root-level .jsonl files in the project directory, sorted by mtime descending.
///
/// Ignores files in subdirectories (which are subagent session files).
/// Used as a fallback for container resolution when `sessions-index.json`
/// entries contain container-internal absolute paths that do not resolve on the host.
pub fn find_via_jsonl_listing(project_dir: &Path) -> Option<PathBuf> {
    let read_dir = std::fs::read_dir(project_dir).ok()?;

    let mut jsonl_files: Vec<(PathBuf, std::time::SystemTime)> = read_dir
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let path = entry.path();
            path.is_file() && path.extension().is_some_and(|ext| ext == "jsonl")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();

    // Sort by mtime descending: most recent first.
    jsonl_files.sort_by(|a, b| b.1.cmp(&a.1));

    jsonl_files.into_iter().next().map(|(path, _)| path)
}

/// Looks up a session's `customTitle` by searching all `sessions-index.json` files
/// under `~/.claude/projects/` for an entry matching the given `session_id`.
///
/// Used to resolve container session names: the container itself has no
/// `sessions-index.json`, but the host project directory's index has entries
/// for sessions started via hooks, keyed by `sessionId`.
pub fn lookup_session_name_by_id(
    claude_home: &Path,
    session_id: &str,
) -> Option<String> {
    let projects_dir = claude_home.join("projects");
    let read_dir = std::fs::read_dir(&projects_dir).ok()?;

    for entry in read_dir.filter_map(|e| e.ok()) {
        let index_path = entry.path().join("sessions-index.json");
        let content = match std::fs::read_to_string(&index_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Try versioned format first, then flat array.
        let entries: Vec<SessionIndexEntry> =
            if let Ok(index) = serde_json::from_str::<SessionsIndex>(&content) {
                index.entries
            } else if let Ok(entries) = serde_json::from_str(&content) {
                entries
            } else {
                continue;
            };

        for index_entry in &entries {
            if index_entry.session_id.as_deref() == Some(session_id) {
                if let Some(ref title) = index_entry.custom_title {
                    if !title.is_empty() {
                        return Some(title.clone());
                    }
                }
            }
        }
    }

    None
}

/// Looks up a session's `customTitle` by searching all `sessions-index.json` files
/// under `~/.claude/projects/` for an entry whose `fullPath` matches the given session file path.
///
/// This is the primary naming path for container sessions resolved via the project
/// directory fallback, where the JSONL `sessionId` may not match the index entry's
/// `sessionId` (e.g., when the file was created by a different session than currently
/// active). Matching by file path is unambiguous.
pub fn lookup_session_name_by_path(
    claude_home: &Path,
    session_file: &Path,
) -> Option<String> {
    let projects_dir = claude_home.join("projects");
    let read_dir = std::fs::read_dir(&projects_dir).ok()?;

    let session_file_str = session_file.to_str()?;

    for entry in read_dir.filter_map(|e| e.ok()) {
        let index_path = entry.path().join("sessions-index.json");
        let content = match std::fs::read_to_string(&index_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Try versioned format first, then flat array.
        let entries: Vec<SessionIndexEntry> =
            if let Ok(index) = serde_json::from_str::<SessionsIndex>(&content) {
                index.entries
            } else if let Ok(entries) = serde_json::from_str(&content) {
                entries
            } else {
                continue;
            };

        for index_entry in &entries {
            if index_entry.full_path.as_deref() == Some(session_file_str) {
                if let Some(ref title) = index_entry.custom_title {
                    if !title.is_empty() {
                        return Some(title.clone());
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_session_file_via_jsonl_listing() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path();

        // Create two .jsonl files with different mtimes.
        let older = project_dir.join("session-old.jsonl");
        std::fs::write(&older, r#"{"type":"user"}"#).unwrap();

        // Brief pause to ensure different mtime.
        std::thread::sleep(std::time::Duration::from_millis(20));

        let newer = project_dir.join("session-new.jsonl");
        std::fs::write(&newer, r#"{"type":"user"}"#).unwrap();

        let result = find_session_file(project_dir);
        assert_eq!(result.as_ref().map(|r| &r.path), Some(&newer));
        assert_eq!(result.as_ref().and_then(|r| r.custom_title.as_deref()), None);
    }

    #[test]
    fn find_session_file_ignores_subdirectory_files() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path();

        // Create a .jsonl in root and one in a subdirectory.
        let root_file = project_dir.join("session-root.jsonl");
        std::fs::write(&root_file, r#"{"type":"user"}"#).unwrap();

        let subdir = project_dir.join("subagent");
        std::fs::create_dir(&subdir).unwrap();
        let sub_file = subdir.join("session-sub.jsonl");
        std::fs::write(&sub_file, r#"{"type":"user"}"#).unwrap();

        // find_session_file should return the root file only.
        let result = find_session_file(project_dir);
        assert_eq!(result.as_ref().map(|r| &r.path), Some(&root_file));
    }

    #[test]
    fn find_session_file_via_sessions_index() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path();

        // Create a session file.
        let session_file = project_dir.join("session-abc.jsonl");
        std::fs::write(&session_file, r#"{"type":"user"}"#).unwrap();

        // Create sessions-index.json pointing to it (flat array format).
        let index = serde_json::json!([
            {
                "fullPath": session_file.to_str().unwrap(),
                "fileMtime": 1700000000000u64,
                "isSidechain": false,
                "sessionId": "abc"
            }
        ]);
        let index_path = project_dir.join("sessions-index.json");
        std::fs::write(&index_path, serde_json::to_string(&index).unwrap()).unwrap();

        let result = find_session_file(project_dir);
        assert_eq!(result.as_ref().map(|r| &r.path), Some(&session_file));
    }

    #[test]
    fn find_session_file_via_versioned_sessions_index() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path();

        // Create a session file.
        let session_file = project_dir.join("session-abc.jsonl");
        std::fs::write(&session_file, r#"{"type":"user"}"#).unwrap();

        // Create sessions-index.json in versioned format with customTitle.
        let index = serde_json::json!({
            "version": 1,
            "entries": [
                {
                    "fullPath": session_file.to_str().unwrap(),
                    "fileMtime": 1700000000000u64,
                    "isSidechain": false,
                    "sessionId": "abc",
                    "customTitle": "my-session"
                }
            ]
        });
        let index_path = project_dir.join("sessions-index.json");
        std::fs::write(&index_path, serde_json::to_string(&index).unwrap()).unwrap();

        let result = find_session_file(project_dir);
        assert_eq!(result.as_ref().map(|r| &r.path), Some(&session_file));
        assert_eq!(
            result.as_ref().and_then(|r| r.custom_title.as_deref()),
            Some("my-session")
        );
    }

    #[test]
    fn find_session_file_skips_sidechains() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path();

        let main_file = project_dir.join("session-main.jsonl");
        std::fs::write(&main_file, r#"{"type":"user"}"#).unwrap();

        let sidechain_file = project_dir.join("session-side.jsonl");
        std::fs::write(&sidechain_file, r#"{"type":"user"}"#).unwrap();

        let index = serde_json::json!([
            {
                "fullPath": sidechain_file.to_str().unwrap(),
                "fileMtime": 1700000002000u64,
                "isSidechain": true,
                "sessionId": "side"
            },
            {
                "fullPath": main_file.to_str().unwrap(),
                "fileMtime": 1700000001000u64,
                "isSidechain": false,
                "sessionId": "main"
            }
        ]);
        let index_path = project_dir.join("sessions-index.json");
        std::fs::write(&index_path, serde_json::to_string(&index).unwrap()).unwrap();

        // Should pick main (non-sidechain) even though sidechain has higher mtime.
        let result = find_session_file(project_dir);
        assert_eq!(result.as_ref().map(|r| &r.path), Some(&main_file));
    }

    #[test]
    fn find_session_file_returns_none_for_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let result = find_session_file(dir.path());
        assert!(result.is_none());
    }

    #[test]
    fn session_file_state_hook_fields_default_to_none() {
        let dir = tempfile::tempdir().unwrap();
        let session_file = dir.path().join("session.jsonl");
        std::fs::write(&session_file, r#"{"type":"user"}"#).unwrap();

        let state = SessionFileState {
            cache_key: CacheKey::Pid(1234),
            session_file: session_file.clone(),
            file_position: 0,
            last_entries: Vec::new(),
            event_file_position: 0,
            cached_hook_events: Vec::new(),
            session_name: None,
            hook_transcript_path: None,
            hook_session_id: None,
            git_dir: None,
            git_head_mtime: None,
            git_branch: None,
            git_commit_short: None,
            git_worktrees_mtime: None,
            git_worktree_branches: None,
            poll_cycle_count: 0,
        };

        assert!(state.hook_transcript_path.is_none());
        assert!(state.hook_session_id.is_none());
    }

    #[test]
    fn session_file_state_hook_transcript_path_overrides_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let original_file = dir.path().join("session-wrong.jsonl");
        let correct_file = dir.path().join("session-correct.jsonl");
        std::fs::write(&original_file, r#"{"type":"user"}"#).unwrap();
        std::fs::write(&correct_file, r#"{"type":"user"}"#).unwrap();

        let mut state = SessionFileState {
            cache_key: CacheKey::Pid(1234),
            session_file: original_file.clone(),
            file_position: 100,
            last_entries: Vec::new(),
            event_file_position: 0,
            cached_hook_events: Vec::new(),
            session_name: None,
            hook_transcript_path: None,
            hook_session_id: None,
            git_dir: None,
            git_head_mtime: None,
            git_branch: None,
            git_commit_short: None,
            git_worktrees_mtime: None,
            git_worktree_branches: None,
            poll_cycle_count: 0,
        };

        // Simulate receiving a SessionStart hook event with a different transcript_path.
        state.hook_transcript_path = Some(correct_file.clone());
        state.hook_session_id = Some("session-abc".to_string());

        // Verify the hook fields are stored.
        assert_eq!(state.hook_transcript_path.as_ref(), Some(&correct_file));
        assert_eq!(state.hook_session_id.as_deref(), Some("session-abc"));

        // Simulate the session_file override logic from process_claude_pane.
        if let Some(ref hook_path) = state.hook_transcript_path {
            if *hook_path != state.session_file {
                state.session_file = hook_path.clone();
                state.file_position = 0;
                state.last_entries.clear();
            }
        }

        assert_eq!(state.session_file, correct_file);
        assert_eq!(state.file_position, 0);
    }

    #[test]
    fn lookup_session_name_by_id_finds_custom_title() {
        let dir = tempfile::tempdir().unwrap();
        let claude_home = dir.path();
        let project_dir = claude_home.join("projects").join("-some-project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let index = serde_json::json!({
            "version": 1,
            "entries": [
                {
                    "sessionId": "abc-123",
                    "fullPath": "/home/user/.claude/projects/-some-project/abc-123.jsonl",
                    "fileMtime": 1700000000000u64,
                    "customTitle": "my-session-name"
                },
                {
                    "sessionId": "def-456",
                    "fullPath": "/home/user/.claude/projects/-some-project/def-456.jsonl",
                    "fileMtime": 1700000001000u64
                }
            ]
        });
        std::fs::write(
            project_dir.join("sessions-index.json"),
            serde_json::to_string(&index).unwrap(),
        )
        .unwrap();

        let result = lookup_session_name_by_id(claude_home, "abc-123");
        assert_eq!(result.as_deref(), Some("my-session-name"));

        // Session without customTitle returns None.
        let result = lookup_session_name_by_id(claude_home, "def-456");
        assert_eq!(result, None);

        // Nonexistent session returns None.
        let result = lookup_session_name_by_id(claude_home, "nonexistent");
        assert_eq!(result, None);
    }

    #[test]
    fn lookup_session_name_by_id_searches_multiple_project_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let claude_home = dir.path();

        let proj_a = claude_home.join("projects").join("-project-a");
        let proj_b = claude_home.join("projects").join("-project-b");
        std::fs::create_dir_all(&proj_a).unwrap();
        std::fs::create_dir_all(&proj_b).unwrap();

        // Only project B has the target session.
        let index_a = serde_json::json!([{"sessionId": "other", "fullPath": "x.jsonl"}]);
        std::fs::write(
            proj_a.join("sessions-index.json"),
            serde_json::to_string(&index_a).unwrap(),
        )
        .unwrap();

        let index_b = serde_json::json!({
            "version": 1,
            "entries": [{
                "sessionId": "target-id",
                "fullPath": "y.jsonl",
                "customTitle": "found-in-b"
            }]
        });
        std::fs::write(
            proj_b.join("sessions-index.json"),
            serde_json::to_string(&index_b).unwrap(),
        )
        .unwrap();

        let result = lookup_session_name_by_id(claude_home, "target-id");
        assert_eq!(result.as_deref(), Some("found-in-b"));
    }
}
