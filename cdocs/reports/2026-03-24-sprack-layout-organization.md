---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T14:30:00-07:00
task_list: terminal-management/sprack-layout-organization
type: report
state: live
status: review_ready
tags: [sprack, tui, tmux, layout, metadata]
---

# sprack Layout Organization: Problem Space Analysis

> BLUF: The current tree presents tmux's session/window/pane hierarchy as-is, but this does not match how users think about their spatial layout.
> tmux internally represents pane splits as a binary tree (alternating horizontal and vertical splits), which produces an unintuitive ordering when flattened.
> The user wants organization by "rows, then columns, then recurse" to match the visual layout, plus exhaustive metadata akin to tmux's `choose-tree` display.
> This report analyzes tmux's layout format, the available metadata fields, and options for spatial-aware tree construction.

## 1. The Observed Problem

The current tree shows panes in the order tmux reports them (by pane index within each window).
This ordering reflects creation order, not spatial arrangement.
A user with a 2x2 grid of panes sees them listed top-to-bottom, left-to-right by index, not grouped by their visual row/column relationships.

Additionally, the metadata displayed per node is sparse: process name and a status badge.
tmux's `choose-tree` shows significantly more: dimensions, PID, title, command, path, flags.

## 2. tmux Layout Format

tmux exposes two layout-related format variables:
- `window_layout`: the full layout string (e.g., `bb62,159x48,0,0{79x48,0,0,79x48,80,0}`)
- `window_visible_layout`: same format but for the visible (unzoomed) layout

### Layout String Grammar

The layout string encodes a binary tree of pane splits:

```
layout      = checksum "," dimensions "," x "," y ( leaf | h-split | v-split )
leaf        = "," pane_id
h-split     = "{" layout layout+ "}"
v-split     = "[" layout layout+ "]"
dimensions  = width "x" height
checksum    = 4-hex-digit checksum (e.g., "bb62")
```

Example: `bb62,159x48,0,0{79x48,0,0,79x48,80,0}`

Decoded:
- Root: 159x48 at position (0,0), horizontal split (`{...}`)
- Left child: 79x48 at (0,0), pane 0
- Right child: 79x48 at (80,0), pane 1 (note: x=80, after the left pane's 79 + 1 border)

### Binary Tree Structure

tmux's layout is a strict binary tree: each node is either a leaf (pane) or a split (horizontal `{}` or vertical `[]`) with two or more children.
Nested splits alternate: a horizontal split's children can be vertical splits, and vice versa.

This binary tree structure does not naturally map to "rows and columns" because:
- A 2x2 grid could be represented as either H{V{a,b}, V{c,d}} or V{H{a,c}, H{b,d}}.
- The tree structure depends on the order of splits, not the visual result.
- A user who splits vertically first, then horizontally, gets a different tree than one who splits horizontally first.

## 3. Available Pane Metadata

tmux exposes 34 pane-specific format variables.
The current sprack-poll format string captures 12 fields.
Missing fields that are relevant to layout and metadata display:

### Spatial Fields (Not Currently Captured)

| Variable | Type | Description |
|----------|------|-------------|
| `pane_width` | integer | Pane width in columns |
| `pane_height` | integer | Pane height in rows |
| `pane_left` | integer | X coordinate of pane's left edge |
| `pane_top` | integer | Y coordinate of pane's top edge |
| `pane_right` | integer | X coordinate of pane's right edge |
| `pane_bottom` | integer | Y coordinate of pane's bottom edge |
| `pane_index` | integer | Pane's index within the window |
| `pane_at_left` | boolean | Whether pane is at the leftmost edge |
| `pane_at_right` | boolean | Whether pane is at the rightmost edge |
| `pane_at_top` | boolean | Whether pane is at the topmost edge |
| `pane_at_bottom` | boolean | Whether pane is at the bottommost edge |

### Process/State Fields (Not Currently Captured)

| Variable | Type | Description |
|----------|------|-------------|
| `pane_tty` | string | TTY device path |
| `pane_in_mode` | boolean | Whether pane is in copy/scroll mode |
| `pane_start_command` | string | Command pane was started with |
| `pane_start_path` | string | Path pane was started in |
| `pane_synchronized` | boolean | Whether pane input is synchronized |
| `pane_last` | boolean | Whether this was the previously active pane |
| `pane_marked` | boolean | Whether pane is marked |
| `pane_input_off` | boolean | Whether pane input is disabled |
| `pane_tabs` | string | Tab stop positions |

### Window-Level Layout Fields

| Variable | Type | Description |
|----------|------|-------------|
| `window_layout` | string | Layout description string |
| `window_visible_layout` | string | Visible layout (unzoomed) |
| `window_zoomed_flag` | boolean | Whether a pane is zoomed |

> NOTE(opus/sprack-layout-organization): The total count of tmux format variables is 118, of which 34 are pane-specific.
> sprack-poll captures 12 fields.
> The spatial fields (`pane_width`, `pane_height`, `pane_left`, `pane_top`) are the key additions needed for layout-aware organization.

## 4. "Rows, Then Columns, Then Recurse" Organization

The user wants panes organized to match their visual arrangement: group by row first, then by column within each row.

### Algorithm Using Spatial Coordinates

Given pane coordinates (`pane_left`, `pane_top`, `pane_width`, `pane_height`):

1. Sort panes by `pane_top` (row position).
2. Group panes with the same `pane_top` into rows.
3. Within each row, sort by `pane_left` (column position).

For a 2x2 grid:

```
pane A: left=0,  top=0,  width=79, height=24
pane B: left=80, top=0,  width=79, height=24
pane C: left=0,  top=25, width=79, height=23
pane D: left=80, top=25, width=79, height=23
```

Grouping by `pane_top`:
- Row 0: A (left=0), B (left=80)
- Row 25: C (left=0), D (left=80)

This matches the visual layout regardless of split order.

### Handling Uneven Splits

Panes do not always align into clean rows.
A layout with one tall pane on the left and two stacked panes on the right:

```
pane A: left=0,  top=0,  width=79, height=48
pane B: left=80, top=0,  width=79, height=24
pane C: left=80, top=25, width=79, height=23
```

Naive row grouping by `pane_top`:
- Row 0: A (left=0), B (left=80)
- Row 25: C (left=80)

This partially works: A and B share the top edge.
But A spans the full height, so it conceptually belongs to both "rows."

**Refined approach:** group by overlapping vertical ranges rather than exact `pane_top` values.
Two panes are in the same "visual row" if their vertical ranges overlap significantly.

### Alternative: Parse the Layout String

Instead of using coordinates, parse `window_layout` to extract the split tree structure directly.
This preserves the hierarchical split information and allows rendering like:

```
v editor (2x2 grid)
  H-split
    v-split: claude (80x24) | nu (80x24)
    v-split: logs (80x12) | test (80x12)
```

> WARN(opus/sprack-layout-organization): Parsing the tmux layout string is non-trivial.
> The format is not formally documented beyond the source code.
> Using spatial coordinates is more robust and does not depend on the internal binary tree structure.

## 5. tmux choose-tree Display Analysis

tmux's `choose-tree` default format (from the running server's `tree_mode_format`):

