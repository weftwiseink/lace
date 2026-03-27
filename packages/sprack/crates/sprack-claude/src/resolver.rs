//! Pane resolver dispatch for local and container Claude Code instances.
//!
//! `LocalResolver` wraps the existing `/proc` walk + session file discovery
//! logic for local panes.
//! Container panes are resolved via the sprack devcontainer mount: hook bridge
//! event files in per-project directories provide the session file path directly,
//! eliminating bind-mount prefix-matching heuristics.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::events;
use crate::proc_walk;
use crate::session::{self, CacheKey, SessionFileState};

/// Session names for which the "container_name without container_workspace" warning
/// has already been emitted. Prevents per-cycle stderr spam.
static WARNED_MISSING_WORKSPACE: std::sync::LazyLock<Mutex<HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

/// Finds candidate panes: those running Claude locally OR belonging to a container session.
///
/// A pane is a candidate if:
/// - Its `current_command` contains "claude" (local Claude pane), OR
/// - Its parent session has `container_name` set (container pane).
pub fn find_candidate_panes(
    snapshot: &sprack_db::types::DbSnapshot,
) -> Vec<sprack_db::types::Pane> {
    let container_session_names: HashSet<&str> = snapshot
        .sessions
        .iter()
        .filter(|session| {
            let has_container = session.container_name.is_some();
            let has_workspace = session.container_workspace.is_some();
            if has_container && !has_workspace {
                if let Ok(mut warned) = WARNED_MISSING_WORKSPACE.lock() {
                    if warned.insert(session.name.clone()) {
                        eprintln!(
                            "sprack-claude: session '{}' has container_name but no container_workspace, skipping container resolution",
                            session.name,
                        );
                    }
                }
            }
            has_container && has_workspace
        })
        .map(|session| session.name.as_str())
        .collect();

    snapshot
        .panes
        .iter()
        .filter(|pane| {
            pane.current_command.contains("claude")
                || container_session_names.contains(pane.session_name.as_str())
        })
        .cloned()
        .collect()
}

/// Builds a lookup map of session name to Session for sessions with container metadata.
pub fn build_container_session_map(
    sessions: &[sprack_db::types::Session],
) -> HashMap<String, sprack_db::types::Session> {
    sessions
        .iter()
        .filter(|session| session.container_name.is_some())
        .map(|session| (session.name.clone(), session.clone()))
        .collect()
}

/// Trait for resolving a tmux pane to its Claude Code session file.
///
/// Internal to sprack-claude: exists for separation of concerns between
/// local `/proc` walking and container mount-based resolution.
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
        let resolved = session::find_session_file(&project_dir)?;

        Some(SessionFileState {
            cache_key: CacheKey::Pid(claude_pid),
            session_file: resolved.path,
            file_position: 0,
            last_entries: Vec::new(),
            event_file_position: 0,
            cached_hook_events: Vec::new(),
            session_name: resolved.custom_title,
            hook_transcript_path: None,
            hook_session_id: None,
            git_dir: None,
            git_head_mtime: None,
            git_branch: None,
            git_commit_short: None,
            git_worktrees_mtime: None,
            git_worktree_branches: None,
            poll_cycle_count: 0,
        })
    }
}

/// Resolves container panes via the sprack devcontainer mount.
///
/// Scans event directories (`~/.local/share/sprack/lace/*/claude-events/`) for
/// hook bridge event files matching the container's workspace cwd. Extracts the
/// `transcript_path` from a `SessionStart` event if found, mapping it to the
/// host-visible path. Falls back to cwd-based event file matching.
///
/// `host_cwd` is the pane's `current_path` on the host: the CWD of the `podman`
/// process. It provides a hint for host-path-encoded project directories when
/// bind-mount path leakage causes Claude inside the container to see the host path
/// instead of the container workspace path.
///
/// Returns `None` if the sprack devcontainer feature is not installed (no mount)
/// or no matching event files exist.
pub fn resolve_container_pane(
    session: &sprack_db::types::Session,
    claude_home: &Path,
    host_cwd: &str,
    home_dir: &Path,
) -> Option<SessionFileState> {
    let workspace = session.container_workspace.as_deref()?;

    resolve_container_pane_via_mount(workspace, claude_home, host_cwd, home_dir)
}

