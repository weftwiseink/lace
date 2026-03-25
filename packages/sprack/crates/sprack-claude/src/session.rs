//! Session file discovery for Claude Code projects.
//!
//! Resolves a Claude Code project directory to its active JSONL session file
//! using a two-tier strategy: parse sessions-index.json (primary), or list
//! root-level .jsonl files by mtime (fallback).

use std::path::{Path, PathBuf};

use serde::Deserialize;

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
}

/// Finds the active session file for a Claude Code project directory.
///
/// Primary strategy: parse sessions-index.json, filter out sidechains,
/// and select the entry with the most recent file modification time.
/// Fallback: list root-level .jsonl files sorted by mtime descending.
pub fn find_session_file(project_dir: &Path) -> Option<PathBuf> {
    // Primary: parse sessions-index.json.
    if let Some(path) = find_via_sessions_index(project_dir) {
        return Some(path);
    }

    // Fallback: list root-level .jsonl files by mtime.
    find_via_jsonl_listing(project_dir)
}

/// Parses sessions-index.json and returns the most recent non-sidechain session file.
fn find_via_sessions_index(project_dir: &Path) -> Option<PathBuf> {
    let index_path = project_dir.join("sessions-index.json");
    let index_content = std::fs::read_to_string(&index_path).ok()?;
    let entries: Vec<SessionIndexEntry> = serde_json::from_str(&index_content).ok()?;

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
        Some(path)
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
/// Public for use by `LaceContainerResolver`, which skips `sessions-index.json`
/// because its `fullPath` entries contain container-internal absolute paths
/// that do not resolve on the host.
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
        assert_eq!(result, Some(newer));
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
        assert_eq!(result, Some(root_file));
    }

    #[test]
    fn find_session_file_via_sessions_index() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path();

        // Create a session file.
        let session_file = project_dir.join("session-abc.jsonl");
        std::fs::write(&session_file, r#"{"type":"user"}"#).unwrap();

        // Create sessions-index.json pointing to it.
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
        assert_eq!(result, Some(session_file));
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
        assert_eq!(result, Some(main_file));
    }

    #[test]
    fn find_session_file_returns_none_for_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let result = find_session_file(dir.path());
        assert_eq!(result, None);
    }
}
