---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T20:00:00-05:00
task_list: lace/wez-into
type: devlog
state: live
status: done
tags: [ux, error-handling, wez-into, lace-up, retry, messaging]
related_to:
  - cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
  - cdocs/reports/2026-02-22-wez-into-error-propagation-and-messaging.md
  - cdocs/reports/2026-02-22-error-triaging-and-fallback-handling.md
---

# Error Visibility and Smart Retry Implementation: Devlog

## Objective

Implement the accepted proposal for improving error visibility and retry behavior
in `wez-into --start`. The user should never be left watching a retry counter with
no diagnostic information. Two phases: bash-only improvements (Phase 1) then
structured LACE_RESULT output from lace up (Phase 2).

## Plan

### Phase 1: Bash-only changes to `bin/wez-into`
1. **1a** -- Replace `$( ... 2>&1)` capture with `tee`-based streaming
2. **1b** -- Show error excerpt immediately before retries
3. **1c** -- Add `docker ps` early-exit check in retry loop
4. **1d** -- Reduce max_attempts from 10 to 5
5. **1e** -- Replace final error message with actionable guidance
6. **1f** -- Fix attempt counter off-by-one
7. Commit and verify Phase 1

### Phase 2: Structured LACE_RESULT from `lace up`
1. **2b** -- Add `isContainerRunning` helper in `commands/up.ts`
2. **2a** -- Emit LACE_RESULT line from command handler
3. **2c** -- Parse LACE_RESULT in `wez-into` with heuristic fallback
4. Run existing tests, commit, and verify Phase 2

## Testing Approach

- Phase 1: Manual scenario-based testing (no existing test harness for wez-into)
  - Verify `lace up` output streams in real time
  - Verify retry loop aborts immediately when no container running
  - Verify final error messages include remediation guidance
- Phase 2: Run existing `lace up` test suite to ensure no regressions
  - Manual verification of LACE_RESULT line emission
  - Manual verification of wez-into parsing

## Implementation Notes

### Phase 1

All six changes (1a-1f) implemented in a single edit pass to `bin/wez-into`'s
`start_and_connect()` function. Key decisions:

- **tee pattern**: `| tee "$up_logfile" >&2` sends streamed output to stderr
  (consistent with wez-into's existing `info`/`err` convention). The logfile
  captures for post-hoc heuristic checks. `mktemp` + `trap EXIT` ensures cleanup.

- **pipefail**: The script already has `set -euo pipefail` on line 16. With
  pipefail, `|| up_exit=$?` correctly captures lace's exit code from the
  pipeline (no PIPESTATUS gymnastics needed, as the review confirmed).

- **docker ps label**: Used `devcontainer.local_folder` (set by devcontainer CLI)
  rather than `lace.project_name` (set by lace) for maximum compatibility.

- **Attempt counter**: Changed `$((attempts + 1))` to `$((attempts))` to start
  at 1/5 instead of 2/10.

### Phase 2

- **isContainerRunning**: Placed in `commands/up.ts` (not `lib/up.ts`) per
  proposal design decision -- it's a post-runUp diagnostic, not part of the
  phase pipeline. Uses `defaultRunSubprocess` directly, not the injected mock.

- **LACE_RESULT emission**: Uses `console.error` (stderr) to avoid interfering
  with stdout-based result messages. JSON is flat and predictable for bash
  parsing. `failedPhase` is the first phase with non-zero exitCode from
  `result.phases`, or "unknown" if no matching phase found.

- **Bash JSON parsing**: Uses parameter expansion (`${var#pattern}`,
  `${var%%pattern}`) and glob matching instead of `jq` or `grep -oP`.
  Tested with four scenarios: false, true, no-result, null-phase.

- **Backward compatibility**: Falls back to legacy "Starting devcontainer"
  heuristic when no LACE_RESULT line is present.

## Changes Made

| File | Description |
|------|-------------|
| `bin/wez-into` | Phase 1: tee streaming, error excerpt, docker ps abort, max_attempts=5, remediation guidance, counter fix. Phase 2: LACE_RESULT parsing with legacy fallback. |
| `packages/lace/src/commands/up.ts` | Phase 2: `isContainerRunning` helper + LACE_RESULT JSON emission on stderr. |

## Verification

### Bash syntax check
```
bash -n bin/wez-into → Syntax OK
```

### TypeScript type check
```
npx tsc --noEmit → clean (no errors)
```

### Test suite (751 tests)
```
Test Files  29 passed (29)
     Tests  751 passed (751)
  Duration  22.98s
```

### Manual tests

**Dry-run with running container:**
```
$ wez-into --dry-run lace
wezterm connect lace:22425 --workspace lace
```

**--start with already-running container:**
```
$ wez-into --start --dry-run lace
wez-into: lace is already running
wezterm connect lace:22425 --workspace lace
```

**--start with stopped container (streaming verification):**
```
$ wez-into --start dotfiles
wez-into: starting dotfiles via lace up --workspace-folder /home/mjr/code/personal/dotfiles ...
Fetching feature metadata...              ← real-time streaming (1a)
Validated metadata for 3 feature(s)
[...]
Starting devcontainer...
lace up completed successfully
LACE_RESULT: {"exitCode":0,"failedPhase":null,"containerMayBeRunning":false}
wez-into: container started successfully
wez-into: waiting for container to be discoverable (attempt 1/5)...  ← counter starts at 1 (1f)
```

**docker ps early-exit (no container running):**
```
$ # Simulated retry loop with nonexistent workspace
test: no container running for /nonexistent/workspace/path -- aborting discovery retries
Exited retry loop after 0 attempts (expected: 0)
```

**LACE_RESULT emission on failure:**
```
$ lace up --workspace-folder /tmp/nonexistent 2>&1 | grep LACE_RESULT
LACE_RESULT: {"exitCode":1,"failedPhase":"unknown","containerMayBeRunning":false}
```

**LACE_RESULT bash parsing (4 scenarios):**
```
Test 1 (containerMayBeRunning=false): PASS - failedPhase=devcontainerUp
Test 2 (containerMayBeRunning=true): PASS
Test 3 (no LACE_RESULT, legacy fallback): PASS
Test 4 (failedPhase=null): PASS - falls back to "unknown"
```

### Reviews
- Phase 1: Accepted (`cdocs/reviews/2026-02-22-review-of-wez-into-error-visibility-phase1.md`)
- Phase 2: Accepted (`cdocs/reviews/2026-02-22-review-of-wez-into-error-visibility-phase2.md`)

### Deferred work
- Unit tests for `isContainerRunning` and LACE_RESULT emission (non-blocking,
  noted in Phase 2 review)
