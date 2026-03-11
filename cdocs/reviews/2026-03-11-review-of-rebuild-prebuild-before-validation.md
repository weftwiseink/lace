---
review_of: cdocs/proposals/2026-03-11-rebuild-prebuild-before-validation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T13:00:00-06:00
task_list: lace/up-pipeline
type: review
state: live
status: done
tags: [self, pipeline-ordering, rebuild, prebuild, no-cache, architecture, test_plan, edge_cases]
---

# Review: Reorder `lace up` Pipeline: Run Prebuild Before Validation When `--rebuild` Is Set

## Summary Assessment

This proposal addresses a real chicken-and-egg deadlock in the `lace up`
pipeline where git extension validation blocks the prebuild that would
fix the issue. The dependency analysis is correct: prebuild genuinely
does not depend on workspace layout or host validation outputs. The
amended `--no-cache` addition is well-motivated by a real user scenario
and correctly targets the Docker build cache problem. The proposal is
thorough, with good edge case coverage and clear design decision
documentation. There are two blocking issues (fragile string matching
for error discrimination and an inaccuracy in edge case E2) and several
non-blocking improvements.

## Section-by-Section Findings

### BLUF and Objective

**Non-blocking.** The BLUF is clear and actionable. The amended
`--no-cache` paragraph integrates naturally. Minor style note: the BLUF
blockquote is getting long (7 sentences). Consider trimming the
`--no-cache` addition to one sentence since the details are covered in
the new "Docker Build Cache Problem" section.

### Background: The Chicken-and-Egg Problem

**No issues.** The pipeline ordering is accurately described and matches
the source code in `up.ts`. Phase numbers align with the actual code
structure.

### Background: Docker Build Cache Problem

**No issues.** The new section clearly explains why lace-level cache
bypass is insufficient and why Docker-level `--no-cache` is needed. The
user scenario is concrete and compelling. Verified that `--no-cache` is
a valid `devcontainer build` flag (confirmed via `devcontainer build
--help`).

### Background: What Phases Depend on What

**No issues.** The dependency table is accurate. Verified against
`up.ts`: `runPrebuild()` receives `workspaceRoot`, `subprocess`, and
`force` -- none of which come from workspace layout or host validation.
The key insight that prebuild and validation are independent is correct.

### Proposed Solution: Pipeline Reorder

**No issues.** The conditional reorder approach is sound. The two
pipeline diagrams clearly show the before/after. The "Why Prebuild Can
Move Earlier" analysis correctly identifies the minimal dependencies.

### Implementation Detail: Pipeline Reorder in `runUp()`

**Blocking: The proposal places the early prebuild block "after the
`hasPrebuildFeatures` extraction (line ~207)" but `hasPrebuildFeatures`
is extracted at line 207 AFTER Phase 0a (line 140) and Phase 0b (line
177).** The early prebuild block must be inserted between config reading
(line 138) and Phase 0a (line 140). This requires also moving the
`hasPrebuildFeatures` extraction earlier, before the early prebuild
conditional. The proposal's pseudocode shows the correct logical
ordering (prebuild before Phase 0a) but the file location reference
points to the wrong line. The implementation phase description should
clarify that `hasPrebuildFeatures` must be extracted earlier when
`rebuild` is true.

### Implementation Detail: `--no-cache` in `runPrebuild()`

**No issues.** The code snippet is correct. The conditional
`--no-cache` flag properly gates on `options.force`. The line reference
(~287) is accurate for the current `prebuild.ts`.

### Handling the Validation After Early Prebuild

**Blocking: String-based error discrimination is fragile.** The code
uses `layoutResult.message.includes("git extensions")` to distinguish
extension errors from other layout errors. This is brittle -- if the
error message wording changes in `workspace-layout.ts`, the detection
silently breaks and `--rebuild` stops working for extensions.

A more robust approach: `applyWorkspaceLayout` already uses structured
warning codes (`"unsupported-extension"`, `"absolute-gitdir"`) in the
`WorkspaceWarning` objects. The `WorkspaceLayoutResult` could carry
forward a structured error code (e.g., `errorCode?: string`) alongside
the message. Alternatively, since the proposal constrains itself not to
modify `workspace-layout.ts`, the `runUp()` code could inspect
`layoutResult.warnings` for warnings with `code ===
"unsupported-extension"` AND `layoutResult.status === "error"`. The
warnings array is already populated before the early return, so this
would work without changing `applyWorkspaceLayout`.

Specifically, the warnings array in `WorkspaceLayoutResult` always
contains the raw `WorkspaceWarning` objects' messages. But looking at
the code more carefully, `layoutResult.warnings` is an array of strings
(formatted messages), not the raw warning objects. The structured
`result.warnings` (with `.code`) is local to `applyWorkspaceLayout` and
not exposed. So the cleanest fix within the "no modify
workspace-layout.ts" constraint would be to match on a more specific
substring that is less likely to change, or to relax the constraint and
add an `errorCode` field to `WorkspaceLayoutResult`. The latter is
minimal and much safer.

### Edge Case E2: Workspace Has Non-Extension Errors

