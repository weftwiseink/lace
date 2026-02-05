-- Lace WezTerm Plugin
-- Provides SSH domain configuration and project discovery for lace devcontainers.
--
-- Usage:
--   local lace = wezterm.plugin.require("file:///path/to/lace/config/wezterm/lace-plugin")
--   lace.apply_to_config(config, {
--     ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
--   })
--
-- Features:
--   - Pre-registers SSH domains for ports 22425-22499 (lace port range)
--   - Discovers running devcontainers via Docker CLI when picker is invoked
--   - Project picker shows all running lace devcontainers
--   - No central registry needed - fully decoupled discovery
--
-- Keybinding:
--   CTRL+SHIFT+P - Open project picker (configurable via picker_key option)
--
-- Or manually trigger the picker:
--   wezterm.action.EmitEvent("lace.project-picker")

local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Port range for lace devcontainer SSH servers
-- w=22, e=4, z=25 spells "wez" in alphabet positions
M.PORT_MIN = 22425
M.PORT_MAX = 22499

-- Configurable defaults
M.defaults = {
  username = "node",                    -- Default container user
  workspace_path = "/workspace",        -- Where worktrees are mounted
  remote_wezterm_path = "/usr/local/bin/wezterm",
  picker_key = "p",                     -- Key for project picker
  picker_mods = "CTRL|SHIFT",           -- Modifiers for project picker
  enable_status_bar = true,             -- Show workspace in status bar
}

-- Track registered event handlers to prevent duplicates
M._registered_events = {}
M._status_registered = false
M._domains_registered = false

--- Pre-register SSH domains for all ports in the lace range.
-- This allows connecting to any discovered project without needing
-- to register domains dynamically (which WezTerm doesn't support).
-- @param config WezTerm config object
-- @param opts Plugin options (ssh_key required)
local function setup_port_domains(config, opts)
  if M._domains_registered then
    return
  end

  config.ssh_domains = config.ssh_domains or {}

  for port = M.PORT_MIN, M.PORT_MAX do
    table.insert(config.ssh_domains, {
      name = "lace:" .. port,
      remote_address = "localhost:" .. port,
      username = opts.username,
      remote_wezterm_path = opts.remote_wezterm_path,
      multiplexing = "WezTerm",
      ssh_option = {
        identityfile = opts.ssh_key,
        -- Host key verification handled by pre-populating ~/.ssh/known_hosts
      },
    })
  end

  M._domains_registered = true
  wezterm.log_info("lace: registered " .. (M.PORT_MAX - M.PORT_MIN + 1) .. " SSH domains for ports " .. M.PORT_MIN .. "-" .. M.PORT_MAX)
end

--- Discover running lace devcontainers via Docker CLI.
-- Queries Docker for containers with devcontainer.local_folder label
-- and ports in the lace range (22425-22499).
-- @return Table of projects keyed by name: { port, name, path, user, container_id }
local function discover_projects()
  -- Get all devcontainers with their ports and project paths
  local success, stdout, stderr = wezterm.run_child_process({
    "docker", "ps",
    "--filter", "label=devcontainer.local_folder",
    "--format", "{{.ID}}\t{{.Label \"devcontainer.local_folder\"}}\t{{.Ports}}"
  })

  if not success then
    wezterm.log_warn("lace: docker ps failed: " .. (stderr or "unknown error"))
    return {}
  end

  local projects = {}

  for line in stdout:gmatch("[^\n]+") do
    local id, local_folder, ports = line:match("^(%S+)\t(.+)\t(.*)$")
    if id and local_folder then
      -- Extract project name from path
      local name = local_folder:match("([^/]+)$")

      -- Find SSH port in expected range (22425-22499)
      -- Port format: "0.0.0.0:22425->2222/tcp" or ":::22425->2222/tcp"
      local ssh_port = nil
      for port_str in ports:gmatch("(%d+)%->2222/tcp") do
        local p = tonumber(port_str)
        if p and p >= M.PORT_MIN and p <= M.PORT_MAX then
          ssh_port = p
          break
        end
      end

      if ssh_port and name then
        -- Get container user
        local user_success, user_stdout = wezterm.run_child_process({
          "docker", "inspect", id, "--format", "{{.Config.User}}"
        })
        local user = M.defaults.username
        if user_success and user_stdout then
          local extracted_user = user_stdout:gsub("%s+", "")
          if extracted_user ~= "" and extracted_user ~= "root" then
            user = extracted_user
          end
        end

        projects[name] = {
          port = ssh_port,
          name = name,
          path = local_folder,
          user = user,
          container_id = id,
        }
      end
    end
  end

  return projects
end

--- Set up the project picker event handler.
-- Shows a selector with all discovered lace devcontainers.
-- @param opts Plugin options
local function setup_project_picker(opts)
  local event_name = "lace.project-picker"

  -- Only register once
  if M._registered_events[event_name] then
    return event_name
  end

  wezterm.on(event_name, function(window, pane)
    local projects = discover_projects()
    local choices = {}

    for name, info in pairs(projects) do
      table.insert(choices, {
        id = name,
        label = string.format("[*] %s (:%d) - %s", name, info.port, info.path),
      })
    end

    if #choices == 0 then
      window:toast_notification("lace", "No running devcontainers found", nil, 5000)
      return
    end

    -- Sort by label for consistent ordering
    table.sort(choices, function(a, b) return a.label < b.label end)

    window:perform_action(
      act.InputSelector({
        title = "Lace Projects",
        choices = choices,
        action = wezterm.action_callback(function(win, _, id)
          if not id then return end
          local project = projects[id]
          if not project then return end

          -- Connect via pre-registered port-based domain
          win:perform_action(
            act.SwitchToWorkspace({
              name = id,
              spawn = {
                domain = { DomainName = "lace:" .. project.port },
                cwd = opts.workspace_path,
              },
            }),
            pane
          )
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

--- Set up keybindings for the project picker.
-- @param config WezTerm config object
-- @param opts Plugin options
-- @param picker_event Event name for the picker
local function setup_keybindings(config, opts, picker_event)
  if not opts.picker_key then
    return
  end

  config.keys = config.keys or {}
  table.insert(config.keys, {
    key = opts.picker_key,
    mods = opts.picker_mods,
    action = act.EmitEvent(picker_event),
  })
end

--- Apply the lace plugin configuration to a WezTerm config.
-- @param config WezTerm config object (from config_builder())
-- @param opts Plugin options:
--   - ssh_key (required): Path to SSH private key for container access
--   - username (optional): Default container user, default "node"
--   - workspace_path (optional): Container workspace path, default "/workspace"
--   - remote_wezterm_path (optional): Path to wezterm in container
--   - picker_key (optional): Key for project picker, default "p"
--   - picker_mods (optional): Modifiers for picker, default "CTRL|SHIFT"
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

  -- Pre-register SSH domains for all ports in range
  setup_port_domains(config, opts)

  -- Set up project picker event
  local picker_event = setup_project_picker(opts)

  -- Set up keybindings for picker
  setup_keybindings(config, opts, picker_event)

  -- Set up status bar (unless disabled)
  if opts.enable_status_bar then
    setup_status_bar()
  end
end

--- Manually trigger project discovery (for testing/debugging).
-- @return Table of discovered projects
function M.discover()
  return discover_projects()
end

--- Get the project picker event name.
-- Useful for adding custom keybindings.
-- @return Event name string
function M.get_picker_event()
  return "lace.project-picker"
end

return M
