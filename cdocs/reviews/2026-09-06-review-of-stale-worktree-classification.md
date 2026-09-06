---
review_of: cdocs/proposals/2026-09-06-stale-worktree-classification.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T11:20:00-07:00
task_list: lace/workspace-validation
type: review
state: live
status: done
tags: [fresh_agent, workspace-detection, worktree, false_negative, test_plan, architecture]
---

# Review of "Classify stale/prunable worktrees separately from broken-live worktrees in `lace up`"

> BLUF: Revise.
> The design is well-grounded, wires a genuinely dead stub against git's own source of truth, and the central warn-not-error / never-auto-prune judgment is correct and well-argued.
> But the proposal presents the admin-forward-pointer scan as strictly superior to the host-children scan it retires, when it is in fact strictly WEAKER at flagging one broken-live sub-case: a SIBLING worktree with a present host working tree and an absolute container-path back-pointer is hard-errored today and would silently become a benign warning.
> That false-negative is inherent to the host/container ambiguity the proposal itself identifies, so warn-not-error remains defensible, but the proposal must state the downgrade rather than imply zero coverage loss.
> Two smaller correctness issues (a `locked`-ordering divergence from git's actual prune order, and no current-worktree exclusion causing duplicate warnings) plus stray authoring-tool tags at EOF round out the blocking set.

## Summary Assessment

The proposal promotes the RFP into a concrete three-part design: an admin-metadata scanner (`scanWorktreeAdmin`) reproducing git's `should_prune_worktree` criteria, a partitioned error policy in `applyWorkspaceLayout`, and a container-side `worktree.useRelativePaths=true` bake-in.
The scope claim is accurate: `prunable-worktree` is a real dead stub in the `ClassificationWarning.code` union (`workspace-detector.ts:45`) never emitted by any path, and the current sibling scan (`checkAbsolutePaths:276-316`) genuinely cannot see an entry whose working tree is gone because it iterates host directory children.
The co-tenant safety argument is the strongest part of the document and is correct: from the host, a live container-side worktree and a dead entry are indistinguishable, so auto-prune is unsafe by construction.

The most important finding is a coverage change the proposal does not acknowledge: retiring `checkAbsolutePaths` in favor of the forward-pointer scan loses the ability to hard-error a broken-live SIBLING worktree whose back-pointer is an absolute container path, because that entry's forward pointer is also an absolute container path that does not resolve on the host and therefore reads as `nonexistent-location` / prunable.
The verdict is Revise: the approach is sound and the blocking items are all fixable in-place, but the false-negative and the git-parity ordering bug must be resolved or explicitly accepted before implementation.

## Section-by-Section Findings

### Prunable detection design and git parity (Proposed Solution 1)

**Blocking - `locked` is checked in the wrong order relative to git.**
The proposal claims to match git's `should_prune_worktree`, but git's actual order is: (1) `worktrees/<name>` is a directory, (2) `locked` exists -> return NOT prunable, (3) stat `gitdir` -> missing -> prunable, (4) empty `gitdir` -> prunable, (5) path absent -> prunable.
The `locked` check precedes the gitdir stat.
The proposal's rule ordering and its mermaid diagram invert this: "file missing or empty? yes -> PRUNABLE" sits ABOVE the `locked` gate.
Under the proposal, a locked entry with a missing or empty `gitdir` is classified prunable; git classifies it not-prunable (locked wins unconditionally).
The blast radius is only a spurious warning under warn-not-error, but the document explicitly sells "git's exact prune criteria," and rule 2's own prose says "Git never auto-prunes a locked entry."
Fix: evaluate `locked` first, before the gitdir-missing/empty test, so the stated parity holds.

**Non-blocking - the `--expire` / index-mtime branch is omitted, which is correct for the `prune` default but worth a one-line note.**
Git's `should_prune_worktree` does not prune a `nonexistent-location` entry whose `worktrees/<name>/index` mtime is newer than the expire threshold.
The `git worktree prune` subcommand defaults `expire` to `TIME_MAX`, so every nonexistent-location entry is prunable in default usage, which is what the proposal reproduces and what the RFP observed.
This is fine, but a NOTE stating "we model `prune`'s default (no `--expire`), not `list`'s annotation" would preempt a future reader assuming full parity.

### The central safety argument and the false-negative (Proposed Solution 1, Design Decisions, Edge Cases)

**Blocking - retiring `checkAbsolutePaths` silently downgrades broken-live SIBLING detection.**
The proposal frames the admin scan as strictly better: "the only way to see an entry whose working tree is gone" and "removes a class of surprise."
It never states that the admin scan is strictly WEAKER for one real sub-case.

Trace a sibling worktree created container-side whose working tree is still present on the host (recall `/workspace/<project>/<name>` and `<bareRepoRoot>/<name>` are the same bind-mounted directory):
- Back-pointer at `<root>/<sibling>/.git`: `gitdir: /workspace/<project>/.bare/worktrees/<sibling>` (absolute container path).
- Forward pointer at `.bare/worktrees/<sibling>/gitdir`: `/workspace/<project>/<sibling>/.git` (absolute container path).

Old `checkAbsolutePaths`: iterates host directory children, finds `<root>/<sibling>/.git` present, reads its absolute back-pointer, emits `absolute-gitdir` -> hard error.
New `scanWorktreeAdmin`: stats the forward pointer `/workspace/<project>/<sibling>/.git`, which does not exist on the host, classifies `nonexistent-location` -> prunable -> benign warning.
The same worktree moves from hard-abort to non-fatal warning.

This IS the false-negative the review brief asks to surface: a genuinely broken-live sibling (present host working tree, absolute back-pointer) can pass as merely prunable.
Crucially, it is unavoidable given the design's own premise: from the host you cannot distinguish this broken-live sibling from a live co-tenant checkout, and the proposal has (correctly) decided the co-tenant case must not hard-abort.
So the downgrade is defensible, but the proposal must OWN it rather than imply the admin scan loses nothing.

Two mitigating facts reduce severity and should be stated in the fix:
- The CURRENT worktree being brought up is unaffected: its working tree is present by definition and the `:166-178` back-pointer check is retained, so the primary broken-live case still hard-aborts.
- The residue is a printed warning, not silence, so a user who reads output still learns of it.

Required change: add an explicit subsection under Design Decisions acknowledging that retiring `checkAbsolutePaths` converts broken-live container-created siblings from `error` to `warning`, and justify it via the same host/container ambiguity that motivates warn-not-error.
If the team wants to preserve the hard error for host-present siblings, the alternative is a union: when a forward pointer reads `nonexistent-location`, also stat `<bareRepoRoot>/<name>/.git`; if that host path exists with an absolute back-pointer, treat it as broken-live.
Note that this alternative re-introduces hard-abort on live co-tenant worktrees, so it likely contradicts the co-tenant goal - which is exactly why the tradeoff needs to be stated and decided, not left implicit.

**Non-blocking - the "looks prunable" edge case is described but not tested.**
Edge Cases covers the live-but-looks-prunable worktree in prose, but the Test Plan has no hermetic case for it.
A test with a `nonexistent-location` forward pointer while the sibling directory IS present on disk would lock in the chosen classification and document the accepted false-negative.

### Partitioned error policy (Proposed Solution 2)

The partition itself is correct: `broken.length > 0 -> error`, prunable-only proceeds with config already mutated at `:137-179`, and `up.ts:346-357` needs no change because `applied` proceeds and `error` aborts as today.
This matches the actual consumption site.

**Non-blocking - no current-worktree exclusion for the admin scan.**
`scanWorktreeAdmin` iterates every admin entry, including the current worktree's, while `:166-178` also checks the current worktree's back-pointer.
For a current worktree with a present, host-resolving forward pointer and an absolute back-pointer, both paths fire and two `absolute-gitdir` warnings are emitted for the same worktree.
The retired `checkAbsolutePaths` carried an `excludeWorktree` parameter precisely to avoid this.
Add an equivalent exclusion or dedup warnings by worktree name.

### Close the source: container `worktree.useRelativePaths` (Proposed Solution 3)

The mechanism is right: `git config --global worktree.useRelativePaths true` in postCreate makes subsequent in-container `git worktree add` write relative pointers, closing the production of new absolute gitdirs.
`worktree.useRelativePaths` is a real git 2.48+ key, and the module already tracks `relativeworktrees: 2.48.0`.

**Non-blocking - do not gate the new injection behind `safeDirectory`.**
The recommended vehicle piggybacks on the block at `:167-172`, which is guarded by `wsConfig.postCreate?.safeDirectory !== false`.
If a user disables `safeDirectory`, they would also lose the relative-paths fix, which is unrelated.
Give `worktree.useRelativePaths` its own unconditional `mergePostCreateCommand` call (or its own `postCreate` option), not a shared gate.

**Non-blocking - the version-gating claim is overstated.**
The proposal says the existing `verifyContainerGitVersion` "already gates on it."
That verification only fires when the repo already carries the `relativeworktrees` extension in its config; a fresh repo without that extension never triggers it.
On a container with git < 2.48, `git config worktree.useRelativePaths true` is an inert no-op (unknown key), so absolute paths would silently persist and the "fix" would not fix.
Low risk, but the doc should not imply the bake-in is version-safe on its own; note the inert-no-op behavior on old git.

### Test Plan

The plan is genuinely hermetic: it extends `createBareRepoWorkspace` (which already writes `.bare/worktrees/<name>/gitdir` forward pointers) with a stale-entry option, requires no git binary and no container, and remembers `clearClassificationCache()`.
The six `scanWorktreeAdmin` cases map cleanly to the detection rules, and the `applyWorkspaceLayout` cases cover prunable-only / broken-live / mixed plus the config-still-mutated regression guard.
Two gaps: the ambiguous host-present-but-forward-pointer-absent case noted above, and no assertion that the current-worktree exclusion prevents duplicate warnings.

### Implementation Phases

Ordering is sound: Phase 1 (scanner) gates Phase 2 (policy) on the warning codes; Phase 3 (bake-in) is correctly marked independent; Phase 4 (container proof + optional `git worktree prune -n` cross-check) is correctly deferred and gated on container availability.
Success criteria are concrete and testable per phase.
No change requested here beyond folding the false-negative acknowledgment into Phase 1's scope.

### Convention compliance

**Blocking - stray authoring-tool tags at EOF.**
The file ends with literal `</content>` and `</invoke>` lines (`:343-344`).
These are leaked tool markup and must be removed.

BLUF is present and substantive.
Sentence-per-line is followed.
No em-dashes; colons and spaced hyphens used per convention.
The RFP back-link is present in the BLUF and the section prose.
Frontmatter validates against the spec (`type: proposal`, `status: review_ready`, tags focused).

## Verdict

**Revise.**
The architecture is correct and the co-tenant safety reasoning is the right call.
Blocking items are the unacknowledged broken-live-sibling downgrade, the `locked` ordering divergence from git's real prune order, and the stray EOF tags.
None require rethinking the approach; they require the proposal to state a tradeoff it currently hides and to correct one ordering claim.

## Action Items

1. [blocking] Add a Design Decisions subsection acknowledging that retiring `checkAbsolutePaths` downgrades broken-live container-created SIBLING worktrees (present host working tree, absolute back-pointer) from `status: "error"` to a benign `prunable-worktree` warning, and justify it via the host/container ambiguity, OR adopt the host-present-directory union check and accept its co-tenant cost. State which.
2. [blocking] Reorder `scanWorktreeAdmin` detection so `locked` is evaluated BEFORE the gitdir-missing/empty test, matching git's `should_prune_worktree`, and fix the mermaid diagram accordingly.
3. [blocking] Remove the stray `</content>` and `</invoke>` lines at the end of the proposal.
4. [non-blocking] Give `scanWorktreeAdmin` a current-worktree exclusion (or dedup by name) so the retained `:166-178` check does not produce duplicate `absolute-gitdir` warnings.
5. [non-blocking] Inject `worktree.useRelativePaths true` via its own unconditional `mergePostCreateCommand`, not gated behind `safeDirectory`, and note it is an inert no-op on container git < 2.48.
6. [non-blocking] Add a hermetic test for the ambiguous case (forward pointer `nonexistent-location` while the sibling directory is present) to lock in the chosen classification, plus a duplicate-warning guard.
7. [non-blocking] Add a NOTE that the scanner models the `prune` subcommand's default (`expire = TIME_MAX`), not `git worktree list`'s annotation, so the omitted index-mtime branch is intentional.

## Open Questions for the Author

The false-negative in item 1 is a genuine design fork, not just a documentation gap. Which resolution do you intend?

- Option A: Accept the downgrade. Broken-live siblings created container-side become warnings, consistent with the co-tenant stance. Simplest, keeps the pure admin scan. (Recommended if co-tenant live worktrees are common.)
- Option B: Union the scans. When a forward pointer reads `nonexistent-location`, also stat `<bareRepoRoot>/<name>/.git`; a present host directory with an absolute back-pointer stays a hard error. Restores today's coverage but hard-aborts live co-tenant worktrees whose working dir is visible on the host, partially defeating the RFP's goal.
- Option C: Defer to the source fix only. Rely on direction 3 to drain absolute entries and accept the transitional warning-only behavior, documenting that broken-live siblings are best-effort until the legacy stock clears.
