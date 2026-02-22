---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T12:00:00-05:00
task_list: lace/wez-into
type: report
state: live
status: wip
tags: [status, error-handling, ux, wez-into, lace-up, messaging]
---

# Error Propagation and User-Facing Messaging in wez-into Container Startup

> BLUF: When `lace up` fails during `wez-into --start`, the user sees a terse
> warning line followed by up to 20 seconds of retry polling, but never sees the
> actual error output from `lace up` until all retries are exhausted. The root
> cause is that `wez-into` captures all of `lace up`'s combined stdout+stderr
> into a single variable, suppresses it on the "recoverable failure" path, and
> only shows the last 15 lines after the retry loop times out. Meanwhile, `lace up`
> itself prints all progress and error messages to stdout via `console.log` and
> `console.error`, which are both swallowed by the `2>&1` capture. The result is
> a 20-second window where the user has no actionable information.

## Context / Background

A user running `wez-into dotfiles --start` observes:

```
wez-into: starting dotfiles via lace up --workspace-folder /home/mjr/code/personal/dotfiles ...
wez-into: warning: lace up exited with code 1 (checking if container started anyway...)
wez-into: waiting for container to be discoverable (attempt 2/10)...
wez-into: waiting for container to be discoverable (attempt 3/10)...
wez-into: waiting for container to be discoverable (attempt 4/10)...
```

The actual failure cause is invisible during the retry period. This report traces
every layer of the error propagation chain, identifies where information is lost
or delayed, and catalogs the messages the user sees at each stage.

## Key Findings

- **`lace up` output is fully captured and suppressed during the retry window.**
  Line 165 of `wez-into` merges stdout and stderr into `up_output` via `2>&1`,
  meaning all of lace's progress messages, warnings, and error details are held
  in a shell variable and never shown to the user until the final failure path.

- **The "Starting devcontainer" heuristic determines whether retries happen.**
  If `lace up` printed "Starting devcontainer..." before failing, `wez-into`
  assumes the container might be running and enters the retry loop. If that
  string is absent, it fails fast. This is a reasonable heuristic but depends
  on an exact string match against lace's internal `console.log` output.

- **`lace up` uses `console.log` for its final result message regardless of
  success or failure.** The command handler at line 71-72 of `commands/up.ts`
  prints `result.message` via `console.log` even when `result.exitCode` is
  non-zero. Error-specific output (e.g., devcontainer stderr) goes to
  `console.error` only for the `devcontainerUp` phase failure.

- **The subprocess layer (`subprocess.ts`) pipes all three stdio channels.**
  `execFileSync` is called with `stdio: ["pipe", "pipe", "pipe"]`, so all
  subprocess output (including from `devcontainer up`) is captured into the
  `SubprocessResult` and never reaches the user's terminal directly.

- **The retry loop provides no diagnostic information during its 20-second
  window** -- only the attempt counter. The actual error from `lace up` is
  deferred to the post-loop failure message.

## Detailed Trace

### Layer 1: `wez-into` shell script (`/var/home/mjr/code/weft/lace/main/bin/wez-into`)

#### Invocation and output capture (lines 157-166)

```bash
info "starting $project via lace up --workspace-folder $workspace_path ..."

up_output=$("$lace_cli" up --workspace-folder "$workspace_path" 2>&1) || up_exit=$?
up_exit=${up_exit:-0}
```

The `$( ... 2>&1)` construct merges `lace up`'s stderr into stdout and captures
everything into `up_output`. Nothing reaches the user's terminal. The user sees
only the `info` line printed at line 149 before the capture begins.

#### Exit code triage (lines 168-203)

The script has four branches:

| Exit code | Branch | User sees | Waits? |
|-----------|--------|-----------|--------|
| 127 | Interpreter not found (line 168) | Immediate error with "command not found" explanation | No |
| 126 | Permission denied (line 178) | Immediate error | No |
| Non-zero, no "Starting devcontainer" in output (line 192) | Pre-start failure | `err "lace up failed before starting container"` + last 15 lines of output | No |
| Non-zero, "Starting devcontainer" present (line 200) | Possible recoverable failure | `info "warning: lace up exited with code $up_exit (checking if container started anyway...)"` | Yes -- enters retry loop |
| 0 | Success (line 202) | `info "container started successfully"` | No (proceeds to discovery) |

