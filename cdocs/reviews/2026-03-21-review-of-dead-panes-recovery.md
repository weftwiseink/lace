---
review_of: cdocs/proposals/2026-03-21-dead-panes-recovery.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T23:15:00-07:00
task_list: session-management/dead-panes
type: review
state: archived
status: done
tags: [fresh_agent, tmux, session-management, rate_limiting, ssh_exit_codes]
---

# Review: Dead Panes Recovery on Container Rebuild

## Summary Assessment

This proposal presents a practical three-phase fix for dead pane accumulation after container rebuilds: `remain-on-exit failed`, a `pane-died` hook with sleep-based rate limiting, and a `prefix + R` respawn-all keybinding.
The overall approach is sound and the phasing is well-structured, but the rate limiting explanation contains an incorrect mental model of why it works, `ControlPersist=600` creates an underexplored interaction with SSH exit codes, and the hook re-application on reattach is flagged as a TODO rather than scoped into the implementation phases.

Verdict: **Revise.** Two blocking issues around the rate limiting explanation accuracy and hook lifecycle management need resolution before implementation.

## Section-by-Section Findings

### BLUF

Clear and accurate.
Correctly states the three-phase hybrid approach and the rationale for each component.
No issues.

### Problem Statement

**Non-blocking.**
The problem statement is accurate and well-grounded.
One minor note: the statement says "3-5 panes" but does not reference whether the `lace-split` panes share SSH multiplexing via `ControlPersist`.
This is relevant because multiplexed slave connections may exit differently than direct connections when the master drops (see SSH exit code finding below).

### Change 1: `remain-on-exit failed`

**Non-blocking.**
The proposal correctly identifies that SSH exits 255 on abrupt connection termination and that `failed` only changes behavior for zero-exit panes.
The line references (525, 470) match the current source code.

One nuance worth noting: the analysis report's NOTE on SSH exit codes mentions that "if the remote end sends a clean disconnect, SSH exits 0."
Docker's `stop` command sends SIGTERM, then SIGKILL after a grace period.
If sshd handles SIGTERM by cleanly disconnecting clients before exiting, the SSH client might receive exit 0 rather than 255.
In practice, sshd does clean up on SIGTERM (it closes connections gracefully), but the timing race between the TCP FIN and the client's detection of it means exit 255 is the more common outcome.
This is not a blocking concern because `remain-on-exit failed` is a strict improvement over `on` regardless: the worst case is that some panes close when they should have persisted, which is the same outcome as `remain-on-exit off`.

### Change 2: `pane-died` Hook with Auto-Respawn

#### Rate Limiting Explanation: **Blocking.**

The proposal's explanation of why sleep-based rate limiting works contains an incorrect model.
Step 3 states: "`run-shell` is synchronous from tmux's perspective for that pane: the pane is in dead state during the sleep."
This is misleading.
`run-shell` is not synchronous in the way described: tmux spawns the shell command as a background job.
However, the rate limiting does work, just not for the stated reason.

The actual mechanism:
1. Pane dies. `pane-died` fires.
2. `run-shell "sleep 3 && tmux respawn-pane -t %5"` spawns a background process that sleeps.
3. During the sleep, the pane remains in the dead state. The `pane-died` hook cannot fire again for this pane because `pane-died` triggers on the transition from alive to dead, and the pane is already dead.
4. After 3 seconds, `respawn-pane` reactivates the pane (transition to alive).
5. If the SSH command then fails, the pane transitions from alive to dead again, firing `pane-died` once more.
6. The cycle repeats with a minimum interval of `sleep_duration + ssh_failure_time`.

The key insight: `pane-died` fires on state transitions, not on state. A pane that is already dead cannot fire `pane-died` again. The sleep adds delay before the respawn, which means the alive-to-dead transition (and thus the next hook invocation) cannot happen until after the sleep completes.

The proposal should correct this explanation to avoid misleading implementers.

#### Concurrent Hook Invocations: **Non-blocking.**

If all 5 panes die simultaneously (the rebuild case), 5 independent `run-shell` processes spawn, each sleeping 3 seconds, then each calling `respawn-pane` on its respective `#{pane_id}`.
This is correct behavior: each pane's hook operates independently.
However, this means 5 SSH connections attempt simultaneously after the 3-second delay.
If the container is not yet ready, all 5 fail, all 5 panes die, and the cycle repeats with 5 concurrent retries.
This is fine for the typical case but worth noting in the proposal.

#### `ControlPersist=600` Interaction: **Non-blocking but worth noting.**

The SSH connection uses `ControlPersist=600` (10 minutes) with `ControlMaster=auto`.
When the first pane connects, it becomes the control master.
Subsequent panes connect as slaves through the master socket.

When the container dies, the master connection drops.
The master's SSH process exits (likely 255), and its pane fires `pane-died`.
The slave panes may behave differently: they lose their channel through the master socket, which may cause them to exit with a different code or at a different time.

More importantly: when `respawn-pane` re-runs the SSH command for the master pane, it re-establishes the control master.
If a slave pane's `respawn-pane` runs before the new master is established, the slave SSH may try to connect through a stale socket and fail with a different error than "connection refused."
The `ControlPath=$HOME/.ssh/lace-ctrl-%C` might have a stale socket file from the dead master.

This is not blocking because the retry cycle handles transient failures, but it could cause confusing error messages and slightly longer recovery times.
A note in the Risks section would be appropriate.

### Change 3: Respawn-All Keybinding

**Non-blocking.**
The keybinding is straightforward and correct.
The `list-panes -s` flag correctly lists all panes across all windows in the session.
The `#{?pane_dead,#{pane_id},}` conditional format and `grep .` filter are a clean way to extract dead pane IDs.

