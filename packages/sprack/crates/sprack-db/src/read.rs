//! Read operations for the sprack database.
//!
//! All queries go through this module. The TUI calls these functions
//! when `check_data_version` indicates the database has changed.

use std::str::FromStr;

use rusqlite::Connection;

use crate::error::SprackDbError;
use crate::types::{DbSnapshot, Integration, Pane, ProcessStatus, Session, Window};

/// Reads all sessions, windows, panes, and integrations into a single snapshot.
///
/// Called by the TUI when `data_version` changes. Four queries, each mapping
/// rows to the corresponding struct.
pub fn read_full_state(conn: &Connection) -> Result<DbSnapshot, SprackDbError> {
    let sessions = read_sessions(conn)?;
    let windows = read_windows(conn)?;
    let panes = read_panes(conn)?;
    let integrations = read_all_integrations(conn)?;

    Ok(DbSnapshot {
        sessions,
        windows,
        panes,
        integrations,
    })
}

/// Reads SQLite's built-in change counter.
///
/// Returns a value that increments whenever any other connection commits.
/// The TUI polls this at short intervals: if unchanged, no further work is needed.
pub fn check_data_version(conn: &Connection) -> Result<u64, SprackDbError> {
    let version: u64 = conn.pragma_query_value(None, "data_version", |row| row.get(0))?;
    Ok(version)
}

/// Reads the heartbeat timestamp, if the poller has ever written one.
///
/// Returns `None` if the heartbeat row does not exist (poller never started).
pub fn read_heartbeat(conn: &Connection) -> Result<Option<String>, SprackDbError> {
    let mut statement = conn.prepare("SELECT updated_at FROM poller_heartbeat WHERE id = 1")?;
    let mut rows = statement.query([])?;
    match rows.next()? {
        Some(row) => {
            let timestamp: String = row.get(0)?;
            Ok(Some(timestamp))
        }
        None => Ok(None),
    }
}

/// Reads all integrations for a specific pane.
///
/// Useful for detail panel rendering where the TUI needs integrations
/// for a single selected pane.
pub fn read_integrations(
    conn: &Connection,
    pane_id: &str,
) -> Result<Vec<Integration>, SprackDbError> {
    let mut statement = conn.prepare(
        "SELECT pane_id, kind, summary, status, updated_at
         FROM process_integrations WHERE pane_id = ?1 ORDER BY kind",
    )?;
    let rows = statement.query_map([pane_id], map_integration_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(SprackDbError::from)
}

// === Private helpers ===

fn read_sessions(conn: &Connection) -> Result<Vec<Session>, SprackDbError> {
    let mut statement = conn.prepare(
        "SELECT name, attached, lace_port, lace_user, lace_workspace, updated_at
         FROM sessions ORDER BY name",
    )?;
    let rows = statement.query_map([], |row| {
        let attached_int: i32 = row.get(1)?;
        let lace_port: Option<i32> = row.get(2)?;
        Ok(Session {
            name: row.get(0)?,
            attached: attached_int != 0,
            lace_port: lace_port.map(|p| p as u16),
            lace_user: row.get(3)?,
            lace_workspace: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(SprackDbError::from)
}

fn read_windows(conn: &Connection) -> Result<Vec<Window>, SprackDbError> {
    let mut statement = conn.prepare(
        "SELECT session_name, window_index, name, active, layout
         FROM windows ORDER BY session_name, window_index",
    )?;
    let rows = statement.query_map([], |row| {
        let active_int: i32 = row.get(3)?;
        Ok(Window {
            session_name: row.get(0)?,
            window_index: row.get(1)?,
            name: row.get(2)?,
            active: active_int != 0,
            layout: row.get::<_, String>(4).unwrap_or_default(),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(SprackDbError::from)
}

fn read_panes(conn: &Connection) -> Result<Vec<Pane>, SprackDbError> {
    let mut statement = conn.prepare(
        "SELECT pane_id, session_name, window_index, title, current_command, current_path,
                pane_pid, active, dead, pane_width, pane_height, pane_left, pane_top,
                pane_index, pane_in_mode
         FROM panes ORDER BY session_name, window_index, pane_top, pane_left, pane_id",
    )?;
    let rows = statement.query_map([], |row| {
        let pane_pid: Option<i32> = row.get(6)?;
        let active_int: i32 = row.get(7)?;
        let dead_int: i32 = row.get(8)?;
        let pane_width: Option<i32> = row.get(9)?;
        let pane_height: Option<i32> = row.get(10)?;
        let pane_left: Option<i32> = row.get(11)?;
        let pane_top: Option<i32> = row.get(12)?;
        let pane_index: Option<i32> = row.get(13)?;
        let in_mode_int: i32 = row.get(14)?;
        Ok(Pane {
            pane_id: row.get(0)?,
            session_name: row.get(1)?,
            window_index: row.get(2)?,
            title: row.get(3)?,
            current_command: row.get(4)?,
            current_path: row.get(5)?,
            pane_pid: pane_pid.map(|p| p as u32),
            active: active_int != 0,
            dead: dead_int != 0,
            pane_width: pane_width.map(|v| v as u32),
            pane_height: pane_height.map(|v| v as u32),
            pane_left: pane_left.map(|v| v as u32),
            pane_top: pane_top.map(|v| v as u32),
            pane_index: pane_index.map(|v| v as u32),
            in_mode: in_mode_int != 0,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(SprackDbError::from)
}

fn read_all_integrations(conn: &Connection) -> Result<Vec<Integration>, SprackDbError> {
    let mut statement = conn.prepare(
        "SELECT pane_id, kind, summary, status, updated_at
         FROM process_integrations ORDER BY pane_id, kind",
    )?;
    let rows = statement.query_map([], map_integration_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(SprackDbError::from)
}

fn map_integration_row(row: &rusqlite::Row) -> rusqlite::Result<Integration> {
    let status_text: String = row.get(3)?;
    let status = ProcessStatus::from_str(&status_text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(Integration {
        pane_id: row.get(0)?,
        kind: row.get(1)?,
        summary: row.get(2)?,
        status,
        updated_at: row.get(4)?,
    })
}
