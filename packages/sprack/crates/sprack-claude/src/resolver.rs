//! Pane resolver dispatch for local and container Claude Code instances.
//!
//! `LocalResolver` wraps the existing `/proc` walk + session file discovery
//! logic for local panes.
//! `LaceContainerResolver` handles panes in lace devcontainer sessions by
//! discovering session files via the `~/.claude` bind mount and workspace
//! prefix matching with an mtime heuristic.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::proc_walk;
use crate::session::{self, CacheKey, SessionFileState};

/// Maximum age for a container session file candidate to be considered active.
/// Directories whose newest `.jsonl` mtime is older than this are ignored.
const CONTAINER_RECENCY_THRESHOLD: Duration = Duration::from_secs(300);

/// Finds candidate panes: those running Claude locally OR belonging to a lace session.
///
/// A pane is a candidate if:
/// - Its `current_command` contains "claude" (local Claude pane), OR
/// - Its parent session has `lace_port` set (container pane).
pub fn find_candidate_panes(
    snapshot: &sprack_db::types::DbSnapshot,
) -> Vec<sprack_db::types::Pane> {
    let lace_session_names: HashSet<&str> = snapshot
        .sessions
        .iter()
        .filter(|session| session.lace_port.is_some())
        .map(|session| session.name.as_str())
        .collect();

    snapshot
        .panes
        .iter()
        .filter(|pane| {
            pane.current_command.contains("claude")
                || lace_session_names.contains(pane.session_name.as_str())
        })
        .cloned()
        .collect()
}

/// Builds a lookup map of session name to Session for sessions with lace metadata.
pub fn build_lace_session_map(
    sessions: &[sprack_db::types::Session],
) -> HashMap<String, sprack_db::types::Session> {
    sessions
        .iter()
        .filter(|session| session.lace_port.is_some())
        .map(|session| (session.name.clone(), session.clone()))
        .collect()
}

/// Trait for resolving a tmux pane to its Claude Code session file.
///
/// Internal to sprack-claude: exists for separation of concerns between
/// local `/proc` walking and container bind-mount resolution.
/// Used directly in tests; main.rs dispatches via convenience functions.
#[allow(dead_code)]
pub trait PaneResolver {
    /// Attempt to find the active session file for this pane.
    /// Returns `None` if resolution fails (process gone, no session file, etc.).
    fn resolve(&self, pane: &sprack_db::types::Pane, claude_home: &Path) -> Option<SessionFileState>;
}

/// Resolves local panes by walking `/proc` to find the Claude process PID,
/// reading its cwd, and locating the session file in `~/.claude/projects/`.
#[allow(dead_code)]
pub struct LocalResolver;

impl PaneResolver for LocalResolver {
    fn resolve(&self, pane: &sprack_db::types::Pane, claude_home: &Path) -> Option<SessionFileState> {
        let shell_pid = pane.pane_pid?;
        let claude_pid = proc_walk::find_claude_pid(shell_pid)?;
        let process_cwd = proc_walk::read_process_cwd(claude_pid)?;
        let encoded_path = proc_walk::encode_project_path(&process_cwd);

        let project_dir = claude_home.join("projects").join(&encoded_path);
        let session_file = session::find_session_file(&project_dir)?;

        Some(SessionFileState {
            cache_key: CacheKey::Pid(claude_pid),
            session_file,
            file_position: 0,
            last_entries: Vec::new(),
        })
    }
}

/// Resolves container panes via the `~/.claude` bind mount.
///
/// Skips `/proc` walking (can't cross PID namespace boundaries).
/// Enumerates `claude_home/projects/` directories matching the workspace prefix
/// derived from the session's `lace_workspace`, then selects the directory
/// with the most recently modified `.jsonl` file.
#[allow(dead_code)]
pub struct LaceContainerResolver<'a> {
    /// The parent session's lace metadata.
    pub session: &'a sprack_db::types::Session,
}

impl<'a> PaneResolver for LaceContainerResolver<'a> {
    fn resolve(&self, _pane: &sprack_db::types::Pane, claude_home: &Path) -> Option<SessionFileState> {
        let workspace = self.session.lace_workspace.as_deref()?;
        let project_dir = find_container_project_dir(workspace, claude_home)?;

        // TODO(opus/sprack-hooks): Remove this bind-mount resolution fallback
        // once hook event bridge is implemented. The hook approach provides
        // session_id and cwd directly, eliminating prefix-matching fragility.
        let session_file = session::find_via_jsonl_listing(&project_dir)?;

        Some(SessionFileState {
            cache_key: CacheKey::ContainerSession(session_file.clone()),
            session_file,
            file_position: 0,
            last_entries: Vec::new(),
        })
    }
}