**Blocking: E2's description is inaccurate.** The proposal says "The
extension warning is downgraded but the absolute-gitdir error blocks the
pipeline." But `applyWorkspaceLayout` checks absolute gitdir BEFORE
extensions (lines 108-121 vs 124-140 in `workspace-layout.ts`). When
both are present, the function returns at the absolute-gitdir check and
the extension error never appears in `layoutResult.message`. The string
match for "git extensions" would fail, and the code would correctly
treat it as a fatal non-extension error. The outcome is correct (the
pipeline blocks) but the reasoning in the proposal is wrong -- it
implies both errors are returned and one is downgraded while the other
blocks. In reality, only the absolute-gitdir error is returned.

Update E2 to reflect this: "When both are present,
`applyWorkspaceLayout` returns the absolute-gitdir error first (it
checks before extensions). The string match does not find 'git
extensions', so the error is treated as fatal. The extension issue is
never surfaced in this case."

### Edge Case E5: Config Has Prebuild Features But No Git Feature

**Non-blocking.** This edge case is well-identified but the warning
message could be more actionable. Consider suggesting the user add the
git feature to their `prebuildFeatures` with `"version": "latest"`.

### Edge Case E6: `--no-cache` Build Takes Longer

**No issues.** The trade-off is well-reasoned. The `--no-cache` flag
only applies when `force` is true, preserving Docker cache benefits for
normal operation.

### Edge Case E7: Workspace Layout Mutations Needed Before Prebuild

**No issues.** Verified: `runPrebuild()` reads `devcontainer.json`
directly via `readDevcontainerConfig()` and does not consume any
workspace layout mutations. The mutations (workspaceMount,
workspaceFolder, postCreateCommand) only affect the generated extended
config later in the pipeline.

### Test Plan

**Non-blocking: T1 asserts `result.exitCode === 0` but the test
workspace has git extensions.** After the early prebuild, Phase 0a still
runs and the extension error is downgraded. But the rest of the pipeline
(metadata fetch, template resolution, etc.) also needs to succeed for
`exitCode === 0`. The test would need to mock not just `devcontainer
build` but also metadata fetch, port allocation, and potentially mount
resolution. The test description should note this or explicitly state
that `skipDevcontainerUp: true` and other simplifications are used.

**Non-blocking: T4 says "absolute gitdir paths (not git extensions)"
but the test should also verify the mock subprocess call log** to
confirm prebuild was actually invoked (early) before the validation
error. Without this, the test could pass even if the reorder did not
happen.

**Non-blocking: T7 and T8 reference `prebuild.test.ts` but the existing
test file is `prebuild.integration.test.ts`.** The test plan should
reference the correct filename or explicitly state a new file is being
created. Given the existing infrastructure in
`prebuild.integration.test.ts` with mock subprocess runners, adding
T7/T8 there would be most natural.

### Implementation Phases

**No issues with the phasing.** Phase 1 correctly bundles both the
reorder and `--no-cache` changes since they are tightly related (both
serve the `--rebuild` use case). Phase 2 for tests is appropriate. The
constraint that `workspace-layout.ts` is not modified may need to be
relaxed per the string-matching finding above.

### Design Decisions

**No issues.** The decisions are well-reasoned. The conditional reorder
vs. two pipeline functions decision is correct -- maintaining two
pipeline paths would be a maintenance burden for a single-phase
position change.

## Verdict

**Revise.** The proposal is well-structured and the core approach is
sound. Three issues must be addressed before acceptance:

1. The fragile string-matching for error discrimination needs a more
   robust mechanism.
2. Edge case E2 contains an inaccurate description of how combined
   errors are handled.
3. The implementation phase references the wrong insertion point (line
   ~207 is after Phase 0a, not before it).

## Action Items

1. [blocking] Replace `layoutResult.message.includes("git extensions")`
   with a more robust error discrimination mechanism. Recommended: add
   an `errorCode?: string` field to `WorkspaceLayoutResult` (relaxing
   the "do not modify workspace-layout.ts" constraint minimally) or use
   warning inspection on the `layoutResult.warnings` array.
2. [blocking] Fix E2 description to accurately reflect that
   `applyWorkspaceLayout` returns only the first error encountered
   (absolute-gitdir takes priority over extensions) and the extension
   error is never surfaced when both are present.
3. [blocking] Fix the implementation phase to clarify that
   `hasPrebuildFeatures` extraction must be moved earlier (before
   Phase 0a) when `rebuild` is true, since the current extraction point
   (line ~207) is after both validation phases.
4. [non-blocking] Trim the BLUF `--no-cache` addition to one sentence
   to keep the summary concise.
5. [non-blocking] T1 should document required mock setup for the full
   pipeline to succeed (metadata, ports, etc.) or explicitly use
   `skipDevcontainerUp: true` and note which phases are stubbed.
6. [non-blocking] T4 should verify mock subprocess call log to confirm
   prebuild was invoked before validation, not just that validation
   failed.
7. [non-blocking] T7/T8 should reference the correct existing test file
   (`prebuild.integration.test.ts`) or note that a new file is created.
