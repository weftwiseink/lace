---
review_of: cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T16:30:00-08:00
task_list: lace/devcontainer-workflow
type: review
state: archived
status: done
tags: [rereview_agent, devcontainer, workflow_automation, developer_experience, revision_verification]
---

# Review (R2): Auto-Attach WezTerm Workspace After Devcontainer Setup

## Summary Assessment

This proposal automates the full devcontainer-to-WezTerm workflow via a single `bin/open-weft-workspace` script.
The R1 blocking issue (readiness check using `wezterm cli list` over SSH failing due to missing `XDG_RUNTIME_DIR`) has been fully resolved: the revised approach polls SSH connectivity only and lets `wezterm connect` handle mux negotiation.
All eight R1 action items have been addressed, and the proposal is now substantially improved with a Related Workstreams section, a Test Plan, corrected behavioral descriptions, and simplified retry logic.
Two minor residual issues remain (one stale sentence in a story, one em-dash in a code example); neither is blocking.
Verdict: **Accept**.

## R1 Action Item Resolution

### 1. [blocking] Readiness check strategy: RESOLVED

The readiness check now polls `ssh -p 2222 -i ~/.ssh/weft_devcontainer -o ConnectTimeout=1 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null node@localhost true` instead of `wezterm cli list` over SSH.
Decision 3 explicitly documents why: `wezterm cli list` over SSH requires `XDG_RUNTIME_DIR` to locate the mux socket, and SSH sessions do not inherit environment variables from `postStartCommand`.
The rationale is clear and the revised command is correct.
The SSH options (`StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`) are appropriate for a devcontainer where the host key changes on rebuild.

### 2. [non-blocking] Related Workstreams section: RESOLVED

A "Related workstreams" subsection now appears in the Background section (lines 79-83), referencing:
- The wezterm-server feature proposal (mux server provider).
- The lace CLI proposal (long-term home for orchestration).
- The SSH key auto-management proposal (key prerequisite).

The BLUF also cross-references all three with hyperlinks.
Phase 3 now references the lace CLI proposal for convergence.

### 3. [non-blocking] `wezterm connect` vs Leader+D distinction: RESOLVED

The "Existing wezterm connect infrastructure" subsection (line 88-89) now clearly states the difference: `wezterm connect weft` "opens a new window connected to the remote mux server," while "Leader+D keybinding uses `SwitchToWorkspace`, which creates or switches to a named `weft` workspace *within* the current WezTerm process."
Decision 2 (lines 147-157) reinforces this: "This differs from the Leader+D keybinding... `wezterm connect weft` always opens a new window, even if one is already connected to the same domain. Running the script twice will produce two windows."
No equivalence is claimed.

### 4. [non-blocking] Shell compatibility target: RESOLVED

Phase 1 constraints now say "Bash script (`#!/bin/bash`), following the `bin/nvim` convention in this repo."
The contradictory "POSIX-compatible bash (no bashisms)" phrasing is gone.

### 5. [non-blocking] `devcontainer up` rebuild behavior: RESOLVED

The "Container needs to be rebuilt" story (lines 197-199) now correctly states: "`devcontainer up` does not automatically rebuild when the Dockerfile changes if the image is already cached. The developer must either pass `--build-no-cache` or remove the cached image."

### 6. [non-blocking] Simplify retry to fixed interval: RESOLVED

Step 2 specifies "1-second intervals, max 15 attempts."
Decision 3 documents the rationale: "exponential backoff adds complexity without benefit in a 15-second window where services either come up within a few seconds or something is wrong."
Phase 1 Step 4 is consistent.

### 7. [non-blocking] JSON output example: RESOLVED

The example now shows `"remoteWorkspaceFolder": "/workspace/main"`, matching the actual `workspaceFolder` in `devcontainer.json`.

### 8. [non-blocking] Add Test Plan: RESOLVED

A dedicated "Test Plan" section (lines 240-268) covers four manual test scenarios: stopped container, running container, missing prerequisites, and mux server failure.
The note that automated testing is impractical (requires Docker daemon, devcontainer CLI, and WezTerm GUI) is honest and reasonable for a PoC.

## New Issues Introduced by Revisions

### Story text inconsistency (non-blocking)

The "Developer opens project for the first time today" story (line 185) says "Script waits for sshd + mux server."
The revised design waits for sshd only, not the mux server directly.
This sentence is a leftover from the pre-revision text and should read "Script waits for SSH connectivity" or similar.

### Em-dash in diagnostic message example (non-blocking)

Line 226 contains: "WezTerm connection failed -- check that wezterm-mux-server is running inside the container."
Per the writing conventions, prefer a colon or spaced hyphen over em-dashes: "WezTerm connection failed: check that wezterm-mux-server is running inside the container."
This is in a quoted diagnostic message example, so the convention applies loosely, but it is worth noting for consistency.

## Broader Assessment

The proposal is well-structured and thorough for a PoC-scoped script.
The BLUF accurately summarizes the problem, constraint, and solution.
The lifecycle hook analysis remains accurate and is the foundation of the design rationale.
The four design decisions are well-reasoned with clear rationales, and the revisions have sharpened Decision 2 (connect vs SwitchToWorkspace) and Decision 3 (readiness check strategy) considerably.
The edge cases section is comprehensive and the new Test Plan section provides actionable manual verification steps.
The cross-references to related workstreams (lace CLI, wezterm-server feature, SSH key management) establish the PoC's place in the broader architecture and its convergence path.

The proposal is ready for implementation.

## Verdict

**Accept.**
All R1 blocking and non-blocking action items have been resolved.
The two residual issues (stale story text, em-dash in example) are cosmetic and do not warrant another revision round.

## Action Items

1. [non-blocking] Fix line 185: change "Script waits for sshd + mux server" to "Script waits for SSH connectivity" to match the revised readiness check strategy.
2. [non-blocking] Fix line 226: change the `--` to a colon in the diagnostic message example per writing conventions.
