---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:30:00-08:00
type: proposal
state: live
status: review_ready
tags: [wezterm, plugin, multi-project, port-allocation, devcontainer, lua]
related_to:
  - cdocs/proposals/2026-02-04-wezterm-project-picker.md
  - cdocs/proposals/2026-02-04-lace-plugins-system.md
  - cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md
revisions:
  - at: 2026-02-04T23:50:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Changed port allocation from hash-based to sequential starting at 11024"
      - "Changed registry path from settings.projects to settings.projects (top-level)"
      - "Specified port configuration via .lace/devcontainer.json extended config"
      - "Consolidated plugin to single init.lua file"
      - "Added wezterm server detection for picker filtering"
      - "Added API transition section"
      - "Specified io.open() for Lua file I/O"
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-05T00:05:00-08:00
  round: 2
---

# Multi-Project WezTerm Plugin Support

> BLUF: Refactor the lace WezTerm plugin to support near-arbitrary numbers of parallel projects by: (1) implementing sequential port allocation starting at port 11024 via the project registry, (2) adopting `lace:<project>` domain naming convention, (3) creating a project registry in `~/.config/lace/settings.json` under a top-level `projects` key, (4) replacing per-project keybindings with a unified project picker that shows all projects but only enables wezterm-capable ones, and (5) ensuring event handlers are properly namespaced. This enables users to run multiple lace-managed devcontainers simultaneously without port conflicts or domain collisions.

## Objective

Enable the lace WezTerm plugin to support multiple parallel projects by:

1. **Eliminating port conflicts**: Sequential port allocation from a known starting point prevents multiple containers from trying to bind the same host port
2. **Preventing domain name collisions**: Each project gets a unique SSH domain name
3. **Providing unified navigation**: A single keybinding opens a project picker instead of requiring per-project bindings
4. **Maintaining backward compatibility**: Existing single-project configurations continue to work

## Background

### Current Architecture

The lace WezTerm plugin at `config/wezterm/lace-plugin/plugin/init.lua` provides SSH domain configuration for connecting to lace devcontainers. The current design assumes a single project:

```lua
M.defaults = {
  domain_name = "lace",           -- Fixed domain name
  ssh_port = "localhost:2222",    -- Fixed port
  username = "node",
  workspace_path = "/workspace",
}
```

**Limitations for multi-project use:**

1. **Port 2222 is hardcoded** in both `devcontainer.json` and the plugin defaults
2. **Domain name "lace"** overwrites when multiple projects load the plugin
3. **Keybindings (Leader+D, Leader+W)** can only target one project
4. **Events** use per-domain naming but lack project-level coordination

### The Problem in Practice

When a user has two lace-enabled projects (e.g., `lace` and `myapp`):

```
# Project A starts first
docker: binding 0.0.0.0:2222 -> container:2222 (success)

# Project B tries to start
docker: binding 0.0.0.0:2222 -> container:2222 (FAIL: port in use)
```

Even if the second project used a different port, the WezTerm plugin currently registers the same domain name "lace", overwriting the first project's configuration.

### Related Proposals

- **[WezTerm Project Picker](2026-02-04-wezterm-project-picker.md)**: RFP for a UI to select which project to connect to
- **[Lace Plugins System](2026-02-04-lace-plugins-system.md)**: How plugins are declared and mounted
- **[Plugin Host Setup RFP](2026-02-04-rfp-plugin-host-setup.md)**: Host-side requirements for plugins

This proposal implements the infrastructure needed for the project picker to work across multiple projects.

## Proposed Solution

### Layer 1: Sequential Port Allocation

#### Port Allocation Algorithm

Each project receives a unique port through sequential allocation starting at port 11024:

```lua
-- Port allocation: sequential from 11024 (0 indexed "lace".map(char => alphabet.indexof(char)).join())
local BASE_PORT = 11024

local function allocate_next_port(existing_projects)
  if not existing_projects or next(existing_projects) == nil then
    return BASE_PORT
  end

  local max_port = BASE_PORT - 1
  for _, config in pairs(existing_projects) do
    if config.sshPort and config.sshPort >= BASE_PORT then
      max_port = math.max(max_port, config.sshPort)
    end
  end

  return max_port + 1
end

-- Examples (sequential assignment):
-- First project  -> 11024
-- Second project -> 11025
-- Third project  -> 11026
```

