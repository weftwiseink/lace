---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T23:00:00-06:00
task_list: lace/up-pipeline
type: devlog
state: live
status: review_ready
tags: [lace-up, validation-architecture, container-verification, git-extensions, docker-no-cache]
related_to:
  - cdocs/proposals/2026-03-11-post-container-git-verification.md
---

# Post-Container Git Extension Verification: Devlog

## Objective

Implement the accepted proposal
`cdocs/proposals/2026-03-11-post-container-git-verification.md`
-- fix broken git extension validation in the `lace up` pipeline by:

1. Removing the extension error from `applyWorkspaceLayout()` (make informational-only)
2. Adding post-`devcontainer up` verification via `docker exec <container> git --version`
3. Passing `--no-cache` to `devcontainer build` when `force` is true

**Key references:**
- Proposal (implementation_wip): `cdocs/proposals/2026-03-11-post-container-git-verification.md`

## Task List

### Phase 1: Core functions + remove error + --no-cache
- [x] Add `compareVersions()` to workspace-detector.ts
- [x] Add `ContainerGitVerificationResult` interface to workspace-detector.ts
- [x] Add `verifyContainerGitVersion()` to workspace-detector.ts
- [x] Add `getDetectedExtensions()` helper to workspace-detector.ts
- [x] Export `findBareGitDir` (currently private)
- [x] Remove extension error block from workspace-layout.ts (lines 201-218)
- [x] Add `--no-cache` to prebuild.ts when `options.force` is true
- [x] Type check passes
- [x] Commit Phase 1

### Phase 2: Pipeline integration
- [x] Add `containerVerification` to `UpResult.phases` in up.ts
- [x] Add `resolveContainerName()` to project-name.ts
- [x] Add verification block in up.ts after devcontainer up
- [x] Type check passes
- [x] Commit Phase 2

### Phase 3: Tests (T1-T15)
- [x] T1: compareVersions basic cases
- [x] T1b: verifyContainerGitVersion parses version with suffixes
- [x] T2: verifyContainerGitVersion with adequate git
- [x] T3: verifyContainerGitVersion with inadequate git
- [x] T4: verifyContainerGitVersion with git not installed
- [x] T5: verifyContainerGitVersion with unknown extension
- [x] T6: verifyContainerGitVersion with multiple extensions, mixed
- [x] T7: getDetectedExtensions returns extensions for bare-worktree
- [x] T7b: getDetectedExtensions returns null for normal clone
- [x] T8: applyWorkspaceLayout no longer errors on extensions
- [x] T9-T13b: Integration tests in up.integration.test.ts
- [x] T13c: resolveContainerName tests in project-name.test.ts
- [x] T14-T15: prebuild --no-cache tests
- [x] All tests pass (888/888)
- [x] Commit Phase 3

## Session Log

### Phase 1: Core functions + remove error + --no-cache

**workspace-detector.ts changes:**
- Added `import type { RunSubprocess }` for the subprocess type
- Exported `findBareGitDir` (was `function`, now `export function`)
- Added `ContainerGitVerificationResult` interface
- Added `compareVersions()` -- simple semver comparison with missing-patch-as-0
- Added `verifyContainerGitVersion()` -- runs `docker exec <container> git --version`,
  parses output, compares against `GIT_EXTENSION_MIN_VERSIONS`
- Added `getDetectedExtensions()` -- resolves bare git dir from classification,
  reads config, returns extensions map or null

**workspace-layout.ts changes:**
- Removed the `unsupported-extension` error block (lines 201-218). Extension
  warnings still flow through the general warning loop (lines 99-103) as
  informational messages.

**prebuild.ts changes:**
- Refactored the `devcontainer build` args into a `buildArgs` array
- Added `if (options.force) { buildArgs.push("--no-cache"); }`

**workspace-layout.test.ts fix:**
- Updated the test "returns error when repo has unsupported git extensions" to
  instead expect `status: "applied"` (renamed to "succeeds with informational
  warnings when repo has git extensions"). This test was the direct consequence
  of removing the error block.

Type check clean, all 70 existing tests pass. Committed as `085e2b0`.

### Phase 2: Pipeline integration

**project-name.ts changes:**
- Added `resolveContainerName()` -- mirrors `generateExtendedConfig`'s
  container name logic (check for `--name` in `runArgs`, fall back to
  `sanitizeContainerName(projectName)`)

**up.ts changes:**
- Added imports: `resolveContainerName` from project-name, `getDetectedExtensions`
  and `verifyContainerGitVersion` from workspace-detector
- Added `containerVerification` to `UpResult.phases` interface
- Added verification block after `devcontainer up` succeeds:
  - Calls `classifyWorkspace()` + `getDetectedExtensions()` to check for extensions
  - If extensions found: reads extended config from disk, resolves container name,
    runs `docker exec` verification
  - Respects `--skip-validation` (downgrade convention)
  - Skipped when `skipDevcontainerUp` is true

**Design note:** Reading the extended config from disk to resolve the container
name is necessary because `generateExtendedConfig` is a void function that writes
to disk. The extended config includes the final `runArgs` with the `--name` flag.
This is cleaner than threading the config through additional parameters.

Type check clean, all 69 tests pass. Committed as `b9f1b68`.

### Phase 3: Tests (T1-T15)

**workspace-detector.test.ts additions (17 new tests):**
- `compareVersions`: 5 tests (positive, zero, negative, major, missing patch)
- `verifyContainerGitVersion`: 7 tests (T1b through T6 + unexpected output)
- `getDetectedExtensions`: 5 tests (T7 worktree, T7 bare-root, T7b normal clone,
  no extensions, no .git)

**project-name.test.ts additions (5 new tests):**
- `resolveContainerName`: space form, equals form, fallback to sanitize,
  missing runArgs, ignores --namespace

**up.integration.test.ts additions (6 new tests):**
- T9: verification passes with adequate git (2.53.0)
- T10: verification fails with old git (2.39.5)
- T11: --skip-validation downgrades failure
- T12: no extensions skips verification
- T13: non-prebuild config with extensions runs verification
- T13b: custom --name in runArgs targets correct container

**prebuild.integration.test.ts additions (2 new tests):**
- T14: `--no-cache` present when `force: true`
- T15: `--no-cache` absent when force not set

Also added `clearClassificationCache()` to the `beforeEach` in up.integration.test.ts
to prevent cross-test contamination from bare-repo fixtures.

**Verification:** 888/888 tests pass, type check clean.

## Deviations from Proposal

None. The implementation follows the proposal exactly as specified.
