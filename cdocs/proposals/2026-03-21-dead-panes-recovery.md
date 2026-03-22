---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:50:00-07:00
task_list: session-management/dead-panes
type: proposal
state: archived
status: implementation_accepted
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T23:15:00-07:00
  round: 1
tags: [lace-into, tmux, session-management]
---

# Dead Panes Recovery on Container Rebuild

> BLUF: Container rebuilds kill all SSH panes in the tmux session, leaving "Pane is dead" placeholders that require manual cleanup.
> Fix with a three-phase hybrid: switch `remain-on-exit` from `on` to `failed` (clean exits close normally), add a per-session `pane-died` hook with sleep-based rate limiting for auto-respawn, and add a `prefix + R` keybinding to respawn all dead panes in one keystroke.

## Problem Statement

When a devcontainer is rebuilt, Docker kills the sshd process, breaking all SSH connections in the tmux session.
Because `lace-into` sets `remain-on-exit on` at the session level, every pane persists as a "Pane is dead" placeholder instead of closing.
The user must manually `respawn-pane` each one (typically 3-5 panes), breaking flow on every rebuild.

The full analysis is in `cdocs/reports/2026-03-21-dead-panes-analysis.md`.

## Proposed Solution

Hybrid approach combining three changes across `bin/lace-into` and `dot_config/tmux/tmux.conf`.

### Change 1: `remain-on-exit failed` (lace-into)

Replace `remain-on-exit on` with `remain-on-exit failed` in `do_connect()` (line 525).

**Behavior**: Panes that exit with status 0 (user types `exit`) close normally.
Panes that exit non-zero (SSH connection failure, status 255) persist for inspection.

This does not solve the rebuild case directly: SSH exits 255 when the container is killed, so dead panes still persist.
It solves the adjacent annoyance of panes lingering after intentional `exit`.

### Change 2: `pane-died` Hook with Auto-Respawn (lace-into)

Add a per-session `pane-died` hook in `do_connect()` that auto-respawns dead panes after a delay.

```bash
# In do_connect(), after setting remain-on-exit:
tmux set-hook -t "$project" pane-died \
  'run-shell "sleep 3 && tmux respawn-pane -t #{pane_id} 2>/dev/null || true"'
```

**Behavior**: When a pane dies, tmux waits 3 seconds (giving the container time to restart sshd), then re-runs the original SSH command via `respawn-pane`.
`respawn-pane` without arguments re-executes the exact command that created the pane, preserving port, user, key paths, and workspace directory.

#### Rate Limiting via Sleep

The report identifies infinite respawn loops as the primary risk: if the container is permanently gone, each failed respawn fires another `pane-died`, creating unbounded retries.

Per-pane retry counters are difficult in tmux hooks (no native per-pane state, and environment variable manipulation inside hooks is fragile).
A simpler approach: the `sleep 3` in `run-shell` acts as a natural rate limiter.

How it works:
1. SSH pane dies. `pane-died` fires.
2. Hook executes `run-shell "sleep 3 && tmux respawn-pane ..."`.
3. `run-shell` is synchronous from tmux's perspective for that pane: the pane is in dead state during the sleep.
4. After 3 seconds, `respawn-pane` runs the SSH command.
5. If the container is back, SSH connects and the pane is alive. No further `pane-died` fires.
6. If the container is still down, SSH fails quickly (connection refused), the pane dies again, and `pane-died` fires again.
7. The next iteration sleeps another 3 seconds before retrying.

This gives a ~3-second interval between retries: not ideal for a permanently-gone container, but tolerable.
The SSH connection-refused failure is near-instant, so the cycle is dominated by the sleep.

If the container comes back after 30 seconds of rebuilding, the hook retries approximately 10 times before succeeding.
Each retry is a lightweight `ssh -p <port> localhost` that fails immediately with "Connection refused."
This is acceptable.

#### Scope: Lace Sessions Only

The hook is set per-session via `set-hook -t "$project"`, not globally.
It only fires for sessions created by `lace-into` (those with `@lace_port` set).
Non-lace tmux sessions are unaffected.

### Change 3: Respawn-All Keybinding (tmux.conf)

Add a keybinding in `dot_config/tmux/tmux.conf` to respawn all dead panes in the current session.

```tmux
# Respawn all dead panes in the current session (prefix + R)
bind R run-shell 'for pane_id in $(tmux list-panes -s -F "#{?pane_dead,#{pane_id},}" | grep .); do tmux respawn-pane -t "$pane_id"; done'
```

**Use case**: Fallback when the auto-respawn hook has given up, or when the user wants immediate control (e.g., container is back, no need to wait for the next retry cycle).

This keybinding is global (applies to all sessions), which is fine: `respawn-pane` is a no-op on live panes, and non-lace sessions rarely have dead panes.

## Interaction with Stale Reattach Fix

The stale reattach problem (Issue 1) is about what `lace-into` does when it finds an existing session with dead panes after a rebuild.
The dead panes problem (this proposal) is about what happens to panes while the user is attached.

These fixes are complementary:

- The **stale reattach fix** (health check in `do_connect()`) provides explicit reconnection when the user runs `lace-into` after a rebuild.
  It can update `@lace_port` if the port changed and respawn panes with the new connection details.
- The **`pane-died` hook** (this proposal) provides automatic resilience for container bounces that happen while the user is already attached.
  The user does not need to re-run `lace-into`: panes respawn on their own once the container is back.

