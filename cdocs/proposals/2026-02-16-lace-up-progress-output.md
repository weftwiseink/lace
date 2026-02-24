---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T14:00:00-05:00
task_list: lace/progress-output
type: proposal
state: live
status: review_ready
tags: [cli, ux, progress, subprocess, devcontainer]
---

# Incremental Progress Output for `lace up`

> BLUF: Replace the silent `execFileSync` subprocess calls during long-running
> phases (prebuild, devcontainer up) with a streaming `spawn`-based runner that
> parses `devcontainer --log-format json` stderr events and prints one-line
> milestones. The default output becomes a compact phase log with elapsed timing;
> `--verbose` inherits full subprocess stdio. The existing `RunSubprocess`
> interface stays unchanged for tests — the streaming runner is a parallel
> facility used only by the real CLI path.

## Objective

`lace up` currently prints "Starting devcontainer..." then goes completely silent
for what can be minutes while Docker builds images, creates containers, and runs
lifecycle commands. The only feedback is the final "lace up completed
successfully" or an error dump. Users cannot tell whether the process is stuck,
building, or running postCreateCommand.

Add minimal, incremental progress output so the user can see what phase the
devcontainer CLI is in without being flooded with Docker build noise.

## Background

### Current output architecture

All subprocess calls go through `runSubprocess` in `subprocess.ts`, which uses
`execFileSync` with `stdio: ["pipe", "pipe", "pipe"]`. Output is captured into a
`SubprocessResult` and never displayed to the user (except stderr on failure).

The three long-running subprocess phases are:
1. **Prebuild** (`devcontainer build`) — can take minutes on cold builds
2. **Resolve mounts** (`git clone`) — typically fast but can be slow on large repos
3. **Devcontainer up** (`devcontainer up`) — the longest phase, includes image
   build, container creation, and all lifecycle commands

### Devcontainer CLI JSON output

`devcontainer up` supports `--log-format json`, which writes structured JSON
lines to **stderr** while sending the final result JSON to **stdout**. Each
stderr line is a JSON object with fields like:

```json
{"type":"start","level":3,"timestamp":1234567890,"text":"Run: docker buildx build ..."}
{"type":"progress","level":3,"timestamp":1234567890,"text":"Step 3/12 : RUN apt-get update"}
{"type":"stop","level":3,"timestamp":1234567890,"text":"Run: docker buildx build ..."}
{"type":"start","level":3,"timestamp":1234567890,"text":"Running the postCreateCommand ..."}
```

The `type` field indicates lifecycle phases (`start`/`stop`/`progress`/`raw`),
and the `text` field contains human-readable descriptions that can be filtered
for milestone events.

### `RunSubprocess` test contract

The `RunSubprocess` type is used in 30+ test files via dependency injection. It
returns `SubprocessResult` (sync). The streaming runner must not break this
contract.

### No progress libraries in the dependency tree

The project depends only on `citty`, `dockerfile-ast`, and `jsonc-parser`. There
are no spinner, color, or progress bar libraries. The proposal should stay
consistent with this minimal dependency philosophy.

## Proposed Solution

### Architecture

```
                    ┌─────────────────────────────────────┐
                    │           runUp() in up.ts          │
                    │                                     │
                    │  Fast phases: use RunSubprocess      │
                    │  (execFileSync, piped, silent)       │
                    │                                     │
                    │  Long phases: use streamSubprocess   │
                    │  (spawn, JSON stderr parsing,        │
                    │   milestone printing)                │
                    └─────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
             default mode                    --verbose mode
          ┌─────────────────┐           ┌─────────────────┐
          │ Parse JSON stderr│           │ Inherit stderr  │
          │ Print milestones │           │ (full output)   │
          │ Show elapsed time│           │                 │
          └─────────────────┘           └─────────────────┘
```

### New `streamSubprocess` function

Add a new function in `subprocess.ts` that uses `child_process.spawn` (async)
instead of `execFileSync`:

```typescript
interface StreamSubprocessOptions {
  cwd?: string;
  /** Called for each stderr line. Return a string to print it, or null to suppress. */
  onStderrLine?: (line: string) => string | null;
  /** If true, inherit stderr directly (--verbose mode). */
  inheritStderr?: boolean;
}

function streamSubprocess(
  command: string,
  args: string[],
  options?: StreamSubprocessOptions,
): Promise<SubprocessResult>;
```

