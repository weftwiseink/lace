---
review_of: cdocs/devlogs/2026-03-19-rebuild-cascading-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-19T14:00:00-07:00
task_list: lace/devcontainer-lifecycle
type: review
state: live
status: done
tags: [fresh_agent, implementation, config-drift, rebuild, test_plan, code_quality, deviation_analysis]
---

# Review: Rebuild Cascading and Config Drift Detection Implementation

## Summary Assessment

This devlog documents the implementation of the accepted proposal for fixing `--rebuild` cascading and adding config drift detection to `lace up`.
The implementation is high quality: both phases follow the proposal's design closely, the code is clean and well-documented, and the devlog accurately records a significant runtime-discovered deviation (port allocator false positives).
The most important finding is that the implementation is faithful to the proposal with one well-justified deviation, the test coverage is thorough (24 unit tests, 6 integration tests), and the ground-truth verification records demonstrate real system validation.
Verdict: **Accept** with non-blocking suggestions for improved test coverage of edge cases and a minor frontmatter issue on the proposal.

## Section-by-Section Findings

### Devlog Frontmatter

The frontmatter is well-formed and follows the spec.
`task_list: lace/devcontainer-lifecycle` correctly aligns with the proposal's task list.
Tags are descriptive and focused.

**Non-blocking.** The `status` field is `wip` but the work appears complete and verified.
It should be updated to `review_ready` or `done` depending on workflow stage.

### BLUF

The BLUF is effective: it names the proposal being implemented, summarizes the two phases, and states the verification outcome.
Sentence-per-line formatting is followed.

**No issues.**

### Objective and Approach

Clear and concise.
The subagent-driven approach with iterative ground-truth testing is well-suited for this kind of mechanical implementation work.
The three-phase breakdown (Phase 1, Phase 2, Phase 2 addendum) mirrors the proposal structure.

**No issues.**

### Phase 1: Forward `--rebuild` to `devcontainer up`

**Implementation matches proposal:** The `removeExistingContainer` option is added to `RunDevcontainerUpOptions` exactly as specified.
The `--remove-existing-container` flag (rather than `--rebuild`) is correctly used per the proposal's design decision.
The call site at `runDevcontainerUp()` passes `removeExistingContainer: rebuild` as proposed.

**Code quality (lib/up.ts lines 912-948):** The implementation is clean.
The destructuring of `removeExistingContainer` from options is clear.
The flag is pushed before other args, which ensures proper CLI argument ordering.

**CLI description update (commands/up.ts line 58):** Updated from "Force rebuild of prebuild image (bypass cache)" to "Force full rebuild: rebuild prebuild image and recreate container" as specified.

**Integration tests (up.integration.test.ts lines 627-680):** Three tests cover the rebuild flag forwarding:
1. Includes `--remove-existing-container` when `rebuild: true`
2. Does NOT include when `rebuild: false`
3. Does NOT include when `rebuild` is omitted

These match the proposal's Phase 1 test plan for unit tests. The proposal also specified an integration test verifying `docker inspect` of `CONTAINER_WORKSPACE_FOLDER` after rebuild, which is covered by the manual verification records rather than an automated test. This is reasonable given the difficulty of automating Docker container lifecycle tests.

**No blocking issues.**

### Phase 2: Config Drift Detection

**Implementation matches proposal:** The `config-drift.ts` module implements `computeRuntimeFingerprint()` using SHA-256 with `sortedStringify()` for deterministic key-order-independent serialization.
The fingerprint is a 16-character hex prefix (`.slice(0, 16)`) as proposed.
The state file is `.lace/runtime-fingerprint` as proposed.

**RUNTIME_KEYS deviation:** The implementation excludes `forwardPorts` and `appPort` from the key list.
This is documented in the devlog's "Deviations from Proposal" section with clear rationale (port allocator feedback loop causing false positives).
The NOTE callout with attribution follows conventions.

**Code quality (config-drift.ts):** The module is well-structured with clear separation of concerns:
- `sortedStringify`: deterministic serialization
- `computeRuntimeFingerprint`: hash computation
- `readRuntimeFingerprint` / `writeRuntimeFingerprint` / `deleteRuntimeFingerprint`: file I/O
- `checkConfigDrift`: orchestration returning a typed `DriftCheckResult`

