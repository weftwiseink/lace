---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T00:00:00-07:00
task_list: terminal-management/sprack-ui-roadmap
type: report
state: live
status: review_ready
tags: [sprack, tui, ux_design, roadmap, architecture]
---

# Sprack TUI UI Roadmap Assessment

> BLUF: The sprack TUI has completed its foundational build-out through Phase 2B, landing verifiability infrastructure, layout organization, hook event bridge, inline summaries with multi-line rich widgets, and session cache schema.
> The gap between current state and the user's vision (scoped session names, absolute token counts, git context, task markers) is well-defined: session names require only a plumbing change, token counts require a small schema extension, but git context requires new data collection infrastructure that no proposal has implemented yet.
> The widget restyle proposal covers all of this but has not been implemented.
> The most impactful next step is landing the widget restyle (session name + absolute tokens), which requires no new data collection and addresses the most visible gap between current rendering and the target layout.

## 1. Current State

### What Has Shipped

The git log shows a clear progression through the phasing plan.
All phases through 2B have landed:

| Phase | Commit | Status |
|-------|--------|--------|
| Phase 0: Verifiability | `ef53ac7` | Done: `ProcFs` trait, socket params, insta snapshots |
| Phase 1A: Layout Organization | `5e4dd5a` | Done: 19-field format string, spatial sorting, metadata display |
| Phase 1.5: Hook Event Bridge | `6cb1b2a`, `8db16bb` | Done: shell script, event reader, ClaudeSummary extensions |
| Phase 2A: Inline Summaries | `2d3c921` | Done: multi-line rich widget, per-tier rendering, detail pane at Full only |
| Phase 2B: Session Cache | `be7a72f` | Done: schema + ingestion (cache functions not yet wired into poll loop) |
| UX Fixes | `0e77e50` | Done: ctrl+c quit, click-to-expand |
| Render Testability | `310c578`, `b19fdc7` | Done: `TestBackend` + insta snapshots, `--dump-rendered-tree` CLI flag |

Total test count has grown from 76 to 91 (58 sprack, 14 sprack-db, 19 sprack-poll).
The codebase is approximately 8,850 lines of Rust across 4 crates.

### What the TUI Renders Today

At 120 columns, the `--dump-rendered-tree` output shows:

```
> PORT-22427                                 |Select a pane to view details
> LOCAL                                      |
```

This is a collapsed view.
When expanded with live Claude sessions and hook data, panes render as multi-line widgets (from `format_rich_widget` in `tree.rs`):

```
claude       [thinking] 42% ctx 3ag
  Tasks: 2/4 done  Draft  Review >Cross-coh
  opus-4-6
  Implementing inline summaries for sprack TUI
```

Without hook data, panes fall back to single-line inline suffixes:

```
  claude       [thinking] 3ag 42%
```

### What Is Not Yet Working

1. **Session cache not wired**: `cache.rs` has schema and ingestion functions but they are `#[allow(dead_code)]`.
   The poll loop still uses the JSONL tail-reader directly.
   `ClaudeSummary` fields like `user_turns`, `assistant_turns`, `tool_counts`, and `context_trend` are defined in the proposal but not yet populated.

2. **Process host awareness (Phase 1B)**: The `resolver.rs` module exists with `find_candidate_panes`, `build_lace_session_map`, and the `LaceContainerResolver` logic, but the critical validation against a live lace deployment with Claude in containers has not been confirmed.
   Container panes still show `ssh` instead of Claude status in the tree unless the resolver correctly traverses bind mounts.

3. **Widget restyle not implemented**: The current widget layout does not match the user's target.
   It uses `process_name [status] context% subagents` on line 1, which is the inline summaries design, not the widget restyle design.

4. **tmux IPC migration (Phase 3)**: Not started.
   Still uses `||`-delimited format strings via raw `Command::new("tmux")`.

## 2. User's Vision

The user's target widget layout, provided as inline feedback:

```
* claude/sprack-2 [thinking]
    opus-4-6 | 840K/1M | 2 subagents
    on branch@commit (and wt other-branch, subagent-branch)
    Implementing inline summaries for sprack TUI
    Tasks: 3/5 done Phase0 Phase1A >Phase2A
```

Key differences from the current rendering:

| Aspect | Current | Target |
|--------|---------|--------|
| Line 1 identity | `claude` (bare process name) | `claude/sprack-2` (scoped session name) |
| Context display | `42% ctx` (percentage) | `840K/1M` (absolute token counts) |
| Subagent format | `3ag` (abbreviated) | `2 subagents` (full word at wide+) |
| Git context | Not shown | `on branch@commit (and wt ...)` as dedicated line |
| Task line position | Line 2 | Line 5 (after git context and purpose) |
| Task markers | Checkmark Unicode + `>` prefix | Checkmark + `>` prefix (same concept, different ordering) |

The widget restyle proposal (`2026-03-24-sprack-claude-widget-restyle.md`) formalizes this vision into a 5-line layout with per-tier degradation.

