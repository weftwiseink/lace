---
review_of: cdocs/devlogs/2026-03-06-wt-clone-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-06T14:30:00-06:00
task_list: lace/worktree-tooling
type: review
state: live
status: done
tags: [fresh_agent, implementation_fidelity, nushell, test_evidence, worktree]
---

# Review: `wt-clone` Implementation Devlog

## Summary Assessment

This devlog documents the implementation of `wt-clone`, a nushell command that creates bare-worktree clones per the proposal at `cdocs/proposals/2026-03-05-worktree-conversion-script.md`.
The implementation faithfully reproduces all 12 algorithm steps from the proposal, the code quality is solid with idiomatic nushell patterns, and 8 test cases provide good coverage across the proposal's test plan.
The main shortcoming is that verification records use summarized/paraphrased output rather than raw pasted terminal evidence for several test cases (Tests 2-5), which weakens their evidentiary value.
Verdict: **Accept** with non-blocking suggestions.

## Algorithm Fidelity: Proposal Steps vs Implementation

The proposal specifies a 12-step algorithm. Here is step-by-step traceability.

| Proposal Step | Implementation (line) | Match? |
|---|---|---|
| 1. Derive target from URL | `wt-repo-name` helper (L16-25), main fallback (L46-50) | Yes |
| 2. Check target exists/non-empty | L52-59 | Yes |
| 3. Bare clone (with `--shallow`) | L72-82 | Yes |
| 4. Create `.git` file | L85 | Yes |
| 5. Configure fetch refspec | L88 | Yes |
| 6. Fetch all refs (with `--shallow`) | L91-99 | Yes |
| 7. Determine default branch | L101-112 | Yes |
| 8. Determine worktree name | L115 | Yes |
| 9. Create worktree | L125 | Yes |
| 10. Fix gitdir paths (relative) | `wt-fix-paths` helper (L28-34), called at L128 | Yes |
| 11. Create `.worktree-root` marker | L131 | Yes |
| 12. Print summary and next steps | L137-158 | Yes |

All 12 steps are present and correctly ordered. No steps were omitted or reordered.

## Section-by-Section Findings

### Objective and Plan

Clear and well-scoped. The devlog correctly identifies the proposal as the source specification and limits its own scope to implementation and verification. No issues.

### Testing Approach

The devlog declares manual structured testing in `/tmp/`, which is appropriate for a personal dotfile script. It correctly references the proposal's test plan as the source of test cases.

### Implementation Notes

