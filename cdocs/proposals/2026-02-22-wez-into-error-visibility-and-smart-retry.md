---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T16:00:00-05:00
task_list: lace/wez-into
type: proposal
state: live
status: in_review
tags: [ux, error-handling, wez-into, lace-up, retry, messaging, bash, typescript]
related_to:
  - cdocs/reports/2026-02-22-wez-into-error-propagation-and-messaging.md
  - cdocs/reports/2026-02-22-error-triaging-and-fallback-handling.md
  - cdocs/proposals/2026-02-16-lace-up-progress-output.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-22T22:45:00-05:00
  round: 4
  scope: phase2-implementation
revision_history:
  - round: 1
    at: 2026-02-22T18:00:00-05:00
    by: "@claude-opus-4-6"
    summary: >
      Addressed all review feedback: fixed pipefail/PIPESTATUS factual error in 1a
      (simplified to `|| up_exit=$?`), moved isContainerRunning into commands/up.ts
      with proper imports, used mktemp+trap in main code, made containerMayBeRunning
      unconditional on failure, replaced grep -oP with bash string manipulation,
      quoted $workspace_path in remediation commands, noted LACE_RESULT filtering in
      1b excerpt.
---

# Error Visibility and Smart Retry for wez-into and lace up

> BLUF: When `lace up` fails during `wez-into --start`, the user sees a one-line
> warning followed by up to 20 seconds of futile retry polling with no diagnostic
> output. The fix is a two-phase approach: Phase 1 (bash-only, no lace changes)
> replaces the output-capture pattern with `tee` so `lace up` output streams to the
> terminal in real time, shows the error excerpt immediately before retries, adds a
> `docker ps` early-exit check so retries abort as soon as the container is confirmed
> dead, and replaces the unhelpful "try: wez-into $project" suggestion with actionable
> remediation guidance. Phase 2 (TypeScript) adds a machine-readable `LACE_RESULT`
> status line to `lace up` output, enabling `wez-into` to replace the fragile
> "Starting devcontainer" grep heuristic with structured data that includes the
> failed phase and whether the container may be running. These two phases together
> eliminate the "20 seconds of silence" problem for all failure categories. The
> related progress-output proposal
> (`cdocs/proposals/2026-02-16-lace-up-progress-output.md`) is complementary: it
> improves what `lace up` says during long-running phases; this proposal improves
> whether and when the user sees it.

## Objective

Make `wez-into --start` failures immediately informative. The user should never be
left watching a retry counter tick up while the actual error sits hidden in a shell
variable. Specifically:

1. The user sees `lace up` output as it happens, not 20 seconds later.
2. Retries stop immediately when the container is confirmed not running.
3. Final error messages include actionable remediation steps.
4. The "Starting devcontainer" text heuristic is replaced with a structured signal.

## Background

Two analysis reports documented the full error propagation chain:

- **Error Propagation Report** (`cdocs/reports/2026-02-22-wez-into-error-propagation-and-messaging.md`):
  Traces every layer from `wez-into` through `lace up` through `subprocess.ts`,
  identifying five information loss points and cataloging all 18 user-visible messages.

- **Error Triaging Report** (`cdocs/reports/2026-02-22-error-triaging-and-fallback-handling.md`):
  Analyzes the failure category taxonomy (11 categories, only 2 benefit from retries),
  the rich `UpResult.phases` data that is discarded by the command handler, and
  provides 7 concrete recommendations (R1-R7) with a priority matrix.

The core problems, synthesized from both reports:

1. **Output capture suppresses everything.** At `bin/wez-into` line 165, the
   `$( ... 2>&1)` pattern merges stdout and stderr into a shell variable. Nothing
   from `lace up` reaches the user's terminal until the retry loop finishes or
   the pre-start heuristic triggers early abort.

2. **The retry loop is futile for 9 of 11 failure categories.** The only cases
   where the container might be running despite `lace up` exit 1 are lifecycle
   hook failures and SSH-not-yet-ready. Config errors, validation failures,
   Docker build failures, and container creation failures all leave no running
   container, making every retry iteration wasted time.

3. **Final error messages lack guidance.** The current suggestion "try: wez-into
   $project" after retry exhaustion is actively misleading -- it will just report
   "not found in running containers."

4. **`lace up` discards its own structured data.** The `UpResult.phases` object
   tracks per-phase exit codes and messages, but the command handler at
   `packages/lace/src/commands/up.ts` line 71-73 only prints `result.message`
   via `console.log`. The phase data is lost.

### Related Work

