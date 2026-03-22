---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T23:15:00-07:00
task_list: session-management/executive-summary
type: report
state: live
status: wip
tags: [lace-into, tmux, ssh, session-management]
---

# Session Management Fixes: Executive Summary

> BLUF: Three session management issues were investigated, proposed, and reviewed.
> Two proposals (stale reattach, SSH key injection) are accepted and ready to implement.
> The dead panes proposal needs a revision addressing hook lifecycle management.
> SSH key injection is the simplest fix (JSON-only, no code changes) and should be implemented first.
> Stale reattach is a moderate bash edit.
> Dead panes recovery has the most complexity and interaction risk.

## Issue Status

| Issue | Report | Proposal | Review Verdict | Complexity | Autonomous? |
|-------|--------|----------|----------------|------------|-------------|
| SSH key injection | Done | Done | **Accepted** R1 | Low (JSON only) | Yes |
| Stale reattach | Done | Done | **Accepted** R1 | Medium (bash) | Yes |
| Dead panes recovery | Done | Done | **Revision requested** R1 | High (tmux hooks) | Partial |

## Issue 1: Stale Reattach

**Status: Ready to implement.**

The fix adds a three-way health check to `do_connect()` in `bin/lace-into`:
- All panes alive: reattach (current behavior).
- All panes dead: kill session, create fresh one.
- Mixed: respawn only dead panes with current SSH command, then reattach.

Uses `tmux list-panes -F '#{pane_dead}'` for health detection.
Approximately 25 lines of bash added to `do_connect()`.

**Review notes**: 5 non-blocking suggestions (code style, ControlMaster staleness note, single-pass awk optimization).
None affect correctness.

**Risk**: Low.
The code paths are well-defined and testable.
Worst case if health check fails: falls through to current behavior (blind reattach).

## Issue 2: Dead Panes Recovery

**Status: Needs revision before implementation.**

The hybrid approach (remain-on-exit failed + pane-died hook + respawn keybinding) is sound, but the review identified two blocking issues:

1. **Rate limiting explanation is incorrect**: The proposal claims `run-shell` blocks `pane-died` from refiring, which is not how tmux hooks work.
The rate limiting actually works because `pane-died` fires on alive-to-dead state transitions only: a dead pane can't trigger it again until respawned and re-died.
The explanation must be corrected.

2. **Hook lifecycle management is unscoped**: The `pane-died` hook is set in `do_connect()` only during session creation.
Reattach via `lace-into` or `tmux-resurrect` does not re-apply the hook.
This needs to be a named phase, not a TODO.

**What can be implemented now (Phase 1 only)**:
Changing `remain-on-exit on` to `remain-on-exit failed` is a one-line change with no interaction risks.
Panes that exit cleanly (user types `exit`) close normally.
Panes killed by container rebuild (exit 255) still persist for inspection.

**What needs revision**: Phases 2-3 (pane-died hook + respawn keybinding) should wait for the corrected proposal, particularly the hook lifecycle question.

## Issue 3: SSH Key Injection

**Status: Ready to implement.**

The fix adds a `mounts` block to `.devcontainer/features/lace-sshd/devcontainer-feature.json`:

```json
"mounts": {
  "authorized-keys": {
    "target": "/home/${_REMOTE_USER}/.ssh/authorized_keys",
    "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
    "description": "SSH public key for lace SSH access",
    "readonly": true,
    "sourceMustBe": "file",
    "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N ''"
  }
}
```

Both copies must be updated:
- `.devcontainer/features/lace-sshd/devcontainer-feature.json`
- `.lace/prebuild/features/lace-sshd/devcontainer-feature.json`

The mount-resolver pipeline fully supports this pattern, verified by the reviewer against the source code.
No TypeScript code changes needed.
Existing tests cover the mount-resolver path (namespace-agnostic).

**Risk**: Minimal.
The only risk is the `${_REMOTE_USER}` variable not resolving correctly, but this is verified by existing tests.

**Verification**: After editing, run `pnpm test` to ensure no regressions, then `lace up --rebuild` to see the mount in `.lace/devcontainer.json`.

## Recommended Implementation Order

1. **SSH key injection** (Issue 3): Simplest, JSON-only, immediately verifiable.
   No test changes needed.
   Unblocks key-based SSH auth.

2. **Stale reattach** (Issue 1): Moderate bash edit, well-reviewed code.
   Manual testing needed (create dead tmux sessions, verify health check).

3. **Dead panes Phase 1** (Issue 2): One-line `remain-on-exit failed` change.
   Can be done alongside #2 since they modify the same function.

4. **Dead panes Phases 2-3**: Defer until proposal revision addresses hook lifecycle.

## Implementation Feasibility for Autonomous Work

Issues 1 and 3 are straightforward enough for autonomous implementation.
Issue 2 Phase 1 is trivial.
Issue 2 Phases 2-3 involve tmux hook semantics that benefit from interactive testing and user feedback.

The main limitation for autonomous work is **verification**: testing SSH connections and tmux session behavior requires a running devcontainer, which requires `lace up --rebuild` (which takes time and may not be available in the current environment).
For the SSH key injection fix, the test suite provides sufficient verification.
For the stale reattach fix, the code changes can be verified by reading but not by running.
