---
review_of: cdocs/proposals/2026-02-15-mount-accessor-api.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T18:30:00-08:00
task_list: lace/template-variables
type: review
state: live
status: done
tags: [rereview_agent, api-design, prebuild-features, internal-consistency, auto-injection, test_plan]
---

# Review R3: Mount Accessor API (v2)

## Summary Assessment

This is a round 3 re-review focused on the prebuild feature mount amendment.
The proposal previously deferred prebuild feature mount auto-injection as future work; it now treats prebuild feature mounts identically to regular feature mounts, with a clear rationale: mounts are runtime config (`docker run` flags) and have no build/runtime lifecycle asymmetry like ports do.
The amendment is internally consistent across all sections of the proposal: the auto-injection description, Phase 3, Phase 4, edge cases, open questions, and test plans all correctly reflect the new behavior.
Verdict: Accept.

## R2 Finding Resolution

### Non-blocking #1 (R2): Namespace validation on unified map

**Status: Unchanged (still non-blocking).**
Phase 4 step 3 still says "each label's namespace must be `project` or in the feature ID map" without explicitly stating it operates on the unified declarations map.
The amendment does not change this finding. It remains a minor implementation-level detail.

## Amendment Review: Prebuild Feature Mount Support

The amendment touches seven locations in the proposal. Each is reviewed below.

### Auto-Injection section (line 203)

The third bullet under "Collect all mount declarations" reads:
> Prebuild feature-level: same extraction as regular features -- mounts are runtime config (`docker run` flags), so there is no build/runtime lifecycle asymmetry as there is with ports

**Finding: Consistent.** The runtime/build-time distinction is stated clearly. The phrasing "same extraction as regular features" is accurate: both use `extractLaceCustomizations(metadata).mounts`.

### Auto-Injection summary bullets (lines 208-211)

The reworked `autoInjectMountTemplates()` summary says "Accept both project and feature declarations" without mentioning prebuild features explicitly.

**Finding [non-blocking]: Minor phrasing gap.** The detailed Phase 3 description (lines 553-559) is explicit about prebuild features, and the preceding numbered list (line 203) covers them. The summary bullet is not wrong (prebuild features are features), but adding "and prebuild feature" would make this summary self-contained. Low priority since the detailed spec is unambiguous.

### Edge case: Prebuild features with mount declarations (lines 437-439)

Clearly states the handling: "Prebuild feature mounts are auto-injected identically to regular feature mounts." The explanation of why mounts differ from ports is thorough: ports are baked into the image at build time (sshd port via `sed` into `sshd_config`), while mounts are `docker run` flags that take effect at container start regardless of when the feature was installed.

**Finding: Consistent and well-reasoned.** This is the strongest articulation of the mount-vs-port asymmetry distinction in the proposal.

### Phase 3: Auto-Injection Rework (lines 546-580)

Phase 3 explicitly includes prebuild features in three places:
1. The `metadataMap` parameter description says "both regular and prebuild features" (line 553)
2. The unified label map includes `prebuild feature: <shortId>/<key>` (line 554)
3. The `buildMountDeclarationsMap()` function description says "Prebuild feature mounts are included in both the declarations map and auto-injection" (line 559)

The test plan includes:
- "Prebuild feature declarations auto-inject" (line 567)
- "Mixed regular + prebuild feature declarations: both auto-inject identically" (line 568)

**Finding: Consistent and well-specified.** The Phase 3 test plan provides adequate coverage.

### Phase 4: Pipeline Wiring (lines 582-624)

Phase 4 step 2 calls `buildMountDeclarationsMap(projectDecls, metadataMap)`. Since `metadataMap` in the current `up.ts` already combines regular and prebuild feature metadata (lines 136-137 of `up.ts`: `allRawFeatures = { ...rawFeatures, ...rawPrebuildFeatures }`), prebuild features are included without requiring additional Phase 4 changes.

The test plan includes: "End-to-end with prebuild feature declarations: prebuild feature metadata with mounts -> auto-injected and resolved (same as regular features)" (line 602).

