---
review_of: cdocs/proposals/2026-03-21-sprack-poll.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T21:00:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [rereview_agent, architecture, daemon, cross_reference_consistency, signal_handling]
---

# Round 2 Review: sprack-poll: tmux State Poller Daemon

## Summary Assessment

This round 2 review focuses on the three blocking issues from round 1: `write_tmux_state` call signature alignment, struct field mapping documentation, and lace options always being re-read regardless of hash match.
All three blocking issues have been resolved.
The proposal is well-structured, internally consistent, and properly aligned with sprack-db's public API.
Verdict: **Accept**.

## Resolution of Round 1 Blocking Issues

### 1. `write_tmux_state` Call Signature (resolved)

Round 1 flagged that the pseudocode called `sprack_db::write_tmux_state(&db, &state, &lace_meta)`, which did not match sprack-db's `(conn, sessions, windows, panes)` signature.

The main loop pseudocode (line 89) now reads:
```rust
sprack_db::write_tmux_state(&db, &sessions, &windows, &panes);
```

This matches sprack-db's documented API exactly.
The preceding line (88) shows the transformation step: `let (sessions, windows, panes) = to_db_types(&snapshot, &lace_meta);`.

### 2. Struct Field Mapping (resolved)

Round 1 flagged that sprack-poll's internal types (`Pane.pid: u32`, `Window.index: u32`) differed from sprack-db's types without any documented mapping.

A new "Type Mapping: sprack-poll to sprack-db" section (lines 195-262) addresses this comprehensively:
- A full `to_db_types()` function with inline type conversions (`u32` to `i32`, `u32` to `Option<u32>`, lace metadata injection).
- A field-level mapping table covering all conversions.
- A NOTE explaining the rationale for remaining type differences.

The internal struct field names have also been aligned: `pane_id`, `pane_pid`, `window_index` now match sprack-db's naming.

### 3. Lace Options Always Re-Read (resolved)

Round 1 flagged that lace options were only read when the main hash changed, meaning metadata-only changes (e.g., `lace-into` setting `@lace_port`) would go undetected.

The pseudocode now always reads lace options (lines 79-80):
```rust
// Always read lace options (cheap: 3-5 show-options calls)
let snapshot = parse_tmux_output(&raw_output);
let lace_meta = query_lace_options(&snapshot.session_names());
```

The write condition (line 87) is `if main_state_changed || lace_options_changed(&db, &lace_meta)`, correctly triggering a DB write for metadata-only changes.
The Hash-Based Diff section (lines 292-318) documents this behavior explicitly, including an updated Mermaid diagram and property descriptions (notably property 3, which is the inverse of the round 1 finding).

## Status of Round 1 Non-Blocking Items

| Item | Status |
|------|--------|
| 4. `wait_for_tmux_or_signal` naming inconsistency | Addressed: consistently `wait_for_signal` throughout |
| 5. SIGINT not registered | Addressed: registered alongside SIGUSR1 and SIGTERM |
| 6. Atomic PID file writes | Not addressed (acceptable for Phase 1) |
| 7. `window-linked`/`window-unlinked` in hooks table | Not addressed (true edge case) |
| 8. Signal-handling test in test plan | Not addressed (acceptable) |
| 9. DB write strategy CASCADE alignment | Addressed: single `DELETE FROM sessions` with CASCADE comment |

The three unaddressed items are genuinely minor and do not warrant blocking.

## New Observations

### lace_options_changed Implementation Gap (non-blocking)

The pseudocode calls `lace_options_changed(&db, &lace_meta)` but does not define this function.
The intent is clear (compare current lace metadata against what is in the DB), but the implementation strategy is unspecified: does it read existing session rows from the DB and compare, or does it maintain an in-memory cache of the last-written lace metadata?
The in-memory approach would be more efficient (avoids a DB read on every cycle), but either works.
This is a design decision best made at implementation time.

### to_db_types Dead Pane PID Edge Case (non-blocking)

The field mapping table notes that `Pane.pane_pid: u32` maps to `Pane.pane_pid: Option<u32>` wrapped in `Some()`, with a parenthetical about dead panes potentially having no PID.
However, the `to_db_types()` code always wraps in `Some(p.pane_pid)`, meaning a dead pane would still have whatever PID tmux reported.
This is correct behavior: tmux's `#{pane_pid}` reports the original shell PID even for dead panes.
The `Option` type in sprack-db exists for future flexibility, not for current dead-pane handling.
No action needed; the mapping table's parenthetical could be slightly clearer but is not misleading.

## Verdict

**Accept**.
All three round 1 blocking issues have been resolved thoroughly.
The type mapping section is a particularly strong addition: it makes the data flow from tmux CLI output through internal types to DB types fully traceable.
The proposal is ready for implementation.

## Action Items

1. [non-blocking] Consider specifying the `lace_options_changed` implementation strategy (in-memory cache vs. DB read) in the pseudocode or a NOTE.
2. [non-blocking] Consider adding `window-linked`/`window-unlinked` to the "Hooks Not Covered" table for completeness.
3. [non-blocking] Consider adding a signal-handling unit test to the test plan (e.g., verify `wait_for_signal` returns immediately on pending SIGUSR1).
