---
review_of: cdocs/proposals/2026-03-24-sprack-inline-summaries.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T16:30:00-07:00
task_list: terminal-management/sprack-inline-summaries
type: review
state: live
status: done
tags: [fresh_agent, architecture, ux_design, code_accuracy, sprack]
---

# Review: sprack Inline Summaries

## Summary Assessment

This proposal redesigns the sprack TUI to surface `ClaudeSummary` fields inline with tree node labels at each layout tier, eliminating the detail pane at Compact/Standard/Wide tiers.
The overall quality is high: the phased approach is sound, the per-tier format strings are concrete and verifiable, the test plan is thorough, and the WARN callout about the hardcoded `LayoutTier::Standard` in `refresh_from_db` correctly identifies a real bug in the current code.
The most important finding is that the proposal references a `Complete` status in multiple tables and the status priority list, but `sprack-claude`'s `summary_to_process_status` never produces `Complete`: no code path maps any `ClaudeSummary.state` value to `ProcessStatus::Complete`.
Verdict: **Revise** - two blocking issues and several non-blocking suggestions.

## Section-by-Section Findings

### BLUF

Clear and informative.
Covers all three phases with appropriate detail.
No issues.

### Objective

Well-framed.
The `ClaudeSummary` field list matches the actual struct in `sprack-claude/src/status.rs`: `state`, `model`, `subagent_count`, `context_percent`, `last_tool`, `error_message`, `last_activity`.
No issues.

### Design: Per-Tier Format Strings

**Compact**: Correctly described as no change from current behavior. Verified against `tree.rs` lines 292-304.

**Standard**: The character budget analysis (12 + 1 + 10 + 1 + 10 = ~34 chars) is reasonable, but does not account for tree indentation.
The proposal mentions "typically 4-8 chars deep" in passing, which would push worst-case to ~42 chars in a 30-col terminal: potentially tight but not blocking since tree depth beyond 2 levels is rare in practice.
**Non-blocking**: Consider noting that the suffix should be omitted entirely when remaining width after indentation drops below a threshold.

**Wide**: The proposal states the detail pane is removed at wide tier.
This is a significant UX change.
The format string includes `{title:20} ({process_name}) {status_badge} {subagent_count}ag {context_percent}% ctx` at ~55 chars, which fits the 60-99 col range.
This is well-considered.

**Full**: The example on line 101 (`editor session        (claude) [tool] Read       42% ctx Edit`) shows both `last_tool` and `Edit` at the end.
It is unclear what the trailing `Edit` represents: if it is a second tool name, the format string on line 95 does not explain how multiple tools are rendered.
**Non-blocking**: Clarify the Full tier example on line 101 or remove the trailing `Edit` if it is erroneous.

### Inline Suffix Format

The table is clear and actionable.
However, it references both `Waiting` and `Complete` as statuses with empty suffixes.

**Blocking**: The `Complete` status is never produced by `sprack-claude`'s `summary_to_process_status()`.
That function maps `"thinking"`, `"tool_use"`, `"idle"`, `"waiting"`, and `"error"`, but not `"complete"`.
The `ProcessStatus::Complete` variant exists in the enum but is not reachable from Claude Code integration data.
The proposal should either: (a) acknowledge that `Complete` is not currently produced and treat it as future-proofing, or (b) remove it from the tables and status priority list to avoid confusion during implementation.

### Detail Pane Redesign

Well-structured.
The proposed `body_layout` code change correctly implements the intended behavior: only Full tier gets the detail split.
The minimum tree width increase from 25 to 40 at Full tier is reasonable given the longer inline suffixes.

### Staleness Indicators

The 10-second threshold aligned with the 2-3 second poll interval is well-reasoned.
The edge case handling (no integration = no suffix) is correct.

The proposal reuses the `process_complete` style for staleness, which is conceptually sound.
However, the document says "only the metadata suffix dims" while the status badge retains color.
This requires splitting the suffix into separate `Span`s with independent styles, which the proposal does describe in the implementation section (`format_inline_suffix` returns `Vec<Span<'static>>`).
No issues.

### Node Type Aggregation

