---
review_of: cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T20:30:00-08:00
task_list: lace/feature-overhaul
type: review
state: live
status: done
tags: [self, architecture, template-resolution, port-model, prebuild-interaction, metadata-dependency, rereview_agent, user-feedback-verification, auto-injection]
rounds:
  - round: 1
    at: 2026-02-06T20:30:00-08:00
    by: "@claude-opus-4-6"
    verdict: revise
    summary: "Clean rewrite successfully compresses v1 cruft. Two blocking issues: (1) D8 description in the design decisions report contradicts the proposal's pipeline ordering; (2) asymmetric override example creates a phantom port allocation with no feature receiving the resolved value. Non-blocking suggestions on featureId extraction ambiguity, prebuild extraction code path clarification, and missing test case."
  - round: 2
    at: 2026-02-06T20:45:00-08:00
    by: "@claude-opus-4-6"
    verdict: accept
    summary: "All blocking issues resolved: D8 heading and body fixed to match proposal pipeline ordering; asymmetric override example clarified with NOTE on host-side label semantics; featureId extraction method specified with collision error behavior; missing edge cases and test cases added."
  - round: 3
    at: 2026-02-06T22:30:00-08:00
    by: "@claude-opus-4-6"
    verdict: accept
    summary: "Post-user-feedback revision review. All five feedback items addressed: lace.* vars reduced to lace.port() only; portsAttributes limited to label+requireLocalPort; self-referential port example has thorough inline comments; implementation plan expanded with code drafts, type definitions, 11 test scenarios, pipeline walkthrough, and 5 error case examples. Design decisions report updated consistently. One non-blocking nit on the unused LACE_ANY_PATTERN regex constant."
  - round: 4
    at: 2026-02-06T23:45:00-08:00
    by: "@claude-opus-4-6"
    verdict: revise
    summary: >
      Auto-injection redesign review. The core design change is sound and
      consistently applied: examples show minimal user config, override story is
      clear, pipeline includes auto-injection step. Two blocking issues:
      (1) Phase 2 description contradicts the new design -- says metadata is
      "optional" and failure "logs warning", but auto-injection requires metadata
      and the rest of the proposal says failure aborts lace up;
      (2) resolveTemplates() return type does not include autoInjected field
      despite TemplateResolutionResult declaring it. Three non-blocking items.
---

# Review: Lace Feature Awareness v2 (Round 4)

## Summary Assessment

This revision introduces auto-injection of `${lace.port()}` templates from feature metadata, a significant design improvement that eliminates boilerplate for users. The core design is sound: features declare port options in their metadata, lace reads the metadata and auto-injects templates for undeclared options, and users override by providing any explicit value. The change is applied consistently across the BLUF, objective, examples, pipeline, code drafts, test scenarios, and the design decisions report. Two blocking inconsistencies remain from pre-revision text that was not fully updated to match the new design.

## Auto-Injection Consistency Verification

The review was primed to check six specific consistency properties:

### (1) Examples show minimal user config -- PASS

The primary example (lines 70-83) shows `"ghcr.io/.../wezterm-server:1": {}` with no explicit port option. The pipeline walkthrough (Step 0, lines 1305-1323) likewise shows an empty feature declaration. Test Scenario 1 (lines 946-989) starts from minimal config. Test Scenarios 4, 5, 9, 10, 11 all use empty feature declarations. The asymmetric override example (lines 238-248) correctly shows an explicit `sshPort` value because it is demonstrating an override.

### (2) Override story is clear -- PASS

Lines 222-234 present a clear table with five override scenarios. The "Key rule" paragraph (line 234) explicitly states: any user-provided value (static or template) prevents auto-injection. Test Scenario 1a (lines 991-1006) covers static value override. Scenario 1b (lines 1008-1023) covers explicit template. Scenario 2 (lines 1025-1054) covers asymmetric override with explicit sshPort. Scenario 10 (lines 1176-1192) covers mixed options where only the port option gets auto-injected.

### (3) Pipeline includes auto-injection step -- PASS

The pipeline diagram (line 258) includes `auto-inject port templates` between `fetch metadata` and `resolve templates`. Key ordering details (lines 261-271) have five numbered steps with auto-injection as step 3, properly positioned after metadata fetch (step 2) and before template resolution (step 4).

### (4) Code drafts include autoInjectPortTemplates -- PASS

The `autoInjectPortTemplates` function (lines 466-505) is well-structured: iterates features, extracts metadata, checks for user-provided values, injects template strings, returns list of injected labels. The up.ts integration draft (lines 832-898) calls `autoInjectPortTemplates` in step 2 between metadata fetch (step 1) and template resolution (step 3).

### (5) Test scenarios cover auto-injection cases -- PASS

Scenario 1 covers basic auto-injection. Scenario 1a covers static value preventing auto-injection. Scenario 1b covers explicit template preventing auto-injection. Scenario 4 covers multiple features with auto-injection. Scenario 10 covers auto-injection adding sshPort alongside user-provided non-port options. The integration test list (lines 1550-1561) includes auto-injection cases, static override, and metadata failure fallback.

### (6) No place implies user MUST write `${lace.port()}` for metadata-declared ports -- PASS

