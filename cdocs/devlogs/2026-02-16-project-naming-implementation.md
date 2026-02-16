---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T19:00:00-06:00
task_list: worktrunk/project-naming
type: devlog
state: live
status: review_ready
tags: [worktrunk, naming, lace-discover, wez-into, docker, implementation]
---

# Project Naming Implementation: Devlog

## Objective

Implement the worktrunk-aware project naming proposal at
`cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md`.

Three components:
1. `deriveProjectName()` + `sanitizeContainerName()` — pure name derivation
2. Label + `--name` injection in `lace up` pipeline
3. Discovery update in `lace-discover` and `wez-into`

## Plan

1. Phase 1: Create `project-name.ts` with name derivation + sanitization + tests
2. Phase 2: Thread project name through `up.ts`, extend `WorkspaceLayoutResult`, inject `runArgs`
3. Phase 3: Update `lace-discover` and `wez-into` bash scripts for label-based naming
4. Phase 4: End-to-end verification

Each phase: implement → test → commit → `/review` subagent → apply feedback → proceed.

## Testing Approach

- Unit tests for all pure functions (vitest, matching existing patterns)
- Integration tests for `runUp()` pipeline using mock subprocess pattern from `up-mount.integration.test.ts`
- Manual verification of bash script changes (no formal harness for bash)
- Full test suite regression check after each phase

## Implementation Notes

### Phase 1: project-name.ts

Created `packages/lace/src/lib/project-name.ts` with three pure functions:
- `deriveProjectName()`: uses `basename(bareRepoRoot)` for worktree/bare-root, `basename(workspacePath)` for everything else
- `sanitizeContainerName()`: Docker name compliance via regex replacement
- `hasRunArgsFlag()`: detects `--flag` and `--flag=` forms without prefix collisions

25 unit tests covering all `WorkspaceClassification` variants, sanitization edge cases, and flag detection forms.

Review: Accepted (Phase 1 review at `cdocs/reviews/2026-02-16-review-of-project-name-phase1.md`).

### Phase 2: Pipeline integration

- Extended `WorkspaceLayoutResult` with `classification?: WorkspaceClassification` field
- Threaded `projectName` through `runUp()` → `generateExtendedConfig()`
- Added runArgs injection: `--label lace.project_name=<raw>` + `--name <sanitized>` (respects user `--name`)
- 6 integration tests + 3 classification threading tests

Review: Accepted (Phase 2 review at `cdocs/reviews/2026-02-16-review-of-rfp-worktrunk-project-naming-phase2.md`).

### Phase 3: Discovery scripts

- `lace-discover`: Added `lace.project_name` label to `discover_raw()` format, updated `discover_projects()` to use label with basename fallback
- `wez-into`: Updated `discover_stopped()` with same pattern

Review: Accepted (Phase 3 review at `cdocs/reviews/2026-02-16-review-of-rfp-worktrunk-project-naming-phase3.md`).

### Phase 4: End-to-end verification

Pre-verification checklist:
- All 724 tests pass (29 test files)
- Build succeeds (vite)
- TypeScript typecheck passes (tsc --noEmit)
- Bash syntax check passes for both scripts

Final review: Accepted (full changeset review at `cdocs/reviews/2026-02-16-review-of-rfp-worktrunk-project-naming.md`).

> NOTE: Live end-to-end verification (container rebuild, `lace-discover` output, `wez-into` connection) deferred to user — requires rebuilding the devcontainer with the new code.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/project-name.ts` | New module: deriveProjectName, sanitizeContainerName, hasRunArgsFlag |
| `packages/lace/src/lib/__tests__/project-name.test.ts` | 25 unit tests for project-name.ts |
| `packages/lace/src/lib/workspace-layout.ts` | Extended WorkspaceLayoutResult with classification field |
| `packages/lace/src/lib/__tests__/workspace-layout.test.ts` | 3 classification threading tests added |
| `packages/lace/src/lib/up.ts` | Thread project name, inject runArgs in generateExtendedConfig |
| `packages/lace/src/lib/__tests__/up-project-name.integration.test.ts` | 6 integration tests for runArgs injection |
| `bin/lace-discover` | Label-based project name with basename fallback |
| `bin/wez-into` | Label-based project name with basename fallback in discover_stopped |

## Verification

**Build & Lint:**
```
> lace@0.1.0 build
> vite build && chmod +x dist/index.js
✓ 30 modules transformed.
dist/index.js  114.61 kB │ gzip: 25.31 kB │ map: 282.85 kB
✓ built in 185ms

> lace@0.1.0 typecheck
> tsc --noEmit
(clean)
```

**Tests:**
```
Test Files  29 passed (29)
     Tests  724 passed (724)
```

**Bash syntax:**
```
lace-discover: syntax OK
wez-into: syntax OK
```
