---
review_of: cdocs/proposals/2026-03-21-sprack-tmux-sidecar-tui.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T18:45:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [rereview_agent, architecture, sqlite, multi_process, schema_design, phasing]
---

# Review (Round 2): sprack tmux Sidecar TUI for Session and Process Management

## Summary Assessment

This proposal has been substantially revised since the round 1 review, replacing the single-binary direct-tmux-CLI architecture with a decoupled multi-process design centered on a shared SQLite database in WAL mode.
The revision addresses several round 1 action items (resolve performance, tmux user options as a data source, serde removal) and introduces significant new architecture: the poller/TUI/summarizer separation, `PRAGMA data_version` reactivity, SIGUSR1-driven updates from tmux hooks, and a concrete SQLite schema.
The most important concern is a gap in the SQLite schema for the multi-writer scenario: the `process_integrations` table allows only one integration per pane (single `pane_id` PRIMARY KEY), which precludes a pane from having both an nvim summary and a language server summary.
The phasing is reasonable but Phase 1 scope has grown compared to round 1 and now includes SQLite schema, a shared library crate, and `PRAGMA data_version` change detection alongside basic TUI rendering.

Verdict: **Accept** with non-blocking suggestions.

## Round 1 Action Item Disposition

Reviewing the nine non-blocking action items from the round 1 review:

1. **HostGroup.name derivation for multi-session hosts**: Not explicitly addressed. The proposal still says "the host group display name is the session name" (line 320). With multiple sessions under one host, which session name is used remains unclear.
2. **`resolve` performance in polling context**: Addressed. Summarizers are standalone binaries on their own intervals, not called inline during the TUI render loop. The performance concern dissolves with the decoupled architecture.
3. **Tmux pane-level user options as data source**: Addressed. The proposal includes `@claude_status` as the top-priority resolution strategy for Claude Code (line 440-442, 453-454) and calls it "the most robust integration channel."
4. **Tree rendering vs "Pane Current Command is Shell" reconciliation**: Partially addressed. Line 596 says "sprack should display the pane title as the primary label, with pane_current_command as a secondary indicator," but the tree mockup (lines 282-293) still shows `nvim [*]` which is a pane_current_command, not a title. The inconsistency persists.
5. **Remove serde/serde_json from Phase 1**: Addressed. Phase 1 dependencies list (line 649) no longer includes serde or serde_json.
6. **Error-path test items**: Not addressed. The test plan still has no error-condition items.
7. **Pane management as explicit non-goal**: Not addressed. The proposal does not state whether sprack is read-and-navigate only.
8. **Promote Open Question 1 (repo location) to decision**: Not addressed. Still an open question.
9. **Fix tmux return proposal status reference**: Partially addressed. Line 82 now says `status: implementation_ready`, but the tmux return proposal's actual frontmatter shows `status: implementation_wip`. The discrepancy persists.

## Section-by-Section Findings

### BLUF and Summary

The BLUF has grown to six sentences to accommodate the SQLite architecture description.
It effectively communicates the key architectural shift: decoupled binaries sharing a SQLite DB rather than a single binary polling tmux directly.
The mention of companion reports (sqlite-watcher analysis, tabby analysis) provides proper provenance for the design choices.

**Non-blocking:** The BLUF now has two separate evolutionary references (wezterm sidecar and tmux migration proposals).
These could be consolidated into one sentence or moved to the Background section, keeping the BLUF focused on what sprack is and how it works rather than its lineage.

### Architecture Overview

The Mermaid diagram clearly shows the three-component architecture with data flow directions.
The separation of concerns is clean: sprack-poll owns tmux reads and DB writes, the TUI owns DB reads and user interaction, summarizers own domain-specific enrichment.

The NOTE about sqlite-watcher not supporting cross-process detection is well-placed and references the companion report.
This is a significant finding that the proposal correctly incorporates.

