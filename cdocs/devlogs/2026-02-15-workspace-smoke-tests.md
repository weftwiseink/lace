---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T23:55:00-08:00
task_list: lace/workspace-validation
type: devlog
state: live
status: wip
tags: [testing, smoke-test, workspace, git, acceptance]
---

# Workspace Smoke Tests: Devlog

## Objective

Implement the accepted proposal at `cdocs/proposals/2026-02-15-workspace-smoke-tests.md`. Create `packages/lace/src/__tests__/workspace_smoke.test.ts` — an acceptance test suite that scaffolds **real** git bare-repo and normal-clone structures, runs the full `runUp()` pipeline against them, and verifies workspace layout auto-generation end-to-end.

Key requirements:
- Real git operations via `execSync` (not fake filesystem stubs)
- `LACE_TEST_KEEP_FIXTURES=1` env var for fixture preservation
- `beforeAll`/`afterAll` lifecycle with named sub-fixtures
- Git availability gate (`describe.skipIf`)
- Mock subprocess but real filesystem
- 15 tests across 3 sections

## Plan

1. **Phase 1**: Test file scaffolding, fixture helpers, and 7 detection tests
   - Create file with imports, lifecycle, git availability gate
   - Implement `createRealBareWorktreeRepo()` and `createRealNormalClone()`
   - Add "workspace detection — real git repos" describe block
   - Verify and commit

2. **Phase 2**: Pipeline (5 tests) and combined E2E (3 tests)
   - Add mock subprocess setup (reuse pattern from `up.integration.test.ts`)
   - Add "lace up pipeline — real bare-worktree repos" describe block
   - Add "combined workspace + validation" describe block
   - Verify full suite green and commit

3. **Phase 3**: Subagent review + cleanup
   - Submit for `/cdocs:review`
   - Address findings, final verification

## Testing Approach

This **is** a test implementation — the deliverable is the test file itself. Verification is:
- All ~15 smoke tests pass against real git-produced structures
- Full suite (675 + new tests) passes
- `LACE_TEST_KEEP_FIXTURES=1` preserves fixtures
- Without env var, fixtures are cleaned up

## Implementation Notes

### Phase 1

*To be filled during implementation.*

### Phase 2

*To be filled during implementation.*

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/__tests__/workspace_smoke.test.ts` | NEW — Workspace smoke test suite |

## Verification

*To be filled after implementation.*
