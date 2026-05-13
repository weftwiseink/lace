---
review_of: cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-05T13:50:00-07:00
task_list: lace/prebuild-cache-rethink/legacy-builder-migration
type: review
state: live
status: done
tags: [self, fresh_agent, rereview_agent, prebuild, migration, legacy_builder, lace_prebuild_deletion]
---

# Round-2 Review: Migrate Away From `lace prebuild` Using the Legacy Builder's Local Layer Cache

## Summary Assessment

Round-2 verifies that the five round-1 fixes landed.
All five did, with one new minor gap introduced by the revision (the BLUF and Summary still cite the pre-revision LoC estimate), one pre-existing internal inconsistency that the round-1 review missed (`validation.test.ts` is double-listed as both trimmed and deleted), and one cosmetic phase-numbering breadcrumb in the "Implementation Phases" header note.

None of these are blocking.
The deletion inventory now matches the source-analysis report's enumeration; `BUILDAH_LAYERS=false` is explicit in both "What leaves lace" and Phase 4 success criteria; Phase 1 -> Phase 2 dependency is stated in two places; the chmod-RFP retirement now cites the pre-test experiment directly.

Verdict: **Accept** with three non-blocking nits.

## Round-1 Fix Verification

### Fix 1: Deletion inventory completeness — LANDED

Cross-referenced "What leaves lace" (lines 114-179) against the source-analysis report's "What 'Delete prebuildFeatures' Would Look Like Concretely" (lines 226-258) and "Test Surface Impact" (lines 186-208):

Source files deleted entirely:
- `commands/{prebuild, restore, status}.ts` — all three present (lines 117-119).
- `lib/{prebuild, status, restore, dockerfile, metadata, lockfile}.ts` — all six present (lines 120-125).

