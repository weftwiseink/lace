---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T16:00:00-07:00
task_list: terminal-management/sprack-layout-organization
type: proposal
state: live
status: wip
tags: [sprack, tui, tmux, layout, metadata]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T16:30:00-07:00
  round: 1
---

# sprack Layout Organization

> BLUF(opus/sprack-layout-organization): Panes should be sorted by `(pane_top, pane_left)` to match visual layout, and the format string should expand from 12 to 19 fields to capture spatial coordinates and richer metadata.
> This is a simple coordinate sort, not overlap-based row grouping or layout string parsing.
> The schema gains 6 pane columns and 1 window column, with `user_version` pragma for forward-compatible migration.
> The poller and TUI must be updated in lockstep (clean-break versioning).

## Objective

1. **Spatial ordering:** Panes within a window display in their visual arrangement (top-to-bottom, left-to-right) rather than by tmux creation index.
2. **Exhaustive metadata:** Each tree node shows comprehensive metadata following tmux `choose-tree` conventions, with tier-aware density.
3. **Schema extension:** The DB captures spatial coordinates and additional pane/window fields needed for ordering and display.

## Design Decisions

### Spatial Sorting: Simple `(pane_top, pane_left)` Sort

Sort panes by `(pane_top, pane_left)` as a two-key lexicographic sort.
No explicit row grouping, no overlap analysis, no layout string parsing.

**Why this works for 95% of layouts:**
- Equal splits produce panes with identical `pane_top` values per visual row.
- Uneven splits (one tall pane spanning multiple "rows") still sort sensibly: the tall pane appears at its top-edge position, before any panes below it.
- The only case where this produces debatable ordering is when a tall left pane spans two stacked right panes. The tall pane sorts with the first right pane (they share `pane_top=0`), and the second right pane sorts after. This matches left-to-right, top-to-bottom reading order, which is the most natural interpretation.

**Why not overlap-based row grouping:**
- Adds complexity for a marginal gain in edge cases.
- Requires defining an overlap threshold (what percentage of vertical overlap constitutes "same row").
- A tall pane that spans 3 visual rows has no correct single-row assignment.
- The simple sort produces the same result as grouping for all regular grid layouts.

**Why not layout string parsing:**
- The `window_layout` format is undocumented beyond tmux source code.
- Parsing produces a binary split tree that still needs flattening into a linear order, arriving at the same result as coordinate sorting.
- The layout string is stored for future use (window-level metadata display) but not parsed for ordering.

### DB Migration: `user_version` Pragma

Use SQLite's `PRAGMA user_version` to track schema versions.
On startup, `init_schema` checks `user_version`:

- **Version 0 (current):** Schema has no spatial columns. Drop all tables and recreate at version 1.
- **Version 1 (this proposal):** Schema includes spatial columns.
- **Future versions:** `ALTER TABLE ADD COLUMN` for additive changes, or drop-and-recreate for breaking changes.

This is a lightweight approach that avoids a full migration framework while preventing silent schema mismatches.
The drop-and-recreate for v0-to-v1 is acceptable because sprack-db is ephemeral state (repopulated every poll cycle).

### Backward Compatibility: Clean Break

The poller and TUI must match versions.
The format string field count changes from 12 to 19, which means old pollers produce lines the new parser rejects, and new pollers produce lines old parsers reject.

**Why a clean break is acceptable:**
- sprack is a monorepo with a single `cargo build` producing all binaries.
- The poller is a daemon started by the TUI; version skew requires deliberate effort.
- Adding variable field count parsing (accepting 12 or 19 fields) introduces maintenance burden for a scenario that does not occur in practice.

### Performance: Negligible Impact

Adding 7 fields to the format string increases per-line output by approximately 60% in character count.
For a typical environment with 10-30 panes polled every 1-2 seconds:

- **Parsing:** ~30 extra `split("||")` segments and integer parses per cycle. Measured in microseconds.
- **DB writes:** 6 additional integer columns per pane INSERT, 1 TEXT column per window INSERT. SQLite handles this trivially.
- **Hashing:** The raw output string is slightly longer. `DefaultHasher` throughput is gigabytes/second.
- **Memory:** ~48 bytes additional per pane struct (6 `Option<u32>` fields). Negligible for dozens of panes.

No benchmarking is needed. The bottleneck is the `tmux list-panes` subprocess spawn, not parsing or DB writes.

## Format String Extension

Current format string (12 fields):

```
#{session_name}||#{session_attached}||#{window_index}||#{window_name}||
#{window_active}||#{pane_id}||#{pane_title}||#{pane_current_command}||
#{pane_current_path}||#{pane_pid}||#{pane_active}||#{pane_dead}
```

Extended format string (19 fields):

```
#{session_name}||#{session_attached}||#{window_index}||#{window_name}||
#{window_active}||#{pane_id}||#{pane_title}||#{pane_current_command}||
#{pane_current_path}||#{pane_pid}||#{pane_active}||#{pane_dead}||
#{pane_width}||#{pane_height}||#{pane_left}||#{pane_top}||
#{pane_index}||#{pane_in_mode}||#{window_layout}
```

New fields (indices 12-18):

| Index | Variable | Type | Purpose |
|-------|----------|------|---------|
| 12 | `pane_width` | integer | Pane width in columns, for dimension display |
| 13 | `pane_height` | integer | Pane height in rows, for dimension display |
| 14 | `pane_left` | integer | X coordinate of left edge, for spatial sort |
| 15 | `pane_top` | integer | Y coordinate of top edge, for spatial sort |
| 16 | `pane_index` | integer | Pane index within window, for display |
| 17 | `pane_in_mode` | boolean | Copy/scroll mode indicator |
| 18 | `window_layout` | string | Layout string, stored for window metadata |

> NOTE(opus/sprack-layout-organization): `window_layout` appears on every pane line in `list-panes -a` output since it is a window-level variable.
> Deduplication happens naturally during `build_snapshot` which groups lines by session+window.

## Schema Changes

### Pane Table: 6 New Columns

```sql
ALTER TABLE panes ADD COLUMN pane_width    INTEGER;
ALTER TABLE panes ADD COLUMN pane_height   INTEGER;
ALTER TABLE panes ADD COLUMN pane_left     INTEGER;
ALTER TABLE panes ADD COLUMN pane_top      INTEGER;
ALTER TABLE panes ADD COLUMN pane_index    INTEGER;
ALTER TABLE panes ADD COLUMN pane_in_mode  INTEGER NOT NULL DEFAULT 0;
```

### Window Table: 1 New Column

```sql
ALTER TABLE windows ADD COLUMN layout TEXT NOT NULL DEFAULT '';
```

### Full Schema (Version 1)

The complete `SCHEMA_SQL` after modification:

```sql
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
    pane_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'idle',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (pane_id, kind),
    FOREIGN KEY (pane_id) REFERENCES panes(pane_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poller_heartbeat (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at TEXT NOT NULL
);
```

### Migration Logic in `init_schema`

```rust
pub fn init_schema(conn: &Connection) -> Result<(), SprackDbError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    match version {
        0 => {
            // Fresh DB or pre-versioning schema. Drop and recreate.
            conn.execute_batch("
                DROP TABLE IF EXISTS process_integrations;
                DROP TABLE IF EXISTS panes;
                DROP TABLE IF EXISTS windows;
                DROP TABLE IF EXISTS sessions;
                DROP TABLE IF EXISTS poller_heartbeat;
            ")?;
            conn.execute_batch(SCHEMA_SQL)?;
        }
        1 => {
            // Current version. No-op.
        }
        other => {
            return Err(SprackDbError::UnsupportedSchemaVersion(other));
        }
    }
    Ok(())
}
```

## Spatial Sorting Algorithm