**Finding: Consistent.** The wiring is correct because the existing `metadataMap` construction in `up.ts` already includes prebuild features.

### Open Questions (line 713)

Question 1 is marked as "Resolved" with the full explanation of the runtime config rationale.

**Finding: Consistent.** The resolution is clear and matches the edge case and Phase 3 descriptions.

### `buildMountDeclarationsMap()` signature (line 559)

The function description says it "combines project + feature + prebuild feature declarations." However, the Phase 4 call site (line 591) passes `(projectDecls, metadataMap)`, suggesting the function signature is `(projectDecls, metadataMap)` with two parameters, not three. Prebuild feature declarations are included because `metadataMap` already contains them.

**Finding [non-blocking]: Potential confusion in function description.** The function description lists three input categories (project, feature, prebuild feature) but the Phase 4 call passes two arguments. This is technically correct (the second argument covers both feature categories), but the description could be clearer: "combines project declarations with feature declarations (both regular and prebuild) from the metadata map."

## Cross-Document Consistency

### Design rationale report (stale)

The companion report `cdocs/reports/2026-02-15-mount-api-design-rationale.md` at line 113 still says:
> Prebuild feature mount declarations are future scope -- the current implementation skips them, same as v1.

This directly contradicts the amended proposal.

**Finding [non-blocking]: Stale related document.** The design rationale report should be updated to reflect the resolved prebuild feature decision. This is outside the proposal's scope (it is a separate document), but the inconsistency should be addressed before implementation begins to avoid confusing the implementing agent.

### R2 review (now superseded)

The R2 review's resolution of non-blocking #5 (line 56) says: "prebuild feature mount declarations are included in the unified declarations map for `.target` resolution availability, but auto-injection skips them." This accurately described the pre-amendment state, which is now superseded by the full support amendment. This R3 review supersedes R2 on this point.

## Section-by-Section Findings

### Runtime-vs-build-time rationale

The proposal explains the mount/port distinction in three places: auto-injection (line 203), edge cases (lines 437-439), and open questions (line 713). All three are consistent and use the same reasoning: mounts are runtime `docker run` flags, ports are baked at build time.

**Finding: Consistent.** The repetition across sections is acceptable because each occurrence serves a different reading context (overview, edge case analysis, question resolution). The wording varies enough to avoid verbatim duplication.

### Phase 5: Migrate Lace Devcontainer (lines 626-680)

The example devcontainer (line 655) shows `prebuildFeatures` with `git` and `sshd` features, neither of which declares mounts. This is correct for the current lace devcontainer. If a prebuild feature with mount declarations were added in the future, auto-injection would handle it with no config changes needed.

**Finding: No issues.**

### Phase 6: Smoke Test (lines 682-709)

The smoke test verifies 4 mount entries (2 static + 2 auto-injected from project declarations). There is no prebuild feature mount in the current lace devcontainer, so this is correct. A prebuild-feature-with-mounts scenario is covered by the Phase 3 and Phase 4 unit/integration tests, not the smoke test.

**Finding: No issues.** Test coverage is distributed appropriately across phases.

## Verdict

**Accept.**
The prebuild feature mount amendment is internally consistent across all sections of the proposal. The runtime-vs-build-time rationale is clear and well-placed. The test plans adequately cover prebuild feature mount scenarios at both the unit level (Phase 3) and integration level (Phase 4). No stale "skip" or "defer" references remain in the proposal itself. The two non-blocking findings are cosmetic (summary bullet phrasing, function description clarity). The stale design rationale report should be updated separately.

## Action Items

1. [non-blocking] Auto-injection summary bullet (line 209): consider changing "Accept both project and feature declarations" to "Accept project, feature, and prebuild feature declarations" for self-containedness.
2. [non-blocking] `buildMountDeclarationsMap()` description (line 559): clarify that "project + feature + prebuild feature" maps to two parameters, not three, since `metadataMap` covers both feature categories.
3. [non-blocking] Update `cdocs/reports/2026-02-15-mount-api-design-rationale.md` recommendation #4 (line 113) to reflect the resolved prebuild feature decision. The current text says "future scope" and contradicts the amended proposal.
