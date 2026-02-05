---
first_authored:
  by: "@claude-haiku-4-5-20251001"
  at: 2026-02-04T00:00:00-08:00
type: proposal
state: evolved
status: accepted
evolved_into: cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
tags: [wezterm, plugin, keybinding, project-picker, ui, cli]
revisions:
  - at: 2026-02-04T20:30:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Completed RFP with full specification"
      - "Added CLI command (wez-lace-into) design"
      - "Resolved all open questions"
      - "Added implementation phases and test plan"
  - at: 2026-02-04T21:15:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Consolidated config: Replaced projects.json with settings.json wezterm.projects section"
      - "Added SSH Domain Registration section explaining dynamic domain setup"
      - "Updated CLI to read from settings.json instead of projects.json"
      - "Clarified that project key = SSH domain name (removed sshDomain field)"
      - "Added Q9 resolving relationship to Lace Plugins System"
      - "Specified wezterm picker behavior for stopped containers (attempt anyway, let SSH fail)"
  - at: 2026-02-04T23:55:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Aligned registry path with multi-project proposal: settings.projects (top-level) instead of settings.wezterm.projects"
      - "Projects are not wezterm-specific; they're used by lace CLI for port allocation and status tracking"
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T21:30:00-08:00
  round: 2
---

# WezTerm Project Picker Feature

> BLUF: Implement a unified project picker with two entry points: (1) a wezterm-native `InputSelector` UI triggered by Leader+P keybinding, and (2) a CLI command `wez-lace-into` for users who prefer command-line invocation. Projects are configured in `~/.config/lace/settings.json` under a top-level `projects` key (not nested under `wezterm`), as projects are used by the lace CLI for port allocation and status tracking beyond just wezterm. SSH domains are dynamically registered by iterating over projects in wezterm.lua. The picker shows configured projects with status indicators (running/stopped) and connects to the selected project's SSH domain, creating a new workspace.

## Objective

Enable users to discover and connect to available devcontainers via:
1. An interactive wezterm-native picker UI (Leader+P)
2. A CLI command (`wez-lace-into`) for keyboard-chord-averse users

Eliminate keybinding collisions when multiple projects configure the lace wezterm plugin by using a single unified picker keybinding instead of per-project bindings.

## Scope

- Design and implement a project picker UI using wezterm's `InputSelector`
- Create a `wez-lace-into` CLI command as an alternative entry point
- Extend the Lace Plugins System settings with a `wezterm.projects` section
- Integrate with the existing lace wezterm plugin architecture
- Support both running and configured-but-stopped devcontainers

## Design Decisions

### D1: Project Registry Location

**Decision**: `~/.config/lace/settings.json` under a top-level `projects` key

**Rationale**: Consolidates with the Lace Plugins System which already defines `settings.json` as the user-level configuration file. Avoids configuration sprawl from multiple JSON files. The `projects` key is at the top level (not nested under `wezterm`) because projects are used by the lace CLI for port allocation, status tracking, and wezterm capability detection - they are not exclusively a wezterm concern.

### D2: Project Discovery Mechanism

**Decision**: Explicit registration via `settings.json`, not automatic discovery.

**Rationale**:
- Automatic discovery (scanning filesystem for devcontainer.json files) is slow and unbounded
- Users have explicit control over which projects appear in the picker
- Registration happens once per project, either manually or via `lace register` command
- Running container detection augments but does not replace registration

### D3: Picker Entry Points

**Decision**: Two entry points - wezterm keybinding and CLI command.

**Rationale**: Different users have different preferences. Some prefer modal keyboard navigation (Leader+P); others prefer explicit CLI commands they can alias, script, or invoke from other tools.

### D4: Container Status in Picker

**Decision**: Show status indicators (running/stopped) but include all registered projects.

**Rationale**: Users need to know container state before connecting. Hiding stopped containers would require users to remember which projects exist.

### D5: Connection Flow

**Decision**: Connect to running containers directly; offer to start stopped containers.

**Rationale**: Starting a devcontainer takes 10-60 seconds. Users should confirm before waiting for a start operation. Running containers connect instantly.

