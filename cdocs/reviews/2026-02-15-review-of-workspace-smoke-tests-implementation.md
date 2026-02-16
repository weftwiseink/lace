---
review_of: cdocs/proposals/2026-02-15-workspace-smoke-tests.md
implementation_file: packages/lace/src/__tests__/workspace_smoke.test.ts
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T22:30:00-08:00
task_list: lace/workspace-validation
type: review
state: live
status: done
tags: [fresh_agent, implementation, test_plan, coverage_gap_analysis, fixture_design, acceptance, smoke_test]
---

# Review: Workspace Smoke Tests -- Implementation

## Summary Assessment

The implementation delivers all 15 tests specified in the accepted proposal across the three prescribed sections (7 detection, 5 pipeline, 3 combined E2E). All 15 tests pass in 806ms. The fixture helpers use real git plumbing commands to produce authentic bare-worktree structures, the `KEEP_FIXTURES` lifecycle works correctly, and the git availability gate follows the established `describe.skipIf` pattern from `docker_smoke.test.ts`. One notable observation: `git worktree add` invoked from the bare directory produces absolute gitdir paths in the `.git` files, which triggers `absolute-gitdir` warnings in every pipeline and E2E test. This is not a bug -- it exercises a real-world code path -- but the proposal's edge case E2 (explicit absolute-path testing) is being implicitly covered rather than explicitly tested. Verdict: **Accept**, with two non-blocking suggestions.

## Proposal Compliance: Test Coverage Matrix

| # | Proposal Test | Implementation | Status |
|---|--------------|----------------|--------|
| 1 | classifies real normal clone | Line 190 | Present |
| 2 | classifies real bare-root | Line 196 | Present |
| 3 | classifies real worktree | Line 209 | Present |
| 4 | classifies real standard bare | Line 223 | Present |
| 5 | detects multiple worktrees | Line 230 | Present |
| 6 | handles worktree with slashes in branch name | Line 248 | Present |
| 7 | handles detached HEAD worktree | Line 269 | Present |
| 8 | generates workspaceMount + workspaceFolder for worktree | Line 292 | Present |
| 9 | generates correct config for bare-root entry | Line 334 | Present |
| 10 | injects safe.directory into postCreateCommand | Line 369 | Present |
| 11 | injects scanDepth into VS Code settings | Line 404 | Present |
| 12 | respects custom mountTarget | Line 442 | Present |
| 13 | full happy path: bare-worktree + validation + mounts | Line 484 | Present |
| 14 | validation failure halts pipeline | Line 546 | Present |
| 15 | skip-validation allows pipeline to continue | Line 594 | Present |

All 15 proposed tests are implemented. No tests were added beyond the proposal scope.

## Section-by-Section Findings

### Git availability gate (lines 34-41)

Correctly follows the `docker_smoke.test.ts` pattern: IIFE that catches `execSync("git --version")` failure and sets a boolean, used with `describe.skipIf(!gitAvailable)`. The `stdio: "pipe"` suppresses output. No issues.

### KEEP_FIXTURES lifecycle (lines 45-185)

**F1 (non-blocking).** The implementation matches the proposal exactly: `KEEP_FIXTURES` checks `process.env.LACE_TEST_KEEP_FIXTURES === "1"`, `beforeAll` creates a single `fixtureRoot` via `mkdtempSync`, `afterAll` conditionally removes it. Both `console.log` messages (on create and on preserve) are present. Verified manually: `LACE_TEST_KEEP_FIXTURES=1` preserves the directory and prints the path; without it, cleanup occurs.

### Fixture helper: createRealBareWorktreeRepo (lines 61-123)

**F2 (non-blocking, observation).** The helper uses `git -C "${bareDir}" worktree add` (operating from the bare directory) rather than `git -C "${root}" worktree add` (operating from the root with `.git` file). This causes git to write absolute gitdir paths in the worktree `.git` files (confirmed: `/tmp/lace-smoke-workspace-XXX/worktree-test/.bare/worktrees/main`). This is not incorrect -- it exercises a real git behavior -- but it means every worktree test implicitly triggers the `absolute-gitdir` warning path. The proposal's edge case E2 ("explicitly test by creating a worktree, then manually rewriting its `.git` file to use an absolute path") is therefore covered implicitly rather than explicitly, but since the detector already has dedicated unit tests for absolute vs. relative paths, this implicit coverage is sufficient.