All functions are exported, enabling thorough unit testing.
The `DriftCheckResult` interface provides good observability into drift state.

**Integration into lib/up.ts (lines 639-673):** The drift detection phase is correctly placed after `generateExtendedConfig()` but before `devcontainer up`, matching the proposal.
The fingerprint is written after successful `devcontainer up` (lines 699-703), ensuring it reflects actual container state.
When `rebuild` is true, the fingerprint is deleted before comparison (line 652), preventing stale comparisons.
The `try/catch` at line 669 silently ignores read failures, which is appropriate: if the config that was just written cannot be read, something more fundamental is wrong.

**Warning message (lines 659-662):** Matches the proposal's drift response spec verbatim.

**Non-blocking observation:** When `rebuild` is true and drift is detected (lines 664-667), the code logs a message but the container will be recreated regardless via Phase 1's `--remove-existing-container`.
This is informational and correct behavior.

**Non-blocking observation:** The `currentFingerprint` variable is typed `string | undefined` (line 643).
If the try/catch at line 669 fires and `currentFingerprint` is undefined, no fingerprint is written after `devcontainer up`.
This means a subsequent `lace up` will not detect drift (no previous fingerprint).
This is an extremely unlikely edge case (the config file was just generated), but a `WARN` comment in the code explaining the consequence would improve clarity.

### Phase 2: Unit Tests (config-drift.test.ts)

24 tests covering:
- `sortedStringify`: key sorting at every depth, different insertion orders, array preservation, nested objects (4 tests)
- `computeRuntimeFingerprint`: format validation, sensitivity to each RUNTIME_KEY, insensitivity to non-runtime keys, deterministic serialization, empty config behavior, forwardPorts/appPort exclusion (9 tests)
- File I/O: read/write/overwrite/delete lifecycle (5 tests)
- `checkConfigDrift`: first run (no previous), unchanged config, containerEnv change, workspaceFolder change, non-runtime property change (5 tests)

This covers the proposal's test plan comprehensively:
- "different hashes for configs differing in any RUNTIME_KEYS property": covered by "detects changes to each RUNTIME_KEYS property" test
- "same hash for configs differing only in non-runtime properties": covered by two tests (features, build)
- "drift detection warns when fingerprint changes": covered by checkConfigDrift drift tests (the warning itself is tested via integration)
- "deterministic serialization": covered by key insertion order test

**Non-blocking.** Missing edge case: what happens when a RUNTIME_KEY value is `null` vs absent?
For example, `{ containerEnv: null }` vs `{}`.
The current implementation treats `null` as present (because `"containerEnv" in config` is true for `{ containerEnv: null }`), so it would include `null` in the fingerprint, while `{}` would not.
This could cause a false positive if the generated config oscillates between these states.
A test for this case would be valuable.

### Phase 2: Integration Tests (up.integration.test.ts lines 682-731)

Three lifecycle tests:
1. Writes fingerprint after successful `devcontainer up`
2. Does not write fingerprint when `skipDevcontainerUp` is true
3. Deletes fingerprint before drift check when `rebuild` is true

These cover the critical lifecycle invariants.

**Non-blocking.** The proposal's integration test plan specified "Change `containerEnv` -> `lace up` -> observe warning -> `lace up --rebuild` -> verify new env var is present in container."
This end-to-end scenario is covered by the manual verification records but not by an automated test.
An integration test that asserts `console.warn` is called with the drift message when a pre-existing fingerprint doesn't match would strengthen coverage.
This could be done with `vi.spyOn(console, "warn")` as other tests in the file already do.

### Phase 2 Addendum: `wez-into --rebuild`

**Implementation matches proposal:** The `--rebuild` flag is added to `wez-into`'s option parsing (line 369-372).
The `REBUILD` variable is checked in `start_and_connect()` and passed through to `lace up` as `--rebuild` (lines 191-193).
Dry-run output, info messages, help text, and examples are all updated.

**Code quality (bin/wez-into):** The implementation is clean and consistent with the existing flag patterns (`--start`, `--dry-run`).
The `REBUILD` variable follows the same `true`/`false` string convention as other flags.

