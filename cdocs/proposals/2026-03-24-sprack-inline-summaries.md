---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T15:30:00-07:00
task_list: terminal-management/sprack-inline-summaries
type: proposal
state: live
status: wip
tags: [sprack, tui, ratatui, layout, ux_design]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T16:30:00-07:00
  round: 1
---

# sprack Inline Summaries

> BLUF(opus/sprack-inline-summaries): Redesign the sprack TUI to show rich multi-line Claude widget dashboards inline with tree nodes instead of in a separate detail panel.
> Each Claude pane renders as a 3-5 line widget: status + context on line 1, task progress on line 2, tool stats on line 3, session purpose on line 4.
> Multi-line `TreeItem` support in `tui-tree-widget` v0.22 is confirmed to work, so the implementation proceeds directly to multi-line rendering.
> Lines 2-4 depend on hook event bridge data (Phase 1.5 of the phasing plan): when hooks are not configured, panes fall back to single-line inline suffixes.
> The detail pane is removed at compact/standard/wide tiers and retained only at full tier as a supplemental expansion for debugging metadata.

## Objective

Every pane with a process integration (Claude Code, future nvim/cargo integrations) displays its status summary directly in the tree node label.
The user never needs to select a node or shift attention to a separate panel to see basic activity state.

The `ClaudeSummary` struct provides: `state`, `model`, `subagent_count`, `context_percent`, `last_tool`, `error_message`, `last_activity`.
The inline summary surfaces the most operationally relevant subset at each layout tier.

## Design: Per-Tier Format Strings

Each tier has a concrete format string defining what appears after the process name.
The `Integration.summary` field contains JSON-serialized `ClaudeSummary` data, which the TUI parses to extract structured fields.

### Compact (<30 cols)

```
{icon} {process_name:15}
```

Example: `* claude` (where `*` = thinking).

No change from the current behavior.
The single-character icon already communicates status at a glance.
No room for additional metadata.

### Standard (30-59 cols)

```
{process_name:12} {status_badge} {summary_suffix}
```

Where `summary_suffix` is tier-aware and budget-constrained to ~10-15 characters:
- Thinking: `{subagent_count}ag {context_percent}%` (e.g., `3ag 42%`)
- Tool use: `{last_tool:8}` (e.g., `Read`, `Edit`)
- Idle: `{context_percent}%` (e.g., `42%`)
- Error: `err` (truncated; detail requires selection)
- Waiting/Complete: empty suffix

Examples:
```
claude       [thinking] 3ag 42%
claude       [tool] Edit
nu           [idle]
claude       [error] err
```

Character budget: ~12 (name) + 1 (space) + ~10 (badge) + 1 (space) + ~10 (suffix) = ~34 chars, fitting within the 30-59 col range after tree indentation (typically 4-8 chars deep).
When available width after indentation drops below 20 characters, the suffix is omitted entirely: only the status badge is shown.

### Wide (60-99 cols)

```
{title:20} ({process_name}) {status_badge} {subagent_count}ag {context_percent}% ctx
```

When in tool use, replace `{subagent_count}ag` with `{last_tool:10}`:
```
{title:20} ({process_name}) [tool] {last_tool:10} {context_percent}% ctx
```

Examples:
```
editor session   (claude) [thinking] 3ag 42% ctx
editor session   (claude) [tool] Read       42% ctx
shell            (nu) [idle]
```

Character budget: ~20 (title) + ~10 (process) + ~10 (badge) + ~15 (metadata) = ~55 chars.
This fills the full tree area width without a detail pane.

> NOTE(opus/sprack-inline-summaries): The detail pane is removed at wide tier.
> The `body_layout` function changes: only Full tier gets the detail split.

### Full (100+ cols)

```
{title:25} ({process_name}) {status_badge} {subagent_count}ag {context_percent}% ctx {last_tool:10}
```

Examples:
```
editor session        (claude) [thinking] 3ag 42% ctx
editor session        (claude) [tool] Read       42% ctx
```

At full tier, the tree occupies the left portion and the detail pane occupies the right.
The detail pane shows supplemental information for the selected node: model name, `updated_at` timestamp, error messages, full tool history.

