---
review_of: cdocs/proposals/2026-02-16-rfp-worktrunk-project-naming.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T15:00:00-06:00
task_list: worktrunk/project-naming
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, component_interaction, naming]
---

# Review: Worktrunk-Aware Project Naming and Container Identity

## Summary Assessment

This proposal addresses the `basename`-based project naming breakage caused by the worktrunk migration, where every primary worktree resolves to "main."
The design is well-structured: a three-component pipeline (derivation function, label injection, discovery update) with clear separation of concerns.
The BLUF accurately captures the full approach, the design decisions are well-reasoned with explicit deferral of container naming, and the implementation phases are sequenced for incremental delivery.
The most significant finding is a gap in how the classification result flows through the `lace up` pipeline: `applyWorkspaceLayout()` does not expose its internal `WorkspaceClassification` in its return type, requiring either a return-type change or a second `classifyWorkspace()` call.

Verdict: **Revise** - two blocking items related to the classification threading gap and a missing test case for `standard-bare` workspaces.

## Section-by-Section Findings

### BLUF

The BLUF is strong.
It captures the three-layer approach, the separator choice, the primary-branch stripping heuristic, the deferral of `--name` and image naming, and the estimated change size.
It references both the motivating devlog and the options analysis.

**Non-blocking:** The BLUF says "~50 lines of TypeScript, ~15 lines of bash."
The options analysis says "~40 lines of TypeScript, ~5 lines of bash."
These are estimates, so the discrepancy is minor, but having two different numbers in closely related documents is slightly confusing.

### Objective

