---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T16:30:00-08:00
type: proposal
state: live
status: implementation_ready
tags: [wezterm, port-scanning, discovery, multi-project, devcontainer, decoupled, docker-cli]
related_to:
  - cdocs/proposals/2026-02-04-wezterm-project-picker.md
  - cdocs/devlogs/2026-02-04-port-scanning-discovery-design.md
supersedes:
  - cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:55:00-08:00
  round: 3
revisions:
  - at: 2026-02-04T22:15:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Resolved domain registration timing with port-based pre-registration"
      - "Specified parallel port scanning via shell script"
      - "Reduced timeout to 200ms for localhost"
      - "Clarified port availability detection method"
      - "Canonicalized LACE_PROJECT_NAME to wezterm-server feature"
      - "Added multi-machine edge case"
      - "Resolved open questions"
  - at: 2026-02-04T23:45:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Removed LACE_PROJECT_NAME in favor of Docker labels (devcontainer.local_folder)"
      - "Removed startup-time discovery; discovery now only happens at picker invocation"
      - "Removed settings.json dependency; all info comes from Docker CLI"
      - "Significantly expanded implementation phases with detailed test methodology"
      - "Added Docker CLI-based discovery as primary mechanism"
      - "Simplified configuration: only SSH key path needed in wezterm.lua"
---

# Port-Scanning WezTerm Discovery

> BLUF: Replace the registry-based multi-project system with decoupled port-scanning discovery. WezTerm scans ports 22425-22499 when the picker is invoked, identifies devcontainers via Docker CLI, and retrieves project identity from Docker labels (`devcontainer.local_folder`). Each lace project independently manages its port in `.lace/devcontainer.json` (gitignored). This eliminates all central configuration while providing automatic discovery of running devcontainers.

## Objective

Enable WezTerm to discover and connect to multiple lace devcontainers through:

1. **On-demand port scanning**: Scan a dedicated port range (22425-22499) only when picker is invoked
2. **Docker CLI discovery**: Use Docker labels to identify projects and get container metadata
3. **Project identification**: Use `devcontainer.local_folder` label for project path (or git URL as fallback)
4. **Zero configuration**: No central registry, no settings.json for discovery

## Background

### Problem with Registry-Based Discovery

The previous proposal required:
- Central project registry in `~/.config/lace/settings.json`
- CLI commands to register/update projects
- Synchronization between registry and actual container state
- Manual updates when projects are added/removed

This creates coupling: the registry must be kept in sync with reality.

### Problem with Startup-Time Discovery

Devcontainers start and stop at unpredictable times. Discovering at WezTerm startup means:
- State becomes stale immediately after any container start/stop
- Need complex cache invalidation logic
- Still need to re-scan anyway when user wants to connect

### Decoupled Discovery

With on-demand port scanning + Docker CLI:
- WezTerm discovers what's actually running when user needs it
- No registry to maintain or sync
- No stale cache to invalidate
- Projects are fully independent
- "Just works" with current container state

## Proposed Solution

### Layer 1: Port Range

**Range**: 22425-22499 (75 ports)

**Rationale**: `w=22, e=4, z=25` spells "wez" in alphabet positions, making the base port memorable. 75 ports supports far more concurrent projects than typical usage.

### Layer 2: Per-Project Port Persistence

Each project stores its port in `.lace/devcontainer.json`:

```jsonc
// .lace/devcontainer.json (gitignored, machine-local)
{
  "appPort": ["22427:2222"]
}
```

**Port Assignment Algorithm** (executed by `lace up`):

```
1. Read existing port from .lace/devcontainer.json if present
2. If port is in valid range (22425-22499):
   a. Check if port is available (TCP connect fails = available)
   b. If available, use it (stable port)
   c. If not available, proceed to step 3
3. Scan 22425-22499 for first unused port (TCP connect fails = unused)
4. Update .lace/devcontainer.json with new port
5. Log if port changed: "Port 22427 was in use, reassigned to 22431"
```

**Port Availability Detection**: Use TCP connect to determine if a port is in use:

