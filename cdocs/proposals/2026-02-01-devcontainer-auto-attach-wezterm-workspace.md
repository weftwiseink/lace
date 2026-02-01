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
  status: revision_requested
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T14:00:00-08:00
  round: 1
---

# Auto-Attach WezTerm Workspace After Devcontainer Setup

> BLUF: The devcontainer spec provides no host-side lifecycle hook that fires after the container is ready.
> The only host-side hook is `initializeCommand`, which runs *before* container creation.
> The `devcontainer up` CLI command is synchronous and returns JSON (including the container ID) once the container is fully running, making `devcontainer up && ./bin/open-weft-workspace` a viable and spec-aligned approach.
> This proposal adds a `bin/open-weft-workspace` script that: (1) runs `devcontainer up` (idempotent), (2) waits for SSH connectivity on port 2222, and (3) invokes `wezterm connect weft` to open a new WezTerm window connected to the devcontainer's mux server.
> This replaces the current multi-step manual process (start container, wait, Leader+D) with a single command.
> Related workstreams: the [wezterm-server feature](cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md) provides the mux server, the [lace CLI](cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md) is the long-term home for `devcontainer up` orchestration, and [SSH key auto-management](cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md) addresses the key prerequisite.

## Objective

Reduce the friction of entering the weft devcontainer development environment.
The current workflow requires: starting the devcontainer (via IDE or CLI), waiting for it to be ready, opening WezTerm, and pressing Leader+D to connect.
The goal is a single command that handles the full lifecycle from "container not running" to "WezTerm workspace connected to devcontainer."

## Background

### Current workflow

1. Developer starts the devcontainer (via VS Code "Reopen in Container" or `devcontainer up --workspace-folder .`).
2. The container builds (if needed), starts, and runs lifecycle hooks: `postCreateCommand` (git safe.directory), `postStartCommand` (wezterm-mux-server --daemonize).
3. Developer opens WezTerm (or switches to an existing window).
4. Developer presses Leader+D to connect to the weft SSH domain at `localhost:2222`.
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

This makes it suitable for chaining: `devcontainer up ... && host-side-command`.

### Related workstreams

- **wezterm-server feature** ([scaffold proposal](cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md)): Provides the `wezterm-mux-server` binary inside the container. Already published to GHCR and integrated into `devcontainer.json`.
- **lace CLI** ([proposal](cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md)): Defines `lace up` wrapping `devcontainer up` with prebuild and orchestration logic. The `open-weft-workspace` script in this proposal is a PoC that handles the "start container + connect terminal" workflow; the lace CLI is the long-term home for this functionality (e.g., `lace connect` or `lace workspace`).
- **SSH key auto-management** ([proposal](cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md)): Automates the `~/.ssh/weft_devcontainer` key pair lifecycle. Currently a manual prerequisite for this script.

### Existing wezterm connect infrastructure

The wezterm config (`config/wezterm/wezterm.lua`) defines an SSH domain `weft` that connects to `localhost:2222` (the devcontainer sshd port).
WezTerm can connect to this domain from the CLI via `wezterm connect weft`, which opens a new window connected to the remote mux server.
The Leader+D keybinding uses `SwitchToWorkspace`, which creates or switches to a named `weft` workspace *within* the current WezTerm process (different from `wezterm connect`, which always opens a new window).

## Proposed Solution

Add a `bin/open-weft-workspace` script that automates the full lifecycle:

```
bin/open-weft-workspace
├── Ensure devcontainer is running (devcontainer up, idempotent)
├── Wait for SSH connectivity on port 2222
└── Open new WezTerm window connected to the weft SSH domain
```

### Script behavior

1. **Check container state**: Run `devcontainer up --workspace-folder <repo-root>`.
   This is idempotent: if the container is already running, `devcontainer up` returns quickly with the existing container's info.
   If the container needs to be built or started, it handles that.

