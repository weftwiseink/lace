---
review_of: cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T22:45:00-05:00
task_list: lace/wez-into
type: review
state: live
status: done
tags: [fresh_agent, phase2, typescript, bash, error-handling, structured-output, backward-compatibility, json-parsing]
---

# Review: Phase 2 Implementation of wez-into Error Visibility

## Summary Assessment

Phase 2 adds a machine-readable `LACE_RESULT` line to `lace up` stderr and teaches
`wez-into` to parse it, replacing the fragile "Starting devcontainer" text heuristic
with structured data. The TypeScript implementation in `commands/up.ts` is clean and
correct: `isContainerRunning` has proper error handling, the `failedPhase` extraction
logic correctly finds the first failing phase, and the `LACE_RESULT` line is emitted
on every invocation as specified. The bash parsing in `wez-into` correctly handles the
structured path and falls back to the legacy heuristic. One blocking issue found: the
error context excerpt (lines 254-257) is unreachable on the non-container-running path
because line 235 exits before reaching it. One non-blocking issue: no unit tests were
added for the Phase 2 TypeScript changes. Verdict: **Revise** (one blocking fix
required, straightforward).

## Section-by-Section Findings

### 2a. Emit `LACE_RESULT` line from the command handler

**Status:** Implemented correctly

File: `packages/lace/src/commands/up.ts` lines 94-106.

```typescript
const failedPhase = result.exitCode !== 0
  ? Object.entries(result.phases).find(([, v]) => v && v.exitCode !== 0)?.[0] ?? "unknown"
  : null;
const containerMayBeRunning = result.exitCode !== 0
  && isContainerRunning(workspaceFolder);
const laceResult = {
  exitCode: result.exitCode,
  failedPhase,
  containerMayBeRunning,
};
console.error(`LACE_RESULT: ${JSON.stringify(laceResult)}`);
```

This matches the proposal exactly. Key observations:

1. **`failedPhase` extraction is correct.** `Object.entries(result.phases)` iterates in
   insertion order (guaranteed by JavaScript for string keys). Since `runUp` assigns
   phases in execution order and returns early on failure, the first entry with
   `exitCode !== 0` is always the failing phase. The `?.[0] ?? "unknown"` fallback
   handles the edge case where `runUp` returns `{ phases: {} }` (e.g., on
   `DevcontainerConfigError` before any phase runs).

2. **`containerMayBeRunning` short-circuits on success.** When `result.exitCode === 0`,
   the `&&` evaluates to `false` without calling `isContainerRunning`. This avoids an
   unnecessary `docker ps` call on the happy path. Correct per the proposal.

3. **`workspaceFolder` is already resolved.** Line 54 resolves it as
   `args["workspace-folder"] || process.cwd()`, so the value passed to
   `isContainerRunning` is correct. The proposal's `options.workspaceFolder ?? process.cwd()`
   is functionally equivalent but the implementation uses the pre-resolved variable,
   which is cleaner.

4. **`LACE_RESULT` goes to stderr via `console.error`.** This matches the proposal's
   design decision and avoids interfering with stdout-based parsing. Since `wez-into`
   captures both streams via `2>&1`, the line is available in `up_output`.

5. **Emitted on every invocation.** The `console.error` call is unconditional (outside
   any `if` block), so both success and failure paths emit the line. On success:
   `{"exitCode":0,"failedPhase":null,"containerMayBeRunning":false}`.

**Finding:** Correct and matches proposal.

### 2b. `isContainerRunning` helper

**Status:** Implemented correctly

File: `packages/lace/src/commands/up.ts` lines 11-22.