```typescript
// In packages/lace/src/lib/port-manager.ts
import * as net from 'net';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(100);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false); // Port is in use
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true); // Port is available
    });
    socket.once('error', () => {
      resolve(true); // Port is available (connection refused)
    });
    socket.connect(port, 'localhost');
  });
}
```

**Why This Works**:
- First run: auto-assign from available ports
- Subsequent runs: reuse stored port (stable)
- Collision recovery: auto-reassign if port taken

### Layer 3: Docker-Based Container Identity

**Primary Approach**: Use Docker labels that devcontainer CLI already sets:

```bash
# Get all running devcontainers with their local folders
docker ps --filter "label=devcontainer.local_folder" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}'
```

**Available Docker Labels**:
- `devcontainer.local_folder` → Full path to project on host (e.g., `/var/home/mjr/code/weft/lace`)
- `devcontainer.config_file` → Path to devcontainer.json
- `devcontainer.metadata` → JSON with features, user info, etc.

**Container Info from Docker Inspect**:
- `Config.User` → Container user (e.g., `node`)
- `NetworkSettings.Ports` → Port mappings

**Project Name Derivation**:
```bash
# Extract project name from local_folder
local_folder="/var/home/mjr/code/weft/lace"
project_name=$(basename "$local_folder")  # "lace"
```

**Fallback for Remote Containers**: If `devcontainer.local_folder` is not present (remote container), use:
- Git remote URL from container
- Container name as last resort

### Layer 4: On-Demand Discovery via Docker CLI

**When**: Discovery runs ONLY when the picker is invoked, not at startup.

**Method**: Single Docker command gets all needed info:

```lua
local function discover_projects()
  -- Get all devcontainers with their ports and project paths
  local success, stdout = wezterm.run_child_process({
    "docker", "ps",
    "--filter", "label=devcontainer.local_folder",
    "--format", "{{.ID}}\t{{.Label \"devcontainer.local_folder\"}}\t{{.Ports}}"
  })

  if not success then
    return {}
  end

  local projects = {}
  for line in stdout:gmatch("[^\n]+") do
    local id, local_folder, ports = line:match("^(%S+)\t(.+)\t(.*)$")
    if id and local_folder then
      -- Extract project name from path
      local name = local_folder:match("([^/]+)$")

      -- Find SSH port in expected range (22425-22499)
      local ssh_port = nil
      for port in ports:gmatch("0%.0%.0%.0:(%d+)%->2222/tcp") do
        local p = tonumber(port)
        if p and p >= 22425 and p <= 22499 then
          ssh_port = p
          break
        end
      end

      if ssh_port and name then
        -- Get container user
        local user_success, user_stdout = wezterm.run_child_process({
          "docker", "inspect", id, "--format", "{{.Config.User}}"
        })
        local user = "node"  -- default
        if user_success and user_stdout then
          user = user_stdout:gsub("%s+", "")
          if user == "" then user = "node" end
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
```

**Performance**: Docker CLI queries are fast (~50-100ms). No SSH probing needed for discovery.

### Layer 5: Project Picker

The picker shows discovered projects:

```lua
wezterm.on("lace.project-picker", function(window, pane)
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

  table.sort(choices, function(a, b) return a.label < b.label end)

  window:perform_action(
    act.InputSelector({
      title = "Lace Projects",
      choices = choices,
      action = wezterm.action_callback(function(win, _, id)
        if not id then return end
        local project = projects[id]

        -- Connect via pre-registered port-based domain
        win:perform_action(
          act.SwitchToWorkspace({
            name = id,
            spawn = {
              domain = { DomainName = "lace:" .. project.port },
              cwd = "/workspace",
            },
          }),
          pane
        )
      end),
    }),
    pane
  )
end)
```

### Layer 6: Domain Registration Strategy

**Challenge**: WezTerm config is evaluated once at startup. Domains for discovered ports must be pre-registered.

**Solution**: Pre-register port-based domains for the entire range at startup:

```lua
-- In apply_to_config(), register domains for all possible ports
local function setup_port_domains(config, ssh_key_path)
  config.ssh_domains = config.ssh_domains or {}

  for port = 22425, 22499 do
    table.insert(config.ssh_domains, {
      name = "lace:" .. port,
      remote_address = "localhost:" .. port,
      username = "node",  -- Will be overridden by SpawnCommand if needed
      remote_wezterm_path = "/usr/local/bin/wezterm",
      multiplexing = "WezTerm",
      ssh_option = {
        identityfile = ssh_key_path,
      },
    })
  end
end
```

**Configuration**: The ONLY configuration needed in wezterm.lua:

```lua
local lace = require("lace")
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  -- Optional: port_range = { min = 22425, max = 22499 },  -- defaults
})
```

### Layer 7: CLI Command (wez-lace-into)

The CLI uses Docker CLI for discovery, matching the WezTerm plugin:

```bash
#!/bin/bash
# wez-lace-into - Connect to lace devcontainer via Docker discovery
set -euo pipefail

LACE_PORT_MIN=22425
LACE_PORT_MAX=22499
SSH_KEY="${HOME}/.ssh/lace_devcontainer"

discover_projects() {
  # Get all devcontainers with their local folders and ports
  docker ps --filter "label=devcontainer.local_folder" \
    --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}' 2>/dev/null | \
  while IFS=$'\t' read -r id local_folder ports; do
    # Extract project name from path
    name=$(basename "$local_folder")

    # Find SSH port in expected range
    ssh_port=$(echo "$ports" | grep -oP '0\.0\.0\.0:\K(\d+)(?=->2222/tcp)' | while read p; do
      if [[ $p -ge $LACE_PORT_MIN && $p -le $LACE_PORT_MAX ]]; then
        echo "$p"
        break
      fi
    done)

    if [[ -n "$ssh_port" ]]; then
      # Get container user
      user=$(docker inspect "$id" --format '{{.Config.User}}' 2>/dev/null || echo "node")
      [[ -z "$user" ]] && user="node"

      echo "$name:$ssh_port:$user:$local_folder"
    fi
  done
}

case "${1:-}" in
  --list)
    discover_projects | cut -d: -f1
    ;;
  --status)
    discover_projects | while IFS=: read -r name port user path; do
      echo "[*] $name (:$port) - $path"
    done
    ;;
  "")
    # Interactive picker
    mapfile -t PROJECTS < <(discover_projects)
    if [[ ${#PROJECTS[@]} -eq 0 ]]; then
      echo "No running devcontainers found" >&2
      exit 1
    fi

    if command -v fzf &>/dev/null; then
      SELECTED=$(printf '%s\n' "${PROJECTS[@]}" | \
        awk -F: '{print $1 " (:" $2 ") - " $4}' | \
        fzf --prompt="Select project: ")
      PROJECT=$(echo "$SELECTED" | cut -d' ' -f1)
    else
      PS3="Select project: "
      select DISPLAY in $(printf '%s\n' "${PROJECTS[@]}" | awk -F: '{print $1}'); do
        [[ -n "$DISPLAY" ]] && PROJECT="$DISPLAY" && break
      done
    fi

    # Find port for selected project
    for proj in "${PROJECTS[@]}"; do
      if [[ "${proj%%:*}" == "$PROJECT" ]]; then
        PORT=$(echo "$proj" | cut -d: -f2)
        break
      fi
    done
    ;;
  *)
    # Direct project name - find its port
    PROJECT="$1"
    PORT=""
    for proj in $(discover_projects); do
      if [[ "${proj%%:*}" == "$PROJECT" ]]; then
        PORT=$(echo "$proj" | cut -d: -f2)
        break
      fi
    done
    if [[ -z "$PORT" ]]; then
      echo "Project '$PROJECT' not found. Running projects:" >&2
      discover_projects | cut -d: -f1 >&2
      exit 1
    fi
    ;;
esac

echo "Connecting to $PROJECT on port $PORT..."
wezterm connect "lace:$PORT" --workspace "$PROJECT"
```

## Design Decisions

