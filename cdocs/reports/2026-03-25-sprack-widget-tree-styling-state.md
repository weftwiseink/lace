---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T18:00:00-07:00
task_list: terminal-management/sprack-widget-tree-styling
type: report
state: live
status: wip
tags: [sprack, tui, widget, layout, architecture]
---

# Sprack Widget and Tree Styling State

> BLUF: The detail pane removal from Phase 2A is partially complete: it is gone at compact, standard, and wide tiers but retained at full tier (100+ cols) as a supplemental debugging panel.
> Rich multi-line widgets render at wide/full tiers when hook data is present, falling back to single-line labels otherwise.
> The CHECKPOINT_2 fields (`user_turns`, `tool_counts`, `context_trend`) are fully wired from cache through to rendering.
> Container panes in lace sessions are candidates for Claude integration detection, but resolution requires `lace_workspace` to be set on the session and a recent `.jsonl` file in the bind mount: an `ssh` pane with no badge indicates one of these preconditions is unmet.

## 1. Detail Pane

### Current State

The detail pane is conditionally rendered based on the layout tier.
In `layout.rs`, `body_layout()` returns `(area, None)` for compact, standard, and wide tiers, and splits horizontally (tree min 40 cols + detail fill) only at full tier (100+ cols).

In `render.rs`, `render_frame()` calls `render_detail_panel()` only when `body_layout()` returns `Some(detail_rect)`.
The detail panel shows integration metadata for the selected pane node: model name, status, context usage, tool/task info, and timestamps.

### Assessment

The Phase 2A goal of "replacing the separate detail pane with inline tree-node summaries" is implemented as designed by the inline summaries proposal.
The proposal explicitly specified: detail pane removed at compact/standard/wide, retained at full tier as a supplemental debugging view.
The code matches this specification.

> NOTE(opus/sprack-widget-tree-styling): The widget restyle proposal (user feedback section) contains a stronger directive: "The detail panel is removed entirely. Widget content renders as nested child TreeItems."
> This directive was not implemented.
> The current code uses multi-line `Text` within a single leaf `TreeItem`, not nested child `TreeItem`s.
> The full-tier detail panel persists as a separate right-side column, not as expandable tree children.
> Whether this is intentional scoping or incomplete work depends on which proposal takes precedence.

### Tier-Specific Behavior

| Tier | Width | Detail Pane | Tree Width |
|------|-------|------------|------------|
| Compact | <30 | None | Full |
| Standard | 30-59 | None | Full |
| Wide | 60-99 | None | Full |
| Full | 100+ | Right column (fill) | Min 40 cols |

## 2. Rich Widget Rendering

### Trigger Conditions

In `tree.rs`, `build_pane_item()` (line 298-322) determines whether to render the rich widget or the simple label.

The `has_hook_data` flag is computed as:

```rust
let has_hook_data = claude_summary
    .as_ref()
    .is_some_and(|s| s.tasks.is_some() || s.session_summary.is_some());
```

The rich widget renders when both conditions are true:
1. `has_hook_data` is true (the `ClaudeSummary` has either `tasks` or `session_summary` populated)
2. The tier is `Wide` or `Full`

Otherwise, `format_pane_label()` produces a single-line label.

### Rich Widget Structure (`format_rich_widget`)

The function at line 667-786 produces 2-5 lines:

- **Line 1**: `{process}/{claude_session_name} [{status_badge}]` (always rendered)
- **Line 2**: `{model_short} | {tokens_display}{trend_arrow} | {subagent_label} | {turns} turns` (always rendered; subagents as full word at wide/full)
- **Tool line**: `{tool1}:{count} {tool2}:{count} {tool3}:{count}` (rendered when `tool_counts` is `Some` and non-empty)
- **Purpose line**: `{session_purpose}` (rendered when `session_purpose` is `Some`)
- **Task line**: `Tasks: {done}/{total} done {markers}` (rendered when `tasks` is `Some` and non-empty)

### CHECKPOINT_2 Fields

All three new fields from CHECKPOINT_2 are rendering:

- **`user_turns`**: Rendered as `{N} turns` on line 2 of the rich widget, and as `{N}t` in the single-line inline suffix.
  Wired in `main.rs` via `cache::read_session_summary()` which sets `summary.user_turns = Some(cached.user_turns)`.
