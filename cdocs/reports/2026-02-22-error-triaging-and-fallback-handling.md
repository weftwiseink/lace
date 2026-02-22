---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T12:00:00-06:00
task_list: lace/wez-into
type: report
state: live
status: wip
tags: [analysis, error-handling, wez-into, lace-up, ux, triaging, fallback]
related_to:
  - cdocs/reports/2026-02-13-wez-into-start-failure-investigation.md
  - cdocs/reports/2026-02-13-wez-into-output-noise-and-detach.md
  - cdocs/proposals/2026-02-16-lace-up-progress-output.md
  - cdocs/devlogs/2026-02-10-wez-into-start-flag-implementation.md
---

# Error Triaging and Fallback Handling in wez-into and lace up

> **BLUF:** When `lace up` fails with exit code 1, `wez-into` enters a 20-second
> discovery retry loop that is actively harmful for most failure categories. The
> root problem is that `wez-into` captures all `lace up` output into a variable
> (`2>&1`), uses a single text heuristic ("Starting devcontainer") to classify
> failures, and discards the rich structured phase information that `lace up`
> already produces internally via `UpResult.phases`. The fix is a two-layer
> approach: (1) have `lace up` emit a machine-readable failure summary that
> `wez-into` can parse to make informed retry/abort decisions, and (2) always
> surface the captured `lace up` output to the user immediately rather than
> deferring it to the end of the retry loop.

## Context / Background

A user running `wez-into dotfiles --start` observes the following problematic UX:

```
wez-into: starting dotfiles via lace up --workspace-folder /home/mjr/code/personal/dotfiles ...
wez-into: warning: lace up exited with code 1 (checking if container started anyway...)
wez-into: waiting for container to be discoverable (attempt 2/10)...
wez-into: waiting for container to be discoverable (attempt 3/10)...
wez-into: waiting for container to be discoverable (attempt 4/10)...
```

The user sees a vague warning followed by a slow retry loop, with no indication of
what went wrong, whether the retries have any chance of succeeding, or what they
should do. The actual error from `lace up` -- which contains detailed phase
information -- is captured but hidden until all 10 retry attempts are exhausted.

This report traces the error propagation path through both `lace up` (TypeScript)
and `wez-into` (bash), identifies the failure categories and their ideal handling,
and recommends concrete improvements.

## Key Findings

### 1. wez-into captures lace up output but hides it during retries

At `bin/wez-into` line 165, all stdout and stderr from `lace up` are merged and
captured into a single variable:

```bash
up_output=$("$lace_cli" up --workspace-folder "$workspace_path" 2>&1) || up_exit=$?
```

This means the user sees nothing from `lace up` during execution (no progress, no
warnings, no errors). They only see `wez-into`'s own messages. The captured output
is shown only when all retries fail (line 232-233) or when the pre-start heuristic
triggers early abort (line 194-195).

### 2. The "Starting devcontainer" heuristic is the only classification mechanism

At `bin/wez-into` line 192, the sole decision about whether to retry or abort is:

```bash
if ! grep -q "Starting devcontainer" <<< "$up_output"; then
  err "lace up failed before starting container (exit $up_exit)"
```

This text match against `console.log("Starting devcontainer...")` at
`packages/lace/src/lib/up.ts` line 561 is a fragile heuristic. It correctly
identifies pre-devcontainer-up failures (config read, validation, metadata fetch,
template resolution, prebuild, mount resolution, config generation) but provides
no further granularity.

### 3. lace up has rich structured phase data that is never exposed

The `UpResult` interface at `packages/lace/src/lib/up.ts` lines 68-82 tracks
per-phase exit codes and messages:

```typescript
phases: {
  workspaceLayout?: { exitCode: number; message: string };
  hostValidation?: { exitCode: number; message: string };
  portAssignment?: { exitCode: number; message: string; port?: number };
  metadataValidation?: { exitCode: number; message: string };
  templateResolution?: { exitCode: number; message: string };
  prebuild?: { exitCode: number; message: string };
  resolveMounts?: { exitCode: number; message: string };
  generateConfig?: { exitCode: number; message: string };
  devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
};
```

However, the `up` command at `packages/lace/src/commands/up.ts` line 71-73 only
prints `result.message` and sets `process.exitCode`. The phase data, which would
tell the caller exactly where the failure occurred, is discarded.

### 4. The retry loop is appropriate for exactly one failure category

