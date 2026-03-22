---
review_of: cdocs/proposals/2026-03-21-sprack-db.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T20:15:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [fresh_agent, architecture, schema, rust, sqlite]
---

# Review: sprack-db Shared SQLite Library Crate

## Summary Assessment

This proposal defines sprack-db, the shared SQLite library crate that underpins the sprack ecosystem's three-binary architecture.
The document is thorough, well-structured, and implementation-ready: it specifies the schema, connection management, typed Rust API, query helpers, error handling, and a test plan.
The most notable quality is the completeness of the write/read API paired with clear rationale for each schema design decision.
The primary concern is a data integrity issue in the `write_tmux_state` function and a few minor gaps in API surface.
Verdict: **Revise** (one blocking issue, several non-blocking improvements).

## Section-by-Section Findings

### BLUF

Clear and accurate.
Correctly identifies the crate as the shared library, names the five tables, and states the "callers never write raw SQL" contract.
No issues.

### Crate Structure

Clean module layout with a flat public API surface.
The file-per-concern organization (schema, types, write, read, error) is idiomatic Rust.
No issues.

### Dependencies

Good rationale for `bundled` feature (devcontainer has no system SQLite).
The explicit choice of synchronous-only operation is well-justified for the dataset size and access patterns.

**Non-blocking**: The proposal specifies `rusqlite = "0.32"`, which is current as of the document's authoring date, but may want to be pinned more precisely in `Cargo.toml` (e.g., `"0.32.1"`).
This is a standard Cargo concern and not specific to the proposal.

### Connection Management

The `open_db` function is well-specified with correct pragma sequence.
WAL mode rationale is solid and well-supported by the sqlite-watcher report.

**Blocking**: The `open_db` implementation calls `conn.pragma_update(None, "journal_mode", "wal")` but does not verify the return value.
`PRAGMA journal_mode = WAL` returns the resulting journal mode as a string.
If WAL mode fails to activate (e.g., the database is on a filesystem that does not support shared memory, or another connection holds an exclusive lock), the pragma silently falls back to another mode.
The function should verify that the returned value is `"wal"` and return an error if it is not.
This is important because the entire cross-process reactivity model depends on WAL mode being active.

> NOTE(opus/sprack-db-review): In practice, sprack runs on local ext4/btrfs in the devcontainer, so WAL failure is unlikely.
> But the defensive check costs nothing and prevents a confusing debugging session if WAL mode silently fails.

### SQL Schema

The schema is well-designed for the use case.
CASCADE deletes, TEXT timestamps, and TEXT ProcessStatus all have clear rationale.
The singleton heartbeat constraint (`CHECK (id = 1)`) is elegant.

**Non-blocking**: The `panes` table has no index on `(session_name, window_index)`.
While SQLite creates implicit indices for PRIMARY KEYs and UNIQUE constraints, the foreign key columns in `panes` are not indexed.
For the expected data volumes (dozens of panes) this is irrelevant, but it is worth noting for completeness.
If the dataset ever grew substantially, CASCADE deletes on `windows` would require a full scan of `panes`.

**Non-blocking**: The `sessions` table uses `updated_at TEXT NOT NULL`, but the proposal does not specify whether sprack-db or the caller is responsible for generating this timestamp.
The `write_tmux_state` function signature takes `sessions: Vec<Session>` (where `Session` has `updated_at: String`), suggesting the caller provides it.
This is fine but should be explicitly stated to avoid ambiguity about whether `write_tmux_state` sets `updated_at` itself.

### Data Types

Clean struct definitions that mirror the schema accurately.
`ProcessStatus` as a four-variant enum with `Display`/`FromStr` is the right approach.

**Non-blocking**: The types section does not mention whether structs implement `PartialEq` or `Eq`.
For the hash-based diff in sprack-poll (mentioned in the roadmap), the state types likely need `Eq` + `Hash` or at least `PartialEq`.
If sprack-poll computes its diff at the sprack-db type level, these derives should be specified here.
If the diff operates on raw tmux output strings before conversion to sprack-db types, this is irrelevant.

### Query Helpers: Write Operations