## Inline Suffix Format

The suffix is built from parsed `ClaudeSummary` JSON.
A new function `parse_claude_summary` in `tree.rs` deserializes the `Integration.summary` field and returns an `Option<ClaudeSummary>`.
If parsing fails (non-Claude integration, empty summary, malformed JSON), no suffix is appended beyond the existing status badge.

Format string construction per status (single-line mode, used at compact/standard tiers and as wide/full fallback when hook data is absent):

| Status | Standard suffix | Wide/Full suffix |
|--------|----------------|-----------------|
| Thinking | `{n}ag {p}%` | `{n}ag {p}% ctx` |
| ToolUse | `{tool:8}` | `{tool:10} {p}% ctx` |
| Idle | `{p}%` | `{p}% ctx` |
| Error | `err` | `err: {msg:20}` |
| Waiting | (empty) | (empty) |
| Complete | (empty) | (empty) |

Multi-line widget format (wide/full tiers when hook data is present):

| Line | Format | Rendered When |
|------|--------|--------------|
| 1 | `{process_name} {status_badge} {p}% ctx {n}ag` | Always |
| 2 | `Tasks: {done}/{total} done {markers}` | `tasks` field is `Some` and non-empty |
| 3 | `R:{r} E:{e} B:{b} \| {turns}t \| {model_short}` | `tool_counts` or `user_turns` is `Some` |
| 4 | `{session_purpose_or_title}` | `session_purpose` or custom title is `Some` |

> NOTE(opus/sprack-inline-summaries): `ProcessStatus::Complete` exists in the enum but is not currently produced by `sprack-claude`'s `summary_to_process_status()`.
> It is included here for forward-compatibility: future integrations or a session-end detection feature may produce this status.
> The implementation handles it as a no-op (empty suffix, dim styling) so no special code path is required.

Where `n` = `subagent_count` (omitted when 0), `p` = `context_percent`, `tool` = `last_tool`, `msg` = `error_message`.

When `subagent_count` is 0, the `{n}ag` portion is omitted entirely, not shown as `0ag`.

### Future Fields from Session Cache and Hook Event Bridge

> NOTE(opus/sprack-inline-summaries): The [session cache proposal](2026-03-24-sprack-claude-incremental-session-cache.md) adds `user_turns`, `assistant_turns`, `tool_counts`, and `context_trend` to `ClaudeSummary`.
> The [hook event bridge](2026-03-24-sprack-iteration-phasing-plan.md) (Phase 1.5) adds `tasks`, `session_summary`, and `session_purpose`.
> When these fields become available, the single-line format strings extend as follows:
> - Wide/Full: append `{turns}t` after context percentage (e.g., `42% ctx 15t`).
> - Wide/Full: append top tool counts when space permits (e.g., `R:47 E:12`).
> - All tiers: context trend indicator as a directional suffix on context percentage (e.g., `42%^` rising, `42%v` falling, `42%-` stable).
> At wide/full tiers, when hook data is available, the pane expands to a multi-line widget (see "Rich Claude Widget" section).
> All extended fields are rendered only when the corresponding `Option` fields are `Some`; absence produces no visual change.

## Rich Claude Widget

When hook event bridge data (Phase 1.5) is available, pane items expand to a multi-line widget showing a dense operational dashboard.
Multi-line `TreeItem` in `tui-tree-widget` v0.22 is confirmed to work: selection highlights all lines, scrolling accounts for variable-height items, and mouse click targeting maps correctly.

### Widget Layout

Each Claude pane renders 3-5 lines depending on data availability:

```
Line 1: {process_name} {status_badge} {context_percent}% ctx {subagent_count}ag
Line 2: Tasks: {done}/{total} done {task_status_summary}
Line 3: R:{read_count} E:{edit_count} B:{bash_count} | {turn_count}t | {model_short}
Line 4: {session_purpose_or_title}
```

Examples at wide tier:

```
claude       [thinking] 42% ctx 3ag
  Tasks: 2/4 done  Draft  Review >Cross-coh
  R:29 E:4 B:11 | 81t | opus-4-6
  Implementing inline summaries for sprack TUI
```