**Why sequential allocation?**
- **Zero collision probability**: Each project gets a guaranteed unique port
- **Deterministic**: Once assigned, a project keeps its port forever
- **Simple**: No complex hashing or birthday problem calculations

#### DevContainer Port Configuration

Projects use `.lace/devcontainer.json` (the extended config pattern already used by lace) to store computed ports:

```jsonc
// .lace/devcontainer.json (auto-generated by lace up)
{
  "appPort": ["11024:2222"]
}
```

The `lace up` command:
1. Reads `customizations.lace.project` from devcontainer.json (or derives from workspace folder name)
2. Checks the registry for an existing port assignment
3. If no port exists, allocates the next sequential port
4. Writes the port to `.lace/devcontainer.json` as `appPort`
5. Updates the registry with the project entry
6. Docker Compose merges the extended config, using the computed port

This extends the existing pattern where `.lace/devcontainer.json` provides project-specific overrides.

### Layer 2: Project Registry

#### Registry Location and Format

The project registry is part of `~/.config/lace/settings.json` under a top-level `projects` key:

```jsonc
{
  // Existing plugins configuration
  "plugins": { ... },

  // Project registry for multi-project support (top-level)
  "projects": {
    "lace": {
      "workspacePath": "/home/user/code/weft/lace",
      "sshPort": 11024,
      "sshKey": "~/.ssh/lace_devcontainer",
      "username": "node",
      "containerWorkspace": "/workspace",
      "lastStarted": "2026-02-04T23:00:00Z",
      "status": "running",
      "weztermEnabled": true
    },
    "myapp": {
      "workspacePath": "/home/user/code/myapp",
      "sshPort": 11025,
      "sshKey": "~/.ssh/lace_devcontainer",
      "username": "node",
      "containerWorkspace": "/workspace",
      "lastStarted": "2026-02-03T10:00:00Z",
      "status": "stopped",
      "weztermEnabled": false
    }
  }
}
```

**Note**: The `projects` key is at the top level of `settings.json`, not nested under `wezterm`. This aligns with the project picker proposal's schema after consolidation.

#### Registry Updates

The `lace` CLI updates the registry at key lifecycle points:

| Command | Registry Action |
|---------|-----------------|
| `lace up` | Add/update project entry, allocate port if new, set status = "running", detect wezterm capability |
| `lace down` | Set status = "stopped" |
| `lace rebuild` | Update timestamps, maintain status |
| First run | Auto-generate project entry with next sequential port |

#### Wezterm Capability Detection

The `lace up` command detects whether a project supports wezterm integration by checking:

1. **Feature detection**: Does `devcontainer.json` include the `ghcr.io/mjrusso/devcontainer-features/wezterm-server` feature?
2. **Port exposure**: Is the SSH port (2222) exposed in the devcontainer config?

```typescript
function detectWeztermCapability(devcontainerConfig: DevcontainerConfig): boolean {
  const features = devcontainerConfig.features || {};
  const hasWeztermFeature = Object.keys(features).some(
    key => key.includes('wezterm-server')
  );
  return hasWeztermFeature;
}
```

The result is stored as `weztermEnabled` in the registry entry.

#### Registry Schema

```typescript
interface ProjectConfig {
  /** Absolute path to project workspace on host */
  workspacePath: string;

  /** SSH port on host (sequentially allocated) */
  sshPort: number;

  /** Path to SSH private key */
  sshKey: string;

  /** Container username */
  username: string;

  /** Workspace path inside container */
  containerWorkspace: string;

  /** ISO timestamp of last container start */
  lastStarted?: string;

  /** Container status (updated by lace CLI) */
  status?: "running" | "stopped" | "unknown";

  /** Whether project has wezterm-server feature enabled */
  weztermEnabled?: boolean;

  /** Optional display name for project picker */
  displayName?: string;
}

interface LaceSettings {
  plugins?: { ... };
  projects?: Record<string, ProjectConfig>;
}
```

### Layer 3: Domain Naming Convention

#### Format: `lace:<project-name>`

