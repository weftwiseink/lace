---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T15:40:00-07:00
task_list: weftwise/parallel-feature-development/review
type: review
state: live
status: wip
tags: [rereview_agent, round-2, architecture, test_plan, portless, worktree, postCreateCommand]
---

# Review of "Streamlined Parallel Feature Development for Weftwise" (Round 2)

> BLUF(opus/weftwise-parallel-dev/review): All four round-1 blocking issues are addressed concretely.
> The `mergePostCreateCommand` composition fix is specified explicitly with an `&&`-joining contract and a Phase-1 unit test; the portless-vs-vite interaction is now an empirical probe (Phase 3 substep A) that gates the conditional Phase 2 relaxation; the BLUF explicitly carries the E2 caveat; and E7 plus the test plan now agree that `appPort: [3000]` is removed before measurement.
> A handful of small internal inconsistencies remain (the top-of-Implementation-Phases dependency summary still says "Phase 3 depends on 2" though the body now correctly inverts this for substep A; Story 3 still calls removal of `appPort: [3000]` "optional" while E7 and Phase 3 substep B treat it as canonical; the Phase 1 composition test specifies an "object" output shape that is wrong for the common case where the input has no prior `postCreateCommand`), but these are wordsmithing rather than design issues.
> Verdict: **Accept** with non-blocking polish notes.

## Summary Assessment

The revision is responsive and surgical.
Each blocking action item from round 1 maps to a specific, locatable change in the proposal: the BLUF caveat (line 21), the new "Vite dev-server port driving: empirical probe required" subsection (Part 1), the new "`mergePostCreateCommand` composition extension" subsection (Part 2), and the tightened E7 + Phase 3 substep B treatment of `appPort: [3000]`.
None of the non-blocking suggestions from round 1 were dropped: pnpm guard, sibling filter, run-as-node note, rootless-podman userns NOTE, sequencing rule for legacy-builder, rapid-succession registration probe, vite-binds-4xxx assertion, concrete cold-store wall time, and the store-incompatibility open question are all present.

The remaining issues are minor consistency tightenings and a single test-specification narrowing that an attentive implementer will spot and resolve in code review.
None require another full revision round.

## Verification of Round 1 Blocking Items

### Blocking 1: `mergePostCreateCommand` composition (Action Item 1)

**Status: addressed.**

Part 2's "`mergePostCreateCommand` composition extension" subsection (lines 258-273) commits to option (c) from round 1's question Q1: append to the existing `lace:workspace` value with `&&` joining, mirroring the string-branch behaviour at the existing line 240.
The before/after example at lines 266-269 makes the contract concrete.
Phase 1's "Files to modify" entry at line 621 explicitly lists `workspace-layout.ts:218-252` as the modification target, calling out `&& joining (mirroring the string-shaped branch at line 240)` and noting the idempotency preservation via `.includes(command)`.
Phase 1's "Tests" section at line 639 mandates an explicit composition test.

The fix is specified concretely enough that an implementer can write the code without further design clarification.