The **Incremental Progress Output** proposal
(`cdocs/proposals/2026-02-16-lace-up-progress-output.md`) addresses what `lace up`
says during execution by adding streaming milestone output for long-running phases
(prebuild, devcontainer up). That proposal is complementary to this one:

- Progress output improves `lace up`'s internal verbosity during normal operation.
- This proposal ensures that whatever `lace up` says actually reaches the user
  through `wez-into`'s orchestration layer, and that failures are triaged
  intelligently rather than subjected to blind retry loops.

Both proposals can be implemented independently. If the progress output proposal
lands first, its milestone lines will be visible to users immediately because
Phase 1 of this proposal streams `lace up` output in real time. If this proposal
lands first, the streaming infrastructure is ready for richer milestone content.

## Proposed Solution

### Phase 1: Bash-only improvements to `wez-into` (no lace changes)

All changes are confined to `bin/wez-into`. No TypeScript changes required.

#### 1a. Stream `lace up` output in real time via `tee`

Replace the output-capture-and-suppress pattern with a `tee`-based pattern that
shows output to the user while still capturing it for the heuristic check.

**File:** `bin/wez-into` lines 164-166

**Current:**

```bash
local up_output up_exit
up_output=$("$lace_cli" up --workspace-folder "$workspace_path" 2>&1) || up_exit=$?
up_exit=${up_exit:-0}
```

**Proposed:**

```bash
local up_logfile
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

The `>&2` after `tee` sends the echoed output to stderr so it does not interfere
with any stdout-based scripting. The user sees `lace up` progress messages, phase
announcements, warnings, and errors as they happen. The `up_output` variable still
holds the full captured text for the "Starting devcontainer" heuristic check.

The `mktemp` call creates a unique temporary file, and the `trap` ensures cleanup
on unexpected exit (Ctrl+C, `set -e` abort). The trap is cleared after the file
is explicitly removed on the normal path.

> NOTE: `set -euo pipefail` is set on `bin/wez-into` line 16. With `pipefail`,
> the pipeline's exit status is the exit code of the leftmost failing command
> (when `tee` succeeds, which it almost always does). The `|| up_exit=$?` pattern
> works correctly here because: (a) `pipefail` propagates `lace`'s non-zero exit
> code as the pipeline's exit status, (b) the `||` suppresses `set -e` so the
> script does not abort, and (c) `$?` at this point is the pipeline's exit status,
> which equals `lace`'s exit code. No `PIPESTATUS` gymnastics are needed.

#### 1b. Show error excerpt immediately before retries

On the "recoverable failure" path (line 200), show the last few lines of captured
output so the user has diagnostic context while the retry loop proceeds.

**File:** `bin/wez-into` line 200, insert after the warning

**Current:**

```bash
info "warning: lace up exited with code $up_exit (checking if container started anyway...)"
```

**Proposed:**

```bash
info "warning: lace up exited with code $up_exit (checking if container started anyway...)"
info ""
info "lace up error context (last 5 lines):"
echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -5 >&2
info ""
```

> NOTE: With 1a implemented, the user will already have seen the full output in
> real time. This excerpt serves as a reminder/summary, particularly useful when
> scrollback is long. If 1a is implemented, this change is lower priority but still
> valuable for the "glanceable summary" use case.
>
> The `grep -v '^LACE_RESULT: '` filter excludes the machine-readable result line
> (added in Phase 2) from the human-readable excerpt. Before Phase 2 lands, the
> grep harmlessly matches nothing and passes all lines through.

#### 1c. Add `docker ps` early-exit check to the retry loop

During the retry loop, check whether a Docker container is actually running for
this workspace. If no container is found, abort retries immediately -- there is
nothing to discover.

The check is unconditional (runs regardless of `up_exit`) so that it also catches
the edge case where `lace up` exits 0 but the container crashes immediately after.

**File:** `bin/wez-into` lines 210-227

**Current:**

```bash
while [[ $attempts -lt $max_attempts ]]; do
    while IFS=: read -r name p user path; do
      if [[ "$name" == "$project" ]]; then
        port="$p"
        break
      fi
    done < <(discover)

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

**Proposed:**

