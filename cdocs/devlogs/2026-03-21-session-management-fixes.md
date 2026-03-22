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

## Changes Made

| File | Description |
|------|-------------|

## Verification
