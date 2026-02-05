---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T20:00:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: live
status: review_ready  # R1 revisions applied
tags: [dotfiles, devcontainer, wezterm, launcher, port-range, discovery, lace-ecosystem, migration, elimination]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-05T20:30:00-08:00
  round: 1
revisions:
  - at: 2026-02-05T21:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Resolved username mismatch: added Design Decision 6 specifying remoteUser override to 'node' in dotfiles devcontainer"
      - "Corrected SSH readiness timing claim: WezTerm does not retry internally; acknowledged as known ergonomic regression with mitigation"
      - "Tightened known_hosts story: specified StrictHostKeyChecking=accept-new in plugin ssh_option as in-scope prerequisite"
      - "Softened BLUF known_hosts claim to match edge case analysis"
      - "Acknowledged two-step workflow as deliberate ergonomic tradeoff in Decision 4"
      - "Added negative test for connecting before SSH is ready"
      - "Added Phase 3 cleanup of old static WezTerm SSH domain and shell aliases referencing port 2223"
      - "Promoted Open Question 4 (username) to resolved Design Decision"
supersedes:
  - cdocs/proposals/2026-02-05-dotfiles-bin-launcher-migration.md
related_to:
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
  - cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
  - cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
  - cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
---

# Eliminate Dotfiles Workspace Launcher Script

> BLUF: The dotfiles project's 374-line `bin/open-dotfiles-workspace` script can be eliminated entirely -- not parameterized, not refactored, but deleted -- by migrating the dotfiles devcontainer to the lace port-range model (22425-22499). The lace ecosystem already provides every capability the launcher script implements: the [lace.wezterm plugin](/home/mjr/code/weft/lace.wezterm/plugin/init.lua) pre-registers SSH domains for ports 22425-22499 and provides a project picker, [`lace-discover`](/var/home/mjr/code/weft/lace/bin/lace-discover) finds running devcontainers via Docker labels, and [`wez-lace-into`](/var/home/mjr/code/weft/lace/bin/wez-lace-into) provides interactive project selection. The only prerequisite is changing the dotfiles devcontainer's SSH port from the fixed `2223` to a port in the lace range and using the same SSH key. The end-state workflow becomes: `devcontainer up` (or `lace up`) to start the container, then the wezterm plugin auto-discovers it via Docker and the user connects through the project picker or `wez-lace-into dotfiles`. No wrapper script, no SSH polling, no mux server startup logic on the host side. Known_hosts management is handled by the plugin's SSH options (`StrictHostKeyChecking=accept-new`), requiring at most a one-time key removal after container rebuilds.
>
> **Key insight:** The [superseded proposal](2026-02-05-dotfiles-bin-launcher-migration.md) asked "how do we deduplicate the launcher?" The correct question is "why does dotfiles need a launcher at all?" The answer: it does not, because the lace ecosystem already solves all five problems the launcher addresses. The launcher was written before the port-range discovery system existed.

## Objective

Eliminate `dotfiles/bin/open-dotfiles-workspace` entirely by making the dotfiles devcontainer a first-class participant in the lace ecosystem, specifically:

1. **Delete the 374-line launcher script** -- not replace it with a wrapper, not parameterize it, but remove it
2. **Adopt the lace port-range model** so the dotfiles devcontainer is auto-discoverable by the lace.wezterm plugin
3. **Unify the SSH key** so both projects use `~/.ssh/lace_devcontainer`, simplifying host-side configuration
4. **Leverage existing infrastructure** -- every feature the launcher provides is already implemented in the lace ecosystem

## Background

### What the Launcher Does (and Who Already Does It Better)

The `bin/open-dotfiles-workspace` script performs five tasks. Each has an existing solution in the lace ecosystem:

| Launcher Task | Lines | Lace Ecosystem Equivalent | How |
|---|---|---|---|
| 1. Run `devcontainer up` | ~80 | `devcontainer up` directly, or `lace up` | User runs it manually or via alias |
| 2. Poll for SSH readiness | ~30 | Not needed with two-step workflow | User starts container, waits for it to be ready, then connects; the few-second gap is handled by a brief wait or manual retry |
| 3. Start wezterm-mux-server | ~15 | `postStartCommand` in devcontainer.json | Already configured: `wezterm-mux-server --daemonize` |
| 4. Manage known_hosts | ~10 | lace.wezterm plugin's `ssh_option` config | Plugin configures SSH options per domain |
| 5. Open WezTerm window via `wezterm connect` | ~50 | `wez-lace-into` or lace.wezterm project picker | Docker-based discovery, then `wezterm connect lace:PORT` |

