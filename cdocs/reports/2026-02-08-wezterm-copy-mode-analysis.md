---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:00:00-08:00
task_list: lace/dotfiles-wezterm
type: report
state: archived
status: done
tags: [wezterm, copy-mode, tmux, clipboard, vim, dotfiles, analysis]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:15:00-08:00
  round: 1
---

# Analysis: WezTerm Copy Mode vs tmux vi-copy Mode

> **BLUF:** WezTerm's copy mode already supports most core vim motions (h/j/k/l, w/b/e, 0/$, g/G, v/V/Ctrl-V) and can be heavily customized through `key_tables`. However, two key pain points exist: (1) mouse selection auto-copies to the system clipboard by default, which is fixable through `mouse_bindings` config, and (2) several advanced vim motions (%, text objects like `viw`/`vaw`, word vs WORD distinction) are missing from wezterm's copy mode engine and cannot be added through configuration alone. A plugin cannot fix these either since CopyMode actions are compiled into the wezterm binary. Config-level improvements can get roughly 85% of tmux vi-copy parity; the remaining gaps require upstream wezterm changes.

## Context

The user's wezterm config at `dotfiles/dot_config/wezterm/wezterm.lua` currently loads the default `copy_mode` key table without modifications. Copy mode is entered via `Alt+C`. The primary complaints are:

1. Mouse text selection auto-copies to clipboard (should only copy on explicit `y`)
2. Copy mode does not behave enough like tmux's vi-copy mode

## Key Findings

### 1. Auto-Copy-on-Select Behavior

**Default behavior:** When text is selected with the mouse and the button is released, wezterm fires `CompleteSelectionOrOpenLinkAtMouseCursor("ClipboardAndPrimarySelection")`. This copies the selection to both the system clipboard (Ctrl-V paste) and the X11 primary selection (middle-click paste).

**Root cause:** The default `mouse_bindings` for the `Up` event on left-click includes clipboard copy. All streak levels (single, double, triple click) and modifier combinations trigger copy.

**Fix available:** Override `mouse_bindings` to use `PrimarySelection` only (standard X11 behavior) or `Nop` (disable copy entirely). The recommended approach for Linux is `PrimarySelection` which preserves middle-click paste while preventing system clipboard pollution:

```lua
config.mouse_bindings = {
  -- Single click: PrimarySelection only (preserves link clicking)
  {
    event = { Up = { streak = 1, button = 'Left' } },
    mods = 'NONE',
    action = act.CompleteSelectionOrOpenLinkAtMouseCursor('PrimarySelection'),
  },
  -- Double click (word select): PrimarySelection only
  {
    event = { Up = { streak = 2, button = 'Left' } },
    mods = 'NONE',
    action = act.CompleteSelection('PrimarySelection'),
  },
  -- Triple click (line select): PrimarySelection only
  {
    event = { Up = { streak = 3, button = 'Left' } },
    mods = 'NONE',
    action = act.CompleteSelection('PrimarySelection'),
  },
}
```

**Related settings:**
- `selection_word_boundary` -- configures what characters delimit "words" for double-click selection. Default includes common punctuation. Not directly related to the copy behavior but worth noting for word selection tuning.

### 2. Copy Mode Default Key Bindings

WezTerm's built-in copy mode (activated by `ActivateCopyMode`, default `Ctrl+Shift+X`) provides these default bindings:

