---
title: "Tab-Oriented WezTerm Integration"
first_authored:
  by: "@claude"
  at: "2026-02-28T17:33:00-06:00"
task_list: null
type: report
state: archived
status: done
tags: [analysis, wezterm, architecture]
related_to:
  - cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
  - cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
  - cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md
  - cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md
  - cdocs/reports/2026-02-10-lace-wezterm-setup-status.md
  - cdocs/reports/2026-02-26-wezterm-connectivity-mechanism-investigation.md
---

# Tab-Oriented WezTerm Integration

## > BLUF

The current lace WezTerm integration is workspace-oriented: `wez-into` and the
lace.wezterm project picker both use `wezterm connect lace:<port> --workspace
<project>` or `act.SwitchToWorkspace`, which creates a new WezTerm window per
project. Migrating to a tab-oriented model -- where all lace devcontainers open
as tabs within a single WezTerm window -- is architecturally feasible but
requires changes across three layers: the `wez-into` CLI script, the
lace.wezterm plugin's picker action, and the user's mental model of how WezTerm
multiplexer domains interact with tabs vs. workspaces. The most significant
constraint is that `wezterm connect` (the CLI command) always opens a new window
and cannot target an existing window as a tab; `SpawnTab` from Lua is the
correct primitive for the tab-oriented model.

## Context / Background

### What Prompted This Analysis

The user wants to constrain lace usage to a single WezTerm window, using tabs
instead of workspaces to switch between devcontainer projects. The current
workspace-per-project model creates multiple windows, which can be unwieldy
depending on desktop environment and workflow preferences.

### WezTerm Workspaces vs. Tabs

WezTerm has a three-level hierarchy: **workspace > tab > pane**.

- **Workspace**: A named grouping of tabs. Switching workspaces replaces the
  entire tab bar with a different set of tabs. Only one workspace is visible at
  a time per window. The workspace name appears in the status bar. Workspaces
  are a WezTerm-level concept (not a multiplexer concept) -- they exist within
  the GUI process's tab management layer.

- **Tab**: A container for panes within a workspace. Tabs appear in the tab bar.
  Multiple tabs can coexist, each connected to different multiplexer domains.

- **Pane**: A terminal surface within a tab. Panes can be split within a tab.

The critical distinction: **a single tab can be connected to an SSH domain
(multiplexer) while other tabs in the same window remain local or connected to
different domains.** This is the foundation that makes tab-oriented multi-project
work possible.

### The Current Workspace-Oriented Architecture

The deployed wezterm config (`~/.config/wezterm/wezterm.lua`) uses the unix
domain multiplexer for session persistence:

```lua
config.unix_domains = { { name = "unix" } }
config.default_gui_startup_args = { "connect", "unix" }
```

The mux-startup event creates a "main" workspace:

```lua
wezterm.on("mux-startup", function()
  local tab, pane, window = wezterm.mux.spawn_window({
    workspace = "main",
    cwd = wezterm.home_dir,
  })
end)
```

The user has Leader+1/2/3 for quick workspace switching (main, feature, scratch)
and Leader+S for a fuzzy workspace launcher. The lace.wezterm plugin adds a
project picker (CTRL+SHIFT+P and Leader+W) that uses `act.SwitchToWorkspace` to
create named workspaces per project.

## Current Architecture

### How Lace Uses WezTerm

There are two connection paths -- CLI and plugin -- and both are
workspace-oriented:

**Path 1: `wez-into` CLI script** (`lace/bin/wez-into`)

The script discovers running devcontainers via `lace-discover` (Docker label
query), then invokes:

```bash
wezterm connect "lace:$port" --workspace "$project" &>/dev/null &
disown
```

Key behaviors:
- `wezterm connect` **always opens a new GUI window**. It cannot target an
  existing window.
- The `--workspace` flag names the workspace within that new window.
- The process is backgrounded and disowned so the calling terminal returns
  immediately.
