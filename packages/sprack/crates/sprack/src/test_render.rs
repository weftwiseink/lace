//! Snapshot tests for the sprack TUI render pipeline.
//!
//! Exercises the full DB-to-render pipeline: write synthetic data to an
//! in-memory SQLite DB, call `refresh_from_db` to populate `App` state,
//! render via `TestBackend`, and compare the buffer text with `insta`.

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::buffer::Buffer;
    use ratatui::Terminal;
    use rusqlite::Connection;

    use sprack_db::types::{Pane, ProcessStatus, Session, Window};
    use sprack_db::write;

    use crate::app::App;
    use crate::render;

    // === Helpers ===

    /// Converts a ratatui Buffer to a plain-text string for snapshot comparison.
    /// Each row becomes one line; trailing whitespace on each row is preserved
    /// (ratatui pads cells with spaces).
    fn buffer_to_string(buffer: &Buffer) -> String {
        let area = buffer.area;
        let mut output = String::new();
        for y in area.y..area.y + area.height {
            for x in area.x..area.x + area.width {
                let cell = &buffer[(x, y)];
                output.push_str(cell.symbol());
            }
            // Trim trailing whitespace per line for cleaner snapshots.
            let trimmed = output.trim_end();
            output.truncate(trimmed.len());
            output.push('\n');
        }
        output
    }

    /// Creates an in-memory DB and returns a Connection ready for writing.
    fn test_db() -> Connection {
        sprack_db::open_test_db()
    }

    /// Renders an App at the given dimensions and returns the buffer text.
    /// Dynamic timestamps are normalized to a fixed value for stable snapshots.
    fn render_app(app: &mut App, cols: u16, rows: u16) -> String {
        let backend = TestBackend::new(cols, rows);
        let mut terminal = Terminal::new(backend).expect("terminal creation should succeed");
        terminal
            .draw(|frame| {
                render::render_frame(frame, app);
            })
            .expect("draw should succeed");
        let raw = buffer_to_string(terminal.backend().buffer());
        // Normalize ISO 8601 timestamps (from write::now_iso8601) to a fixed value
        // so snapshots don't break on every run.
        normalize_timestamps(&raw)
    }

    /// Replaces ISO 8601 timestamps like "2026-03-25T05:23:33Z" with a fixed placeholder.
    fn normalize_timestamps(s: &str) -> String {
        let mut result = String::with_capacity(s.len());
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            // Match pattern: YYYY-MM-DDTHH:MM:SSZ (20 chars).
            if i + 20 <= bytes.len()
                && bytes[i].is_ascii_digit()
                && bytes[i + 4] == b'-'
                && bytes[i + 7] == b'-'
                && bytes[i + 10] == b'T'
                && bytes[i + 13] == b':'
                && bytes[i + 16] == b':'
                && bytes[i + 19] == b'Z'
            {
                result.push_str("<TIMESTAMP>");
                i += 20;
            } else {
                result.push(bytes[i] as char);
                i += 1;
            }
        }
        result
    }

    /// Builds a minimal App from a DB connection, refreshes from DB, and returns it.
    /// All tree nodes are expanded so the full hierarchy is visible.
    fn app_from_db(db: Connection) -> App {
        let mut app = App::new(db, None);
        app.refresh_from_db().expect("refresh should succeed");
        // Expand all tree nodes so the full hierarchy is visible in snapshots.
        app.tree_state.open(vec![]);
        expand_all_recursive(&app.tree_items, &mut app.tree_state, vec![]);
        app
    }

    /// Recursively opens all tree nodes so the full hierarchy is rendered.
    fn expand_all_recursive(
        items: &[tui_tree_widget::TreeItem<'static, crate::tree::NodeId>],
        state: &mut tui_tree_widget::TreeState<crate::tree::NodeId>,
        path: Vec<crate::tree::NodeId>,
    ) {
        for item in items {
            let mut item_path = path.clone();
            item_path.push(item.identifier().clone());
            state.open(item_path.clone());
            expand_all_recursive(item.children(), state, item_path);
        }
    }

    // === Test data builders ===

    fn make_session(name: &str) -> Session {
        Session {
            name: name.to_string(),
            attached: false,
            lace_port: None,
            lace_user: None,
            lace_workspace: None,
            updated_at: "2026-03-21T12:00:00Z".to_string(),
        }
    }

    fn make_session_attached(name: &str) -> Session {
        Session {
            attached: true,
            ..make_session(name)
        }
    }

    fn make_session_lace(name: &str, port: u16) -> Session {
        Session {
            lace_port: Some(port),
            lace_user: Some("node".to_string()),
            lace_workspace: Some("/workspace".to_string()),
            ..make_session(name)
        }
    }

    fn make_window(session_name: &str, index: i32, name: &str) -> Window {
        Window {
            session_name: session_name.to_string(),
            window_index: index,
            name: name.to_string(),
            active: index == 0,
            layout: String::new(),
        }
    }

    fn make_pane(pane_id: &str, session_name: &str, window_index: i32) -> Pane {
        Pane {
            pane_id: pane_id.to_string(),
            session_name: session_name.to_string(),
            window_index,
            title: String::new(),
            current_command: "bash".to_string(),
            current_path: "/home/user".to_string(),
            pane_pid: Some(1234),
            active: true,
            dead: false,
            pane_width: Some(80),
            pane_height: Some(24),
            pane_left: Some(0),
            pane_top: Some(0),
            pane_index: Some(0),
            in_mode: false,
        }
    }

    fn claude_summary_json() -> String {
        serde_json::json!({
            "state": "thinking",
            "model": "claude-opus-4-6",
            "subagent_count": 2,
            "context_percent": 45,
            "last_tool": "Read",
            "tasks": [
                {"subject": "Fix rendering", "status": "InProgress"},
                {"subject": "Add tests", "status": "Completed"}
            ],
            "session_purpose": "sprack TUI development"
        })
        .to_string()
    }

    /// Writes a single session with one window, one pane, and a claude_code integration.
    fn populate_single_session_with_claude(db: &Connection) {
        let sessions = vec![make_session_attached("dev")];
        let windows = vec![make_window("dev", 0, "editor")];
        let panes = vec![make_pane("%0", "dev", 0)];
        write::write_tmux_state(db, &sessions, &windows, &panes).unwrap();
        write::write_integration(
            db,
            "%0",
            "claude_code",
            &claude_summary_json(),
            &ProcessStatus::Thinking,
        )
        .unwrap();
    }

    /// Writes a multi-session setup: one local, one lace.
    fn populate_multi_session(db: &Connection) {
        let sessions = vec![
            make_session_attached("dev"),
            make_session_lace("remote-app", 22427),
        ];
        let windows = vec![
            make_window("dev", 0, "editor"),
            make_window("dev", 1, "terminal"),
            make_window("remote-app", 0, "code"),
        ];
        let panes = vec![
            make_pane("%0", "dev", 0),
            Pane {
                pane_id: "%1".to_string(),
                current_command: "nvim".to_string(),
                active: false,
                pane_left: Some(80),
                pane_index: Some(1),
                ..make_pane("%1", "dev", 0)
            },
            make_pane("%2", "dev", 1),
            make_pane("%3", "remote-app", 0),
        ];
        write::write_tmux_state(db, &sessions, &windows, &panes).unwrap();

        // Add claude integration to the remote pane.
        write::write_integration(
            db,
            "%3",
            "claude_code",
            &claude_summary_json(),
            &ProcessStatus::Thinking,
        )
        .unwrap();
    }

    // === Snapshot tests ===

    #[test]
    fn test_render_empty_state_standard() {
        let db = test_db();
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 50, 24);
        insta::assert_snapshot!("empty_state_standard_50x24", output);
    }

    #[test]
    fn test_render_empty_state_full() {
        let db = test_db();
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 120, 24);
        insta::assert_snapshot!("empty_state_full_120x24", output);
    }

    #[test]
    fn test_render_single_session_compact() {
        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 25, 20);
        insta::assert_snapshot!("single_session_compact_25x20", output);
    }

    #[test]
    fn test_render_single_session_standard() {
        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 45, 20);
        insta::assert_snapshot!("single_session_standard_45x20", output);
    }

    #[test]
    fn test_render_single_session_wide() {
        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 80, 20);
        insta::assert_snapshot!("single_session_wide_80x20", output);
    }

    #[test]
    fn test_render_single_session_full() {
        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 120, 30);
        insta::assert_snapshot!("single_session_full_120x30", output);
    }

    #[test]
    fn test_render_multi_session_standard() {
        let db = test_db();
        populate_multi_session(&db);
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 45, 24);
        insta::assert_snapshot!("multi_session_standard_45x24", output);
    }

    #[test]
    fn test_render_multi_session_full() {
        let db = test_db();
        populate_multi_session(&db);
        let mut app = app_from_db(db);
        let output = render_app(&mut app, 120, 30);
        insta::assert_snapshot!("multi_session_full_120x30", output);
    }

    #[test]
    fn test_render_stale_poller() {
        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);
        app.poller_healthy = false;
        app.last_heartbeat = None;
        let output = render_app(&mut app, 80, 20);
        insta::assert_snapshot!("stale_poller_80x20", output);
    }

    #[test]
    fn test_render_healthy_poller() {
        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);
        app.poller_healthy = true;
        let output = render_app(&mut app, 80, 20);
        insta::assert_snapshot!("healthy_poller_80x20", output);
    }

    #[test]
    fn test_render_error_integration() {
        let db = test_db();
        let sessions = vec![make_session("dev")];
        let windows = vec![make_window("dev", 0, "editor")];
        let panes = vec![make_pane("%0", "dev", 0)];
        write::write_tmux_state(&db, &sessions, &windows, &panes).unwrap();

        let error_summary = serde_json::json!({
            "state": "error",
            "model": "claude-opus-4-6",
            "subagent_count": 0,
            "context_percent": 78,
            "error_message": "Rate limit exceeded",
            "tasks": [
                {"subject": "Fix rendering", "status": "InProgress"}
            ]
        })
        .to_string();

        write::write_integration(&db, "%0", "claude_code", &error_summary, &ProcessStatus::Error)
            .unwrap();

        let mut app = app_from_db(db);
        let output = render_app(&mut app, 120, 30);
        insta::assert_snapshot!("error_integration_full_120x30", output);
    }

    #[test]
    fn test_render_selected_pane_detail() {
        use crate::tree::NodeId;

        let db = test_db();
        populate_single_session_with_claude(&db);
        let mut app = app_from_db(db);

        // Select the pane node to trigger detail panel rendering.
        app.tree_state.select(vec![
            NodeId::HostGroup("local".to_string()),
            NodeId::Session("dev".to_string()),
            NodeId::Window("dev".to_string(), 0),
            NodeId::Pane("%0".to_string()),
        ]);

        let output = render_app(&mut app, 120, 30);
        insta::assert_snapshot!("selected_pane_detail_120x30", output);
    }
}
