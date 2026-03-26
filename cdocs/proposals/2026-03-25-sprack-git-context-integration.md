---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T12:00:00-07:00
task_list: terminal-management/sprack-git-context
type: proposal
state: live
status: review_ready
last_reviewed:
  status: revision_requested
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T14:00:00-07:00
  round: 1
tags: [sprack, git, ux_design, data_collection]
---

# sprack Git Context Integration

> BLUF(opus/sprack-git-context): Add git repository context to the sprack Claude widget: branch name, short commit hash, worktree enumeration, and dirty state.
> Data collection happens in sprack-claude during the poll cycle by reading `.git/HEAD` and related files directly, avoiding subprocess calls for the common case.
> The working directory is already resolved via `/proc` for local panes and via bind-mount heuristics for container panes.
> Three implementation phases: (1) branch + commit hash, (2) worktree enumeration, (3) dirty state indicator.

## Problem

The sprack Claude widget shows session state (model, tokens, subagent count, task progress) but no git context.
When multiple Claude sessions operate across worktrees of the same repository, the branch name is the fastest way to distinguish which session is working where.
Without git context, the user must mentally map session names to branches, or switch to a terminal to run `git branch`.

The [widget restyle proposal](2026-03-24-sprack-claude-widget-restyle.md) defines a git context line in the target layout but defers the data collection design to a separate proposal.
This proposal fills that gap.

## Design

### Display Format

The git context renders as a dedicated line in the Claude widget:

```
on feat/inline-summaries@a1b2c3d (wt main, fix/hotfix)
```

Components:
- `feat/inline-summaries`: current branch name (from HEAD)
- `a1b2c3d`: short commit hash (7 characters)
- `(wt main, fix/hotfix)`: other worktree branches, if any

When the working directory is not a git repository, the line is omitted entirely.
When HEAD is detached, the branch portion shows `HEAD` and the commit hash alone provides identification.

### Per-Tier Rendering

| Tier | Git Context |
|------|-------------|
| Compact | Omitted |
| Standard | Omitted |
| Wide | `on {branch}@{commit}` (no worktrees) |
| Full | `on {branch}@{commit} (wt {branches...})` |

Branch names are truncated with ellipsis to fit available width.
The commit hash is always 7 characters and never truncated.

### Dirty State Indicator (Phase 3)

A `*` suffix on the branch name indicates uncommitted changes:

```
on feat/inline-summaries*@a1b2c3d (wt main, fix/hotfix)
```

This mirrors the convention used by git's own `__git_ps1` prompt function and is immediately recognizable to developers.

## Data Collection

### Architecture Decision: Direct File Inspection

Git state is collected in sprack-claude during the poll cycle, not in the TUI.
This keeps all data collection centralized in one daemon and uses the same `ClaudeSummary` JSON path as everything else.

Two approaches were evaluated:

| Approach | Pros | Cons |
|----------|------|------|
| Hook-based (PostToolUse) | Updates only on tool calls, captures state at moment of work | Requires hook config, stale between calls, adds hook latency |
| Direct inspection | No dependencies, always fresh, works without Claude Code config | Adds I/O per poll cycle |

Direct inspection is the chosen approach.
It has zero configuration requirements and leverages the working directory already resolved via `/proc/{pid}/cwd` (local panes) or bind-mount matching (container panes).

> NOTE(opus/sprack-git-context): Hook-based collection could supplement direct inspection in the future.
> The hook event bridge infrastructure from the [hook event bridge proposal](2026-03-24-sprack-hook-event-bridge.md) would provide the transport.
> For now, direct inspection is sufficient and simpler.

### Reading Git State Without Subprocesses

The common case (branch + commit hash) can be resolved by reading files directly, avoiding `git` subprocess overhead entirely.

#### Branch Name

Read `.git/HEAD`:
- If it contains `ref: refs/heads/{branch}`, extract `{branch}`.
- If it contains a raw SHA, HEAD is detached: use `"HEAD"` as the branch name.

#### Commit Hash

Two strategies, tried in order:
1. If `.git/HEAD` points to a ref, read `.git/refs/heads/{branch}` for the full SHA, then truncate to 7 characters.
2. If the ref file does not exist (packed refs), fall back to `git rev-parse --short HEAD` subprocess.

