---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T14:30:00-08:00
task_list: lace/dotfiles-wezterm
type: proposal
state: archived
status: accepted
revision_notes: |
  R1 revisions applied:
  - [B1] Fixed cursor position inconsistency: removed false claim that cursor lands at
    mouse selection endpoint. BLUF and body now consistently state cursor lands at
    terminal cursor position (typically bottom of visible area).
  - [B3] Added explicit Recommendation section with clear revert criteria. Proposal now
    commits to "implement the workaround" with specific conditions for reverting to
    status quo.
  - Added active_key_table() guard for "already in copy mode" edge case.
  - Promoted upstream feature request from open question to explicit recommendation.
  - Fixed test plan link to reference local dotfiles path.
  - Added inline opt-in documentation comments to the code sample.
tags: [wezterm, copy-mode, mouse, selection, dotfiles, keybindings, clipboard]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T15:00:00-08:00
  round: 2
---

# WezTerm Mouse Selection to Copy Mode Transition

> BLUF: Automatically entering wezterm copy mode after mouse text selection is **not fully achievable** with wezterm's current architecture. The `ActivateCopyMode` action creates a new `CopyOverlay` that initializes with `start: None`, unconditionally clearing any existing mouse selection. There is no Lua API to retrieve selection coordinates or programmatically set a selection range within copy mode -- only `get_selection_text_for_pane` (text only, no coordinates) is available. This means the selection cannot be captured and restored after the copy mode transition.
>
> This proposal recommends a **partial workaround**: bind the mouse `Up` event (via `action_callback`) to detect when a selection exists and, if so, save the text to PrimarySelection and enter copy mode with `Cell` selection mode active. The copy mode cursor lands at the terminal's current cursor position (typically near the bottom of the visible area), **not** at the mouse selection endpoint -- the original selection is lost when the CopyOverlay initializes. The workaround's value is that the user lands in copy mode ready for keyboard navigation, and the selected text is already in PrimarySelection as a fallback. The alternative "yank menu" approach (detect selection, offer y/Y/Escape choices via `InputSelector`) is also analyzed but not recommended due to UX overhead.
>
> **Key constraint:** The wezterm `CopyOverlay` source ([`overlay/copy.rs`](https://github.com/wezterm/wezterm/blob/main/wezterm-gui/src/overlay/copy.rs)) initializes selection state to `None` on creation. This is a compiled behavior, not configurable. A true "mouse selection persists into copy mode" feature would require an upstream wezterm change.
>
> **Scope:** Dotfiles config only (`dotfiles/dot_config/wezterm/wezterm.lua`). No lace plugin changes.

## Objective

When text is selected with the mouse in wezterm, enable a workflow where the user can immediately operate on that selection using copy mode keybindings (y to yank, v to adjust visual selection, etc.) without needing to re-select the text from scratch using keyboard navigation.

The ideal behavior: mouse drag to select text, release button, and wezterm transitions into copy mode with the mouse selection active and operable. The user presses `y` to yank, `Y` to yank the line, or `Escape` to clear and navigate.

## Background

### Current Behavior

In the current wezterm config, mouse selection and copy mode are completely separate worlds:

1. **Mouse selection** highlights text and populates `PrimarySelection` on button release (configured in the existing `mouse_bindings`). The selection is visible but there are no keyboard bindings to operate on it -- the only actions are middle-click paste or Ctrl+Shift+C to copy.

2. **Copy mode** (entered via `Alt+C`) starts with no selection. The user must navigate to the desired text and press `v` to begin selecting, then use `hjkl`/`w`/`b` to extend, then `y` to yank. This is entirely keyboard-driven.

The gap: after selecting text with the mouse, there is no way to use the vim-style copy mode keys (`y`, `Y`, `v`, `V`, `o`, etc.) on that selection. The user must either:
- Accept the mouse selection as-is and use `Ctrl+Shift+C` to copy
- Abandon the mouse selection, enter copy mode, and re-select with the keyboard

### WezTerm Architecture Constraints

Research into wezterm's source code and API reveals three blocking constraints:

**1. `ActivateCopyMode` clears selection state.**

When `ActivateCopyMode` fires, wezterm creates a `CopyOverlay` via `CopyOverlay::with_pane()`. The overlay initializes with `start: None` and `range: None`, unconditionally discarding any existing mouse selection. This is compiled Rust code in `wezterm-gui/src/overlay/copy.rs`, not configurable.

**2. No Lua API for selection coordinates.**

The `window` object exposes `get_selection_text_for_pane(pane)` which returns the selected text as a string, and `get_selection_escapes_for_pane(pane)` which returns text with terminal escape sequences. Neither returns the selection's start/end coordinates (row, column). There is no `set_selection_range` or equivalent method.

Without coordinates, it is impossible to:
- Capture the mouse selection geometry before entering copy mode
- Restore it by programmatically positioning the copy mode cursor and setting the selection anchor

**3. `SetSelectionMode` only works inside an active copy mode overlay.**

The `CopyMode` actions (`SetSelectionMode`, `ClearSelectionMode`, etc.) are dispatched to the active `CopyOverlay`. If called before `ActivateCopyMode`, they are silently ignored. If called via `act.Multiple` after `ActivateCopyMode`, they execute against the freshly-initialized overlay (which has no selection to operate on). This is documented in [issue #5952](https://github.com/wezterm/wezterm/issues/5952).

### Prior Art

- The existing [copy mode improvements proposal](2026-02-08-wezterm-copy-mode-improvements.md) established the `override_binding` helper, `mouse_bind` helper, and the vim-style copy mode key table. This proposal builds on that foundation.
- [WezTerm issue #5952](https://github.com/wezterm/wezterm/issues/5952) discusses copy mode enhancement requests including better mode transition behavior.
- [WezTerm issue #1954](https://github.com/wezterm/wezterm/issues/1954) discusses alternative selection models but does not address mouse-to-copy-mode transitions.

## Proposed Solution

### Approach: Mouse-Up Callback with Copy Mode Entry

Add an `action_callback` to the mouse `Up` event that:
1. Checks whether text was selected (via `get_selection_text_for_pane`)
2. If selected text exists, copies it to `PrimarySelection`, then enters copy mode with `Cell` selection mode active
3. If no text was selected, falls through to the default behavior (open link or complete selection)

```lua
-- Mouse Up with selection detection: enter copy mode after mouse selection.
-- NOTE: The original mouse selection is NOT preserved in copy mode. The
-- CopyOverlay initializes with start=None, clearing all selection state.
-- The selected text IS saved to PrimarySelection before entry, so
-- middle-click paste always works as a fallback.
-- To disable this behavior, replace this binding with:
--   mouse_bind('Up', 1, 'Left', 'NONE',
--     act.CompleteSelectionOrOpenLinkAtMouseCursor('PrimarySelection'))
mouse_bind('Up', 1, 'Left', 'NONE',
  wezterm.action_callback(function(window, pane)
    -- Guard: if already in copy mode, do not re-enter (would reset overlay)
    if window:active_key_table() == 'copy_mode' then
      window:perform_action(
        act.CompleteSelection('PrimarySelection'), pane)
      return
    end
    local sel = window:get_selection_text_for_pane(pane)
    if sel ~= '' then
      -- Selection exists: complete to primary, then enter copy mode
      window:perform_action(
        act.CompleteSelection('PrimarySelection'), pane)
      window:perform_action(act.ActivateCopyMode, pane)
      -- Set Cell selection mode so y/Y immediately work on keyboard selection
      window:perform_action(
        act.CopyMode { SetSelectionMode = 'Cell' }, pane)
    else
      -- No selection: default behavior (open link at cursor)
      window:perform_action(
        act.CompleteSelectionOrOpenLinkAtMouseCursor('PrimarySelection'), pane)
    end
  end))
```

### What This Achieves

- After mouse selection, the user is **automatically in copy mode** with the `copy_mode` key table active
- `Cell` selection mode is immediately active, so pressing `y` will yank whatever is under/around the cursor
- The original mouse selection text is already in `PrimarySelection` (via `CompleteSelection` before copy mode entry)
- The copy mode key table is active, so all vim-style navigation keys (`hjkl`, `w`, `b`, `v`, `V`, `/`, etc.) work immediately

### What This Does NOT Achieve

- The original mouse selection is **not preserved** in copy mode. The user sees the copy mode overlay with a new cursor, not the highlighted mouse selection.
- Pressing `y` immediately after entering copy mode yanks the character at the cursor, not the original mouse selection. The user would need to visually re-select or use `Y` for the current line.
- The copy mode cursor position depends on where wezterm places it when creating the `CopyOverlay`, which is at the terminal's current cursor position (typically the bottom of the visible area or the last output position), not at the mouse selection endpoint.

### Fallback: "Already Copied" Notification

Because the selection text is already copied to `PrimarySelection` before entering copy mode, the user has a fast path:

1. Select text with mouse (auto-enters copy mode)
2. Realize the selection is not visible in copy mode
3. Press `q` to exit copy mode
4. Middle-click to paste (the text is in PrimarySelection)

Or if they want it in the system clipboard:

1. Select text with mouse (auto-enters copy mode, text goes to PrimarySelection)
2. Press `q` to exit
3. Use `Alt+C` to re-enter copy mode, navigate to the text, `v` to select, `y` to yank to clipboard

This is admittedly not a great UX. The primary value of this proposal is getting the user into copy mode quickly after a mouse selection, not preserving the selection itself.

### Alternative Considered: InputSelector Yank Menu

An alternative approach uses `InputSelector` (wezterm's built-in fuzzy picker) to present a menu after mouse selection:

```lua
-- After mouse selection, show a choice menu
window:perform_action(act.InputSelector {
  title = 'Selection Actions',
  choices = {
    { label = 'Yank to clipboard (y)' },
    { label = 'Enter copy mode (c)' },
    { label = 'Cancel (Escape)' },
  },
  action = wezterm.action_callback(function(window, pane, id, label)
    if label and label:match('^Yank') then
      window:perform_action(act.CopyTo('ClipboardAndPrimarySelection'), pane)
    elseif label and label:match('^Enter') then
      window:perform_action(act.ActivateCopyMode, pane)
    end
  end),
}, pane)
```

**Why not recommended:** The popup menu adds friction to every mouse selection. Most mouse selections are casual (reading, not copying). Forcing a menu choice on every selection would be disruptive. The callback approach (auto-enter copy mode) is less intrusive even though it cannot preserve the selection.

### Alternative Considered: Do Nothing (Status Quo)

Accept that mouse selection and copy mode are separate workflows. Use the mouse for quick selections with PrimarySelection, and use copy mode (Alt+C) for precise keyboard-driven selections.

**Why not recommended:** While the status quo is consistent and predictable, the gap it leaves (no keyboard operation on mouse selections) is a real workflow friction point. The partial workaround, despite its limitations, provides value: the mouse selection text is saved to PrimarySelection and the user lands in copy mode ready for keyboard navigation. Even without the original selection visible, this is faster than the manual Alt+C workflow.

### Recommendation

**Implement the workaround**, with the following revert criteria:

- **Revert to status quo if** `SetSelectionMode('Cell')` does not work reliably after `ActivateCopyMode` inside the callback AND the copy mode cursor consistently lands far from the mouse selection area (e.g., at the bottom of the terminal). In this case, the user would enter copy mode with no selection and no proximity to their intended text, which is worse than the status quo.
- **Keep the workaround if** either (a) `SetSelectionMode` works, giving the user an immediate Cell selection at the cursor, or (b) the cursor lands near the selection area, making it quick to navigate with `hjkl` to the desired position.

Additionally, **file an upstream feature request** on [wezterm/wezterm](https://github.com/wezterm/wezterm) for `ActivateCopyMode` to accept an optional initial selection range. This would enable the ideal behavior and make the workaround unnecessary.

## Important Design Decisions

### Decision 1: Use `action_callback` on mouse Up, not `act.Multiple`

**Decision:** Use `wezterm.action_callback` for the mouse Up binding rather than `act.Multiple`.

**Why:** `act.Multiple` constructs all actions at config load time. But we need conditional logic: only enter copy mode if text was actually selected. A bare mouse click (no drag) should not enter copy mode. `action_callback` defers to runtime where we can check `get_selection_text_for_pane`.

**Tradeoff:** Actions inside `action_callback` cannot be validated by `show-keys` -- they appear as `EmitEvent 'user-defined-N'`. Manual testing is required to verify correctness. This is consistent with the existing Escape binding in copy mode, which already uses `action_callback`.

### Decision 2: Complete selection to PrimarySelection BEFORE entering copy mode

**Decision:** Call `CompleteSelection('PrimarySelection')` before `ActivateCopyMode` in the callback.

**Why:** Once copy mode is entered, the mouse selection is lost. By completing the selection first, the text is saved to PrimarySelection regardless of what happens in copy mode. The user always has middle-click paste as a fallback.

### Decision 3: Set Cell selection mode immediately after entering copy mode

**Decision:** Call `SetSelectionMode('Cell')` after `ActivateCopyMode`.

**Why:** Without this, the user enters copy mode with no selection active. Pressing `y` would yank nothing. By setting Cell mode, at minimum the character at the cursor is selected, and the user can extend from there. This is closer to the "ready to operate" state the user expects.

**Risk:** `SetSelectionMode` dispatched via `perform_action` inside a callback may not work reliably if the `CopyOverlay` has not fully initialized by the time the callback continues executing. The action dispatch is synchronous in Lua but the overlay creation may involve async rendering. This needs empirical testing.

### Decision 4: Only trigger on streak=1 (single click release), not double/triple

**Decision:** Only the single-click Up binding gets the copy mode callback. Double-click (word select) and triple-click (line select) keep their existing behavior (complete to PrimarySelection only).

**Why:** Double and triple clicks are typically quick selection shortcuts where the user wants to grab a word or line and move on. Auto-entering copy mode after every double-click would be jarring. Single-click-drag is the deliberate selection gesture where copy mode entry is most useful.

**Open question:** Should double/triple click also enter copy mode? This could be made configurable in the future, but starting with single-click-drag only is the conservative choice.

### Decision 5: Recommend this as opt-in, with status quo as default

**Decision:** Document this as an optional enhancement in the config, with a clear comment explaining the limitation (selection not preserved). The user can enable/disable it by commenting out the callback binding.

**Why:** The partial workaround may not match all users' expectations. Making it opt-in with clear documentation lets the user decide whether the tradeoff is worthwhile.

## Edge Cases / Challenging Scenarios

### Single click (no drag) should not enter copy mode

The callback checks `get_selection_text_for_pane`. A single click without drag produces no selection (empty string), so the callback falls through to `CompleteSelectionOrOpenLinkAtMouseCursor`. Link clicking continues to work normally.

### Shift+click (extend selection) behavior

The current config has a separate Shift+click binding. This proposal does not modify it -- Shift+click continues to extend and complete to PrimarySelection without entering copy mode. Adding copy mode entry to Shift+click is possible but adds complexity and should be deferred.

### Interaction with running programs that capture mouse

When a program (e.g., vim, htop) captures mouse input, wezterm's mouse bindings are bypassed. The callback will not fire. This is correct behavior -- we do not want to enter copy mode when clicking inside a mouse-aware application.

### Copy mode already active when mouse selection occurs

If the user is already in copy mode and uses the mouse to select text, the callback includes a guard: `window:active_key_table() == 'copy_mode'` checks whether copy mode is already active. If so, the callback completes the selection to PrimarySelection and returns without calling `ActivateCopyMode` again. This prevents resetting the copy mode overlay and losing the user's current position.

> NOTE: Whether wezterm actually fires the mouse `Up` callback while the copy mode overlay is active needs empirical testing. The guard is a safety measure in case it does.

### Selection text is empty but selection is visually present

In rare cases (selecting only whitespace or empty cells), `get_selection_text_for_pane` may return an empty string even though cells are visually highlighted. In this case, the callback would not enter copy mode, which is acceptable behavior.

### Interaction with lace.wezterm plugin

The lace.wezterm plugin modifies `config.keys` and registers SSH domains but does not touch `config.mouse_bindings` or `config.key_tables`. No conflict.

### Wayland vs X11

`PrimarySelection` works on both Wayland (via `wp_primary_selection_unstable_v1`) and X11. No platform-specific handling needed, consistent with the existing mouse bindings.

## Test Plan

Follow the WezTerm TDD Validation Workflow from the dotfiles repo (`/home/mjr/code/personal/dotfiles/CLAUDE.md`).

### Phase 0: Capture baseline

```sh
wezterm show-keys --lua --key-table copy_mode > /tmp/wez_copy_mode_before.lua
wezterm show-keys --lua > /tmp/wez_keys_before.lua
```

### Phase 1: Validate config parses

After editing `dot_config/wezterm/wezterm.lua`:

```sh
wezterm --config-file dot_config/wezterm/wezterm.lua ls-fonts 2>/tmp/wez_stderr.txt 1>/dev/null
if grep -q ERROR /tmp/wez_stderr.txt; then
    echo "CONFIG ERROR:"; cat /tmp/wez_stderr.txt
else
    echo "Config parsed OK"
fi
```

### Phase 2: Verify bindings not silently dropped

```sh
wezterm --config-file dot_config/wezterm/wezterm.lua show-keys --lua --key-table copy_mode > /tmp/wez_copy_mode_after.lua
diff /tmp/wez_copy_mode_before.lua /tmp/wez_copy_mode_after.lua
```

The copy_mode key table should be unchanged (this proposal modifies mouse_bindings, not key_tables). If the diff shows the copy mode table reverted to defaults, the config has a parse error.

### Phase 3: Manual mouse selection tests

1. **Single click on a link:** Should open the link, NOT enter copy mode
2. **Single click on blank area:** Should do nothing special, NOT enter copy mode
3. **Click-drag to select text, release:** Should enter copy mode. Verify:
   - Title bar shows "Copy Mode" prefix
   - `y` yanks (something) to clipboard
   - `q` exits copy mode
   - The selected text is in PrimarySelection (middle-click to verify)
4. **Double-click (word select):** Should NOT enter copy mode. Word goes to PrimarySelection only.
5. **Triple-click (line select):** Should NOT enter copy mode. Line goes to PrimarySelection only.

### Phase 4: Copy mode interaction tests

1. Enter copy mode via `Alt+C`, then use mouse to select text. Observe behavior.
2. Mouse-select text (auto-enters copy mode), then `Escape` to clear, then navigate with `hjkl`, then `v` to select, then `y` to yank. Verify full workflow.
3. Mouse-select text (auto-enters copy mode), then `q` to exit. Middle-click to verify PrimarySelection has the mouse-selected text.

### Phase 5: Deploy and verify

```sh
chezmoi apply
tail -20 "$XDG_RUNTIME_DIR/wezterm/log" | grep -i error
wezterm cli list
```

### Phase 6: Empirical validation of `SetSelectionMode` timing

This is the highest-risk test. After mouse selection triggers copy mode entry:

1. Does `SetSelectionMode('Cell')` actually activate? (Check if the cursor shows a selection highlight)
2. If not, try adding a small delay or restructuring the callback
3. Document the result -- if `SetSelectionMode` does not work reliably in this context, remove it from the implementation and document the limitation

## Implementation Phases

### Phase 1: Add mouse Up callback

**Tasks:**
- Modify the existing `mouse_bind('Up', 1, 'Left', 'NONE', ...)` binding to use `action_callback` instead of `CompleteSelectionOrOpenLinkAtMouseCursor`
- Implement the selection detection and copy mode entry logic
- Add clear comments explaining the limitation (selection not preserved)

**Success criteria:**
- Config parses without errors (ls-fonts check)
- Single click still opens links
- Click-drag-release enters copy mode
- Mouse-selected text is in PrimarySelection

**Constraints:**
- Do NOT modify the existing copy_mode key table or other mouse bindings
- Do NOT modify any lace plugin code
- Keep the existing double-click and triple-click bindings unchanged

### Phase 2: Validate `SetSelectionMode` timing

**Tasks:**
- Test whether `SetSelectionMode('Cell')` works when called immediately after `ActivateCopyMode` in the callback
- If it does not work, try alternative approaches (e.g., deferring via a second `perform_action` call)
- If no approach works reliably, remove `SetSelectionMode` and document the limitation

**Success criteria:**
- Clear documentation of whether `SetSelectionMode` works in this context
- If it works: copy mode enters with Cell selection active
- If it does not: copy mode enters with no selection (user must press `v`)

### Phase 3: Add opt-in documentation

**Tasks:**
- Add a comment block above the mouse Up callback explaining:
  - What it does (enters copy mode after mouse selection)
  - What it does NOT do (preserve the mouse selection)
  - How to disable it (revert to the simple `CompleteSelectionOrOpenLinkAtMouseCursor` binding)
- Test the disable path (commenting out the callback, uncommenting the simple binding)

**Success criteria:**
- Clear inline documentation for future maintainers
- Easy toggle between enhanced and simple behavior

## Open Questions

1. **Does `SetSelectionMode` work reliably inside `action_callback` after `ActivateCopyMode`?** This is an empirical question that cannot be answered from documentation alone. The implementation agent must test this. If it does not work, the workaround degrades to "enter copy mode with no selection" -- evaluate against the revert criteria in the Recommendation section.

2. **Should double/triple click also enter copy mode?** Excluded from this proposal for simplicity, but could be added later if the single-click-drag UX proves valuable.

3. **Where does the copy mode cursor land relative to the mouse selection?** The CopyOverlay positions the cursor at the pane's terminal cursor, not the mouse position. If the terminal cursor is far from the scrollback region where the mouse selection was, the user will need significant `hjkl`/search navigation to return. This is the biggest UX risk and must be evaluated empirically.

> NOTE: The upstream feature request (for `ActivateCopyMode` to accept an initial selection range) is an explicit recommendation in the Proposed Solution section, not an open question.
