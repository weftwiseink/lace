---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T22:00:00-07:00
task_list: terminal-management/sprack-widget-restyle
type: proposal
state: live
status: implementation_wip
tags: [sprack, tui, ux_design, widget]
---

# sprack Claude Widget Restyle

> BLUF(opus/sprack-widget-restyle): Restyle the Claude pane widget to a 5-line dashboard centered on session identity, git context, and absolute token counts.
> The key changes: scoped `claude/{session_name}` identity on line 1, absolute token display (e.g., 840K/1M) instead of percentage, git branch+commit context as a dedicated line, and session purpose promoted to line 4.
> This requires two new data sources: tmux session name (available from sprack-poll) and git branch/commit state (requires new collection via hooks or direct inspection).

## Objective

The Claude widget is the primary operational dashboard for each Claude Code session.
The [inline summaries proposal](2026-03-24-sprack-inline-summaries.md) established the multi-line widget architecture.
This proposal restyles the widget content to surface higher-value information: which session, what branch, how much context remains in absolute terms.

## Target Layout

```
* claude/sprack-2 [thinking]
    opus-4-6 | 840K/1M | 2 subagents
    on branch@commit (and wt other-branch, subagent-branch)
    Implementing inline summaries for sprack TUI
    Tasks: 3/5 done ✓Phase0 ✓Phase1A >Phase2A
```

### Line-by-Line Specification

| Line | Format | Content |
|------|--------|---------|
| 1 | `{process}/{session_name} [{status_badge}]` | Scoped identity: process type and tmux session name. Status badge in brackets. |
| 2 | `{model_short} \| {tokens_used}/{tokens_max} \| {n} subagents` | Model shortname, absolute token counts (K/M suffixed), subagent count as full word. |
| 3 | `on {branch}@{short_commit} (and wt {other_branches})` | Git context: current branch, short commit hash, worktree branches if any. |
| 4 | `{session_purpose}` | Session purpose from PostCompact hook or first user message. |
| 5 | `Tasks: {done}/{total} done {markers}` | Task progress with completion markers. |

### Rationale for Changes

**Session name on line 1**: The tmux session name (e.g., `sprack-2`, `lace-main`) disambiguates which Claude instance this is.
Showing `claude/sprack-2` instead of bare `claude` provides immediate context when multiple sessions are active.
The session name is already available in sprack-poll's tmux state: each pane belongs to a session.

**Absolute token counts**: `840K/1M` communicates remaining capacity more intuitively than `42%`.
A developer seeing `840K/1M` knows they have used 840K of 1M tokens.
A developer seeing `42%` must mentally compute what that means for their model's context window.
The `K` and `M` suffixes keep the display compact.

**Git context line**: Knowing which branch and commit a Claude session is working on is critical for multi-worktree workflows.
When three Claude sessions are active across worktrees, the branch name is the fastest way to identify which is which.
The `(and wt ...)` suffix shows other worktree branches, useful for cross-branch awareness.

**Status badge moved to line 1**: In the inline summaries design, status badge was on line 1 but separated from the identity.
Placing it immediately after the scoped name keeps the most important information (who and what state) together.

**Subagent count uses full word**: `2 subagents` is clearer than `2ag` at the cost of a few characters.
At wide/full tiers there is sufficient horizontal space for the full word.

> NOTE(opus/sprack-widget-restyle): The inline summaries proposal uses `{n}ag` for compact representation.
> At compact/standard tiers, the abbreviated form may still be appropriate.
> The full word `subagents` is for wide/full tiers only.

## Per-Tier Rendering

### Compact (<30 cols)

```
* claude/sprack-2
```

Single line, no status badge.
The scoped name replaces the bare process name.

### Standard (30-59 cols)

```
* claude/sprack-2 [thinking]
    opus-4-6 | 840K/1M | 2ag
```

Two lines.
Line 2 uses abbreviated `ag` instead of `subagents` to fit the narrower width.
Git context and session purpose are omitted.

### Wide (60-99 cols)

```
* claude/sprack-2 [thinking]
    opus-4-6 | 840K/1M | 2 subagents
    on feat/inline-summaries@a1b2c3d
    Implementing inline summaries for sprack TUI
    Tasks: 3/5 done ✓Phase0 ✓Phase1A >Phase2A
```

Full 5-line widget.
Git context line appears.
Session purpose and task progress are shown when data is available.

### Full (100+ cols)

Same as wide, with the detail pane available for supplemental metadata (full error messages, timestamps, tool history).

