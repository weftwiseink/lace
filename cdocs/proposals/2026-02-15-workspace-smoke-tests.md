---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T22:30:00-08:00
task_list: lace/workspace-validation
type: proposal
state: live
status: implemented
tags: [testing, smoke-test, workspace, validation, acceptance, e2e]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-15T22:30:00-08:00
  round: 3
---

# Workspace Validation Acceptance & Smoke Test Suite

> BLUF: Add `packages/lace/src/__tests__/workspace_smoke.test.ts` — a focused acceptance test suite that scaffolds **real** git bare-repo and normal-clone structures (via `git init --bare`, `git worktree add`, etc.), runs the full `runUp()` pipeline against them, and verifies workspace layout auto-generation end-to-end. Tests auto-cleanup by default but respect a `LACE_TEST_KEEP_FIXTURES=1` environment variable to preserve temp directories for manual inspection. The existing `createBareRepoWorkspace()` helper creates fake filesystem stubs; this suite uses real git operations to close the gap between unit tests and production. Host validation and mount validation are covered by a combined end-to-end scenario rather than standalone sections, since those features already test against real filesystem operations in their existing unit/integration tests.

> NOTE: R1 review removed standalone host validation (Section 3) and inferred mount validation (Section 4) sections — those duplicate existing tests in `host-validator.test.ts` and `up.integration.test.ts` which already use real filesystem operations. The combined scenario in Section 3 covers their integration with real git structures.

## Objective

The workspace validation feature has unit + integration tests that all use fabricated filesystem layouts (writing `.git` files and `.bare/` directories directly). While these are correct and useful, they diverge from reality in several ways:

1. **No real git objects** — The fake `.bare/` directories don't contain valid pack files, index, or config. Real git repos have additional metadata that could affect detection.
2. **No real worktree linkage** — `git worktree add` writes additional state (e.g., `worktrees/<name>/HEAD`, `worktrees/<name>/ORIG_HEAD`, lock files, config files) that the detector should tolerate. This includes `.bare/config` and other git-internal files that the current fabricated structures don't produce.
3. **Pipeline coverage gap** — Integration tests use `runUp()` with mock subprocess but the workspace detection + layout mutation is exercised against fake structures. A smoke test against real git structures confirms the full pipeline works against authentic inputs.

> NOTE: `classifyWorkspace()` does not currently read `.git/config` or `.bare/config`. The concern about additional git metadata files is about their presence alongside the files the detector does read (`.git` file, `.bare/worktrees/` directory), not about the detector parsing config files. This is a robustness concern, not a detection gap.

The goal is an acceptance test suite that exercises the workspace validation features against real git repos, confirming that the filesystem-only detection approach works with actual git-produced structures.

## Background

### Current test infrastructure

- **`scenario-utils.ts`** provides `createBareRepoWorkspace()` and `createNormalCloneWorkspace()` — these write `.git` files, `.bare/` directories, and worktree pointers directly, without git.
- **`workspace-detector.test.ts`** (16 tests) — unit tests against fake filesystem structures.
- **`workspace-layout.test.ts`** (29 tests) — unit tests for config generation and merge helpers.
- **`host-validator.test.ts`** (23 tests) — unit tests for file-existence checks (already uses real filesystem: `writeFileSync`, `symlinkSync`, `existsSync`).
- **`up.integration.test.ts`** (13 workspace/validation tests) — `runUp()` pipeline tests with mock subprocess and fake filesystem. Includes host validation, inferred mount validation, and skip-validation tests that already use real filesystem paths.

### Why real git repos matter

The `classifyWorkspace()` function reads `.git` file contents and walks the filesystem to find `.bare/worktrees/`. While the fake structures are a faithful reproduction of the nikitabobko convention, real git repos produced by `git init --bare` + `git worktree add` contain additional files and slightly different layouts (e.g., git may use absolute paths in some worktree configurations, writes additional metadata like `ORIG_HEAD` and lock files). Testing against real structures is the only way to confirm the detector handles all of this.

### What doesn't need re-testing

Host validation (`host-validator.ts`) already tests against real files, symlinks, and tilde expansion in its unit tests. Inferred mount validation already tests against real filesystem paths in `up.integration.test.ts`. These don't benefit from being re-tested in a smoke suite — the "real git" value proposition is specific to workspace detection and layout generation.

## Proposed Solution

