---
review_of: cdocs/proposals/2026-03-22-pane-connect-disconnect.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-22T11:00:00-07:00
task_list: session-management/pane-connect-disconnect
type: review
state: archived
status: done
tags: [fresh_agent, tmux, nushell, test_plan, session-management, pane-management]
---

# Review: Pane-Level Connect and Disconnect for Lace Sessions

## Summary Assessment

This proposal adds `--pane` mode to `lace-into` and a `disconnect-pane` tmux command, enabling per-pane container attachment without session switching.
The design is well-structured, correctly applies the nushell default-shell lessons from the Alt+S debug session, and makes sound trade-offs (set-if-absent session options, no SSH guard on disconnect).
The main gaps are: the `disconnect-pane` command-alias has a quoting issue that will silently fail, the proposal does not show how the test harness in `bin/test/test-lace-into.sh` is extended, and the per-pane options add complexity without a clear consumer beyond future speculation.
Verdict: **Revise** (two blocking issues).

## Section-by-Section Findings

### BLUF and Summary

Clear and accurate.
The framing correctly positions `--pane` as complementary to existing session-per-container behavior.
No issues.

### Objective

Well-scoped.
The explicit mention of preserving `lace-split` compatibility via session-level options shows the author considered cross-feature interactions.

### Background

**Non-blocking.** The line references ("line 451 of `bin/lace-into`", "lines 538-543") are helpful but brittle: they will drift as the file changes.
Consider referencing function names (`do_connect()`, the dead-pane respawn block) instead of line numbers.

### Proposed Solution: `do_connect_pane()`

**Blocking: `respawn-pane -k` with the `ssh_base` array pattern needs verification against tmux's argument handling.**

The proposal reuses the `ssh_base` array pattern from `do_connect()`:

```bash
tmux respawn-pane -k -t "$TMUX_PANE" "${ssh_base[@]}"
```

In `do_connect()`, both `new-session` and `respawn-pane` use this pattern (lines 542, 561 of `bin/lace-into`), and this works because tmux treats remaining positional arguments as the command plus its arguments, executing them directly without going through the default shell.
The proposal correctly applies this same mechanism.

However, there is a subtle difference with `respawn-pane -k` versus `respawn-pane` (without `-k`).
The existing `do_connect()` uses `respawn-pane` without `-k` for dead pane recovery (line 542), which re-uses an already-dead pane.
`do_connect_pane()` uses `respawn-pane -k`, which kills an alive pane first.
These should behave identically regarding argument passing, but the proposal should explicitly confirm this, since `respawn-pane -k` on a live pane is a different codepath in tmux and the nushell default-shell issue is the kind of bug that appears only under specific conditions.

The actual concern here is lower-risk than it appears: the existing `do_connect()` already proves `respawn-pane "${ssh_base[@]}"` bypasses the default shell, and `-k` only changes the pre-kill behavior, not the command-execution behavior.
**Downgrade to non-blocking**: add a note that `-k` has been verified to behave identically to non-`-k` regarding argument handling, or add a test case that confirms it.

### Proposed Solution: `disconnect-pane` Command Alias

**Blocking: the `command-alias` `run-shell` will not correctly expand `#{pane_id}`.**

The proposed registration:

```tmux
set -s command-alias[100] disconnect-pane='run-shell "tmux respawn-pane -k -t #{pane_id}"'
```

There is an issue with `#{pane_id}` inside `run-shell`.
Format variables like `#{pane_id}` are expanded by tmux in contexts where a target pane is known (e.g., inside `bind`, `if-shell`, or `display-message`).
In a `command-alias` invoked from the command prompt, the format string is expanded by the `run-shell` command in the context of the current pane.
This should work because `run-shell` does support format expansion in its argument string.

However, the simpler and more robust approach is:

```tmux
set -s command-alias[100] disconnect-pane='respawn-pane -k'
```

`respawn-pane` without a target defaults to the current pane.
The `run-shell` indirection is unnecessary since `respawn-pane` is a native tmux command that can be used directly in a command-alias.
The `run-shell` form adds a layer of shell invocation (via `/bin/sh`) that is not needed and introduces potential quoting complications.

**This is blocking because the `run-shell "tmux respawn-pane ..."` form invokes `tmux` as a subprocess, which connects to the default tmux socket, not necessarily the same server.**
In isolated testing with `-L <socket>`, this will silently target the wrong server.
More importantly, the bare `tmux` call in `run-shell` does not inherit the `-L` socket name.

The correct simple form:

```tmux
set -s command-alias[100] disconnect-pane='respawn-pane -k'
```

Similarly, the keybinding:

```tmux
bind D respawn-pane -k
```

No `run-shell` wrapper needed.

### Proposed Solution: Keybinding

The proposed keybinding:

```tmux
bind D run-shell 'tmux respawn-pane -k -t "#{pane_id}"'
```

Same issue as above: `run-shell 'tmux ...'` invokes tmux as a subprocess.
For a keybinding, the simpler form is:

```tmux
bind D respawn-pane -k
```