All instances of `${lace.port(wezterm-server/sshPort)}` in the proposal appear in contexts where they are either: (a) showing what auto-injection produces, (b) showing the explicit-template override path, (c) showing embedded templates in non-feature locations like `appPort`, or (d) in error case examples. No prose or example suggests the user must write the template for a port that the feature already declares in `customizations.lace.ports`.

## Section-by-Section Findings

### BLUF and Objective (lines 48-52)

Updated consistently. BLUF mentions "auto-injects" with bold emphasis. Objective says "Lace auto-injects" and "Users declare the feature; lace handles port allocation automatically."

No issues.

### Feature-level port declarations (lines 184-220)

Lines 186 clearly state the dual purpose of `customizations.lace.ports`. The inline comments in the code example (lines 202-205) explain both purposes. Line 218 correctly states that without metadata, auto-injection does not occur.

No issues.

### Dependency section (lines 281-290)

Updated to list auto-injection as the primary dependency on metadata. Line 290 correctly states that without metadata, template resolution still works for explicitly-written templates.

No issues.

### Edge cases (lines 292-337)

Two new edge cases added: "No templates and no metadata" (lines 294-295) and "Feature has metadata but user provides explicit value" (lines 297-298). The "Feature metadata unavailable" case (lines 315-316) is updated to describe `--skip-metadata-validation` behavior.

No issues.

### Phase 2 description (lines 910-925)

**[blocking] Phase 2 contradicts the auto-injection design.** Line 919 says "add optional metadata fetch" and line 925 says "Metadata failure logs warning, does not block `lace up`". But the rest of the proposal (lines 218, 265, 279, 290, 315-316) and the design decisions report (D7 and D12) establish that metadata is required by default and failure aborts `lace up` unless `--skip-metadata-validation` is set. The Phase 2 description reads as if it was not updated from the pre-auto-injection design where metadata was best-effort.

Phase 2 should say metadata fetch is required (not optional), and failure aborts `lace up` (not logs warning). It should mention the `--skip-metadata-validation` escape hatch.

### TemplateResolutionResult and resolveTemplates() (lines 360-370, 512-530)

**[blocking] The `TemplateResolutionResult` interface declares an `autoInjected: string[]` field (line 367), but `resolveTemplates()` (lines 512-530) does not populate it.** The return statement on line 529 returns `{ resolvedConfig, allocations, warnings }` -- missing `autoInjected`. Meanwhile, `autoInjectPortTemplates()` (lines 473-505) returns the injected labels as its own return value, but this is not threaded into `TemplateResolutionResult`.

Two options: (a) remove `autoInjected` from `TemplateResolutionResult` since auto-injection happens before `resolveTemplates()` and returns its result independently, or (b) have the caller pass the injected labels into `resolveTemplates()` to include in the result. Option (a) is cleaner -- the `autoInjected` data is available from `autoInjectPortTemplates()` directly and does not need to be part of the resolution result.

### autoInjectPortTemplates type safety (lines 473-505)

**[non-blocking]** The function parameter `metadataMap: Map<string, FeatureMetadata | null>` uses a type `FeatureMetadata` that is defined in the metadata management proposal, not in this proposal's type definitions section. The proposal should either note that this type comes from `feature-metadata.ts` or add a forward reference. Not a blocking issue since the metadata management proposal defines the type fully, but it could confuse an implementor reading only this proposal.

### Pipeline walkthrough label in Step 5 (lines 1384-1397)

**[non-blocking]** The auto-generated portsAttributes shows `"label": "wezterm-server/sshPort (lace)"` (the default label), but Step 2 says metadata was fetched with label `"wezterm ssh"`. The walkthrough should show `"wezterm ssh (lace)"` as the label since metadata is available in this scenario. The same inconsistency existed before the auto-injection revision but is worth fixing now.

### D5 in design decisions report (line 87)

**[non-blocking]** D5 still says "Lace reads this via feature metadata fetching (best-effort)." The parenthetical "(best-effort)" contradicts the updated D7 which says metadata is required. Should be removed or changed to "(required by default)".

## Verdict

**Revise.** The auto-injection design itself is sound and consistently applied in the main sections. Two blocking inconsistencies from pre-revision text need correction: the Phase 2 description still describes metadata as optional/best-effort, and the `TemplateResolutionResult.autoInjected` field is declared but never populated.

## Action Items

1. [blocking] Update Phase 2 description (lines 910-925) to align with the required-metadata design: metadata fetch is not "optional", failure does not merely "log warning" -- it aborts `lace up` unless `--skip-metadata-validation` is set. Success criteria should reflect the strict error semantics.
2. [blocking] Resolve the `autoInjected` field mismatch: either remove `autoInjected` from `TemplateResolutionResult` (since `autoInjectPortTemplates()` returns this data independently), or thread it through `resolveTemplates()`. Removing it is cleaner.
3. [non-blocking] Add a note that `FeatureMetadata` type in `autoInjectPortTemplates` comes from `feature-metadata.ts` (defined in the metadata management proposal).
4. [non-blocking] Fix the pipeline walkthrough Step 5 portsAttributes label: should show `"wezterm ssh (lace)"` (from metadata) rather than the default `"wezterm-server/sshPort (lace)"`, since Step 2 confirmed metadata was fetched successfully.
5. [non-blocking] In the design decisions report, remove "(best-effort)" from D5 line 87, or change to "(required by default)" to match updated D7.