**Non-blocking nit on the test specification:** Line 639 says the composition test should "produce an object whose `lace:workspace` value contains BOTH commands joined by `&&`."
This is correct for the case where the input `config.postCreateCommand` is already an object (e.g., user-defined with named keys) or an array (which lifts to an object with `lace:user-setup` and `lace:workspace` keys at line 241-244).
But for the common case (weftwise's actual `devcontainer.json` has NO `postCreateCommand` at all), the first merge call hits the `!existing` branch and produces a plain string; the second merge call hits the string branch and produces a string `"safeDirectory && install-loop"`.
The result is a string, not an object with a `lace:workspace` key.
The test as worded would either need a fixture with a pre-existing object/array postCreateCommand, or it should be reworded to say "the final `postCreateCommand` contains BOTH commands joined by `&&` (as a string when the input was empty, or as the `lace:workspace` value when the input was object/array)."
The implementer will spot this on first test write; it is not load-bearing for the design.

### Blocking 2: Portless framework-flag injection vs vite relaxation (Action Item 2)

**Status: addressed.**

The proposal commits to a probe-first posture rather than papering over the unknown.
The new "Vite dev-server port driving: empirical probe required" subsection (lines 180-205) frames the probe explicitly, the probe-result table at lines 190-192 enumerates the three possible outcomes and their consequences for Phase 2, and the NOTE at line 203-205 honestly characterises this as the load-bearing unknown.
Phase 2's description at line 647-654 is correctly tagged "(conditional)" and the conditional logic is clear: vite-binds-4xxx → Phase 2 is documentation-only; vite-binds-3000 → Phase 2 applies the relaxation.
Phase 3 substep A at line 675-678 defines the probe operation in terms an implementer can execute.

The Phase 2 + Phase 3 substep A sequencing is internally consistent at the body level: Phase 2's prose explicitly notes "conditional on the empirical probe in Phase 3 (substep A)" and Phase 3 substep A is presented as a probe that "answers Phase 2's conditional."
The probe runs first, the relaxation decision follows, and Phase 3 substep B (the actual portless adoption commit) follows that.

**Non-blocking inconsistency:** The top-of-Implementation-Phases summary at lines 608-612 still asserts "Phases 1-2 can run in parallel. Phase 3 depends on 2."
With the substep restructuring, the true ordering is: Phase 1 || (Phase 3 substep A) → Phase 2 → Phase 3 substep B → Phase 4 → Phase 5.
Recommend tightening the summary to: "Phase 1 is independent. Phase 3 substep A runs first to inform Phase 2. Phase 2 (conditional) depends on Phase 3 substep A. Phase 3 substep B depends on Phase 2. Phase 4 depends on Phase 1. Phase 5 is the integration validation."

### Blocking 3: BLUF and Objective E2 caveat (Action Item 3)

**Status: addressed, well-placed.**

Round 1 question Q4 offered three options; the proposal effectively picks option (a) and adds it in both the BLUF (line 21) and the Objective (line 30).
The BLUF wording is direct: "Caveat (Edge Case E2): worktrees added AFTER `lace up` still require one manual `pnpm install --frozen-lockfile` per new worktree (~2.5s with the store mount)."
The Objective restates the same caveat in slightly fuller form.
A reader who reads only the BLUF now has no surprise when they reach Story 2 and Edge Case E2.

This satisfies the writing convention against glossing over deviations and front-and-centres the most material seam in the user pitch.

### Blocking 4: E7 contradiction with test plan port mappings (Action Item 4)

**Status: addressed.**

E7 at line 519-521 commits to removing `appPort: [3000]` as part of Phase 3, with the canonical post-proposal state being "portless only."
The test plan's expected port mappings at line 582 list `<lace-allocated>:1355` and the existing `22425:22425`, explicitly not including `3000:3000`.
Phase 3 substep B item 2 at line 705 makes the removal a Phase 3 step.
Phase 3 substep B verification at line 711 explicitly verifies `podman port weftwise` "no longer shows `3000:3000`."

The contradiction from round 1 is resolved.

**Non-blocking inconsistency, Story 3:** Lines 437-438 still describe the removal of `appPort: [3000]` as conditional and "optional" ("The old `appPort: [3000]` symmetric mapping can be removed. (It conflicts with portless's `22435:1355` for the host-port allocation; they are different host ports so removal is optional.)").
With E7 and Phase 3 substep B now treating removal as canonical, Story 3 should be tightened: "The old `appPort: [3000]` symmetric mapping is removed as part of this migration (E7); the post-proposal canonical config does not have it."

**Non-blocking inconsistency, timing wording:** E7 line 519 says "remove `appPort: [3000]` as part of Phase 3 (portless adoption) and replace it with portless **before measuring**."
Phase 3 substep B item 2 at line 705 says "Remove `appPort: [3000]` from the project devcontainer.json **once portless is the established workflow**."
"Before measuring" and "once portless is the established workflow" are close but not identical.
A literal reading of "established workflow" could push removal to after Phase 5; the test plan assumes removal before Phase 5.
Recommend aligning Phase 3 substep B item 2 to "Remove `appPort: [3000]` from the project devcontainer.json as part of this phase (before Phase 5 measurement)."

## Verification of Round 1 Non-Blocking Items

| Round 1 action item | Status | Location |
|---|---|---|
| 5a: pnpm guard in command literal | Addressed | Line 246, 628 |
| 5b: broader sibling filter | Addressed | Line 249, 628 (`.bare\|.lace\|.git\|.pnpm-store\|.worktree-root`) |
| 5c: run-as-node note | Addressed | Line 243, 626 |
| 6: rootless-podman userns NOTE in E5 | Addressed | Lines 497-500 (with concrete workarounds) |
| 7: D6 sync-server explicit non-scope | Addressed | Lines 380-382 |
| 8: legacy-builder sequencing rule | Addressed | Lines 167-176 (clear if/otherwise rule), reiterated in Phase 3 substep B item 1 lines 685-701 |
| 9: rapid-succession registration probe + vite-binds-4xxx assertion | Addressed | Test plan rows at lines 570-571; success criteria at lines 585-586 |
| 10: incompatible host-store open question | Addressed | Lines 793-798 (Q6) |
| 11: concrete cold-store wall-time budget | Addressed | Line 581 ("under 240s for N=3 worktrees") |
| 12: composition idempotency unit test | Addressed | Line 639 (with the spec-narrowness caveat above) |

All ten non-blocking items from round 1 are present.
None were lost in the revision.

## Section-by-Section: New Findings

### Legacy-builder sequencing rule (Part 1)

The rule at lines 167-176 is unambiguous: "If legacy-builder has landed for weftwise at implementation time → top-level `features`. Otherwise → `prebuildFeatures`."
Phase 3 substep B item 1 (lines 685-701) re-states the rule with concrete JSON snippets for each branch.
This is implementable without further clarification.

**Non-blocking polish:** Line 171 says "The pipeline calls `injectForBlock` (symmetric injection) but the portless feature's `customizations.lace.ports.proxyPort` declaration still produces a host-mapped allocation via the regular features-to-ports allocator path."
This is technically correct but the reference to `injectForBlock` is somewhat opaque without a line cite.
Recommend a brief citation (e.g., `packages/lace/src/lib/template-resolver.ts:???` for the symmetric injection path) so the implementer can verify the claim while editing weftwise's devcontainer.json.

### Phase ordering summary (Implementation Phases preamble)

As noted under Blocking 2, lines 608-612 do not reflect the substep-A-before-Phase-2 restructuring.
The body of Phase 2 and Phase 3 substep A correctly captures the cross-link, but the summary at the top of the section reads as if Phase 2 is unconditional and Phase 3 depends linearly on Phase 2.
This is non-blocking because the body prose is authoritative and the implementer reads top-to-bottom, but the summary is the first thing skimmers see and it does not match.

### Composition test specification (Phase 1)

Already covered under Blocking 1.
The test as worded will need slight rephrasing to handle the empty-`postCreateCommand` input case (which is weftwise's actual case).
This is a one-line fix in the test description, not a redesign.

### Story 3 vs E7 (canonical vs transitional `appPort`)

Already covered under Blocking 4.
Story 3 should be aligned with E7's canonical removal stance.

## New Issues Not Flagged in Round 1

### Verification Methodology step 2 mid-state

Line 596-597 says: "**After Phase 2 (weftwise vite config relaxation):** Run `lace up --rebuild` in a worktree and `pnpm dev` (NOT portless yet). Assert it still binds 3000 (env unset path)."
But Phase 2 is now conditional: if the probe returns "vite binds 4xxx," Phase 2 is documentation-only and the vite.config.ts is unchanged.
In that case, this verification step is trivially true (no code changed) but somewhat misleading as written; it implies the relaxation has been applied.
Recommend a one-line conditional: "If Phase 2 applied the relaxation, assert `pnpm dev` with `PORT` unset still binds 3000. If Phase 2 was documentation-only, this step verifies nothing new beyond Phase 0."

### `installDeps: boolean | string` interface widening (Phase 1)

Line 618 says: "extend `WorkspaceConfig.postCreate` interface with `installDeps?: boolean | string`."
D4 (lines 358-364) describes the reserved schema as `"auto" | "pnpm" | "npm" | "yarn" | true | false`, and Phase 1 implements only the boolean branch.
The `| string` widening at line 618 implies the implementer should already accept string values (presumably stored as `installDeps: "pnpm"` etc.) even though only `true` (and undefined/false) are handled in initial scope.

Is the implementer expected to accept-and-store the string values without acting on them, or to reject any non-boolean value with a warning?
This is a small but real under-specification.
Recommend Phase 1 specify behaviour for non-boolean values: either (a) `installDeps: "pnpm"` is accepted and treated identically to `true`, or (b) any non-boolean value is rejected with a warning and `installDeps` defaults to `false` for v1.
Option (a) lets weftwise opt-in early to the eventual `"auto"` semantics; option (b) is conservative and forces a follow-up migration when D4's broader detection lands.

This is not a blocker for acceptance; it can be settled at implementation time.
Worth a sentence in Phase 1 either way.

### Empirical test plan: bare-repo-root install behaviour

Test plan unit test 4 at line 543 asserts `applyWorkspaceLayout` with `installDeps: true` and `bare-root` classification still appends the install loop.
But the empirical test in Phase 5 is run from a worktree (`main`), where the iteration is over siblings.
There is no explicit empirical test that the loop iterates correctly when the user runs `lace up` from the bare-root rather than from a worktree.
The classification check at workspace-layout.ts:143-150 produces the same `bareRepoRoot` either way, so the unit test should be sufficient, but it is worth a single-sentence note in the empirical matrix that the bare-root case is covered by unit tests, not by the empirical matrix.

This is non-blocking and arguably unnecessary, but flagging for completeness.

## Verdict

**Accept.**

All four round-1 blocking issues are addressed concretely.
All ten non-blocking action items from round 1 are present in the revision.
The remaining issues are wordsmithing and minor internal-consistency polish (Implementation Phases summary, Story 3 framing, Verification Methodology conditional, `installDeps: boolean | string` semantic).
None require another full revision round.
The proposal is ready to advance to `implementation_ready`.

## Action Items

The following are non-blocking polish suggestions; the proposal may proceed without them, but addressing them before implementation will reduce implementer friction.

1. **[non-blocking]** Update Implementation Phases preamble (lines 608-612) to reflect the Phase 3 substep A → Phase 2 → Phase 3 substep B ordering.
   Current text reads "Phase 3 depends on 2" but the actual ordering is "Phase 2 depends on Phase 3 substep A, Phase 3 substep B depends on Phase 2."

2. **[non-blocking]** Reword the Phase 1 composition test (line 639) to cover both the empty-`postCreateCommand` input case (string output) and the pre-existing-object input case (object with `lace:workspace` key).
   Current wording assumes object output, which is wrong for weftwise's actual config.

3. **[non-blocking]** Align Story 3 (lines 437-438) with E7's canonical-removal stance: state that `appPort: [3000]` is removed (not optional) as part of this migration.

4. **[non-blocking]** Align E7 timing language ("before measuring") with Phase 3 substep B item 2 ("once portless is the established workflow").
   Recommend "as part of this phase (before Phase 5 measurement)" in both places.

5. **[non-blocking]** Clarify `WorkspaceConfig.postCreate.installDeps: boolean | string` semantic in Phase 1.
   Either accept-and-store string values without acting on them, or reject them with a warning.
   Choose one and document.

6. **[non-blocking]** Add a one-line conditional to Verification Methodology step 2 acknowledging that if Phase 2 was documentation-only (probe returned vite-binds-4xxx), the verification is trivial.

7. **[non-blocking]** Add a line citation to `injectForBlock` (line 171) so the implementer can verify the symmetric-injection-with-host-mapping claim while editing weftwise's devcontainer.json.

## Questions for the Author (multi-choice, non-blocking)

**Q1: `installDeps` type widening in Phase 1.**
- (a) Phase 1 accepts only `boolean` and rejects `string` values with a warning until D4's broader detection lands.
- (b) Phase 1 accepts `"pnpm"` as a string alias for `true`, with any other string falling back to a warning and `false`.
- (c) Phase 1 accepts any string but only acts on `"pnpm"` and `true`; future D4 work expands the acted-on set without a schema change.

**Q2: Composition test fixture shape.**
The composition test in Phase 1 needs a fixture input.
- (a) Use weftwise's actual case (empty `postCreateCommand`): assert the result is the joined string `"safeDirectory && install-loop"`.
- (b) Use an object-shaped input fixture (e.g., `{ "user:setup": "echo hi" }`): assert the result has both `user:setup` and `lace:workspace` keys, with `lace:workspace` containing the joined commands.
- (c) Both. Cover the string-output and object-output paths with separate test cases.
