//! Incremental session cache for richer Claude Code summaries.
//!
//! Ingests JSONL entries into a persistent SQLite cache (`session-cache.db`),
//! tracking turn counts, tool usage, context history, and subagent lifecycle.
//! The cache persists across sprack-claude restarts, avoiding re-parsing.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::jsonl::JsonlEntry;
use crate::status::{extract_context_percent, extract_last_tool, extract_model};

/// Opens the session cache database, creating it if needed.
///
/// Uses WAL mode and foreign keys, same as sprack-db.
#[allow(dead_code)]
pub fn open_cache_db(path: Option<&Path>) -> anyhow::Result<Connection> {
    let db_path = match path {
        Some(p) => p.to_path_buf(),
        None => default_cache_path()?,
    };
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&db_path)?;
    conn.pragma_update(None, "journal_mode", "wal")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "foreign_keys", "on")?;
    init_cache_schema(&conn)?;

    Ok(conn)
}

#[allow(dead_code)]
fn default_cache_path() -> anyhow::Result<PathBuf> {
    let home = std::env::var("HOME")
        .map_err(|_| anyhow::anyhow!("HOME not set"))?;
    Ok(PathBuf::from(home).join(".local/share/sprack/session-cache.db"))
}

fn init_cache_schema(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(CACHE_SCHEMA_SQL)?;
    Ok(())
}

const CACHE_SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS ingestion_state (
    file_path       TEXT PRIMARY KEY,
    byte_offset     INTEGER NOT NULL DEFAULT 0,
    file_size       INTEGER NOT NULL DEFAULT 0,
    session_id      TEXT,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_metadata (
    session_id          TEXT PRIMARY KEY,
    project_path        TEXT NOT NULL,
    model               TEXT,
    started_at          TEXT,
    last_activity_at    TEXT,
    user_turns          INTEGER NOT NULL DEFAULT 0,
    assistant_turns     INTEGER NOT NULL DEFAULT 0,
    total_input_tokens  INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cache_read    INTEGER NOT NULL DEFAULT 0,
    total_cache_create  INTEGER NOT NULL DEFAULT 0,
    last_context_pct    INTEGER NOT NULL DEFAULT 0,
    last_stop_reason    TEXT,
    last_tool           TEXT,
    active_subagents    INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    file_path           TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_usage (
    session_id  TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    call_count  INTEGER NOT NULL DEFAULT 0,
    last_used   TEXT NOT NULL,
    PRIMARY KEY (session_id, tool_name),
    FOREIGN KEY (session_id) REFERENCES session_metadata(session_id)
);

CREATE TABLE IF NOT EXISTS context_history (
    session_id      TEXT NOT NULL,
    seq             INTEGER NOT NULL,
    recorded_at     TEXT NOT NULL,
    context_pct     INTEGER NOT NULL,
    input_tokens    INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq),
    FOREIGN KEY (session_id) REFERENCES session_metadata(session_id)
);

CREATE TABLE IF NOT EXISTS subagent_tracking (
    session_id          TEXT NOT NULL,
    tool_use_id         TEXT NOT NULL,
    parent_tool_use_id  TEXT,
    first_seen_at       TEXT NOT NULL,
    last_seen_at        TEXT NOT NULL,
    is_complete         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, tool_use_id),
    FOREIGN KEY (session_id) REFERENCES session_metadata(session_id)
);
";

