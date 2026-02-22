---
review_of: cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T20:30:00-05:00
task_list: lace/wez-into
type: review
state: live
status: done
tags: [fresh_agent, phase1, bash, error-handling, correctness, edge-cases, pipefail]
---

# Review: Phase 1 Implementation of wez-into Error Visibility

## Summary Assessment

Phase 1 implements all six proposed changes (1a-1f) in `bin/wez-into` with high
fidelity to the accepted proposal. The tee/pipefail/exit-code capture pattern is
correct under `set -euo pipefail`, the `docker ps` early-exit check is sound, and
the error messaging is a substantial improvement over the original. Two issues
require minor attention: a trap quoting pattern that is technically correct for
`mktemp` paths but non-idiomatic. No blocking issues found.
Verdict: **Accept** with one non-blocking suggestion.

## Section-by-Section Findings

### 1a. Stream `lace up` output in real time via `tee`

**Status:** Implemented correctly with one bug

The implementation at lines 168-184 matches the proposal:

```bash
up_logfile=$(mktemp /tmp/lace-up-XXXXXX.log) || {
    err "cannot create temp file for lace up log"
    exit 1
}
trap "rm -f '$up_logfile'" EXIT

local up_exit=0

"$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
  | tee "$up_logfile" >&2 \
  || up_exit=$?

local up_output
up_output=$(cat "$up_logfile" 2>/dev/null || true)
rm -f "$up_logfile"
trap - EXIT
```

The `tee`-to-stderr pattern is correct: output streams to the user via stderr while
being captured to a temp file. The `|| up_exit=$?` correctly captures the pipeline
exit status and suppresses `set -e`. With `pipefail`, the pipeline's exit status is
that of `lace` (assuming `tee` succeeds, which it almost always does).

**Bug (blocking): Trap quoting is fragile.** Line 173 uses:

```bash
trap "rm -f '$up_logfile'" EXIT
```

The double-quoted string with embedded single quotes means `$up_logfile` is expanded
at trap-definition time (correct), but the single quotes provide no protection
against filenames containing single quotes. While `mktemp` on Linux will never
produce a path with single quotes, the pattern is fragile in principle. More
importantly, if the `mktemp` template were ever changed or the path came from
another source, this would silently break. The safe idiom is:

```bash
trap 'rm -f '"\"$up_logfile\""'' EXIT
```

Or more readably, capture the path in a variable and use the common pattern:

```bash
trap "rm -f \"$up_logfile\"" EXIT
```

This uses double quotes throughout, so `$up_logfile` is expanded at definition time
and the resulting `rm -f "/tmp/lace-up-XXXXXX.log"` command is correctly quoted at
execution time. The current implementation uses single quotes inside double quotes,
which means the `rm` command that the trap actually executes is:

```
rm -f '/tmp/lace-up-abcdef.log'
```

This works -- the single quotes protect the path at execution time. On reflection,
this is actually correct for `mktemp`-generated paths (which contain only
alphanumerics, hyphens, and dots). **Downgrading to non-blocking.** The pattern is
technically correct for this use case but not idiomatic. A future reader might
incorrectly assume the single quotes are protective against all special characters
when they are not (a path containing a literal single quote would break the trap).

**Finding:** The tee/pipefail/exit-code capture is correct. The trap quoting works
for `mktemp`-generated paths but is non-idiomatic.

### 1b. Show error excerpt immediately before retries

**Status:** Implemented correctly

Lines 219-222:

```bash
info "warning: lace up exited with code $up_exit (checking if container started anyway...)"
info ""
info "lace up error context (last 5 lines):"
echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -5 >&2
info ""
```

This matches the proposal exactly. The `grep -v '^LACE_RESULT: '` filter is harmless
before Phase 2 lands (matches nothing, passes all lines through). The excerpt goes
to stderr via `>&2`, consistent with all other diagnostic output.

**Finding:** Correct and matches proposal. The excerpt serves as a useful glanceable
summary even though 1a already streams output in real time.

