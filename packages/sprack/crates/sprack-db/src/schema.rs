//! Schema creation for the sprack database.
//!
//! All CREATE TABLE statements live here. `init_schema` is called by `open_db`
//! to ensure tables exist. All statements use IF NOT EXISTS for idempotency.

use rusqlite::Connection;

use crate::error::SprackDbError;

/// Creates all five tables if they do not already exist.
///
/// Safe to call multiple times on the same connection: IF NOT EXISTS
/// makes repeated calls no-ops.
pub fn init_schema(conn: &Connection) -> Result<(), SprackDbError> {
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

const SCHEMA_SQL: &str = "
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
    PRIMARY KEY (session_name, window_index),
    FOREIGN KEY (session_name) REFERENCES sessions(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS panes (
    pane_id        TEXT PRIMARY KEY,
    session_name   TEXT NOT NULL,
    window_index   INTEGER NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    current_command TEXT NOT NULL DEFAULT '',
    current_path   TEXT NOT NULL DEFAULT '',
    pane_pid       INTEGER,
    active         INTEGER NOT NULL DEFAULT 0,
    dead           INTEGER NOT NULL DEFAULT 0,
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
