---
review_of: cdocs/proposals/2026-03-21-stale-reattach-fix.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T23:15:00-07:00
task_list: session-management/stale-reattach
type: review
state: live
status: done
tags: [fresh_agent, bash_correctness, edge_cases, architecture]
---

# Review: Stale Reattach Fix

## Summary Assessment

This proposal adds a three-way pane health check to `lace-into`'s `do_connect()` function, addressing the common problem of blindly reattaching to tmux sessions with dead SSH panes after container restarts.
The approach is well-grounded in the companion analysis report, the bash implementation is correct, and the phasing is sensible (Phase 1 is the complete fix, Phase 2 is already inline, Phase 3 is deferred).
Two issues merit attention: a subtle interaction between this proposal's respawn path and the dead-panes proposal's `pane-died` hook regarding the SSH command used, and an edge case around `respawn-pane` behavior with workspace-aware `ssh_base` commands on panes that were originally created by `lace-split` (which may construct `ssh_base` differently).
Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF and Problem Statement

Clear and accurate.
The problem is well-scoped: `lace-into` reattaches to sessions with dead panes because it treats session existence + port match as sufficient.
The reference to the analysis report is appropriate.

### Proposed Solution: Three-Way Health Check

The three-way classification (all-alive, mixed, all-dead) is the right design.
The analysis report's Option D is implemented faithfully.

**Bash correctness of the core code block:**

```bash
total_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | wc -l)
alive_panes=$(tmux list-panes -t "=$project" -F '#{pane_dead}' | grep -c '^0$' || true)
```

This issues two `tmux list-panes` calls to the same session, which creates a TOCTOU window: a pane could die between the first and second call, making `alive_panes > total_panes` impossible (it cannot become alive between calls) but making `alive_panes` potentially stale-high.
In practice this is harmless: the worst case is classifying a session as "mixed" when it is actually "all dead," which triggers the respawn path instead of the kill-and-recreate path.
The respawn path's inner `list-panes` re-queries pane state, so a fully-dead session would simply have all panes respawned rather than the session being killed and recreated.
The end result is functionally identical. **Non-blocking.**

> NOTE(opus/stale-reattach-review): The two-call pattern could be collapsed into a single `list-panes` call with post-processing (e.g., `tmux list-panes -t "=$project" -F '#{pane_dead}' | awk '{total++; if ($0=="0") alive++} END {print total, alive}'`), but the clarity benefit of the current approach outweighs the micro-optimization.

The `|| true` on the `grep -c` is correct: `grep -c` exits 1 when no matches are found, which would trigger `set -e`. Good defensive coding.

### Key Design Decisions

**`ssh_base` availability**: Verified against the source.
`ssh_base` is constructed at line 480, before the session-existence check at line 503.
The respawn path at the proposed insertion point has `ssh_base` in scope. Correct.

**`respawn-pane` with explicit command**: The proposal correctly identifies that `respawn-pane` without arguments re-runs the pane's original command.
The decision to pass `"${ssh_base[@]}"` explicitly is sound: it ensures current connection details are used.
However, this creates a behavioral asymmetry with the dead-panes proposal's `pane-died` hook, which calls `respawn-pane` without arguments (relying on the original command).
If both proposals are implemented together:

1. User is attached, container bounces: `pane-died` hook fires, calls `respawn-pane` (no args, uses original command).
2. User detaches and runs `lace-into` after a bounce: stale reattach fix fires, calls `respawn-pane -t "$pane_id" "${ssh_base[@]}"` (explicit current command).

These are not in conflict (they handle different scenarios), but the asymmetry is worth documenting.
If `ssh_base` ever diverges from the pane's original command (e.g., workspace path changed, user changed), the `pane-died` hook would re-run the stale command while the stale-reattach fix would use the fresh one. **Non-blocking**, but should be noted in the interaction section.

**`total_panes=0` guard**: The condition `[ "$total_panes" -gt 0 ] && [ "$alive_panes" -eq "$total_panes" ]` correctly handles the 0/0 edge case by short-circuiting on the first condition.
The proposal's explanation of the logic flow is accurate. Good.

**`@lace_port` update deferral**: Reasonable.
The existing port-mismatch logic already creates a disambiguated session name when the port changes, so this is not a gap in the fix.

### Implementation Phases

**Phase 1**: The code diff is complete and self-contained.
It can be applied as-is to the current `bin/lace-into` source.
All line number references are accurate against the current file.

**Phase 2**: Correctly noted as already handled inline in Phase 1.
The proposal avoids the trap of making the 0/0 guard a separate phase when it is really a detail of the condition expression.

