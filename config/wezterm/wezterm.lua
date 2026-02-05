-- Lace WezTerm Plugin Usage Example
-- For personal wezterm config, see your dotfiles repo.
-- This file demonstrates loading the lace plugin for devcontainer access.

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Minimal config for plugin demonstration
config.color_scheme = "Solarized Dark (Gogh)"

-- =============================================================================
-- Lace Plugin
-- Provides SSH domains and project picker for lace devcontainer access.
-- See https://github.com/weftwiseink/lace.wezterm for documentation.
-- =============================================================================

-- Load the plugin from GitHub (recommended)
-- For local development, set LACE_WEZTERM_DEV=/path/to/local/lace.wezterm
local plugin_url = os.getenv("LACE_WEZTERM_DEV")
  and ("file://" .. os.getenv("LACE_WEZTERM_DEV"))
  or "https://github.com/weftwiseink/lace.wezterm"

local ok, lace_plugin = pcall(wezterm.plugin.require, plugin_url)
if ok then
  lace_plugin.apply_to_config(config, {
    ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
    -- Default keybinding: CTRL+SHIFT+P for project picker
    -- Customize with picker_key and picker_mods options
  })
else
  wezterm.log_warn("Failed to load lace plugin: " .. tostring(lace_plugin))
end

return config
