---
review_of: cdocs/proposals/2026-03-28-lace-up-validation-and-error-reporting.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-28T10:45:00-07:00
task_list: lace/validation-pipeline
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, implementation_feasibility]
---

# Review: Validation, Log Persistence, and Debuggability for `lace up`

## Summary Assessment

The proposal addresses a real and well-scoped problem: opaque container runtime errors caused by stale or invalid mount state.
The four remaining improvements (mount attribution, log persistence, error footer, `lace validate`) are well-motivated and incrementally deliverable.
The most significant gap is Phase 3's `RunLog` design, which underspecifies how lace and podman output are captured given the current subprocess architecture.
Verdict: **Revise** on two blocking items, both in Phase 3.

## Section-by-Section Findings

### BLUF and Summary

Clear and accurate.
Correctly distinguishes what's already done from what remains.
No issues.

### Phase 1: Mount Validation with Full Attribution

Well-scoped.
The cross-referencing approach (`templateResult.mountAssignments` + `mountDeclarations`) is correct: both are available in scope at the scan point (verified in `up.ts`).

**Non-blocking:** The example error output shows `declared by: sprack feature (sourceMustBe: directory)`.
For non-validated mounts (no `sourceMustBe`), the parenthetical should be omitted or show `(auto-created directory)` to avoid implying a constraint that doesn't exist.

### Phase 2: Stale Assignment Detection in `load()`

Correct approach.
The session fix handles `sourceMustBe` mounts in `resolveSource()`.
This phase covers the remaining case: non-`sourceMustBe` auto-created directories that disappear.

**Non-blocking:** The `existsSync()` check in `load()` adds filesystem I/O per loaded assignment.
For a typical project with 6-8 mounts this is negligible, but worth noting as a design trade-off.

### Phase 3: Debug Log Persistence

The motivation is strong: losing error context to terminal scrollback is a real operational pain.
The design decisions (plaintext, project-scoped, try/catch) are sound.

**Blocking:** The proposal says the log should contain "full subprocess stdout/stderr for the `devcontainerUp` phase," but doesn't address how this is captured.
Currently, `runDevcontainerUp()` in `up.ts` calls `devcontainer up` via `subprocess()` which returns `{ exitCode, stdout, stderr }`.
The `SubprocessResult` is available, but stdout/stderr may be large (the build output alone is 20KB+ as seen in the triggering incident).
The proposal should specify:
- Whether stdout is captured or only stderr (stdout contains build progress; stderr has the actual errors).
- A size limit or truncation strategy for the log entry.
- Whether the subprocess stdout/stderr should be captured differently than today (currently it's fully buffered in memory via `execSync`).

**Blocking:** The log file naming `.lace/logs/YYYY-MM-DDTHH-MM-SS.log` has a collision risk that the proposal acknowledges but resolves with "append a random suffix."
The implementation should specify the suffix format (e.g., 6 hex chars from `randomBytes(3)`) so the implementer doesn't have to make this decision.

### Phase 4: Agent-Friendly Error Footer

Strong design.
The footer template is well-chosen: it provides all the file paths an agent needs, the failed phase for triage, and a runnable `lace validate` command.

**Non-blocking:** The footer shows relative paths for `.lace/` files (`log: .lace/logs/...`) but an absolute path for `workspace`.
For agent consumption, all paths should be absolute so they're unambiguous regardless of the agent's working directory.
The `lace validate` command already uses `--workspace-folder` with an absolute path, which is good.

**Non-blocking:** Consider whether `lace validate` output should also include the debugging footer on failure.
If yes, the footer logic should live in a shared utility, not be inlined in `commands/up.ts`.

### Phase 5: `lace validate` Subcommand

Clean design.
Reusing `runUp()` with `skipDevcontainerUp: true` + `validateOnly: true` is the right approach.
The checklist output format is readable and parseable.

**Non-blocking:** The proposal lists "Config drift detection" as an executed phase, but drift detection compares the current extended config against the previously-generated one.
On a first run (no `.lace/devcontainer.json` yet), drift detection is a no-op.
For `validate`, drift detection primarily tells you "if you ran `lace up` now, would the container be recreated?"
This is useful context: worth noting in the output (e.g., `Config drift... changes detected (container would be recreated)`).

**Non-blocking:** The `validateOnly` flag needs to suppress the prebuild phase.
The proposal mentions this but doesn't detail the mechanism.
In `up.ts`, the prebuild is gated by `if (needsPrebuild && !options.skipDevcontainerUp)` (approximately).
`validateOnly` should be an additional gate: `if (needsPrebuild && !options.skipDevcontainerUp && !options.validateOnly)`.

### Edge Cases

The three cases covered are the right ones.
The port allocation side effect in validate mode is correctly identified as acceptable.

### Test Plan

Adequate coverage for each phase.
The test descriptions are specific enough to implement.

**Non-blocking:** Phase 3 tests say "verify file creation, content structure, and retention policy" but don't mention testing the subprocess output capture (the blocking item above).
Add a test that verifies the log contains the `devcontainerUp` stderr when the subprocess fails.

## Verdict

**Revise.**
Two blocking items in Phase 3 (log capture strategy, filename collision format) need specification before implementation.
The rest is well-designed and ready to implement.

## Action Items

1. [blocking] Specify log capture strategy for Phase 3: which subprocess streams are logged, size limits/truncation, and whether the capture mechanism changes.
2. [blocking] Specify the log filename collision suffix format (e.g., `YYYY-MM-DDTHH-MM-SS-<6hex>.log`).
3. [non-blocking] Phase 1: omit `(sourceMustBe: directory)` from error output for non-validated mounts, or use `(auto-created directory)`.
4. [non-blocking] Phase 4: use absolute paths for all files in the debugging footer.
5. [non-blocking] Phase 4: extract footer logic into a shared utility if `lace validate` also uses it.
6. [non-blocking] Phase 5: note drift detection output phrasing for "changes detected" case.
7. [non-blocking] Phase 3 test plan: add test for subprocess stderr capture in log file.
