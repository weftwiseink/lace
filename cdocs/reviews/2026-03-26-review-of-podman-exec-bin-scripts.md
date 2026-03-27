---
review_of: cdocs/devlogs/2026-03-26-podman-exec-container-entry.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T18:30:00-07:00
task_list: lace/podman-migration
type: review
state: live
status: done
tags: [fresh_agent, shell_scripting, podman, migration, error_handling, edge_cases]
---

# Review: Podman Exec Bin Script Migration

## Summary Assessment

The podman exec migration across seven bin scripts is well-executed: SSH is fully removed from the entry path, the `@lace_container` metadata model is internally consistent, and the shared `resolve_runtime()` abstraction cleanly replaces hardcoded `docker` calls.
The most significant findings are: one stale SSH comment, a subtle validation gap in `resolve_runtime()` step 2, the `lace-inspect` exec calls running as container default user rather than the resolved remote user, and the triple-implementation of runtime resolution across bash and nushell.
The code is production-quality with minor improvements possible.
Verdict: **Accept** with non-blocking suggestions.

## Script-by-Script Findings

### lace-lib.sh (shared library)

The `resolve_runtime()` function is clean and well-documented with its three-tier resolution chain.
The `|| exit 1` on line 55 correctly propagates failure to any sourcing script.

**Non-blocking (F1)**: The `overridePodmanCommand` path (step 2) trusts the settings.json value without validating the command exists on PATH.
If `settings.json` specifies `"overridePodmanCommand": "nerdctl"` but nerdctl is not installed, `RUNTIME` is set to `"nerdctl"` and all subsequent `"$RUNTIME" exec ...` calls fail with opaque "command not found" errors.
Step 3 (auto-detect) validates via `command -v`, but step 2 does not.
A `command -v "$override"` check after extraction would catch this with a clear diagnostic.

**Non-blocking (F2)**: The grep/sed parser for settings.json is fragile against edge cases: JSON comments (not standard but common), whitespace variations, or multiple keys on the same line.
This is acceptable given the no-jq-dependency constraint and the simplicity of lace's settings.json, but worth a NOTE callout in the source.

### lace-discover

Label-based discovery is a clean replacement for the SSH port range scan.
The `remoteUser` extraction from `devcontainer.metadata` with `grep -oP` and `head -1` correctly handles multi-match edge cases.

**Non-blocking (F3)**: The colon-delimited text output format (`name:container_name:user:path:workspace`) is parsed via `IFS=:` in `lace-into`.
If any field contains a colon (technically valid in Linux paths, though extremely rare), parsing misaligns.
The JSON output mode does not have this issue.
This is a pre-existing design choice carried forward, not a regression.

**Non-blocking (F4)**: Line 52 has a redundant `2>&1` after `&>/dev/null` (which already redirects both stdout and stderr).
`"$RUNTIME" info &>/dev/null 2>&1` should be just `"$RUNTIME" info &>/dev/null`.

### lace-into

This is the largest script (~970 lines) and handles the most complex state transitions: session creation, dead pane respawning, pane mode, stopped container start, interactive pickers.
The implementation is thorough with good error paths and diagnostics.

**Non-blocking (F5)**: `build_exec_cmd()` uses bash nameref (`local -n _cmd=$4`) which requires bash 4.3+.
All target systems (Fedora) have bash 5.x, but this is worth a comment for portability awareness.

**Non-blocking (F6)**: The `discover()` helper calls `lace-discover` for every user-resolution and project-lookup, which means multiple container runtime queries per invocation.
For the common case (1-3 containers), this is negligible.
For systems with many containers, caching the discover output in a variable and parsing it multiple times would be more efficient.

**Non-blocking (F7)**: In `do_connect()`, the dead pane respawn loop (lines 524-534) iterates `$dead_panes` unquoted: `for pane_id in $dead_panes`.
Since pane IDs are `%N` format (no spaces), this is safe, but quoting the expansion with `while read` would be more defensive:

```bash
while read -r pane_id; do
  ...
done <<< "$dead_panes"
```

**Non-blocking (F8)**: The `start_and_connect()` function sets a `trap "rm -f '$up_logfile'" EXIT` on line 193.
If the script reaches this code path, the trap replaces any prior EXIT trap.
In practice there is no prior EXIT trap in lace-into, but this is a fragile pattern if one is added later.
The explicit `rm -f "$up_logfile"` on line 208 and `trap - EXIT` on line 209 mitigate this well.

### lace-split

Clean and focused. The symlink resolution for `SCRIPT_DIR` is the same pattern used in `lace-into` and `lace-discover`, correctly finding `lace-lib.sh` when invoked via symlink.

**Non-blocking (F9)**: The `exec_args` array on line 81 uses `"${user:-node}"` as a default, while `lace-discover`'s user resolution defaults to `"node"` only when the resolved user is empty or root.
If the metadata is somehow cleared between the `lace-into` session creation and a subsequent split (e.g., manual `set-option -pu`), the fallback to `"node"` is reasonable.
The defaults are consistent across the codebase.