## 3. Gap Analysis

### Achievable Without New Infrastructure

**Session name on line 1.**
The tmux session name is already in the `Pane` struct (`pane.session_name`).
`format_rich_widget` and `format_pane_label` receive the `Pane` reference.
Threading the session name into the display requires changing the format string only: `format!("claude/{}", pane.session_name)`.
No new data collection, no schema changes.
Estimated effort: 1-2 hours.

**Absolute token counts.**
`extract_context_percent` in `status.rs` already computes `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` against `model_context_window()`.
Adding `tokens_used: Option<u64>` and `tokens_max: Option<u64>` to `ClaudeSummary` is a small schema extension.
The TUI needs a `format_token_count()` function (K/M suffix formatting).
Estimated effort: 2-3 hours.

**Subagent count full word.**
Changing `"{}ag"` to `"{} subagents"` at wide/full tiers is a one-line format string change.
Compact/standard tiers keep `"{}ag"`.

**Task line reordering.**
Moving the task line from line 2 to line 5 in `format_rich_widget` is a reordering of the line construction.

### Requires New Data Collection

**Git branch and commit.**
No proposal has implemented git context collection.
The widget restyle proposal outlines two options:

- **Option A (Hook-based)**: PostToolUse hooks run `git rev-parse` and write branch/commit to event files.
  Requires hook script modification and a new event type.
- **Option B (Direct inspection)**: sprack-claude reads `.git/HEAD` from the pane's resolved cwd on each poll cycle.
  Requires resolving the cwd (already done for session file discovery) and adding subprocess calls or file reads for git state.

Option B is simpler: sprack-claude already resolves the cwd.
Reading `.git/HEAD` for the branch and `.git/refs/heads/<branch>` for the commit hash is a few file reads, no subprocess needed.
Caching with inode/mtime checks on `.git/HEAD` keeps overhead negligible.

Estimated effort: 4-6 hours (including cache, error handling for non-git directories, worktree enumeration).

**Git worktree branches.**
Requires `git worktree list --porcelain` or reading `.git/worktrees/` directory.
This is an extension of git context collection, with its own caching layer.
Estimated effort: 2-3 hours on top of basic git context.

### Requires Wiring Existing Code

**Session cache integration.**
The `cache.rs` module has schema and `ingest_new_entries` but the poll loop does not call it.
Wiring this enables `user_turns`, `assistant_turns`, `tool_counts`, and `context_trend` in `ClaudeSummary`.
These fields feed into the inline widget but are lower priority than session name, tokens, and git context for the user's target layout.
Estimated effort: 3-4 hours to wire and validate.

## 4. Data Availability

| Data Point | Source | Available Now | Used in Widget |
|------------|--------|---------------|----------------|
| Process name | tmux `current_command` | Yes | Yes (line 1) |
| Session name | tmux snapshot (`pane.session_name`) | Yes | No (not threaded to widget) |
| Status badge | JSONL `stop_reason` | Yes | Yes (line 1) |
| Context % | JSONL token usage | Yes | Yes (line 1) |
| Absolute tokens | JSONL token usage fields | Yes (raw data exists) | No (not extracted) |
| Model name | JSONL `message.model` | Yes | Yes (line 3 of widget) |
| Subagent count | JSONL `agent_progress` | Yes | Yes (line 1) |
| Last tool | JSONL `tool_use` blocks | Yes | Yes (in tool_use state) |
| Task list | Hook events (TaskCompleted, PostToolUse) | Yes (when hooks configured) | Yes (line 2) |
| Session purpose | Hook PostCompact `compact_summary` | Yes (when hooks configured) | Yes (line 4) |
| Session summary | Hook PostCompact | Yes (when hooks configured) | Yes (line 4) |
| Git branch | `.git/HEAD` in pane cwd | Not collected | No |
| Git commit | `.git/refs/heads/<branch>` in pane cwd | Not collected | No |
| Worktree branches | `.git/worktrees/` | Not collected | No |
| Turn counts | JSONL entry counting | Partially (cache schema exists, not wired) | No |
| Tool counts | JSONL tool_use blocks | Partially (cache schema exists, not wired) | No |
| Context trend | Context history samples | Partially (cache schema exists, not wired) | No |

The critical observation: the user's target layout requires only two new data sources (git branch, git commit).
Session name is already available but not plumbed.
Absolute tokens are derivable from existing data with a small extraction change.

## 5. Proposed Next Steps

Ordered by impact relative to achieving the user's target layout, with feasibility considered.

### Step 1: Widget Restyle Phase 1 (Session Name + Absolute Tokens)

Implement the widget restyle proposal's Phase 1: thread session name, add absolute token fields, reformat the widget.
This closes the largest visual gap between current and target layout with no new data collection.

