---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T10:00:00-08:00
task_list: lace/dogfooding
type: proposal
state: archived
status: accepted
tags: [integration-testing, wez-into, devcontainer, discovery, ports, dogfooding, end-to-end]
related_to:
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
  - cdocs/proposals/2026-02-09-prebuild-features-port-support.md
  - cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md
  - cdocs/reports/2026-02-08-wez-into-cli-command-status.md
  - cdocs/reports/2026-02-09-wez-into-packaging-analysis.md
---

# End-to-End Integration Testing and Lacification of Devcontainer Workflows

> **BLUF:** Both the lace and dotfiles devcontainers have been individually migrated toward lace idioms (port allocation, prebuildFeatures, feature awareness), but the full pipeline -- from `lace up` generating correct port mappings, through Docker containers running with those mappings, to `lace-discover` finding them, to `wez-into` connecting via WezTerm SSH domains -- has never been tested end-to-end as a unified workflow. This proposal defines a six-phase methodical verification plan that audits and aligns both devcontainer configs, validates each layer of the pipeline independently, tests the `wez-into` CLI against live containers, and patches any bugs found along the way. The deliverables are: (1) both devcontainer configs fully lacified and verified working, (2) a patched `wez-into` script, and (3) a devlog with captured command output for every verification step. The key risk is the dotfiles container, which currently runs with zero port mappings because it predates the [prebuild features port support](2026-02-09-prebuild-features-port-support.md) fix and the [hostSshPort rename](../devlogs/2026-02-10-rename-sshport-to-hostsshport.md). The lace container has a correct `${lace.port(wezterm-server/hostSshPort)}:2222` template but has not been rebuilt since the rename.

## Objective

Achieve a verified, working end-to-end connection flow for both the lace and dotfiles devcontainers through the full lace toolchain: `lace up` -> Docker port mappings -> `lace-discover` -> `wez-into` -> WezTerm SSH domain connection. Every layer must be independently verified with captured output, and any bugs found must be patched as part of the work.

## Background

### Current state of the two devcontainers

**Lace devcontainer** (`/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json`):
- Recently migrated to lace idioms per the [self-hosting proposal](2026-02-09-lace-devcontainer-self-hosting.md)
- Uses `${lace.port(wezterm-server/hostSshPort)}:2222` in `appPort` (correct after the hostSshPort rename)
- Has `customizations.lace.prebuildFeatures` for git and sshd
- Keeps wezterm-server in `features` (required because `lace up` auto-injection only reads `features` for port-declaring features -- though the [prebuild features port support](2026-02-09-prebuild-features-port-support.md) proposal addresses this)
- No `.lace/` directory exists yet -- `lace up` has not been run against it

**Dotfiles devcontainer** (`/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`):
- Has `customizations.lace.prebuildFeatures` with wezterm-server (the case the prebuild port support proposal fixes)
- Has NO `appPort` -- relies entirely on auto-injection
- The generated `.lace/devcontainer.json` exists but has NO `appPort` entries (generated before the prebuild port support fix)
- The `.lace/port-assignments.json` still references the old label `wezterm-server/sshPort` (assigned port 22426)
- The running container has zero port mappings (confirmed in the hostSshPort rename devlog)
- Uses `repoMounts` for the lace repo

### The hostSshPort rename

The wezterm-server feature option was renamed from `sshPort` to `hostSshPort` on 2026-02-10. The rename changes:
- Feature manifest: `devcontainers/features/src/wezterm-server/devcontainer-feature.json` -- `sshPort` -> `hostSshPort` in both `options` and `customizations.lace.ports`
- Lace devcontainer template: `${lace.port(wezterm-server/sshPort)}` -> `${lace.port(wezterm-server/hostSshPort)}`
- Existing `port-assignments.json` files with label `wezterm-server/sshPort` will be treated as stale -- the allocator will create a new assignment for `wezterm-server/hostSshPort` on next `lace up` run

The dotfiles devcontainer config was NOT updated for the rename because it does not reference the option name directly (it relies on auto-injection). However, the stale port-assignments.json will cause a new port to be allocated rather than reusing 22426.

### The prebuild features port support fix

The [prebuild features port support proposal](2026-02-09-prebuild-features-port-support.md) extended the `lace up` pipeline to:
1. Collect features from both `features` and `prebuildFeatures` for port metadata
2. Auto-inject asymmetric `appPort` entries for port-declaring prebuild features
3. Extend the feature-ID map so template resolution accepts IDs from either block

This fix is critical for the dotfiles devcontainer, which has wezterm-server in `prebuildFeatures`. Without it, the port pipeline is entirely skipped.

### The wez-into CLI

`wez-into` (`/var/home/mjr/code/weft/lace/bin/wez-into`) is a 224-line bash script that:
1. Locates `lace-discover` (co-located or on PATH)
2. Queries Docker for running devcontainers in port range 22425-22499
3. Connects via `wezterm connect lace:<port> --workspace <project>`
4. Supports `--list`, `--status`, `--dry-run`, `--help`, interactive picker