The launcher exists because the dotfiles devcontainer predates the port-range discovery system. When it was created, the only way to connect WezTerm to a devcontainer was through a fixed-port SSH domain with a manually configured WezTerm config. The lace ecosystem has since solved this generically.

### The Lace Ecosystem Components

**lace.wezterm plugin** ([`plugin/init.lua`](/home/mjr/code/weft/lace.wezterm/plugin/init.lua)):
- Pre-registers 75 SSH domains for ports 22425-22499 (format: `lace:PORT`)
- Provides a project picker that discovers running devcontainers via Docker CLI
- Configures SSH options (identity file, multiplexing mode) for all domains
- Already loaded in the user's WezTerm config

**`lace-discover`** ([`bin/lace-discover`](/var/home/mjr/code/weft/lace/bin/lace-discover)):
- Queries Docker for containers with `devcontainer.local_folder` label
- Filters for ports in 22425-22499 range mapped to internal port 2222
- Output format: `name:port:user:path`

**`wez-lace-into`** ([`bin/wez-lace-into`](/var/home/mjr/code/weft/lace/bin/wez-lace-into)):
- Interactive project picker (fzf or bash select)
- Direct connection: `wez-lace-into dotfiles`
- Delegates discovery to `lace-discover`
- Connects via `wezterm connect lace:PORT`

### Current Dotfiles Devcontainer Configuration

From [`dotfiles/.devcontainer/devcontainer.json`](/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json):

```json
"appPort": ["2223:2222"],
"mounts": [
  "source=${localEnv:HOME}/.ssh/dotfiles_devcontainer.pub,target=/home/vscode/.ssh/authorized_keys,type=bind,readonly"
],
"postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"
```

