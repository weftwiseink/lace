-- Lace WezTerm Plugin Usage Example
-- For personal wezterm config, see your dotfiles repo.
-- This file demonstrates loading the lace plugin for devcontainer access.

local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder()

-- Minimal config for plugin demonstration
config.color_scheme = "Solarized Dark (Gogh)"

-- =============================================================================
-- Lace Plugin
-- Provides SSH domain and worktree picker for lace devcontainer access.
-- See config/wezterm/lace-plugin/README.md for details.
-- =============================================================================

-- Get the plugin path
-- When using this config from the lace repo, the plugin is in the same directory.
-- In production, personal configs should use absolute paths.
local function get_lace_plugin_path()
  -- Check if we're in a container with lace mounted as a plugin
  local is_container = os.getenv("REMOTE_CONTAINERS") ~= nil
  if is_container then
    return "file:///mnt/lace/plugins/lace/config/wezterm/lace-plugin"
  end

  -- Default: assume we're running from the lace repo checkout
  return "file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin"
end

local ok, lace_plugin = pcall(wezterm.plugin.require, get_lace_plugin_path())
if ok then
  lace_plugin.apply_to_config(config, {
    ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
    domain_name = "lace",
    ssh_port = "localhost:2222",
    username = "node",
    workspace_path = "/workspace",
  })

  -- Example: Add lace-specific keybindings
  config.keys = config.keys or {}

  -- Leader+D: Quick connect to lace devcontainer
  config.leader = { key = "z", mods = "ALT", timeout_milliseconds = 1000 }
  table.insert(config.keys, {
    key = "d",
    mods = "LEADER",
    action = lace_plugin.connect_action({
      domain_name = "lace",
      workspace_path = "/workspace",
      main_worktree = "lace",
    }),
  })

  -- Leader+W: Worktree picker
  table.insert(config.keys, {
    key = "w",
    mods = "LEADER",
    action = act.EmitEvent(lace_plugin.get_picker_event("lace")),
  })
else
  wezterm.log_warn("Failed to load lace plugin: " .. tostring(lace_plugin))
end

return config