```
#{?pane_format,
  #{pane_current_command}
  #{?pane_active,*,}
  #{?pane_marked,M,}
  #{?#{&&:#{pane_title},#{!=:#{pane_title},#{host_short}}},
    : "#{pane_title}",},
#{?window_format,
  #{window_name}#{window_flags}
  #{?#{&&:#{==:#{window_panes},1},
    #{&&:#{pane_title},#{!=:#{pane_title},#{host_short}}}},
    : "#{pane_title}",},
  #{session_windows} windows
  #{?session_grouped, (group ...),}
  #{?session_attached, (attached),}
}}
```

Key takeaways for sprack's metadata display:

| Node Type | choose-tree Shows | sprack Equivalent |
|-----------|-------------------|-------------------|
| Session | Window count, group info, attached status | Window count, lace port, attached |
| Window | Name, flags, pane count, title (if single-pane) | Name, pane count, active indicator |
| Pane | Command, active marker, title (if non-default) | Command, PID, path, dimensions, status |

choose-tree uses conditional formatting: it shows title only when it differs from the hostname.
sprack should similarly suppress default/uninformative metadata.

## 6. Metadata Display Priorities

Leaning "exhaustive" as the user requested, the metadata per node type:

### Pane Metadata (Ordered by Priority)

1. `current_command` (always shown)
2. Status badge from `process_integrations` (if available)
3. `pane_width` x `pane_height` dimensions
4. `pane_pid` (PID of the shell process)
5. `current_path` (working directory, truncated)
6. `title` (if non-default, i.e., differs from hostname)
7. `pane_tty` (TTY device)
8. Active/last/marked indicators

### Window Metadata

1. `window_name`
2. Pane count
3. Active/zoomed flags
4. Layout summary (e.g., "2x2 grid", "3 stacked", "2 side-by-side")

### Session Metadata

1. `session_name`
2. Window count
3. Attached/detached status
4. `@lace_port` (if lace session)
5. `@lace_workspace` (if lace session)

## 7. Schema and Polling Impact

Adding spatial metadata requires expanding the sprack-poll format string and the sprack-db `panes` table.

### Format String Extension

Current (12 fields):
```
#{session_name}||#{session_attached}||#{window_index}||#{window_name}||
#{window_active}||#{pane_id}||#{pane_title}||#{pane_current_command}||
#{pane_current_path}||#{pane_pid}||#{pane_active}||#{pane_dead}
```

Proposed additions (7 fields, total 19):
```
...||#{pane_width}||#{pane_height}||#{pane_left}||#{pane_top}||
#{pane_index}||#{pane_in_mode}||#{window_layout}
```

> NOTE(opus/sprack-layout-organization): `window_layout` is per-window, not per-pane, but it appears on every pane line when using `list-panes -a`.
> Deduplication happens at parse time (the current code already deduplicates windows).

### Schema Extension

New columns for the `panes` table:

```sql
pane_width     INTEGER,
pane_height    INTEGER,
pane_left      INTEGER,
pane_top       INTEGER,
pane_index     INTEGER,
pane_in_mode   INTEGER NOT NULL DEFAULT 0
```

New column for the `windows` table:

```sql
layout         TEXT NOT NULL DEFAULT ''
```

## Summary

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Pane ordering | By tmux index (creation order) | By spatial position (rows, then columns) |
| Metadata captured | 12 fields | 19+ fields |
| Metadata displayed | Process name + status badge | Exhaustive: dimensions, PID, path, title, mode |
| Layout awareness | None | Spatial coordinates or parsed layout string |
| Split visualization | Flat list under window | Grouped by visual row/column arrangement |