/// Resolves a container pane's session file via hook event files or project directory.
///
/// Four-tier resolution strategy:
/// 1. Hook event files: scan event directories for a file matching the workspace cwd.
///    If a `SessionStart` event provides a host-visible `transcript_path`, use it.
/// 2. Project directory (container path): encode the workspace path and look for
///    session files in `~/.claude/projects/`.
/// 3. Project directory (host path): encode the pane's host CWD and its parent
///    directories, looking for session files in `~/.claude/projects/`. This handles
///    bind-mount path leakage where Claude inside the container sees the host path
///    instead of the container workspace path.
/// 4. Returns `None` if no strategy finds a session file.
fn resolve_container_pane_via_mount(
    workspace: &str,
    claude_home: &Path,
    host_cwd: &str,
    home_dir: &Path,
) -> Option<SessionFileState> {
    let event_dirs = events::event_dirs_from_home(home_dir);

    // Search event directories for an event file matching this workspace.
    let mut event_file: Option<PathBuf> = None;
    for event_dir in &event_dirs {
        if let Some(found) = events::find_event_file(event_dir, workspace) {
            event_file = Some(found);
            break;
        }
    }

    // If we found an event file, try to extract transcript_path from it.
    if let Some(ref ef) = event_file {
        let mut position = 0u64;
        let hook_events = events::read_events(ef, &mut position);

        let mut transcript_path: Option<PathBuf> = None;
        let mut session_id: Option<String> = None;

        for event in &hook_events {
            if let events::HookEvent::SessionStart {
                session_id: sid,
                transcript_path: tp,
                ..
            } = event
            {
                session_id = Some(sid.clone());
                if let Some(tp) = tp {
                    let tp_path = PathBuf::from(tp);
                    if tp_path.is_file() {
                        transcript_path = Some(tp_path);
                    }
                }
            }
        }

        // If we have a host-visible transcript_path, use it directly.
        if let Some(ref tp) = transcript_path {
            // Look up session name from host sessions-index.json files.
            let session_name = session_id
                .as_deref()
                .and_then(|sid| session::lookup_session_name_by_id(claude_home, sid));

            return Some(SessionFileState {
                cache_key: CacheKey::ContainerSession(tp.clone()),
                session_file: tp.clone(),
                file_position: 0,
                last_entries: Vec::new(),
                event_file_position: position,
                cached_hook_events: hook_events,
                session_name,
                hook_transcript_path: transcript_path,
                hook_session_id: session_id,
                git_dir: None,
                git_head_mtime: None,
                git_branch: None,
                git_commit_short: None,
                git_worktrees_mtime: None,
                git_worktree_branches: None,
                poll_cycle_count: 0,
            });
        }
    }

    // Collect candidate project directories from multiple path encodings.
    // Bind-mount path leakage can cause Claude inside the container to see the
    // host filesystem path instead of the container workspace path, creating
    // session files under a host-path-encoded directory rather than the expected
    // container-workspace-encoded directory.
    let best = find_best_project_session(workspace, host_cwd, claude_home)?;

    // Fix B1: Probe the resolved JSONL file for a sessionId, then look up
    // its customTitle in sessions-index.json. This provides naming for
    // container sessions resolved via the project directory fallback.
    // Try two strategies: (1) match by sessionId from the JSONL entries,
    // (2) match by fullPath in sessions-index.json (handles cases where
    // the JSONL sessionId differs from the index entry's sessionId).
    let probe_entries = crate::jsonl::tail_read(&best, crate::jsonl::default_tail_bytes());
    let session_id = probe_entries
        .iter()
        .find_map(|e| e.session_id.as_deref())
        .map(|s| s.to_string());

    let session_name = session_id
        .as_deref()
        .and_then(|sid| session::lookup_session_name_by_id(claude_home, sid))
        .or_else(|| session::lookup_session_name_by_path(claude_home, &best));

    Some(SessionFileState {
        cache_key: CacheKey::ContainerSession(best.clone()),
        session_file: best,
        file_position: 0,
        last_entries: Vec::new(),
        event_file_position: 0,
        cached_hook_events: Vec::new(),
        session_name,
        hook_transcript_path: None,
        hook_session_id: session_id,
        git_dir: None,
        git_head_mtime: None,
        git_branch: None,
        git_commit_short: None,
        git_worktrees_mtime: None,
        git_worktree_branches: None,
        poll_cycle_count: 0,
    })
}

