---
review_of: cdocs/proposals/2026-03-21-sprack-db.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T20:45:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [rereview_agent, architecture, schema, rust, sqlite, wal_verification]
---

# Round 2 Review: sprack-db Shared SQLite Library Crate

## Summary Assessment

This is a round 2 review following up on a single blocking issue (WAL mode verification) and five non-blocking suggestions from round 1.
All six action items have been resolved: the blocking WAL verification is implemented correctly, integration flicker is explicitly acknowledged, derives are specified, timestamp responsibility is documented, and two new tests cover the gaps.
The proposal also adds two well-considered new elements: `open_db_readonly()` and an expanded `ProcessStatus` enum.
Verdict: **Accept.**

## Round 1 Action Item Resolution

### 1. [blocking] WAL mode verification in `open_db` - RESOLVED

The `open_db` function now uses `pragma_update_and_check` to set WAL mode and reads the return value, returning `SprackDbError::WalActivationFailed(mode)` if the result is not `"wal"`.
This is the correct approach: `PRAGMA journal_mode = WAL` can silently fall back to another mode, and verifying the return value catches that case.
The new `WalActivationFailed` error variant in `SprackDbError` is clean and descriptive.

### 2. [non-blocking] Integration data flicker acknowledgment - RESOLVED

A `WARN(opus/sprack-db)` callout now explicitly frames the flicker window as an accepted Phase 1 trade-off, with two concrete mitigation strategies noted for later.
This is the right level of documentation: the reader understands the consequence and the path forward.

### 3. [non-blocking] PartialEq/Eq/Hash derives - RESOLVED

The types section now specifies that all structs derive `Debug, Clone, PartialEq, Eq`, and that `Session`, `Window`, `Pane` additionally derive `Hash` for sprack-poll's hash-based diff.
This cleanly answers the question of where the diff boundary lives (at the sprack-db type level, not raw tmux output).

### 4. [non-blocking] Timestamp responsibility - RESOLVED

An explicit statement clarifies that the caller (sprack-poll) populates `updated_at` timestamps before passing structs to `write_tmux_state`.
No ambiguity remains.

### 5. [non-blocking] WAL concurrent read/write test - RESOLVED

Test 12 covers opening two connections and verifying concurrent read-during-write succeeds.

### 6. [non-blocking] FK violation test for integrations - RESOLVED

Test 13 covers `write_integration` with a nonexistent `pane_id`, verifying foreign key enforcement.

## New Additions Review

### `open_db_readonly()`

A well-motivated addition: the TUI only reads, so a read-only connection enforces this at the SQLite level.
The implementation correctly uses `pragma_query_value` (query-only) rather than `pragma_update_and_check` (set-then-check), since a read-only connection cannot change the journal mode: it can only verify the mode was already set to WAL by the writer.

The NOTE callout about `init_schema()` being the writer's responsibility and the TUI needing to handle a missing DB is clear and correct.

**Non-blocking observation**: `open_db_readonly` sets `PRAGMA foreign_keys = ON`, which is irrelevant for a read-only connection (foreign keys only affect INSERT/UPDATE/DELETE).
This is harmless but slightly misleading: a reader might wonder why a read-only connection enables FK enforcement.
Removing it or adding a brief comment would improve clarity, but this does not affect correctness.

**Non-blocking observation**: `SQLITE_OPEN_NO_MUTEX` means the connection object itself is not thread-safe (multi-thread mode, not serialized mode).
This is the correct choice for a single-threaded TUI event loop but should be noted either in the proposal or in the implementation code, since using the connection from multiple threads without external synchronization would be undefined behavior.

### `ProcessStatus` Expanded to 6 Variants

The expansion from 4 to 6 variants (`Thinking`, `ToolUse`, `Idle`, `Error`, `Waiting`, `Complete`) is well-justified.
Each variant maps to a distinct visual treatment (color) in the TUI, and the text representations (`"thinking"`, `"tool_use"`, etc.) are consistent with the self-describing TEXT storage rationale.
The schema design rationale section has been updated to reflect all six values.

### `DbSnapshot` Rename

Clean rename from `TreeState` to `DbSnapshot` with a clear rationale (avoiding collision with `tui-tree-widget::TreeState`).
The comment in the struct definition documents the reason.

### WAL Verification Test (Test 14)

Good addition: tests that `open_db` returns `WalActivationFailed` when WAL cannot be activated.
The parenthetical "(e.g., in-memory DB with incompatible config)" gives a practical test strategy.

## Writing Conventions

The document continues to follow conventions well: sentence-per-line formatting, proper callout syntax with attribution, BLUF, Mermaid diagram, no em-dashes or emojis.
The `WARN` callout for the flicker trade-off is a good use of the convention system to surface a known concern without cluttering the main design narrative.

## Verdict

**Accept.**

All blocking issues from round 1 are resolved.
The new additions (`open_db_readonly`, expanded `ProcessStatus`, `DbSnapshot` rename, `WalActivationFailed` error) are well-designed and properly documented.
The proposal is implementation-ready.

## Action Items

1. [non-blocking] Consider removing `PRAGMA foreign_keys = ON` from `open_db_readonly`, or adding a comment explaining why it is set on a read-only connection.
2. [non-blocking] Consider documenting the `SQLITE_OPEN_NO_MUTEX` threading implication: the returned connection must not be shared across threads without external synchronization.