Key observations:
- Uses fixed port 2223 (outside the lace range 22425-22499)
- Uses a separate SSH key (`dotfiles_devcontainer` vs `lace_devcontainer`)
- Uses `vscode` user (vs lace's `node`) -- the lace.wezterm plugin registers all domains with `username = "node"`, so this must be aligned
- Already runs `wezterm-mux-server` via `postStartCommand` (mux server startup is already handled)

### Current Lace Devcontainer Configuration

From [`lace/.devcontainer/devcontainer.json`](/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json):

```json
"appPort": ["2222:2222"],
"mounts": [
  "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
],
"postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"
```

> NOTE: The lace devcontainer itself also uses a fixed port (2222), which is also outside the lace range. It has its own launcher script (`bin/open-lace-workspace`). Migrating lace's own devcontainer to the port-range model is a separate effort, but this proposal demonstrates the pattern using dotfiles first.

### Why Not Parameterize? (Superseded Approach)

The [superseded proposal](2026-02-05-dotfiles-bin-launcher-migration.md) proposed creating a generic `bin/open-workspace` script that reads project-specific configuration from `.lace/workspace.conf` files. While sound as an incremental improvement, it perpetuates the launcher paradigm: a script that orchestrates `devcontainer up` + SSH polling + mux server management + WezTerm connection. The lace ecosystem has already decomposed these concerns into independent, composable tools. Parameterizing the launcher would create a well-factored version of something that should not exist.

## Proposed Solution

### Architecture: No Script, Just Configuration

The solution is a configuration change, not a code change. The dotfiles devcontainer adopts the lace port-range convention, and the existing lace ecosystem tools handle everything else.

```
BEFORE:                                    AFTER:
dotfiles/                                  dotfiles/
  bin/                                       .devcontainer/
    open-dotfiles-workspace (374 lines)        devcontainer.json (updated port + key)
  .devcontainer/                             bin/
    devcontainer.json                          (open-dotfiles-workspace deleted)
```

### Changes to dotfiles devcontainer.json

Four changes to `devcontainer.json`:

**1. Port: 2223 -> 22426 (a port in the lace range)**

```json
// Before:
"appPort": ["2223:2222"],

// After:
"appPort": ["22426:2222"],
```

Port 22426 is chosen as the second port in the lace range (22425 is reserved for lace itself by convention, though no formal assignment exists). The specific port choice is arbitrary within 22425-22499; what matters is that it falls in the range that `lace-discover` scans and the lace.wezterm plugin pre-registers.

**2. SSH key: dotfiles_devcontainer -> lace_devcontainer**

```json
// Before:
"source=${localEnv:HOME}/.ssh/dotfiles_devcontainer.pub,target=/home/vscode/.ssh/authorized_keys,type=bind,readonly"

// After:
"source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
```

The lace.wezterm plugin configures all SSH domains with the `lace_devcontainer` key. Using the same key for dotfiles means no additional SSH configuration is needed. The mount target changes from `/home/vscode/` to `/home/node/` to match the `remoteUser` override (see change 3 below). The separate `dotfiles_devcontainer` key provided no security benefit (both keys are on the same host, accessing containers on the same host).

**3. Container user: override remoteUser to `node`**

```json
// Add to devcontainer.json:
"remoteUser": "node"
```

The lace.wezterm plugin registers all SSH domains with `username = "node"` (the plugin's default). The `lace:PORT` domains have a fixed username baked in at WezTerm config load time -- neither `wez-lace-into` nor the project picker can override it per-connection. The dotfiles devcontainer currently uses `vscode` as the default user (from the `base:ubuntu` image). To align with the lace ecosystem, the devcontainer must use `node` for SSH access. Adding `"remoteUser": "node"` ensures the container creates and configures the `node` user. The authorized_keys mount target must also change from `/home/vscode/.ssh/authorized_keys` to `/home/node/.ssh/authorized_keys`. See Decision 6 for the full rationale.

**4. No other changes needed**

- The `postStartCommand` already starts `wezterm-mux-server --daemonize` -- this is the correct behavior and matches lace's configuration.
- The `devcontainer.local_folder` label is set automatically by the devcontainer CLI, so `lace-discover` will find it.

### What Happens to Each Launcher Responsibility

**1. Running `devcontainer up`**: The user runs `devcontainer up --workspace-folder ~/code/personal/dotfiles` directly, or creates a shell alias. This is a one-liner, not worth a 374-line script.

**2. SSH readiness polling**: WezTerm does not retry SSH connections internally -- if the SSH server is not ready, `wezterm connect` will fail with a connection error. However, the two-step workflow (start container, then connect later) makes this a non-issue in practice: by the time the user switches to connecting, sshd is already running. In the rare case where the user connects immediately after `devcontainer up`, the connection attempt may fail once and the user retries after a few seconds. This is a deliberate ergonomic tradeoff -- the launcher's polling loop provided seamless single-command operation, but at the cost of 30 lines of orchestration code. The two-step workflow is simpler and more transparent.

**3. Starting wezterm-mux-server**: Already handled by `postStartCommand` in `devcontainer.json`. The launcher's mux-server check was a safety net for cases where `postStartCommand` failed silently -- this is an edge case that does not justify 374 lines of orchestration. If the mux server is not running, `wezterm connect` fails with a clear error message.

**4. Managing known_hosts**: The lace.wezterm plugin configures SSH options for each domain via the `ssh_option` table. As a prerequisite for this migration, the plugin should add `StrictHostKeyChecking = "accept-new"` to the domain registration. This accepts new host keys automatically (covering first-connection and post-rebuild scenarios) while still rejecting changed keys for previously-seen hosts. If a key does change (rebuild), the user runs `ssh-keygen -R "[localhost]:22426"` once -- a single command vs the launcher's automated cycle. This is a configuration concern, not a per-connection orchestration concern.

**5. Opening WezTerm window**: `wez-lace-into dotfiles` or the project picker (Ctrl+Shift+P). Both discover the container via Docker, find its port, and run `wezterm connect lace:22426`.

### The New Workflow

```
# Start the container (once, or after reboot):
devcontainer up --workspace-folder ~/code/personal/dotfiles

# Connect from WezTerm (any time after container is running):
# Option A: Project picker (Ctrl+Shift+P in WezTerm)
#   -> Shows "dotfiles (:22426) - /home/mjr/code/personal/dotfiles"
#   -> Select it
# Option B: CLI
wez-lace-into dotfiles
# Option C: Direct
wezterm connect lace:22426
```

### Optional: Shell Alias for Container Startup

For convenience, a shell alias can replace the "start container" step:

```bash
# In ~/.bashrc or equivalent:
alias dotfiles-up='devcontainer up --workspace-folder ~/code/personal/dotfiles'
```

This is zero lines of project-specific code in the dotfiles repository.

## Important Design Decisions

### Decision 1: Eliminate Rather Than Parameterize

**Decision:** Delete `bin/open-dotfiles-workspace` entirely rather than refactoring it into a wrapper around a generic lace launcher.

**Why:** The launcher script exists because the port-range discovery system did not exist when the dotfiles devcontainer was created. Every function the script performs is now handled by existing lace infrastructure. The superseded proposal's parameterization approach would create a well-maintained version of unnecessary code. The lace ecosystem's tools are independently useful (project picker, CLI discovery, WezTerm plugin) and already tested; wrapping them in another script adds complexity without value.

### Decision 2: Unify SSH Keys

**Decision:** Use `~/.ssh/lace_devcontainer` for both lace and dotfiles devcontainers, rather than maintaining separate keys.

**Why:** The lace.wezterm plugin hardcodes the SSH key path for all domains in the 22425-22499 range. Using a different key for dotfiles would require either: (a) modifying the plugin to support per-project keys (complexity), or (b) maintaining a separate SSH domain outside the plugin (defeats the purpose). Separate keys provided no security benefit -- both are stored on the same host, both access containers on the same host, and the containers themselves are development environments with no sensitive data beyond what is on the host. The `dotfiles_devcontainer` key can be deleted after migration.

### Decision 3: Static Port Assignment (22426) Rather Than Dynamic

**Decision:** Assign dotfiles a fixed port (22426) in `devcontainer.json` rather than implementing dynamic port allocation.

**Why:** The lace range has 75 ports for at most a handful of projects. Static assignment is simple, predictable, and debuggable. Dynamic allocation would require a port broker or race-condition handling. The [port-scanning discovery proposal](2026-02-04-port-scanning-wezterm-discovery.md) already anticipates static assignment within the range. Port conflicts are unlikely and immediately obvious when they occur (Docker refuses to bind).

### Decision 4: No Replacement Script At All

**Decision:** Provide no wrapper, no alias file, no replacement script in the dotfiles repository. The workflow is standard devcontainer CLI + existing lace tools.

**Why:** Adding any project-specific script -- even a one-liner -- creates maintenance surface area and implies the project has special needs. It does not. The dotfiles devcontainer is a standard devcontainer with an SSH port in the lace range. The lace ecosystem discovers and connects to it generically. If the user wants a convenience alias, that belongs in their shell config (which is, fittingly, managed by the dotfiles repo).

**Tradeoff acknowledged:** The current launcher provides a single-command workflow (`bin/open-dotfiles-workspace` does everything). The proposed replacement requires two steps: start the container, then connect. This is a deliberate tradeoff -- the two-step workflow is simpler, more transparent, and composes with the rest of the lace ecosystem, but it is slightly less convenient for the "cold start" case. For the common "reconnect to running container" case, it is a single command (`wez-lace-into dotfiles` or the project picker).

### Decision 6: Override Dotfiles Container User to `node`

**Decision:** Add `"remoteUser": "node"` to the dotfiles devcontainer.json and change the authorized_keys mount to `/home/node/.ssh/authorized_keys`.

**Why:** The lace.wezterm plugin registers all 75 SSH domains with a single username (defaulting to `"node"`). The username is baked into the SSH domain at WezTerm config load time and cannot be overridden per-connection by `wez-lace-into` or the project picker. The dotfiles container currently uses `vscode` (the default from `mcr.microsoft.com/devcontainers/base:ubuntu`). If the container uses `vscode` but WezTerm connects as `node`, the SSH connection will be rejected because `node`'s `authorized_keys` would not exist.

Three options were considered:
- **A. Change the container user to `node`** (chosen): Simple, aligns with lace convention, requires only `devcontainer.json` changes.
- **B. Modify the plugin to support per-port username overrides**: More general but requires plugin code changes and a configuration mechanism that does not yet exist.
- **C. Configure sshd in the container to accept any user**: Non-standard, fragile.

Option A is chosen because the dotfiles devcontainer has no dependency on the `vscode` username. The container uses a generic base image, and the only user-specific configuration is the authorized_keys mount path. Changing to `node` is a one-line addition to devcontainer.json.

### Decision 5: Migrate Dotfiles Before Lace

**Decision:** Migrate the dotfiles devcontainer to the port-range model first, even though lace's own devcontainer (port 2222) is also outside the range.

**Why:** Dotfiles is a simpler case: no custom Dockerfile, no worktree mounts, no build context. It is the ideal candidate for proving the pattern. Lace's migration is more complex (custom Dockerfile, workspace mount at `/workspace`, build args) and can follow once the pattern is validated. Additionally, migrating dotfiles first validates that the lace ecosystem handles external projects correctly -- if it only worked for lace itself, it would not be a general solution.

## Stories

### Developer Starts Dotfiles Container and Connects

Developer opens a terminal and runs:
```
devcontainer up --workspace-folder ~/code/personal/dotfiles
```
Container starts. SSH server binds to host port 22426. Mux server starts via `postStartCommand`.

Developer opens WezTerm, presses Ctrl+Shift+P (project picker). The picker shows:
```
[*] dotfiles (:22426) - /home/mjr/code/personal/dotfiles
```
Developer selects it. WezTerm connects via `lace:22426` SSH domain. Terminal opens inside the container.

### Developer Has Both Containers Running

Lace is on port 2222 (or 22425 after its own migration). Dotfiles is on port 22426. Developer runs `wez-lace-into --status`:
```
[*] dotfiles (:22426) - /home/mjr/code/personal/dotfiles
```

> NOTE: Lace on port 2222 would not appear in `wez-lace-into --status` because 2222 is outside the discovery range. This is expected until lace migrates to 22425. The developer can still connect to lace via `wezterm connect lace` (static domain) or via `bin/open-lace-workspace`.

### Developer Forgets to Start the Container

Developer runs `wez-lace-into dotfiles`. No container is running. `lace-discover` returns nothing. `wez-lace-into` prints:
```
wez-lace-into: error: Project 'dotfiles' not found
```
Developer starts the container, then retries. This is the expected workflow -- the launcher's "start if not running" behavior was convenient but not essential.

### New Team Member Sets Up

Team member clones dotfiles, runs `devcontainer up --workspace-folder .`, loads their WezTerm config with the lace plugin. Container is auto-discovered. No scripts to learn, no special invocations.

## Edge Cases / Challenging Scenarios

### Port 22426 Already In Use

**Trigger:** Another application or devcontainer is bound to port 22426.

**Behavior:** `devcontainer up` fails with a port binding error from Docker. The error message clearly identifies the port conflict.

**Mitigation:** Choose a different port in the 22425-22499 range. The port choice is a single value in `devcontainer.json`. No other configuration depends on the specific port number -- discovery is by scanning the range.

### SSH Key Not Yet Created

**Trigger:** New machine setup; `~/.ssh/lace_devcontainer` does not exist.

**Behavior:** The SSH public key mount in `devcontainer.json` fails. `devcontainer up` reports a mount error.

**Mitigation:** Generate the key: `ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""`. This is a one-time setup, same as before. The old `dotfiles_devcontainer` key is no longer needed.

### Mux Server Fails to Start

**Trigger:** `postStartCommand` (`wezterm-mux-server --daemonize`) fails silently.

**Behavior:** `wezterm connect lace:22426` fails because the mux server is not running. WezTerm shows a connection error.

**Mitigation:** This is the same failure mode as the current launcher, except the launcher had a retry mechanism. In practice, the mux server starts reliably. If it fails, the user can diagnose with `devcontainer exec --workspace-folder ~/code/personal/dotfiles -- pgrep -a wezterm`. The retry logic in the launcher was 15 lines of safety net that masked the real problem (a broken `postStartCommand`).

### Known Hosts Rejection

**Trigger:** Container is rebuilt, SSH host key changes, WezTerm rejects the new key.

**Behavior:** WezTerm prompts for host key verification or fails to connect.

**Mitigation:** As a prerequisite for this migration, the lace.wezterm plugin should add `StrictHostKeyChecking = "accept-new"` to the `ssh_option` table in `setup_port_domains()`. This policy accepts keys for never-before-seen hosts automatically (first connection, new port) and only rejects keys that have changed for a previously-seen host. After a container rebuild (which changes the host key), the user runs `ssh-keygen -R "[localhost]:22426"` once, then the next connection accepts the new key automatically. This is a single manual command vs the launcher's automated cycle -- a minor ergonomic cost that does not justify 374 lines of orchestration. A future `lace up` enhancement could automate the key rotation as part of the rebuild flow.

### WezTerm Plugin Not Loaded

**Trigger:** User's WezTerm config does not include the lace.wezterm plugin.

**Behavior:** No `lace:22426` SSH domain exists. `wezterm connect lace:22426` fails with "unknown domain."

**Mitigation:** The lace plugin must be loaded in `~/.config/wezterm/wezterm.lua`. This is a prerequisite of the lace ecosystem in general, not specific to this migration. The user who previously used `bin/open-dotfiles-workspace` already had a WezTerm config with a static `dotfiles` SSH domain -- they need to replace that with the lace plugin (which they likely already have).

### Transition Period: Both Old and New Configs

**Trigger:** User has updated `devcontainer.json` but hasn't rebuilt the container.

**Behavior:** The old container is still running on port 2223. The new config will not take effect until the container is rebuilt.

**Mitigation:** Run `devcontainer up --workspace-folder ~/code/personal/dotfiles --remove-existing-container` to force a rebuild. This is standard devcontainer behavior.

### User Wants to Keep a Convenience Script

**Trigger:** User prefers having a `bin/open-dotfiles-workspace` command.

**Behavior:** Not applicable; the script is deleted.

**Mitigation:** Add a shell alias: `alias open-dotfiles-workspace='devcontainer up --workspace-folder ~/code/personal/dotfiles && wez-lace-into dotfiles'`. This is two commands chained, totaling one line. If many users want this pattern, it could become a generic `lace open <project>` CLI command in the future.

## Test Plan

### Phase 1: Devcontainer Configuration Change

| # | Scenario | Pass Criteria |
|---|----------|---------------|
| 1 | `devcontainer up` with new port | Container starts, port 22426 is bound on host |
| 2 | SSH connectivity | `ssh -p 22426 -i ~/.ssh/lace_devcontainer node@localhost true` succeeds |
| 3 | Mux server running | `docker exec <container> pgrep -f wezterm-mux-server` returns a PID |
| 4 | Docker label present | `docker ps --filter "label=devcontainer.local_folder=/home/mjr/code/personal/dotfiles"` shows the container |

### Phase 2: Lace Ecosystem Discovery

| # | Scenario | Pass Criteria |
|---|----------|---------------|
| 1 | `lace-discover` finds dotfiles | Output includes `dotfiles:22426:node:/home/mjr/code/personal/dotfiles` |
| 2 | `wez-lace-into --status` shows dotfiles | Output includes `[*] dotfiles (:22426)` |
| 3 | `wez-lace-into dotfiles` connects | WezTerm window opens, terminal is inside container |
| 4 | Project picker shows dotfiles | Ctrl+Shift+P in WezTerm lists dotfiles as an option |

### Phase 3: End-to-End Workflow

| # | Scenario | Pass Criteria |
|---|----------|---------------|
| 1 | Cold start -> connect | `devcontainer up` + `wez-lace-into dotfiles` results in working terminal |
| 2 | Rebuild -> reconnect | `devcontainer up --remove-existing-container` + reconnect works |
| 3 | Both containers running | Lace and dotfiles discoverable and connectable independently |
| 4 | `bin/open-dotfiles-workspace` deleted | Script does not exist; no broken references |
| 5 | Immediate connect after startup | Run `wez-lace-into dotfiles` within 2 seconds of `devcontainer up` completing; verify behavior (may fail with connection error; user retries after a few seconds) |
| 6 | Old WezTerm config cleanup | No static `dotfiles` SSH domain remains in WezTerm config; no shell aliases reference port 2223 |

### Phase 4: SSH Key Transition

| # | Scenario | Pass Criteria |
|---|----------|---------------|
| 1 | `lace_devcontainer` key works for dotfiles | SSH connection succeeds with the shared key |
| 2 | Old `dotfiles_devcontainer` key no longer needed | Container works without `~/.ssh/dotfiles_devcontainer` existing |

## Implementation Phases

### Phase 1: Update Dotfiles Devcontainer Configuration

**Scope:**
- Change `appPort` from `"2223:2222"` to `"22426:2222"` in `dotfiles/.devcontainer/devcontainer.json`
- Change SSH key mount from `dotfiles_devcontainer.pub` to `lace_devcontainer.pub`
- Change SSH key mount target from `/home/vscode/.ssh/authorized_keys` to `/home/node/.ssh/authorized_keys`
- Add `"remoteUser": "node"` to align with the lace.wezterm plugin's SSH domain username

**Prerequisite (lace.wezterm plugin):**
- Add `StrictHostKeyChecking = "accept-new"` to the `ssh_option` table in `setup_port_domains()` in `lace.wezterm/plugin/init.lua`

**Files modified (in dotfiles repo):**
- `.devcontainer/devcontainer.json`

**Files modified (in lace.wezterm repo):**
- `plugin/init.lua` (add `StrictHostKeyChecking` to `ssh_option`)

**Constraints:**
- Do not change the image, features, or non-SSH mounts in dotfiles `devcontainer.json`
- The plugin change is additive (no breaking changes to existing domains)

**Success criteria:**
- Container starts with port 22426 bound
- SSH works with `lace_devcontainer` key as user `node`
- `postStartCommand` starts the mux server as before
- Container user is `node` (verify with `whoami` inside container)

### Phase 2: Verify Lace Ecosystem Discovery

**Scope:**
- Rebuild the dotfiles devcontainer with the new config
- Verify `lace-discover` output includes the dotfiles container
- Verify `wez-lace-into dotfiles` connects successfully
- Verify the WezTerm project picker shows dotfiles

**Files modified:** None (verification only)

**Dependencies:** Phase 1 complete, container rebuilt.

**Success criteria:**
- `lace-discover` finds dotfiles with correct port, user, and path
- `wez-lace-into dotfiles` opens a working WezTerm terminal
- Project picker lists dotfiles

### Phase 3: Delete the Launcher Script and Clean Up

**Scope:**
- Delete `dotfiles/bin/open-dotfiles-workspace`
- Remove the old `dotfiles_devcontainer` SSH key if desired (optional, can keep for rollback)
- Update any documentation or shell aliases that reference the old script
- Remove the static `dotfiles` SSH domain from WezTerm config (`~/.config/wezterm/wezterm.lua`) if present (it is superseded by the plugin's `lace:22426` domain)
- Remove any shell aliases that reference port 2223 or `bin/open-dotfiles-workspace`
- Remove the old `[localhost]:2223` entry from `~/.ssh/known_hosts`

**Files modified (in dotfiles repo):**
- `bin/open-dotfiles-workspace` (deleted)

**Files potentially modified (in user config):**
- `~/.config/wezterm/wezterm.lua` (remove static `dotfiles` SSH domain if present)
- Shell config files (remove aliases referencing old script or port)
- `~/.ssh/known_hosts` (remove stale `[localhost]:2223` entry)

**Dependencies:** Phase 2 verified working.

**Constraints:**
- Verify no other scripts or configs reference `bin/open-dotfiles-workspace` before deleting
- Verify no cron jobs or system services invoke it

**Success criteria:**
- Script is deleted
- No broken references to old script, port 2223, or static `dotfiles` SSH domain
- `wez-lace-into dotfiles` continues to work as the replacement

### Phase 4 (Optional): Migrate Lace's Own Devcontainer

**Scope:**
- Change lace's `appPort` from `"2222:2222"` to `"22425:2222"` (first port in range)
- Update lace's SSH key mount if needed (already uses `lace_devcontainer`)
- Slim down or delete `bin/open-lace-workspace` once lace is in the discovery range
- Update `bin/open-workspace` if the superseded proposal's parameterization work was partially implemented

**Dependencies:** Phases 1-3 validated the pattern with dotfiles.

**Success criteria:**
- Lace container discovered by `lace-discover`
- `wez-lace-into lace` connects to lace
- Both lace and dotfiles visible in project picker simultaneously

> NOTE: This phase is listed for completeness. It is not required for the dotfiles migration and should be tracked separately.

## Open Questions

1. **Port assignment convention:** Should port 22425 be formally reserved for lace, or should it be first-come-first-served within the range? This proposal assumes 22425 for lace and 22426 for dotfiles, but no mechanism enforces this.

2. **Known hosts full automation:** This proposal specifies `StrictHostKeyChecking=accept-new` in the plugin, which handles first-connection automatically but still requires manual `ssh-keygen -R` after rebuilds. Should `lace up` or a devcontainer lifecycle hook fully automate the key rotation? This is a future enhancement, not a blocker for this migration.

3. **Container startup from WezTerm:** The launcher could start a stopped container. With this proposal, the container must already be running for discovery to work. Should `wez-lace-into` gain a `--start` flag that runs `devcontainer up` if the project is not found? This would be a separate enhancement to `wez-lace-into`.
