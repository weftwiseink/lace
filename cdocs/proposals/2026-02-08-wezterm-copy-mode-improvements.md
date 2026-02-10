---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:30:00-08:00
task_list: lace/dotfiles-wezterm
type: proposal
state: archived
status: accepted
tags: [wezterm, copy-mode, tmux, clipboard, vim, dotfiles, keybindings]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T08:53:00-08:00
  round: 3
implementation_notes: |
  Full implementation complete (2026-02-09):
  - Phase 1: mouse_bindings with 6 PrimarySelection overrides via mouse_bind helper.
  - Phase 2: override_binding helper, y/Y/q overrides, Escape (action_callback
    approach preserved from prior partial implementation), search_mode passthrough.
  - config.key_tables uses individual assignment (copy_mode, search_mode) to
    avoid overwriting plugin-added key_tables.
  - Both deployed (~/.config/wezterm/wezterm.lua) and chezmoi source
    (dotfiles/dot_config/wezterm/wezterm.lua) are in sync.
  Implementation review: accepted with no blocking findings.
  Hotfix (2026-02-09): Replaced invalid { CopyMode = 'ScrollToBottom' } with
  { CopyMode = 'MoveToScrollbackBottom' } in y, Y, q, and Escape bindings.
  ScrollToBottom is not a valid CopyModeAssignment in wezterm 20240203.
  R3 review: accepted.
---

# WezTerm Copy Mode Improvements

> BLUF: Replace the current pass-through copy mode configuration in the personal wezterm config with two targeted changes: (1) override `mouse_bindings` to route mouse selection to X11 PrimarySelection only, preventing unwanted system clipboard pollution, and (2) define a complete custom `copy_mode` key table with vim/tmux-parity bindings for selection, yanking, and search navigation. All changes are purely dotfiles config -- the lace.wezterm plugin cannot extend CopyMode actions. The implementation is a single-file edit to the chezmoi-managed wezterm config.
>
> **Key Dependencies:**
> - [Copy Mode Analysis Report](../reports/2026-02-08-wezterm-copy-mode-analysis.md) -- research on wezterm copy mode capabilities and limitations
>
> **Scope:** This proposal is a dotfiles concern only. Changes apply to `dotfiles/dot_config/wezterm/wezterm.lua` (chezmoi source) and the deployed `~/.config/wezterm/wezterm.lua`.

## Objective

Improve the wezterm copy mode experience to behave more like tmux's vi-copy mode by:

1. **Stopping mouse selection from auto-copying to the system clipboard** -- selections should populate the X11 primary selection (middle-click paste) only, not the Ctrl-V clipboard
2. **Customizing the copy_mode key table** to provide explicit, vim-like yank behavior and better search integration

