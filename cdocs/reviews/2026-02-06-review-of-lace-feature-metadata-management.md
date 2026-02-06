---
review_of: cdocs/proposals/2026-02-06-lace-feature-metadata-management.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T19:45:00-08:00
task_list: lace/feature-overhaul
type: review
state: live
status: done
tags: [rereview_agent, architecture, error_semantics, v2_convention, implementation_detail, test_plan]
---

# Review: Devcontainer Feature Metadata Management (R2)

## Summary Assessment

This is a substantial revision that addresses all three pieces of user feedback: error semantics changed from best-effort to fail-fast, port label examples now consistently use the v2 `featureId/optionName` convention, and the implementation plan expanded from high-level bullets to detailed TypeScript code drafts with 41 concrete test scenarios. All R1 blocking issues (cache key escaping, `FetchOptions` parameter threading) remain resolved. The proposal is now implementation-ready. One blocking issue: the `--no-cache` flag in the `readFsCache` code path does not distinguish between floating and pinned versions, contradicting the design text and test scenario 31.

Verdict: **Revise** -- one blocking issue in the cache bypass logic. Non-blocking items are minor.

## Prior Review Status (R1)

All R1 action items addressed:
- [blocking] Cache key escaping: replaced with percent-encoding. Verified correct.
- [blocking] FetchOptions parameter: added with `noCache`, `skipValidation`, and `subprocess` fields.
- [non-blocking] Objective wording: clarified.
- [non-blocking] Local path resolution: specified as caller-resolves.
- [non-blocking] ValidationResult simplified: `warnings`/`unknownOptions` replaced with unified `errors: ValidationError[]` with `kind` discriminator. Good.
- [non-blocking] No-version-tag edge case: added.
- [non-blocking] Runtime type narrowing: noted.
- [non-blocking] Options parameter in Phase 1: established.

## Verification of User Feedback Points

### 1. Error semantics: fail-fast, not best-effort

**Pass.** The revision is thoroughly consistent:
- BLUF: "strict error semantics -- metadata fetch failures are build errors that abort `lace up`"
- Error semantics section: five-point degradation path with `MetadataFetchError` thrown on failure
- `MetadataFetchError` class: clear error message with feature ID, reason, and `--skip-metadata-validation` hint
- Design decision: explicit rationale for why best-effort was rejected
- `fetchFeatureMetadata()` code draft: throws by default, returns null only when `skipValidation` is true
- Integration code draft: validation errors throw, aborting the pipeline
- Test scenarios 2, 3, 36, 37, 41: cover both error and skip-validation paths
- No residual "warning" or "best-effort" language in any section

One place deserves a close look: the v2 feature awareness proposal still says "Best-effort" in its `feature-metadata.ts` module description (line 208) and "Metadata failure logs warning, does not block `lace up`" in Phase 2 success criteria (line 357). That is a different document and out of scope for this review, but the implementer should update it for consistency.

### 2. Port label examples match v2 conventions

**Pass.** All examples use `sshPort` as both the option name and the `customizations.lace.ports` key:
- Module API section: `FeatureMetadata` example uses `sshPort` throughout
- Extraction section: correct example with `sshPort`/`sshPort` alignment, plus explicit "WRONG" example showing the `port`/`ssh` mismatch
- `validatePortDeclarations()`: new function that enforces key-option alignment
- Test scenarios 18-21: specifically test the v2 convention enforcement
- Integration scenarios 39: tests that a mismatch aborts `lace up`

The "WRONG" example callout is a nice addition -- it makes the convention violation concrete.

### 3. Implementation includes code snippets

**Pass.** The proposal now includes TypeScript code drafts for:
- `fetchFromRegistry()` -- full function body with error handling
- `fetchFromLocalPath()` -- full function body with `existsSync`/`readFileSync`
- `isLocalPath()` -- detection logic
- `fetchFeatureMetadata()` -- full orchestration with cache checks and error handling
- `fetchAllFeatureMetadata()` -- deduplication and `Promise.all()`
- `CacheEntry` interface -- file format
- `featureIdToCacheKey()` / `cacheKeyToFilePath()` -- percent-encoding
- `getTtlMs()` -- version format detection with regexes
- `readFsCache()` -- TTL checking logic
- `writeFsCache()` -- directory creation and serialization
- `validateFeatureOptions()` -- full function body
- `validatePortDeclarations()` -- full function body
- `extractLaceCustomizations()` -- runtime type narrowing with helper functions
- `MetadataFetchError` class -- custom error with structured fields
- Integration sketch in `up.ts` -- pipeline wiring

This is comprehensive. The code drafts are logical, consistent with each other, and consistent with the existing `subprocess.ts` patterns in the codebase.

### 4. Test plan has concrete scenarios

**Pass.** 41 numbered scenarios, each with:
- Setup/input: specific mock data or preconditions
- Expected output: concrete values, error types, or behavioral assertions
- Scenarios grouped by concern (OCI fetch, local-path, extraction, option validation, port declaration validation, in-memory cache, filesystem cache, integration)

The test scenarios are actionable -- an implementer could write the test file directly from these descriptions.

## Section-by-Section Findings

### BLUF

Clean. The bold "strict error semantics" is a good signal. Correctly summarizes the `--skip-metadata-validation` escape hatch.

### Module API surface