It has never been tested against containers with working lace port allocation because neither container had working port mappings until the recent fixes.

### Expected port assignments

| Project | Port Label | Expected Port | Container Port | Source |
|---------|-----------|---------------|----------------|--------|
| lace | `wezterm-server/hostSshPort` | 22425 (first allocation) | 2222 | `appPort` template in devcontainer.json |
| dotfiles | `wezterm-server/hostSshPort` | 22426 (second allocation, or new) | 2222 | Auto-injected by prebuild port support |

> NOTE: The dotfiles port-assignments.json has `wezterm-server/sshPort: 22426` from the old label. After the rename, the allocator will create a new assignment for `wezterm-server/hostSshPort`. Whether it reuses 22426 or allocates a fresh port depends on whether the old assignment is cleaned up or the allocator considers port 22426 still "in use."

## Proposed Solution

A six-phase verification plan, executed sequentially. Each phase produces captured command output in the devlog. Containers may be destroyed and recreated as needed. The plan is designed to be executable by a subagent with docker access.

### Phase 1: Audit and align devcontainer configs

**Goal:** Ensure both configs are syntactically correct and use the right lace idioms before attempting `lace up`.

#### 1.1 Lace devcontainer audit

Verify the lace config at `/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json`:

```bash
# Check appPort uses the renamed hostSshPort option
grep 'hostSshPort' /var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json
# Expected: "appPort": ["${lace.port(wezterm-server/hostSshPort)}:2222"]

# Check wezterm-server is in features (not prebuildFeatures)
# This is required until prebuild port support is confirmed working
cat /var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json | python3 -c "
import sys, json
config = json.load(sys.stdin)
features = config.get('features', {})
print('wezterm-server in features:', any('wezterm-server' in k for k in features))
prebuild = config.get('customizations', {}).get('lace', {}).get('prebuildFeatures', {})
print('wezterm-server in prebuildFeatures:', any('wezterm-server' in k for k in prebuild))
"
# Expected: wezterm-server in features: True, wezterm-server in prebuildFeatures: False

# Check customizations.lace exists
grep -A5 '"lace"' /var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json | head -10
```

**Expected state:** The lace config should already be correct after the self-hosting migration and hostSshPort rename.

#### 1.2 Dotfiles devcontainer audit

Verify the dotfiles config at `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`:

```bash
# Check wezterm-server placement (should be in prebuildFeatures)
cat /home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json | python3 -c "
import sys, json
config = json.load(sys.stdin)
prebuild = config.get('customizations', {}).get('lace', {}).get('prebuildFeatures', {})
print('wezterm-server in prebuildFeatures:', any('wezterm-server' in k for k in prebuild))
features = config.get('features', {})
print('features block:', features)
print('appPort:', config.get('appPort', 'NOT SET'))
"
# Expected: wezterm-server in prebuildFeatures: True, features block: {}, appPort: NOT SET

# Check for stale sshPort references
grep -r 'sshPort' /home/mjr/code/personal/dotfiles/.devcontainer/ || echo "No sshPort references (good)"
grep -r 'sshPort' /home/mjr/code/personal/dotfiles/.lace/ || echo "No sshPort in .lace (may have stale assignments)"
```

**Expected state:** The dotfiles config has wezterm-server in `prebuildFeatures` with no `appPort`. This is the scenario the prebuild port support fix handles via asymmetric auto-injection. The `.lace/port-assignments.json` will have a stale `wezterm-server/sshPort` label.

#### 1.3 Fix dotfiles stale port assignments

```bash
# Inspect current state
cat /home/mjr/code/personal/dotfiles/.lace/port-assignments.json
# Expected: {"assignments":{"wezterm-server/sshPort":{"label":"wezterm-server/sshPort","port":22426,...}}}

# The stale assignment will be ignored on next lace up because the label changed.
# Document this for the devlog but do NOT manually edit -- let lace up handle it.
```

**No fixes expected for Phase 1** unless the dotfiles config has structural issues beyond the stale assignment. The prebuild port support fix should handle the auto-injection. If the fix has not been implemented yet, Phase 1 should document this as a blocker for Phase 2.

#### 1.4 Pre-flight check: verify prebuild port support is implemented

```bash
# Check that autoInjectPortTemplates handles prebuildFeatures
cd /var/home/mjr/code/weft/lace
grep -n 'injectForPrebuildBlock\|prebuildFeatures' packages/lace/src/lib/template-resolver.ts | head -20

# Run the test suite to confirm
npx vitest run packages/lace/src/lib/__tests__/template-resolver.test.ts 2>&1 | tail -20
```

If the prebuild port support is not yet implemented, this is a hard blocker. The dotfiles devcontainer cannot get port bindings without it. Document the blocker and stop.

### Phase 2: Build and launch verification

**Goal:** Run `lace up` for each project and verify the generated configs and port mappings are correct.

#### 2.1 Lace container: lace up

