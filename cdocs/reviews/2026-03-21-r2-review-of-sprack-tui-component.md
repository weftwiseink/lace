---
review_of: cdocs/proposals/2026-03-21-sprack-tui-component.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T21:15:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [rereview_agent, architecture, tui, api_consistency, round_2]
---

# Round 2 Review: sprack TUI Component Proposal

## Summary Assessment

This proposal defines the `sprack` TUI binary: application structure, responsive layout, tree rendering, input handling, DB reading, tmux navigation, self-filtering, daemon launching, and visual styling.
All three blocking issues from the round 1 review have been resolved cleanly.
The DB connection now uses `sprack_db::open_db_readonly()`, the ProcessStatus enum is aligned across both proposals with 6 variants, and mouse input correctly separates selection (click) from tmux focus (double-click).
Several non-blocking items were also addressed (zombie prevention via `status()`, daemon detach via `setsid()`, and the `DbSnapshot` rename in sprack-db).
Verdict: Accept.

## Round 1 Blocking Issue Resolution

### 1. DB Connection: Resolved

The connection setup section (lines 386-393) now uses `sprack_db::open_db_readonly(db_path)?` with a NOTE explaining that WAL mode and read-only flags are configured internally.
No raw `Connection::open_with_flags` remains.
This maintains the principle that sprack-db mediates all database interaction.

### 2. ProcessStatus Alignment: Resolved

The Process Status Colors table (lines 565-571) lists 6 variants: Thinking, ToolUse, Idle, Error, Waiting, Complete.
Cross-checked against the sprack-db proposal: `ProcessStatus` there now defines the same 6 variants with matching names, colors noted in comments, and `Display`/`FromStr` round-tripping for TEXT column storage.
Full alignment achieved.

### 3. Mouse UX: Resolved

The Mouse section (lines 350-363) specifies click-to-select and double-click-to-focus.
Line 360 states explicitly: "Left click selects only, matching the keyboard's select/focus separation (cursor keys select, Enter focuses)."
Line 361: "Double-click is the mouse equivalent of pressing Enter."
This is the correct separation.

## Round 1 Non-Blocking Item Status

| # | Item | Status |
|---|------|--------|
| 4 | Rename sprack-db's `TreeState` to avoid collision | Addressed in sprack-db (now `DbSnapshot`, line 268 of sprack-db proposal) |
| 5 | Sync refinements doc on detail panel tiers | Not verified (out of scope for this review) |
| 6 | Use `status()` for tmux commands to avoid zombies | Addressed (lines 442-443, explicit rationale) |
| 7 | Add `setsid()` to daemon spawning | Addressed (line 519, `pre_exec` with `libc::setsid()`, with NOTE callout) |
| 8 | Visually distinguish self-filtered empty windows | Not addressed, remains a reasonable future consideration |

## Fresh Pass Observations

### App State: `db: Connection` Field Type

The `App` struct (line 74) stores `db: Connection`.
This is correct: `open_db_readonly()` returns a `rusqlite::Connection`, which is what gets stored.
No issue.

### Double-Click Detection

The proposal states double-click triggers tmux focus but does not specify how double-click detection works.
Crossterm does emit `MouseEventKind::Down` events, and distinguishing single from double click typically requires timing logic (tracking time between clicks) or relying on the terminal emulator's double-click event.
Crossterm does not natively emit a "double-click" event kind.

**Non-blocking.** The implementation will need a small state machine: track last click time and position, fire focus if a second click on the same node arrives within ~300ms.
This is straightforward but worth noting since the proposal's mouse table implies double-click is a primitive event.

### `unsafe` Block in Daemon Spawning

The `spawn_daemon` function (lines 513-521) wraps the entire `Command` chain in an `unsafe` block due to `pre_exec`.
This is correct usage: `pre_exec` is unsafe because the closure runs between `fork()` and `exec()` in the child process, where only async-signal-safe functions are permitted.
`libc::setsid()` is async-signal-safe.
No issue.

### Heartbeat Field Missing from App State

The `App` struct (lines 71-80) does not include a field for the heartbeat timestamp, yet the proposal describes checking heartbeat staleness (>5 seconds) to show a status bar warning.
The `poller_healthy: bool` field captures the derived state but not the raw timestamp.
This is fine for the proposal level of detail: `poller_healthy` is computed from the heartbeat during each `read_full_state` call.

### Test Plan Coverage

The test plan is comprehensive.
No new gaps identified beyond what was noted in round 1 (layout tier transition mid-frame, which remains non-blocking).

## Verdict

**Accept.** All three round 1 blocking issues are resolved.
The non-blocking items from round 1 were substantially addressed (4 of 5 actionable items fixed).
One new non-blocking observation: double-click detection will require a small timing state machine since crossterm does not emit double-click events natively.
The proposal is ready for implementation.

## Action Items

1. [non-blocking] Document or add a NOTE about the double-click detection mechanism (timing-based state machine on `MouseEventKind::Down` events). This will need to be addressed during implementation.
2. [non-blocking] Sync the design refinements proposal regarding which tiers have a detail panel (carried forward from round 1, item #5).
3. [non-blocking] Consider visually distinguishing windows where all panes are self-filtered (carried forward from round 1, item #8).