### D1: Docker CLI Over SSH Probing

**Decision**: Use Docker CLI for discovery instead of SSH probing each port.

**Tradeoff**: Requires Docker CLI on host. Gained: much faster (~100ms vs 1-2s), no SSH key issues during discovery, richer metadata.

### D2: On-Demand Discovery Over Startup Caching

**Decision**: Run discovery fresh when picker is invoked, never at startup.

**Tradeoff**: Slight delay on picker open (~100ms). Gained: always accurate, no stale cache, no cache invalidation logic.

### D3: Docker Labels Over Custom Environment Variables

**Decision**: Use `devcontainer.local_folder` label instead of custom `LACE_PROJECT_NAME`.

**Tradeoff**: Less control over display name. Gained: zero container modification needed, already available, works with any devcontainer.

### D4: Per-Project Port Persistence

**Decision**: Store port in `.lace/devcontainer.json`, not a central file.

**Tradeoff**: No global view of port assignments. Gained: complete decoupling, no sync issues.

### D5: No settings.json for Discovery

**Decision**: All discovery info comes from Docker. No settings.json dependency.

**Tradeoff**: Cannot configure display names centrally. Gained: zero configuration required, true decoupling.

### D6: No Backward Compatibility

**Decision**: Clean break from registry-based system.

**Rationale**: User explicitly said "no backwards compatibility concerns". Simplifies implementation.

## Configuration

The ONLY configuration for the wezterm plugin:

```lua
-- In wezterm.lua
local lace = require("lace")
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
})
```

Optional overrides (with defaults shown):
```lua
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  port_min = 22425,
  port_max = 22499,
  default_user = "node",
})
```

## Edge Cases

### E1: Port Collision at Startup

**Trigger**: Two projects try to start with the same stored port.

**Behavior**: First to start gets the port. Second fails to bind, `lace up` detects this, reassigns to next available port, retries.

### E2: Stale Port in .lace/devcontainer.json

**Trigger**: Project's stored port is now used by another project that started while this one was stopped.

**Behavior**: `lace up` checks port availability before starting. If unavailable, reassigns.

### E3: No Projects Running

**Trigger**: User opens picker with no containers running.

**Behavior**: Toast notification: "No running devcontainers found".

### E4: Non-Lace Devcontainer on Port

**Trigger**: A devcontainer without wezterm-server is running.

**Behavior**: Container appears in Docker query but port won't be in 22425-22499 range. Filtered out.

### E5: Container with Same Project Name

**Trigger**: Two containers from different paths have the same basename (e.g., `/home/user/work/lace` and `/home/user/personal/lace`).

**Behavior**: Both get name "lace" - collision. Last discovered wins. Prevent by using unique folder names, or enhance picker to show full path.

### E6: SSH Key Not Found

**Trigger**: Configured SSH key doesn't exist.

**Behavior**: Domain connection fails. WezTerm shows SSH error. User must create key.

### E7: Docker Not Running

**Trigger**: Docker daemon is not running.

**Behavior**: Discovery returns empty list. Picker shows "No running devcontainers found".

### E8: Same Project on Multiple Machines

**Trigger**: Same project cloned to two different machines; each assigns its own port.

**Behavior**: No conflict. `.lace/devcontainer.json` is gitignored and machine-local. Each machine maintains its own port assignment independently.

## Test Plan

### Unit Tests: Port Assignment

| Scenario | Expected |
|----------|----------|
| No existing port, empty range | Assign 22425 |
| No existing port, 22425 in use | Assign 22426 |
| Existing port 22427, available | Use 22427 |
| Existing port 22427, unavailable | Reassign to next available |
| All ports in use | Error with message |

### Unit Tests: Discovery

| Scenario | Expected |
|----------|----------|
| No devcontainers running | Empty projects list |
| One devcontainer with SSH port in range | One project in list |
| Devcontainer with port outside range | Skipped |
| Multiple devcontainers | All with valid ports in list |
| Devcontainer without local_folder label | Skipped |

### Integration Tests