### D6: Workspace Naming

**Decision**: Use project name as workspace name.

**Rationale**: Workspaces in wezterm persist across connections. Using the project name provides clear organization and allows quick switching via `ShowLauncherArgs({ flags = "WORKSPACES" })`.

## Specification

### Project Registry Format

Projects are configured in `~/.config/lace/settings.json` under a top-level `projects` key (not nested under `wezterm`):

```jsonc
// ~/.config/lace/settings.json
{
  // Existing plugins configuration (from Lace Plugins System)
  "plugins": {
    "github.com/user/dotfiles": {
      "overrideMount": { "source": "~/code/personal/dotfiles" }
    }
  },

  // Project registry (top-level, used by lace CLI and wezterm plugin)
  "projects": {
    "lace": {
      "displayName": "Lace",
      "sshPort": 11024,
      "sshUser": "node",
      "sshKey": "~/.ssh/lace_devcontainer",
      "workspacePath": "/workspace",
      "mainWorktree": "lace",
      "repoPath": "~/code/weft/lace",
      "weztermEnabled": true
    },
    "dotfiles": {
      "displayName": "Dotfiles",
      "sshPort": 11025,
      "sshUser": "node",
      "sshKey": "~/.ssh/dotfiles_devcontainer",
      "workspacePath": "/workspaces/dotfiles",
      "mainWorktree": "main",
      "repoPath": "~/code/personal/dotfiles",
      "weztermEnabled": true
    }
  }
}
```

**Note**: The project key (e.g., "lace", "dotfiles") is used as the SSH domain name. There is no separate `sshDomain` field; the key serves both as project identifier and domain name.

**Schema:**

```typescript
interface LaceSettings {
  plugins?: Record<string, PluginConfig>;  // From Lace Plugins System
  projects?: Record<string, ProjectConfig>;  // Top-level project registry
}

interface ProjectConfig {
  /** Display name shown in picker */
  displayName: string;

  /** SSH port for container access (sequentially allocated from 11024) */
  sshPort: number;

  /** SSH username */
  sshUser: string;

  /** Path to SSH private key (tilde expansion supported) */
  sshKey: string;

  /** Container workspace mount path */
  workspacePath: string;

  /** Default worktree/subdirectory to connect to */
  mainWorktree: string;

  /** Host path to project repository (for container detection) */
  repoPath: string;

  /** Whether project has wezterm-server feature enabled */
  weztermEnabled?: boolean;
}
```

### SSH Domain Registration

SSH domains must be registered in wezterm.lua before they can be used with `SwitchToWorkspace`. The lace-plugin reads `settings.json` and dynamically registers an SSH domain for each project.

**Implementation in wezterm.lua:**

```lua
-- Load settings.json
local function load_lace_settings()
  local config_home = os.getenv("XDG_CONFIG_HOME") or (wezterm.home_dir .. "/.config")
  local settings_file = config_home .. "/lace/settings.json"

  local f = io.open(settings_file, "r")
  if not f then return nil end

  local content = f:read("*a")
  f:close()

  local ok, settings = pcall(wezterm.json_parse, content)
  if not ok then return nil end

  return settings
end

-- In wezterm.lua, after config_builder()
local settings = load_lace_settings()
if settings and settings.projects then
  for name, project in pairs(settings.projects) do
    -- Skip projects without wezterm support
    if project.weztermEnabled ~= false then
      -- Expand tilde in paths
      local ssh_key = project.sshKey:gsub("^~", wezterm.home_dir)

      -- Register SSH domain for this project (domain = "lace:<name>")
      lace_plugin.apply_to_config(config, {
        ssh_key = ssh_key,
        domain_name = "lace:" .. name,
        ssh_port = "localhost:" .. tostring(project.sshPort),
        username = project.sshUser,
        workspace_path = project.workspacePath,
        main_worktree = project.mainWorktree,
      })
    end
  end
end
```

This approach:
1. Reads project configuration from `settings.json` (top-level `projects` key)
2. Calls `apply_to_config` once per wezterm-enabled project, registering each SSH domain
3. Uses the `lace:<name>` format for domain names per the multi-project proposal
4. Keybindings remain disabled (per existing plugin design); users interact via picker or CLI

