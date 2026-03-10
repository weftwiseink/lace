---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-10T14:45:00-08:00
task_list: lace/wez-into
type: proposal
state: live
status: implementation_wip
tags: [wez-into, ssh, workspace, cwd, bugfix, dx]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-10T17:00:00-08:00
  round: 1
---

# Fix wez-into SSH Sessions Landing in /home/node Instead of Workspace Directory

> **BLUF:** When `wez-into` switched from mux-server domain connections to direct
> SSH (`wezterm cli spawn -- ssh ...`) in commit `efb29cc`, it lost the
> `default_cwd` behavior that the wezterm-mux-server provided. SSH always lands
> in the user's home directory (`/home/node`), not the workspace folder (e.g.,
> `/workspace/lace/main`). The fix is to use the `CONTAINER_WORKSPACE_FOLDER`
> env var (already available in SSH sessions via lace's `containerEnv` injection)
> as a remote command:
> `cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd; exec $SHELL -l`.
> This reads the env var on the remote side, falls back to `$HOME` if unset, and
> starts an interactive login shell in the workspace directory. A secondary
> finding is that the wezterm-mux-server is not running inside the container at
> all (the `entrypoint.sh` and `wezterm.lua` files are missing from the prebuild
> image), but this is a separate issue -- the mux server is no longer in the
> connection path and fixing the SSH CWD is the correct approach.

## Objective

When a user runs `wez-into lace`, the SSH session should land in the container's
workspace directory (`/workspace/lace/main`) rather than the user's home directory
(`/home/node`).

## Background

### The Connection Path

`wez-into` connects to devcontainers via this sequence:

1. `lace-discover` finds running containers and returns `name:port:user:path`
   (where `path` is the **host-side** local folder).
2. `do_connect()` runs `wezterm cli spawn -- ssh -p <port> ... node@localhost`.
3. SSH authenticates via the lace SSH key and drops into the `node` user's shell.

### How CWD Used to Work

Before commit `efb29cc` (2026-02-28), `wez-into` used WezTerm's SSH domain
mechanism: `wezterm connect lace:<port>` or `wezterm cli spawn --domain-name`.
This connected through the `wezterm-mux-server` running inside the container,
which had `config.default_cwd` set from the `CONTAINER_WORKSPACE_FOLDER` env var.
The mux server ensured new panes opened in the workspace directory.

### Why Direct SSH Was Adopted

Commit `efb29cc` switched to direct SSH because WezTerm's mux server could not
reliably establish SSH domain connections after config hot-reload. Direct SSH
bypasses the mux server entirely, which solved the reliability problem but lost
the `default_cwd` behavior.

### Secondary Finding: Mux Server Not Running

Investigation revealed that:
- `/usr/local/share/wezterm-server/` (containing `entrypoint.sh` and
  `wezterm.lua`) does not exist inside the container.
- The wezterm-mux-server process is not running.
- The binaries (`wezterm`, `wezterm-mux-server`) are installed at `/usr/local/bin/`.

This means the prebuild image was built from a version of the wezterm-server
feature that predates the workspace awareness changes (commit `b6f5a3d`). The
prebuild image needs to be rebuilt to include the entrypoint and config files.
However, since `wez-into` no longer uses the mux server for connections, this is
a separate concern and does not block this fix.

### Relevant Data

The `CONTAINER_WORKSPACE_FOLDER` env var is available in the container:

```
$ docker inspect <container_id> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep CONTAINER
CONTAINER_WORKSPACE_FOLDER=/workspace/lace/main
```

It is also available inside SSH sessions (inherited from the container env):

```
$ ssh node@localhost -p 22426 'echo $CONTAINER_WORKSPACE_FOLDER'
/workspace/lace/main
```

But SSH always starts in `/home/node`:

```
$ ssh node@localhost -p 22426 'pwd'
/home/node
```

## Proposed Solution

### Approach: SSH RemoteCommand with Workspace cd

Modify the `do_connect()` function in `bin/wez-into` to:

1. Resolve the container-side workspace folder from `CONTAINER_WORKSPACE_FOLDER`
   inside the SSH session.
2. Pass `cd <workspace> && exec $SHELL -l` as the SSH remote command.

The implementation reads the env var from within the SSH session itself rather
than from `docker inspect`, which avoids adding a Docker dependency to the
connection path and handles the env var being set by any mechanism (containerEnv,
.bashrc, etc.).

```bash
# In do_connect(), change the spawn command from:
pane_id=$(wezterm cli spawn -- ssh \
    -o "IdentityFile=$LACE_SSH_KEY" \
    -o "IdentitiesOnly=yes" \
    -o "UserKnownHostsFile=$LACE_KNOWN_HOSTS" \
    -o "StrictHostKeyChecking=no" \
    -p "$port" \
    "$user@localhost")

# To:
pane_id=$(wezterm cli spawn -- ssh \
    -o "IdentityFile=$LACE_SSH_KEY" \
    -o "IdentitiesOnly=yes" \
    -o "UserKnownHostsFile=$LACE_KNOWN_HOSTS" \
    -o "StrictHostKeyChecking=no" \
    -p "$port" \
    "$user@localhost" \
    -t 'cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd; exec $SHELL -l')
```

The single-quoted string ensures `$CONTAINER_WORKSPACE_FOLDER` is expanded on
the remote side, not locally. The `:-$HOME` fallback ensures graceful degradation
if the env var is unset (falls back to the home directory, which is the current
behavior).

The `-t` flag forces pseudo-terminal allocation, which is required when passing
a remote command that starts an interactive shell. Without `-t`, SSH would not
allocate a PTY and the shell would not be interactive.

> NOTE: The dry-run output should also be updated to reflect the workspace cd.

### Also Update the Fallback Path

The `wezterm connect` fallback (line 509) is used when no mux is running (cold
start). This path goes through the mux server, which would set `default_cwd` if
the mux server were running and configured. Since we've established that the mux
server is not currently running, this fallback path also likely lands in
`/home/node`. However, fixing the fallback is out of scope for this proposal --
the direct SSH path is the primary connection method.

## Important Design Decisions

### Decision: Read env var via SSH rather than docker inspect

**Decision:** Use the `CONTAINER_WORKSPACE_FOLDER` env var available inside the
SSH session rather than resolving it via `docker inspect` on the host.

**Why:**
- Avoids adding a `docker inspect` call to the hot path (connection latency).
- The env var is already set inside the container by lace's `containerEnv`
  injection.
- No need to correlate container IDs between `lace-discover` and `docker inspect`.
- Works regardless of how the env var was set (containerEnv, Dockerfile ENV,
  runtime injection).
- The env var is the canonical source of truth -- it's the same one the
  wezterm-mux-server's `wezterm.lua` reads.

### Decision: Use `exec $SHELL -l` rather than `exec bash`

**Decision:** Use `exec $SHELL -l` to start the shell.

**Why:**
- Respects the container's configured default shell (could be nushell, zsh, etc.).
- The `-l` flag ensures login shell behavior, which sources profile files.
- `exec` replaces the intermediate shell process, keeping the process tree clean.

### Decision: Fallback to $HOME when env var is unset

**Decision:** Use `${CONTAINER_WORKSPACE_FOLDER:-$HOME}` with a fallback to
`$HOME`.

**Why:**
- Containers not managed by lace (or older lace versions) may not have
  `CONTAINER_WORKSPACE_FOLDER` set.
- Falling back to `$HOME` preserves the current behavior for those cases.
- No error or warning needed -- the fallback is silent and expected.

## Edge Cases / Challenging Scenarios

### Workspace directory does not exist inside the container

If `CONTAINER_WORKSPACE_FOLDER` is set but the directory doesn't exist (e.g.,
mount failed, path mismatch), `cd` will fail and the shell won't start. Mitigation:
use `cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd` to fall back
to the home directory on `cd` failure. The `|| cd` (no args) goes to `$HOME` in
all POSIX shells.

