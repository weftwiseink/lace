---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T14:15:00-07:00
task_list: terminal-management/sprack-inline-summaries
type: report
state: live
status: review_ready
tags: [sprack, tui, ratatui, layout, ux_design]
---

# sprack Inline Summary Design: Problem Space Analysis

> BLUF: The current TUI design uses a separate detail pane on the right that shows information for the selected node.
> User feedback requests summaries be aligned inline with each tree node rather than isolated in a detail panel.
> This requires either multi-line tree nodes, a two-column layout (tree + aligned metadata), or a custom widget that combines tree structure with inline annotations.
> The `tui-tree-widget` crate does not natively support multi-line items, so the solution involves either extending the tree widget, replacing it with a custom renderer, or using a parallel column approach.

## 1. The Observed Problem

The TUI renders a tree on the left and a detail pane on the right.
The detail pane shows "Select a pane to view details" when nothing is selected.
Even when a pane is selected, the user must shift attention between the tree (which shows the structure) and the detail pane (which shows the status).

The user's desired behavior: every summarizable process has its summary aligned with its node in the tree, with no separate detail pane needed for the common case.

## 2. Current Widget Architecture

The TUI uses `tui-tree-widget` v0.22.0 (crate: `tui-tree-widget`).
Each `TreeItem` takes:
- A `NodeId` identifier
- A `Line<'static>` (or `Text`) for the display content
- Child `TreeItem`s for nested nodes

`TreeItem::new(id, text, children)` where `text` is converted via `Into<Text<'a>>`.
`Text` is a vector of `Line`s, which means `TreeItem` can technically hold multi-line content.

> NOTE(opus/sprack-inline-summaries): The `tui-tree-widget` crate accepts `Text` (multiple `Line`s) as item content.
> However, the tree rendering logic may not correctly account for multi-line items when computing vertical offsets, selection highlighting, and scroll positions.
> This needs empirical testing.

## 3. Design Options

### 3A. Multi-Line Tree Nodes

Embed the summary as a second (or third) line within each `TreeItem`:

```
v lace (22427)
  v editor
    claude (ssh)
      thinking... 3 agents, 42% ctx
    nu (ssh)
  > logs (3)
```

Each pane node becomes two lines: the process name and the summary beneath it, indented to align under the parent.

**Advantages:**
- Summary is visually attached to its node.
- No separate panel needed.
- Collapsed nodes hide their summaries.

**Challenges:**
- `tui-tree-widget` may not handle multi-line items correctly for selection, scrolling, and mouse click targeting.
- Vertical space usage doubles for every summarizable pane.
- The indentation of the summary line is ambiguous: it could look like a child node.

### 3B. Inline Suffix (Single-Line, Extended)

Extend each pane's `Line` to include the summary as trailing spans:

```
v lace (22427)
  v editor
    claude (ssh) [thinking] 3 agents, 42% ctx
    nu (ssh) [idle]
  > logs (3)
```

This is a natural extension of the existing Standard/Wide tier formatting, which already places `[thinking]` badges inline.

**Advantages:**
- No widget changes needed: this is the existing approach, extended.
- One line per node, compact.
- The tree structure is clear.

**Challenges:**
- Horizontal space is limited, especially at Standard tier (30-59 cols).
- Long summaries truncate or push the tree wider.
- No room for multi-line detail (subagent list, context breakdown).

### 3C. Two-Column Aligned Layout (Tree + Metadata Column)

Split the tree area into two columns: the tree on the left, aligned metadata on the right:

```
v lace (22427)              |
  v editor                  |
    claude (ssh)            | thinking... 3 agents, 42%
    nu (ssh)                | idle
  > logs (3)                |
```

The metadata column is not a separate widget but a parallel render pass that aligns annotations with tree rows.

**Advantages:**
- Summaries are visually aligned with their nodes without ambiguity.
- Tree structure remains clean.
- Similar to `tmux choose-tree`'s approach of showing metadata alongside entries.

**Challenges:**
- Requires knowing the rendered row position of each tree node.
- `tui-tree-widget` does not expose row-to-node mapping after rendering.
- Custom rendering logic is needed to synchronize tree rows with metadata.