**F3 (non-blocking, positive).** The use of git plumbing commands (`hash-object`, `commit-tree`, `update-ref`) to create the initial commit in the bare repo is a good design choice. It avoids needing a working tree for the initial commit and sidesteps the `core.bare` issue that would arise from trying `git commit` in a bare repo. The explicit `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME` environment variables prevent failures when the test environment has no global git config.

**F4 (non-blocking, positive).** The worktree creation logic correctly differentiates between the `main` branch (which already exists from the initial commit, so uses `worktree add ... main`) and new branches (which use `worktree add -b`). This prevents the "branch already exists" error that would occur if all branches used `-b`.

### Fixture helper: createRealNormalClone (lines 128-148)

Clean and minimal. Uses `git init` + `git commit --allow-empty` with explicit author/committer env vars. Returns the root path. No issues.

### Mock subprocess (lines 152-165)

**F5 (non-blocking).** The mock is simpler than the one in `up.integration.test.ts`: it does not track `mockCalls`, does not handle `devcontainer build`, and does not write lock files. This is appropriate for the smoke tests, which use `skipDevcontainerUp: true` and do not test prebuild or devcontainer up phases. The metadata fetch handler returns `exitCode: 1` (feature not found), which is correct for configs that do not declare OCI features.

### Section 1: Workspace detection tests (lines 189-287)

**F6 (non-blocking, positive).** All seven detection tests follow a consistent pattern: create fixture, call `classifyWorkspace()`, assert on `classification.type` and relevant sub-fields. The type narrowing via `if (result.classification.type === "worktree")` before accessing `bareRepoRoot` and `worktreeName` is type-safe and idiomatic.

**F7 (non-blocking).** The "classifies real bare-root" test (line 196) passes an empty worktree array `[]`, creating a bare repo with no worktrees. This correctly tests the `bare-root` classification path. The assertion `expect(result.classification.bareRepoRoot).toBe(resolve(repo.root))` uses `resolve()` to normalize the path, which matches how `classifyWorkspace()` resolves paths internally.

**F8 (non-blocking).** The "handles worktree with slashes in branch name" test (line 248) creates the worktree outside `createRealBareWorktreeRepo` because it needs a custom directory name (`feature-foo`) that differs from the branch name (`feature/foo`). This is the correct approach -- the helper's API maps worktree names to directory names, so a worktree with a different branch name cannot be expressed through the helper's API.

**F9 (non-blocking, positive).** The "handles detached HEAD worktree" test (line 269) uses `--detach` which creates a worktree with a raw SHA in `HEAD` instead of a symbolic ref. The test confirms that `classifyWorkspace()` is indifferent to `HEAD` format, which is the expected behavior since the detector reads `.git` file pointers and walks `worktrees/` directories, not worktree `HEAD` files.

### Section 2: Pipeline tests (lines 291-479)

**F10 (non-blocking, positive).** Each pipeline test creates its own fixture subdirectory within `fixtureRoot` (e.g., `pipeline-worktree`, `pipeline-bare-root`) and its own `cacheDir`, preventing cross-test contamination. This follows the proposal's "each test creates its own named subdirectory" design.

**F11 (non-blocking).** The `workspaceMount` assertion (line 328-330) verifies the full mount string format including `consistency=delegated`. This is a precise assertion that would catch format regressions. The `workspaceFolder` assertion checks for `/workspace/main` (worktree) vs. `/workspace` (bare-root), matching the `applyWorkspaceLayout()` logic.

**F12 (non-blocking).** The "injects safe.directory into postCreateCommand" test (line 369) uses `toContain("safe.directory")` rather than asserting the exact command string. This is slightly loose but acceptable -- the exact command is unit-tested in `workspace-layout.test.ts`.