```typescript
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

Key observations:

1. **Uses `defaultRunSubprocess` (not injected mock).** This is correct per the
   proposal: `isContainerRunning` is a post-`runUp` diagnostic, not part of the phase
   pipeline. The import at line 4 (`import { runSubprocess as defaultRunSubprocess }`)
   makes the distinction clear.

2. **Error handling is thorough.** The `try/catch` returns `false` for any exception.
   While `defaultRunSubprocess` itself has an internal `try/catch` that should handle
   `execFileSync` errors (including `ENOENT` when docker is not on PATH), the outer
   `try/catch` is a defensive safety net. This is appropriate for a function whose
   failure mode is "assume no container running" -- the safe default.

3. **Return condition is correct.** `result.exitCode === 0 && result.stdout.trim() !== ""`
   ensures both that `docker ps` succeeded AND that it actually found a matching
   container. An empty stdout with exit 0 means the filter matched nothing.

4. **Label filter matches `wez-into`'s retry loop filter.** Both use
   `devcontainer.local_folder=$workspace_path`, consistent with the proposal's design
   decision to use the devcontainer CLI's own label rather than lace's custom label.

5. **Placed at module scope in `commands/up.ts`.** This matches the proposal's design
   decision to keep it close to its only call site. It is not exported, so it does not
   pollute the library's public API.

**Finding:** Correct and well-structured. No issues.

### 2c. Parse `LACE_RESULT` in `wez-into`

**Status:** Implemented with one bug

File: `bin/wez-into` lines 201-257.

**Structured path (lines 208-239):**

The parsing logic is correct:

1. **`grep '^LACE_RESULT: '` with `tail -1`** handles the multi-line defense (last
   occurrence wins). The `|| true` suppresses `set -e` when grep finds nothing.

2. **`containerMayBeRunning` extraction** via glob match
   `[[ "$result_json" == *'"containerMayBeRunning":true'* ]]` is correct for
   `JSON.stringify` output (no spaces between key, colon, and value). The default
   is `"false"`, and only an explicit `true` (without quotes) triggers the `"true"` path.

3. **`failedPhase` extraction** via `${result_json#*\"failedPhase\":\"}` correctly
   strips everything up to and including the opening quote of the value. The
   `${phase_fragment%%\"*}` then extracts the value up to the closing quote. If the
   pattern does not match (e.g., `"failedPhase":null`), the fallback to `"unknown"` is
   correct. As noted in the proposal, `failedPhase` is only used on the failure path
   where it is always a string, never `null`.

4. **Non-running container path (lines 226-236):** When `containerMayBeRunning` is false,
   the code prints a clear error with the phase name, shows the last 10 lines of output
   (filtering out the `LACE_RESULT` line), and exits immediately. This is the key
   improvement: no retry loop for non-recoverable failures.

5. **Running container path (lines 238-239):** When the container may be running, the
   code prints a warning with the phase name and proceeds to discovery retries. This is
   correct for the legitimate retry case (e.g., lifecycle hook failure).

**Fallback path (lines 240-253):**

The legacy "Starting devcontainer" heuristic is preserved exactly, with minor improvements
to the error output (10-line context instead of 15, `grep -v '^LACE_RESULT: '` filter,
`lace up` debug command suggestion). This ensures backward compatibility with older
`lace` versions that do not emit `LACE_RESULT`.

**Bug (blocking): Error context excerpt at lines 254-257 is partially unreachable.**

```bash
    fi
    info ""
    info "lace up error context (last 5 lines):"
    echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -5 >&2
    info ""
  else
    info "container started successfully"
  fi
```

Lines 254-257 execute after the `if/else` block that handles LACE_RESULT vs. fallback.
They are intended to be the 1b "error excerpt before retries" from Phase 1. However,
there are two code paths that reach this point:

- **Structured path, container running (line 238-239):** Falls through to 254-257. The
  user sees the 5-line excerpt. **Correct.**
- **Structured path, container NOT running (line 226-236):** `exit 1` at line 235 means
  lines 254-257 are never reached. **This is correct behavior** (the user already saw
  the 10-line excerpt at line 231), but it means the 5-line excerpt is now only shown
  for the "container may be running" case on the structured path.
- **Fallback path, "Starting devcontainer" found (line 252):** Falls through to 254-257.
  The user sees the 5-line excerpt. **Correct.**
- **Fallback path, "Starting devcontainer" NOT found (line 250):** `exit 1` at line 250
  means lines 254-257 are never reached. Again, **correct behavior** since the 10-line
  excerpt was already shown.

Wait -- on re-examination, this is actually correct. The 5-line excerpt at lines 254-257
runs on both paths that proceed to the retry loop (structured with running container,
and fallback with "Starting devcontainer" found). The paths that exit early already show
their own 10-line excerpt. So the code is functionally correct.

However, there is still a structural issue: the 5-line excerpt at lines 254-257
duplicates information from the structured path's warning at line 238. On the structured
path (container running), the user sees:

1. Line 238: "warning: lace up failed in phase 'X' (exit N) but container may be running"
2. Line 239: "checking if container is discoverable..."
3. Lines 254-257: "lace up error context (last 5 lines):" + excerpt

This is the intended Phase 1b behavior applied to the Phase 2 path. **Downgrading from
blocking to non-blocking.** The duplication is mild (one line of context + 5 lines of
excerpt) and actually serves the "glanceable summary" use case described in the proposal.

**Revised finding:** The code is functionally correct. The 5-line excerpt only fires on
paths that proceed to the retry loop, which is the correct behavior.

After further analysis, I am re-examining whether there is in fact a legitimate bug.
Let me re-read the code flow more carefully.

Looking at lines 201-260 in `wez-into`:

```
201: elif [[ $up_exit -ne 0 ]]; then
...
208:   if [[ -n "$lace_result_line" ]]; then
...
226:     if [[ "$container_may_be_running" != "true" ]]; then
...
235:       exit 1           <-- exits here, never reaches 254
236:     fi
237:
238:     info "warning: ..."  <-- container IS running
239:     info "checking ..."
240:   else
241:     # Fallback heuristic
242:     if ! grep -q "Starting devcontainer" ...; then
...
250:       exit 1           <-- exits here, never reaches 254
251:     fi
252:     info "warning: ..."  <-- "Starting devcontainer" WAS found
253:   fi
254:   info ""
255:   info "lace up error context (last 5 lines):"
256:   echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -5 >&2
257:   info ""
258: else
259:   info "container started successfully"
260: fi
```

Lines 254-257 are reached in exactly two cases:
1. Structured LACE_RESULT present, container IS running -> proceeds to retry loop
2. No LACE_RESULT, "Starting devcontainer" found -> proceeds to retry loop

Both of these are the "recoverable failure" paths. Showing the 5-line excerpt before
retries is exactly the Phase 1b behavior. This is correct.

**Actual finding: No bug.** The control flow is correct. Downgrading to informational.

### Does `isContainerRunning` have proper error handling?

**Status:** Yes

As analyzed in 2b above, the function has a double layer of error handling:
1. `defaultRunSubprocess` internally catches `execFileSync` errors and returns a
   `SubprocessResult` with `exitCode: 1`.
2. The outer `try/catch` in `isContainerRunning` catches anything else and returns `false`.

Both layers default to "container not running," which is the safe assumption (it causes
`wez-into` to skip retries rather than waste time on a dead container).

### Is the LACE_RESULT JSON emission correct?

**Status:** Yes

The `JSON.stringify` call produces predictable, flat JSON with no nesting. The field
order is deterministic (JavaScript objects maintain insertion order for string keys).
Example outputs:

- Success: `LACE_RESULT: {"exitCode":0,"failedPhase":null,"containerMayBeRunning":false}`
- Host validation failure: `LACE_RESULT: {"exitCode":1,"failedPhase":"hostValidation","containerMayBeRunning":false}`
- Lifecycle hook failure with running container: `LACE_RESULT: {"exitCode":1,"failedPhase":"devcontainerUp","containerMayBeRunning":true}`
- Config parse error (empty phases): `LACE_RESULT: {"exitCode":1,"failedPhase":"unknown","containerMayBeRunning":false}`

All of these are correctly handled by the bash parser.

### Does the `failedPhase` find the right phase?

**Status:** Yes

`Object.entries(result.phases).find(([, v]) => v && v.exitCode !== 0)` finds the first
phase with a non-zero exit code. Since `runUp` returns early on the first failure, there
is at most one phase with `exitCode !== 0`. The `v &&` guard handles the case where a
phase value is `undefined` (not all phases are always present).

Edge case: when `runUp` returns `{ phases: {} }` (e.g., on `DevcontainerConfigError`
at lines 126-129 or 470-474 of `lib/up.ts`), `Object.entries({})` returns `[]`, so
`find` returns `undefined`, and `?.[0] ?? "unknown"` produces `"unknown"`. This is
correct -- the user sees "lace up failed in phase 'unknown'" which is accurate (the
failure occurred before any named phase).

### Is the bash LACE_RESULT parsing correct?

**Status:** Yes, with one edge case documented

The parsing handles all expected JSON shapes correctly. The key edge cases:

1. **`failedPhase` is `null` (success case):** The `${result_json#*\"failedPhase\":\"}`
   pattern does not match `"failedPhase":null` (no opening quote after colon), so
   `phase_fragment` equals `result_json`, and `failed_phase` is set to `"unknown"`.
   This code path is unreachable on success (gated by `up_exit -ne 0` at line 201),
   so the "unknown" value is never displayed. Correct.

2. **`containerMayBeRunning` with spaces:** `JSON.stringify` does not insert spaces,
   so `"containerMayBeRunning":true` (no space) is the only format produced. The glob
   match `*'"containerMayBeRunning":true'*` handles this correctly. If a future change
   uses `JSON.stringify(obj, null, 2)` (pretty-print), the glob would fail to match
   and `container_may_be_running` would default to `"false"`. This is the safe default
   (skip retries), so even this hypothetical breakage fails safe.

3. **Multiple `LACE_RESULT` lines:** The `tail -1` ensures the last line is used, which
   is the one emitted by the command handler after all phases complete. Correct.

4. **`LACE_RESULT` absent (older lace):** The `grep` returns nothing, `|| true` prevents
   `set -e` abort, `lace_result_line` is empty, and the `else` branch activates the
   legacy heuristic. Correct.

### Does the fallback to the legacy heuristic work?

**Status:** Yes

Lines 240-253 preserve the exact legacy behavior: `grep -q "Starting devcontainer"` on
the captured output, with early exit if not found. The only changes from the original
are improved error output (10-line excerpt, `lace up` debug command suggestion,
`LACE_RESULT` filtering). These are Phase 1 improvements that were already reviewed and
accepted.

### Backward compatibility

**Status:** Maintained

1. **Older `lace` (no `LACE_RESULT`):** The fallback heuristic handles this correctly.
2. **Newer `lace` with older `wez-into` (pre-Phase 2):** The `LACE_RESULT` line goes to
   stderr, which older `wez-into` captures via `2>&1` but never parses. It appears in
   `up_output` as a harmless extra line. Since the old code uses `grep -q "Starting
   devcontainer"` (not exact match), the `LACE_RESULT` line does not interfere.
3. **UpResult interface:** Unchanged. No new fields added to the type.
4. **RunSubprocess type:** Unchanged. `isContainerRunning` uses the default implementation
   directly, not the injected mock.
5. **Existing tests:** The `LACE_RESULT` line is emitted to stderr. Existing integration
   tests for `runUp` (in `up.integration.test.ts`) test the library function directly
   and do not exercise the command handler, so they are unaffected.

### Test coverage

**Status:** Missing -- non-blocking but notable

The proposal's test plan specifies unit tests for:
- `isContainerRunning` (returns true/false/false-on-error)
- `LACE_RESULT` emission (success, hostValidation failure, devcontainerUp failure
  with/without container)

No new test files were added for the Phase 2 TypeScript changes. The existing
`up.integration.test.ts` tests `runUp` directly (the library function) and does not
exercise the command handler in `commands/up.ts`. This means:
- `isContainerRunning` is untested
- The `LACE_RESULT` emission logic is untested
- The `failedPhase` extraction from `result.phases` is untested

The bash-side parsing is inherently manual-test territory (no `bats` harness exists),
which is acceptable for the current project maturity.

This is non-blocking because the TypeScript code is straightforward and the logic is
simple enough to verify by inspection, but tests would provide regression protection
against future changes to the `UpResult` interface or `phases` object shape.

## Verdict

**Accept**

After thorough analysis, the implementation matches the proposal with high fidelity.
The initial concern about unreachable code at lines 254-257 was resolved on closer
inspection -- the control flow is correct, with the 5-line excerpt only firing on paths
that proceed to the retry loop. The `isContainerRunning` helper is well-structured with
proper error handling. The bash JSON parsing uses appropriate string manipulation
techniques that are robust for the predictable JSON shape produced by `JSON.stringify`.
Backward compatibility is maintained in both directions. One non-blocking suggestion
regarding test coverage.

## Action Items

1. [non-blocking] Add unit tests for `isContainerRunning` and `LACE_RESULT` emission in
   a new `packages/lace/src/commands/__tests__/up-lace-result.test.ts` file. The
   `isContainerRunning` function could be exported for testing (or tested indirectly via
   the command handler). Test cases per the proposal: success path, hostValidation
   failure, devcontainerUp failure with/without container, docker-not-on-PATH. This
   would provide regression protection against future `UpResult` interface changes.

2. [non-blocking] Consider adding a brief inline comment at line 254 explaining why the
   5-line excerpt is only reached on the "proceed to retry" paths. The control flow has
   two `exit 1` statements (lines 235, 250) that prevent the excerpt from firing on
   non-recoverable paths, which is correct but not immediately obvious to a future
   reader.