The 10-attempt discovery retry loop (`bin/wez-into` lines 206-227) was designed
for the case documented in `cdocs/devlogs/2026-02-10-wez-into-start-flag-implementation.md`:
`lace up` exits 1 due to a `postStartCommand` failure (e.g., CWD mismatch in a
worktree layout) while the container itself is running and discoverable. In that
case, retrying discovery is correct because the container needs time for SSH to
become ready.

For all other failure categories, retrying is futile:

| Failure Category | Phase | Container Running? | Retry Helps? |
|---|---|---|---|
| Config read error | workspaceLayout, config parse | No | No |
| Host validation failure | hostValidation | No | No |
| Metadata fetch failure | metadataValidation | No | No |
| Template resolution error | templateResolution | No | No |
| Prebuild failure | prebuild | No | No |
| Mount resolution failure | resolveMounts | No | No |
| Config generation error | generateConfig | No | No |
| Docker build failure | devcontainerUp | No | No |
| Container creation failure | devcontainerUp | No | No |
| Lifecycle hook failure | devcontainerUp | Yes (usually) | Yes |
| SSH not yet ready | post-devcontainerUp | Yes | Yes |

### 5. lace up output on failure contains actionable information

When `lace up` fails, the `result.message` field contains a prefixed summary
that identifies the phase:

- `"Workspace layout failed: ..."` (line 148)
- `"Host validation failed: N error(s). Use --skip-validation to downgrade to warnings."` (lines 184-185)
- `"Feature \"X\" has invalid options: ..."` (line 248)
- `"Template resolution failed: ..."` (line 416)
- `"Prebuild failed: ..."` (line 494)
- `"Resolve mounts failed: ..."` (line 517)
- `"Config generation failed: ..."` (line 551)
- `"devcontainer up failed: ..."` (line 573)

Additionally, during execution, `lace up` writes progress messages to stdout via
`console.log`:
- `"Fetching feature metadata..."` (line 227)
- `"Running prebuild..."` (line 482)
- `"Generating extended devcontainer.json..."` (line 530)
- `"Starting devcontainer..."` (line 561)

And validation warnings/errors to stderr via `console.warn`/`console.error`:
- `"ERROR: Required file not found: ~/.ssh/lace_devcontainer.pub"` (line 178)
- `"Warning: Bind mount source does not exist: ..."` (line 436)

All of this is captured in the `up_output` variable but not shown to the user until
after the retry loop fails.

### 6. The final error message when retries are exhausted is informative but delayed

At `bin/wez-into` lines 229-239, when all 10 attempts fail:

```bash
if [[ $up_exit -ne 0 ]]; then
  err "lace up failed (exit $up_exit) and container is not discoverable"
  err "lace up output (last 15 lines):"
  echo "$up_output" | tail -15 >&2
else
  err "container started but not discoverable after $max_attempts attempts"
  err "the container may need more time to start SSH"
fi
err "try: wez-into $project"
```

This is the right information, but the user had to wait 20 seconds (10 attempts
x 2 seconds) to see it. For config errors or build failures, the container
will never appear, making the entire wait wasted.

### 7. Exit code 127/126 handling is already good

After the investigation in `cdocs/reports/2026-02-13-wez-into-start-failure-investigation.md`,
`wez-into` now handles exit codes 127 (command not found) and 126 (permission denied)
as immediate failures at lines 168-182. The `verify_lace_cli()` function at
lines 83-107 pre-checks that `node` is available. This is a model for how other
failure categories should be handled.

## Analysis: Error Flow Diagram

```
User: wez-into dotfiles --start
  |
  v
wez-into: locate_lace_cli() + verify_lace_cli()  <-- good: catches 127/126 early
  |
  v
wez-into: up_output=$("$lace_cli" up ... 2>&1)   <-- all output captured, nothing shown
  |
  v
exit 127/126? --> immediate abort with clear message  <-- good
  |
  v
exit != 0?
  |-- grep "Starting devcontainer" absent?
  |     --> abort with "failed before starting" + last 15 lines  <-- good, but...
  |         (user sees lace up output for the first time here)
  |
  |-- grep "Starting devcontainer" present?
  |     --> "warning: lace up exited with code $up_exit (checking if container started anyway...)"
  |     --> enter 10-attempt retry loop (20 seconds)  <-- BAD for most failures
  |         |
  |         v
  |       all retries exhausted?
  |         --> "lace up failed (exit $up_exit) and container is not discoverable"
  |         --> show last 15 lines of up_output  <-- user finally sees the error
  |
  v
exit == 0? --> "container started successfully" + discover + connect  <-- good
```