/// Finds the most recently modified session file across multiple candidate
/// project directory encodings.
///
/// Candidates are derived from:
/// 1. The container workspace path (e.g., `/workspaces/lace/main`)
/// 2. The host CWD path and its parent directories (e.g., `/var/home/mjr/code/weft/lace/main/packages/sprack`,
///    `/var/home/mjr/code/weft/lace/main`, etc.)
///
/// Each candidate path is encoded and checked as a project directory under
/// `~/.claude/projects/`. The session file with the most recent mtime wins.
fn find_best_project_session(
    workspace: &str,
    host_cwd: &str,
    claude_home: &Path,
) -> Option<PathBuf> {
    let projects_dir = claude_home.join("projects");

    // Build list of unique candidate encoded paths.
    let mut candidates: Vec<String> = Vec::new();

    // 1. Container workspace encoding (canonical).
    let workspace_encoded = proc_walk::encode_project_path(Path::new(workspace));
    candidates.push(workspace_encoded);

    // 2. Host CWD and its parent directories.
    // Walk up from host_cwd to root, adding each as a candidate.
    // This handles both the exact CWD and parent directories where Claude
    // might have been started (e.g., monorepo root vs subdirectory).
    let mut path = Path::new(host_cwd);
    for _ in 0..10 {
        let encoded = proc_walk::encode_project_path(path);
        if !candidates.contains(&encoded) {
            candidates.push(encoded);
        }
        match path.parent() {
            Some(parent) if parent != path => path = parent,
            _ => break,
        }
    }

    // Find the session file with the most recent mtime across all candidates.
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;

    for encoded in &candidates {
        let project_dir = projects_dir.join(encoded);
        if let Some(session_path) = session::find_via_jsonl_listing(&project_dir) {
            if let Ok(mtime) = std::fs::metadata(&session_path).and_then(|m| m.modified()) {
                let dominated = best.as_ref().is_some_and(|(_, best_mtime)| mtime <= *best_mtime);
                if !dominated {
                    best = Some((session_path, mtime));
                }
            }
        }
    }

    best.map(|(path, _)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn dispatch_selects_local_resolver_for_non_container_pane() {
        // Verify that a pane without container_name uses the local resolver path.
        // No container_session means resolve_container_pane is not called.
        // This test verifies the find_candidate_panes filter logic.
        let snapshot = sprack_db::types::DbSnapshot {
            sessions: vec![
                sprack_db::types::Session {
                    name: "local-dev".to_string(),
                    attached: false,
                    container_name: None,
                    container_user: None,
                    container_workspace: None,
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
    fn find_candidate_panes_includes_container_session_panes() {
        let snapshot = sprack_db::types::DbSnapshot {
            sessions: vec![
                sprack_db::types::Session {
                    name: "lace-dev".to_string(),
                    attached: false,
                    container_name: Some("dev-container".to_string()),
                    container_user: Some("node".to_string()),
                    container_workspace: Some("/workspaces/lace".to_string()),
                    updated_at: "2026-03-24T12:00:00Z".to_string(),
                },
                sprack_db::types::Session {
                    name: "local-dev".to_string(),
                    attached: false,
                    container_name: None,
                    container_user: None,
                    container_workspace: None,
                    updated_at: "2026-03-24T12:00:00Z".to_string(),
                },
            ],
            windows: vec![],
            panes: vec![
                // Container pane: ssh, belongs to container session.
                make_test_pane("%0", "lace-dev", "ssh", Some(1234)),
                // Local claude pane.
                make_test_pane("%1", "local-dev", "claude", Some(5678)),
                // Non-candidate: not claude, not container.
                make_test_pane("%2", "local-dev", "vim", Some(9999)),
            ],
            integrations: vec![],
        };

        let candidates = super::find_candidate_panes(&snapshot);
        assert_eq!(candidates.len(), 2, "container pane and claude pane should both be candidates");

        let candidate_ids: Vec<&str> = candidates.iter().map(|p| p.pane_id.as_str()).collect();
        assert!(candidate_ids.contains(&"%0"), "container session pane should be included");
        assert!(candidate_ids.contains(&"%1"), "local claude pane should be included");
        assert!(!candidate_ids.contains(&"%2"), "vim pane should not be included");
    }

    #[test]
    fn find_candidate_panes_excludes_container_without_workspace() {
        // A session with container_name but no container_workspace should NOT be treated
        // as a container candidate. This prevents repeated error integration
        // writes when container resolution inevitably fails.
        let snapshot = sprack_db::types::DbSnapshot {
            sessions: vec![
                sprack_db::types::Session {
                    name: "incomplete-container".to_string(),
                    attached: false,
                    container_name: Some("dev-container".to_string()),
                    container_user: Some("node".to_string()),
                    container_workspace: None, // Missing workspace.
                    updated_at: "2026-03-24T12:00:00Z".to_string(),
                },
            ],
            windows: vec![],
            panes: vec![
                // Non-claude pane in a session with container_name but no workspace.
                make_test_pane("%0", "incomplete-container", "ssh", Some(1234)),
            ],
            integrations: vec![],
        };

        let candidates = super::find_candidate_panes(&snapshot);
        assert!(
            candidates.is_empty(),
            "pane should not be a candidate when container_workspace is missing"
        );
    }

    #[test]
    fn resolve_container_pane_returns_none_without_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        let session = sprack_db::types::Session {
            name: "lace-dev".to_string(),
            attached: false,
            container_name: Some("dev-container".to_string()),
            container_user: Some("node".to_string()),
            container_workspace: None,
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        let result = resolve_container_pane(&session, claude_home, "/some/host/path", temp.path());
        assert!(result.is_none(), "should return None without workspace");
    }

    #[test]
    fn resolve_container_pane_returns_none_without_event_dirs() {
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        let session = sprack_db::types::Session {
            name: "lace-dev".to_string(),
            attached: false,
            container_name: Some("dev-container".to_string()),
            container_user: Some("node".to_string()),
            container_workspace: Some("/workspaces/lace".to_string()),
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        // No event directories and no ~/.claude/projects/ dir: resolution should return None.
        let result = resolve_container_pane(&session, claude_home, "/some/host/path", temp.path());
        assert!(
            result.is_none(),
            "should return None when no event dirs or project dirs exist"
        );
    }

    #[test]
    fn resolve_container_pane_falls_back_to_project_dir_without_events() {
        // The fallback path encodes the workspace and looks for JSONL files in
        // ~/.claude/projects/<encoded_workspace>/. This must work even when no
        // hook event files exist (the common case before hooks are first fired).
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        // Create a project dir matching the encoded workspace path.
        let workspace = "/workspaces/lace";
        let encoded = crate::proc_walk::encode_project_path(std::path::Path::new(workspace));
        let project_dir = claude_home.join("projects").join(&encoded);
        std::fs::create_dir_all(&project_dir).unwrap();

        // Create a session JSONL file in the project dir.
        let session_file = project_dir.join("session-abc.jsonl");
        std::fs::write(&session_file, r#"{"type":"user","message":{"role":"user","content":"hello"}}"#)
            .unwrap();

        let session = sprack_db::types::Session {
            name: "lace-dev".to_string(),
            attached: false,
            container_name: Some("dev-container".to_string()),
            container_user: Some("node".to_string()),
            container_workspace: Some(workspace.to_string()),
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        // No event directories exist, but the project dir has a session file.
        let result = resolve_container_pane(&session, claude_home, "/some/host/path", temp.path());
        assert!(
            result.is_some(),
            "should resolve via project dir fallback when no event files exist"
        );
        let state = result.unwrap();
        assert_eq!(state.session_file, session_file);
        assert!(state.hook_transcript_path.is_none());
        assert!(state.hook_session_id.is_none());
    }

    #[test]
    fn resolve_container_pane_prefers_host_path_when_newer() {
        // When bind-mount path leakage causes Claude to use the host path,
        // the resolver should find the session under the host-path encoding
        // and prefer it over a stale session under the workspace encoding.
        let temp = tempfile::tempdir().unwrap();
        let claude_home = temp.path();

        let workspace = "/workspaces/lace/main";
        let host_cwd = "/var/home/mjr/code/weft/lace/main/packages/sprack";

        // Create a stale session under the workspace encoding.
        let workspace_encoded = crate::proc_walk::encode_project_path(std::path::Path::new(workspace));
        let workspace_dir = claude_home.join("projects").join(&workspace_encoded);
        std::fs::create_dir_all(&workspace_dir).unwrap();
        let stale_file = workspace_dir.join("session-stale.jsonl");
        std::fs::write(&stale_file, r#"{"type":"user","message":{"role":"user","content":"old"}}"#).unwrap();

        // Brief pause to ensure different mtime.
        std::thread::sleep(std::time::Duration::from_millis(20));

        // Create a newer session under the host-path encoding (parent of host_cwd).
        // The host CWD is .../packages/sprack, but the session is at .../lace/main.
        let host_parent = "/var/home/mjr/code/weft/lace/main";
        let host_encoded = crate::proc_walk::encode_project_path(std::path::Path::new(host_parent));
        let host_dir = claude_home.join("projects").join(&host_encoded);
        std::fs::create_dir_all(&host_dir).unwrap();
        let fresh_file = host_dir.join("session-fresh.jsonl");
        std::fs::write(&fresh_file, r#"{"type":"user","message":{"role":"user","content":"new"}}"#).unwrap();

        let session = sprack_db::types::Session {
            name: "lace".to_string(),
            attached: false,
            container_name: Some("lace".to_string()),
            container_user: Some("node".to_string()),
            container_workspace: Some(workspace.to_string()),
            updated_at: "2026-03-24T12:00:00Z".to_string(),
        };

        let result = resolve_container_pane(&session, claude_home, host_cwd, temp.path());
        assert!(result.is_some(), "should resolve to a session file");
        let state = result.unwrap();
        assert_eq!(
            state.session_file, fresh_file,
            "should prefer the newer host-path-encoded session over the stale workspace-encoded one"
        );
    }

    #[test]
    fn build_container_session_map_filters_by_container_name() {
        let sessions = vec![
            sprack_db::types::Session {
                name: "container-dev".to_string(),
                attached: false,
                container_name: Some("dev".to_string()),
                container_user: None,
                container_workspace: None,
                updated_at: String::new(),
            },
            sprack_db::types::Session {
                name: "local-dev".to_string(),
                attached: false,
                container_name: None,
                container_user: None,
                container_workspace: None,
                updated_at: String::new(),
            },
        ];

        let map = build_container_session_map(&sessions);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("container-dev"));
        assert!(!map.contains_key("local-dev"));
    }
}
