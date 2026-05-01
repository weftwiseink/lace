---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-28T10:00:00-07:00
task_list: lace/validation-pipeline
type: proposal
state: live
status: implementation_ready
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-28T13:00:00-07:00
  round: 3
tags: [validation, error-reporting, mounts, debugging, lace-up]
---

# Validation, Log Persistence, and Debuggability for `lace up`

> BLUF: Four focused improvements to `lace up` error handling: (1) complete mount label attribution in validation errors, (2) persistent log files so errors survive terminal scrollback loss, (3) a templated agent-friendly debugging footer on all error output, and (4) a `lace validate` dry-run subcommand.
> Phases 1-2 of the original bug fix (hard error for missing mounts, stale `sourceMustBe` re-resolution) are already implemented.

> NOTE(opus/lace-failure-debug): Fixes already landed in this session:
> - `up.ts`: post-resolution mount scan returns structured error result with `exitCode: 1` and `phases.mountValidation` (was warning-only).
> - `mount-resolver.ts`: `resolveSource()` checks `existsSync()` for persisted `sourceMustBe` assignments, re-resolves when path is gone.
> - Tests: 1018 passing, including 2 new stale-mount tests.

## Summary

A user ran `lace up` and received a raw podman error (`statfs ... no such file or directory`) because a persisted mount assignment pointed to a deleted directory.
The critical path is fixed: missing bind-mount sources are now a hard error, and stale `sourceMustBe` assignments are re-resolved.

Four improvements remain:
1. The post-resolution mount error lacks label attribution and feature provenance.
2. All output is ephemeral (stdout/stderr only): no persistent logs.
3. Error output doesn't guide agents or users toward next debugging steps.
4. No way to validate config without starting a container.

## Objective

- Mount validation errors name the label, originating feature, and exact remediation steps.
- Every `lace up` run writes a log file to `.lace/logs/`; error output references the log path.
- All error output ends with a templated debugging message that an agent can act on.
- `lace validate` exercises the full config pipeline without starting a container.

## Phase 1: Mount Validation with Full Attribution

Enhance the post-resolution mount scan in `up.ts` to correlate missing sources back to their mount labels and feature declarations.

At the scan point, `templateResult.mountAssignments` has the label-to-path mapping and `mountDeclarations` has the feature provenance.
Cross-referencing produces attribution.

Error output changes from:

```
Bind mount source(s) do not exist on host:
  • /home/user/.local/share/sprack/lace
    target: /mnt/sprack
```

To:

```
Bind mount source(s) do not exist on host:

  sprack/data: /home/user/.local/share/sprack/lace
    target: /mnt/sprack
    declared by: sprack feature (sourceMustBe: directory)
    fix: mkdir -p /home/user/.local/share/sprack/lace
         or override in ~/.config/lace/settings.json:
           { "mounts": { "sprack/data": { "source": "/path/to/dir" } } }
```

The `(sourceMustBe: directory)` parenthetical is only shown when the declaration has `sourceMustBe` set.
For auto-created mounts (no `sourceMustBe`), show `(auto-created directory)` instead.

For mounts without a matching label (static mounts in devcontainer.json), the error falls back to the current format noting it's a static entry.

**Files:** `packages/lace/src/lib/up.ts`

**Changes:**
- Extend the `missingMounts` array to include `label`, `declaration` fields.
- Cross-reference `templateResult.mountAssignments` and `mountDeclarations`.
- Rewrite the error message formatter with label, feature name, `sourceMustBe` type, `mkdir` hint, and settings override instruction.

**Tests:** Update existing mount validation test in `up.integration.test.ts`.

## Phase 2: Stale Assignment Detection in `load()`

Extend `MountPathResolver.load()` to check `existsSync()` on non-override assignments.
When a persisted path no longer exists, discard the entry and log a warning.
This covers the non-`sourceMustBe` case (the `sourceMustBe` case is already handled by the session fix in `resolveSource()`).

> NOTE(opus/lace-failure-debug): Discard-and-re-derive is correct here because `resolveSource()` auto-creates default directories.
> A deleted mount directory is transparently recreated on next `lace up`, which matches user expectations.

**Files:** `packages/lace/src/lib/mount-resolver.ts`

**Changes:**
- After the existing `isStaleDefaultPath()` check in `load()`, add `existsSync()` check for non-override assignments.
- Emit `console.warn()` for discarded entries.

**Tests:** Add to `mount-resolver.test.ts` in the staleness detection describe block.

## Phase 3: Debug Log Persistence

Write a log file to `.lace/logs/` on each `lace up` invocation.
On error, the log path is referenced in the error output so agents and users can find the full context.

**Log file format:** `.lace/logs/YYYY-MM-DDTHH-MM-SS-<6hex>.log` (plaintext, one per run).
The 6-hex suffix is generated from `crypto.randomBytes(3).toString('hex')` to avoid collisions from concurrent runs.

**Contents:**
- Invocation timestamp, working directory, and CLI arguments
- Each pipeline phase: name, status (pass/fail/skip), duration, warnings, errors
- Subprocess stderr from the `devcontainerUp` phase (the most common source of opaque errors)
- The final `LACE_RESULT` payload
- Resolved config summary: port allocations, mount assignments

**Subprocess output capture:**
The `devcontainerUp` phase calls `devcontainer up` via `subprocess()` (`execSync`), which returns `{ exitCode, stdout, stderr }` fully buffered in memory.
The log captures **stderr only** from this phase: stderr contains the build steps and error messages; stdout is typically empty or minimal for `devcontainer up`.
Stdout from other phases (console.log output) is not captured separately: it's already visible in the terminal.
**Truncation:** if stderr exceeds 100KB, the log includes the first 20KB and last 80KB with a `[... truncated N bytes ...]` marker.
This covers the common case where the error is at the end of a long build log.