/// Convenience function for resolving container panes from `main.rs`.
///
/// Constructs a `LaceContainerResolver` and resolves without a specific pane
/// (container resolution depends on session metadata, not pane PID).
pub fn resolve_container_pane(
    session: &sprack_db::types::Session,
    claude_home: &Path,
) -> Option<SessionFileState> {
    let workspace = session.lace_workspace.as_deref()?;
    let project_dir = find_container_project_dir(workspace, claude_home)?;

    // TODO(opus/sprack-hooks): Remove this bind-mount resolution fallback
    // once hook event bridge is implemented.
    let session_file = session::find_via_jsonl_listing(&project_dir)?;

    Some(SessionFileState {
        cache_key: CacheKey::ContainerSession(session_file.clone()),
        session_file,
        file_position: 0,
        last_entries: Vec::new(),
    })
}

/// Finds the best-matching project directory for a container workspace.
///
/// Encodes the workspace path as a prefix, enumerates all directories in
/// `claude_home/projects/` that start with that prefix, and selects the one
/// whose most recently modified `.jsonl` file has the latest mtime.
///
/// Directories whose newest `.jsonl` is older than `CONTAINER_RECENCY_THRESHOLD`
/// are excluded to avoid selecting stale worktree directories.
pub fn find_container_project_dir(workspace: &str, claude_home: &Path) -> Option<PathBuf> {
    let prefix = proc_walk::encode_project_path(Path::new(workspace));
    let projects_dir = claude_home.join("projects");

    let read_dir = std::fs::read_dir(&projects_dir).ok()?;
    let now = SystemTime::now();

    let candidates: Vec<(PathBuf, SystemTime)> = read_dir
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(&prefix)
        })
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let dir = entry.path();
            let newest_mtime = newest_jsonl_mtime(&dir)?;

            // Exclude directories with stale session files.
            if let Ok(age) = now.duration_since(newest_mtime) {
                if age > CONTAINER_RECENCY_THRESHOLD {
                    return None;
                }
            }

            Some((dir, newest_mtime))
        })
        .collect();

    candidates
        .into_iter()
        .max_by_key(|(_, mtime)| *mtime)
        .map(|(path, _)| path)
}