- If WezTerm is not running, `wezterm connect` starts a new GUI instance.
- If WezTerm is already running, it hands off to the existing instance, but
  still creates a **new window**.

**Path 2: lace.wezterm plugin picker** (`plugin/init.lua`)

The project picker uses `act.SwitchToWorkspace`:

```lua
win:perform_action(
  act.SwitchToWorkspace({
    name = id,       -- e.g., "lace"
    spawn = {
      domain = { DomainName = "lace:" .. project.port },
      cwd = opts.workspace_path,
    },
  }),
  pane
)
```

Key behaviors:
- `SwitchToWorkspace` creates a new workspace named after the project.
- Within the same WezTerm process, the window switches to the new workspace.
- The first tab in that workspace connects to the SSH domain for the
  devcontainer.
- Returning to the previous workspace preserves its tab/pane state.
- The workspace is visible in the left status bar.

### The Multiplexer Domain Model

The lace.wezterm plugin pre-registers 75 SSH domains at config load time (one
per port in the 22425-22499 range):

```lua
for port = M.PORT_MIN, M.PORT_MAX do
  table.insert(config.ssh_domains, {
    name = "lace:" .. port,
    remote_address = "localhost:" .. port,
    username = port_users[port] or opts.username,
    remote_wezterm_path = opts.remote_wezterm_path,
    multiplexing = "WezTerm",
    ssh_option = {
      identityfile = opts.ssh_key,
      userknownhostsfile = M.KNOWN_HOSTS_FILE,
    },
  })
end
```

Domain registration happens at startup and is static (WezTerm does not support
dynamic domain registration). The domains exist regardless of whether any
containers are running. Discovery of which domains have active containers
happens on-demand via `docker ps` when the picker is invoked.

### How `wezterm connect` Creates New Windows

The `wezterm connect <domain>` CLI subcommand is architecturally different from
the Lua `SwitchToWorkspace` or `SpawnTab` actions:

- **`wezterm connect`**: Starts a new GUI window (or spawns a new WezTerm
  process if none is running). The window is attached to the specified
  multiplexer domain. There is no CLI mechanism to target an existing window.

- **`SwitchToWorkspace` (Lua)**: Operates within an existing WezTerm process.
  Creates a new workspace and switches the current window to it.

- **`SpawnTab` (Lua)**: Creates a new tab within the current window's current
  workspace. Can target a specific domain via `SpawnCommand.domain`.

This distinction is fundamental: the CLI path (`wez-into`) inherently creates
new windows, while the Lua path (plugin picker) can operate within the existing
window using either workspaces or tabs.

## WezTerm Tab Model

### How Tabs Work Within a Single Window

Tabs in WezTerm are independent terminal containers within a workspace. Each tab
has:

- Its own set of panes (split layout)
- Its own domain attachment (local, unix, SSH, etc.)
- Its own working directory
- An independent title (settable via OSC escape sequences or Lua)

A single window can have tabs connected to different domains simultaneously.
For example:

- Tab 1: local shell (default domain)
- Tab 2: connected to `lace:22426` (lace devcontainer)
- Tab 3: connected to `lace:22427` (dotfiles devcontainer)
- Tab 4: local nvim session

This works because domain attachment is per-tab (actually per-pane), not
per-window or per-workspace.

### How Multiplexer Domains Interact With Tabs

When a tab is spawned in an SSH domain (`multiplexing = "WezTerm"`), WezTerm:

1. Opens an SSH connection to the remote address
2. Negotiates the WezTerm mux protocol over the SSH tunnel
3. Attaches to the remote `wezterm-mux-server`'s tab/pane tree
4. Renders the remote pane content in the local tab

The remote mux server maintains its own tab tree. When connected via
`multiplexing = "WezTerm"`, WezTerm presents the remote tabs within the local
window. New tabs spawned in that domain appear in the remote mux server's tree
and are reflected locally.

