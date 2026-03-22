---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:35:00-07:00
task_list: session-management/stale-reattach
type: report
state: archived
status: done
tags: [lace-into, tmux, session-management]
---

# Stale Tmux Session Reattach Analysis

> BLUF: When `lace-into` finds an existing tmux session with a matching port, it blindly reattaches without checking whether SSH panes are alive.
> Combined with `remain-on-exit on`, this silently presents dead panes to the user after container restarts.
> Tmux exposes `pane_dead`, `pane_pid`, and `pane_dead_status` format variables that enable reliable health checks before reattach.

## Problem Description

A user runs `lace-into lace` expecting a working SSH connection to their devcontainer.
If a tmux session named "lace" already exists with a matching `@lace_port`, `do_connect()` skips all connection setup and attaches immediately (lines 503-519 of `bin/lace-into`):

```bash
if tmux has-session -t "=$project" 2>/dev/null; then
    local existing_port
    existing_port=$(tmux show-option -t "=$project" -qv @lace_port 2>/dev/null)
    if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
      info "attaching to existing session: $project"
      # ... attach or switch-client ...
      return 0
    fi
fi
```

This code handles one failure mode (port mismatch after container restart) but misses a more common one: the container restarted on the same port, and the SSH processes in the session's panes have exited.

### User impact

1. The user sees a dead pane with no shell prompt and no indication of what went wrong.
2. With `remain-on-exit on`, the pane shows "Pane is dead" text but stays open. The user must manually respawn or kill the pane.
3. The `@lace_port` session option still holds the old port value, which happens to match the new port (port allocation is deterministic for the same workspace folder). The port-mismatch guard does not trigger.
4. The user's mental model: "`lace-into` gives me a working connection" is violated.

## Root Cause Analysis

The reattach logic treats session existence + port match as sufficient proof of a healthy session.
It does not inspect the session's panes.

Three conditions can produce a stale session:

1. **Container restart (same port)**: The sshd port is allocated deterministically from `devcontainer.json` configuration. A `docker restart` or `lace up` cycle produces the same port. The SSH connections in existing panes die, but `@lace_port` still matches.
2. **Container rebuild (same port)**: A `lace up --rebuild` recreates the container. Host keys change, SSH connections break. Port often remains the same.
3. **Network interruption**: SSH connections time out. Panes become dead while the container is still running.

The `remain-on-exit on` setting (set both globally in `tmux.conf` and per-session in `do_connect()` at line 525) keeps dead panes visible instead of closing them.
This is intentional: it preserves scrollback and error messages.
The side effect is that tmux sessions with dead panes remain discoverable via `has-session`, making stale reattach possible.

## Tmux APIs for Pane Health Detection

Tmux provides format variables queryable via `list-panes -F`:

| Variable | Type | Description |
|---|---|---|
| `pane_dead` | Boolean (0/1) | 1 if the pane's process has exited |
| `pane_dead_status` | Integer | Exit code of the process in a dead pane |
| `pane_dead_signal` | String | Signal that killed the process (if applicable) |
| `pane_pid` | Integer | PID of the pane's child process |
| `pane_current_command` | String | Name of the current running command |

Query example:

```bash
tmux list-panes -t "=$project" -F '#{pane_id} #{pane_dead} #{pane_dead_status}'
```

Output for a session with one alive and one dead pane:

```
%0 0
%1 1 255
```

A session is "healthy" if at least one pane has `pane_dead=0`.
A session is "fully dead" if all panes have `pane_dead=1`.
A session is "partially dead" if some panes are dead and others are alive.

## Fix Approaches

### Option A: Kill-and-Recreate

Check pane health before reattach.
If all panes are dead, kill the session and fall through to the new-session creation path.

```bash
if tmux has-session -t "=$project" 2>/dev/null; then
    local existing_port
    existing_port=$(tmux show-option -t "=$project" -qv @lace_port 2>/dev/null)
    if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
      # Check if any panes are alive
      local alive_count
      alive_count=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | grep -c '^0$' || true)
      if [ "$alive_count" -gt 0 ]; then
        info "attaching to existing session: $project"
        # ... attach ...
        return 0
      else
        info "existing session has no live panes, recreating"
        tmux kill-session -t "=$project"
        # fall through to new-session creation
      fi
    fi
fi
```

**Pros**: Simple. User always gets a fresh, working session.
**Cons**: Destroys scrollback from dead panes. If a user had a local pane (non-SSH) in the session, it would also be killed.

### Option B: Respawn Dead Panes in Place

Keep the session, but respawn each dead pane with the current SSH command.

```bash
local dead_panes
dead_panes=$(tmux list-panes -t "=$project" -F '#{pane_id} #{pane_dead}' | awk '$2 == 1 {print $1}')
for pane_id in $dead_panes; do
    tmux respawn-pane -t "$pane_id" "${ssh_base[@]}"
done
```

**Pros**: Preserves session layout. Non-dead panes (e.g., local shells, editors) are untouched.
**Cons**: More complex. `respawn-pane` replaces the dead pane's command but resets scrollback. Requires building `ssh_base` even on the reattach path.