Each project's SSH domain uses the format `lace:<project-name>`:

```lua
-- Examples:
-- Project "lace"   -> domain "lace:lace"
-- Project "myapp"  -> domain "lace:myapp"
-- Project "foo"    -> domain "lace:foo"
```

**Why this format?**
- Clear namespace: `lace:` prefix identifies lace-managed domains
- Human-readable: project name is visible
- Sortable: all lace domains group together in listings
- Consistent: predictable pattern for automation

#### WezTerm Domain Registration

The plugin registers domains for each known project:

```lua
local function setup_ssh_domains(config, projects)
  config.ssh_domains = config.ssh_domains or {}

  for project_name, project_config in pairs(projects) do
    local domain_name = "lace:" .. project_name

    table.insert(config.ssh_domains, {
      name = domain_name,
      remote_address = "localhost:" .. project_config.sshPort,
      username = project_config.username,
      remote_wezterm_path = "/usr/local/bin/wezterm",
      multiplexing = "WezTerm",
      ssh_option = {
        identityfile = project_config.sshKey,
      },
    })
  end
end
```

### Layer 4: Unified Project Picker

#### Single Keybinding, Project Selection

Instead of per-project keybindings, a single `Leader+D` opens a project picker:

```lua
wezterm.on("lace.project-picker", function(window, pane)
  local projects = M.load_projects_from_registry()
  local choices = {}

  for name, config in pairs(projects) do
    local status_icon = config.status == "running" and "[*]" or "[-]"
    local wezterm_icon = config.weztermEnabled and "" or " (no wezterm)"
    local enabled = config.weztermEnabled ~= false

    table.insert(choices, {
      id = name,
      label = status_icon .. " " .. (config.displayName or name) .. wezterm_icon,
    })
  end

  if #choices == 0 then
    window:toast_notification("lace", "No projects configured", nil, 3000)
    return
  end

  -- Sort: wezterm-enabled first, then alphabetically
  table.sort(choices, function(a, b)
    local a_enabled = projects[a.id].weztermEnabled ~= false
    local b_enabled = projects[b.id].weztermEnabled ~= false
    if a_enabled ~= b_enabled then
      return a_enabled
    end
    return a.label < b.label
  end)

  window:perform_action(
    act.InputSelector({
      title = "Select Project",
      choices = choices,
      action = wezterm.action_callback(function(win, _, id)
        if id then
          local project = projects[id]

          -- Check if wezterm is enabled for this project
          if project.weztermEnabled == false then
            win:toast_notification("lace",
              "Project '" .. id .. "' does not have wezterm-server enabled",
              nil, 5000)
            return
          end

          win:perform_action(
            act.SwitchToWorkspace({
              name = id,
              spawn = {
                domain = { DomainName = "lace:" .. id },
                cwd = project.containerWorkspace,
              },
            }),
            pane
          )
        end
      end),
    }),
    pane
  )
end)
```

#### Picker Filtering Behavior

The picker shows ALL registered projects but:
- **Wezterm-enabled projects**: Full interaction, can be selected
- **Non-wezterm projects**: Shown with "(no wezterm)" suffix, selection shows toast notification explaining they can't be connected via wezterm

This ensures users see all their projects and understand why some aren't connectable.

#### Keybinding Configuration

```lua
-- In wezterm.lua after loading the plugin:
table.insert(config.keys, {
  key = "d",
  mods = "LEADER",
  action = act.EmitEvent("lace.project-picker"),
})
```

**Workflow:**
1. User presses `Leader+D`
2. Project picker shows all registered projects with status indicators
3. Wezterm-enabled projects can be selected; others show explanation
4. User selects a project
5. WezTerm switches to a workspace named after the project, connected to the project's SSH domain

### Layer 5: Per-Project Worktree Picker

#### Event Naming

Each project gets its own worktree picker event:

```lua
-- Event pattern: lace.worktree-picker.<project-name>
-- Examples:
-- "lace.worktree-picker.lace"
-- "lace.worktree-picker.myapp"
```

#### Access from Project Picker

After selecting a project, users can access the worktree picker:

