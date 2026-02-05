---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T16:00:00-08:00
type: devlog
state: archived
status: done
tags: [wezterm, port-scanning, discovery, multi-project, devcontainer]
---

# Port-Scanning Discovery Design

## Objective

Design a dramatically simplified multi-project WezTerm support system using port-scanning discovery instead of a central registry. The user wants:

1. WezTerm scans ports 22425-22499 directly to find running devcontainers
2. Server verification to confirm each port is a wezterm-mux-server
3. Project info retrieval from the devcontainer
4. No central registry (removes settings.projects requirement for discovery)
5. Decoupled: Lace devcontainers manage their own port binding independently
6. Stable ports: Projects should maintain consistent ports across restarts

## Research Findings

### WezTerm Server Verification

WezTerm doesn't expose a dedicated "ping" or identification protocol for verifying mux servers. The available approaches are:

1. **SSH Connection Probe**: Attempt SSH with timeout; success indicates SSH is listening
2. **wezterm cli list**: Requires already being connected; not useful for discovery
3. **Port TCP Connect**: Only proves something is listening, not what it is

The most reliable verification is attempting an SSH connection with a short timeout. If the SSH handshake completes, we know it's an SSH server; the wezterm-mux-server feature runs atop SSH.

### Project Identification

How can we identify which project a discovered port belongs to?

**Option A: Docker Labels** (Container-side)
```bash
docker ps --filter "publish=22425" --format '{{.Labels}}' | grep devcontainer.local_folder
```
- Pro: Reliable, already set by devcontainer CLI
- Con: Requires docker access from host, not available from WezTerm Lua

**Option B: SSH Environment Variable** (Via SSH probe)
```bash
ssh -p 22425 node@localhost 'echo $LACE_PROJECT_NAME'
```
- Pro: Works from WezTerm Lua via `wezterm.run_child_process()`
- Con: Requires the container to set `LACE_PROJECT_NAME` environment variable

**Option C: Marker File** (Via SSH probe)
```bash
ssh -p 22425 node@localhost 'cat /workspace/.lace/project-name'
```
- Pro: Explicit, easy to implement
- Con: Requires file creation during `lace up`

**Option D: Hostname** (Via SSH probe)
```bash
ssh -p 22425 node@localhost 'hostname'
```
- Pro: Already set by devcontainer
- Con: Format varies, may need parsing

**Decision**: Use Option B (environment variable) with fallback to workspace folder parsing. Set `LACE_PROJECT_NAME` during container startup via the devcontainer feature.

### Port Range Selection

User specified: 22425-22499 (w=22, e=4, z=25)

This provides 75 available ports, which is sufficient for typical usage (most users run 1-5 projects simultaneously).

### Port Stability Without Central Registry

The challenge: How does a project claim and remember its port without a central coordinator?

**Approach: Per-Project Port Configuration**

Each lace project stores its assigned port in `.lace/devcontainer.json`:

```jsonc
// .lace/devcontainer.json (auto-generated, gitignored)
{
  "appPort": ["22427:2222"]
}
```

**Port Assignment Algorithm** (in `lace up`):

1. If `.lace/devcontainer.json` has an `appPort` with port in 22425-22499 range, use it
2. Otherwise, scan 22425-22499 for unused ports
3. Pick the first unused port
4. Write to `.lace/devcontainer.json`
5. The container starts with that port binding

**Why This Works**:
- First-run projects get auto-assigned ports based on what's currently available
- Subsequent runs use the stored port (stable)
- If another project took the port while stopped, re-scan and pick a new one
- The `.lace/devcontainer.json` is gitignored, so it's machine-local

**Collision Handling**:
- During `lace up`, verify the configured port is actually available
- If not (another project took it), reassign and update `.lace/devcontainer.json`
- Log a warning so user knows the port changed

## Design Decisions

### D1: Decoupled Port Assignment

Each project independently manages its port in `.lace/devcontainer.json`. No central registry.

**Tradeoff**: Port collisions can occur if two projects start simultaneously. Mitigated by checking at startup and reassigning.

### D2: Environment Variable for Project Identification

Set `LACE_PROJECT_NAME` in the container. The WezTerm picker reads this via SSH probe.

**Implementation**: Add to wezterm-server feature or as a separate lace-identity feature.

### D3: SSH Probe for Server Verification

Use SSH connection with 1-second timeout to verify wezterm-mux-server availability.

**Implementation**:
```lua
local function probe_port(port)
  local ok = wezterm.run_child_process({
    "ssh", "-p", tostring(port),
    "-o", "ConnectTimeout=1",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "BatchMode=yes",
    "node@localhost",
    "echo $LACE_PROJECT_NAME"
  })
  return ok, stdout
end
```

### D4: Port Range Scanning in WezTerm

WezTerm scans ports 22425-22499 on plugin load or when project picker is opened.

**Implementation**: Sequential scan with parallel probes (configurable concurrency).

## Simplified Architecture

