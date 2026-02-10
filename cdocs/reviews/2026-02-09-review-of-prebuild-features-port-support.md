---
review_of: cdocs/proposals/2026-02-09-prebuild-features-port-support.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T18:30:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, architecture, ports, prebuild, pipeline_correctness]
---

# Review: Prebuild Features Port Support

## Summary Assessment

This proposal addresses a real and well-documented silent failure where port-declaring features in `prebuildFeatures` are invisible to the port allocation pipeline. The unified collection approach is sound and the test plan is thorough. However, the proposal contains an incorrect claim about how auto-injected values propagate to the prebuild pipeline (D5), and the diagnostic warning in Phase 5 is underspecified in a way that could produce confusing behavior. Verdict: **Revise** -- two blocking issues need correction before this can be accepted.

## Section-by-Section Findings

### BLUF

Clear and comprehensive. Accurately summarizes the bug, the fix, and the scope. No issues.

### Objective

Well-stated. The principle "moving a feature between blocks should only affect build-time caching" is the right framing.

### Background

Accurate and well-referenced. The code excerpts match the actual source. The two-config comparison is helpful for readers unfamiliar with the bug.

### Proposed Solution

#### Step 1 (up.ts feature collection)

Sound. The `allRawFeatures` merge via spread operator is correct. One consideration: the spread `{ ...rawFeatures, ...rawPrebuildFeatures }` silently drops the prebuild entry if the same key exists in both. This is fine because `validateNoOverlap` catches same-key overlap before the port pipeline runs -- but only for the prebuild pipeline's invocation, not for the port pipeline. **Non-blocking:** Consider noting that `validateNoOverlap` must run before the unified collection is built, or that the spread operator's key-collision behavior is acceptable because `validateNoOverlap` already guards against it.

#### Step 2 (autoInjectPortTemplates)

The description says "Writes back to the correct block (features or prebuildFeatures)" but the code sketch iterates over `allFeatures` (the merged object). Writing to `allFeatures[fullRef]` would modify the merged copy, NOT the original `prebuildFeatures` block in the config. The existing implementation writes directly to `features[fullRef]` because `features` is a reference into `config.features`. The merged `allFeatures` is a new object -- writes to it do not propagate back.

**Blocking:** The auto-injection write-back mechanism needs to be specified correctly. The implementation must determine which block a feature came from and write back to that block's reference. One approach: iterate over `features` and `prebuildFeatures` separately rather than merging. Another: keep a provenance map tracking which block each feature came from, and use it for write-back.

#### Step 3 (resolveTemplates feature-ID map)

Sound. `buildFeatureIdMap(allFeatures)` correctly extends the validation scope. The `walkAndResolve` function already walks the entire config tree including nested `customizations.lace.prebuildFeatures`, so templates there will be found and resolved.

#### Step 4 (Diagnostic warning)

**Blocking:** The warning trigger condition is contradictory. The proposal says the warning fires when "a feature in `prebuildFeatures` declares ports" AND "no `appPort` entry references that feature's port label." But when auto-injection is active (the default case -- E6), lace auto-injects the template and generates a symmetric `appPort`. So the warning would never fire in the most common scenario where it would be useful. Meanwhile, the warning WOULD fire between auto-injection and port-entry-generation (since at that point there is no user-provided `appPort`), but the auto-generated one has not been created yet.

The warning as described seems to target a scenario that the rest of the proposal explicitly handles automatically. Either:
(a) The warning should fire only when the user has opted out of auto-injection (explicit static port value) AND has no `appPort`, or
(b) The warning should be dropped entirely since the auto-injection fix handles the common case, or
(c) The timing and condition need to be reworked.

Clarify what the warning actually detects and when in the pipeline it runs.

### Design Decisions

#### D5: No changes to the prebuild pipeline

**Blocking (factual inaccuracy):** The proposal states: "Template resolution happens before prebuild in the `lace up` pipeline (step 3 vs step 4 in the pipeline ordering), so by the time prebuild runs, any `${lace.port()}` values have already been replaced with concrete port numbers."

This is incorrect. `runPrebuild()` in `prebuild.ts` (line 70) reads the devcontainer.json from disk independently via `readDevcontainerConfig(configPath)`. It does NOT receive the `configForResolution` object from `up.ts`. Auto-injected values written to `configForResolution` (an in-memory `structuredClone`) are invisible to the prebuild pipeline.