**F13 (non-blocking).** The "injects scanDepth into VS Code settings" test (line 404) navigates the nested `customizations.vscode.settings` structure with a cast. The assertion `expect(vscodeSettings?.["git.repositoryScanMaxDepth"]).toBe(2)` checks the correct default value from `WorkspaceConfig.postCreate.scanDepth`.

**F14 (non-blocking).** The "respects custom mountTarget" test (line 442) asserts both `toContain("target=/src,")` on the mount string and `toBe("/src/main")` on the workspace folder. The trailing comma in `"target=/src,"` ensures the assertion does not match a false positive like `target=/src-other`.

### Section 3: Combined E2E tests (lines 483-648)

**F15 (non-blocking, positive).** The "full happy path" test (line 484) creates a real file for `validate.fileExists` and a real directory for the bind mount source, then verifies all three pipeline phases succeed (`workspaceLayout`, `hostValidation`, `generateConfig`). This exercises the full Phase 0a -> 0b -> config generation path against real git structures, which is the core value proposition of the combined E2E section.

**F16 (non-blocking, observation).** The happy path test creates validation artifacts (`e2e-happy-key.pub`, `e2e-happy-data/`) as siblings of the bare-worktree repo in `fixtureRoot`, not inside the worktree. This is correct since `validate.fileExists` checks host-side paths that are independent of the workspace structure.

**F17 (non-blocking, positive).** The "validation failure halts pipeline" test (line 546) makes strong assertions about phase ordering: `workspaceLayout?.exitCode === 0` (Phase 0a succeeded), `hostValidation?.exitCode === 1` (Phase 0b failed), `generateConfig` is `undefined` (pipeline halted before Phase 1). This precisely matches the proposal's specification and would catch regressions in the pipeline's early-exit logic.

**F18 (non-blocking).** The "skip-validation allows pipeline to continue" test (line 594) asserts `result.phases.hostValidation?.message` contains `"warning"`. Cross-referencing with `up.ts` line 183, the message format is `"Passed with N warning(s)"` when `skipValidation` downgrades errors to warnings, so `.toContain("warning")` is correct. The test also verifies that the pipeline continues to completion (`generateConfig` is defined, generated config has correct `workspaceFolder`).

### Imports and dependencies

**F19 (non-blocking, observation).** The test imports `checkAbsolutePaths` from `@/lib/workspace-detector` but never uses it. This is a dead import.

## Assertion Thoroughness

The assertions are thorough and correct. Key patterns:

- **Type narrowing before accessing union fields:** All tests that check `classification.bareRepoRoot` or `worktreeName` first narrow the type with an `if` guard (e.g., lines 204, 217, 241, 263, 283). This is type-safe.
- **Pipeline phase checks:** Tests verify both `exitCode` and structural properties (`workspaceMount`, `workspaceFolder`, `postCreateCommand`, VS Code settings) of the generated config.
- **E2E phase ordering:** The combined tests verify which phases are present/absent, confirming the pipeline's early-exit behavior.
- **Path normalization:** `resolve()` is used when comparing paths to avoid mismatches from relative vs. absolute path representations.

## Bugs

No bugs found. All 15 tests pass. The fixture helpers produce valid git structures, the mock subprocess handles the test scenarios correctly, and the assertions match the production code's behavior.

## Verdict

**Accept.**

The implementation faithfully delivers all 15 tests from the accepted proposal. The fixture helpers use real git operations, the `KEEP_FIXTURES` lifecycle works correctly, the git availability gate follows established patterns, and assertions are thorough. The dead import of `checkAbsolutePaths` is the only cleanup item. The implicit coverage of absolute gitdir paths (via git's natural behavior when `worktree add` is invoked from the bare directory) is sufficient given that the detector already has dedicated unit tests for this code path.

## Action Items

1. [non-blocking] Remove the unused `checkAbsolutePaths` import on line 28. It is imported but never referenced in any test.
2. [non-blocking] Consider adding a brief inline comment in `createRealBareWorktreeRepo` noting that `git -C "${bareDir}" worktree add` produces absolute gitdir paths in worktree `.git` files, which is the expected behavior on this platform and implicitly exercises the `absolute-gitdir` warning path. This helps future readers understand why the pipeline tests emit `absolute-gitdir` warnings in their stderr output.