```
claude       [tool] Edit 67% ctx
  Tasks: 3/3 done  Refactor  Tests  Docs
  R:14 E:9 B:3 | 42t | opus-4-6
  Verifiability infrastructure cleanup
```

When hook data is not available (hooks not configured or no events yet), the widget falls back to a single-line inline suffix:

```
claude       [thinking] 3ag 42%
```

### Per-Line Data Sources

| Line | Content | Data Source | Fallback |
|------|---------|------------|----------|
| 1 | Status, context %, subagent count | JSONL tail-reader (current) | Always available |
| 2 | Task list progress summary | Hook: `TaskCompleted`, `PostToolUse` on TaskCreate/TaskUpdate | Omitted |
| 3 | Tool usage stats, turn count, model | Hook: `PostToolUse` counts + JSONL: model, turns | Omitted (or partial from JSONL) |
| 4 | Session purpose or custom title | Hook: `PostCompact` summary or `SessionStart` + JSONL: custom title | Omitted |

Lines 2-4 render only when the corresponding `ClaudeSummary` fields are populated.
When all optional lines are absent, the widget is a single line: identical to the current inline suffix behavior.

### Tier-Specific Widget Rendering

| Tier | Lines Rendered | Notes |
|------|---------------|-------|
| Compact (<30 cols) | 1 only (icon + name) | No room for multi-line |
| Standard (30-59 cols) | 1 only (name + badge + suffix) | Multi-line would overflow |
| Wide (60-99 cols) | 1-4 (all available lines) | Full widget when hook data present |
| Full (100+ cols) | 1-4 (all available lines) | Detail pane supplements |

At compact and standard tiers, the widget is always single-line regardless of data availability.
Multi-line rendering activates at wide and full tiers when hook data is present.

### Task Status Summary Format

The task progress on line 2 uses a compact notation:

```
Tasks: {done}/{total} done {completed_markers} {current_marker}
```

Where completed tasks show as checked names and the current in-progress task is prefixed with `>`:

```
Tasks: 2/4 done  Draft  Review >Cross-coh
```

Task names are truncated to fit the available width.
When no task list exists (hook data absent or no tasks created), line 2 is omitted entirely.

### Tool Stats Format

Line 3 shows abbreviated tool counts, total turn count, and model shortname:

```
R:{read} E:{edit} B:{bash} | {turns}t | {model_short}
```

Tool counts track Read, Edit, and Bash (the three most operationally relevant tools).
Other tools are omitted from the summary to keep it compact.
The model shortname is derived from the full model string (e.g., `claude-opus-4-6` becomes `opus-4-6`).

When tool count data is unavailable, line 3 shows only turn count and model (from JSONL data) or is omitted entirely.

## Detail Pane Redesign

The detail pane role changes from "primary status display" to "supplemental debugging view."

**Compact, Standard, Wide tiers**: No detail pane.
The tree occupies the full body area.
All essential status is inline.

**Full tier (100+ cols)**: Detail pane retained.
Shows expanded information for the selected pane node:
- Integration kind and full status text.
- Model name (e.g., `claude-opus-4-6`).
- Full error message (untruncated).
- `updated_at` timestamp.
- Future: token counts, conversation turn count, tool call history.

The `body_layout` function changes:

```rust
pub fn body_layout(area: Rect, tier: LayoutTier) -> (Rect, Option<Rect>) {
    match tier {
        LayoutTier::Compact | LayoutTier::Standard | LayoutTier::Wide => (area, None),
        LayoutTier::Full => {
            let [tree, detail] =
                Layout::horizontal([Constraint::Min(40), Constraint::Fill(1)]).areas(area);
            (tree, Some(detail))
        }
    }
}
```

> NOTE(opus/sprack-inline-summaries): The minimum tree width increases from 25 to 40 at Full tier.
> This accommodates the longer inline suffixes.

## Staleness Indicators

Inline summaries reflect the last `Integration.updated_at` timestamp.
If the sprack-claude daemon is slow, crashes, or stops, summaries become stale.