```bash
while [[ $attempts -lt $max_attempts ]]; do
    while IFS=: read -r name p user path; do
      if [[ "$name" == "$project" ]]; then
        port="$p"
        break
      fi
    done < <(discover)

    if [[ -n "$port" ]]; then
      break
    fi

    # Check if a container is even running for this workspace.
    # No running container means retries are futile.
    local container_id
    container_id=$(docker ps \
      --filter "label=devcontainer.local_folder=$workspace_path" \
      --format '{{.ID}}' 2>/dev/null || true)
    if [[ -z "$container_id" ]]; then
      info "no container running for $workspace_path -- aborting discovery retries"
      break
    fi

    attempts=$((attempts + 1))
    if [[ $attempts -lt $max_attempts ]]; then
      info "waiting for container to be discoverable (attempt $((attempts))/$max_attempts)..."
      sleep 2
    fi
done
```

This eliminates up to 20 seconds of wasted time for all failure categories where
no container was created (config errors, validation failures, Docker build failures,
container creation failures). The `docker ps` call is inexpensive (single label
filter, local daemon).

> NOTE: The `docker ps` check runs on every retry iteration, not just when
> `up_exit` is non-zero. This makes the check unconditional, which is simpler and
> also catches the edge case where `lace up` exits 0 but the container crashes
> immediately afterward. The cost of one extra `docker ps` call per retry iteration
> on the success path is negligible (the success path typically finds the container
> on the first discovery attempt and never enters the retry body).
>
> Edge case: on the first iteration, if `lace up` just exited and the container is
> in a Docker cleanup/zombie state, `docker ps` might briefly show it as "running"
> before it transitions to "exited." This would cause one extra retry iteration
> (2 seconds), which is acceptable.

#### 1d. Reduce max retry attempts

Even for the legitimate retry case (lifecycle hook failure with container running),
SSH typically starts within 2-4 seconds. 10 attempts (20 seconds) is excessive.

**File:** `bin/wez-into` line 208

**Current:**

```bash
local max_attempts=10
```

**Proposed:**

```bash
local max_attempts=5
```

Combined with 1c, the worst case for a "container actually running" scenario is 10
seconds. For the "container not running" scenario, the `docker ps` check at 1c
causes immediate exit on the first retry iteration.

#### 1e. Replace final error message with actionable guidance

Replace the unhelpful "try: wez-into $project" suggestion with remediation guidance.

**File:** `bin/wez-into` lines 229-239

**Current:**

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

**Proposed:**

```bash
if [[ -z "$port" ]]; then
    if [[ $up_exit -ne 0 ]]; then
      err "lace up failed (exit $up_exit) and container is not discoverable"
      # Only show tail if output was NOT already streamed (1a fallback).
      # With tee-based streaming, the user already saw everything in real time.
      # Still show a short excerpt as a reminder of the failure.
      err ""
      err "error context (last 10 lines):"
      echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -10 >&2
      err ""
      err "to debug, run lace up directly:"
      err "  lace up --workspace-folder \"$workspace_path\""
      err ""
      err "common causes:"
      err "  - Docker daemon not running          (check: docker info)"
      err "  - Missing host-side files             (check validation errors above)"
      err "  - Image build failure                 (check Docker build output above)"
      err "  - Lifecycle hook failure, no container (check: docker ps -a --filter label=devcontainer.local_folder=\"$workspace_path\")"
    else
      err "container started but not discoverable after $max_attempts attempts"
      err "the container may need more time to start SSH"
      err ""
      err "check container status:"
      err "  docker ps --filter label=devcontainer.local_folder=\"$workspace_path\""
      err ""
      err "to retry connection:"
      err "  wez-into $project"
    fi
    exit 1
fi
```

The guidance distinguishes between the two failure modes (lace up failed vs.
container started but not discoverable) and provides specific diagnostic commands
rather than a generic retry suggestion. The `$workspace_path` is quoted in
suggested commands to handle paths containing spaces.

#### 1f. Fix the "attempt 1/N" off-by-one

The current loop skips "attempt 1/10" and starts at "attempt 2/10" because
`attempts` is incremented before the message is printed, and the first attempt
has no message.

**File:** `bin/wez-into` lines 222-226

**Current:**

```bash
    attempts=$((attempts + 1))
    if [[ $attempts -lt $max_attempts ]]; then
      info "waiting for container to be discoverable (attempt $((attempts + 1))/$max_attempts)..."
      sleep 2
    fi
```

**Proposed:**

```bash
    attempts=$((attempts + 1))
    if [[ $attempts -lt $max_attempts ]]; then
      info "waiting for container to be discoverable (attempt $((attempts))/$max_attempts)..."
      sleep 2
    fi
```

This prints "attempt 1/5" on the first visible retry, matching user expectations.
The loop starts with `attempts=0`; after the first failed discovery, `attempts`
becomes 1 and the message reads "attempt 1/5". After the second, "attempt 2/5",
and so on up to "attempt 4/5" (since the condition is `attempts < max_attempts`).
This gives 5 total discovery attempts: the first silent one plus 4 with messages.

