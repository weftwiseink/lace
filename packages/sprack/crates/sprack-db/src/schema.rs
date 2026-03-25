//! Schema creation and migration for the sprack database.
//!
//! All CREATE TABLE statements live here. `init_schema` is called by `open_db`
//! to ensure tables exist. Uses `PRAGMA user_version` for schema versioning.

use rusqlite::Connection;

use crate::error::SprackDbError;

/// Current schema version. Increment when the schema changes.
const CURRENT_SCHEMA_VERSION: i32 = 1;

/// Creates or migrates the database schema.
///
/// Checks `PRAGMA user_version` to determine the current schema version:
/// - Version 0: Fresh DB or pre-versioning. Drop all tables and recreate at version 1.
/// - Version 1: Current version. Ensure tables exist (IF NOT EXISTS).
/// - Higher: Unsupported. Return an error directing the user to rebuild.
pub fn init_schema(conn: &Connection) -> Result<(), SprackDbError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    match version {
        0 => {
            // Fresh DB or pre-versioning schema. Drop and recreate.
            conn.execute_batch(
                "DROP TABLE IF EXISTS process_integrations;
                 DROP TABLE IF EXISTS panes;
                 DROP TABLE IF EXISTS windows;
                 DROP TABLE IF EXISTS sessions;
                 DROP TABLE IF EXISTS poller_heartbeat;",
            )?;
            conn.execute_batch(SCHEMA_SQL)?;
        }
        v if v == CURRENT_SCHEMA_VERSION => {
            // Current version. Ensure tables exist (idempotent).
            conn.execute_batch(SCHEMA_SQL)?;
        }
        other => {
            return Err(SprackDbError::UnsupportedSchemaVersion(other));
        }
    }

    Ok(())
}

const SCHEMA_SQL: &str = "
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS sessions (
    name           TEXT PRIMARY KEY,
    attached       INTEGER NOT NULL DEFAULT 0,
    lace_port      INTEGER,
    lace_user      TEXT,
    lace_workspace TEXT,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS windows (
    session_name   TEXT NOT NULL,
    window_index   INTEGER NOT NULL,
    name           TEXT NOT NULL,
    active         INTEGER NOT NULL DEFAULT 0,
    layout         TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (session_name, window_index),
    FOREIGN KEY (session_name) REFERENCES sessions(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panes (
    pane_id         TEXT PRIMARY KEY,
    session_name    TEXT NOT NULL,
    window_index    INTEGER NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    current_command TEXT NOT NULL DEFAULT '',
    current_path    TEXT NOT NULL DEFAULT '',
    pane_pid        INTEGER,
    active          INTEGER NOT NULL DEFAULT 0,
    dead            INTEGER NOT NULL DEFAULT 0,
    pane_width      INTEGER,
    pane_height     INTEGER,
    pane_left       INTEGER,
    pane_top        INTEGER,
    pane_index      INTEGER,
    pane_in_mode    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_name, window_index)
        REFERENCES windows(session_name, window_index) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS process_integrations (
    pane_id        TEXT NOT NULL,
    kind           TEXT NOT NULL,
    summary        TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'idle',
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (pane_id, kind),
    FOREIGN KEY (pane_id) REFERENCES panes(pane_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poller_heartbeat (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at     TEXT NOT NULL
);
";
