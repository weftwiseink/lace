---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T20:00:00-08:00
task_list: lace/claude-code-feature
type: devlog
state: archived
status: done
tags: [claude-code, testing, scenario-tests, devcontainer-features]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-04T12:00:00-08:00
  round: 1
---

# Claude Code Feature Tests Implementation

## Objective

Implement the claude-code feature test, verification, and documentation plan as specified in the proposal at `cdocs/proposals/2026-03-03-claude-code-feature-test-verification-plan.md`. This includes:
- Unit tests for metadata extraction of the real claude-code `devcontainer-feature.json`
- Eight scenario tests (C1-C8) covering mount auto-injection, settings overrides, validated mount resolution, Docker smoke test, multi-feature coexistence, version pinning, prebuild features, and mount suppression
- Documentation updates to the root README
- Full test suite verification

## Plan

### Phase 1: Unit Tests for Metadata Extraction
Add tests to `packages/lace/src/lib/__tests__/feature-metadata.test.ts` that read the real claude-code feature metadata and verify `extractLaceCustomizations()` returns the correct mount declaration with `sourceMustBe: "directory"` and no port declarations.

### Phase 2: Scenario Test File
Create `packages/lace/src/__tests__/claude-code-scenarios.test.ts` with scenarios C1-C8, following the patterns from `wezterm-server-scenarios.test.ts` and `portless-scenarios.test.ts`.

### Phase 3: Documentation
Add claude-code to the root README features table.

### Phase 4: Full Verification
Run the complete test suite and build. Paste output into this devlog.

## Testing Approach

Each scenario is written incrementally -- write one, run tests, fix, commit, then move to the next. This prevents cascading failures and makes debugging tractable.

The claude-code feature is mount-only (no ports), which exercises a different code path than wezterm-server (ports + mounts) or portless (ports only). Key aspects to test:
- `sourceMustBe: "directory"` validation
- `recommendedSource` expansion via `~/.claude`
- `_REMOTE_USER` variable passthrough (opaque to lace)
- Mount-only auto-injection without port allocation

## Implementation Notes

### Phase 1: Unit tests
Added `readRealFeatureMetadata()` helper that reads actual `devcontainer-feature.json` files from `devcontainers/features/src/`. Added four test cases for claude-code:
- Mount declaration with sourceMustBe extraction
- No port declarations verification
- Feature id and version verification
- Version option default "latest" verification

All used `extractLaceCustomizations()` with the real feature metadata, confirming the actual JSON file matches expected structure.

### Phase 2: Scenario tests
Created `packages/lace/src/__tests__/claude-code-scenarios.test.ts` with 8 scenarios.

**C1-C3** (mount basics): Auto-injection, settings override, and sourceMustBe validation. C3 isolation was achieved by pointing settings override to a nonexistent directory, avoiding dependency on host `~/.claude`.

**C4** (Docker smoke): Initially failed when using `mcr.microsoft.com/devcontainers/base:ubuntu` + `ghcr.io/devcontainers/features/node:1` because the devcontainer CLI installed features in an order that put claude-code before node (npm unavailable). Fixed by switching to `node:24-bookworm` base image which has npm preinstalled.

**C5** (multi-feature): Combined claude-code (mount-only) with wezterm-server (ports + mounts). Verified both mount and port entries present without interference.

**C6** (version pinning): Verified user-specified version option passes through lace untouched.

**C7** (prebuild): Used `createMockSubprocess()` pattern from portless-scenarios. Verified mount auto-injection works for prebuild features.

**C8** (suppression): Verified explicit `${lace.mount(claude-code/config)}` in user's mounts array prevents duplicate auto-injection.

### Phase 3: Documentation
Added claude-code to root README features table and project structure tree (alphabetically after neovim which was added by another agent on a parallel branch).

## Changes Made

### Files modified
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts` -- Added `readRealFeatureMetadata()` helper and 4 claude-code metadata unit tests
- `README.md` -- Added claude-code to features table and project structure

### Files created
- `packages/lace/src/__tests__/claude-code-scenarios.test.ts` -- 8 scenario tests (C1-C8)
- `cdocs/devlogs/2026-03-03-claude-code-feature-tests-implementation.md` -- This devlog

### Commits
1. `chore: begin claude-code feature test implementation` -- Proposal status update, devlog creation
2. `test: add unit tests for claude-code feature metadata extraction` -- Phase 1 (4 unit tests)
3. `test: add claude-code scenarios C1-C3` -- Mount auto-injection, settings override, sourceMustBe validation
4. `test: add claude-code scenario C4 Docker smoke test` -- Docker integration (gated by isDockerAvailable)
5. `test: add claude-code scenarios C5-C6` -- Multi-feature coexistence, version pinning
6. `test: add claude-code scenarios C7-C8` -- Prebuild features, mount suppression
7. `docs: add claude-code to root README features table` -- Documentation update

## Verification

### Build
```
pnpm --filter lace build
vite v6.4.1 building for production...
transforming...
30 modules transformed.
dist/index.js  125.28 kB
built in 173ms
```

### Test Suite
```
Test Files  32 passed (32)
     Tests  812 passed (812)
  Start at  18:08:07
  Duration  26.98s
```

### New tests added

**Unit tests** (in `feature-metadata.test.ts`):
- `claude-code feature metadata > extracts mount declaration with sourceMustBe from real feature metadata`
- `claude-code feature metadata > has no port declarations`
- `claude-code feature metadata > has the expected feature id and version`
- `claude-code feature metadata > declares a version option with default 'latest'`

**Scenario tests** (in `claude-code-scenarios.test.ts`):
- `Scenario C1: mount auto-injection from feature metadata > auto-injects mount template for claude-code/config into mounts array`
- `Scenario C2: mount resolution with settings override > uses settings override source instead of recommendedSource`
- `Scenario C3: sourceMustBe validation rejects missing source > fails when source directory does not exist and settings point to nonexistent path`
- `Scenario C4: Docker smoke test > builds container with claude CLI and .claude directory` (4637ms, Docker)
- `Scenario C5: claude-code + wezterm-server coexistence > generates config with both mount and port entries`
- `Scenario C6: version pinning passes through to feature options > version option is preserved in generated config`
- `Scenario C7: claude-code in prebuildFeatures > mount still auto-injected when feature is in prebuildFeatures`
- `Scenario C8: explicit mount entry suppresses auto-injection > user-written mount for claude-code/config prevents auto-injection duplicate`

All 12 new tests pass. Zero regressions in existing tests.