### Phase 2: Structured result line from `lace up` (TypeScript changes)

Add a machine-readable result line to `lace up` output that `wez-into` can parse,
replacing the fragile "Starting devcontainer" grep heuristic with precise metadata.

#### 2a. Emit `LACE_RESULT` line from the command handler

**File:** `packages/lace/src/commands/up.ts` lines 69-75

**Current:**

```typescript
const result = await runUp(options);

if (result.message) {
    console.log(result.message);
}

process.exitCode = result.exitCode;
```

**Proposed:**

```typescript
import { runSubprocess as defaultRunSubprocess } from "@/lib/subprocess";

// ... (inside the run() handler, after runUp completes)

const result = await runUp(options);

if (result.message) {
    console.log(result.message);
}

// Emit machine-readable result line for callers (e.g., wez-into).
// This goes to stderr so it doesn't interfere with stdout-based parsing.
// Format: LACE_RESULT: {"exitCode":N,"failedPhase":"...","containerMayBeRunning":bool}
const failedPhase = result.exitCode !== 0
    ? Object.entries(result.phases).find(([, v]) => v && v.exitCode !== 0)?.[0] ?? "unknown"
    : null;
const containerMayBeRunning = result.exitCode !== 0
    && isContainerRunning(options.workspaceFolder ?? process.cwd());
const laceResult = {
    exitCode: result.exitCode,
    failedPhase,
    containerMayBeRunning,
};
console.error(`LACE_RESULT: ${JSON.stringify(laceResult)}`);

process.exitCode = result.exitCode;
```

The `LACE_RESULT:` prefix makes the line easy to grep from captured output. The
JSON payload provides:

- `exitCode`: The overall exit code (redundant with process exit code, but
  included for completeness).
- `failedPhase`: The name of the first phase that failed, or `null` on success.
  This replaces the "Starting devcontainer" heuristic entirely.
- `containerMayBeRunning`: Whether a Docker container matching the workspace
  folder is currently running. This is the key signal for retry decisions.

> NOTE: The `containerMayBeRunning` check runs `isContainerRunning` unconditionally
> on all failure paths, regardless of which phase failed. The `docker ps` call is the
> ground truth -- if a container is running, it should be reported regardless of
> which phase the proposal thinks could leave one. This is simpler and future-proof
> (a new phase could conceivably leave a running container). The `docker ps` call is
> only executed on the failure path, so there is no performance impact on success.

#### 2b. Add `isContainerRunning` helper in the command handler

**File:** `packages/lace/src/commands/up.ts` (new function at module scope)

The helper is placed directly in `commands/up.ts` rather than in `lib/up.ts`
because it is a post-`runUp` diagnostic check, not part of the core `runUp`
pipeline. This keeps it close to its only call site and avoids needing to export
it from the library module.

```typescript
import { runSubprocess as defaultRunSubprocess } from "@/lib/subprocess";

/**
 * Quick check: is a Docker container running for this workspace folder?
 * Used to annotate failure results for callers that need to decide
 * whether to retry discovery.
 *
 * This function uses the default subprocess runner (not the injected mock)
 * because it is a post-runUp diagnostic, not part of the phase pipeline.
 */
function isContainerRunning(workspaceFolder: string): boolean {
    try {
        const result = defaultRunSubprocess("docker", [
            "ps",
            "--filter", `label=devcontainer.local_folder=${workspaceFolder}`,
            "--format", "{{.ID}}",
        ]);
        return result.exitCode === 0 && result.stdout.trim() !== "";
    } catch {
        return false;
    }
}
```

> NOTE: This function is called only on the failure path, so the extra `docker ps`
> call has no performance impact on the success path. The `try/catch` handles the
> case where `docker` is not on PATH (`execFileSync` throws `ENOENT`). The function
> uses `defaultRunSubprocess` (synchronous `execFileSync`) which briefly blocks the
> event loop, but since this is a CLI tool about to exit, that is acceptable.

#### 2c. Parse `LACE_RESULT` in `wez-into`

**File:** `bin/wez-into` lines 183-203, replace the heuristic block

**Current heuristic:**

```bash
elif [[ $up_exit -ne 0 ]]; then
    if ! grep -q "Starting devcontainer" <<< "$up_output"; then
      err "lace up failed before starting container (exit $up_exit)"
      err "lace up output:"
      echo "$up_output" | tail -15 >&2
      exit 1
    fi
    info "warning: lace up exited with code $up_exit (checking if container started anyway...)"
```