| Scenario | Expected |
|----------|----------|
| Start first project | Assigned port 22425, discoverable |
| Start second project | Assigned port 22426, both discoverable |
| Stop first project | Only second discoverable |
| Restart first project | Same port 22425 reused |
| wez-lace-into --list | Shows running projects |
| wez-lace-into --status | Shows projects with ports and paths |
| Picker shows both | Both selectable |

### Performance Tests

| Scenario | Expected |
|----------|----------|
| Discovery with 0 containers | Completes in < 200ms |
| Discovery with 3 containers | Completes in < 300ms |
| Discovery with 10 containers | Completes in < 500ms |

## Implementation Phases

### Phase 1: Port Assignment in lace up

**Scope:**
- Update `lace up` to manage ports in 22425-22499 range
- Store/read from `.lace/devcontainer.json`
- Check port availability before starting

**Files:**
- `packages/lace/src/commands/up.ts`
- `packages/lace/src/lib/port-manager.ts` (new)

**Test Methodology:**

1. **Create port-manager.ts and verify it compiles:**
   ```bash
   # In packages/lace directory
   npm run build
   # Expected: No TypeScript errors
   ```

2. **Test port availability function manually:**
   ```bash
   # Start a listener on a test port
   nc -l 22425 &
   NC_PID=$!

   # Run a quick test script
   npx ts-node -e "
   import { isPortAvailable } from './src/lib/port-manager';
   (async () => {
     console.log('22425 available:', await isPortAvailable(22425));  // Should be false
     console.log('22426 available:', await isPortAvailable(22426));  // Should be true
   })();
   "

   # Cleanup
   kill $NC_PID
   ```

3. **Test port assignment for new project:**
   ```bash
   # In a test project directory (create temp if needed)
   mkdir -p /tmp/test-lace-project/.lace
   cd /tmp/test-lace-project

   # Run lace up (dry-run or with mock)
   lace up --dry-run

   # Verify .lace/devcontainer.json was created with port
   cat .lace/devcontainer.json
   # Expected: {"appPort": ["22425:2222"]}
   ```

4. **Test port persistence:**
   ```bash
   # Run lace up again
   lace up --dry-run

   # Verify same port is used
   cat .lace/devcontainer.json
   # Expected: Still {"appPort": ["22425:2222"]}
   ```

5. **Test port collision handling:**
   ```bash
   # Block port 22425
   nc -l 22425 &
   NC_PID=$!

   # Clear existing assignment
   rm .lace/devcontainer.json

   # Run lace up
   lace up --dry-run

   # Verify it assigned 22426
   cat .lace/devcontainer.json
   # Expected: {"appPort": ["22426:2222"]}

   kill $NC_PID
   ```

**Debugging Steps:**
- If port check always returns available: verify socket timeout is working (add debug logs)
- If port check always returns unavailable: check firewall rules, verify connect is reaching localhost
- If devcontainer.json not created: check directory permissions, verify .lace directory exists

**Done Criteria:**
- [ ] `npm run build` succeeds with no errors
- [ ] Port availability detection correctly identifies used vs free ports
- [ ] New project gets assigned first available port in range
- [ ] Existing project reuses its stored port
- [ ] Port collision triggers reassignment with logged message

---

### Phase 2: Docker Discovery Function

**Scope:**
- Create standalone discovery script/function that queries Docker
- Parse container info to extract project name, port, user, path
- Test in isolation before integrating

**Files:**
- `bin/lace-discover` (new standalone script for testing)
- Later integrated into wezterm plugin

**Test Methodology:**

1. **Verify Docker labels are present on devcontainers:**
   ```bash
   # List all devcontainers with their labels
   docker ps --filter "label=devcontainer.local_folder" --format json | jq '.'

   # Expected: JSON output with Labels containing devcontainer.local_folder
   ```

2. **Test label extraction:**
   ```bash
   docker ps --filter "label=devcontainer.local_folder" \
     --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}'

   # Expected output format:
   # abc123def456  /var/home/user/code/project  0.0.0.0:22425->2222/tcp
   ```

