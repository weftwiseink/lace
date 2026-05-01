---
review_of: cdocs/proposals/2026-03-28-lace-up-validation-and-error-reporting.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-28T13:00:00-07:00
task_list: lace/validation-pipeline
type: review
state: live
status: done
tags: [fresh_agent, post_implementation, validation, test_coverage, architecture]
---

# Review: Post-Implementation Review of Validation, Log Persistence, and Debuggability

## Summary Assessment

This is a post-implementation review of five commits (`5a57f5b..9cc98c5`) implementing the proposal's five phases.
The implementation is faithful to the proposal's design in its core mechanics: mount attribution, stale detection, log persistence, debug footer, and the `lace validate` subcommand all work as specified.
All 1044 tests pass.
Two findings are blocking: the debug footer never includes `projectName` (deviating from the proposal template), and two early return paths in `runUp()` omit `logPath` from the returned result.
Overall quality is high, with clean separation of concerns and good test coverage.

## Prior Review Action Items

The R1 review identified two blocking items and five non-blocking items.
Disposition of each:

1. **[blocking] Log capture strategy**: Resolved. The proposal was updated to specify stderr-only capture, 100KB truncation (20KB head + 80KB tail), and `execSync` buffering. Implementation matches exactly.
2. **[blocking] Filename collision suffix**: Resolved. The proposal specifies `YYYY-MM-DDTHH-MM-SS-<6hex>.log`, and the implementation uses `crypto.randomBytes(3).toString('hex')`.
3. **[non-blocking] Non-validated mount parenthetical**: Resolved. The implementation shows `(auto-created directory)` for mounts without `sourceMustBe`.
4. **[non-blocking] Absolute paths in footer**: Resolved. All paths in `formatDebugFooter` are absolute (built via `join(workspaceFolder, ".lace", ...)`).
5. **[non-blocking] Extract footer into shared utility**: Resolved. `formatDebugFooter()` lives in `debug-footer.ts` and is used by both `up.ts` and `validate.ts`.
6. **[non-blocking] Drift detection output for validate**: Not addressed. The implementation does not add special phrasing for drift detection in validate mode. Low impact since the config drift check runs silently.
7. **[non-blocking] Subprocess stderr capture test**: Resolved. `run-log.test.ts` has a dedicated test "log file contains subprocess entries with stderr".

## Phase-by-Phase Findings

### Phase 1: Mount Validation with Full Attribution

**Implementation**: `up.ts` lines 714-773.

The `MissingMount` interface correctly includes `label` and `declaration` fields.
Cross-referencing uses `mountAssignments.find(a => a.resolvedSource === source)` to correlate resolved mounts back to their labels, then looks up the declaration by label.

The error format matches the proposal:
- Label and source on the first line (`  sprack/data: /path`)
- Target, feature provenance with `(sourceMustBe: directory)` or `(auto-created directory)`
- Remediation with `mkdir -p` and settings override

For static mounts without a label, the fallback format is: `  /path (static mount entry)`.

**Finding (non-blocking):** The attributed test at line 2196 of `up.integration.test.ts` tests the `sourceMustBe: "file"` path, which fails at Phase 7.5 (the earlier validated-mount check), not the Phase 3+ inferred mount scan.
There is no integration test that exercises the specific attributed format from the Phase 3+ scan with a declared mount that has `sourceMustBe: "directory"`.
This gap exists because `sourceMustBe: "directory"` mounts are auto-created, so they can't easily reach the missing-source scan.
The static mount test (line 2166) does exercise the fallback format.
This is a genuine coverage gap but low risk since the formatting code is straightforward.

### Phase 2: Stale Assignment Detection in `load()`

**Implementation**: `mount-resolver.ts` lines 168-175.

The `existsSync()` check on non-override assignments is correctly placed after the existing `isStaleDefaultPath()` check.
Discarded entries emit a `console.warn()` with the label and path.
Override entries are preserved (validated at `resolveSource()` time).

**Test coverage**: Three tests in `mount-resolver.test.ts`:
- Discards non-override entry with non-existent path, re-derives (line 968)
- Preserves override entry even when source is gone (line 1009)
- Validated mount (`sourceMustBe`) re-resolution when source disappears (line 884)

This matches the proposal's test plan. Implementation is clean.

### Phase 3: Debug Log Persistence

**Implementation**: `run-log.ts` (186 lines, new file), integrated in `up.ts`.

The `RunLog` class implements:
- Correct file naming: ISO timestamp with colons replaced by hyphens, 6-hex suffix
- Phase recording, subprocess stderr capture with truncation
- Config summary recording
- LACE_RESULT payload in the log
- Retention policy: keep 10 most recent AND anything under 7 days
- Try/catch in `finalize()`: never throws

The integration in `up.ts` uses a `try { ... } finally { finalizeLog(); }` wrapping the entire pipeline, ensuring the log is written on all code paths.

**Finding (blocking):** Two early return paths in `runUp()` bypass the `result` variable and return fresh objects without `logPath`:
- Line 208: `DevcontainerConfigError` on initial config parse
- Line 892: `DevcontainerConfigError` on full config read (for prebuild)