### 1c. Add `docker ps` early-exit check to the retry loop

**Status:** Implemented correctly

Lines 244-253:

```bash
local container_id
container_id=$(docker ps \
  --filter "label=devcontainer.local_folder=$workspace_path" \
  --format '{{.ID}}' 2>/dev/null || true)
if [[ -z "$container_id" ]]; then
  info "no container running for $workspace_path -- aborting discovery retries"
  break
fi
```

This matches the proposal. The check is unconditional (runs regardless of `up_exit`),
which is correct per the design decision. The `2>/dev/null || true` suppresses Docker
errors and treats failures as "no container." The `devcontainer.local_folder` label
is the right filter (set by the devcontainer CLI itself).

**One subtlety worth noting:** The `$workspace_path` variable is not quoted inside
the `--filter` argument string. The value is:

```bash
--filter "label=devcontainer.local_folder=$workspace_path"
```

Since `$workspace_path` is inside double quotes, it expands correctly even with
spaces. This is fine.

**Finding:** Correct. The `docker ps` check eliminates futile retries effectively.

### 1d. Reduce max retry attempts

**Status:** Implemented correctly

Line 230: `local max_attempts=5` (was 10). Matches the proposal.

**Finding:** Correct. Combined with 1c, worst case for a running container is 10
seconds; for a dead container, retries abort on the first iteration.

### 1e. Replace final error message with actionable guidance

**Status:** Implemented correctly

Lines 262-287 match the proposal closely. The implementation distinguishes between
the `up_exit -ne 0` failure path and the `up_exit -eq 0` (container started but not
discoverable) path, providing different remediation guidance for each.

The `$workspace_path` is quoted in the suggested commands (e.g.,
`err "  lace up --workspace-folder \"$workspace_path\""`), which handles paths
with spaces. The `grep -v '^LACE_RESULT: '` filter is applied to the error context
excerpt, consistent with 1b.

**Finding:** Correct. The remediation guidance is specific and actionable. The
distinction between the two failure modes is well-handled.

### 1f. Fix the "attempt 1/N" off-by-one

**Status:** Partially correct -- the counter display has a remaining off-by-one

Line 257:

```bash
info "waiting for container to be discoverable (attempt $((attempts))/$max_attempts)..."
```

The proposal states: "After the first failed discovery, `attempts` becomes 1 and the
message reads 'attempt 1/5'. After the second, 'attempt 2/5', and so on up to
'attempt 4/5'."

Walking through the loop:

1. **Iteration 0:** `attempts=0`, discovery fails, `docker ps` check passes (container running), `attempts` incremented to 1, condition `1 < 5` is true, prints "attempt 1/5", sleeps 2s. Correct.
2. **Iteration 1:** `attempts=1`, discovery fails, `docker ps` check passes, `attempts` incremented to 2, condition `2 < 5` is true, prints "attempt 2/5", sleeps 2s. Correct.
3. **Iteration 2:** discovery fails, `attempts` becomes 3, prints "attempt 3/5". Correct.
4. **Iteration 3:** discovery fails, `attempts` becomes 4, condition `4 < 5` is true, prints "attempt 4/5", sleeps 2s. Correct.
5. **Iteration 4:** discovery fails, `attempts` becomes 5, condition `5 < 5` is false, no message, no sleep, loop condition `5 < 5` is false, loop exits.

So we get 5 discovery attempts total (iterations 0-4), with messages on iterations
0-3 reading "attempt 1/5" through "attempt 4/5". This matches the proposal's stated
behavior.

However, the semantics are slightly misleading: "attempt 1/5" suggests this is the
first of five attempts, but it is actually the second discovery attempt (the first
was silent). The total number of discovery attempts is 5, but the user sees messages
for attempts 2-5 labeled as "1/5" through "4/5". The user never sees "attempt 5/5"
because the last iteration does not print a message.

