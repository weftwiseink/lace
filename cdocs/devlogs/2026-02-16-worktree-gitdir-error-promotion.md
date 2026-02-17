---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T00:00:00-05:00
task_list: lace/workspace-validation
type: devlog
state: final
status: complete
tags: [workspace-detection, error-handling, worktree]
---

# Promote worktree absolute gitdir warning to error: Devlog

## Objective

The `lace up` command currently emits a **warning** when worktree `.git` files use
absolute gitdir paths. These absolute paths will not resolve inside the container,
making the devcontainer non-functional. This should be a hard **error** that stops
`lace up` rather than a warning the user might miss.

## Plan

1. In `workspace-layout.ts:applyWorkspaceLayout`, after collecting warnings from
   `classifyWorkspace`, check if any have `code === "absolute-gitdir"`.
2. If found, return `status: "error"` with a clear message listing the affected
   worktrees and remediation steps.
3. The existing `up.ts` code already handles `status === "error"` correctly —
   returns `exitCode: 1` unless `--skip-validation` is set.
4. Add tests to `workspace-layout.test.ts` covering the new error path.
5. Existing tests use `useAbsolutePaths: false` by default, so they remain green.

## Testing Approach

Unit tests in `workspace-layout.test.ts` for the new error case. Run full test suite
to verify no regressions.

## Implementation Notes

The change is minimal and well-contained:
- `workspace-detector.ts` — no changes needed. It already classifies correctly.
- `workspace-layout.ts` — check `result.warnings` for `absolute-gitdir` codes before
  proceeding with layout application. Return error status.
- `up.ts` — no changes needed. Already handles `status === "error"` with exit code 1,
  and `--skip-validation` downgrades errors to warnings.

The `--skip-validation` escape hatch means users can still proceed if they know what
they're doing (e.g., non-worktree-aware container setups).

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/workspace-layout.ts` | Promote absolute-gitdir warnings to error status |
| `packages/lace/src/lib/__tests__/workspace-layout.test.ts` | Add tests for error on absolute gitdir paths |

## Verification

**Tests:**
```
 Test Files  29 passed (29)
      Tests  726 passed (726)
   Duration  22.17s
```

All 726 tests pass, including:
- 2 new tests for the error promotion (absolute gitdir → error, relative → success)
- 15 smoke tests using real `git worktree add`
- 4 workspace layout integration tests
- 6 project-name integration tests
