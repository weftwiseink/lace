---
first_authored:
  by: "claude-opus-4-5"
  at: "2026-02-01T17:00:00-05:00"
type: report
subtype: analysis
state: live
status: done
tags: [wezterm, overlays, api-reference, inputselector, modal-ui]
---

# WezTerm Overlay System: Deep Technical Reference

This report provides a comprehensive reference for WezTerm's Rust overlay extension system. It covers every built-in overlay type, the underlying architecture, extensibility APIs, community patterns, and practical code examples for plugin authors.

## Table of Contents

1. [Overlay Architecture](#1-overlay-architecture)
2. [CharSelect](#2-charselect)
3. [PaneSelect](#3-paneselect)
4. [QuickSelect / QuickSelectArgs](#4-quickselect--quickselectargs)
5. [InputSelector](#5-inputselector)
6. [PromptInputLine](#6-promptinputline)
7. [Confirmation](#7-confirmation)
8. [Copy Mode](#8-copy-mode)
9. [Search Mode](#9-search-mode)
10. [Debug Overlay](#10-debug-overlay)
11. [Command Palette](#11-command-palette)
12. [Launcher Menu](#12-launcher-menu)
13. [augment-command-palette Event](#13-augment-command-palette-event)
14. [Composing Overlays with Key Tables](#14-composing-overlays-with-key-tables)
15. [Visual Appearance of Overlays](#15-visual-appearance-of-overlays)
16. [Community Patterns and Plugins](#16-community-patterns-and-plugins)
17. [Sources](#17-sources)

---

## 1. Overlay Architecture

### What Overlays Are

Overlays in WezTerm are modal UI panes that render on top of the terminal content within a tab. They intercept keyboard input, present their own rendering, and execute callbacks when the user makes a selection or provides input. Overlays are not terminal processes -- they are GUI-layer constructs that implement the `Pane` trait but exist only in the frontend, not in the multiplexer (mux) layer.

### Why Overlays Are GUI-Only

WezTerm's architecture separates the **mux layer** (session management, pane lifecycle, domain connections) from the **GUI frontend** (rendering, input handling, overlays). The `window:active_pane()` method can return overlay `Pane` objects that are invisible to `mux_window:active_pane()`. This means:

- Overlays cannot be triggered from `wezterm cli` commands.
- Overlays cannot be triggered from the mux server or remote multiplexer clients.
- Overlay state is ephemeral and per-GUI-window.
- The `wezterm connect` and `wezterm serial` subcommands interact with the mux, not the GUI overlay stack.

### Source Code Layout

The overlay implementation lives in the `wezterm-gui` crate, which is the standalone GUI application component. The key source directories and files:

| Path | Purpose |
|------|---------|
| `wezterm-gui/src/overlay/mod.rs` | Module definition, overlay type registration |
| `wezterm-gui/src/overlay/copy.rs` | Copy Mode and Search overlay |
| `wezterm-gui/src/overlay/quickselect.rs` | QuickSelect pattern matching overlay |
| `wezterm-gui/src/overlay/selector.rs` | InputSelector (fuzzy/alphabetic chooser) |
| `wezterm-gui/src/overlay/charselect.rs` | CharSelect (emoji/unicode picker) |
| `wezterm-gui/src/overlay/launcher.rs` | Launcher Menu overlay |
| `wezterm-gui/src/overlay/confirm.rs` | Confirmation dialog overlay |
| `wezterm-gui/src/overlay/prompt.rs` | PromptInputLine text input overlay |
| `wezterm-gui/src/termwindow/mod.rs` | TermWindow -- central coordinator, overlay state management |
| `wezterm-gui/src/termwindow/keyevent.rs` | Key event routing through modal key table stack |
| `wezterm-gui/src/termwindow/paneselect.rs` | PaneSelect overlay (rendered differently from other overlays) |
| `config/src/keyassignment.rs` | `KeyAssignment` enum defining overlay-triggering actions |

### The Overlay Stack

Each WezTerm GUI window maintains an overlay stack. When an overlay is activated, it pushes onto this stack and captures input. The topmost overlay receives all key events first. Key resolution follows the stack from top to bottom until a match is found.

Stack management is handled by `KeyTableState`, which supports:
- Timeout-based expiration
- One-shot activations (auto-pop after single keypress)
- Explicit `PopKeyTable` and `ClearKeyTableStack` actions
- `replace_current` to swap the top of stack

Known architectural constraints:
- Opening an `InputSelector` while another overlay is active could historically produce errors (fixed by @mikkasendke).
- Modal overlays like CharSelect and the command palette sometimes would not render when first activated until a keypress (fixed in nightly).
- The overlay stack is cleared when configuration is reloaded.

### How Overlays Implement the Pane Trait

Each overlay creates a synthetic `Pane` object that:
1. Renders its own content into the terminal cell grid (using the same rendering pipeline as real terminal panes).
2. Handles key input according to its own key table or internal key dispatch.
3. Reports its own dimensions and cursor state.
4. Is destroyed when dismissed (Escape, Ctrl+G, Ctrl+C, or selection).

This means overlays respect the same font rendering, color theming, and GPU acceleration as the rest of WezTerm.

---

## 2. CharSelect

### Overview

CharSelect activates a modal character picker for emoji, Unicode symbols, and NerdFont glyphs. It supports fuzzy search by name or hex codepoint, category browsing, and frecency-based "Recently Used" tracking.

**Default binding:** `CTRL+SHIFT+U`

### Visual Description

The CharSelect overlay fills the pane area with a searchable grid. At the top is a text input for fuzzy filtering. Below that, characters are displayed in a grid with their names. The currently selected group name appears as a header. Characters are shown at a larger size for visibility. The background and foreground colors are configurable.

### Configuration Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `copy_on_select` | boolean | `true` | Whether selecting copies to clipboard |
| `copy_to` | string | `'ClipboardAndPrimarySelection'` | Copy destination (same values as `CopyTo`) |
| `group` | string | `'RecentlyUsed'` | Pre-selected character group |

### Available Character Groups

- `RecentlyUsed` -- frecency-ordered recent selections
- `SmileysAndEmotion`
- `PeopleAndBody`
- `AnimalsAndNature`
- `FoodAndDrink`
- `TravelAndPlaces`
- `Activities`
- `Objects`
- `Symbols`
- `Flags`
- `NerdFonts`
- `UnicodeNames`

### Appearance Configuration (top-level config)

| Option | Since | Description |
|--------|-------|-------------|
| `char_select_fg_color` | 20230712 | Text color in CharSelect |
| `char_select_bg_color` | 20230712 | Background color in CharSelect |
| `char_select_font` | nightly | Font face override |
| `char_select_font_size` | nightly | Font size override |

### Key Bindings (hardcoded, not configurable)

| Key | Action |
|-----|--------|
| `UpArrow` / `DownArrow` | Navigate items |
| `Enter` | Accept, copy to clipboard, insert into pane |
| `Escape` / `CTRL+G` | Cancel |
| `CTRL+R` | Next character group |
| `CTRL+SHIFT+R` | Previous character group |
| `CTRL+U` | Clear input |

### Lua Example

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

-- Default CharSelect
config.keys = {
  { key = 'u', mods = 'CTRL|SHIFT', action = act.CharSelect },
}

-- CharSelect opening to NerdFonts, copying only to clipboard
config.keys = {
  {
    key = 'n',
    mods = 'LEADER',
    action = act.CharSelect {
      copy_on_select = true,
      copy_to = 'Clipboard',
      group = 'NerdFonts',
    },
  },
}

-- Appearance
config.char_select_fg_color = '#ffffff'
config.char_select_bg_color = '#1e1e2e'

return config
```

### Limitations

- Key bindings within CharSelect are hardcoded and cannot be remapped.
- CharSelect history/frecency was not persisted across restarts in older versions (fixed in nightly).
- Duplicate entries in CharSelect are now suppressed but were historically cluttered.
- Cannot use Input Method (IME) within CharSelect (issue #7173).

---

## 3. PaneSelect

### Overview

PaneSelect activates a pane selection mode that overlays large single- or two-character labels on each pane. The user types a label to select that pane. It supports multiple modes including activation, swapping, and moving panes.

**Default binding:** `CTRL+SHIFT+P` (for some configurations; no universal default)

### Visual Description

When activated, PaneSelect un-zooms the current tab to show all panes. Each pane receives a large overlay letter (default font size 36) from the alphabet. The labels are rendered prominently at the center of each pane using the `pane_select_font` or `window_frame.font`. Background terminal content remains visible but dimmed.

### Configuration Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `alphabet` | string | `quick_select_alphabet` value | Characters used for labels |
| `mode` | string | `'Activate'` | Selection mode |
| `show_pane_ids` | boolean | `false` | Show pane ID alongside label |

### Available Modes

| Mode | Behavior |
|------|----------|
| `'Activate'` | Focus the selected pane (default) |
| `'SwapWithActive'` | Swap positions; focus moves to selected pane's original position |
| `'SwapWithActiveKeepFocus'` | Swap positions; focus stays on the originally active pane |
| `'MoveToNewTab'` | Move selected pane to a new tab in same window |
| `'MoveToNewWindow'` | Move selected pane to a new window |

### Appearance Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `pane_select_font_size` | `36` | Font size for pane labels |
| `pane_select_font` | `window_frame.font` | Font face for pane labels |

### Lua Example

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

config.keys = {
  -- Default pane activation
  { key = '8', mods = 'CTRL', action = act.PaneSelect },

  -- Numeric labels
  {
    key = '9',
    mods = 'CTRL',
    action = act.PaneSelect { alphabet = '1234567890' },
  },

  -- Swap panes
  {
    key = '0',
    mods = 'CTRL',
    action = act.PaneSelect { mode = 'SwapWithActive' },
  },

  -- Swap keeping focus
  {
    key = '{',
    mods = 'LEADER|SHIFT',
    action = act.PaneSelect { mode = 'SwapWithActiveKeepFocus' },
  },

  -- Show pane IDs for debugging
  {
    key = 'i',
    mods = 'LEADER',
    action = act.PaneSelect { show_pane_ids = true },
  },
}

return config
```

### Key Table Interaction

PaneSelect does not use a key table. It renders directly, waits for a single label input, and dismisses itself. Escape and Ctrl+G cancel.

### Zoom Behavior

PaneSelect automatically un-zooms the current tab to reveal all panes, then re-zooms after the action completes.

### Limitations

- No user-configurable foreground/background colors exposed yet (CharSelect got its own color options because it was reusing PaneSelect colors).
- Labels are limited to the alphabet characters; with many panes, two-character labels are generated.
- No callback mechanism; PaneSelect performs a fixed action per mode.

---

## 4. QuickSelect / QuickSelectArgs

### Overview

QuickSelect scans the terminal scrollback for text matching configurable regex patterns (URLs, file paths, git hashes, IP addresses, numbers, etc.), highlights matches, and assigns short alphabetic prefixes. Typing the prefix copies (and optionally pastes) the matched text.

**Default binding:** `CTRL+SHIFT+SPACE`

### Visual Description

When activated, the entire visible terminal content (plus configurable scrollback lines) is scanned. Matched text is highlighted with configurable background/foreground colors. Each match receives a one- or two-character prefix label rendered at the start of the match. A status bar at the bottom of the pane shows instructions. Typing a label in lowercase copies; typing it in uppercase copies AND pastes.

### QuickSelect (Simple Form)

```lua
{ key = 'Space', mods = 'CTRL|SHIFT', action = act.QuickSelect }
```

Activates QuickSelect with global configuration: `quick_select_patterns` and `quick_select_alphabet`.

### QuickSelectArgs (Parameterized Form)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `patterns` | table of strings | global patterns | Regex patterns to match (completely overrides defaults) |
| `alphabet` | string | `quick_select_alphabet` | Characters for label generation |
| `action` | KeyAssignment | copy to clipboard | Action to perform instead of clipboard copy |
| `skip_action_on_paste` | boolean | `false` | Whether `action` runs on uppercase (paste) selection |
| `label` | string | `'copy'` | Text shown in overlay footer |
| `scope_lines` | number | `1000` | Lines above/below viewport to search |

### Global Configuration

| Option | Description |
|--------|-------------|
| `quick_select_alphabet` | Alphabet for label generation (default: `'asdfqwerzxcvjklmiuopghtybn'`) |
| `quick_select_patterns` | Additional regex patterns appended to built-in defaults |
| `quick_select_remove_styling` | (nightly) Remove all color/styling before matching |

### Color Configuration (in `config.colors`)

| Key | Default | Description |
|-----|---------|-------------|
| `quick_select_label_bg` | `{ Color = 'peru' }` | Background of prefix labels |
| `quick_select_label_fg` | `{ Color = '#ffffff' }` | Foreground of prefix labels |
| `quick_select_match_bg` | `{ AnsiColor = 'Navy' }` | Background of matched text |
| `quick_select_match_fg` | `{ Color = '#ffffff' }` | Foreground of matched text |

### Lua Examples

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

-- Add custom patterns to global config
config.quick_select_patterns = {
  -- Match Kubernetes pod names
  '[a-z]+-[a-z0-9]+-[a-z0-9]+',
  -- Match Docker container IDs (12+ hex chars)
  '[0-9a-f]{12,64}',
}

-- URL-only quick select with custom action
config.keys = {
  {
    key = 'o',
    mods = 'LEADER',
    action = act.QuickSelectArgs {
      label = 'open url',
      patterns = { 'https?://\\S+' },
      skip_action_on_paste = true,
      action = wezterm.action_callback(function(window, pane)
        local url = window:get_selection_text_for_pane(pane)
        wezterm.log_info('opening: ' .. url)
        wezterm.open_with(url)
      end),
    },
  },
}

-- Custom colors
config.colors = {
  quick_select_label_bg = { Color = '#ff6e6e' },
  quick_select_label_fg = { Color = '#000000' },
  quick_select_match_bg = { Color = '#3e4452' },
  quick_select_match_fg = { Color = '#e5c07b' },
}

return config
```

### Key Table Interaction

QuickSelect does not use a key table. Input is captured directly. Typing a label selects the match; `Escape` cancels.

### Limitations

- The `action` callback receives the selected text via `window:get_selection_text_for_pane(pane)`, not as a direct parameter.
- Patterns completely override defaults when specified in `QuickSelectArgs`; there is no append mode per-invocation.
- Cannot customize the "copy" / "paste" behavior separately in `QuickSelectArgs`.

---

## 5. InputSelector

### Overview

InputSelector presents a list of choices for the user to select from, with support for both alphabetic quick-select labels and fuzzy finding. It is the most extensible overlay for plugin authors because choices can be dynamically built from any Lua-accessible data source.

**Available since:** 20230408-112425-69ae8472

### Visual Description

The InputSelector renders as a full-pane overlay. In default mode, each choice is displayed with a numeric/alphabetic prefix label on the left and the label text on the right. A description bar at the bottom shows usage hints. In fuzzy mode, a text input appears at the top, and choices filter in real-time as the user types.

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | yes | -- | Title shown at top of overlay |
| `choices` | table | yes | -- | Array of choice objects |
| `action` | callback | yes | -- | `wezterm.action_callback(function(window, pane, id, label) ... end)` |
| `fuzzy` | boolean | no | `false` | Start in fuzzy-finding mode |
| `alphabet` | string | no | `'1234567890abcdefghilmnopqrstuvwxyz'` | Characters for quick-select labels |
| `description` | string | no | `'Select an item and press Enter = accept, Esc = cancel, / = filter'` | Text shown in default mode |
| `fuzzy_description` | string | no | (same as description) | Text shown in fuzzy mode |

Note: `description` and `fuzzy_description` were added in version 20240127-113634-bbcac864. Both support `wezterm.format` for styled text.

### Choice Object Structure

```lua
{
  label = 'Display text',       -- required: shown to user
  id = 'programmatic_value',    -- optional: passed to callback
}
```

If `id` is omitted, the callback receives the `label` as both `id` and `label`. The `label` field supports styled text via `wezterm.format`:

```lua
{
  label = wezterm.format {
    { Foreground = { AnsiColor = 'Green' } },
    { Text = 'active: ' },
    { Foreground = { Color = '#ffffff' } },
    { Text = 'my-workspace' },
  },
  id = '/home/user/projects/my-workspace',
}
```

### Callback Signature

```lua
wezterm.action_callback(function(window, pane, id, label)
  -- window: Window object
  -- pane: Pane object
  -- id: selected choice's id (nil if cancelled)
  -- label: selected choice's label (nil if cancelled)
  if not id then
    -- User pressed Escape/Ctrl+C
    return
  end
  -- Handle selection
end)
```

### Built-in Key Bindings

| Key | Action |
|-----|--------|
| `1`-`9`, alphabet chars | Quick-select by label prefix |
| `/` | Enter fuzzy mode (from default mode) |
| `Backspace` | Delete filter char; exit fuzzy mode if filter empty |
| `Enter`, Left Click | Accept current selection |
| `DownArrow`, `CTRL+N`, `CTRL+J`, `j` | Move down |
| `UpArrow`, `CTRL+P`, `CTRL+K`, `k` | Move up |
| `CTRL+G`, `CTRL+C`, `Escape` | Cancel |

### Color Configuration (in `config.colors`)

| Key | Description |
|-----|-------------|
| `input_selector_label_bg` | Background color of selection labels |
| `input_selector_label_fg` | Foreground color of selection labels |

### Fuzzy vs. Alphabetic Selection Modes

**Default mode (alphabetic):**
- Each choice gets a prefix from the `alphabet` string.
- Single character for small lists; two characters for larger lists.
- Typing the prefix immediately selects. `j`/`k` are excluded from the default alphabet to allow vim-style navigation.
- `/` switches to fuzzy mode.

**Fuzzy mode:**
- A text input captures keystrokes.
- Choices are filtered and ranked by fuzzy match score.
- `Enter` selects the highlighted match.
- `Backspace` on empty filter returns to default mode (if `fuzzy` was not `true` at start).

When `fuzzy = true`, the overlay opens directly in fuzzy mode and pressing Backspace on an empty filter does not exit to default mode.

### Dynamically Building Choice Lists

The power of InputSelector for plugins comes from building choices at bind time using `wezterm.action_callback`:

```lua
local wezterm = require 'wezterm'
local act = wezterm.action

config.keys = {
  {
    key = 'w',
    mods = 'LEADER',
    action = wezterm.action_callback(function(window, pane)
      -- Dynamically build choices from mux state
      local choices = {}
      for _, name in ipairs(wezterm.mux.get_workspace_names()) do
        table.insert(choices, { label = name, id = name })
      end

      window:perform_action(
        act.InputSelector {
          title = 'Switch Workspace',
          choices = choices,
          fuzzy = true,
          fuzzy_description = wezterm.format {
            { Attribute = { Intensity = 'Bold' } },
            { Foreground = { Color = '#aaffaa' } },
            { Text = 'Workspace: ' },
          },
          action = wezterm.action_callback(function(inner_window, inner_pane, id, label)
            if not id then return end
            inner_window:perform_action(
              act.SwitchToWorkspace { name = id },
              inner_pane
            )
          end),
        },
        pane
      )
    end),
  },
}
```

### Full Example: Theme Switcher

```lua
local wezterm = require 'wezterm'
local act = wezterm.action

config.keys = {
  {
    key = 't',
    mods = 'LEADER',
    action = wezterm.action_callback(function(window, pane)
      local schemes = wezterm.get_builtin_color_schemes()
      local choices = {}
      for name, _ in pairs(schemes) do
        table.insert(choices, { label = name })
      end
      table.sort(choices, function(a, b) return a.label < b.label end)

      window:perform_action(
        act.InputSelector {
          title = 'Color Scheme',
          choices = choices,
          fuzzy = true,
          action = wezterm.action_callback(function(inner_window, inner_pane, id, label)
            if not label then return end
            inner_window:set_config_overrides { color_scheme = label }
          end),
        },
        pane
      )
    end),
  },
}
```

### Limitations

- The `augment-command-palette` event handler runs synchronously; if you build an InputSelector in it, the choices must be precomputed.
- Key bindings within InputSelector are hardcoded (no custom key table).
- Upper-case alphabet labels are supported since PR #4227 but may not be available in all stable releases.

---

## 6. PromptInputLine

### Overview

PromptInputLine activates a single-line text input overlay. When the user submits the input, a callback receives the text. This is the primary mechanism for interactive renaming, workspace creation, and any workflow needing freeform text from the user.

**Availability:** Stable (description, action). Nightly-only (prompt, initial_value).

### Visual Description

The overlay renders a description at the top of the pane area (supporting styled text), followed by a text input line with a configurable prompt string. The cursor blinks in the input field. The rest of the pane content is hidden behind the overlay background.

### Configuration Fields

| Field | Type | Required | Since | Description |
|-------|------|----------|-------|-------------|
| `description` | string | yes | stable | Text at top of overlay; supports `wezterm.format` |
| `action` | callback | yes | stable | `function(window, pane, line)` |
| `prompt` | string | no | nightly | Prompt text before input; supports `wezterm.format`. Default: `'> '` |
| `initial_value` | string | no | nightly | Pre-fill the input field |

### Callback Signature

```lua
wezterm.action_callback(function(window, pane, line)
  -- line: string if user submitted, nil if cancelled (Escape/Ctrl+C)
  if line then
    -- use line
  end
end)
```

### Lua Examples

**Tab Renaming:**

```lua
local wezterm = require 'wezterm'
local act = wezterm.action

config.keys = {
  {
    key = 'r',
    mods = 'LEADER',
    action = act.PromptInputLine {
      description = 'Enter new tab name:',
      action = wezterm.action_callback(function(window, pane, line)
        if line then
          window:active_tab():set_title(line)
        end
      end),
    },
  },
}
```

**Workspace Creation with Styled Prompt:**

```lua
config.keys = {
  {
    key = 'W',
    mods = 'LEADER|SHIFT',
    action = act.PromptInputLine {
      description = wezterm.format {
        { Attribute = { Intensity = 'Bold' } },
        { Foreground = { AnsiColor = 'Fuchsia' } },
        { Text = 'Enter workspace name:' },
      },
      prompt = wezterm.format {
        { Foreground = { Color = '#aaffaa' } },
        { Text = 'workspace > ' },
      },
      initial_value = 'my-project',
      action = wezterm.action_callback(function(window, pane, line)
        if line then
          window:perform_action(
            act.SwitchToWorkspace { name = line, spawn = { cwd = wezterm.home_dir } },
            pane
          )
        end
      end),
    },
  },
}
```

### Key Table Interaction

PromptInputLine does not use a key table. It captures all key input directly. Standard text editing keys work (backspace, cursor movement). Escape and Ctrl+C cancel.

### Limitations

- `prompt` and `initial_value` are nightly-only as of this writing.
- Cannot use Input Method (IME) for CJK input within PromptInputLine (issue #7173).
- No multi-line input support.
- No input validation callback; validation must happen in the action callback after submission.

---

## 7. Confirmation

### Overview

Confirmation displays a yes/no dialog overlay with a customizable message. It provides separate callbacks for acceptance and cancellation.

**Availability:** Nightly builds only.

### Visual Description

The Confirmation overlay renders a message in the pane area (supporting styled text via `wezterm.format`) with "Yes" and "No" options. The user navigates and selects using keyboard input.

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `message` | string | no | `'Really continue?'` | Confirmation text; supports `wezterm.format` |
| `action` | callback | yes | -- | Called on "Yes"; `function(window, pane)` |
| `cancel` | callback | no | -- | Called on "No"/dismiss; `function(window, pane)` |

### Lua Example

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

config.keys = {
  {
    key = 'Q',
    mods = 'LEADER|SHIFT',
    action = act.Confirmation {
      message = wezterm.format {
        { Foreground = { AnsiColor = 'Red' } },
        { Attribute = { Intensity = 'Bold' } },
        { Text = 'Close all panes in this tab?' },
      },
      action = wezterm.action_callback(function(window, pane)
        window:perform_action(act.CloseCurrentTab { confirm = false }, pane)
      end),
      cancel = wezterm.action_callback(function(window, pane)
        wezterm.log_info 'Tab close cancelled'
      end),
    },
  },
}

return config
```

### Chaining with Other Overlays

Confirmation can gate destructive operations that then trigger another overlay:

```lua
action = act.Confirmation {
  message = 'Restart workspace? This will close all panes.',
  action = wezterm.action_callback(function(window, pane)
    -- After confirmation, show workspace selector
    window:perform_action(
      act.InputSelector {
        title = 'Select workspace to restart',
        choices = { ... },
        action = wezterm.action_callback(function(w, p, id, label) ... end),
      },
      pane
    )
  end),
}
```

### Limitations

- Nightly-only; not available in stable releases.
- Cannot customize the "Yes"/"No" labels or add additional options.
- The `cancel` callback does not distinguish between "No" selection and Escape dismissal.

---

## 8. Copy Mode

### Overview

Copy Mode provides vim-style keyboard-driven text selection and copying within the terminal scrollback. It uses the `copy_mode` key table for all bindings.

**Default binding:** `CTRL+SHIFT+X`

### Visual Description

Copy Mode renders an overlay that shows the terminal scrollback with a visible cursor. The cursor can be moved using vim-style motions. Selected text is highlighted. A status indicator appears showing the current selection mode (Cell, Line, Block). The colors of the active and inactive highlights are configurable.

### Color Configuration (in `config.colors`)

| Key | Description |
|-----|-------------|
| `copy_mode_active_highlight_bg` | Background of actively selected text |
| `copy_mode_active_highlight_fg` | Foreground of actively selected text |
| `copy_mode_inactive_highlight_bg` | Background of previous selections |
| `copy_mode_inactive_highlight_fg` | Foreground of previous selections |

### Default Key Bindings (Partial)

| Category | Key | Action |
|----------|-----|--------|
| **Enter/Exit** | `CTRL+SHIFT+X` | Activate Copy Mode |
| | `y` | Copy selection and exit |
| | `Escape`, `CTRL+C`, `CTRL+G`, `q` | Exit without copying |
| **Selection** | `v` | Toggle Cell selection |
| | `SHIFT+V` | Line selection |
| | `CTRL+V` | Block/rectangular selection |
| | `o`, `SHIFT+O` | Move to other end of selection |
| **Movement** | `h`/`j`/`k`/`l` | Left/Down/Up/Right |
| | Arrow keys | Left/Down/Up/Right |
| | `w` | Forward word |
| | `b` | Backward word |
| | `e` | End of word |
| | `0`, `Home` | Start of line |
| | `^`, `ALT+M` | First non-blank character |
| | `$`, `End` | End of line |
| | `Enter` | Start of next line |
| **Scrolling** | `g` | Top of scrollback |
| | `SHIFT+G` | Bottom of scrollback |
| | `SHIFT+H` / `SHIFT+M` / `SHIFT+L` | Viewport top/middle/bottom |
| | `PageUp`, `CTRL+B` | Page up |
| | `PageDown`, `CTRL+F` | Page down |
| | `CTRL+U` / `CTRL+D` | Half-page up/down |
| **Search** | `/` | Enter search (EditPattern) |
| | `n` | Next match |
| | `SHIFT+N` | Previous match |
| **Jump** | `f` | Jump forward to character |
| | `SHIFT+F` | Jump backward to character |
| | `t` | Jump forward before character |
| | `SHIFT+T` | Jump backward before character |
| | `;` | Repeat jump |
| | `,` | Reverse jump |

### Customizing Copy Mode

You can extend the defaults rather than replacing them entirely:

```lua
local wezterm = require 'wezterm'
local act = wezterm.action

local copy_mode = wezterm.gui.default_key_tables().copy_mode

-- Add custom bindings
table.insert(copy_mode, { key = 'y', mods = 'NONE', action = act.Multiple {
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'Close' },
}})

config.key_tables = {
  copy_mode = copy_mode,
}
```

To view your current version's full defaults:

```bash
wezterm show-keys --lua --key-table copy_mode
```

### Key Table Interaction

Copy Mode uses the `copy_mode` key table. This is a named key table that is pushed onto the key table stack when Copy Mode is activated. The key table is popped when Copy Mode exits. Within Copy Mode, pressing `/` transitions to the `search_mode` key table (see Search Mode below).

### Limitations

- No support for vim text objects (e.g., `ciw`, `da"`).
- Block selection does not support non-rectangular selections.
- Cannot extend with custom vim-style operators.

---

## 9. Search Mode

### Overview

Search Mode activates a search overlay that highlights matches in the terminal scrollback. It integrates with Copy Mode via the `search_mode` key table.

**Default binding:** `CTRL+SHIFT+F` (standalone) or `/` from within Copy Mode

### Visual Description

When activated, a search bar appears at the bottom of the pane. Typing populates the search pattern and highlights matching text throughout the visible terminal and scrollback. The number of matches is displayed in the search bar. The bottom-most match is selected and scrolled into view.

### Key Bindings (default `search_mode` key table)

| Key | Action |
|-----|--------|
| `Enter`, `UpArrow`, `CTRL+P` | Previous match |
| `CTRL+N`, `DownArrow` | Next match |
| `CTRL+R` | Cycle match mode: case-sensitive -> case-insensitive -> regex |
| `Escape` | Cancel search, keep viewport position |
| `CTRL+U` | Clear search pattern |

### Customizing Search Mode

```lua
local search_mode = wezterm.gui.default_key_tables().search_mode

config.key_tables = {
  search_mode = search_mode,
}
```

To view defaults:

```bash
wezterm show-keys --lua --key-table search_mode
```

### Transitioning Between Copy and Search

From Copy Mode, `/` triggers `CopyMode('EditPattern')` which pushes the `search_mode` key table. There is a known issue (#3746) where `EditPattern` should pop the `copy_mode` key table when transitioning to `search_mode`.

### Limitations

- Search does not persist across sessions (issue #1912 requests remembering last search term).
- No support for multi-line pattern matching.
- Regex mode uses the Rust `regex` crate syntax, not PCRE.

---

## 10. Debug Overlay

### Overview

The Debug Overlay provides a log viewer and interactive Lua REPL. It is primarily a troubleshooting and prototyping tool.

**Default binding:** `CTRL+SHIFT+L`
**Available since:** 20210814-124438-54e29167

### Visual Description

The Debug Overlay fills the current pane with two sections: the upper area displays recent log messages (errors, warnings, info) from WezTerm's internal logging system. The lower area provides a Lua REPL prompt where you can type and execute Lua expressions.

### Pre-loaded Globals

| Global | Type | Description |
|--------|------|-------------|
| `wezterm` | module | The complete wezterm Lua module |
| `window` | object | The current Window object |

### REPL Features

- Command history is persisted across overlay activations.
- `CTRL+R` searches history (like Bash).
- Up arrow cycles through previous commands.
- Any valid Lua expression can be evaluated.
- You can explore WezTerm APIs interactively: inspect color schemes, query window configuration, test `wezterm.format` output, etc.

### Lua Example

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()

config.keys = {
  -- Custom binding (default CTRL+SHIFT+L may conflict with other tools)
  {
    key = 'd',
    mods = 'LEADER',
    action = wezterm.action.ShowDebugOverlay,
  },
}

-- If you disable all defaults, always keep the debug overlay bound
-- config.disable_default_key_bindings = true

return config
```

### Exiting

Press `Escape` or `CTRL+D` to close the Debug Overlay.

### Limitations

- The Lua REPL context is **isolated** -- it cannot dynamically assign event handlers or modify global application state.
- It is for prototyping and inspection only, not for runtime configuration changes.
- No tab completion (issue #6866 requests this).
- Output from iterating over large tables can be broken (issue #3894).

---

## 11. Command Palette

### Overview

The Command Palette is a modal fuzzy-finder overlay that shows all available actions, ranked by frecency. Users can type to filter and select commands. It is the primary discoverability mechanism for WezTerm's key assignments.

**Default binding:** `CTRL+SHIFT+P`
**Available since:** 20230320-124340-559cb7b0

### Visual Description

The Command Palette renders as a full-pane overlay with a text input at the top and a scrollable list of commands below. Each command shows its description, associated key binding (rendered according to `ui_key_cap_rendering`), and an optional icon. Commands are ranked by frecency, and typing narrows the list by fuzzy match score.

### Appearance Configuration

| Option | Description |
|--------|-------------|
| `command_palette_font` | Font face for palette text |
| `command_palette_font_size` | Font size |
| `command_palette_fg_color` | Text color |
| `command_palette_bg_color` | Background color |
| `command_palette_rows` | Number of visible rows |
| `ui_key_cap_rendering` | How key caps are displayed (e.g., `'Super'`, `'Emacs'`, `'UnixLong'`) |

### Key Bindings Within the Palette

| Key | Action |
|-----|--------|
| Type text | Fuzzy filter commands |
| `UpArrow` / `DownArrow` | Navigate items |
| `Enter` | Execute selected command |
| `CTRL+U` | Clear filter |
| `Escape` | Close palette |

### Lua Example

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()

config.command_palette_bg_color = '#1e1e2e'
config.command_palette_fg_color = '#cdd6f4'
config.command_palette_font = wezterm.font('JetBrains Mono')
config.command_palette_font_size = 14.0
config.command_palette_rows = 14

config.keys = {
  {
    key = 'P',
    mods = 'CTRL|SHIFT',
    action = wezterm.action.ActivateCommandPalette,
  },
}

return config
```

### Extending via `augment-command-palette`

See [section 13](#13-augment-command-palette-event) for the event-based extension API.

### Key Table Interaction

The Command Palette does not use a user-configurable key table. Its internal keybindings are hardcoded.

### Limitations

- Frecency ranking is not configurable.
- Cannot hide specific built-in commands from the palette.
- The `augment-command-palette` event handler is synchronous and fires every time the palette opens.
- Custom entries cannot specify a `label` field for key binding association (issue #4622).
- If multiple plugins register `augment-command-palette`, only the last handler's entries appear (the event does not aggregate handlers).

---

## 12. Launcher Menu

### Overview

The Launcher Menu is an overlay that displays launchable items: configured `launch_menu` entries, tabs, domains, workspaces, and key assignments. It supports fuzzy filtering.

**Default trigger:** Right-click on the `+` new tab button
**Key assignment:** `ShowLauncher` or `ShowLauncherArgs`

### Configuration

`ShowLauncherArgs` accepts:

| Field | Type | Description |
|-------|------|-------------|
| `flags` | string | Pipe-delimited set of flags controlling content |
| `title` | string | Optional title for the overlay |

### Available Flags

| Flag | Content |
|------|---------|
| `FUZZY` | Start in fuzzy-filter mode |
| `TABS` | Include tabs from current window |
| `LAUNCH_MENU_ITEMS` | Include `config.launch_menu` entries |
| `DOMAINS` | Include connection domains |
| `WORKSPACES` | Include workspace list |
| `COMMANDS` | Include key assignments |
| `KEY_ASSIGNMENTS` | Include all configured key bindings |

Flags are combined with `|`: `'FUZZY|TABS|LAUNCH_MENU_ITEMS'`.

### Defining Launch Menu Items

```lua
config.launch_menu = {
  { args = { 'htop' } },
  {
    label = 'Bash',
    args = { 'bash', '-l' },
    cwd = '/home/user',
  },
  {
    label = 'Python REPL',
    args = { 'python3' },
    set_environment_variables = { PYTHONSTARTUP = '/home/user/.pythonrc' },
  },
}
```

### Launcher Color Configuration

| Key | Description |
|-----|-------------|
| `launcher_label_fg` | Foreground color of launcher labels |
| `launcher_label_bg` | Background color of launcher labels |

### Lua Example

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

config.keys = {
  -- Fuzzy tab/workspace switcher
  {
    key = 'Space',
    mods = 'ALT',
    action = act.ShowLauncherArgs { flags = 'FUZZY|TABS|WORKSPACES' },
  },
  -- Full launcher with all options
  {
    key = 'l',
    mods = 'LEADER',
    action = act.ShowLauncherArgs {
      flags = 'FUZZY|LAUNCH_MENU_ITEMS|DOMAINS|WORKSPACES',
      title = 'Launch',
    },
  },
}

return config
```

### Limitations

- Cannot programmatically control which items appear beyond the flag system.
- The launcher menu does not support custom callback actions (unlike InputSelector).
- Cannot add arbitrary entries beyond `launch_menu` SpawnCommand items without using `augment-command-palette` or InputSelector.

---

## 13. augment-command-palette Event

### Overview

The `augment-command-palette` event fires each time the Command Palette is opened. Handlers return tables of `CommandInfo` objects that are merged into the palette.

**Available since:** 20230712-072601-f4abf8fd

### Handler Signature

```lua
wezterm.on('augment-command-palette', function(window, pane)
  return {
    { brief = '...', icon = '...', action = ... },
    -- ...
  }
end)
```

### CommandInfo Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `brief` | string | yes | Short description shown in palette |
| `doc` | string | no | Extended description (reserved for future use) |
| `action` | KeyAssignment | yes | Action executed on selection |
| `icon` | string | no | Nerd Fonts glyph name (e.g., `'md_rename_box'`, `'fa_plug'`) |

### Important Constraints

1. **Synchronous only.** Calling async functions within the handler will not succeed. All data must be precomputed or cached.
2. **Last handler wins.** If multiple plugins register `augment-command-palette`, only the last registration's return value is used. This is a known limitation for multi-plugin environments.
3. **Fires every time.** The handler runs fresh each time the palette opens, so choices can be dynamic (within synchronous constraints).

### Comprehensive Example

```lua
local wezterm = require 'wezterm'
local act = wezterm.action

wezterm.on('augment-command-palette', function(window, pane)
  return {
    -- Rename current tab
    {
      brief = 'Rename Tab',
      icon = 'md_rename_box',
      action = act.PromptInputLine {
        description = 'Enter new tab name:',
        action = wezterm.action_callback(function(window, pane, line)
          if line then
            window:active_tab():set_title(line)
          end
        end),
      },
    },

    -- Create new workspace
    {
      brief = 'New Workspace',
      icon = 'md_plus_circle',
      action = act.PromptInputLine {
        description = 'Enter workspace name:',
        action = wezterm.action_callback(function(window, pane, line)
          if line then
            window:perform_action(
              act.SwitchToWorkspace { name = line },
              pane
            )
          end
        end),
      },
    },

    -- Toggle opacity
    {
      brief = 'Toggle Opacity',
      icon = 'md_circle_opacity',
      action = wezterm.action_callback(function(window, pane)
        local overrides = window:get_config_overrides() or {}
        if overrides.window_background_opacity == 1.0 then
          overrides.window_background_opacity = 0.85
        else
          overrides.window_background_opacity = 1.0
        end
        window:set_config_overrides(overrides)
      end),
    },

    -- Run htop in new pane
    {
      brief = 'System Monitor (htop)',
      icon = 'md_monitor',
      action = act.SplitHorizontal { args = { 'htop' } },
    },
  }
end)
```

### Plugin Integration Pattern

Because only the last handler wins, plugins that want to cooperate must chain:

```lua
-- Not ideal: each plugin registration overwrites the previous
-- Workaround: aggregate in a single handler
local custom_palette_entries = {}

local function add_palette_entries(entries)
  for _, entry in ipairs(entries) do
    table.insert(custom_palette_entries, entry)
  end
end

-- Plugin A
add_palette_entries({
  { brief = 'Plugin A Action', action = act.Nop },
})

-- Plugin B
add_palette_entries({
  { brief = 'Plugin B Action', action = act.Nop },
})

wezterm.on('augment-command-palette', function(window, pane)
  return custom_palette_entries
end)
```

---

## 14. Composing Overlays with Key Tables

### The Key Table Stack

WezTerm maintains a per-window stack of key table activations. This enables layered modal workflows where a leader key activates a table, a key within that table triggers an overlay, and the overlay's callback can activate yet another table or overlay.

### ActivateKeyTable Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Name of the key table to activate |
| `one_shot` | boolean | `true` | Auto-deactivate after one keypress |
| `timeout_milliseconds` | number | none | Auto-deactivate after timeout |
| `replace_current` | boolean | `false` | Pop current table before pushing |
| `until_unknown` | boolean | `false` | Deactivate on unmapped key |
| `prevent_fallback` | boolean | `false` | Prevent searching deeper stack levels |

### Stack Management Actions

| Action | Behavior |
|--------|----------|
| `ActivateKeyTable { ... }` | Push a table onto the stack |
| `PopKeyTable` | Remove top entry |
| `ClearKeyTableStack` | Clear all entries |

### Pattern: Leader -> Key Table -> Overlay -> Callback

This is the most powerful composition pattern. The leader key opens a command table, a key in that table opens an overlay, and the overlay callback performs an action:

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

-- Leader key
config.leader = { key = 'a', mods = 'CTRL', timeout_milliseconds = 1500 }

-- Top-level keys activate key tables
config.keys = {
  -- LEADER then r -> resize mode (persistent)
  {
    key = 'r',
    mods = 'LEADER',
    action = act.ActivateKeyTable {
      name = 'resize_pane',
      one_shot = false,
    },
  },

  -- LEADER then s -> session management mode (one-shot)
  {
    key = 's',
    mods = 'LEADER',
    action = act.ActivateKeyTable {
      name = 'session_mode',
      one_shot = true,
      timeout_milliseconds = 2000,
    },
  },
}

-- Define key tables
config.key_tables = {
  -- Resize mode: arrow keys resize, Escape exits
  resize_pane = {
    { key = 'LeftArrow', action = act.AdjustPaneSize { 'Left', 1 } },
    { key = 'RightArrow', action = act.AdjustPaneSize { 'Right', 1 } },
    { key = 'UpArrow', action = act.AdjustPaneSize { 'Up', 1 } },
    { key = 'DownArrow', action = act.AdjustPaneSize { 'Down', 1 } },
    { key = 'h', action = act.AdjustPaneSize { 'Left', 5 } },
    { key = 'l', action = act.AdjustPaneSize { 'Right', 5 } },
    { key = 'k', action = act.AdjustPaneSize { 'Up', 5 } },
    { key = 'j', action = act.AdjustPaneSize { 'Down', 5 } },
    { key = 'Escape', action = 'PopKeyTable' },
  },

  -- Session mode: single-key actions that may open overlays
  session_mode = {
    -- 'w' opens workspace switcher (InputSelector overlay)
    {
      key = 'w',
      action = wezterm.action_callback(function(window, pane)
        local choices = {}
        for _, name in ipairs(wezterm.mux.get_workspace_names()) do
          table.insert(choices, { label = name, id = name })
        end
        window:perform_action(
          act.InputSelector {
            title = 'Switch Workspace',
            choices = choices,
            fuzzy = true,
            action = wezterm.action_callback(function(w, p, id, label)
              if id then
                w:perform_action(act.SwitchToWorkspace { name = id }, p)
              end
            end),
          },
          pane
        )
      end),
    },

    -- 'n' prompts for new workspace name (PromptInputLine overlay)
    {
      key = 'n',
      action = act.PromptInputLine {
        description = 'New workspace name:',
        action = wezterm.action_callback(function(window, pane, line)
          if line then
            window:perform_action(
              act.SwitchToWorkspace { name = line },
              pane
            )
          end
        end),
      },
    },

    -- 'd' asks for confirmation before closing workspace
    {
      key = 'd',
      action = act.Confirmation {
        message = 'Close all tabs in this workspace?',
        action = wezterm.action_callback(function(window, pane)
          -- Close logic here
          window:perform_action(act.CloseCurrentTab { confirm = false }, pane)
        end),
      },
    },

    { key = 'Escape', action = 'PopKeyTable' },
  },
}

return config
```

### Pattern: Chained Overlay Callbacks

An overlay callback can itself trigger another overlay:

```lua
-- First overlay: select a project
action = act.InputSelector {
  title = 'Select Project',
  choices = project_choices,
  fuzzy = true,
  action = wezterm.action_callback(function(window, pane, id, label)
    if not id then return end
    -- Second overlay: select action for that project
    window:perform_action(
      act.InputSelector {
        title = 'Action for ' .. label,
        choices = {
          { label = 'Open in new tab', id = 'tab' },
          { label = 'Open in new workspace', id = 'workspace' },
          { label = 'Open in split pane', id = 'split' },
        },
        action = wezterm.action_callback(function(w, p, action_id, _)
          if action_id == 'tab' then
            w:perform_action(act.SpawnCommandInNewTab { cwd = id }, p)
          elseif action_id == 'workspace' then
            w:perform_action(act.SwitchToWorkspace { name = label, spawn = { cwd = id } }, p)
          elseif action_id == 'split' then
            w:perform_action(act.SplitHorizontal { cwd = id }, p)
          end
        end),
      },
      pane
    )
  end),
}
```

### Displaying Active Key Table in Status Bar

```lua
wezterm.on('update-right-status', function(window, pane)
  local name = window:active_key_table()
  if name then
    name = 'TABLE: ' .. name
  end
  window:set_right_status(name or '')
end)
```

---

## 15. Visual Appearance of Overlays

### Rendering Model

All overlays render as synthetic `Pane` objects using WezTerm's GPU-accelerated rendering pipeline. They share the same text shaping, font fallback, ligature support, and color rendering as normal terminal content. This means:

- Overlays respect the configured color scheme.
- Custom fonts can be specified per overlay type where supported.
- Overlays scale properly with font size changes and window resizing.
- Overlays handle resize events (historically buggy for debug and launcher, now fixed in nightly).

### Per-Overlay Appearance Summary

| Overlay | Background | Content | Interactive Elements |
|---------|------------|---------|---------------------|
| **CharSelect** | Configurable (`char_select_bg_color`) | Character grid with names, group header | Text input at top, category cycling |
| **PaneSelect** | Semi-transparent over pane content | Large centered labels (configurable font/size) | Single-character input |
| **QuickSelect** | Terminal content with highlighted matches | Color-coded labels and match highlights | Label typing area at bottom |
| **InputSelector** | Opaque overlay | Numbered/labeled choice list | Text input in fuzzy mode, description bar |
| **PromptInputLine** | Opaque overlay | Description text, prompt string | Single-line text input with cursor |
| **Confirmation** | Opaque overlay | Message text, Yes/No options | Selection input |
| **Copy Mode** | Terminal scrollback with selection highlight | Cursor, selection range | Vim-style key input |
| **Search** | Terminal content with match highlights | Search bar at bottom with match count | Text input, mode indicator |
| **Debug Overlay** | Opaque overlay | Log output, REPL prompt | Multi-line REPL input |
| **Command Palette** | Configurable (`command_palette_bg_color`) | Ranked command list with key bindings | Text input at top, list navigation |
| **Launcher** | Configurable (`launcher_label_bg/fg`) | Categorized launch items | Fuzzy filter input |

### Inactive Pane Dimming

When an overlay is active, the underlying terminal content may be dimmed according to `inactive_pane_hsb` (hue, saturation, brightness multiplier). This is the same dimming applied to inactive panes in split layouts.

### Text Background Opacity

The `text_background_opacity` setting affects how text in overlays renders over any background image. With transparent backgrounds, overlay text may need higher opacity for readability.

---

## 16. Community Patterns and Plugins

### resurrect.wezterm

**Repository:** [MLFlexer/resurrect.wezterm](https://github.com/MLFlexer/resurrect.wezterm)

Saves and restores window, tab, and pane state (including terminal output) across WezTerm restarts. Inspired by tmux-resurrect.

**Overlay usage:** The `fuzzy_load` function uses WezTerm's built-in InputSelector to present saved sessions for restoration:

```lua
local resurrect = wezterm.plugin.require 'https://github.com/MLFlexer/resurrect.wezterm'

config.keys = {
  {
    key = 'R',
    mods = 'LEADER|SHIFT',
    action = wezterm.action_callback(function(window, pane)
      resurrect.fuzzy_loader(window, pane, function(id, label, items)
        -- Restore selected session
      end, {
        title = 'Restore Session',
        description = 'Select a saved session to restore',
        fuzzy_description = 'Type to filter sessions...',
        is_fuzzy = true,
      })
    end),
  },
}
```

Key features for overlay integration:
- `fuzzy_load` options: `title`, `description`, `fuzzy_description`, `is_fuzzy`
- Filtering options: `ignore_workspaces`, `ignore_tabs`, `ignore_windows`
- Custom formatting functions for windows, workspaces, tabs, and dates

### smart_workspace_switcher.wezterm

**Repository:** [MLFlexer/smart_workspace_switcher.wezterm](https://github.com/MLFlexer/smart_workspace_switcher.wezterm)

Workspace switching with fuzzy finding and zoxide integration.

**Overlay usage:** Internally creates an InputSelector with choices built from active workspaces and zoxide directory history:

```lua
local workspace_switcher = wezterm.plugin.require
  'https://github.com/MLFlexer/smart_workspace_switcher.wezterm'

config.keys = {
  {
    key = 's',
    mods = 'LEADER',
    action = workspace_switcher.switch_workspace(),
  },
  {
    key = 'S',
    mods = 'LEADER|SHIFT',
    action = workspace_switcher.switch_to_prev_workspace(),
  },
}

-- Custom label formatting
workspace_switcher.workspace_formatter = function(label)
  return wezterm.format {
    { Text = ' ' .. label },
  }
end

-- Event-driven behavior
wezterm.on('smart_workspace_switcher.workspace_switcher.chosen', function(window, workspace)
  wezterm.log_info('Switched to: ' .. workspace)
end)

wezterm.on('smart_workspace_switcher.workspace_switcher.created', function(window, workspace)
  wezterm.log_info('Created: ' .. workspace)
end)
```

Events emitted:
- `smart_workspace_switcher.workspace_switcher.start`
- `smart_workspace_switcher.workspace_switcher.chosen`
- `smart_workspace_switcher.workspace_switcher.created`
- `smart_workspace_switcher.workspace_switcher.canceled`
- `smart_workspace_switcher.workspace_switcher.switched_to_prev`

### sessionizer.wezterm

**Repository:** [mikkasendke/sessionizer.wezterm](https://github.com/mikkasendke/sessionizer.wezterm)

Flexible sessionizer inspired by ThePrimeagen's tmux-sessionizer. Uses a schema-based approach to define custom menus.

**Overlay usage:** Wraps InputSelector with a declarative schema system:

```lua
local sessionizer = wezterm.plugin.require
  'https://github.com/mikkasendke/sessionizer.wezterm'

local schema = {
  options = {
    title = 'Sessionizer',
    prompt = 'Select entry: ',
    always_fuzzy = true,
    callback = sessionizer.DefaultCallback,
  },
  sessionizer.DefaultWorkspace {},
  sessionizer.AllActiveWorkspaces { filter_current = true },
  sessionizer.FdSearch {
    wezterm.home_dir .. '/projects',
    max_depth = 2,
    exclude = { 'node_modules', '.git' },
  },
  processing = sessionizer.for_each_entry(function(entry)
    entry.label = entry.label:gsub(wezterm.home_dir, '~')
  end),
}

config.keys = {
  {
    key = 'f',
    mods = 'LEADER',
    action = sessionizer.show(schema),
  },
}
```

Built-in generators:
- `DefaultWorkspace {}` -- entry for the default workspace
- `AllActiveWorkspaces { filter_default, filter_current }` -- active workspaces
- `FdSearch(path | opts)` -- directory search via `fd`

### modal.wezterm

**Repository:** [MLFlexer/modal.wezterm](https://github.com/MLFlexer/modal.wezterm)

Adds vim-like modal keybindings with visual mode indicators. Enhances Copy Mode with additional motions and provides a UI mode for pane/tab management.

**Overlay interaction:** Extends the `copy_mode` and `search_mode` key tables with additional bindings and visual overlays showing the current mode.

### Other Notable Plugins Using Overlays

| Plugin | Author | Overlay Usage |
|--------|--------|---------------|
| [quick_domains.wezterm](https://github.com/DavidRR-F/quick_domains.wezterm) | DavidRR-F | InputSelector for SSH domain selection |
| [workspace-picker.wezterm](https://github.com/isseii10/workspace-picker.wezterm) | isseii10 | InputSelector for workspace switching with zoxide |
| [wsinit.wezterm](https://github.com/JuanraCM/wsinit.wezterm) | JuanraCM | InputSelector for workspace initialization configs |
| [workspacesionizer.wezterm](https://github.com/vieitesss/workspacesionizer.wezterm) | vieitesss | InputSelector for workspace selection |
| [tabsets.wezterm](https://github.com/srackham/tabsets.wezterm) | srackham | InputSelector/PromptInputLine for named tab set management |
| [wezterm-sessions](https://github.com/abidibo/wezterm-sessions) | abidibo | InputSelector for session save/restore |

The InputSelector overlay is by far the most commonly used extension point. Nearly all workspace, session, and domain management plugins build on it.

---

## 17. Sources

### Official Documentation

- [InputSelector](https://wezterm.org/config/lua/keyassignment/InputSelector.html)
- [CharSelect](https://wezterm.org/config/lua/keyassignment/CharSelect.html)
- [PaneSelect](https://wezterm.org/config/lua/keyassignment/PaneSelect.html)
- [QuickSelect](https://wezterm.org/config/lua/keyassignment/QuickSelect.html)
- [QuickSelectArgs](https://wezterm.org/config/lua/keyassignment/QuickSelectArgs.html)
- [PromptInputLine](https://wezterm.org/config/lua/keyassignment/PromptInputLine.html)
- [Confirmation](https://wezterm.org/config/lua/keyassignment/Confirmation.html)
- [ShowDebugOverlay](https://wezterm.org/config/lua/keyassignment/ShowDebugOverlay.html)
- [ActivateCommandPalette](https://wezterm.org/config/lua/keyassignment/ActivateCommandPalette.html)
- [ShowLauncherArgs](https://wezterm.org/config/lua/keyassignment/ShowLauncherArgs.html)
- [Copy Mode](https://wezterm.org/copymode.html)
- [Quick Select Mode](https://wezterm.org/quickselect.html)
- [Key Tables](https://wezterm.org/config/key-tables.html)
- [Key Binding](https://wezterm.org/config/keys.html)
- [augment-command-palette](https://wezterm.org/config/lua/window-events/augment-command-palette.html)
- [Colors & Appearance](https://wezterm.org/config/appearance.html)
- [Quick Select Alphabet](https://wezterm.org/config/lua/config/quick_select_alphabet.html)
- [Quick Select Patterns](https://wezterm.org/config/lua/config/quick_select_patterns.html)

### Source Code References

- [wezterm-gui/src/overlay/copy.rs](https://github.com/wez/wezterm/blob/main/wezterm-gui/src/overlay/copy.rs)
- [wezterm-gui source tree](https://github.com/wezterm/wezterm/tree/main/wezterm-gui)
- [WezTerm repository](https://github.com/wezterm/wezterm)

### Community Resources

- [DeepWiki: Key Assignments and Event Handling](https://deepwiki.com/wezterm/wezterm/3.2-key-assignments-and-event-handling)
- [DeepWiki: WezTerm Architecture](https://deepwiki.com/wezterm/wezterm)
- [awesome-wezterm plugin list](https://github.com/michaelbrusegard/awesome-wezterm)
- [resurrect.wezterm](https://github.com/MLFlexer/resurrect.wezterm)
- [smart_workspace_switcher.wezterm](https://github.com/MLFlexer/smart_workspace_switcher.wezterm)
- [sessionizer.wezterm](https://github.com/mikkasendke/sessionizer.wezterm)
- [modal.wezterm](https://github.com/MLFlexer/modal.wezterm)
- [WezTerm Debug Overlay Tips and Tricks](https://github.com/wezterm/wezterm/discussions/5989)
- [InputSelector PR #4227 (fuzzy_description, uppercase labels)](https://github.com/wezterm/wezterm/pull/4227)
- [Alex Plescan: Okay, I really like WezTerm](https://alexplescan.com/posts/2024/08/10/wezterm/)
- [aNNi::Writes: WezTerm projects selector](https://blog.annimon.com/wezterm-projects/)
- [Fredrik Averpil: Session management in WezTerm](https://fredrikaverpil.github.io/blog/2024/10/20/session-management-in-wezterm-without-tmux/)
- [mwop.net: Using resurrect.wezterm](https://mwop.net/blog/2024-10-21-wezterm-resurrect.html)
