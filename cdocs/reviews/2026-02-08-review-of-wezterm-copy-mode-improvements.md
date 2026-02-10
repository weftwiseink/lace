---
review_of: cdocs/proposals/2026-02-08-wezterm-copy-mode-improvements.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:45:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
tags: [fresh_agent, wezterm, copy-mode, keybindings, correctness, edge_cases]
---

# Review: WezTerm Copy Mode Improvements

## Summary Assessment

This proposal addresses two specific pain points with wezterm copy mode: unwanted auto-copy-on-select and insufficient vim/tmux parity in keybindings. The solution is well-scoped, correctly identifies the boundary between config-level fixes and upstream limitations, and provides ready-to-use Lua code. The most important finding is a correctness concern with the `Escape` override: `ClearSelectionMode` does not create a "second press exits" flow as the comments suggest -- it unconditionally clears the selection mode and nothing more, meaning there is no built-in way to exit copy mode via Escape after the override. This needs to be called out more clearly so the user makes an informed choice. Verdict: **Accept** with non-blocking clarifications.

## Section-by-Section Findings

### BLUF and Objective

Clear, accurate, well-scoped. The NOTE callout for upstream limitations is exactly the right approach -- upfront, concise, and linked to the report. **No issues.**

### Background

Correctly reproduces the current config state and identifies both problems. The "Why Not a Plugin?" section is valuable context that prevents future misdirected effort. **No issues.**

### Part 1: Mouse Bindings Override

The mouse bindings table is comprehensive. The proposal improves on the analysis report's version by including SHIFT, ALT, and SHIFT|ALT modifier variants, which the report's review flagged as a gap. The `mouse_bind` helper function is clean.

One subtlety: **setting `config.mouse_bindings` replaces the entire default mouse binding table**, not just the specified entries. The defaults include bindings for right-click (paste), middle-click (paste from primary), and various Down events for selection start. By only specifying Up events, the proposal relies on the fact that unspecified default bindings are preserved for other event types. This is how wezterm works -- `mouse_bindings` overrides are merged with defaults by event signature, not replaced wholesale. The proposal should state this assumption explicitly so a reader does not worry about losing right-click paste or middle-click paste. **Non-blocking** -- the code is correct, but the reasoning should be documented.

### Part 2: Custom copy_mode Key Table

The `override_binding` helper is a clean pattern. The override-from-defaults approach (Decision 1) is the right call for maintainability.

**Escape behavior concern:** The proposal says "Escape: clear selection first, then exit on second press" in the code comments, and the NOTE callout says "If no selection is active, `Escape` still keeps you in copy mode." These two statements are slightly contradictory. The code comment implies a second Escape exits; the NOTE says it does not. The NOTE is correct: `ClearSelectionMode` is idempotent. Pressing Escape repeatedly will just keep firing `ClearSelectionMode` with no further effect. There is no conditional "if selection is clear, then close" logic available in wezterm's action system.

This means that with this override, **the only ways to exit copy mode are `q`, `Ctrl+C`, or `Ctrl+G`**. The user needs to know this clearly. The code comment on lines 158-161 should be corrected to remove the "then exit on second press" implication. **Non-blocking** -- the NOTE on line 180 already describes the actual behavior correctly, but the code comment is misleading.

**Y (yank line) behavior:** The `SetSelectionMode = 'Line'` followed immediately by `CopyTo` in an `act.Multiple` chain assumes wezterm processes the selection mode change and applies it to the current cursor position before the copy executes. This should work because `act.Multiple` processes actions sequentially within the same frame, and `SetSelectionMode` expands the selection to the full line synchronously. Worth noting in the test plan that if `Y` copies only the character under the cursor, the `act.Multiple` sequencing assumption was wrong. **Non-blocking** -- likely correct but untested.

**Two calls to `default_key_tables()`:** The code calls `wezterm.gui.default_key_tables()` twice (once for `copy_mode`, once for `search_mode`). This is a minor inefficiency. Consider:

```lua
local defaults = wezterm.gui.default_key_tables()
copy_mode = defaults.copy_mode
search_mode = defaults.search_mode
```

**Non-blocking** -- purely aesthetic, no functional impact.

### Part 3: Resulting Key Table Summary

The summary tables are thorough and correctly annotate which bindings are defaults, overrides, or new additions. The search mode NOTE about the upstream selection-after-search issue is a good callout, and the suggestion to use Escape to clear it ties the override back to a practical benefit. **No issues.**

### Design Decisions

All four decisions are well-reasoned with clear rationale. Decision 3 (PrimarySelection for mouse, ClipboardAndPrimarySelection for y) is the strongest -- it articulates the passive/active distinction cleanly. **No issues.**

### Edge Cases

The `config.key_tables` overwrite bug is a genuine pre-existing issue and the proposed fix (`config.key_tables = config.key_tables or {}`) is correct. Good catch.

The Wayland/X11 note is accurate -- wezterm handles PrimarySelection on both.

**Missing edge case:** The proposal does not address what happens with the mouse bindings when wezterm is running inside a remote/SSH session (e.g., connecting to a devcontainer via the lace.wezterm plugin). In that scenario, mouse events are still handled by the local wezterm instance, so the mouse_bindings config applies normally. Worth a one-line note for completeness. **Non-blocking.**

### Test Plan

The test plan is practical and covers all the key scenarios. The pre/post diff using `wezterm show-keys` is a particularly good verification step. One addition worth considering: test that right-click paste and middle-click paste still work after the mouse_bindings change, since those are not explicitly overridden and rely on wezterm's default merge behavior. **Non-blocking.**

### Implementation Phases

Appropriately scoped at 20 minutes total. The three phases are correctly sequenced. **No issues.**

### Open Questions

All three questions are genuine decision points. The recommendations are reasonable. Question 1 (Escape behavior) is the most impactful -- the proposal should make clear that the user is giving up Escape-to-exit entirely, not just adding a "clear first" step. **Non-blocking** -- covered above.

## Verdict

**Accept.** The proposal is well-researched, correctly scoped, and provides ready-to-implement code. The mouse bindings fix is straightforward and addresses the primary complaint. The copy_mode overrides are conservative (only 4 key changes on top of defaults) and reversible. The non-blocking findings are documentation/clarity issues, not correctness problems (with the minor caveat that the Escape code comment should be aligned with the NOTE's accurate description of the behavior).

## Action Items

1. [non-blocking] Fix the code comment on the Escape override to remove the "then exit on second press" implication. The actual behavior is: Escape always clears selection mode, never exits. Align with the NOTE callout which already describes this correctly.
2. [non-blocking] Add a brief note in Part 1 explaining that wezterm merges `mouse_bindings` overrides with defaults by event signature, so right-click paste and middle-click paste are not affected by this change.
3. [non-blocking] Consolidate the two `wezterm.gui.default_key_tables()` calls into a single call assigned to a local variable.
4. [non-blocking] Add a test step for right-click paste and middle-click paste verification after the mouse_bindings change.
5. [non-blocking] In the Edge Cases section, note that mouse_bindings apply to the local wezterm instance even when connected to remote domains (devcontainers), so no special handling is needed.
