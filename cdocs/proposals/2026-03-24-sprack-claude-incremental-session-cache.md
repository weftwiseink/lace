---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T16:00:00-07:00
task_list: terminal-management/sprack-claude-session-cache
type: proposal
state: live
status: wip
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:00:00-07:00
  round: 1
tags: [sprack, claude_code, sqlite, session_files, incremental]
---

# Sprack-Claude Incremental Session Cache

> BLUF: sprack-claude's tail-reading approach discards session history on every poll cycle, producing unreliable summaries that miss conversation structure, cumulative tool usage, and context trends.
> This proposal adds a lightweight SQLite session cache that ingests JSONL incrementally via byte-offset tracking, storing only the aggregated metadata sprack-claude needs for richer status display.
> The cache is not a full mirror: it stores counters, timestamps, and relationship edges, not message content.
> The schema is designed to grow toward the full mirror RFP without migration breakage.

## Relationship to the Full Mirror RFP

The [Claude Code SQLite Mirror RFP](2026-03-24-claude-code-sqlite-mirror.md) proposes a full-fidelity ingestion of all JSONL data: every message, every content block, full text, FTS5 search, session replay.
That is the right long-term target but wrong next step.

This proposal implements the subset the mirror RFP calls "intermediate layer for sprack-claude":

| Full Mirror RFP | This Proposal |
|---|---|
| All messages stored with raw JSON | No message content stored |
| Content blocks with text | Tool name counters only |
| FTS5 full-text search | Not included |
| Session replay | Not included |
| Token usage per message | Cumulative token usage per session |
| Subagent session tree | Flat subagent tracking (parent tool use ID, status) |
| Standalone daemon | Integrated into sprack-claude's existing poll loop |

The full mirror can later wrap this cache's `ingestion_state` table to avoid re-parsing bytes that were already ingested.
The `session_metadata` table becomes a seed for the mirror's `sessions` table.

## Objective

After this work, sprack-claude gains:

1. **Conversation turn count**: how many user/assistant exchanges have occurred, visible in the TUI.
2. **Cumulative tool usage**: total tool calls and per-tool breakdown across the session, not just the last tool.
3. **Context usage history**: context % at each assistant message, enabling trend display (rising/falling/stable).
4. **Reliable session detection without /proc**: session file discovery via workspace path from pane metadata, eliminating the `/proc` dependency for container panes.
5. **Subagent lifecycle tracking**: which subagents were spawned, whether they are still active or completed.
6. **Faster polling**: byte-offset tracking avoids re-reading unchanged bytes, and the cache persists across sprack-claude restarts.

## Schema Design

A separate `session-cache.db` file at `~/.local/share/sprack/session-cache.db`.

> NOTE(opus/sprack-claude-session-cache): A separate database avoids bloating `state.db` with historical session data.
> `state.db` is optimized for fast reads by the TUI on every render frame.
> The session cache is written every poll cycle but read only by sprack-claude itself.

### `ingestion_state`

Tracks per-file read position for incremental ingestion.

```sql
CREATE TABLE IF NOT EXISTS ingestion_state (
    file_path       TEXT PRIMARY KEY,
    byte_offset     INTEGER NOT NULL DEFAULT 0,
    file_size       INTEGER NOT NULL DEFAULT 0,
    last_modified   TEXT NOT NULL,
    session_id      TEXT,
    updated_at      TEXT NOT NULL
);
```

- `file_path`: absolute path to the JSONL session file.
- `byte_offset`: last successfully parsed byte position.
- `file_size`: file size at last read, used to detect rotation (file shrank).
- `last_modified`: ISO 8601 mtime, used to skip unchanged files.
- `session_id`: the session UUID extracted from entries in this file (nullable because it may not be known until the first entry is parsed).

### `session_metadata`

Aggregated session-level data, updated incrementally as new entries arrive.

```sql
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
```

- Turn counts and token totals are monotonically incremented as new entries are parsed.
- `last_context_pct`, `last_stop_reason`, `last_tool` replace the tail-read-derived values.
- `is_active` is set to 0 when no new bytes appear for a configurable staleness threshold.

### `tool_usage`

Per-session tool call counts.

```sql
CREATE TABLE IF NOT EXISTS tool_usage (
    session_id  TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    call_count  INTEGER NOT NULL DEFAULT 0,
    last_used   TEXT NOT NULL,
    PRIMARY KEY (session_id, tool_name),
    FOREIGN KEY (session_id) REFERENCES session_metadata(session_id)
);
```

This enables "Read: 47, Edit: 12, Bash: 8" style summaries in the TUI.

### `context_history`

Sampled context usage over time for trend display.