This function:
1. Spawns the child process with `stdio: ["pipe", "pipe", "pipe"]` (or
   `["pipe", "pipe", "inherit"]` in verbose mode)
2. Collects stdout into a buffer (for the final result JSON)
3. In default mode: reads stderr line-by-line, passes each line to
   `onStderrLine`, prints non-null returns via `process.stderr.write`
4. Returns the same `SubprocessResult` shape as `runSubprocess`

### JSON stderr parser for devcontainer output

A small filter function that extracts milestones from devcontainer JSON stderr:

```typescript
function devcontainerProgressFilter(line: string): string | null {
  try {
    const event = JSON.parse(line);
    if (event.type === "start" && typeof event.text === "string") {
      // Extract key phase transitions
      if (event.text.startsWith("Run: docker buildx build")) return "  Building image...";
      if (event.text.startsWith("Running the postCreateCommand")) return "  Running postCreateCommand...";
      if (event.text.startsWith("Running the postStartCommand")) return "  Running postStartCommand...";
      if (event.text.startsWith("Running the onCreateCommand")) return "  Running onCreateCommand...";
      if (event.text.startsWith("Running the updateContentCommand")) return "  Running updateContentCommand...";
      if (event.text.match(/^Starting container/)) return "  Starting container...";
    }
    return null; // suppress everything else
  } catch {
    return null; // non-JSON line, suppress
  }
}
```

### Updated `lace up` output

**Before:**
```
Auto-configured for worktree 'main' in /var/home/mjr/code/weft/lace
Fetching feature metadata...
Validated metadata for 2 feature(s)
Allocated ports:
  ssh: 22430
Running prebuild...
Prebuild complete. FROM rewritten to: lace.local/prebuild:abc123
Generating extended devcontainer.json...
Starting devcontainer...
                              ← silence for 30-120 seconds
lace up completed successfully
```

**After (default):**
```
Auto-configured for worktree 'main' in /var/home/mjr/code/weft/lace
Fetching feature metadata...
Validated metadata for 2 feature(s)
Allocated ports:
  ssh: 22430
Running prebuild...
  Building image...
Prebuild complete. FROM rewritten to: lace.local/prebuild:abc123
Generating extended devcontainer.json...
Starting devcontainer...
  Building image...
  Starting container...
  Running postCreateCommand...
lace up completed successfully (47s)
```

**After (`--verbose`):**
```
...same preamble...
Starting devcontainer...
[full devcontainer stderr output — docker build steps, layer downloads, etc.]
lace up completed successfully (47s)
```

### `--verbose` flag

Add a `--verbose` flag to the `up` command that:
1. Sets `inheritStderr: true` on `streamSubprocess` calls
2. Passes through to devcontainer as well (via `devcontainerArgs`)

This flag is separate from the existing devcontainer `--log-level` flag (which
the user can already pass through via `devcontainerArgs`).

### Elapsed time

Add total elapsed time to the final success/failure message. This requires only
a `Date.now()` at the start of `runUp` and a subtraction at the end — no timers
or intervals.

## Important Design Decisions

### Decision: New streaming function alongside `runSubprocess`, not replacing it

**Decision:** Add `streamSubprocess` as a separate function. Do not modify the
`RunSubprocess` type or `runSubprocess` implementation.

**Why:** The `RunSubprocess` type is injected into 30+ test files via dependency
injection. Tests provide synchronous mock implementations that return hardcoded
`SubprocessResult` values. Making this async would require updating every test
file. Instead, `streamSubprocess` is used directly in `runUp` for the
prebuild and devcontainer-up phases, while the injected `subprocess` continues to
be used for metadata fetches and other fast operations that don't need progress.

### Decision: Parse `--log-format json` rather than inheriting raw stderr

**Decision:** Use `--log-format json` to get structured events, then filter for
milestone lines.