Clear framing of the three naming surfaces that break.
Line number references are accurate: `lace-discover` line 73 (`name=$(basename "$local_folder")`) and `wez-into` line 125 (`name=$(basename "$local_folder")`) are correct.
The upstream issue reference (vscode-remote-release#2485) provides useful context.

No issues.

### Background

The "Current Naming Pipeline" diagram is useful.
Line references to `classifyWorkspace()` (workspace-detector.ts:57-169), `generateExtendedConfig()` (up.ts:579-673), and `applyWorkspaceLayout()` (workspace-layout.ts:79-178) are all verified correct against the source.

**Blocking:** The Background section states: "The classification result is available but not currently used for naming."
This is misleading.
`applyWorkspaceLayout()` runs `classifyWorkspace()` internally (workspace-layout.ts line 94), but its return type `WorkspaceLayoutResult` only exposes `{ status, message, warnings }`.
The `WorkspaceClassification` object is consumed and discarded within `applyWorkspaceLayout()`.
Phase 2 says to "Thread the classification result from `applyWorkspaceLayout()` through to `generateExtendedConfig()`" but does not specify how.

There are two options:
(a) Extend `WorkspaceLayoutResult` to include an optional `classification` field.
(b) Call `classifyWorkspace()` a second time directly in `runUp()` before calling `generateExtendedConfig()`.

Option (a) is cleaner and avoids redundant filesystem access.
Option (b) is simpler but runs the detection twice.
The proposal should specify which approach to use and note the return-type modification as a change in Phase 2.

### Proposed Solution

The three-component architecture (derivation, injection, discovery) is clean and well-motivated.
The code sketches for label injection and the naming examples table are clear.

The naming examples table at the end notes that same-named repos in different orgs produce collisions.
This is honestly acknowledged and the future escape hatch (`customizations.lace.project`) is reasonable.

**Non-blocking:** The function signature in Component 1 is `deriveProjectName(classification, workspacePath)`.
For the `worktree` and `bare-root` cases, `workspacePath` is not used (the name comes from `bareRepoRoot`).
For `normal-clone`, `not-git`, `standard-bare`, and `malformed`, the name comes from `basename(workspacePath)`.
This is fine, but the proposal should document that `standard-bare` repos fall into the "normal" basename path.
The `standard-bare` type is present in `WorkspaceClassification` but absent from the naming rules list.
See test plan finding below.

### Design Decisions

All five decisions are well-reasoned with clear rationale and explicit consideration of alternatives.

The `~` separator decision is solid.
One small clarification: the options analysis report's separator table marks `~` as "Docker name valid?" = "Yes", but `~` is actually NOT valid in Docker container names (`[a-zA-Z0-9][a-zA-Z0-9_.-]`).
This is a non-issue for the proposal since container naming is deferred and `~` only appears in label values (which have no character restrictions) and in discovery output.
But if container naming is ever added in the future, the separator would need to be transliterated (e.g., `~` to `-` in the container name).
This is a concern for the options analysis report, not this proposal.

The deferral of `--name` injection is the right call.
The collision failure mode analysis is particularly well done.

### Stories

All four stories are concrete and trace through the pipeline end-to-end.
Story 3 (pre-label migration) correctly identifies the `basename` fallback behavior.
Story 4 (stopped container restart) covers the `discover_stopped` path.

No issues.

### Edge Cases

Thorough coverage.
The stale `devcontainer.local_folder` edge case is especially well-analyzed: it correctly identifies that `basename` produces the right answer "by coincidence" for old containers but that `--start` would fail.

**Non-blocking:** The "User-provided `--label lace.project_name`" edge case states "the last one wins" for Docker labels.
This is correct for `docker run` behavior, but it is worth noting that this only applies at container creation time.
If a user has this in their base `devcontainer.json` and lace appends its own in the extended config's `runArgs`, the final Docker CLI invocation determines precedence.
Since lace's `generateExtendedConfig` appends to `runArgs` after reading existing entries, lace's label should indeed come last.
The analysis is correct, just could be slightly more explicit about the mechanism.

### Test Plan

**Blocking:** The unit test table covers `normal-clone`, `worktree` (three primary variants + non-primary), `bare-root`, `not-git`, and `malformed`, but omits `standard-bare`.
The `WorkspaceClassification` type union includes `standard-bare` (workspace-detector.ts line 27-28), which is a bare git repo that does NOT use the nikitabobko convention (no `.git` file, no `.bare/` directory).
`deriveProjectName()` should handle this case, presumably via `basename(workspacePath)`.
A test case should be added.

**Non-blocking:** The integration tests mention verifying `runArgs` merging preserves existing user-provided entries.
Consider also testing the case where `runArgs` already contains a `--label` entry (not `lace.project_name`, but any other label) to confirm the append does not clobber it.

**Non-blocking:** The manual/E2E test list is comprehensive.
Consider adding a test for the concurrent-worktrees scenario (Story 2): two worktrees with containers, verify `lace-discover` outputs both with distinct names.

### Implementation Phases

The four phases are well-sequenced with clear success criteria and constraints.
Phase 1 is isolated (no existing files modified), Phases 2-3 build incrementally, and Phase 4 is manual verification.

**Non-blocking:** Phase 2 says to modify `generateExtendedConfig()` to call `deriveProjectName()` with "the classification from Phase 0a."
As noted in the Background finding, the classification is not currently exposed by `applyWorkspaceLayout()`.
Phase 2's changes list should explicitly include either:
- Modifying `WorkspaceLayoutResult` to include an optional `classification?: WorkspaceClassification` field, or
- Adding a direct `classifyWorkspace()` call in `runUp()` after Phase 0a.

This is the implementation detail of the blocking finding above.

**Non-blocking:** Phase 3 mentions modifying `lace-discover` to read the label via `docker inspect`, but `lace-discover` currently uses `docker ps --format` for discovery (line 62-63).
Adding a `docker inspect` call for each container would add N additional Docker API calls (one per running container).
An alternative is to add the `lace.project_name` label to the `docker ps --format` template directly:
```bash
docker ps --filter "label=devcontainer.local_folder" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Label "lace.project_name"}}\t{{.Ports}}'
```
This retrieves the label in the same query with zero additional overhead.
The proposal should specify this approach.

### Open Questions

All five questions are marked resolved with clear answers.
The resolutions are consistent with the design decisions and implementation plan.

No issues.

## Verdict

**Revise.**

The proposal is well-designed and nearly complete.
Two blocking items need resolution before implementation can begin autonomously:

1. The classification threading gap must be explicitly addressed (how does `generateExtendedConfig` get the `WorkspaceClassification`?).
2. The `standard-bare` test case must be added.

## Action Items

1. [blocking] Specify how the `WorkspaceClassification` flows from `applyWorkspaceLayout()` to `generateExtendedConfig()`. Either extend `WorkspaceLayoutResult` to include the classification or add a direct `classifyWorkspace()` call in `runUp()`. Update Phase 2's changes list accordingly.
2. [blocking] Add a `standard-bare` test case to the unit test table (e.g., `{type:"standard-bare"}`, path `/code/bare-repo/` -> `"bare-repo"`).
3. [non-blocking] In Phase 3, specify using `docker ps --format` with `{{.Label "lace.project_name"}}` instead of a separate `docker inspect` call per container, to avoid N+1 Docker API calls.
4. [non-blocking] Reconcile the estimated line counts between the BLUF (~50 TS, ~15 bash) and the options analysis (~40 TS, ~5 bash).
5. [non-blocking] In the naming rules list (Component 1), explicitly mention how `standard-bare` workspaces are handled (basename of workspacePath).
6. [non-blocking] Note in the design decisions or edge cases that `~` is NOT valid in Docker container names, so if `--name` injection is added in the future, the project name would need transliteration for the container name.
7. [non-blocking] Consider adding a concurrent-worktrees E2E test (two worktrees, verify distinct discovery output).
