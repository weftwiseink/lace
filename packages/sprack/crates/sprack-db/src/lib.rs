//! sprack-db: shared SQLite library for the sprack ecosystem.
//!
//! Provides the SQLite schema, connection management, typed query helpers,
//! and shared data types. All three sprack binaries (sprack TUI, sprack-poll,
//! sprack-claude) depend on this crate. Callers never write raw SQL.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

pub mod error;
pub mod read;
pub mod schema;
pub mod types;
pub mod write;

pub use error::SprackDbError;

/// Opens a read-write SQLite connection with WAL mode, busy timeout, and foreign keys.
///
/// If `path` is `None`, uses the default location `~/.local/share/sprack/state.db`.
/// Creates parent directories if needed, then initializes the schema.
pub fn open_db(path: Option<&Path>) -> Result<Connection, SprackDbError> {
    let db_path = match path {
        Some(p) => p.to_path_buf(),
        None => default_db_path()?,
    };
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&db_path)?;

    let mode: String =
        conn.pragma_update_and_check(None, "journal_mode", "wal", |row| row.get(0))?;
    if mode != "wal" {
        return Err(SprackDbError::WalActivationFailed(mode));
    }

    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "foreign_keys", "on")?;

    schema::init_schema(&conn)?;
    Ok(conn)
}

/// Opens a read-only SQLite connection for TUI use.
///
/// Uses `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` flags.
/// Verifies WAL mode is active (does not attempt to set it).
/// Checks schema version: returns `UnsupportedSchemaVersion` if the DB was
/// created by an older binary that lacks the current schema columns.
pub fn open_db_readonly(path: Option<&Path>) -> Result<Connection, SprackDbError> {
    let db_path = match path {
        Some(p) => p.to_path_buf(),
        None => default_db_path()?,
    };

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;

    let mode: String = conn.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if mode != "wal" {
        return Err(SprackDbError::WalActivationFailed(mode));
    }

    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "foreign_keys", "on")?;

    // Verify schema version matches what this binary expects.
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != schema::CURRENT_SCHEMA_VERSION {
        return Err(SprackDbError::UnsupportedSchemaVersion(version));
    }

    Ok(conn)
}

/// Returns the default database path: `~/.local/share/sprack/state.db`.
fn default_db_path() -> Result<PathBuf, SprackDbError> {
    let home = std::env::var("HOME")
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME not set"))?;
    Ok(PathBuf::from(home).join(".local/share/sprack/state.db"))
}