### 3D. tmux choose-tree Inspiration

tmux's `choose-tree` command uses a format string that conditionally renders metadata inline with each node type.
Its default `tree_mode_format` (from this tmux server):

```
#{?pane_format,#{pane_current_command}#{?pane_active,*,}...,
#{?window_format,#{window_name}#{window_flags}...,
#{session_windows} windows#{?session_attached, (attached),}}}
```

Key observations:
- Pane lines show: `current_command`, active marker, title (if non-default).
- Window lines show: `window_name`, flags, pane count, title (if single-pane window).
- Session lines show: window count, group info, attached status.
- All metadata is inline, single-line per entry.
- A separate preview pane shows the actual terminal content (bottom half).

tmux choose-tree does not show process-specific summaries (context usage, subagent count).
Its metadata is structural (counts, flags, names), not semantic.

### 3E. Custom Tree Renderer (Replace tui-tree-widget)

Build a custom tree renderer that supports:
- Multi-line nodes with controlled indentation.
- A parallel metadata column.
- Selection and scrolling aware of variable-height items.

This is the most flexible option but the most implementation effort.

## 4. Widget Capabilities Analysis

### tui-tree-widget v0.22

- `TreeItem` accepts `impl Into<Text<'a>>`, so `Text` with multiple `Line`s is valid at the type level.
- The `Tree` widget renders items vertically, computing offsets from `TreeState`.
- Selection highlighting applies to the first line of a multi-line item (untested: may not highlight all lines).
- Mouse `click_at` computes hit targets from rendered positions, which could misalign with multi-line items.
- Scrolling is item-based, not line-based.

> WARN(opus/sprack-inline-summaries): Multi-line `TreeItem` support in `tui-tree-widget` is not documented.
> The crate's examples and tests use single-line items exclusively.
> Empirical testing is required before committing to approach 3A.

### ratatui Table Widget

- Supports multi-line rows via `Row::new(vec![Cell::from(text)])` where `text` can be multi-line.
- Built-in column alignment.
- Built-in selection and scrolling.
- Does not have tree-specific features (indentation, collapse/expand, parent-child relationships).

A Table could simulate tree indentation by prepending spaces/tree-chrome to the first column's text.
This approach trades native tree semantics for native column alignment.

### ratatui Paragraph Widget

- Renders `Text` (multi-line) in a rectangular area.
- No selection, scrolling, or interactivity.
- Useful for the metadata column if manually positioned.

## 5. Recommended Approach: Progressive Enhancement

Given the analysis, a phased approach:

**Phase 1: Extended inline suffix (3B).**
This is achievable with zero widget changes.
Extend the existing pane label formatting to include more summary data in the `Line` spans.
The Wide and Full tiers already have inline badges: extend them with agent count and context percentage.

**Phase 2: Evaluate multi-line TreeItem (3A).**
Test whether `tui-tree-widget` handles multi-line `Text` correctly for selection, scrolling, and mouse targeting.
If it works, add optional summary lines beneath pane nodes.

**Phase 3: Two-column aligned layout (3C) or custom renderer (3E).**
If native multi-line support is insufficient, build a custom tree renderer or a synchronized two-column layout.
This is the highest-effort option and should only be pursued if Phase 1 and Phase 2 prove inadequate.

## 6. Space Budget Analysis

At Standard tier (30-59 cols), inline suffixes must fit within ~15-25 characters after the process name:
- Process name: ~8-12 chars (`claude`, `nu`, `nvim`)
- Status badge: ~10-12 chars (`[thinking]`, `[tool: Read]`)
- Remaining: ~5-10 chars for additional metadata

At Wide tier (60-99 cols), the budget is larger:
- Process name + title: ~20-30 chars
- Status badge: ~10-12 chars
- Remaining: ~20-40 chars (enough for `3 agents, 42% ctx`)

At Full tier (100+ cols), there is ample space for detailed inline summaries.

The detail pane can be retained for Full tier as an expansion area for information that does not fit inline (full session history, token counts, model name).
The key insight from user feedback: the detail pane should not be the primary way to see status.
Inline summaries are the primary display; the detail pane is supplemental.