```bash
cd /var/home/mjr/code/weft/lace

# Clean any stale .lace directory
ls -la .lace/ 2>/dev/null || echo "No .lace directory (expected for first run)"

# Run lace up (skip devcontainer up to inspect generated config first)
npx lace up --skip-devcontainer-up 2>&1

# Inspect generated config
cat .lace/devcontainer.json | python3 -m json.tool

# Verify port assignment
cat .lace/port-assignments.json | python3 -m json.tool
# Expected: wezterm-server/hostSshPort assigned a port in 22425-22499

# Verify appPort in generated config
cat .lace/devcontainer.json | python3 -c "
import sys, json
config = json.load(sys.stdin)
print('appPort:', config.get('appPort', 'NOT SET'))
print('forwardPorts:', config.get('forwardPorts', 'NOT SET'))
print('portsAttributes:', json.dumps(config.get('portsAttributes', {}), indent=2))
"
# Expected: appPort: ["22425:2222"] (or similar), forwardPorts: [22425], portsAttributes with label
```

**Verification criteria for lace:**
- [ ] `port-assignments.json` has `wezterm-server/hostSshPort` with port in 22425-22499
- [ ] Generated `devcontainer.json` has `appPort` with asymmetric mapping (e.g., `"22425:2222"`)
- [ ] Generated config has `forwardPorts` matching the allocated port
- [ ] Generated config has `portsAttributes` with the `wezterm ssh` label

#### 2.2 Lace container: full lace up with devcontainer up

```bash
cd /var/home/mjr/code/weft/lace

# Full lace up (includes devcontainer up)
npx lace up 2>&1

# Capture docker ps output
docker ps --filter "label=devcontainer.local_folder" --format 'table {{.Names}}\t{{.Ports}}\t{{.Label "devcontainer.local_folder"}}' 2>&1
# Expected: lace container with port mapping like 0.0.0.0:22425->2222/tcp

# Verify specific port mapping
docker ps --filter "label=devcontainer.local_folder" --format '{{.Ports}}' | grep -oE '[0-9]+->2222/tcp'
# Expected: 22425->2222/tcp (or whatever port was assigned)
```

#### 2.3 Dotfiles container: lace up

```bash
cd /home/mjr/code/personal/dotfiles

# Inspect current .lace state
cat .lace/port-assignments.json 2>/dev/null
cat .lace/devcontainer.json 2>/dev/null

# Run lace up
npx lace up 2>&1

# Inspect generated config
cat .lace/devcontainer.json | python3 -m json.tool

# Verify port assignment (should be fresh allocation for hostSshPort)
cat .lace/port-assignments.json | python3 -m json.tool
# Expected: wezterm-server/hostSshPort with port in 22425-22499

# Verify appPort was auto-injected (asymmetric prebuild injection)
cat .lace/devcontainer.json | python3 -c "
import sys, json
config = json.load(sys.stdin)
print('appPort:', config.get('appPort', 'NOT SET'))
print('forwardPorts:', config.get('forwardPorts', 'NOT SET'))
"
# Expected: appPort with asymmetric mapping like ["22426:2222"]
```

**Verification criteria for dotfiles:**
- [ ] `port-assignments.json` has `wezterm-server/hostSshPort` (new label, not old `sshPort`)
- [ ] Generated `devcontainer.json` has `appPort` with asymmetric mapping
- [ ] Old `wezterm-server/sshPort` assignment is either replaced or coexists harmlessly
- [ ] `forwardPorts` and `portsAttributes` present in generated config

#### 2.4 Docker port mapping verification (both containers)

```bash
# Full docker ps with port details
docker ps --filter "label=devcontainer.local_folder" \
  --format 'table {{.ID}}\t{{.Names}}\t{{.Ports}}\t{{.Label "devcontainer.local_folder"}}' 2>&1

# Per-container port verification
for container_id in $(docker ps --filter "label=devcontainer.local_folder" -q); do
  folder=$(docker inspect "$container_id" --format '{{index .Config.Labels "devcontainer.local_folder"}}')
  name=$(basename "$folder")
  ports=$(docker port "$container_id" 2222/tcp 2>/dev/null || echo "NO MAPPING")
  echo "$name: $ports (folder: $folder)"
done
# Expected:
#   lace: 0.0.0.0:22425 (folder: /var/home/mjr/code/weft/lace)
#   dotfiles: 0.0.0.0:22426 (folder: /home/mjr/code/personal/dotfiles)

# Verify ports match port-assignments.json
echo "=== Lace port assignment ==="
cat /var/home/mjr/code/weft/lace/.lace/port-assignments.json
echo "=== Dotfiles port assignment ==="
cat /home/mjr/code/personal/dotfiles/.lace/port-assignments.json
```

### Phase 3: Discovery verification

**Goal:** Verify `lace-discover` finds both containers with correct metadata.

#### 3.1 Text output format

