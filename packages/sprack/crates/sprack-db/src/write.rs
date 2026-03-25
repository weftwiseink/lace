//! Write operations for the sprack database.
//!
//! All mutations go through this module. Callers never write raw SQL.

use rusqlite::Connection;

use crate::error::SprackDbError;
use crate::types::{Pane, Session, Window};

/// Replaces all tmux state in a single transaction.
///
/// Deletes all existing sessions (CASCADE handles windows, panes, integrations),
/// then inserts the provided sessions, windows, and panes.
/// The caller is responsible for populating `updated_at` timestamps on sessions.
pub fn write_tmux_state(
    conn: &Connection,
    sessions: &[Session],
    windows: &[Window],
    panes: &[Pane],
) -> Result<(), SprackDbError> {
    let transaction = conn.unchecked_transaction()?;

    transaction.execute("DELETE FROM sessions", [])?;
    insert_sessions(&transaction, sessions)?;
    insert_windows(&transaction, windows)?;
    insert_panes(&transaction, panes)?;

    transaction.commit()?;
    Ok(())
}

/// Upserts the singleton heartbeat row with the current timestamp.
///
/// Uses INSERT OR REPLACE to ensure only one row exists (id = 1).
pub fn write_heartbeat(conn: &Connection) -> Result<(), SprackDbError> {
    let timestamp = now_iso8601();
    conn.execute(
        "INSERT OR REPLACE INTO poller_heartbeat (id, updated_at) VALUES (1, ?1)",
        [&timestamp],
    )?;
    Ok(())
}

/// Upserts a single process integration row.
///
/// Called by summarizers (e.g., sprack-claude) after computing process status.
/// Uses INSERT OR REPLACE on the composite primary key (pane_id, kind).
pub fn write_integration(
    conn: &Connection,
    pane_id: &str,
    kind: &str,
    summary: &str,
    status: &crate::types::ProcessStatus,
) -> Result<(), SprackDbError> {
    let timestamp = now_iso8601();
    let status_text = status.to_string();
    conn.execute(
        "INSERT OR REPLACE INTO process_integrations (pane_id, kind, summary, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![pane_id, kind, summary, status_text, timestamp],
    )?;
    Ok(())
}

fn insert_sessions(conn: &Connection, sessions: &[Session]) -> Result<(), SprackDbError> {
    let mut statement = conn.prepare(
        "INSERT INTO sessions (name, attached, lace_port, lace_user, lace_workspace, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for session in sessions {
        statement.execute(rusqlite::params![
            session.name,
            session.attached as i32,
            session.lace_port,
            session.lace_user,
            session.lace_workspace,
            session.updated_at,
        ])?;
    }
    Ok(())
}

fn insert_windows(conn: &Connection, windows: &[Window]) -> Result<(), SprackDbError> {
    let mut statement = conn.prepare(
        "INSERT INTO windows (session_name, window_index, name, active, layout)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for window in windows {
        statement.execute(rusqlite::params![
            window.session_name,
            window.window_index,
            window.name,
            window.active as i32,
            window.layout,
        ])?;
    }
    Ok(())
}

fn insert_panes(conn: &Connection, panes: &[Pane]) -> Result<(), SprackDbError> {
    let mut statement = conn.prepare(
        "INSERT INTO panes (pane_id, session_name, window_index, title, current_command, current_path, pane_pid, active, dead, pane_width, pane_height, pane_left, pane_top, pane_index, pane_in_mode)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
    )?;
    for pane in panes {
        statement.execute(rusqlite::params![
            pane.pane_id,
            pane.session_name,
            pane.window_index,
            pane.title,
            pane.current_command,
            pane.current_path,
            pane.pane_pid,
            pane.active as i32,
            pane.dead as i32,
            pane.pane_width,
            pane.pane_height,
            pane.pane_left,
            pane.pane_top,
            pane.pane_index,
            pane.in_mode as i32,
        ])?;
    }
    Ok(())
}

/// Returns the current time as an ISO 8601 string with UTC timezone.
///
/// Used by write operations in this module and exported for other crates
/// (e.g., sprack-poll) that need timestamps in the same format.
// NOTE(opus/sprack-db): Using a simple seconds-since-epoch format for now.
// A proper ISO 8601 library (chrono or time) would be cleaner, but avoiding
// extra dependencies for this ephemeral timestamp.
pub fn now_iso8601() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("1970-01-01T00:00:00Z+{}s", duration.as_secs())
}