### Container has nushell or non-POSIX shell

The remote command `cd ... && exec $SHELL -l` is evaluated by the SSH server's
configured shell for the user (from `/etc/passwd`). In the current lace
containers, this is `/bin/bash`. If the container user's shell were changed to
nushell, the `cd ... && exec $SHELL -l` syntax might not work (nushell uses
different syntax for `&&`). However, the SSH server always uses the user's login
shell to evaluate the command string, and if the login shell is bash, the command
works even if `$SHELL` points to nushell. This is a non-issue for current
configurations.

### wezterm cli spawn with remote command

`wezterm cli spawn -- ssh ... -t 'command'` passes the entire SSH command
(including arguments) to the spawned process. WezTerm does not interpret the
SSH arguments -- they are passed verbatim to the `ssh` binary. This is the same
mechanism used by the existing connection and has no special interaction.

### The -t flag and PTY allocation

SSH normally allocates a PTY only for interactive sessions (no command specified).
When a command is specified, SSH disables PTY allocation. The `-t` flag overrides
this, forcing PTY allocation. Without `-t`, the `exec $SHELL -l` would start
a non-interactive shell (no prompt, no job control), which would be unusable.

`wezterm cli spawn` already provides a PTY on the local side, but the `-t` flag
is needed for the **remote** side PTY allocation by the SSH server.