> NOTE: Several advanced vim/tmux motions are impossible to implement in wezterm copy mode. The `CopyMode` actions are compiled into the wezterm binary and cannot be extended by configuration or plugins. The following are **not achievable**: `%` bracket matching, `W`/`B`/`E` WORD motions, text objects (`viw`/`vaw`/`vi"`), numeric count prefix (`5j`), single-line scroll (`Ctrl-Y`/`Ctrl-E`), marks, and registers. See the [analysis report](../reports/2026-02-08-wezterm-copy-mode-analysis.md) for the full gap assessment. Upstream issues [#4471](https://github.com/wezterm/wezterm/issues/4471) and [#5952](https://github.com/wezterm/wezterm/issues/5952) track these gaps.

## Background

### Current State

The wezterm config at `dotfiles/dot_config/wezterm/wezterm.lua` loads the default `copy_mode` key table without modifications:

```lua
local copy_mode = nil
if wezterm.gui then
  copy_mode = wezterm.gui.default_key_tables().copy_mode
end

if copy_mode then
  config.key_tables = {
    copy_mode = copy_mode,
  }
end
```

Copy mode is entered via `Alt+C`. No `mouse_bindings` overrides exist.

### Problems

1. **Auto-copy-on-select:** When text is selected with the mouse and the button is released, wezterm fires `CompleteSelectionOrOpenLinkAtMouseCursor("ClipboardAndPrimarySelection")`. This copies the selection to both the system clipboard and the X11 primary selection. On Linux, this is unexpected -- the convention is that mouse selection populates the primary selection only, and explicit copy (Ctrl-C or `y` in copy mode) populates the clipboard.

2. **Copy mode lifecycle:** The default `y` binding yanks to `ClipboardAndPrimarySelection`, scrolls to bottom, and exits copy mode. This is reasonable but not configurable enough -- there is no way to yank a line (`Y`) or to clear the selection without exiting.

### Why Not a Plugin?

The [analysis report](../reports/2026-02-08-wezterm-copy-mode-analysis.md) established that wezterm plugins (including lace.wezterm) cannot add new `CopyMode` actions. The `act.CopyMode` actions are compiled into the wezterm binary. Plugins can only register events, modify config tables, and add key bindings using existing actions. There is no plugin API to inject custom cursor movement logic into copy mode.

This is purely a **dotfiles config concern**.

## Proposed Solution

### Part 1: Mouse Bindings Override

Add a `mouse_bindings` config that routes all mouse selection to `PrimarySelection` only. This covers single-click (with link detection), double-click (word select), triple-click (line select), and all modifier combinations:

```lua
-- =============================================================================
-- Mouse Bindings
-- Route mouse selection to PrimarySelection only (not system clipboard).
-- On Linux, the convention is: mouse select -> primary selection (middle-click),
-- explicit copy (Ctrl-C / y in copy mode) -> system clipboard.
-- =============================================================================

local function mouse_bind(dir, streak, button, mods, action)
  return {
    event = { [dir] = { streak = streak, button = button } },
    mods = mods,
    action = action,
  }
end

config.mouse_bindings = {
  -- Single click release: complete selection to primary, or open link
  mouse_bind('Up', 1, 'Left', 'NONE',
    act.CompleteSelectionOrOpenLinkAtMouseCursor('PrimarySelection')),
  -- Shift+click (extend selection): primary only
  mouse_bind('Up', 1, 'Left', 'SHIFT',
    act.CompleteSelectionOrOpenLinkAtMouseCursor('PrimarySelection')),
  -- Alt+click: primary only
  mouse_bind('Up', 1, 'Left', 'ALT',
    act.CompleteSelection('PrimarySelection')),
  -- Shift+Alt+click: primary only
  mouse_bind('Up', 1, 'Left', 'SHIFT|ALT',
    act.CompleteSelectionOrOpenLinkAtMouseCursor('PrimarySelection')),
  -- Double click (word select): primary only
  mouse_bind('Up', 2, 'Left', 'NONE',
    act.CompleteSelection('PrimarySelection')),
  -- Triple click (line select): primary only
  mouse_bind('Up', 3, 'Left', 'NONE',
    act.CompleteSelection('PrimarySelection')),
}
```

### Part 2: Custom copy_mode Key Table

Replace the current pass-through with an explicit, commented key table. The approach is to start from `wezterm.gui.default_key_tables().copy_mode` at runtime and then apply targeted overrides. This preserves future wezterm default additions while customizing the specific behaviors we care about.

```lua
-- =============================================================================
-- Copy Mode Customization
-- Vim/tmux-like copy mode keybindings.
-- Enter copy mode: Alt+C
-- Limitations (upstream wezterm): no %, no W/B/E, no text objects, no count
-- prefix, no Ctrl-Y/Ctrl-E scroll, no marks, no registers.
-- See: https://github.com/wezterm/wezterm/issues/4471
-- =============================================================================

local copy_mode = nil
local search_mode = nil
if wezterm.gui then
  copy_mode = wezterm.gui.default_key_tables().copy_mode
  search_mode = wezterm.gui.default_key_tables().search_mode
end

if copy_mode then
  -- Helper: find and replace a binding in the key table by key+mods
  local function override_binding(tbl, key, mods, new_action)
    for i, binding in ipairs(tbl) do
      if binding.key == key and binding.mods == (mods or 'NONE') then
        tbl[i].action = new_action
        return
      end
    end
    -- Not found -- append
    table.insert(tbl, { key = key, mods = mods or 'NONE', action = new_action })
  end

  -- y: yank to clipboard + primary, scroll to bottom, exit copy mode
  -- (Same as default, but explicit so it is clear and modifiable)
  override_binding(copy_mode, 'y', 'NONE', act.Multiple {
    { CopyTo = 'ClipboardAndPrimarySelection' },
    { CopyMode = 'ScrollToBottom' },
    { CopyMode = 'Close' },
  })

  -- Y: yank entire line (enter line mode, copy, exit)
  -- Selects the current line, copies, and exits.
  override_binding(copy_mode, 'Y', 'SHIFT', act.Multiple {
    { CopyMode = { SetSelectionMode = 'Line' } },
    { CopyTo = 'ClipboardAndPrimarySelection' },
    { CopyMode = 'ScrollToBottom' },
    { CopyMode = 'Close' },
  })

  -- Escape: clear selection first, then exit on second press.
  -- Default Escape exits immediately. This override clears selection mode
  -- if active, which is closer to vim behavior (Escape in visual -> normal).
  -- A second Escape (with no selection active) exits copy mode.
  override_binding(copy_mode, 'Escape', 'NONE', act.Multiple {
    { CopyMode = 'ClearSelectionMode' },
  })

  -- q: always exit copy mode (no selection, no copy)
  override_binding(copy_mode, 'q', 'NONE', act.Multiple {
    { CopyMode = 'ClearSelectionMode' },
    { CopyMode = 'ScrollToBottom' },
    { CopyMode = 'Close' },
  })

  config.key_tables = {
    copy_mode = copy_mode,
    search_mode = search_mode,
  }
end
```

> NOTE: The `Escape` override changes behavior from the default. By default, `Escape` exits copy mode entirely. With this change, `Escape` clears the active selection mode first (like pressing Escape in vim visual mode returns to normal mode). If no selection is active, `Escape` still keeps you in copy mode -- use `q` to exit. This is a deliberate tradeoff favoring the vim mental model. If this proves disorienting in practice, revert `Escape` to the default `Close` behavior.

### Part 3: Resulting Key Table Summary

After overrides, the effective copy mode bindings are:

**Movement (all from defaults, unchanged):**

| Key | Action |
|-----|--------|
| `h`/`j`/`k`/`l` | Move left/down/up/right |
| `w` | Forward word |
| `b` | Backward word |
| `e` | Forward word end |
| `0` | Start of line |
| `^` | First non-blank character |
| `$` | End of line |
| `g` | Top of scrollback |
| `G` | Bottom of scrollback |
| `H`/`M`/`L` | Viewport top/middle/bottom |
| `Ctrl+U`/`Ctrl+D` | Half-page up/down |
| `Ctrl+B`/`Ctrl+F` | Full page up/down |
| `f`/`F`/`t`/`T` | Jump to/before char forward/backward |
| `;`/`,` | Repeat/reverse char jump |

**Selection (defaults + overrides):**

| Key | Action | Source |
|-----|--------|--------|
| `v` | Toggle cell selection (visual mode) | Default |
| `V` | Toggle line selection (visual line) | Default |
| `Ctrl+V` | Toggle block selection (visual block) | Default |
| `o` | Jump to other end of selection | Default |
| `O` | Jump to other end (horizontal) | Default |

**Clipboard (overrides):**

| Key | Action | Source |
|-----|--------|--------|
| `y` | Yank selection to clipboard, scroll to bottom, exit | Override (explicit) |
| `Y` | Select current line, yank to clipboard, exit | **New** |

**Lifecycle (overrides):**

| Key | Action | Source |
|-----|--------|--------|
| `Escape` | Clear selection mode (stay in copy mode) | **Changed** |
| `q` | Clear selection, scroll to bottom, exit | Override (explicit) |
| `Ctrl+C` | Exit copy mode | Default |
| `Ctrl+G` | Exit copy mode | Default |

**Search (all from defaults, unchanged):**

| Key | Action |
|-----|--------|
| `/` | Search forward (enters search_mode) |
| `?` | Search backward (enters search_mode) |
| `n` | Next search match |
| `N` | Previous search match |

> NOTE: When returning from search mode to copy mode, wezterm always enters selection/visual mode. There is no way to search-then-navigate without a selection active. This is an upstream limitation tracked in [issue #5952](https://github.com/wezterm/wezterm/issues/5952). Pressing `Escape` (with the override above) will clear the selection, allowing navigation before starting a new selection with `v`.

## Important Design Decisions

### Decision 1: Override-from-defaults, not replace-from-scratch

**Decision:** Start from `wezterm.gui.default_key_tables().copy_mode` and apply targeted overrides rather than defining the entire key table from scratch.

**Rationale:**
- Preserves any new bindings added by future wezterm releases
- Keeps the config focused on what is actually customized
- Reduces maintenance burden -- we only own the delta
- The `override_binding` helper function makes the approach readable

**Tradeoff:** If wezterm changes a default binding we depend on, the override may silently become redundant or conflicting. Acceptable risk given wezterm's stable key table history.

### Decision 2: Escape clears selection instead of exiting

**Decision:** Map `Escape` to `ClearSelectionMode` instead of the default `Close`.

**Rationale:**
- Matches vim mental model: `Escape` in visual mode returns to normal mode, does not exit the buffer
- `q` provides the exit path (like `:q` in vim)
- `Ctrl+C` and `Ctrl+G` remain as additional exit paths
- Allows recovering from accidental selections without leaving copy mode

**Risk:** Users with deep Escape-to-exit muscle memory will find this disorienting. Mitigated by `q`, `Ctrl+C`, and `Ctrl+G` all still exiting.

### Decision 3: PrimarySelection for mouse, ClipboardAndPrimarySelection for y

**Decision:** Mouse selection goes to PrimarySelection only; `y` in copy mode goes to both clipboard and primary selection.

**Rationale:**
- Mouse selection is often incidental (selecting to read, not to copy). Populating the system clipboard loses whatever was previously copied with Ctrl-C.
- `y` in copy mode is an explicit intent to yank. Populating both clipboard and primary selection means the yanked text is available via both Ctrl-V and middle-click.
- This matches the tmux model: mouse select is passive, `y` is active.

### Decision 4: No lace.wezterm plugin involvement

**Decision:** Keep all copy mode changes in the personal dotfiles config. Do not add copy mode functionality to the lace.wezterm plugin.

**Rationale:**
- CopyMode actions cannot be extended by plugins (compiled into wezterm binary)
- Copy mode preferences are personal, not project-specific
- The lace.wezterm plugin's domain is devcontainer discovery and SSH domain management
- Mixing concerns would complicate the plugin for zero benefit

## Edge Cases

### Interaction with lace.wezterm plugin

The lace.wezterm plugin calls `apply_to_config(config, opts)` which may add key bindings to `config.keys` but does not touch `config.key_tables` or `config.mouse_bindings`. No conflict.

However, the current config sets `config.key_tables` in the Copy Mode section, after the lace plugin section. If the lace plugin ever adds its own `key_tables` entries (e.g., a custom picker key table), the `config.key_tables = { copy_mode = ... }` assignment would overwrite them. The fix is to use `config.key_tables = config.key_tables or {}` and then assign individual tables:

```lua
config.key_tables = config.key_tables or {}
config.key_tables.copy_mode = copy_mode
config.key_tables.search_mode = search_mode
```

This is a pre-existing bug in the current config (the `config.key_tables = { copy_mode = copy_mode }` assignment could overwrite plugin-added key tables) and should be fixed as part of this change.

### Wayland vs X11

On Wayland, there is no X11 primary selection in the traditional sense. However, wezterm's `PrimarySelection` target works on both Wayland (via `wp_primary_selection_unstable_v1` protocol) and X11. No platform-specific handling needed.

### search_mode key table

The `search_mode` key table is passed through from defaults without modification. We include it in the `config.key_tables` assignment to avoid accidentally dropping it when setting `copy_mode`. The search_mode defaults (Enter to accept, Escape to cancel, Ctrl-R for regex toggle) are sufficient.

## Test Plan

### Pre-Implementation Verification

1. Confirm current config location:
   ```bash
   ls -la ~/.config/wezterm/wezterm.lua
   # Should exist and match dotfiles source
   ```

2. Dump current copy mode bindings for comparison:
   ```bash
   wezterm show-keys --lua --key-table copy_mode > /tmp/copy_mode_before.lua
   ```

### Implementation Verification

1. After editing the chezmoi source, dry-run:
   ```bash
   chezmoi diff
   # Should show only wezterm.lua changes
   ```

2. Apply:
   ```bash
   chezmoi apply
   ```

3. Reload wezterm config (Leader+R or restart).

4. Test mouse selection:
   - Select text with mouse in terminal
   - Middle-click to paste: should work (PrimarySelection populated)
   - Ctrl+V in another app: should NOT have the selected text (system clipboard unchanged)

5. Test copy mode:
   - `Alt+C` to enter copy mode
   - `v` to start visual selection, `hjkl` to move, `y` to yank
   - Ctrl+V in another app: should have the yanked text
   - Middle-click: should also have the yanked text

6. Test Y (yank line):
   - `Alt+C` to enter copy mode
   - `Y` to yank the current line
   - Ctrl+V: should have the entire line

7. Test Escape behavior:
   - `Alt+C`, `v`, select some text
   - `Escape`: selection should clear, still in copy mode
   - `q`: should exit copy mode

8. Test search:
   - `Alt+C`, `/`, type search term, Enter
   - `n`/`N` to navigate matches
   - `Escape` to clear selection after search
   - `v` to start new selection, `y` to yank

### Post-Verification

1. Dump new copy mode bindings for diff:
   ```bash
   wezterm show-keys --lua --key-table copy_mode > /tmp/copy_mode_after.lua
   diff /tmp/copy_mode_before.lua /tmp/copy_mode_after.lua
   # Should show only the y, Y, Escape, q changes
   ```

## Implementation Phases

### Phase 1: Mouse Bindings (5 min)

**Tasks:**
- Add `mouse_bind` helper function to wezterm config
- Add `config.mouse_bindings` with all 6 PrimarySelection overrides
- Place after Core Settings section, before Keybindings section

**Success Criteria:**
- Mouse selection no longer copies to system clipboard
- Middle-click paste still works with mouse selection
- Link clicking still works on single click

### Phase 2: Copy Mode Key Table (10 min)

**Tasks:**
- Replace the current copy_mode pass-through with the override-from-defaults approach
- Add `override_binding` helper function
- Apply `y`, `Y`, `Escape`, and `q` overrides
- Include `search_mode` in `config.key_tables`
- Fix the `config.key_tables` assignment to not overwrite existing entries

**Success Criteria:**
- `y` yanks to clipboard and exits
- `Y` yanks current line and exits
- `Escape` clears selection (stays in copy mode)
- `q` exits copy mode cleanly
- All default bindings (h/j/k/l, v/V/Ctrl-V, w/b/e, f/t, /, ?) still work

### Phase 3: Smoke Test and Commit (5 min)

**Tasks:**
- Run all test plan checks
- Commit to dotfiles repo
- Verify `chezmoi apply` produces expected result

**Success Criteria:**
- All test plan checks pass
- `chezmoi diff` shows no drift

## Open Questions

1. **Should `Escape` clear selection or exit copy mode?**
   This proposal changes Escape to clear selection (vim mental model). If this proves disorienting in practice, revert to the default behavior. The user should try both and decide. (Recommendation: try the vim model first -- `q` is easy to reach for exiting.)

2. **Should `y` keep or exit copy mode?**
   The default (yank-and-exit) matches vim visual mode behavior. tmux defaults to staying in copy mode after yank. This proposal keeps the vim model (yank-and-exit). If the user frequently wants to yank multiple selections, consider adding a `Ctrl+Y` binding for yank-and-stay. (Recommendation: keep yank-and-exit for now.)

3. **Should we also customize `search_mode`?**
   The default search_mode bindings are functional. Customization could add Ctrl-N/Ctrl-P for next/prev match while still in the search editor, but this adds complexity for marginal benefit. (Recommendation: leave search_mode at defaults, revisit if pain appears.)

## Appendix: Files Modified

### Chezmoi Source (edit here)

```
/home/mjr/code/personal/dotfiles/dot_config/wezterm/wezterm.lua
```

### Deployed Config (via chezmoi apply)

```
~/.config/wezterm/wezterm.lua
```

### Not Modified

```
/home/mjr/code/weft/lace.wezterm/    -- plugin not involved
/var/home/mjr/code/weft/lace/        -- lace repo not involved
```