```lua
-- Leader+W while in a project workspace triggers that project's worktree picker
table.insert(config.keys, {
  key = "w",
  mods = "LEADER",
  action = wezterm.action_callback(function(window, pane)
    -- Get current workspace name (which is the project name)
    local workspace = window:active_workspace()

    -- Check if this is a lace project workspace
    if M._projects[workspace] then
      window:perform_action(
        act.EmitEvent("lace.worktree-picker." .. workspace),
        pane
      )
    else
      -- Not in a lace project, show project picker instead
      window:perform_action(act.EmitEvent("lace.project-picker"), pane)
    end
  end),
})
```

### Layer 6: Lua File I/O for Registry Access

#### Reading settings.json from WezTerm

The WezTerm plugin uses `io.open()` to read the settings.json file:

```lua
local function load_projects_from_registry()
  local config_home = os.getenv("XDG_CONFIG_HOME") or (wezterm.home_dir .. "/.config")
  local settings_file = config_home .. "/lace/settings.json"

  local f = io.open(settings_file, "r")
  if not f then
    wezterm.log_warn("lace: Could not open " .. settings_file)
    return {}
  end

  local content = f:read("*a")
  f:close()

  local ok, settings = pcall(wezterm.json_parse, content)
  if not ok then
    wezterm.log_error("lace: Failed to parse settings.json: " .. tostring(settings))
    return {}
  end

  return settings.projects or {}
end
```

**Note**: `io.open()` is available in WezTerm's Lua environment. This was validated in the WezTerm Sidecar proposal's research. If a specific environment doesn't support it, the fallback would be `wezterm.run_child_process({"cat", settings_file})`.

## API Transition

### Current Single-Project API

The existing plugin API configures a single project:

```lua
-- Current usage in wezterm.lua
local lace = wezterm.plugin.require("https://github.com/mjrusso/lace")
lace.apply_to_config(config, {
  domain_name = "lace",
  ssh_port = "localhost:2222",
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  username = "node",
  workspace_path = "/workspace",
  main_worktree = "lace",
})
```

### New Multi-Project API

The new API reads from the registry and configures all projects:

```lua
-- New usage in wezterm.lua
local lace = wezterm.plugin.require("https://github.com/mjrusso/lace")
lace.apply_to_config(config, {
  -- Optional: override registry path (defaults to ~/.config/lace/settings.json)
  registry_path = wezterm.home_dir .. "/.config/lace/settings.json",

  -- Optional: default SSH key for projects that don't specify one
  default_ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",

  -- Optional: enable project picker keybinding (default: true)
  enable_picker = true,
})
```

### Backward Compatibility

The plugin maintains backward compatibility:

```lua
function M.apply_to_config(config, opts)
  opts = opts or {}

  -- Detect old-style single-project config
  if opts.domain_name and opts.ssh_port then
    -- Legacy mode: treat as single project
    wezterm.log_info("lace: Using legacy single-project configuration")
    setup_single_project(config, opts)
    return
  end

  -- New mode: read from registry
  local registry_path = opts.registry_path or
    (os.getenv("XDG_CONFIG_HOME") or (wezterm.home_dir .. "/.config")) .. "/lace/settings.json"

  local projects = load_projects_from_registry(registry_path)

  if next(projects) == nil then
    wezterm.log_warn("lace: No projects found in registry, falling back to defaults")
    -- Could fall back to legacy behavior or just skip
    return
  end

  setup_multi_project(config, projects, opts)
end
```

### Migration Steps

For users upgrading from single-project to multi-project:

1. **Update lace CLI**: `npm install -g @mjrusso/lace` (or update in devcontainer)
2. **Run `lace up`**: This creates/updates the registry entry for the current project
3. **Update wezterm.lua** (optional): Change to new API style, or keep old style for single-project use
4. **Repeat for additional projects**: `lace up` in each project directory

The plugin will:
- Detect the configuration style and behave appropriately
- Log which mode it's operating in for debugging
- Maintain full backward compatibility with explicit single-project configs

## Design Decisions

### D1: Sequential Port Allocation Over Hash-Based

**Decision**: Use sequential allocation starting at port 11024.

**Alternatives considered:**
1. **Hash-based allocation (CRC32)**: Deterministic but has collision probability
2. **Ephemeral ports**: Never conflicts but changes on every restart, breaking reconnection
3. **Pure registry-based**: Requires manual coordination for each new project