Sorting is applied in two complementary locations:
1. **DB query level:** `read_panes` in `read.rs` changes its `ORDER BY` clause from `pane_id` to `pane_top, pane_left, pane_id` so that panes arrive pre-sorted for all consumers.
2. **In-memory fallback:** `panes_for_window` in `tree.rs` applies the same sort as a defensive measure, ensuring correct order even if panes are filtered or combined from multiple queries.

### Rust Pseudocode

```rust
fn panes_for_window<'a>(
    session_name: &str,
    window_index: i32,
    panes: &'a [Pane],
) -> Vec<&'a Pane> {
    let mut matched: Vec<&Pane> = panes
        .iter()
        .filter(|p| p.session_name == session_name && p.window_index == window_index)
        .collect();

    matched.sort_by(|a, b| {
        let top_cmp = a.pane_top.cmp(&b.pane_top);
        if top_cmp != std::cmp::Ordering::Equal {
            return top_cmp;
        }
        a.pane_left.cmp(&b.pane_left)
    });

    matched
}
```

> NOTE(opus/sprack-layout-organization): `pane_top` and `pane_left` are `Option<u32>` in the Pane struct.
> Panes with `None` coordinates (should not occur in practice) sort to the beginning via `Option`'s natural ordering.

### Sort Examples

**2x2 grid (equal splits):**

```
Input (creation order): A(%0, top=0, left=0), B(%1, top=0, left=80),
                         C(%2, top=25, left=0), D(%3, top=25, left=80)
Sort key:                (0,0), (0,80), (25,0), (25,80)
Output:                  A, B, C, D
```

**Tall left pane + 2 stacked right:**

```
Input: A(%0, top=0, left=0, 79x48), B(%1, top=0, left=80, 79x24),
       C(%2, top=25, left=80, 79x23)
Sort key: (0,0), (0,80), (25,80)
Output:  A, B, C
```

This reads as: "main pane, top-right, bottom-right," which matches visual scanning order.

**3 horizontal splits (stacked):**

```
Input: A(%0, top=0, left=0), B(%1, top=16, left=0), C(%2, top=33, left=0)
Sort key: (0,0), (16,0), (33,0)
Output:  A, B, C
```

## Metadata Display

### Pane Node Display by Tier

The `{status}` field in all tiers refers to the integration-derived status indicator (from `process_integrations`).
At Compact tier it renders as a single-character icon (e.g., `*`); at Standard and above it renders as a text badge (e.g., `THINKING`).
This is existing behavior for Compact; Standard and above gain new fields.

| Tier | Format | Change | Example |
|------|--------|--------|---------|
| Compact | `{status_icon} {command}` | Unchanged | `* nvim` |
| Standard | `{command} [{dims}] {status_badge}` | **New:** dimensions | `nvim [80x24] THINKING` |
| Wide | `{command} [{dims}] {path} {status_badge}` | **New:** dimensions, path | `nvim [80x24] ~/code THINKING` |
| Full | `{title_or_cmd} ({command}) [{dims}] pid:{pid} {path} {status_badge}` | **New:** dimensions, PID, title, path | `editor (nvim) [80x24] pid:1234 ~/code THINKING` |

Fields shown per tier:

- **Compact (unchanged):** Process name (truncated), status icon from integration.
- **Standard (changed):** Process name, dimensions (`WxH`), status badge. Dimensions are the key new addition.
- **Wide (changed):** Process name, dimensions, truncated working directory path, status badge.
- **Full (changed):** Pane title (if non-default, otherwise process name), process name in parens, dimensions, PID, working directory, status badge.

Active/mode indicators (new):
- Active pane: `*` prefix (all tiers).
- Copy mode: `[copy]` suffix (Standard and above). Requires `pane_in_mode` field.

> NOTE(opus/sprack-layout-organization): Title suppression follows tmux `choose-tree` convention: title is only shown when it differs from the hostname or is non-empty/non-default.

### Window Node Display by Tier