**Visual treatment**: Apply `Modifier::DIM` to the entire suffix when the integration's `updated_at` is older than 10 seconds.

Implementation:
1. Parse `Integration.updated_at` as an ISO 8601 timestamp.
2. Compare against `std::time::SystemTime::now()` (converting via `chrono` or manual parsing).
3. If the delta exceeds 10 seconds, apply dimmed styling to the suffix spans.

This reuses the existing `process_complete` style (dim overlay0) as the staleness indicator, avoiding new theme entries.
The status badge retains its color; only the metadata suffix dims.

> NOTE(opus/sprack-inline-summaries): The 10-second threshold aligns with the sprack-claude poll interval (2-3 seconds).
> A healthy system never shows dimmed suffixes.
> A stale suffix tells the user "this data may be outdated" without alarming them.

**Edge case**: When the poller is not running at all, the integration row may not exist.
No suffix is rendered in this case (no integration = no summary), which is the correct behavior.

## Node Type Aggregation

Session and window nodes show aggregate status summaries for their descendant panes.

### Window nodes

Format: `{window_name} ({active_count}/{total_count})` where `active_count` is panes with active integrations.

**Active statuses**: Thinking, ToolUse, Waiting, Error.
These represent panes where work is in progress or attention is needed.

**Inactive statuses**: Idle, Complete.
Idle means the model has responded and the user has not sent a new message.
Complete means the session has ended.

When any descendant pane is in an error state, the window label adds a styled `!` indicator.
When any descendant is thinking or in tool use, the window label inherits the highest-priority status color for its count.

Status priority for color inheritance (highest to lowest): Error, Thinking, ToolUse, Waiting, Idle, Complete.

Example:
```
editor (2/3)          # 2 of 3 panes are active
logs (0/2)            # all panes idle
```

### Session nodes

Format: `{session_name} ({active_count}/{total_count} panes)`.

Same aggregation logic as windows, rolled up across all descendant panes.

Example:
```
lace (4/7 panes)      # 4 active across all windows
```

> NOTE(opus/sprack-inline-summaries): Aggregation counts require iterating descendant integrations during tree construction.
> This is a data-plumbing change in `build_window_item` and `build_session_item`, not a widget change.
> The integration list is already available in the `DbSnapshot`.

### Host group nodes

No aggregation.
Host groups are structural containers and adding counts would create visual noise at the top level.

## Multi-Line TreeItem: Confirmed Working

> NOTE(opus/sprack-inline-summaries): Multi-line `TreeItem` support in `tui-tree-widget` v0.22 has been confirmed to work architecturally.
> Selection highlighting covers all lines, scrolling accounts for variable-height items, and mouse click targeting maps correctly.
> This was the prerequisite evaluation gate: it is now a verification step rather than a blocker.

### Verification Checklist

A brief verification during Phase 2A implementation confirms the following behaviors in the sprack context:

1. **Mixed single-line and multi-line items**: Non-Claude panes (single-line) coexist with Claude panes (3-5 lines) without layout issues.
2. **Collapsed parent with multi-line children**: Collapsing a window hides all lines of child pane widgets.
3. **Deep nesting with multi-line**: Four-level tree indentation (host > session > window > pane) with multi-line leaf items renders correctly.
4. **Scrolling with variable heights**: Scrolling through a mix of single-line and multi-line items positions items without overlap or gaps.
5. **Performance**: No measurable degradation with 20+ multi-line pane items (typical lace deployment).

## Implementation Phases

### Phase 1: Multi-Line Rich Claude Widget

**Goal**: Surface `ClaudeSummary` fields as multi-line pane widgets at wide/full tiers, with single-line inline suffixes at compact/standard tiers.

**Dependency**: Phase 1.5 (hook event bridge) of the [phasing plan](2026-03-24-sprack-iteration-phasing-plan.md) provides the task list, session summary, and tool count data that populate lines 2-4 of the widget.
Without Phase 1.5, this phase still delivers single-line inline suffixes (line 1 only) using existing JSONL data.

**Changes**:

1. **`tree.rs`**: Add `parse_claude_summary()` function.
   Deserialize `Integration.summary` as `ClaudeSummary` JSON.
   Add `serde` and `serde_json` as dependencies to the `sprack` crate (they are already dependencies of `sprack-claude`, but the TUI crate needs them directly, or re-export `ClaudeSummary` from `sprack-db`).

2. **`tree.rs`**: Modify `build_pane_item()` to construct multi-line `TreeItem`.
   At wide/full tiers, when hook data is available, build a `Text` with 3-5 `Line`s:
   - Line 1: process name, status badge, context %, subagent count (same as current inline suffix).
   - Line 2: Task list progress summary: `Tasks: {done}/{total} done {markers}`.
   - Line 3: Tool stats and turn count: `R:{n} E:{n} B:{n} | {t}t | {model}`.
   - Line 4: Session purpose or custom title.
   When hook data is absent, build a single-line `TreeItem` with the inline suffix.
   At compact/standard tiers, always single-line regardless of data availability.

3. **`tree.rs`**: Add `format_inline_suffix()` for single-line mode.
   After the existing status badge, append tier-specific suffix spans using the parsed `ClaudeSummary`.
   The suffix follows the format strings defined in the Per-Tier Format Strings section.
   Apply `theme.subtext0` style to metadata spans (agent count, context percent) and `theme.process_*` styles to tool names.

4. **`tree.rs`**: Add `format_widget_lines()` for multi-line mode.
   Build lines 2-4 from `ClaudeSummary` task, tool count, and session summary fields.
   Each line is rendered only when its backing data is `Some`.
   Apply indented styling (2-space indent) to sub-lines to visually nest them under line 1.

5. **`tree.rs`**: Add `format_window_label_with_aggregation()` and `format_session_label_with_aggregation()`.
   Accept a slice of `Integration` references.
   Count active integrations, determine highest-priority status, format the `(active/total)` suffix.

6. **`tree.rs`**: Update `build_window_items()` and `build_session_items()` to pass integration data through for aggregation.

7. **`layout.rs`**: Change `body_layout()` to only split at Full tier.
   Wide tier becomes tree-only.

8. **`render.rs`**: Update `render_detail_panel()` to show expanded metadata (model, error message, timestamp) instead of duplicating what is now inline.

9. **`colors.rs`**: Add `pub inline_metadata: Style` (maps to `subtext0` or `overlay1`) for the metadata suffix.
   Add `pub stale_suffix: Style` (dimmed version of `inline_metadata`).
   Add `pub widget_subline: Style` for lines 2-4 of the multi-line widget.

10. **`app.rs`**: Fix the hardcoded `LayoutTier::Standard` in `refresh_from_db()`.
    Store the terminal width and recompute the tier at refresh time, or accept that label formatting at refresh time uses a default tier and re-build labels at render time.

> WARN(opus/sprack-inline-summaries): The current `refresh_from_db()` builds tree items with `LayoutTier::Standard` regardless of actual terminal width.
> This means resizing the terminal does not update label formatting until the next DB change triggers a refresh.
> Phase 1 should address this by rebuilding tree items at render time when the tier changes.
> This requires caching the snapshot and rebuilding on tier transitions, adding a `last_tier` field to `App`.

> NOTE(opus/sprack-inline-summaries): Tier-transition rebuilds use the cached `DbSnapshot`, not a fresh DB query.
> This means a resize may show slightly stale data until the next DB change triggers a full refresh (typically within 2-3 seconds).
> This is an acceptable trade-off: avoiding a DB read on every resize keeps the render path fast.

**Estimated effort**: 5-7 focused implementation hours.

### Phase 2: Multi-Line Verification (Integrated into Phase 1)

**Goal**: Verify multi-line `TreeItem` behavior within the sprack context during Phase 1 implementation.

> NOTE(opus/sprack-inline-summaries): This is no longer a separate phase.
> Multi-line `TreeItem` in `tui-tree-widget` v0.22 is confirmed to work architecturally.
> The verification checklist (see "Multi-Line TreeItem: Confirmed Working" section) runs as part of Phase 1's manual validation.

