---
title: "WezTerm Tab Title Pinning"
first_authored:
  by: "@claude"
  at: "2026-02-28T00:00:00-06:00"
task_list: null
type: report
state: live
status: wip
tags: [investigation, wezterm, tab-management]
---

# WezTerm Tab Title Pinning

> **BLUF:** Yes, WezTerm supports pinned tab titles. The `tab:set_title()` API stores
> a title on the tab object that is **separate** from pane titles set by OSC escape
> sequences. WezTerm's default tab rendering ignores this stored title and reads from
> the active pane instead -- but a `format-tab-title` event handler can check
> `tab_info.tab_title`, and when it is non-empty, display that instead of the pane
> title. This effectively "pins" the tab title: programs like Claude Code can send
> all the OSC 0/1/2 sequences they want, and the pinned title will stick. No upstream
> patches are needed. The solution is approximately 30 lines of Lua in the wezterm
> config.

## Context

### The Problem

TUI applications routinely set terminal titles via OSC escape sequences:

- **OSC 0** (`\x1b]0;title\x1b\\`): Sets both icon name and window title
- **OSC 1** (`\x1b]1;title\x1b\\`): Sets icon name (used as tab title when non-empty)
- **OSC 2** (`\x1b]2;title\x1b\\`): Sets window title

Claude Code, like many TUI applications, emits OSC sequences to set a title reflecting
its current state. This overwrites whatever tab name the user intended, making it
impossible to label tabs by project when running Claude Code in multiple tabs.

Shells compound the problem: most shell prompt configurations emit OSC 2 before each
command, so even after manually naming a tab, the next shell prompt resets it.

### The Goal

The user wants to:
1. Name a tab (e.g., "lace", "dotfiles", "scratch") when spawning it
2. Have that name persist regardless of what the running program does
3. Optionally clear the pinned name to revert to normal (program-controlled) behavior

## WezTerm Title Mechanisms

WezTerm maintains title information at two distinct levels, and the default rendering
conflates them in a way that makes pinning non-obvious.

### Level 1: Pane Title (OSC-controlled)

Each pane stores its own title, updated by the terminal escape sequences that programs
emit. The `pane:get_title()` method returns this value, following this priority:

1. If OSC 1 set a non-empty icon name, return that
2. Otherwise, return the value from OSC 2 (window title)
3. For local panes showing "wezterm", attempt to resolve the foreground process name

This is the title that programs like Claude Code override. Every OSC sequence replaces
whatever was there before.

### Level 2: Tab Title (API-controlled)

Each tab has a separate title string, set via:

- **Lua API:** `tab:set_title("my title")` (available since 20220807-113146-c2fee766)
- **CLI:** `wezterm cli set-tab-title "my title"` (available since 20230408-112425-69ae8472)
- **Interactive:** via `PromptInputLine` keybinding

This title is stored on the `MuxTab` object and is completely independent of pane
titles. OSC sequences from programs do **not** touch this value. It persists until
explicitly changed or cleared.

### The Conflation: Default Rendering