A single test file at `packages/lace/src/__tests__/workspace_smoke.test.ts` containing ~15 test cases organized into describe blocks. The tests scaffold real git repos using `execSync` calls to `git init`, `git worktree add`, etc., run the lace pipeline against them, and verify outputs.

### File structure

```
packages/lace/src/__tests__/workspace_smoke.test.ts
```

### Test fixture lifecycle

```typescript
// Environment variable to preserve fixtures for manual inspection
const KEEP_FIXTURES = process.env.LACE_TEST_KEEP_FIXTURES === "1";

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "lace-smoke-workspace-"));
  if (KEEP_FIXTURES) {
    console.log(`LACE_TEST_KEEP_FIXTURES=1 — fixtures at: ${fixtureRoot}`);
  }
});

afterAll(() => {
  if (!KEEP_FIXTURES) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } else {
    console.log(`Fixtures preserved at: ${fixtureRoot}`);
  }
});
```

Using `beforeAll`/`afterAll` (not `beforeEach`/`afterEach`) because:
- Git operations are relatively slow (~100ms each); creating once and sharing is more efficient.
- Each test creates its own named subdirectory within `fixtureRoot`, so they don't interfere.
- `KEEP_FIXTURES` makes more sense when the entire fixture tree is preserved together.
- **Important:** Tests must not mutate each other's sub-fixtures. Each test should treat its siblings as read-only.

### Fixture creation helpers

New helpers in the smoke test file (not in scenario-utils.ts, since these require git):

```typescript
function createRealBareWorktreeRepo(
  parentDir: string,
  name: string,
  worktrees: string[] = ["main"],
): { root: string; worktrees: Record<string, string> } {
  // git init --bare .bare
  // git -C .bare symbolic-ref HEAD refs/heads/main
  // echo "gitdir: ./.bare" > .git
  // git worktree add ./main HEAD (or equivalent)
  // ...
}

function createRealNormalClone(
  parentDir: string,
  name: string,
): string {
  // git init <name>
  // git -C <name> commit --allow-empty -m "init"
}
```

### Test scenarios

#### 1. Workspace detection against real git structures

```
describe("workspace detection — real git repos")
```

| Test | What it does | Verifies |
|------|-------------|----------|
| classifies real normal clone | `git init` + commit | `type: "normal-clone"` |
| classifies real bare-root | nikitabobko `git init --bare .bare` + `.git` file | `type: "bare-root"`, correct `bareRepoRoot` |
| classifies real worktree | `git worktree add` from bare repo | `type: "worktree"`, correct `bareRepoRoot` + `worktreeName` |
| classifies real standard bare | `git init --bare` (no `.git` file wrapper) | `type: "standard-bare"` |
| detects multiple worktrees | `git worktree add` for 3 branches | All classify correctly, same `bareRepoRoot` |
| handles worktree with slashes in branch name | `git worktree add ./feature-foo -b feature/foo` | Correct `worktreeName` = `feature-foo` (directory basename, not branch) |
| handles detached HEAD worktree | `git worktree add --detach ./detached` | Classifies correctly despite different `HEAD` content (raw SHA vs `ref:`) |

#### 2. Full pipeline with real bare-worktree repos

```
describe("lace up pipeline — real bare-worktree repos")
```

| Test | What it does | Verifies |
|------|-------------|----------|
| generates workspaceMount + workspaceFolder for worktree | Create real bare-worktree, write devcontainer.json with `layout: "bare-worktree"`, run `runUp()` | Generated config has correct mount source (bare root) and folder (worktree path) |
| generates correct config for bare-root entry | Run `runUp()` from the bare-root directory | `workspaceFolder` = `mountTarget` (no worktree suffix) |
| injects safe.directory into postCreateCommand | Default config with bare-worktree layout | `postCreateCommand` contains the `git config --global --add safe.directory '*'` command |
| injects scanDepth into VS Code settings | Default config with bare-worktree layout | `customizations.vscode.settings["git.repositoryScanMaxDepth"]` = 2 |
| respects custom mountTarget | Config with `mountTarget: "/src"` | Mount target and folder use `/src` prefix |

#### 3. Combined end-to-end scenarios

```
describe("lace up pipeline — combined workspace + validation")
```