The statement "Zero tmux CLI calls in the read path" (line 137) for the TUI is a strong architectural invariant that simplifies reasoning about TUI performance.

**No blocking issues.**

### SQLite Schema

The schema is well-structured with appropriate foreign keys and CASCADE deletes.
The use of `INSERT OR REPLACE` for the poller's full-state writes is pragmatic for a schema this small.

**Concern 1 (non-blocking, important):** The `process_integrations` table has `pane_id TEXT PRIMARY KEY`, meaning each pane can have at most one integration record.
This is fine for Phase 4 (one summarizer per pane), but it creates an architectural ceiling: if a pane runs nvim inside a tmux session that is also running a language server, only one summarizer can claim the pane.
Consider whether the primary key should be `(pane_id, kind)` instead of just `pane_id`, allowing multiple enrichments per pane.
The TUI would then need to decide how to display multiple integrations (e.g., show the highest-priority one, or concatenate summaries).
This is not blocking because Phase 4 targets single-summarizer-per-pane, but the schema is the hardest thing to change later.

**Concern 2 (non-blocking):** The `panes` table lacks a `pane_pid` column.
`pane_pid` is available from `tmux list-panes -F` and is used by summarizers to identify running processes.
Without it in the DB, summarizers must either re-query tmux or infer process identity from `current_command` alone.
Since summarizers are standalone binaries that could query tmux directly, this may be intentional, but storing `pane_pid` in the DB would allow summarizers to be fully DB-driven (no tmux CLI calls of their own for process matching).

**Concern 3 (non-blocking):** The `windows` table has no `updated_at` column, unlike `sessions`.
If future optimizations want to diff only changed windows, having a timestamp would help.
This is minor since the current design does full-table replacement on each poll cycle.

### Poller Design (sprack-poll)

The SIGUSR1 pattern borrowed from tabby is well-chosen.
The four tmux hooks (after-new-session, after-new-window, pane-exited, session-closed) cover the major structural events.

The `pkill -USR1 sprack-poll` approach is simple but has a subtle issue: if multiple instances of sprack-poll are running (e.g., user accidentally starts two), all instances receive the signal.
This is probably fine (redundant refreshes are harmless), but worth noting.

**Non-blocking:** The hook list omits `after-select-window`, `after-select-pane`, and `client-session-changed`.
These events change which pane/window/session is active, which affects the `active` flags in the schema.
Without hooks for these events, active-pane changes are detected only on the 1-second fallback poll.
If the TUI highlights the active pane, this creates visible lag when switching focus.
Consider adding `after-select-window` and `after-select-pane` to the hook list, or noting this as a Phase 2 refinement.

**Non-blocking:** The proposal mentions hash-based diff to skip no-op writes (line 220, in the tabby NOTE) but does not commit to implementing it.
If the poller writes all rows on every 1-second cycle regardless of changes, it triggers a `data_version` bump on every cycle, causing the TUI to re-read the full DB every second even when nothing changed.
The poller should either compare against previous state and skip the write when unchanged, or this should be called out as an acceptable trade-off for the current scope.

### TUI State Reading

The `PRAGMA data_version` polling at 50-100ms is well-justified by the companion report.
Step 5 of the render cycle (diff against previous tree to preserve UI state) is important and correctly identified.

**Non-blocking:** The proposal says `PRAGMA data_version` is "a single syscall" (line 368).
It is actually a SQLite pragma that internally reads from the shared memory region (wal-index in WAL mode).
It is fast (sub-microsecond) but not technically a single syscall.
This is a minor precision issue that does not affect the design.

### Sidecar Pane Lifecycle

The toggle keybinding script is well-constructed.
The round 1 suggestion about using `@sprack_pane` user option instead of `grep ":sprack$"` has not been incorporated, but the current approach works for standard deployments.

**No new issues beyond round 1.**

### Process Integration Architecture (Phase 4)

The shift from compiled-in traits to standalone summarizer binaries is a significant improvement over the round 1 design.
It correctly applies Unix philosophy: the DB schema is the contract, not a Rust trait.

