---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:30:00-07:00
task_list: session-management/investigation-and-fixes
type: devlog
state: live
status: wip
tags: [lace-into, tmux, ssh, session-management]
---

# Session Management Fixes: Devlog

## Objective

Investigate and fix three issues with the lace-into/tmux session management workflow:

1. **Stale reattach**: `lace-into lace` reattaches to an existing tmux session without verifying panes are connected to the devcontainer.
2. **Dead panes on rebuild**: When a devcontainer is rebuilt, SSH panes die but remain visible as dead panes instead of gracefully recovering.
3. **Missing SSH key injection**: The `lace-sshd` feature (metadata-only) does not inject `authorized_keys` into the container, causing password prompts on SSH connection.

## Plan

1. Dispatch three parallel `/report` agents to investigate each issue independently.
2. Dispatch three parallel `/propose` agents with fix designs.
3. Review each proposal.
4. Executive summary report to assess which fixes are straightforward enough to implement autonomously.
5. Implement viable fixes with subagents.

## Testing Approach

Issue-dependent:
- Issue 1 (reattach): Manual testing with tmux sessions.
- Issue 2 (dead panes): Manual testing after container rebuild.
- Issue 3 (SSH keys): Verify authorized_keys mount in generated devcontainer.json, test SSH connection.

## Implementation Notes

### Key Findings from Investigation

**Issue 3 root cause identified during initial exploration:**
The generated `.lace/devcontainer.json` has NO `authorized_keys` mount.
The old `wezterm-server` feature declared a mount for `authorized_keys` as part of its feature metadata (label `wezterm-server/authorized-keys`), but the new `lace-sshd` feature is metadata-only and declares no mounts.
The mount-resolver and template-resolver test suites still reference `wezterm-server/authorized-keys`, confirming this was previously handled by the wezterm-server feature.

**Issue 1 root cause:**
`do_connect()` in `lace-into` (line 503) checks for existing tmux sessions and blindly reattaches.
No check for whether panes are alive or connected.

**Issue 2 root cause:**
`remain-on-exit on` (line 525) keeps dead panes visible after SSH disconnects.
No mechanism to detect container rebuild and reconnect.

### Subagent-Driven Investigation

Three parallel rounds of subagents were dispatched:

**Round 1 (Reports):**
- Agent 1: stale reattach analysis (115s, 14 tool uses)
- Agent 2: dead panes analysis (172s, 23 tool uses)
- Agent 3: SSH key injection analysis (196s, 49 tool uses)

**Round 2 (Proposals):**
- Agent 1: stale reattach fix proposal (103s)
- Agent 2: dead panes recovery proposal (121s)
- Agent 3: SSH key injection fix proposal (110s)

**Round 3 (Reviews):**
- Stale reattach: **Accepted** R1 (5 non-blocking suggestions)
- Dead panes: **Revision requested** R1 (2 blocking: rate limiting explanation, hook lifecycle)
- SSH key injection: **Accepted** R1 (mount-resolver pipeline verified against source)

### Implementation Decisions

1. **SSH key injection** (Issue 3): Implementing immediately. JSON-only change, no code changes. Lowest risk.
2. **Stale reattach** (Issue 1): Implementing. ~25 lines of bash. Well-reviewed code.
3. **Dead panes Phase 1** (Issue 2): Implementing `remain-on-exit failed` (one-line change).
4. **Dead panes Phases 2-3**: Deferred. Hook lifecycle management needs revision and interactive testing.

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/reports/2026-03-21-stale-reattach-analysis.md` | Analysis report |
| `cdocs/reports/2026-03-21-dead-panes-analysis.md` | Analysis report |
| `cdocs/reports/2026-03-21-ssh-key-injection-analysis.md` | Analysis report |
| `cdocs/proposals/2026-03-21-stale-reattach-fix.md` | Fix proposal (accepted) |
| `cdocs/proposals/2026-03-21-dead-panes-recovery.md` | Fix proposal (revision requested) |
| `cdocs/proposals/2026-03-21-ssh-key-injection-fix.md` | Fix proposal (accepted) |
| `cdocs/reviews/2026-03-21-review-of-*.md` | Three review documents |
| `cdocs/reports/2026-03-21-session-management-executive-summary.md` | Executive summary |
| `.devcontainer/features/lace-sshd/devcontainer-feature.json` | Added authorized-keys mount |
| `.lace/prebuild/features/lace-sshd/devcontainer-feature.json` | Added authorized-keys mount |
| `bin/lace-into` | Health check + remain-on-exit failed |

## Verification

TODO(opus/session-management): Pending implementation agent results.