The critical gap is in the "Starting devcontainer present + non-zero exit" path.
The fact that `lace up` reached the `devcontainer up` phase does not mean the
container is running. Docker build failures, image pull failures, and container
creation failures all happen within the `devcontainer up` phase but result in no
running container.

## Analysis: What the User Actually Needs

When `lace up` fails, the user needs to answer three questions:

1. **What failed?** -- The specific phase and error message.
2. **Is the container running?** -- Determines whether retry/connect is viable.
3. **What should I do?** -- Actionable remediation steps.

The current flow answers none of these until 20 seconds later, and even then only
partially (the tail of captured output may not include the relevant error if it
scrolled past 15 lines of subsequent output).

## Recommendations

### R1: Show lace up output to the user in real-time (short-term)

Instead of capturing all output into a variable, stream it through while also
capturing it. This can be done with `tee` and a process substitution:

```bash
up_output=$("$lace_cli" up --workspace-folder "$workspace_path" 2>&1 | tee /dev/stderr) || up_exit=$?
```

Or, if the output should be prefixed to distinguish it from wez-into's own messages,
pipe through `sed`:

```bash
up_output=$("$lace_cli" up --workspace-folder "$workspace_path" 2>&1 | tee >(sed 's/^/  /' >&2)) || up_exit=$?
```

This way the user sees `lace up` progress and errors as they happen, not 20
seconds later. The existing progress proposal
(`cdocs/proposals/2026-02-16-lace-up-progress-output.md`) would further improve
this by adding milestone lines during long-running phases.

**Impact:** High. The user immediately sees what is happening and can Ctrl+C
if they recognize a fatal error, rather than watching helpless retry attempts.

**Files:** `bin/wez-into` lines 164-166.

### R2: Add a machine-readable failure summary to lace up (medium-term)

Add a `--json-summary` flag (or emit to a well-known file) that writes the
`UpResult` as JSON so callers can parse it:

```bash
lace up --workspace-folder "$path" --json-summary /tmp/lace-up-result.json
```

Or, more simply, have `lace up` emit a structured exit line on stderr that
`wez-into` can parse:

```
LACE_RESULT: {"phase":"devcontainerUp","exitCode":1,"containerMayBeRunning":true}
```

This would replace the "Starting devcontainer" grep heuristic with a precise
signal. The `containerMayBeRunning` field directly answers the key question:
should the caller retry discovery?

**Impact:** High. Eliminates the heuristic entirely, gives callers precise
information.

**Files:**
- `packages/lace/src/commands/up.ts` -- emit structured result line
- `packages/lace/src/lib/up.ts` -- add `containerMayBeRunning` to `UpResult`
- `bin/wez-into` -- parse the structured line

### R3: Classify devcontainer up failures into recoverable vs. fatal (medium-term)

The `devcontainerUp` phase currently returns a single `SubprocessResult`. The
failure could be a Docker build error (no container exists), a container creation
error (no container exists), or a lifecycle hook error (container exists and is
running). `wez-into` cannot distinguish these.

Within `runDevcontainerUp` at `packages/lace/src/lib/up.ts` lines 716-736,
after a non-zero exit from `devcontainer up`, check whether a container is
actually running:

```typescript
if (upResult.exitCode !== 0) {
  // Quick check: is a container running for this workspace?
  const checkResult = subprocess("docker", [
    "ps", "--filter", `label=devcontainer.local_folder=${workspaceFolder}`,
    "--format", "{{.ID}}"
  ]);
  const containerRunning = checkResult.exitCode === 0 && checkResult.stdout.trim() !== "";
  // ... annotate result with containerRunning
}
```

This gives `wez-into` the information it needs to decide whether retrying
discovery is worthwhile.

**Impact:** Medium. Reduces the problem to a single precise check rather than
a heuristic.

**Files:** `packages/lace/src/lib/up.ts` lines 555-576.

### R4: Show lace up error output immediately on failure, before retrying (short-term)

Even without R1's real-time streaming, the captured output should be shown
immediately when `lace up` exits non-zero, not after the retry loop:

At `bin/wez-into` line 200, after the "checking if container started anyway"
message, add:

```bash
info "lace up output:"
echo "$up_output" | tail -20 >&2
```

This way the user sees the error and can assess whether the retries are
worthwhile while they are happening.

**Impact:** Medium. The user can Ctrl+C the futile retries after seeing a
build error. Does not require any changes to `lace up`.