What actually happens: the prebuild pipeline extracts `prebuildFeatures` from the on-disk config (which has the user's original values, not the auto-injected ones) and uses those to build the prebuild image. The feature gets its default option values (e.g., `sshPort: "2222"`), not the lace-allocated port.

The resolved config (with concrete port numbers) ends up in `.lace/devcontainer.json`, which is used by `devcontainer up` -- but that is the RUNTIME config, not the PREBUILD config. The prebuild image is built with default values.

This is actually fine for correctness: the prebuild image just installs the software; the runtime config (via `devcontainer up` with the extended config) is what controls port bindings and option values. But the proposal's claim about the prebuild seeing resolved values is wrong and the NOTE about cache invalidation (E8) is also wrong -- the prebuild context does NOT contain the resolved port number, so port reassignment does NOT invalidate the prebuild cache (unless the user explicitly writes a port value in the on-disk config).

Correct D5 to accurately describe the data flow: the prebuild reads from disk, sees original (un-injected) values, and builds the image with feature defaults. Template resolution outputs go only into `.lace/devcontainer.json`. This is correct behavior but needs accurate documentation.

### Edge Cases

#### E8: Port reassignment invalidates prebuild cache

**Non-blocking (but related to D5 correction):** As noted above, when auto-injection is active, the injected value is in-memory only. The prebuild pipeline reads from disk and sees the original config. So port reassignment does NOT change the prebuild context, and the cache is NOT invalidated. E8's analysis is only correct when the user explicitly writes a `${lace.port()}` template or a static port value into the on-disk config AND that value somehow changes. Since auto-injection only modifies the in-memory clone, E8 as written is incorrect for the default auto-injection case. Update or remove this edge case.

### What NOT to Change

**Non-blocking:** The entry for `warnPrebuildPortTemplates()` says "templates in prebuild features will be resolved (this is new behavior made possible by this proposal)." This is actually already true today because `resolveTemplates` calls `walkAndResolve` which walks the entire config tree, including nested objects under `customizations`. However, the existing `warnPrebuildPortTemplates` check runs BEFORE template resolution, and the `resolvePortLabel` validation would fail because the feature-ID map does not include prebuild features. After this proposal, templates in prebuild features would resolve successfully. The description should be clearer that the "new behavior" is that resolution now succeeds (rather than failing validation), not that it is attempted.

### Test Plan

Thorough and well-structured. The coverage across unit and integration tests is good. T1-T6 cover the new behaviors, T7-T8 and T13-T14 cover regression. T9-T12 provide integration coverage for the primary scenarios.

**Non-blocking:** T5 describes testing a "prebuild feature auto-injected template" but the test would need to call `autoInjectPortTemplates` first to set up the template, then call `resolveTemplates`. Make explicit that T5 is a two-step test (inject then resolve), not just a resolve test.

### Implementation Phases

Well-sequenced with clear acceptance criteria. Phase 1-4 are the core changes, Phase 5 is the warning (which needs rework per the blocking finding above), Phase 6 is integration tests, Phase 7 is downstream.

## Verdict

**Revise.** Three blocking issues:

1. The auto-injection write-back in Step 2 needs a correct mechanism for writing to the originating block rather than to the merged collection.
2. The diagnostic warning (Step 4 / Phase 5) has contradictory trigger conditions that need clarification or removal.
3. D5's claim about the prebuild seeing resolved values is factually incorrect and E8's cache invalidation analysis follows from the same incorrect premise. Both need correction.

## Action Items

1. **[blocking]** Fix auto-injection write-back: specify whether to iterate over blocks separately or use a provenance map. The merged `allFeatures` object cannot be written to and have changes propagate back to the config.
2. **[blocking]** Clarify or remove the diagnostic warning (Phase 5). Either define the precise condition and pipeline timing, or drop it in favor of relying on auto-injection to handle the common case.
3. **[blocking]** Correct D5 and E8: the prebuild pipeline reads from disk, not from the resolved config. Auto-injected values do not propagate to the prebuild context. E8's cache invalidation claim is incorrect for the auto-injection case.
4. **[non-blocking]** Note in Step 1 that `validateNoOverlap` guards against key collision in the spread merge.
5. **[non-blocking]** Clarify T5 as a two-step test (auto-inject, then resolve).
6. **[non-blocking]** Clarify the `warnPrebuildPortTemplates` entry in "What NOT to Change" -- the new behavior is that resolution succeeds rather than failing validation.
