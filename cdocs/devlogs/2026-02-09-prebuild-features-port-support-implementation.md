---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T19:55:00-08:00
task_list: lace/dogfooding
type: devlog
state: archived
status: done
tags: [ports, prebuild, bug-fix, template-resolver, integration-tests]
---

# Prebuild Features Port Support: Implementation Devlog

## Objective

Implement the accepted proposal at `cdocs/proposals/2026-02-09-prebuild-features-port-support.md`. The core problem: lace's port allocation pipeline in `up.ts` only reads features from the top-level `features` block, silently ignoring features declared in `customizations.lace.prebuildFeatures`. When a port-declaring feature like `wezterm-server` is placed in `prebuildFeatures`, the container starts with zero port bindings. The fix extends the pipeline to read from both blocks, with asymmetric auto-injection for prebuild features.

## Plan

Follow the proposal's 7 implementation phases in order, running the test suite after each phase:

1. Extract helper `extractPrebuildFeaturesRaw()`
2. Unify feature collection in `up.ts`
3. Extend `autoInjectPortTemplates` for prebuild features (asymmetric injection)
4. Extend `resolveTemplates` feature-ID map
5. Add diagnostic warning for static-port prebuild features
6. Integration tests T9-T12
7. Assess dotfiles devcontainer (downstream validation)

## Testing Approach

Test-first for each phase: write or update tests before verifying the implementation. Run the full suite (`pnpm test` from `packages/lace`) after every phase. All 423 pre-existing tests must pass at each checkpoint.

## Implementation Notes

### Phase 1: extractPrebuildFeaturesRaw

Placed the function in `template-resolver.ts` rather than `devcontainer.ts`. The function is consumed by three other functions in `template-resolver.ts` (`autoInjectPortTemplates`, `resolveTemplates`, `warnPrebuildPortFeaturesStaticPort`) and by `up.ts`. Co-locating with the primary consumers avoids adding another cross-module import.

The function returns a **direct reference** to the prebuild features object (not a copy). This is intentional -- `injectForPrebuildBlock` reads the block to check for user-provided values but writes to `config.appPort`, not to the prebuild features block itself.

### Phase 2: Unified feature collection in up.ts

Key change: introduced `rawPrebuildFeatures`, `allRawFeatures`, and `allFeatureIds` to merge features from both blocks into a single collection for the metadata pipeline.

**Issue encountered:** Two existing integration tests ("prebuild only" and "full config") failed because `createMock()` did not handle `devcontainer features info manifest` commands for `claude-code:1`. After the change, the metadata pipeline now includes prebuild features, so it attempts to fetch metadata for `claude-code:1`. The mock returned `'{"imageName":["test"]}'` for all commands, which lacks the `annotations` key and triggers a `MetadataFetchError`.

**Fix:** Added `claudeCodeMetadata` constant (no lace port declarations) and updated `createMock()` and `createFailingDevcontainerUpMock()` to detect `devcontainer features info manifest` commands and return proper metadata JSON.

### Phase 3: Asymmetric auto-injection

Refactored `autoInjectPortTemplates` into three functions:

- `autoInjectPortTemplates()` -- orchestrator, calls the two sub-functions
- `injectForBlock()` -- symmetric injection for top-level features (extracted from the old `autoInjectPortTemplates`)
- `injectForPrebuildBlock()` -- asymmetric injection for prebuild features

The asymmetric injection writes `${lace.port(shortId/optionName)}:DEFAULT_PORT` into `config.appPort` rather than writing into the feature option. This is necessary because prebuild features are installed at image build time with default values; the devcontainer CLI does not reinstall them at runtime, so the container port is fixed at the feature's default.

### Phase 4: Extended feature-ID map

Modified `resolveTemplates()` to build `featureIdMap` from `{ ...features, ...prebuildFeatures }`. This allows `resolvePortLabel()` to validate feature IDs from either block when processing `${lace.port(featureId/optionName)}` expressions in `appPort` or elsewhere.

### Phase 5: Static-port diagnostic warning

Added `warnPrebuildPortFeaturesStaticPort()` with targeted logic: warn only when a port-declaring prebuild feature has an explicit static value AND no `appPort` entry. Integrated at Step 3b in `runUp()`, after auto-injection so it can check which features had injection applied.

### Phase 6: Integration tests

Added 4 integration tests (T9-T12) covering the primary scenarios:
- T9: Prebuild-only wezterm-server, asymmetric pipeline
- T10: Prebuild wezterm-server with explicit appPort template
- T11: Prebuild features without port metadata
- T12: Mixed blocks (features + prebuildFeatures), both getting allocations

### Phase 7: Dotfiles assessment

Read the dotfiles devcontainer config. It has `wezterm-server` in `prebuildFeatures` with a `version` option only (not `sshPort`). Since `version` is not a port option, auto-injection correctly fires for `sshPort`, producing the asymmetric `appPort` entry `${lace.port(wezterm-server/sshPort)}:2222`. No changes needed to the dotfiles config.

### Deviations from proposal

None. The implementation follows all 7 phases exactly as specified. The only minor choice was placing `extractPrebuildFeaturesRaw` in `template-resolver.ts` instead of `devcontainer.ts`, which the proposal listed as an option.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/template-resolver.ts` | Added `extractPrebuildFeaturesRaw()`, refactored `autoInjectPortTemplates()` into 3 functions with asymmetric prebuild injection, extended `resolveTemplates()` feature-ID map, added `warnPrebuildPortFeaturesStaticPort()` |
| `packages/lace/src/lib/up.ts` | Added imports, unified feature collection from both blocks, integrated static-port warning at Step 3b |
| `packages/lace/src/lib/__tests__/template-resolver.test.ts` | Added 22 new tests: `extractPrebuildFeaturesRaw` (7), T1-T3 auto-injection (3), T4-T6 resolveTemplates (3), `warnPrebuildPortFeaturesStaticPort` (5), plus 4 supporting tests |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Added `claudeCodeMetadata`, updated mocks for metadata fetch, added T9-T12 integration tests (4) with supporting config constants and metadata fixtures |

## Verification

**Tests:**

```
 Test Files  20 passed (20)
      Tests  445 passed (445)
   Start at  11:54:14
   Duration  43.93s (transform 1.28s, setup 0ms, collect 3.26s, tests 51.87s, environment 3ms, prepare 2.07s)
```

22 new tests added, 0 regressions. All 445 tests pass across 20 test files.

**Constraints verified:**
- `validateNoOverlap()` -- unchanged
- `runPrebuild()` -- unchanged
- `PortAllocator` -- unchanged
- `warnPrebuildPortTemplates()` -- unchanged
- Discovery tools (`lace-discover`, `wez-into`) -- unchanged
- Port range (22425-22499) -- unchanged

**Implementation review:** Self-review completed at `cdocs/reviews/2026-02-09-review-of-prebuild-features-port-support-implementation.md`. Verdict: Accept. No blocking issues found.
