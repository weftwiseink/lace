---
review_of: cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T17:00:00-06:00
task_list: worktrunk/project-naming
type: review
state: live
status: done
tags: [fresh_agent, rereview_agent, architecture, test_plan, naming, container-naming, edge_cases, runargs_merging]
---

# Review (R2): Worktrunk-Aware Project Naming and Container Identity

## Summary Assessment

This proposal defines a three-component pipeline (name derivation, label + container name injection, label-based discovery) to fix the `basename`-based naming breakage under the worktrunk layout.
The revision successfully addresses both blocking items from the R1 review: the classification threading gap is resolved via an explicit `WorkspaceLayoutResult` extension, and `standard-bare` is covered in both the naming rules and test plan.
The most significant additions in this revision are the `--name` injection (previously deferred), the `hasRunArgsFlag()` helper, and the container name sanitization strategy: these are well-motivated and substantially increase the proposal's scope while keeping the design clean.
The most important remaining finding is that `hasRunArgsFlag()` can produce a false positive on flags like `--network` when scanning for `--name`, because the `startsWith` check on `--name=` also matches `--name-something=`.

Verdict: **Revise** - one blocking issue (false-positive prefix match in `hasRunArgsFlag`) and several non-blocking improvements.

## Prior Review Resolution

The R1 review raised 2 blocking and 5 non-blocking items.

| # | Item | Status |
|---|------|--------|
| 1 | [blocking] Specify how `WorkspaceClassification` flows to `generateExtendedConfig` | Resolved. Phase 2 (lines 415-418) explicitly extends `WorkspaceLayoutResult` with `classification?: WorkspaceClassification`. |
| 2 | [blocking] Add `standard-bare` test case | Resolved. Test plan table (line 351) includes `standard-bare`. |
| 3 | [non-blocking] Use `docker ps --format` with label template | Resolved. Phase 3 (lines 442-446) specifies the `{{.Label "lace.project_name"}}` template approach. |
| 4 | [non-blocking] Reconcile line count estimates | Partially addressed. BLUF now says "~60 lines TS, ~15 bash" reflecting added `--name` scope. Options analysis not updated (separate doc, predates `--name` decision). Acceptable. |
| 5 | [non-blocking] List `standard-bare` in naming rules | Resolved. Line 135 explicitly includes it. |
| 6 | [non-blocking] Note `~` invalid in Docker container names | No longer applicable. `~` separator removed entirely. |
| 7 | [non-blocking] Concurrent-worktrees E2E test | Not addressed. Still a gap; see action items. |

## Section-by-Section Findings

### BLUF

Strong.
Accurately summarizes the three components, the worktree exclusion rationale, and the scope of change.
The BLUF correctly reflects the revised design (no `~` separator, no per-worktree naming, `--name` injection included).

No issues.

### Objective

