---
review_of: cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T19:30:00-06:00
task_list: worktrunk/project-naming
type: review
state: live
status: done
tags: [fresh_agent, phase2_review, classification_threading, runargs_injection, integration_tests, naming]
---

# Review: Worktrunk Project Naming Phase 2 (Label + Name Injection)

## Summary Assessment

Phase 2 threads workspace classification from `applyWorkspaceLayout()` through `runUp()` and into `generateExtendedConfig()`, where it injects `--label lace.project_name=<raw>` and `--name <sanitized>` into the generated devcontainer.json `runArgs`.
The implementation is correct and closely follows the proposal's specification.
The classification threading covers all return paths, `hasRunArgsFlag` handles both flag forms without false-positive prefix matches, and user-provided `runArgs` are never clobbered.
One non-blocking gap exists in the integration test matrix: the "sanitized name differs from label" case is missing.
Verdict: Accept.

## Section-by-Section Findings

### workspace-layout.ts: Classification Field

**No issues.**

The `classification?: WorkspaceClassification` field was added to `WorkspaceLayoutResult` at line 31.
All return paths are correct:

- **Skipped** (line 87-92): No `classification` field, since `classifyWorkspace()` is never called. Correct.
- **Error (normal-clone)** (line 109-116): Includes `classification`. Correct.
- **Error (not-git, standard-bare, malformed)** (line 127-132): Includes `classification`. Correct.
- **Applied** (line 176-183): Includes `classification`. Correct.

The `classification` field is computed exactly once (the existing `classifyWorkspace()` call at line 97) and threaded through every post-detection return path. No duplicate calls were introduced.

### up.ts: Phase 0a Project Name Computation

**No issues.**

Lines 137-161 handle the project name derivation cleanly:

```typescript
let projectName: string = basename(workspaceFolder);
// ...
if (layoutResult.classification) {
  projectName = deriveProjectName(layoutResult.classification, workspaceFolder);
}
```

The fallback to `basename(workspaceFolder)` when `classification` is undefined (the "skipped" case, meaning no workspace config) is correct.
This means normal workspaces without `customizations.lace.workspace` still get a sensible project name.
The error cases where `skipValidation` is false cause early return before `projectName` is used, so the fallback value is harmless there.
The error case where `skipValidation` is true still computes `projectName` from the classification, which is also correct: the classification is populated on error paths.

### up.ts: GenerateExtendedConfigOptions Threading

**Non-blocking.** Minor style inconsistency.

The `projectName` field was added to `GenerateExtendedConfigOptions` at line 577 as `projectName?: string` (optional).
It is passed from `runUp()` at line 527.
Inside `generateExtendedConfig()`, `projectName` is accessed via `options.projectName` (lines 673-676) rather than through the destructuring block at lines 588-595.
This is functionally correct but inconsistent with the other fields that are all destructured.
Not worth a blocking change, but worth noting for future cleanup.

### up.ts: runArgs Injection in generateExtendedConfig()

**No issues.**

Lines 672-681:

```typescript
if (options.projectName) {
  const runArgs = (extended.runArgs ?? []) as string[];
  runArgs.push("--label", `lace.project_name=${options.projectName}`);
  const sanitized = sanitizeContainerName(options.projectName);
  if (!hasRunArgsFlag(runArgs, "--name")) {
    runArgs.push("--name", sanitized);
  }
  extended.runArgs = runArgs;
}
```

Key correctness points verified:

1. **Label uses raw project name**: `options.projectName` is unsanitized in the label value. Correct per proposal.
2. **--name uses sanitized name**: `sanitizeContainerName(options.projectName)` produces a Docker-safe name. Correct.
3. **User override respected**: `hasRunArgsFlag(runArgs, "--name")` checks the current `runArgs` array (which already contains user entries from the config). If the user provided `--name`, no second `--name` is injected.
4. **Label is always injected**: The label push is unconditional within the `if (options.projectName)` guard. Even when the user provides `--name`, the label is still added.
5. **Existing runArgs preserved**: The code reads existing `runArgs` with `(extended.runArgs ?? [])` and appends, never replaces.

### project-name.ts: hasRunArgsFlag

