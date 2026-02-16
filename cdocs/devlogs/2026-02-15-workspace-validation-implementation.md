---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T21:17:00-08:00
task_list: lace/workspace-validation
type: devlog
state: live
status: complete
tags: [validation, worktree, workspaceMount, workspaceFolder, implementation]
---

# Devlog: Workspace Validation & Layout Implementation

## Objective

Implement the accepted proposal at `cdocs/proposals/2026-02-15-workspace-validation-and-layout.md`. This adds:
1. Workspace layout detection and auto-configuration (`customizations.lace.workspace`)
2. Host-side precondition validation (`customizations.lace.validate`)
3. Inferred mount validation (automatic bind-mount source checks)
4. Application to lace's own devcontainer

## Plan

1. **Phase 1**: Workspace detection + auto-generation (workspace-detector.ts, workspace-layout.ts, tests, up.ts integration)
2. **Review Phase 1**: Code review subagent
3. **Phase 2**: Host validation framework (host-validator.ts, tests, --skip-validation CLI, up.ts integration)
4. **Review Phase 2**: Code review subagent
5. **Phase 3**: Inferred mount validation + README docs
6. **Phase 4**: Apply to lace's own devcontainer
7. **Final review**: Legacy cleanup, E2E verification against lace devcontainer
8. **Executive report**: Final state summary

## Testing Approach

- TDD: unit tests for detector, layout, and validator modules
- Integration tests via `runUp()` with mock subprocess
- CLI smoke tests with canned bare-repo filesystem layouts
- E2E verification against lace's own devcontainer

## Baseline

- 594 tests passing across 23 files (verified before implementation)
- Branch: `wtmounts`

## Implementation Notes

### Phase 1: Workspace detection + auto-generation

Created two new modules:

**`workspace-detector.ts`** — Filesystem-only git layout classification. Parses `.git` file contents to detect the nikitabobko bare-worktree convention (`.bare/` + sibling worktrees). Returns a discriminated union: `worktree | bare-root | normal-clone | standard-bare | not-git | malformed`. Emits warnings for absolute gitdir pointers (portability concern).

**`workspace-layout.ts`** — Config auto-generation. Reads `customizations.lace.workspace`, validates against detected layout, and mutates config with `workspaceMount`, `workspaceFolder`, `postCreateCommand` (safe.directory), and VS Code `git.repositoryScanMaxDepth`. Respects user-set overrides — never clobbers existing values.

**Key decisions:**
- Filesystem-only detection (no git binary dependency) for portability
- Phase 0a insertion: mutations happen BEFORE `structuredClone` in up.ts so they propagate through the pipeline
- `WorkspaceLayoutResult.status` uses a typed union (`"skipped" | "applied" | "error"`) not string matching
- Helpers (`mergePostCreateCommand`, `mergeVscodeSettings`) exported for direct unit testing

**Test count:** 594 → 643 (+49 new tests: 16 detector, 29 layout, 4 integration)

**Commit:** `832d005`

**Review:** PASS — no blocking issues, 5 non-blocking observations

### Phase 2: Host validation framework

**`host-validator.ts`** — Host-side precondition validation. Reads `customizations.lace.validate.fileExists` array, expands `~` via `os.homedir()`, checks existence with `existsSync` (follows symlinks). Returns structured results with pass/fail per check and an overall status.

**Key decisions:**
- Tilde expansion uses `os.homedir()` not environment variable (more portable)
- `--skip-validation` CLI flag downgrades errors to warnings (follows existing `--skip-metadata-validation` pattern)
- Phase 0b insertion in up.ts, after Phase 0a
- Flexible input format: accepts either `{ path, severity, hint }` objects or bare `string` paths

**Test count:** 643 → 670 (+27 new tests: 23 unit, 4 integration)

**Commit:** `a89eb8a`

**Review:** PASS — 3 non-blocking (no localEnv expansion, no mixed error+warn test, passed checks carry hint data)

### Phase 3: Inferred mount validation + docs

Added post-template-resolution mount validation: after all `${lace.*}` templates are resolved, scans resolved bind mounts for missing host-side source directories. Also checks resolved `workspaceMount` source path.

Added documentation to `README.md` covering the workspace layout schema, validate schema, `--skip-validation` flag, and inferred mount validation behavior.

**Test count:** 670 → 675 (+5 integration tests)

**Commit:** `afbafa6`

### Phase 4: Apply to lace devcontainer

Applied both features to lace's own `.devcontainer/devcontainer.json`:
- Added `workspace` block: `{ "layout": "bare-worktree", "mountTarget": "/workspace" }`
- Added `validate` block: `{ "fileExists": [{ "path": "~/.ssh/lace_devcontainer.pub", ... }] }`
- Commented out manual `workspaceMount`, `workspaceFolder`, `postCreateCommand` with explanation for contributors without lace

**Commit:** `8f86629`

### Final cleanup

Code review found 3 non-blocking issues; 2 addressed:
1. Removed unused `import type { WorkspaceConfig }` from workspace-layout.test.ts
2. Changed misleading `// ── Private Helpers ──` to `// ── Helpers (exported for testing) ──`
3. Pre-existing unused imports in up.ts (readFileSync, jsonc) left untouched — not from this branch

**Commit:** `04fbb00`

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/workspace-detector.ts` | NEW — Git workspace classification (270 lines) |
| `packages/lace/src/lib/workspace-layout.ts` | NEW — Config auto-generation from workspace layout (249 lines) |
| `packages/lace/src/lib/host-validator.ts` | NEW — Host-side precondition validation |
| `packages/lace/src/lib/__tests__/workspace-detector.test.ts` | NEW — 16 unit tests |
| `packages/lace/src/lib/__tests__/workspace-layout.test.ts` | NEW — 29 unit tests |
| `packages/lace/src/lib/__tests__/host-validator.test.ts` | NEW — 23 unit tests |
| `packages/lace/src/__tests__/helpers/scenario-utils.ts` | Added createBareRepoWorkspace + createNormalCloneWorkspace |
| `packages/lace/src/lib/up.ts` | Phase 0a/0b insertion + inferred mount validation |
| `packages/lace/src/commands/up.ts` | --skip-validation flag |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | 13 integration tests |
| `packages/lace/README.md` | Documentation for workspace + validate schemas |
| `.devcontainer/devcontainer.json` | Self-hosting: workspace + validate blocks |
| `cdocs/devlogs/2026-02-15-workspace-validation-implementation.md` | This devlog |

## Verification

### Build & Lint

```
TypeScript compiles cleanly (tsc --noEmit: 0 errors)
```

### Tests

```
Test Files  26 passed (26)
     Tests  675 passed (675)
  Start at  21:48:21
  Duration  22.93s
```

Test growth: 594 (baseline) → 643 (Phase 1) → 670 (Phase 2) → 675 (Phase 3) = **81 new tests**

### E2E Verification

**CLI smoke test against real repo:**
- `lace up` against `/var/home/mjr/code/weft/lace` correctly returns error: "bare-worktree declared but workspace is a normal git clone" — expected, since the actual repo is a normal clone (devcontainer.json is designed for when opened from a worktree)

**Canned bare-repo scenarios (2/2 pass):**
- Workspace layout detection: correctly generates workspaceMount + workspaceFolder for bare-worktree
- Multi-worktree: correctly resolves worktree name and bare-repo root

**Host validation scenarios (3/3 pass):**
- Missing file fails with error severity
- Existing file passes
- `--skip-validation` downgrades errors to warnings

**Legacy check:** No orphaned code paths, no backwards-compat shims, all new code reachable via up.ts pipeline.
