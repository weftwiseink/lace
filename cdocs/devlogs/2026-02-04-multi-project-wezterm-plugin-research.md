---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:00:00-08:00
type: devlog
state: live
status: done
tags: [wezterm, plugin, multi-project, port-allocation, devcontainer]
---

# Multi-Project WezTerm Plugin Research

## Objective

Research and design a refactor of the lace WezTerm plugin to support near-arbitrary numbers of parallel projects without port conflicts, domain name collisions, or event handler conflicts.

## Background

The current lace WezTerm plugin at `config/wezterm/lace-plugin/plugin/init.lua` has several limitations when multiple lace-enabled projects run simultaneously:

1. **Hardcoded port (2222)**: The SSH port is fixed, causing conflicts when multiple containers try to bind the same port
2. **Domain name collision**: Each project defaults to domain name "lace", overwriting previous registrations
3. **Event handler conflicts**: Events like `lace.trigger-worktree-picker.lace` collide across projects
4. **Keybinding collisions**: Leader+D and Leader+W can only target one project at a time

## Research Notes

### Current Architecture

The plugin follows a clean pattern:
```lua
-- plugin/init.lua exports:
M.apply_to_config(config, opts)  -- Main entry point
M.get_picker_event(domain_name)  -- Get event name for custom bindings
M.connect_action(opts)           -- Create a connect action

-- Options:
{
  ssh_key = "~/.ssh/lace_devcontainer",
  domain_name = "lace",           -- SSH domain name
  ssh_port = "localhost:2222",    -- SSH address
  username = "node",
  workspace_path = "/workspace",
  main_worktree = "main",
}
```

The plugin:
1. Registers an SSH domain with the given name
2. Sets up a worktree picker event
3. Optionally adds status bar workspace display

### Port Conflict Analysis

**Current situation:**
- `devcontainer.json` hardcodes `"appPort": ["2222:2222"]`
- WezTerm config hardcodes `ssh_port = "localhost:2222"`
- If Project A uses port 2222 and Project B tries to use 2222, Docker fails to bind

**Dynamic port allocation strategies:**

1. **Ephemeral ports**: Let Docker assign a random host port (`"appPort": ["2222"]` maps container:2222 to a random host port)
   - Pro: Never conflicts
   - Con: Port changes on every container restart, requiring discovery mechanism

2. **Port registry file**: `~/.config/lace/port-registry.json` maps project names to allocated ports
   - Pro: Stable ports per project
   - Con: Requires coordination, cleanup of stale entries

3. **Hash-based port**: Derive port from project name (e.g., `crc32(project_name) % 1000 + 2222`)
   - Pro: Deterministic, no coordination needed
   - Con: Potential collisions (birthday paradox), limited range

4. **Sequential allocation**: Start at 2222, increment for each new project
   - Pro: Simple, predictable
   - Con: Gaps when projects are removed, requires registry

**Recommendation**: Hybrid approach:
- Use hash-based port as the default (provides stability without coordination)
- Fall back to port registry for collision resolution
- Support explicit port override in devcontainer.json

### Project Discovery Mechanisms

For the project picker to work, WezTerm needs to know about available projects. Options:

1. **Static configuration**: User lists projects in wezterm.lua
   - Pro: Explicit, no magic
   - Con: Manual maintenance burden

2. **Port registry scanning**: Read from `~/.config/lace/settings.json` or dedicated registry
   - Pro: Centralized source of truth
   - Con: Requires lace CLI to populate

3. **Docker container labels**: Query Docker for running containers with lace labels
   - Pro: Always accurate for running containers
   - Con: Slower (exec docker), only shows running containers

4. **Devcontainer.json scanning**: Scan common paths for devcontainer.json files
   - Pro: Discovers all potential projects
   - Con: Expensive, may find non-lace projects

**Recommendation**: Layer 2 + 3:
- `lace up` writes to registry when starting a container
- WezTerm reads registry for configured projects
- Optionally query Docker for running status

### Domain Naming Conventions

The SSH domain name must be unique per project. Options:

1. **Project name prefix**: `lace:myproject`, `lace:other-project`
   - Pro: Clear namespace, sortable
   - Con: Verbose in UI

2. **Just project name**: `myproject`, `other-project`
   - Pro: Short, clean
   - Con: Could conflict with other SSH domains

3. **Hashed suffix**: `lace-a7b3c`, `lace-f2e1d`
   - Pro: Guaranteed unique
   - Con: Not human-readable

**Recommendation**: `lace:<project-name>` format
- Clear it's a lace-managed domain
- Project name is visible for identification
- Consistent pattern for all lace projects

### Event Handler Deduplication

Current code already handles this:
```lua
M._registered_events = {}
if M._registered_events[event_name] then
  return event_name
end
```

For multi-project support, events should include the project identifier:
- `lace.trigger-worktree-picker.lace:myproject`
- `lace.container-status.lace:myproject`

### Integration with Project Picker (RFP)

The [WezTerm Project Picker](../proposals/2026-02-04-wezterm-project-picker.md) RFP describes a UI for selecting which project to connect to. The multi-project refactor enables this by:

1. Providing a registration mechanism for projects
2. Supporting multiple SSH domains simultaneously
3. Enabling per-project worktree pickers

The project picker would:
1. Query the project registry
2. Show InputSelector with available projects
3. On selection, switch to that project's domain/worktree

### Lace Plugins System Integration

The [Lace Plugins System](../proposals/2026-02-04-lace-plugins-system.md) proposal describes how plugins (including WezTerm) are mounted. The [Plugin Host Setup RFP](../proposals/2026-02-04-rfp-plugin-host-setup.md) describes host-side requirements.

For multi-project support, the WezTerm plugin needs:
1. Per-project SSH key support (or shared key across projects)
2. Port allocation during `lace resolve-mounts` or `lace up`
3. Registry update on container start/stop

## Design Decisions Made

### D1: Use lace settings.json for project registry
**Decision**: Extend `~/.config/lace/settings.json` with a `projects` field.
**Rationale**: Already exists for plugins, keeps config centralized.

### D2: Hash-based port allocation with fallback
**Decision**: Default port = `crc32(project_name) % 1000 + 2222`, with registry override.
**Rationale**: Deterministic and collision-resistant for typical use cases.

### D3: Domain naming convention
**Decision**: Use `lace:<project-name>` format.
**Rationale**: Clear namespace, human-readable, consistent.

### D4: Unified keybinding approach
**Decision**: Single Leader+D opens project picker, not direct connect.
**Rationale**: Scales to arbitrary project count without keybinding explosion.

## Next Steps

1. Draft full proposal for multi-project WezTerm plugin support
2. Request review via /review subagent
3. Iterate based on feedback
4. Prepare for user review

## Files Examined

- `/var/home/mjr/code/weft/lace/config/wezterm/lace-plugin/plugin/init.lua` - Current plugin implementation
- `/var/home/mjr/code/weft/lace/config/wezterm/wezterm.lua` - Main WezTerm config
- `/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json` - Current devcontainer config
- `/var/home/mjr/code/weft/lace/cdocs/proposals/2026-02-04-lace-plugins-system.md` - Plugins system proposal
- `/var/home/mjr/code/weft/lace/cdocs/proposals/2026-02-04-wezterm-project-picker.md` - Project picker RFP
- `/var/home/mjr/code/weft/lace/cdocs/reports/2026-02-04-wezterm-plugin-research.md` - Prior plugin research
