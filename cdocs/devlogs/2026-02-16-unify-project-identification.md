---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T23:45:00-06:00
task_list: worktrunk/project-identification
type: devlog
state: live
status: review_ready
tags: [worktree, project-id, mounts, naming, deriveProjectId, implementation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-16T23:55:00-06:00
  round: 1
---

# Unify Project Identification: Devlog

## Objective

Implement the proposal at
`cdocs/proposals/2026-02-16-unify-worktree-project-identification.md`.

Make `deriveProjectId()` self-classifying so all lace subsystems use
worktree-aware project identification. Extract `sanitizeProjectId()` as a pure
helper. Add a module-level classification cache. Fix mount guidance UX.

## Plan

1. Phase 1: Self-classifying `deriveProjectId` + classification cache
2. Phase 2: Fix `projectName` fallback in `up.ts`
3. Phase 3: Mount persistence staleness detection
4. Phase 4: Update test assertions
5. Phase 5: Improve mount guidance UX

Each phase: implement → test → commit → `/review` subagent → apply feedback → proceed.

## Testing Approach

- Unit tests for pure functions (vitest, matching existing patterns)
- Integration tests using `createBareRepoWorkspace` fixture helper
- Full test suite regression check after each phase
- Build + typecheck verification before commits

## Implementation Notes

### Phase 1: Self-Classifying `deriveProjectId` + Classification Cache

- Added module-level `Map<string, ClassificationResult>` cache to `workspace-detector.ts`
- Extracted `classifyWorkspaceUncached()` as private helper, `classifyWorkspace()` checks cache first
- Exported `clearClassificationCache()` for test isolation
- Extracted `sanitizeProjectId()` as pure exported function from `repo-clones.ts`
- Rewrote `deriveProjectId()` to call `classifyWorkspace()` → `deriveProjectName()` → `sanitizeProjectId()`
- Fixed trailing-dash edge case: `sanitizeProjectId("my project!")` → `"my-project"` (not `"my-project-"`)
- Added 14 new tests: sanitizeProjectId (7), worktree awareness (4), cache (3)
- Updated one existing assertion for trailing-dash behavior change
- Commit: `256d323`

### Phase 2: Fix `projectName` Fallback in `up.ts`

- Replaced `basename(workspaceFolder)` fallback with `classifyWorkspace()` call
- When no `customizations.lace.workspace` config present, worktree workspaces now get correct project name
- Added integration test: worktree workspace WITHOUT layout config → projectName derived from bare-repo root
- Commit: `fe018c7`

### Phase 3: Mount Persistence Staleness Detection

- Added `isStaleDefaultPath()` private method to `MountPathResolver`
- Modified `load()` to detect and discard stale non-override assignments on load
- Staleness check: verifies `resolvedSource` contains `/<currentProjectId>/mounts/`
- Override assignments (user-configured paths) are never checked for staleness
- Added 3 tests: stale default discarded, override preserved, non-stale preserved
- Commit: `d95c5f6`

### Phase 4: Update Test Assertions

- Verified all existing tests pass without assertion changes (`not-git` classification falls back to `basename()`)
- Added `clearClassificationCache()` to `template-resolver.test.ts` and `up-mount.integration.test.ts` for cache isolation
- No assertion changes needed — all temp-dir tests use non-git directories which still fall back to basename
- Commit: `cabc2ee`

### Phase 5: Improve Mount Guidance UX

- Updated `emitMountGuidance` to check `existsSync(expandPath(recommendedSource))`
  - If recommended source exists on host: `→ <path> exists on host. Configure in settings.json to use it.`
  - If it doesn't exist: `→ Optional: configure source to <path> in settings.json`
- Settings hint block only shown when recommended sources don't actually exist on host
- Bind mount source warnings now include Docker auto-create context: `Docker will auto-create this as a root-owned directory, which may cause permission issues.`
- workspaceMount warnings distinguished with: `This is the workspace mount. The container may not function properly without it.`
- Added 6 tests for `emitMountGuidance` covering: empty assignments, all-overrides, override+default display, exists-on-host, not-exists, tilde expansion
- Updated 2 existing integration test assertions to verify new context messages
- Commit: `069e24a`

## Verification

### Final Test Suite
- 750 tests passing across 29 test files
- 6 new tests added in Phase 5 (750 - 744 = 6)
- `tsc --noEmit` clean — no type errors
- No test coverage reduction — all existing assertions preserved

### Commits
1. `256d323` — feat(project-id): make deriveProjectId self-classifying with classification cache
2. `fe018c7` — fix(up): use classifyWorkspace fallback for projectName when no layout config
3. `d95c5f6` — feat(mounts): add staleness detection for persisted mount assignments
4. `cabc2ee` — test: add clearClassificationCache to test beforeEach blocks
5. `069e24a` — feat(mounts): improve mount guidance UX with context-aware messaging

### No Deviations from Proposal
All phases implemented as specified. No design changes needed.
