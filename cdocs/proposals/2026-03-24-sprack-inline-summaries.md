---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T15:00:00-07:00
task_list: terminal-management/sprack-inline-summaries
type: proposal
state: live
status: request_for_proposal
tags: [sprack, tui, ratatui, layout, ux_design, future_work]
---

# sprack Inline Summaries

> BLUF(opus/sprack-inline-summaries): The current detail-pane-on-the-right design requires the user to shift attention between the tree and a separate panel to see process status.
> This RFP requests a redesign where summaries are displayed inline with tree nodes: either as extended single-line suffixes, multi-line tree items, or a two-column aligned layout.
> The detail pane should become supplemental (showing expanded info for the selected node at wide widths) rather than the primary status display.
> See the [inline summary design report](../reports/2026-03-24-sprack-inline-summary-design.md) for full analysis.

## Objective

Redesign the sprack TUI so that every pane with a process integration (e.g., Claude Code status) has its summary visible directly in the tree view without requiring the user to select the node or look at a separate panel.

The primary information to show inline:
- Activity state (thinking, tool_use, idle, waiting, error).
- Subagent count (when > 0).
- Context usage percentage.
- Last tool name (when in tool_use state).

## Scope

### In Scope

- Extended inline suffixes at all layout tiers (Compact, Standard, Wide, Full).
- Evaluation of `tui-tree-widget` multi-line `Text` support for summary sub-lines.
- Space budget analysis per tier to determine what fits inline vs what overflows.
- Redesign of the detail pane role: supplemental at Wide/Full tiers, absent at Compact/Standard.
- Rendering logic changes in `tree.rs` and `render.rs`.

### Out of Scope

- Custom tree widget implementation (deferred unless multi-line evaluation fails).
- Animated status indicators (spinner, progress bar).
- Non-Claude integrations (nvim, cargo): the design should support them generically but this RFP focuses on Claude summaries.

## Open Questions

1. **Multi-line feasibility:** Does `tui-tree-widget` v0.22 correctly handle `Text` with multiple `Line`s for selection highlighting, scrolling, and mouse click targeting?
   This needs empirical testing before committing to the multi-line approach.

2. **Tier-specific formatting:** What summary elements fit at each tier?
   The report estimates ~15-25 usable characters at Standard tier and ~20-40 at Wide tier.
   Should the design specify exact format strings per tier, or should it be dynamic based on available width?

3. **Summary staleness:** Inline summaries update when the DB changes, but if sprack-claude is slow or not running, stale summaries linger.
   Should there be a visual indicator for stale summaries (e.g., dimmed text, timestamp)?

4. **Detail pane retention:** Should the detail pane be completely removed, or kept as an opt-in expansion for Full tier?
   The user's feedback says "no separate detail pane in the pure sense," but there may be value in an expanded view for debugging or monitoring.

5. **Two-column synchronization:** If pursuing the aligned two-column approach (tree + metadata column), how should scrolling and selection synchronize between the two columns?
   `tui-tree-widget` does not expose rendered row positions, so custom rendering may be needed.

6. **Node type summaries:** Should session and window nodes also show aggregate summaries (e.g., "3/5 panes active, 2 thinking")?
   This adds information density but increases visual complexity.
