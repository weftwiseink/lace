---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-20T13:36:00-07:00
task_list: devcontainer/workspace-path-migration
type: devlog
state: archived
status: done
tags: [devcontainer, workspace_paths, migration]
---

# Workspace Path Migration: Devlog

## Objective

Implement `cdocs/proposals/2026-03-20-devcontainer-workspace-path-migration.md`.
Migrate the container workspace root from `/workspace/lace` to `/workspaces/lace` and eliminate the Dockerfile's `COPY . .` to fix stale-file shadowing that causes Claude Code "external imports" warnings on startup.

## Plan

Per the proposal's four phases:

1. **Dockerfile changes**: isolate build deps to `/build`, remove `COPY . .`, set runtime WORKDIR to `/workspaces/lace`.
2. **Source default migration**: update `workspace-layout.ts` fallback defaults, update all test assertions.
3. **Config and documentation**: update `devcontainer.json` mountTarget and fallback comments, update docs.
4. **Verification**: `lace up`, rebuild container, verify no stale files, tests pass.

## Testing Approach

Run `pnpm test` in `packages/lace/` after source changes.
Rebuild the actual container and verify inside it for end-to-end validation.

## Implementation Notes

> NOTE(opus/workspace-path-migration): The proposal specifies changing workspace-layout.ts defaults from `"/workspace"` to `"/workspaces/lace"`.
> The generic default should be `"/workspaces"` (not project-specific), since `mountTarget` in devcontainer.json provides the full path.
> This project explicitly sets `mountTarget: "/workspaces/lace"` in devcontainer.json, so the result is the same for this project.
> Deviation: using `"/workspaces"` as the generic default instead of `"/workspaces/lace"`.

## Changes Made

| File | Description |
|------|-------------|
| `.devcontainer/Dockerfile` | Isolated build deps to `/build`, removed `COPY . .`, set WORKDIR to `/workspaces` |
| `packages/lace/src/lib/workspace-layout.ts` | Changed default mountTarget from `"/workspace"` to `"/workspaces"` (lines 11, 64, 95) |
| `.devcontainer/devcontainer.json` | Changed mountTarget to `/workspaces/lace`, updated fallback comments |
| `packages/lace/README.md` | Updated workspace path examples and default documentation |
| `packages/lace/docs/migration.md` | Updated example workspace paths |
| `packages/lace/src/lib/__tests__/workspace-layout.test.ts` | Updated 6 assertions for new default path |
| `packages/lace/src/__tests__/workspace_smoke.test.ts` | Updated 5 assertions for new default path |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Updated 2 assertions for new default path |

## Verification

**Tests (928/928 pass):**
```
 Test Files  34 passed (34)
      Tests  928 passed (928)
   Duration  31.08s
```

**Container verification after `lace up --rebuild`:**
```
=== /workspaces/lace/main exists ===
-rw-r--r--. 1 node node 109 Mar 19 08:49 /workspaces/lace/main/CLAUDE.md

=== NO stale files at /workspaces/ root ===
ls: cannot access '/workspaces/CLAUDE.md': No such file or directory

=== NO stale files at /workspace/ ===
ls: cannot access '/workspace/': No such file or directory

=== clauthier mount ===
AGENTS.md  README.md  agents  hooks  rules  scripts  skills

=== clauthier symlink ===
/var/home/mjr/code/weft/clauthier/main

=== pnpm works ===
10.28.1
```

**pnpm install inside container:**
```
Packages: +144
Done in 2.7s using pnpm v10.28.1
```

All verification checks pass:
- Live bind mount at `/workspaces/lace/main` contains expected files.
- No stale CLAUDE.md or .claude/rules at `/workspaces/` root (the shadowing problem is eliminated).
- `/workspace/` directory does not exist at all.
- Clauthier repoMount and symlink from previous session still work.
- pnpm installs and runs correctly in the new workspace path.
