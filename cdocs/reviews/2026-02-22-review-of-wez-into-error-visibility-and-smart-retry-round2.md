---
review_of: cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-22T19:15:00-05:00
task_list: lace/wez-into
type: review
state: live
status: done
tags: [rereview_agent, bash, pipefail, error-handling, correctness, follow_up]
---

# Review (Round 2): Error Visibility and Smart Retry for wez-into and lace up

## Summary Assessment

This is a follow-up review of the revised proposal after round 1 identified two blocking
issues (incorrect pipefail/PIPESTATUS handling in 1a, and isContainerRunning
export/import mismatch in 2a/2b) plus five non-blocking suggestions. The revision
addresses all seven items. The pipefail fix is correct, the isContainerRunning placement
is sound, and the non-blocking items (mktemp+trap, unconditional containerMayBeRunning,
grep -oP removal, quoting, LACE_RESULT filtering) are all resolved satisfactorily. The
revised proposal is internally consistent and ready for implementation.

Verdict: **Accept.**

## Resolution of Blocking Issues

### Blocking Issue 1: pipefail/PIPESTATUS factual error (1a)

**Status: Resolved.**

The round 1 review found that the proposal incorrectly claimed `set -o pipefail` was
not set in `wez-into` and proposed a `PIPESTATUS[0]` capture pattern that would not work
under the script's actual `set -euo pipefail` (line 16).

The revision removes the incorrect claim entirely and replaces the capture pattern with
the simpler `|| up_exit=$?`:

```bash
local up_exit=0

"$lace_cli" up --workspace-folder "$workspace_path" 2>&1 \
  | tee "$up_logfile" >&2 \
  || up_exit=$?
```

The accompanying NOTE (proposal lines 166-172) correctly explains why this works:
`pipefail` propagates `lace`'s non-zero exit code as the pipeline status (since `tee`
almost always succeeds), the `||` suppresses `set -e`, and `$?` captures the pipeline
exit status. No `PIPESTATUS` gymnastics needed. This matches the exact pattern the
round 1 review recommended.

I verified against `bin/wez-into` line 16: `set -euo pipefail` is indeed set. The
revised code is correct under these settings.

### Blocking Issue 2: isContainerRunning export/import mismatch (2a/2b)

**Status: Resolved.**

The round 1 review found that the original proposal placed `isContainerRunning` in
`lib/up.ts` as a non-exported function but called it from `commands/up.ts`, making
it unreachable. The review suggested either exporting it or moving it to the command
handler.