**Files:** `bin/wez-into` line 200, insert output display before retry loop.

### R5: Refine the pre-devcontainer-up heuristic (short-term)

The current heuristic checks for `"Starting devcontainer"` as a proxy for
"lace reached the devcontainer up phase." This can be supplemented with
additional checks from the captured output:

```bash
# Check for common fatal patterns that preclude a running container
if grep -qE "(docker build failed|Cannot connect to the Docker daemon|image.*not found)" <<< "$up_output"; then
  err "lace up failed during container creation (exit $up_exit)"
  err "lace up output:"
  echo "$up_output" | tail -20 >&2
  exit 1
fi
```

Known patterns from `lace up` output that indicate no container is running:

- `"devcontainer up failed:"` (line 573 of up.ts) -- could be build or lifecycle
- `"devcontainer build failed:"` (line 303 of prebuild.ts) -- definitely no container
- `"Prebuild failed:"` (line 494 of up.ts) -- definitely no container
- Docker daemon errors -- definitely no container
- Image pull failures -- definitely no container

**Impact:** Low-medium. Reduces futile retries for common failure modes without
requiring changes to `lace up`.

**Files:** `bin/wez-into` lines 183-201.

### R6: Reduce retry count and add early exit on known-dead patterns (short-term)

The current 10 attempts with 2-second sleep means 20 seconds of waiting. For
the legitimate case (container running, SSH not yet ready), SSH typically starts
within 2-4 seconds. A more aggressive strategy:

- Reduce max attempts to 5 (10 seconds max)
- On each retry iteration, check if the Docker container is still running
  (`docker ps --filter ...`). If it exited, abort immediately.

```bash
while [[ $attempts -lt $max_attempts ]]; do
  # ... discovery check ...

  # If lace up failed, check if the container is still alive
  if [[ $up_exit -ne 0 ]]; then
    container_running=$(docker ps --filter "label=devcontainer.local_folder=$workspace_path" --format '{{.ID}}' 2>/dev/null)
    if [[ -z "$container_running" ]]; then
      err "container is not running -- aborting discovery retries"
      break
    fi
  fi

  sleep 2
done
```

**Impact:** Medium. Reduces the worst-case wait from 20 seconds to near-instant
for the "container never started" case.

**Files:** `bin/wez-into` lines 206-227.

### R7: Improve the final error message with remediation guidance (short-term)

When all retries are exhausted, the current message is:

```
wez-into: error: lace up failed (exit 1) and container is not discoverable
wez-into: error: lace up output (last 15 lines):
[raw output]
wez-into: error: try: wez-into dotfiles
```

The suggestion to "try: wez-into dotfiles" is not useful -- it will just show
"not found in running containers." Better guidance would be:

```
wez-into: error: lace up failed (exit 1) and container is not discoverable
wez-into: error:
wez-into: error: lace up output (last 20 lines):
[raw output]
wez-into: error:
wez-into: error: to debug, run lace up directly:
wez-into: error:   lace up --workspace-folder /home/mjr/code/personal/dotfiles
wez-into: error:
wez-into: error: common causes:
wez-into: error:   - Docker daemon not running (check: docker info)
wez-into: error:   - Missing required files (check validation errors above)
wez-into: error:   - Image build failure (check Docker build output above)
```

**Impact:** Low. Improves the final error message but does not address the delay.

**Files:** `bin/wez-into` lines 229-239.

## Priority Matrix

| Rec | Effort | Impact | Requires lace changes | Recommended Order |
|-----|--------|--------|----------------------|-------------------|
| R4  | Low    | Medium | No                   | 1 (immediate)     |
| R1  | Low    | High   | No                   | 2 (immediate)     |
| R6  | Low    | Medium | No                   | 3 (immediate)     |
| R5  | Low    | Low-Med| No                   | 4 (immediate)     |
| R7  | Low    | Low    | No                   | 5 (immediate)     |
| R3  | Medium | Medium | Yes                  | 6 (next sprint)   |
| R2  | Medium | High   | Yes                  | 7 (next sprint)   |

Recommendations R1 through R5 and R7 can all be implemented in `bin/wez-into`
alone, requiring no changes to the `lace` TypeScript codebase. R6 requires a
trivial `docker ps` call. These five changes together would eliminate the vast
majority of the "20 seconds of futile retries" problem.

R2 and R3 are the strategic improvements that give `wez-into` (and any future
caller) precise information about what failed and whether the container is
running, replacing heuristics with structured data.
