---
review_of: cdocs/proposals/2026-02-15-workspace-smoke-tests.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T15:30:00-08:00
task_list: lace/workspace-validation
type: review
state: live
status: done
tags: [rereview_agent, test_plan, coverage_gap_analysis, fixture_design, acceptance]
---

# Review R2: Workspace Validation Acceptance & Smoke Test Suite

## Summary Assessment

This revised proposal addresses both R1 blocking findings: the standalone host validation section (F5) and inferred mount validation section (F6) are removed entirely.
The resulting suite of ~15 tests in 3 sections is tightly focused on the "real git" value proposition.
Non-blocking improvements from R1 are adequately addressed: gap 3 folded into gap 2 with a NOTE callout, specific test counts removed, overlapping pipeline tests dropped, fixture mutation warning added, detached HEAD edge case included, and default execution criterion made explicit.
Verdict: Accept.

## R1 Resolution Tracker

### Blocking findings

| ID | Finding | Status |
|----|---------|--------|
| F5 | Section 3 (host validation) duplicated host-validator.test.ts | **Resolved.** Section removed. Host validation appears only in the combined end-to-end scenario (Section 3, the new numbering). |
| F6 | Section 4 (inferred mount validation) duplicated up.integration.test.ts | **Resolved.** Section removed. Mount validation appears only in the combined end-to-end scenario. |

### Non-blocking findings

| ID | Finding | Status |
|----|---------|--------|
| F1 | Objective gap 3 overstated (classifyWorkspace does not read git config) | **Resolved.** Gap 3 folded into gap 2. NOTE callout at line 31 clarifies this is a robustness concern about file presence, not a detection gap. |
| F2 | Test count "81" may be stale | **Resolved.** Specific count removed. Background section now cites test files with counts in parentheses rather than a fragile total. |
| F4 | Two overlapping pipeline tests from Section 2 | **Resolved.** "preserves user-set workspaceMount" and "errors on real normal clone with bare-worktree declared" are removed. Section 2 is now 5 tests, all with clear "real git" differentiation. |
| D3 caveat | Tests must not mutate each other's sub-fixtures | **Resolved.** Line 91 explicitly states: "Tests must not mutate each other's sub-fixtures. Each test should treat its siblings as read-only." |
| E7 | Add detached HEAD worktree edge case | **Resolved.** Added as the seventh test in Section 1 (line 135) and as edge case E7 (line 248). Includes rationale about HEAD content difference. |
| F11 | Clarify whether smoke tests run in default vitest execution | **Resolved.** Acceptance criterion 7 (line 276) explicitly states the file runs as part of default `vitest run`, not gated or excluded. |

## Section-by-Section Findings

### BLUF

The BLUF has been updated to reflect the reduced scope and explain the rationale for the combined end-to-end approach.
The NOTE callout about R1 changes is appropriate for document context.
No issues.

### Objective (R2-F1: Well-scoped)

The three enumerated gaps are now properly scoped.
Gap 2 absorbs the former gap 3, and the NOTE callout on line 31 is precise: "The concern about additional git metadata files is about their presence alongside the files the detector does read (.git file, .bare/worktrees/ directory), not about the detector parsing config files."
This is exactly the clarification R1 requested.

### Background (R2-F2: Accurate)

The "What doesn't need re-testing" subsection (lines 49-51) clearly explains why host validation and mount validation are excluded from standalone smoke test sections.
The per-file test counts in parentheses are a good compromise between precision and staleness risk.

### Section 1: Workspace detection (R2-F3: Strong, comprehensive)

Seven tests covering: normal clone, bare-root, worktree, standard bare, multiple worktrees, slashed branch names, and detached HEAD.
All seven exercise `classifyWorkspace()` against structures produced by real `git init --bare` + `git worktree add`, which is the core gap this suite closes.

The detached HEAD test (line 135) is a good addition: cheap to run, confirms that the detector is indifferent to HEAD content format, and covers a scenario that could regress if the detector is ever extended to read worktree HEAD files.

