-- lace wezterm config
-- Usage: WEZTERM_CONFIG_FILE=/workspace/main/lace/config/wezterm/wezterm.lua wezterm
-- Or symlink: ln -s /workspace/main/lace/config/wezterm/wezterm.lua ~/.config/wezterm/wezterm.lua

local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder()

-- =============================================================================
-- Appearance
-- =============================================================================

config.color_scheme = "Solarized Dark (Gogh)"
config.font = wezterm.font("JetBrains Mono", { weight = "Medium" })
config.font_size = 12.0
config.line_height = 1.2

-- Window
config.window_background_opacity = 0.95
config.window_padding = { left = 4, right = 4, top = 4, bottom = 4 }
config.window_decorations = "RESIZE"
config.hide_tab_bar_if_only_one_tab = false
config.tab_bar_at_bottom = true
config.use_fancy_tab_bar = false

-- Status bar (shows workspace name)
wezterm.on("update-status", function(window, pane)
  local workspace = window:active_workspace()
  window:set_left_status(wezterm.format({
    { Background = { Color = "#073642" } },
    { Foreground = { Color = "#2aa198" } },
    { Text = "  " .. workspace .. " " },
  }))
end)

-- =============================================================================
-- Core Settings
-- =============================================================================

config.scrollback_lines = 99999
config.enable_scroll_bar = false
config.check_for_updates = false

-- Note: escape key delay is handled at the terminal/shell/neovim level, not wezterm
-- For neovim: set timeoutlen=300 and ttimeoutlen=10 in init.lua

-- =============================================================================
-- Multiplexing - Unix Domain (enables session persistence)
-- =============================================================================

config.unix_domains = {
  { name = "unix" },
}

-- Uncomment to auto-connect to mux on startup (enables persistence across restarts)
-- config.default_gui_startup_args = { "connect", "unix" }

-- =============================================================================
-- Multiplexing - SSH Domain (devcontainer access)
-- Connects to wezterm-mux-server running inside the devcontainer via SSH.
-- See docs/proposals/wezterm_devcontainer_multiplexing.md
-- =============================================================================

config.ssh_domains = {
  {
    name = "lace",
    remote_address = "localhost:2222",
    username = "node",
    remote_wezterm_path = "/usr/local/bin/wezterm",
    multiplexing = "WezTerm",
    ssh_option = {
      identityfile = wezterm.home_dir .. "/.ssh/lace_devcontainer",
    },
  },
}

-- =============================================================================
-- Keybindings
-- Modeled after mjr's tmux.conf:
-- - Ctrl+H/J/K/L: pane navigation
-- - Alt+H/J/K/L: splits
-- - Alt+N/P: tab navigation
-- - Alt+C: copy mode
-- =============================================================================

config.leader = { key = "z", mods = "ALT", timeout_milliseconds = 1000 }

config.keys = {
  -- Pane navigation: Ctrl+H/J/K/L
  { key = "h", mods = "CTRL", action = act.ActivatePaneDirection("Left") },
  { key = "j", mods = "CTRL", action = act.ActivatePaneDirection("Down") },
  { key = "k", mods = "CTRL", action = act.ActivatePaneDirection("Up") },
  { key = "l", mods = "CTRL", action = act.ActivatePaneDirection("Right") },

  -- Splits: Alt+H/J/K/L (preserving cwd)
  { key = "l", mods = "ALT", action = act.SplitPane({ direction = "Right", size = { Percent = 50 } }) },
  { key = "h", mods = "ALT", action = act.SplitPane({ direction = "Left", size = { Percent = 50 } }) },
  { key = "j", mods = "ALT", action = act.SplitPane({ direction = "Down", size = { Percent = 50 } }) },
  { key = "k", mods = "ALT", action = act.SplitPane({ direction = "Up", size = { Percent = 50 } }) },

  -- Tab management: Alt+N (new), Alt+N/P (cycle)
  { key = "n", mods = "ALT|SHIFT", action = act.SpawnTab("CurrentPaneDomain") },
  { key = "n", mods = "ALT", action = act.ActivateTabRelative(1) },
  { key = "p", mods = "ALT", action = act.ActivateTabRelative(-1) },

  -- Close pane: Alt+W
  { key = "w", mods = "ALT", action = act.CloseCurrentPane({ confirm = true }) },

  -- Copy mode: Alt+C (like tmux Alt-C)
  { key = "c", mods = "ALT", action = act.ActivateCopyMode },

  -- Workspace switching (worktree-oriented)
  { key = "s", mods = "LEADER", action = act.ShowLauncherArgs({ flags = "FUZZY|WORKSPACES" }) },

  -- Quick workspace access
  { key = "1", mods = "LEADER", action = act.SwitchToWorkspace({ name = "main" }) },
  { key = "2", mods = "LEADER", action = act.SwitchToWorkspace({ name = "feature" }) },
  { key = "3", mods = "LEADER", action = act.SwitchToWorkspace({ name = "scratch" }) },

  -- Pane zoom toggle: Leader+Z
  { key = "z", mods = "LEADER", action = act.TogglePaneZoomState },

  -- Resize panes: Ctrl+Alt+H/J/K/L
  { key = "h", mods = "CTRL|ALT", action = act.AdjustPaneSize({ "Left", 5 }) },
  { key = "j", mods = "CTRL|ALT", action = act.AdjustPaneSize({ "Down", 5 }) },
  { key = "k", mods = "CTRL|ALT", action = act.AdjustPaneSize({ "Up", 5 }) },
  { key = "l", mods = "CTRL|ALT", action = act.AdjustPaneSize({ "Right", 5 }) },

  -- Quick actions
  { key = ":", mods = "LEADER", action = act.ActivateCommandPalette },
  { key = "r", mods = "LEADER", action = act.ReloadConfiguration },
}

