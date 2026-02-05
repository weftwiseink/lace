---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T12:00:00-05:00
type: report
subtype: analysis
state: archived
status: done
tags: [wezterm, plugin, lua, devcontainer, local-development]
---

# WezTerm Plugin Research: Local Plugin Without Separate Repository

## BLUF (Bottom Line Up Front)

WezTerm's plugin system supports local file paths via the `file://` protocol, making it possible to create a lace-specific plugin without a separate repository. The plugin would live at `config/wezterm/lace-plugin/plugin/init.lua` and be loaded with `wezterm.plugin.require "file:///workspace/main/lace/config/wezterm/lace-plugin"`. The plugin can export `apply_to_config(config)` to inject SSH domains, keybindings, events, and status bar configuration.

**Recommendation**: Create a local plugin structure within the lace repository. This approach avoids repository proliferation while providing clean separation of lace-specific WezTerm configuration.

---

## Context

The current lace WezTerm configuration at `/var/home/mjr/code/weft/lace/config/wezterm/wezterm.lua` contains both general WezTerm preferences and lace-specific functionality:

**Lace-specific code to extract:**
- SSH domain configuration for devcontainer access (lines 67-86)
- Leader+D keybinding for devcontainer connection
- `trigger-worktree-picker` event and Leader+W keybinding
- Status bar showing workspace name
- Helper function `spawn_worktree_workspace()`

**General configuration to keep in main wezterm.lua:**
- Appearance settings (color scheme, fonts, window styling)
- Core settings (scrollback, CSI encoding)
- Unix domain multiplexing
- Standard keybindings (pane navigation, splits, tabs)
- Copy mode customization

---

## Key Findings

### 1. Plugin Loading Mechanisms

WezTerm plugins can be loaded from two URL schemes:

**HTTPS (Remote)**
```lua
local plugin = wezterm.plugin.require "https://github.com/owner/repo"
```

**File Protocol (Local)**
```lua
local plugin = wezterm.plugin.require "file:///home/user/projects/myPlugin"
```

The `file://` protocol enables local development without publishing to a remote repository. This is the key mechanism that makes a lace-embedded plugin viable.

**Important**: After making changes to a local plugin, `wezterm.plugin.update_all()` must be called (via Debug Overlay REPL or configuration reload) to sync changes into WezTerm's runtime directory.

### 2. Plugin Directory Structure

A plugin must contain a `plugin/init.lua` file:

```
lace-plugin/
  plugin/
    init.lua     # Required entry point
    domains.lua  # Optional additional modules
    events.lua   # Optional additional modules
```

The `init.lua` must export a module, conventionally with an `apply_to_config(config)` function.

### 3. Plugin Capabilities

Plugins can configure virtually everything that a regular wezterm.lua can:

| Capability | Supported | Notes |
|------------|-----------|-------|
| SSH domains | Yes | Modify `config.ssh_domains` |
| Keybindings | Yes | Append to `config.keys` |
| Event handlers | Yes | Register via `wezterm.on()` |
| Status bar | Yes | Via `update-status` event |
| Key tables | Yes | Modify `config.key_tables` |
| Custom actions | Yes | Via `wezterm.action_callback()` |
| External commands | Yes | Via `wezterm.run_child_process()` |

### 4. The `apply_to_config` Pattern

The standard plugin pattern accepts the config builder and modifies it in-place:

```lua
-- plugin/init.lua
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

function M.apply_to_config(config, opts)
  opts = opts or {}

  -- Add SSH domains
  config.ssh_domains = config.ssh_domains or {}
  table.insert(config.ssh_domains, {
    name = "lace",
    remote_address = opts.ssh_port or "localhost:2222",
    username = "node",
    -- ...
  })

  -- Add keybindings
  config.keys = config.keys or {}
  table.insert(config.keys, {
    key = "d",
    mods = "LEADER",
    action = act.SwitchToWorkspace({ name = "lace", spawn = { domain = { DomainName = "lace" } } }),
  })

  -- Register events
  wezterm.on("trigger-worktree-picker", function(window, pane)
    -- ...
  end)
end

return M
```

### 5. Multi-Module Plugins

For plugins with multiple files, `package.path` must be updated to include the plugin directory. The directory can be obtained from `wezterm.plugin.list()`:

```lua
local function setup_package_path()
  for _, item in ipairs(wezterm.plugin.list()) do
    if item.url:match("lace%-plugin") then
      package.path = package.path .. ";" .. item.plugin_dir .. "/plugin/?.lua"
      break
    end
  end
end
```