**Non-blocking (F10)**: When `$TARGET` is empty and `TARGET_ARGS` is an empty array, the `tmux show-option -pqv "${TARGET_ARGS[@]}" @lace_container` expansion is correct (empty array expands to nothing).
This is correct bash behavior but could benefit from a comment explaining the empty-array-expansion semantics.

### lace-disconnect-pane

Simple and correct. The `set-option -pu` (unset pane option) calls are the right approach.

**Non-blocking (F11)**: Line 23 contains a stale comment: "which would be SSH" should reference "which would be the container exec command" (or "podman exec").
This is the only residual SSH reference that describes current behavior inaccurately.

### lace-paste-image (nushell)

The podman cp replacement for SCP is clean: save clipboard to local temp, `$runtime cp` into container, send path to pane.

**Non-blocking (F12)**: The `resolve-runtime` function is duplicated from the bash implementation.
If the resolution logic changes, three implementations must be updated (lace-lib.sh, lace-paste-image, lace-inspect).
A potential future improvement: a standalone `lace-runtime` script that prints the resolved runtime, callable from both bash and nushell.

**Non-blocking (F13)**: The nushell `resolve-runtime` returns `"MISSING_RUNTIME"` instead of erroring when no runtime is found.
This means `^MISSING_RUNTIME cp ...` will fail with a confusing "command not found" error rather than a clear "no container runtime" diagnostic.
The bash version handles this better by exiting with a descriptive error.

**Non-blocking (F14)**: `podman cp` copies files as root into the container.
The pasted image lands in `/tmp/` (world-readable), so file ownership is not a practical concern for this use case.
However, if the destination path changes in the future, ownership could become relevant.

### lace-inspect (nushell)

Comprehensive inspection with mounts, ports, labels, environment, and in-container checks.

**Non-blocking (F15)**: All `^$runtime exec $name` calls run without `--user`, defaulting to the container's process user (typically root).
This is acceptable for an inspection tool since it needs access to system paths, credential files, and git repos.
However, the `claude --version` check (line 188) and credential file checks (lines 178-183) may behave differently when run as root vs. the configured remote user, since Claude's config is user-specific.
The `CLAUDE_CONFIG_DIR` env var extraction (line 175) mitigates this by using the absolute path regardless of user.

**Non-blocking (F16)**: The `resolve-runtime` duplication (same as F12/F13) applies here.

## Cross-Cutting Concerns

### Metadata consistency

The `@lace_container`, `@lace_user`, `@lace_workspace` triple is set consistently:
- `lace-into do_connect()`: session-level and pane-level on initial pane
- `lace-into do_connect_pane()`: pane-level always, session-level if not already set
- `lace-split`: pane-level on new split pane (propagated from source pane)
- `lace-disconnect-pane`: all three cleared via `-pu` (unset pane)

This is internally consistent and correctly implements the split-propagation model.

### No residual SSH in runtime paths

Verified via grep: the only SSH references are in comments (lace-paste-image line 63, lace-disconnect-pane line 23).
The lace-disconnect-pane comment (F11) inaccurately describes current behavior.
The lace-paste-image comment is a historical note and is fine.

### Error handling robustness

The bash scripts use `set -euo pipefail` consistently.
Podman exec failures in `lace-into` are handled via session-level health checks (dead pane detection, respawn).
The `lace-into --start` flow has thorough error handling with structured `LACE_RESULT` parsing and a legacy heuristic fallback.
The nushell scripts use `try/catch` consistently.

### Shell scripting quality

Variables are consistently quoted.
Arrays are used instead of string splitting for command construction.
The symlink resolution pattern is repeated in three scripts; this is acceptable since bash sourcing doesn't support a two-stage resolution (the pattern must be inlined before sourcing `lace-lib.sh`).

## Verdict

**Accept.**
The migration is thorough, internally consistent, and well-tested (49/50 automated, manual verification, cargo check).
All findings are non-blocking.
The stale SSH comment (F11) is the only factual inaccuracy and is trivial to fix.
The `resolve-runtime` duplication across bash and nushell (F12/F13) is an inherent consequence of the polyglot tooling and has a clear future mitigation path.

## Action Items

1. [non-blocking] (F11) Update the stale comment in `lace-disconnect-pane` line 23 from "which would be SSH" to "which would be the container exec command".
2. [non-blocking] (F4) Remove redundant `2>&1` after `&>/dev/null` in `lace-discover` line 52.
3. [non-blocking] (F1) Consider adding `command -v "$override"` validation after extracting `overridePodmanCommand` from settings.json in `resolve_runtime()`.
4. [non-blocking] (F13) Consider improving the nushell `resolve-runtime` fallback to `error make` with a descriptive message instead of returning `"MISSING_RUNTIME"`.
5. [non-blocking] (F12) Consider creating a standalone `lace-runtime` script to unify the three `resolve_runtime` implementations.
6. [non-blocking] (F7) Consider using `while read` instead of unquoted `for pane_id in $dead_panes` for defensive coding.
