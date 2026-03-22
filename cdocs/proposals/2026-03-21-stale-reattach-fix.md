---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:50:00-07:00
task_list: session-management/stale-reattach
type: proposal
state: live
status: wip
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T23:15:00-07:00
  round: 1
tags: [lace-into, tmux, session-management]
---

# Fix Stale Tmux Session Reattach

> BLUF: `lace-into` blindly reattaches to tmux sessions with dead SSH panes after container restarts.
> This proposal adds pane health checks to `do_connect()` using tmux's `pane_dead` format variable, implementing a hybrid strategy: kill fully-dead sessions, respawn individual dead panes in mixed-health sessions, reattach when all panes are alive.

## Problem Statement

When `lace-into` finds an existing tmux session with a matching `@lace_port`, it reattaches without checking whether the SSH panes are alive.
Combined with `remain-on-exit on`, this silently presents dead panes after container restarts.
The user expects a working SSH connection but gets a "Pane is dead" message with no automatic recovery.

See `cdocs/reports/2026-03-21-stale-reattach-analysis.md` for the full root cause analysis and edge case enumeration.

## Proposed Solution

Add a three-way health check to `do_connect()` between the session-existence check and the attach/switch-client call.
The check queries `tmux list-panes -F '#{pane_dead}'` to classify the session:

1. **All panes alive**: Reattach immediately (current behavior, no change).
2. **All panes dead**: Kill the session, fall through to the new-session creation path.
3. **Mixed (some alive, some dead)**: Refresh host keys, respawn only dead panes with the current SSH command, then reattach.

This is Option D (hybrid) from the analysis report.

### Key Design Decisions

**`ssh_base` is already available on the reattach path.**
The current `do_connect()` constructs `ssh_base` at line 480 (before the session-existence check at line 503).
The respawn path can use it directly: no restructuring needed.

**`respawn-pane` must receive an explicit command.**
Calling `respawn-pane` without arguments re-runs the pane's original command, which may reference a stale port or user.
Passing `"${ssh_base[@]}"` explicitly ensures the respawned pane uses current connection details.

**`refresh_host_key()` must precede respawn.**
Container rebuilds change host keys.
The kill-and-recreate path already calls `refresh_host_key()` (it falls through to the new-session code at line 522).
The respawn path must call it explicitly before issuing `respawn-pane`.

**Guard against `total_panes=0`.**
If `list-panes` returns no output for a valid session (unexpected but defensive), both `total_panes` and `alive_panes` would be 0.
The `alive_panes -eq total_panes` check would evaluate `0 == 0` (true), incorrectly treating the session as healthy.
An explicit guard treats `total_panes=0` as fully-dead.

**`@lace_port` update on port change is out of scope.**
The existing port-mismatch logic (lines 514-518) creates a disambiguated session name when the port changes.
Updating `@lace_port` on an existing session is a separate concern and not addressed here.

## Implementation Phases

### Phase 1: Add Pane Health Check to `do_connect()`

Replace the unconditional reattach block (lines 506-513) with a three-way health check.

The existing code:

```bash
    if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
      info "attaching to existing session: $project"
      if [ -n "$TMUX" ]; then
        tmux switch-client -t "=$project"
      else
        exec tmux attach-session -t "=$project"
      fi
      return 0
    fi
```

Becomes:

```bash
    if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
      local total_panes alive_panes
      total_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | wc -l)
      alive_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | grep -c '^0$' || true)

      if [ "$total_panes" -gt 0 ] && [ "$alive_panes" -eq "$total_panes" ]; then
        # All panes alive: reattach
        info "attaching to existing session: $project"
        if [ -n "$TMUX" ]; then
          tmux switch-client -t "=$project"
        else
          exec tmux attach-session -t "=$project"
        fi
        return 0
      elif [ "$alive_panes" -gt 0 ]; then
        # Mixed: respawn dead panes, then reattach
        info "respawning $((total_panes - alive_panes)) dead pane(s) in session $project"
        refresh_host_key "$port"
        local dead_panes
        dead_panes=$(tmux list-panes -t "=$project" -F '#{pane_id} #{pane_dead}' \
                     | awk '$2 == 1 {print $1}')
        for pane_id in $dead_panes; do
            tmux respawn-pane -t "$pane_id" "${ssh_base[@]}"
        done
        if [ -n "$TMUX" ]; then
          tmux switch-client -t "=$project"
        else
          exec tmux attach-session -t "=$project"
        fi
        return 0
      else
        # All dead (or zero panes): kill and recreate
        info "session $project has no live panes, recreating"
        tmux kill-session -t "=$project"
        # fall through to new-session creation
      fi
    fi
```

### Phase 2: Guard for `total_panes=0`

Handled inline in Phase 1.
The condition `[ "$total_panes" -gt 0 ] && [ "$alive_panes" -eq "$total_panes" ]` ensures that 0/0 falls through to the kill-and-recreate branch.
When `alive_panes=0` and `total_panes=0`, neither the all-alive nor the mixed branch triggers, so execution reaches the else (all-dead) branch.

### Phase 3: Update `@lace_port` on Respawn (Future)

> NOTE(opus/stale-reattach): This phase is deferred.
> The current port-mismatch logic already handles port changes by creating a disambiguated session.
> Updating `@lace_port` in-place would require also updating `@lace_user` and `@lace_workspace`, and the interaction with the disambiguated session naming needs design.

