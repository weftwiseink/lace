//! Integration tests for the full poll cycle: session resolution, state detection,
//! naming, and hook event processing.
//!
//! Uses `TestFixture` to create isolated temp directories for claude_home and home_dir,
//! an in-memory SQLite database, and helpers for writing mock JSONL session files,
//! sessions-index.json files, and hook event files.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::session::SessionFileState;

// ── TestFixture ──

struct TestFixture {
    /// Temp directory that acts as `~/.claude` (claude_home).
    /// The actual claude_home path is `claude_dir.path()/.claude`.
    claude_dir: tempfile::TempDir,
    /// Temp directory that acts as `$HOME` (home_dir).
    home_dir: tempfile::TempDir,
    /// In-memory database connection.
    db: rusqlite::Connection,
    /// Session cache shared across poll cycles.
    session_cache: HashMap<String, SessionFileState>,
}

impl TestFixture {
    fn new() -> Self {
        let claude_dir = tempfile::tempdir().unwrap();
        let home_dir = tempfile::tempdir().unwrap();

        // Create the projects directory under claude_home.
        let claude_home = claude_dir.path().join(".claude");
        std::fs::create_dir_all(claude_home.join("projects")).unwrap();

        let db = sprack_db::open_test_db();

        TestFixture {
            claude_dir,
            home_dir,
            db,
            session_cache: HashMap::new(),
        }
    }

    /// Returns the path to the `.claude` directory (claude_home).
    fn claude_home(&self) -> PathBuf {
        self.claude_dir.path().join(".claude")
    }

    /// Adds a JSONL session file with the given entries.
    ///
    /// `project_path` is the raw project path (e.g., "/workspaces/lace").
    /// Returns the full path to the created session file.
    fn add_session_file(
        &self,
        project_path: &str,
        session_id: &str,
        entries: &[serde_json::Value],
    ) -> PathBuf {
        let encoded = crate::proc_walk::encode_project_path(Path::new(project_path));
        let project_dir = self.claude_home().join("projects").join(&encoded);
        std::fs::create_dir_all(&project_dir).unwrap();

        let session_file = project_dir.join(format!("{session_id}.jsonl"));
        let content: String = entries
            .iter()
            .map(|e| serde_json::to_string(e).unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        std::fs::write(&session_file, content).unwrap();
        session_file
    }

    /// Adds a sessions-index.json file for a project.
    fn add_sessions_index(&self, project_path: &str, entries: &[serde_json::Value]) {
        let encoded = crate::proc_walk::encode_project_path(Path::new(project_path));
        let project_dir = self.claude_home().join("projects").join(&encoded);
        std::fs::create_dir_all(&project_dir).unwrap();

        let index = serde_json::json!({
            "version": 1,
            "entries": entries,
        });
        let index_path = project_dir.join("sessions-index.json");
        std::fs::write(&index_path, serde_json::to_string(&index).unwrap()).unwrap();
    }

    /// Adds hook event files for a project.
    ///
    /// Creates the event directory at `home_dir/.local/share/sprack/lace/<project_name>/claude-events/`
    /// and writes events as JSONL lines to `<session_id>.jsonl`.
    fn add_hook_events(
        &self,
        project_name: &str,
        session_id: &str,
        events: &[serde_json::Value],
    ) {
        let event_dir = self
            .home_dir
            .path()
            .join(".local/share/sprack/lace")
            .join(project_name)
            .join("claude-events");
        std::fs::create_dir_all(&event_dir).unwrap();

        let event_file = event_dir.join(format!("{session_id}.jsonl"));
        let content: String = events
            .iter()
            .map(|e| serde_json::to_string(e).unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        std::fs::write(&event_file, content).unwrap();
    }

    /// Sets the tmux state in the database.
    fn set_tmux_state(
        &self,
        sessions: &[sprack_db::types::Session],
        windows: &[sprack_db::types::Window],
        panes: &[sprack_db::types::Pane],
    ) {
        sprack_db::write::write_tmux_state(&self.db, sessions, windows, panes).unwrap();
    }

    /// Runs a single poll cycle and returns the resulting integrations.
    fn run_poll_cycle(&mut self) -> Vec<sprack_db::types::Integration> {
        let claude_home = self.claude_home();
        let home_dir = self.home_dir.path().to_path_buf();
        crate::run_poll_cycle(
            &self.db,
            &mut self.session_cache,
            &claude_home,
            None,
            &home_dir,
        );
        sprack_db::read::read_full_state(&self.db)
            .unwrap()
            .integrations
    }

    /// Sets the mtime of a file to the given time.
    fn set_file_mtime(path: &Path, time: SystemTime) {
        let file_time = filetime::FileTime::from_system_time(time);
        filetime::set_file_mtime(path, file_time).unwrap();
    }
}

// ── Mock Data Constructors: JSONL entries ──

fn mock_assistant_entry(stop_reason: Option<&str>, model: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "assistant",
        "message": {
            "model": model,
            "stop_reason": stop_reason,
            "usage": {"input_tokens": 1000, "output_tokens": 500},
            "content": [{"type": "text"}]
        },
        "sessionId": "test-session-id"
    })
}