**Blocking**: The status priority list (line 195) reads "Error, Thinking, ToolUse, Waiting, Idle, Complete."
This ordering places Waiting above Idle, which conflicts with the existing code's semantics: `Idle` means "model has responded and is awaiting user decision," while `Waiting` means "user message sent, awaiting model response."
In practice, `Waiting` is a more transient/active state than `Idle`.
The priority question matters because it determines the color of the aggregated window/session count.

The proposed `(active_count, total_count)` definition counts panes with "non-idle, non-complete integrations" as active.
This means `Waiting` counts as active, which makes semantic sense.
But `Idle` does not count as active, meaning a pane where Claude has finished responding and the user is reading output is "inactive."
This seems correct for the aggregation use case but should be explicitly stated rather than implied.

**Non-blocking**: Add a one-line definition of "active" to the aggregation section for clarity.

### Widget Evaluation Plan (Phase 2)

The test matrix is thorough and the success/failure criteria are clear.
The timeline estimate of 1-2 hours is reasonable for a standalone harness.
No issues.

### Implementation Phases

**Phase 1** items 1-8 are well-specified.
Item 1 correctly identifies the dependency question (import `ClaudeSummary` from `sprack-claude` vs. re-export from `sprack-db`).
The WARN callout about the hardcoded tier is accurate: verified at `app.rs` line 136.

Item 8 proposes storing `last_tier` in `App` and rebuilding on tier transitions.
This is the right approach but introduces a subtle bug risk: if the snapshot is cached but the integration data has changed since the last DB refresh, rebuilding tree items from the stale snapshot could show outdated information.
**Non-blocking**: Note that tier-transition rebuilds use the cached snapshot and therefore do not re-fetch from DB. This is acceptable because the next DB change will trigger a full refresh, but it should be documented as a known trade-off.

**Phase 2** is appropriately scoped as a gate.

**Phase 3** is correctly deferred with the right rationale.

### Rendering Changes

The function signatures are consistent with the existing codebase.
The modification list for `tree.rs`, `render.rs`, and `layout.rs` is comprehensive.
No missing functions identified.

### Test Plan

The 14 test items cover the key scenarios.
The unit tests for parsing, formatting, aggregation, and staleness are well-specified.
The manual integration test items are appropriate for a TUI that cannot be easily automated.

**Non-blocking**: Consider adding a unit test for the tier-transition rebuild path: verify that changing the tier regenerates labels with the correct format.

### Open Risks

Risk 1 (JSON parsing overhead) is correctly dismissed.
Risk 2 (tier mismatch) is the most important and is already addressed by the Phase 1 plan.
Risk 3 (schema evolution) correctly identifies the re-export approach as the preferred solution.
Risk 4 (timestamp parsing) proposes a minimal manual parser, which is pragmatic.
Risk 5 (Phase 3 deferred) is correctly framed.

No issues.

## Verdict

**Revise**.
Two blocking items must be addressed before this proposal is implementation-ready.

## Action Items

1. [blocking] Reconcile the `Complete` status references. `ProcessStatus::Complete` exists in the enum but `sprack-claude` never produces it. Either: (a) add a clarifying NOTE that `Complete` is included for future-proofing and is not currently reachable, or (b) remove it from the inline suffix table (lines 121-122), the status priority list (line 195), and the aggregation active/inactive definition.
2. [blocking] Clarify what "active" means in the aggregation section (line 191). The current text says "non-idle, non-complete integrations" are active, but the status priority list also includes Waiting above Idle. State explicitly which statuses count as active and which as inactive, and why.
3. [non-blocking] Clarify or fix the Full tier example on line 101: the trailing `Edit` after `42% ctx` is not explained by the format string on line 95.
4. [non-blocking] Add a note that the suffix should be omitted (or truncated further) when available width after tree indentation drops below a minimum threshold at Standard tier, to avoid rendering artifacts in deeply nested trees.
5. [non-blocking] Document the trade-off that tier-transition rebuilds use the cached DB snapshot, not a fresh query.
6. [non-blocking] Consider adding a unit test for tier-transition label regeneration.
