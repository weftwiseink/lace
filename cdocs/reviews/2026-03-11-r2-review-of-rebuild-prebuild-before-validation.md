---
review_of: cdocs/proposals/2026-03-11-rebuild-prebuild-before-validation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T15:18:38-07:00
task_list: lace/up-pipeline
type: review
state: live
status: done
tags: [fresh_agent, pipeline-ordering, rebuild, prebuild, no-cache, architecture, validation-false-positive, ux]
---

# Review (Round 2): Reorder `lace up` Pipeline: Run Prebuild Before Validation When `--rebuild` Is Set

## Summary Assessment

This proposal addresses a real chicken-and-egg deadlock where git extension
validation blocks the prebuild that would fix the detected issue. The round 1
review raised three blocking items (fragile string-matching, E2 inaccuracy,
line reference error) -- all three have been addressed in the amended proposal.
The `errorCode` addition to `WorkspaceLayoutResult` is a clean, minimal
approach. The `--no-cache` addition is well-motivated and correctly scoped. One
new blocking concern surfaces on closer inspection: the E3 "subsequent runs
still fail" scenario represents a validation false positive that should not be
deferred to a vague Phase 3 -- it needs a concrete commitment. Verdict:
**Revise** on one blocking item; the core approach is sound.

## Prior Review Round Resolution

The round 1 review raised three blocking items:

1. **String-matching fragility** -- Resolved. The proposal now adds a
   structured `errorCode` field to `WorkspaceLayoutResult` with a union type
   (`"absolute-gitdir" | "unsupported-extension" | "layout-mismatch" |
   "detection-failed"`). The `runUp()` discrimination code uses `errorCode`
   rather than `message.includes()`. Verified that the four codes cover all
   error branches in `applyWorkspaceLayout`:
   - `normal-clone` at line 110 → `"layout-mismatch"`
   - `not-git`/`standard-bare`/`malformed` at line 120 → `"detection-failed"`
   - `absoluteGitdirWarnings` at line 189 → `"absolute-gitdir"`
   - `extensionWarnings` at line 205 → `"unsupported-extension"`

2. **E2 inaccuracy** -- Resolved. E2 now correctly states that
   `applyWorkspaceLayout` returns only the absolute-gitdir error (it checks
   before extensions, lines 186-198 vs 201-218), and the extension check never
   executes when both are present.

3. **Line reference error** -- Resolved. The implementation phase now correctly
   references "between config reading (line ~138) and Phase 0a (line ~140)"
   and notes that `hasPrebuildFeatures` must be extracted earlier.

## Section-by-Section Findings

### BLUF and Objective

**No issues.** Clear, actionable, and covers both the reorder and `--no-cache`
aspects.

### Background: Chicken-and-Egg Problem

**No issues.** Accurately describes the pipeline ordering in `up.ts`. Verified:
Phase 0a is at line 140, prebuild is at line 557. The dependency analysis
correctly shows they are independent.

### Background: Docker Build Cache Problem

**No issues.** The `--no-cache` rationale is sound. Verified that
`devcontainer build` is invoked at `prebuild.ts:287-298` without `--no-cache`
currently. The floating-tag scenario (git feature with `"version": "latest"`)
is a real Docker caching pitfall.

### Proposed Solution: Conditional Phase Reorder

**No issues.** The conditional block approach is the right granularity. The
`prebuildCompleted` flag cleanly prevents double-execution without requiring
two separate pipeline functions.

### Implementation Detail: errorCode on WorkspaceLayoutResult

**No issues.** The union type is well-chosen. The `errorCode` is optional
(backwards-compatible) and only set on error branches. Each existing error
return maps cleanly to a code. The `runUp()` discrimination code is concise
and type-safe.

### Implementation Detail: --no-cache in runPrebuild()

**No issues.** Verified the insertion point at `prebuild.ts:287-298`. The
conditional `if (options.force) { buildArgs.push("--no-cache"); }` is clean
and correctly scoped. The `devcontainer build` arg array is constructed before
the call at line 287, so pushing `--no-cache` before the `run()` call is
straightforward.

### Handling the Validation After Early Prebuild

**No issues with the mechanism.** The targeted downgrade (only
`unsupported-extension`, not all errors) is correct. Using `errorCode` instead
of string-matching is robust.

### Edge Case E3: Subsequent `lace up` Without `--rebuild`

