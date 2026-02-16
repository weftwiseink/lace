---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T23:55:00-08:00
task_list: lace/workspace-validation
type: devlog
state: live
status: complete
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

1. **Phase 1+2**: Write all 15 tests in a single file (detection, pipeline, E2E)
2. **Phase 3**: Subagent review + cleanup

## Testing Approach

This **is** a test implementation — the deliverable is the test file itself. Verification is:
- All 15 smoke tests pass against real git-produced structures
- Full suite (675 + 15 new = 690) passes
- `LACE_TEST_KEEP_FIXTURES=1` preserves fixtures
- Without env var, fixtures are cleaned up

## Implementation Notes

### Bare repo initialization requires git plumbing

`git commit --allow-empty` doesn't work in a bare repo ("this operation must be run in a work tree"). Fixed by using git plumbing commands:
```typescript
const emptyTree = execSync(`git -C "${bareDir}" hash-object -t tree --stdin`, { input: "" }).toString().trim();
const commit = execSync(`git -C "${bareDir}" commit-tree ${emptyTree} -m "initial commit"`, { ... }).toString().trim();
execSync(`git -C "${bareDir}" update-ref refs/heads/main ${commit}`);
```

### Default branch must be set explicitly

`git init --bare` creates HEAD pointing to `refs/heads/master`. Since the initial commit is created on `refs/heads/main`, HEAD must be updated:
```typescript
execSync(`git -C "${bareDir}" symbolic-ref HEAD refs/heads/main`);
```

### Worktree add: existing vs new branches

`git worktree add -b main <dir>` fails because `main` already exists from the initial commit. The fix:
- For `main`: `git worktree add <dir> main` (checks out existing branch)
- For others: `git worktree add -b <name> <dir> main` (creates new branch based on main)

### Absolute gitdir paths from real git

`git worktree add` from a bare directory produces absolute gitdir paths in the `.git` pointer files. This implicitly exercises the `absolute-gitdir` warning path in `classifyWorkspace()` — a beneficial side effect of using real git operations vs fabricated stubs.

### GIT_AUTHOR/COMMITTER env vars

Set explicitly in `execSync` calls to prevent failures in environments without global git config (CI, containers).

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/__tests__/workspace_smoke.test.ts` | NEW — 15 smoke tests against real git repos |
| `cdocs/proposals/2026-02-15-workspace-smoke-tests.md` | Status: `review_ready` → `implementation_wip` |
| `cdocs/devlogs/2026-02-15-workspace-smoke-tests.md` | This devlog |
| `cdocs/reviews/2026-02-15-review-of-workspace-smoke-tests-implementation.md` | Implementation review (accepted) |

## Verification

### Tests

```
 Test Files  27 passed (27)
      Tests  690 passed (690)
   Start at  22:28:19
   Duration  22.87s
```

Test growth: 675 (baseline) → 690 (+15 smoke tests)

### Smoke test timing

```
 ✓ src/__tests__/workspace_smoke.test.ts (15 tests) 840ms
```

Well under the 10-second acceptance criterion.

### KEEP_FIXTURES

```bash
$ LACE_TEST_KEEP_FIXTURES=1 npx vitest run src/__tests__/workspace_smoke.test.ts
# Output: LACE_TEST_KEEP_FIXTURES=1 — fixtures at: /tmp/lace-smoke-workspace-0GBRDB
$ ls /tmp/lace-smoke-workspace-0GBRDB/
bare-root-test  detached-head  e2e-fail  e2e-happy  ...  worktree-test
```

Without the env var, fixtures are automatically cleaned up (verified by confirming temp dirs don't persist after a normal run).

### Review

Subagent review verdict: **Accept** — 2 non-blocking items addressed (removed unused `checkAbsolutePaths` and `existsSync` imports).
