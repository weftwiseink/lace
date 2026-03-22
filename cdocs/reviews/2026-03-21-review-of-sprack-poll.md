---
review_of: cdocs/proposals/2026-03-21-sprack-poll.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T20:15:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [fresh_agent, architecture, daemon, signal_handling, cross_reference_consistency]
---

# Review: sprack-poll: tmux State Poller Daemon

## Summary Assessment

This proposal defines sprack-poll, the tmux state polling daemon that feeds the sprack SQLite database.
The document is well-structured, thorough in its coverage of the polling loop, tmux CLI interaction, signal handling, and error behavior.
The most significant finding is a set of interface mismatches between sprack-poll's internal data types and sprack-db's public API: these are not bugs (both are pre-implementation proposals), but they will cause confusion during implementation unless reconciled.
The proposal also has a gap in how lace metadata changes are detected when the main tmux state hash is unchanged.
Verdict: **Revise** to address the cross-reference inconsistencies and the lace options polling gap.

## Section-by-Section Findings

### BLUF

Well-written.
Covers the what (tmux state poller), how (single `list-panes -a -F` call, hash-based diff, SIGUSR1), and where (`packages/sprack/crates/sprack-poll/`).
The <50ms latency claim is substantiated later in the signal handling section.
No issues.

### Binary Structure

**Non-blocking**: the crate structure is clean and the three-module split (`main.rs`, `tmux.rs`, `diff.rs`) is appropriate for the scope.
The dependency table is clear.
The `signal-hook` rationale NOTE is well-placed.

### Main Loop Pseudocode

**Blocking**: the pseudocode calls `sprack_db::write_tmux_state(&db, &state, &lace_meta)` with a `TmuxSnapshot` and separate lace metadata.
However, the sprack-db proposal defines `write_tmux_state(conn, sessions, windows, panes)` with three separate vectors and no lace metadata parameter.
Lace metadata in sprack-db is part of the `Session` struct (`lace_port`, `lace_user`, `lace_workspace` fields).
The sprack-poll proposal needs to either:
(a) show the data transformation from `TmuxSnapshot` + lace options into sprack-db's `(Vec<Session>, Vec<Window>, Vec<Pane>)`, or
(b) align the pseudocode signature with sprack-db's actual API.

**Non-blocking**: the pseudocode references `wait_for_tmux_or_signal(&signals, poll_interval)` in the `TmuxError::ServerNotRunning` branch, but this function is never defined.
The later section defines `wait_for_signal` only.
Either unify the names or document the behavioral difference (presumably the "tmux or signal" variant also checks for tmux server reappearance).

### tmux CLI Interaction

Thorough section.
The format variable table is comprehensive and the unit-separator delimiter choice is well-justified.

**Non-blocking**: the lace metadata N+1 query is acknowledged with a reasonable rationale ("3-10 sessions, tmux has no batch option").
Acceptable.

### Parsing

**Blocking**: the internal `Pane` struct defines `pid: u32`, but sprack-db defines `pane_pid: Option<u32>`.
The sprack-poll `Session` struct has no `updated_at`, `lace_port`, `lace_user`, or `lace_workspace` fields, while sprack-db's `Session` has all of these.
The sprack-poll `Window` struct uses `index: u32` while sprack-db uses `window_index: i32`.
These are not necessarily errors (sprack-poll has internal types that get mapped to sprack-db types before writing), but the proposal never shows the mapping step.
This is a gap in the design: the reader cannot verify that the data flow from tmux output to DB is correct without seeing the transformation.

### Command Execution

**Non-blocking**: the TODO about the 5-second timeout is honest and the risk assessment ("tmux hangs are rare") is reasonable.
However, for a long-running daemon, a rare hang is a production-down scenario.
The `wait-timeout` crate approach should be elevated to Phase 1 rather than deferred.
This is non-blocking for the proposal but worth calling out.

### Hash-Based Diff Algorithm

Clean design.
The "hash before parse" optimization is sound.
The Mermaid diagram is clear.

**Blocking**: Property 3 states "Lace options not hashed: the per-session `show-options` calls run only when the main hash changes."
This means if `lace-into` sets `@lace_port` on an existing session (without creating new panes or changing any tmux structural state), the DB will not reflect the change until some unrelated tmux state change triggers a hash mismatch.
The proposal should acknowledge this gap and either:
(a) accept it as a known limitation (with reasoning for why it is rare enough), or
(b) always re-read lace options (the cost is small: 3 `show-options` calls per session, ~5-10ms total).

### SIGUSR1 Signal Handling