**Retention:** hybrid policy: keep the 10 most recent AND anything less than 7 days old.
Delete anything older than 7 days beyond the most recent 10.

**Design decisions:**
- Plaintext over structured JSON: the log is for human debugging. `LACE_RESULT` remains the machine-readable interface.
- `.lace/logs/` over `~/.config/lace/logs/`: logs are project-scoped. Already gitignored.
- Log writing is wrapped in try/catch: never affects `runUp()` return value or exit code.
- Stderr-only capture: stdout from `devcontainer up` is build progress noise. Errors and the actionable information are on stderr.

**Files:**
- New: `packages/lace/src/lib/run-log.ts`
- Modified: `packages/lace/src/lib/up.ts`

**Tests:** New `run-log.test.ts`: verify file creation, content structure, and retention policy.

## Phase 4: Agent-Friendly Error Footer

All `lace up` error output ends with a templated debugging message.
The footer provides structured context for an agent to investigate the failure without needing to reconstruct the state.

**Template:**

```
─── lace debugging context ───
  log: /home/mjr/code/apps/whelm/.lace/logs/2026-03-28T10-15-30-a3f2b1.log
  config: /home/mjr/code/apps/whelm/.lace/devcontainer.json
  mounts: /home/mjr/code/apps/whelm/.lace/mount-assignments.json
  ports: /home/mjr/code/apps/whelm/.lace/port-assignments.json
  failed phase: mountValidation
  project: whelm
  workspace: /home/mjr/code/apps/whelm

To debug, run: lace validate --workspace-folder /home/mjr/code/apps/whelm
```

All paths are absolute for unambiguous agent consumption.

The footer is emitted when `exitCode !== 0`.
Both `lace up` and `lace validate` use the same footer logic, extracted into a shared utility (`formatDebugFooter()` in a new `packages/lace/src/lib/debug-footer.ts`).

**Files:**
- New: `packages/lace/src/lib/debug-footer.ts`
- Modified: `packages/lace/src/commands/up.ts`

**Tests:** Verify footer is emitted on failure, not on success.

## Phase 5: `lace validate` Subcommand

A dry-run that exercises the full config pipeline without starting a container.

**Phases executed:**
1. Parse devcontainer.json
2. Workspace layout detection
3. Host validation
4. User config loading and merge
5. Feature metadata fetch and validation
6. Template resolution (port allocation, mount resolution)
7. Mount source existence check
8. Extended config generation
9. Config drift detection

**Phases skipped:** prebuild, `devcontainer up`, container verification.

Reuses `runUp()` with `skipDevcontainerUp: true` and a new `validateOnly: true` flag that also skips the prebuild.

**Output format:**

```
$ lace validate
Parsing devcontainer.json... OK
Workspace layout... worktree (lace/main)
Host validation... 2/2 checks passed
User config... 3 mount(s), 1 feature(s)
Feature metadata... 5/5 validated
Template resolution... 3 port(s), 4 mount(s)
Mount sources... all exist
Config generation... OK

Validation passed.
```

**Files:**
- New: `packages/lace/src/commands/validate.ts`
- Modified: `packages/lace/src/index.ts` (register command)
- Modified: `packages/lace/src/lib/up.ts` (add `validateOnly` option)

**Tests:** New `validate.test.ts`: valid workspace passes, missing mount source fails with attributed error.

## Edge Cases

**Concurrent `lace up` invocations.**
Log file naming uses ISO timestamps with seconds granularity.
Concurrent runs within the same second collide.
Mitigation: append a short random suffix.
This is an existing limitation of `.lace/` and is not introduced by this proposal.

**`lace validate` and port allocation side effects.**
Port allocation persists assignments even in validate mode.
This is acceptable: port assignments are idempotent and reused on the next `lace up`.

**Mount assignment points to a file instead of a directory.**
`existsSync()` returns true for both.
Type mismatch is caught by `validateSourceType()` for `sourceMustBe` mounts.
For non-validated mounts, this passes through to the runtime: Phase 1's attributed error helps diagnosis.

## Test Plan

### Phase 1: Mount Validation with Full Attribution
- Unit test: missing mount source produces error with label, feature name, and remediation.
- Unit test: static mount (no label) produces fallback error format.
- Unit test: `${...}` sources are still skipped.

### Phase 2: Stale Assignment Detection
- Unit test: non-override entry with non-existent path is discarded, warning logged, re-resolved.
- Unit test: override entry with non-existent path is preserved (validated in `resolveSource()`).

### Phase 3: Debug Log Persistence
- Unit test: `RunLog.finalize()` writes file with expected name and structure.
- Unit test: retention policy keeps 10 most recent, deletes old files.

### Phase 4: Agent-Friendly Error Footer
- Integration test: failing `lace up` emits footer with log path and `lace validate` command.
- Integration test: successful `lace up` does NOT emit footer.

### Phase 5: `lace validate`
- Integration test: valid workspace returns exit code 0.
- Integration test: workspace with missing mount source returns exit code 1 with attributed error.
- Unit test: `validateOnly: true` skips prebuild and devcontainer phases.

## Verification Methodology

End-to-end verification against the lace devcontainer after each phase:
- Delete a mount source directory, run `lace up`, verify attributed error and log file.
- Run again, verify auto-recovery.
- Run `lace validate` on a healthy workspace, verify checklist output.
- Run `lace validate` with a broken mount, verify error output and debugging footer.