`respawn-pane -k` in a binding targets the current pane by default.
**Non-blocking** (the run-shell form works in practice since the user's tmux.conf is loaded into the default server), but the simpler form is preferred.

### Session-Level Set-If-Absent Logic

The set-if-absent pattern is correct:

```bash
existing_port=$(tmux show-option -qv @lace_port 2>/dev/null)
if [[ -z "$existing_port" ]]; then
  tmux set-option @lace_port "$port"
  ...
```

This correctly uses `show-option` without the `=` prefix (the proposal references this as learning #2 from the debug session).
The warning when ports differ is a good user experience touch.

One nuance: `show-option -qv` without `-t` targets the current session.
Since `do_connect_pane()` runs from within the user's current tmux session (the user invokes `lace-into --pane` from a pane in their session), this correctly targets the session the pane belongs to.
No issue.

### Per-Pane Options

**Non-blocking: premature complexity.**

The proposal adds three per-pane options: `@lace_connected`, `@lace_target_port`, `@lace_target_project`.
The only consumer mentioned is `disconnect-pane` ("enable `disconnect-pane` to verify the pane is actually connected"), but the proposal's own `disconnect-pane` implementation does not read these options.
The "future tooling" and "future per-pane-aware split behavior" are speculative.

These options are harmless but add code and testing surface for no current benefit.
Recommend deferring to when a consumer exists.
If kept, the proposal should acknowledge that `disconnect-pane` does not clear them (which it does, in the cleanup NOTE), and that stale options are the expected state after disconnect.

### Interaction with Existing Features

Well-analyzed.
The `lace-split` interaction, dead pane recovery limitations, and session-oriented coexistence are all correctly described.
The limitation that per-pane options do not influence Alt+HJKL splits is clearly documented.

### Edge Cases

**Non-blocking: `disconnect-pane` clears working directory.**

The proposal correctly identifies that `respawn-pane -k` starts in `pane_start_directory`, not the user's current `pwd`.
This is inherent to `respawn-pane` and cannot be avoided without complexity.
Acceptable for Phase 1.

**Non-blocking: multi-container session.**

The "first container wins" semantics for session-level `@lace_port` are reasonable.
The warning message is clear.
Future per-pane-aware splits are deferred appropriately.

### Test Plan

**Blocking: test plan items are manual-only with no harness extension.**

The proposal lists 10 test scenarios, all described as manual verification steps.
The existing `bin/test/test-lace-into.sh` harness provides automated testing for session creation, reattach, and dead pane recovery.
The proposal should show how the harness is extended with `--pane` tests.

At minimum, the harness needs:

1. A test for `--pane` outside tmux (verify error message)
2. A test for `--pane` inside the test tmux (verify `respawn-pane` is called, pane options are set, session options are set-if-absent)
3. A test for multi-container warning (connect pane A to project X, connect pane B to project Y, verify warning)

The "Learnings Applied" section (#4) says "The test harness at `bin/test/test-lace-into.sh` must be extended with `--pane` tests before the feature ships," but the test plan section does not include the harness test specifications.
The test plan should contain both manual and automated test specifications.

Testing `--pane` in the harness requires simulating being "inside tmux": the `run_lace_into` helper sets `TMUX=""`, which means `--pane` will always fail the precondition check.
The proposal should describe how to set `TMUX` and `TMUX_PANE` in the test environment to simulate being inside tmux.
This is straightforward: `TMUX="/tmp/tmux-1000/lace-test-harness,12345,0" TMUX_PANE="%0"`.

### Learnings Applied

Good section.
Correctly references all five relevant findings from the debug session.
Learning #1 (nushell default-shell) is the most important and is correctly applied in the `ssh_base` array pattern.

### Implementation Phases

Clean three-phase plan.
Phase 2 being in the dotfiles repo is a practical note.
Risk assessments are accurate.

## Verdict

**Revise.**
Two blocking issues must be addressed before acceptance:

1. The `disconnect-pane` command-alias should use bare `respawn-pane -k` instead of `run-shell "tmux respawn-pane -k -t #{pane_id}"`.
2. The test plan must include harness extension specifications, not just manual steps.

## Action Items

1. [blocking] Replace `disconnect-pane` command-alias from `run-shell "tmux respawn-pane -k -t #{pane_id}"` to `respawn-pane -k`. Same for the keybinding: `bind D respawn-pane -k`.
2. [blocking] Add automated test specifications to the test plan showing how `bin/test/test-lace-into.sh` is extended for `--pane` mode, including how `TMUX`/`TMUX_PANE` are set in the test environment.
3. [non-blocking] Consider deferring per-pane options (`@lace_connected`, `@lace_target_port`, `@lace_target_project`) until a consumer exists. If kept, note that they are speculative and untested.
4. [non-blocking] Replace line number references in Background with function name references for durability.
5. [non-blocking] Add a note confirming `respawn-pane -k` argument handling is identical to `respawn-pane` (without `-k`) regarding default shell bypass, or add a test case that confirms this.
6. [non-blocking] Simplify the SSH guard variant from `if-shell` with `display-message` to a NOTE that this can be added later, rather than including the full implementation inline. The inline code increases cognitive load for a feature explicitly deferred.