Clean framing.
The three naming surfaces (lace-discover, discover_stopped, Docker container name) are correctly identified with accurate line number references.
The upstream issue link (vscode-remote-release#2485) and community workaround are useful context.

No issues.

### Background: Existing Infrastructure

The `applyWorkspaceLayout()` description (lines 85-92) now correctly identifies that `WorkspaceLayoutResult` does not expose the `WorkspaceClassification` and states the extension is needed.
This directly addresses the R1 blocking finding.

No issues.

### Proposed Solution: Component 1

The `deriveProjectName()` function signature and naming rules are clear.
All `WorkspaceClassification` variants are now explicitly listed, including `standard-bare` (line 135).

**Non-blocking:** The function is described as taking `(classification, workspacePath)`.
For `worktree` and `bare-root` types, the name comes from `bareRepoRoot`, not `workspacePath`.
The proposal should note that `workspacePath` is only used as a fallback for types that lack `bareRepoRoot` (`normal-clone`, `standard-bare`, `not-git`, `malformed`).
This is already implicit in the naming rules, but making it explicit improves implementor clarity.

### Proposed Solution: Component 2 (Label + Name Injection)

The code sketch is clear and correct.
The strategy of always injecting the label (additive, no conflict) and conditionally injecting `--name` (skip if user override detected) is sound.

**Blocking:** The `hasRunArgsFlag()` implementation has a false-positive prefix-match bug.

```typescript
function hasRunArgsFlag(runArgs: string[], flag: string): boolean {
  return runArgs.some(arg => arg === flag || arg.startsWith(`${flag}=`));
}
```

When called with `flag = "--name"`, the `startsWith("--name=")` check also matches hypothetical flags like `"--namespace=foo"`.
Looking at the test plan table (line 365), there is a test for `"--namespace"` with the space form (`["--namespace", "x"]`), which correctly returns `false` because `"--namespace" !== "--name"`.
However, the equals form (`["--namespace=x"]`) is NOT tested and would return `true` because `"--namespace=x".startsWith("--name=")` is... actually false, because `"--namespace=x"` starts with `"--namespace="`, not `"--name="`.

Wait: `"--namespace=x".startsWith("--name=")` evaluates to `false` because the 7th character of `"--namespace=x"` is `s`, not `=`.
So the prefix match is actually correct: `startsWith("--name=")` only matches strings where the 7th character is `=`.

Let me reconsider.
`"--name="` is 7 characters.
`"--namespace=x"` has `"--names"` as its first 7 characters (n-a-m-e-s), not `"--name="`.
So `"--namespace=x".startsWith("--name=")` is `false`.
The implementation is correct.

Retracting the blocking finding. The `startsWith("--name=")` check is safe against `--namespace=` because the `=` must appear at exactly position 6 (0-indexed) for the prefix to match.
The test plan's "Similar prefix" case (line 365, `["--namespace", "x"]`) covers the space form.
Adding the equals form (`["--namespace=x"]`) would strengthen confidence but is non-blocking.

**Non-blocking:** The `hasRunArgsFlag()` helper handles `--name value` and `--name=value` forms.
There is a third form worth considering: short flags.
Docker's `--name` does not have a short form (unlike `-p` for `--publish`), so this is not a concern for `--name` specifically.
However, if `hasRunArgsFlag()` is used for other flags in the future, the short-form gap should be noted.
For the current scope, this is fine.

### Proposed Solution: Component 3 (Discovery Update)

The label-read-with-basename-fallback approach is straightforward and correctly specified.
Using `{{.Label "lace.project_name"}}` in the `docker ps --format` template (as specified in Phase 3) avoids the N+1 `docker inspect` calls flagged in R1.

No issues.

### Naming Examples Table

Comprehensive.
All `WorkspaceClassification` variants are represented.
The "Multiple repos, same name" rows (lines 192-193) honestly acknowledge the collision, and the NOTE callout proposes `customizations.lace.project` as a future escape hatch.

No issues.

### Design Decisions

All four decisions are well-reasoned.

**Decision: Worktree name excluded from project name** - The rationale is strong.
The worktrunk model mounts the bare repo root, so all worktrees are siblings inside one container.
The argument against including worktree names (would imply separate containers, would require separator and primary-branch stripping heuristic) is convincing.

**Decision: Inject `--name`** - Good reversal from the options analysis's "defer" recommendation.
The justification (opaque names are bad UX, user-override detection is ~3 lines, collision is manageable) is persuasive.

**Non-blocking:** The collision handling (lines 225-231) says the `--name` collision "only happens when" a non-lace container has the same name or same-named repos in different orgs.
There is a third collision scenario not mentioned: if the user manually runs `docker run --name lace ...` for a non-devcontainer workload.
This is covered by case 1 ("non-lace container coincidentally has the same name") but could be more explicitly called out.

**Decision: Store name as Docker label** - The rationale for centralizing naming in TypeScript is sound.
The label immutability concern is correctly noted with the migration path (basename fallback).

**Decision: No change to prebuild image naming** - Correctly deferred.

### Edge Cases

Thorough and well-analyzed.

**Same repo name in different orgs** (lines 289-299):
The analysis is honest about the `--name` failure mode on the second `lace up`.
The statement "The second container falls back to Docker's auto-generated name" (line 295) deserves verification: does the devcontainer CLI gracefully handle a `--name` collision in `runArgs`, or does it surface a hard error?
The devcontainer CLI invokes `docker run` with the provided `runArgs`; if `--name` collides, Docker returns exit code 125 with `"Conflict. The container name ... is already in use"`.
The devcontainer CLI does NOT catch this and retry without `--name`.

**Blocking:** Line 294-295 states: "The second container falls back to Docker's auto-generated name (lace doesn't retry with a different name)."
This is inaccurate. Docker does not "fall back" to an auto-generated name on `--name` collision; it fails with a hard error.
The sentence should say the second `lace up` fails with a Docker name-conflict error, and the user must resolve it (rename the conflicting container, remove it, or add a `--name` override in their devcontainer.json).
The resolution options listed in lines 298-299 are correct, but the failure mode description on line 295 is wrong.

**Container name character sanitization** (lines 310-314):
The split strategy (label stores unsanitized, `--name` gets sanitized) is sound.
Label values have no character restrictions, so the unsanitized name preserves full fidelity for discovery.
The sanitized name in `--name` ensures Docker compatibility.

**Non-blocking:** The sanitization spec says "replacing invalid characters with `-` and stripping leading non-alphanumeric characters."
This could produce an empty string if the basename is entirely non-alphanumeric (e.g., a directory named `---`).
After stripping leading non-alphanumeric and replacing all remaining characters with `-`, you get an empty string.
The sanitization function should have a fallback for this (e.g., `"lace-project"` as a default).
This is extremely unlikely in practice but worth noting for robustness.

**User-provided `--label lace.project_name`** (lines 316-322):
The analysis states "the last one wins" for duplicate Docker labels.
This is correct for `docker run`: when the same label key is specified multiple times via `--label`, the last value takes precedence.
Since lace appends its `--label` after the existing `runArgs`, lace's value wins.
The desired precedence (lace-derived name is authoritative) is correctly achieved.

**`runArgs` merging with existing entries** (lines 335-338):
The merge strategy (append `--label` always, append `--name` only if not present) is correctly specified.

### Test Plan

**Non-blocking:** The sanitization test case (line 355) shows input `/tmp/my project!` expected output `"my-project-"`.
The trailing `-` (from replacing `!`) is technically valid per Docker's charset (`[a-zA-Z0-9][a-zA-Z0-9_.-]`), but trailing punctuation in names is awkward.
Consider stripping trailing non-alphanumeric characters as well, producing `"my-project"`.
This is a design choice, not a correctness issue.

**Non-blocking:** The `hasRunArgsFlag` test table (lines 357-365) is solid.
Consider adding the equals form of the "Similar prefix" case: `["--namespace=x"]`, `"--name"` -> `false`.
This would confirm the `startsWith` check does not produce false positives on flags with overlapping prefixes in the equals form.

**Non-blocking:** The integration tests (lines 367-375) cover label injection, name injection, user-provided `--name` preservation, and `runArgs` merging.
Missing: a test for the sanitization pipeline end-to-end (project name with invalid Docker characters flows through `generateExtendedConfig` and produces a sanitized `--name` but unsanitized label value).

**Non-blocking:** The manual/E2E tests (lines 377-385) do not include a test for the `--name` collision scenario (same project name, second `lace up` fails).
This is the highest-risk new behavior and deserves at least manual verification.

### Implementation Phases

The four phases are well-sequenced.
Phase 1 is pure and isolated (no existing files modified).
Phase 2 correctly lists the `WorkspaceLayoutResult` extension and the `hasRunArgsFlag()` helper.
Phase 3 correctly uses the `docker ps --format` label template.
Phase 4 is manual verification.

**Non-blocking:** Phase 2 success criteria (lines 427-432) include "Container has a human-readable name matching the project name."
This criterion should note that the name is the *sanitized* form of the project name, not necessarily identical.
For most repos this is the same, but for repos with special characters it would differ.

### Open Questions

All five questions are resolved with consistent answers.
The resolutions align with the design decisions and implementation plan.

No issues.

## Consistency Check: Revision Artifacts

The proposal was revised to remove the `~` separator and per-worktree naming.
Scanning for stale references:
- No `~` separator references remain (only `~` in line count estimates and markdown strikethrough).
- Lines 209-210 mention separator and primary-branch stripping in the past tense, explaining why they were excluded. This is appropriate.
- The options analysis report still discusses `~` separators and primary-branch stripping. This is expected: the options analysis is a separate document that predates the decision, and its content is not stale (it documents the analysis, not the decision).

The proposal is self-consistent after revision.

## Verdict

**Revise.**

One blocking item: the inaccurate failure mode description for the same-name collision edge case (line 295 claims Docker "falls back" to an auto-generated name, but Docker actually fails with a hard error).
All other findings are non-blocking improvements.
The overall design is sound and the revision successfully addressed all R1 blocking items.

## Action Items

1. [blocking] Correct the same-name collision failure mode description (line 294-295). Docker does not fall back to an auto-generated name when `--name` collides; it fails with exit code 125 and a "Conflict" error. The sentence should describe this as a hard failure, not a silent fallback. The resolution options on lines 298-299 are already correct.
2. [non-blocking] Add a sanitization fallback for the degenerate case where the basename is entirely non-alphanumeric (produces an empty string after sanitization). A default like `"lace-project"` prevents a Docker error from an empty `--name`.
3. [non-blocking] Add the equals-form "Similar prefix" test case for `hasRunArgsFlag`: `["--namespace=x"]`, `"--name"` -> `false`.
4. [non-blocking] Add an integration test verifying that sanitization produces different values for `--name` (sanitized) and `--label` (unsanitized) when the project name contains special characters.
5. [non-blocking] Add a manual/E2E test for the `--name` collision scenario: run `lace up` for two same-named repos, verify the second fails with a clear Docker conflict error.
6. [non-blocking] Consider stripping trailing non-alphanumeric characters from sanitized container names (e.g., `"my-project-"` -> `"my-project"`).
7. [non-blocking] Add the concurrent-worktrees E2E test from R1 (two worktrees, verify `lace-discover` outputs one entry, not two).
8. [non-blocking] Phase 2 success criteria should note that the container name is the sanitized form of the project name, which may differ from the label value.
