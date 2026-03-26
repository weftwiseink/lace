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
2. **Test isolation fix**: Write `{}` to a temp file, set `LACE_USER_CONFIG` to that file in `beforeEach` for all affected test harnesses.
3. **Stale wezterm-server tests**: Remove tests referencing the deleted feature.
4. **Acceptance test reorganization**: Gate Docker-dependent tests behind `LACE_RUN_ACCEPTANCE_TESTS=1`.
5. **Verify**: Full suite passes with 0 failures.

## Testing Approach

Run `pnpm test` after each change to track progress toward 0 failures.
Acceptance tests verified separately with `LACE_RUN_ACCEPTANCE_TESTS=1`.

## Implementation Notes

### User config isolation

Initial attempt used `LACE_USER_CONFIG=/dev/null`, which caused `jsonc.parse("")` to return `undefined`, breaking downstream code.
Switched to writing `{}` to a temp file in each test's workspace directory.

For tests that deliberately test "no user config" behavior (UC2, F2), we keep the empty `{}` file rather than deleting the env var, because deleting allows the host's real `~/.config/lace/user.json` to leak in.
This is functionally equivalent: an empty user config has no features, no git identity, no mounts.

### Stale wezterm-server tests

Removed 3 scenario tests (C5, N3, P3) that used `symlinkLocalFeature(ctx, "wezterm-server")`.
The `wezterm-server` feature directory was deleted in commit `7f6ca1d`.
Tests in `up.integration.test.ts` that reference wezterm-server via registry URLs still work because the mock subprocess handles them.

### Additional fixes found during work

1. **C8 assertion**: The claude-code feature gained a `config-json` mount declaration after C8 was written.
   The assertion `mounts.filter(m => m.includes(".claude")).length === 1` now matches both `.claude` (dir) and `.claude.json` (file).
   Fixed to exclude `.claude.json` from the filter.

2. **Warning text mismatch**: `up.integration.test.ts` checked for "Docker will auto-create" but the product code was updated to say "container runtime will auto-create".
   Updated the test assertion.

3. **Missing settings files for worktree tests**: `up-project-name.integration.test.ts` set `LACE_SETTINGS` to paths where settings files didn't exist, causing `SettingsConfigError`.
   Added `mkdirSync`/`writeFileSync` to create the settings files at those paths.

### Acceptance test gating

Docker-dependent tests are gated behind `LACE_RUN_ACCEPTANCE_TESTS=1`:
- `docker_smoke.test.ts` (entire file: 3 tests)
- `claude-code-scenarios.test.ts` C4
- `neovim-scenarios.test.ts` N6, N8

These tests pull images from Docker Hub/GHCR, run real container builds, and exec into running containers.
They are antipatterns for a default test suite: they are slow (minutes), network-dependent, and can hit Docker Hub rate limits.

### Pre-existing prebuild T14 test

During initial investigation, the `runPrebuild: --no-cache when force is true (T14)` test appeared to fail.
This turned out to be a stale working tree issue: the uncommitted BuildKit migration changes to `prebuild.ts` were present during the initial run.
After the working tree was clean, T14 passes because `prebuild.ts` now correctly includes `--no-cache` when `force` is true.

## Changes Made

| File | Description |
|------|-------------|
| `src/commands/__tests__/up.integration.test.ts` | Add `LACE_USER_CONFIG` isolation; fix "container runtime" warning assertion |
| `src/lib/__tests__/up-mount.integration.test.ts` | Add `LACE_USER_CONFIG` isolation |
| `src/lib/__tests__/up-project-name.integration.test.ts` | Add `LACE_USER_CONFIG` isolation; create settings files for worktree tests |
| `src/__tests__/claude-code-scenarios.test.ts` | Add `LACE_USER_CONFIG` isolation; remove C5 (wezterm-server); fix C8 assertion; gate C4 |
| `src/__tests__/neovim-scenarios.test.ts` | Add `LACE_USER_CONFIG` isolation; remove N3 (wezterm-server); gate N6, N8 |
| `src/__tests__/portless-scenarios.test.ts` | Add `LACE_USER_CONFIG` isolation; remove P3 (wezterm-server) |
| `src/__tests__/fundamentals-scenarios.test.ts` | Add `LACE_USER_CONFIG` isolation; fix F2 "no user config" test |
| `src/__tests__/user-config-scenarios.test.ts` | Add `LACE_USER_CONFIG` isolation; fix UC2 "no user config" test |
| `src/__tests__/workspace_smoke.test.ts` | Add `LACE_USER_CONFIG` isolation |
| `src/__tests__/docker_smoke.test.ts` | Add `LACE_USER_CONFIG` isolation; gate behind `LACE_RUN_ACCEPTANCE_TESTS` |

## Verification

**Default suite (no acceptance tests):**
```
 Test Files  37 passed | 1 skipped (38)
      Tests  1011 passed | 11 skipped (1022)
   Start at  14:36:04
   Duration  1.83s
```

Baseline was 97 failures across 14 files.
All 97 failures are resolved: 0 failures in the default suite.