```bash
/var/home/mjr/code/weft/lace/bin/lace-discover
# Expected output (two lines, one per container):
#   lace:22425:node:/var/home/mjr/code/weft/lace
#   dotfiles:22426:vscode:/home/mjr/code/personal/dotfiles
# (or similar ports)
```

**Verification criteria:**
- [ ] Both containers appear
- [ ] Port numbers match port-assignments.json values
- [ ] User is `node` for lace, `vscode` for dotfiles
- [ ] Paths match the workspace folder labels

#### 3.2 JSON output format

```bash
/var/home/mjr/code/weft/lace/bin/lace-discover --json | python3 -m json.tool
# Expected: JSON array with two objects, each having name, port, user, path, container_id
```

#### 3.3 Edge case: single container running

```bash
# Stop the dotfiles container
docker stop $(docker ps --filter "label=devcontainer.local_folder=/home/mjr/code/personal/dotfiles" -q) 2>/dev/null

# Discovery should find only lace
/var/home/mjr/code/weft/lace/bin/lace-discover
# Expected: single line with lace

# Restart dotfiles
cd /home/mjr/code/personal/dotfiles && npx lace up 2>&1
```

#### 3.4 Discovery user detection

```bash
# Verify lace-discover detects the correct user for each container
for container_id in $(docker ps --filter "label=devcontainer.local_folder" -q); do
  folder=$(docker inspect "$container_id" --format '{{index .Config.Labels "devcontainer.local_folder"}}')
  user=$(docker inspect "$container_id" --format '{{.Config.User}}')
  echo "$(basename "$folder"): Config.User='$user'"
done
# Expected:
#   lace: Config.User='node' (or empty, in which case lace-discover defaults to 'node')
#   dotfiles: Config.User='vscode' (or empty)
```

> NOTE: `lace-discover` defaults to `node` when the Docker user is empty or `root`. For the dotfiles container (base:ubuntu image), the user should be `vscode`. If Docker reports an empty user, `lace-discover` will incorrectly default to `node`. This is a known limitation; the lace.wezterm plugin handles user override separately via `docker inspect`.

### Phase 4: wez-into CLI verification

**Goal:** Test every `wez-into` subcommand against the live containers.

#### 4.1 Pre-flight: verify wez-into and lace-discover are accessible

```bash
which wez-into || echo "NOT ON PATH"
which lace-discover || echo "NOT ON PATH"

# If not on PATH, test via direct invocation
/var/home/mjr/code/weft/lace/bin/wez-into --help
/var/home/mjr/code/weft/lace/bin/lace-discover --help
```

#### 4.2 --list subcommand

```bash
/var/home/mjr/code/weft/lace/bin/wez-into --list
# Expected: two lines:
#   lace
#   dotfiles
```

#### 4.3 --status subcommand

```bash
/var/home/mjr/code/weft/lace/bin/wez-into --status
# Expected: formatted table like:
#   PROJECT              PORT     USER       PATH
#   -------              ----     ----       ----
#   lace                 22425    node       /var/home/mjr/code/weft/lace
#   dotfiles             22426    vscode     /home/mjr/code/personal/dotfiles
```

#### 4.4 --dry-run subcommand

```bash
/var/home/mjr/code/weft/lace/bin/wez-into --dry-run lace
# Expected: wezterm connect lace:22425 --workspace lace

/var/home/mjr/code/weft/lace/bin/wez-into --dry-run dotfiles
# Expected: wezterm connect lace:22426 --workspace dotfiles
```