fn mock_user_entry() -> serde_json::Value {
    serde_json::json!({
        "type": "user",
        "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]},
        "sessionId": "test-session-id"
    })
}

fn mock_assistant_entry_with_slug(
    stop_reason: Option<&str>,
    model: &str,
    slug: &str,
) -> serde_json::Value {
    let mut entry = mock_assistant_entry(stop_reason, model);
    entry["slug"] = serde_json::json!(slug);
    entry
}

fn mock_custom_title_entry(title: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "custom-title",
        "customTitle": title,
        "sessionId": "test-session-id"
    })
}

#[allow(dead_code)]
fn mock_session_start_event(session_id: &str, cwd: &str) -> serde_json::Value {
    serde_json::json!({
        "ts": "2026-03-27T12:00:00Z",
        "event": "SessionStart",
        "session_id": session_id,
        "cwd": cwd,
        "data": {}
    })
}

fn mock_session_start_event_with_transcript(
    session_id: &str,
    cwd: &str,
    transcript_path: &str,
) -> serde_json::Value {
    serde_json::json!({
        "ts": "2026-03-27T12:00:00Z",
        "event": "SessionStart",
        "session_id": session_id,
        "cwd": cwd,
        "data": {
            "transcript_path": transcript_path
        }
    })
}

fn mock_session_end_event(session_id: &str) -> serde_json::Value {
    serde_json::json!({
        "ts": "2026-03-27T12:05:00Z",
        "event": "SessionEnd",
        "session_id": session_id,
        "cwd": "/workspace",
        "data": {"reason": "user_exit"}
    })
}

// ── Mock Data Constructors: tmux state ──

fn make_container_session(
    name: &str,
    container_name: &str,
    workspace: &str,
) -> sprack_db::types::Session {
    sprack_db::types::Session {
        name: name.to_string(),
        attached: false,
        container_name: Some(container_name.to_string()),
        container_user: Some("node".to_string()),
        container_workspace: Some(workspace.to_string()),
        updated_at: "2026-03-27T12:00:00Z".to_string(),
    }
}

#[allow(dead_code)]
fn make_local_session(name: &str) -> sprack_db::types::Session {
    sprack_db::types::Session {
        name: name.to_string(),
        attached: false,
        container_name: None,
        container_user: None,
        container_workspace: None,
        updated_at: "2026-03-27T12:00:00Z".to_string(),
    }
}

fn make_window(session_name: &str, index: i32, name: &str) -> sprack_db::types::Window {
    sprack_db::types::Window {
        session_name: session_name.to_string(),
        window_index: index,
        name: name.to_string(),
        active: true,
        layout: String::new(),
    }
}