Neither fix subsumes the other:
- Without the hook, a container bounce during an active session requires the user to notice the dead panes, switch to a local shell, and re-run `lace-into`.
- Without the reattach fix, running `lace-into` after a rebuild blindly reattaches to a session that may have dead panes (which the hook may or may not have recovered).

## Implementation Phases

### Phase 1: `remain-on-exit failed`

**Scope**: Single line change in `bin/lace-into`.

**Changes**:
- Line 525: `remain-on-exit on` to `remain-on-exit failed`
- Line 470 (dry-run output): update to match

**Risk**: Low.
The only behavioral difference is that zero-exit panes close instead of lingering.
SSH exits 255 on connection errors, so the diagnostic-preservation behavior is unchanged.

**Validation**: Open a lace session, type `exit` in the remote shell, confirm the pane closes instead of showing "Pane is dead."

### Phase 2: `pane-died` Hook

**Scope**: Add `set-hook` call in `do_connect()` after the `remain-on-exit` line.

**Changes**:
```bash
# After: tmux set-option -t "$project" remain-on-exit failed
tmux set-hook -t "$project" pane-died \
  'run-shell "sleep 3 && tmux respawn-pane -t #{pane_id} 2>/dev/null || true"'
```

**Risk**: Moderate.
The infinite retry concern is mitigated by the sleep-based rate limiter, but a permanently unreachable container produces ongoing (slow) retries.
This is a background process consuming negligible resources, but the user should be aware of it.

**Validation**:
1. Connect to a container via `lace-into`.
2. Stop the container (`docker stop <name>`).
3. Observe the pane die and the hook fire after 3 seconds.
4. Start the container (`docker start <name>`).
5. Observe the pane reconnect on the next retry.
6. Verify non-lace sessions are unaffected.

### Phase 3: Respawn-All Keybinding

**Scope**: Add keybinding to `dot_config/tmux/tmux.conf` (dotfiles repo).

**Changes**:
```tmux
# Respawn all dead panes in the current session
bind R run-shell 'for pane_id in $(tmux list-panes -s -F "#{?pane_dead,#{pane_id},}" | grep .); do tmux respawn-pane -t "$pane_id"; done'
```

**Risk**: Low.
`prefix + R` is unbound by default in tmux.
`respawn-pane` is a no-op on live panes.

**Validation**: Kill multiple panes in a session, press `prefix + R`, confirm all respawn.

## Testing Plan

### Unit Tests (Manual)

1. **Clean exit closes pane**: SSH into container, type `exit`, confirm pane closes (no "Pane is dead").
2. **Connection failure preserves pane**: SSH to a non-existent port, confirm pane stays with error message visible.
3. **Auto-respawn on container stop/start**: Stop container, observe pane die, start container, observe pane reconnect within ~6 seconds.
4. **Rate limiting**: Stop container and leave it stopped for 30 seconds. Observe retries at ~3-second intervals (not a tight loop).
5. **Respawn-all keybinding**: Kill 3 panes, press `prefix + R`, confirm all 3 respawn.
6. **Non-lace session isolation**: Create a non-lace tmux session, kill a pane, confirm no auto-respawn fires.
7. **lace-split panes**: Open a split via `Alt-S`, stop the container, confirm the split also auto-respawns.

### Integration Tests

1. **Full rebuild cycle**: Run `lace up --rebuild`, observe all panes die and reconnect after the container is back.
2. **Port stability**: Confirm `@lace_port` matches the respawned SSH command's port.
   Lace's port allocation is deterministic, so the port should not change across rebuilds.
3. **tmux-resurrect interaction**: Save sessions via resurrect, kill tmux server, restore.
   Confirm restored lace sessions have the `pane-died` hook re-applied by the next `lace-into` invocation.
   Resurrect does not restore hooks: this is a known limitation.
   The user must re-run `lace-into` after a resurrect to re-establish the hook.

## Risks

### Infinite Respawn on Permanently-Gone Containers

If the container is deleted (not just stopped), the SSH command fails repeatedly at ~3-second intervals.
Each retry is lightweight (connection refused is instant), but the retries continue until the tmux session is killed.

Mitigations:
- The 3-second sleep prevents CPU waste.
- The pane shows "Pane is dead" between retries, so the user has visual feedback.
- The user can kill the pane or session to stop retries.
- A future enhancement could add a retry counter via tmux pane environment variables, stopping after N failures.

### tmux-resurrect Does Not Restore Hooks

`tmux-resurrect` saves session layout and pane commands but not session-level hooks.
After a resurrect, lace sessions lack the `pane-died` hook.
The panes will have dead SSH commands that resurrect attempts to restart, but without the hook, future pane deaths are not auto-respawned.

Mitigation: Re-running `lace-into <project>` reattaches to the existing session and could re-apply the hook.
This requires a change to `do_connect()` to set the hook on reattach, not just on session creation.

> TODO(opus/session-management): Extend `do_connect()` to re-apply `set-hook` and `remain-on-exit` when reattaching to an existing session, not just when creating a new one.
> This ensures hooks survive tmux-resurrect restores.

### Port Changes After Rebuild

If the container comes back on a different port (rare with lace's deterministic port allocation, but possible if the devcontainer config changed), the respawned SSH command uses the stale port.
The respawn fails, and the hook retries indefinitely against the wrong port.

Mitigation: This is addressed by the stale reattach fix (Issue 1), which updates `@lace_port` on `lace-into` invocation.
Until that fix lands, the user must kill the session and re-run `lace-into` if the port changes.