**Verification criteria:**
- [ ] Domain format is `lace:<port>` (matching lace.wezterm plugin's pre-registered SSH domains)
- [ ] Port matches the allocated port from port-assignments.json
- [ ] Workspace name matches the project directory basename

#### 4.5 Project not found error

```bash
/var/home/mjr/code/weft/lace/bin/wez-into --dry-run nonexistent 2>&1
# Expected: error message with "project 'nonexistent' not found" and list of running projects
echo "Exit code: $?"
# Expected: 1
```

#### 4.6 No containers running

```bash
# Stop all devcontainers
docker ps --filter "label=devcontainer.local_folder" -q | xargs -r docker stop

# Test wez-into with no containers
/var/home/mjr/code/weft/lace/bin/wez-into --list 2>&1
# Expected: empty output

/var/home/mjr/code/weft/lace/bin/wez-into 2>&1
# Expected: error "no running devcontainers found"

# Restart containers for subsequent phases
cd /var/home/mjr/code/weft/lace && npx lace up 2>&1
cd /home/mjr/code/personal/dotfiles && npx lace up 2>&1
```

#### 4.7 SSH connectivity test (pre-wezterm)

Before testing the full WezTerm connection, verify raw SSH connectivity:

```bash
# Get allocated ports
LACE_PORT=$(cat /var/home/mjr/code/weft/lace/.lace/port-assignments.json | python3 -c "import sys,json; print(json.load(sys.stdin)['assignments']['wezterm-server/hostSshPort']['port'])")
DOTFILES_PORT=$(cat /home/mjr/code/personal/dotfiles/.lace/port-assignments.json | python3 -c "import sys,json; print(json.load(sys.stdin)['assignments']['wezterm-server/hostSshPort']['port'])")

echo "Lace port: $LACE_PORT, Dotfiles port: $DOTFILES_PORT"

# Test SSH to lace container
ssh -p "$LACE_PORT" -i ~/.ssh/lace_devcontainer -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 node@localhost echo "SSH to lace OK"

# Test SSH to dotfiles container
ssh -p "$DOTFILES_PORT" -i ~/.ssh/lace_devcontainer -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 vscode@localhost echo "SSH to dotfiles OK"
```

**Verification criteria:**
- [ ] SSH key `~/.ssh/lace_devcontainer` exists
- [ ] SSH connects to lace container on allocated port
- [ ] SSH connects to dotfiles container on allocated port
- [ ] Correct user is used for each container (`node` for lace, `vscode` for dotfiles)

### Phase 5: End-to-end WezTerm connection

**Goal:** Actually connect via `wez-into` and verify the remote session works.

#### 5.1 Verify lace.wezterm plugin domains

```bash
# Check that the plugin pre-registers SSH domains covering our allocated ports
wezterm show-keys 2>/dev/null | head -5  # Just confirm wezterm is running

# The lace.wezterm plugin registers domains lace:22425 through lace:22499.
# Verify the allocated ports fall in this range:
echo "Lace port $LACE_PORT in range? $([ $LACE_PORT -ge 22425 ] && [ $LACE_PORT -le 22499 ] && echo YES || echo NO)"
echo "Dotfiles port $DOTFILES_PORT in range? $([ $DOTFILES_PORT -ge 22425 ] && [ $DOTFILES_PORT -le 22499 ] && echo YES || echo NO)"
```

#### 5.2 Verify wezterm-mux-server inside containers

```bash
# Check mux server in lace container
LACE_CID=$(docker ps --filter "label=devcontainer.local_folder=/var/home/mjr/code/weft/lace" -q | head -1)
docker exec "$LACE_CID" pgrep -a wezterm-mux || echo "MUX NOT RUNNING in lace"

# Check mux server in dotfiles container
DOTFILES_CID=$(docker ps --filter "label=devcontainer.local_folder=/home/mjr/code/personal/dotfiles" -q | head -1)
docker exec "$DOTFILES_CID" pgrep -a wezterm-mux || echo "MUX NOT RUNNING in dotfiles"
```

If the mux server is not running, the `postStartCommand` may not have fired. Manually start it:

```bash
docker exec -u node "$LACE_CID" sh -c "wezterm-mux-server --daemonize 2>/dev/null || true"
docker exec -u vscode "$DOTFILES_CID" sh -c "wezterm-mux-server --daemonize 2>/dev/null || true"
```

#### 5.3 Connect via wez-into lace

```bash
# Dry-run first to confirm command
/var/home/mjr/code/weft/lace/bin/wez-into --dry-run lace

# Actually connect (this exec's into wezterm connect, opening a new WezTerm window)
# Manual verification: run this in a terminal and confirm a WezTerm window opens
/var/home/mjr/code/weft/lace/bin/wez-into lace
```

**Manual verification checklist for lace connection:**
- [ ] WezTerm window opens
- [ ] Shell prompt appears inside the container
- [ ] `whoami` returns `node`
- [ ] `pwd` shows the workspace directory (e.g., `/workspace/main`)
- [ ] `hostname` or container environment confirms it is the lace container
- [ ] Can run commands (e.g., `ls`, `git status`)

#### 5.4 Connect via wez-into dotfiles

```bash
/var/home/mjr/code/weft/lace/bin/wez-into --dry-run dotfiles
/var/home/mjr/code/weft/lace/bin/wez-into dotfiles
```

**Manual verification checklist for dotfiles connection:**
- [ ] WezTerm window opens
- [ ] Shell prompt appears inside the container
- [ ] `whoami` returns `vscode`
- [ ] `pwd` shows the workspace directory
- [ ] Can run commands

#### 5.5 Interactive picker test

```bash
# With both containers running, invoke without arguments
# If fzf is installed, should show fzf picker with both projects
# If not, should show bash select menu
/var/home/mjr/code/weft/lace/bin/wez-into
```

### Phase 6: Bug fixes and patches

**Goal:** Fix any issues discovered in Phases 1-5 and document all changes.

This phase is reactive -- it addresses whatever breaks during testing. Based on the current state analysis, the following issues are anticipated:

#### 6.1 Anticipated: dotfiles port-assignments.json stale label

**Symptom:** After `lace up`, the dotfiles `port-assignments.json` may contain both the old `wezterm-server/sshPort` and new `wezterm-server/hostSshPort` entries.

**Fix:** No code change needed. The allocator creates a new assignment for the new label. The old entry is harmless dead weight. Optionally clean it up by deleting and re-running `lace up`:

```bash
rm /home/mjr/code/personal/dotfiles/.lace/port-assignments.json
cd /home/mjr/code/personal/dotfiles && npx lace up 2>&1
```

#### 6.2 Anticipated: lace-discover user detection for dotfiles

**Symptom:** `lace-discover` may report `node` for the dotfiles container instead of `vscode` if Docker reports an empty user.

**Fix:** If confirmed, patch `lace-discover` to use `docker inspect` more robustly. The current fallback (`[[ -z "$user" || "$user" == "root" ]] && user="node"`) is lace-centric. A more correct default would be to check the container image's default user.

> NOTE: This is a known architectural limitation. The lace.wezterm plugin handles user detection separately and correctly via `docker inspect`. The `lace-discover` user field is informational for `wez-into --status` display but is NOT used for the actual SSH connection (the plugin handles that).

#### 6.3 Anticipated: prebuild port support not yet implemented

**Symptom:** `lace up` in the dotfiles repo produces zero port allocations because `autoInjectPortTemplates` does not scan `prebuildFeatures`.

**Severity:** Hard blocker for dotfiles integration.

**Fix:** Implement the prebuild features port support per the [proposal](2026-02-09-prebuild-features-port-support.md). This is out of scope for this proposal if it has not been implemented yet -- document it as a prerequisite and test the lace container only.

#### 6.4 Potential: wez-into interactive picker with single project

There is a subtle bug in `wez-into`: when exactly one project is found, the script calls `do_connect` but does NOT `exit` afterward (the `exec` in `do_connect` handles termination when actually connecting, but in `--dry-run` mode the `exit 0` inside `do_connect` handles it). However, if the single-project code path does NOT have `--dry-run` active, `do_connect` calls `exec wezterm connect ...` which replaces the process. This is correct. No bug here, but verify during testing.

#### 6.5 Potential: wez-into --dry-run requires --dry-run before project name

The argument parser processes flags and positional arguments in order. `wez-into --dry-run lace` works, but `wez-into lace --dry-run` may not work correctly because `lace` is consumed as the PROJECT before `--dry-run` is seen. The parser loop continues, so `--dry-run` IS still set, but the action dispatch happens based on `$ACTION` being empty (no `--list`/`--status`/`--help`), falling through to the project connection code. Since `DRY_RUN=true` is a global, `do_connect` still picks it up. This should work, but verify.

```bash
# Test both orderings
/var/home/mjr/code/weft/lace/bin/wez-into --dry-run lace
/var/home/mjr/code/weft/lace/bin/wez-into lace --dry-run
# Both should produce the same output
```

## Important Design Decisions

### D1: Test the pipeline bottom-up, not top-down

**Decision:** Verify each layer independently (config -> lace up -> docker -> discover -> wez-into -> wezterm) before testing the full stack.

**Why:** A top-down test (`wez-into lace` fails) gives one error message that could be caused by any of six layers. Bottom-up testing isolates failures to specific layers and makes the devlog useful as a diagnostic reference for future issues. When `wez-into` fails, the devlog will show exactly which layer broke and what the expected vs actual output was at each layer.

### D2: Destroy and recreate containers rather than patching running ones

**Decision:** Treat `lace up` as the authoritative way to create containers. Do not manually fix running containers' port mappings.

**Why:** Docker port mappings are set at container creation time and cannot be changed on a running container. The only way to get correct port mappings is to stop the container and run `lace up` (which invokes `devcontainer up` with the extended config). Manually fixing containers would test a state that `lace up` cannot reproduce.

### D3: Capture all command output in the devlog

**Decision:** Every verification step records its full command output (stdout, stderr, exit code) in the devlog.

**Why:** The devlog serves as evidence that the pipeline works end-to-end. It also serves as a reference for debugging future regressions -- if `wez-into` stops working, the devlog shows what correct output looks like at each layer. Without captured output, "it works" is an unverifiable claim.

### D4: Test both containers even if one blocks

**Decision:** If the dotfiles container blocks (e.g., prebuild port support not implemented), still test the lace container through the full pipeline.

**Why:** The lace container uses the simpler path (wezterm-server in `features` with explicit `appPort` template). Testing it validates the core pipeline. The dotfiles container tests the harder path (prebuild auto-injection). Getting one working end-to-end is valuable even if the other is blocked.

### D5: Do not modify the lace.wezterm plugin

**Decision:** The plugin is out of scope for this proposal. If the plugin's SSH domains do not cover the allocated ports, document the issue but do not fix it here.

**Why:** The plugin pre-registers domains for ports 22425-22499. As long as the allocated ports fall in this range (which they must, by the allocator's design), the plugin's domains will work. Plugin bugs are a separate workstream.

## Edge Cases / Challenging Scenarios

### E1: Port collision between lace and dotfiles

**Trigger:** Both containers are assigned the same port.

**Behavior:** The `PortAllocator` is per-project (reads from each project's `.lace/port-assignments.json`). Two projects could independently assign the same port (e.g., both get 22425). Docker will fail to start the second container with a port conflict error.

**Mitigation:** This is a known limitation of per-project allocation. The allocator scans for in-use ports before assigning, so if the first container is already running, the second allocation will skip its port. The risk is when both `lace up` commands run before either container starts. For this testing plan, run `lace up` for lace first, wait for it to start, then run for dotfiles.

### E2: SSH host key change after container recreation

**Trigger:** Recreating a container generates a new SSH host key. The old key is in `~/.ssh/known_hosts` for `[localhost]:22425`.

**Behavior:** SSH connection fails with "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"

**Mitigation:** The lace.wezterm plugin uses `StrictHostKeyChecking=accept-new` to auto-accept new keys. For raw SSH testing in Phase 4.7, use `-o StrictHostKeyChecking=accept-new`. If known_hosts has stale entries, remove them with `ssh-keygen -R "[localhost]:22425"`.

### E3: wezterm-mux-server not running after container start

**Trigger:** The `postStartCommand` may not fire reliably, or the mux server may crash.

**Behavior:** `wezterm connect lace:<port>` connects via SSH but fails to attach to a mux session.

**Mitigation:** Phase 5.2 explicitly checks for the mux server and provides a manual restart command. The mux server is required for `wezterm connect` (mux domain) but NOT for basic SSH. If the mux server consistently fails, fall back to testing with `wezterm ssh` instead.

### E4: /var/home/mjr vs /home/mjr path discrepancy

**Trigger:** The lace repo is at `/var/home/mjr/code/weft/lace` but some tools resolve the path as `/home/mjr/code/weft/lace` (if `/home/mjr` is a symlink to `/var/home/mjr`).

**Behavior:** `lace-discover` reports one path, `wez-into` matches by basename (not full path), so the discrepancy does not affect functionality. But the `--status` output and `docker inspect` label may show different paths depending on which form was used with `devcontainer up`.

**Mitigation:** Document the actual path shown by `docker inspect` and `lace-discover`. The basename-based matching in `wez-into` is resilient to this.

### E5: npx lace not available in dotfiles repo

**Trigger:** The dotfiles repo does not have `lace` as a dependency. `npx lace up` may fail or prompt to install.

**Behavior:** `npx lace up` may not work from the dotfiles directory if lace is not installed globally or in the dotfiles project.

**Mitigation:** Use the full path to the lace binary: `/var/home/mjr/code/weft/lace/packages/lace/bin/lace up` or install lace globally. Document which invocation method works.

## Verification Scorecard

The following checklist summarizes all verification criteria. Each item should be marked pass/fail in the devlog with captured evidence.

### Config Audit (Phase 1)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| C1 | Lace appPort uses `hostSshPort` template | `${lace.port(wezterm-server/hostSshPort)}:2222` | |
| C2 | Lace wezterm-server in `features` block | True | |
| C3 | Lace `customizations.lace` section exists | True | |
| C4 | Dotfiles wezterm-server in `prebuildFeatures` | True | |
| C5 | Dotfiles has no explicit `appPort` | True (auto-injected) | |
| C6 | Prebuild port support is implemented | `injectForPrebuildBlock` exists | |

### Port Allocation (Phase 2)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| P1 | Lace `port-assignments.json` has `hostSshPort` | Port in 22425-22499 | |
| P2 | Lace generated config has asymmetric `appPort` | e.g., `"22425:2222"` | |
| P3 | Lace generated config has `forwardPorts` | e.g., `[22425]` | |
| P4 | Lace generated config has `portsAttributes` | Label: "wezterm ssh" | |
| P5 | Dotfiles `port-assignments.json` has `hostSshPort` | Port in 22425-22499 | |
| P6 | Dotfiles generated config has asymmetric `appPort` | e.g., `"22426:2222"` | |
| P7 | Docker shows lace container with correct port mapping | `XXXXX->2222/tcp` | |
| P8 | Docker shows dotfiles container with correct port mapping | `XXXXX->2222/tcp` | |
| P9 | No port collision between containers | Different host ports | |

### Discovery (Phase 3)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| D1 | `lace-discover` finds lace container | `lace:XXXXX:node:/path` | |
| D2 | `lace-discover` finds dotfiles container | `dotfiles:XXXXX:vscode:/path` | |
| D3 | `lace-discover --json` returns valid JSON | Array with 2 objects | |
| D4 | Discovery ports match port-assignments.json | Ports match | |
| D5 | Single-container discovery works | Only running container shown | |

### wez-into CLI (Phase 4)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| W1 | `--list` shows both projects | `lace\ndotfiles` | |
| W2 | `--status` shows formatted table | Aligned columns | |
| W3 | `--dry-run lace` prints correct command | `wezterm connect lace:XXXXX --workspace lace` | |
| W4 | `--dry-run dotfiles` prints correct command | `wezterm connect lace:XXXXX --workspace dotfiles` | |
| W5 | `--dry-run nonexistent` prints error | Exit code 1, helpful message | |
| W6 | `--help` prints usage | Full help text | |
| W7 | No containers: `--list` is empty | Empty output | |
| W8 | No containers: bare invocation shows error | "no running devcontainers found" | |
| W9 | Argument order: `lace --dry-run` works | Same as `--dry-run lace` | |

### SSH Connectivity (Phase 4.7)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| S1 | SSH key `~/.ssh/lace_devcontainer` exists | File exists | |
| S2 | SSH to lace container succeeds | "SSH to lace OK" | |
| S3 | SSH to dotfiles container succeeds | "SSH to dotfiles OK" | |

### WezTerm Connection (Phase 5)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| T1 | Allocated ports in plugin domain range | 22425-22499 | |
| T2 | wezterm-mux-server running in lace container | Process found | |
| T3 | wezterm-mux-server running in dotfiles container | Process found | |
| T4 | `wez-into lace` opens WezTerm window | Window opens, shell prompt | |
| T5 | Lace session: correct user | `whoami` = `node` | |
| T6 | Lace session: correct cwd | `/workspace/main` or similar | |
| T7 | `wez-into dotfiles` opens WezTerm window | Window opens, shell prompt | |
| T8 | Dotfiles session: correct user | `whoami` = `vscode` | |

## Implementation Phases

### Phase 1: Config audit and alignment

**Scope:** Read and verify both devcontainer configs. Check for the hostSshPort rename. Verify prebuild port support is implemented. No code changes unless a config fix is needed.

**Acceptance criteria:**
- All C1-C6 scorecard items documented with evidence
- Any config fixes applied and committed
- Blockers (e.g., prebuild port support not implemented) documented

**Constraints:**
- Do NOT modify `lace up` pipeline code in this phase
- Do NOT modify `lace-discover` or `wez-into` in this phase

### Phase 2: Build and launch

**Scope:** Run `lace up` for both projects. Verify generated configs and Docker port mappings.

**Dependencies:** Phase 1 (configs must be correct)

**Acceptance criteria:**
- All P1-P9 scorecard items documented with evidence
- Both containers running with correct port mappings
- No port collisions

**Constraints:**
- Run lace `lace up` first, wait for container start, then dotfiles `lace up`
- Do NOT manually create port mappings

### Phase 3: Discovery verification

**Scope:** Run `lace-discover` and verify output. Test edge cases.

**Dependencies:** Phase 2 (containers must be running)

**Acceptance criteria:**
- All D1-D5 scorecard items documented with evidence
- Discovery output matches Docker reality

**Constraints:**
- Do NOT modify `lace-discover` unless a bug is found (document bugs, fix in Phase 6)

### Phase 4: wez-into CLI and SSH verification

**Scope:** Test all `wez-into` subcommands. Test raw SSH connectivity.

**Dependencies:** Phase 3 (discovery must work)

**Acceptance criteria:**
- All W1-W9 and S1-S3 scorecard items documented with evidence
- Any `wez-into` bugs documented for Phase 6

**Constraints:**
- Use `--dry-run` before actual connections
- Test SSH independently before WezTerm

### Phase 5: End-to-end WezTerm connection

**Scope:** Actually connect via `wez-into` and verify the remote sessions.

**Dependencies:** Phase 4 (SSH must work)

**Acceptance criteria:**
- All T1-T8 scorecard items documented with evidence
- Both connections produce a working remote shell

**Constraints:**
- Requires interactive terminal access (cannot be fully automated)
- Do NOT modify the lace.wezterm plugin

### Phase 6: Bug fixes and patches

**Scope:** Fix any issues found in Phases 1-5. Patch `wez-into`, configs, or `lace-discover` as needed. Commit all changes.

**Dependencies:** Phases 1-5 (must know what needs fixing)

**Acceptance criteria:**
- All bugs documented with root cause and fix
- Patches committed to the appropriate repos (lace, dotfiles)
- Re-run verification for affected scorecard items to confirm fixes
- Devlog includes before/after evidence for each fix

**Constraints:**
- Do NOT change the port allocation pipeline (`up.ts`, `template-resolver.ts`) -- if the prebuild port support is missing, that is a separate implementation task, not part of this testing work
- Do NOT change the lace.wezterm plugin
- Patches to `wez-into`, `lace-discover`, and devcontainer configs are in scope

## Open Questions

1. **Is prebuild features port support implemented?** The [proposal](2026-02-09-prebuild-features-port-support.md) is accepted but the implementation status is unclear. If not implemented, the dotfiles container cannot be lacified until it is. Phase 1.4 checks for this.

2. **How to invoke lace from the dotfiles repo?** The dotfiles repo does not have lace as a dependency. Options: (a) install lace globally, (b) use `npx -p @weftwiseink/lace lace up`, (c) use the absolute path to the lace binary in the lace repo. The testing plan should document which method works.

3. **Should stale port-assignments.json be cleaned up?** The dotfiles `.lace/port-assignments.json` has a `wezterm-server/sshPort` entry that will never be used again after the rename. It is harmless but confusing. Should Phase 6 delete it, or let it accumulate?
