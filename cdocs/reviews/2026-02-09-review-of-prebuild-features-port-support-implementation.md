---
review_of: cdocs/proposals/2026-02-09-prebuild-features-port-support.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T19:54:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, implementation, architecture, test_plan, ports, prebuild]
---

# Review: Prebuild Features Port Support -- Implementation

## Summary Assessment

This is a self-review of the implementation of the accepted prebuild features port support proposal. The implementation extends lace's port allocation pipeline to include features declared in `customizations.lace.prebuildFeatures`, with asymmetric auto-injection for prebuild features (injecting `appPort` entries with `host:defaultContainerPort` mapping). The implementation is clean, well-tested (22 new tests, 445 total passing), and closely follows all 7 phases of the accepted proposal. The most notable design decision -- placing `extractPrebuildFeaturesRaw()` in `template-resolver.ts` rather than `devcontainer.ts` -- is a reasonable choice that avoids circular dependency concerns and keeps the function co-located with its primary consumers. Verdict: **Accept**.

## Section-by-Section Findings

### Phase 1: extractPrebuildFeaturesRaw

**Finding 1 (non-blocking):** The function was placed in `template-resolver.ts` instead of `devcontainer.ts` as the proposal suggested as one option. This is a defensible decision -- the function is consumed by `autoInjectPortTemplates`, `resolveTemplates`, and `warnPrebuildPortFeaturesStaticPort`, all in `template-resolver.ts`, plus `up.ts` for the unified collection. Placing it in `devcontainer.ts` would have been equally valid but would add another import from that module into `template-resolver.ts`.

**Finding 2 (non-blocking):** The function returns a direct reference rather than a copy for in-place mutation support. This is documented in the function's JSDoc and tested with the "returns a direct reference (not a copy)" test. The design is correct for the auto-injection use case where `injectForPrebuildBlock` needs to read (but not write to) the prebuild features block.

**Tests:** 7 unit tests covering all edge cases (present, absent, null, empty, no-customizations, no-lace, direct-reference). Thorough.

### Phase 2: Unified feature collection in up.ts

**Finding 3 (non-blocking):** The implementation uses `extractPrebuildFeaturesRaw` (lightweight accessor) rather than the discriminated union `extractPrebuildFeatures` from `devcontainer.ts`. This is appropriate -- the unified collection needs a plain object for the spread merge, not a discriminated union.

**Finding 4 (non-blocking):** The spread merge `{ ...rawFeatures, ...rawPrebuildFeatures }` correctly relies on `validateNoOverlap` (run by the prebuild pipeline) to prevent duplicates. The proposal's NOTE about this is accurate.

**Finding 5 (non-blocking):** The metadata fetch mock update in `up.integration.test.ts` was necessary because extending the pipeline to include prebuild features means metadata is now fetched for `claude-code:1` in existing tests. The fix (adding `claudeCodeMetadata` constant and handling `devcontainer features info manifest` in `createMock()` and `createFailingDevcontainerUpMock()`) is correct and minimal.

### Phase 3: Asymmetric auto-injection for prebuild features

**Finding 6 (non-blocking):** The refactoring of `autoInjectPortTemplates` into three functions (`autoInjectPortTemplates`, `injectForBlock`, `injectForPrebuildBlock`) is clean. The orchestrator is readable and the separation between symmetric (top-level) and asymmetric (prebuild) injection is clear.

**Finding 7 (non-blocking):** `injectForPrebuildBlock` correctly reads the default port from `metadata.options?.[optionName]?.default` and guards against missing defaults with `if (!defaultPort) continue`. This prevents generating a broken asymmetric mapping if the metadata lacks a default value.

**Finding 8 (non-blocking):** The appPort array initialization pattern `(config.appPort ?? []) as (string | number)[]` followed by `config.appPort = appPort` is correct -- it creates the array if absent and updates the reference. Each iteration of the inner loop re-reads from `config.appPort` to pick up prior insertions, which is safe because the reference is set on each push.

