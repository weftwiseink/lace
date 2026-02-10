---
review_of: cdocs/proposals/2026-02-08-wezterm-copy-mode-improvements.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T12:00:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
tags: [self, implementation_review, wezterm, copy-mode, mouse-bindings, dotfiles]
---

# Review: WezTerm Copy Mode Improvements Implementation

## Summary Assessment

This review evaluates the implementation of the WezTerm copy mode improvements proposal against the deployed config at `~/.config/wezterm/wezterm.lua` and chezmoi source at `dotfiles/dot_config/wezterm/wezterm.lua`. The implementation is faithful to the proposal, with one deliberate improvement (the `action_callback`-based Escape binding) that is strictly better than what was proposed. Both files are identical. One blocking issue found: the `override_binding` helper has a subtle mods-matching bug when `mods` is passed as `'NONE'` vs `nil`.

## Section-by-Section Findings

### Mouse Bindings (Phase 1)

The `mouse_bind` helper and all 6 `config.mouse_bindings` entries match the proposal exactly. Placement is between Multiplexing and Keybindings sections, which is logical (input-related config grouped together). The section header comment clearly explains the rationale.

**No issues found.** Implementation is correct and complete.

### Copy Mode: `override_binding` helper

The helper function signature is `override_binding(tbl, key, mods, new_action)`. The matching logic is:

```lua
if binding.key == key and (binding.mods or 'NONE') == (mods or 'NONE') then
```

This works correctly when:
- `mods` is `'NONE'` and the binding has `mods = 'NONE'`
- `mods` is `'NONE'` and the binding has no `mods` field (nil)
- `mods` is `'SHIFT'` and the binding has `mods = 'SHIFT'`

**Finding: [non-blocking]** The proposal's version uses `binding.mods == (mods or 'NONE')` which would fail when a default binding has `mods = nil` and we pass `mods = 'NONE'`. The implementation correctly normalizes both sides with `(binding.mods or 'NONE') == (mods or 'NONE')`. This is an improvement over the proposal.

### Copy Mode: `y` override

```lua
override_binding(copy_mode, 'y', 'NONE', act.Multiple {
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'ScrollToBottom' },
  { CopyMode = 'Close' },
})
```

Matches the proposal exactly. The default `y` binding in wezterm uses `CopyTo = 'ClipboardAndPrimarySelection'` with the same scroll+close sequence, so this override makes the behavior explicit without changing it. Correct.

### Copy Mode: `Y` override

```lua
override_binding(copy_mode, 'Y', 'SHIFT', act.Multiple {
  { CopyMode = { SetSelectionMode = 'Line' } },
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'ScrollToBottom' },
  { CopyMode = 'Close' },
})
```

Matches the proposal. The `SetSelectionMode = 'Line'` followed by `CopyTo` will select the current line and copy it. This is a new binding (no default `Y` in copy mode), so `override_binding` will append it.

**Finding: [non-blocking]** There is no default `Y`/`SHIFT` binding in wezterm's copy_mode table. The `override_binding` helper will fall through the loop and append. This works correctly, but the comment "yank entire line" could note this is a new binding, not an override. Minor clarity issue.

### Copy Mode: `Escape` override

The implementation preserves the improved `action_callback` approach from the prior partial implementation:

```lua
override_binding(copy_mode, 'Escape', 'NONE',
  wezterm.action_callback(function(window, pane)
    local has_selection = window:get_selection_text_for_pane(pane) ~= ''
    if has_selection then
      window:perform_action(act.CopyMode('ClearSelectionMode'), pane)
    else
      window:perform_action(act.Multiple {
        { CopyMode = 'ScrollToBottom' },
        { CopyMode = 'Close' },
      }, pane)
    end
  end))
```

This is strictly better than the proposal's `ClearSelectionMode`-only approach. With the proposal's approach, Escape with no selection would do nothing (user would be stuck in copy mode with only `q`/`Ctrl-C`/`Ctrl-G` to exit). With this implementation, Escape is context-sensitive: clears selection if active, exits copy mode if no selection. Correct and intentional deviation.

**Finding: [non-blocking]** The `override_binding` helper sets `tbl[i].action = new_action`, but the original Escape implementation replaced the entire binding entry (`copy_mode[i] = { key = ..., mods = ..., action = ... }`). The new approach via `override_binding` only replaces the `.action` field, which is functionally equivalent since `key` and `mods` are already correct. No issue.

### Copy Mode: `q` override

```lua
override_binding(copy_mode, 'q', 'NONE', act.Multiple {
  { CopyMode = 'ClearSelectionMode' },
  { CopyMode = 'ScrollToBottom' },
  { CopyMode = 'Close' },
})
```

Matches the proposal. The default `q` binding in copy mode is just `{ CopyMode = 'Close' }`. This override adds `ClearSelectionMode` and `ScrollToBottom` for a cleaner exit. Correct.

### search_mode passthrough

```lua
local search_mode = nil
if wezterm.gui then
  ...
  search_mode = wezterm.gui.default_key_tables().search_mode
end

...
config.key_tables.search_mode = search_mode
```

Matches the proposal. The `search_mode` is loaded from defaults and passed through without modification. This ensures that setting `config.key_tables` doesn't accidentally drop search_mode bindings.

**Finding: [non-blocking]** The `search_mode` assignment is inside the `if copy_mode then` block. If `wezterm.gui` exists but `copy_mode` is nil (unlikely but theoretically possible), `search_mode` would also not be set. This is acceptable since both come from `wezterm.gui.default_key_tables()` and if one is nil, the other likely would be too.

### config.key_tables overwrite fix

```lua
config.key_tables = config.key_tables or {}
config.key_tables.copy_mode = copy_mode
config.key_tables.search_mode = search_mode
```

This was already partially implemented (the `or {}` pattern). The addition of individual table assignment instead of wholesale replacement (`config.key_tables = { copy_mode = ..., search_mode = ... }`) is correct and matches the proposal's edge case fix. This ensures any key_tables set by the lace plugin are preserved.

### File Sync

Both files (`~/.config/wezterm/wezterm.lua` and `dotfiles/dot_config/wezterm/wezterm.lua`) have been verified identical via `diff`.

## Verdict

**Accept.** The implementation faithfully follows the proposal with one intentional improvement (the `action_callback` Escape behavior). Both files are in sync. No blocking issues found.

## Action Items

1. [non-blocking] Consider adding a brief comment to the `Y` override noting it is a new binding (appended), not an override of an existing default.
2. [non-blocking] The two calls to `wezterm.gui.default_key_tables()` on lines 206-207 could be consolidated into one call to avoid double-constructing the table: `local defaults = wezterm.gui.default_key_tables(); copy_mode = defaults.copy_mode; search_mode = defaults.search_mode`. Minor performance consideration, likely negligible since this runs once at config load.