```sql
CREATE TABLE IF NOT EXISTS context_history (
    session_id      TEXT NOT NULL,
    seq             INTEGER NOT NULL,
    recorded_at     TEXT NOT NULL,
    context_pct     INTEGER NOT NULL,
    input_tokens    INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq),
    FOREIGN KEY (session_id) REFERENCES session_metadata(session_id)
);
```

- `seq` is a monotonically increasing integer per session, assigned during ingestion. This avoids ordering ambiguity when two assistant messages share the same timestamp second.
- One row per assistant message that reports token usage.
- The TUI can query the last N rows to render a sparkline or trend indicator (e.g., arrow up/down/flat).

> NOTE(opus/sprack-claude-session-cache): Storing one row per assistant message could grow large for very long sessions (hundreds of turns).
> A compaction strategy (keep only every Nth row for entries older than 1 hour) can be added later if needed.
> For now, the expected scale is manageable: a 200-turn session produces 200 rows at ~50 bytes each.

### `subagent_tracking`

Minimal subagent relationship data.

```sql
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
```

- Rows are created from `agent_progress` entries and sidechain assistant entries.
- `is_complete` is set to 1 when the corresponding tool result appears in the parent session's entries.
- `last_seen_at` updates on each `agent_progress` event, enabling the TUI to show subagent staleness.

## Incremental Reading

The core improvement over current behavior: byte-offset tracking persisted in SQLite.

### Current approach

```
poll cycle:
  open file
  seek to (file_size - 32KB)
  read to end
  parse all lines
  discard on next cycle
```

Problems: re-reads the same 32KB every cycle, loses all history beyond the tail window, restarts from scratch on process restart.

### Cache approach

```
poll cycle:
  read ingestion_state for file_path
  if file_size < stored byte_offset: rotation detected, reset to 0
  if file mtime == stored last_modified: skip (no changes)
  open file, seek to byte_offset
  read new bytes
  parse lines, update session_metadata/tool_usage/context_history/subagent_tracking
  update ingestion_state with new byte_offset
```

Key behaviors:
- Rotation detection: if the file shrinks, reset `byte_offset` to 0 and re-ingest. Also clear the session's accumulated counters since the file was replaced.
- Mtime short-circuit: skip files whose mtime has not changed since last read. This is the common case for idle sessions and saves the file open/seek/read syscalls entirely.
- First-read bootstrap: on first encounter of a file, do a full read (not tail-only) to get accurate turn counts and token totals. This is a one-time cost per session file.
- Compact summary skip: entries with `isCompactSummary: true` are skipped, matching the full mirror RFP's approach. This requires adding an `is_compact_summary: Option<bool>` field (with `#[serde(rename = "isCompactSummary", default)]`) to the `JsonlEntry` struct in `jsonl.rs`. The ingestion pipeline filters these entries before updating counters: `entries.iter().filter(|e| !e.is_compact_summary.unwrap_or(false))`. This filtering is a phase 1 requirement because compact summaries re-state earlier messages and would double-count turns and tokens without it.

> WARN(opus/sprack-claude-session-cache): First-read bootstrap of a large session file (10MB+) could introduce a one-time latency spike.
> This is acceptable because it happens once per session file, and the parsed data is immediately cached.
> If it becomes a problem, the bootstrap can be deferred to a background thread.
> Multiple panes discovering large session files simultaneously could compound the cost: e.g., 4 panes with 10MB files would block the poll cycle for 400ms-2s.
> Phase 1 should measure bootstrap latency and decide whether async/threaded bootstrap is needed before phase 2.

## Session Discovery Without /proc

The current `/proc`-based approach (`proc_walk.rs`) fails for container panes because:
1. The Claude Code process runs in a different PID namespace.
2. `current_command` shows `ssh` instead of `claude`.

The session cache benefits from an alternative discovery path that does not require `/proc` at all.

### Deference to Process Host Awareness

> NOTE(opus/sprack-claude-session-cache): The [process host awareness proposal](2026-03-24-sprack-process-host-awareness.md) defines the full `PaneResolver` trait with `LaceContainerResolver` for container pane session discovery.
> This proposal does not re-implement that logic.
> The session cache consumes whatever session file path the resolver provides, regardless of whether it came from `/proc` walking (local panes) or bind-mount enumeration (container panes).
> The integration point is: the resolver returns a `ResolvedSession { session_file: PathBuf, ... }`, and the session cache's `incremental_ingest()` accepts that path.

For local panes (no lace metadata, `current_command` contains "claude"):

1. Use `pane.current_path` directly as the cwd.
2. Encode and resolve via `LocalResolver` (existing `/proc` walk + path encoding).
3. Pass the resolved session file path to `incremental_ingest()`.

For container panes (lace metadata present):

1. Use `LaceContainerResolver` from the process host awareness proposal.
2. Pass the resolved session file path to `incremental_ingest()`.

The session cache is agnostic to how the session file was discovered.

