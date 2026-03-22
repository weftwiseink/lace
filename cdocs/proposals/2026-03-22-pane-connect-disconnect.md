---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-22T09:30:00-07:00
task_list: session-management/pane-connect-disconnect
type: proposal
state: live
status: wip
tags: [lace-into, tmux, session-management, pane-management]
---

# Pane-Level Connect and Disconnect for Lace Sessions

> BLUF: `lace-into` currently creates a dedicated tmux session per container, forcing users to switch sessions to work in a container.
> Two complementary features eliminate this friction: `lace-into --pane` connects the current tmux pane to a container via SSH (staying in whatever session you are already in), and a `disconnect-pane` tmux command drops the current pane back to a local shell.
> Together they enable fluid per-pane container attachment without session switching.

## Summary

The current `lace-into` workflow is session-oriented: each container gets its own tmux session, and the user switches between sessions to move between containers (or between local and container work).
This works but introduces context-switching friction: the user must leave their `main` session to work in a container, losing their local pane layout.

This proposal adds two features:

1. **`lace-into --pane`**: Connects the current pane to a container, keeping the user in their current session. Uses `tmux respawn-pane -k` to replace the current pane's process with an SSH connection to the target container.
2. **`disconnect-pane`**: A tmux custom command (registered via `command-alias`) that drops the current pane's SSH connection, replacing it with a local shell. Accessible via `prefix + :` then typing `disconnect-pane`, or via an optional keybinding.

These features complement rather than replace the existing session-per-container model.
Users who prefer dedicated sessions continue using `lace-into <project>` as before.

## Objective

Enable per-pane container connection and disconnection within any tmux session:

- Connect any pane to any running container without leaving the current session
- Disconnect any pane from its container, dropping back to a local shell
- Preserve session-level `@lace_port`/`@lace_user`/`@lace_workspace` options so that `lace-split` (Alt+HJKL container-aware splits) works after a `--pane` connection
- Maintain backward compatibility with the existing session-per-container workflow

## Background

### Current `lace-into` Connection Model

`lace-into` operates at session granularity (see `do_connect()` at line 451 of `bin/lace-into`):

1. Check for an existing tmux session named after the project
2. If found: verify `@lace_port` matches, check pane health, reattach
3. If not found: create a new session with `tmux new-session -d -s "$project"`, set session options, attach

The user's workflow is: `lace-into lace` to switch to the lace session, do container work, then `tmux switch-client` back to their main session.

### tmux Pane Respawning

`tmux respawn-pane -k` kills the current pane process and starts a new command in the same pane, preserving pane position and layout.
This is the mechanism `lace-into` already uses for dead pane recovery (lines 538-543 of `bin/lace-into`).

### tmux `command-alias`

tmux supports custom commands via the `command-alias` server option:

```tmux
set -s command-alias[100] disconnect-pane='run-shell "..."'
```

After this, the user can type `prefix + :` followed by `disconnect-pane` at the tmux command prompt.
The command appears in command completion, making it discoverable.

### tmux Per-Pane Options

tmux supports per-pane user options via `set-option -p`:

```bash
tmux set-option -p @lace_connected true
tmux set-option -p @lace_target_port 22426
```

These are independent of session-level options and survive pane operations.

## Proposed Solution

### 1. `lace-into --pane`

Add a `--pane` flag to `lace-into` that connects the current pane instead of creating/attaching a session.

#### Preconditions

- Must be running inside tmux (`$TMUX` is set)
- Current pane is identified by `$TMUX_PANE`

If `--pane` is given outside tmux, `lace-into` exits with an error.

#### Behavior

```
lace-into --pane <project>       Connect current pane to named project
lace-into --pane                 Interactive picker, connect current pane
lace-into --pane --start <proj>  Start container if needed, then connect pane
```

The `--pane` flag modifies the connection step only: discovery, host key refresh, and container startup (`--start`) work identically to the session-oriented path.

#### Implementation: `do_connect_pane()`

A new function parallel to `do_connect()`:

```bash
do_connect_pane() {
  local project="$1"
  local port="$2"
  local workspace="${3:-}"
  local user
  user=$(resolve_user_for_port "$port")

  # Build SSH command (same as do_connect)
  local ssh_base=(
    ssh
    -o "IdentityFile=$LACE_SSH_KEY"
    -o "IdentitiesOnly=yes"
    -o "UserKnownHostsFile=$LACE_KNOWN_HOSTS"
    -o "StrictHostKeyChecking=no"
    -o "ControlMaster=auto"
    -o "ControlPath=$HOME/.ssh/lace-ctrl-%C"
    -o "ControlPersist=600"
    -t
    -p "$port"
    "${user}@localhost"
  )

  if [[ -n "$workspace" ]]; then
    ssh_base+=("cd $workspace && exec \$SHELL -l")
  fi

  refresh_host_key "$port"

  # Respawn the current pane with the SSH command
  tmux respawn-pane -k -t "$TMUX_PANE" "${ssh_base[@]}"

  # Set pane-level options for tracking
  tmux set-option -p -t "$TMUX_PANE" @lace_connected true
  tmux set-option -p -t "$TMUX_PANE" @lace_target_port "$port"
  tmux set-option -p -t "$TMUX_PANE" @lace_target_project "$project"

  # Set session-level options if not already set, enabling lace-split
  local existing_port
  existing_port=$(tmux show-option -qv @lace_port 2>/dev/null)
  if [[ -z "$existing_port" ]]; then
    tmux set-option @lace_port "$port"
    tmux set-option @lace_user "$user"
    if [[ -n "$workspace" ]]; then
      tmux set-option @lace_workspace "$workspace"
    fi
    info "session lace options set (enables Alt+HJKL container splits)"
  elif [[ "$existing_port" != "$port" ]]; then
    info "warning: session @lace_port ($existing_port) differs from pane target ($port)"
    info "Alt+HJKL splits will target the session-level container, not this pane's"
  fi

  # Update pane title
  tmux select-pane -t "$TMUX_PANE" -T "$project"
}
```

#### Key Design Decisions

**`respawn-pane -k` over `send-keys`.**
`respawn-pane -k` replaces the pane process cleanly: it kills the current shell and starts the SSH command as the pane's root process.
The alternative (`tmux send-keys "ssh ..." Enter`) is simpler but leaves the original shell as a parent process, meaning `exit` from SSH drops back to the local shell rather than killing the pane.
`respawn-pane -k` makes the SSH connection the pane's only process, which aligns with how `lace-into` creates session panes.

**Session-level options: set-if-absent, not overwrite.**
When `--pane` connects a pane, it sets `@lace_port` and friends at session level only if they are not already set.
This enables `lace-split` (Alt+HJKL container-aware splits) for the first connection.
If the session already has `@lace_port` from a different container (e.g., pane 1 connected to `lace`, pane 2 connecting to `dotfiles`), the session options are left unchanged and a warning is emitted.

This is a conscious limitation: session-level options support one container per session.
Per-pane options (`@lace_target_port`) track which container each pane is connected to, enabling future per-pane-aware split behavior.

**Pane-level options for tracking.**
`@lace_connected`, `@lace_target_port`, and `@lace_target_project` are set per-pane to track connection state.
These enable `disconnect-pane` to verify the pane is actually connected, and future tooling to query pane connection status.

### 2. `disconnect-pane`

A tmux custom command that replaces the current pane's SSH process with a local shell.

#### Registration

In `dot_config/tmux/tmux.conf`:

```tmux
# disconnect-pane: Drop the current pane from SSH back to a local shell.
# Usage: prefix + : then type "disconnect-pane"
set -s command-alias[100] disconnect-pane='run-shell "tmux respawn-pane -k -t #{pane_id}"'
```

`respawn-pane -k` without a command argument starts the default shell (`$SHELL`, which is nushell per `default-shell` config).
This kills the SSH process and drops to a fresh local shell in the same pane.

#### Keybinding (Optional)

For quick access without the command prompt:

```tmux
# Disconnect current pane from SSH (prefix + D)
bind D run-shell 'tmux respawn-pane -k -t "#{pane_id}"'
```

`prefix + D` is `Alt-z D` with the current prefix configuration.
Uppercase `D` avoids collision with tmux's default `d` (detach).

#### Pane Option Cleanup

The simple `respawn-pane -k` approach does not clear per-pane lace options (`@lace_connected`, etc.).
This is acceptable: the options become stale but harmless.
A more thorough version could wrap the respawn in a script:

```bash
#!/bin/bash
# disconnect-pane helper
tmux set-option -p -u @lace_connected 2>/dev/null || true
tmux set-option -p -u @lace_target_port 2>/dev/null || true
tmux set-option -p -u @lace_target_project 2>/dev/null || true
tmux respawn-pane -k
```