2. **Wait for SSH readiness**: After `devcontainer up` returns, sshd may not yet be accepting connections.
   The script polls SSH connectivity with `ssh -p 2222 -i ~/.ssh/weft_devcontainer -o ConnectTimeout=1 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null node@localhost true` in a retry loop (1-second intervals, max 15 attempts) to confirm sshd is up and authentication works.
   The readiness check verifies SSH only, not the mux server directly.
   `wezterm connect` handles mux server negotiation itself; if the mux server is not yet ready, `wezterm connect` will fail with a clear error, which is more informative than a generic timeout from the wrapper script.

3. **Spawn WezTerm window**: Run `wezterm connect weft` to open a new WezTerm window connected to the devcontainer's mux server.
   This always opens a new window (unlike Leader+D, which creates-or-switches within an existing WezTerm process).
   The window lands at `/workspace/main` (the default cwd for the weft SSH domain in `wezterm.lua`).
   If `wezterm connect` fails (e.g., mux server not running), the script captures the exit code and prints a diagnostic message.

### Script location and naming

`bin/open-weft-workspace` follows the existing convention (`bin/nvim` exists as a wrapper script).
The name is descriptive: it opens a weft workspace in WezTerm.

### Usage

```bash
# From the repo root (most common)
./bin/open-weft-workspace

# Or add the bin/ directory to PATH
open-weft-workspace
```

## Important Design Decisions

### Decision 1: Wrapper script over devcontainer.json hook

**Decision**: Use a host-side script rather than trying to embed this in `devcontainer.json`.

**Why**: The devcontainer spec has no host-side post-ready hook.
The `initializeCommand` runs before the container exists, not after.
`postAttachCommand` runs inside the container and is designed for IDE tool attachment, not host-side process spawning.
A wrapper script around `devcontainer up` is the spec-aligned approach for host-side post-ready actions, and it is what the devcontainer CLI documentation implicitly recommends for automation.

### Decision 2: Use `wezterm connect` rather than `wezterm cli spawn`

**Decision**: Spawn a new WezTerm GUI window via `wezterm connect weft` rather than using `wezterm cli` to create a tab or pane in an existing window.

**Why**: `wezterm connect <domain>` creates a new window attached to the remote mux server, which gives the user a dedicated window for container work.
`wezterm cli spawn --domain-name weft` could add a tab to an existing window, but that requires a running WezTerm instance and mixes container and host contexts in the same window.
The `connect` approach works whether or not WezTerm is already running.

This differs from the Leader+D keybinding (`SwitchToWorkspace`), which creates-or-switches to a named workspace *within* the current WezTerm process.
`wezterm connect weft` always opens a new window, even if one is already connected to the same domain.
Running the script twice will produce two windows.

> NOTE: A future refinement could detect an existing weft-connected window and focus it rather than opening a new one.
> This is acceptable for a PoC.

### Decision 3: Poll SSH connectivity rather than sleeping

**Decision**: Use a retry loop checking SSH connectivity rather than a fixed `sleep` or polling the mux server directly.

**Why**: A fixed sleep is fragile: too short on slow builds, wastefully long on fast starts.
Polling SSH connectivity (`ssh ... node@localhost true`) confirms sshd is up and key-based auth works.
The mux server is not checked directly because `wezterm cli list` over SSH requires `XDG_RUNTIME_DIR` to locate the mux socket, and SSH sessions do not inherit environment variables from the `postStartCommand` that started the daemon.
Instead, `wezterm connect` handles mux server negotiation natively and produces clear error messages if the server is not ready.
The retry interval is a fixed 1-second poll (15 attempts max): exponential backoff adds complexity without benefit in a 15-second window where services either come up within a few seconds or something is wrong.

### Decision 4: Script uses `devcontainer up` rather than `docker compose` directly

**Decision**: Invoke `devcontainer up` rather than lower-level Docker commands.

