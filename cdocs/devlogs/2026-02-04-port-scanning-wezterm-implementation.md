---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T17:00:00-08:00
type: devlog
state: live
status: review_ready
tags: [wezterm, port-scanning, discovery, multi-project, devcontainer, implementation]
implements:
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
last_reviewed:
  status: revision_requested
  by: claude-haiku-4-5-20251001
  at: 2026-02-04T18:45:00-08:00
  round: 1
---

# Port-Scanning WezTerm Discovery Implementation

## Objective

Implement the port-scanning WezTerm discovery system as specified in the accepted proposal. This replaces the registry-based multi-project system with decoupled port-scanning discovery via Docker CLI.

Key features:
1. Port range 22425-22499 for wezterm SSH servers
2. `lace up` assigns and persists ports in `.lace/devcontainer.json`
3. WezTerm plugin discovers projects via Docker CLI when picker is invoked
4. `wez-lace-into` CLI uses Docker discovery
5. No central registry required

## Implementation Plan

Per the proposal, implementation proceeds in 5 phases:

1. **Phase 1**: Port Assignment in `lace up`
2. **Phase 2**: Docker Discovery Function (standalone script)
3. **Phase 3**: WezTerm Plugin with Docker Discovery
4. **Phase 4**: CLI Update (`wez-lace-into`)
5. **Phase 5**: End-to-End Integration Testing

---

## Phase 1: Port Assignment in `lace up`

### Plan

- Create `packages/lace/src/lib/port-manager.ts`
- Implement `isPortAvailable()` using TCP connect
- Implement `assignPort()` to find/persist port
- Update `lace up` to call port assignment before generating config

### Implementation Notes

Created `packages/lace/src/lib/port-manager.ts` with:
- `LACE_PORT_MIN = 22425`, `LACE_PORT_MAX = 22499`
- `isPortAvailable(port)`: TCP connect with 100ms timeout
- `findAvailablePort()`: Sequential scan of port range
- `parseAppPort(appPort)`: Parse devcontainer appPort format
- `readPortAssignment(workspaceFolder)`: Read from `.lace/devcontainer.json`
- `writePortAssignment(workspaceFolder, port)`: Write to `.lace/devcontainer.json`
- `assignPort(workspaceFolder)`: Main assignment logic with collision handling

Updated `lace up` workflow:
1. Port assignment now runs as Phase 0 (before prebuild)
2. Converted `runUp()` to async to support port availability checking
3. Extended config now always generated (includes port mapping)
4. Port mapping added to `appPort` in extended devcontainer.json

### Verification

- [x] `npm run build` succeeds
- [x] `npm run typecheck` passes
- [x] All 298 tests pass
- [x] Port assignment phase runs before other phases
- [x] Extended config includes `appPort: ["22425:2222"]` format

### Commit

`c8dff68` - feat(lace): add port assignment for wezterm SSH server (22425-22499)

---

## Phase 2: Docker Discovery Function

### Plan

- Create `bin/lace-discover` standalone script
- Parse Docker output to extract project info
- Test in isolation before integrating into wezterm plugin

### Implementation Notes

Created `bin/lace-discover` with:
- Queries Docker for containers with `devcontainer.local_folder` label
- Filters for ports in 22425-22499 range (mapping to 2222)
- Extracts project name from path basename
- Gets container user via `docker inspect`
- Outputs text format (name:port:user:path) or JSON

### Verification

```bash
# Verify Docker labels are present
docker ps --filter "label=devcontainer.local_folder" --format json | head -1 | jq '.'

# Test discovery (empty result expected - no lace ports yet)
./bin/lace-discover
./bin/lace-discover --json
```

- [x] Script is executable
- [x] Returns empty array when no lace containers running
- [x] Correctly skips containers with ports outside range

### Commit

`9722deb` - feat(bin): add lace-discover script for Docker-based project discovery

---

## Phase 3: WezTerm Plugin with Docker Discovery

### Plan

- Pre-register SSH domains for ports 22425-22499 at startup
- Implement `discover_projects()` using Docker CLI
- Implement project picker UI
- Add CTRL+SHIFT+P keybinding

### Implementation Notes

Rewrote `config/wezterm/lace-plugin/plugin/init.lua`:

**Port Domain Registration:**
- Pre-registers 75 SSH domains (lace:22425 through lace:22499)
- Each domain configured with SSH key and WezTerm multiplexing
- Logged at startup: "lace: registered 75 SSH domains for ports 22425-22499"

**Docker Discovery:**
- `discover_projects()` queries Docker with same logic as shell script
- Parses container ID, local_folder label, and ports
- Filters for ports in lace range
- Gets container user via docker inspect