3. **Test user extraction:**
   ```bash
   # Get container ID from previous command
   CONTAINER_ID=$(docker ps --filter "label=devcontainer.local_folder" -q | head -1)

   docker inspect "$CONTAINER_ID" --format '{{.Config.User}}'
   # Expected: "node" (or whatever user the container uses)
   ```

4. **Create and test discovery script:**
   ```bash
   # Create bin/lace-discover with the discovery logic
   chmod +x bin/lace-discover

   # Run it
   ./bin/lace-discover

   # Expected output format:
   # lace:22425:node:/var/home/mjr/code/weft/lace
   ```

5. **Test with multiple containers:**
   ```bash
   # Start another devcontainer (if available)
   # Then run discovery
   ./bin/lace-discover

   # Should list all running devcontainers with ports in range
   ```

6. **Test edge cases:**
   ```bash
   # Stop all devcontainers
   docker stop $(docker ps -q --filter "label=devcontainer.local_folder")

   ./bin/lace-discover
   # Expected: No output (empty)

   # With Docker stopped (if safe to test)
   sudo systemctl stop docker
   ./bin/lace-discover 2>&1
   # Expected: Error or empty gracefully
   ```

**Debugging Steps:**
- If no containers found: verify `docker ps` works, check filter label spelling
- If port not extracted: test regex against actual Ports output format, may vary
- If user is empty: check if container runs as root (User will be empty string)
- If path extraction fails: check for special characters in path

**Done Criteria:**
- [ ] Discovery script returns correct format for running containers
- [ ] Project name correctly extracted from path basename
- [ ] Port correctly identified within 22425-22499 range
- [ ] User correctly extracted (defaults to "node" if empty)
- [ ] Empty/error cases handled gracefully

---

### Phase 3: WezTerm Plugin with Docker Discovery

**Scope:**
- Pre-register port-based domains at startup
- Implement discover_projects() using Docker CLI
- Implement project picker UI
- Wire up keyboard shortcut

**Files:**
- `config/wezterm/lace-plugin/plugin/init.lua`

**Test Methodology:**

1. **Test domain pre-registration:**
   ```lua
   -- Add to init.lua temporarily for testing
   wezterm.log_info("Registered " .. #config.ssh_domains .. " SSH domains")

   -- Reload wezterm config (Ctrl+Shift+R or restart)
   -- Check wezterm log:
   -- tail -f ~/.local/share/wezterm/wezterm.log

   -- Expected: "Registered 75 SSH domains" (or 75 + any existing)
   ```

2. **Test Docker CLI from Lua:**
   ```lua
   -- Add temporary test in init.lua
   local success, stdout, stderr = wezterm.run_child_process({
     "docker", "ps", "--filter", "label=devcontainer.local_folder", "--format", "{{.ID}}"
   })
   wezterm.log_info("Docker test - success: " .. tostring(success))
   wezterm.log_info("Docker test - stdout: " .. (stdout or "nil"))
   wezterm.log_info("Docker test - stderr: " .. (stderr or "nil"))
   ```

3. **Test discover_projects function:**
   ```lua
   -- Add temporary keybinding for testing
   config.keys = {
     {
       key = "d",
       mods = "CTRL|SHIFT",
       action = wezterm.action_callback(function(window, pane)
         local projects = discover_projects()
         local msg = "Found projects:\n"
         for name, info in pairs(projects) do
           msg = msg .. string.format("  %s: port=%d user=%s\n", name, info.port, info.user)
         end
         wezterm.log_info(msg)
         window:toast_notification("lace", msg, nil, 5000)
       end),
     },
   }

   -- Press Ctrl+Shift+D and check toast/log
   ```

4. **Test picker UI:**
   ```lua
   -- Bind actual picker to test key
   config.keys = {
     {
       key = "p",
       mods = "CTRL|SHIFT|ALT",
       action = wezterm.action.EmitEvent("lace.project-picker"),
     },
   }

   -- Press Ctrl+Shift+Alt+P
   -- Expected: Picker appears with list of running projects
   ```