```
* claude/sprack-2 [thinking]
    opus-4-6 | 840K/1M | 2 subagents
    on feat/inline-summaries@a1b2c3d (and wt main, fix/hotfix)
    Implementing inline summaries for sprack TUI
    Tasks: 3/5 done ✓Phase0 ✓Phase1A >Phase2A
```

At full tier, the worktree branch list is shown when worktrees exist.

## New Data Sources

### Session Name

**Source**: Already available.
Each pane in the sprack-poll snapshot belongs to a tmux session.
The `Pane` struct from `sprack-db` includes `session_name`.
The TUI's tree-building code has access to this when constructing pane items.

**Change required**: Pass session name through to the pane label formatter.
No new data collection needed.

### Absolute Token Counts

**Source**: Partially available.
`ClaudeSummary` has `context_percent: u8` and `model: Option<String>`.
The `extract_context_percent` function in `sprack-claude/src/status.rs` computes the percentage from `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` against `model_context_window()`.

**Change required**: Add `tokens_used: Option<u64>` and `tokens_max: Option<u64>` fields to `ClaudeSummary`.
Populate them in `build_summary()` alongside `context_percent`.
The TUI formats these as human-readable strings: `format_token_count(840_000)` produces `"840K"`, `format_token_count(1_000_000)` produces `"1M"`.

> NOTE(opus/sprack-widget-restyle): `context_percent` is retained for backward compatibility and for compact-tier rendering where absolute counts would not fit.

### Git Context

**Source**: Not currently collected.
Two viable approaches exist.

#### Option A: Hook-Based Collection

Claude Code hooks (PostToolUse on Bash, Write, Edit) can capture git state after each tool invocation.
A hook script runs `git rev-parse --abbrev-ref HEAD` and `git rev-parse --short HEAD` in the session's working directory.
The hook writes the result to a location sprack-claude can read (e.g., a sidecar file, or the hook event bridge from the [hook event bridge proposal](2026-03-24-sprack-hook-event-bridge.md)).

**Pros**: Updates only when tools run (low overhead), captures the branch at the moment of work.
**Cons**: Requires hook configuration, adds hook latency, git state is stale between tool calls.

#### Option B: Direct Git Inspection

sprack-claude reads the working directory of each Claude process (already resolved via `/proc` inspection) and runs `git rev-parse` against it.
This can be done on each poll cycle alongside the JSONL tail-reading.

**Pros**: No hook dependency, always fresh, works without any Claude Code configuration.
**Cons**: Adds a subprocess call per poll cycle per pane (mitigated by caching with inode/mtime checks on `.git/HEAD`).

> TODO(opus/sprack-widget-restyle): Decide between Option A and Option B.
> Option B is likely simpler for initial implementation: sprack-claude already resolves the cwd of each Claude process.
> A hybrid approach is also possible: use direct inspection as baseline, augment with hook data when available.

#### Git Data Fields

New fields on `ClaudeSummary`:

```rust
/// Current git branch name (e.g., "feat/inline-summaries").
pub git_branch: Option<String>,
/// Short commit hash (e.g., "a1b2c3d").
pub git_commit_short: Option<String>,
/// Other worktree branch names, if any.
pub git_worktree_branches: Option<Vec<String>>,
```

When the working directory is not a git repository, all three fields are `None` and line 3 is omitted.

### Worktree Branches

**Source**: `git worktree list --porcelain` in the session's working directory.
Produces a list of worktrees with their branch names.
Filter out the current branch (already shown in `git_branch`) and the bare worktree.

> WARN(opus/sprack-widget-restyle): Worktree enumeration adds subprocess overhead.
> Cache aggressively: worktree topology changes infrequently.
> A reasonable cache TTL is 30 seconds, invalidated on `.git/worktrees/` directory mtime change.

## ClaudeSummary Schema Changes

```rust
pub struct ClaudeSummary {
    // Existing fields
    pub state: String,
    pub model: Option<String>,
    pub subagent_count: u32,
    pub context_percent: u8,
    pub last_tool: Option<String>,
    pub error_message: Option<String>,
    pub last_activity: Option<String>,
    pub tasks: Option<Vec<TaskEntry>>,
    pub session_summary: Option<String>,
    pub session_purpose: Option<String>,

    // New fields for widget restyle
    pub tokens_used: Option<u64>,
    pub tokens_max: Option<u64>,
    pub git_branch: Option<String>,
    pub git_commit_short: Option<String>,
    pub git_worktree_branches: Option<Vec<String>>,
}
```