**Proposed (with fallback to existing heuristic):**

```bash
elif [[ $up_exit -ne 0 ]]; then
    # Parse structured result line if available (Phase 2 of lace up).
    # Falls back to the "Starting devcontainer" heuristic for older lace versions.
    local lace_result_line container_may_be_running failed_phase
    lace_result_line=$(grep '^LACE_RESULT: ' <<< "$up_output" | tail -1 || true)

    if [[ -n "$lace_result_line" ]]; then
      # Structured result available -- use it.
      local result_json="${lace_result_line#LACE_RESULT: }"

      # Extract fields using bash string manipulation (no jq or grep -P dependency).
      container_may_be_running="false"
      if [[ "$result_json" == *'"containerMayBeRunning":true'* ]]; then
        container_may_be_running="true"
      fi

      # Extract failedPhase value via bash parameter expansion.
      # The JSON is flat and predictable: {"failedPhase":"someName",...}
      local phase_fragment="${result_json#*\"failedPhase\":\"}"
      if [[ "$phase_fragment" != "$result_json" ]]; then
        failed_phase="${phase_fragment%%\"*}"
      else
        failed_phase="unknown"
      fi

      if [[ "$container_may_be_running" != "true" ]]; then
        err "lace up failed in phase '$failed_phase' (exit $up_exit)"
        err "container is not running -- no point retrying discovery"
        err ""
        err "error context (last 10 lines):"
        echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -10 >&2
        err ""
        err "to debug, run lace up directly:"
        err "  lace up --workspace-folder \"$workspace_path\""
        exit 1
      fi

      info "warning: lace up failed in phase '$failed_phase' (exit $up_exit) but container may be running"
      info "checking if container is discoverable..."
    else
      # Fallback: legacy heuristic for older lace versions without LACE_RESULT.
      if ! grep -q "Starting devcontainer" <<< "$up_output"; then
        err "lace up failed before starting container (exit $up_exit)"
        err ""
        err "error context (last 10 lines):"
        echo "$up_output" | tail -10 >&2
        err ""
        err "to debug, run lace up directly:"
        err "  lace up --workspace-folder \"$workspace_path\""
        exit 1
      fi
      info "warning: lace up exited with code $up_exit (checking if container started anyway...)"
    fi
```

The fallback ensures backward compatibility: if someone runs a newer `wez-into`
with an older `lace` that does not emit `LACE_RESULT`, the existing heuristic
still works.

## Important Design Decisions

### Decision: `tee` to stderr, not stdout

**Decision:** Stream `lace up` output to stderr via `tee "$up_logfile" >&2`.

**Why:** `wez-into` does not currently pipe its stdout to anything, but future
callers or wrapper scripts might. Sending diagnostic output to stderr keeps stdout
clean for structured output (e.g., `--dry-run` prints commands to stdout). All of
`wez-into`'s own messages (`info`, `err`) already go to stderr.

### Decision: `LACE_RESULT` on stderr, not stdout

**Decision:** Emit the machine-readable `LACE_RESULT` line via `console.error`
(stderr), not `console.log` (stdout).

**Why:** `lace up`'s stdout is currently used for human-readable messages
(`result.message`). Adding a machine-readable line to stdout would break callers
that parse stdout for the result message. Using stderr keeps the channels separate.
Since `wez-into` captures both streams via `2>&1`, the `LACE_RESULT` line is still
available in `up_output`.

### Decision: Lightweight JSON parsing in bash, no `jq` dependency

**Decision:** Parse the `LACE_RESULT` JSON using bash string manipulation
(`${var#pattern}`, `${var%%pattern}`) and glob matching rather than `jq` or
`grep -oP`.

**Why:** `jq` is not a guaranteed dependency on all systems where `wez-into` runs.
`grep -oP` (Perl-compatible regex) is a GNU extension not available on macOS or
minimal Docker images. While the current target is Fedora (where both are
available), using only bash builtins for JSON extraction is consistent with the
"no external tool dependencies" design principle already established in the script.
The `LACE_RESULT` JSON payload is intentionally simple (flat object, no nesting,
predictable field order) to enable reliable extraction with basic string tools.

### Decision: `docker ps` check inside the retry loop, not before it

**Decision:** Check `docker ps` on each retry iteration rather than once before
entering the loop.

**Why:** There is a race condition: the container might still be starting when
`lace up` exits (the `devcontainer up` CLI exits after the container starts but
before SSH is ready, for example during postStartCommand). A one-time check before
the loop could miss a container that starts milliseconds later. Checking on each
iteration catches both the "never started" and "started then crashed" cases.