5. **Test connection from picker:**
   ```bash
   # Open picker, select a project
   # Expected: New workspace opens, connected to container via SSH
   # Verify with:
   hostname  # Should show container hostname
   echo $SHELL  # Should show container shell
   ```

6. **Test empty state:**
   ```bash
   # Stop all devcontainers
   docker stop $(docker ps -q --filter "label=devcontainer.local_folder")

   # Open picker
   # Expected: Toast notification "No running devcontainers found"
   ```

**Debugging Steps:**
- If Docker command fails: check if wezterm can find docker binary (PATH issues)
- If parsing fails: log raw stdout and check format matches expected
- If picker doesn't appear: check for Lua syntax errors in wezterm log
- If connection fails: verify SSH key path is correct, try manual SSH connection
- If workspace doesn't switch: check domain name matches "lace:PORT" format

**Done Criteria:**
- [ ] 75 SSH domains registered at startup (verify in log)
- [ ] Docker discovery returns correct project info
- [ ] Picker appears with formatted project list
- [ ] Selecting project opens new workspace connected to container
- [ ] Empty state shows appropriate toast notification
- [ ] No Lua errors in wezterm log during normal operation

---

### Phase 4: CLI Update (wez-lace-into)

**Scope:**
- Update `wez-lace-into` to use Docker discovery
- Remove any dependency on settings.json
- Match discovery logic with WezTerm plugin

**Files:**
- `bin/wez-lace-into`

**Test Methodology:**

1. **Test --list flag:**
   ```bash
   # With containers running
   wez-lace-into --list

   # Expected: List of project names, one per line
   # lace
   # other-project
   ```

2. **Test --status flag:**
   ```bash
   wez-lace-into --status

   # Expected: Formatted status output
   # [*] lace (:22425) - /var/home/mjr/code/weft/lace
   # [*] other-project (:22426) - /var/home/mjr/code/other
   ```

3. **Test direct project connection:**
   ```bash
   wez-lace-into lace

   # Expected: Connects to the "lace" project
   # Verify by checking hostname in resulting terminal
   ```

4. **Test non-existent project:**
   ```bash
   wez-lace-into nonexistent

   # Expected: Error message with list of available projects
   # "Project 'nonexistent' not found. Running projects:"
   # lace
   ```

5. **Test interactive picker (with fzf):**
   ```bash
   # Ensure fzf is installed
   which fzf

   wez-lace-into
   # Expected: fzf picker appears with project list
   # Select one, should connect
   ```

6. **Test interactive picker (without fzf):**
   ```bash
   # Temporarily hide fzf
   PATH_BACKUP=$PATH
   export PATH=$(echo $PATH | tr ':' '\n' | grep -v fzf | tr '\n' ':')

   wez-lace-into
   # Expected: bash select menu appears
   # 1) lace
   # 2) other-project
   # Select project:

   export PATH=$PATH_BACKUP
   ```

7. **Test with no containers:**
   ```bash
   docker stop $(docker ps -q --filter "label=devcontainer.local_folder")

   wez-lace-into --list
   # Expected: No output

   wez-lace-into --status
   # Expected: No output

   wez-lace-into
   # Expected: "No running devcontainers found" error, exit 1
   ```

**Debugging Steps:**
- If Docker command fails: verify docker is in PATH, user has docker permissions
- If port regex fails: test against actual `docker ps` Ports output format
- If fzf picker fails: check fzf version compatibility
- If wezterm connect fails: verify domain is registered, check wezterm log

**Done Criteria:**
- [ ] `--list` shows project names only
- [ ] `--status` shows projects with ports and paths
- [ ] Direct project name connects successfully
- [ ] Non-existent project shows helpful error
- [ ] Interactive picker works with fzf
- [ ] Interactive picker works with bash select fallback
- [ ] Empty container state handled gracefully

---

### Phase 5: End-to-End Integration Testing

**Scope:**
- Test full workflow from container start to connection
- Test multiple containers simultaneously
- Test container start/stop during session

**Test Methodology:**