> NOTE(opus/pane-connect-disconnect): The simple `respawn-pane -k` is sufficient for Phase 1.
> The helper script for option cleanup can be added if stale options cause issues.

#### Safety: SSH-Only Guard

The simple implementation does not check whether the pane is actually running SSH.
`respawn-pane -k` kills whatever process the pane is running and starts a new shell.
If the user runs `disconnect-pane` on a local shell pane, it restarts the shell (harmless but unnecessary).

An optional guard checks `pane_current_command`:

```tmux
set -s command-alias[100] disconnect-pane='if-shell \
  "[ \"$(tmux display-message -p \"#{pane_current_command}\")\" = ssh ]" \
  "respawn-pane -k" \
  "display-message \"Pane is not running SSH\""'
```

This only disconnects panes whose root process is `ssh`, showing a status message otherwise.

> NOTE(opus/pane-connect-disconnect): The SSH guard is nice-to-have but adds complexity.
> Since `respawn-pane -k` on a local shell just restarts the shell, the guard is not required for correctness.
> Recommend starting without the guard and adding it if users find the behavior confusing.

### 3. Reconnection Workflow

`disconnect-pane` followed by `lace-into --pane <project>` reconnects the pane to a container.
This enables a natural workflow for container switches:

1. User has pane connected to `lace` container
2. `disconnect-pane` drops to local shell
3. `lace-into --pane dotfiles` connects the same pane to the `dotfiles` container

Or more simply, `lace-into --pane dotfiles` can be run directly on a pane that is already SSH'd into another container.
`respawn-pane -k` kills the existing SSH and starts the new one, so no explicit disconnect is needed for switching.

## Interaction with Existing Features

### lace-split (Alt+HJKL Container Splits)

`--pane` sets session-level `@lace_port` if not already set, enabling Alt+HJKL container-aware splits.
This means: connect one pane via `--pane`, and subsequent Alt+HJKL splits in that session auto-SSH into the same container.

Limitation: if different panes in the same session are connected to different containers, Alt+HJKL splits follow the session-level `@lace_port` (the first container connected).
Per-pane-aware splits would require `lace-split` to read `@lace_target_port` from the active pane, which is a future enhancement.

### Dead Pane Recovery (`pane-died` Hook)

The `pane-died` hook (from the dead-panes-recovery proposal) applies at session level.
Panes connected via `--pane` in non-lace sessions do not have the hook.
If their SSH dies, the pane shows "Pane is dead" (with `remain-on-exit failed` at session level) without auto-respawn.

This is acceptable: the `--pane` workflow is ad-hoc. Users can manually reconnect via `lace-into --pane` or respawn via `prefix + R`.

### Session-Oriented `lace-into` (No Flag)

`lace-into <project>` (without `--pane`) continues to create/attach dedicated sessions.
The two workflows are independent and can coexist.

### `--dry-run`

`--pane --dry-run` prints the `respawn-pane` command that would be executed:

```
tmux respawn-pane -k -t %42 ssh -o IdentityFile=... -t -p 22426 node@localhost "cd /workspace && exec $SHELL -l"
tmux set-option -p -t %42 @lace_connected true
tmux set-option -p -t %42 @lace_target_port 22426
```

## Edge Cases

### `--pane` Outside tmux

If `$TMUX` is not set, `--pane` exits with an error:

```
lace-into: error: --pane requires running inside tmux
```

### Multi-Container Session

When panes in the same session are connected to different containers via `--pane`:

- Session-level `@lace_port` tracks the first container connected
- Per-pane `@lace_target_port` tracks each pane's actual connection
- Alt+HJKL splits follow the session-level target
- A warning is emitted when connecting to a container that differs from the session-level target

This is a known limitation.
A future `lace-split` enhancement could read the active pane's `@lace_target_port` instead of the session's `@lace_port`.

### `disconnect-pane` Clears Working Directory

`respawn-pane -k` starts a fresh shell in the pane's `start_directory` (the directory the pane was created in, or `$HOME`).
The user's working directory from before the disconnect is lost.
This is inherent to `respawn-pane` and cannot be avoided without a wrapper that captures `pwd` before respawning.

### Container Not Running

`lace-into --pane <project>` when the container is not running follows the same behavior as session-oriented `lace-into`: it errors with a message about the project not being found, with hints about `--start`.