```
Host Machine                          Container (port 22427)
+------------------------+            +------------------------+
|  WezTerm               |            |  wezterm-mux-server    |
|  - Scans 22425-22499   |    SSH     |  - Listens on 2222     |
|  - Probes for SSH      |----------->|  - LACE_PROJECT_NAME   |
|  - Gets project name   |            |    = "myproject"       |
|  - Offers picker UI    |            +------------------------+
+------------------------+

+------------------------+            +------------------------+
|  lace CLI              |            |  Container (port 22428)|
|  - lace up             |            |  - Another project     |
|  - Assigns port from   |            +------------------------+
|    range if unset      |
|  - Stores in           |
|    .lace/devcontainer  |
+------------------------+
```

## Changes from Previous Proposal

1. **Removed**: `~/.config/lace/settings.json` projects section for discovery
2. **Removed**: Central port allocation registry
3. **Added**: Port-scanning discovery (22425-22499)
4. **Added**: SSH probe for project identification
5. **Added**: Per-project `.lace/devcontainer.json` port persistence
6. **Simplified**: No backward compatibility concerns (clean break)
7. **Removed**: References to `@mjrusso/lace` (user unfamiliar with this)

## Implementation Plan

### Phase 1: Container Identity
- Add `LACE_PROJECT_NAME` environment variable to wezterm-server feature
- Derive from workspace folder name if not explicitly set

### Phase 2: Port Assignment in lace CLI
- Update `lace up` to check/assign port from 22425-22499
- Store in `.lace/devcontainer.json`
- Check port availability before starting

### Phase 3: WezTerm Port Scanner
- Implement port scanning in lace-plugin
- SSH probe to verify and identify projects
- Build picker choices from discovered projects

### Phase 4: CLI Integration (wez-lace-into)
- Update CLI to use port scanning
- Remove dependency on settings.json for discovery

## Resolved Questions

1. **Concurrency**: 10 parallel probes via `xargs -P 10`
2. **Cache Duration**: No caching; fresh scan on each picker invocation (~1 second is acceptable)
3. **SSH Key**: Default to `~/.ssh/lace_devcontainer`
4. **Timeout**: 200ms per probe (sufficient for localhost)
5. **Domain Registration**: Pre-register port-based domains (`lace:22425` through `lace:22499`) at startup

## Outcome

Created proposal: `cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md`

The proposal went through two rounds of review:
- **Round 1**: Identified blocking issues with domain registration timing, parallel scanning, and timeout
- **Round 2**: Accepted after revisions addressed all blocking issues

Key solutions after Round 2:
- Pre-register 75 port-based domains at WezTerm startup (decouples domain registration from discovery)
- Parallel scanning via shell script with `xargs -P 10`
- 200ms timeout for localhost SSH probes
- `LACE_PROJECT_NAME` set via wezterm-server feature

## Round 3 Revision (User Feedback Integration)

User feedback prompted a significant revision with four key changes:

### 1. Replace LACE_PROJECT_NAME with Docker Labels

Instead of a custom environment variable, use Docker's existing `devcontainer.local_folder` label:

```bash
docker ps --filter "label=devcontainer.local_folder" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}'
```

**Benefits**:
- Zero container modification required
- Works with any devcontainer out of the box
- Richer metadata available (config file, features, etc.)

### 2. On-Demand Discovery Only

Removed startup-time discovery entirely. Discovery now runs ONLY when the picker is invoked.

**Rationale**: Devcontainers start/stop at unpredictable times, so startup-cached state becomes stale immediately. On-demand discovery via Docker CLI is fast (~100ms) and always accurate.

### 3. Remove settings.json Dependency

All discovery information comes from Docker CLI. The only configuration needed in wezterm.lua is the SSH key path:

```lua
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
})
```

### 4. Expanded Implementation Phases

Added detailed test methodology for each phase:
- Specific test commands with expected outputs
- Debugging steps for common failure modes
- Done criteria checklists

**Phase structure**:
1. Port Assignment in lace up
2. Docker Discovery Function (standalone script)
3. WezTerm Plugin with Docker Discovery
4. CLI Update (wez-lace-into)
5. End-to-End Integration Testing

Each phase includes verification steps so implementors can confirm correctness before proceeding.

### Docker CLI Approach

The discovery mechanism shifted from SSH probing each port to querying Docker directly:

```lua
local success, stdout = wezterm.run_child_process({
  "docker", "ps",
  "--filter", "label=devcontainer.local_folder",
  "--format", "{{.ID}}\t{{.Label \"devcontainer.local_folder\"}}\t{{.Ports}}"
})
```

**Advantages**:
- Much faster (~100ms vs 1-2s for SSH probing)
- No SSH key issues during discovery
- Access to richer container metadata
- Single command gets all needed info

**Tradeoff**: Requires Docker CLI on host (acceptable for devcontainer workflow).

### Round 3 Review Outcome

Accepted. All feedback integrated successfully. The proposal is now ready for implementation.
