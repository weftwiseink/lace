---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:35:00-07:00
task_list: session-management/dead-panes
type: report
state: live
status: wip
tags: [lace-into, tmux, session-management]
---

# Dead Panes on Container Rebuild: Analysis

> BLUF: When a devcontainer is rebuilt via `lace up --rebuild`, all SSH panes in the tmux session die.
> Because `lace-into` sets `remain-on-exit on` at the session level, these dead panes persist as "Pane is dead" placeholders instead of closing.
> The user must manually respawn or kill each one.
> The best fix is `remain-on-exit failed` combined with a `pane-died` hook that auto-respawns SSH panes after a delay, giving the container time to come back up.

## Problem Description

### User Workflow

1. User runs `lace-into lace` to connect to a devcontainer.
   `lace-into` creates a tmux session with an SSH pane to the container.
2. User opens additional panes via `Alt-S` (lace-split), each SSHing into the same container.
3. User rebuilds the container: `lace up --rebuild` or `lace-into --start --rebuild lace`.
4. The container stops, destroying the sshd process.
   All SSH connections in all panes terminate.
5. Every pane shows "Pane is dead" and becomes unresponsive.
6. User must manually intervene: `respawn-pane` on each pane, or kill the session and re-run `lace-into`.

This is disruptive.
A typical session has 3-5 panes.
Manual cleanup after every rebuild breaks flow.

### Why It Matters

Container rebuilds are not rare events.
They happen when `devcontainer.json` changes, when features are updated, or when the user explicitly wants a fresh environment.
The rebuild-reconnect cycle should be as seamless as possible.

## Root Cause

### Why `remain-on-exit on` Exists

`lace-into` sets `remain-on-exit on` at the session level (`bin/lace-into`, line 525) to prevent pane flash-and-die on transient SSH errors.

Without it, if SSH fails to connect (wrong key, container not ready, port mismatch), the pane executes the SSH command, SSH exits non-zero, and tmux immediately destroys the pane.
The user sees a brief flash and then the pane vanishes.
In a single-pane session, this kills the entire tmux session with no feedback about what went wrong.

`remain-on-exit on` solves this by keeping the pane alive after the command exits, showing the SSH error output and the "Pane is dead" message.
The user can read the error and decide what to do.

### Why It Causes Dead Pane Accumulation

The setting is session-level, meaning it applies to every pane in the session.
When a container rebuild kills all SSH connections, every pane transitions to "dead" state simultaneously.
None of them close.
The session remains attached, full of dead panes, requiring manual cleanup.

The setting has no intelligence: it cannot distinguish between "SSH failed on first connection" (where preserving the pane is useful for diagnostics) and "container was rebuilt" (where the user wants automatic recovery).

## Tmux Mechanisms for Dead Pane Handling

### `remain-on-exit` Option

**Values** (tmux 3.5a):
- `off`: Pane closes immediately when the command exits.
  Default behavior.
- `on`: Pane stays visible after exit regardless of exit status.
  Shows `remain-on-exit-format` text at the bottom.
- `failed`: Pane stays visible only if the command exited with a non-zero status.
  Clean exits (status 0) cause the pane to close normally.

**Scope**: Window option.
Can be set per-session (affecting all windows/panes in the session), per-window, or overridden per-pane using `set-option -p`.

The `failed` value is particularly relevant: SSH exits with status 255 on connection errors, but exits 0 when the connection is closed cleanly by the remote end (e.g., `exit` typed in shell) or when the remote host goes away gracefully.

> NOTE(opus/session-management): The exit status of SSH when the remote sshd is killed (container stop/rebuild) depends on how the TCP connection terminates.
> If the connection is reset (RST), SSH exits non-zero (255).
> If the connection times out via `ServerAliveInterval`, SSH also exits 255.
> If the remote end sends a clean disconnect, SSH exits 0.
> Container stop/rebuild almost always produces a non-zero exit because Docker terminates processes abruptly.

### `pane-died` Hook

Fires when a pane's command exits but the pane is kept alive due to `remain-on-exit`.
Does not fire if `remain-on-exit` is `off` (the pane closes before the hook could run).

Available format variables in the hook context:
- `#{pane_dead}`: 1 if pane is dead.
- `#{pane_dead_status}`: Exit status of the dead process.
- `#{pane_dead_signal}`: Signal that killed the process (if applicable).
- `#{pane_dead_time}`: Timestamp when the process exited.
- `#{pane_id}`: Unique pane identifier (e.g., `%5`).

Example usage:

