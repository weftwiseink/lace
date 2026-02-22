---
review_of: cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T17:30:00-05:00
task_list: lace/wez-into
type: review
state: live
status: done
tags: [fresh_agent, bash, pipefail, error-handling, correctness, backward_compat]
---

# Review: Error Visibility and Smart Retry for wez-into and lace up

## Summary Assessment

This proposal addresses a real and well-documented UX problem: 20 seconds of silent,
futile retry polling after `lace up` failures. The two-phase structure (bash-only
improvements first, then structured TypeScript output) is sound, and the phasing
decision that Phase 1 delivers standalone value is correct. However, the proposal
contains a critical factual error about `set -o pipefail` that invalidates the core
`tee`-based streaming mechanism (1a), the most important change in the entire proposal.
The PIPESTATUS capture pattern is also wrong under the current script settings. These
must be fixed before implementation. The remaining changes (1b-1f, Phase 2) are
well-reasoned with only minor issues.

Verdict: **Revise.** The `pipefail` interaction must be resolved; once fixed, the
proposal is ready for implementation.

## Section-by-Section Findings

### 1a: Stream `lace up` output in real time via `tee`

**Finding: The `pipefail` claim is factually wrong. This breaks the proposed exit code capture.**

The proposal states at lines 143-146:

> NOTE: `set -o pipefail` is not set in `wez-into` and should not be added, because
> it would cause `tee` failures (e.g., broken pipe) to propagate as the overall exit
> code. `PIPESTATUS[0]` is the correct mechanism to capture the first command's exit
> code in a pipeline.

`bin/wez-into` line 16 is `set -euo pipefail`. `pipefail` IS set. This changes the
semantics of the proposed pipeline fundamentally.

With `pipefail` set, the proposed code:

```bash
"$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
  | tee "$up_logfile" >&2 \
  || up_exit=${PIPESTATUS[0]:-$?}
```

has two problems:

1. **`set -e` + pipeline failure = immediate exit.** When `lace up` exits non-zero,
   `pipefail` makes the entire pipeline's exit status non-zero. With `set -e` active,
   the script will exit immediately at that line before the `||` handler can execute,
   unless the pipeline is in a conditional context. The `||` does create a conditional
   context, so `set -e` is suppressed for this command -- but only because of the `||`.
   This is subtle and worth noting explicitly.