**Blocking concern (folded into Connection Management above)**: `write_tmux_state` performs DELETE-all + INSERT-all.
The document correctly notes that this cascades to integrations, which summarizers re-write on their next cycle.
However, this means there is a window (between the DELETE and the summarizer's next write) where the TUI reads a state with no integrations.
If the TUI renders during this window, integration data temporarily disappears and then reappears.
The proposal acknowledges this via the NOTE callout but does not address the user-visible flicker.

This is actually a design trade-off rather than a bug, but it should be explicitly acknowledged as an accepted consequence rather than just mentioned in passing.
Possible mitigations (not necessarily required for Phase 1):
- Preserve integration rows that match still-existing pane_ids during the write transaction.
- Two-phase write: insert new state, then delete stale sessions.

The `write_heartbeat` and `write_integration` upserts are clean and correct.

### Query Helpers: Read Operations

The `read_full_state` function runs four separate queries.
For the expected data volumes, this is fine.
The `check_data_version` usage is well-documented and correctly references the sqlite-watcher report.

**Non-blocking**: `read_full_state` uses `SELECT * FROM ...` syntax.
While this is acceptable for a proposal, the implementation should use explicit column lists to avoid breakage if schema evolution adds columns.
The TODO about `user_version` migrations at the end of the document reinforces this concern: if columns are added in a future schema version, `SELECT *` would return unexpected data to old struct mappings.

### Error Handling

The `SprackDbError` enum is minimal and appropriate.
The per-caller error handling strategies (log-and-retry for daemons, status bar warning for TUI) are well-considered.

No issues.

### Idempotent Schema Creation

The "no migration system" decision is well-justified by the ephemeral nature of the data.
The TODO for `user_version` is appropriate forward-looking commentary.

No issues.

### Relationship to Other Components

The Mermaid diagram and component table clearly show how sprack-db fits into the ecosystem.
The "sprack-db is the only crate that contains SQL" statement is a strong architectural invariant.

No issues.

### Test Plan

Comprehensive: 11 specific test cases covering schema creation, round-trips, cascades, upserts, cross-connection data_version, and edge cases.
The in-memory / tempfile isolation strategy is correct.

**Non-blocking**: The test plan does not include a test for WAL mode verification (ties to the blocking finding above).
A test that opens two connections and verifies concurrent read-during-write behavior would validate the WAL mode contract.

**Non-blocking**: No test for error paths (e.g., what happens when `write_integration` is called with a `pane_id` that does not exist in the `panes` table).
Given `PRAGMA foreign_keys = ON`, this should fail with a foreign key violation.
Test 11 covers this pattern for panes, but the same should apply to integrations.

### Related Documents

Well-linked to the parent roadmap, sibling proposals, and supporting reports.
The cross-reference table is complete.

No issues.

### Writing Conventions

The document follows sentence-per-line formatting, uses proper callout syntax with attribution, includes a BLUF, and uses Mermaid for the diagram.
No em-dashes or emojis detected.

One minor convention note: the document uses "e.g." frequently without surrounding commas in some places (e.g., `(e.g., "%42")`), but this is inconsistent rather than wrong, and is non-blocking.

## Verdict

**Revise.**

The proposal is high-quality and nearly implementation-ready.
One blocking issue (WAL mode verification) requires a small but important change.
The integration data flicker during `write_tmux_state` is a design trade-off that should be explicitly acknowledged, though it does not need to be solved in this proposal.

## Action Items

1. [blocking] Add WAL mode verification to `open_db`: after setting `PRAGMA journal_mode = WAL`, read the return value and return `SprackDbError` if it is not `"wal"`. This is the foundation of the cross-process architecture.
2. [non-blocking] Explicitly acknowledge the integration data flicker window during `write_tmux_state` as an accepted trade-off, or describe a mitigation strategy (e.g., preserving integration rows for still-valid pane_ids within the transaction).
3. [non-blocking] Clarify whether `PartialEq`/`Eq`/`Hash` derives are needed on the data types for sprack-poll's hash-based diff, or whether the diff operates on raw tmux output.
4. [non-blocking] Clarify timestamp responsibility: does `write_tmux_state` generate `updated_at`, or does the caller provide it?
5. [non-blocking] Add a WAL-mode concurrent read/write test to the test plan.
6. [non-blocking] Add a foreign key violation test for `write_integration` with a nonexistent `pane_id`.
