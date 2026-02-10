---
review_of: cdocs/proposals/2026-02-09-symmetric-prebuild-port-binding.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T23:15:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, rereview_agent, architecture, ports, prebuild, symmetric, containerPort, metadata_schema]
---

# Review: Symmetric Prebuild Port Binding (R2)

## Summary Assessment

The R1 revision fundamentally redesigns the approach: feature promotion is replaced with a `containerPort` metadata field that drives correct `appPort` generation without re-running `install.sh`. This addresses both R1 blocking issues (non-functional symmetric mapping and prebuild cache defeat). The revised design is clean, minimal, and backward compatible. The injection is symmetric (same code path for both blocks), the `appPort` generation is metadata-driven (uses `containerPort` when declared, falls back to symmetric when absent), and the prebuild cache is fully preserved. Verdict: **Accept** with non-blocking suggestions.

## Prior Action Items Status

1. **[blocking] E7 / metadata-only port correctness (R1)** -- RESOLVED. The `containerPort` metadata field explicitly declares the container-side port. `generatePortEntries` uses it to produce correct `host:containerPort` mappings. E1 now correctly shows `appPort: ["22430:2222"]`, not `"22430:22430"`. The metadata-only concern is fully addressed without requiring `install.sh` modification.

2. **[blocking] Feature promotion performance regression (R1)** -- RESOLVED. Feature promotion is eliminated entirely. No `install.sh` re-runs. No network fetches. The prebuild cache is preserved. The `containerPort` metadata field achieves the correct mapping through metadata alone.

3. **[non-blocking] Conditional promotion (R1)** -- N/A. Promotion is removed.

4. **[non-blocking] Duplicate features in extended config (R1)** -- N/A. No promotion means no duplicates.

5. **[non-blocking] Extended config JSON structure test (R1)** -- PARTIALLY ADDRESSED. T16 verifies that wezterm-server does NOT appear in `features` (no promotion), which implicitly checks the structure. Consider adding explicit verification that `prebuildFeatures` is preserved unchanged in the extended config.

6. **[non-blocking] containerPort metadata field (R1 action item 6)** -- ADOPTED as the core design. This was a suggestion in the R1 review and is now the primary mechanism.

## Section-by-Section Findings (R2)

### BLUF (revised)

The BLUF accurately describes the revised approach. The key distinction is well-articulated: "The symmetry is in the injection pattern (identical for both blocks), while the appPort generation uses metadata to produce correct host:container mappings." This correctly sets expectations that the proposal is about injection symmetry, not about eliminating all asymmetry in the system. The `appPort` mapping is inherently asymmetric when `containerPort` differs from the host port, and the BLUF does not hide this. **No issue.**

### Proposed Solution

The two-part design (symmetric injection + containerPort metadata) is sound. The code sketches are correct and minimal:

1. `autoInjectPortTemplates` simplification: replacing `injectForPrebuildBlock` with a second `injectForBlock` call. Verified against the source: `injectForBlock` writes `${lace.port()}` into the feature's option value, which works for both top-level and prebuild features because the function operates on the block reference directly.

2. `generatePortEntries` change: one line (`const containerPort = featureMeta?.containerPort ?? alloc.port`). Verified against the source: `featureMeta` is already available in the loop body via `featurePortMetadata?.get(alloc.label)`. The fallback `alloc.port` preserves backward compatibility (symmetric mapping when `containerPort` is absent).

**No issue.**

### Step 3: Type definitions

The `containerPort` additions to `LacePortDeclaration` and `FeaturePortDeclaration` are correct. The parsing in `extractLaceCustomizations` correctly validates with `typeof entry.containerPort === "number"` (not string). The propagation in `buildFeaturePortMetadata` is straightforward.

**Non-blocking observation:** The `containerPort` field is typed as `number` in the metadata but the sshd feature's port is a string (`"2222"`) in the feature option's `default` field. This is correct because `containerPort` is a metadata declaration (always a number), not a feature option (which can be string or boolean). The distinction is clear but worth a brief note in the D2 design decision.

### D2: containerPort metadata field

The rationale is strong. The comparison with feature promotion is well-argued: same correct `appPort` mapping, zero runtime cost, no prebuild cache impact. The generality note ("works for any feature where the container port differs from the host port") is a good design principle.