> NOTE(opus/sprack-git-context): Packed refs are common in large repositories after `git gc`.
> The subprocess fallback is acceptable because it only triggers when the loose ref file is absent, which is a minority case.
> An alternative is to parse `.git/packed-refs` directly, but the format is simple enough that either approach works.

#### Worktree Enumeration

Read the `.git/worktrees/` directory:
- Each subdirectory represents a linked worktree.
- Read `{worktree_dir}/HEAD` to get each worktree's branch.
- Filter out the current branch (already displayed) and any bare/detached worktrees.

> WARN(opus/sprack-git-context): This approach only works from the main worktree's `.git` directory.
> Linked worktrees have a `.git` _file_ (not directory) pointing to `{main_gitdir}/worktrees/{name}`.
> The resolver must follow this indirection to reach the main `.git` directory for worktree enumeration.

#### Bare Repository Awareness

Lace uses bare repos with worktrees (`core.bare = true`).
In a bare repo layout:
- The working directory contains a `.git` file pointing to `{bare_repo}/worktrees/{name}`.
- The bare repo's `HEAD` may point to a default branch that no worktree uses.
- Worktree enumeration starts from the bare repo root, not from `.git/`.

The resolver handles this by:
1. Reading `.git` in the working directory.
2. If it's a file, parsing the `gitdir:` line to find the actual git directory.
3. Walking up from the gitdir to find the parent bare repo (the directory containing `worktrees/`).
4. Enumerating worktrees from there.

### Working Directory Source

sprack-claude already resolves the working directory for each Claude pane:
- **Local panes**: `proc_walk::read_process_cwd(claude_pid)` reads `/proc/{pid}/cwd`.
- **Container panes**: The `LaceContainerResolver` matches against workspace paths in the bind-mounted `~/.claude/projects/` directory.

For local panes, the cwd from `/proc` is the exact directory where git inspection should happen.
For container panes, the cwd is a host-side path into the bind mount, not the container-internal path.
Git files (`.git/HEAD`, etc.) are accessible through the bind mount if the container's workspace is mounted with the `.git` directory visible.

> WARN(opus/sprack-git-context): Container panes present a complication.
> The `.git` directory may not be bind-mounted into the container, or the bind-mount path may differ from the actual git root.
> Phase 1 targets local panes only.
> Container git context requires verifying that the workspace bind mount includes `.git` and that the resolved host-side path is correct.

### Refresh Frequency

Git state (branch, commit) changes infrequently relative to the 2-second poll cycle.
Checking every poll cycle wastes I/O on unchanged data.

Strategy: check `.git/HEAD` mtime on every poll cycle (a single `stat()` call).
Only re-read the full git state when the mtime changes or on initial discovery.
This reduces steady-state overhead to one `stat()` per pane per cycle.

For worktree enumeration, check `.git/worktrees/` directory mtime.
Worktree topology changes even less frequently than branches.

The `stat()` approach is preferable to a cycle counter because it adapts to actual change frequency rather than imposing an arbitrary interval.

## ClaudeSummary Schema Changes

New fields on `ClaudeSummary`:

```rust
/// Current git branch name (e.g., "feat/inline-summaries").
/// "HEAD" when detached.
#[serde(default)]
pub git_branch: Option<String>,

/// Short commit hash (e.g., "a1b2c3d").
#[serde(default)]
pub git_commit_short: Option<String>,

/// Other worktree branch names, if any.
#[serde(default)]
pub git_worktree_branches: Option<Vec<String>>,

/// Whether the working tree has uncommitted changes.
#[serde(default)]
pub git_dirty: Option<bool>,
```

All fields are `Option` with `#[serde(default)]` for backward compatibility.
When the working directory is not a git repository, all fields are `None` and the git context line is omitted from the widget.

## Implementation

### Phase 1: Branch + Commit Hash

Scope: local panes only.