### Phase 4: Extended feature-ID map in resolveTemplates

**Finding 9 (non-blocking):** The merge `{ ...features, ...prebuildFeatures }` for `buildFeatureIdMap` correctly extends validation to catch short-ID collisions across blocks (T6 test). The `buildFeatureIdMap` function throws on collision, which is the right behavior.

### Phase 5: Static-port diagnostic warning

**Finding 10 (non-blocking):** `warnPrebuildPortFeaturesStaticPort` correctly checks three conditions: (1) feature in prebuild with port metadata, (2) not in `injected` list (auto-injection was active), (3) no `appPort` entry referencing the label. The `appPort` check searches for the un-resolved template string `${lace.port(label)}`, which is correct because this function runs _after_ auto-injection but _before_ template resolution.

**Finding 11 (non-blocking):** The warning message is actionable: "Either remove the static value to enable auto-injection, or add an appPort entry." This matches the proposal's specification.

### Phase 6: Integration tests T9-T12

**Finding 12 (non-blocking):** T9 (prebuild feature with ports, full pipeline) is thorough. It verifies:
- Asymmetric appPort mapping
- No symmetric entry generated
- forwardPorts and portsAttributes generated with correct metadata-enriched labels
- port-assignments.json persisted
- sshPort NOT in prebuild feature options

**Finding 13 (non-blocking):** T10 (explicit asymmetric appPort) correctly tests the E3 edge case from the proposal -- user provides static value + explicit appPort template.

**Finding 14 (non-blocking):** T11 (no port metadata) correctly verifies that prebuild features without `customizations.lace.ports` produce no allocation.

**Finding 15 (non-blocking):** T12 (mixed blocks) verifies that features in `features` (symmetric) and features in `prebuildFeatures` (asymmetric) both get allocations with distinct ports. The test verifies the debug-proxy entry ends with `:9229` (asymmetric) while wezterm-server gets symmetric mapping.

### Phase 7: Dotfiles devcontainer assessment

**Finding 16 (non-blocking):** The assessment that the dotfiles config "just works" is correct. The dotfiles config has `wezterm-server` in `prebuildFeatures` with a `version` option only. Since `version` is not a port option, auto-injection correctly fires for `sshPort` (which has no explicit value), producing the asymmetric `appPort` entry with default 2222.

### Cross-cutting concerns

**Finding 17 (non-blocking):** All 445 tests pass (22 new, 423 existing unchanged). No regressions.

**Finding 18 (non-blocking):** The implementation respects all "What NOT to Change" constraints: `validateNoOverlap`, `runPrebuild`, `PortAllocator`, `warnPrebuildPortTemplates`, port range, and discovery tools are all unmodified.

**Finding 19 (non-blocking):** The `readFileSync` import in `up.ts` (line 2) was already present before this change -- no new imports added beyond `warnPrebuildPortFeaturesStaticPort` and `extractPrebuildFeaturesRaw`.

## Verdict

**Accept.** The implementation faithfully follows the accepted proposal across all 7 phases, handles all specified edge cases, and introduces 22 new tests with zero regressions. The code is well-structured with clear separation between symmetric and asymmetric injection paths. No blocking issues found.

## Action Items

1. [non-blocking] Consider adding a comment in `injectForPrebuildBlock` noting that the `appPort` array mutation pattern (re-read + push + assign) is intentional for multi-port features.
2. [non-blocking] The proposal mentions T7 and T8 as regression tests, but these are implicitly satisfied by the existing test suite passing. No explicit test stubs are needed, but a brief comment in the test file acknowledging this could help future readers.
3. [non-blocking] Consider downstream validation: run `lace up` against the dotfiles devcontainer to confirm the fix works end-to-end (Phase 7 acceptance criteria mentions `lace-discover` and `wez-into` connectivity).
