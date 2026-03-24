# sprack-db

Shared SQLite library for the sprack ecosystem.
Provides the database schema, WAL-mode connection management, typed query helpers, and shared data types.
All three sprack binaries depend on this crate.
Callers never write raw SQL.

## Key Types

- `Session`, `Window`, `Pane`, `Integration`: row types mapping directly to database tables.
- `ProcessStatus`: enum (`Thinking`, `ToolUse`, `Idle`, `Error`, `Waiting`, `Complete`) with `Display`/`FromStr` for DB round-tripping.
- `DbSnapshot`: complete database state for tree rendering.

## Key Functions

- `open_db(path)`: opens a read-write connection with WAL mode, busy timeout, foreign keys, and schema initialization.
- `open_db_readonly(path)`: opens a read-only connection for the TUI (does not create schema).
- `read::read_full_state(conn)`: reads all sessions, windows, panes, and integrations into a `DbSnapshot`.
- `read::check_data_version(conn)`: returns SQLite's `PRAGMA data_version` for change detection.
- `write::write_tmux_state(conn, sessions, windows, panes)`: replaces all tmux state in a single transaction.
- `write::write_integration(conn, pane_id, kind, summary, status)`: upserts a process integration row.
- `write::write_heartbeat(conn)`: writes the poller heartbeat timestamp.

## Schema

Five tables: `sessions`, `windows`, `panes`, `process_integrations`, `poller_heartbeat`.
Foreign keys enforce the hierarchy with `ON DELETE CASCADE`.
Schema is created idempotently via `CREATE TABLE IF NOT EXISTS`.

Default database location: `~/.local/share/sprack/state.db`.

See the [main sprack README](../../README.md) for full project documentation.