```tmux
set-hook -g pane-died 'if-shell "[ #{pane_dead_status} -ne 0 ]" "respawn-pane"'
```

### `respawn-pane` Command

Reactivates a dead pane by re-running its original command (or a new command if specified).
The pane must be in the dead state unless `-k` is given.

Key properties:
- Without arguments, re-runs the exact command that created the pane.
  For lace SSH panes, this means the full `ssh -o ... -p <port> user@localhost` command.
- `-c <dir>`: Override the working directory.
- `-e VAR=val`: Set environment variables.
- `-k`: Kill any running command first (allows respawning active panes).

This is the primary recovery mechanism.
After a container rebuild, `respawn-pane` on each dead pane re-executes the SSH command, which reconnects to the new container (assuming the same port and user).

### `set-option -p` (Per-Pane Override)

`remain-on-exit` can be overridden per-pane:

```tmux
tmux set-option -p -t %5 remain-on-exit off
```

This allows setting `remain-on-exit on` at session level for new SSH panes (protecting against initial connection failures) while clearing it on panes that have successfully connected (so they close cleanly on normal exit).

## Fix Approaches

### Option A: Use `remain-on-exit failed`

Change line 525 of `lace-into` from `remain-on-exit on` to `remain-on-exit failed`.

**Behavior change**: Panes only persist if the command exited non-zero.
A clean `exit 0` from the remote shell closes the pane normally.

**Impact on the dead-pane problem**:
When a container is rebuilt, Docker kills sshd abruptly.
SSH detects the broken connection and exits with status 255.
The pane remains visible with the error message, same as today.

This does not solve the dead-pane-on-rebuild problem because rebuild causes non-zero exits.

**What it does solve**: Panes where the user types `exit` in the remote shell no longer linger as dead panes.
This is a quality-of-life improvement but not a fix for the rebuild case.

**Risk**: Low.
The only behavioral difference is that zero-exit panes close instead of lingering.

### Option B: `pane-died` Hook with Auto-Respawn