### Decision: Unconditional `docker ps` check (not gated on `up_exit`)

**Decision:** Run the `docker ps` check in the retry loop on every iteration,
regardless of whether `lace up` exited 0 or non-zero.

**Why:** This is simpler (no conditional) and catches the edge case where `lace up`
exits 0 but the container crashes immediately afterward. The cost is one extra
`docker ps` call per retry iteration on the success path, which is negligible since
the success path typically finds the container on the first discovery attempt and
never enters the retry body. The same reasoning applies to Phase 2's
`containerMayBeRunning` field -- `isContainerRunning` is called unconditionally on
the failure path, since `docker ps` is the ground truth regardless of which phase
failed.

### Decision: Keep the "Starting devcontainer" heuristic as a fallback

**Decision:** Do not remove the grep heuristic in Phase 2. Keep it as a fallback
for older `lace` versions.

**Why:** `wez-into` and `lace` are co-located in the same repo, but they could
temporarily be out of sync (e.g., during development, or if `wez-into` is symlinked
to a different version). The fallback costs nothing and provides graceful
degradation.

### Decision: Phase 1 is self-contained and valuable without Phase 2

**Decision:** Phase 1 (bash-only changes) provides the majority of the UX
improvement and has no dependency on Phase 2.

**Why:** Real-time output streaming (1a) and the `docker ps` early-exit check (1c)
together eliminate the two worst aspects of the current behavior: hidden output and
futile retries. Phase 2 adds precision (replacing a heuristic with structured data)
but the heuristic is already correct for the common case. Implementing Phase 1
first delivers immediate value.

### Decision: `isContainerRunning` in `commands/up.ts`, not `lib/up.ts`

**Decision:** Place the `isContainerRunning` helper function in
`packages/lace/src/commands/up.ts` (the command handler file) rather than in
`packages/lace/src/lib/up.ts` (the library module).

**Why:** The function is a post-`runUp` diagnostic check used exclusively by the
command handler to annotate the `LACE_RESULT` line. It is not part of the core
`runUp` pipeline and has no other callers. Placing it in the command handler keeps
it close to its only call site, avoids polluting the library's public API, and
eliminates the need for export/import plumbing. It uses `defaultRunSubprocess`
directly (imported from `@/lib/subprocess`), not the injected mock, because it
runs after the phase pipeline is complete.

## Stories

### Config validation failure

A developer runs `wez-into dotfiles --start`. Their SSH key file is missing.
`lace up` fails in the hostValidation phase with "ERROR: Required file not found:
~/.ssh/lace_devcontainer.pub".

**Before:** The user sees "warning: lace up exited with code 1 (checking if
container started anyway...)" followed by 20 seconds of retry polling. The
validation error is hidden in `up_output`.

**After (Phase 1):** The user sees the validation error in real time as `lace up`
prints it. The retry loop checks `docker ps`, finds no container, and aborts
immediately. The final message suggests running `lace up` directly and lists
"Missing host-side files" as a common cause.

**After (Phase 2):** The LACE_RESULT line reports `failedPhase: "hostValidation"`
and `containerMayBeRunning: false`. `wez-into` prints "lace up failed in phase
'hostValidation' (exit 1) -- container is not running" and exits immediately with
no retry loop at all.

### Docker build failure

A developer changes their Dockerfile and introduces a syntax error. `lace up`
reaches the devcontainer up phase ("Starting devcontainer...") but `devcontainer up`
fails during the Docker build.

**Before:** The user sees the "checking if container started anyway" warning.
The "Starting devcontainer" heuristic triggers the full retry loop because that
string IS present in the output. 20 seconds of futile retries follow.

**After (Phase 1):** The user sees the Docker build error in real time. The retry
loop checks `docker ps` on the first iteration, finds no container, and aborts.

**After (Phase 2):** The LACE_RESULT line reports `failedPhase: "devcontainerUp"`
and `containerMayBeRunning: false` (the `docker ps` check in `isContainerRunning`
confirms no container). `wez-into` exits immediately.

### Lifecycle hook failure (legitimate retry case)

A developer's `postStartCommand` fails due to a transient network error. The
container IS running.

**Before:** The retry loop eventually discovers the container and connects. But
the user waited up to 20 seconds with no information.

**After (Phase 1):** The user sees the lifecycle error in real time. The retry loop
checks `docker ps`, finds the container IS running, and continues retrying
discovery. Discovery succeeds within a few iterations. Total wait: 2-6 seconds.