2. **`PIPESTATUS` is overwritten by the `||` clause.** After `|| up_exit=${PIPESTATUS[0]:-$?}`
   executes, `PIPESTATUS` reflects the status of the `up_exit=...` assignment (which
   succeeds, so `PIPESTATUS` becomes `(0)`). By the time `${PIPESTATUS[0]}` is
   evaluated, it is the PIPESTATUS of the assignment, not of the pipeline. The correct
   pattern is:

   ```bash
   "$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
     | tee "$up_logfile" >&2; \
   up_exit="${PIPESTATUS[0]}"
   ```

   Here, `PIPESTATUS` is read on the very next line after the pipeline completes,
   before any other command overwrites it. The `;` (not `||`) ensures we don't enter
   a conditional that masks the array.

   However, there is a secondary problem: with `set -e` and `pipefail`, the pipeline
   failing will cause the script to exit before reaching the next line. The fix is to
   wrap it:

   ```bash
   "$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
     | tee "$up_logfile" >&2 \
     || true
   up_exit="${PIPESTATUS[0]}"
   ```

   But `|| true` also clobbers PIPESTATUS. The robust pattern is:

   ```bash
   local up_exit=0
   local pipe_statuses
   "$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
     | tee "$up_logfile" >&2 \
   && true  # no-op on success to avoid set -e
   pipe_statuses=("${PIPESTATUS[@]}")
   up_exit="${pipe_statuses[0]}"
   ```

   Actually, the simplest correct approach under `set -euo pipefail` is:

   ```bash
   local up_exit=0
   "$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
     | tee "$up_logfile" >&2 \
     || up_exit=$?
   ```

   With `pipefail`, `$?` after the pipeline IS the exit code of the leftmost failing
   command (i.e., `lace up`'s exit code), which is exactly what we want. `tee` almost
   never fails, so `pipefail` will propagate `lace`'s exit code as the pipeline status.
   The `||` suppresses `set -e`, and `$?` captures the pipeline's exit status, which
   under `pipefail` is the exit code of the first failing command.

   Wait -- that is not quite right either. `pipefail` sets the pipeline's exit status
   to the rightmost non-zero exit code, not the leftmost. If `lace` exits 1 and `tee`
   exits 0, the pipeline exits 1 (from `lace`). If both `lace` exits 1 and `tee` exits
   2, the pipeline exits 2 (from `tee`, the rightmost). Since `tee` almost never fails,
   the practical result is that `$?` equals `lace`'s exit code. But technically,
   `pipefail` returns the exit status of the last command to exit with a non-zero
   status, and in a simple two-command pipeline, if only the first fails, the pipeline
   status equals that exit code. This is actually correct for the use case.

   The simplest correct version:

   ```bash
   local up_exit=0
   "$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
     | tee "$up_logfile" >&2 \
     || up_exit=$?
   ```

   This works because: (a) `pipefail` is set, so the pipeline's exit status is the
   exit code of the failing `lace` command (since `tee` succeeds), (b) `|| up_exit=$?`
   suppresses `set -e` and captures the pipeline exit status, (c) `$?` at this point
   is the pipeline's exit status, which is `lace`'s exit code.

This is **blocking**. The proposal's own NOTE about pipefail is wrong, and the proposed
`PIPESTATUS[0]` capture pattern will not work as written. The proposal should
acknowledge that `pipefail` IS set and use the simpler `|| up_exit=$?` pattern, which
under `pipefail` gives the correct result without needing `PIPESTATUS` at all.

### 1b: Show error excerpt immediately before retries

**Non-blocking.** This is sound. With 1a implemented, the user already saw the output
in real time, so the excerpt is a helpful summary rather than the first time they see
the error. The proposal correctly notes this lower priority.

One minor observation: the `echo "$up_output" | tail -5 >&2` pattern will show the
`LACE_RESULT` line (once Phase 2 lands) as one of the last 5 lines. Consider filtering
it out here, or at least note the interaction.

### 1c: Add `docker ps` early-exit check to the retry loop

**Non-blocking, minor concern.** The approach is sound and the label
`devcontainer.local_folder` is the right choice.

However, one edge case is worth noting: the first iteration of the retry loop runs the
`docker ps` check before `sleep 2`. If `lace up` just exited and the container is in
the process of being cleaned up by Docker (zombie state), `docker ps` might briefly
show it as "running" before it transitions to "exited." This would cause one extra
retry iteration (2 seconds), which is acceptable. Not blocking, but worth documenting.

### 1d: Reduce max retry attempts

**Non-blocking.** Reducing from 10 to 5 is reasonable given the `docker ps` early-exit
check. The worst case of 10 seconds for a legitimately running container is sufficient.

### 1e: Replace final error message with actionable guidance

**Non-blocking, minor issue.** The remediation guidance is a significant improvement
over "try: wez-into $project."

One detail: the `$workspace_path` in the error message should be quoted in the
suggested command to handle paths with spaces:

```bash
err "  lace up --workspace-folder \"$workspace_path\""
```

Also, the `docker ps -a` command in the "common causes" section should use `docker ps -a`
(not `docker ps`) since we are looking for containers that may have exited:

```bash
err "  - Lifecycle hook failure, no container (check: docker ps -a --filter label=devcontainer.local_folder=$workspace_path)"
```

This is already correct in the proposal -- good.

### 1f: Fix the "attempt 1/N" off-by-one

**Non-blocking, but the fix is slightly wrong.**

The proposal changes `$((attempts + 1))` to `$((attempts))`. Let us trace through:

- Loop starts with `attempts=0`.
- First iteration: discovery fails, `attempts` becomes 1, message prints
  "attempt 1/5", sleep.
- Second iteration: discovery fails, `attempts` becomes 2, message prints
  "attempt 2/5", sleep.
- ...up to "attempt 4/5" (since the condition is `attempts < max_attempts`).

So the user sees attempts 1 through 4 (4 messages), which corresponds to 5 total
discovery attempts (the first silent one plus 4 with messages). This is actually
correct behavior and matches user expectations. The fix is fine.

### 2a: Emit `LACE_RESULT` line from the command handler

**Blocking: `isContainerRunning` is not importable from `up.ts` as proposed.**

The proposal places `isContainerRunning` in `packages/lace/src/lib/up.ts` as a
non-exported function (line 431: `function isContainerRunning`), but calls it from
`packages/lace/src/commands/up.ts`. For this to work, `isContainerRunning` must be
exported from `up.ts` or moved to the command handler file.

Additionally, the proposed code in `commands/up.ts` references `isContainerRunning`
directly but has no import statement for it. The proposal should either:

1. Export `isContainerRunning` from `up.ts` and import it in `commands/up.ts`, or
2. Move `isContainerRunning` into `commands/up.ts` itself (simpler, since it is
   only used there).

Option 2 is cleaner because the function is a post-`runUp` diagnostic check, not
part of the core `runUp` pipeline.

**Non-blocking: the `containerMayBeRunning` logic is too narrow.**

The proposal checks `containerMayBeRunning` only when `failedPhase === "devcontainerUp"`:

```typescript
const containerMayBeRunning = failedPhase === "devcontainerUp"
    && isContainerRunning(options.workspaceFolder ?? process.cwd());
```

This is correct for the current codebase -- only `devcontainerUp` failures can leave
a running container. However, the condition could simply be:

```typescript
const containerMayBeRunning = result.exitCode !== 0
    && isContainerRunning(options.workspaceFolder ?? process.cwd());
```

This is simpler, future-proof (what if a new phase can leave a running container?),
and the `docker ps` check is only run on the failure path anyway. The `docker ps`
call is the ground truth -- if a container is running, it should be reported
regardless of which phase the proposal thinks could leave one.

### 2b: Add `isContainerRunning` helper

**Non-blocking, minor concern.** The function uses `defaultRunSubprocess` which calls
`execFileSync`. This is synchronous and appropriate here (it is a quick check on the
failure path). However, the command handler's `run` function is `async`, so using a
synchronous subprocess call blocks the event loop briefly. Since this is a CLI tool
that is about to exit, this is acceptable.

The function also does not handle the case where the `docker` command is not on PATH.
The `try/catch` around the call handles `execFileSync` throwing an `ENOENT` error, so
this is already covered. Good.

### 2c: Parse `LACE_RESULT` in `wez-into`

**Non-blocking: `grep -oP` is not universally available.**

The proposal uses `grep -oP` (Perl-compatible regex) to extract `failedPhase`:

```bash
failed_phase=$(echo "$result_json" | grep -oP '"failedPhase"\s*:\s*"\K[^"]+' || echo "unknown")
```

On GNU/Linux systems (which this codebase targets), `grep -P` is available. However,
on macOS or minimal Docker images, it may not be. Since `wez-into` runs on the host
(not in a container), and the host is Fedora, this is fine in practice. But since the
proposal already chose to avoid `jq` for portability, it is worth noting that
`grep -P` is a GNU extension. An alternative using only POSIX-compatible tools:

```bash
failed_phase=$(echo "$result_json" | sed -n 's/.*"failedPhase"\s*:\s*"\([^"]*\)".*/\1/p')
```

Or, since the JSON is intentionally simple and flat, bash string manipulation:

```bash
failed_phase="${result_json#*\"failedPhase\":\"}"
failed_phase="${failed_phase%%\"*}"
```

**Non-blocking: backward compatibility fallback is well-handled.** The fallback to the
"Starting devcontainer" heuristic when `LACE_RESULT` is absent is a good design
decision. The grep for `^LACE_RESULT: ` with `tail -1` is defensive and correct.

### Design Decisions

**Non-blocking: the `tee >&2` decision is correct.** Sending streamed output to stderr
keeps stdout clean and is consistent with the script's existing `info`/`err` functions
that write to stderr.

**Non-blocking: the `docker ps` inside the retry loop (rather than before it) is the
right call.** The race condition argument is valid.

### Edge Cases

**Non-blocking: `/tmp` file cleanup on unexpected exit.** The proposal creates
`/tmp/lace-up-$$.log` but only cleans it up after reading. If the script is
interrupted (Ctrl+C, SIGTERM) between creation and cleanup, the file remains. This is
a minor concern since `/tmp` is typically cleaned on reboot. However, adding a `trap`
for cleanup would be more robust:

```bash
local up_logfile
up_logfile=$(mktemp /tmp/lace-up-XXXXXX.log)
trap "rm -f '$up_logfile'" EXIT
```

Note: the script already uses `set -e`, so any error in the pipeline path would cause
exit without cleanup. A trap handles this.

The proposal mentions `mktemp` as a mitigation in the edge cases section but does not
use it in the main proposed code. The main code should use `mktemp` directly.

### Completeness: Coverage of Report Recommendations

Both reports provide recommendations. Let me verify coverage:

**Error Propagation Report (R1-R5):**
- R1 (show output in real time): addressed by 1a.
- R2 (show captured output immediately on failure): addressed by 1b.
- R3 (add diagnostic message on first failed discovery): partially addressed by 1c
  (docker ps check provides better info). The specific "container not yet visible"
  message on first attempt is not implemented, but the docker ps check is better.
- R4 (distinguish discovery infrastructure failures): not directly addressed, but the
  docker ps check in 1c provides a partial solution. The report's suggestion to modify
  `lace-discover` exit codes is out of scope for this proposal.
- R5 (direct error messages to stderr): not addressed, but the proposal notes this
  as unnecessary given the `tee`-based streaming approach. Correct reasoning.

**Error Triaging Report (R1-R7):**
- R1 (show output in real time): addressed by 1a.
- R2 (machine-readable failure summary): addressed by Phase 2.
- R3 (classify devcontainerUp failures): addressed by 2b (`isContainerRunning`).
- R4 (show captured error immediately on failure): addressed by 1b.
- R5 (refine pre-devcontainer-up heuristic): partially addressed. Phase 2 replaces
  the heuristic entirely with structured data. Phase 1 keeps the heuristic as-is,
  which is acceptable since the docker ps check (1c) compensates.
- R6 (reduce retry count + early exit): addressed by 1c and 1d.
- R7 (improve final error message): addressed by 1e.

Coverage is comprehensive. All high-priority items from both reports are addressed.

### Test Plan

**Non-blocking: the test plan is manual-only for Phase 1.** This is appropriate given
that `wez-into` has no test harness. However, the proposal could note that the bash
changes in Phase 1 are amenable to testing with `bats` (Bash Automated Testing System)
if a test harness is ever added.

The Phase 2 unit test plan is reasonable. The assertion that existing tests won't be
affected (because tests call `runUp` directly, not the command handler) is correct --
I verified this against `up.integration.test.ts`.

## Verdict

**Revise.** Two blocking issues must be addressed:

1. The `pipefail` factual error and resulting PIPESTATUS capture pattern must be
   corrected. The proposal should acknowledge `set -euo pipefail` on line 16 of
   `wez-into` and use `|| up_exit=$?` instead of `PIPESTATUS[0]`.

2. The `isContainerRunning` function must be either exported from `up.ts` or moved
   to `commands/up.ts`, with a corresponding import statement added.

Once these are fixed, the proposal is ready for implementation.

## Action Items

1. [blocking] Fix the `pipefail` factual error. Acknowledge that `set -euo pipefail`
   is already set in `wez-into` (line 16). Replace the `PIPESTATUS[0]` capture pattern
   with the simpler `|| up_exit=$?`, which under `pipefail` correctly captures the
   failing command's exit code. Remove the NOTE claiming `pipefail` is not set.

2. [blocking] Fix the `isContainerRunning` import/export. Either export it from `up.ts`
   and add an import in `commands/up.ts`, or move the function into `commands/up.ts`
   directly. Add the missing import of `defaultRunSubprocess` if the function is placed
   in the command handler.

3. [non-blocking] Use `mktemp` in the main proposed code for 1a, not just in the edge
   cases section. Add a `trap` for cleanup on script exit.

4. [non-blocking] Consider simplifying the `containerMayBeRunning` check to always run
   `isContainerRunning` on the failure path, regardless of `failedPhase`, since the
   `docker ps` call is the ground truth.

5. [non-blocking] Consider replacing `grep -oP` with `sed` or bash string manipulation
   for `failedPhase` extraction, for consistency with the "no external tool dependencies"
   design principle.

6. [non-blocking] Quote `$workspace_path` in the remediation guidance commands in 1e
   to handle paths with spaces.

7. [non-blocking] Note the interaction between 1b's `tail -5` and Phase 2's
   `LACE_RESULT` line appearing in the excerpt.