**Non-blocking.** The proposal noted that `--rebuild` should be used with `--start` for convenience.
The current implementation allows `--rebuild` without `--start`, in which case `REBUILD` is set but never used (since only `start_and_connect` checks it).
This is harmless but could be clarified in the help text to indicate `--rebuild` requires `--start`.

> NOTE(opus/devcontainer-lifecycle): Looking at the argument parsing, `--rebuild` is parsed independently of `--start`.
> If a user runs `wez-into --rebuild lace` (no `--start`), the `REBUILD` flag is set but the code path goes to direct connection (lines 653-670), which ignores `REBUILD`.
> This is benign but potentially confusing.

### Verification Records

The verification records are thorough and provide strong evidence of ground-truth testing:
- Phase 1: Container ID change confirms actual recreation; environment variables confirm correct config propagation.
- Phase 2: Five scenarios covering first run, same config, changed config, rebuild, and the port reassignment false-positive fix.
- Test suite: 918 tests across 33 files all passing.

**No issues.**

### Deviations from Proposal

The single deviation (excluding `forwardPorts` and `appPort` from RUNTIME_KEYS) is well-documented with:
1. The problem statement (false-positive drift on every re-run)
2. The root cause (port allocator feedback loop)
3. The rationale for the fix (pragmatic, eliminates a class of false positives)
4. A NOTE callout with attribution explaining it was discovered during testing

This section is exemplary: it surfaces the deviation front and center, explains the reasoning, and acknowledges the gap (manually specified port changes won't trigger drift warnings).

**No issues.**

### Proposal Frontmatter

**Non-blocking.** The proposal's `status` field is `implementation_wip`, which is not in the frontmatter spec's valid values.
The valid values are: `request_for_proposal`, `wip`, `review_ready`, `implementation_ready`, `evolved`, `implementation_accepted`, `done`.
The closest valid value would be `implementation_ready` (accepted and being implemented) or a custom status.

## Additional Findings

### Fingerprint Does Not Survive devcontainer up Failure

If `devcontainer up` fails (lines 692-697), the code returns early without writing the fingerprint (lines 699-703).
This means the next `lace up` will compare against the old fingerprint (or no fingerprint on first run).
If the config changed and the container failed to start, the next run will correctly detect drift again.
This is the right behavior, matching the proposal: "If `devcontainer up` fails, the old fingerprint is retained."

### Config Drift Reads Extended Config, Not Source Config

The drift detection reads the generated `.lace/devcontainer.json` (line 646-648), not the source `.devcontainer/devcontainer.json`.
This is correct: the extended config contains the resolved values that actually affect the container.
It also means drift detection captures changes from template resolution, port allocation, and workspace layout, not just user edits.

### No Auto-Rebuild Option

The proposal mentioned "Optionally (flag-gated): auto-pass `--remove-existing-container`" for automatic drift resolution.
The implementation correctly implements the warning-only approach, deferring auto-rebuild to future work.
This is consistent with the proposal's design decision "Warning vs auto-rebuild on drift."

## Verdict

**Accept.**

The implementation is faithful to the proposal, with one well-justified deviation discovered during ground-truth testing.
The code is clean, well-tested, and properly integrated into the existing codebase.
The devlog is thorough and follows writing conventions.
Test coverage meets the proposal's test plan with minor gaps in automated integration coverage (compensated by manual verification records).

## Action Items

1. [non-blocking] Update the devlog's `status` from `wip` to `review_ready` or `done`.
2. [non-blocking] Fix the proposal's `status` from `implementation_wip` to a valid frontmatter value (likely `implementation_ready` or `implementation_accepted`).
3. [non-blocking] Add a unit test for `computeRuntimeFingerprint` behavior when RUNTIME_KEY values are `null` vs absent to guard against false-positive drift from config serialization variance.
4. [non-blocking] Add an integration test asserting `console.warn` is called with the drift warning message when a stale fingerprint exists and config changes.
5. [non-blocking] Consider clarifying in `wez-into --help` that `--rebuild` is only effective with `--start`, or add a warning when `--rebuild` is used without `--start`.
6. [non-blocking] Add a code comment in `lib/up.ts` near line 669 explaining the consequence of the catch block: if the extended config read fails, no fingerprint is written, and the next run will not detect drift from this session.