All new fields are `Option` with `#[serde(default)]` for backward compatibility.
Older sprack-claude versions that do not populate these fields produce `None`, and the TUI falls back gracefully: line 2 shows percentage instead of absolute counts, line 3 is omitted.

## Formatting Functions

### `format_token_count(tokens: u64) -> String`

Compact human-readable token count:
- `< 1_000`: bare number (e.g., `"500"`)
- `1_000..1_000_000`: K-suffixed, rounded to nearest K (e.g., `"840K"`)
- `>= 1_000_000`: M-suffixed with one decimal if not whole (e.g., `"1M"`, `"1.2M"`)

### `format_git_context(branch: &str, commit: &str, worktrees: &[String], tier: LayoutTier) -> Line`

Builds line 3:
- Wide: `on {branch}@{commit}` (worktrees omitted to save space unless few)
- Full: `on {branch}@{commit} (and wt {branches...})`

Branch names are truncated to fit available width.

### `format_scoped_name(process: &str, session_name: &str) -> String`

Produces `claude/sprack-2` from process name `claude` and session name `sprack-2`.

## Relationship to Inline Summaries Proposal

This proposal evolves the widget layout defined in the [inline summaries proposal](2026-03-24-sprack-inline-summaries.md).
The inline summaries proposal established the multi-line `TreeItem` architecture, per-tier rendering, staleness indicators, and node aggregation.
All of that infrastructure remains unchanged.

This proposal changes only the _content_ of each widget line:

| Aspect | Inline Summaries | Widget Restyle |
|--------|-----------------|----------------|
| Line 1 | `{process_name} {status_badge} {context_percent}% ctx {n}ag` | `{process}/{session} [{status_badge}]` |
| Line 2 | `Tasks: {done}/{total} done {markers}` | `{model} \| {tokens}/{max} \| {n} subagents` |
| Line 3 | `R:{n} E:{n} B:{n} \| {t}t \| {model}` | `on {branch}@{commit} (and wt ...)` |
| Line 4 | `{session_purpose}` | `{session_purpose}` |
| Line 5 | (not present) | `Tasks: {done}/{total} done {markers}` |

Tool stats (`R:n E:n B:n`) are moved to the detail pane at full tier.
They are useful for debugging but not for the at-a-glance dashboard.

> NOTE(mjr/sprack-trouble): Three architectural decisions from user feedback:
> 1. **Detail panel removal**: The detail panel is removed entirely. Widget content renders as nested child TreeItems within the pane node (making it a non-leaf node with expandable children), not as a separate split panel. This is a single unified tree view.
> 2. **Default expanded tree**: The sprack TUI starts with all tree nodes expanded by default, not collapsed. This applies to both the live TUI and the `--dump-rendered-tree` output.
> 3. **Widget as tree items**: Multi-line widget content (model, tokens, git context, purpose, tasks) are each child nodes of the pane TreeItem rather than multi-line Text in a single leaf node. This integrates naturally with the tree's expand/collapse mechanics.

## Implementation Notes

### Phase 1: Session Name + Token Counts

Minimal changes, no new data collection:
1. Thread session name from `Pane` to pane label construction.
2. Add `tokens_used` and `tokens_max` to `ClaudeSummary`, populate in `build_summary()`.
3. Update pane label formatting functions to use the new layout.

### Phase 2: Git Context

Requires new data collection:
1. Implement git state reader in sprack-claude (Option B: direct inspection).
2. Add git fields to `ClaudeSummary`.
3. Add line 3 rendering to pane widget.

### Phase 3: Worktree Branches

Extension of Phase 2:
1. Implement `git worktree list` reader with caching.
2. Render worktree branches at full tier.

## Open Questions

1. **Compact tier scoped name truncation**: `claude/my-long-session-name` may exceed compact tier width.
   Should the session name be truncated, or should compact tier show bare `claude` as today?
   Recommendation: truncate the session name to fit, with ellipsis.

2. **Git context for non-git directories**: Some Claude sessions may operate outside git repositories.
   Line 3 is simply omitted, and the widget renders as 4 lines (or fewer).

3. **Branch name length**: Feature branches like `feat/sprack-claude-widget-restyle-proposal` are long.
   Truncation strategy needed: truncate to available width minus commit hash, with ellipsis.

> TODO(opus/sprack-widget-restyle): Evaluate whether the tool stats line (`R:n E:n B:n`) should be an optional 6th line at full tier, or remain detail-pane-only.