1. **Clean slate test:**
   ```bash
   # Stop all devcontainers
   docker stop $(docker ps -q --filter "label=devcontainer.local_folder") 2>/dev/null

   # Start fresh project
   cd /path/to/test/project
   lace up

   # Verify port assignment
   cat .lace/devcontainer.json
   # Expected: Port in 22425-22499 range

   # Verify discovery
   wez-lace-into --status
   # Expected: Shows the project

   # Connect via CLI
   wez-lace-into test-project
   # Expected: Connects successfully
   ```

2. **Multi-project test:**
   ```bash
   # Start first project
   cd /path/to/project-a
   lace up

   # Start second project
   cd /path/to/project-b
   lace up

   # Verify different ports
   cat /path/to/project-a/.lace/devcontainer.json  # e.g., 22425
   cat /path/to/project-b/.lace/devcontainer.json  # e.g., 22426

   # Verify both discoverable
   wez-lace-into --status
   # Expected: Both projects listed

   # Test picker in WezTerm
   # Press picker shortcut, should show both
   ```

3. **Container lifecycle test:**
   ```bash
   # Start project, connect, verify
   cd /path/to/project-a
   lace up

   # Connect via WezTerm picker
   # Open picker, select project, verify connection

   # In another terminal, stop container
   docker stop $(docker ps -q --filter "label=devcontainer.local_folder=/path/to/project-a")

   # Open picker again
   # Expected: project-a no longer listed

   # Restart container
   lace up

   # Open picker
   # Expected: project-a back in list with same port
   ```

4. **Port collision recovery test:**
   ```bash
   # Start first project
   cd /path/to/project-a
   rm -f .lace/devcontainer.json
   lace up
   cat .lace/devcontainer.json  # Note port, e.g., 22425

   # Modify second project to claim same port
   cd /path/to/project-b
   echo '{"appPort": ["22425:2222"]}' > .lace/devcontainer.json

   # Start second project (first is still running)
   lace up

   # Verify it got reassigned
   cat .lace/devcontainer.json
   # Expected: Different port than 22425
   ```

5. **WezTerm workspace test:**
   ```bash
   # Connect to project via picker
   # Note workspace name in WezTerm status bar

   # Switch to different project via picker
   # Note new workspace name

   # Use WezTerm workspace switcher
   # Both workspaces should be available
   ```

**Debugging Steps:**
- If port not reused on restart: check .lace/devcontainer.json persistence
- If discovery misses container: verify Docker labels, check port range
- If workspace name wrong: check project name extraction from path
- If connection drops: check SSH key, container SSH server

**Done Criteria:**
- [ ] Fresh project gets port assigned and is discoverable
- [ ] Multiple projects get unique ports and are all discoverable
- [ ] Stopped container disappears from discovery
- [ ] Restarted container reuses its port
- [ ] Port collision triggers automatic reassignment
- [ ] WezTerm workspaces named correctly after projects
- [ ] Full workflow from `lace up` to connected terminal works

## Comparison with Previous Proposal

| Aspect | Registry-Based | Port-Scanning (Revised) |
|--------|---------------|------------------------|
| Discovery | Read settings.json | Docker CLI at picker time |
| Configuration | Required for each project | None (auto-discover) |
| Identity | LACE_PROJECT_NAME env var | devcontainer.local_folder label |
| Discovery timing | Startup (stale) | On-demand (always fresh) |
| settings.json | Required for project list | Not used for discovery |
| Accuracy | Can be stale | Always current |
| Speed | Instant (but stale) | ~100ms (always fresh) |
| Coupling | CLI must update registry | Fully decoupled |
| Complexity | Higher (sync logic) | Lower |

## Related Documents

- [Devlog: Port-Scanning Discovery Design](../devlogs/2026-02-04-port-scanning-discovery-design.md)
- [WezTerm Project Picker](2026-02-04-wezterm-project-picker.md) - UI design (still applicable)
- [Superseded: Multi-Project WezTerm Plugin](2026-02-04-multi-project-wezterm-plugin.md) - Previous registry-based approach