**Rationale**: Sequential allocation is simpler, has zero collision probability, and the port assignments are stable once assigned. The 11024 base is memorable (l-a-c-e alphabet positions).

### D2: Shared SSH Key Across Projects

**Decision**: Default to a shared `~/.ssh/lace_devcontainer` key for all projects.

**Alternatives considered:**
1. **Per-project keys**: Maximum isolation but complex key management
2. **Project-derived key names**: `~/.ssh/lace_<project>` -- adds setup friction

**Rationale**: The shared key simplifies setup while maintaining security (the key only provides access to containers, not to any external systems). Projects can override to use different keys if needed.

### D3: Domain Naming with `lace:` Prefix

**Decision**: Use `lace:<project-name>` format for SSH domains.

**Alternatives considered:**
1. **Just project name**: Could conflict with user's other SSH domains
2. **Hash suffix**: `lace-a7b3c` -- not human-readable

**Rationale**: The prefix provides a clear namespace while keeping the domain human-readable for debugging and manual access.

### D4: Project Picker Over Per-Project Keybindings

**Decision**: Single `Leader+D` opens project picker instead of per-project bindings.

**Alternatives considered:**
1. **Numbered bindings**: `Leader+1` = project1, `Leader+2` = project2 -- doesn't scale
2. **Auto-generated bindings**: Complex, potential conflicts
3. **No default bindings**: User configures everything manually

**Rationale**: A picker scales to arbitrary project counts and provides visual feedback about project status. The slight additional interaction (select from list) is worthwhile for the flexibility gained.

### D5: Registry Updates by lace CLI Only

**Decision**: Only the lace CLI writes to the project registry; WezTerm reads it.

**Alternatives considered:**
1. **WezTerm writes on connect**: Would require Lua file writing, adds complexity
2. **Shared writes**: Race condition risks between CLI and plugin

**Rationale**: The lace CLI has the authoritative knowledge about container state. WezTerm reads the registry for configuration but doesn't modify it, keeping the data flow unidirectional.

### D6: Single init.lua Plugin File

**Decision**: Keep all plugin code in a single `init.lua` file.

**Alternatives considered:**
1. **Multi-file plugin**: `registry.lua`, `picker.lua`, `worktree.lua` as separate modules
2. **Lazy loading modules**: Load modules on demand

**Rationale**: WezTerm plugins have a specific structure requirement where `plugin/init.lua` is the entry point. Multi-file plugins require `package.path` manipulation which adds complexity. For a plugin of this size, a single file is maintainable and avoids module loading issues.

### D7: Top-Level `projects` Key in settings.json

**Decision**: Place project registry at `settings.projects` (top-level), not `settings.wezterm.projects`.

**Alternatives considered:**
1. **`wezterm.projects`**: Groups with other wezterm config
2. **Separate `projects.json` file**: Isolation but config sprawl

**Rationale**: Projects are not exclusively a wezterm concern. The registry is used by the lace CLI for port allocation, status tracking, and potentially other features. A top-level key makes this clear and aligns with the flat structure preference for settings.json.

## Edge Cases / Challenging Scenarios

### E1: Project Name Contains Special Characters

**Trigger**: Project name like "my-app/v2" or "foo:bar"

**Behavior**: The domain name sanitizes special characters:
- Replace `/` with `-`
- Replace `:` with `-`
- Lowercase everything
- Result: `lace:my-app-v2`, `lace:foo-bar`

**Implementation**:
```lua
local function sanitize_project_name(name)
  return name:lower():gsub("[/:]", "-"):gsub("[^a-z0-9-]", "")
end
```

### E2: Duplicate Sanitized Names

**Trigger**: Two projects like `My-App` and `my_app` both sanitize to `my-app`

**Behavior**: The second project to register gets a numeric suffix: `my-app-2`

**Implementation**: The lace CLI checks for existing sanitized names and appends a suffix if needed.

### E3: Registry Out of Sync with Running Containers

**Trigger**: Container started outside of `lace up`, or registry file deleted

**Behavior**: The WezTerm plugin operates on registry state. If a container is running but not in the registry:
- It won't appear in the project picker
- Manual domain configuration still works
- Running `lace up` in the project directory updates the registry

