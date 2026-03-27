//! Write operations for the sprack database.
//!
//! All mutations go through this module. Callers never write raw SQL.

use rusqlite::Connection;

use crate::error::SprackDbError;
use crate::types::{Pane, Session, Window};

/// Replaces all tmux state in a single transaction.
///
/// Saves process_integrations before the cascade delete and restores them
/// afterward, since the DELETE FROM sessions cascades through windows -> panes
/// -> process_integrations. Integrations are only restored for panes that
/// still exist in the new snapshot.
pub fn write_tmux_state(
    conn: &Connection,
    sessions: &[Session],
    windows: &[Window],
    panes: &[Pane],
) -> Result<(), SprackDbError> {
    let transaction = conn.unchecked_transaction()?;

    // Save integrations before cascade delete wipes them.
    let saved_integrations = save_integrations(&transaction)?;

    transaction.execute("DELETE FROM sessions", [])?;
    insert_sessions(&transaction, sessions)?;
    insert_windows(&transaction, windows)?;
    insert_panes(&transaction, panes)?;

    // Restore integrations for panes that survived the replacement.
    restore_integrations(&transaction, &saved_integrations)?;

    transaction.commit()?;
    Ok(())
}

/// Reads all process_integrations rows for preservation across state replacement.
fn save_integrations(
    conn: &Connection,
) -> Result<Vec<(String, String, String, String, String)>, SprackDbError> {
    let mut statement =
        conn.prepare("SELECT pane_id, kind, summary, status, updated_at FROM process_integrations")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// Restores saved integrations for panes that survived the state replacement.
/// FK violations (pane_id not in panes) produce errors that are silently
/// discarded via `let _ =`, effectively skipping removed panes.
fn restore_integrations(
    conn: &Connection,
    integrations: &[(String, String, String, String, String)],
) -> Result<(), SprackDbError> {
    let mut statement = conn.prepare(
        "INSERT OR IGNORE INTO process_integrations (pane_id, kind, summary, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (pane_id, kind, summary, status, updated_at) in integrations {
        let _ = statement.execute(rusqlite::params![pane_id, kind, summary, status, updated_at]);
    }
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
        "INSERT INTO sessions (name, attached, container_name, container_user, container_workspace, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for session in sessions {
        statement.execute(rusqlite::params![
            session.name,
            session.attached as i32,
            session.container_name,
            session.container_user,
            session.container_workspace,
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

/// Returns the current UTC time as seconds since the Unix epoch.
pub fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Returns the current time as an ISO 8601 string with UTC timezone.
///
/// Used by write operations in this module and exported for other crates
/// (e.g., sprack-poll) that need timestamps in the same format.
pub fn now_iso8601() -> String {
    epoch_secs_to_iso8601(now_epoch_secs())
}

/// Converts seconds since the Unix epoch to an ISO 8601 string (`YYYY-MM-DDTHH:MM:SSZ`).
fn epoch_secs_to_iso8601(secs: u64) -> String {
    let (hour, minute, second) = ((secs % 86400) / 3600, (secs % 3600) / 60, secs % 60);

    // Howard Hinnant's civil_from_days algorithm.
    let days = (secs / 86400) as i64;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Parses an ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SSZ`) into seconds since the Unix epoch.
///
/// Returns `None` if the format doesn't match. Inverse of `now_iso8601`.
pub fn parse_iso8601_to_epoch(s: &str) -> Option<u64> {
    // Expected format: "YYYY-MM-DDTHH:MM:SSZ" (20 chars).
    if s.len() != 20 || !s.ends_with('Z') {
        return None;
    }
    let bytes = s.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' || bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }

    let y: i64 = s[0..4].parse().ok()?;
    let m: i64 = s[5..7].parse().ok()?;
    let d: i64 = s[8..10].parse().ok()?;
    let hour: u64 = s[11..13].parse().ok()?;
    let minute: u64 = s[14..16].parse().ok()?;
    let second: u64 = s[17..19].parse().ok()?;

    // Inverse of Howard Hinnant's civil_from_days: days_from_civil.
    let y_adj = if m <= 2 { y - 1 } else { y };
    let era = y_adj.div_euclid(400);
    let yoe = y_adj.rem_euclid(400);
    let m_adj = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * m_adj + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;

    if days < 0 {
        return None;
    }

    Some(days as u64 * 86400 + hour * 3600 + minute * 60 + second)
}
