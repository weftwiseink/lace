# Lace WezTerm Plugin

A WezTerm plugin for connecting to lace devcontainers via SSH domain multiplexing.

## Features

- **SSH Domain**: Configures an SSH domain for connecting to the devcontainer's wezterm-mux-server
- **Worktree Picker**: Fuzzy selector for switching between worktrees in the container
- **Status Bar**: Displays the current workspace name in the left status area

## Installation

The plugin is loaded using WezTerm's `plugin.require` with a `file://` URL:

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Load the lace plugin
local lace = wezterm.plugin.require("file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin")

-- Apply plugin configuration
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
})

return config
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `ssh_key` | (required) | Path to SSH private key for container access |
| `domain_name` | `"lace"` | SSH domain name |
| `ssh_port` | `"localhost:2222"` | SSH address (host:port) |
| `username` | `"node"` | Container user |
| `workspace_path` | `"/workspace"` | Container path where worktrees are mounted |
| `main_worktree` | `"main"` | Default worktree name |
| `remote_wezterm_path` | `"/usr/local/bin/wezterm"` | Path to wezterm binary in container |
| `enable_status_bar` | `true` | Show workspace name in status bar |

## Usage

### Connecting to the Devcontainer

After applying the plugin, you can connect to the devcontainer using:

```lua
-- In wezterm.lua, add a keybinding:
table.insert(config.keys, {
  key = "d",
  mods = "LEADER",
  action = lace.connect_action(),
})
```

Or use WezTerm's launcher to connect to the SSH domain directly.

### Worktree Picker

The plugin registers an event handler for picking worktrees. Trigger it with:

```lua
table.insert(config.keys, {
  key = "w",
  mods = "LEADER",
  action = wezterm.action.EmitEvent(lace.get_picker_event()),
})
```

This shows a fuzzy selector listing directories in `/workspace/` and switches to a workspace connected to the selected worktree.

## Multiple Projects

When using this plugin for multiple projects, configure each with a unique domain name:

```lua
-- Lace project
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  domain_name = "lace",
  ssh_port = "localhost:2222",
})

-- Dotfiles project
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/dotfiles_devcontainer",
  domain_name = "dotfiles",
  ssh_port = "localhost:2223",
})
```

Note: Keybindings are intentionally disabled to avoid conflicts. Add your own keybindings using the helper functions.

## Prerequisites

1. **SSH Key**: Generate a key pair for container access:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""
   ```

2. **WezTerm Server**: The devcontainer must have `wezterm-mux-server` installed and running. Use the `ghcr.io/weftwiseink/devcontainer-features/wezterm-server` feature.

3. **SSHD**: The devcontainer must expose SSH access. Use the `ghcr.io/devcontainers/features/sshd` feature and expose port 2222.

## Plugin Caching

WezTerm caches plugins. After modifying the plugin source, reload your configuration (Leader+R by default) or use the Debug Overlay to call `wezterm.plugin.update_all()`.

## Related

- [Lace Devcontainer](https://github.com/weftwiseink/lace) - Main lace project
- [WezTerm Plugin System](https://wezfurlong.org/wezterm/config/plugins.html) - WezTerm plugin documentation