**Why:** Raw devcontainer stderr is extremely noisy — it includes every Docker
build step, layer download progress, apt-get output, and lifecycle command
stdout/stderr. Dumping this to the terminal defeats the "minimalist" goal.
JSON parsing lets us extract just the phase transitions (building, starting,
running lifecycle commands) and present a clean, scannable log. The raw output
remains available via `--verbose` for debugging.

### Decision: No spinners or animated output

**Decision:** Use static line-by-line output, not spinners or in-place updates.

**Why:** Spinners (e.g., `ora`) require a dependency and complicate piped/CI
output. In-place updates (`\r`) can conflict with other output and are invisible
in non-TTY contexts. Static lines are universally compatible, grep-friendly, and
consistent with the project's existing output style.

### Decision: `streamSubprocess` is async, making `runUp` remain async

**Decision:** `streamSubprocess` returns a `Promise<SubprocessResult>`.

**Why:** `runUp` is already `async` (it `await`s `fetchAllFeatureMetadata`).
The streaming subprocess naturally requires async I/O. No signature changes
needed.

### Decision: Only stream long-running phases

**Decision:** Use `streamSubprocess` only for prebuild and devcontainer-up.
Metadata fetches, mount resolution, and config generation continue to use the
injected `RunSubprocess`.

**Why:** The fast phases complete in under a second. Adding streaming overhead
to them provides no UX benefit and complicates the DI-based test architecture.
The two long-running phases (prebuild, devcontainer up) are the ones where
silence is problematic.

### Decision: Elapsed time on final message only, not per-phase

**Decision:** Show total elapsed time in the final "lace up completed" message.
Do not show per-phase timing.

**Why:** Per-phase timing adds visual noise and requires tracking timers across
phases. The total time is the metric users care about ("how long did that
take?"). If per-phase timing becomes useful later (e.g., for performance
analysis), it can be added to the `UpResult.phases` data structure without
changing the console output.

## Stories

### First-time setup (cold build)

A developer runs `lace up` for the first time. Docker needs to build the image
from scratch (no layer cache). The prebuild phase takes 60s and devcontainer up
takes 90s. With progress output, they see "Building image..." appear within
seconds, confirming the process is working. Without it, they stare at "Starting
devcontainer..." for 2.5 minutes wondering if it's hung.

### Incremental rebuild (warm cache)

A developer runs `lace up` after a small config change. Docker layer cache
hits most steps. Prebuild takes 5s, devcontainer up takes 10s. The milestone
lines flash by quickly — the user sees the phase names but doesn't need to
read them. The "(15s)" at the end confirms it was fast.

### CI / piped output

A CI pipeline runs `lace up` with stdout/stderr piped to a log file. The
milestone lines appear as regular log entries, timestamps provided by CI.
No ANSI escape codes or cursor manipulation to corrupt the log.

### Debugging a stuck lifecycle command

A developer's `postCreateCommand` hangs. They see "Running postCreateCommand..."
appear and then silence. This narrows the problem to the lifecycle command rather
than the build or container creation. With `--verbose`, they can see the actual
command output to diagnose further.

## Edge Cases / Challenging Scenarios

### `devcontainer up` without `--log-format json`

If the user passes their own `--log-format text` via `devcontainerArgs`, lace
should not also inject `--log-format json`. The filter function should
gracefully handle non-JSON lines (already handled by the `try/catch` in the
parser — non-JSON lines return `null` and are suppressed).

Detection: check `devcontainerArgs` for `--log-format` before injecting.

### Subprocess spawn failure

If `devcontainer` is not on PATH or fails to spawn, `streamSubprocess` should
return a `SubprocessResult` with a non-zero exit code and descriptive stderr,
matching the behavior of `runSubprocess`.

### Very long lifecycle commands

Some `postCreateCommand` scripts run for minutes. The milestone output shows
"Running postCreateCommand..." but nothing else until it completes. This is
acceptable — the user knows what phase they're in. For more detail, `--verbose`
shows the full output.

### Prebuild also uses `devcontainer build`

The prebuild phase shells out to `devcontainer build`, which also supports
`--log-format json`. The same streaming + filter approach applies.

### `runUp` test path vs real path

Tests inject a mock `RunSubprocess` and set `skipDevcontainerUp: true`. The
streaming path is only taken when `skipDevcontainerUp` is false and no mock
subprocess is injected. Tests continue to work exactly as before.