**After (Phase 2):** The LACE_RESULT line reports `containerMayBeRunning: true`.
`wez-into` prints "container may be running, checking discovery..." and enters
the retry loop with confidence.

## Edge Cases / Challenging Scenarios

### `tee` failure or `/tmp` not writable

If `mktemp` fails to create the log file, the script exits immediately with a
clear error message (the `|| { err ...; exit 1; }` handler in 1a). If `tee`
cannot write to the file after creation (disk full mid-write), the pipeline
fails. The `|| up_exit=$?` captures the exit code, but `up_output` will be
empty or partial. The heuristic check will not find "Starting devcontainer" and
will take the early-abort path, which is the safe default (fail fast rather than
retry blindly).

The `trap "rm -f ..." EXIT` ensures the temp file is cleaned up even if the script
is interrupted (Ctrl+C, `set -e` abort) between creation and explicit removal.

### `tee` fails, giving a misleading exit code

With `set -euo pipefail`, if `tee` itself exits non-zero (e.g., write error), the
pipeline's exit status could reflect `tee`'s error rather than `lace`'s. This is
extremely unlikely in practice (`tee` to a local file almost never fails), but if
it happens, `up_exit` will be non-zero (correct direction) and the script will
take the failure path (safe default). The `docker ps` check in the retry loop will
determine the actual container state regardless of exit code provenance.

### `LACE_RESULT` line absent (older lace version)

Handled by the fallback to the "Starting devcontainer" heuristic in Phase 2c. The
grep for `LACE_RESULT:` returns empty, and the code takes the `else` branch.

### `LACE_RESULT` line appears multiple times

Defensive: the `tail -1` in `grep '^LACE_RESULT: ' <<< "$up_output" | tail -1`
ensures we use only the last occurrence. Multiple occurrences should not happen
(the line is emitted once at the end of the command handler), but if some debug
logging accidentally includes the prefix, the last line is the authoritative one.

### `docker ps` is slow or Docker daemon is down

The `docker ps` call in the retry loop uses `2>/dev/null || true` to suppress
errors and treat failures as "container not found." If Docker is completely
unavailable, every iteration will see an empty result and immediately break out
of the loop (no container running). This is correct behavior -- if Docker is
down, there is nothing to discover.

### Race condition: container starts after `docker ps` check

The `docker ps` check could return empty if the container is in the process of
starting (between `docker create` and `docker start`). This is unlikely because
`devcontainer up` does not exit until the container is at least in the "running"
state. But if it happens, the check on the next retry iteration (2 seconds later)
will see the running container and continue the loop.

### `lace up` output contains a line starting with `LACE_RESULT:`

If `lace up`'s stdout or stderr happens to include a line matching the
`^LACE_RESULT: ` pattern from a source other than the command handler (e.g.,
embedded in Docker build output), the parser could extract incorrect data. The
prefix is intentionally chosen to be unlikely in organic output. The `tail -1`
ensures the last occurrence (the one emitted by the command handler, which runs
after all phases) takes precedence.

### `failedPhase` is `null` in the JSON

When `lace up` succeeds (`exitCode: 0`), `failedPhase` is `null` (not a quoted
string). The bash string extraction `${result_json#*\"failedPhase\":\"}` will not
match `"failedPhase":null` (no opening quote after the colon), so
`phase_fragment` will equal `result_json` and `failed_phase` will be set to
`"unknown"`. This is harmless because the `failedPhase` value is only used on
the failure path (when `up_exit` is non-zero), and a successful result never
reaches that code path.

## Test Plan

### Phase 1 (bash-only changes)

Phase 1 changes are in `bin/wez-into`, a bash script. There is no existing test
harness for `wez-into` (it is an integration-level script). Testing is manual
and scenario-based. If a test harness is ever added, `bats` (Bash Automated
Testing System) would be well-suited for these scenarios.

**Manual test scenarios:**

1. **Normal success path:** `wez-into --start <project>` with a working config.
   Verify `lace up` output streams to the terminal in real time, followed by
   "container started successfully" and connection.

2. **Config validation failure:** Remove `~/.ssh/lace_devcontainer.pub` and run
   `wez-into --start <project>`. Verify the validation error appears in real time,
   the retry loop aborts immediately (no "waiting for container" messages), and
   the final message includes remediation guidance.

3. **Docker build failure:** Introduce a Dockerfile error and run
   `wez-into --start <project>`. Verify the build error appears in real time,
   the `docker ps` check finds no container, and retries abort immediately.