### Section 2: Full pipeline (R2-F4: Focused)

Five tests, all with clear differentiation from existing `up.integration.test.ts`:
1. Generates workspaceMount + workspaceFolder for worktree
2. Generates correct config for bare-root entry
3. Injects safe.directory into postCreateCommand
4. Injects scanDepth into VS Code settings
5. Respects custom mountTarget

These all run `runUp()` against real git structures rather than fabricated ones.
The removal of the two overlapping tests (preserves user-set workspaceMount, errors on normal clone mismatch) per F4 is correct: those scenarios test code paths that are insensitive to real vs. fabricated `.git` directories.

### Section 3: Combined end-to-end (R2-F5: Adequately covers integration gap)

**Non-blocking.**
Three tests covering the full happy path, validation failure halting the pipeline, and skip-validation bypass.
This is the right abstraction level: it verifies that workspace layout (Phase 0a), host validation (Phase 0b), and mount validation all integrate correctly against real git structures, without duplicating the granular validation tests that already exist.

One observation: the "validation failure halts pipeline" test (line 160) asserts that `workspaceLayout` phase succeeded (0a ran) and `hostValidation` phase failed (0b halted) and `generateConfig` is absent.
This is a strong assertion about phase ordering that would catch regressions in the pipeline's early-exit logic.
The same assertion exists in `up.integration.test.ts`, but here it runs against a real bare-worktree repo, which adds modest value: it confirms Phase 0a (which depends on `classifyWorkspace()`) actually runs and succeeds before the pipeline halts at Phase 0b.
Worth keeping.

### Design Decisions (R2-F6: D7 is well-justified)

D7 ("No standalone host validation or mount validation sections") is a new decision added for R2.
The reasoning is clear: existing tests already use real filesystem operations, so the "real git" value proposition does not apply.
This decision directly addresses R1's blocking findings and its rationale is sound.

### Edge Cases (R2-F7: Complete)

E7 (detached HEAD worktree) is the only addition since R1.
The edge case list (E1-E7) is comprehensive for the scope of the suite.

### Test Plan (R2-F8: Clear acceptance criteria)

Seven acceptance criteria, all specific and testable.
Criterion 7 (default execution, not gated) addresses R1's F11 finding directly.
The "675 + new tests" count in criterion 6 could become stale, but this is a minor concern since the intent ("full suite passes") is clear.

### Implementation Phases (R2-F9: Adjusted scope)

Phase 1 now includes 7 detection tests (including detached HEAD).
Phase 2 includes 5 pipeline + 3 combined tests.
Phase 3 is review/cleanup.
The phasing is sequential, well-scoped, and accounts for the reduced suite.

## Coverage Analysis (R2)

| Section | Tests | Unique to smoke suite | Overlapping |
|---------|-------|-----------------------|-------------|
| 1. Workspace detection | 7 | 7 (real git) | 0 |
| 2. Pipeline + bare-worktree | 5 | 5 (real git) | 0 |
| 3. Combined end-to-end | 3 | 3 (integration) | 0 |
| **Total** | **15** | **15** | **0** |

All 15 proposed tests provide unique value not covered by the existing test suite.
The overlap concerns from R1 are fully resolved.

## Verdict

**Accept.**
Both blocking findings are resolved.
All non-blocking improvements are adequate.
The suite is focused at ~15 tests across 3 sections with zero unnecessary duplication.
The combined end-to-end section effectively covers the validation/mount integration gap without re-testing what `host-validator.test.ts` and `up.integration.test.ts` already cover with real filesystem operations.

## Action Items

1. [non-blocking] The "675 + new tests" figure in acceptance criterion 6 may become stale as the test suite grows. Consider rephrasing to "the full existing test suite continues to pass" to avoid future staleness.
2. [non-blocking] The NOTE callout at lines 21-22 references R1 review changes, which is useful now but will age. Consider removing it after implementation is complete and the document is finalized, per the history-agnostic writing convention.