-- =============================================================================
-- Devcontainer: Connect + Worktree Picker
-- Leader+D: connect to lace devcontainer (SSH domain)
-- Leader+W: pick a worktree from /workspace/ inside container
-- =============================================================================

-- Quick connect to devcontainer at /workspace/main
table.insert(config.keys, {
  key = "d",
  mods = "LEADER",
  action = act.SwitchToWorkspace({
    name = "lace",
    spawn = {
      domain = { DomainName = "lace" },
      cwd = "/workspace/main",
    },
  }),
})

-- Helper: spawn a workspace connected to a container worktree
local function spawn_worktree_workspace(name)
  return act.SwitchToWorkspace({
    name = name,
    spawn = {
      domain = { DomainName = "lace" },
      cwd = "/workspace/" .. name,
    },
  })
end

-- Worktree picker: queries /workspace/ in the container, shows fuzzy selector
wezterm.on("trigger-worktree-picker", function(window, pane)
  local ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer"
  local success, stdout = wezterm.run_child_process({
    "ssh", "-p", "2222",
    "-i", ssh_key,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "node@localhost",
    "ls", "-1", "/workspace",
  })

  if not success then
    window:toast_notification("lace", "Container not running or SSH failed", nil, 3000)
    return
  end

  local choices = {}
  for name in stdout:gmatch("[^\n]+") do
    -- Skip hidden dirs and non-worktree items
    if not name:match("^%.") and name ~= "node_modules" then
      table.insert(choices, {
        id = name,
        label = name,
      })
    end
  end

  window:perform_action(
    act.InputSelector({
      title = "Select Worktree",
      choices = choices,
      action = wezterm.action_callback(function(win, _, id, label)
        if id then
          win:perform_action(spawn_worktree_workspace(id), pane)
        end
      end),
    }),
    pane
  )
end)

table.insert(config.keys, {
  key = "w",
  mods = "LEADER",
  action = act.EmitEvent("trigger-worktree-picker"),
})

-- =============================================================================
-- Copy Mode Customization
-- Default is already vim-like, but we can extend it
-- =============================================================================

local copy_mode = nil
if wezterm.gui then
  copy_mode = wezterm.gui.default_key_tables().copy_mode
  -- Add any custom copy_mode bindings here
  -- table.insert(copy_mode, { key = "y", action = act.CopyTo("ClipboardAndPrimarySelection") })
end

if copy_mode then
  config.key_tables = {
    copy_mode = copy_mode,
  }
end

-- =============================================================================
-- Workspaces for Worktrees
-- Create workspace when spawning into a worktree directory
-- =============================================================================

wezterm.on("gui-startup", function(cmd)
  -- Default workspace is "main", use home directory as default cwd
  local tab, pane, window = wezterm.mux.spawn_window({
    workspace = "main",
    cwd = wezterm.home_dir,
  })
  -- Could auto-create additional workspaces here
end)

-- =============================================================================
-- Smart Workspace Switcher (optional integration)
-- Uncomment if using smart_workspace_switcher.wezterm plugin
-- =============================================================================

-- local workspace_switcher = wezterm.plugin.require("https://github.com/MLFlexer/smart_workspace_switcher.wezterm")
-- workspace_switcher.apply_to_config(config)

-- =============================================================================
-- Session Persistence (optional)
-- Uncomment if using resurrect.wezterm plugin
-- =============================================================================

-- local resurrect = wezterm.plugin.require("https://github.com/MLFlexer/resurrect.wezterm")
-- resurrect.periodic_save({ interval_seconds = 300 })
--
-- config.keys = wezterm.util.merge(config.keys, {
--   { key = "S", mods = "LEADER", action = wezterm.action_callback(function(win, pane)
--     resurrect.save_state(resurrect.workspace_state.get_workspace_state())
--   end) },
--   { key = "R", mods = "LEADER", action = wezterm.action_callback(function(win, pane)
--     resurrect.fuzzy_load(win, pane, function(id, label)
--       local state = resurrect.load_state(id, "workspace")
--       resurrect.workspace_state.restore_workspace(state, { relative = true, restore_text = true })
--     end)
--   end) },
-- })

return config