**Why**: `devcontainer up` is the canonical CLI for managing devcontainers.
It handles the full lifecycle (build, create, start, hooks) and respects `devcontainer.json` configuration.
Using Docker commands directly would bypass lifecycle hooks and feature installation.
The `devcontainer` CLI is already a development dependency for this project.

## Stories

### Developer opens project for the first time today

Container is stopped.
Developer runs `./bin/open-weft-workspace`.
`devcontainer up` starts the container, runs lifecycle hooks.
Script waits for sshd + mux server.
WezTerm window opens connected to `/workspace/main`.

### Developer's container is already running

Developer runs `./bin/open-weft-workspace`.
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
If the mux server fails to start, the SSH readiness check will still pass (sshd is independent), but `wezterm connect weft` will fail when it tries to negotiate with the mux server.
The script should capture the `wezterm connect` exit code and print a diagnostic message pointing to possible mux-server issues (e.g., "WezTerm connection failed -- check that wezterm-mux-server is running inside the container").
The `|| true` in `postStartCommand` prevents container startup from failing, but means the mux server issue is silent until connection time.

### Race between sshd startup and readiness check

The sshd feature starts the SSH daemon during feature installation, but there can be a brief window after `devcontainer up` returns where sshd is not yet accepting connections.
The retry loop handles this naturally.

### Multiple devcontainer configurations in the repo

The script assumes a single devcontainer configuration at `.devcontainer/devcontainer.json`.
If the repo later adds multiple configurations (e.g., `.devcontainer/frontend/devcontainer.json`), the script would need a `--config-path` flag.
Out of scope for this PoC.

## Implementation Phases

### Phase 1: Create `bin/open-weft-workspace` script

**Steps**:

1. Create `bin/open-weft-workspace` (bash, executable).
2. Implement prerequisite checks: `devcontainer` CLI on `$PATH`, `wezterm` on `$PATH`, SSH key exists at `~/.ssh/weft_devcontainer`.
3. Implement `devcontainer up --workspace-folder` invocation, capturing JSON output and checking the `outcome` field.
4. Implement readiness polling: retry `ssh -p 2222 -i ~/.ssh/weft_devcontainer -o ConnectTimeout=1 -o StrictHostKeyChecking=no node@localhost wezterm cli list` with exponential backoff, max 15 seconds.
5. On readiness, invoke `wezterm connect weft`.
6. On timeout, print diagnostic output (which service failed, how to debug).

**Success criteria**: Running `./bin/open-weft-workspace` from the repo root with a stopped container results in the container starting and a WezTerm workspace opening connected to the devcontainer.
Running it again with the container already running opens a new WezTerm window promptly.

**Constraints**:
- Do not modify `devcontainer.json` or `wezterm.lua`.
- POSIX-compatible bash (no bashisms beyond what is standard on Linux).
- Script must be idempotent and safe to run multiple times.

### Phase 2: Documentation and integration

**Steps**:

1. Add usage instructions to the repo's development setup documentation (if one exists) or as a comment block at the top of the script.
2. Consider adding the script path to the repo's `.gitattributes` or noting it in the project README if appropriate.
3. Test on a clean checkout: clone the repo, run the script, verify the full flow works without prior manual setup (aside from SSH key generation and tool installation).

**Success criteria**: A developer with `devcontainer`, `wezterm`, and the SSH key can run the script and get a working WezTerm workspace without additional manual steps.

### Phase 3 (future): Deeper WezTerm integration

> NOTE: This phase is aspirational and not part of the PoC scope.

Potential improvements beyond the PoC:

- Detect if a WezTerm window is already connected to the `weft` domain and focus it rather than opening a new one.
- Integration with the `gui-startup` hook in `wezterm.lua` to auto-connect on WezTerm launch.
- A `bin/lace` wrapper that combines devcontainer management and workspace entry as subcommands.
- Support for workspace selection (connect to a specific worktree, not just `/workspace/main`).
