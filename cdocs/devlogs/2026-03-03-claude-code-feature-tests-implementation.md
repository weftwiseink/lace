---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T20:00:00-08:00
task_list: lace/claude-code-feature
type: devlog
state: live
status: wip
tags: [claude-code, testing, scenario-tests, devcontainer-features]
---

# Claude Code Feature Tests Implementation

## Objective

Implement the claude-code feature test, verification, and documentation plan as specified in the proposal at `cdocs/proposals/2026-03-03-claude-code-feature-test-verification-plan.md`. This includes:
- Unit tests for metadata extraction of the real claude-code `devcontainer-feature.json`
- Eight scenario tests (C1-C8) covering mount auto-injection, settings overrides, validated mount resolution, Docker smoke test, multi-feature coexistence, version pinning, prebuild features, and mount suppression
- Documentation updates to the root README
- Full test suite verification

## Plan

### Phase 1: Unit Tests for Metadata Extraction
Add tests to `packages/lace/src/lib/__tests__/feature-metadata.test.ts` that read the real claude-code feature metadata and verify `extractLaceCustomizations()` returns the correct mount declaration with `sourceMustBe: "directory"` and no port declarations.

### Phase 2: Scenario Test File
Create `packages/lace/src/__tests__/claude-code-scenarios.test.ts` with scenarios C1-C8, following the patterns from `wezterm-server-scenarios.test.ts` and `portless-scenarios.test.ts`.

### Phase 3: Documentation
Add claude-code to the root README features table.

### Phase 4: Full Verification
Run the complete test suite and build. Paste output into this devlog.

## Testing Approach

Each scenario is written incrementally -- write one, run tests, fix, commit, then move to the next. This prevents cascading failures and makes debugging tractable.

The claude-code feature is mount-only (no ports), which exercises a different code path than wezterm-server (ports + mounts) or portless (ports only). Key aspects to test:
- `sourceMustBe: "directory"` validation
- `recommendedSource` expansion via `~/.claude`
- `_REMOTE_USER` variable passthrough (opaque to lace)
- Mount-only auto-injection without port allocation

## Implementation Notes

_(Updated as work progresses)_

## Changes Made

_(Updated as commits are made)_

## Verification

_(Full test output pasted after Phase 4)_