### Picker UI Specification

The wezterm-native picker uses `InputSelector` with the following design:

**Title**: "Lace Projects"

**Entry Format**:
```
[STATUS] DisplayName (domain)
```

Where STATUS is:
- `[*]` - Container running
- `[-]` - Container stopped
- `[?]` - Unknown (detection failed)

**Example Picker Display**:
```
Select Project:
  [*] Lace (lace)
  [-] Dotfiles (dotfiles)
  [*] My App (myapp)
```

**Behavior on Selection**:
1. If container is running: `SwitchToWorkspace` with domain and cwd
2. If container is stopped: Toast notification offering to start, or direct connect attempt
3. If unknown: Attempt connection (may prompt SSH trust)

### CLI Command: `wez-lace-into`

**Location**: `bin/wez-lace-into` (can be symlinked to PATH)

**Usage**:
```bash
wez-lace-into                  # Show interactive picker
wez-lace-into <project>        # Connect to specific project
wez-lace-into --list           # List available projects
wez-lace-into --status         # Show projects with status
wez-lace-into --help           # Show help
```

**Interactive Picker**: When invoked without arguments, uses `select` (bash builtin) or `fzf` if available for project selection.

**Implementation Sketch**:

```bash
#!/bin/bash
# wez-lace-into - Connect to lace devcontainer projects
#
# Usage:
#   wez-lace-into                # Show project picker
#   wez-lace-into <project>      # Connect to specific project
#   wez-lace-into --list         # List available projects
#
# Prerequisites: wezterm, jq (for JSON parsing)

set -euo pipefail

LACE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/lace"
SETTINGS_FILE="$LACE_CONFIG/settings.json"

err() { echo "wez-lace-into: error: $*" >&2; }
info() { echo "wez-lace-into: $*" >&2; }

# Check prerequisites
if [[ ! -f "$SETTINGS_FILE" ]]; then
  err "settings.json not found at $SETTINGS_FILE"
  err "Create it with a projects section, or run 'lace up' to auto-register"
  exit 1
fi

if ! command -v wezterm &>/dev/null; then
  err "wezterm not found on PATH"
  err "Install from: https://wezfurlong.org/wezterm/installation.html"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  err "jq required for JSON parsing"
  err "Install with: sudo dnf install jq  # or apt, brew, etc."
  exit 1
fi

# Helper to extract from top-level projects key
get_projects() {
  jq -r '.projects // {} | keys[]' "$SETTINGS_FILE"
}

get_project_field() {
  local proj="$1" field="$2"
  jq -r --arg p "$proj" --arg f "$field" '.projects[$p][$f] // empty' "$SETTINGS_FILE"
}

# Parse arguments
case "${1:-}" in
  --list)
    get_projects
    exit 0
    ;;
  --status)
    for proj in $(get_projects); do
      repo_path=$(get_project_field "$proj" "repoPath")
      repo_path="${repo_path/#\~/$HOME}"

      if docker ps -q --filter "label=devcontainer.local_folder=$repo_path" 2>/dev/null | grep -q .; then
        echo "[*] $proj"
      else
        echo "[-] $proj"
      fi
    done
    exit 0
    ;;
  --help|-h)
    cat <<'EOF'
wez-lace-into - Connect to lace devcontainer projects

Usage:
  wez-lace-into                # Show project picker
  wez-lace-into <project>      # Connect to specific project
  wez-lace-into --list         # List available projects
  wez-lace-into --status       # Show projects with running status
  wez-lace-into --help         # Show this help

Projects are configured in ~/.config/lace/settings.json under the projects key
EOF
    exit 0
    ;;
  "")
    # Interactive picker mode
    mapfile -t PROJECTS < <(get_projects)

    if [[ ${#PROJECTS[@]} -eq 0 ]]; then
      err "no projects configured in $SETTINGS_FILE under projects key"
      exit 1
    fi

    # Build picker with status indicators
    declare -a CHOICES
    for proj in "${PROJECTS[@]}"; do
      repo_path=$(get_project_field "$proj" "repoPath")
      repo_path="${repo_path/#\~/$HOME}"
      display_name=$(get_project_field "$proj" "displayName")
      display_name="${display_name:-$proj}"

      if docker ps -q --filter "label=devcontainer.local_folder=$repo_path" 2>/dev/null | grep -q .; then
        CHOICES+=("[*] $display_name ($proj)")
      else
        CHOICES+=("[-] $display_name ($proj)")
      fi
    done

    # Use fzf if available, otherwise use select
    if command -v fzf &>/dev/null; then
      SELECTED=$(printf '%s\n' "${CHOICES[@]}" | fzf --prompt="Select project: " --height=10)
    else
      echo "Select project:" >&2
      select SELECTED in "${CHOICES[@]}"; do
        [[ -n "$SELECTED" ]] && break
      done
    fi

    [[ -z "${SELECTED:-}" ]] && exit 0

    # Extract project name from selection
    PROJECT=$(echo "$SELECTED" | sed 's/.*(\([^)]*\))$/\1/')
    ;;
  *)
    PROJECT="$1"
    ;;
esac

# Validate project exists
if ! jq -e --arg p "$PROJECT" '.projects[$p]' "$SETTINGS_FILE" >/dev/null 2>&1; then
  err "project '$PROJECT' not found in $SETTINGS_FILE"
  err "available projects: $(get_projects | tr '\n' ', ' | sed 's/, $//')"
  exit 1
fi

# Read project config (domain uses lace:<name> format)
SSH_DOMAIN="lace:$PROJECT"
SSH_PORT=$(get_project_field "$PROJECT" "sshPort")
SSH_USER=$(get_project_field "$PROJECT" "sshUser")
SSH_KEY=$(get_project_field "$PROJECT" "sshKey")
SSH_KEY="${SSH_KEY/#\~/$HOME}"
REPO_PATH=$(get_project_field "$PROJECT" "repoPath")
REPO_PATH="${REPO_PATH/#\~/$HOME}"

# Check if container is running
CONTAINER_RUNNING=""
if command -v docker &>/dev/null; then
  CONTAINER_RUNNING=$(docker ps -q --filter "label=devcontainer.local_folder=$REPO_PATH" 2>/dev/null || true)
fi

if [[ -z "$CONTAINER_RUNNING" ]]; then
  info "container for $PROJECT is not running"
  if [ -t 0 ]; then
    read -r -n 1 -p "Start container? [y/N]: " CONFIRM </dev/tty
    echo ""
    if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
      info "starting container with: lace up --workspace-folder $REPO_PATH"
      if ! lace up --workspace-folder "$REPO_PATH"; then
        err "failed to start container"
        exit 1
      fi
    else
      info "not starting container"
      exit 0
    fi
  else
    err "container not running and not in interactive mode"
    exit 1
  fi
fi

# Check for existing WezTerm workspace
EXISTING_WORKSPACE=""
if PANE_LIST=$(wezterm cli list --format json 2>/dev/null); then
  EXISTING_WORKSPACE=$(echo "$PANE_LIST" | jq -r --arg ws "$PROJECT" \
    '[.[] | select(.workspace == $ws)][0] // empty | .workspace // empty')
fi

if [[ -n "$EXISTING_WORKSPACE" ]]; then
  info "workspace '$PROJECT' already exists"
  # Could focus existing workspace here if wezterm had that capability
fi

# Pre-populate known_hosts
if [[ -f "$HOME/.ssh/known_hosts" ]]; then
  ssh-keygen -R "[localhost]:$SSH_PORT" 2>/dev/null || true
fi
ssh-keyscan -p "$SSH_PORT" localhost >> "$HOME/.ssh/known_hosts" 2>/dev/null || true

# Connect to the domain (project key = domain name)
info "connecting to $PROJECT via SSH domain '$SSH_DOMAIN'..."
wezterm connect "$SSH_DOMAIN" --workspace "$PROJECT"
```

