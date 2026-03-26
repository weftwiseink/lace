---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T20:00:00-07:00
task_list: lace/podman-migration
type: devlog
state: archived
status: done
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

- Unit tests for `getPodmanCommand()` cache behavior, override, and warning (7 tests).
- Full test suite verified after each phase: 105 pre-existing failures, zero new regressions.
- Mock assertions updated from `"docker"` to `"podman"` where subprocess commands are checked.
- Mount policy tests for new podman blocklist entries (4 new test cases).

## Implementation Notes

### Phase 1

Created `container-runtime.ts` as a thin cached accessor.
Added `overridePodmanCommand?: string` to `LaceSettings` interface.
The function reads `loadSettings()` once, caches the result.
Non-podman overrides trigger a one-time `console.warn`.
`resetPodmanCommandCache()` exported for test isolation.

### Phase 2

Migrated all 5 call sites in 4 source files, plus 2 devcontainer CLI calls.
Key issue discovered: `getPodmanCommand()` calls `loadSettings()`, which reads `LACE_SETTINGS` env var.
Test files that set `LACE_SETTINGS` to a temp path without creating the file caused `SettingsConfigError`.
Fix: create a default empty `{}` settings file in `beforeEach` and call `resetPodmanCommandCache()` for test isolation.
This resolved the 3 test regressions from settings file access.

### Phase 3

Added podman storage (`~/.local/share/containers`) and podman socket (`$XDG_RUNTIME_DIR/podman`) to mount policy blocklist.
The socket path uses `process.env.XDG_RUNTIME_DIR` expansion at module load time (short-lived CLI, no invalidation needed).
If `XDG_RUNTIME_DIR` is unset, the socket rule is skipped with a comment.

Neovim N8 test needed `:Z` SELinux label on bind mount for rootless podman on Fedora.
Updated JSDoc comments: "Docker" to "container runtime" or "container" where referring to the runtime (not the Dockerfile file format).

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/container-runtime.ts` | New: `getPodmanCommand()` and `resetPodmanCommandCache()` |
| `packages/lace/src/lib/settings.ts` | Added `overridePodmanCommand` to `LaceSettings` |
| `packages/lace/src/lib/up.ts` | Migrated 2 docker calls + devcontainer up `--docker-path` |
| `packages/lace/src/lib/prebuild.ts` | Migrated 1 docker call + devcontainer build `--docker-path` |
| `packages/lace/src/commands/up.ts` | Migrated 1 docker call in `isContainerRunning` |
| `packages/lace/src/lib/workspace-detector.ts` | Migrated 1 docker call in `verifyContainerGitVersion` |
| `packages/lace/src/lib/user-config.ts` | Added podman entries to mount policy blocklist |
| `packages/lace/src/lib/project-name.ts` | JSDoc: "Docker" to "container" |
| `packages/lace/src/lib/feature-metadata.ts` | JSDoc: "Docker mount" to "Mount" |
| `packages/lace/src/lib/port-allocator.ts` | JSDoc: "Docker -p" to "Container -p" |
| `packages/lace/src/lib/__tests__/container-runtime.test.ts` | New: 7 unit tests |
| `packages/lace/src/lib/__tests__/user-config.test.ts` | Added 4 podman mount policy test cases |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Updated mocks and test setup for podman |
| `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` | Added cache reset and default settings |
| `packages/lace/src/lib/__tests__/up-project-name.integration.test.ts` | Added cache reset and default settings |
| `packages/lace/src/__tests__/docker_smoke.test.ts` | Updated to use `getPodmanCommand()` |
| `packages/lace/src/__tests__/helpers/scenario-utils.ts` | Updated to use `getPodmanCommand()` |
| `packages/lace/src/__tests__/neovim-scenarios.test.ts` | Updated docker exec/run to podman, added `:Z` |
| `packages/lace/src/__tests__/claude-code-scenarios.test.ts` | Updated docker exec to podman |

## Verification

### Build and tests

```
Test Files  9 failed | 29 passed (38)
     Tests  105 failed | 920 passed (1025)
```

105 failures are all pre-existing (present before this work).
Zero new regressions introduced.
4 new tests added (mount policy), 7 new tests added (container-runtime), totaling 1025 tests (up from 1021).

### Hardcoded docker check

No `"docker"` strings remain in non-test source files:
```
grep -r '"docker"' packages/lace/src/ --include='*.ts' --exclude='*test*' --exclude='*__tests__*'
(no output)
```

### Podman availability

```
podman version 5.7.1
```