The 127 and 126 cases were added as hardening after a prior investigation
(`cdocs/reports/2026-02-13-wez-into-start-failure-investigation.md`). The
"pre-start failure" fast-path (checking for "Starting devcontainer") was also
added at that time.

The problematic path is the fourth row: `lace up` reached the `devcontainer up`
phase (it printed "Starting devcontainer...") but still exited non-zero. The
user sees only a one-line warning. The captured `up_output` -- which contains
the actual error message -- is not shown.

#### Retry/discovery loop (lines 206-227)

```bash
local port=""
local attempts=0
local max_attempts=10

while [[ $attempts -lt $max_attempts ]]; do
    # ... discovery logic ...
    if [[ -n "$port" ]]; then
        break
    fi
    attempts=$((attempts + 1))
    if [[ $attempts -lt $max_attempts ]]; then
        info "waiting for container to be discoverable (attempt $((attempts + 1))/$max_attempts)..."
        sleep 2
    fi
done
```

This polls `lace-discover` up to 10 times with 2-second intervals (max ~20
seconds). The only user-visible output during this window is the attempt counter
line. No diagnostic information from the failed `lace up` is shown.

The loop starts at `attempts=0` and the message says `attempt $((attempts+1))`,
so the first message the user sees is "attempt 2/10" (the first attempt is
silent). This is slightly confusing -- the user sees attempts 2 through 10
but never "attempt 1/10".

#### Post-retry failure (lines 229-239)

```bash
if [[ -z "$port" ]]; then
    if [[ $up_exit -ne 0 ]]; then
        err "lace up failed (exit $up_exit) and container is not discoverable"
        err "lace up output (last 15 lines):"
        echo "$up_output" | tail -15 >&2
    else
        err "container started but not discoverable after $max_attempts attempts"
        err "the container may need more time to start SSH"
    fi
    err "try: wez-into $project"
    exit 1
fi
```

This is the **only place** where `up_output` is shown to the user in the
failure-after-retry path. It shows the last 15 lines. By this point, the user
has already waited ~20 seconds.

#### Post-retry success (lines 244-246)

```bash
if [[ $up_exit -ne 0 ]]; then
    info "container is running despite lace up exit $up_exit (likely a lifecycle hook failure)"
fi
```

If the container IS discoverable despite `lace up` failing, the user gets a
brief note. The actual error output from `lace up` is never shown -- the script
proceeds directly to `do_connect`. This is arguably correct (the container is
working), but the user has no visibility into what failed.

### Layer 2: `lace up` command handler (`/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/up.ts`)

```typescript
const result = await runUp(options);

if (result.message) {
    console.log(result.message);
}

process.exitCode = result.exitCode;
```

Lines 69-76. The command handler prints `result.message` via `console.log`
(stdout) for both success and failure. It sets `process.exitCode` rather than
calling `process.exit()`, allowing graceful shutdown.

The `result.message` contains the failure reason (e.g., `"devcontainer up
failed: <stderr>"`) but it goes to stdout, which is captured by `wez-into`'s
`$()` substitution and held in `up_output`.

### Layer 3: `runUp()` orchestrator (`/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/up.ts`)

The `runUp` function has multiple failure points, each setting `result.message`
and `result.exitCode`:

| Phase | Failure message pattern | Also prints to console? |
|-------|------------------------|------------------------|
| Config read (line 126) | `err.message` | No |
| Workspace layout (line 148) | `"Workspace layout failed: ..."` | Yes, via `console.log` at line 144 |
| Host validation (line 184) | `"Host validation failed: N error(s)..."` | Yes, warnings via `console.warn` at lines 178-179 |
| Metadata validation (line 252) | `"Feature X has invalid options..."` | No (only in result.message) |
| Template resolution (line 416) | `"Template resolution failed: ..."` | Warnings via `console.warn` at line 408 |
| Prebuild (line 494) | `"Prebuild failed: ..."` | `console.log` at line 499 for success |
| Resolve mounts (line 517) | `"Resolve mounts failed: ..."` | `console.log` at line 522 for success |
| Config generation (line 551) | `"Config generation failed: ..."` | No |
| devcontainer up (line 573) | `"devcontainer up failed: <stderr>"` | `console.error(upResult.stderr)` at line 574 |

The critical observation: for the `devcontainerUp` phase failure (the most
common cause of "exited with code 1"), the error details are in
`upResult.stderr`. This gets printed via `console.error` (to stderr) AND
embedded in `result.message` (printed to stdout by the command handler). Both
streams are captured by `wez-into`'s `2>&1`.

### Layer 4: Subprocess execution (`/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/subprocess.ts`)

```typescript
const opts: ExecFileSyncOptions = {
    cwd: options?.cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
};
```

Lines 22-27. All three stdio channels are piped. This means `devcontainer up`'s
stdout and stderr are captured into the `SubprocessResult` and never reach the
user's terminal. The 10MB buffer is generous, so truncation is unlikely.

### Layer 5: `lace-discover` (`/var/home/mjr/code/weft/lace/main/bin/lace-discover`)

The discovery script is silent on failure -- if Docker is unavailable or the
daemon is not running, it outputs nothing (text mode) or `[]` (JSON mode) and
exits 0. This means the retry loop in `wez-into` cannot distinguish "Docker is
broken" from "container hasn't started yet."

## Message Inventory

Complete list of user-visible messages in the `wez-into --start` flow:

### Before `lace up` runs

1. `"starting $project via lace up --workspace-folder $workspace_path ..."` (line 149, info)

### On `lace up` exit 127 (interpreter not found)

2. `"lace CLI failed to execute (exit 127: command not found)"` (line 170, err)
3. `"this usually means the node runtime is not on PATH"` (line 171, err)
4. `"lace CLI: $lace_cli"` (line 173, err)
5. `"output: $up_output"` (line 175, err, conditional)

### On `lace up` exit 126 (permission denied)

6. `"lace CLI is not executable (exit 126: permission denied)"` (line 180, err)
7. `"lace CLI: $lace_cli"` (line 181, err)

### On `lace up` failure before "Starting devcontainer"

8. `"lace up failed before starting container (exit $up_exit)"` (line 193, err)
9. `"lace up output:"` (line 194, err)
10. Last 15 lines of output (line 195, stderr)

### On `lace up` failure after "Starting devcontainer" (the reported issue)

11. `"warning: lace up exited with code $up_exit (checking if container started anyway...)"` (line 200, info)
12. `"waiting for container to be discoverable (attempt N/10)..."` (line 224, info, repeated up to 9 times)

### After retry loop exhaustion

13. `"lace up failed (exit $up_exit) and container is not discoverable"` (line 231, err)
14. `"lace up output (last 15 lines):"` (line 232, err)
15. Last 15 lines of output (line 233, stderr)
16. `"try: wez-into $project"` (line 238, err)

### After retry loop success (container found despite error)

17. `"container is running despite lace up exit $up_exit (likely a lifecycle hook failure)"` (line 245, info)

### On successful `lace up`

18. `"container started successfully"` (line 202, info)

## Information Loss Points

### 1. Immediate suppression of `lace up` output (line 165)

The `$( ... 2>&1)` capture is the primary information loss point. All of
`lace up`'s progress output (phase announcements, port allocations, warnings,
and error messages) is captured into `up_output` and not shown to the user.