**Non-blocking**: the `wait_for_signal` implementation uses a 50ms sleep-poll loop.
The NOTE correctly identifies that `signal_hook::iterator::Signals::wait()` with a timeout would be cleaner.
`signal_hook::iterator::SignalsInfo::wait()` does accept an iterator with timeout semantics via `signal_hook::iterator::Pending` and `std::thread::park_timeout`.
Alternatively, `signal_hook::low_level::pipe::register()` with a self-pipe and `poll(2)` would give exact wakeup.
The current approach works but wastes cycles; worth a TODO for Phase 1.

**Non-blocking**: SIGINT is not registered.
If the user somehow sends Ctrl-C to the sprack-poll process (e.g., during debugging), it will terminate without PID file cleanup.
Consider adding SIGINT alongside SIGTERM for clean shutdown.

### tmux Hook Configuration

Good coverage.
The WARN about binary name matching is important.

**Non-blocking**: the hooks list omits `window-linked` and `window-unlinked`, which fire when windows are moved between sessions.
This is an edge case (most users do not move windows between sessions), but it would cause a stale tree for up to 1 second.
Worth a note in the "Hooks Not Covered" table.

**Non-blocking**: the `session-closed` hook uses a different name than tmux's actual hook.
tmux 3.0+ uses `session-closed`; earlier versions use `session-close`.
Given the devcontainer environment controls the tmux version, this is likely fine, but worth verifying against the target tmux version.

### Daemon Lifecycle

Clean startup/shutdown flow.
The Mermaid diagram is helpful.

**Non-blocking**: the PID file write is not atomic.
If sprack-poll crashes between creating the file and writing the PID, a subsequent launch will find an empty PID file.
Using a write-to-temp-then-rename pattern (atomic on Linux for same-filesystem renames) would be more robust.
This is a minor robustness concern.

**Non-blocking**: the 60-second timeout for tmux server absence could be documented as configurable via the `config.toml` referenced in the design refinements proposal.

### Error Handling

The error table is comprehensive and the resilience principle is well-stated.
No issues.

### DB Write Strategy

**Non-blocking**: the proposal shows `DELETE FROM panes; DELETE FROM windows; DELETE FROM sessions;` in that order, but the sprack-db proposal says "Delete all rows from sessions (CASCADE handles windows, panes, integrations)."
If CASCADE is in effect, only `DELETE FROM sessions` is needed.
The sprack-poll proposal's explicit three-table delete is redundant but not incorrect.
This is a minor inconsistency: align with sprack-db's documented approach (single delete with CASCADE) for clarity.

### Test Plan

Good coverage.
The unit/integration split is appropriate.
The NOTE about mocking the tmux CLI via a command executor trait is the right approach.

**Non-blocking**: no test for SIGUSR1 handling.
Even in unit tests, verifying that the `wait_for_signal` function returns immediately when a signal is pending (using `signal_hook::low_level::raise`) would be valuable.

### Implementation Phases

Clean two-phase split.
Phase 1 covers the core loop; Phase 2 adds signal handling and hooks.
The NOTE about hook installation belonging to the user is appropriate.

## Verdict

**Revise**.
Three blocking issues to resolve before acceptance:
1. Reconcile the `write_tmux_state` call signature and data transformation between sprack-poll's internal types and sprack-db's API.
2. Document the struct field mapping from sprack-poll's `TmuxSnapshot` hierarchy to sprack-db's `(Session, Window, Pane)` types.
3. Address the lace options polling gap when main tmux state hash is unchanged.

## Action Items

1. [blocking] Align the `write_tmux_state` pseudocode call with sprack-db's documented function signature `(conn, sessions, windows, panes)`, or add a mapping function that transforms `TmuxSnapshot` + lace options into sprack-db types.
2. [blocking] Show or describe the field mapping between sprack-poll's internal structs (`Pane.pid: u32`, `Window.index: u32`) and sprack-db's types (`Pane.pane_pid: Option<u32>`, `Window.window_index: i32`). Even a brief note acknowledging the mapping step would suffice.
3. [blocking] Address the lace options hash gap: either always re-read lace options on every poll cycle (recommended, given the negligible cost), or document the limitation with reasoning for why stale lace metadata is acceptable.
4. [non-blocking] Define or unify `wait_for_tmux_or_signal` with `wait_for_signal` in the pseudocode.
5. [non-blocking] Add SIGINT to the registered signal set for clean shutdown during debugging.
6. [non-blocking] Consider atomic PID file writes (write-to-temp-then-rename).
7. [non-blocking] Add `window-linked`/`window-unlinked` to the "Hooks Not Covered" table or to the hook list.
8. [non-blocking] Consider adding a signal-handling test to the test plan.
9. [non-blocking] Align the DB write strategy section with sprack-db's CASCADE approach (single `DELETE FROM sessions` instead of three deletes).
