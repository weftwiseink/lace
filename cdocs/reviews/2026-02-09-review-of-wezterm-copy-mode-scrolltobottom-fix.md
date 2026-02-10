---
review_of: cdocs/proposals/2026-02-08-wezterm-copy-mode-improvements.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T08:53:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
tags: [fresh_agent, bugfix_review, wezterm, copy-mode, api_validation, version_compat]
---

# Review: WezTerm Copy Mode ScrollToBottom Fix

## Summary Assessment

This review evaluates the hotfix that replaces `{ CopyMode = 'ScrollToBottom' }` with `{ CopyMode = 'MoveToScrollbackBottom' }` across all copy mode exit bindings (y, Y, q, Escape) in the personal wezterm config. The fix is correct: `ScrollToBottom` is not a valid `CopyModeAssignment` variant in wezterm version 20240203-110809-5046fc22, while `MoveToScrollbackBottom` is confirmed valid by both the installed version's default key tables (bound to `G`) and the official wezterm API documentation. The fix has been validated via config parsing (`wezterm ls-fonts`), key binding inspection (`wezterm show-keys`), and log review (no new errors). **Accept.**

## Evidence

### Root Cause

The error `ScrollToBottom is not a valid CopyModeAssignment variant` occurred because:

1. The wezterm documentation at wezterm.org/copymode.html shows `{ CopyMode = 'ScrollToBottom' }` in the default key tables, but this reflects a **newer version** than what is installed.
2. The installed version (20240203) does not include `ScrollToBottom` as a CopyMode sub-action. Its default `y`, `q`, and Escape bindings do NOT use any scroll-to-bottom action -- they just use `{ CopyMode = 'Close' }`.
3. `ScrollToBottom` exists as a **top-level** `KeyAssignment` (`act.ScrollToBottom`), not as a CopyMode variant. The table syntax `{ CopyMode = 'ScrollToBottom' }` was invalid.

### Prior Review Gap

The R2 implementation review (2026-02-09-review-of-wezterm-copy-mode-implementation.md) accepted the `ScrollToBottom` usage and even stated "The default `y` binding in wezterm uses `CopyTo = 'ClipboardAndPrimarySelection'` with the same scroll+close sequence." This was incorrect -- the reviewer did not validate against the installed wezterm version's actual defaults. The actual defaults for this version show no scroll-to-bottom in any exit binding.

### Fix Validation

1. **Config parsing**: `wezterm ls-fonts` returns font info without config errors.
2. **Key binding inspection**: `wezterm show-keys --lua --key-table copy_mode` shows all four bindings with the correct `MoveToScrollbackBottom` action.
3. **Log review**: The wezterm GUI log (`/run/user/1000/wezterm/wezterm-gui-log-1076655.txt`) shows `ScrollToBottom` errors from 08:38 (before fix) but no errors after the 08:47 config reload.
4. **File sync**: `diff` confirms both files (deployed and chezmoi source) are identical.
5. **API confirmation**: `MoveToScrollbackBottom` is confirmed valid by the installed version's `G` binding in the default copy_mode table.

## Section-by-Section Findings

### y binding (line 228-232)

```lua
override_binding(copy_mode, 'y', 'NONE', act.Multiple {
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'MoveToScrollbackBottom' },
  { CopyMode = 'Close' },
})
```

The fix adds `MoveToScrollbackBottom` before `Close`. The installed version's default `y` does NOT include this step (it just copies and closes), so this is an enhancement over the default: it ensures the cursor moves to the scrollback bottom before exiting, which ensures the viewport returns to the live terminal area. This is a reasonable enhancement.

**No issues found.**

### Y binding (line 236-241)

```lua
override_binding(copy_mode, 'Y', 'SHIFT', act.Multiple {
  { CopyMode = { SetSelectionMode = 'Line' } },
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'MoveToScrollbackBottom' },
  { CopyMode = 'Close' },
})
```

Consistent with the `y` binding. The `SetSelectionMode = 'Line'` followed by `CopyTo` followed by `MoveToScrollbackBottom` followed by `Close` is the correct sequence.

**No issues found.**

### Escape binding (line 246-257)

```lua
override_binding(copy_mode, 'Escape', 'NONE',
  wezterm.action_callback(function(window, pane)
    local has_selection = window:get_selection_text_for_pane(pane) ~= ''
    if has_selection then
      window:perform_action(act.CopyMode('ClearSelectionMode'), pane)
    else
      window:perform_action(act.Multiple {
        { CopyMode = 'MoveToScrollbackBottom' },
        { CopyMode = 'Close' },
      }, pane)
    end
  end))
```

The `act.Multiple` inside the callback is evaluated at runtime (when Escape is pressed), not at config parse time. The original `ScrollToBottom` error would have manifested at runtime when pressing Escape without a selection. The fix correctly uses `MoveToScrollbackBottom`.

**Finding: [non-blocking]** The `act.Multiple` construction inside the callback is re-evaluated on every Escape press. Since `act.Multiple` likely allocates a new table each time, a minor optimization would be to hoist it outside the callback as a local. This is negligible for a keystroke handler. No action needed.

### q binding (line 260-264)

```lua
override_binding(copy_mode, 'q', 'NONE', act.Multiple {
  { CopyMode = 'ClearSelectionMode' },
  { CopyMode = 'MoveToScrollbackBottom' },
  { CopyMode = 'Close' },
})
```

Consistent with the other bindings. `ClearSelectionMode` before `MoveToScrollbackBottom` is the correct order.

**No issues found.**

### Comment quality (lines 224-227)

```lua
-- y: yank to clipboard + primary, scroll to bottom, exit copy mode
-- MoveToScrollbackBottom returns the cursor to the live terminal area before closing.
-- Note: 'ScrollToBottom' is NOT a valid CopyMode variant in wezterm 20240203;
-- MoveToScrollbackBottom is the correct CopyMode action for this purpose.
```

The comment documents the version-specific issue clearly, which will help future maintainers (or agents) avoid re-introducing the bug. Good practice.

**No issues found.**

### Semantic difference: MoveToScrollbackBottom vs ScrollToBottom

`MoveToScrollbackBottom` moves the copy mode **cursor** to the bottom of the scrollback. `ScrollToBottom` (the top-level `act.ScrollToBottom`) scrolls the **viewport** to the bottom. Within copy mode, moving the cursor to the bottom effectively achieves the same visual result (the viewport follows the cursor). After `Close`, the viewport returns to the live terminal position regardless. So `MoveToScrollbackBottom` before `Close` is semantically appropriate and functionally correct.

**No issues found.**

## Verdict

**Accept.** The fix is correct, well-validated, and well-documented. All four affected bindings use the proper `MoveToScrollbackBottom` CopyMode variant that is confirmed valid in the installed wezterm version. Both config files are in sync.

## Action Items

1. [non-blocking] Consider adding the wezterm version constraint to the proposal's `implementation_notes` so future upgrades know to re-evaluate when `ScrollToBottom` becomes available as a CopyMode variant.
2. [non-blocking] The prior R2 review (2026-02-09-review-of-wezterm-copy-mode-implementation.md) incorrectly accepted `ScrollToBottom` without version validation. Consider adding a note to that review's frontmatter marking it as superseded or noting the missed finding.