1. Add a `git` module to `sprack-claude` with functions:
   - `read_git_head(cwd: &Path) -> Option<GitHead>` where `GitHead` is `Branch(String)` or `Detached(String)`.
   - `read_commit_short(cwd: &Path, branch: &str) -> Option<String>`: reads loose ref, falls back to `git rev-parse`.
   - `resolve_git_dir(cwd: &Path) -> Option<PathBuf>`: follows `.git` file indirection for worktrees/bare repos.
2. Add `git_branch` and `git_commit_short` to `ClaudeSummary` in `sprack-claude/src/status.rs`.
3. Call git resolution in `process_claude_pane()` after session file resolution, using the same `process_cwd` from `/proc`.
4. Add mtime caching: store `(mtime, GitState)` in the session cache, skip re-read when mtime is unchanged.
5. Add the git context line to `format_rich_widget()` in `sprack/src/tree.rs`, between the model/tokens line and the session purpose line.
6. Add corresponding fields to the TUI's `ClaudeSummary` deserializer.

**Success criteria**: `sprack --dump-rendered-tree` output includes `on main@a1b2c3d` for a Claude pane in a git repository.

### Phase 2: Worktree Enumeration

Scope: local panes, repos with linked worktrees.

1. Add `enumerate_worktrees(git_dir: &Path) -> Vec<String>`: reads `.git/worktrees/*/HEAD`, extracts branch names.
2. Handle bare repo layout: resolve from worktree gitdir up to bare repo root.
3. Add `git_worktree_branches` to `ClaudeSummary`.
4. Render worktree branches at Full tier: `(wt main, fix/hotfix)`.
5. Cache worktree list with `.git/worktrees/` mtime guard.

**Success criteria**: `sprack --dump-rendered-tree` at Full tier shows worktree branches for a repo with linked worktrees.

### Phase 3: Dirty State Indicator

Scope: local panes, opt-in (higher cost).

1. Run `git status --porcelain` (subprocess, unavoidable for reliable dirty detection).
2. Store result as `git_dirty: Option<bool>` on `ClaudeSummary`.
3. Render as `*` suffix on branch name: `feat/inline-summaries*@a1b2c3d`.
4. Rate-limit: run `git status` at most once every 10 seconds per pane, not every poll cycle.
   Use a last-checked timestamp alongside the mtime guard.

> WARN(opus/sprack-git-context): `git status --porcelain` can be slow in large repositories with many untracked files.
> The 10-second rate limit mitigates this, but repositories with expensive `.gitignore` patterns may still cause latency spikes.
> Consider `git status --porcelain --untracked-files=no` to reduce cost, at the expense of not detecting new untracked files.

**Success criteria**: branch name shows `*` suffix when uncommitted changes exist.

## Open Questions

1. **Container pane git context**: Container panes resolve session files via bind-mount heuristics, not `/proc` cwd.
   The host-side path to the workspace may or may not include `.git`.
   Should Phase 1 attempt container git context, or defer it?
   Recommendation: defer to Phase 2 or later, since the bind-mount path resolution needs validation.

2. **Submodule handling**: Submodules have their own `.git` (file pointing to parent's `.git/modules/`).
   Should the git context show the submodule's branch or the parent repo's?
   Recommendation: show whatever `.git/HEAD` resolves to in the working directory, which is the submodule's branch.

3. **Git context for non-git directories**: Some Claude sessions operate outside git repositories (e.g., system config editing).
   The git context line is simply omitted.
   No special handling needed.

4. **Performance ceiling**: With 10+ concurrent Claude sessions, each needing `stat()` calls per cycle, is there a measurable impact?
   `stat()` is fast (microseconds), so 10 calls per 2-second cycle is negligible.
   The `git rev-parse` subprocess fallback is the only concern, and it triggers rarely (packed refs only).

## Relationship to Other Proposals

- **[Widget Restyle](2026-03-24-sprack-claude-widget-restyle.md)**: Defines the target layout with git context on line 3. This proposal specifies the data collection and rendering for that line.
- **[Hook Event Bridge](2026-03-24-sprack-hook-event-bridge.md)**: Could provide an alternative/supplementary git data source in the future. Not required for this proposal.
- **[Inline Summaries](2026-03-24-sprack-inline-summaries.md)**: Established the multi-line widget architecture. Git context integrates as an additional line within that architecture.
