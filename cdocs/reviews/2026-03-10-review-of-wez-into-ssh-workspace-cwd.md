---
review_of: cdocs/proposals/2026-03-10-wez-into-ssh-workspace-cwd.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-10T17:00:00-08:00
task_list: lace/wez-into
type: review
state: live
status: done
tags: [fresh_agent, bugfix, ssh, minimal_change, test_plan]
---

# Review: Fix wez-into SSH Sessions Landing in /home/node Instead of Workspace Directory

## Summary Assessment

This proposal diagnoses a real, confirmed bug where `wez-into` SSH sessions land in
`/home/node` instead of the workspace directory after the connection mechanism was
changed from mux-server domains to direct SSH. The fix is minimal and correct: append
a remote command to the SSH invocation that `cd`s to `$CONTAINER_WORKSPACE_FOLDER`.
The proposal is well-structured with thorough edge case analysis and a clear test plan.
Verdict: Accept with minor non-blocking suggestions.

## Section-by-Section Findings

### Background (lines 38-96)

The historical context is accurate and well-documented. The investigation confirming
that `CONTAINER_WORKSPACE_FOLDER` is available via SSH and that `pwd` returns
`/home/node` was independently verified against the running container. The secondary
finding about the mux server not running is appropriately scoped as out-of-band.

No issues.

### Proposed Solution (lines 98-152)

The proposed change is correct. Verified against the actual `do_connect()` function
in `bin/wez-into` (lines 498-504). One accuracy note:

**Finding 1 (non-blocking): The current code structure differs slightly from the
proposal's "before" snippet.** The actual code at line 498-504 uses a `&& { ... } || { ... }`
pattern where `pane_id` assignment is followed by `set-tab-title` in the success
block. The proposal's "before" snippet shows a simpler standalone assignment. This
does not affect the fix -- the `-t 'cd ... ; exec $SHELL -l'` addition goes into
the SSH arguments within the same `wezterm cli spawn -- ssh ...` command. But the
implementer should be aware of the surrounding `&& { ... } || { ... }` structure.

**Finding 2 (non-blocking): The `-t` flag placement in the proposed command.** The
proposal places `-t` after `"$user@localhost"`. While SSH tolerates options after
the host in many implementations, the canonical placement is before the host argument.
Consider placing `-t` with the other SSH options for clarity:

```bash
pane_id=$(wezterm cli spawn -- ssh \
    -o "IdentityFile=$LACE_SSH_KEY" \
    -o "IdentitiesOnly=yes" \
    -o "UserKnownHostsFile=$LACE_KNOWN_HOSTS" \
    -o "StrictHostKeyChecking=no" \
    -t \
    -p "$port" \
    "$user@localhost" \
    'cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd; exec $SHELL -l')
```

### Design Decisions (lines 155-189)

All three design decisions are sound and well-reasoned:

1. Reading the env var via SSH (not `docker inspect`) avoids latency and complexity.
2. Using `exec $SHELL -l` respects the configured shell.
3. Falling back to `$HOME` preserves backward compatibility.

No issues.

### Edge Cases (lines 191-227)

Thorough coverage. The workspace-directory-not-found case, non-POSIX shell case,
and PTY allocation case are all correctly analyzed.

**Finding 3 (non-blocking): Missing edge case -- `wezterm cli spawn` exit code
semantics with remote commands.** When SSH runs a remote command that exits (e.g.,
the `exec $SHELL -l` fails), `wezterm cli spawn` may return a pane_id but the pane
could be immediately dead. The existing fallback pattern (`&& { ... } || { ... }`)
handles the case where `spawn` itself fails, but not the case where the pane dies
shortly after creation. This is an existing limitation, not introduced by this
change, so it is non-blocking.

### Test Plan (lines 229-293)

The test plan is practical and covers the essential scenarios. Phase 0 verifies
the diagnosis, Phase 1 verifies the fix, Phase 2 covers regressions.

**Finding 4 (non-blocking): Test Plan Phase 0 is already verified.** The SSH
commands in Phase 0 were run during this review and confirmed the diagnosis. The
reviewer ran `ssh -p 22426 node@localhost 'pwd'` (returned `/home/node`) and
`ssh -p 22426 node@localhost 'echo $CONTAINER_WORKSPACE_FOLDER'` (returned
`/workspace/lace/main`). The proposed fix command also returns `/workspace/lace/main`.

### Implementation Phases (lines 296-338)

Phase 1 is well-scoped. Phase 2 (prebuild rebuild) and Phase 3 (regression tests)
are correctly deferred.

**Finding 5 (blocking): The dry-run output (line 437 of `bin/wez-into`) must be
updated.** The proposal mentions this in a NOTE on line 143 but does not include it
in the Implementation Phase 1 changes list on line 306. The dry-run output currently
does not reflect the workspace cd command, and a user running `wez-into --dry-run lace`
would see a stale command. The proposal's Phase 1 list on line 302-306 should
explicitly include updating the dry-run output, and the acceptance criteria on
line 319-322 do mention it, but the changes list should match.

Wait -- re-reading line 302-306, item 2 says "Update the dry-run output (line 437)
to show the new command format." This is actually present. The finding is withdrawn.
The dry-run update IS listed. No blocking issue.

## Verdict

**Accept.** The proposal correctly diagnoses the bug, proposes a minimal fix, and
covers edge cases thoroughly. The fix has been independently verified against the
running container. All findings are non-blocking.

## Action Items

1. [non-blocking] Place the `-t` flag before the host argument (with other SSH options)
   for canonical SSH argument ordering.
2. [non-blocking] Ensure the implementer accounts for the `&& { ... } || { ... }`
   structure surrounding the `wezterm cli spawn` call when editing `do_connect()`.
3. [non-blocking] Consider adding a comment in the script explaining why the remote
   command is needed (the mux-server used to handle CWD via `default_cwd`).
