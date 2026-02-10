---
review_of: cdocs/proposals/2026-02-09-wezterm-mouse-selection-copy-mode.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T15:00:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
tags: [self, rereview_agent, wezterm, copy-mode, mouse, feasibility]
---

# Review R2: WezTerm Mouse Selection to Copy Mode Transition

## Summary Assessment

This is the R2 review of the mouse-selection-to-copy-mode proposal. All blocking findings from R1 have been addressed. The cursor position inconsistency (B1) is fixed -- the BLUF and body now consistently state the cursor lands at the terminal cursor position, not the mouse selection endpoint. The recommendation gap (B3) is resolved with an explicit "Implement the workaround" recommendation and clear revert criteria. The non-blocking suggestions (active_key_table guard, upstream feature request promotion, test plan link fix) were also applied. The proposal is now internally consistent, takes a clear position, and provides actionable guidance for an implementation agent.

**Verdict: Accept.**

## R1 Action Item Resolution

| # | Finding | Status |
|---|---------|--------|
| 1 | [blocking] Fix cursor position inconsistency in "What This Achieves" | Resolved. The false claim about cursor landing at the mouse selection endpoint was removed. Replaced with a bullet about the copy mode key table being active. |
| 2 | [blocking] Commit to a clear recommendation | Resolved. New "Recommendation" section added with explicit revert criteria: revert if SetSelectionMode fails AND cursor lands far from selection; keep if either works. |
| 3 | [non-blocking] Add active_key_table() guard | Resolved. Guard added to the code sample with clear comment. Edge case section updated to describe the guard behavior. |
| 4 | [non-blocking] Promote upstream feature request | Resolved. Explicit recommendation to file upstream request added to the Recommendation section. Open Questions section includes a NOTE clarifying this is now a recommendation. |
| 5 | [non-blocking] Fix test plan link | Resolved. Now references the local path `/home/mjr/code/personal/dotfiles/CLAUDE.md`. |
| 6 | [non-blocking] Fix BLUF cursor position wording | Resolved. BLUF now explicitly states "the copy mode cursor lands at the terminal's current cursor position (typically near the bottom of the visible area), **not** at the mouse selection endpoint." |

## Section-by-Section Findings

### BLUF

**No issues.** The BLUF is now internally consistent with the body. It clearly states the limitation (selection not preserved, cursor at terminal position), the workaround (save to PrimarySelection, enter copy mode), and the scope (dotfiles only). The "not fully achievable" framing is honest without being defeatist.

### Proposed Solution

**Non-blocking.** The code sample now includes the `active_key_table()` guard and inline opt-in documentation comments. The Recommendation section provides clear, testable revert criteria. One minor observation: the "Fallback: Already Copied" section describes a scenario where the user exits copy mode and re-enters with `Alt+C` to yank to clipboard. This could note that the user could also just use `Ctrl+Shift+C` from the normal terminal (outside copy mode) after the mouse selection -- no need to re-enter copy mode for clipboard copy. This is a minor omission, not blocking.

### Edge Cases

**No issues.** The "Copy mode already active" section now describes the `active_key_table()` guard with a NOTE about empirical testing. The other edge cases are unchanged and remain well-analyzed.

### Test Plan

**Non-blocking.** The test plan link is fixed. One addition worth considering for implementation: Phase 3 test case 3 ("Click-drag to select text, release") should note that the implementation agent should also observe *where* the copy mode cursor lands relative to the selected text. This directly feeds into the revert criteria -- if the cursor consistently lands at the bottom of the terminal (far from a scrollback selection), that is evidence toward reverting. This is not blocking since the revert criteria in the Recommendation section already describe this evaluation.

### Open Questions

**No issues.** The three remaining open questions are genuinely empirical and cannot be resolved without implementation. Question #3 (cursor position relative to selection) is the most critical and is correctly flagged as "the biggest UX risk."

## Verdict

**Accept.** The proposal is internally consistent, takes a clear position with testable revert criteria, and provides actionable implementation guidance. The remaining open questions are appropriately deferred to empirical testing during implementation. The research quality on wezterm's architectural constraints is thorough and well-sourced.

## Action Items

1. [non-blocking] Consider noting in the "Fallback" section that `Ctrl+Shift+C` from normal mode is also a path to clipboard copy after mouse selection, without needing to re-enter copy mode.
2. [non-blocking] Consider adding cursor position observation to Phase 3 test case 3 to feed directly into the revert criteria evaluation.
