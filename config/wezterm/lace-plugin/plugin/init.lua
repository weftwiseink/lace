-- Lace WezTerm Plugin
-- Provides SSH domain configuration and worktree picker for lace devcontainers.
--
-- Usage:
--   local lace = wezterm.plugin.require("file:///path/to/lace/config/wezterm/lace-plugin")
--   lace.apply_to_config(config, {
--     ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
--     domain_name = "lace",
--     ssh_port = "localhost:2222",
--   })
--
-- Or manually trigger the worktree picker:
--   wezterm.action.EmitEvent("lace.trigger-worktree-picker.lace")

local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Configurable defaults
M.defaults = {
  domain_name = "lace",           -- Name of the SSH domain
  ssh_port = "localhost:2222",    -- SSH connection address
  username = "node",              -- Container user
  workspace_path = "/workspace",  -- Where worktrees are mounted
  main_worktree = "main",         -- Default worktree name
  remote_wezterm_path = "/usr/local/bin/wezterm",
  -- NOTE: domain_name "lace" may conflict if multiple projects use this plugin
  -- with different configurations. Future work should consider a namespacing
  -- strategy (e.g., "lace:<project-name>") to avoid collision.
}

-- Track registered event handlers to prevent duplicates
M._registered_events = {}
M._status_registered = false

--- Set up the SSH domain for connecting to the devcontainer.
-- @param config WezTerm config object
-- @param opts Plugin options
local function setup_ssh_domain(config, opts)
  config.ssh_domains = config.ssh_domains or {}
  table.insert(config.ssh_domains, {
    name = opts.domain_name,
    remote_address = opts.ssh_port,
    username = opts.username,
    remote_wezterm_path = opts.remote_wezterm_path,
    multiplexing = "WezTerm",
    ssh_option = {
      identityfile = opts.ssh_key,
      -- Host key verification should be handled by pre-populating ~/.ssh/known_hosts
      -- before connecting. Do NOT use userknownhostsfile = "/dev/null".
    },
  })
end

--- Create an action to spawn a workspace connected to a container worktree.
-- @param name Worktree name
-- @param opts Plugin options
-- @return WezTerm action
local function spawn_worktree_workspace(name, opts)
  return act.SwitchToWorkspace({
    name = name,
    spawn = {
      domain = { DomainName = opts.domain_name },
      cwd = opts.workspace_path .. "/" .. name,
    },
  })
end

--- Set up the worktree picker event handler.
-- Queries /workspace/ in the container and shows a fuzzy selector.
-- @param opts Plugin options
-- @return Event name for triggering the picker
local function setup_worktree_picker(opts)
  local event_name = "lace.trigger-worktree-picker." .. opts.domain_name

  -- Only register the event once per domain
  if M._registered_events[event_name] then
    return event_name
  end

  wezterm.on(event_name, function(window, pane)
    local port = opts.ssh_port:match(":(%d+)$") or "2222"
    local success, stdout = wezterm.run_child_process({
      "ssh", "-p", port,
      "-i", opts.ssh_key,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      opts.username .. "@localhost",
      "ls", "-1", opts.workspace_path,
    })

    if not success then
      window:toast_notification(opts.domain_name, "Container not running or SSH failed", nil, 3000)
      return
    end

    local choices = {}
    for name in stdout:gmatch("[^\n]+") do
      -- Skip hidden dirs and common non-worktree items
      if not name:match("^%.") and name ~= "node_modules" then
        table.insert(choices, { id = name, label = name })
      end
    end

    if #choices == 0 then
      window:toast_notification(opts.domain_name, "No worktrees found in " .. opts.workspace_path, nil, 3000)
      return
    end

    window:perform_action(
      act.InputSelector({
        title = "Select Worktree (" .. opts.domain_name .. ")",
        choices = choices,
        action = wezterm.action_callback(function(win, _, id)
          if id then
            win:perform_action(spawn_worktree_workspace(id, opts), pane)
          end
        end),
      }),
      pane
    )
  end)

  M._registered_events[event_name] = true
  return event_name