/// Returns the mtime of the most recently modified `.jsonl` file in a directory.
///
/// Only considers root-level files (not subdirectories, which contain subagent sessions).
fn newest_jsonl_mtime(dir: &Path) -> Option<SystemTime> {
    let read_dir = std::fs::read_dir(dir).ok()?;

    read_dir
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let path = entry.path();
            path.is_file() && path.extension().is_some_and(|ext| ext == "jsonl")
        })
        .filter_map(|entry| entry.metadata().ok()?.modified().ok())
        .max()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Creates a test Pane with the required fields, using defaults for layout fields.
    fn make_test_pane(
        pane_id: &str,
        session_name: &str,
        current_command: &str,
        pane_pid: Option<u32>,
    ) -> sprack_db::types::Pane {
        sprack_db::types::Pane {
            pane_id: pane_id.to_string(),
            session_name: session_name.to_string(),
            window_index: 0,
            title: String::new(),
            current_command: current_command.to_string(),
            current_path: "/home/user".to_string(),
            pane_pid,
            active: true,
            dead: false,
            pane_width: None,
            pane_height: None,
            pane_left: None,
            pane_top: None,
            pane_index: None,
            in_mode: false,
        }
    }

    /// Creates a synthetic `~/.claude/projects/` structure for testing.
    fn create_test_projects_dir(
        base: &Path,
        dirs_with_files: &[(&str, &[(&str, Duration)])],
    ) {
        let projects_dir = base.join("projects");
        std::fs::create_dir_all(&projects_dir).unwrap();

        let now = SystemTime::now();

        for (dir_name, files) in dirs_with_files {
            let dir_path = projects_dir.join(dir_name);
            std::fs::create_dir_all(&dir_path).unwrap();

            for (file_name, age) in *files {
                let file_path = dir_path.join(file_name);
                std::fs::write(&file_path, r#"{"type":"user"}"#).unwrap();

                // Set mtime to now - age.
                let mtime = now - *age;
                let mtime_filetime = filetime::FileTime::from_system_time(mtime);
                filetime::set_file_mtime(&file_path, mtime_filetime).unwrap();
            }
        }
    }

    #[test]
    fn find_container_project_dir_selects_by_prefix_and_mtime() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        create_test_projects_dir(
            claude_home,
            &[
                // Matching prefix, recent file.
                (
                    "-workspaces-lace-main",
                    &[("session-a.jsonl", Duration::from_secs(10))],
                ),
                // Matching prefix, older file.
                (
                    "-workspaces-lace-feature",
                    &[("session-b.jsonl", Duration::from_secs(60))],
                ),
                // Non-matching prefix.
                (
                    "-workspaces-other-project",
                    &[("session-c.jsonl", Duration::from_secs(5))],
                ),
            ],
        );

        let result = find_container_project_dir("/workspaces/lace", claude_home);
        assert!(result.is_some());
        let selected = result.unwrap();
        assert!(
            selected.ends_with("-workspaces-lace-main"),
            "expected -workspaces-lace-main, got: {}",
            selected.display()
        );
    }

    #[test]
    fn find_container_project_dir_excludes_stale_directories() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        create_test_projects_dir(
            claude_home,
            &[
                // Matching prefix but very old (beyond recency threshold).
                (
                    "-workspaces-lace-main",
                    &[("session-old.jsonl", Duration::from_secs(600))],
                ),
            ],
        );

        let result = find_container_project_dir("/workspaces/lace", claude_home);
        assert!(
            result.is_none(),
            "stale directory should be excluded"
        );
    }

    #[test]
    fn find_container_project_dir_returns_none_for_no_matches() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        create_test_projects_dir(
            claude_home,
            &[(
                "-workspaces-other-project",
                &[("session.jsonl", Duration::from_secs(10))],
            )],
        );

        let result = find_container_project_dir("/workspaces/lace", claude_home);
        assert!(result.is_none());
    }

    #[test]
    fn find_container_project_dir_handles_empty_projects_dir() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();
        std::fs::create_dir_all(claude_home.join("projects")).unwrap();

        let result = find_container_project_dir("/workspaces/lace", claude_home);
        assert!(result.is_none());
    }

    #[test]
    fn find_container_project_dir_handles_missing_projects_dir() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();
        // Don't create the projects directory at all.

        let result = find_container_project_dir("/workspaces/lace", claude_home);
        assert!(result.is_none());
    }

    #[test]
    fn find_container_project_dir_multiple_worktrees_selects_most_recent() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        create_test_projects_dir(
            claude_home,
            &[
                (
                    "-workspaces-lace-main",
                    &[("session-a.jsonl", Duration::from_secs(120))],
                ),
                (
                    "-workspaces-lace-feature-branch",
                    &[("session-b.jsonl", Duration::from_secs(5))],
                ),
                (
                    "-workspaces-lace-hotfix",
                    &[("session-c.jsonl", Duration::from_secs(30))],
                ),
            ],
        );

        let result = find_container_project_dir("/workspaces/lace", claude_home);
        assert!(result.is_some());
        let selected = result.unwrap();
        assert!(
            selected.ends_with("-workspaces-lace-feature-branch"),
            "expected most recent worktree, got: {}",
            selected.display()
        );
    }

    #[test]
    fn lace_container_resolver_resolve_finds_session_file() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        create_test_projects_dir(
            claude_home,
            &[(
                "-workspaces-lace-main",
                &[("session-abc.jsonl", Duration::from_secs(10))],
            )],
        );

        let session = sprack_db::types::Session {
            name: "lace-dev".to_string(),
            attached: false,
            lace_port: Some(2222),
            lace_user: Some("node".to_string()),
            lace_workspace: Some("/workspaces/lace".to_string()),
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        let pane = make_test_pane("%0", "lace-dev", "ssh", Some(1234));

        let resolver = LaceContainerResolver { session: &session };
        let result = resolver.resolve(&pane, claude_home);

        assert!(result.is_some(), "resolver should find session file");
        let state = result.unwrap();
        assert!(
            state.session_file.to_string_lossy().contains("session-abc.jsonl"),
            "should resolve to the session file"
        );
        assert!(
            matches!(state.cache_key, CacheKey::ContainerSession(_)),
            "cache key should be ContainerSession variant"
        );
    }

    #[test]
    fn lace_container_resolver_returns_none_without_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        let session = sprack_db::types::Session {
            name: "lace-dev".to_string(),
            attached: false,
            lace_port: Some(2222),
            lace_user: Some("node".to_string()),
            lace_workspace: None, // No workspace set.
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        let pane = make_test_pane("%0", "lace-dev", "ssh", Some(1234));

        let resolver = LaceContainerResolver { session: &session };
        let result = resolver.resolve(&pane, claude_home);
        assert!(result.is_none(), "should return None without workspace");
    }

    #[test]
    fn local_resolver_returns_none_without_pane_pid() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        let pane = make_test_pane("%0", "dev", "claude", None);

        let resolver = LocalResolver;
        let result = resolver.resolve(&pane, claude_home);
        assert!(result.is_none(), "should return None without pane PID");
    }

    #[test]
    fn dispatch_selects_container_resolver_for_lace_session() {
        // Verify the dispatch logic: pane with lace_port gets container resolution.
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        create_test_projects_dir(
            claude_home,
            &[(
                "-workspaces-lace-main",
                &[("session.jsonl", Duration::from_secs(5))],
            )],
        );

        let session = sprack_db::types::Session {
            name: "lace-dev".to_string(),
            attached: false,
            lace_port: Some(2222),
            lace_user: Some("node".to_string()),
            lace_workspace: Some("/workspaces/lace".to_string()),
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        // Use the convenience function that main.rs calls.
        let result = resolve_container_pane(&session, claude_home);
        assert!(result.is_some(), "container resolution should succeed");

        let state = result.unwrap();
        assert!(matches!(state.cache_key, CacheKey::ContainerSession(_)));
    }

    #[test]
    fn dispatch_selects_local_resolver_for_non_lace_pane() {
        // Verify that a pane without lace_port uses the local resolver path.
        // The local resolver will return None (no real /proc), but the dispatch
        // logic should not attempt container resolution.

        // No lace_session means resolve_container_pane is not called.
        // This test verifies the find_candidate_panes filter logic.
        let snapshot = sprack_db::types::DbSnapshot {
            sessions: vec![
                sprack_db::types::Session {
                    name: "local-dev".to_string(),
                    attached: false,
                    lace_port: None,
                    lace_user: None,
                    lace_workspace: None,
                    updated_at: "2026-03-24T12:00:00Z".to_string(),
                },
            ],
            windows: vec![],
            panes: vec![
                make_test_pane("%0", "local-dev", "claude", Some(1234)),
                make_test_pane("%1", "local-dev", "vim", Some(5678)),
            ],
            integrations: vec![],
        };

        let candidates = super::find_candidate_panes(&snapshot);
        assert_eq!(candidates.len(), 1, "only claude pane should be a candidate");
        assert_eq!(candidates[0].pane_id, "%0");
    }

    #[test]
    fn find_candidate_panes_includes_lace_session_panes() {
        let snapshot = sprack_db::types::DbSnapshot {
            sessions: vec![
                sprack_db::types::Session {
                    name: "lace-dev".to_string(),
                    attached: false,
                    lace_port: Some(2222),
                    lace_user: Some("node".to_string()),
                    lace_workspace: Some("/workspaces/lace".to_string()),
                    updated_at: "2026-03-24T12:00:00Z".to_string(),
                },
                sprack_db::types::Session {
                    name: "local-dev".to_string(),
                    attached: false,
                    lace_port: None,
                    lace_user: None,
                    lace_workspace: None,
                    updated_at: "2026-03-24T12:00:00Z".to_string(),
                },
            ],
            windows: vec![],
            panes: vec![
                // Container pane: ssh, belongs to lace session.
                make_test_pane("%0", "lace-dev", "ssh", Some(1234)),
                // Local claude pane.
                make_test_pane("%1", "local-dev", "claude", Some(5678)),
                // Non-candidate: not claude, not lace.
                make_test_pane("%2", "local-dev", "vim", Some(9999)),
            ],
            integrations: vec![],
        };

        let candidates = super::find_candidate_panes(&snapshot);
        assert_eq!(candidates.len(), 2, "lace pane and claude pane should both be candidates");

        let candidate_ids: Vec<&str> = candidates.iter().map(|p| p.pane_id.as_str()).collect();
        assert!(candidate_ids.contains(&"%0"), "lace session pane should be included");
        assert!(candidate_ids.contains(&"%1"), "local claude pane should be included");
        assert!(!candidate_ids.contains(&"%2"), "vim pane should not be included");
    }
}