This has an important implication: spawning a tab in domain `lace:22426` does
not just create a local tab -- it creates a remote tab on the container's mux
server. If you disconnect and reconnect, the remote tab persists.

### `SpawnTab` vs. `SwitchToWorkspace` Semantics

| Aspect | `SpawnTab` | `SwitchToWorkspace` |
|--------|-----------|-------------------|
| Creates | A new tab in the current workspace | A new workspace (with its own tab set) |
| Window behavior | Stays in the same window | Stays in the same window (switches tab bar) |
| Visual result | Tab appears in tab bar alongside existing tabs | Entire tab bar is replaced |
| Returning | Tab is always visible | Must switch workspaces to return |
| Domain attachment | Set via `SpawnCommand.domain` in the action | Set via `spawn.domain` in the action |
| CLI equivalent | `wezterm cli spawn --domain-name lace:22426` | No direct CLI equivalent |

For `SpawnTab`, the Lua action is:

```lua
act.SpawnCommandInNewTab({
  domain = { DomainName = "lace:" .. port },
  cwd = "/workspace",
})
```

Or using the more general `SpawnTab`:

```lua
act.SpawnTab("CurrentPaneDomain")  -- inherits domain
```

### Can `wezterm connect` Target an Existing Window as a Tab?

**No.** The `wezterm connect` CLI command always opens a new window. There is no
`--tab` or `--existing-window` flag.

However, `wezterm cli spawn` can create a tab in an existing window's mux:

```bash
wezterm cli spawn --domain-name "lace:22426" --workspace main
```

This creates a new tab in the mux server, attached to the specified domain. If
the GUI is connected to that mux server (which it is when using `connect unix`),
the tab appears in the window.

The `--workspace` flag on `wezterm cli spawn` specifies which workspace the new
tab belongs to, but it does not switch the GUI to that workspace. The user must
switch manually.

## Key Findings

### What Would Need to Change

**1. `wez-into` CLI script**

The `do_connect()` function currently runs:

```bash
wezterm connect "lace:$port" --workspace "$project" &>/dev/null &
disown
```

For tab-oriented operation, this must change to:

```bash
wezterm cli spawn --domain-name "lace:$port" --new-window=false
```

Or, if the user wants the tab created in a specific workspace:

```bash
wezterm cli spawn --domain-name "lace:$port" --workspace main
```

However, `wezterm cli spawn` requires a running WezTerm mux server to
communicate with. If WezTerm is not running, `wezterm cli spawn` will fail
(unlike `wezterm connect`, which can bootstrap a new GUI). The script would
need to handle the "no WezTerm running" case differently -- possibly falling
back to `wezterm connect` for the first invocation.

**2. lace.wezterm plugin picker action**

The picker callback must change from `SwitchToWorkspace` to
`SpawnCommandInNewTab`:

```lua
-- Before (workspace-oriented):
win:perform_action(
  act.SwitchToWorkspace({
    name = id,
    spawn = {
      domain = { DomainName = domain_name },
      cwd = opts.workspace_path,
    },
  }),
  pane
)

-- After (tab-oriented):
win:perform_action(
  act.SpawnCommandInNewTab({
    domain = { DomainName = domain_name },
    cwd = opts.workspace_path,
  }),
  pane
)
```

This is a small code change, but the behavioral shift is significant: instead
of getting a dedicated workspace per project, all project connections appear as
tabs in the current workspace.

**3. Tab naming/identification**

With workspaces, the project name appeared in the left status bar. With tabs,
each project tab needs a distinguishable title. WezTerm can set tab titles via:

- `wezterm.on("format-tab-title", ...)` event handler
- The shell integration's OSC title escape sequences
- The `set_tab_title` method on tab objects (from Lua)

The tab title should include the project name (e.g., "lace", "dotfiles") so the
user can identify which tab connects to which devcontainer.

**4. Re-use detection**