## Test Plan

### Phase 0: Verify the diagnosis (manual)

```bash
# Confirm current behavior: SSH lands in /home/node
ssh -p 22426 \
  -o "IdentityFile=$HOME/.config/lace/ssh/id_ed25519" \
  -o "IdentitiesOnly=yes" \
  -o "UserKnownHostsFile=$HOME/.ssh/lace_known_hosts" \
  -o "StrictHostKeyChecking=no" \
  node@localhost 'pwd'
# Expected: /home/node

# Confirm CONTAINER_WORKSPACE_FOLDER is available
ssh -p 22426 \
  -o "IdentityFile=$HOME/.config/lace/ssh/id_ed25519" \
  -o "IdentitiesOnly=yes" \
  -o "UserKnownHostsFile=$HOME/.ssh/lace_known_hosts" \
  -o "StrictHostKeyChecking=no" \
  node@localhost 'echo $CONTAINER_WORKSPACE_FOLDER'
# Expected: /workspace/lace/main

# Confirm the fix approach works
ssh -t -p 22426 \
  -o "IdentityFile=$HOME/.config/lace/ssh/id_ed25519" \
  -o "IdentitiesOnly=yes" \
  -o "UserKnownHostsFile=$HOME/.ssh/lace_known_hosts" \
  -o "StrictHostKeyChecking=no" \
  node@localhost \
  'cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd; exec $SHELL -l'
# Expected: interactive shell in /workspace/lace/main
```

### Phase 1: Verify the fix via wez-into (manual)

```bash
# After applying the fix:
wez-into lace
# Expected: new tab opens in /workspace/lace/main
# Verify by running `pwd` in the opened shell

# Test dry-run reflects the new command
wez-into --dry-run lace
# Expected: ssh command includes the cd + exec shell logic

# Test with a second project if available
wez-into weftwise
# Expected: opens in that project's workspace folder
```

### Phase 2: Regression scenarios (manual)

```bash
# Test fallback: container without CONTAINER_WORKSPACE_FOLDER
# (Requires a container without the env var, or temporarily unsetting it)
# Expected: falls back to /home/node (current behavior)

# Test duplicate detection still works
wez-into lace  # first call
wez-into lace  # second call should activate existing tab, not create new one

# Test --start path still works
# Stop a container, then: wez-into --start <project>
# Expected: starts container and connects to workspace directory
```

## Implementation Phases

### Phase 1: Fix the SSH workspace CWD in do_connect

**Changes to `bin/wez-into`:**

1. Modify the `wezterm cli spawn -- ssh ...` command in `do_connect()` to append
   `-t 'cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd; exec $SHELL -l'`.

2. Update the dry-run output (line 437) to show the new command format.

3. Update the fallback `wezterm connect` command comment to note that it does not
   benefit from this fix (the mux server would need to be running for workspace
   CWD, which is a separate issue).

**Constraints:**
- Do not modify `lace-discover` -- the fix is entirely in `wez-into`.
- Do not modify the wezterm-server feature -- the mux server is not in the
  connection path.
- Do not modify any container-side files (bashrc, profile) -- the fix is
  host-side only.

**Acceptance criteria:**
- `wez-into lace` opens a shell in `/workspace/lace/main`.
- `wez-into --dry-run lace` shows the `cd` command in the output.
- Containers without `CONTAINER_WORKSPACE_FOLDER` fall back to `/home/node`.
- Duplicate tab detection still works.

### Phase 2 (future, out of scope): Rebuild Prebuild Image

The wezterm-server feature's `entrypoint.sh` and `wezterm.lua` are missing from
the current prebuild image. Rebuilding the prebuild image would restore the mux
server functionality, which would fix the `wezterm connect` fallback path. This
is tracked separately and does not affect the direct SSH connection path.

### Phase 3 (future, out of scope): Regression Prevention

Add a smoke test to `wez-into` or lace's integration test suite that verifies:
- SSH to a running container starts in `CONTAINER_WORKSPACE_FOLDER`.
- The env var is set in the container's environment.

This could be part of the `wez-into` end-to-end test suite proposed in
`cdocs/proposals/2026-02-10-wez-into-end-to-end-integration-testing.md`.