### Option C: Health-Check-First with User Prompt

Check health, then prompt the user: "Session has dead panes. Kill and reconnect? [Y/n]"

**Pros**: No data loss without user consent.
**Cons**: Interactive prompts break scripted usage. Adds friction to the common case (dead panes after restart are almost always unwanted).

### Option D: Hybrid (Recommended)

Combine kill-and-recreate for fully-dead sessions with respawn for partially-dead sessions:

1. If all panes are dead: kill session, create fresh one.
2. If some panes are alive: respawn only the dead panes, refresh host key, reattach.
3. If all panes are alive: reattach (current behavior).

This handles the common case (full restart) cleanly and the edge case (mixed health) gracefully.

```bash
if tmux has-session -t "=$project" 2>/dev/null; then
    local existing_port
    existing_port=$(tmux show-option -t "=$project" -qv @lace_port 2>/dev/null)
    if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
      local total_panes alive_panes
      total_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | wc -l)
      alive_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | grep -c '^0$' || true)

      if [ "$alive_panes" -eq "$total_panes" ]; then
        # All alive: reattach
        info "attaching to existing session: $project"
        # ... attach ...
        return 0
      elif [ "$alive_panes" -eq 0 ]; then
        # All dead: kill and recreate
        info "session $project has no live panes, recreating"
        tmux kill-session -t "=$project"
        # fall through to new-session
      else
        # Mixed: respawn dead panes, then reattach
        info "respawning $((total_panes - alive_panes)) dead pane(s) in session $project"
        refresh_host_key "$port"
        local dead_panes
        dead_panes=$(tmux list-panes -t "=$project" -F '#{pane_id} #{pane_dead}' \
                     | awk '$2 == 1 {print $1}')
        for pane_id in $dead_panes; do
            tmux respawn-pane -t "$pane_id" "${ssh_base[@]}"
        done
        # ... attach ...
        return 0
      fi
    fi
fi
```

## Interaction with `remain-on-exit on`

The `remain-on-exit on` setting is the direct enabler of the stale reattach problem.
Without it, dead panes would close automatically and tmux would destroy empty sessions.
The session would not exist for `has-session` to find.

Removing `remain-on-exit on` is not a viable fix because:

1. It serves a real purpose: preserving error output when SSH connections fail during initial setup.
2. Users rely on it to see why a connection failed (auth errors, host key mismatches, network issues).
3. It is set both in `tmux.conf` globally and in `do_connect()` per-session, so it is an intentional choice.

The correct approach is to keep `remain-on-exit on` and add health checks to `lace-into`.
The setting preserves diagnostic information; `lace-into` should consume that information (via `pane_dead`) rather than ignoring it.

## Edge Cases

### Multiple panes, all SSH

The lace-split keybinding (Alt-S) creates additional SSH panes in the same session using the `@lace_port`/`@lace_user`/`@lace_workspace` session options.
After a container restart, all SSH panes die simultaneously.
This is the "all dead" case: kill and recreate is correct.

### Mixed alive and dead panes

A user might have:
- One dead SSH pane (container restarted).
- One alive local shell pane (running a log tail, local build, etc.).

Killing the entire session would destroy the local shell.
The respawn approach in Option D handles this correctly.

### User has unsaved work in a local pane

If the session contains a pane running `vim` or another editor on local files, killing the session loses unsaved work.
This is only a risk with the kill-and-recreate approach on a mixed-health session.
Option D avoids this: it only kills when all panes are dead (no editor could be running), and respawns individual panes when some are alive.

### Port changed but session has the old port

This is already handled by the existing port-mismatch logic (line 514-518): a new session is created with a disambiguated name (`project-port`).
The stale session with the old port remains but is not reattached.
A follow-up improvement could kill the old stale session when creating the disambiguated one.

### Container healthy but SSH timed out

The pane is dead, but the container is fine.
Respawning the pane with the same SSH command reconnects to the running container.
This works correctly with all proposed approaches.

### Host key rotation after rebuild

When a container is rebuilt, its SSH host keys change.
The `refresh_host_key()` function (lines 410-434) handles this by removing stale entries and re-scanning.
The fix must call `refresh_host_key()` before respawning panes, which Option D does.
The kill-and-recreate path falls through to the new-session code, which already calls `refresh_host_key()`.

### Session exists but `list-panes` fails

If `list-panes` returns no output (should not happen for a valid session), the `alive_panes` count would be 0 and `total_panes` would be 0.
The `alive_panes -eq total_panes` check (0 == 0) would treat this as "all alive" and reattach.
A guard for `total_panes -eq 0` should fall through to kill-and-recreate.

## Recommendation

Option D (hybrid) is the recommended approach.
It handles all identified edge cases, preserves user work in mixed-health sessions, and adds minimal complexity to the existing `do_connect()` function.

The implementation requires approximately 15 lines of additional bash in `do_connect()`, using only standard tmux commands (`list-panes`, `respawn-pane`, `kill-session`) that are available in all supported tmux versions (3.0+).