The `finally` block still runs `finalizeLog()`, so the log IS written to disk.
But the caller receives a result object without `logPath`, making the log undiscoverable through the API.
The debug footer in `commands/up.ts` uses `result.logPath` to populate the `log:` line, so these failures produce a footer without a log path reference.
Fix: return `result` instead of a new object in both locations, or add `logPath: runLog.getLogPath()` to the returned objects.

**Test coverage**: `run-log.test.ts` has 9 tests covering file creation, content structure (metadata, phases, subprocess, LACE_RESULT, config summary), retention policy (both age-based and count-based), truncation, and error resilience.
This is thorough. The subprocess stderr capture test addresses R1 action item 7.

### Phase 4: Agent-Friendly Debug Footer

**Implementation**: `debug-footer.ts` (41 lines, new file).

The footer matches the proposal template with one deviation: absolute paths for config, mounts, ports files, and the `lace validate` command.
Both `commands/up.ts` and `commands/validate.ts` use `formatDebugFooter()`.

**Finding (blocking):** The `projectName` field is never populated.
The proposal template shows `project: whelm`, but `formatDebugFooter` receives `projectName` as an optional field, and neither `commands/up.ts` nor `commands/validate.ts` passes it.
`projectName` is computed inside `runUp()` and not exposed in `UpResult`.
This means the footer always omits the `project:` line.
Fix: either expose `projectName` in `UpResult` and pass it to `formatDebugFooter`, or remove the field from the proposal template. The former is more useful: knowing the project name helps agents construct container references.

**Test coverage**: 4 tests in `debug-footer.test.ts` covering all fields, omission of optional fields, and absolute path verification.
The test for `projectName` inclusion (line 6) does pass because it constructs the options with `projectName: "whelm"` directly, but this test doesn't catch the integration gap where neither command provides the value.

**Finding (non-blocking):** The footer tests verify the footer content but no integration test checks that the footer is emitted on `lace up` failure or suppressed on success.
The proposal's test plan calls for "Integration test: failing `lace up` emits footer with log path and `lace validate` command" and "Integration test: successful `lace up` does NOT emit footer."
These integration tests are missing.
The unit tests verify the formatter, and the command code is simple, so the risk is low.

### Phase 5: `lace validate` Subcommand

**Implementation**: `commands/validate.ts` (62 lines, new file), `index.ts` registration.

The command correctly sets `skipDevcontainerUp: true` and `validateOnly: true`.
Prebuild is skipped via `if (hasPrebuildFeatures && !validateOnly)` at line 903 of `up.ts`.
Config generation still runs (verified by test).
Debug footer is emitted on failure.

**Finding (non-blocking):** The proposal specifies a structured checklist output format (lines 193-205):
```
Parsing devcontainer.json... OK
Workspace layout... worktree (lace/main)
...
Validation passed.
```
The implementation does not produce this checklist.
Instead, it reuses the existing `console.log` calls from `runUp()` (e.g., "Fetching feature metadata...", "No port templates found, skipping port allocation.") and on success returns `"Validation passed."`.
The output is functional but doesn't match the proposal's clean checklist format.
This is a cosmetic deviation, not a functional one.

**Test coverage**: 5 tests in `validate.test.ts` covering success, mount failure, prebuild skip, logPath presence, and config generation.
This matches the proposal's test plan.

## Cross-Cutting Observations

**Error resilience is well-handled.** The `RunLog` class wraps all I/O in try/catch.
The `finalizeLog()` wrapper in `up.ts` is also wrapped.
Log failures are truly silent: they never affect the return value or exit code.

**Subprocess output capture integration is clean.** The `devcontainerUp` stderr is captured via `runLog.logSubprocess()` at line 1043-1050 of `up.ts`, after the subprocess returns.
This correctly captures stderr from the devcontainer build process.

**Config summary in logs is useful.** Port and mount allocation summaries are written to the log file, providing a snapshot of the resolved configuration for debugging.

## Verdict

**Revise.**
Two blocking findings need resolution before the proposal can transition to `implementation_accepted`:
1. `projectName` not passed to debug footer in either command.
2. Two early return paths return objects without `logPath`.

Both are straightforward fixes (exposing `projectName` in `UpResult`, and using the existing `result` variable for early returns).

## Action Items

1. [blocking] Expose `projectName` in `UpResult` and pass it to `formatDebugFooter` in both `commands/up.ts` and `commands/validate.ts`, or document the omission as intentional.
2. [blocking] Fix two early return paths in `runUp()` (lines 208, 892) to include `logPath: runLog.getLogPath()` in the returned object.
3. [non-blocking] Add integration test for the Phase 3+ attributed error format with a declared mount that reaches the post-resolution scan (not the Phase 7.5 sourceMustBe check).
4. [non-blocking] Add integration tests for debug footer emission on failure and suppression on success (Phase 4 test plan items).
5. [non-blocking] Consider implementing the structured checklist output format for `lace validate` as specified in the proposal.
