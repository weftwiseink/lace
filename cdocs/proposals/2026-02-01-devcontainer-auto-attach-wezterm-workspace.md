---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T12:00:00-08:00
task_list: lace/devcontainer-workflow
type: proposal
state: live
status: review_ready
tags: [devcontainer, wezterm, developer-experience, workflow-automation, automation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T19:00:00-08:00
  round: 3
revision_notes: "R1 revisions: fixed blocking readiness check issue (SSH-only poll instead of wezterm cli list), added Related Workstreams section, added Test Plan, clarified wezterm connect vs SwitchToWorkspace behavioral difference, fixed shell compatibility constraint, simplified retry to fixed interval, cross-referenced lace CLI proposal"
---

# Auto-Attach WezTerm Workspace After Devcontainer Setup

> BLUF: The devcontainer spec provides no host-side lifecycle hook that fires after the container is ready.
> The only host-side hook is `initializeCommand`, which runs *before* container creation.
> The `devcontainer up` CLI command is synchronous and returns JSON to stdout once the container is fully running.
> This proposal adds a `bin/open-lace-workspace` script that reads `devcontainer up` JSON from stdin (enabling `devcontainer up | bin/open-lace-workspace`), waits for SSH connectivity on port 2222, and invokes `wezterm connect lace` to open a new WezTerm window connected to the devcontainer's mux server.
> The script also supports standalone invocation (`bin/open-lace-workspace`) which runs `devcontainer up` internally.
> This replaces the current multi-step manual process (start container, wait, Leader+D) with a single command or pipeline.
> Related workstreams: the [wezterm-server feature](cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md) provides the mux server, the [lace CLI](cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md) is the long-term home for `devcontainer up` orchestration, and [SSH key auto-management](cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md) addresses the key prerequisite.

## Objective

Reduce the friction of entering the lace devcontainer development environment.
The current workflow requires: starting the devcontainer (via IDE or CLI), waiting for it to be ready, opening WezTerm, and pressing Leader+D to connect.
The goal is a single command that handles the full lifecycle from "container not running" to "WezTerm workspace connected to devcontainer."

## Background

### Current workflow

1. Developer starts the devcontainer (via VS Code "Reopen in Container" or `devcontainer up --workspace-folder .`).
2. The container builds (if needed), starts, and runs lifecycle hooks: `postCreateCommand` (git safe.directory), `postStartCommand` (wezterm-mux-server --daemonize).
3. Developer opens WezTerm (or switches to an existing window).
4. Developer presses Leader+D to connect to the lace SSH domain at `localhost:2222`.
5. WezTerm connects to the wezterm-mux-server running inside the container via SSH, spawning a workspace at `/workspace/main`.

Steps 1-2 and 3-4 are disconnected.
The developer must manually judge when the container is ready before attempting to connect (and the `postStartCommand` that starts wezterm-mux-server runs after sshd but is not surfaced to the host).

### Devcontainer lifecycle hooks

The devcontainer spec ([containers.dev/implementors/json_reference](https://containers.dev/implementors/json_reference/)) defines six lifecycle hooks in order:

| Hook | Runs on | When |
|------|---------|------|
| `initializeCommand` | **Host** | Before container creation |
| `onCreateCommand` | Container | First creation only |
| `updateContentCommand` | Container | After onCreateCommand |
| `postCreateCommand` | Container | First creation only |
| `postStartCommand` | Container | Every start |
| `postAttachCommand` | Container | Every tool attach |

`initializeCommand` is the only host-side hook, and it runs *before* the container exists, not after.
There is no `postReadyCommand` or equivalent that runs on the host after the container is fully set up.

### `devcontainer up` CLI behavior

The `devcontainer up` command ([github.com/devcontainers/cli](https://github.com/devcontainers/cli)) is synchronous.
It blocks until the container is running and all lifecycle hooks through `postStartCommand` have executed.
On success, it outputs JSON to stdout:

```json
{
  "outcome": "success",
  "containerId": "f0a055ff...",
  "remoteUser": "node",
  "remoteWorkspaceFolder": "/workspace/main"
}
```

This makes it suitable for both chaining (`devcontainer up ... && host-side-command`) and piping (`devcontainer up ... | host-side-command`).
The piped approach is preferable because the downstream script can parse the JSON output to validate the outcome and extract container metadata without a separate query.

### Related workstreams

- **wezterm-server feature** ([scaffold proposal](cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md)): Provides the `wezterm-mux-server` binary inside the container. Already published to GHCR and integrated into `devcontainer.json`.
- **lace CLI** ([proposal](cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md)): Defines `lace up` wrapping `devcontainer up` with prebuild and orchestration logic. The `open-lace-workspace` script in this proposal is a PoC that handles the "start container + connect terminal" workflow; the lace CLI is the long-term home for this functionality (e.g., `lace connect` or `lace workspace`).
- **SSH key auto-management** ([proposal](cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md)): Automates the `~/.ssh/lace_devcontainer` key pair lifecycle. Currently a manual prerequisite for this script.

### Existing wezterm connect infrastructure

The wezterm config (`config/wezterm/wezterm.lua`) defines an SSH domain `lace` that connects to `localhost:2222` (the devcontainer sshd port).
WezTerm can connect to this domain from the CLI via `wezterm connect lace`, which opens a new window connected to the remote mux server.
The Leader+D keybinding uses `SwitchToWorkspace`, which creates or switches to a named `lace` workspace *within* the current WezTerm process (different from `wezterm connect`, which always opens a new window).

## Proposed Solution

Add a `bin/open-lace-workspace` script that accepts `devcontainer up` JSON on stdin and connects WezTerm to the running container:

```
# Piped mode (preferred): devcontainer up feeds JSON into the script
devcontainer up --workspace-folder . | bin/open-lace-workspace

# Standalone mode: script runs devcontainer up internally
bin/open-lace-workspace
```

```
bin/open-lace-workspace
├── Read devcontainer up JSON (from stdin or by running it internally)
├── Validate outcome == "success"
├── Wait for SSH connectivity on port 2222
└── Open new WezTerm window connected to the lace SSH domain
```

### Script behavior

1. **Obtain container state**: If stdin is a pipe (detected via `[ -p /dev/stdin ]` or `[ ! -t 0 ]`), read and parse the `devcontainer up` JSON from stdin.
   If stdin is a terminal (no pipe), run `devcontainer up --workspace-folder <repo-root>` internally and capture its JSON output.
   In both cases, validate that the `outcome` field is `"success"` and exit with a diagnostic message if not.
   The piped mode enables composability: callers can pass flags to `devcontainer up` (e.g., `--build-no-cache`) without the script needing to know about them.

2. **Wait for SSH readiness**: After the container is confirmed running, sshd may not yet be accepting connections.
   The script polls SSH connectivity with `ssh -p 2222 -i ~/.ssh/lace_devcontainer -o ConnectTimeout=1 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null node@localhost true` in a retry loop (1-second intervals, max 15 attempts) to confirm sshd is up and authentication works.
   The readiness check verifies SSH only, not the mux server directly.
   `wezterm connect` handles mux server negotiation itself; if the mux server is not yet ready, `wezterm connect` will fail with a clear error, which is more informative than a generic timeout from the wrapper script.

3. **Spawn WezTerm window**: Run `wezterm connect lace` to open a new WezTerm window connected to the devcontainer's mux server.
   This always opens a new window (unlike Leader+D, which creates-or-switches within an existing WezTerm process).
   The window lands at `/workspace/main` (the default cwd for the lace SSH domain in `wezterm.lua`).
   If `wezterm connect` fails (e.g., mux server not running), the script captures the exit code and prints a diagnostic message.

### Script location and naming

`bin/open-lace-workspace` follows the existing convention (`bin/nvim` exists as a wrapper script).
The name is descriptive: it opens a lace workspace in WezTerm.

### Usage

```bash
# Piped mode: caller controls devcontainer up flags
devcontainer up --workspace-folder . | ./bin/open-lace-workspace

# Standalone mode: script runs devcontainer up internally
./bin/open-lace-workspace

# With rebuild
devcontainer up --workspace-folder . --build-no-cache | ./bin/open-lace-workspace
```

## Important Design Decisions

### Decision 1: Wrapper script over devcontainer.json hook

**Decision**: Use a host-side script rather than trying to embed this in `devcontainer.json`.

**Why**: The devcontainer spec has no host-side post-ready hook.
The `initializeCommand` runs before the container exists, not after.
`postAttachCommand` runs inside the container and is designed for IDE tool attachment, not host-side process spawning.
A wrapper script around `devcontainer up` is the spec-aligned approach for host-side post-ready actions, and it is what the devcontainer CLI documentation implicitly recommends for automation.

### Decision 2: Dual-mode stdin detection (pipe vs standalone)

**Decision**: The script detects whether stdin is a pipe and reads `devcontainer up` JSON from it, falling back to running `devcontainer up` internally when invoked standalone.

**Why**: The piped approach (`devcontainer up | bin/open-lace-workspace`) is more composable.
The caller controls `devcontainer up` flags (`--build-no-cache`, `--config`, etc.) without the script needing to proxy them.
The JSON is already on stdout; parsing it from stdin avoids running `devcontainer up` twice or needing a separate status query.
Standalone mode preserves the convenience of a single command for the common case.
The detection is standard bash: `[ ! -t 0 ]` or `[ -p /dev/stdin ]`.

### Decision 3: Use `wezterm connect` rather than `wezterm cli spawn`

**Decision**: Spawn a new WezTerm GUI window via `wezterm connect lace` rather than using `wezterm cli` to create a tab or pane in an existing window.

**Why**: `wezterm connect <domain>` creates a new window attached to the remote mux server, which gives the user a dedicated window for container work.
`wezterm cli spawn --domain-name lace` could add a tab to an existing window, but that requires a running WezTerm instance and mixes container and host contexts in the same window.
The `connect` approach works whether or not WezTerm is already running.

This differs from the Leader+D keybinding (`SwitchToWorkspace`), which creates-or-switches to a named workspace *within* the current WezTerm process.
`wezterm connect lace` always opens a new window, even if one is already connected to the same domain.
Running the script twice will produce two windows.

> NOTE: A future refinement could detect an existing lace-connected window and focus it rather than opening a new one.
> This is acceptable for a PoC.

### Decision 4: Poll SSH connectivity rather than sleeping

**Decision**: Use a retry loop checking SSH connectivity rather than a fixed `sleep` or polling the mux server directly.

**Why**: A fixed sleep is fragile: too short on slow builds, wastefully long on fast starts.
Polling SSH connectivity (`ssh ... node@localhost true`) confirms sshd is up and key-based auth works.
The mux server is not checked directly because `wezterm cli list` over SSH requires `XDG_RUNTIME_DIR` to locate the mux socket, and SSH sessions do not inherit environment variables from the `postStartCommand` that started the daemon.
Instead, `wezterm connect` handles mux server negotiation natively and produces clear error messages if the server is not ready.
The retry interval is a fixed 1-second poll (15 attempts max): exponential backoff adds complexity without benefit in a 15-second window where services either come up within a few seconds or something is wrong.

### Decision 5: Script uses `devcontainer up` rather than `docker compose` directly

**Decision**: Invoke `devcontainer up` rather than lower-level Docker commands.

**Why**: `devcontainer up` is the canonical CLI for managing devcontainers.
It handles the full lifecycle (build, create, start, hooks) and respects `devcontainer.json` configuration.
Using Docker commands directly would bypass lifecycle hooks and feature installation.
The `devcontainer` CLI is already a development dependency for this project.

## Stories

### Developer opens project for the first time today

Container is stopped.
Developer runs `devcontainer up --workspace-folder . | ./bin/open-lace-workspace` (or `./bin/open-lace-workspace` standalone).
`devcontainer up` starts the container, runs lifecycle hooks, outputs JSON.
Script reads the JSON, confirms success, waits for SSH readiness.
WezTerm window opens connected to `/workspace/main`.

### Developer's container is already running

Developer runs `./bin/open-lace-workspace`.
`devcontainer up` returns immediately (container already running).
Readiness check passes on first poll.
WezTerm window opens within a second.

### Container needs to be rebuilt (Dockerfile changed)

`devcontainer up` does not automatically rebuild when the Dockerfile changes if the image is already cached.
The developer must either pass `--build-no-cache` or remove the cached image.
When a rebuild does occur, the script simply waits for `devcontainer up` to complete.
Once the container is ready, the readiness check and WezTerm connection proceed normally.

### SSH key is missing

`devcontainer up` succeeds, but the readiness check fails (SSH auth rejected).
Script times out after 15 seconds and prints a diagnostic message pointing to the SSH key setup instructions.

### Port 2222 is already in use by another process

`devcontainer up` may fail if the port conflict prevents the container from binding.
The script surfaces the `devcontainer up` error output and exits.

## Edge Cases / Challenging Scenarios

### devcontainer CLI not installed

The script should check for `devcontainer` on `$PATH` and print a clear error message with installation instructions if missing.

### WezTerm not installed on the host

The script should check for `wezterm` on `$PATH` before attempting to connect.

### Container starts but wezterm-mux-server fails to daemonize

The `postStartCommand` (`wezterm-mux-server --daemonize 2>/dev/null || true`) currently swallows errors.
If the mux server fails to start, the SSH readiness check will still pass (sshd is independent), but `wezterm connect lace` will fail when it tries to negotiate with the mux server.
The script should capture the `wezterm connect` exit code and print a diagnostic message pointing to possible mux-server issues (e.g., "WezTerm connection failed -- check that wezterm-mux-server is running inside the container").
The `|| true` in `postStartCommand` prevents container startup from failing, but means the mux server issue is silent until connection time.

### Race between sshd startup and readiness check

The sshd feature starts the SSH daemon during feature installation, but there can be a brief window after `devcontainer up` returns where sshd is not yet accepting connections.
The retry loop handles this naturally.

### Multiple devcontainer configurations in the repo

The script assumes a single devcontainer configuration at `.devcontainer/devcontainer.json`.
If the repo later adds multiple configurations (e.g., `.devcontainer/frontend/devcontainer.json`), the script would need a `--config-path` flag.
Out of scope for this PoC.

## Test Plan

Manual testing covers the primary scenarios.
Automated testing is not practical for this script since it requires a running Docker daemon, devcontainer CLI, and WezTerm GUI.
This test plan is structured as a practical debugging guide: an implementer can work through each section independently to verify and troubleshoot the script.

### 1. Prerequisites verification

Before testing the script, confirm all host-side prerequisites are present.
Run each of these commands and verify the expected output:

```bash
# Verify devcontainer CLI is installed (standalone mode requires this)
which devcontainer
# Expected: /usr/local/bin/devcontainer or similar path
# If missing: npm install -g @devcontainers/cli

# Verify wezterm is installed on the host
which wezterm
# Expected: /usr/bin/wezterm or ~/.local/bin/wezterm or similar
# If missing: install from https://wezfurlong.org/wezterm/installation.html

# Verify SSH key pair exists
ls -la ~/.ssh/lace_devcontainer*
# Expected: two files:
#   ~/.ssh/lace_devcontainer       (private key)
#   ~/.ssh/lace_devcontainer.pub   (public key)
# If missing: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""

# Verify the wezterm config defines the "lace" SSH domain
grep -A5 'name = "lace"' config/wezterm/wezterm.lua
# Expected: ssh_domain block with remote_address = "localhost:2222"
```

### 2. Manual component testing

Test each stage of the script's pipeline independently before testing the script as a whole.

#### 2a. Testing `devcontainer up` in isolation

```bash
# From the repo root (the directory containing .devcontainer/)
devcontainer up --workspace-folder .
```

**Important**: `devcontainer up` mixes log/progress output with JSON on stdout.
The final line (or sometimes the only JSON-structured line) contains the result JSON.
Example raw output may look like:

```
[2026-02-01T20:00:00.000Z] Start: Run: docker compose ...
[2026-02-01T20:00:05.000Z] ...
{"outcome":"success","containerId":"f0a055ff...","remoteUser":"node","remoteWorkspaceFolder":"/workspace/main"}
```

To extract only the JSON line, you can pipe through a filter:

```bash
devcontainer up --workspace-folder . 2>/dev/null | grep '^\s*{'
# Or more robustly: find the line containing "outcome"
devcontainer up --workspace-folder . 2>/dev/null | grep '"outcome"'
```

Verify the JSON contains `"outcome":"success"`.
If it contains `"outcome":"error"`, the `"message"` field describes what went wrong.

Possible JSON shapes:

```json
// Success:
{"outcome":"success","containerId":"f0a055ff...","remoteUser":"node","remoteWorkspaceFolder":"/workspace/main"}

// Failure:
{"outcome":"error","message":"...","description":"..."}
```

#### 2b. Testing SSH connectivity

After `devcontainer up` succeeds, test the SSH connection that the script's readiness check uses:

```bash
ssh -p 2222 \
  -i ~/.ssh/lace_devcontainer \
  -o ConnectTimeout=2 \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR \
  node@localhost true
echo "Exit code: $?"
```

- **Exit code 0**: SSH is ready, authentication succeeded.
- **Exit code 255**: Connection refused (sshd not running or port not bound) or authentication failure.
- To distinguish auth failure from connection refused, increase verbosity:

```bash
ssh -p 2222 \
  -i ~/.ssh/lace_devcontainer \
  -o ConnectTimeout=2 \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -v \
  node@localhost true 2>&1 | tail -20
```

Look for `Connection refused` (sshd not running), `Permission denied (publickey)` (key mismatch), or `Connection timed out` (port not forwarded).

#### 2c. Testing `wezterm connect lace`

After SSH connectivity is confirmed:

```bash
wezterm connect lace
```

- **Success**: A new WezTerm GUI window opens with a shell prompt at `/workspace/main` inside the container.
  The tab title shows the remote hostname. The script can now exit.
- **Failure (mux server not running)**: WezTerm prints an error about failing to connect to the mux server.
  The window may flash and close, or an error dialog may appear.
- **Failure (SSH issue)**: If the underlying SSH connection fails, wezterm shows an SSH error.
  This should not happen if step 2b passed, but if it does, the SSH domain config in `wezterm.lua` may be misconfigured.

Note: `wezterm connect` is a **GUI operation**. It opens a window and returns to the shell.
The exit code reflects whether the initial connection setup succeeded, not whether the window remains open.

#### 2d. Testing stdin pipe detection

Test that the script correctly handles piped input vs. terminal invocation:

```bash
# Simulate piped mode with valid JSON
echo '{"outcome":"success","containerId":"abc123","remoteUser":"node","remoteWorkspaceFolder":"/workspace/main"}' \
  | ./bin/open-lace-workspace
# Expected: script skips running devcontainer up, proceeds to SSH poll

# Simulate piped mode with failure JSON
echo '{"outcome":"error","message":"Docker not running"}' \
  | ./bin/open-lace-workspace
# Expected: script prints error about devcontainer up failure and exits with code 2

# Simulate piped mode with empty/garbage input
echo 'not json at all' | ./bin/open-lace-workspace
# Expected: script prints JSON parsing error and exits with code 2

# Standalone mode (no pipe)
./bin/open-lace-workspace
# Expected: script runs devcontainer up internally
```

### 3. Debugging common failures

#### "SSH connection refused" (exit code 255, "Connection refused" in verbose output)

The container is running but sshd is not listening on port 2222.

```bash
# Verify the container is running
docker ps --filter "label=devcontainer.local_folder" --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}"
# Look for: 0.0.0.0:2222->2222/tcp in the Ports column

# Verify sshd is running inside the container
devcontainer exec --workspace-folder . -- pgrep -a sshd
# Expected: one or more sshd processes listed
# If empty: the sshd feature may have failed to install or start

# Check if port 2222 is bound on the host
ss -tlnp | grep 2222
# Expected: LISTEN state on *:2222 or 0.0.0.0:2222
# If another process holds the port, devcontainer may have failed to bind it
```

#### "Permission denied (publickey)"

SSH connects but authentication fails. The mounted public key does not match the local private key.

```bash
# Show the fingerprint of the local private key
ssh-keygen -lf ~/.ssh/lace_devcontainer
# Example output: 256 SHA256:abc123... user@host (ED25519)

# Show the fingerprint of the key mounted inside the container
devcontainer exec --workspace-folder . -- ssh-keygen -lf /home/node/.ssh/authorized_keys
# These two fingerprints MUST match

# If they don't match, the mount in devcontainer.json may be stale.
# Rebuild the container: devcontainer up --workspace-folder . --rebuild
```

#### "wezterm connect failed" (SSH works but WezTerm window fails to open)

The mux server inside the container is not running or crashed.

```bash
# Check if wezterm-mux-server is running inside the container
devcontainer exec --workspace-folder . -- pgrep -a wezterm
# Expected: a wezterm-mux-server process
# If missing: the postStartCommand failed silently (it uses || true)

# Restart the mux server manually
devcontainer exec --workspace-folder . -- wezterm-mux-server --daemonize
# Then retry: wezterm connect lace

# Check the mux server socket exists
devcontainer exec --workspace-folder . -- ls -la /run/user/$(devcontainer exec --workspace-folder . -- id -u)/wezterm/
# Expected: a socket file (mux-*.sock or similar)
# If /run/user/<uid> does not exist, XDG_RUNTIME_DIR may not be set
```

#### `devcontainer up` returns non-success outcome

```bash
# Run with trace logging to see the full build/start output
devcontainer up --workspace-folder . --log-level trace 2>&1 | tee /tmp/devcontainer-up.log

# Common causes:
# - Docker daemon not running: "Cannot connect to the Docker daemon"
# - Port conflict: "port is already allocated" (another container or process on 2222)
# - Build failure: Dockerfile syntax error or network issue during build
# - Feature install failure: check the trace log for feature-specific errors

# To check for port conflicts specifically:
ss -tlnp | grep 2222
docker ps --format "{{.Ports}}" | grep 2222
```

#### JSON parsing failure

`devcontainer up` mixes log lines with the JSON result on stdout.
If the script fails to parse JSON, the issue is likely that log lines are being included in the parse input.

```bash
# Capture raw stdout to inspect what devcontainer up actually emits
devcontainer up --workspace-folder . > /tmp/dc-raw-output.txt 2>/dev/null
cat -A /tmp/dc-raw-output.txt
# Look for the JSON line -- it should be the line containing {"outcome":

# The script should extract the JSON line by finding the line that starts with '{'
# or the line containing '"outcome"'. Log lines typically start with '[' (timestamp).
# Example filter approaches:
#   grep '^{' /tmp/dc-raw-output.txt        # lines starting with {
#   grep '"outcome"' /tmp/dc-raw-output.txt  # lines containing "outcome"
#   tail -1 /tmp/dc-raw-output.txt           # often the last line (but not guaranteed)
```

### 4. End-to-end smoke test

Step-by-step from a clean state (container not running):

```bash
# Step 0: Verify prerequisites (see section 1)
which devcontainer && which wezterm && ls ~/.ssh/lace_devcontainer && echo "All prereqs OK"

# Step 1: Ensure container is stopped
docker ps -q --filter "label=devcontainer.local_folder" | xargs -r docker stop
# Or: devcontainer down (if supported by your CLI version)

# Step 2a: Test piped mode
devcontainer up --workspace-folder . | ./bin/open-lace-workspace
# Expected: container starts, SSH poll succeeds, WezTerm window opens
# Verify: new WezTerm window appears with shell prompt at /workspace/main

# Step 2b: Test standalone mode (close the WezTerm window first, container still running)
./bin/open-lace-workspace
# Expected: devcontainer up returns quickly (already running), SSH poll passes immediately,
#           new WezTerm window opens

# Step 3: Verify exit codes
echo "Exit code: $?"
# Expected: 0 on success

# Step 4: Test error path -- kill the mux server and retry
devcontainer exec --workspace-folder . -- pkill wezterm-mux-server
./bin/open-lace-workspace
echo "Exit code: $?"
# Expected: SSH poll passes, wezterm connect fails, exit code 4,
#           diagnostic message about mux server

# Step 5: Restart mux server for a clean state
devcontainer exec --workspace-folder . -- wezterm-mux-server --daemonize
```

### 5. Using devcontainer CLI for debugging

```bash
# Verbose container startup (shows all lifecycle hook execution)
devcontainer up --workspace-folder . --log-level trace

# Execute commands inside the running container
devcontainer exec --workspace-folder . -- <command>
# Examples:
devcontainer exec --workspace-folder . -- whoami          # should print "node"
devcontainer exec --workspace-folder . -- pgrep -a sshd   # verify sshd is running
devcontainer exec --workspace-folder . -- pgrep -a wezterm # verify mux server is running
devcontainer exec --workspace-folder . -- ss -tlnp        # show listening ports inside container
devcontainer exec --workspace-folder . -- cat /home/node/.ssh/authorized_keys  # verify key is mounted

# Check what lifecycle hooks ran
devcontainer exec --workspace-folder . -- cat /tmp/*.log  # if any hooks log to /tmp

# Verify the workspace mount
devcontainer exec --workspace-folder . -- ls /workspace/
# Expected: main/ and any other worktrees

# Check feature installation
devcontainer exec --workspace-folder . -- which wezterm-mux-server
# Expected: /usr/local/bin/wezterm-mux-server
devcontainer exec --workspace-folder . -- wezterm-mux-server --version
```

### 6. Using wezterm CLI for debugging

```bash
# List all active mux clients and tabs (run on the HOST)
wezterm cli list
# Shows tabs across all wezterm instances including remote domains

# JSON output for scripted inspection
wezterm cli list --format json

# Debug-level logging for wezterm connect (very verbose)
WEZTERM_LOG=debug wezterm connect lace 2>&1 | head -100
# This shows the SSH negotiation, mux protocol handshake, and any errors
# Useful for diagnosing: mux version mismatches, SSH config issues, socket problems

# Check wezterm version on host vs container
wezterm --version
devcontainer exec --workspace-folder . -- wezterm --version
# Mux protocol issues can arise from major version mismatches between host and container

# List SSH domains configured in wezterm
# (No CLI command for this; inspect the config file directly)
grep -A6 'ssh_domains' config/wezterm/wezterm.lua
```

## Implementation Phases

### Phase 1: Create `bin/open-lace-workspace` script

**Steps**:

1. Create `bin/open-lace-workspace` (`#!/bin/bash`, executable, following `bin/nvim` precedent).
2. Implement prerequisite checks, stdin detection, JSON parsing, SSH polling, and `wezterm connect` invocation as detailed below.

**Script skeleton with pseudocode**:

```bash
#!/bin/bash
# Open a WezTerm workspace connected to the lace devcontainer.
#
# Usage:
#   devcontainer up --workspace-folder . | ./bin/open-lace-workspace   (piped mode)
#   ./bin/open-lace-workspace                                          (standalone mode)
#
# Piped mode: reads devcontainer up JSON from stdin, validates success,
# waits for SSH readiness, and opens a WezTerm window connected to the
# lace SSH domain.
#
# Standalone mode: runs devcontainer up internally, then proceeds as above.
#
# Prerequisites:
#   - wezterm installed on the host
#   - SSH key pair at ~/.ssh/lace_devcontainer (see devcontainer.json mounts)
#   - devcontainer CLI installed (standalone mode only)
#
# Exit codes:
#   0 - Success (WezTerm window opened)
#   1 - Prerequisite failure (missing tool or SSH key)
#   2 - devcontainer up failure (non-success outcome or JSON parse error)
#   3 - SSH connectivity timeout (sshd not reachable after max retries)
#   4 - wezterm connect failure (mux server not running or connection error)

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

# --- Resolve repo root using SCRIPT_DIR pattern from bin/nvim ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# --- Configuration constants ---
SSH_KEY="$HOME/.ssh/lace_devcontainer"
SSH_PORT=2222
SSH_USER="node"
SSH_HOST="localhost"
MAX_SSH_ATTEMPTS=15
SSH_RETRY_INTERVAL=1

# --- Helper: print error messages prefixed with script name ---
# Format: "open-lace-workspace: <message>"
# All error messages should include actionable remediation guidance.
err() {
  echo "${SCRIPT_NAME}: error: $*" >&2
}

info() {
  echo "${SCRIPT_NAME}: $*" >&2
}

# --- Phase A: Prerequisite checks ---

# Always required: wezterm on host
if ! command -v wezterm &>/dev/null; then
  err "wezterm not found on PATH"
  err "Install from: https://wezfurlong.org/wezterm/installation.html"
  exit 1
fi

# Always required: SSH private key
if [[ ! -f "$SSH_KEY" ]]; then
  err "SSH key not found at $SSH_KEY"
  err "Generate with: ssh-keygen -t ed25519 -f $SSH_KEY -N \"\""
  exit 1
fi

# --- Phase B: Obtain devcontainer up JSON ---
#
# Stdin detection: [ ! -t 0 ] returns true when stdin is NOT a terminal
# (i.e., it is a pipe or redirect). This is the standard bash idiom.
# We prefer [ ! -t 0 ] over [ -p /dev/stdin ] because -t works with
# both pipes and redirects, while -p only detects pipes.

if [ ! -t 0 ]; then
  # --- Piped mode ---
  # Read all of stdin. devcontainer up mixes log lines with JSON on stdout.
  # Log lines typically start with '[' (timestamp) or are blank.
  # The JSON result is the line containing '"outcome"'.
  info "reading devcontainer up output from stdin..."
  RAW_INPUT="$(cat)"

  # Extract the JSON line: find the line containing "outcome"
  # This handles the case where devcontainer up emits log lines before/after JSON.
  JSON_LINE="$(echo "$RAW_INPUT" | grep '"outcome"' | head -1)"

  if [[ -z "$JSON_LINE" ]]; then
    err "failed to find JSON output in stdin (no line containing '\"outcome\"')"
    err "raw input (first 5 lines):"
    echo "$RAW_INPUT" | head -5 >&2
    exit 2
  fi
else
  # --- Standalone mode ---
  # devcontainer CLI is required only in this path.
  if ! command -v devcontainer &>/dev/null; then
    err "devcontainer CLI not found on PATH (required for standalone mode)"
    err "Install with: npm install -g @devcontainers/cli"
    err "Or use piped mode: devcontainer up --workspace-folder . | $0"
    exit 1
  fi

  info "running devcontainer up --workspace-folder $REPO_ROOT ..."
  # Capture output and exit code separately. Under set -e, a failed command
  # substitution in assignment would abort before DC_EXIT is set, so we
  # use the "|| true" idiom and capture the exit code in one expression.
  DC_EXIT=0
  RAW_OUTPUT="$(devcontainer up --workspace-folder "$REPO_ROOT" 2>&1)" || DC_EXIT=$?

  # Extract JSON line from mixed output
  JSON_LINE="$(echo "$RAW_OUTPUT" | grep '"outcome"' | head -1)"

  if [[ -z "$JSON_LINE" ]]; then
    err "devcontainer up did not produce JSON output (exit code: $DC_EXIT)"
    err "raw output (last 10 lines):"
    echo "$RAW_OUTPUT" | tail -10 >&2
    exit 2
  fi
fi

# --- Phase C: Parse JSON and validate outcome ---
#
# JSON parsing strategy:
# - Prefer jq if available (robust, handles edge cases)
# - Fall back to grep/sed for environments without jq
# - The only field we need is "outcome" (must equal "success")

if command -v jq &>/dev/null; then
  OUTCOME="$(echo "$JSON_LINE" | jq -r '.outcome')"
else
  # Fallback: extract outcome value using grep + sed
  # Matches "outcome":"<value>" or "outcome": "<value>" (with optional whitespace)
  OUTCOME="$(echo "$JSON_LINE" | grep -o '"outcome"\s*:\s*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')"
fi

if [[ "$OUTCOME" != "success" ]]; then
  err "devcontainer up reported outcome: $OUTCOME"
  # Try to extract error message for better diagnostics
  if command -v jq &>/dev/null; then
    MSG="$(echo "$JSON_LINE" | jq -r '.message // .description // empty')"
  else
    MSG="$(echo "$JSON_LINE" | grep -o '"message"\s*:\s*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')"
  fi
  [[ -n "${MSG:-}" ]] && err "message: $MSG"
  exit 2
fi

info "devcontainer up succeeded"

# --- Phase D: SSH readiness polling ---
#
# SSH command explanation:
#   -p 2222                       Port where sshd feature listens
#   -i ~/.ssh/lace_devcontainer   Private key matching the mounted public key
#   -o ConnectTimeout=1           Fail fast if sshd not yet listening
#   -o StrictHostKeyChecking=no   Container host key changes on rebuild
#   -o UserKnownHostsFile=/dev/null  Don't pollute known_hosts with container keys
#   -o LogLevel=ERROR             Suppress warnings about known_hosts and key checking
#   node@localhost                The devcontainer user @ host
#   true                          Minimal command to verify auth + connectivity

info "waiting for SSH readiness on port $SSH_PORT..."
ATTEMPT=0
while [[ $ATTEMPT -lt $MAX_SSH_ATTEMPTS ]]; do
  ATTEMPT=$((ATTEMPT + 1))
  if ssh -p "$SSH_PORT" \
       -i "$SSH_KEY" \
       -o ConnectTimeout=1 \
       -o StrictHostKeyChecking=no \
       -o UserKnownHostsFile=/dev/null \
       -o LogLevel=ERROR \
       "${SSH_USER}@${SSH_HOST}" true 2>/dev/null; then
    info "SSH ready (attempt $ATTEMPT/$MAX_SSH_ATTEMPTS)"
    break
  fi

  if [[ $ATTEMPT -eq $MAX_SSH_ATTEMPTS ]]; then
    err "SSH connectivity timeout after $MAX_SSH_ATTEMPTS attempts"
    err "troubleshooting:"
    err "  - verify container is running: docker ps | grep devcontainer"
    err "  - verify sshd is running: devcontainer exec --workspace-folder $REPO_ROOT -- pgrep -a sshd"
    err "  - verify port binding: ss -tlnp | grep $SSH_PORT"
    err "  - test SSH manually: ssh -p $SSH_PORT -i $SSH_KEY -v ${SSH_USER}@${SSH_HOST} true"
    exit 3
  fi

  sleep "$SSH_RETRY_INTERVAL"
done

# --- Phase E: Open WezTerm window ---
#
# wezterm connect lace:
#   Opens a new GUI window connected to the "lace" SSH domain defined
#   in wezterm.lua. This connects via SSH to the container's
#   wezterm-mux-server, landing at /workspace/main.
#   Always opens a NEW window (unlike Leader+D SwitchToWorkspace).

info "connecting WezTerm to lace domain..."
WEZ_EXIT=0
wezterm connect lace || WEZ_EXIT=$?
if [[ $WEZ_EXIT -ne 0 ]]; then
  err "wezterm connect lace failed (exit code: $WEZ_EXIT)"
  err "troubleshooting:"
  err "  - verify mux server: devcontainer exec --workspace-folder $REPO_ROOT -- pgrep -a wezterm"
  err "  - restart mux server: devcontainer exec --workspace-folder $REPO_ROOT -- wezterm-mux-server --daemonize"
  err "  - debug connection: WEZTERM_LOG=debug wezterm connect lace"
  exit 4
fi

info "done"
```

**Key implementation notes**:

- **SCRIPT_DIR / REPO_ROOT resolution**: Uses the same `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` pattern as `bin/nvim`. `REPO_ROOT` is derived as `dirname "$SCRIPT_DIR"` since the script lives in `bin/`. This is used for the `--workspace-folder` argument to `devcontainer up` in standalone mode.

- **Stdin detection (`[ ! -t 0 ]`)**: Returns true when file descriptor 0 (stdin) is not a terminal. This covers both pipes (`cmd | script`) and redirects (`script < file`). Preferred over `[ -p /dev/stdin ]` which only detects pipes, not redirects.

- **`devcontainer up` stdout parsing**: The critical challenge is that `devcontainer up` emits log lines mixed with JSON on stdout. The script extracts the JSON by searching for the line containing `"outcome"`. This is more robust than `tail -1` (which can fail if trailing newlines or log lines appear after the JSON) and more robust than `grep '^{'` (which can match malformed JSON-like log lines). The `head -1` ensures we take only the first match in case of duplicates.

- **JSON parsing without jq**: The fallback uses `grep -o` to extract the `"outcome":"value"` pattern and `sed` to isolate the value. This handles optional whitespace around the colon. The fallback is intentionally limited to the fields we need (`outcome`, `message`); it is not a general JSON parser.

- **SSH command flags**:
  - `-o ConnectTimeout=1`: Ensures each poll attempt fails fast (1 second) rather than hanging for the default TCP timeout.
  - `-o StrictHostKeyChecking=no` and `-o UserKnownHostsFile=/dev/null`: The container's host key changes on every rebuild. Without these, SSH would refuse to connect after a rebuild due to a "host key changed" error. Using `/dev/null` avoids polluting `~/.ssh/known_hosts`.
  - `-o LogLevel=ERROR`: Suppresses the warning about adding the host to known_hosts, keeping script output clean.
  - `true` as the remote command: The lightest possible command to verify connectivity. It exits 0 immediately, confirming sshd is listening, key auth works, and the user shell is functional.

- **Exit code conventions**:
  - `0` = Success. WezTerm window opened.
  - `1` = Prerequisite failure. A required tool or file is missing. Actionable message tells the user what to install or create.
  - `2` = `devcontainer up` failure. Either the outcome was not `"success"`, or the JSON could not be parsed from the output. Message includes the raw outcome or parse error.
  - `3` = SSH timeout. sshd did not become reachable within the retry window. Message includes troubleshooting steps for port binding, sshd process, and manual SSH testing.
  - `4` = `wezterm connect` failure. SSH works but the mux server connection failed. Message includes steps to check and restart the mux server.

- **Error message format**: All messages are prefixed with the script name (`open-lace-workspace: error: ...` or `open-lace-workspace: ...` for info). Error messages include actionable remediation: the specific command to run, file to check, or URL to visit.

**Success criteria**: Running `./bin/open-lace-workspace` from the repo root with a stopped container results in the container starting and a new WezTerm window opening connected to the devcontainer.
Running it again with the container already running opens a new WezTerm window promptly.
All failure modes produce distinct exit codes and actionable error messages.

**Constraints**:
- Do not modify `devcontainer.json` or `wezterm.lua`.
- Bash script (`#!/bin/bash`), following the `bin/nvim` convention in this repo.
- Script must be idempotent and safe to run multiple times.
- `set -euo pipefail` for strict error handling.
- No dependencies beyond standard coreutils, bash, ssh, and optionally jq.

### Phase 2: Documentation and integration

**Steps**:

1. Add a header comment block to the script (already shown in the skeleton above). The header should include:
   - Script purpose: one-sentence description.
   - Usage examples: piped mode and standalone mode.
   - Prerequisites: the three requirements (wezterm, devcontainer CLI, SSH key) with one-liner setup commands.
   - Exit code reference table.
   - Pointer to this proposal for design rationale.

2. Mark the file executable: `chmod +x bin/open-lace-workspace`.

3. Test on a clean checkout: clone the repo, run the script, verify the full flow works without prior manual setup (aside from SSH key generation and tool installation).

**Success criteria**: A developer with `devcontainer`, `wezterm`, and the SSH key can run the script and get a working WezTerm workspace without additional manual steps.
The script header comment is sufficient as standalone documentation; no separate doc file is needed for this PoC.

> NOTE: Future improvements (window reuse, auto-connect on WezTerm launch, lace CLI absorption, worktree selection) are tracked in a follow-up RFP: [Deeper WezTerm-Devcontainer Integration](cdocs/proposals/2026-02-01-deeper-wezterm-devcontainer-integration.md).