**Phase 3**: Appropriately deferred.
The NOTE callout explains the scope boundary well.

### Code Diff

The diff is clean and matches the implementation section.
One observation: the indentation in the `for` loop uses 4-space indentation for the `tmux respawn-pane` line, while the surrounding code uses 6-space (2-level nesting inside the `if` chain).
This is cosmetic and would likely be caught by `shfmt`, but is worth flagging.

**Mixed-path attach/switch-client duplication**: The attach/switch-client block is now repeated three times in the function (all-alive path, mixed path, and the original new-session path at the bottom).
This is a natural consequence of the three-way branch and is acceptable, but a helper function like `attach_or_switch()` could reduce duplication.
**Non-blocking.**

### Testing Plan

The five scenarios cover the critical paths well.
Scenario 5 (zero panes) is difficult to test in practice as the proposal acknowledges, but the defensive guard is justified.

One scenario is missing: **container rebuild with host key change + mixed-health panes**.
In this case, the mixed path calls `refresh_host_key "$port"` before respawning dead panes, which is correct.
But the alive panes still hold an SSH connection with the old host key.
If the alive pane's SSH connection is intact (ControlMaster multiplexing keeps it alive through a brief sshd restart), there is no issue.
If the alive pane's connection dies during the `refresh_host_key` + respawn sequence (a narrow window), the user would need to run `lace-into` again.
This is an unlikely edge case and does not represent a regression from current behavior. **Non-blocking.**

### Risks and Mitigations

The risk table is thorough.
The "Race between health check and pane state change" entry correctly identifies the TOCTOU issue and its benign outcome.

One risk not mentioned: **ControlMaster interaction**.
The `ssh_base` includes `-o ControlMaster=auto` and `-o ControlPath=...`.
When the mixed path respawns a dead pane with `"${ssh_base[@]}"`, the new SSH connection may reuse an existing ControlMaster socket from an alive pane.
If the ControlMaster socket is stale (the underlying connection died), the new SSH connection could fail with a multiplexing error before falling back to a direct connection.
In practice, SSH handles this gracefully (it retries without multiplexing), and `remain-on-exit on` preserves any error output.
**Non-blocking**, but worth a brief mention in the risk table.

### Interaction with Dead Panes Proposal

The stale reattach proposal does not explicitly document its interaction with the dead-panes proposal's `pane-died` hook.
The dead-panes proposal has a good "Interaction with Stale Reattach Fix" section.
This proposal should add a reciprocal section or cross-reference, noting:

1. The hook handles in-session pane death (while attached); this fix handles stale sessions found on `lace-into` invocation.
2. `respawn-pane` in this proposal uses explicit `ssh_base`; the hook uses no-arg `respawn-pane`. The behavioral difference is intentional but should be documented.
3. If both are implemented, the `pane-died` hook may have already recovered panes before the user runs `lace-into`. The health check in this proposal correctly handles that case (all-alive path).

**Non-blocking**, but the cross-reference strengthens both documents.

### Writing Conventions

The proposal follows sentence-per-line, uses BLUF, and the NOTE callout in Phase 3 has proper attribution.
No emojis, no em-dashes. Clean.

## Verdict

**Accept.**
The proposal is well-designed, the bash code is correct, the edge cases are well-analyzed, and the phasing is pragmatic.
The non-blocking suggestions below improve documentation completeness and minor code hygiene but do not affect correctness.

## Action Items

1. [non-blocking] Add an "Interaction with Dead Panes Proposal" section cross-referencing `cdocs/proposals/2026-03-21-dead-panes-recovery.md`. Note the asymmetry between explicit `ssh_base` (this proposal) vs. no-arg `respawn-pane` (hook), and explain why both are correct for their respective scenarios.
2. [non-blocking] Fix the indentation of `tmux respawn-pane -t "$pane_id" "${ssh_base[@]}"` inside the `for` loop to match the surrounding nesting level (6 spaces, not 4+4).
3. [non-blocking] Consider extracting the attach/switch-client block into a helper function to reduce the three-way duplication in `do_connect()`.
4. [non-blocking] Add a brief note about ControlMaster socket staleness to the Risks table: when the mixed path respawns panes, SSH may encounter a stale ControlMaster socket from a dead connection but handles this gracefully via fallback.
5. [non-blocking] Consider collapsing the two `tmux list-panes` calls into one to eliminate the harmless TOCTOU window (e.g., pipe through `awk` to compute both `total_panes` and `alive_panes` in a single pass).