end

--- Set up the status bar to show workspace name.
-- Only registers once globally (shared across all plugin instances).
local function setup_status_bar()
  if M._status_registered then
    return
  end

  wezterm.on("update-status", function(window, pane)
    local workspace = window:active_workspace()
    window:set_left_status(wezterm.format({
      { Background = { Color = "#073642" } },
      { Foreground = { Color = "#2aa198" } },
      { Text = "  " .. workspace .. " " },
    }))
  end)

  M._status_registered = true
end

-- NOTE: Keybindings (Leader+D, Leader+W) are intentionally disabled.
-- When multiple projects use this plugin with different configurations,
-- the keybindings conflict (each overwriting the previous).
-- See RFP: cdocs/proposals/2026-02-04-wezterm-project-picker.md for the
-- planned project picker feature that will provide a unified UI for
-- selecting which project's devcontainer to connect to.
--
-- For now, users can invoke the picker event directly via:
--   wezterm.action.EmitEvent("lace.trigger-worktree-picker.<domain_name>")
--
-- Or add their own keybindings:
--   table.insert(config.keys, {
--     key = "d", mods = "LEADER",
--     action = act.SwitchToWorkspace({
--       name = "lace",
--       spawn = { domain = { DomainName = "lace" }, cwd = "/workspace/main" },
--     }),
--   })
local function setup_keybindings(config, opts, picker_event)
  -- Keybindings disabled pending project picker feature
  -- config.keys = config.keys or {}
  -- table.insert(config.keys, { key = "d", mods = "LEADER", action = ... })
  -- table.insert(config.keys, { key = "w", mods = "LEADER", action = ... })
end

--- Apply the lace plugin configuration to a WezTerm config.
-- @param config WezTerm config object (from config_builder())
-- @param opts Plugin options:
--   - ssh_key (required): Path to SSH private key for container access
--   - domain_name (optional): SSH domain name, default "lace"
--   - ssh_port (optional): SSH address, default "localhost:2222"
--   - username (optional): Container user, default "node"
--   - workspace_path (optional): Container worktree path, default "/workspace"
--   - main_worktree (optional): Default worktree name, default "main"
--   - remote_wezterm_path (optional): Path to wezterm in container
--   - enable_status_bar (optional): Show workspace in status bar, default true
function M.apply_to_config(config, opts)
  opts = opts or {}

  -- Merge defaults with provided options
  for k, v in pairs(M.defaults) do
    if opts[k] == nil then
      opts[k] = v
    end
  end

  -- ssh_key is required
  if not opts.ssh_key then
    wezterm.log_error("lace plugin: ssh_key option is required")
    return
  end

  -- Set up SSH domain for devcontainer connection
  setup_ssh_domain(config, opts)

  -- Set up worktree picker event
  local picker_event = setup_worktree_picker(opts)

  -- Set up status bar (unless disabled)
  if opts.enable_status_bar ~= false then
    setup_status_bar()
  end

  -- Set up keybindings (currently disabled)
  setup_keybindings(config, opts, picker_event)
end

--- Get the worktree picker event name for a domain.
-- Useful for adding custom keybindings.
-- @param domain_name The SSH domain name
-- @return Event name string
function M.get_picker_event(domain_name)
  return "lace.trigger-worktree-picker." .. (domain_name or M.defaults.domain_name)
end

--- Create an action to connect to the devcontainer's main worktree.
-- @param opts Options (domain_name, workspace_path, main_worktree)
-- @return WezTerm action
function M.connect_action(opts)
  opts = opts or {}
  local domain_name = opts.domain_name or M.defaults.domain_name
  local workspace_path = opts.workspace_path or M.defaults.workspace_path
  local main_worktree = opts.main_worktree or M.defaults.main_worktree

  return act.SwitchToWorkspace({
    name = domain_name,
    spawn = {
      domain = { DomainName = domain_name },
      cwd = workspace_path .. "/" .. main_worktree,
    },
  })
end

return M