The resolution priority for Claude Code (line 453-457) correctly places `@claude_status` tmux option first, addressing round 1 action item 3.

The WARN about pane content scraping fragility (lines 444-446) with the rate-limiting guidance (at most once per second per pane) is appropriate.

**Non-blocking:** The proposal describes summarizers as "repeating on a configurable interval or signal" (line 415) but does not specify who signals them.
sprack-poll receives SIGUSR1 from tmux hooks; do summarizers also listen for signals?
Or do they independently poll the DB for pane changes?
Clarifying the summarizer lifecycle (startup, polling strategy, shutdown) would strengthen the Phase 4 design.

### Important Design Decisions

Decision 1 (Decoupled Architecture via Shared SQLite) is well-reasoned.
The trade-off acknowledgment ("operational complexity: three processes instead of one") is honest.
The mitigation (launcher script) is noted but deferred.

Decision 6 (Summarizers as Standalone Binaries) provides strong rationale for the decoupling.
The point about being "written in any language" is valid since the contract is the SQLite schema.

**No issues.**

### Edge Cases

The edge cases section remains thorough from round 1 with no new gaps introduced by the architecture change.
The "Container Port Reuse After Restart" scenario (line 567) correctly identifies that `remain-on-exit` state reveals dead sessions.

**Non-blocking (carried from round 1):** The "Pane Current Command is Shell" edge case (line 592-596) still conflicts with the tree rendering mockup.
The mockup shows `nvim [*]` as a node label, which implies `pane_current_command` is the primary display.
The edge case section says pane title should be primary.
These should be reconciled.

### Test Plan

The test plan covers all four phases but still lacks error-condition items (carried from round 1).
Phase 4 test items (lines 632-638) reference "the process integration trait" (line 636) and "implementing the trait" (line 637), which is language from the old compiled-in-trait architecture.
These should be updated to reflect the standalone-binary model: "Adding a new integration requires only a new binary that writes to `process_integrations`" (which line 717 already says correctly in the Phase 4 success criteria).

**Non-blocking:** The test plan Phase 4 items are inconsistent with the proposed architecture.
Lines 636-637 describe a trait-based system, but the proposal describes standalone binaries.
Update test items to match.

### Implementation Phases

Phase 1 scope has grown compared to round 1.
It now includes: Cargo workspace with two binaries, shared library crate (`sprack-db`), SQLite schema, sprack-poll implementation, TUI with `PRAGMA data_version` detection, and basic navigation.
This is a substantial Phase 1, but each piece is necessary for the decoupled architecture to function at all.

**Non-blocking:** Phase 1 lists `tokio` as a dependency "for signal handling in poller" (line 649).
For a poller that sleeps and wakes on SIGUSR1, tokio may be heavier than needed.
The `signal-hook` crate provides SIGUSR1 handling without an async runtime.
If sprack-poll is synchronous (poll, write, sleep), tokio adds unnecessary complexity.
If async is needed for other reasons (e.g., concurrent tmux CLI calls), this is fine.

### Open Questions

The five open questions are well-chosen.
Question 3 (DB location) is particularly important for the multi-process architecture: all three processes must agree on the DB path.
`$XDG_RUNTIME_DIR/sprack/state.db` is the most appropriate choice since the data is ephemeral (tmux state is rebuilt on each server start).

Question 5 (launcher UX) directly addresses the operational complexity concern.
The "sprack auto-starts sprack-poll if not running" approach would reduce friction significantly.

**Non-blocking:** Question 5 should also consider whether `sprack` auto-starts summarizers, or whether summarizers are opt-in via configuration.
Auto-starting everything from `sprack` would collapse the three-process complexity into a single user-facing command.

## Architectural Assessment: Multi-Process Trade-offs

The decoupled architecture is the defining change in this revision and merits evaluation beyond individual sections.

