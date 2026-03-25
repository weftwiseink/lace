---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T22:15:00-07:00
task_list: terminal-management/sprack-tui-ux
type: proposal
state: live
status: request_for_proposal
tags: [sprack, tui, ux_design]
---

# Sprack TUI UX Improvements

> BLUF: Two small interaction fixes: clicking non-leaf tree nodes should expand/collapse them immediately, and ctrl+c should quit the TUI.

## Objective

Address two friction points in sprack's tree interaction:

1. **Click-to-expand**: clicking a session, window, or host group node currently only selects it.
The user expects clicking a non-leaf node to toggle its expanded/collapsed state, matching standard tree widget behavior.

2. **Ctrl+C to quit**: the standard terminal exit chord does not quit sprack.
Users instinctively reach for ctrl+c to exit TUI applications.

## Scope

These are minor input handling changes, not architectural work.

- **Click-to-expand**: determine whether `tui-tree-widget` v0.22 exposes toggle-on-click behavior, or whether the mouse event handler in `app.rs`/`render.rs` needs to call `tree_state.toggle()` on non-leaf clicks.
- **Ctrl+C**: add `KeyCode::Char('c')` with `KeyModifiers::CONTROL` to the quit keybinding match in the input handler, alongside the existing `q` binding.

## Open Questions

1. Does `tui-tree-widget` handle click-to-expand natively via `StatefulWidget`, or does sprack need to intercept the mouse event and call toggle manually?
2. Should double-click be required for expand (single-click selects, double-click toggles), or should single-click on non-leaf nodes always toggle?
   Recommendation: single-click toggles, matching file tree conventions.
3. Are there any other keybindings that should be added while we're in the input handler?
   Candidates: `?` for help overlay, `/` for search/filter.