On the "recoverable failure" path, the user sees only message #11 above. The
actual error output is deferred until message #14-15 (after ~20 seconds of
retries) or never shown (if the container is found, message #17).

### 2. The "Starting devcontainer" heuristic (line 192)

This heuristic depends on an exact match against `console.log("Starting
devcontainer...")` at line 561 of `up.ts`. If that string ever changes, the
heuristic breaks silently -- early failures would be misclassified as
"potentially recoverable" and subjected to 20 seconds of futile retries.

### 3. Tail truncation (lines 195, 233)

Both failure paths show only the last 15 lines of output via `tail -15`. For a
full `lace up` run that reached the `devcontainer up` phase, the output can be
hundreds of lines (feature metadata, port allocation, prebuild, etc.). The
actual error message is usually near the end, so the truncation is usually
acceptable -- but if `lace up` prints additional context after the error (e.g.,
the `result.message` summary), the root cause detail might be cut.

### 4. `lace up` mixing error messages into stdout (line 71 of commands/up.ts)

The command handler prints `result.message` (which contains failure details) via
`console.log` (stdout). The `runUp` function also prints to `console.error` for
the devcontainer-up stderr (line 574). Both end up in `up_output` due to `2>&1`.
This is not strictly a loss, but it means error context and progress output are
interleaved in the captured variable with no structural separation.

### 5. Silent discovery failures in retry loop

`lace-discover` exits 0 even when Docker is unavailable. The retry loop cannot
distinguish "container not yet ready" from "Docker daemon is down" from
"container failed to start." All three appear identical: empty discovery output,
followed by another 2-second sleep.

## Comparison with Existing Proposals

The proposal at `cdocs/proposals/2026-02-16-lace-up-progress-output.md`
directly addresses part of this problem. It proposes streaming `lace up` output
to the terminal in real time using `spawn` instead of `execFileSync`. If
implemented, `lace up`'s phase milestones would be visible to the user as they
happen, rather than being captured and suppressed.

However, that proposal focuses on `lace up`'s internal output architecture. It
does not address how `wez-into` captures and suppresses that output. Even with
streaming progress in `lace up`, the `$( ... 2>&1)` capture in `wez-into`
would still suppress everything.

## Recommendations

### 1. Show `lace up` output in real time instead of capturing it

Replace the output-capture pattern:

```bash
up_output=$("$lace_cli" up --workspace-folder "$workspace_path" 2>&1) || up_exit=$?
```

with a `tee`-based pattern that shows output to the user while also capturing it
for the heuristic check:

```bash
"$lace_cli" up --workspace-folder "$workspace_path" 2>&1 | tee /tmp/lace-up-$$.log
up_exit=${PIPESTATUS[0]}
up_output=$(cat /tmp/lace-up-$$.log)
```

This lets the user see `lace up`'s progress messages in real time while still
allowing the "Starting devcontainer" heuristic to work on the captured output.

### 2. Show captured error output immediately on the "recoverable failure" path

Even without recommendation #1, the script could print relevant lines from
`up_output` immediately after the warning at line 200, before entering the
retry loop. For example:

```bash
info "warning: lace up exited with code $up_exit (checking if container started anyway...)"
# Show the last few lines so the user knows what failed
echo "$up_output" | tail -5 >&2
```

This gives the user immediate context about the failure while the retry loop
proceeds.

### 3. Add a diagnostic message if the retry loop finds nothing on the first attempt

Currently, the first discovery attempt is silent. If the first attempt fails,
the user sees "attempt 2/10" with no explanation. Adding a note like "container
not yet visible to discovery" after the first failed attempt would clarify what
the loop is doing.

### 4. Distinguish discovery-infrastructure failures from "not yet ready"

If `lace-discover` were to exit with distinct codes for "Docker unavailable"
vs. "no matching containers," `wez-into` could fail fast on infrastructure
errors rather than retrying.

### 5. Direct `lace up` error messages to stderr

In `commands/up.ts`, change the failure path to use `console.error` instead of
`console.log` for `result.message` when `result.exitCode` is non-zero. This
would allow `wez-into` to capture stdout for heuristics while letting error
messages pass through stderr to the user (if it only redirected stdout).
However, this would require changing `wez-into`'s `2>&1` pattern.
