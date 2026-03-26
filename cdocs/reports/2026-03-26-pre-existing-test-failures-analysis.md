---
first_authored:
  by: "@claude-opus-4-6-20250310"
  at: 2026-03-26T13:47:07-07:00
task_list: lace/test-health
type: report
state: live
status: done
tags: [test-health, investigation, test-isolation]
---

# Pre-Existing Test Failures in packages/lace

> BLUF: All 105 test failures share a single root cause: the integration tests read the host's real `~/.config/lace/user.json` instead of running in isolation.
> The user config injects features (neovim, nushell, claude-code) whose metadata the test mocks do not handle, causing the `runUp` pipeline to abort at metadata fetch.
> This is a test isolation defect, not a product bug.
> The fix is to set `LACE_USER_CONFIG=/dev/null` (or equivalent) in the affected test harnesses.

## Context / Background

During implementation of the podman-first core runtime (replacing `"docker"` with `getPodmanCommand()`), 105 tests were discovered to be already failing on `main` before any migration changes.
This report investigates the failures to determine whether they indicate product bugs, test infrastructure issues, or environmental coupling.

## Key Findings

- **105 failures across 9 test files**, out of 1025 total tests (920 passing).
- **Single root cause**: `loadUserConfig()` in `up.ts` calls `findUserConfig()`, which falls through to `~/.config/lace/user.json` when `LACE_USER_CONFIG` is unset.
  The host has a real `user.json` that declares three features, git identity, mounts, and env vars.
- **The mock subprocess** in `up.integration.test.ts` only handles `ghcr.io/anthropics/devcontainer-features/claude-code:1` metadata requests.
  All other features (injected from the real user config) return `exitCode: 1, Error: feature not found`, which aborts the pipeline at metadata validation.
- **29 test files pass cleanly.** These are either pure unit tests or integration tests that don't invoke `runUp`.

## Failure Taxonomy

### Category 1: Pipeline abort from unhandled user-config features (98 failures)

The dominant pattern: `expected 1 to be +0 // Object.is equality` on `result.exitCode`.

The pipeline loads the host's `user.json`, which merges in `ghcr.io/weftwiseink/devcontainer-features/neovim:1` and `ghcr.io/eitsupi/devcontainer-features/nushell:0`.
The test mock returns `exitCode: 1` for these unknown features.
The metadata validation phase aborts with:

```
Failed to fetch metadata for feature "ghcr.io/weftwiseink/devcontainer-features/neovim:1":
  devcontainer CLI exited with code 1: Error: feature not found
```

This accounts for 98 of the 105 failures.

**Affected files and counts:**

| Test file | Failed | Total | Notes |
|-----------|--------|-------|-------|
| `commands/__tests__/up.integration.test.ts` | 50 | 57 | Core `runUp` pipeline tests |
| `lib/__tests__/up-mount.integration.test.ts` | 24 | 24 | Mount template resolution via `runUp` |
| `lib/__tests__/up-project-name.integration.test.ts` | 7 | 7 | Project name injection via `runUp` |
| `__tests__/claude-code-scenarios.test.ts` | 6 | 8 | Scenario tests calling `runUp` |
| `__tests__/neovim-scenarios.test.ts` | 4 | 7 | Scenario tests calling `runUp` |
| `__tests__/portless-scenarios.test.ts` | 2 | 3 | Scenario tests calling `runUp` |
| `__tests__/workspace_smoke.test.ts` | 7 | 15 | Workspace pipeline tests |
| `__tests__/user-config-scenarios.test.ts` | 1 | 6 | UC2 backward compatibility |

### Category 2: Deleted `wezterm-server` feature directory (4 failures)

Three scenario tests reference `wezterm-server` via `symlinkLocalFeature("wezterm-server")`, which looks for `devcontainers/features/src/wezterm-server/`.
This directory was deleted in commit `7f6ca1d` ("refactor: delete wezterm-server feature and cleanup"), but the tests were not updated.

```
Error: Feature source not found at .../devcontainers/features/src/wezterm-server.
```

**Affected tests:**
- `claude-code-scenarios.test.ts`: Scenario C5 (claude-code + wezterm-server coexistence)
- `neovim-scenarios.test.ts`: Scenario N3 (neovim + wezterm-server coexistence)
- `portless-scenarios.test.ts`: Scenario P3 (portless + wezterm-server coexistence)
- `up.integration.test.ts`: 1 test referencing wezterm-server metadata

### Category 3: Git identity leaking from host config (1 failure)

`fundamentals-scenarios.test.ts` Scenario F2 ("fundamentals without user.json") expects `containerEnv.LACE_GIT_NAME` to be `undefined`, but gets `"micimize"` from the host's `user.json`.
This is the same root cause as Category 1: the test does not isolate from the host user config.

```
expected 'micimize' to be undefined
```

## Root Cause Analysis

The `loadUserConfig()` function has a well-designed override mechanism:

1. Check `LACE_USER_CONFIG` env var first.
2. Fall back to `~/.config/lace/user.json`.
3. Return empty config if neither exists.

The problem is that `up.integration.test.ts`, `up-mount.integration.test.ts`, `up-project-name.integration.test.ts`, and the scenario test files set `LACE_SETTINGS` in `beforeEach` (for settings isolation) but do not set `LACE_USER_CONFIG`.
This means the pipeline picks up the host's real user config, which injects features the mocks don't handle.

The `beforeEach` in `up.integration.test.ts` explicitly manages `LACE_SETTINGS`:

```typescript
process.env.LACE_SETTINGS = join(settingsDir, "settings.json");
```

But never sets `LACE_USER_CONFIG`.

## Severity Assessment

**These are not product bugs.** The `runUp` pipeline correctly validates metadata for all declared features.
The failures occur because the test environment leaks host state into test execution.

- **No user-visible defects** are hidden by these failures.
- **Test results are environment-dependent**: they pass on machines without `~/.config/lace/user.json` and fail on machines that have one.
- **The Category 2 failures** (deleted wezterm-server) are genuine stale tests that reference a removed component.

## Recommendations

### Immediate fix (addresses 101/105 failures)

Add `LACE_USER_CONFIG` isolation to the shared `beforeEach` in all affected test harnesses:

```typescript
beforeEach(() => {
  // Isolate from host user config
  process.env.LACE_USER_CONFIG = "/dev/null";
  // ... existing setup ...
});

afterEach(() => {
  delete process.env.LACE_USER_CONFIG;
  // ... existing teardown ...
});
```

Alternatively, create a nonexistent path and point to it, or write an empty `{}` to a temp file.

### Stale test cleanup (addresses 4/105 failures)

Remove or rewrite the three scenario tests that reference `wezterm-server`.
The feature was deleted in `7f6ca1d` and replaced by `lace-fundamentals`.
Options:
- Delete the coexistence tests outright (the feature no longer exists).
- Rewrite them to test `lace-fundamentals` + `portless` or `lace-fundamentals` + `claude-code` coexistence.

### Defensive improvement

Consider adding a guard in the test setup helper (`scenario-utils.ts`) that warns or fails if the test process has an active `~/.config/lace/user.json` and `LACE_USER_CONFIG` is not explicitly set.
This would prevent this class of isolation failure from recurring.