**Non-blocking:** `ValidationError` declares `kind: "unknown_option" | "port_key_mismatch" | "missing_port_option"` but the `"missing_port_option"` kind is never produced by any code draft or referenced in any test scenario. Either remove it from the union type or document what would produce it. My guess is it was intended for a case like "feature uses `${lace.port(feat/opt)}` but `opt` is not declared in options" -- but that validation lives in the template resolver (v2 proposal), not in this module. Recommend removing it to avoid confusion.

### Error semantics section

**Blocking:** The `fetchFeatureMetadata()` code draft checks `!noCache` before calling `readFsCache()`:

```typescript
if (!isLocalPath(featureId) && !noCache) {
    const fsCached = readFsCache(featureId);
    ...
}
```

When `noCache` is true, the entire filesystem cache is bypassed -- including permanent entries for pinned versions. But the design text says: "Pinned version caches are not affected by `noCache` since their content is immutable." And test scenario 31 explicitly requires: "`--no-cache` does NOT bypass permanent cache."

The code draft contradicts the design and the test. The fix: when `noCache` is true, still check the filesystem cache but only for pinned versions. This requires the cache read path to know whether the entry is permanent:

```typescript
if (!isLocalPath(featureId)) {
    const fsCached = readFsCache(featureId, { skipFloating: noCache });
    if (fsCached) { ... }
}
```

Or more simply: always call `readFsCache()`, and have `readFsCache()` accept a `skipFloating` flag that skips entries with non-null TTL.

### Caching section

**Non-blocking:** The `SEMVER_EXACT` regex `/^.*:\d+\.\d+\.\d+$/` would also match pre-release versions like `:1.2.3-beta` because `-beta` is not in the regex and the regex does not anchor after the third digit group before `$`. Wait -- actually it would NOT match `:1.2.3-beta` because the `$` requires the string to end after the digits. So `:1.2.3-beta` gets a 24h TTL, which is correct since pre-release tags can be republished. The regex is fine as-is. No action needed.

**Non-blocking:** `SEMVER_EXACT` also matches things like `:0.0.999` which are valid semver but unusual. This is fine -- the intent is "three dot-separated numbers" not "valid semver range."

### Validation: port declaration keys

Good addition. The `validatePortDeclarations()` function is clean and the error messages are actionable.

**Non-blocking:** The function takes only `metadata: FeatureMetadata`, which means the `featureId` in error messages comes from `metadata.id`. This is the feature's self-declared ID (e.g., `"wezterm-server"`), not the full registry path. For the error message this is actually better (shorter, more recognizable), but worth noting that this is not the same string as the `featureId` parameter in `fetchFeatureMetadata()`.

### extractLaceCustomizations code draft

**Non-blocking:** When `customizations.lace` exists but `ports` does not, the function returns `{ ports: undefined }`. When `customizations` does not exist at all, it returns `null`. This is a meaningful distinction: `null` means "no lace customizations at all" vs. `{ ports: undefined }` meaning "lace customizations exist but no ports declared." This is fine but should be documented in the JSDoc so callers know to check for both.

### Integration with `lace up` code draft

**Non-blocking:** The integration code calls `extractFeatureIdsFromConfig(config)` and `getUserProvidedOptions(config, featureId)` -- neither of which is defined in this proposal. These are presumably implemented in the v2 feature awareness proposal or in the template resolver. This is fine for a code sketch, but the proposal should note that these helper functions come from outside this module.

### Test Plan

**Non-blocking:** Scenario 31 ("--no-cache does NOT bypass permanent cache") is a good test but, as noted in the blocking finding above, the current code draft would fail it. This is actually a positive signal -- the test correctly captures the intended behavior and will catch the bug in the code draft.

**Non-blocking:** No test scenario for a feature that has `customizations.lace` but no `ports` key, verifying that `extractLaceCustomizations()` returns `{ ports: undefined }` (distinct from `null`). This edge case is worth a scenario since the distinction affects caller logic.

### Implementation Phases

Clean. Phase boundaries are well-chosen. Phase 1 scope matches scenarios 1-24, Phase 2 matches 25-34, Phase 3 matches 35-41.

## Verdict

**Revise.** One blocking issue: the `readFsCache` bypass logic in `fetchFeatureMetadata()` does not distinguish between floating and pinned cache entries when `noCache` is true, contradicting the design text and test scenario 31. Straightforward fix -- pass a flag to `readFsCache()` or restructure the conditional.

## Action Items

1. [blocking] Fix the `noCache` cache bypass in `fetchFeatureMetadata()` to still check permanent (pinned) cache entries when `noCache` is true. The current code skips all filesystem cache reads when `noCache` is true, but the design and scenario 31 require that pinned versions remain cached. Restructure the conditional: always call `readFsCache()`, pass a `skipFloating` flag when `noCache` is true, and have `readFsCache()` return null for entries with non-null TTL when that flag is set.
2. [non-blocking] Remove `"missing_port_option"` from the `ValidationError.kind` union type -- it is never produced by any code path in this proposal.
3. [non-blocking] Document the `null` vs. `{ ports: undefined }` distinction in `extractLaceCustomizations()` JSDoc.
4. [non-blocking] Note that `extractFeatureIdsFromConfig()` and `getUserProvidedOptions()` in the integration code sketch are external helpers, not part of this module.
5. [non-blocking] Add a test scenario for `extractLaceCustomizations()` when `customizations.lace` exists but has no `ports` key, verifying the return value is `{ ports: undefined }` (not `null`).
