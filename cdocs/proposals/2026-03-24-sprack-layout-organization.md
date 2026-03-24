---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T15:15:00-07:00
task_list: terminal-management/sprack-layout-organization
type: proposal
state: live
status: request_for_proposal
tags: [sprack, tui, tmux, layout, metadata, future_work]
---

# sprack Layout Organization

> BLUF(opus/sprack-layout-organization): The current tree presents panes in tmux creation order, which does not match the user's spatial mental model.
> This RFP requests two changes: (1) organize panes by visual position ("rows, then columns, then recurse") using spatial coordinates from tmux, and (2) capture and display exhaustive pane metadata (dimensions, PID, path, title, mode) similar to tmux's `choose-tree`.
> Both changes require expanding sprack-poll's format string and the sprack-db schema.
> See the [layout organization report](../reports/2026-03-24-sprack-layout-organization.md) for full analysis.

## Objective

1. **Spatial ordering:** Panes within a window are displayed in their visual arrangement (top-to-bottom rows, left-to-right within rows) rather than by tmux index.
2. **Exhaustive metadata:** Each node displays comprehensive metadata, leaning toward showing more rather than less, following tmux `choose-tree` conventions.
3. **Schema extension:** Capture the additional tmux format variables needed for spatial ordering and metadata display.

## Scope

### In Scope

- Extending `sprack-poll`'s tmux format string to capture spatial fields (`pane_width`, `pane_height`, `pane_left`, `pane_top`, `pane_index`, `pane_in_mode`) and `window_layout`.
- Extending the `panes` and `windows` tables in sprack-db to store the new fields.
- Spatial sorting algorithm: group panes by visual row (overlapping `pane_top` ranges), sort by `pane_left` within rows.
- Metadata display formatting per layout tier: what metadata appears at Compact, Standard, Wide, Full.
- Pane dimension display (e.g., `80x24`).
- Window-level layout summary (e.g., "2x2", "3 stacked", "H-split").

### Out of Scope

- Parsing the `window_layout` string into a split tree (complex, fragile: spatial coordinates are sufficient).
- Visualizing the pane layout graphically (minimap, ASCII art of splits).
- Custom pane border rendering.
- Capturing all 34 tmux pane variables (capture only the highest-value additions).

## Open Questions

1. **Row grouping tolerance:** When grouping panes into visual rows by `pane_top`, what tolerance should be used?
   Exact-match grouping fails for uneven layouts (e.g., one tall pane spanning multiple "rows").
   Should grouping use overlap percentage, or simply sort by `(pane_top, pane_left)` without explicit row grouping?

2. **Layout string parsing:** Should the design parse `window_layout` to derive a split tree, or rely entirely on spatial coordinates?
   The layout string provides the split hierarchy directly but is undocumented and complex to parse.
   Coordinates are simpler but lose the split-type information (horizontal vs vertical).

3. **DB schema migration:** The sprack-db proposal states "no migration system" and uses delete-and-recreate.
   Is this still acceptable, or should the design introduce a `user_version` pragma for the schema extension?

4. **Backward compatibility:** If the format string is extended, old sprack-poll binaries produce fewer fields per line.
   Should parsing handle variable field counts, or is a clean-break acceptable (require matching binary versions)?

5. **Metadata density vs readability:** The user wants "exhaustive" metadata, but dense displays can be overwhelming.
   Should the design specify a strict information hierarchy (priority-ordered fields, shown based on available width), or show everything and let the user scroll?

6. **Window layout summary:** What format should the window-level layout summary use?
   Options: raw dimensions ("159x48"), split description ("2 cols, 2 rows"), pane count ("4 panes"), or a combination.

7. **Performance impact:** Adding 7 fields to the format string increases parse and DB write volume by ~60%.
   Is this significant given the current small dataset size (dozens of panes)?
   Likely negligible, but should be verified.
