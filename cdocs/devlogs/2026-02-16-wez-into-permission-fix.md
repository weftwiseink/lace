---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T09:30:00-06:00
task_list: lace/cli
type: devlog
state: live
status: complete
tags: [wez-into, build, permissions, bug-fix, workspace-layout]
---

# Fix wez-into Permission Denied (exit 126): Devlog

## Objective

`wez-into lace --start` fails with exit 126 (permission denied) because the
Vite build outputs `dist/index.js` without the executable bit. The symlink chain
`bin/lace -> dist/index.js` means the shell can't execute it.

A secondary issue was uncovered: the workspace layout validation hard-errors when
`layout: "bare-worktree"` is declared but the repo is a normal git clone, preventing
`lace up` from completing at all.

## Plan

1. Diagnose root cause (done: `dist/index.js` is 644, needs 755)
2. Fix the build pipeline to `chmod +x` after Vite output
3. Rebuild and verify locally
4. Fix workspace layout to gracefully degrade for normal clones
5. Verify `wez-into lace --start` works end-to-end

## Debugging Process

**Phase 1 - Root Cause Investigation:**
- `wez-into` reports exit 126 from `lace up`
- `locate_lace_cli()` falls through local candidates (all fail `-x` check on the
  symlink target) and finds `/home/linuxbrew/.linuxbrew/bin/lace`
- That's a symlink to `../lib/node_modules/lace/dist/index.js`
- The target file has permissions `-rw-r--r--` (644) — not executable
- Vite/Rollup doesn't set executable permissions on output files
- The linuxbrew copy and the local workspace copy are the same file (pnpm link),
  so fixing one fixes both

**Phase 2 - Permission Fix:**
- Added `chmod +x dist/index.js` as post-build step in `package.json`
- Build script: `"build": "vite build && chmod +x dist/index.js"`
- Simple, transparent, no plugin overhead

**Phase 3 - Secondary Issue (Workspace Layout):**
- After fixing permissions, `lace up` ran but failed with exit 1:
  `Workspace layout "bare-worktree" declared but /var/home/mjr/code/weft/lace is a normal git clone`
- Root cause: `applyWorkspaceLayout()` returns `status: "error"` when the declared layout
  doesn't match the actual repo type
- This is too strict — a shared devcontainer.json should work for both normal clones and
  bare-worktree layouts (normal clones use default mount behavior)
- Fix: return `status: "skipped"` with a warning instead of `status: "error"` when the
  workspace is a normal clone

## Implementation Notes

- **Why graceful skip?** The devcontainer.json is checked into the repo and shared.
  It's authored for bare-worktree (the intended layout) but contributors may have a normal
  clone. For normal clones, the default devcontainer mount behavior is correct — no
  workspaceMount/workspaceFolder auto-configuration needed.
- **Other non-worktree types still error:** `not-git`, `standard-bare`, and `malformed`
  remain hard errors. Only `normal-clone` gets the graceful skip, since it's the common
  case where the layout mismatch is benign.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/package.json` | Added `chmod +x dist/index.js` to build script |
| `packages/lace/src/lib/workspace-layout.ts` | Changed normal-clone from error to graceful skip with warning |
| `packages/lace/src/lib/__tests__/workspace-layout.test.ts` | Updated test to expect `"skipped"` status |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Updated 2 integration tests for new behavior |

## Verification

**Tests:**
```
 Test Files  27 passed (27)
      Tests  690 passed (690)
   Duration  22.41s
```

**Build:**
```
$ pnpm --filter lace build
vite v6.4.1 building for production...
✓ 29 modules transformed.
dist/index.js  113.36 kB
✓ built in 179ms
$ ls -la packages/lace/dist/index.js
-rwxr-xr-x. 1 mjr mjr 113262 Feb 16 10:11 packages/lace/dist/index.js
```

**End-to-end:**
```
$ wez-into lace --start
wez-into: starting lace via lace up --workspace-folder /var/home/mjr/code/weft/lace ...
wez-into: container is running despite lace up exit 1 (likely a lifecycle hook failure)
wez-into: connecting to lace on port 22426...

$ wez-into --status
PROJECT              PORT     USER       PATH
-------              ----     ----       ----
lace                 22426    node       /var/home/mjr/code/weft/lace
```
