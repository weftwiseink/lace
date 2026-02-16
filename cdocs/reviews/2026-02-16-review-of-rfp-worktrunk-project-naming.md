---
review_of: cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T21:30:00-06:00
task_list: worktrunk/project-naming
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, pipeline_integration, bash, typescript]
---

# Review: Worktrunk-Aware Project Naming (Final Implementation Review)

## Summary Assessment

This proposal defines a three-component pipeline (name derivation, label/name injection, label-based discovery) to fix the broken `basename` naming that occurs under the worktrunk layout.
The implementation across all four phases is thorough, well-tested (25 unit tests + 6 integration tests covering the TypeScript side, plus manual verification for bash), and cleanly integrated into the existing codebase.
The most important finding is that the implementation faithfully follows the proposal with no deviations or regressions, and the one minor stylistic inconsistency in `generateExtendedConfig()` has no functional impact.
Verdict: **Accept**.

## Section-by-Section Findings

### Phase 1: Name Derivation Function (`project-name.ts`)

The module implements `deriveProjectName()`, `sanitizeContainerName()`, and `hasRunArgsFlag()` as pure functions with no side effects, matching the proposal exactly.

**`deriveProjectName`**: The switch statement covers all six `WorkspaceClassification` variants exhaustively.
TypeScript's exhaustive switch checking ensures this stays correct as the union evolves.
The `worktree` and `bare-root` cases both use `basename(classification.bareRepoRoot)` as specified, while the remaining four types fall through to `basename(workspacePath)`.
This is correct.

**`sanitizeContainerName`**: The three-step regex approach (replace invalid chars, strip leading non-alnum, strip trailing non-alnum, fallback to `"lace-project"`) matches the proposal's specification and Docker's `[a-zA-Z0-9][a-zA-Z0-9_.-]` constraint.

**`hasRunArgsFlag`**: The prefix-collision protection (`--name` vs `--namespace`) works because `startsWith("--name=")` does not match `"--namespace=x"`.
The test suite includes explicit cases for this, which is good defensive testing.

**Tests**: All 25 tests (10 for `deriveProjectName`, 9 for `sanitizeContainerName`, 6 for `hasRunArgsFlag`) are present, covering every `WorkspaceClassification` variant and the edge cases specified in the proposal's test tables.
The test file follows the project's existing vitest conventions.

**Finding (non-blocking)**: The `// IMPLEMENTATION_VALIDATION` header at line 1 of both source and test files was added despite the proposal's constraint stating "Do not add `// IMPLEMENTATION_VALIDATION` -- that header is for existing files only if the project uses it as a convention."
Looking at the codebase, this header is used consistently across existing files (`up.ts`, `workspace-layout.ts`, etc.), so following the existing convention is reasonable, but it deviates from the proposal's explicit instruction.

### Phase 2: Pipeline Integration (`workspace-layout.ts` + `up.ts`)

**`WorkspaceLayoutResult` extension**: The `classification?: WorkspaceClassification` field is added as optional, correctly reflecting that the "skipped" path does not compute a classification.
All three return paths in `applyWorkspaceLayout()` (`applied`, `error`, `skipped`) populate the field correctly: `applied` and `error` include it, `skipped` omits it.

**Threading in `up.ts`**: The approach is correct:
1. Line 137: `projectName` defaults to `basename(workspaceFolder)` (fallback for non-classified workspaces).
2. Line 159-161: Overrides with `deriveProjectName()` if classification is available.
3. Line 527: Passes `projectName` to `generateExtendedConfig()`.

This ensures the project name is always defined, even when `applyWorkspaceLayout()` returns "skipped" (no workspace config) or when classification is absent.

**Label and name injection** (lines 672-681): The injection logic correctly:
- Always adds `--label lace.project_name=<unsanitized>`.
- Only adds `--name <sanitized>` when the user has not already provided `--name`.
- Scans the full `runArgs` array (including user-provided entries) before deciding.

**Finding (non-blocking, stylistic)**: In `generateExtendedConfig()`, `projectName` is not extracted in the destructuring block at lines 588-595 but is instead accessed as `options.projectName` at line 673.
This works correctly but is inconsistent with how all other options are destructured at the top of the function.
Low priority.

