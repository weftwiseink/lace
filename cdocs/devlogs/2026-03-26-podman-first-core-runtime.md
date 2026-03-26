---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T20:00:00-07:00
task_list: lace/podman-migration
type: devlog
state: live
status: wip
tags: [architecture, podman, migration]
---

# Podman-First Core Runtime: Devlog

## Objective

Implement the proposal at `cdocs/proposals/2026-03-26-podman-first-core-runtime.md`.
Replace all hardcoded `"docker"` subprocess calls in `packages/lace/src/` with `getPodmanCommand()`.
Add `--docker-path` to devcontainer CLI calls.
Update mount policy with podman entries.

## Plan

Three phases, each committed separately:

1. **Phase 1:** Create `container-runtime.ts` with `getPodmanCommand()`, add `overridePodmanCommand` to `LaceSettings`, write unit tests.
2. **Phase 2:** Migrate all 5 docker call sites and 2 devcontainer CLI calls. Update test mocks to expect `"podman"`.
3. **Phase 3:** Mount policy podman entries, smoke test updates, JSDoc cleanup.

## Testing Approach

- Unit tests for `getPodmanCommand()` cache behavior, override, and warning.
- Existing 445+ test suite must pass after each phase.
- Mock assertions updated from `"docker"` to `"podman"` where subprocess commands are checked.
- Mount policy tests for new podman blocklist entries.

## Implementation Notes

### Phase 1

(Updated as work progresses)

### Phase 2

(Updated as work progresses)

### Phase 3

(Updated as work progresses)

## Changes Made

| File | Description |
|------|-------------|

## Verification