**Mitigation**: `lace status` command could scan Docker for lace containers and reconcile with registry.

### E4: Multiple Users on Shared Machine

**Trigger**: Users share a machine with different lace projects

**Behavior**: Each user has their own `~/.config/lace/settings.json`. Port ranges are per-user (sequentially allocated). If two users have projects with overlapping ports, they'll conflict when both are running.

**Resolution**: Each user's first project starts at 11024. If port conflicts occur, one user can manually override their project's port in the registry.

### E5: Migration from Existing Single-Project Setup

**Trigger**: User upgrades from current single-project plugin to multi-project version

**Behavior**: The plugin maintains backward compatibility:
- If `apply_to_config` receives old-style options (domain_name, ssh_port), use legacy mode
- If no registry exists but user runs `lace up`, create registry with the single project
- Existing hardcoded ports in devcontainer.json continue to work

**Migration steps**:
1. Update lace CLI
2. Run `lace up` (creates registry entry automatically)
3. Plugin detects and uses registry configuration

### E6: WezTerm Restart While Container Running

**Trigger**: WezTerm closes and reopens while containers are running

**Behavior**: On startup, the plugin reads the registry and configures all domains. Even if status shows "stopped" (stale), the SSH domain is configured. Connection will succeed if the container is actually running.

### E7: Project Without Wezterm Server

**Trigger**: User has a lace project that doesn't use the wezterm-server feature

**Behavior**:
- `lace up` detects the missing feature and sets `weztermEnabled: false`
- Project appears in picker with "(no wezterm)" suffix
- Selecting it shows a toast notification explaining why it can't connect
- User can still see the project exists and its status

### E8: Workspace Name Conflicts

**Trigger**: User manually creates a workspace with the same name as a project

**Behavior**: The `SwitchToWorkspace` action will switch to the existing workspace. If it's not connected to the correct domain, the user may see unexpected content.

**Mitigation**: Document that workspace names match project names. Users should avoid manually creating workspaces with lace project names.

## Test Plan

### Unit Tests: Port Allocation

