---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T22:00:00-08:00
task_list: lace/feature-metadata
type: devlog
state: live
status: review_ready
tags: [feature-metadata, oci, tarball-fallback, hybrid, implementation]
references:
  - cdocs/proposals/2026-02-13-hybrid-oci-metadata-fallback.md
  - cdocs/reports/2026-02-13-oci-metadata-annotation-missing-incident.md
---

# Hybrid OCI Metadata Fallback Implementation: Devlog

## Objective

Implement the [hybrid OCI metadata fallback proposal](../proposals/2026-02-13-hybrid-oci-metadata-fallback.md) to fix `lace up` failures on third-party features that lack the `dev.containers.metadata` OCI annotation (e.g., `ghcr.io/eitsupi/devcontainer-features/nushell:0`). The fix adds a blob download + tarball extraction fallback path when the annotation is missing, while preserving the existing subprocess-based manifest fetch for the normal case.

## Plan

Following the proposal's 4-phase implementation:

1. **Phase 1**: Create `oci-blob-fallback.ts`, modify `feature-metadata.ts` (MetadataFetchError kind field, AnnotationMissingError sentinel, blob fallback in catch block, OciManifest layers)
2. **Phase 2**: Test coverage -- new `oci-blob-fallback.test.ts`, update `feature-metadata.test.ts` and `up.integration.test.ts`
3. **Phase 3**: Remove `--skip-metadata-validation` from `bin/wez-into`
4. **Phase 4**: Smoke test against live registries

Commits after each phase. Using `/review` subagents for periodic feedback.

## Testing Approach

- **Unit tests first**: Write tests for `oci-blob-fallback.ts` functions (tar parser, token acquisition, blob download) with mocked `fetch`
- **Integration tests**: Update `feature-metadata.test.ts` scenario 5 (split into 5a/5b for blob fallback success/failure), add mixed-batch tests
- **`up.integration.test.ts`**: Add mixed-feature scenarios with annotation-missing + blob fallback
- **Smoke test**: Run `vitest` suite, then live `lace up` in lace devcontainer (has nushell:0)
- **Verify existing tests**: All 445+ tests must pass without regressions

## Implementation Notes

### Phase 1: Core Infrastructure
- Created `oci-blob-fallback.ts` (~200 lines): `parseFeatureOciRef`, `acquireAnonymousToken`, `downloadBlob`, `extractFromTar`, `fetchFromBlob`
- The tar parser handles pax extended headers (0x78 per-file, 0x67 global), `./` prefix normalization, and gzip detection (early error with clear message)
- `AnnotationMissingError` is an internal sentinel (not exported) that bridges the sync `fetchFromRegistry()` to the async `fetchFeatureMetadata()` for blob fallback dispatch
- Added `MetadataFetchKind` type with 4 variants for structured error discrimination
- `OciManifest` interface extended with optional `layers` array to pass layer info through to the fallback

### Phase 2: Test Coverage
- 29 unit tests for `oci-blob-fallback.ts` covering all exported functions
- Split scenario 5 into 5a (blob fallback succeeds) and 5b (blob fallback fails with `blob_fallback_failed` kind)
- Added `MetadataFetchError` kind discrimination tests (5 tests)
- Added blob fallback integration tests (4 tests) covering cache behavior, error propagation
- Added mixed-annotation integration tests for `up.integration.test.ts` (3 tests)
- Total: 488 tests, up from 445

### Phase 3: wez-into Cleanup
- Removed `--skip-metadata-validation` flag and explanatory comment from `bin/wez-into`
- This workaround is no longer needed since `lace up` handles missing annotations gracefully

### Phase 4: Live Smoke Tests
- Confirmed `nushell:0` still lacks `dev.containers.metadata` annotation — blob fallback path is exercised
- Confirmed `wezterm-server:1` has the annotation — normal path still works
- Anonymous token, blob download (10,240 bytes), tar extraction, and JSON parse all succeed against live GHCR

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/oci-blob-fallback.ts` | New module: OCI blob download + tar extraction fallback |
| `packages/lace/src/lib/feature-metadata.ts` | MetadataFetchKind, AnnotationMissingError sentinel, blob fallback in catch block |
| `packages/lace/src/lib/up.ts` | Updated comment for null-metadata continue (line 154) |
| `packages/lace/src/lib/__tests__/oci-blob-fallback.test.ts` | 29 unit tests for blob fallback module |
| `packages/lace/src/lib/__tests__/feature-metadata.test.ts` | Blob fallback integration + kind discrimination tests |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Mixed-annotation integration tests |
| `bin/wez-into` | Removed `--skip-metadata-validation` workaround |

## Verification

**Tests (all 488 passing):**
```
 Test Files  21 passed (21)
      Tests  488 passed (488)
   Duration  26.36s
```

**Live GHCR smoke test:**
```
=== Test 1: GHCR anonymous token ===
OK: got token (80 chars)

=== Test 2: OCI manifest ===
OK: manifest has 1 layers
Annotation present: false
Confirmed: no annotation. Blob fallback path WILL be triggered.

=== Test 3: Download blob (sha256:4782d0e1b185d...) ===
OK: downloaded 10240 bytes

=== Test 4: Tar contains devcontainer-feature.json ===
OK: found at byte offset 2635

=== Test 5: Parse devcontainer-feature.json ===
OK: parsed JSON, id=nushell, version=0.1.1

=== ALL SMOKE TESTS PASSED ===
```

**wezterm-server annotation (normal path):**
```
wezterm-server annotation present: true
OK: annotation parsed, id=wezterm-server
```