### WezTerm Plugin Integration

The lace-plugin gains a new function to render the project picker. It reads from `settings.json` (top-level `projects` key):

```lua
-- In lace-plugin/plugin/init.lua

-- Helper to read settings.json
local function load_settings()
  local config_home = os.getenv("XDG_CONFIG_HOME") or (wezterm.home_dir .. "/.config")
  local settings_file = config_home .. "/lace/settings.json"

  local f = io.open(settings_file, "r")
  if not f then return nil end

  local content = f:read("*a")
  f:close()

  local ok, settings = pcall(wezterm.json_parse, content)
  if not ok then return nil end

  return settings
end

-- Project picker event
local function setup_project_picker()
  wezterm.on("lace.show-project-picker", function(window, pane)
    local settings = load_settings()
    if not settings then
      window:toast_notification("lace", "settings.json not found or invalid", nil, 5000)
      return
    end

    local projects = settings.projects or {}

    -- Build choices with status
    local choices = {}
    for name, project in pairs(projects) do
      local status = "[-]"  -- Default to stopped

      -- Try to detect running container (via SSH probe)
      local ssh_port = tostring(project.sshPort or 2222)
      local probe_ok = wezterm.run_child_process({
        "ssh", "-p", ssh_port,
        "-o", "ConnectTimeout=1",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        "-o", "BatchMode=yes",
        (project.sshUser or "node") .. "@localhost",
        "true"
      })
      if probe_ok then
        status = "[*]"
      end

      table.insert(choices, {
        id = name,
        label = status .. " " .. (project.displayName or name) .. " (" .. name .. ")",
      })
    end

    if #choices == 0 then
      window:toast_notification("lace", "No projects in settings.json", nil, 5000)
      return
    end

    -- Sort by label
    table.sort(choices, function(a, b) return a.label < b.label end)

    window:perform_action(
      act.InputSelector({
        title = "Lace Projects",
        choices = choices,
        action = wezterm.action_callback(function(win, _, id)
          if not id then return end

          local project = projects[id]
          if not project then return end

          -- Connect to project (domain = "lace:<id>")
          win:perform_action(
            act.SwitchToWorkspace({
              name = id,
              spawn = {
                domain = { DomainName = "lace:" .. id },
                cwd = (project.workspacePath or "/workspace") .. "/" .. (project.mainWorktree or "main"),
              },
            }),
            pane
          )
        end),
      }),
      pane
    )
  end)
end

-- Add to apply_to_config
function M.apply_to_config(config, opts)
  -- ... existing setup ...

  -- Setup project picker (only once globally)
  if not M._project_picker_registered then
    setup_project_picker()
    M._project_picker_registered = true
  end

  -- Add unified picker keybinding
  config.keys = config.keys or {}
  table.insert(config.keys, {
    key = "p",
    mods = "LEADER",
    action = act.EmitEvent("lace.show-project-picker"),
  })
end
```