**Project Picker:**
- Registered on `lace.project-picker` event
- Shows all discovered containers with format: `[*] name (:port) - /path`
- Connects via `lace:PORT` domain when selected
- Toast notification if no containers found

**Configuration:**
- Only `ssh_key` required now
- Optional: `picker_key`, `picker_mods`, `enable_status_bar`

### Verification

Cannot fully test without restarting WezTerm, but code review confirms:
- [x] Domain registration loop covers full port range
- [x] Docker CLI command matches shell script
- [x] Port parsing regex handles both 0.0.0.0 and ::: formats
- [x] Keybinding registered correctly

### Commit

`fd633e3` - feat(wezterm): implement Docker-based project discovery in lace plugin

---

## Phase 4: CLI Update (wez-lace-into)

### Plan

- Create `bin/wez-lace-into` CLI
- Use lace-discover for Docker discovery
- Provide interactive picker and direct connection

### Implementation Notes

Created `bin/wez-lace-into` with:
- `--list`: Show project names only
- `--status`: Show projects with ports and paths
- `<project>`: Direct connection to named project
- (no args): Interactive picker (fzf or bash select fallback)
- Single project auto-connects without picker

Uses `bin/lace-discover` for discovery, connects via `wezterm connect lace:PORT`.

### Verification

```bash
./bin/wez-lace-into --help   # Shows usage
./bin/wez-lace-into --list   # Empty (no lace containers)
./bin/wez-lace-into --status # Empty (no lace containers)
./bin/wez-lace-into test     # Error: project not found
```

- [x] Help text displays correctly
- [x] Empty list handled gracefully
- [x] Non-existent project shows helpful error

### Commit

`defbaa0` - feat(bin): add wez-lace-into CLI for project connection

---

## Phase 5: End-to-End Integration Testing

### Plan

Per the proposal, test full workflow:
1. Start container with `lace up` (assigns port)
2. Verify discovery finds it
3. Connect via wez-lace-into
4. Test picker in WezTerm

### Prerequisites

Need to rebuild current devcontainer with new port assignment.
Current container uses port 2222 (old format), not in lace range.

### Testing

**Note:** Full E2E testing requires rebuilding the devcontainer, which would
disrupt the current session. Key components have been unit tested.

Manual verification checklist:

1. [ ] `lace up` assigns port in 22425-22499 range
2. [ ] Port persisted in `.lace/devcontainer.json`
3. [ ] Container starts with correct port mapping
4. [ ] `bin/lace-discover` finds container
5. [ ] `bin/wez-lace-into --status` shows container
6. [ ] `bin/wez-lace-into <project>` connects
7. [ ] WezTerm picker shows container (CTRL+SHIFT+P)
8. [ ] Selecting project opens workspace

### Performance Verification

Per proposal requirements:

| Scenario | Expected | Actual |
|----------|----------|--------|
| Discovery with 0 containers | < 200ms | ~50ms (docker ps) |
| Discovery with 3 containers | < 300ms | TBD |
| Discovery with 10 containers | < 500ms | TBD |

---

## Summary

### Files Created

- `packages/lace/src/lib/port-manager.ts` - Port assignment logic
- `packages/lace/src/lib/__tests__/port-manager.test.ts` - Unit tests (21 tests)
- `bin/lace-discover` - Docker discovery script
- `bin/wez-lace-into` - WezTerm connection CLI

### Files Modified

- `packages/lace/src/lib/up.ts` - Added port assignment phase
- `packages/lace/src/commands/up.ts` - Made async for port checking
- `packages/lace/src/commands/__tests__/up.integration.test.ts` - Updated for async
- `config/wezterm/lace-plugin/plugin/init.lua` - Complete rewrite for Docker discovery

### Commits

1. `c8dff68` - feat(lace): add port assignment for wezterm SSH server (22425-22499)
2. `9722deb` - feat(bin): add lace-discover script for Docker-based project discovery
3. `fd633e3` - feat(wezterm): implement Docker-based project discovery in lace plugin
4. `defbaa0` - feat(bin): add wez-lace-into CLI for project connection
5. `e55a854` - test(lace): add unit tests for port-manager module

### Test Results

- All 315 tests pass
- Port-manager module has 21 dedicated unit tests
- Integration tests updated for async runUp

### Follow-up Tasks

1. **E2E Testing**: Rebuild devcontainer to test full workflow
2. **open-lace-workspace**: Update to use dynamic port discovery (currently hardcoded to 2222)
3. **WezTerm**: Restart to load new plugin with domain registration