### Pane-to-session association

The `ingestion_state.file_path` and `session_metadata.file_path` columns link a session to its JSONL file.
The pane-to-session mapping is established at resolution time and cached in the existing in-memory `session_cache` HashMap.
The SQLite cache stores session-level data; the pane-to-session association remains in-memory and is re-established on restart by matching `pane.current_path` against `session_metadata.project_path`.

## Subagent Tracking

Subagent data comes from two sources in the JSONL stream:

1. **`agent_progress` entries**: `{type: "progress", data: {type: "agent_progress", toolUseID: "..."}}`
   - Create or update a `subagent_tracking` row.
   - Update `last_seen_at`.
   - Update `session_metadata.active_subagents` count.

2. **Sidechain assistant entries**: `{type: "assistant", isSidechain: true, parentToolUseID: "..."}`
   - Create or update a `subagent_tracking` row using `parentToolUseID`.
   - These entries confirm the subagent is producing output.

3. **Completion detection**: when a non-sidechain assistant entry contains a tool result for a `tool_use_id` that has a corresponding `subagent_tracking` row, mark that row `is_complete = 1`.

The `active_subagents` count in `session_metadata` is derived: `SELECT COUNT(*) FROM subagent_tracking WHERE session_id = ? AND is_complete = 0`.

> NOTE(opus/sprack-claude-session-cache): Completion detection is imperfect because the tool result may not reference the tool_use_id in a parseable way.
> The current `count_subagents` function in `status.rs` has the same limitation.
> The `is_complete` flag can be refined later; for now, staleness-based heuristics (subagent with no `agent_progress` for 60 seconds) supplement it.

## Integration with sprack-claude Main Loop

The session cache replaces direct JSONL reading but preserves the overall architecture.

### Modified poll cycle

```
run_poll_cycle:
  1. find_claude_panes()              # unchanged
  2. for each pane:
     a. resolve pane to session file  # modified: workspace-path first, /proc fallback
     b. incremental_ingest()          # NEW: read new bytes, update cache DB
     c. build_summary_from_cache()    # modified: read from cache DB instead of in-memory entries
     d. write_integration()           # unchanged
  3. clean_stale_integrations()       # unchanged
```

### ClaudeSummary changes

The `ClaudeSummary` struct gains new fields:

```rust
pub struct ClaudeSummary {
    pub state: String,
    pub model: Option<String>,
    pub subagent_count: u32,
    pub context_percent: u8,
    pub last_tool: Option<String>,
    pub error_message: Option<String>,
    pub last_activity: Option<String>,
    // New fields from session cache:
    pub user_turns: u32,
    pub assistant_turns: u32,
    pub tool_counts: Option<HashMap<String, u32>>,
    pub context_trend: Option<String>,  // "rising", "falling", "stable"
}
```

The `tool_counts` field is optional for backward compatibility with TUI versions that do not yet render it.
The `context_trend` is computed from the last 5 `context_history` rows.

### Module structure

New module: `cache.rs` in sprack-claude, responsible for:
- Opening/creating `session-cache.db`.
- `ingest_new_entries(conn, file_path, entries)`: updates all cache tables from a batch of new `JsonlEntry` values.
- `read_session_summary(conn, session_id) -> CachedSessionData`: reads aggregated data for summary construction.
- Schema initialization (CREATE TABLE statements).

The existing `jsonl.rs` module is preserved: its `incremental_read` function is still used for the actual file reading.
The `status.rs` module's `build_summary` function is modified to accept `CachedSessionData` instead of raw `&[JsonlEntry]`.

## Extensibility Toward Full Mirror

The schema is designed for additive extension:

1. **Message storage**: add a `messages` table with `session_id` FK, `sequence_number`, `role`, `raw_json`. The `ingestion_state` table's byte-offset tracking works identically for full-message ingestion.
2. **Content blocks**: add a `content_blocks` table with `message_id` FK. No existing tables change.
3. **FTS5**: add a virtual table on `messages.raw_json` or `content_blocks.text`. No existing tables change.
4. **Standalone daemon**: the `cache.rs` module's ingestion logic can be extracted into a separate crate. The ingestion functions are pure (take a connection and entries, return nothing) and have no dependency on the poll loop.

No existing columns need renaming or type changes.
The `ingestion_state` table is the critical shared primitive: the full mirror reads the same byte offsets to avoid duplicate work.

> NOTE(opus/sprack-claude-session-cache): Sharing `ingestion_state` between the session cache and the full mirror requires them to reside in the same database file, or for the full mirror to read the session cache's DB directly via ATTACH.
> If the full mirror uses a separate `claude-mirror.db` as the RFP suggests, it would need to either ATTACH `session-cache.db` to read byte offsets, or maintain its own `ingestion_state` table seeded from the session cache's.
> The additive schema extensions (messages, content_blocks, FTS5) should target the full mirror's DB, not `session-cache.db`.