If a container rebuilds onto a different port, the existing port-mismatch guard catches it.
For the same-port case (the common scenario), `@lace_port` already matches and no update is needed.

## Code Diff

The complete change to `do_connect()` in `bin/lace-into`.
Context: lines 501-519 of the current file.

```diff
   # Check for existing session.
   # Verify the session's @lace_port matches to avoid name collisions.
   if tmux has-session -t "=$project" 2>/dev/null; then
     local existing_port
     existing_port=$(tmux show-option -t "=$project" -qv @lace_port 2>/dev/null)
     if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
-      info "attaching to existing session: $project"
-      if [ -n "$TMUX" ]; then
-        tmux switch-client -t "=$project"
-      else
-        exec tmux attach-session -t "=$project"
-      fi
-      return 0
+      local total_panes alive_panes
+      total_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | wc -l)
+      alive_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | grep -c '^0$' || true)
+
+      if [ "$total_panes" -gt 0 ] && [ "$alive_panes" -eq "$total_panes" ]; then
+        # All panes alive: reattach
+        info "attaching to existing session: $project"
+        if [ -n "$TMUX" ]; then
+          tmux switch-client -t "=$project"
+        else
+          exec tmux attach-session -t "=$project"
+        fi
+        return 0
+      elif [ "$alive_panes" -gt 0 ]; then
+        # Mixed: respawn dead panes, then reattach
+        info "respawning $((total_panes - alive_panes)) dead pane(s) in session $project"
+        refresh_host_key "$port"
+        local dead_panes
+        dead_panes=$(tmux list-panes -t "=$project" -F '#{pane_id} #{pane_dead}' \
+                     | awk '$2 == 1 {print $1}')
+        for pane_id in $dead_panes; do
+            tmux respawn-pane -t "$pane_id" "${ssh_base[@]}"
+        done
+        if [ -n "$TMUX" ]; then
+          tmux switch-client -t "=$project"
+        else
+          exec tmux attach-session -t "=$project"
+        fi
+        return 0
+      else
+        # All dead (or zero panes): kill and recreate
+        info "session $project has no live panes, recreating"
+        tmux kill-session -t "=$project"
+        # fall through to new-session creation
+      fi
     fi
   fi
```

## Testing Plan

All scenarios assume a tmux session named `test` with `@lace_port` set and `remain-on-exit on`.

### Scenario 1: All Panes Dead (Container Restart)

1. Start a lace session: `lace-into test`.
2. Kill the container: `docker stop <container>`.
3. Wait for panes to show "Pane is dead".
4. Restart the container: `docker start <container>` (same port).
5. Run `lace-into test` again.
6. **Expected**: Session is killed and recreated with a fresh SSH connection. Log message: "session test has no live panes, recreating".

### Scenario 2: Mixed Health (One Dead, One Alive)

1. Start a lace session: `lace-into test`.
2. Split the pane: press the lace-split keybinding (Alt-S) to create a second SSH pane.
3. In a separate terminal, manually kill one SSH process: find the pane's PID via `tmux list-panes -t test -F '#{pane_pid}'` and `kill` it.
4. Verify one pane is dead: `tmux list-panes -t test -F '#{pane_id} #{pane_dead}'` should show one `0` and one `1`.
5. Run `lace-into test` again.
6. **Expected**: Only the dead pane is respawned. The alive pane is untouched. Log message: "respawning 1 dead pane(s) in session test".

### Scenario 3: All Panes Alive (Normal Reattach)

1. Start a lace session: `lace-into test`.
2. Detach: `tmux detach`.
3. Run `lace-into test` again.
4. **Expected**: Reattach with no health-check output. Log message: "attaching to existing session: test". Identical to current behavior.

### Scenario 4: Container Rebuild (Host Key Change)

1. Start a lace session: `lace-into test`.
2. Rebuild the container: `lace up --rebuild test`.
3. Wait for panes to die.
4. Run `lace-into test` again.
5. **Expected**: Session is killed and recreated. `refresh_host_key()` is called (via the new-session path). No host key mismatch errors.

### Scenario 5: Zero Panes (Defensive)

1. Manually create a degenerate session: `tmux new-session -d -s test` then kill all panes except the session itself (difficult to achieve in practice).
2. Run `lace-into test` with a matching port.
3. **Expected**: Falls through to kill-and-recreate. Does not incorrectly treat 0/0 as "all alive".

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `tmux list-panes` output format changes across versions | Low | Pane health check fails, falls through to kill-and-recreate (safe default) | The `pane_dead` format variable has been stable since tmux 2.6. Lace targets tmux 3.0+. |
| `respawn-pane` fails (e.g., SSH connection refused) | Medium | Pane respawns but immediately dies again, showing the SSH error | `remain-on-exit on` preserves the error message. The user sees the failure and can retry or investigate. No worse than current behavior. |
| Race between health check and pane state change | Low | A pane dies between the `list-panes` query and the `attach-session` call | The user would see a freshly-dead pane. Running `lace-into` again would trigger the respawn path. Acceptable UX. |
| Respawn uses `ssh_base` with workspace path, but pane was originally created without one | Low | Pane respawns into the workspace directory instead of the root | This is actually an improvement: workspace-aware panes are the intended default. |
| Kill-and-recreate destroys scrollback in dead panes | Medium | Diagnostic output from failed SSH connections is lost | The user already needs to re-run `lace-into` to get a working session. Dead pane scrollback is rarely consulted after the initial failure diagnosis. Acceptable tradeoff. |