One minor concern: `prefix + R` in tmux is unbound by default (confirmed), but some tmux plugin sets (like tmux-sensible or oh-my-tmux) may bind it.
This is a user-environment concern, not a proposal defect.

### Interaction with Stale Reattach Fix

**Blocking.**

The proposal correctly states that these fixes are complementary and neither subsumes the other.
However, it does not address a concrete conflict: the `pane-died` hook uses `respawn-pane` without arguments (re-running the original command with the original port), while the stale reattach fix uses `respawn-pane` with explicit `${ssh_base[@]}` (current connection details).

If the port changes during a rebuild:
1. The `pane-died` hook fires, sleeps 3 seconds, and respawns with the stale port.
2. The respawn fails, the pane dies again, the hook retries indefinitely against the wrong port.
3. The user runs `lace-into`, which triggers the stale reattach fix, respawns with the correct port.
4. But the `pane-died` hook is still configured with the original `#{pane_id}` and no-argument `respawn-pane`.

The proposal acknowledges the port-change risk in the Risks section but frames it as "addressed by the stale reattach fix."
In reality, the stale reattach fix does not cancel or reconfigure the hook.
The hook continues to respawn with the stale command indefinitely.

The proposal should address this interaction more precisely: either the hook should be re-set by `lace-into` on reattach (which connects to the TODO about hook re-application), or the hook should include a port-check guard.

### Implementation Phases

**Non-blocking.**
The phases are well-ordered (simplest first, building on each other).
Phase 2's validation plan is thorough.
Phase 3 is in the dotfiles repo, which is correctly identified as a cross-repo concern.

### Testing Plan

**Non-blocking.**
The manual test scenarios cover the important cases.
Test 3 (auto-respawn on container stop/start) specifies "within ~6 seconds" which is reasonable (3-second sleep + SSH connect time).
Test 4 (rate limiting) would benefit from specifying what to observe: the user should verify that the retry interval is approximately 3 seconds (not 0 or sub-second), confirming the sleep-based rate limiter.

The tmux-resurrect integration test (Test 3 under Integration Tests) correctly identifies that hooks are not restored and requires `lace-into` re-invocation.
However, the proposal's TODO about extending `do_connect()` to re-apply hooks on reattach is not scoped into any implementation phase.
This means the tmux-resurrect test would fail until that TODO is addressed, making the test plan internally inconsistent.

### Risks

**Non-blocking.**
The risks are accurately identified and honestly assessed.
The "Port Changes After Rebuild" risk correctly notes the dependency on the stale reattach fix.

The "Infinite Respawn on Permanently-Gone Containers" risk mentions a future retry counter via pane environment variables.
This is a reasonable deferral, but the proposal should note the observable symptom: `tmux list-panes` would show the pane cycling between alive and dead states every ~3 seconds, and `run-shell` processes would accumulate if tmux does not reap them synchronously.
In practice, tmux does reap `run-shell` processes, so this is informational only.

## Additional Findings

### Hook Re-Application on Reattach: **Blocking.**

The TODO at line 209 identifies a real gap: `do_connect()` only sets the hook on session creation (the code path at line 524-526), not on the reattach path (lines 506-513).
This means:
- After tmux-resurrect, hooks are lost.
- After a tmux server restart, hooks are lost.
- If `lace-into` is run against an existing session (the reattach path), the hook is not refreshed.

The proposal correctly identifies this in the TODO but does not include it in the Implementation Phases.
Since the hook is the core mechanism of this proposal, the hook's lifecycle should be fully addressed.
This should be either Phase 2a (set hook on both creation and reattach) or explicitly deferred with a rationale for why partial coverage is acceptable.

### `remain-on-exit failed` and SSH ControlMaster Exit Behavior

SSH multiplexing means that when the user types `exit` in a slave pane's shell, the SSH slave process exits 0, but the control master may persist (due to `ControlPersist=600`).
This is fine for `remain-on-exit failed`: the slave pane closes normally on exit 0.

However, if the user closes the control master's pane (the first pane created), the slave panes lose their channel.
Depending on the SSH version, slaves may exit 0 (clean channel close) or non-zero (broken pipe).
With `remain-on-exit failed`, a zero-exit would cause the slave pane to close silently, which might surprise the user.
This is an edge case but worth noting.

## Verdict

**Revise.**
The proposal's core approach is solid and the three-phase structure is appropriate.
Two blocking issues require resolution: the rate limiting explanation needs correction (the mechanism works but the explanation is wrong), and hook lifecycle management (creation vs. reattach) must be explicitly scoped rather than deferred as a TODO.

## Action Items

1. [blocking] Correct the rate limiting explanation in the "Rate Limiting via Sleep" section. The sleep works because `pane-died` fires on alive-to-dead transitions, not because `run-shell` is synchronous. The current explanation could mislead implementers into believing tmux blocks during `run-shell`.
2. [blocking] Scope hook re-application into the implementation phases. Either add a Phase 2a that sets the `pane-died` hook on the reattach path in `do_connect()`, or explicitly state why the reattach path is excluded and what the user experience is without it (no auto-respawn after tmux-resurrect or `lace-into` reattach until the session is killed and recreated).
3. [non-blocking] Note the `ControlPersist=600` interaction in the Risks section: stale control sockets may cause different failure modes during respawn, and concurrent respawn of 5 panes may race with control master re-establishment.
4. [non-blocking] Clarify the stale reattach interaction: the hook continues to respawn with the original command even after the stale reattach fix updates `@lace_port`. The hook is not reconfigured by `lace-into` reattach unless item 2 is addressed.
5. [non-blocking] Add a note about the 5-pane concurrent respawn scenario in the rate limiting section.
6. [non-blocking] In test 4 (rate limiting), specify the observable: "verify the interval between `pane-died` events is approximately 3 seconds, not sub-second."