With `SwitchToWorkspace`, calling the picker for a project that is already
connected simply switches to the existing workspace -- it does not create a
duplicate connection. With `SpawnCommandInNewTab`, each invocation creates a new
tab. The plugin would need to check whether a tab already exists for the
selected project's domain and switch to it instead of spawning a duplicate.

This is achievable by iterating the current window's tabs and checking each
tab's pane domain:

```lua
-- Check if a tab already exists for this domain
local tabs = window:mux_window():tabs()
for _, tab in ipairs(tabs) do
  local tab_panes = tab:panes()
  for _, tab_pane in ipairs(tab_panes) do
    if tab_pane:get_domain_name() == domain_name then
      -- Activate this tab instead of spawning a new one
      tab:activate()
      return
    end
  end
end
-- No existing tab found; spawn new one
```

### What Works Naturally With Tabs

- **Single-window workflow**: All devcontainer connections live alongside local
  tabs in one window. No alt-tabbing between WezTerm windows.
- **Tab bar visibility**: All projects are visible in the tab bar simultaneously.
  No hidden workspaces to remember.
- **Keyboard navigation**: Alt+N/P already cycles tabs. No Leader+S workspace
  switching needed.
- **Mixed domains**: Local and remote tabs coexist naturally. A local nvim tab
  next to a devcontainer shell tab is a natural workflow.
- **Pane splits within tabs**: Each project tab can be split into panes (editor +
  shell + build) independently.

### What Becomes Harder With Tabs

- **Visual isolation**: Workspaces provided complete visual separation between
  projects. With tabs, all project tabs share the tab bar, which can get
  crowded with multiple projects.
- **Tab bar real estate**: The config sets `tab_max_width = 40` and
  `show_new_tab_button_in_tab_bar = false`. With local tabs plus multiple
  project tabs, the bar may overflow. WezTerm handles this with scroll arrows
  but it degrades discoverability.
- **Accidental tab closure**: Closing a tab connected to a remote mux server
  disconnects from the domain for that tab. With workspaces, the entire
  workspace's tab set was a self-contained unit that was harder to accidentally
  disrupt.
