---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T13:31:14-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: wip
tags: [architecture, sprack, sqlite, rust]
---

# sqlite-watcher: Cross-Process Reactivity Assessment

> BLUF: sqlite-watcher does not support cross-process change detection and cannot be used for the decoupled poller/TUI architecture.
> The crate's README explicitly states this limitation.
> It uses per-connection temporary triggers, which are inherently invisible to other processes.
> The viable alternative for sprack is polling SQLite's `PRAGMA data_version`, which detects cross-process writes with no schema changes and ~50ms polling latency.

## The Question

Sprack's proposed architecture decouples tmux state polling from the ratatui TUI:
a poller process writes to a shared SQLite database, and the TUI reacts to DB changes.
The critical requirement is that the TUI process must detect writes made by the poller process.

## sqlite-watcher: How It Works

**Crate metadata:** v0.7.0, AGPL-3.0-only, ~414k downloads, hosted at [gitlab.com/AngryPixel/sqlite-watcher](https://gitlab.com/AngryPixel/sqlite-watcher).
Supports rusqlite, sqlx, and diesel backends via feature flags.

The change detection mechanism uses **per-connection temporary triggers**, not `sqlite3_update_hook`, not filesystem watching, and not polling.

The implementation:

1. Creates a temporary tracking table per connection: `CREATE TEMP TABLE IF NOT EXISTS rsqlite_watcher_version_tracker (table_id INTEGER PRIMARY KEY, updated INTEGER)`
2. For each observed table, installs temporary triggers on INSERT, UPDATE, and DELETE that set `updated=1` in the tracking table.
3. On `publish_watcher_changes()`, queries the tracking table for `updated=1` rows and dispatches to registered `TableObserver` callbacks via a background thread.
4. Resets the tracking flags after each publish cycle.

A `Watcher` instance coordinates observers through a bounded `flume` channel (capacity 24) to a single background thread named `sqlite_watcher`.

## Why Cross-Process Detection Fails

The crate's lib.rs documentation states:

> "The only limitation of this model is that it only works for connections that inhabit the same process space. While sqlite supports being modified by multiple processes, the current observation does not support this use case."

The reason is structural: `TEMP` tables and `TEMP` triggers exist only within the creating connection.
They are stored in a per-connection temporary database, not in the main database file.
Process B's temporary triggers are never fired by Process A's writes because Process A has its own connection with its own temporary namespace.

This is not a bug or missing feature: it is an inherent consequence of the trigger-based architecture.

## SQLite's Native Cross-Process Primitives

### `sqlite3_update_hook` (not viable)

The C API's `sqlite3_update_hook()` registers a callback for row changes, but it is per-connection only.
From the SQLite docs: "Any callback set by a previous call to this function for the same database connection is overridden."
It cannot detect changes from other connections or processes.

### `PRAGMA data_version` (viable)

This is the SQLite-native mechanism for cross-process change detection.

From the docs: the integer values returned by two invocations of `PRAGMA data_version` from the same connection will be different if changes were committed to the database by **any other connection** in the interim, including connections in separate processes.

Key properties:
- Returns an integer that changes when another connection commits.
- Unchanged by commits on the same connection (only tracks external changes).
- Works across processes and shared-cache connections.
- Values are meaningful only when compared from the same connection at two different times.
- Available in all SQLite versions since 3.12.0 (2016).

Usage pattern in rusqlite:

```rust
let version: i64 = conn.pragma_query_value(None, "data_version", |row| row.get(0))?;
// ... later ...
let new_version: i64 = conn.pragma_query_value(None, "data_version", |row| row.get(0))?;
if new_version != version {
    // Another process modified the database
}
```

## Alternative Approaches for Sprack

### Option 1: `data_version` Polling (recommended)

Poll `PRAGMA data_version` on a timer (e.g., 50-100ms).
When the version changes, re-query the relevant tables.

Advantages:
- Zero schema changes or triggers required.
- Works with any SQLite library (rusqlite, sqlx, diesel).
- Detects all cross-process changes regardless of how they were made.
- Minimal overhead: a single pragma query per poll cycle.
- Composable with ratatui's event loop via `tokio::time::interval` or a dedicated thread.

Disadvantages:
- Polling latency: changes are detected on the next poll cycle, not instantly.
- Does not tell you which tables changed, only that something changed.
- Requires a subsequent query to determine what data is new.

For sprack's use case (tmux state refreshing a TUI sidebar), 50-100ms latency is imperceptible.
The "which tables changed" limitation is irrelevant if the DB has a simple schema (e.g., one `tmux_state` table).

### Option 2: Filesystem Watching via `notify` Crate

Watch the SQLite database file (and WAL file in WAL mode) using the `notify` crate, which uses inotify on Linux.

Advantages:
- Near-instant notification on writes.
- No polling overhead.

Disadvantages:
- SQLite's internal write patterns produce multiple filesystem events per logical transaction (WAL writes, checkpoints, journal files).
- Debouncing is required to avoid spurious refreshes.
- The `notify` crate has known limitations with network filesystems, though this is irrelevant for local-only sprack usage.
- More complex to integrate correctly than a simple pragma poll.

### Option 3: Unix Domain Socket Side-Channel

The poller sends a notification over a Unix domain socket after each DB write.

Advantages:
- Instant notification with semantic content (which tables changed, row counts).
- No polling, no filesystem event noise.

Disadvantages:
- Adds a second IPC channel alongside the database, increasing complexity.
- Must handle socket lifecycle (creation, cleanup, reconnection).
- The database is no longer the single source of truth for synchronization: if the socket message is lost or the TUI restarts, it must fall back to polling or full-table reads anyway.

### Option 4: WAL Mode + `data_version` (recommended enhancement)

Combine `PRAGMA journal_mode=WAL` with `data_version` polling.
WAL mode allows concurrent readers and a single writer without blocking, which is the desired concurrency model for a poller writing and a TUI reading simultaneously.

This is not a separate option from Option 1 but rather the recommended configuration: WAL mode handles the concurrency correctly, and `data_version` handles the change detection.

> NOTE(opus/sprack-tui): WAL mode requires all processes on the same host machine due to shared memory (wal-index).
> This is inherently satisfied for sprack since both the poller and TUI run on the same machine.

## Recommendation

Use `PRAGMA data_version` polling with WAL mode.
This is the simplest correct approach:

1. Both processes open the same SQLite database in WAL mode.
2. The poller writes tmux state on its polling interval.
3. The TUI polls `PRAGMA data_version` at 50-100ms intervals (or on each ratatui tick).
4. When the version changes, the TUI re-reads the state tables and updates the display.

No additional crates are needed beyond rusqlite (or sqlx).
The sqlite-watcher crate is not useful for this architecture and should not be adopted.

> WARN(opus/sprack-tui): sqlite-watcher is licensed AGPL-3.0-only.
> Even if it supported cross-process detection, the AGPL license would require careful evaluation for sprack's distribution model.

## License Consideration

sqlite-watcher uses AGPL-3.0-only, which requires source distribution for any networked use.
The `PRAGMA data_version` approach avoids this concern entirely since it uses only rusqlite (MIT/Apache-2.0) or sqlx (MIT/Apache-2.0).