/// Opens an in-memory SQLite connection with the schema initialized.
///
/// Intended for use in tests across crates that need a populated sprack DB
/// without touching the filesystem. WAL mode is not applicable to in-memory DBs.
#[cfg(any(test, feature = "test-support"))]
pub fn open_test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("failed to open in-memory db");
    conn.pragma_update(None, "foreign_keys", "on")
        .expect("failed to enable foreign keys");
    schema::init_schema(&conn).expect("failed to init schema");
    conn
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;
    use crate::types::*;

    // === Test data builders ===

    fn make_test_session(name: &str) -> Session {
        Session {
            name: name.to_string(),
            attached: false,
            container_name: None,
            container_user: None,
            container_workspace: None,
            updated_at: "2026-03-21T12:00:00Z".to_string(),
        }
    }

    fn make_test_window(session_name: &str, window_index: i32) -> Window {
        Window {
            session_name: session_name.to_string(),
            window_index,
            name: format!("win-{window_index}"),
            active: window_index == 0,
            layout: String::new(),
        }
    }

    fn make_test_pane(pane_id: &str, session_name: &str, window_index: i32) -> Pane {
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
            pane_width: None,
            pane_height: None,
            pane_left: None,
            pane_top: None,
            pane_index: None,
            in_mode: false,
        }
    }

    /// Helper: delegates to the public `open_test_db` from `lib.rs`.
    fn open_test_db() -> Connection {
        super::open_test_db()
    }

    // === 1. Schema creation ===

    #[test]
    fn test_schema_creation_creates_all_five_tables() {
        let temp_dir = std::env::temp_dir().join("sprack-db-test-schema");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test-schema.db");

        let conn = open_db(Some(&db_path)).unwrap();

        let mut statement = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let table_names: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(table_names.contains(&"sessions".to_string()));
        assert!(table_names.contains(&"windows".to_string()));
        assert!(table_names.contains(&"panes".to_string()));
        assert!(table_names.contains(&"process_integrations".to_string()));
        assert!(table_names.contains(&"poller_heartbeat".to_string()));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    // === 2. Idempotent schema ===

    #[test]
    fn test_init_schema_idempotent_no_error_on_second_call() {
        let conn = open_test_db();
        // Second call should succeed without error.
        schema::init_schema(&conn).unwrap();
    }

    // === 3. Round-trip sessions ===

    #[test]
    fn test_round_trip_sessions_write_read_equality() {
        let conn = open_test_db();

        let sessions = vec![
            Session {
                name: "dev".to_string(),
                attached: true,
                container_name: Some("dev".to_string()),
                container_user: Some("node".to_string()),
                container_workspace: Some("/workspace".to_string()),
                updated_at: "2026-03-21T12:00:00Z".to_string(),
            },
            make_test_session("main"),
        ];

        write::write_tmux_state(&conn, &sessions, &[], &[]).unwrap();
        let snapshot = read::read_full_state(&conn).unwrap();

        assert_eq!(snapshot.sessions.len(), 2);
        assert_eq!(snapshot.sessions[0], sessions[0]);
        assert_eq!(snapshot.sessions[1], sessions[1]);
    }

    // === 4. Round-trip windows and panes ===

    #[test]
    fn test_round_trip_full_state_tree() {
        let conn = open_test_db();

        let sessions = vec![make_test_session("sess1")];
        let windows = vec![make_test_window("sess1", 0), make_test_window("sess1", 1)];
        let panes = vec![
            make_test_pane("%0", "sess1", 0),
            make_test_pane("%1", "sess1", 0),
            make_test_pane("%2", "sess1", 1),
        ];

        write::write_tmux_state(&conn, &sessions, &windows, &panes).unwrap();
        let snapshot = read::read_full_state(&conn).unwrap();

        assert_eq!(snapshot.sessions.len(), 1);
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.panes.len(), 3);

        // Verify parent-child relationships.
        for window in &snapshot.windows {
            assert_eq!(window.session_name, "sess1");
        }
        for pane in &snapshot.panes {
            assert_eq!(pane.session_name, "sess1");
        }
    }

    // === 5. CASCADE delete ===

    #[test]
    fn test_cascade_delete_removes_children() {
        let conn = open_test_db();

        let sessions = vec![make_test_session("sess1"), make_test_session("sess2")];
        let windows = vec![make_test_window("sess1", 0), make_test_window("sess2", 0)];
        let panes = vec![
            make_test_pane("%0", "sess1", 0),
            make_test_pane("%1", "sess2", 0),
        ];

        write::write_tmux_state(&conn, &sessions, &windows, &panes).unwrap();

        // Write an integration for pane %0 (belongs to sess1).
        write::write_integration(
            &conn,
            "%0",
            "claude_code",
            "thinking",
            &ProcessStatus::Thinking,
        )
        .unwrap();

        // Delete sess1 directly.
        conn.execute("DELETE FROM sessions WHERE name = 'sess1'", [])
            .unwrap();

        let snapshot = read::read_full_state(&conn).unwrap();
        assert_eq!(snapshot.sessions.len(), 1);
        assert_eq!(snapshot.sessions[0].name, "sess2");
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.panes.len(), 1);
        assert_eq!(snapshot.integrations.len(), 0);
    }

    // === 6. Integration upsert ===

    #[test]
    fn test_integration_upsert_updates_existing_row() {
        let conn = open_test_db();

        let sessions = vec![make_test_session("s")];
        let windows = vec![make_test_window("s", 0)];
        let panes = vec![make_test_pane("%0", "s", 0)];
        write::write_tmux_state(&conn, &sessions, &windows, &panes).unwrap();

        // First write.
        write::write_integration(&conn, "%0", "claude_code", "initial", &ProcessStatus::Idle)
            .unwrap();

        // Second write with updated summary.
        write::write_integration(
            &conn,
            "%0",
            "claude_code",
            "updated summary",
            &ProcessStatus::Thinking,
        )
        .unwrap();

        let integrations = read::read_integrations(&conn, "%0").unwrap();
        assert_eq!(integrations.len(), 1);
        assert_eq!(integrations[0].summary, "updated summary");
        assert_eq!(integrations[0].status, ProcessStatus::Thinking);
    }

    // === 7. ProcessStatus round-trip ===

    #[test]
    fn test_process_status_display_from_str_round_trip() {
        let variants = vec![
            (ProcessStatus::Thinking, "thinking"),
            (ProcessStatus::ToolUse, "tool_use"),
            (ProcessStatus::Idle, "idle"),
            (ProcessStatus::Error, "error"),
            (ProcessStatus::Waiting, "waiting"),
            (ProcessStatus::Complete, "complete"),
        ];

        for (variant, expected_text) in variants {
            let displayed = variant.to_string();
            assert_eq!(displayed, expected_text);

            let parsed = ProcessStatus::from_str(&displayed).unwrap();
            assert_eq!(parsed, variant);
        }

        // Invalid status should error.
        let result = ProcessStatus::from_str("nonexistent");
        assert!(result.is_err());
    }

    // === 8. data_version detection ===

    #[test]
    fn test_data_version_changes_after_write_from_other_connection() {
        let temp_dir = std::env::temp_dir().join("sprack-db-test-data-version");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test-dv.db");

        let conn1 = open_db(Some(&db_path)).unwrap();
        let conn2 = open_db(Some(&db_path)).unwrap();

        let version_before = read::check_data_version(&conn2).unwrap();

        let sessions = vec![make_test_session("s")];
        write::write_tmux_state(&conn1, &sessions, &[], &[]).unwrap();

        let version_after = read::check_data_version(&conn2).unwrap();
        assert_ne!(version_before, version_after);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    // === 9. Heartbeat round-trip ===

    #[test]
    fn test_heartbeat_write_read_round_trip() {
        let conn = open_test_db();

        // No heartbeat initially.
        let heartbeat = read::read_heartbeat(&conn).unwrap();
        assert!(heartbeat.is_none());

        write::write_heartbeat(&conn).unwrap();

        let heartbeat = read::read_heartbeat(&conn).unwrap();
        assert!(heartbeat.is_some());
        assert!(!heartbeat.unwrap().is_empty());
    }

    // === 10. Empty state ===

    #[test]
    fn test_empty_state_returns_empty_vectors() {
        let conn = open_test_db();
        let snapshot = read::read_full_state(&conn).unwrap();

        assert!(snapshot.sessions.is_empty());
        assert!(snapshot.windows.is_empty());
        assert!(snapshot.panes.is_empty());
        assert!(snapshot.integrations.is_empty());
    }

    // === 11. Foreign key enforcement ===

    #[test]
    fn test_foreign_key_enforcement_pane_with_nonexistent_window_fails() {
        let conn = open_test_db();

        // Insert a session but no window.
        let sessions = vec![make_test_session("s")];
        write::write_tmux_state(&conn, &sessions, &[], &[]).unwrap();

        // Directly try to insert a pane referencing a nonexistent window.
        let result = conn.execute(
            "INSERT INTO panes (pane_id, session_name, window_index, active, dead) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["%99", "s", 99, 0, 0],
        );

        assert!(result.is_err());
    }

    // === 12. WAL concurrent read/write ===

    #[test]
    fn test_wal_concurrent_read_write_both_succeed() {
        let temp_dir = std::env::temp_dir().join("sprack-db-test-wal-concurrent");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test-wal.db");

        let writer = open_db(Some(&db_path)).unwrap();
        let reader = open_db_readonly(Some(&db_path)).unwrap();

        // Read on reader while writing on writer.
        let snapshot_before = read::read_full_state(&reader).unwrap();
        assert!(snapshot_before.sessions.is_empty());

        let sessions = vec![make_test_session("concurrent")];
        write::write_tmux_state(&writer, &sessions, &[], &[]).unwrap();

        let snapshot_after = read::read_full_state(&reader).unwrap();
        assert_eq!(snapshot_after.sessions.len(), 1);
        assert_eq!(snapshot_after.sessions[0].name, "concurrent");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    // === 13. Integration FK enforcement ===

    #[test]
    fn test_integration_fk_enforcement_nonexistent_pane_fails() {
        let conn = open_test_db();

        let result = write::write_integration(
            &conn,
            "%nonexistent",
            "claude_code",
            "test",
            &ProcessStatus::Idle,
        );

        assert!(result.is_err());
    }

    // === 14. WAL verification ===

    #[test]
    fn test_wal_verification_with_file_based_db() {
        let temp_dir = std::env::temp_dir().join("sprack-db-test-wal-verify");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test-wal-verify.db");

        // open_db should succeed and activate WAL on a file-based DB.
        let conn = open_db(Some(&db_path)).unwrap();

        // Verify WAL is active.
        let mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