- **`tool_counts`**: Rendered as a dedicated line showing the top 3 tools (`Read:47 Edit:12 Bash:8`).
  Populated from the session cache's aggregated tool usage.
- **`context_trend`**: Appended as a directional arrow to the context display: `^` for rising, `v` for falling, `=` for stable.
  Populated from `cached.context_trend` in the cache enrichment step.

### Single-Line Inline Suffix

When the rich widget does not render (no hook data, or compact/standard tier), the `format_pane_label()` function builds an inline suffix from parsed `ClaudeSummary` data.
The suffix varies by tier:

- **Compact**: Status icon + truncated process name (15 chars)
- **Standard**: `{active_prefix}{scoped_name:20} {badge} {suffix}` where suffix shows subagent count, context display, turn count, or last tool name during tool use
- **Wide**: Same as standard with dimensions (`[80x24]`) and wider name truncation (30 chars)
- **Full**: Title/scoped name + `(process_name)` + dimensions + PID + path + badge + suffix

> NOTE(opus/sprack-widget-tree-styling): During tool use, the inline suffix clears its normal content and shows only the truncated tool name (8 chars).
> This is a deliberate design choice in `format_pane_label()` at line 446-452.

### Tier Mismatch at Refresh Time

`app.rs` line 136-138 builds tree items with a hardcoded `LayoutTier::Standard`:

```rust
let tier = LayoutTier::Standard;
self.tree_items = tree::build_tree(&snapshot, self.own_pane_id.as_deref(), tier);
```

This means label formatting uses standard tier regardless of actual terminal width until the next DB change triggers a refresh.
The inline summaries proposal flagged this as `WARN` and recommended caching the snapshot and rebuilding on tier transitions.
This has not been addressed.

## 3. Claude Session Detection in Container Panes

### Candidate Detection (`find_candidate_panes`)

A pane becomes a candidate for Claude integration if either:
1. Its `current_command` contains "claude" (local Claude pane), OR
2. Its parent session has `lace_port` set (container pane - all panes in lace sessions are candidates)

### Processing (`process_claude_pane`)

For each candidate pane, dispatch logic in `main.rs` (line 133-174):

1. If `current_command` contains "claude": try local `/proc` resolution first, fall back to container resolution if the session has lace metadata
2. If `current_command` does NOT contain "claude" but the session has lace metadata: use container resolution directly
3. If neither condition is met: no resolution (should not reach this point due to `find_candidate_panes` filter)

### Container Resolution Preconditions

`LaceContainerResolver` requires three preconditions for successful resolution:

1. **`lace_workspace` must be set** on the session (`session.lace_workspace.as_deref()?` returns `None` if absent)
2. **A matching project directory must exist** in `~/.claude/projects/` with a prefix matching the encoded workspace path
3. **The project directory must have a `.jsonl` file modified within the last 300 seconds** (`CONTAINER_RECENCY_THRESHOLD`)

### Why a Pane Shows `* ssh` with No Badge

An `ssh` pane in a lace session showing no integration badge indicates one of:

- **`lace_workspace` is not set**: The devlog confirms this is a known issue: "`@lace_workspace` is empty on current lace sessions."
  Without `lace_workspace`, `resolve_container_pane()` returns `None` at the first line.
- **No recent session file**: If Claude has not been used in the container within the last 5 minutes, `CONTAINER_RECENCY_THRESHOLD` excludes the directory.
- **No matching project directory**: The workspace path encoding did not match any directory in `~/.claude/projects/`.
- **Resolution failed and error integration was written then cleaned**: If the pane was initially a candidate but resolution failed, an error integration is written.
  On subsequent cycles, if the pane is no longer a candidate, `clean_stale_integrations()` removes it.

The most likely cause for a live lace session is the first: `@lace_workspace` is not set on the tmux session.
This must be set as a tmux session option (e.g., `tmux set-option -t lace-test @lace_workspace /workspaces/lace`) for container resolution to work.

## 4. Layout Tier Behavior

### Breakpoints

`layout_tier()` in `layout.rs`:

| Width Range | Tier |
|------------|------|
| 0-29 | Compact |
| 30-59 | Standard |
| 60-99 | Wide |
| 100+ | Full |

### Tree vs. Tree+Detail Decision

`body_layout()` makes the split decision:
- Compact, Standard, Wide: tree gets the full body area, no detail pane
- Full: horizontal split with tree (min 40 cols) and detail (fill remaining)

The tier is computed fresh on every render frame from `area.width`, so resizing the terminal immediately changes the layout.
However, tree item labels are NOT rebuilt on resize: they use the cached `LayoutTier::Standard` from the last `refresh_from_db()` call.
This means at full tier, the layout shows tree+detail but labels are formatted for standard tier until the next DB change.

### Comment Documentation

The `body_layout()` doc comment states: "Inline summaries at Wide tier make a separate detail pane unnecessary."
This accurately reflects the implementation.

## 5. Proposals and Prior Devlogs

### Inline Summaries Proposal (`2026-03-24-sprack-inline-summaries.md`)

Status: `implementation_wip`.

Key specifications:
- Multi-line rich widget at wide/full tiers when hook data present: **implemented**
- Single-line inline suffixes at compact/standard: **implemented**
- Detail pane removed at compact/standard/wide, retained at full: **implemented**
- Node type aggregation (active/total counts on window/session labels): **not implemented** (window/session labels show pane/window counts but not integration status aggregation)
- Staleness indicators (dim suffix when integration older than 10s): **not implemented**
- Tier-transition rebuild (cache snapshot, rebuild on tier change): **not implemented**

### Widget Restyle Proposal (`2026-03-24-sprack-claude-widget-restyle.md`)

Status: `implementation_wip`.

Key specifications:
- Scoped `claude/{session_name}` identity: **implemented** (both in rich widget and single-line label)
- Absolute token counts (`840K/1M`): **implemented** via `format_token_count()` and `format_context_display()`
- Git context line: **not implemented** (Phase 2 of this proposal)
- Worktree branches: **not implemented** (Phase 3 of this proposal)
- User feedback: detail panel removed entirely, widget as nested child TreeItems, default expanded tree: **not implemented** (the detail panel persists at full tier, widget uses multi-line Text not child nodes)

### Troubleshooting Devlog (`2026-03-25-sprack-troubleshooting-and-widget-restyle.md`)

Status: `review_ready`.
Covers Phase 1 widget restyle (session names + absolute tokens) and Phase 2A inline summaries (rich widget).
Commit `2d3c921` is the Phase 2A implementation.

### Continuation Devlog (`2026-03-25-sprack-ui-and-ipc-continuation.md`)

Status: `review_ready`.
Covers CHECKPOINT_1 (hook dedup), CHECKPOINT_2 (session cache wiring with `user_turns`/`tool_counts`/`context_trend`), CHECKPOINT_3 (tab delimiter), and CHECKPOINT_4 (container validation).

## Recommendations

1. **Resolve the detail panel directive conflict**.
The inline summaries proposal says "retained at full tier as supplemental."
The widget restyle proposal's user feedback says "removed entirely, widget as child TreeItems."
These are contradictory.
Clarify which is the intended target state.

2. **Fix the tier mismatch in `refresh_from_db()`**.
Store `last_tier` in `App`, detect tier changes at render time, and rebuild tree items from cached snapshot when the tier transitions.
This is a small change with visible impact: resizing the terminal currently shows wrong-tier labels until a DB change.

3. **Implement staleness indicators**.
The inline summaries proposal specifies dimming suffixes when `updated_at` exceeds 10 seconds.
This is straightforward: parse the ISO 8601 timestamp, compare to `SystemTime::now()`, apply `Modifier::DIM`.
Without this, users cannot distinguish fresh data from stale data when `sprack-claude` stops or crashes.

4. **Implement node type aggregation**.
Window and session labels showing active integration counts (e.g., `editor (2/3)`) would significantly improve at-a-glance status scanning.
The integration data is already available in `DbSnapshot`.

5. **Investigate `lace_workspace` population**.
Container panes showing `* ssh` without a badge is the most visible gap for lace users.
Determine how and when lace sets `@lace_workspace` on tmux sessions and ensure it is populated for active containers.