The "Phases 1+2" section is a useful deviation record: the devlog explains that phases were combined because edge case handling is integral to a working command.
The pattern decisions are well-documented, especially the note about `-> string` return type syntax being invalid in nushell (a correction from the proposal's pseudocode).

**Finding (non-blocking):** The devlog notes the dual-site reserved name check (early for `--name`, late for branch-derived name with cleanup) but this is a deviation from the proposal, which describes reserved name checking only as edge case E8 without specifying the two-phase approach. The devlog should be credited for surfacing this: the implementation is better than the proposal's specification, since early validation avoids an unnecessary clone when `--name` is explicitly set to a reserved value.

### Changes Made

The changes table lists two files, both in the chezmoi dotfiles repo. I verified:
- `wt-clone.nu` exists at the referenced path and contains 159 lines of implementation.
- `config.nu` contains `source ($nu.default-config-dir | path join "scripts/wt-clone.nu")` at line 59.

Both files are confirmed present and consistent with the devlog's claims.

### Verification: Parse Check

The `--help` output is pasted with full flag and parameter documentation. This confirms the nushell parser accepted the command definition. Adequate evidence.

### Verification: Tests 1 and 8 (SSH Clone and Lace Recognition)

These are the strongest verification records. Test 1 includes the full command output and lists six specific structural checks (`.git` file content, worktree `.git` content, bare gitdir content, `git log`, `git remote -v`, branch tracking). Test 8 shows full `lace up` output confirming worktree detection. Both have pasted terminal evidence.

### Verification: Tests 2-5 (HTTPS, Non-Default Branch, Custom Name, Shallow)

**Finding (non-blocking):** These tests use bracketed summaries like `[creates ./lace/ in CWD -- correct auto-derivation]` and `[worktree directory: mountvars/]` instead of pasting the actual terminal output. While the summaries describe the expected behavior and are plausible, they lack the raw evidence that makes Test 1 and Test 8 convincing. For a devlog at `review_ready` status, summarized evidence is acceptable for straightforward cases, but pasting the actual output would make verification self-contained.

### Verification: Tests 6 and 7 (Error Cases)

Test 6 (target exists) shows the exact error message. Test 7 (reserved name) shows the error message and explicitly confirms `[/tmp/test-reserved does NOT exist -- no clone was attempted]`, which validates the early-validation optimization. Good evidence.

### Verification: Overall Coverage

The 8 test cases cover all items from the proposal's test plan (items 1-8). This is complete coverage. The devlog does not mention any test failures or regressions encountered during development. Either the implementation was clean on first pass, or intermediate failures were not recorded. This is minor: the devlog is a record of final state, not a debugging journal.

## Code Quality: Nushell Idioms

The implementation follows established patterns from `wez-session.nu`:
- Non-exported helpers (`wt-repo-name`, `wt-fix-paths`) are accessible via `source` (not `use`).
- `error make` for user-facing errors with clear messages.
- `^git` prefix for all external commands.
- `path expand | into string` for passing paths to externals.
- `try/catch` for external commands that may fail.

**Finding (non-blocking):** The `wt-repo-name` helper in the implementation (L16-25) is more robust than the proposal's pseudocode (`$url | path basename | str replace -r '\.git$' ''`). The implementation handles SSH URLs with `:` separators by splitting on `:` first, then taking the basename. This is a good deviation: `path basename` on `git@github.com:org/repo.git` would return `org/repo.git` in some shells, not `repo.git`. The implementation correctly handles this by detecting non-HTTP URLs with `:` and splitting.

**Finding (non-blocking):** The proposal specified a `wt-create-marker` helper function, but the implementation inlines the marker file creation at L131. This is a reasonable simplification: the helper would be a one-liner called once. The inline version is more readable.

**Finding (non-blocking):** Repeated `$bare_dir | path expand | into string` appears 6 times in the main function (lines 75, 77, 88, 93, 95, 106, 125). Extracting this to a `let bare_dir_str = ...` binding at line 70 would reduce noise. This is a minor style point.

**Finding (non-blocking):** The `git worktree add` at L125 does not have `try/catch` wrapping, unlike the clone and fetch operations. If the worktree add fails (e.g., branch does not exist on remote), the `.bare/` and `.git` file will already have been created, leaving a partial layout. The proposal does not specify cleanup for this case either, but adding a `try/catch` with cleanup would make the error handling consistent.

## Deviations From Proposal

Three deviations identified, all improvements:

1. **Phases combined:** Phases 1 and 2 were implemented together rather than sequentially. Documented in devlog. Reasonable.
2. **Dual-site reserved name validation:** Not specified in the proposal's algorithm. Implementation adds early validation for `--name` and late validation for branch-derived names. Better than the proposal.
3. **URL parsing improvement:** The `wt-repo-name` helper is more robust than the proposal's pseudocode, correctly handling SSH URL colon separators. Not documented as a deviation in the devlog, but evident from code comparison.

None of these are concerning. All are improvements over the proposal's specification.

## Verdict

**Accept.** The implementation faithfully covers all 12 algorithm steps, all 8 edge cases, and all 8 test plan items from the proposal. Code quality is solid with idiomatic nushell patterns. Deviations from the proposal are improvements, not regressions. The summarized test evidence in Tests 2-5 is the only notable gap, and it does not rise to blocking since the tests that matter most (Test 1 for structural correctness, Test 8 for lace integration) have full pasted evidence.

## Action Items

1. [non-blocking] Consider pasting raw terminal output for Tests 2-5 instead of bracketed summaries, to make the verification fully self-contained.
2. [non-blocking] Extract repeated `$bare_dir | path expand | into string` to a `let` binding to reduce duplication in the main function body.
3. [non-blocking] Add `try/catch` around `git worktree add` (L125) with cleanup to match the error handling pattern used for `git clone` and `git fetch`.
4. [non-blocking] Document the URL parsing improvement (SSH colon handling) as a deviation from the proposal in the Implementation Notes section.