| Test | What it does | Verifies |
|------|-------------|----------|
| full happy path: bare-worktree + validation + mounts | Real bare-worktree repo, `validate.fileExists` with existing file, bind mount with existing source | `exitCode: 0`, all phases present and successful, generated config correct |
| validation failure halts pipeline | Real bare-worktree repo + missing required file in `validate.fileExists` | `exitCode: 1`, `workspaceLayout` phase succeeded (0a ran), `hostValidation` phase failed (0b halted), later phases like `generateConfig` absent |
| skip-validation allows pipeline to continue | Real bare-worktree repo + missing file + `skipValidation: true` | `exitCode: 0`, host validation downgraded to warning, workspace layout + generated config both present |

## Important Design Decisions

### D1: Real git operations via `execSync`

**Decision:** Use `execSync("git init ...")` etc. to create real git repositories.

**Why:** The entire point of these smoke tests is to verify against structures produced by real git. Using the fabricated helpers from `scenario-utils.ts` would defeat the purpose. The `git` binary is available in the development environment and CI (the existing test suite already uses `execSync` for Docker operations in docker_smoke.test.ts).

### D2: `LACE_TEST_KEEP_FIXTURES` environment variable

**Decision:** Support `LACE_TEST_KEEP_FIXTURES=1` to preserve temp directories after test run.

**Why:** When a test fails or when manually exploring behavior, being able to `cd` into the fixture and inspect git state, `.lace/devcontainer.json` output, and `.devcontainer/` scaffolding is invaluable. This is a common pattern in integration test suites. The env var approach is zero-overhead (no CLI flag parsing needed) and works with any test runner invocation:

```bash
LACE_TEST_KEEP_FIXTURES=1 npx vitest run src/__tests__/workspace_smoke.test.ts
```

### D3: `beforeAll` / `afterAll` scope (not `beforeEach`)

**Decision:** Create fixture root once per suite; each test creates a named sub-fixture.

**Why:** Git operations take ~100ms each. With ~15 tests, per-test setup/teardown would add ~1.5s of overhead. More importantly, when `KEEP_FIXTURES=1`, a single directory tree is much easier to inspect than 15 scattered temp directories. Each test creates its own named subdirectory and must not modify sibling fixtures.

### D4: Smoke tests in `src/__tests__/` (not `src/lib/__tests__/`)

**Decision:** Place the file at `packages/lace/src/__tests__/workspace_smoke.test.ts` (alongside the existing docker_smoke.test.ts).

**Why:** These are acceptance/smoke tests that exercise the full pipeline, not unit tests for a single module. The `src/__tests__/` directory is the established location for this kind of cross-cutting test (see `docker_smoke.test.ts`).

### D5: Mock subprocess but real filesystem

**Decision:** Use mock subprocess (no actual Docker or devcontainer CLI) but real git-produced filesystem structures.

**Why:** These tests target the workspace detection and validation logic, which is filesystem-dependent. The `devcontainer up` step is already well-tested and would require Docker, adding significant test time and infrastructure requirements. The mock subprocess pattern is already used in `up.integration.test.ts` and works well.

### D6: Fixture helpers local to the smoke test file

**Decision:** Define `createRealBareWorktreeRepo()` and `createRealNormalClone()` inside the smoke test file rather than in `scenario-utils.ts`.

**Why:** These helpers require the `git` binary, while the existing `scenario-utils.ts` helpers are pure filesystem operations. Mixing git-dependent and git-independent helpers would create an implicit dependency on git for all tests that import from scenario-utils. The smoke test file is the only consumer.

### D7: No standalone host validation or mount validation sections

**Decision:** Cover host validation and mount validation only in the combined end-to-end scenario (Section 3), not as standalone test sections.

**Why:** The existing `host-validator.test.ts` (23 tests) and `up.integration.test.ts` (5 mount validation tests) already use real filesystem operations (`writeFileSync`, `symlinkSync`, `existsSync`). There is no "fake vs. real" gap to close for these features. The combined scenario verifies they integrate correctly with real git structures without duplicating existing coverage.

## Edge Cases / Challenging Scenarios

### E1: Git not available

If `git` is not on PATH, the fixture creation will fail. The entire describe block should be gated with:

```typescript
const gitAvailable = (() => {
  try { execSync("git --version", { stdio: "pipe" }); return true; }
  catch { return false; }
})();

describe.skipIf(!gitAvailable)("workspace smoke tests", () => { ... });
```

This follows the pattern used by `docker_smoke.test.ts` for Docker availability.

### E2: Git worktree with absolute paths