**Behavior for stopped containers**: The wezterm picker always attempts connection on selection. If the container is stopped, the SSH connection will fail and wezterm displays an error. Users can then start the container via `lace up` or use the CLI command which offers to start stopped containers.

### Keybinding Summary

| Keybinding | Action | Notes |
|------------|--------|-------|
| Leader+P | Show project picker | New unified picker |
| Leader+W | Show worktree picker | Existing, for current project |
| Leader+D | Quick connect (legacy) | Deprecated, use picker |
| Leader+S | Show workspaces | Existing wezterm workspace switcher |

## Open Questions (Resolved)

### Q1: Devcontainer Detection
**Resolution**: Combination approach. Read from `settings.json` (top-level `projects` key) for the list, probe SSH port to detect running status. No filesystem scanning for devcontainer.json files.

### Q2: Project Identification
**Resolution**: Projects self-register in `settings.json` with a `displayName` field. The project key serves as both identifier and SSH domain name. The picker shows `displayName (projectKey)`.

### Q3: Scope of Listing
**Resolution**: All registered projects from `settings.json`, with status indicators for running/stopped.

### Q4: Keybinding Design
**Resolution**: Single unified keybinding (Leader+P) for the picker. CLI provides alternative entry point.

### Q5: Integration with Worktree Picker
**Resolution**: Separate UIs. Project picker selects which project/container to connect to. Worktree picker (Leader+W) selects which worktree within the current project. They are complementary.