| Action | Default Keys | Vim Equivalent |
|--------|-------------|----------------|
| Exit copy mode | `Esc`, `Ctrl+C`, `Ctrl+G`, `q` | Same |
| Copy to clipboard + exit | `y` | `y` (yank) |
| Cell selection toggle | `v` | `v` (visual) |
| Line selection toggle | `Shift+V` | `V` (visual line) |
| Block selection toggle | `Ctrl+V` | `Ctrl+V` (visual block) |
| Move left/down/up/right | `h`/`j`/`k`/`l`, arrow keys | Same |
| Forward word | `w`, `Alt+Right`, `Tab` | `w` |
| Backward word | `b`, `Alt+Left`, `Shift+Tab` | `b` |
| Forward word end | `e` | `e` |
| Line start | `0`, `Home` | `0` |
| Line end (non-blank) | `^`, `Alt+M` | `^` |
| Line end | `$`, `End` | `$` |
| Next line start | `Enter` | `Enter` |
| Top of scrollback | `g` | `gg` |
| Bottom of scrollback | `Shift+G` | `G` |
| Viewport top/mid/bottom | `Shift+H`/`M`/`L` | `H`/`M`/`L` |
| Page up/down | `PageUp`/`PageDown`, `Ctrl+B`/`F` | Same |
| Half-page up/down | `Ctrl+U`/`D` | Same |
| Selection other end | `o` | `o` |
| Selection other end (horiz) | `Shift+O` | `O` |
| Search forward | `/` (enters EditPattern) | `/` |
| Search backward | `?` (enters EditPattern) | `?` |
| Next/prev search match | `n`/`Shift+N` | `n`/`N` |
| Jump forward to char | `f` | `f` |
| Jump backward to char | `Shift+F` | `F` |
| Jump forward before char | `t` | `t` |
| Jump backward after char | `Shift+T` | `T` |
| Repeat jump | `;` | `;` |
| Reverse jump | `,` | `,` |

**The `y` key binding by default does:**
```lua
act.Multiple {
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'ScrollToBottom' },
  { CopyMode = 'Close' },
}
```

### 3. Available CopyMode Actions

These are the `act.CopyMode` actions that can be used in key_tables:

**Movement:**
- `MoveLeft`, `MoveRight`, `MoveUp`, `MoveDown`
- `MoveForwardWord`, `MoveBackwardWord`, `MoveForwardWordEnd`
- `MoveToStartOfLine`, `MoveToStartOfLineContent`, `MoveToEndOfLineContent`
- `MoveToStartOfNextLine`
- `MoveToScrollbackTop`, `MoveToScrollbackBottom`
- `MoveToViewportTop`, `MoveToViewportMiddle`, `MoveToViewportBottom`
- `PageUp`, `PageDown`
- `MoveForwardSemanticZone`, `MoveBackwardSemanticZone`

**Selection:**
- `SetSelectionMode` -- values: `Cell`, `Word`, `Line`, `Block`, `SemanticZone`
- `ClearSelectionMode` -- clears selection mode but stays in copy mode
- `MoveToSelectionOtherEnd`, `MoveToSelectionOtherEndHoriz`

**Search (from copy mode):**
- `EditPattern` -- enters search pattern editor (transitions to `search_mode` key table)
- `AcceptPattern` -- accepts the current search pattern
- `ClearPattern` -- clears the search pattern
- `PriorMatch`, `NextMatch`
- `PriorMatchPage`, `NextMatchPage`

**Jump:**
- `JumpForward { prev_char = false }` -- jump to char (`f`)
- `JumpForward { prev_char = true }` -- jump before char (`t`)
- `JumpBackward { prev_char = false }` -- jump back to char (`F`)
- `JumpBackward { prev_char = true }` -- jump back after char (`T`)
- `JumpAgain` -- repeat last jump (`;`)
- `JumpReverse` -- reverse last jump (`,`)

**Lifecycle:**
- `Close` -- exit copy mode
- `ScrollToBottom` -- scroll to bottom of scrollback

### 4. Comparison with tmux vi-copy Mode

