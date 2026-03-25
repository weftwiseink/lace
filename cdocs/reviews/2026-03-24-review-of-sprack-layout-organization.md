---
review_of: cdocs/proposals/2026-03-24-sprack-layout-organization.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T16:30:00-07:00
task_list: terminal-management/sprack-layout-organization
type: review
state: live
status: done
tags: [fresh_agent, architecture, sprack, schema_migration, test_plan]
---

# Review: sprack Layout Organization

## Summary Assessment

This proposal addresses spatial ordering of panes and richer metadata display in the sprack TUI.
The overall quality is high: the design decisions are well-reasoned, alternatives are analyzed with clear rationale for rejection, the implementation phases are sequenced correctly, and the proposal is grounded in the actual codebase.
The most important finding is that the proposal has a gap between the `SprackDbError` enum and the proposed `UnsupportedSchemaVersion` variant, and the `ORDER BY` sort should happen at the DB query level in `read_panes` rather than (or in addition to) in-memory in `tree.rs`.

**Verdict: Revise** - two blocking issues and several non-blocking improvements.

## Section-by-Section Findings

### BLUF

Well-constructed.
Covers the three key changes (sort, format string, schema migration) and explicitly scopes out what this is _not_ (overlap grouping, layout parsing).
No issues.

### Objective

Clear and concise. No issues.

### Design Decisions: Spatial Sorting

The `(pane_top, pane_left)` sort is the right call.
The analysis of why overlap-based grouping and layout parsing are unnecessary is thorough and convincing.
The edge case discussion (tall left pane) is honest about the limitation and correctly identifies reading-order as the defensible default.

One observation: the proposal says sorting happens "in `tree.rs` when building pane items for a window" (Spatial Sorting Algorithm section), but the current `read_panes` in `read.rs` already has `ORDER BY session_name, window_index, pane_id`.
**[Non-blocking]** The sort should be applied at the DB query level (`ORDER BY pane_top, pane_left` in `read_panes`) rather than as an in-memory sort in `tree.rs`.
This is more efficient and ensures consistent ordering regardless of where panes are read.
The in-memory sort in `tree.rs` is a viable fallback, but the DB query is the natural home for this.

### Design Decisions: DB Migration

The `user_version` pragma approach is sound for an ephemeral database.
Drop-and-recreate for v0-to-v1 is the right choice given that sprack-db is rebuilt every poll cycle.

**[Blocking]** The proposal introduces `SprackDbError::UnsupportedSchemaVersion(i32)` in the migration logic pseudocode, but this variant does not exist in the current `SprackDbError` enum (which only has `Sqlite`, `Io`, `InvalidStatus`, and `WalActivationFailed`).
The proposal should explicitly note this as a required type change in the "Type Changes" section or the implementation phases.

### Design Decisions: Backward Compatibility

The clean-break rationale is correct for a monorepo binary.
No issues.

### Design Decisions: Performance

The analysis is accurate.
Subprocess spawn dominates, and the additional parsing/DB work is trivially cheap.
No issues.

### Format String Extension

The field table is clear and the index assignments are correct.
The NOTE about `window_layout` deduplication is appropriate.

**[Non-blocking]** The proposal omits `window_zoomed_flag`, which the companion report (section 3) identified as relevant for window metadata display, and which the Metadata Display section references (`[Z]` flag for zoomed windows).
Either add `window_zoomed_flag` to the format string (field 19, bumping to 20 fields), or clarify that zoom status will be derived from a different source or deferred to a follow-up.

### Schema Changes

The ALTER statements and full schema SQL are internally consistent.
The migration logic is well-structured.

**[Non-blocking]** The proposal uses `IF NOT EXISTS` in the full schema SQL but the migration logic does `DROP TABLE IF EXISTS` before `execute_batch(SCHEMA_SQL)` for version 0.
This is correct behavior (the `IF NOT EXISTS` is harmless after a drop), but worth noting that the `IF NOT EXISTS` clauses are only relevant for the version 1 no-op path where tables already exist.

### Spatial Sorting Algorithm

The Rust pseudocode is correct.
The sort examples are helpful and cover the important cases.

**[Non-blocking]** The NOTE about `Option::None` sorting to the beginning is a subtle correctness point.
In practice this means panes with missing coordinates would appear _before_ all spatially-positioned panes, which is acceptable.
Consider whether `None` coordinates should instead sort to the _end_ (after all positioned panes) to avoid confusing interleaving.
This is minor since the proposal correctly states it should not occur in practice.