Changes:
- `ClaudeSummary`: add `tokens_used: Option<u64>`, `tokens_max: Option<u64>`.
- `status.rs`: populate token fields in `build_summary()`.
- `tree.rs`: `format_rich_widget` uses `claude/{session_name}`, displays `840K/1M` instead of `42%`, reorders lines to match target, uses `subagents` at wide+ tiers.
- `tree.rs`: `format_pane_label` uses scoped name at all tiers.
- Add `format_token_count()` utility.

Estimated effort: 3-4 hours.

### Step 2: Git Context Collection (Widget Restyle Phase 2)

Add git state reader to sprack-claude using Option B (direct `.git/HEAD` inspection).
Populate `git_branch` and `git_commit_short` on `ClaudeSummary`.
Render as line 3 in the widget.

Estimated effort: 4-6 hours.

### Step 3: Wire Session Cache

Connect `cache.rs` ingestion to the poll loop.
This enables turn counts, tool counts, and context trend display.
These are secondary to the user's target layout but improve the detail pane and future widget lines.

Estimated effort: 3-4 hours.

### Step 4: Git Worktree Branches (Widget Restyle Phase 3)

Add worktree enumeration for the `(and wt ...)` suffix at full tier.

Estimated effort: 2-3 hours.

### Step 5: Container Validation

Validate process host awareness against a live lace deployment.
This is prerequisite for the TUI being useful in the primary use case: monitoring Claude in containers.
Should be done alongside or before any widget restyle work, as the widget is meaningless if container panes do not show Claude status.

> NOTE(opus/sprack-ui-roadmap): This step is listed as step 5 but may need to be step 0.
> If container panes do not resolve to Claude status, the widget restyle is cosmetic only.
> The resolver code exists but has not been validated end-to-end.

### Step 6: tmux IPC Migration (Phase 3)

Replace raw `Command::new("tmux")` with tmux-interface-rs.
Low urgency: the delimiter problem (`||`) is rare in practice.
Should wait until all feature work is stable.

Estimated effort: 4-6 hours.

## 6. Open Questions

1. **Container validation priority.**
   Should container pane resolution be validated before or after widget restyle?
   The widget restyle is visually satisfying but operationally useless if container panes do not show Claude status.
   The user may prefer to see the visual improvement first (on local panes) and validate containers separately.

2. **Token display format.**
   The user's mockup shows `840K/1M` (tokens used / context window).
   An alternative is `160K remaining` or `840K/1M (84%)`.
   Should the percentage be retained as a secondary indicator, or is the absolute count sufficient?

3. **Git context data source.**
   Option B (direct `.git/HEAD` read) is simpler but requires sprack-claude to have filesystem access to the pane's cwd.
   For container panes, the cwd is inside the container's filesystem, not directly accessible from the host.
   The `~/.claude` bind mount provides session files but not the git repository.
   Git context for container panes may require Option A (hooks writing git state) or a new bind mount for `.git`.

4. **Session name truncation at compact tier.**
   `claude/my-long-session-name` exceeds compact tier width.
   Options: truncate session name with ellipsis, show bare `claude` at compact tier, or abbreviate the session name.

5. **Staleness indicator scope.**
   The inline summaries proposal specifies dimming the suffix when `updated_at` exceeds 10 seconds.
   The current implementation in `format_rich_widget` does not implement staleness checks.
   Should this be addressed as part of the widget restyle or deferred?

6. **Window/session aggregation.**
   The inline summaries proposal specifies active/total pane counts on window and session nodes.
   The current `format_window_label` shows pane count but not active integration count.
   Should aggregation be part of the next iteration or deferred?

## Related Documents

| Document | Type | Key Content |
|----------|------|-------------|
| [Widget restyle proposal](../proposals/2026-03-24-sprack-claude-widget-restyle.md) | Proposal | 5-line target layout, token formatting, git context options |
| [Inline summaries proposal](../proposals/2026-03-24-sprack-inline-summaries.md) | Proposal | Multi-line TreeItem architecture, per-tier rendering, staleness |
| [Iteration phasing plan](../proposals/2026-03-24-sprack-iteration-phasing-plan.md) | Proposal | Phase sequencing, subagent allocation, validation checkpoints |
| [Hook event bridge](../proposals/2026-03-24-sprack-hook-event-bridge.md) | Proposal | 7 hook events, event file format, ClaudeSummary extensions |
| [Session cache](../proposals/2026-03-24-sprack-claude-incremental-session-cache.md) | Proposal | SQLite cache schema, incremental ingestion, turn/tool counts |
| [Project status report](../reports/2026-03-24-sprack-project-status.md) | Report | Initial state assessment, RFP inventory |
| [Implementation handoff devlog](../devlogs/2026-03-24-sprack-implementation-handoff.md) | Devlog | 4-crate build-out, container boundary discovery |
| [TUI UX improvements](../proposals/2026-03-24-sprack-tui-ux-improvements.md) | Proposal | Click-to-expand, ctrl+c quit (both implemented) |