| Scenario | Expected |
|----------|----------|
| First project | Port 11024 |
| Second project | Port 11025 |
| Project with existing port | Keep existing port |
| Empty registry | Start at 11024 |
| Gap in port sequence | Use next after max (don't fill gaps) |

### Unit Tests: Registry Parsing

| Scenario | Expected |
|----------|----------|
| Valid registry JSON | Projects parsed correctly |
| Missing file | Empty projects map |
| Invalid JSON | Error with guidance |
| Missing optional fields | Defaults applied |
| Tilde expansion in paths | Expanded correctly |

### Unit Tests: Domain Name Generation

| Scenario | Expected |
|----------|----------|
| Simple name | `lace:name` |
| Name with special chars | Sanitized, `lace:sanitized-name` |
| Empty name | Error |
| Duplicate after sanitization | Suffix added |

### Unit Tests: Wezterm Detection

| Scenario | Expected |
|----------|----------|
| Has wezterm-server feature | `weztermEnabled: true` |
| No wezterm-server feature | `weztermEnabled: false` |
| Feature detection error | Default to `true` (permissive) |

### Integration Tests: Multi-Project Workflow

| Scenario | Expected |
|----------|----------|
| Start project A | Port 11024 assigned, registry updated, domain registered |
| Start project B | Port 11025 assigned, both domains accessible |
| Project picker shows both | Both projects listed with correct status |
| Select project A | Switches to workspace, connects to correct domain |
| Worktree picker in project A | Shows project A's worktrees |
| Select non-wezterm project | Toast notification, no connection |

### Integration Tests: API Transition

| Scenario | Expected |
|----------|----------|
| Old-style apply_to_config | Legacy single-project mode |
| New-style apply_to_config | Multi-project registry mode |
| Mixed: old config + registry | Old config takes precedence for that project |

### Manual Verification

1. Configure two projects with `customizations.lace.project` set
2. Run `lace up` on both projects
3. Verify both containers running on different ports (11024, 11025)
4. In WezTerm, `Leader+D` shows both projects
5. Select each project, verify connection
6. `Leader+W` shows correct worktrees for each project

## Implementation Phases

### Phase 1: Port Allocation Infrastructure

**Scope:**
- Implement sequential port allocation in lace CLI
- Update `lace up` to calculate and use allocated ports
- Update `lace up` to write computed port to `.lace/devcontainer.json`
- Update `lace up` to create/update project registry entries
- Implement wezterm capability detection

**Files:**
- `packages/lace/src/lib/port-allocation.ts` (new)
- `packages/lace/src/lib/project-registry.ts` (new)
- `packages/lace/src/commands/up.ts` (modify)

**Verification**: `lace up` allocates sequential ports and updates registry.

### Phase 2: Registry Integration

**Scope:**
- Extend settings.json schema with top-level `projects` field
- Update lace CLI to read/write project registry
- Add `lace status` command showing registered projects and their status
- Add `lace down` registry updates

**Files:**
- `packages/lace/src/lib/settings.ts` (extend)
- `packages/lace/src/commands/down.ts` (modify)
- `packages/lace/src/commands/status.ts` (new)

**Verification**: Registry accurately reflects container state across lifecycle.

### Phase 3: WezTerm Plugin Multi-Domain Support

**Scope:**
- Update plugin to read project registry using `io.open()`
- Register SSH domains for all projects
- Implement project picker event with wezterm filtering
- Update event naming to include project identifier
- Maintain backward compatibility with old API

**Files:**
- `config/wezterm/lace-plugin/plugin/init.lua` (major refactor)

**Verification**: Multiple projects accessible via unified picker.

### Phase 4: Per-Project Worktree Picker

**Scope:**
- Context-aware worktree picker (knows which project is active)
- Event namespacing per project
- Keybinding integration with workspace detection

**Files:**
- `config/wezterm/lace-plugin/plugin/init.lua` (modify)

**Verification**: `Leader+W` shows correct worktrees based on current workspace.

### Phase 5: Documentation and Migration

**Scope:**
- Update README with multi-project usage
- Document migration from single-project setup
- Add troubleshooting guide for common issues
- Update devcontainer.json template with `customizations.lace.project`

**Files:**
- `config/wezterm/lace-plugin/README.md` (update)
- `docs/multi-project.md` (new)
- `.devcontainer/devcontainer.json` (update template)

**Verification**: New users can set up multi-project environment following docs.

## Open Questions

1. **Automatic status refresh**: Should the plugin periodically check container status (via SSH or Docker), or rely solely on CLI-updated registry? Periodic checks add accuracy but also latency and complexity.

2. **Project discovery vs. explicit registration**: Should `lace up` automatically register any project it starts, or require explicit opt-in via `customizations.lace.project`? Auto-registration is more magical but might register unintended projects.

3. **Container cleanup**: Should `lace down` remove the project from the registry entirely, or just mark as stopped? Keeping stopped projects enables quick reconnection; removing them keeps the registry clean.

4. **Shared vs. per-project SSH keys**: The proposal defaults to shared keys. Should we provide a `lace init-keys --project <name>` command for users who want per-project isolation?

## Tradeoffs Summary

| Aspect | This Proposal | Alternative | Tradeoff |
|--------|---------------|-------------|----------|
| Port allocation | Sequential from 11024 | Hash-based | Simplicity vs. determinism without registry |
| Domain naming | `lace:<project>` | Just project name | Namespace safety vs. brevity |
| Project selection | Picker UI | Per-project keybindings | Scalability vs. speed |
| Registry updates | CLI only | CLI + plugin | Consistency vs. freshness |
| SSH keys | Shared default | Per-project | Simplicity vs. isolation |
| Plugin structure | Single init.lua | Multi-file | Simplicity vs. modularity |
| Registry location | Top-level `projects` | `wezterm.projects` | General utility vs. wezterm grouping |

## Related Documents

- [WezTerm Plugin Research](../reports/2026-02-04-wezterm-plugin-research.md)
- [WezTerm Project Picker RFP](2026-02-04-wezterm-project-picker.md)
- [Lace Plugins System](2026-02-04-lace-plugins-system.md)
- [Plugin Host Setup RFP](2026-02-04-rfp-plugin-host-setup.md)