| Feature | tmux vi-copy | wezterm copy_mode | Gap? |
|---------|-------------|-------------------|------|
| Basic h/j/k/l movement | Yes | Yes | No |
| w/b/e word motion | Yes | Yes | No |
| 0/$/^ line motion | Yes | Yes | No |
| g/G scrollback bounds | Yes (`gg`/`G`) | Yes (`g`/`G`) | Minor: wezterm uses single `g` |
| H/M/L viewport | Yes | Yes | No |
| Ctrl-U/D half-page | Yes | Yes | No |
| Ctrl-B/F full page | Yes | Yes | No |
| v (visual mode) | Yes | Yes | No |
| V (visual line) | Yes | Yes | No |
| Ctrl-V (visual block) | Yes | Yes | No |
| y (yank) | Yes | Yes | No |
| o (swap selection end) | Yes | Yes | No |
| / (search forward) | Yes | Yes | No |
| ? (search backward) | Yes | Yes | No |
| n/N (next/prev match) | Yes | Yes | No |
| f/F/t/T (char jump) | Yes | Yes | No |
| ;/, (repeat/reverse jump) | Yes | Yes | No |
| % (match bracket) | Yes | **No** | **Yes -- cannot be added via config** |
| W/B/E (WORD motion) | Yes | **No** | **Yes -- w/b/e treats all non-blank as WORD** |
| viw/vaw (text objects) | Yes | **No** | **Yes -- no text object support** |
| vi"/va" (quote objects) | Yes | **No** | **Yes -- no text object support** |
| Ctrl-Y/Ctrl-E (scroll 1 line) | Yes | **No** | **Yes -- only page/half-page scroll** |
| Number prefix (e.g., `5j`) | Yes | **No** | **Yes -- no count prefix support** |
| `q` exits without copying | Yes | Yes | No |
| y copies and exits | Configurable | Yes (default) | No |
| Stays in copy mode after yank | Configurable | **Not default** (exits) | Configurable via key_tables |
| Search from cursor position | Yes | **Partial** | PR #6999 adds relative search |
| Copy to specific clipboard | N/A (uses tmux buffer + pipe) | Yes (`CopyTo` with target) | Different model |
| Semantic zone selection | No | Yes (`SemanticZone`) | wezterm advantage |

### 5. What Can Be Customized via Config

**Fully configurable (key_tables):**
- Remap any key to any available CopyMode action
- Chain multiple actions with `act.Multiple`
- Customize `y` to copy to specific clipboard targets
- Customize `y` to stay in copy mode instead of exiting
- Add `Escape` to clear selection before exiting
- Bind `/` and `?` to search forward/backward from copy mode
- Customize what `v` toggles (toggle vs set selection mode)

**Configurable (mouse_bindings):**
- Disable auto-copy-on-select
- Route mouse selection to PrimarySelection only
- Preserve link-clicking while disabling clipboard copy