Add a `pane-died` hook (in `lace-into`'s `do_connect()` or in `tmux.conf`) that automatically respawns dead panes after a delay.

```tmux
set-hook -t "$project" pane-died \
  'run-shell "sleep 5 && tmux respawn-pane -t #{pane_id}"'
```

**Behavior**: When any pane dies, wait 5 seconds (giving the container time to restart sshd), then re-run the original command.

**Advantages**:
- Fully automatic recovery.
  No user intervention needed.
- `respawn-pane` without arguments re-runs the exact SSH command, preserving port, user, and workspace.
- The delay accommodates container startup time.

**Risks and complications**:
- **Infinite respawn loop**: If the container is permanently gone or the port changed, the SSH command fails repeatedly.
  Each failure triggers another `pane-died` event, creating an infinite loop.
  Mitigation: count respawn attempts (via a tmux environment variable) and stop after N failures.
- **Race with `lace-into` reattach**: If the user runs `lace-into` after a rebuild, it may find the existing session and reattach.
  Meanwhile the hook is trying to respawn panes.
  These are not necessarily in conflict (respawn is per-pane, reattach is per-session), but the interaction needs thought.
- **Port changes**: If the container comes back on a different port (rare with lace's port allocation, but possible), the respawned SSH command uses the old port and fails.
  The `@lace_port` session option would also be stale.

**Retry limit pattern**:

```tmux
set-hook -t "$project" pane-died \
  'if-shell "[ #{pane_dead_status} -ne 0 ]" \
    "run-shell \"sleep 5 && tmux respawn-pane -t #{pane_id} 2>/dev/null || true\""'
```

A more robust version would track attempt count, but tmux hooks have limited state.
Per-pane environment variables could serve as a counter, but the complexity grows quickly.

### Option C: Dead Panes Fall Back to Local Shell

Instead of running bare SSH as the pane command, wrap it in a script that falls back to a local shell on failure:

```bash
ssh <opts> user@localhost || exec $SHELL
```

**Behavior**: If SSH fails, the pane spawns a local shell instead of dying.
The user lands in a local shell and can manually reconnect.

**Advantages**:
- Pane never dies, so `remain-on-exit` is irrelevant.
- The user has a shell to work with (can re-run SSH, check container status, etc.).
- No infinite loop risk.

**Disadvantages**:
- The pane is no longer "in the container."
  The user has a local shell they did not ask for.
- The pane title still says "shell" but it is a local shell, which is confusing.
- The `Alt-S` split command generates bare SSH commands, not wrapped ones.
  Modifying the split keybinding to wrap SSH adds complexity.
- `respawn-pane` re-runs the wrapper, but the SSH portion may still fail.

**Variant**: Fall back to a shell that auto-retries SSH with a visible countdown:

```bash
ssh <opts> user@localhost
while [ $? -ne 0 ]; do
  echo "Connection lost. Retrying in 5s... (Ctrl-C to stop)"
  sleep 5
  ssh <opts> user@localhost
done
```

This is more user-friendly but requires wrapping every SSH invocation in a retry script.

### Option D: `respawn-pane` via Keybinding

Add a keybinding (e.g., `prefix + R`) that respawns the current pane:

```tmux
bind R respawn-pane
```

**Behavior**: Manual but fast.
After a rebuild, the user presses `prefix + R` in each dead pane to reconnect.

**Advantages**:
- Simple, no magic.
- User controls when to reconnect (useful if they want to read the error first).
- No risk of infinite loops or port mismatch surprises.

**Disadvantages**:
- Still manual.
  With 5 panes, that is 5 keystrokes plus navigation.
- Does not address the "I want it to just work" expectation.

**Enhancement**: Combine with a "respawn all dead panes" command:

```tmux
bind R run-shell 'for pane_id in $(tmux list-panes -s -F "#{?pane_dead,#{pane_id},}" | grep .); do tmux respawn-pane -t "$pane_id"; done'
```

This respawns all dead panes in the current session with a single keystroke.

### Option E: Hybrid Approach (Recommended)

Combine options A, B, and D:

1. **Switch to `remain-on-exit failed`** (Option A): Panes that exit cleanly (user types `exit`) close normally.
   Panes that die from connection errors persist for inspection.

2. **Add a `pane-died` hook with bounded retry** (Option B): Auto-respawn dead panes after a delay, but limit to 3 attempts.
   On the 4th failure, leave the pane dead for manual inspection.

3. **Add a "respawn all" keybinding** (Option D): Fallback for cases where auto-respawn gives up or the user wants immediate control.

Implementation sketch for `do_connect()`:

```bash
tmux set-option -t "$project" remain-on-exit failed
tmux set-hook -t "$project" pane-died \
  'respawn-pane -t "#{pane_id}"'
```

> NOTE(opus/session-management): The bounded retry in tmux hooks is difficult without external state.
> tmux hooks cannot easily track per-pane retry counts.
> A simpler approach: respawn once on `pane-died`, and if the respawned pane dies again within 10 seconds, leave it dead.
> This can be approximated by checking `#{pane_dead_time}` against the current time, but tmux format strings have limited arithmetic.

## Tradeoff Summary

| Approach | Auto-recovery | Prevents flash-and-die | Infinite loop risk | Complexity |
|----------|--------------|----------------------|-------------------|------------|
| A: `failed` | No | Partial (non-zero only) | None | Trivial |
| B: `pane-died` hook | Yes | Yes | Yes (mitigable) | Moderate |
| C: Local shell fallback | Yes (to local shell) | Yes | None | High (wrapper scripts) |
| D: Keybinding | No (manual) | No | None | Trivial |
| E: Hybrid (A+B+D) | Yes | Yes | Mitigated | Moderate |

## Interaction with Issue 1: Stale Reattach

Issue 1 is the problem where `lace-into <project>` blindly reattaches to an existing tmux session without checking whether its panes are alive or connected.
After a rebuild, the user runs `lace-into lace` expecting a fresh connection, but gets reattached to a session full of dead panes.

The dead-pane problem and the stale-reattach problem are closely related but distinct:

- **Dead panes** is about what happens to existing SSH connections when the container goes away.
  It is a tmux-layer problem.
- **Stale reattach** is about what `lace-into` does when it finds an existing session.
  It is a lace-into-layer problem.

Fixing one does not fix the other, but they interact:

- If dead panes auto-respawn (Option B/E), then stale reattach is less painful: the user reattaches and finds panes that are reconnecting or already reconnected.
  But if the port changed, the respawned connections fail.
- If `lace-into` detects stale sessions and refreshes them (Issue 1 fix), it could also respawn dead panes as part of the refresh, making the `pane-died` hook less necessary.
- The cleanest resolution addresses both: `lace-into` detects the session, checks for dead panes, updates `@lace_port` if the port changed, and respawns panes with the updated connection details.
  This is a coordinated fix across both issues.

A `pane-died` hook (Option B) provides immediate resilience at the tmux layer without waiting for the `lace-into` reattach fix.
The two fixes are complementary: the hook handles the "container bounced but came back quickly" case, while the `lace-into` fix handles the "user explicitly reconnects after a rebuild" case.