The revision takes option 2 (moving to `commands/up.ts`), which the round 1 review
identified as the cleaner approach. The function is now defined at module scope in
`commands/up.ts` (proposal section 2b, lines 488-511) with a clear rationale in both
the code comment and the design decision (section "Decision: isContainerRunning in
commands/up.ts, not lib/up.ts", lines 681-693).

The import statement `import { runSubprocess as defaultRunSubprocess } from "@/lib/subprocess"`
is explicitly shown in section 2a (line 435) and referenced in section 2b (line 490).
I verified that `@/lib/subprocess` exports `runSubprocess` (see
`packages/lace/src/lib/subprocess.ts` line 20), so the import resolves correctly.

One note: `commands/up.ts` currently only imports from `@/lib/up` (line 3). The
revision adds a new import from `@/lib/subprocess`. This is a straightforward addition
with no conflict.

## Resolution of Non-Blocking Suggestions

### Non-blocking 3: mktemp+trap in main code (1a)

**Status: Resolved.** The revised 1a code (lines 139-154) uses `mktemp /tmp/lace-up-XXXXXX.log`
with an error handler, sets `trap "rm -f '$up_logfile'" EXIT`, explicitly removes the
file after reading, and clears the trap. This is thorough: it handles Ctrl+C, `set -e`
abort, and the normal path.

One minor observation: the trap uses single quotes around `$up_logfile` inside double
quotes (`trap "rm -f '$up_logfile'" EXIT`), which means `$up_logfile` is expanded at
trap-definition time (via the double quotes) and the resulting path is single-quoted in
the trap command. This is correct and handles paths with spaces. If the path contained a
single quote, the trap would break, but `mktemp` does not produce paths with single
quotes.

### Non-blocking 4: Unconditional containerMayBeRunning check (2a)

**Status: Resolved.** The revised code (proposal line 451-452) checks
`isContainerRunning` on all failure paths:

```typescript
const containerMayBeRunning = result.exitCode !== 0
    && isContainerRunning(options.workspaceFolder ?? process.cwd());
```

This matches the round 1 review's recommendation exactly. The accompanying NOTE
(lines 473-478) explains the rationale: `docker ps` is ground truth, the check is
only on the failure path, and it is future-proof against new phases.

### Non-blocking 5: grep -oP removal (2c)

**Status: Resolved.** The revised 2c code (lines 551-563) uses bash string manipulation
for both `containerMayBeRunning` (glob matching against `*'"containerMayBeRunning":true'*`)
and `failedPhase` (parameter expansion `${result_json#*\"failedPhase\":\"}` followed by
`${phase_fragment%%\"*}`).

The design decision section (lines 621-633) explains the rationale and explicitly
acknowledges that `grep -oP` is a GNU extension. No external tool dependencies beyond
bash builtins.

### Non-blocking 6: $workspace_path quoting in remediation commands (1e)

**Status: Resolved.** The revised 1e code quotes `$workspace_path` in all suggested
commands:

- Line 351: `err "  lace up --workspace-folder \"$workspace_path\""`
- Line 357: `docker ps -a --filter label=devcontainer.local_folder=\"$workspace_path\""`
- Line 363: `docker ps --filter label=devcontainer.local_folder=\"$workspace_path\""`

### Non-blocking 7: LACE_RESULT filtering in 1b excerpt (1b)

**Status: Resolved.** The revised 1b code (line 193) filters the LACE_RESULT line:

```bash
echo "$up_output" | grep -v '^LACE_RESULT: ' | tail -5 >&2
```

The NOTE (lines 203-204) explains that before Phase 2 lands, the grep harmlessly
matches nothing. The same filtering is applied in 1e (line 348) and 2c (line 570).
Consistent throughout.

## Check for New Issues Introduced by the Revision

### Self-consistency of code examples

I checked all code examples in the revised proposal against each other and against the
actual codebase:

- The `start_and_connect` function in `bin/wez-into` begins at line 132. The proposal's
  "Current" excerpts for 1a (lines 164-166), 1b (line 200), 1c (lines 210-227), 1d
  (line 208), 1e (lines 229-239), and 1f (lines 222-226) all match the actual file.

- The `commands/up.ts` "Current" excerpt (lines 69-75 in section 2a) matches the actual
  file (`packages/lace/src/commands/up.ts` lines 69-75).

- The `isContainerRunning` function in section 2b calls `defaultRunSubprocess("docker", [...])`
  and checks `result.exitCode === 0 && result.stdout.trim() !== ""`. I verified that
  `runSubprocess` in `packages/lace/src/lib/subprocess.ts` returns a `SubprocessResult`
  with `exitCode`, `stdout`, and `stderr` fields. The interface matches.

- The `UpResult.phases` structure referenced in section 2a (`Object.entries(result.phases).find(...)`)
  matches the actual interface at `packages/lace/src/lib/up.ts` lines 68-82. Each phase
  value has an `exitCode` field, so `v && v.exitCode !== 0` is correct.

### Potential issue: devcontainerUp phase has a different shape

The `UpResult.phases.devcontainerUp` value has shape `{ exitCode: number; stdout: string; stderr: string }`
(line 80 of `lib/up.ts`), while all other phases have `{ exitCode: number; message: string }`.
The proposal's `failedPhase` extraction code (`Object.entries(result.phases).find(([, v]) => v && v.exitCode !== 0)?.[0]`)
only checks `v.exitCode`, so this shape difference does not matter. The code is correct.

### Potential issue: trap interaction with existing traps

The proposal adds `trap "rm -f '$up_logfile'" EXIT` inside `start_and_connect`. If the
caller or any earlier code in the script also sets an EXIT trap, this would overwrite it.
I checked `bin/wez-into` -- there is no existing EXIT trap anywhere in the script. No
conflict. This is not a new issue, just a note for implementers.

### Potential issue: `up_output` from `cat` after pipeline failure

In the revised 1a, `up_output=$(cat "$up_logfile" 2>/dev/null || true)` reads the temp
file after the tee pipeline. If `lace up` produces very large output and is killed
mid-write by a signal, the file could be incomplete. The `2>/dev/null || true` handles
the case where the file does not exist. For the truncation case, `up_output` will
contain whatever was written, which is correct behavior (the heuristic check and tail
excerpts work on partial output). No issue.

## Verdict

**Accept.** Both blocking issues from round 1 are correctly resolved. All five
non-blocking suggestions are addressed. The revised proposal is internally consistent,
the code examples match the actual codebase, and no new issues were introduced by the
revisions. The proposal is ready for implementation.

## Action Items

No blocking items remain. The following are optional observations for implementers:

1. [non-blocking] When implementing the `isContainerRunning` addition to `commands/up.ts`,
   the new import `import { runSubprocess as defaultRunSubprocess } from "@/lib/subprocess"`
   should be added alongside the existing import from `@/lib/up` on line 3. Group it
   logically with other library imports.

2. [non-blocking] The EXIT trap in 1a (`trap "rm -f '$up_logfile'" EXIT`) is set inside
   the `start_and_connect` function. If future changes add an EXIT trap elsewhere in
   `wez-into`, the traps will conflict (bash replaces, not appends). This is a standard
   bash limitation and not specific to this proposal, but worth noting in a comment at
   the trap site.

3. [non-blocking] The `devcontainerUp` phase has a different shape from other phases
   (`stdout`/`stderr` instead of `message`). If the LACE_RESULT output is ever extended
   to include the failed phase's message, the extraction code would need to account for
   this. Not relevant to the current proposal, but worth noting for future extensions.