This is the same behavior the proposal specifies ("the first silent one plus 4 with
messages"), so the implementation matches the proposal. Whether the UX is optimal is
a design question outside the scope of this review.

**Finding:** Correct per the proposal. The counter semantics (silent first attempt,
then "1/5" through "4/5") match what was specified.

### Overall: Does the implementation match Phase 1 changes 1a-1f?

**Status:** Yes, with high fidelity

All six changes are implemented as proposed. The implementation does not introduce
any Phase 2 changes (no TypeScript modifications, no `LACE_RESULT` emission). The
`grep -v '^LACE_RESULT: '` filters are forward-compatible with Phase 2 and harmless
before it lands.

### Correctness under `set -euo pipefail`

**Status:** Correct

Line 16: `set -euo pipefail` is set and preserved throughout.

The key concern is the pipeline at line 177-179:

```bash
"$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
  | tee "$up_logfile" >&2 \
  || up_exit=$?
```

With `pipefail`, the pipeline's exit status is the leftmost non-zero exit code. If
`lace` exits non-zero and `tee` exits 0, the pipeline's exit status equals `lace`'s
exit code. The `||` suppresses `set -e` for the entire pipeline, so the script does
not abort. `$?` after the `||` is the pipeline's exit status. This is correct.

One edge case: if `tee` fails (e.g., disk full), `SIGPIPE` may be delivered to
`lace` because `tee` closes its stdin. With `pipefail`, the exit status would be the
higher of `lace`'s SIGPIPE exit (141) and `tee`'s error exit. This is an extreme
edge case that the proposal acknowledges, and the behavior (taking the failure path
with a non-zero `up_exit`) is the correct default.

**Finding:** The `pipefail` + `||` pattern is correct. No `PIPESTATUS` gymnastics
are needed.

### Preservation of existing functionality

**Status:** Correct

The changes are confined to `start_and_connect()` (lines 132-297). The function's
external interface (parameters, return behavior, side effects) is unchanged. The
following paths are unaffected:

- **Success path:** `lace up` exits 0, discovery finds the container, connection
  proceeds. The only visible change is real-time output streaming (1a) and the
  "container started successfully" message.
- **Already-running detection:** Handled before `start_and_connect()` is called
  (lines 476-493). Unmodified.
- **Interactive picker:** Unmodified (lines 558-641).
- **Dry-run:** Handled at lines 151-155, before the `tee` pipeline. Unmodified.
- **Exit 126/127 handling:** Lines 186-200. These were present before and are
  unmodified in structure; they now operate on the `tee`-captured output instead of
  the `$()` captured output, but the behavior is identical.

**Finding:** No regressions to existing functionality.

## Verdict

**Accept**

The implementation is solid and matches the proposal with high fidelity. All six
Phase 1 changes (1a-1f) are implemented correctly. The tee/pipefail pattern is
sound, the `docker ps` early-exit check works as designed, and the error messaging
is a substantial improvement. One non-blocking suggestion noted below.

## Action Items

1. [non-blocking] Consider changing the trap quoting from `trap "rm -f '$up_logfile'" EXIT`
   to `trap "rm -f \"$up_logfile\"" EXIT` at line 173. Both work for `mktemp` paths,
   but the double-quote form is more idiomatic and robust against hypothetical path
   changes. Alternatively, add a comment explaining that single-quote embedding is
   safe here because `mktemp` paths contain no special characters.

## Notes for Phase 2

- The `grep -v '^LACE_RESULT: '` filters at lines 221, 267 are correctly placed
  and ready for Phase 2. They are no-ops until `lace up` starts emitting the
  `LACE_RESULT` line.
- The fallback heuristic (`grep -q "Starting devcontainer"` at line 210) is
  preserved and will serve as the backward-compatibility path when Phase 2 adds
  the structured `LACE_RESULT` parsing.
- The `docker ps` check in the retry loop (1c) partially overlaps with Phase 2's
  `containerMayBeRunning` field. When Phase 2 lands, the `docker ps` check remains
  valuable as a belt-and-suspenders defense (it catches containers that crash after
  `lace up` reports `containerMayBeRunning: true`).