However, for a simple plugin like lace's needs, a single `init.lua` file is likely sufficient.

### 6. Plugin Runtime Location

WezTerm clones/copies plugins into its runtime directory:
- Linux: `$XDG_RUNTIME_DIR/wezterm/plugins/` or `~/.local/share/wezterm/plugins/`
- The directory name is derived from the plugin URL

For local `file://` plugins, changes require `wezterm.plugin.update_all()` to sync.

---

## Recommended Approach

### Option A: In-Repository Plugin (Recommended)

Create the plugin within the lace repository:

```
config/wezterm/
  wezterm.lua                    # Main config, loads plugin
  lace-plugin/
    plugin/
      init.lua                   # Plugin entry point
```

**wezterm.lua usage:**
```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- General configuration...
config.color_scheme = "Solarized Dark (Gogh)"
-- ...

-- Load lace plugin
-- Path assumes container environment; host path would differ
local lace = wezterm.plugin.require "file:///workspace/main/lace/config/wezterm/lace-plugin"
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  ssh_port = "localhost:2222",
})

return config
```

**Advantages:**
- Single repository, no external dependencies
- Version-controlled alongside the devcontainer configuration
- Clear separation of concerns
- Can be easily extracted to a standalone repo later if desired

**Disadvantages:**
- Path must be adjusted for host vs. container context
- Requires `wezterm.plugin.update_all()` after changes

### Option B: XDG Convention-Based Plugin

Place the plugin in WezTerm's conventional plugin directory:

```
~/.local/share/wezterm/plugins/lace-plugin/plugin/init.lua
```

This avoids the `file://` protocol but means the plugin lives outside the lace repository.

**Advantages:**
- Automatically discovered by WezTerm
- No path configuration needed

**Disadvantages:**
- Plugin code not version-controlled with lace
- Manual installation step for new machines
- Harder to keep in sync with lace changes

### Option C: Symlink Approach

Symlink from XDG location to the in-repo plugin:

```bash
ln -s /workspace/main/lace/config/wezterm/lace-plugin ~/.local/share/wezterm/plugins/lace-plugin
```

**Advantages:**
- Combines version control (Option A) with automatic discovery (Option B)

**Disadvantages:**
- Requires manual symlink setup
- Path differences between host and container

---

## Proposed Plugin Structure

```lua
-- config/wezterm/lace-plugin/plugin/init.lua
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Default configuration
M.defaults = {
  ssh_port = "localhost:2222",
  username = "node",
  workspace_path = "/workspace",
  main_worktree = "main",
  remote_wezterm_path = "/usr/local/bin/wezterm",
}

-- SSH domain configuration
local function setup_ssh_domain(config, opts)
  config.ssh_domains = config.ssh_domains or {}
  table.insert(config.ssh_domains, {
    name = "lace",
    remote_address = opts.ssh_port,
    username = opts.username,
    remote_wezterm_path = opts.remote_wezterm_path,
    multiplexing = "WezTerm",
    ssh_option = {
      identityfile = opts.ssh_key,
    },
  })
end

-- Helper: spawn workspace for a worktree
local function spawn_worktree_workspace(name, opts)
  return act.SwitchToWorkspace({
    name = name,
    spawn = {
      domain = { DomainName = "lace" },
      cwd = opts.workspace_path .. "/" .. name,
    },
  })
end

-- Worktree picker event
local function setup_worktree_picker(opts)
  wezterm.on("lace.trigger-worktree-picker", function(window, pane)
    local success, stdout = wezterm.run_child_process({
      "ssh", "-p", opts.ssh_port:match(":(%d+)$"),
      "-i", opts.ssh_key,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      opts.username .. "@localhost",
      "ls", "-1", opts.workspace_path,
    })

    if not success then
      window:toast_notification("lace", "Container not running or SSH failed", nil, 3000)
      return
    end

    local choices = {}
    for name in stdout:gmatch("[^\n]+") do
      if not name:match("^%.") and name ~= "node_modules" then
        table.insert(choices, { id = name, label = name })
      end
    end

    window:perform_action(
      act.InputSelector({
        title = "Select Worktree",
        choices = choices,
        action = wezterm.action_callback(function(win, _, id, label)
          if id then
            win:perform_action(spawn_worktree_workspace(id, opts), pane)
          end
        end),
      }),
      pane
    )
  end)
end

-- Status bar showing workspace
local function setup_status_bar()
  wezterm.on("update-status", function(window, pane)
    local workspace = window:active_workspace()
    window:set_left_status(wezterm.format({
      { Background = { Color = "#073642" } },
      { Foreground = { Color = "#2aa198" } },
      { Text = "  " .. workspace .. " " },
    }))
  end)
end

-- Keybindings
local function setup_keybindings(config, opts)
  config.keys = config.keys or {}

  -- Leader+D: Quick connect to devcontainer
  table.insert(config.keys, {
    key = "d",
    mods = "LEADER",
    action = spawn_worktree_workspace(opts.main_worktree, opts),
  })

  -- Leader+W: Worktree picker
  table.insert(config.keys, {
    key = "w",
    mods = "LEADER",
    action = act.EmitEvent("lace.trigger-worktree-picker"),
  })
end

-- Main entry point
function M.apply_to_config(config, opts)
  -- Merge user options with defaults
  opts = opts or {}
  for k, v in pairs(M.defaults) do
    if opts[k] == nil then
      opts[k] = v
    end
  end

  -- Require ssh_key to be provided
  if not opts.ssh_key then
    wezterm.log_error("lace plugin: ssh_key option is required")
    return
  end

  setup_ssh_domain(config, opts)
  setup_worktree_picker(opts)
  setup_status_bar()
  setup_keybindings(config, opts)
end

return M
```