`git worktree add` on some platforms/versions writes absolute gitdir paths in the `.git` file. The tests should verify that `classifyWorkspace()` handles both absolute and relative paths, and that the `absolute-gitdir` warning is emitted when appropriate. Explicitly test by creating a worktree, then manually rewriting its `.git` file to use an absolute path.

### E3: Branch names with slashes

`git worktree add ./feature-foo -b feature/foo` creates a directory `feature-foo` with branch `feature/foo`. The worktree name should be `feature-foo` (the directory basename), not the branch name.

### E4: Empty worktree list

A bare-root repo with no worktrees yet created. `classifyWorkspace()` should return `bare-root` when opened from the root, and `checkAbsolutePaths()` should return an empty array.

### E5: Worktree created from non-nikitabobko bare repo

A standard bare repo (`git init --bare`) without the `.git` file wrapper. `classifyWorkspace()` should return `standard-bare` and `applyWorkspaceLayout()` should return an error.

### E6: Race between fixture creation and test execution

Since `beforeAll` creates the fixture root and tests create sub-fixtures, there's a timing question. However, vitest runs tests within a file sequentially by default, so this is not a concern.

### E7: Detached HEAD worktree

`git worktree add --detach ./detached` creates a worktree with a detached HEAD. The worktree's `HEAD` file contains a raw commit SHA instead of `ref: refs/heads/...`. `classifyWorkspace()` does not read worktree `HEAD` files (it reads the `.git` pointer file and walks `worktrees/`), so this should classify correctly. Included as a cheap smoke test to confirm.

## Test Plan

### Running the tests

```bash
# Full smoke test suite
cd packages/lace
npx vitest run src/__tests__/workspace_smoke.test.ts

# With fixture preservation for manual inspection
LACE_TEST_KEEP_FIXTURES=1 npx vitest run src/__tests__/workspace_smoke.test.ts

# Run alongside the full suite (included by default, gated by git availability)
npx vitest run  # includes workspace_smoke.test.ts
```

### Acceptance criteria

1. All ~15 tests pass against real git-produced structures.
2. Tests complete in under 10 seconds (git operations are fast).
3. `LACE_TEST_KEEP_FIXTURES=1` preserves the fixture directory and prints its path.
4. Without the env var, fixture directory is cleaned up.
5. `git` unavailability skips the entire suite gracefully (no failures).
6. The full test suite (675 + new tests) continues to pass.
7. The smoke test file runs as part of the default `vitest run` execution (not gated or excluded). Unlike `docker_smoke.test.ts` which requires Docker, `git` is universally available in development and CI.

## Implementation Phases

### Phase 1: Test file scaffolding, fixture helpers, and detection tests

**Files created:**
- `packages/lace/src/__tests__/workspace_smoke.test.ts`

**Work:**
1. Create the test file with imports, `KEEP_FIXTURES` env var handling, `beforeAll`/`afterAll` lifecycle.
2. Implement `createRealBareWorktreeRepo()` — uses `git init --bare`, writes `.git` file, `git worktree add`.
3. Implement `createRealNormalClone()` — uses `git init`, `git commit --allow-empty`.
4. Implement git availability gate (`describe.skipIf`).
5. Add the "workspace detection — real git repos" describe block (7 tests including detached HEAD).

**Success criteria:**
- 7 detection tests pass against real git structures.
- `classifyWorkspace()` returns correct types for real repos.
- `LACE_TEST_KEEP_FIXTURES=1` preserves fixtures.

### Phase 2: Pipeline and combined end-to-end tests

**Work:**
1. Add mock subprocess setup (reuse pattern from `up.integration.test.ts`).
2. Add "lace up pipeline — real bare-worktree repos" describe block (5 tests).
3. Add "combined workspace + validation" describe block (3 tests).
4. Each test writes a `devcontainer.json` into the fixture's `.devcontainer/` directory, runs `runUp()`, and asserts on the result and generated config.

**Success criteria:**
- All 8 pipeline + combined tests pass.
- Generated configs have correct `workspaceMount`, `workspaceFolder`, `postCreateCommand`, VS Code settings.
- Combined happy-path exercises full pipeline with workspace layout + host validation + mount validation.
- Full test suite (675 + ~15 new) passes.

### Phase 3: Review iteration and cleanup

**Work:**
1. Submit for `/review`.
2. Address findings.
3. Final verification: full suite green, `KEEP_FIXTURES` works, fixtures clean up without it.