The streaming function itself can be tested independently with a mock child
process or by spawning a trivial script that emits known JSON lines.

## Test Plan

### Unit tests for `streamSubprocess`

- Spawns a child process and captures stdout/stderr
- `onStderrLine` callback is invoked per line
- Returns correct exit code on success and failure
- `inheritStderr: true` passes stderr through (verify with captured output)
- Handles spawn errors gracefully

### Unit tests for `devcontainerProgressFilter`

- Parses JSON `start` events and returns milestone strings
- Returns `null` for non-milestone events (progress, raw, stop)
- Returns `null` for non-JSON lines
- Returns `null` for malformed JSON

### Integration tests

- `lace up` with `--verbose` passes `--log-format json` to devcontainer args
  (verify via mock subprocess args)
- `lace up` without `--verbose` also passes `--log-format json` (verify via
  mock subprocess args)
- User-provided `--log-format text` in devcontainerArgs is respected (lace does
  not inject conflicting flag)
- Elapsed time appears in final message

### Existing test compatibility

- All 726 existing tests pass without modification (the `RunSubprocess` DI path
  is untouched)

## Implementation Phases

### Phase 1: `streamSubprocess` function

**Scope:** Add `streamSubprocess` to `subprocess.ts` alongside the existing
`runSubprocess`.

**Files:**
- `packages/lace/src/lib/subprocess.ts` — new async function
- `packages/lace/src/lib/__tests__/subprocess.test.ts` — new test file

**Success criteria:**
- `streamSubprocess("echo", ["hello"])` returns `{ exitCode: 0, stdout: "hello\n", stderr: "" }`
- `onStderrLine` callback fires per line
- `inheritStderr: true` passes stderr through
- Spawn errors return non-zero exit code
- Existing `runSubprocess` unchanged

**Constraints:**
- Do not modify `RunSubprocess` type
- Do not modify any other files
- No new dependencies

### Phase 2: Devcontainer progress filter

**Scope:** Add `devcontainerProgressFilter` function and wire it into `runUp`
for the devcontainer-up and prebuild phases.

**Files:**
- `packages/lace/src/lib/progress.ts` — new file with filter function
- `packages/lace/src/lib/__tests__/progress.test.ts` — new test file
- `packages/lace/src/lib/up.ts` — use `streamSubprocess` for prebuild and
  devcontainer-up phases
- `packages/lace/src/commands/up.ts` — add `--verbose` flag, pass to `runUp`

**Success criteria:**
- Default `lace up` prints milestone lines during devcontainer-up
- `--verbose` shows full subprocess stderr
- Prebuild phase also streams progress
- User-provided `--log-format` is not overridden
- All existing tests pass

**Constraints:**
- Do not change behavior of fast phases (metadata fetch, mount resolution, etc.)
- Do not change `UpResult` shape
- The `subprocess` option in `UpOptions` continues to control fast-phase calls

### Phase 3: Elapsed timing

**Scope:** Add total elapsed time to the final result message.

**Files:**
- `packages/lace/src/lib/up.ts` — capture start time, format duration in
  result message
- `packages/lace/src/commands/up.ts` — no changes (prints `result.message`)

**Success criteria:**
- Success message includes "(Xs)" suffix
- Failure message also includes timing
- Time is wall-clock seconds, rounded to nearest second

**Constraints:**
- Do not add per-phase timing to console output
- Per-phase timing in `UpResult` data structure is out of scope (can be added
  later if needed)

## Open Questions

1. **Should `--verbose` also increase `--log-level` to `debug` or `trace`?**
   The devcontainer CLI's `--log-level` controls verbosity of its own logging.
   `--verbose` could map to `--log-level debug` in addition to inheriting
   stderr. Recommendation: keep them independent — `--verbose` controls lace's
   output behavior, `--log-level` is a devcontainer passthrough.

2. **Should milestone output go to stdout or stderr?** Currently all `lace up`
   output goes to stdout via `console.log`. The milestone lines are informational
   (not the primary result), which argues for stderr. But mixing stdout/stderr
   is confusing for users who aren't redirecting. Recommendation: stdout via
   `console.log`, consistent with existing phase messages.