| Tier | Format | Example |
|------|--------|---------|
| Compact | `{name}` | `editor` |
| Standard | `{name} ({pane_count} panes)` | `editor (4 panes)` |
| Wide | `{name} ({pane_count} panes) {flags}` | `editor (4 panes) [Z]` |
| Full | `{name} ({pane_count} panes) {flags}` | `editor (4 panes) [Z]` |

Window flags:
- `*`: Active window in its session (derived from existing `active` column).
- `Z`: A pane is zoomed.

> NOTE(opus/sprack-layout-organization): The `[Z]` zoom flag requires `window_zoomed_flag` from tmux, which is not captured in this proposal's format string.
> Zoom detection is deferred to a follow-up. The flag column placeholder is included in the display spec for completeness.

The `layout` column is stored but not parsed for display in this proposal.
A future iteration could derive a summary like "2x2 grid" or "H-split" from the layout string.

### Session Node Display by Tier

| Tier | Format | Example |
|------|--------|---------|
| Compact | `{name}` | `dev` |
| Standard | `{name} ({window_count}w)` | `dev (3w)` |
| Wide | `{name} ({window_count}w) {status}` | `dev (3w) attached` |
| Full | `{name} ({window_count}w) {port} {status}` | `dev (3w) :2222 attached` |

## Type Changes

### `sprack-poll` Types

```rust
pub struct TmuxPane {
    pub pane_id: String,
    pub title: String,
    pub current_command: String,
    pub current_path: String,
    pub pane_pid: u32,
    pub active: bool,
    pub dead: bool,
    // New fields:
    pub pane_width: u32,
    pub pane_height: u32,
    pub pane_left: u32,
    pub pane_top: u32,
    pub pane_index: u32,
    pub in_mode: bool,
}

pub struct TmuxWindow {
    pub window_index: u32,
    pub name: String,
    pub active: bool,
    pub panes: Vec<TmuxPane>,
    // New field:
    pub layout: String,
}
```

### `sprack-db` Types

```rust
pub struct Pane {
    pub pane_id: String,
    pub session_name: String,
    pub window_index: i32,
    pub title: String,
    pub current_command: String,
    pub current_path: String,
    pub pane_pid: Option<u32>,
    pub active: bool,
    pub dead: bool,
    // New fields:
    pub pane_width: Option<u32>,
    pub pane_height: Option<u32>,
    pub pane_left: Option<u32>,
    pub pane_top: Option<u32>,
    pub pane_index: Option<u32>,
    pub in_mode: bool,
}

pub struct Window {
    pub session_name: String,
    pub window_index: i32,
    pub name: String,
    pub active: bool,
    // New field:
    pub layout: String,
}
```

> NOTE(opus/sprack-layout-organization): New spatial fields on `Pane` are `Option<u32>` rather than `u32` to match the nullable DB columns and allow for graceful handling if tmux ever returns empty values.
> `in_mode` is `bool` (non-nullable, defaults to false) because the tmux variable always returns 0 or 1.

### `sprack-db` Error Type

The `SprackDbError` enum gains a variant for schema version mismatches:

```rust
#[derive(Debug, thiserror::Error)]
pub enum SprackDbError {
    // ... existing variants ...

    /// Database schema version is newer than this binary supports.
    #[error("Unsupported schema version {0}: rebuild all sprack binaries")]
    UnsupportedSchemaVersion(i32),
}
```

## Ordering Constraint: tmux IPC Migration

> NOTE(opus/sprack-layout-organization): This proposal and the [tmux IPC migration](2026-03-24-sprack-tmux-ipc-migration.md) both modify the tmux interaction layer.
> Layout organization extends the format string from 12 to 19 fields.
> The IPC migration replaces format string parsing with tmux-interface-rs.
> Recommended order: layout organization first (extends the existing format string), then IPC migration (migrates all 19 fields to tmux-interface-rs).
> If the IPC migration lands first, the format string extension becomes a tmux-interface-rs field addition instead.
> The two proposals must not be implemented in parallel on the same code.