**Strengths:**
- Clean separation of concerns with well-defined data flow.
- SQLite as the integration contract is language-agnostic and inspectable (any user can `sqlite3 state.db` to debug).
- WAL mode + `PRAGMA data_version` is the correct concurrency and change-detection pattern, as validated by the companion report.
- Summarizers as standalone binaries enable independent development and deployment.

**Risks:**
- Process coordination: three processes must agree on DB path, schema version, and lifecycle. No schema versioning mechanism is described.
- Startup ordering: the TUI must handle the case where the poller has not yet written any data. The schema creation should be idempotent across all three process types.
- Stale data: if sprack-poll crashes, the TUI continues displaying the last known state with no indication of staleness. Consider a heartbeat mechanism (e.g., a `poller_heartbeat` table or checking `sessions.updated_at` recency).
- WAL file growth: if sprack-poll writes frequently and the TUI holds long-running read transactions (during tree diff computation), the WAL file may grow. This is unlikely to be a practical issue given the small data volume.

## Verdict

**Accept.**

The decoupled SQLite architecture is a meaningful improvement over the round 1 single-binary design.
It correctly addresses the process integration composability problem and is well-supported by the companion research reports (sqlite-watcher analysis, tabby analysis).
The schema design is sound with one notable limitation (single integration per pane).
Most round 1 action items were addressed; the remaining ones are minor.

All findings are non-blocking.

## Action Items

1. [non-blocking, important] Consider changing `process_integrations` primary key from `pane_id` to `(pane_id, kind)` to allow multiple enrichments per pane. This is the hardest thing to change post-implementation.
2. [non-blocking] Add `after-select-window` and `after-select-pane` to the tmux hook list, or note that active-pane changes are delayed by up to 1 second. This affects the active-pane highlighting feature.
3. [non-blocking] Clarify whether sprack-poll implements hash-based diff to skip no-op writes. Without it, every 1-second poll triggers a `data_version` bump and TUI re-read regardless of actual changes.
4. [non-blocking] Update test plan Phase 4 items (lines 636-637) to match the standalone-binary architecture instead of the old trait-based model.
5. [non-blocking, carried] Reconcile the tree rendering mockup with the "Pane Current Command is Shell" edge case. Clarify primary display label.
6. [non-blocking, carried] Add 1-2 error-path test items (tmux command failure, poller crash detection, race between render and navigation).
7. [non-blocking, carried] Clarify `HostGroup.name` derivation when multiple sessions share the same `@lace_port`.
8. [non-blocking] Consider adding `pane_pid` to the `panes` schema so summarizers can be fully DB-driven without independent tmux CLI calls.
9. [non-blocking] Clarify summarizer lifecycle: how are they started, what triggers their poll cycles, and who manages their shutdown.
10. [non-blocking] Consider a staleness detection mechanism for when sprack-poll crashes (heartbeat timestamp check, or age-of-data indicator in the TUI).
11. [non-blocking] Fix tmux return proposal status reference: document says `implementation_ready` (line 82), actual frontmatter shows `implementation_wip`.
12. [non-blocking] Evaluate whether tokio is necessary for sprack-poll, or whether `signal-hook` would be a lighter dependency for SIGUSR1 handling.

## Questions for the Author

1. **Schema versioning**: When the schema evolves (e.g., adding `pane_pid` or changing the `process_integrations` key), how do the three processes coordinate? Options:
   a. A `schema_version` table checked at startup, with migration logic in `sprack-db`.
   b. All processes unconditionally `CREATE TABLE IF NOT EXISTS` and the schema is additive-only.
   c. The DB is ephemeral and rebuilt on each sprack-poll start.

2. **Summarizer auto-discovery**: Should `sprack` auto-detect and launch summarizer binaries (e.g., scan PATH for `sprack-*` binaries), or should summarizers be explicitly configured in `config.toml`? Auto-discovery is more ergonomic; explicit configuration is more predictable.