- **Tab ordering**: New project tabs are appended at the end of the tab bar.
  There is no automatic grouping of project tabs vs. local tabs. The user must
  manually organize them (or the plugin could insert at specific positions, but
  WezTerm's Lua API has limited tab ordering control).
- **Remote tab fan-out**: When connecting to a WezTerm mux domain, all tabs from
  the remote mux server appear locally. If the remote mux has 3 tabs, connecting
  creates 3 local tabs, not 1. This can flood the local tab bar with remote
  tabs. (This is the same behavior with workspaces, but workspaces contain the
  fan-out to a separate namespace.)

### Multiplexer Domain Behavior With Tabs

When using `multiplexing = "WezTerm"` (as lace does), the SSH domain connection
establishes a mux protocol session. The remote mux server's tabs are presented
locally. This means:

- **First connection**: Creates one or more tabs reflecting the remote mux
  server's state. If the remote mux has tabs from a previous session, they all
  appear.
- **Subsequent connections**: If you spawn another tab in the same domain, it
  creates a new tab on the remote mux server and reflects it locally.
- **Disconnection**: Closing the local tab does not kill the remote tab (the
  remote mux server persists). Reconnecting shows the remote tabs again.

For tab-oriented use, this means the first time you connect to `lace:22426`, you
may get multiple tabs (one per remote mux tab). Subsequent uses of the picker
should activate the existing tab rather than creating new remote tabs.

## Tradeoffs

| Aspect | Workspace-Oriented | Tab-Oriented |
|--------|-------------------|--------------|
| **Window management** | One window per project (or one window with workspace switching) | Single window, all projects as tabs |
| **Visual separation** | Complete: each project has its own tab bar | Minimal: all tabs share one bar |
| **Keybinding complexity** | Leader+S for workspace switching, Leader+1/2/3 for quick access | Alt+N/P to cycle tabs, CTRL+number for direct tab access |
| **Multiplexer behavior** | Remote tabs contained in a workspace namespace | Remote tabs appear in the shared tab bar |
| **Workflow disruption** | Switching workspaces replaces entire context | Clicking/cycling tabs shifts one context at a time |
| **Discoverability** | Hidden workspaces require active recall | All tabs visible in tab bar (but can get crowded) |
| **CLI connection** | `wezterm connect` (new window, simple) | `wezterm cli spawn` (requires running mux, more complex) |
| **Duplicate prevention** | `SwitchToWorkspace` is idempotent (switches to existing) | `SpawnCommandInNewTab` creates duplicates (needs guard logic) |
| **Tab bar overflow** | Each workspace has a clean tab bar | Many tabs may crowd the bar |
| **Status bar** | Left status shows workspace name (project context) | Left status shows workspace name (less meaningful if single workspace) |
| **Session persistence** | Workspaces are saved/restored by resurrect.wezterm | Tabs are saved/restored by resurrect.wezterm (works either way) |
| **`wez-into --start`** | Creates window, obvious feedback | Creates tab in existing window, subtler feedback |

## Migration Path

### Phase 1: Plugin Change (Minimal, Reversible)

**Change the picker action in lace.wezterm from `SwitchToWorkspace` to
`SpawnCommandInNewTab`.**

In `lace.wezterm/plugin/init.lua`, modify the `setup_project_picker` function.
Add duplicate-tab detection before spawning:

```lua
-- In the picker callback:
local domain_name = "lace:" .. project.port

-- Check for existing tab connected to this domain
local existing_tab = nil
for _, tab in ipairs(win:mux_window():tabs()) do
  for _, tp in ipairs(tab:panes()) do
    if tp:get_domain_name() == domain_name then
      existing_tab = tab
      break
    end
  end
  if existing_tab then break end
end

if existing_tab then
  -- Activate the existing tab
  existing_tab:activate()
else
  -- Spawn a new tab in the project's domain
  win:perform_action(
    act.SpawnCommandInNewTab({
      domain = { DomainName = domain_name },
      cwd = opts.workspace_path,
    }),
    pane
  )
end
```

Add an option to `apply_to_config` to control the behavior:

```lua
-- New option: "workspace" (default, current behavior) or "tab"
M.defaults.connection_mode = "workspace"
```

This lets the user opt into tab mode without breaking existing behavior.

**Files modified:**
- `lace.wezterm/plugin/init.lua`

### Phase 2: Tab Title Enhancement

Add a `format-tab-title` event handler that shows the project name (derived from
the domain name) for tabs connected to lace domains:

```lua
wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
  local active_pane = tab.active_pane
  local domain = active_pane.domain_name or ""
  if domain:match("^lace:") then
    local port = domain:match("^lace:(%d+)$")
    -- Look up project name from discovered projects cache
    -- Or derive from pane title / user vars
    local title = "lace:" .. (port or "?")
    return { { Text = " " .. title .. " " } }
  end
  -- Fall through to default title for non-lace tabs
end)
```

To show the project name instead of the port, the plugin could cache the
discovery results (project name -> port mapping) and use that in the tab title
handler.

**Files modified:**
- `lace.wezterm/plugin/init.lua`

### Phase 3: `wez-into` CLI Update

Modify `wez-into`'s `do_connect()` function to use `wezterm cli spawn` instead
of `wezterm connect`:

```bash
do_connect() {
  local project="$1"
  local port="$2"

  refresh_host_key "$port"
  info "connecting to $project on port $port..."
  export XKB_LOG_LEVEL=10

  # Try to spawn a tab in the existing mux (tab-oriented mode)
  if wezterm cli spawn --domain-name "lace:$port" &>/dev/null; then
    info "tab created for $project"
  else
    # Fallback: no running mux server, start a new window
    info "no running mux; starting new window..."
    wezterm connect "lace:$port" --workspace "$project" &>/dev/null &
    disown
  fi
}
```

This preserves the `wezterm connect` fallback for when WezTerm is not running.

**Files modified:**
- `lace/bin/wez-into`

### Phase 4: Status Bar Update (Optional)

If the user operates entirely in a single workspace, the left status bar
(currently showing workspace name) could be repurposed to show the active tab's
project name:

```lua
wezterm.on("update-status", function(window, pane)
  local domain = pane:get_domain_name() or ""
  local display = window:active_workspace()
  if domain:match("^lace:") then
    -- Show project name instead of workspace
    display = display .. " | " .. (domain:match("^lace:(%d+)$") or "?")
  end
  window:set_left_status(...)
end)
```

This is optional and depends on the user's preference for status bar content.

### Phase 5: Remove Workspace Infrastructure (If Committing Fully)

If the tab-oriented model proves satisfactory:

- Remove Leader+1/2/3 quick workspace bindings (or repurpose for tab indices)
- Remove Leader+S workspace launcher (or repurpose for tab switching)
- Simplify mux-startup to not create named workspaces
- Update resurrect.wezterm config if workspace saving is no longer relevant

This phase should only be undertaken after sustained use of the tab-oriented
model confirms it meets the user's workflow needs.

## Recommendations

1. **Start with the plugin's `connection_mode` option (Phase 1).** This is the
   lowest-risk change. Add a `connection_mode = "tab"` option to the
   lace.wezterm plugin that switches the picker from `SwitchToWorkspace` to
   `SpawnCommandInNewTab`. The default remains `"workspace"` for backward
   compatibility. The user opts in via their wezterm.lua config.

2. **Implement duplicate-tab detection immediately.** Unlike `SwitchToWorkspace`
   (which is inherently idempotent), `SpawnCommandInNewTab` will create duplicate
   tabs on repeated invocations. The picker must check for existing tabs
   connected to the target domain before spawning. This is a correctness
   requirement, not an enhancement.

3. **Defer `wez-into` changes.** The CLI script is the secondary connection path
   (the primary path for regular use is the plugin picker). Changing `wez-into`
   to use `wezterm cli spawn` introduces the "no running mux" edge case and
   changes the user-visible behavior (tab appears silently vs. new window
   appears prominently). This is worth doing eventually but is not blocking.

4. **Invest in tab title quality.** The tab bar becomes the primary navigation
   surface in tab-oriented mode. Tabs connected to lace domains should show the
   project name prominently, not just "node@localhost" or the default title. The
   `format-tab-title` handler should cache discovery results to avoid Docker
   queries on every title render.

5. **Keep workspaces for non-lace use.** Even in tab-oriented lace mode, the
   user may still want workspaces for grouping local tabs (e.g., "main" for
   primary work, "scratch" for experiments). The migration should not eliminate
   workspaces entirely -- it should move lace connections from workspaces to
   tabs while preserving the workspace infrastructure for other uses.

6. **Consider the remote tab fan-out problem.** When connecting to a mux domain
   with `SpawnCommandInNewTab`, all remote mux tabs appear in the local tab bar.
   If the remote mux server has accumulated many tabs from previous sessions,
   this can flood the local tab bar. The workspace model contained this flood
   within a namespace; the tab model does not. The user may need to periodically
   clean up remote mux tabs, or the plugin could limit which remote tabs are
   presented locally (though WezTerm's API for this is limited).

7. **Test with the existing unix domain mux.** The user's config uses
   `default_gui_startup_args = { "connect", "unix" }`, which means the GUI
   already connects to a local mux server. `wezterm cli spawn` communicates
   with this mux server. Verify that spawning an SSH domain tab from within a
   unix domain connection works correctly -- the domain nesting (unix mux
   locally, SSH mux remotely) should work but warrants explicit testing.
