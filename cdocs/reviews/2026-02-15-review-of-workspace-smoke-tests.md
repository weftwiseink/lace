---
review_of: cdocs/proposals/2026-02-15-workspace-smoke-tests.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T23:45:00-08:00
task_list: lace/workspace-validation
type: review
state: live
status: done
tags: [fresh_agent, test_plan, coverage_gap_analysis, fixture_design, architecture]
---

# Review: Workspace Validation Acceptance & Smoke Test Suite

## Summary Assessment

This proposal adds a smoke test suite that replaces the fabricated filesystem structures in `scenario-utils.ts` with real `git init --bare` / `git worktree add` operations, then runs the full `runUp()` pipeline against them.
The proposal is well-structured and the core justification is sound: real git repositories produce additional metadata (pack files, config, absolute-path worktree linking) that the fake helpers do not replicate, and testing against authentic structures is the right way to close that gap.
The most important finding is that the host validation and inferred mount validation test scenarios (Sections 3 and 4) substantially duplicate existing coverage in `host-validator.test.ts` and `up.integration.test.ts` without adding the "real filesystem" value that justifies the workspace detection tests.
Verdict: Revise.

## Section-by-Section Findings

### BLUF

The BLUF is clear, specific, and front-loads the key decision (real git operations vs. fabricated stubs).
No issues.

### Objective (F1: Accurate gap analysis)

**Non-blocking.**
The four enumerated gaps are well-reasoned.
Gap 3 ("No `.git/config` or `.bare/config`") is slightly overstated: `classifyWorkspace()` does not read git config files at all; it reads `.git` file content and walks `worktrees/` entries.
The real risk is more about git-produced metadata in `.bare/worktrees/<name>/` (e.g., `HEAD`, `ORIG_HEAD`, lock files) interfering with directory traversal, which gap 2 already covers.
Consider folding gap 3 into gap 2 or clarifying that it is future-proofing rather than a current detection concern.

### Background (F2: Test count accuracy)

**Non-blocking.**
The proposal cites "81 unit + integration tests" but the existing `up.integration.test.ts` alone has well over 30 workspace-related integration tests (workspace layout, host validation, inferred mount validation), plus 16 in `workspace-detector.test.ts`, 29 in `workspace-layout.test.ts`, and 23 in `host-validator.test.ts`.
The count likely changed during the `wtmounts` branch work.
Consider verifying or removing the specific number to avoid staleness.

### Test Scenarios Section 1: Workspace detection (F3: Strong value-add)

**This is the strongest section of the proposal.**
The six tests in "workspace detection - real git repos" are precisely the scenarios where real git operations matter.
The existing `workspace-detector.test.ts` uses `createBareRepoWorkspace()`, which writes `.git` files and `.bare/` directories manually.
These smoke tests close a genuine gap: real `git worktree add` writes additional state (`HEAD`, `ORIG_HEAD`, `gitdir` back-pointers with platform-specific path separators) that the fake helpers do not produce.

One observation: the "detects multiple worktrees" test and the "handles worktree with slashes in branch name" test are particularly valuable because they exercise `checkAbsolutePaths()` sibling scanning against real git state, which the current unit tests only exercise against fabricated pointers.

### Test Scenarios Section 2: Full pipeline with real bare-worktree repos (F4: Moderate value-add, some overlap)

**Non-blocking.**
Five of the seven tests here are meaningful: they exercise the `runUp()` pipeline against real git structures, which is genuinely different from the existing integration tests that use `createBareRepoWorkspace()`.
However, two tests overlap significantly with existing `up.integration.test.ts`:

- "preserves user-set workspaceMount" is already tested in `workspace-layout.test.ts` (the `mergeVscodeSettings` / `mergePostCreateCommand` tests exercise preservation semantics).
- "errors on real normal clone with bare-worktree declared" is already tested in `up.integration.test.ts` ("returns error when bare-worktree declared but workspace is normal clone").

The added value of repeating these against a real `git init` normal clone is marginal: the detection for normal clones checks whether `.git` is a directory, which behaves identically for real and fabricated `.git/` directories.
Consider marking these two as lower priority or dropping them in favor of more differentiated scenarios.

### Test Scenarios Section 3: Host validation with real filesystem (F5: Excessive overlap)

**Blocking.**
All six tests in this section closely duplicate existing coverage:

| Proposed test | Already covered by |
|---|---|
| passes when validated file exists | `host-validator.test.ts` "fileExists - present file passes" |
| fails when validated file is missing | `host-validator.test.ts` "fileExists - missing file with severity error fails" + `up.integration.test.ts` "fileExists blocks lace up" |
| passes with symlink to existing target | `host-validator.test.ts` "fileExists - symlink to existing target passes" |
| fails with symlink to missing target | `host-validator.test.ts` "fileExists - symlink to missing target fails" |
| skip-validation downgrades to warning | `host-validator.test.ts` "--skip-validation downgrades error to warning" + `up.integration.test.ts` "skip-validation downgrades errors" |
| handles tilde expansion for real home dir | `host-validator.test.ts` "fileExists - tilde expansion works" |

The existing host-validator unit tests already use real filesystem operations (`writeFileSync`, `symlinkSync`).
There is no "fake vs. real" gap to close here: host validation checks `existsSync()` on real paths, and the unit tests already pass real paths.
The smoke test adds no structural fidelity that the unit tests lack.

Recommendation: Remove Section 3 entirely, or reduce it to a single "combined" test in Section 5 that verifies host validation works in the context of a real bare-worktree repo (which is already partially proposed).