**Changes**:

1. Optionally create `packages/sprack/examples/multiline-tree-test.rs` as a standalone smoke test for CI.
2. Run the verification checklist during Phase 1's validation checkpoint.

**Estimated effort**: included in Phase 1.

### Phase 3: Custom Renderer (Unlikely)

> NOTE(opus/sprack-inline-summaries): Multi-line `TreeItem` in `tui-tree-widget` v0.22 is confirmed to work.
> Phase 3 is unlikely to be needed: native multi-line support covers the rich widget dashboard use case.
> This phase is retained only as a contingency if unforeseen rendering issues emerge during Phase 1 implementation.

**Goal**: Replace `tui-tree-widget` with a custom tree renderer if native multi-line support proves insufficient in practice.

**Approach**: A custom `StatefulWidget` that:
- Accepts a tree data structure (reuse `NodeId` and the existing tree-building logic).
- Renders indented tree lines with expand/collapse state.
- Supports variable-height items (1 line for simple nodes, 2+ for nodes with summaries).
- Tracks row-to-node mapping for mouse click targeting.
- Handles keyboard navigation (j/k/h/l) with multi-line-aware scrolling.

**Estimated effort**: 8-12 hours (deferred indefinitely).

## Rendering Changes: tree.rs

### New functions

- `parse_claude_summary(summary: &str) -> Option<ClaudeSummary>`: Deserialize the JSON summary field.
- `format_inline_suffix(summary: &ClaudeSummary, tier: LayoutTier, theme: &Theme) -> Vec<Span<'static>>`: Build the tier-aware metadata spans for single-line mode.
- `format_widget_lines(summary: &ClaudeSummary, tier: LayoutTier, theme: &Theme) -> Vec<Line<'static>>`: Build lines 2-4 of the multi-line widget from hook data fields. Returns an empty vec when hook data is absent.
- `format_task_progress(tasks: &[TaskSummary]) -> Line<'static>`: Format the task list progress line.
- `format_tool_stats(tool_counts: &ToolCounts, turns: u32, model: &str) -> Line<'static>`: Format the tool stats and model line.
- `compute_aggregation(integrations: &[&Integration]) -> (usize, usize, Option<ProcessStatus>)`: Returns `(active_count, total_count, highest_priority_status)`.
- `is_stale(updated_at: &str, threshold_secs: u64) -> bool`: Timestamp staleness check.

### Modified functions

- `build_pane_item()`: Construct multi-line `TreeItem` (via `Text` with multiple `Line`s) at wide/full tiers when hook data is present. Fall back to single-line `TreeItem` otherwise.
- `format_window_label()`: Accept integration data, append `(active/total)` count.
- `format_session_label()`: Accept integration data, append `(active/total panes)` count.
- `build_window_item()`: Pass integrations through for aggregation counting.
- `build_session_item()`: Pass integrations through for aggregation counting.

## Rendering Changes: render.rs

### Modified functions

- `render_frame()`: The `body_layout` change means `detail_area` is `None` at wide tier.
  No code change needed in `render_frame` itself (it already checks `if let Some(detail_rect)`).

- `render_detail_panel()`: Simplify to show only supplemental metadata (model, full error, timestamps).
  Remove the integration summary line (it is now inline in the tree).

## Rendering Changes: layout.rs

### Modified functions

- `body_layout()`: Wide tier returns `(area, None)` instead of splitting.
  Only Full tier splits.
  Minimum tree width increases to 40 for Full tier.

## Test Plan

### Unit tests (tree.rs)

1. `test_parse_claude_summary_valid_json`: Valid `ClaudeSummary` JSON parses correctly.
2. `test_parse_claude_summary_empty_string`: Empty string returns `None`.
3. `test_parse_claude_summary_invalid_json`: Malformed JSON returns `None`.
4. `test_format_inline_suffix_thinking_standard`: Correct format at standard tier.
5. `test_format_inline_suffix_tool_use_wide`: Correct format at wide tier with tool name.
6. `test_format_inline_suffix_zero_subagents_omitted`: `0ag` is not rendered.
7. `test_compute_aggregation_mixed_statuses`: Correct active count and priority detection.
8. `test_is_stale_fresh_timestamp`: Recent timestamp is not stale.
9. `test_is_stale_old_timestamp`: Old timestamp is stale.
10. `test_format_pane_label_with_integration_standard`: Full pane label includes suffix at standard tier.
11. `test_format_pane_label_without_integration`: No suffix when no integration exists.