---

## Underspecifications and Questions

### 1. Host vs. Container Path Resolution

The plugin path differs between host and container:
- Host: `file:///home/mjr/code/weft/lace/config/wezterm/lace-plugin`
- Container: `file:///workspace/main/lace/config/wezterm/lace-plugin`

**Question**: Should the wezterm.lua detect its environment and adjust the path, or should we use the symlink approach?

**Possible solution**: Use `wezterm.config_dir` or environment variables to detect context:
```lua
local is_container = os.getenv("REMOTE_CONTAINERS") ~= nil
local plugin_path = is_container
  and "file:///workspace/main/lace/config/wezterm/lace-plugin"
  or "file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin"
```

### 2. Plugin Update Workflow

After modifying the plugin, WezTerm needs `wezterm.plugin.update_all()` to sync changes. This could be automated via:
- A keybinding in the config
- The existing Leader+R reload configuration
- A file watcher (not currently supported by WezTerm)

**Question**: What's the expected development workflow for iterating on the plugin?

### 3. Graceful Degradation

If the plugin fails to load (wrong path, syntax error), what should happen?

**Recommendation**: Wrap the plugin load in pcall:
```lua
local ok, lace = pcall(wezterm.plugin.require, plugin_path)
if ok then
  lace.apply_to_config(config, opts)
else
  wezterm.log_warn("Failed to load lace plugin: " .. tostring(lace))
end
```

### 4. SSH Key Path Variability

The SSH key path (`~/.ssh/lace_devcontainer`) is hardcoded in the current config. Should this be:
- A required option to `apply_to_config`
- A default that can be overridden
- Auto-detected from the environment

**Recommendation**: Required option with a sensible error message if missing.

---

## Example Plugins Referenced

The following community plugins demonstrate the patterns described:

| Plugin | Repository | Key Pattern |
|--------|------------|-------------|
| smart_workspace_switcher | [MLFlexer/smart_workspace_switcher.wezterm](https://github.com/MLFlexer/smart_workspace_switcher.wezterm) | `apply_to_config`, event emission, InputSelector |
| resurrect | [MLFlexer/resurrect.wezterm](https://github.com/MLFlexer/resurrect.wezterm) | Modular exports, state management, fuzzy_loader |
| sessionizer | [mikkasendke/sessionizer.wezterm](https://github.com/mikkasendke/sessionizer.wezterm) | Schema-based configuration |
| dev.wezterm | [ChrisGVE/dev.wezterm](https://github.com/ChrisGVE/dev.wezterm) | Local development helpers, path resolution |

---

## Sources

- [WezTerm Plugin Documentation](https://wezterm.org/config/plugins.html)
- [WezTerm Plugin Discussion #3989](https://github.com/wezterm/wezterm/discussions/3989) - Runtime directory access
- [WezTerm Plugin Discussion #4125](https://github.com/wezterm/wezterm/discussions/4125) - Default plugin directories
- [WezTerm docs/config/plugins.md](https://github.com/wezterm/wezterm/blob/main/docs/config/plugins.md)
- [smart_workspace_switcher.wezterm](https://github.com/MLFlexer/smart_workspace_switcher.wezterm)
- [resurrect.wezterm](https://github.com/MLFlexer/resurrect.wezterm)
- [dev.wezterm](https://github.com/ChrisGVE/dev.wezterm)
