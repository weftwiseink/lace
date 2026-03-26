---
first_authored:
  by: "@claude-opus-4-6-20250310"
  at: 2026-03-26T13:48:49-07:00
task_list: lace/test-health
type: devlog
state: live
status: wip
tags: [test-health, test-isolation, acceptance-tests]
---

# Fix 105 Pre-Existing Test Failures and Reorganize Acceptance Tests: Devlog

## Objective

Fix all 105 pre-existing test failures in `packages/lace/` and reorganize tests with external dependencies into a separate acceptance test tier.

The failures trace to a single root cause: the host's `~/.config/lace/user.json` leaks into tests via `loadUserConfig()` when `LACE_USER_CONFIG` is unset.
See `cdocs/reports/2026-03-26-pre-existing-test-failures-analysis.md` for the full investigation.

## Plan

1. **Baseline**: Run full test suite, capture current failure count.
2. **Test isolation fix**: Set `LACE_USER_CONFIG=/dev/null` in `beforeEach`/`afterEach` for all 10 affected test files.
3. **Stale wezterm-server tests**: Remove 4 tests referencing the deleted feature.
4. **Acceptance test reorganization**: Move tests with external dependencies (Docker Hub pulls, registry fetches) to `*.acceptance.test.ts` files gated behind `LACE_RUN_ACCEPTANCE_TESTS`.
5. **Verify**: Full suite passes with 0 failures.

## Testing Approach

Run `pnpm test` after each change to track progress toward 0 failures.
Acceptance tests will be verified separately with `LACE_RUN_ACCEPTANCE_TESTS=1`.

## Implementation Notes

(Updated as work progresses.)

## Changes Made

| File | Description |
|------|-------------|

## Verification