### Unit tests (tree.rs, continued)

12. `test_format_pane_label_tier_transition`: Verify that the same pane data produces different label formats at Standard vs. Wide tier, confirming tier-transition rebuild correctness.

### Unit tests (tree.rs, multi-line widget)

15. `test_widget_lines_with_hook_data`: Verify lines 2-4 render when task, tool count, and session summary data is present.
16. `test_widget_lines_without_hook_data`: Verify empty vec when hook data fields are all `None`.
17. `test_widget_lines_partial_hook_data`: Verify only populated lines render (e.g., tasks present but no session summary).
18. `test_format_task_progress_mixed_status`: Verify completed and in-progress task markers render correctly.
19. `test_format_tool_stats_format`: Verify `R:n E:n B:n | t | model` format.
20. `test_build_pane_item_multiline_wide`: Verify `TreeItem` has multiple lines at wide tier with hook data.
21. `test_build_pane_item_singleline_standard`: Verify `TreeItem` is single-line at standard tier even with hook data.

### Unit tests (layout.rs)

13. `test_body_layout_wide_no_detail`: Wide tier returns `None` for detail area.
14. `test_body_layout_full_has_detail`: Full tier still has detail pane.

### Integration test (manual)

22. Run `sprack` with a live Claude Code session and hooks configured, verify:
    - Multi-line widget renders task progress and session purpose at wide/full tiers.
    - Single-line fallback renders correctly when hooks are not configured.
    - Inline suffixes update when status changes.
    - Stale indicators appear when sprack-claude is stopped.
    - Window/session aggregation counts are accurate.
    - Full tier detail pane shows supplemental metadata.
    - Resizing the terminal transitions between tiers smoothly.
    - Mixed single-line (non-Claude) and multi-line (Claude) pane items coexist without layout issues.

## Open Risks

1. **JSON parsing overhead**: Parsing `ClaudeSummary` JSON on every tree rebuild (every 50ms poll tick when the DB changes) adds CPU overhead.
   Mitigation: `serde_json::from_str` on a small JSON blob (~200 bytes) is sub-microsecond. Not a concern.

2. **Tier mismatch at refresh time**: The current `refresh_from_db` builds tree items with a hardcoded tier.
   Phase 1 must address this to avoid labels being formatted for the wrong tier.
   Mitigation: Cache the snapshot and rebuild tree items at render time when the tier changes.

3. **`ClaudeSummary` schema evolution**: If `sprack-claude` adds fields to `ClaudeSummary`, the TUI crate must update its local type or import from `sprack-claude`.
   Mitigation: Re-export `ClaudeSummary` from `sprack-db` as the canonical type, or use `serde_json::Value` for forward-compatible parsing.

4. **Timestamp parsing dependency**: Staleness detection requires parsing ISO 8601 timestamps.
   The codebase does not currently use `chrono` or `time`.
   Mitigation: Use a minimal manual parser for `YYYY-MM-DD HH:MM:SS` format (the format SQLite's `datetime()` produces). Avoid adding a full datetime crate.

5. **Hook data availability**: Lines 2-4 of the rich widget depend on Phase 1.5 (hook event bridge) data.
   If Phase 1.5 is delayed, the multi-line widget falls back to single-line mode.
   Mitigation: single-line inline suffixes (line 1 only) are a complete feature on their own. The multi-line widget is an enhancement, not a blocker.

6. **Variable-height scrolling edge cases**: While multi-line `TreeItem` is confirmed to work, edge cases with rapid item height changes (e.g., hook data arriving mid-scroll) may cause visual jitter.
   Mitigation: height changes only occur on full tree rebuilds (every 2-3 seconds), not during render. This is unlikely to be noticeable.