### Q6: Metadata Display
**Resolution**: `[status] DisplayName (key)` format. Status shows running/stopped.

### Q7: Connection Flow
**Resolution**: Running containers connect immediately via `SwitchToWorkspace`. Stopped containers prompt for confirmation before starting.

### Q8: Plugin Registration
**Resolution**: Explicit registration in `~/.config/lace/settings.json` under the top-level `projects` key. The `lace up` command auto-registers projects. Optional future `lace register` command could manually add projects.

### Q9: Relationship to Lace Plugins System
**Resolution**: Project picker configuration is consolidated with the Lace Plugins System in `settings.json`. The `plugins` key handles mount configuration; the `projects` key (top-level) handles project registry including port allocation, status tracking, and wezterm configuration. They are complementary: plugins define what gets mounted; projects define how to connect to containers.

## Test Plan

### Unit Tests

| Test | Expected Outcome |
|------|------------------|
| Parse valid settings.json with projects | Returns project map |
| Parse settings.json without projects section | Returns empty map |
| Parse invalid JSON | Error with message |
| Tilde expansion in paths | Expands correctly |
| Missing required fields | Error identifying field |

### Integration Tests

| Test | Expected Outcome |
|------|------------------|
| CLI --list with projects | Lists project names |
| CLI --status with running container | Shows [*] indicator |
| CLI --status with stopped container | Shows [-] indicator |
| CLI with valid project argument | Connects successfully |
| CLI with invalid project argument | Error with suggestions |
| CLI picker with fzf | Shows fuzzy picker |
| CLI picker without fzf | Shows select menu |

### Manual Verification

1. Configure two projects in settings.json under the projects key
2. Start one container, leave other stopped
3. Invoke `wez-lace-into --status` and verify indicators
4. Invoke `wez-lace-into` and select the running project
5. Verify workspace opens with correct cwd
6. Test Leader+P picker in wezterm
7. Verify worktree picker (Leader+W) still works within project

## Implementation Phases

### Phase 1: Project Registry

1. Extend `settings.json` schema with top-level `projects` key
2. Add validation logic to lace-plugin
3. Document manual registration process in settings.json (or use `lace up` for auto-registration)

**Success criteria**: Plugin reads and validates settings.json projects section

### Phase 2: WezTerm Picker UI

1. Implement `lace.show-project-picker` event handler
2. Add status detection via SSH probe
3. Add Leader+P keybinding
4. Update wezterm.lua

**Success criteria**: Leader+P shows picker with correct status

### Phase 3: CLI Command

1. Create `bin/wez-lace-into` script
2. Implement --list, --status, --help flags
3. Implement interactive picker (fzf/select)
4. Add connection logic

**Success criteria**: CLI can list, show status, and connect to projects

### Phase 4: Integration and Polish

1. Add `lace register` command (optional)
2. Update documentation
3. Handle edge cases (no docker, SSH failures)
4. Add toast notifications for errors

**Success criteria**: Full workflow documented and tested

## Related Documents

- [WezTerm Plugin Research](../reports/2026-02-04-wezterm-plugin-research.md) - Background on wezterm plugin capabilities
- [Lace Plugins System](2026-02-04-lace-plugins-system.md) - Plugin system with project configuration patterns
- [Deeper WezTerm DevContainer Integration](2026-02-01-deeper-wezterm-devcontainer-integration.md) - Integration patterns
- [Project Picker CLI Devlog](../devlogs/2026-02-04-wezterm-project-picker-cli.md) - Research notes for CLI design

## Sources

- [WezTerm CLI Documentation](https://wezterm.org/cli/cli/index.html)
- [SwitchToWorkspace](https://wezterm.org/config/lua/keyassignment/SwitchToWorkspace.html)
- [SpawnCommand](https://wezterm.org/config/lua/SpawnCommand.html)
- [user-var-changed event](https://wezterm.org/config/lua/window-events/user-var-changed.html)
- [wezterm.emit Discussion](https://github.com/wezterm/wezterm/discussions/3424)
