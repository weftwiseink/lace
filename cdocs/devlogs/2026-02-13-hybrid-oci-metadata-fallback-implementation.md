---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T22:00:00-08:00
task_list: lace/feature-metadata
type: devlog
state: live
status: wip
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

*(Updated as work progresses)*

## Changes Made

| File | Description |
|------|-------------|

## Verification

*(Populated after each phase)*