/// Ingests a batch of new JSONL entries into the session cache.
///
/// Updates session_metadata counters, tool_usage, context_history, and subagent_tracking.
/// Entries with `is_compact_summary = true` are skipped to avoid double-counting.
pub fn ingest_new_entries(
    conn: &Connection,
    file_path: &str,
    project_path: &str,
    entries: &[JsonlEntry],
) -> anyhow::Result<()> {
    let timestamp = now_utc();

    // Filter out compact summary entries (re-stated messages that would double-count).
    let real_entries: Vec<&JsonlEntry> = entries
        .iter()
        .filter(|e| !e.is_compact_summary.unwrap_or(false))
        .filter(|e| !e.is_sidechain.unwrap_or(false))
        .collect();

    if real_entries.is_empty() {
        return Ok(());
    }

    // Extract session_id from the first entry that has one.
    let session_id = real_entries
        .iter()
        .find_map(|e| e.session_id.as_deref())
        .unwrap_or("unknown");

    // Ensure session_metadata row exists.
    conn.execute(
        "INSERT OR IGNORE INTO session_metadata (session_id, project_path, file_path, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, project_path, file_path, timestamp],
    )?;

    let mut user_turns_delta: i64 = 0;
    let mut assistant_turns_delta: i64 = 0;
    let mut input_tokens_delta: i64 = 0;
    let mut output_tokens_delta: i64 = 0;
    let mut cache_read_delta: i64 = 0;
    let mut cache_create_delta: i64 = 0;
    let mut last_context_pct: Option<u8> = None;
    let mut last_stop_reason: Option<String> = None;
    let mut last_tool: Option<String> = None;
    let mut model: Option<String> = None;
    let mut last_activity: Option<String> = None;
    let mut context_rows: Vec<(u8, i64)> = Vec::new();

    for entry in &real_entries {
        match entry.entry_type.as_str() {
            "user" => {
                user_turns_delta += 1;
            }
            "assistant" => {
                assistant_turns_delta += 1;
                if let Some(msg) = &entry.message {
                    if let Some(usage) = &msg.usage {
                        input_tokens_delta += usage.input_tokens as i64;
                        output_tokens_delta += usage.output_tokens as i64;
                        cache_read_delta += usage.cache_read_input_tokens.unwrap_or(0) as i64;
                        cache_create_delta += usage.cache_creation_input_tokens.unwrap_or(0) as i64;
                    }
                    let pct = extract_context_percent(msg);
                    last_context_pct = Some(pct);
                    let total_input = msg.usage.as_ref().map(|u| {
                        u.input_tokens as i64
                            + u.cache_read_input_tokens.unwrap_or(0) as i64
                            + u.cache_creation_input_tokens.unwrap_or(0) as i64
                    }).unwrap_or(0);
                    context_rows.push((pct, total_input));

                    last_stop_reason = msg.stop_reason.clone();
                    if let Some(tool) = extract_last_tool(msg) {
                        // Track tool usage.
                        conn.execute(
                            "INSERT INTO tool_usage (session_id, tool_name, call_count, last_used)
                             VALUES (?1, ?2, 1, ?3)
                             ON CONFLICT(session_id, tool_name) DO UPDATE SET
                                call_count = call_count + 1, last_used = ?3",
                            rusqlite::params![session_id, tool, timestamp],
                        )?;
                        last_tool = Some(tool);
                    }
                    if let Some(m) = extract_model(msg) {
                        model = Some(m);
                    }
                }
                last_activity = entry.timestamp.clone().or(last_activity);
            }
            "progress" => {
                if let Some(data) = &entry.data {
                    if data.data_type.as_deref() == Some("agent_progress") {
                        if let Some(tool_use_id) = &data.tool_use_id {
                            conn.execute(
                                "INSERT INTO subagent_tracking
                                    (session_id, tool_use_id, first_seen_at, last_seen_at)
                                 VALUES (?1, ?2, ?3, ?3)
                                 ON CONFLICT(session_id, tool_use_id) DO UPDATE SET
                                    last_seen_at = ?3",
                                rusqlite::params![session_id, tool_use_id, timestamp],
                            )?;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Update session_metadata with accumulated deltas.
    let mut update_parts = vec![
        "user_turns = user_turns + ?2",
        "assistant_turns = assistant_turns + ?3",
        "total_input_tokens = total_input_tokens + ?4",
        "total_output_tokens = total_output_tokens + ?5",
        "total_cache_read = total_cache_read + ?6",
        "total_cache_create = total_cache_create + ?7",
        "updated_at = ?8",
    ];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(session_id.to_string()),
        Box::new(user_turns_delta),
        Box::new(assistant_turns_delta),
        Box::new(input_tokens_delta),
        Box::new(output_tokens_delta),
        Box::new(cache_read_delta),
        Box::new(cache_create_delta),
        Box::new(timestamp.clone()),
    ];

    let mut param_idx = 9;
    if let Some(pct) = last_context_pct {
        update_parts.push(&"last_context_pct = ?9");
        params.push(Box::new(pct as i32));
        param_idx = 10;
    }
    if let Some(ref reason) = last_stop_reason {
        let placeholder = if param_idx == 9 { "?9" } else { "?10" };
        let part = format!("last_stop_reason = {placeholder}");
        // Use a static string to avoid lifetime issues.
        if param_idx == 9 {
            update_parts.push("last_stop_reason = ?9");
            param_idx = 10;
        } else {
            update_parts.push("last_stop_reason = ?10");
            param_idx = 11;
        }
        let _ = part;
        params.push(Box::new(reason.clone()));
    }
    if let Some(ref tool) = last_tool {
        let part = format!("last_tool = ?{param_idx}");
        let _ = part;
        match param_idx {
            9 => update_parts.push("last_tool = ?9"),
            10 => update_parts.push("last_tool = ?10"),
            _ => update_parts.push("last_tool = ?11"),
        }
        params.push(Box::new(tool.clone()));
        param_idx += 1;
    }
    if let Some(ref m) = model {
        match param_idx {
            9 => update_parts.push("model = ?9"),
            10 => update_parts.push("model = ?10"),
            11 => update_parts.push("model = ?11"),
            _ => update_parts.push("model = ?12"),
        }
        params.push(Box::new(m.clone()));
        param_idx += 1;
    }
    if let Some(ref activity) = last_activity {
        match param_idx {
            9 => update_parts.push("last_activity_at = ?9"),
            10 => update_parts.push("last_activity_at = ?10"),
            11 => update_parts.push("last_activity_at = ?11"),
            12 => update_parts.push("last_activity_at = ?12"),
            _ => update_parts.push("last_activity_at = ?13"),
        }
        params.push(Box::new(activity.clone()));
    }

    let sql = format!(
        "UPDATE session_metadata SET {} WHERE session_id = ?1",
        update_parts.join(", ")
    );
    conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))?;

    // Insert context history rows.
    let max_seq: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM context_history WHERE session_id = ?1",
        [session_id],
        |row| row.get(0),
    )?;
    for (i, (pct, input_tokens)) in context_rows.iter().enumerate() {
        conn.execute(
            "INSERT INTO context_history (session_id, seq, recorded_at, context_pct, input_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![session_id, max_seq + 1 + i as i64, timestamp, *pct as i32, *input_tokens],
        )?;
    }

    // Update active_subagents count.
    let active_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM subagent_tracking WHERE session_id = ?1 AND is_complete = 0",
        [session_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE session_metadata SET active_subagents = ?1 WHERE session_id = ?2",
        rusqlite::params![active_count, session_id],
    )?;

    Ok(())
}

/// Reads cached session data for building summaries.
#[allow(dead_code)]
pub struct CachedSessionData {
    pub session_id: String,
    pub model: Option<String>,
    pub user_turns: u32,
    pub assistant_turns: u32,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read: u64,
    pub total_cache_create: u64,
    pub last_context_pct: u8,
    pub last_stop_reason: Option<String>,
    pub last_tool: Option<String>,
    pub active_subagents: u32,
    pub last_activity_at: Option<String>,
    pub tool_counts: Vec<(String, u32)>,
    pub context_trend: Option<String>,
}

/// Reads session summary data from the cache.
#[allow(dead_code)]
pub fn read_session_summary(conn: &Connection, session_id: &str) -> Option<CachedSessionData> {
    let row = conn.query_row(
        "SELECT session_id, model, user_turns, assistant_turns,
                total_input_tokens, total_output_tokens, total_cache_read, total_cache_create,
                last_context_pct, last_stop_reason, last_tool, active_subagents, last_activity_at
         FROM session_metadata WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(CachedSessionData {
                session_id: row.get(0)?,
                model: row.get(1)?,
                user_turns: row.get::<_, i32>(2)? as u32,
                assistant_turns: row.get::<_, i32>(3)? as u32,
                total_input_tokens: row.get::<_, i64>(4)? as u64,
                total_output_tokens: row.get::<_, i64>(5)? as u64,
                total_cache_read: row.get::<_, i64>(6)? as u64,
                total_cache_create: row.get::<_, i64>(7)? as u64,
                last_context_pct: row.get::<_, i32>(8)? as u8,
                last_stop_reason: row.get(9)?,
                last_tool: row.get(10)?,
                active_subagents: row.get::<_, i32>(11)? as u32,
                last_activity_at: row.get(12)?,
                tool_counts: Vec::new(),
                context_trend: None,
            })
        },
    ).ok()?;

    // Load tool counts.
    let mut data = row;
    if let Ok(mut stmt) = conn.prepare(
        "SELECT tool_name, call_count FROM tool_usage
         WHERE session_id = ?1 ORDER BY call_count DESC LIMIT 10",
    ) {
        if let Ok(rows) = stmt.query_map([session_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)? as u32))
        }) {
            data.tool_counts = rows.filter_map(|r| r.ok()).collect();
        }
    }

    // Compute context trend from last 5 history entries.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT context_pct FROM context_history
         WHERE session_id = ?1 ORDER BY seq DESC LIMIT 5",
    ) {
        if let Ok(rows) = stmt.query_map([session_id], |r| r.get::<_, i32>(0)) {
            let pcts: Vec<i32> = rows.filter_map(|r| r.ok()).collect();
            if pcts.len() >= 2 {
                let newest = pcts[0];
                let oldest = pcts[pcts.len() - 1];
                let diff = newest - oldest;
                data.context_trend = Some(if diff > 5 {
                    "rising".to_string()
                } else if diff < -5 {
                    "falling".to_string()
                } else {
                    "stable".to_string()
                });
            }
        }
    }

    Some(data)
}