### Metadata Display

The tier-based display tables are well-structured and the progression from Compact to Full is sensible.

**[Blocking]** The "Pane Node Display by Tier" table shows `{icon}` at Compact tier, but the field names do not correspond to anything in the proposed schema.
The current `tree.rs` code uses integration status for icons.
The proposal should clarify: is `{icon}` derived from the integration status (existing behavior) or from a new field?
The Standard tier shows `{badge}` which maps to integration status, but the Compact tier's `{icon}` appears to be a different rendering of the same data.
If so, this is just existing behavior with a different label in the table - but the table should use consistent terminology or clarify the mapping.

Additionally, the Standard tier format shows `{command} [{dims}] {badge}`, but the current Standard tier in `tree.rs` shows `{command} {badge}` (no dimensions).
The proposal is changing the Standard tier display, which is fine, but the Compact tier currently shows `{icon} {command}` which is the _existing_ format.
The tables mix existing behavior with proposed changes without distinguishing them.
Clarify which tiers are changing and which are unchanged.

### Type Changes

The `sprack-poll` and `sprack-db` type definitions are correct and internally consistent.
The NOTE about `Option<u32>` vs `bool` rationale is good.

**[Non-blocking]** The `TmuxWindow` struct in the Type Changes section shows `window_index: u32`, which matches the current code.
The `Window` DB type shows `window_index: i32`.
This mismatch exists in the current code (the `to_db_types` function casts `u32 as i32`), so it is not introduced by this proposal, but it is worth noting as a pre-existing concern.

### Implementation Phases

The three-phase approach is correctly sequenced: data pipeline first, then sorting, then display.
The task breakdown is granular enough to track progress.

**[Non-blocking]** Phase 1 step 7 says "Implement `user_version` check in `init_schema`."
The current `init_schema` is a simple `conn.execute_batch(SCHEMA_SQL)` call.
The proposal should note that the function signature may need to change if the new error variant requires updating the return type (though `SprackDbError` already wraps rusqlite errors, so the `pragma_query_value` call should work with the existing signature once the new variant is added).

### Test Plan

Comprehensive.
The unit tests cover parsing, sorting, migration, and label formatting.
The integration tests cover round-trip and sort-after-read.
Manual verification is appropriately scoped.

**[Non-blocking]** Consider adding a test case for the migration path where `user_version` is a future unknown version (e.g., version 99).
The proposal's pseudocode handles this with `UnsupportedSchemaVersion(other)`, but having an explicit test for this path would be valuable.
The test plan mentions "unknown version (error)" under schema migration, which covers this - confirm it maps to a specific test.

### Open Risks

The four risks are well-identified.
Risk 1 (`window_layout` containing `||`) is correctly assessed as low.
Risk 2 (tmux version) is real and should be addressed: document the minimum tmux version.
Risk 3 (user expectations) is inherent and acknowledged.
Risk 4 (schema version error UX) is actionable and should be addressed in implementation.

No issues with the risk section itself.

### Writing Convention Compliance

The document follows sentence-per-line formatting, uses BLUF, uses NOTE callouts with proper attribution, and avoids emojis.
One minor deviation: line 35 is a long multi-clause sentence that could be split for clarity, but this is not blocking.

## Verdict

**Revise.** Two blocking issues must be addressed:

1. The `SprackDbError::UnsupportedSchemaVersion` variant is used in pseudocode but not declared as a required type change.
2. The Metadata Display tier tables mix existing behavior with proposed changes and use inconsistent terminology (`{icon}` vs `{badge}`).

## Action Items

1. [blocking] Add `UnsupportedSchemaVersion(i32)` to the `SprackDbError` enum in the Type Changes section, or add a dedicated subsection noting this required error variant addition.
2. [blocking] Clarify the Metadata Display pane tier tables: distinguish which tiers are changing vs. preserving existing behavior, and use consistent terminology for integration-derived status indicators.
3. [non-blocking] Consider moving the spatial sort from in-memory (`tree.rs`) to the DB query level (`read_panes` ORDER BY clause), or document why in-memory sorting is preferred.
4. [non-blocking] Address the `window_zoomed_flag` gap: either add it to the format string or note it as deferred. The Window metadata display references `[Z]` for zoomed panes but the data source is not captured.
5. [non-blocking] Consider whether `None` spatial coordinates should sort to end rather than beginning.
6. [non-blocking] Note the pre-existing `u32`/`i32` window_index mismatch between poll and DB types as a known concern.