### Test Scenarios Section 4: Inferred mount validation (F6: Excessive overlap)

**Blocking.**
Same issue as Section 3.
All three tests duplicate existing coverage in `up.integration.test.ts`:

- "warns on missing bind-mount source" is covered by "inferred mount validation - warns on missing bind-mount source"
- "does not warn when bind-mount source exists" is covered by "inferred mount validation - does not warn for existing source"
- "warns on missing workspaceMount source" is covered by "inferred mount validation - warns on missing workspaceMount source"

These tests use real filesystem paths in both the existing integration tests and the proposed smoke tests.
There is no additional fidelity from putting them in a smoke test file.

Recommendation: Remove Section 4 entirely.

### Test Scenarios Section 5: Combined scenarios (F7: Good but could absorb validation)

**Non-blocking.**
The "full happy path" test is valuable as a single end-to-end assertion that workspace detection, host validation, and mount validation all work together against a real bare-worktree repo.
This is the right place to verify that host validation and mount validation integrate correctly with real git structures, rather than dedicating separate sections to them.

The second test ("validation failure prevents workspace config generation") has an important parenthetical clarification about phase ordering.
The assertion that `generateConfig` is absent when host validation fails at Phase 0b is already tested in `up.integration.test.ts`, but doing it against a real bare-worktree repo adds modest value by confirming the phase ordering holds when workspace layout (Phase 0a) actually does work.

### Design Decisions (F8: Sound rationale)

**Non-blocking.**
All six design decisions are well-reasoned with clear justification.

D6 (fixture helpers local to the smoke test file) is a good call.
The separation between git-dependent and git-independent helpers avoids coupling the broader test suite to a `git` binary dependency.

D3 (`beforeAll` / `afterAll`) deserves a minor caveat: if a test modifies the shared fixture root (e.g., deletes a worktree directory during cleanup), it could affect subsequent tests.
The proposal's plan to have each test create a named subdirectory mitigates this, but worth noting explicitly that tests must not mutate each other's sub-fixtures.

### Edge Cases (F9: Good coverage, one gap)

**Non-blocking.**
E1 (git not available) follows the established `docker_smoke.test.ts` pattern and is correct.
E2 (absolute paths) is well-handled.
E3 (branch name slashes) is important and correctly identified.
E4 (empty worktree list) is good.
E5 (non-nikitabobko bare repo) is good.

One gap: **E7: Worktree created by `git worktree add` with `--detach`.**
A detached HEAD worktree has a different `HEAD` file content (a raw commit SHA instead of `ref: refs/heads/...`).
`classifyWorkspace()` does not read `HEAD` in worktrees, so this is unlikely to matter, but it would be a cheap test to add.

### Implementation Phases (F10: Reasonable phasing)

**Non-blocking.**
The three implementation phases are ordered correctly (detection first, pipeline second, validation/combined third).
If the blocking findings about Sections 3 and 4 are accepted, Phase 3 shrinks to just the combined scenarios.

### Test Plan (F11: Missing test isolation detail)

**Non-blocking.**
The acceptance criteria mention "All ~18 tests pass" but do not specify whether the smoke test file should be excluded from the default `vitest run` execution or included.
Given that `docker_smoke.test.ts` runs with Docker gating, the workspace smoke tests should run by default (they only need `git`, which is universally available in development and CI).
Worth making this explicit.

## Coverage Overlap Analysis

To quantify the overlap concern raised in F5 and F6:

| Proposed section | Tests | Unique to smoke suite | Already covered |
|---|---|---|---|
| 1. Workspace detection | 6 | 6 (real git) | 0 |
| 2. Pipeline + bare-worktree | 7 | 5 | 2 (partial) |
| 3. Host validation | 6 | 0 | 6 |
| 4. Mount validation | 3 | 0 | 3 |
| 5. Combined | 2 | 2 | 0 |
| **Total** | **24** | **13** | **11** |

Almost half the proposed tests duplicate existing coverage without adding "real git" value.
Removing Sections 3 and 4 and the two overlapping tests from Section 2 reduces the suite to ~13 focused, high-value tests.

## Verdict

**Revise.**
The core idea is strong and the workspace detection + pipeline sections deliver genuine value.
The host validation and inferred mount validation sections must be removed or reduced to avoid duplicating existing tests that already use real filesystem operations.
The combined scenario in Section 5 is the correct place to verify that these phases integrate with real git structures.

## Action Items

1. [blocking] Remove Section 3 (host validation with real filesystem): all six tests duplicate `host-validator.test.ts` coverage. Host validation already tests against real files/symlinks.
2. [blocking] Remove Section 4 (inferred mount validation with real paths): all three tests duplicate `up.integration.test.ts` coverage. Mount validation already uses real filesystem paths.
3. [non-blocking] Consider dropping "preserves user-set workspaceMount" and "errors on real normal clone with bare-worktree declared" from Section 2 to reduce overlap with existing tests. If retained, document what the real-git variant adds.
4. [non-blocking] Fold Objective gap 3 (`.git/config` / `.bare/config`) into gap 2 or clarify that it is future-proofing, since `classifyWorkspace()` does not read git config files.
5. [non-blocking] Verify or remove the "81 unit + integration tests" count, which may be stale.
6. [non-blocking] Add a note to D3 (`beforeAll`/`afterAll`) that tests must not mutate each other's sub-fixtures.
7. [non-blocking] Consider adding an E7 edge case for `git worktree add --detach` (detached HEAD worktree).
8. [non-blocking] Clarify in the test plan whether `workspace_smoke.test.ts` runs in the default `vitest run` or is gated/excluded.