fn now_utc() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("1970-01-01T00:00:00Z+{}s", duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsonl::{AssistantMessage, ContentBlock, JsonlEntry, TokenUsage};

    fn open_test_cache() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "on").unwrap();
        init_cache_schema(&conn).unwrap();
        conn
    }

    fn make_user_entry(session_id: &str) -> JsonlEntry {
        JsonlEntry {
            entry_type: "user".to_string(),
            session_id: Some(session_id.to_string()),
            timestamp: None,
            is_sidechain: None,
            parent_tool_use_id: None,
            is_compact_summary: None,
            message: None,
            data: None,
        }
    }

    fn make_assistant_entry(session_id: &str, input_tokens: u64, tool: Option<&str>) -> JsonlEntry {
        JsonlEntry {
            entry_type: "assistant".to_string(),
            session_id: Some(session_id.to_string()),
            timestamp: Some("2026-03-24T20:00:00Z".to_string()),
            is_sidechain: None,
            parent_tool_use_id: None,
            is_compact_summary: None,
            message: Some(AssistantMessage {
                model: Some("claude-opus-4-6".to_string()),
                usage: Some(TokenUsage {
                    input_tokens,
                    output_tokens: 100,
                    cache_read_input_tokens: Some(0),
                    cache_creation_input_tokens: Some(0),
                }),
                stop_reason: Some("end_turn".to_string()),
                content: tool.map(|t| vec![ContentBlock {
                    block_type: "tool_use".to_string(),
                    name: Some(t.to_string()),
                    id: Some("tu_1".to_string()),
                }]),
            }),
            data: None,
        }
    }

    #[test]
    fn ingest_counts_turns() {
        let conn = open_test_cache();
        let entries = vec![
            make_user_entry("s1"),
            make_assistant_entry("s1", 1000, None),
            make_user_entry("s1"),
            make_assistant_entry("s1", 2000, Some("Edit")),
        ];

        ingest_new_entries(&conn, "/test.jsonl", "/workspaces/lace", &entries).unwrap();

        let data = read_session_summary(&conn, "s1").unwrap();
        assert_eq!(data.user_turns, 2);
        assert_eq!(data.assistant_turns, 2);
        assert_eq!(data.model.as_deref(), Some("claude-opus-4-6"));
    }

    #[test]
    fn ingest_tracks_tool_usage() {
        let conn = open_test_cache();
        let entries = vec![
            make_user_entry("s1"),
            make_assistant_entry("s1", 1000, Some("Read")),
            make_assistant_entry("s1", 1000, Some("Edit")),
            make_assistant_entry("s1", 1000, Some("Read")),
        ];

        ingest_new_entries(&conn, "/test.jsonl", "/workspaces/lace", &entries).unwrap();

        let data = read_session_summary(&conn, "s1").unwrap();
        assert_eq!(data.tool_counts.len(), 2);
        let read_count = data.tool_counts.iter().find(|(name, _)| name == "Read");
        assert_eq!(read_count.map(|(_, c)| *c), Some(2));
        let edit_count = data.tool_counts.iter().find(|(name, _)| name == "Edit");
        assert_eq!(edit_count.map(|(_, c)| *c), Some(1));
    }

    #[test]
    fn ingest_records_context_history() {
        let conn = open_test_cache();
        let entries = vec![
            make_assistant_entry("s1", 100_000, None),
            make_assistant_entry("s1", 150_000, None),
        ];

        ingest_new_entries(&conn, "/test.jsonl", "/workspaces/lace", &entries).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM context_history WHERE session_id = 's1'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn ingest_skips_compact_summaries() {
        let conn = open_test_cache();
        let mut compact_entry = make_user_entry("s1");
        compact_entry.is_compact_summary = Some(true);

        let entries = vec![
            make_user_entry("s1"),
            compact_entry,
            make_assistant_entry("s1", 1000, None),
        ];

        ingest_new_entries(&conn, "/test.jsonl", "/workspaces/lace", &entries).unwrap();

        let data = read_session_summary(&conn, "s1").unwrap();
        // Compact summary user entry should be skipped.
        assert_eq!(data.user_turns, 1);
        assert_eq!(data.assistant_turns, 1);
    }

    #[test]
    fn ingest_incremental_accumulates() {
        let conn = open_test_cache();

        // First batch.
        let batch1 = vec![make_user_entry("s1"), make_assistant_entry("s1", 1000, None)];
        ingest_new_entries(&conn, "/test.jsonl", "/workspaces/lace", &batch1).unwrap();

        // Second batch.
        let batch2 = vec![make_user_entry("s1"), make_assistant_entry("s1", 2000, Some("Bash"))];
        ingest_new_entries(&conn, "/test.jsonl", "/workspaces/lace", &batch2).unwrap();

        let data = read_session_summary(&conn, "s1").unwrap();
        assert_eq!(data.user_turns, 2);
        assert_eq!(data.assistant_turns, 2);
    }

    #[test]
    fn schema_idempotent() {
        let conn = open_test_cache();
        // Second call should not error.
        init_cache_schema(&conn).unwrap();
    }
}
