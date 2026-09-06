---
review_of: cdocs/proposals/2026-09-06-stale-worktree-classification.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T11:24:52-07:00
task_list: lace/workspace-validation
type: review
state: live
status: done
tags: [rereview_agent, workspace-detection, worktree, false_negative, git_parity, architecture]
---

# Re-review (R2) of "Classify stale/prunable worktrees separately from broken-live worktrees in `lace up`"

> BLUF: Accept.
> All three R1 blocking items are genuinely resolved, not papered over: the broken-live sibling false-negative is now explicitly OWNED as an accepted trade-off with the union-scan alternative considered and rejected, the `locked` gate precedes the gitdir stat in both the mermaid diagram and the rule list, and the file ends cleanly with no authoring tags.
> The five non-blocking items are all addressed.
> One residual documentation nit remains (a stale "rule 1" cross-reference the reordering left behind), non-blocking and safe to fix in passing.

## Summary Assessment

This is a focused R2 re-review of the revised proposal against the three R1 blocking findings and the non-blocking set.
The revision does the harder thing the R1 review asked for: it states a coverage trade-off it previously implied away, and it argues the trade-off from the same host/container ambiguity that motivates the whole warn-not-error stance, so the design stays internally consistent.
No new inconsistency was introduced by the revision beyond one stale rule-number reference.
Verdict: Accept.

## Blocking Items (R1) - Verification

### 1. Broken-live sibling false-negative is now OWNED - RESOLVED

The proposal no longer frames the admin scan as strictly superior.
`Admin scan over working-tree-children scan` (`:247-251`) now states plainly: "This realignment is not a pure superset of the retired scan: it trades away one broken-live case, documented next."
The BLUF (`:19-24`) makes no superiority claim.

A dedicated `Broken-live sibling downgrade (accepted coverage trade-off)` subsection under Important Design Decisions (`:253-283`) documents every element the brief requires:
- The genuinely-broken SIBLING (present host working tree, absolute `/workspace/...` back-pointer, `nonexistent-location` forward pointer) reads as prunable and is downgraded error to warning (`:263-265`).
- Accepted because indistinguishable from a live co-tenant from the host (`:267-269`).
- The CURRENT worktree being upped is unaffected, `:166-178` check retained (`:277-279`).
- Direction 3 (`useRelativePaths`) drains the source (`:283`).

The union-scan alternative is explicitly considered and rejected (`:271-273`), with the reason stated: it re-introduces hard-abort on live co-tenant worktrees, defeating the RFP's central goal.
The Edge Cases list carries a matching entry (`:295-299`) that cross-links back to the design decision.
This is a clean, decisive resolution of the R1 fork: the author chose Option A (accept the downgrade) and documented it as such.

### 2. `locked` ordering matches git - RESOLVED

Mermaid diagram (`:48-57`): the flow is `read gitdir` -> `locked exists?` -> (no) -> `gitdir missing or empty?` -> (no) -> `stat path`.
The `locked` gate now sits ABOVE the missing/empty check.

Detection-rules list (`:141-144`): rule 1 is `locked`, rule 2 is gitdir missing/empty, rule 3 is stat the path.
The prose at `:138-139` states the invariant directly: "Git evaluates `locked` BEFORE stat-ing the gitdir, so a locked entry is never prunable even when its `gitdir` is missing or empty."
Both the diagram and the list now match git's `should_prune_worktree` order. Resolved.

### 3. Stray EOF authoring tags removed - RESOLVED

The file ends on real content (`only the relative-paths fix makes host and container agree.`) at line 410 with a single trailing newline.
No `</content>` / `</invoke>` markup remains (verified via `tail -c 300 | cat -A`). Resolved.

## Non-blocking Items (R1) - Verification

All addressed:

- **Current-worktree exclusion + dedup test.** The scan excludes the current worktree or dedups by name (`:159-160`), motivated by the double-emission scenario. The Test Plan adds the guard: "Current-worktree exclusion: ... emits exactly ONE `absolute-gitdir` warning, not two" (`:335-336`). Addressed.
- **Direction-3 dedicated unconditional injection, not gated behind `safeDirectory`.** `:195-203` prescribes its own `mergePostCreateCommand` call and explains why sharing the `safeDirectory` guard is wrong; Phase 3 (`:388`) and the injection test (`:351`, `:393`) enforce guard-independence. Addressed.
- **Softened "inert no-op on git < 2.48" framing.** `:206-208` now states the setting is an inert no-op on old git, that the bake-in is not itself version-gated, and that `verifyContainerGitVersion` only fires when the repo already carries the extension. The overstated "already gates on it" claim is gone. Addressed.
- **Ambiguous-sibling hermetic test.** `:333-334` adds a `classifyWorkspace` case: forward pointer `nonexistent-location` while the sibling directory IS present, asserting `prunable-worktree` and no `absolute-gitdir`, explicitly to lock in the accepted downgrade and guard against a regression that would re-hard-error co-tenants. Addressed.
- **TIME_MAX-vs-list-annotation NOTE.** `:146-148` adds the NOTE stating the scanner models `prune`'s default (`expire = TIME_MAX`), not `list`'s index-mtime annotation, and that the omission is intentional. Addressed.

## Convention Pass

- BLUF present and substantive (`:19-24`).
- Sentence-per-line followed throughout.
- No em-dashes; colons and spaced hyphens per convention.
- RFP back-link present in the BLUF (`:19`) and Objective/Background prose.
- Frontmatter validates (`type: proposal`, `status: review_ready`, focused tags).

No convention regressions from the revision.

## Residual Nit (non-blocking)

**Stale rule-number cross-reference introduced by the `locked` reorder.**
Edge Cases (`:307-308`) says gitdir-present-but-empty and no-gitdir cases are "handled by rule 1."
After the R1 fix, `locked` became rule 1 and gitdir missing/empty became rule 2, so this should read "handled by rule 2."
Blast radius is zero (documentation only), but it is a genuine inconsistency the reordering left behind. Safe to fix in passing; does not block acceptance.

## Verdict

**Accept.**

The three R1 blocking findings are resolved with substance rather than hand-waving: the false-negative is owned as an explicit, argued trade-off with the rejected alternative on record; the `locked` gate is correctly ordered in both diagram and list; and the EOF is clean.
All non-blocking items are addressed.
The design is implementation-ready.
The single residual nit is documentation-only and non-blocking.

## Action Items

1. [non-blocking] Fix the stale cross-reference at `:308`: change "handled by rule 1" to "handled by rule 2" (the `locked` reorder made gitdir missing/empty rule 2).