**NOT configurable (hardcoded in wezterm binary):**
- No `%` bracket matching motion
- No `W`/`B`/`E` WORD motions (current w/b/e uses wezterm's own word boundary definition)
- No text objects (`viw`, `vaw`, `vi"`, etc.)
- No numeric count prefix (`5j`, `10w`, etc.)
- No single-line scroll (`Ctrl-Y`/`Ctrl-E`)
- No marks (`m`/`'`/`` ` ``)
- No registers

### 6. Existing Plugins and Tools

**wez-tmux** (github.com/sei40kr/wez-tmux):
- Ports tmux key bindings to wezterm (prefix key model)
- Includes copy mode bindings: `leader + [` enters copy mode
- Does NOT add new CopyMode actions -- uses the same built-in wezterm actions
- Primarily useful for the tmux-style prefix key workflow, not for copy mode improvements

**modal.wezterm** (github.com/MLFlexer/modal.wezterm):
- Adds vim-like modal keybindings for normal terminal use
- NOT related to copy mode
- Adds normal/insert mode switching for the terminal itself

**Neither plugin can add missing CopyMode actions** (bracket matching, text objects, count prefix). These would require changes to the wezterm binary itself.

### 7. Copy Mode Lifecycle Customization

The default `y` binding exits copy mode after yanking. This can be changed to mimic tmux behavior where you stay in copy mode after yanking:

```lua
-- Yank without exiting copy mode (like tmux default)
{
  key = 'y',
  mods = 'NONE',
  action = act.Multiple {
    { CopyTo = 'ClipboardAndPrimarySelection' },
    { CopyMode = 'ClearSelectionMode' },
  },
}
```

Or to yank and exit (vim-like, current default):
```lua
-- Yank and exit (current default)
{
  key = 'y',
  mods = 'NONE',
  action = act.Multiple {
    { CopyTo = 'ClipboardAndPrimarySelection' },
    { CopyMode = 'ScrollToBottom' },
    { CopyMode = 'Close' },
  },
}
```

### 8. Search Mode Integration

When `EditPattern` is triggered from copy mode (bound to `/` by default), wezterm transitions to the `search_mode` key table. This is a separate key table that handles text input for the search pattern. After pressing Enter (`AcceptPattern`), wezterm returns to the `copy_mode` key table.

**Known issue:** Transitioning from search mode back to copy mode always enters selection/visual mode. There is no clean way to search, accept, and return to "normal mode" (no selection) in copy mode. This is an upstream limitation (GitHub issue #5952).

## Analysis

### Achievability Assessment

| Improvement | Difficulty | Method |
|-------------|-----------|--------|
| Disable auto-copy-on-select | Easy | `mouse_bindings` config |
| Route mouse select to PrimarySelection only | Easy | `mouse_bindings` config |
| Customize y to copy to specific target | Easy | `key_tables` config |
| Stay in copy mode after y | Easy | `key_tables` config |
| Add `/`/`?` search from copy mode | Already default | Built-in |
| Ctrl-Y/Ctrl-E single line scroll | **Impossible** | No CopyMode action exists |
| Numeric count prefix | **Impossible** | No CopyMode support |
| `%` bracket matching | **Impossible** | No CopyMode action exists |
| `W`/`B`/`E` WORD motions | **Impossible** | Word boundary is hardcoded |
| Text objects (viw, vaw) | **Impossible** | No CopyMode support |
| Marks | **Impossible** | No CopyMode support |

### Plugin Feasibility

A wezterm plugin (including lace.wezterm) **cannot** add new CopyMode actions. The `act.CopyMode` actions are compiled into the wezterm binary. Plugins can only:

- Register custom events
- Modify config tables
- Add key bindings using existing actions
- Run Lua code in response to events

There is no plugin API to inject custom cursor movement logic into copy mode. This means copy mode improvements are strictly a **dotfiles config concern**, not a lace.wezterm plugin concern.

## Recommendations

1. **Immediate: Fix auto-copy-on-select** -- Override `mouse_bindings` to use `PrimarySelection` only on Linux. This is a 10-line config change.

2. **Immediate: Customize copy_mode key_tables** -- Build a complete custom `copy_mode` key table that starts from defaults and adds/modifies bindings for better tmux parity where possible.

3. **Do not attempt plugin-based solution** -- CopyMode actions are not extensible via plugins. Keep this as a dotfiles concern.

4. **Document known limitations** -- Add comments in the wezterm config noting which vim/tmux motions are unavailable upstream.

5. **Watch upstream** -- GitHub issues #4471 (additional vi-like keybindings) and #5952 (search/copy mode enhancements) track the most impactful missing features. Both are tagged "PR-welcome."

---

### Sources

- [WezTerm Copy Mode Documentation](https://wezterm.org/copymode.html)
- [WezTerm CopyTo Action](https://wezterm.org/config/lua/keyassignment/CopyTo.html)
- [WezTerm Mouse Binding Documentation](https://wezterm.org/config/mouse.html)
- [WezTerm SetSelectionMode](https://wezterm.org/config/lua/keyassignment/CopyMode/SetSelectionMode.html)
- [WezTerm ClearSelectionMode](https://wezterm.org/config/lua/keyassignment/CopyMode/ClearSelectionMode.html)
- [WezTerm EditPattern](https://wezterm.org/config/lua/keyassignment/CopyMode/EditPattern.html)
- [Disable copy on selection (Discussion #3760)](https://github.com/wezterm/wezterm/discussions/3760)
- [Complete selection without clipboard copy (Discussion #4024)](https://github.com/wezterm/wezterm/discussions/4024)
- [Copy to PrimarySelection only (Discussion #6199)](https://github.com/wezterm/wezterm/discussions/6199)
- [Additional vi-like keybindings (Issue #4471)](https://github.com/wezterm/wezterm/issues/4471)
- [Search/Copy Mode enhancements (Issue #5952)](https://github.com/wezterm/wezterm/issues/5952)
- [wez-tmux plugin](https://github.com/sei40kr/wez-tmux)
- [modal.wezterm plugin](https://github.com/MLFlexer/modal.wezterm)

*Report generated: 2026-02-08T10:00:00-08:00*