## Separate DB Recommendation

Use a separate `session-cache.db` alongside `state.db`.

Reasons:
- **Write contention**: `state.db` is written by sprack-poll every 2 seconds and read by the TUI on every frame. Adding session cache writes to the same DB increases lock contention under WAL mode.
- **Size trajectory**: `state.db` stays small (dozens of rows). The session cache grows with session count and duration. Mixing them makes backup/rotation awkward.
- **Failure isolation**: a corrupt or locked session cache should not prevent the TUI from rendering pane status from `state.db`.
- **Independent lifecycle**: `state.db` is ephemeral (can be deleted and rebuilt from tmux). The session cache has historical value and should be preserved.

Both databases use WAL mode.
sprack-claude opens two connections: one to `state.db` (existing), one to `session-cache.db` (new).

## Implementation Phases

### Phase 1: Schema and Incremental Ingestion

- Add `cache.rs` module with schema creation and `ingest_new_entries`.
- Add `session-cache.db` creation to the daemon startup.
- Wire `incremental_read` output through `ingest_new_entries` before `build_summary`.
- `build_summary` still reads from in-memory entries (no behavior change yet).
- Tests: ingestion correctness, rotation handling, idempotency.

Deliverable: session cache is populated but not yet consumed. Validates the ingestion pipeline in production.

### Phase 2: Cache-Backed Summaries

- Modify `build_summary` to read from `session-cache.db` via `read_session_summary`.
- Add `user_turns`, `assistant_turns`, `tool_counts`, `context_trend` to `ClaudeSummary`.
- Add workspace-path session resolution as primary strategy, `/proc` as fallback.
- Remove the in-memory `last_entries` cache from `SessionFileState` (the SQLite cache replaces it).
- Tests: summary correctness from cache, workspace-path resolution, fallback behavior.

Deliverable: sprack-claude produces richer summaries from cached data. Container pane resolution works via workspace path.

### Phase 3: Subagent Lifecycle and Context Trends

- Populate `subagent_tracking` table from ingested entries.
- Implement completion detection and staleness heuristics.
- Populate `context_history` and compute `context_trend`.
- TUI integration for new summary fields (separate from this proposal, but the data is available).

Deliverable: full subagent and context trend data available for TUI consumption.

## Test Plan

- **Ingestion correctness**: write known JSONL entries to a temp file, run `ingest_new_entries`, verify `session_metadata` counters match expected values.
- **Incremental behavior**: append entries in stages, verify byte offsets advance correctly and counters accumulate.
- **Rotation handling**: write entries, truncate file, write new entries. Verify `byte_offset` resets and counters re-initialize.
- **Mtime short-circuit**: verify no file I/O occurs when mtime is unchanged.
- **Subagent tracking**: inject `agent_progress` and sidechain entries, verify `subagent_tracking` rows and `active_subagents` count.
- **Context history**: inject assistant entries with varying token usage, verify `context_history` rows and trend computation.
- **Malformed entries**: inject corrupt JSON lines mixed with valid ones, verify graceful skip with correct counters for valid entries.
- **Concurrent access**: verify WAL mode allows sprack-claude to write while a separate connection reads (simulating future analytics queries).
- **Schema migration**: verify `init_schema` is idempotent (safe to call on an existing database).

## Open Risks

1. **First-read cost**: bootstrapping a large session file on first encounter reads the entire file. For a 20MB file with thousands of entries, this could take 100-500ms. Acceptable for a one-time cost, but should be measured.

2. **Session ID discovery**: the `sessionId` field may not appear on every JSONL entry. If the first few entries lack it, the `ingestion_state.session_id` column stays null until one is found. The ingestion logic must handle entries before a session ID is known.

3. **Compact summary entries**: Claude Code injects synthetic `isCompactSummary` entries that re-state earlier messages. These must be detected and skipped to avoid double-counting turns and tokens. The `JsonlEntry` struct requires a new `is_compact_summary` field (see Incremental Reading section for the concrete specification). This is a phase 1 prerequisite.

4. **Multiple sessions per file**: Claude Code's session continuation pattern means a single file may contain entries from multiple session IDs. The current design assumes one session ID per file. If multiple IDs appear, the ingestion should use the most recent one and log a warning.

5. **Container bind mount assumptions**: workspace-path resolution assumes `~/.claude` is bind-mounted into containers. If this assumption breaks (e.g., different mount paths, no mount), the `/proc` fallback must still work for local panes.

6. **TUI backward compatibility**: adding new fields to `ClaudeSummary` requires the TUI to handle their absence gracefully when reading summaries written by an older sprack-claude. The fields are `Option` types, so JSON deserialization handles this, but the TUI rendering code must check.