fn make_pane(
    pane_id: &str,
    session_name: &str,
    window_index: i32,
    command: &str,
) -> sprack_db::types::Pane {
    sprack_db::types::Pane {
        pane_id: pane_id.to_string(),
        session_name: session_name.to_string(),
        window_index,
        title: String::new(),
        current_command: command.to_string(),
        current_path: "/workspace".to_string(),
        pane_pid: Some(99999),
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

// ── Tests ──

#[test]
fn empty_state_produces_no_integrations() {
    let mut fix = TestFixture::new();
    let integrations = fix.run_poll_cycle();
    assert!(integrations.is_empty());
}

/// Container pane with a session file whose mtime is older than CONTAINER_SESSION_MAX_AGE
/// and whose last entry is end_turn (idle). On the second poll cycle, the stale session
/// should cause cache invalidation and re-resolution.
#[test]
fn container_pane_no_integration_when_session_file_stale() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    // Create session file with an idle entry.
    let session_file = fix.add_session_file(
        workspace,
        "stale-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    // Set mtime to 120 seconds ago (beyond CONTAINER_SESSION_MAX_AGE of 60s).
    let stale_time = SystemTime::now() - std::time::Duration::from_secs(120);
    TestFixture::set_file_mtime(&session_file, stale_time);

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    // First poll cycle: resolves and writes integration.
    let integrations = fix.run_poll_cycle();
    // Should have found the session file despite being stale on first resolve.
    // The staleness check is for *cache invalidation*, not initial resolution.
    assert_eq!(
        integrations.len(),
        1,
        "first cycle should resolve the session file"
    );

    // Make the file stale again (the first read may have touched the mtime).
    TestFixture::set_file_mtime(&session_file, stale_time);

    // Second poll cycle: cache invalidated due to stale mtime. Re-resolution should
    // detect that the file is stale AND in a terminal state, and skip the integration.
    let integrations = fix.run_poll_cycle();
    let claude_integrations: Vec<_> = integrations
        .iter()
        .filter(|i| i.kind == crate::INTEGRATION_KIND)
        .collect();
    assert!(
        claude_integrations.is_empty(),
        "stale container session with terminal state should produce no integration"
    );
}

/// Container session should use customTitle from sessions-index.json, but currently
/// the container fallback path (`find_best_project_session`) calls `find_via_jsonl_listing`
/// which bypasses sessions-index.json entirely, losing the customTitle.
///
/// BUG: session_name is None when it should be "my-custom-session".
/// FIX: After `find_best_project_session` resolves a session file, extract sessionId
/// from the JSONL entries and look it up in sessions-index.json (proposal fix B1).
#[test]
fn container_session_uses_custom_title_from_sessions_index() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    let session_file = fix.add_session_file(
        workspace,
        "session-abc",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    // Add sessions-index.json with customTitle.
    fix.add_sessions_index(
        workspace,
        &[serde_json::json!({
            "sessionId": "session-abc",
            "fullPath": session_file.to_str().unwrap(),
            "fileMtime": 1700000000000u64,
            "isSidechain": false,
            "customTitle": "my-custom-session"
        })],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    let summary: crate::status::ClaudeSummary =
        serde_json::from_str(&integrations[0].summary).unwrap();

    // Fix B1: container fallback now probes the JSONL for sessionId and looks up
    // customTitle in sessions-index.json.
    assert_eq!(
        summary.session_name.as_deref(),
        Some("my-custom-session"),
        "session_name should come from sessions-index.json customTitle via sessionId probe"
    );
}

/// Session file whose last entry has stop_reason = "end_turn" should show idle status.
#[test]
fn session_with_end_turn_shows_idle() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(
        workspace,
        "idle-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);
    assert_eq!(
        integrations[0].status,
        sprack_db::types::ProcessStatus::Idle,
        "end_turn stop_reason should produce Idle status"
    );
}

/// Session file whose last entry has stop_reason = null should show thinking status.
#[test]
fn session_with_null_stop_reason_shows_thinking() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(
        workspace,
        "thinking-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(None, "claude-opus-4-6"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);
    assert_eq!(
        integrations[0].status,
        sprack_db::types::ProcessStatus::Thinking,
        "null stop_reason should produce Thinking status"
    );
}

/// Two container panes in the same session that both resolve to the same JSONL file.
/// Expected: at most one integration per session file (dedup).
/// NOTE: This test likely FAILS currently - that's expected. The fix comes later.
#[test]
fn multiple_panes_same_session_file_produce_single_integration() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(
        workspace,
        "shared-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane_a = make_pane("%0", "lace-dev", 0, "ssh");
    let pane_b = make_pane("%1", "lace-dev", 0, "bash");

    fix.set_tmux_state(&[session], &[window], &[pane_a, pane_b]);

    let integrations = fix.run_poll_cycle();

    // Count integrations with claude_code kind (exclude error integrations).
    let claude_integrations: Vec<_> = integrations
        .iter()
        .filter(|i| i.kind == crate::INTEGRATION_KIND)
        .collect();

    // Fix A3: dedup by session file path. Two panes resolving to the same file
    // should produce only one integration.
    assert_eq!(
        claude_integrations.len(),
        1,
        "duplicate panes resolving to the same session file should produce a single integration"
    );
}

/// A SessionEnd hook event should clear the integration for the pane.
#[test]
fn session_end_hook_clears_integration() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    let session_file = fix.add_session_file(
        workspace,
        "ending-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    // Add hook events: SessionStart then SessionEnd.
    fix.add_hook_events(
        "my-project",
        "ending-session",
        &[
            mock_session_start_event_with_transcript(
                "ending-session",
                workspace,
                session_file.to_str().unwrap(),
            ),
            mock_session_end_event("ending-session"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();

    // After SessionEnd, the integration should be cleared.
    let claude_integrations: Vec<_> = integrations
        .iter()
        .filter(|i| i.kind == crate::INTEGRATION_KIND)
        .collect();
    assert!(
        claude_integrations.is_empty(),
        "SessionEnd hook event should clear the integration"
    );
}

/// Hook bridge SessionStart event provides a transcript_path that resolves to a session file.
#[test]
fn hook_bridge_provides_transcript_path() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    // Create two session files: one "wrong" (would be found by mtime) and one "correct"
    // (referenced by the hook's transcript_path).
    fix.add_session_file(
        workspace,
        "wrong-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    // Brief pause to ensure different mtime.
    std::thread::sleep(std::time::Duration::from_millis(20));

    let correct_file = fix.add_session_file(
        workspace,
        "correct-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(None, "claude-sonnet-4-20250514"),
        ],
    );

    // Add hook event with transcript_path pointing to the correct session.
    fix.add_hook_events(
        "my-project",
        "correct-session",
        &[mock_session_start_event_with_transcript(
            "correct-session",
            workspace,
            correct_file.to_str().unwrap(),
        )],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    // The integration should reflect the correct session (sonnet model, thinking state).
    let summary: crate::status::ClaudeSummary =
        serde_json::from_str(&integrations[0].summary).unwrap();
    assert_eq!(
        summary.model.as_deref(),
        Some("claude-sonnet-4-20250514"),
        "should use the session file from transcript_path, not the mtime-based one"
    );
}

/// Container session without workspace should not produce an integration.
#[test]
fn container_without_workspace_produces_no_integration() {
    let mut fix = TestFixture::new();

    let session = sprack_db::types::Session {
        name: "broken-session".to_string(),
        attached: false,
        container_name: Some("dev-container".to_string()),
        container_user: Some("node".to_string()),
        container_workspace: None, // Missing workspace.
        updated_at: "2026-03-27T12:00:00Z".to_string(),
    };
    let window = make_window("broken-session", 0, "main");
    let pane = make_pane("%0", "broken-session", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();

    // Pane should not be a candidate when container_workspace is missing.
    assert!(
        integrations.is_empty(),
        "container without workspace should produce no integrations"
    );
}

/// JSONL file containing a custom-title entry should set session_name.
#[test]
fn jsonl_with_custom_title_entry_sets_session_name() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(
        workspace,
        "titled-session",
        &[
            mock_user_entry(),
            mock_custom_title_entry("my-jsonl-title"),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    let summary: crate::status::ClaudeSummary =
        serde_json::from_str(&integrations[0].summary).unwrap();
    assert_eq!(
        summary.session_name.as_deref(),
        Some("my-jsonl-title"),
        "custom-title JSONL entry should set session_name"
    );
}

/// Session file with only a user entry (no assistant response yet) should show waiting.
#[test]
fn session_file_with_only_user_entry_shows_waiting() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(workspace, "waiting-session", &[mock_user_entry()]);

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);
    assert_eq!(
        integrations[0].status,
        sprack_db::types::ProcessStatus::Waiting,
        "user-only session should show Waiting status"
    );
}

/// Slug from JSONL entry is used as session_name when no customTitle is available.
#[test]
fn session_slug_used_as_session_name_fallback() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(
        workspace,
        "slug-session",
        &[
            mock_user_entry(),
            mock_assistant_entry_with_slug(Some("end_turn"), "claude-opus-4-6", "swirling-swimming-hopper"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    let summary: crate::status::ClaudeSummary =
        serde_json::from_str(&integrations[0].summary).unwrap();
    assert_eq!(
        summary.session_name.as_deref(),
        Some("swirling-swimming-hopper"),
        "slug should be used as session_name when no customTitle is available"
    );
}

/// Session with tool_use stop_reason shows ToolUse status.
#[test]
fn session_with_tool_use_shows_tool_use() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    fix.add_session_file(
        workspace,
        "tooluse-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("tool_use"), "claude-opus-4-6"),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);
    assert_eq!(
        integrations[0].status,
        sprack_db::types::ProcessStatus::ToolUse,
        "tool_use stop_reason should produce ToolUse status"
    );
}

/// Two-cycle test: first cycle establishes an integration via SessionStart hook,
/// second cycle adds SessionEnd and verifies the integration is cleared.
/// More realistic than the single-cycle session_end_hook_clears_integration test.
#[test]
fn session_end_clears_existing_integration_on_second_cycle() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    let session_file = fix.add_session_file(
        workspace,
        "lifecycle-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
        ],
    );

    // First: only SessionStart event (session is active).
    fix.add_hook_events(
        "my-project",
        "lifecycle-session",
        &[mock_session_start_event_with_transcript(
            "lifecycle-session",
            workspace,
            session_file.to_str().unwrap(),
        )],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    // First poll cycle: integration should be established.
    let integrations = fix.run_poll_cycle();
    assert_eq!(
        integrations.len(),
        1,
        "first cycle should establish an integration"
    );

    // Append SessionEnd to the event file.
    let event_dir = fix
        .home_dir
        .path()
        .join(".local/share/sprack/lace/my-project/claude-events");
    let event_file = event_dir.join("lifecycle-session.jsonl");
    let end_event = serde_json::to_string(&mock_session_end_event("lifecycle-session")).unwrap();
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&event_file)
        .unwrap();
    use std::io::Write;
    writeln!(file, "{}", end_event).unwrap();

    // Second poll cycle: SessionEnd should clear the integration.
    let integrations = fix.run_poll_cycle();
    let claude_integrations: Vec<_> = integrations
        .iter()
        .filter(|i| i.kind == crate::INTEGRATION_KIND)
        .collect();
    assert!(
        claude_integrations.is_empty(),
        "SessionEnd on second cycle should clear the integration"
    );
}

/// Sidechain entries in JSONL should be filtered from state determination.
#[test]
fn sidechain_entries_filtered_from_state() {
    let mut fix = TestFixture::new();
    let workspace = "/workspaces/lace";

    // Create a session file where the last entry is a sidechain assistant with
    // stop_reason = null (thinking), but the last non-sidechain entry has end_turn.
    fix.add_session_file(
        workspace,
        "sidechain-session",
        &[
            mock_user_entry(),
            mock_assistant_entry(Some("end_turn"), "claude-opus-4-6"),
            // Sidechain entry: should be filtered out of state determination.
            serde_json::json!({
                "type": "assistant",
                "parentToolUseId": "tool-use-123",
                "isSidechain": true,
                "message": {
                    "model": "claude-opus-4-6",
                    "stop_reason": null,
                    "usage": {"input_tokens": 500, "output_tokens": 200},
                    "content": [{"type": "text"}]
                },
                "sessionId": "test-session-id"
            }),
        ],
    );

    let session = make_container_session("lace-dev", "dev-container", workspace);
    let window = make_window("lace-dev", 0, "main");
    let pane = make_pane("%0", "lace-dev", 0, "ssh");

    fix.set_tmux_state(&[session], &[window], &[pane]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    // The sidechain entry (thinking) should be ignored.
    // State should reflect the last non-sidechain entry (end_turn = Idle).
    assert_eq!(
        integrations[0].status,
        sprack_db::types::ProcessStatus::Idle,
        "sidechain entries should be filtered; last non-sidechain entry is end_turn (Idle)"
    );
}
