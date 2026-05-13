---
review_of: cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T22:15:00-07:00
task_list: lace/prebuild-cache-rethink/legacy-builder-migration
type: review
state: live
status: done
tags: [self, fresh_agent, runtime_validated, prebuild, migration, legacy_builder]
---

# Review: Migrate Away From `lace prebuild` Using the Legacy Builder's Local Layer Cache

## Summary Assessment

The proposal closes a five-week investigation arc cleanly: the central direction (delete `lace prebuild`, lean on the legacy builder's local layer cache, accept the cross-machine/cross-project sharing forfeit) is well-supported by empirical evidence and source analysis.
The validating experiment's headline numbers (234s cold, 16s warm, 57/63 instruction steps cached, 15x speedup) are verbatim-correct against the report; the "57 of 63" framing is sharper than the experiment's own "57/57 instruction layers" framing, but the math reconciles cleanly via the 6 stage-anchor `FROM ... AS ...` instructions that podman never annotates with cache markers.

However, the "What leaves lace" deletion enumeration is **materially incomplete** compared to the source-analysis report it cites: it omits the `lace status` subcommand, `lib/status.ts` (~117 LoC), `lib/validation.ts`, and several test files (`e2e.test.ts`, `status.integration.test.ts`, `validation.test.ts`).
This is the only finding that rises to "blocking" severity; the rest is non-blocking polish.

Verdict: **Revise (light)**. Two blocking items (incomplete deletion inventory; missing `BUILDAH_LAYERS=false` removal directive), several non-blocking suggestions.

## Section-by-Section Findings

### BLUF and Background

**Non-blocking, accurate.** The empirical claims spot-check correctly against [`cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`](../reports/2026-05-12-experiment-legacy-builder-cache.md):

- "234s cold, 16s warm" maps to the report's `3:54.71 (234.71s)` and `0:15.62 (15.62s)`.
- "15x speedup" maps to the report's `6.65%` ratio (1/0.0665 ≈ 15.0).
- "57/63 instruction steps cached" reconciles with the report's `57 of 57 instruction layers reporting --> Using cache` plus the 6 stage-anchor `FROM ... AS ...` instructions that podman does not annotate.
  The proposal's framing ("57 of 63 instruction steps cached") is the more conservative number and is arguably more honest.
- "All feature install scripts cached" maps to the report's "every actual instruction layer hit cache" and the explicit per-feature enumeration.

The Background's seven-point structure cleanly summarises the five-week arc and cites each contributing report. The pacing (one paragraph per finding) and the use of footnote-style links rather than inline explanation keeps the section scannable.

### Proposed Solution: Pipeline change

**Non-blocking, clear.** The before/after pipeline diff is accurate against `up.ts:1287-1329`. The proposal correctly identifies what *stays* at the `runDevcontainerUp` invocation site (`--buildkit never`, the `dev_container_feature_content_temp` cleanup).

### Proposed Solution: What stays in lace

**Non-blocking, complete enough.** All five enumerated items are load-bearing per the experiment report and the bug-investigation reports.

The framing of `chmod 1777 /tmp` as "belt-and-suspenders" is honest: the pre-test experiment ([`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](../reports/2026-05-12-pretest-experiment-buildkit-never-drop.md)) showed the chmod *alone* is insufficient against `#6503`. The proposal does not overclaim its protective value, which matches the experimental evidence.

### Proposed Solution: What leaves lace

**Blocking (incomplete inventory).** Cross-referenced against the source-analysis report ([`cdocs/reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md`](../reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md)), the following items are missing from the proposal's deletion list:

1. **`packages/lace/src/commands/status.ts`** (the CLI subcommand wrapper).
   The source-analysis report's "Subcommand Impact Map" lists `lace status` alongside `lace prebuild` and `lace restore` as fully prebuild-coupled and slated for deletion. The current state of `commands/status.ts` confirms this: its entire body is `runStatus()` from `lib/status.ts` and its description is "Show current prebuild state (original image, prebuild image, staleness)." Without `prebuildFeatures`, `lace status` has nothing to report.

2. **`packages/lace/src/lib/status.ts`** (~117 LoC).
   The source-analysis report classifies this as "Easy-redirect (delete or repurpose)." It is prebuild-only.

3. **`packages/lace/src/lib/validation.ts`**.
   Both functions in the file (`validateNoOverlap`, `featureIdentifier`) exist solely to validate that `prebuildFeatures` and `features` don't share identifiers. With `prebuildFeatures` removed, the entire file becomes dead. Source analysis flags this at entanglement #5.

4. **Test files**:
   - `packages/lace/src/commands/__tests__/status.integration.test.ts` (entire file)
   - `packages/lace/src/lib/__tests__/validation.test.ts` (entire file)
   - `packages/lace/src/__tests__/e2e.test.ts` (entire file — source analysis describes it as "purely the prebuild lifecycle e2e")
   - Updates to `packages/lace/src/__tests__/portless-scenarios.test.ts`, `claude-code-scenarios.test.ts`, `fundamentals-scenarios.test.ts`, and `docker_smoke.test.ts` (trim prebuild cases)

5. **Subcommand-registration removal in `packages/lace/src/index.ts`** beyond just `prebuild`/`restore` (also `status`).

The proposal's Phase 4 step 7 says "remove references to the deleted subcommands" generically, but the deletion enumeration is what the implementer cross-checks at PR review time. The omitted items together represent **roughly 120-150 LoC of source plus 200+ LoC of tests** that the LoC estimate (400-700 source / 150-200 tests) probably already includes but the explicit enumeration does not.

6. **`BUILDAH_LAYERS=false` removal.**
   The validating experiment explicitly recommends (Implications #3): "Stop setting `BUILDAH_LAYERS=false`. The lace workaround in `prebuild.ts:332` for stale feature content is unnecessary if cleanup runs reliably before each build; the cache benefit of leaving layers on is substantial."
   This is load-bearing for the experiment's 15x speedup claim - the experiment ran with `BUILDAH_LAYERS` unset.
   The proposal mentions retaining the `dev_container_feature_content_temp` cleanup but does not call out that `BUILDAH_LAYERS=false` (currently set in `prebuild.ts:331`) must be removed alongside the prebuild pipeline deletion. This is implicit in deleting `prebuild.ts`, but `BUILDAH_LAYERS=false` could plausibly be re-introduced elsewhere as a defensive measure unless the proposal explicitly forbids it.

The proposal would be sharper if "What leaves lace" enumerated specific function names (`validateNoOverlap`, `injectForPrebuildBlock`, `warnPrebuildPortTemplates`, `warnPrebuildPortFeaturesStaticPort`) the way the source-analysis report does. The current bullet-level granularity ("Strip from existing files... remove `extractPrebuildFeaturesRaw` and the prebuild-vs-features merge logic") is correct but loses information.

### Important Design Decisions

**Non-blocking, well-reasoned.**

The "Why the legacy builder is acceptable" subsection cleanly delivers the verdict (6.65% ratio, comfortably below the <50% pass criterion).

The "Why we don't try to preserve the clean-environment guarantee" subsection is the most important design decision in the document and the proposal frames it honestly: the guarantee is *emergent*, not designed, and reinventing it post-deletion would amount to re-implementing prebuild.
This is the right call.

The "Why we don't introduce `lace cache prune`" subsection cleanly cites the user-stated cleanup ownership preference. Good.

The "Why we don't auto-inject the `chmod 1777 /tmp` workaround" subsection correctly handles the chmod-injection RFP retirement question (see "RFP retirement" below).

### Forfeit framing prominence

**Non-blocking, adequate.** The forfeit of cross-machine and cross-project sharing is documented in three places:

1. BLUF: "Scope is intentionally narrow: local layer cache only, single project on single machine, no remote registries."
2. Important Design Decisions: "Cross-machine and cross-project sharing are explicitly forfeited by this proposal per the author's stated constraint."
3. Summary: "The proposal is intentionally narrow scope: local layer cache, single project, single machine. Cross-machine and cross-project sharing are forfeited."

A future reader will not mistake this for an accidental omission. The forfeit also reframes the cost honestly ("one cold build per (project, machine) pair, not per build"). This is fine.

One non-blocking suggestion: the BLUF could call out that this is a deliberate trade against the prior `lace.local/*` design that *did* enable cross-project sharing (and was the source of the 2026-05-05 incident). The current framing emphasises what is forfeited but does not emphasise that the forfeit is the exact mechanism that closes the collision class. Adding "(closes the collision class structurally; eliminates the `lace.local/*` namespace that caused 2026-05-05)" to the BLUF's scope sentence would make the trade-off visible at first read.

### Edge Cases: Env-order conflicts

**Non-blocking, adequate.** The proposal correctly cites the validating experiment's `NPM_CONFIG_PREFIX` + node-feature exit-11 incident and documents the remediation in three concrete steps (audit, classify, verify).

The "if a project surfaces an uncloseable conflict, follow-up RFP" escape hatch (NOTE callout at line 202-204) is appropriately realistic. The empirical base is two real projects with one known case, so calling it "rare" is supportable. The follow-up RFP for a per-feature pre-install ENV-clear mechanism is a well-scoped escape hatch.

One non-blocking refinement: the remediation list could explicitly note that lace's pre-deletion `prebuildFeatures` separation *incidentally* avoided this class of conflict for the prebuild-feature subset (per the validating experiment's Failure Mode #2 finding, "lace's feature orchestration is either avoiding this transitive pull or unsetting the env, which is worth verifying"). This is true and is part of *what is being forfeited* by the migration. Documenting it makes the trade-off legible.

### Edge Cases: wezterm-server asymmetric port injection (Phase 3)

**Non-blocking, the proposal's resolution is concrete enough.** The proposal's framing — "either (a) rely on the now-unified allocator path or (b) declare a static `appPort` in weftwise's `devcontainer.json`" — maps to two real, executable options that the source analysis predicted.

Reading `template-resolver.ts:162-268`, the asymmetric path (`injectForPrebuildBlock`) writes into `config.appPort` with the form `${lace.port(short/option)}:DEFAULT_PORT`, where `DEFAULT_PORT` comes from the feature metadata's option default. The symmetric path (`injectForBlock`) writes into the feature option *value* itself, with no asymmetric host:container mapping.

For wezterm-server's `hostSshPort` option specifically, the question is: does the in-container SSH listener accept a runtime-configurable port via the feature option? If yes, option (a) works (the symmetric path sets the feature option to `${lace.port(...)}`, which becomes the same on both sides). If no, the user must hand-write `appPort` in weftwise's devcontainer.json (option b).

The proposal's framing of these two options is correct and concrete. A reviewer asked whether it "actually resolves or defers." The honest answer: Phase 3 resolves *the lace-side mechanism* (verify and possibly extend the regular allocator to honour `hostSshPort`-style declarations) and *defers the per-feature decision to weftwise's owner*. That deferral is appropriate because the decision is project-specific, but the proposal could be clearer that Phase 3 has two distinct deliverables (the lace code change + the project-level config change in weftwise).

One non-blocking refinement: Phase 3 substep 4 conflates the two deliverables ("Migrate weftwise's wezterm-server port handling: either rely on the unified allocator, or declare a static `appPort`"). Splitting this into "4a: ensure the lace-side allocator handles the feature's declaration; 4b: migrate weftwise's config accordingly" would make the phase boundaries clearer.

### Edge Cases: `dev_container_feature_content_temp` cleanup, Dockerfile drift, one-time cleanup

**Non-blocking, accurate.** All three are documented correctly. The "Drift in user Dockerfiles independent of lace" callout (pnpm@latest-10 drift) is appropriately scoped: it surfaces a real issue from the experiment without conflating it with the migration's concerns.

### Test Plan and Verification Methodology

**Non-blocking, adequate.** The pass criterion of "warm build < 30% of cold" is generous (the experiment hit 6.65%, well below) and gives realistic buffer for less-cache-friendly projects.

Two non-blocking suggestions:

1. The "All features functional" check (Per-project verification step 3) is good but could specify: "specifically including any feature whose `customizations.lace.mounts` declaration must survive the move from `prebuildFeatures` to `features`." The source-analysis report's Scenario C7 (`claude-code-scenarios.test.ts:355-392`) validates exactly this; the per-project verification should hit the same surface.

2. The dogfooding paragraph could note that lace's own `.devcontainer/devcontainer.json` uses `prebuildFeatures` per the source-analysis report's user-config inventory. The proposal flags this in Phase 7 step 1 but the Test Plan's "Dogfooding" section could explicitly link to Phase 7.

### Implementation Phases

**Non-blocking, sequentially-coherent with one ordering concern.**

The seven phases are largely independent and follow a defensible order: per-project migration first (Phases 1-2), then the one lace-side blocker (Phase 3), then deletion (Phases 4-6), then dogfooding (Phase 7).

One ordering question: **Phase 4 (lace code deletion) presupposes that all consuming projects have already migrated**, but the source-analysis report inventories seven user configs (whelm, backup, weftwise, lace, clauthier, dotfiles, lace worktree) of which the proposal explicitly migrates only **three** in Phases 1, 2, and 7 (weftwise, whelm, lace itself). The other four (backup, clauthier, dotfiles, lace worktree) are not addressed.

The proposal could either:
- (a) Add a Phase 2.5 ("Migrate remaining user configs: backup, clauthier, dotfiles") before Phase 4.
- (b) Explicitly classify these as out-of-scope (e.g., "backup is a clone of whelm and follows the same migration; clauthier and dotfiles are trivial per the source-analysis report; lace worktree is auto-generated and N/A").
- (c) Add a generic "migrate any other user configs" substep.

The current state — silent omission — is the weakest option, because a future implementer reading the proposal will not know whether these are intentionally deferred or accidentally forgotten.

A related ordering observation: **Phase 3 (wezterm-server) is technically a Phase 1 prerequisite** if weftwise's wezterm-server port handling must work *before* the rest of weftwise is migrated. The proposal places Phase 1 (weftwise) before Phase 3 (wezterm-server). If Phase 1's success criterion is "weftwise's `lace up` works without `customizations.lace.prebuildFeatures` set," and wezterm-server's port handling is gated on Phase 3, then Phase 1 cannot meet its success criterion until Phase 3 is also complete.

The proposal hints at this in Phase 1 substep 3 ("Move all six prebuildFeatures to top-level `features`") but does not call out that this transition is gated on Phase 3's lace-side allocator work. The phase order may need adjustment, or Phase 1 may need a "depends on Phase 3" caveat.

> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): The proposal's Phase 3 NOTE callout says "This phase should complete before Phase 4 code deletion" but does not address its relationship to Phase 1 (weftwise migration). A re-ordering to Phase 3 -> Phase 1 -> Phase 2 -> Phase 4..7 would be more defensible.

### Phase 4 specifics

The substep enumeration in Phase 4 lists files to delete and files to strip but does not name the specific functions to remove (per the gap identified in "What leaves lace" above). Substep 1 references the deletion of `prebuild.ts`, `restore.ts` (but not `status.ts`), `dockerfile.ts`, `metadata.ts`, `lockfile.ts`. Adding `status.ts` and `validation.ts` would align with the source-analysis report's enumeration.

Substep 5 ("Remove `prebuildFeatures` from the schema") is correct but should also call out: "And update the merge target in `applyUserConfig` (`user-config-merge.ts:158-173`) to always route into `features`, drop `mergedPrebuildFeatures` from the return type, and update the three callsites in `up.ts`." The source-analysis report calls this out explicitly.

### Phase 6 (Documentation)

**Non-blocking, complete.** The five documentation surfaces named are appropriate.

### Phase 7 (Dogfooding)

**Non-blocking, appropriately tight.** The one-time cleanup script is documented in Edge Cases and re-referenced in Phase 7 step 6. Good.

### chmod-injection RFP retirement

**Non-blocking, recommendation is honest.** Cross-checked against [`cdocs/proposals/2026-05-12-rfp-auto-inject-tmp-workaround.md`](../proposals/2026-05-12-rfp-auto-inject-tmp-workaround.md):

The chmod-injection RFP's stated motivation is:
> Make any lace-managed devcontainer build immune to `containers/buildah#6503` on rootless podman, without requiring the user to know about or apply the workaround themselves.

The RFP's own framing acknowledges (Open Question #1) that the answer to "is the chmod actually sufficient on its own?" is gated on the pretest experiment. The pretest experiment ([`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](../reports/2026-05-12-pretest-experiment-buildkit-never-drop.md)) answered: "No, the chmod alone is insufficient. `--buildkit never` is load-bearing."

Given that:
- The migration proposal commits to keeping `--buildkit never` (Phase 4 substep 3, "Retain the `--buildkit never` flag").
- The legacy builder routes through `COPY --from` instead of `RUN --mount=type=bind` and thus does not trigger `#6503`.
- The chmod is harmless but provides no additional protection on the legacy-builder path.

The migration proposal's recommendation to retire the chmod-injection RFP is honest. The RFP's residual use case ("if lace drops `--buildkit never` (a separate plausible follow-up after the pre-test experiment), user projects without the chmod will start failing") is no longer plausible: the pre-test experiment falsified the drop-`--buildkit never` premise, and the migration proposal makes `--buildkit never` durably load-bearing.

One non-blocking suggestion: the migration proposal could explicitly cite the pretest experiment's "No, chmod alone is insufficient" finding when arguing for chmod-injection retirement (lines 174-180). Currently it cites only the pre-test result generically.

A residual use case the proposal does *not* surface but which the chmod-injection RFP author may want to consider: if a future lace user explicitly *wants* BuildKit (e.g., for `--mount=type=cache` benefits) and is willing to accept the `#6503` risk for non-feature-install layers, the chmod-injection mechanism could be useful as opt-in. But this is speculative and well outside the migration proposal's scope.

### Author checklist compliance

**Non-blocking, hits each bullet.**

- BLUF clarity: yes, the BLUF leads with the verdict, the empirical justification, and the scope constraint.
- Source citations: yes, six references in the BLUF, more throughout.
- "Why" not just "what": the four-subsection "Important Design Decisions" section is structured around "why" questions.
- Writing conventions: sentence-per-line is consistent. No em-dashes. NOTE callouts are attributed (`opus/lace/prebuild-cache-rethink/legacy-builder-migration`).
- NOTE callouts where future readers need context: yes, three of them, all placed where context is needed (env-order escape hatch, Phase 3 ordering, chmod-RFP retirement).
- Follow-able for someone unfamiliar: a fresh agent can read the proposal and the Background section orients them to the five-week arc. The seven referenced reports provide depth on demand.

The one author-checklist gap: "whether there is anything inconsistent or missing from the initial draft" — the missing `status.ts`/`validation.ts`/`e2e.test.ts` enumeration items are exactly the class of omission this checkpoint is supposed to catch.

## Verdict

**Revise (light).**

The proposal's central direction is sound and well-supported by the validating experiment.
Two blocking items need correction before `implementation_ready`; both are deletion-list completeness, not design changes.
The remaining items are non-blocking polish.

## Action Items

1. **[blocking]** Add to "What leaves lace" deletion enumeration:
   - `packages/lace/src/commands/status.ts` (the `lace status` subcommand wrapper).
   - `packages/lace/src/lib/status.ts` (the status pipeline, ~117 LoC).
   - `packages/lace/src/lib/validation.ts` (entirely prebuild-only: `validateNoOverlap`, `featureIdentifier`).
   - `packages/lace/src/commands/__tests__/status.integration.test.ts`.
   - `packages/lace/src/lib/__tests__/validation.test.ts`.
   - `packages/lace/src/__tests__/e2e.test.ts` (per source analysis, "purely the prebuild lifecycle e2e").
   - Update Phase 4 substep 1 to include `status.ts` and `validation.ts`.

2. **[blocking]** Add to "What stays / leaves" or to Phase 4: explicit removal of `BUILDAH_LAYERS=false` from `prebuild.ts:331` (and a directive to *not* re-introduce it elsewhere as a defensive measure). The validating experiment ran with `BUILDAH_LAYERS` unset and explicitly recommends stopping setting it.

3. **[non-blocking]** Address the four user configs not covered by Phases 1, 2, 7 (backup, clauthier, dotfiles, lace worktree). Either add a Phase 2.5 or explicitly classify them out-of-scope with rationale.

4. **[non-blocking]** Reconcile Phase 1 (weftwise migration) ordering vs Phase 3 (wezterm-server lace-side work). Either re-order (Phase 3 before Phase 1) or add an explicit "Phase 1 depends on Phase 3 for the wezterm-server port handling" caveat. Currently the proposal implies Phase 1 can succeed independently, but weftwise's `appPort` resolution is gated on Phase 3.

5. **[non-blocking]** In the chmod-injection RFP retirement subsection, cite the pretest experiment's specific "chmod alone is insufficient" finding (`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`) as the disposition of the RFP's Open Question #1.

6. **[non-blocking]** Split Phase 3 substep 4 into 4a (ensure the lace-side allocator handles the feature's declaration) and 4b (migrate weftwise's config accordingly) to clarify the two distinct deliverables.

7. **[non-blocking]** In the env-order remediation guidance (Edge Cases), explicitly note that the pre-deletion `prebuildFeatures` separation incidentally avoided this class of conflict for prebuild-feature transitive dependencies. Documenting this makes the trade-off legible to the reader.

8. **[non-blocking]** Enumerate specific function names to delete in "What leaves lace" the way the source-analysis report does (`validateNoOverlap`, `injectForPrebuildBlock`, `warnPrebuildPortTemplates`, `warnPrebuildPortFeaturesStaticPort`, `featureIdentifier`). The current bullet-level granularity is correct but loses information that the implementer will re-derive at PR time.

9. **[non-blocking]** Optionally sharpen the BLUF to call out that the forfeit of cross-project sharing is *the mechanism* that closes the 2026-05-05 collision class, not merely a coincident consequence.

## Clarification Questions for the Author

These are optional refinements; the proposal is acceptable after addressing the blocking items even if these go unanswered.

**Q1: Phase ordering between weftwise migration and wezterm-server lace-side work.** Is the intent that Phase 3 must precede Phase 1, or that Phase 1 can succeed with a temporary hand-written `appPort` in weftwise pending Phase 3? The proposal is ambiguous on this point.

Options:
- (a) Re-order to Phase 3 -> Phase 1 -> Phase 2 -> Phase 4..7.
- (b) Keep current order; add a "Phase 1 may require a temporary hand-written `appPort` in weftwise's devcontainer.json until Phase 3 lands" caveat.
- (c) Keep current order; allow Phase 1 to defer wezterm-server until Phase 3 (i.e., Phase 1 success means "all features except wezterm-server function").

**Q2: Scope of other user configs.** The source-analysis report lists seven user configs using `prebuildFeatures`. The proposal explicitly migrates three (weftwise, whelm, lace itself). For the other four (backup, clauthier, dotfiles, lace worktree):

Options:
- (a) Migrate them in Phase 2.5 (add explicit substeps).
- (b) Document as out-of-scope; their owners migrate post-Phase 4 using the documentation produced in Phase 6.
- (c) Migrate trivial cases (backup, clauthier, dotfiles) in a single fold; explicitly skip lace worktree (auto-generated).

**Q3: `BUILDAH_LAYERS=false` retirement.** Is the intent to:

Options:
- (a) Remove `BUILDAH_LAYERS=false` as part of Phase 4 (delete `prebuild.ts` and don't re-introduce the env-var setting elsewhere).
- (b) Add explicit Phase 4 substep to verify `BUILDAH_LAYERS` is not set anywhere in lace after deletion.
- (c) Keep `BUILDAH_LAYERS=false` defensively at the `runDevcontainerUp` site, even though the experiment recommends against it.

Reviewer's recommendation: (a) - that's what the experiment recommends and what the proposal implicitly does, but it should be made explicit.