**Blocking: E3 represents a validation false positive, not a known
limitation.** After a successful `--rebuild`, the container image has git 2.53
which fully supports `relativeWorktrees`. But the next `lace up` (normal run)
fails validation because `applyWorkspaceLayout` checks the host repo config,
assumes the container can't handle the extensions, and has no way to know the
image was already fixed.

The proposal frames this as "the user must use `--skip-validation`" and defers
a fix to a vague Phase 3. But `--skip-validation` is a blunt instrument -- it
suppresses ALL validation, not just the extension check. Requiring it on every
subsequent run is poor UX and defeats the purpose of the validation system.

The metadata marker approach described in the Phase 3 NOTE is the right fix
and is small enough to include in this proposal's scope:

- After early prebuild succeeds with `--rebuild`, write a
  `gitFeatureVersion` field to `.lace/prebuild/metadata.json` (which
  `runPrebuild` already writes at line 331-336).
- In `applyWorkspaceLayout` (or in `runUp()`'s error handling), read the
  metadata marker. If `gitFeatureVersion` indicates git 2.48+, suppress the
  `unsupported-extension` error automatically.
- This is a small addition to the already-planned metadata write and a
  read in the validation path. No new files, no new infrastructure.

If this must stay out of scope, at minimum promote Phase 3 to a concrete
commitment: create an RFP and reference it from the proposal so it does not
get forgotten.

### Edge Case E5: Config Has Prebuild Features But No Git Feature

**Non-blocking.** The warning message variant is appropriate. One refinement:
the warning could suggest adding the git feature to `prebuildFeatures` with
`"version": "latest"` as actionable guidance rather than just warning about
the risk.

### Edge Case E6: --no-cache Build Takes Longer

**No issues.** The trade-off is well-reasoned. `--rebuild` signals explicit
intent.

### Design Decisions

**No issues.** All five decisions are well-reasoned. "Conditional Reorder, Not
Two Separate Pipeline Functions" is the clear right call. "Only Skip Extension
Errors, Not All Layout Errors" prevents `--rebuild` from masking real config
issues.

### Test Plan

**Non-blocking: T1's pipeline completeness.** T1 asserts `result.exitCode ===
0`, which requires the full pipeline (metadata, templates, mounts, generate,
up) to succeed or be stubbed. The test description should note which phases
are mocked/stubbed (at minimum `skipDevcontainerUp: true` and mock subprocess
for `devcontainer build`).

**Non-blocking: runPrebuild self-contained config read.** The proposal's
implementation detail (line 696-697) notes "the full config read must also
move into the early block." But `runPrebuild` already does its own
`readDevcontainerConfig` at `prebuild.ts:70`. The early `runUp()` call
doesn't need the full config read from `up.ts:540-555` -- `runPrebuild` is
self-contained. The existing full config read at line 540 becomes redundant
when `prebuildCompleted` is true but is harmless (reads the already-rewritten
Dockerfile). The implementation phase should clarify this to avoid confusion.

### Wasted Rebuild on Hard Errors

**Non-blocking (per user direction).** If the workspace has a non-extension
hard error (e.g., normal-clone layout mismatch), the early prebuild runs to
completion before the hard check fails. The user pays the full rebuild cost
for nothing. Running hard classification checks before early prebuild would
avoid this since hard checks have no chicken-and-egg issue. However, the user
has indicated "accept the cost" -- hard errors are rare and `--rebuild`
implies willingness to wait. The proposal's Decision section reasoning is
sound.

## Verdict

**Revise.** The core approach is sound and the round 1 blocking items are all
resolved. One new blocking item: the E3 false-positive validation failure on
subsequent runs should either be addressed in-scope (via the metadata marker)
or concretely committed as a fast-follow RFP, not left as a vague Phase 3
NOTE.

## Action Items

1. [blocking] Resolve E3: either include the metadata marker in Phase 1 scope
   (write `gitFeatureVersion` to `metadata.json` during early prebuild, read
   it during validation to suppress `unsupported-extension` automatically) or
   create an explicit RFP and reference it from this proposal so the UX gap
   has a tracking artifact.
2. [non-blocking] Clarify that `runPrebuild` is self-contained (does its own
   config read at `prebuild.ts:70`) and the full config read at `up.ts:540`
   does not need to move into the early block. Remove or amend the statement
   at line 696-697.
3. [non-blocking] T1 test description should document required mocks/stubs
   for the full pipeline to succeed.
4. [non-blocking] E5 warning message should suggest adding the git feature
   with `"version": "latest"` as actionable remediation.