4. **Lifecycle hook failure with running container:** Configure a `postStartCommand`
   that fails (e.g., `false`). Verify `lace up` output streams in real time,
   the retry loop finds the container via `docker ps`, and discovery succeeds
   within 1-2 iterations.

5. **Docker daemon not running:** Stop Docker and run `wez-into --start <project>`.
   Verify the error appears in real time and retries abort immediately.

### Phase 2 (TypeScript changes)

**Unit tests for `isContainerRunning`:**

- Returns `true` when `docker ps` finds a matching container.
- Returns `false` when `docker ps` finds no matching container.
- Returns `false` when `docker ps` fails (e.g., Docker not on PATH).

**Unit tests for LACE_RESULT emission:**

- On success: `LACE_RESULT` line has `exitCode: 0`, `failedPhase: null`,
  `containerMayBeRunning: false`.
- On hostValidation failure: `failedPhase: "hostValidation"`,
  `containerMayBeRunning: false`.
- On devcontainerUp failure with no container: `failedPhase: "devcontainerUp"`,
  `containerMayBeRunning: false`.
- On devcontainerUp failure with running container: `failedPhase: "devcontainerUp"`,
  `containerMayBeRunning: true`.

**Integration test (manual):**

- Run `lace up --workspace-folder <path>` with a deliberate failure and verify
  the `LACE_RESULT` line appears on stderr with correct JSON.
- Run `wez-into --start <project>` with the updated `lace` and verify
  `wez-into` parses the structured line and skips retries for non-recoverable
  failures.

## Implementation Phases

### Phase 1: Bash-only improvements to `bin/wez-into`

**Scope:** Changes 1a through 1f, all in `bin/wez-into`.

**Files:**
- `bin/wez-into` -- modify `start_and_connect()` function (lines 132-248)

**Success criteria:**
- `lace up` output is visible to the user as it happens (1a).
- Error context is shown immediately before retries (1b).
- Retries abort within one iteration when no container is running (1c).
- Max retry attempts reduced from 10 to 5 (1d).
- Final error message includes actionable remediation guidance (1e).
- Retry counter starts at 1, not 2 (1f).
- All existing functionality (success path, already-running detection, interactive
  picker, dry-run) continues to work.

**Constraints:**
- No changes to any TypeScript files.
- No changes to `lace-discover`.
- `set -euo pipefail` is already set on line 16 and must not be removed.
- Do not introduce dependencies on `jq` or other tools not already used.

### Phase 2: Structured result line from `lace up`

**Scope:** Changes 2a through 2c.

**Files:**
- `packages/lace/src/commands/up.ts` -- add `isContainerRunning` helper and emit
  `LACE_RESULT` line (2a, 2b)
- `bin/wez-into` -- parse `LACE_RESULT` line with heuristic fallback (2c)

**Success criteria:**
- `lace up` emits a `LACE_RESULT:` line on stderr for every invocation.
- The line contains valid JSON with `exitCode`, `failedPhase`, and
  `containerMayBeRunning` fields.
- `wez-into` parses the structured line when present and falls back to the
  "Starting devcontainer" heuristic when absent.
- Non-recoverable failures (containerMayBeRunning: false) skip the retry loop
  entirely.
- All existing `lace up` tests pass without modification (the `LACE_RESULT` line
  is emitted to stderr, which tests do not typically assert on).

**Constraints:**
- Do not modify the `UpResult` interface shape (no breaking changes for callers).
- Do not modify the `RunSubprocess` type or `runSubprocess` implementation.
- The `isContainerRunning` function must use the default subprocess runner, not
  the injected mock (it is a post-`runUp` check, not part of the phase pipeline).
- Maintain backward compatibility: `wez-into` must work correctly with both old
  (no `LACE_RESULT`) and new `lace` versions.

## Open Questions

1. **Should `LACE_RESULT` be a well-known file instead of a stderr line?**
   Writing to `$XDG_RUNTIME_DIR/lace/last-up-result.json` would avoid the need
   for grep-based extraction from captured output, but introduces filesystem
   coupling and cleanup concerns. The stderr line is simpler and self-contained.
   Recommendation: use the stderr line unless a concrete need for the file
   approach emerges.

2. **Should the `docker ps` check in the retry loop use the
   `devcontainer.local_folder` label or the `lace.project_name` label?**
   `devcontainer.local_folder` is set by the devcontainer CLI itself and is
   always present. `lace.project_name` is set by lace and might not be present
   on containers created by other tools. Recommendation: use
   `devcontainer.local_folder` for maximum compatibility.