`--pane --start <project>` starts the container and then connects the pane.

## Test Plan

### 1. Basic `--pane` Connection

1. Start a tmux session: `tmux new-session -s main`
2. Run `lace-into --pane lace`
3. **Verify**: pane is now SSH'd into the lace container (`hostname` shows container hostname)
4. **Verify**: pane title shows "lace"
5. **Verify**: `tmux show-option -qv @lace_port` returns the container port
6. **Verify**: `tmux show-option -p -qv @lace_connected` returns `true`

### 2. Interactive Picker with `--pane`

1. In a tmux session, run `lace-into --pane` (no project name)
2. **Verify**: fzf picker shows running containers
3. Select a container
4. **Verify**: current pane connects to the selected container

### 3. `--pane` Outside tmux

1. From a bare terminal (no tmux), run `lace-into --pane lace`
2. **Verify**: error message: "--pane requires running inside tmux"

### 4. `disconnect-pane`

1. Connect a pane via `lace-into --pane lace`
2. Press `prefix + :`, type `disconnect-pane`, press Enter
3. **Verify**: pane now runs a local nushell shell
4. **Verify**: SSH to the container is no longer active

### 5. `disconnect-pane` Keybinding

1. Connect a pane via `lace-into --pane lace`
2. Press `prefix + D`
3. **Verify**: same behavior as the command-prompt version

### 6. Reconnection After Disconnect

1. `lace-into --pane lace` to connect
2. `disconnect-pane` to drop back to local
3. `lace-into --pane lace` to reconnect
4. **Verify**: pane is back in the container

### 7. Container Switching via `--pane`

1. `lace-into --pane lace` to connect to lace
2. `lace-into --pane dotfiles` to switch to dotfiles (without disconnecting first)
3. **Verify**: pane is now SSH'd into the dotfiles container

### 8. Session-Level Options for lace-split

1. Start a plain tmux session: `tmux new-session -s work`
2. `lace-into --pane lace` in the first pane
3. **Verify**: `tmux show-option -qv @lace_port` is set
4. Press Alt+L to split
5. **Verify**: new pane opens SSH'd into the same container

### 9. `--pane --start`

1. Stop a container: `docker stop <container>`
2. Run `lace-into --pane --start lace`
3. **Verify**: container starts and pane connects

### 10. `--pane --dry-run`

1. Run `lace-into --pane --dry-run lace`
2. **Verify**: prints the `respawn-pane` and `set-option` commands without executing

## Implementation Phases

### Phase 1: `--pane` Flag and `do_connect_pane()`

**Scope**: Changes to `bin/lace-into`.

**Steps**:
1. Add `--pane` to argument parsing (alongside `--start`, `--list`, etc.)
2. Add `PANE_MODE=false` flag, set to `true` when `--pane` is parsed
3. Add `$TMUX` check: if `PANE_MODE=true` and `$TMUX` is empty, exit with error
4. Implement `do_connect_pane()` as specified in the Proposed Solution
5. Route to `do_connect_pane()` instead of `do_connect()` when `PANE_MODE=true`
6. Update `--dry-run` output to show `respawn-pane` commands when in pane mode
7. Update `--help` text to document `--pane`

**Risk**: Low.
`--pane` is an additive flag that does not modify existing codepaths.
`do_connect_pane()` reuses the same `ssh_base` construction as `do_connect()`.

**Validation**: Test plan items 1-3, 7, 9-10.

### Phase 2: `disconnect-pane` Command and Keybinding

**Scope**: Changes to `dot_config/tmux/tmux.conf` (dotfiles repo).

**Steps**:
1. Add `command-alias` registration for `disconnect-pane`
2. Add `prefix + D` keybinding
3. `chezmoi apply` to deploy
4. Reload tmux config

**Risk**: Low.
`respawn-pane -k` is a well-understood tmux command.
`command-alias[100]` uses a high index to avoid collisions with plugin-defined aliases.

**Validation**: Test plan items 4-6.

### Phase 3: Session Option Integration

**Scope**: Verify lace-split interaction.

**Steps**:
1. Connect a pane via `--pane` in a non-lace session
2. Verify session-level options are set
3. Verify Alt+HJKL container-aware splits work
4. Test multi-container warnings

**Risk**: Low.
Session options are set-if-absent, so existing lace sessions are unaffected.

**Validation**: Test plan item 8.