**No issues.**

The implementation `arg === flag || arg.startsWith(\`${flag}=\`)` correctly handles:

- Space form: `["--name", "foo"]` matches `arg === "--name"`.
- Equals form: `["--name=foo"]` matches `arg.startsWith("--name=")`.
- Similar prefix (space): `["--namespace", "x"]` does NOT match `"--namespace" === "--name"` (false). Correct.
- Similar prefix (equals): `["--namespace=x"]` does NOT match `"--namespace=x".startsWith("--name=")` (false, because `--namespace=` is not `--name=`). Correct.

All six test cases in `project-name.test.ts` (lines 145-169) cover this matrix.

### workspace-layout.test.ts: Classification Threading Tests

**No issues.**

Three tests at lines 468-512 cover the classification field:

1. "exposes worktree classification on applied result": Uses real `createBareRepoWorkspace`, verifies `classification.type === "worktree"`. Correct.
2. "exposes classification on error result (normal-clone)": Uses `createNormalCloneWorkspace` with a bare-worktree config, verifies `classification.type === "normal-clone"`. Correct.
3. "does not expose classification on skipped result": Uses an empty config, verifies `classification` is undefined. Correct.

These three tests cover the three `status` outcomes (applied, error, skipped), which is the right boundary.

### up-project-name.integration.test.ts

**Non-blocking.** One gap in the test matrix.

The integration tests cover 5 scenarios against the full `runUp()` pipeline:

1. **Normal workspace injection** (line 92): Verifies label and --name appear in generated config. Correct.
2. **User --name space form** (line 116): Verifies user's `--name my-custom` is preserved, label still injected, no duplicate `--name`. Correct.
3. **User --name= equals form** (line 147): Same as above for equals form. Correct.
4. **Existing runArgs preserved** (line 177): Verifies `--label other=value --cap-add SYS_PTRACE` are all still present alongside the new entries. Correct.
5. **Worktree workspace** (line 206): Creates a real bare-repo workspace with `createBareRepoWorkspace`, runs `runUp()`, verifies project name is `"my-project"` (repo name) not `"main"` (worktree name). Correct and thorough.

**Missing from proposal matrix:**
- "Sanitized name differs from label": The proposal specifies a test where the workspace dir name contains special characters, verifying the `--label` value is unsanitized while `--name` is sanitized. This test is absent. While `sanitizeContainerName` is unit-tested in `project-name.test.ts`, verifying the divergence between label and name in the integration path would close the loop.

This is non-blocking because the unit tests for `sanitizeContainerName` cover the sanitization logic, and the integration tests verify the plumbing. The gap is that no single test asserts both values side-by-side in the generated config to confirm label is raw and name is sanitized.

### Test Infrastructure

**No issues.**

The integration test follows the established pattern from `up-mount.integration.test.ts`:
- Temp directory per test with cleanup in `afterEach`.
- Mock subprocess.
- `LACE_SETTINGS` env var override.
- `clearMetadataCache` calls.
- `trackProjectMountsDir` for mount directory cleanup.
- `skipDevcontainerUp: true` to isolate config generation.

The worktree test (line 206) is particularly well-structured: it creates a real bare repo workspace, writes the devcontainer.json into the worktree, and reads the generated config from the worktree's `.lace/` directory.

## Verdict

**Accept.**

The implementation is correct, complete, and well-tested.
Classification threading covers all return paths in `applyWorkspaceLayout()`.
The `hasRunArgsFlag` function handles both forms without false-positive prefix matches.
User-provided `runArgs` are never clobbered.
The label value is unsanitized (raw project name) while the `--name` value is sanitized.
The integration tests cover the proposal's test matrix with one non-blocking omission.

## Action Items

1. [non-blocking] Add a "sanitized name differs from label" integration test: create a workspace with special characters in the directory name (e.g., `"my project!"`) and assert that the `--label` value contains the raw name while the `--name` value contains the sanitized form. This completes the proposal's Phase 2 test matrix.
2. [non-blocking] Consider destructuring `projectName` alongside the other fields in `generateExtendedConfig()` at line 588-595 for consistency, then using the local variable instead of `options.projectName`.