**No issue.**

### D3: containerPort is optional, defaults to symmetric

This is the correct backward-compatibility strategy. No existing features declare `containerPort`, so they all get symmetric mapping (unchanged behavior). New features that need fixed container ports declare `containerPort` and get correct asymmetric mapping.

**No issue.**

### D4: Resolved prebuild option values are non-functional

This is the key insight that makes the design work. The resolved value in `prebuildFeatures` is "dead data" from the devcontainer CLI's perspective, but it serves lace's port allocation pipeline. The two purposes (allocation vs service configuration) are clearly separated.

**Non-blocking:** Consider whether the resolved value in the extended config's `prebuildFeatures` block should be stripped to avoid confusion. A developer reading the extended config might expect `sshPort: 22430` to mean "sshd listens on 22430." However, stripping it would require modifying `generateExtendedConfig` to post-process the prebuild features block, which adds complexity. On balance, leaving it in place and relying on the informational warning (Step 5) is the simpler approach.

### E6: Top-level feature without containerPort

This edge case is well-analyzed. The observation that `containerPort` is relevant for top-level features too is correct and shows the generality of the design. For wezterm-server in the top-level `features` block, `containerPort: 2222` produces the correct mapping because wezterm-server's `install.sh` does not configure sshd's listening port.

**No issue.**

### E9: containerPort vs option default

Good analysis distinguishing the two semantics. The hypothetical proxy example makes the distinction concrete. This should help feature authors understand when to use `containerPort`.

**No issue.**

### Test Plan

The test plan is comprehensive. T6-T8 cover the core `containerPort` behavior (with metadata, without metadata, suppression). T10-T12 cover the type/parsing changes. T16 covers the full pipeline with `containerPort`. T7 and T15 cover backward compatibility.

**Non-blocking:** T6 specifies `"22430:2222"` as the expected `appPort` value. This is a string, not a number. Verify that the existing `generatePortEntries` code produces string-typed `appPort` entries. Checking the source: `result.appPort.push(\`${alloc.port}:${alloc.port}\`)` -- yes, it produces strings via template literals. The change to `result.appPort.push(\`${alloc.port}:${containerPort}\`)` also produces a string. Confirmed. **No issue.**

### Implementation Phases

The phases are well-sequenced:
- Phase 1 (types) has no dependencies
- Phase 2 (appPort generation) depends on Phase 1
- Phase 3 (symmetric injection) is independent of Phases 1-2 and could be done in parallel
- Phase 4 (warnings) depends on Phase 3
- Phase 5 (feature metadata) depends on Phases 1-2
- Phase 6 (integration tests) depends on all prior phases

**Non-blocking:** Phase 3 and Phases 1-2 are independent. Consider noting that they can be developed in parallel for faster implementation. The symmetric injection change does not depend on `containerPort` support -- it just changes how templates are injected. The `containerPort` change is in `generatePortEntries`, which is downstream.

### What NOT to Change

The list is accurate. `generatePortEntries` IS changed (to use `containerPort`), and it is correctly NOT listed in "What NOT to Change." All items that are listed as unchanged are verified against the proposal.

**No issue.**

## Verdict

**Accept.** Both R1 blocking issues are resolved. The `containerPort` metadata field is a clean, minimal solution that achieves symmetric injection without defeating the prebuild cache. The design is backward compatible, well-tested, and generalizable. The code changes are small and localized: one line in `generatePortEntries`, type additions to two interfaces, parsing additions to two functions, and the deletion of `injectForPrebuildBlock`.

## Action Items

1. **[non-blocking]** Consider noting in D2 that `containerPort` is typed as `number` (metadata declaration) while the option's `default` is a `string` (feature option value). This distinction may not be obvious to feature authors.

2. **[non-blocking]** Consider noting in the Implementation Phases section that Phases 1-2 and Phase 3 can be developed in parallel, since symmetric injection does not depend on `containerPort` support.

3. **[non-blocking]** Add explicit verification in T16 that `prebuildFeatures` is preserved in the extended config's `customizations.lace` block (not stripped or modified by the pipeline).