Strip enumeration covers:
- `up.ts`: lines 347-353, 393-394, 797-800, 806-836, 408, 545-550, 888-926 — matches the source-analysis report's bullets.
- `template-resolver.ts`: `extractPrebuildFeaturesRaw`, `injectForPrebuildBlock`, `warnPrebuildPortTemplates`, `warnPrebuildPortFeaturesStaticPort`, lines 564-566 — all four functions named with correct line numbers (matches the source-analysis report Table-row #6/7 and entanglement #14).
- `validation.ts`: `validateNoOverlap` (lines 23-39) and `featureIdentifier` (lines 10-14) — present and correctly identified as the entire prebuild-only file content.
- `user-config-merge.ts`: lines 158-173 plus `mergedPrebuildFeatures` return-type drop — present.
- `user-config.ts`: schema removal — present.
- `devcontainer.ts`: `extractPrebuildFeatures` (137-163), `generateTempDevcontainerJson` (228-241) — present.
- `index.ts`: three subcommand registrations — present.

Tests deleted entirely:
- `dockerfile.test.ts`, `lockfile.test.ts`, `metadata.test.ts`, three `*.integration.test.ts` files (prebuild/restore/status), `e2e.test.ts` — all seven present.

Tests trimmed:
- `template-resolver.test.ts` (with `injectForPrebuildBlock` tests T1-T5 and the prebuild sub-cases at 826/851/1235/1263/1305 explicitly enumerated) — matches the source-analysis report verbatim.
- `devcontainer.test.ts` (lines 48-241), `user-config-merge.test.ts` (line 249-), `up.integration.test.ts`, `validate.test.ts` (lines 110-138), `portless-scenarios.test.ts` P1, `claude-code-scenarios.test.ts` C7, `docker_smoke.test.ts` prebuild-runs section — all present.

The deletion inventory now matches the source-analysis report comprehensively.
The line-level granularity addresses round-1 action item #8 (function-name enumeration) at the same time.

### Fix 2: `BUILDAH_LAYERS=false` removal — LANDED

Three explicit references in the revised proposal:
- "What leaves lace" line 120: "Note: this includes the `BUILDAH_LAYERS=false` env-var manipulation at `prebuild.ts:330-331` and its restoration at `prebuild.ts:352-357`. **The post-deletion lace does NOT re-introduce `BUILDAH_LAYERS=false` anywhere.**"
- Phase 4 substep 2 (line 386): "Per 'What leaves lace' above, this also removes the `BUILDAH_LAYERS=false` env-var manipulation that lived inside `prebuild.ts:330-357` — the post-deletion lace must not re-introduce it anywhere."
- Phase 4 success criteria (line 402): "`BUILDAH_LAYERS=false` does not appear anywhere in lace source."

This addresses Q3 from the round-1 review with option (a) plus option (b): both removal and post-condition verification.
Good.

### Fix 3: Phase 1 -> Phase 2 dependency — LANDED

- "Implementation Phases" preamble note (line 333): "Phase 1 (handle wezterm-server) precedes Phase 2 (migrate weftwise) because weftwise uses the wezterm-server feature, which currently relies on the asymmetric `autoInjectPortTemplates` path for prebuild features."
- Phase 2 NOTE callout (line 348): "Depends on Phase 1 (wezterm-server port handling) being resolved (either the allocator extension or the static-appPort fallback)."
- Phase 2 substep 4 (line 356): "Apply Phase 1's wezterm-server resolution: either rely on the extended allocator, or set `\"appPort\": <allocated>` in `devcontainer.json`."

Phase renumbering is consistent:
- Phase 1: wezterm-server port injection (lace-side prerequisite).
- Phase 2: Migrate weftwise.
- Phase 3: Survey and migrate remaining user projects (addresses round-1 action item #3 — the four uncovered user configs).
- Phase 4: Lace code deletion.
- Phase 5: Test surface update.
- Phase 6: Documentation update.
- Phase 7: Dogfood and ship.

Phase 3 explicitly names `backup`, `clauthier`, `dotfiles`, `lace`-worktree variants (line 366), closing the round-1 gap on uncovered user configs.

The chain of cross-references inside Phase 4 substep 4 (line 392: "post-Phase 1 — only safe to delete after wezterm-server allocator path is resolved") is consistent with the new numbering.

### Fix 4: Chmod-RFP retirement cites the pre-test experiment — LANDED

Line 211: "The pre-test experiment ([`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](../reports/2026-05-12-pretest-experiment-buildkit-never-drop.md)) empirically confirmed that `chmod 1777 /tmp` in the base image does not by itself prevent `#6503` from corrupting `/tmp` at subsequent feature install layers — both Variant 1 (no chmod) and Variant 2 (chmod only) failed identically at the same `apt-get update` step."

The citation is now direct (path + report), names both variants tested, and identifies the failure point (`apt-get update` step).
This addresses round-1 action item #5.

### Fix 5: Phase 5 test enumeration matches source analysis — LANDED

Phase 5 substeps (lines 408-422) list:
- Entire-file deletions: `{dockerfile, lockfile, metadata, validation}.test.ts`, the three `*.integration.test.ts` files, `e2e.test.ts`.
- Trimmed: 8 files, each with the source-analysis report's specific line citations (e.g., `devcontainer.test.ts` lines 48-241, `validate.test.ts` lines 110-138, `user-config-merge.test.ts` line 249-, `template-resolver.test.ts`'s T1-T5 and 826/851/1235/1263/1305).

The Phase 5 enumeration matches the source-analysis report's "Test Surface Impact" section line-for-line.

## New Gaps Introduced by the Revision

### Nit 1 (non-blocking): BLUF and Summary still cite the pre-revision LoC estimate

The "What leaves lace" section (line 178) now correctly reports "Approximately 800-1000 LoC source (revised up from initial 400-700 estimate) + 200-300 LoC tests deleted."

The BLUF (line 23) and Summary (line 456) still cite the old number: "Approximately 400-700 LoC of source plus 150-200 LoC of tests deleted from lace" (BLUF) and "Deleting `lace prebuild` is roughly 400-700 LoC of source and 150-200 LoC of tests" (Summary).

A future reader hitting the BLUF first will form an under-estimate of scope. This is a minor consistency gap that should be reconciled in a single pass. Suggested:

- BLUF line 23: change to "Approximately 800-1000 LoC of source plus 200-300 LoC of tests deleted from lace; one user-facing behaviour change (feature install env-order) requires migration-time remediation per project."
- Summary line 456: change to "Deleting `lace prebuild` is roughly 800-1000 LoC of source and 200-300 LoC of tests."

### Nit 2 (non-blocking): `validation.test.ts` double-classification

Pre-existing inconsistency that the round-1 review missed and the round-2 revision did not fix:

- "What leaves lace" line 160 lists `validation.test.ts` under "Tests trimmed (delete prebuild-specific cases, keep file)" with the caption "delete `validateNoOverlap` tests entirely."
- Phase 5 substep 1 line 410 lists `validation.test.ts` under "Delete entire test files."

These two classifications contradict each other. The Phase 5 classification (delete entire file) is correct: `validation.test.ts` only exports tests for `validateNoOverlap` and `featureIdentifier`, both of which are being deleted along with their source file `validation.ts`.

After the deletion, the test file would have nothing left to test, so the entire file disappears. The "What leaves lace" entry on line 160 should be removed from the "Tests trimmed" subsection and added to the "Tests deleted entirely" subsection at line 148-155.

### Nit 3 (non-blocking): Pre-amble breadcrumb on "Implementation Phases"

Line 333's preamble note is good in substance but reads a bit awkwardly because it is rendering as a single inline `> Phase ordering note: ...` block-quote line. Compare with the structure used for the chmod-injection RFP NOTE callouts elsewhere in the document, which use the `NOTE(attribution): ...` convention.

Suggested rewrite as a proper attributed NOTE:
```
> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): Phase 1 (handle wezterm-server) precedes Phase 2 (migrate weftwise) because weftwise uses the wezterm-server feature, which currently relies on the asymmetric `autoInjectPortTemplates` path for prebuild features. Migrating weftwise's features out of `prebuildFeatures` without first ensuring the regular allocator handles wezterm-server's `hostSshPort` would break the host SSH binding.
```

This is purely stylistic; the content is correct.

## Pre-existing Items Not Re-raised

Round-1 non-blocking items #4 (Phase ordering), #6 (Phase 3 substep split), #7 (env-order remediation note about transitive-dependency forfeit), and #9 (BLUF sharpening on the collision class) were not directly raised in this round-2 brief; they are still optional polish.

Round-1 item #4 is *substantially addressed* by the new phase numbering — Phase 1 (wezterm-server) is now explicitly the prerequisite for Phase 2 (weftwise migration). The two-deliverable split (item #6) is not explicitly done in the new Phase 1, but Phase 1 substep 3 (allocator extension on a feature branch) and substep 4 (static `appPort` fallback recipe) implicitly separate the two paths.

These remain optional and do not block acceptance.

## Verdict

**Accept.**

All five round-1 blocking and substantive non-blocking fixes landed correctly.
The three nits surfaced in round-2 are cosmetic/consistency issues that the author may address in a follow-up pass before merging, but do not block status transition to `implementation_ready`.

The deletion inventory now matches the source-analysis report; `BUILDAH_LAYERS=false` is explicit; phase ordering is coherent; the chmod-RFP retirement cites the experimental falsification by path.

## Action Items

1. **[non-blocking]** Reconcile the LoC estimate in the BLUF (line 23) and Summary (line 456) with the revised "What leaves lace" estimate at line 178 (800-1000 LoC source + 200-300 LoC tests, not 400-700 + 150-200).

2. **[non-blocking]** Resolve the `validation.test.ts` double-classification. Remove it from "Tests trimmed" at line 160 and confirm Phase 5 substep 1's "Delete entire test files" entry stands. Or, alternatively, demote Phase 5's classification — but the source-analysis report ("test file is `validateNoOverlap`-only") supports the entire-file deletion.

3. **[non-blocking]** Optionally restyle the Phase-ordering preamble at line 333 as an attributed `> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): ...` callout for consistency with the document's other NOTE callouts.

## Clarification Questions for the Author

These remain optional refinements; the proposal is acceptable as-is.

**Q1: LoC reconciliation preference.** Do you want the BLUF/Summary to cite the revised range (800-1000 / 200-300), or keep the old range with a "(initially estimated; revised up after source-analysis cross-check)" qualifier? The former is cleaner; the latter preserves an audit trail.

Options:
- (a) Update both citations to the new range (recommended).
- (b) Keep the old number in BLUF/Summary and add a "see 'What leaves lace' for revised estimate" pointer.
- (c) Leave as-is; the discrepancy is minor.

**Q2: `validation.test.ts` final classification.** Should the proposal classify `validation.test.ts` as:

Options:
- (a) Entire-file deletion (matches Phase 5 substep 1 and the source-analysis report's reasoning). Recommended.
- (b) Trimmed (matches the "What leaves lace" line 160 entry as currently written).
- (c) Defer the call to the implementer based on whether anything else gets added to the file in the interim.