## Implementation Phases

### Phase 1: Data Pipeline (sprack-poll, sprack-db)

1. Extend `TMUX_FORMAT` to 19 fields and update `EXPECTED_FIELD_COUNT`.
2. Add new fields to `ParsedLine`, `TmuxPane`, `TmuxWindow`.
3. Update `parse_single_line` to extract new fields at indices 12-18.
4. Update `build_snapshot` to propagate `layout` to `TmuxWindow`.
5. Extend `sprack-db` types (`Pane`, `Window`) with new fields.
6. Update `SCHEMA_SQL` to version 1 schema with new columns.
7. Implement `user_version` check in `init_schema`.
8. Update `insert_panes` and `insert_windows` SQL to include new columns.
9. Update `read_panes` and `read_windows` to read new columns.
10. Update `to_db_types` mapping in `tmux.rs`.
11. Update all existing tests, add new tests for spatial field parsing.

### Phase 2: Spatial Sorting (sprack TUI)

1. Change `panes_for_window` in `tree.rs` to sort by `(pane_top, pane_left)`.
2. Add tests verifying sort order for: equal grid, uneven splits, single pane, all-same-top.

### Phase 3: Metadata Display (sprack TUI)

1. Update `format_pane_label` to include dimensions at Standard tier and above.
2. Update `format_pane_label` to include path at Wide tier and above.
3. Update `format_pane_label` to include PID and title at Full tier.
4. Update `format_window_label` to include pane count at Standard tier and above.
5. Update `format_session_label` to include window count.
6. Add active/mode indicators to pane labels.
7. Update tests for new label formats.

## Test Plan

### Unit Tests

- **Parse 19-field lines:** Verify all new fields are correctly extracted from format output.
- **Reject 12-field lines:** Confirm old-format lines are rejected (clean break).
- **Spatial sort ordering:** Test `panes_for_window` with various layouts:
  - 2x2 equal grid.
  - Tall left + stacked right.
  - 3 horizontal stacks.
  - Single pane (trivial case).
  - All panes at same `pane_top` (pure left-to-right sort).
- **Schema migration:** Test `init_schema` with `user_version = 0` (drop and recreate), `user_version = 1` (no-op), and unknown version (error).
- **Pane label formatting:** Test each tier produces expected output with new fields.
- **Window label formatting:** Test pane count display.
- **`to_db_types` mapping:** Verify new fields propagate from `TmuxPane`/`TmuxWindow` to `Pane`/`Window`.

### Integration Tests

- **Round-trip test:** Write a snapshot with spatial fields to the DB via `write_tmux_state`, read it back via `read_full_state`, and verify all fields match.
- **Sort-after-read:** Read panes from DB, sort by `(pane_top, pane_left)`, verify order matches expected visual layout.

### Manual Verification

- Run the TUI against a live tmux server with various pane layouts.
- Verify pane ordering in the tree matches the visual layout.
- Verify metadata density changes correctly across terminal widths (Compact, Standard, Wide, Full breakpoints).

## Open Risks

1. **`window_layout` field may contain `||`:** The layout string uses `{`, `}`, `[`, `]`, `,` as delimiters, not `||`. Visual inspection of tmux source confirms `||` cannot appear in layout strings. Low risk.
2. **tmux version differences:** Spatial format variables (`pane_left`, `pane_top`, etc.) have been stable since tmux 2.1 (2015). The minimum tmux version sprack targets should be documented.
3. **User expectation mismatch:** Users with complex nested split layouts may have different mental models of "correct" ordering. The `(pane_top, pane_left)` sort matches reading order, which is the most common expectation, but is not the only valid interpretation.
4. **Schema version error UX:** If a user somehow runs a newer poller with an older TUI (or vice versa), the `UnsupportedSchemaVersion` error needs a clear message directing the user to rebuild all binaries.