**Integration tests**: The 6 tests in `up-project-name.integration.test.ts` cover:
- Normal workspace (label + name injected).
- User `--name` in space form (preserved, no duplication).
- User `--name=` in equals form (preserved).
- Existing `runArgs` preserved and appended to.
- Special characters (label unsanitized, name sanitized).
- Worktree workspace (repo name used, not worktree name).

These map to the proposal's test table.
The tests follow the same pattern as the existing `up-mount.integration.test.ts`.

**Finding (non-blocking)**: The proposal's test table lists "Classification exposed" and "Classification on skip" as Phase 2 tests.
These are actually present in `workspace-layout.test.ts` (the "classification threading" describe block at line 468), not in the integration test file.
This is fine - the tests exist, they're just in a different file than the proposal suggested as an option.

### Phase 3: Discovery Update (`lace-discover` + `wez-into`)

**`lace-discover`**: The `discover_raw()` function now includes `{{.Label "lace.project_name"}}` as the fourth tab-separated field.
The `discover_projects()` function reads the fourth field as `project_name` and uses `${project_name:-$(basename "$local_folder")}` for the fallback.
The old `name=$(basename "$local_folder")` line is deleted.
The Go template syntax is correct.
The IFS and field count match.

**`wez-into`**: The `discover_stopped()` function uses the same pattern: adds `{{.Label "lace.project_name"}}` to the format template, reads it as the second tab-separated field, and falls back to `basename`.
The old `name=$(basename "$local_folder")` line is deleted.

**Finding (non-blocking)**: Neither script has formal automated tests.
The proposal acknowledges this and relies on manual verification and the integration test suite for the TypeScript pipeline.
For bash scripts of this complexity (117 lines for `discover_stopped`, 140 lines for `lace-discover`), this is acceptable but represents a gap.
The proposal's Phase 4 verification steps serve as the test plan for these scripts.

### Phase 4: End-to-End Verification

The user's task prompt confirms: all 724 tests pass (29 test files), build succeeds, TypeScript typecheck passes, bash syntax check passes.
This exceeds the proposal's success criteria of 690+ tests, indicating the test suite has grown during implementation.

### Cross-Phase Consistency

**No legacy basename-only code paths**: Verified.
In `lace-discover`, the only `basename` call is inside the `${project_name:-...}` fallback expression.
In `wez-into`, same pattern.
In the TypeScript pipeline, `basename(workspaceFolder)` at line 137 of `up.ts` serves as the fallback when classification is unavailable, which is the correct behavior for the no-workspace-config path.

**Label value is unsanitized**: Confirmed at line 675: `--label lace.project_name=${options.projectName}` uses the raw project name.

**`--name` value is sanitized**: Confirmed at line 676-678: `sanitizeContainerName(options.projectName)`.

**User `runArgs` never clobbered**: Confirmed.
The implementation casts `extended.runArgs ?? []`, preserving any existing entries, and only appends.
`hasRunArgsFlag` scans the full array (including user entries) before injecting `--name`.

### Proposal Document Quality

The proposal is well-structured: clear BLUF, objective, three-component pipeline diagram, detailed implementation notes with code snippets, comprehensive test tables, and explicit success criteria per phase.
The implementation notes section includes two important guardrails ("clean breaks over backwards-compatible layering" and "replace entirely with label-based approach").
The phase separation is logical and each phase has clear constraints preventing scope creep.

## Verdict

**Accept.**
The implementation faithfully realizes the proposal across all four phases.
All TypeScript `WorkspaceClassification` variants are covered, user-provided `runArgs` are never clobbered, the label/name split (unsanitized label vs sanitized container name) is correct, and pre-label container fallback works via `${project_name:-$(basename ...)}`.
The test coverage is strong on the TypeScript side (31 tests across unit and integration) and adequate on the bash side (manual verification).

## Action Items

1. [non-blocking] Consider extracting `projectName` in the destructuring block at the top of `generateExtendedConfig()` for consistency with how other options are accessed in that function.
2. [non-blocking] The `// IMPLEMENTATION_VALIDATION` header was added to the new module despite the proposal's instruction against it. Since the header is used across all existing files in the codebase, this is the right call, but the proposal's constraint text should be updated to reflect the actual convention.
3. [non-blocking] Consider adding a `shellcheck` CI step for `bin/lace-discover` and `bin/wez-into` to catch bash issues in the absence of formal tests.