Here is the critical subtlety. By default, WezTerm renders tab titles by reading **the
active pane's title**, not the tab's stored title. As the maintainer (Wez) confirmed in
[Discussion #2814](https://github.com/wezterm/wezterm/discussions/2814):

> "While `tab:set_title` sets a string that can be retrieved via `tab:get_title`,
> wezterm doesn't look at that string -- it reads the title from the active pane inside
> of the tab in its default implementation."

This means that without a `format-tab-title` handler, `tab:set_title()` is effectively
invisible. The stored tab title exists, it just is not displayed.

### The Solution: `format-tab-title` Event

The `format-tab-title` event fires whenever WezTerm needs to compute tab bar text. The
handler receives a `TabInformation` object with both:

- `tab_info.tab_title` -- the manually-set tab title (empty string if unset)
- `tab_info.active_pane.title` -- the pane title (set by OSC sequences)

By checking `tab_title` first, the handler can display the pinned title when present
and fall back to the pane title when not. This is exactly the pattern shown in the
[official documentation](https://wezterm.org/config/lua/window-events/format-tab-title.html):

```lua
function tab_title(tab_info)
  local title = tab_info.tab_title
  -- if the tab title is explicitly set, take that
  if title and #title > 0 then
    return title
  end
  -- Otherwise, use the title from the active pane
  return tab_info.active_pane.title
end
```

## Key Findings

### 1. Tab title storage is separate from pane title storage

The `MuxTab` object stores a title string independently of any pane. OSC escape
sequences update pane titles only. Setting a tab title via `set_title()` creates a
value that persists through any number of OSC title changes from the running program.

**Confidence: High.** This is documented behavior and confirmed by the maintainer.

### 2. No built-in config option to ignore OSC title sequences

There is no `config.ignore_osc_title = true` or similar setting. WezTerm always
processes OSC 0/1/2 and updates the pane title. The control point is at the rendering
layer, not the ingestion layer.

**Confidence: High.** Exhaustive search of WezTerm docs and GitHub issues found no
such option.

### 3. `format-tab-title` is the correct and only interception point

The `format-tab-title` event is the single place where tab rendering can be
customized. It is synchronous (must return quickly), runs for every tab, and can
return either a plain string or a styled `FormatItem` table.

Only one `format-tab-title` handler can be active. If the lace.wezterm plugin or
any other plugin registers one, they will conflict.

**Confidence: High.** Documented constraint.

### 4. Per-tab metadata can be stored via multiple mechanisms

For more advanced use cases (e.g., per-tab icons, colors, or metadata beyond the
title), three storage mechanisms are available:

| Mechanism | Scope | Survives OSC | Survives config reload | Survives mux restart |
|-----------|-------|-------------|----------------------|---------------------|
| `tab:set_title()` | Tab | Yes | Yes | Yes (mux domain) |
| `wezterm.GLOBAL` | Process | Yes | Yes | No |
| Pane user vars | Pane | Yes | Yes | Yes (mux domain) |

`tab:set_title()` is the simplest and most appropriate for this use case.

### 5. The existing config has no `format-tab-title` handler

The current config at
`/home/mjr/code/personal/dotfiles/dot_config/wezterm/wezterm.lua` uses default tab
rendering. It already has an `update-status` handler for the status bar, but nothing
for tab titles. Adding a `format-tab-title` handler is non-conflicting.

The lace.wezterm plugin at `/home/mjr/code/weft/lace.wezterm/plugin/init.lua` also
does not register a `format-tab-title` handler. It uses `update-status` for the
workspace status bar. No conflict.

## Recommended Approach

### Option A: `format-tab-title` + `PromptInputLine` (Recommended)

This approach adds two things to the wezterm config:

1. A `format-tab-title` handler that prefers `tab_title` over `active_pane.title`
2. A keybinding (e.g., `Leader+T`) that prompts the user for a tab name

**Pros:**
- Pure Lua, no external dependencies
- Works with unix domain mux (title persists across GUI reconnects)
- Approximately 30 lines of config
- Non-destructive: tabs without a pinned title behave exactly as before
- Clearing the title (empty input) reverts to default behavior

**Cons:**
- Requires manual interaction to pin a title
- No automatic project-name detection

### Option B: Automatic pinning via `mux-startup` / `spawn_tab`

Set tab titles programmatically when spawning tabs in `mux-startup`:

```lua
local tab, pane, window = wezterm.mux.spawn_window({ ... })
tab:set_title("main")
```

**Pros:**
- No manual interaction needed for known workspaces
- Combines well with Option A

**Cons:**
- Only works for tabs created at startup
- New tabs spawned via `Alt+Shift+N` would not get automatic titles

### Option C: User var from shell + `format-tab-title`

Set a user variable from the shell (e.g., in the prompt), then read it in the
`format-tab-title` handler:

```bash
# In shell config:
printf "\033]1337;SetUserVar=%s=%s\007" "TAB_PIN" "$(echo -n "my-project" | base64)"
```

**Pros:**
- Title follows the shell session, not the WezTerm tab
- Works through multiplexer connections and even tmux

**Cons:**
- Requires shell-side configuration for each environment
- TUI apps like Claude Code would still override pane titles; the user var is separate
- More complex plumbing

### Recommended: Option A + B combined

Use Option A as the foundation (always active), and seed startup tabs with titles via
Option B. This gives both manual pinning for ad-hoc tabs and automatic naming for
known workspaces.

## Implementation Sketch

### 1. `format-tab-title` Handler

Add to the wezterm config, in the event handlers section:

```lua
-- =============================================================================
-- Tab Title Pinning
-- Prefer explicitly-set tab titles over program-controlled pane titles.
-- Pin a title: Leader+T (interactive), or tab:set_title() (programmatic)
-- Clear a pin: Leader+T, then press Enter with empty input
-- =============================================================================

-- Resolve the display title for a tab.
-- Priority: explicit tab_title > active pane title
local function resolve_tab_title(tab_info)
  local title = tab_info.tab_title
  if title and #title > 0 then
    return title
  end
  return tab_info.active_pane.title
end

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
  local title = resolve_tab_title(tab)

  -- Truncate to max_width (retro tab bar only)
  if max_width and #title > max_width - 2 then
    title = wezterm.truncate_right(title, max_width - 2)
  end

  -- Optional: add a pin indicator when title is explicitly set
  local pinned = tab.tab_title and #tab.tab_title > 0
  local icon = pinned and " " or ""

  if tab.is_active then
    return {
      { Background = { Color = slate.bg_raised } },
      { Foreground = { Color = slate.fg_bright } },
      { Attribute = { Intensity = "Bold" } },
      { Text = " " .. icon .. title .. " " },
    }
  else
    return {
      { Background = { Color = slate.bg_surface } },
      { Foreground = { Color = slate.fg_dim } },
      { Text = " " .. icon .. title .. " " },
    }
  end
end)
```

### 2. Interactive Rename Keybinding

Add to `config.keys`:

```lua
-- Rename tab (pin title): Leader+T
{
  key = "t",
  mods = "LEADER",
  action = act.PromptInputLine({
    description = "Set tab title (empty to unpin)",
    action = wezterm.action_callback(function(window, pane, line)
      if line then
        window:active_tab():set_title(line)
      end
    end),
  }),
},
```

### 3. Automatic Startup Titles (Optional)

Modify the existing `mux-startup` handler:

```lua
wezterm.on("mux-startup", function()
  local tab, pane, window = wezterm.mux.spawn_window({
    workspace = "main",
    cwd = wezterm.home_dir,
  })
  tab:set_title("home")
end)
```

### 4. CLI Usage

From any running shell inside WezTerm:

```bash
# Pin the current tab's title
wezterm cli set-tab-title "lace"

# Clear the pin (revert to program-controlled title)
wezterm cli set-tab-title ""
```

This is useful for scripting. For example, a shell alias:

```bash
alias pin='wezterm cli set-tab-title'
alias unpin='wezterm cli set-tab-title ""'
```

## Open Questions

1. **Pin indicator character:** The implementation sketch uses a pin emoji. This
   may not render well in all fonts or may conflict with the user's aesthetic
   preferences. A simpler approach would be to use no indicator at all, or a
   single character like `*`.

2. **`format-tab-title` exclusivity:** Only one handler can be active. If the
   lace.wezterm plugin or resurrect.wezterm later adds a `format-tab-title`
   handler, there will be a conflict. The handler should either live in the main
   config (not a plugin) or be coordinated across plugins.

3. **Mux domain persistence:** `tab:set_title()` values persist within the unix
   domain mux session, so they survive GUI disconnects/reconnects. They do **not**
   survive mux server restarts unless the resurrect plugin serializes them. Whether
   resurrect captures tab titles would need to be verified.

4. **Interaction with `wezterm cli list`:** The `wezterm cli list` command shows
   tab titles. If the `format-tab-title` handler modifies display text (adding
   icons, truncating), `cli list` will still show the raw stored title. This is
   generally desirable but worth noting.

## Sources

- [format-tab-title event](https://wezterm.org/config/lua/window-events/format-tab-title.html)
- [MuxTab:set_title()](https://wezterm.org/config/lua/MuxTab/set_title.html)
- [TabInformation object](https://wezterm.org/config/lua/TabInformation.html)
- [wezterm cli set-tab-title](https://wezterm.org/cli/cli/set-tab-title.html)
- [pane:get_title()](https://wezterm.org/config/lua/pane/get_title.html)
- [PaneInformation object](https://wezterm.org/config/lua/PaneInformation.html)
- [Escape sequences reference](https://wezterm.org/escape-sequences.html)
- [Passing data from panes to Lua](https://wezterm.org/recipes/passing-data.html)
- [Issue #1598: Set title for tab and all its panes](https://github.com/wezterm/wezterm/issues/1598)
- [Issue #522: Feature request to rename a tab manually](https://github.com/wezterm/wezterm/issues/522)
- [Issue #6154: Setting window-title per tab](https://github.com/wezterm/wezterm/issues/6154)
- [Discussion #2814: Changing tab title programmatically](https://github.com/wezterm/wezterm/discussions/2814)
- [Discussion #2983: Setting tab title and lua global variables](https://github.com/wezterm/wezterm/discussions/2983)
- [Discussion #3960: How could I change the current tab's title?](https://github.com/wezterm/wezterm/discussions/3960)
