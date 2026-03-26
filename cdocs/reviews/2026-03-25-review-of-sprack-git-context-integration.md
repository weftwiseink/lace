---
review_of: cdocs/proposals/2026-03-25-sprack-git-context-integration.md
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T14:00:00-07:00
task_list: terminal-management/sprack-git-context
type: review
state: live
status: done
tags: [fresh_agent, architecture, git, sprack, bare_repo]
---

# Review: sprack Git Context Integration

## Summary Assessment

This proposal designs git repository context (branch, commit, worktrees, dirty state) for the sprack Claude widget, collected in sprack-claude via direct file inspection rather than subprocess calls.
The overall approach is sound and well-motivated, the phasing is logical, and the bare-repo worktree resolution logic is correctly described.
Two issues warrant attention before implementation: a gap in the mtime caching architecture (cache state has no home in `SessionFileState`), and an underspecified edge case in the bare-repo walk that could produce incorrect parent resolution.
The proposal is close to implementation-ready with targeted revisions.

## Section-by-Section Findings

### Design / Display Format

The `on {branch}@{commit} (wt {branches...})` format is clear and compact.
The tier table (Compact/Standard omit, Wide shows branch+commit, Full shows worktrees) is coherent with the existing tier system observed in `tree.rs`.

The display spec notes branch names are truncated with ellipsis.
The proposal does not specify what the available width budget is for the branch name at Wide vs Full tier, or whether the commit hash participates in width accounting.
This is a minor gap: the implementation will need a budget, and leaving it entirely to the implementer creates inconsistency risk.

**Non-blocking**: Specify the branch name truncation budget (character count or derivation rule) in the Display Format section, consistent with how other lines use `truncate_label`.

### Data Collection / Architecture Decision: Direct File Inspection

The rationale for direct inspection over hooks is solid.
The comparison table is accurate.
The hook-bridge NOTE callout appropriately scopes future work.

### Data Collection / Reading Git State Without Subprocesses

**Branch name**: The `.git/HEAD` parsing logic is correct.
Reading `ref: refs/heads/{branch}` covers the normal case; raw SHA covers detached HEAD.

**Commit hash**: The two-strategy approach (loose ref first, subprocess fallback for packed refs) is sound.
The NOTE on packed-refs prevalence is accurate - `git gc` or `git pack-refs` will consolidate loose refs into `.git/packed-refs`, and this is common in repos with a long history.
The proposal mentions parsing `.git/packed-refs` directly as an alternative but doesn't commit to it.

**Non-blocking**: Consider implementing `.git/packed-refs` parsing directly instead of subprocess fallback.
The format is simple (`{sha} refs/heads/{branch}` per line, with `^{sha}` peeled lines to skip).
This would make the implementation entirely subprocess-free in Phase 1, which is a stronger guarantee than "subprocess only for minority case".
If the implementer prefers the subprocess fallback for simplicity, the WARN callout should note that subprocess spawn has a non-trivial startup cost on Linux (typically 5-15ms), which is acceptable per cycle but worth measuring.

**Worktree enumeration**: The description is correct.
The WARN about linked worktrees having a `.git` file (not directory) is accurate and important.

### Data Collection / Bare Repository Awareness

This is the most technically complex section.
The four-step walk is:
1. Read `.git` in cwd.
2. If it's a file, parse `gitdir:` to find the actual git dir (e.g., `{bare_repo}/worktrees/{name}`).
3. Walk up from the gitdir to find the parent bare repo (the directory containing `worktrees/`).
4. Enumerate worktrees from there.

Step 3 is underspecified.
"Walking up from the gitdir" to find the bare repo root assumes the gitdir path always has `worktrees/` as an intermediate directory component.
In the standard layout (`{bare_repo}/worktrees/{name}`), this is true: `parent().parent()` from the worktree-specific gitdir yields the bare repo root.
However, the proposal doesn't state this concretely - it says "walking up" which could imply a loop scanning for `worktrees/` existence.

**Blocking**: Clarify step 3 of the bare-repo walk.
The correct approach for `gitdir: {bare_repo}/worktrees/{name}` is: the gitdir points to `{bare_repo}/worktrees/{name}`, so `gitdir.parent()` gives `{bare_repo}/worktrees/`, and `gitdir.parent().parent()` gives the bare repo root.
This is a direct path computation, not a loop.
The proposal should state this explicitly, because an iterative "walk up until you find a `worktrees/` dir" approach would break when the repo is nested inside a directory named `worktrees/`.

Additionally, the section says "the bare repo's `HEAD` may point to a default branch that no worktree uses."
This is correct but the implication is unaddressed: when enumerating worktrees, the bare repo's own `HEAD` should not be included in the worktree list (it's not a checked-out worktree).
Only the entries under `worktrees/*/HEAD` represent actual linked worktrees.

**Non-blocking**: Add a note confirming that the bare repo's own `HEAD` is excluded from worktree enumeration (it is not a linked worktree entry and would show a stale/default branch).

### Data Collection / Working Directory Source

The distinction between local panes (`/proc/{pid}/cwd`) and container panes (bind-mount heuristics) is correct.
The WARN about container pane complication is appropriate and the recommendation to defer to Phase 2 is sound.

One gap: the proposal says container panes resolve cwd via "workspace prefix matching" against bind-mounted `~/.claude/projects/`, but the git root may be above the workspace directory.
For example, if the cwd is `~/projects/myrepo/packages/sprack` and the git root is `~/projects/myrepo`, the git resolution needs to walk upward from cwd to find `.git`.
This is true for local panes as well, but the proposal assumes the cwd is the git root.

**Blocking**: The proposal must address git root discovery by walking up from cwd until `.git` is found (or filesystem root is reached without finding one).
The current spec implies `read_git_head(cwd)` is called directly on the resolved cwd, but cwd is rarely the git root.
`resolve_git_dir(cwd)` in Phase 1's implementation list does include following `.git` file indirection, but does not mention the upward walk from cwd to find `.git` in the first place.
This is a significant omission that will cause the feature to silently return no git context for any session not running in the git root directory.

### Data Collection / Refresh Frequency

The mtime guard design is correct in principle: `stat()` the mtime of `.git/HEAD`, skip re-read when unchanged.

**Blocking**: The proposal describes caching `(mtime, GitState)` per pane, but `SessionFileState` (in `session.rs`) has no field for this.
The proposal's Phase 1 implementation step 4 says "add mtime caching: store `(mtime, GitState)` in the session cache", but doesn't identify where exactly this state lives.
`SessionFileState` is the natural home (it's the per-pane cache), but adding git-specific fields there couples session state to git state in a single struct that's already getting large.
The proposal should either:
(a) Specify adding `git_mtime: Option<SystemTime>` and `git_state: Option<GitState>` fields to `SessionFileState`, accepting the coupling, or
(b) Introduce a parallel `GitStateCache: HashMap<String, (SystemTime, GitState)>` keyed by pane_id in the poll loop, mirroring the session_cache pattern.
Neither is clearly wrong, but leaving this unresolved creates implementation ambiguity.

The `.git/worktrees/` directory mtime guard for worktree enumeration is sound.

### ClaudeSummary Schema Changes

The four new fields (`git_branch`, `git_commit_short`, `git_worktree_branches`, `git_dirty`) all use `Option` with `#[serde(default)]`.
This is correct for backward compatibility - the existing deserialization test in `status.rs` (`test_summary_deserialization_backward_compatible`) will cover old JSON without these fields.

The stash confirms `git_branch` and `git_commit_short` are already stubbed in `ClaudeSummary`, but `git_worktree_branches` and `git_dirty` are not yet added.
The TUI-side `ClaudeSummary` in `tree.rs` also mirrors the sprack-claude struct and will need the same additions.

**Non-blocking**: The proposal notes "Add corresponding fields to the TUI's `ClaudeSummary` deserializer" in Phase 1 step 6.
Since the TUI deserializes with `#[serde(default)]`, the fields silently default to `None` if missing, which means the TUI will not break during the transition even before step 6 is done.
This is an implementation convenience worth noting explicitly so the implementer understands the ordering is flexible.

### Implementation / Phase 1

The Phase 1 scope (local panes, branch + commit) is correct.
The function signatures proposed (`read_git_head`, `read_commit_short`, `resolve_git_dir`) are sensible.

The success criterion (`sprack --dump-rendered-tree` shows `on main@a1b2c3d`) is clear and testable.

**Non-blocking**: The `process_cwd` available in `process_claude_pane` is obtained indirectly: it's computed during session resolution but not stored on `SessionFileState`.
The git resolution needs the cwd, which means either storing it on `SessionFileState` or re-computing it from `/proc/{pid}/cwd` each cycle.
Re-computing is cheap but creates a second proc walk.
The proposal should specify which approach is used.

### Implementation / Phase 2

Phase 2 (worktree enumeration) correctly scopes to local panes.
The success criterion is adequate.

**Non-blocking**: Phase 2 step 2 says "Handle bare repo layout: resolve from worktree gitdir up to bare repo root."
This is the same underspecified walk described in the Bare Repository Awareness section.
The clarification needed there applies here too.

### Implementation / Phase 3

Phase 3 (dirty state, `git status --porcelain`) is correctly scoped as opt-in with a 10-second rate limit.
The WARN about large repo latency is accurate.

The `--untracked-files=no` suggestion is a good cost-reduction option.
For the lace use case (tracked workspaces, active Claude sessions), untracked files are often transient and less interesting than staged/modified tracked files.
Defaulting to `--untracked-files=no` with the full check as a config option would be a better default than the reverse.

**Non-blocking**: Consider defaulting Phase 3 to `git status --porcelain --untracked-files=no` rather than presenting it as a fallback.
Untracked files are the dominant source of `git status` latency in large repos and are the least actionable category for the widget's purpose.

### Open Questions

All four open questions are addressed appropriately.
Q1 (container git context deferral) and Q2 (submodule handling) are well-reasoned.
Q3 (non-git directories) is trivial.
Q4 (performance ceiling) is correctly analyzed.

**Non-blocking**: Q2 (submodule handling) notes the resolver will show whatever `.git/HEAD` resolves to in the cwd.
For a submodule, the `.git` file points to the parent's `.git/modules/{name}` directory.
`resolve_git_dir` will follow this correctly.
However, the worktree enumeration (Phase 2) will then look for `worktrees/` relative to the submodule's git dir, not the parent repo's git dir.
This is correct behavior (submodule worktrees are separate from parent repo worktrees), but it means the worktree list for a submodule session will always be empty even if the parent repo has linked worktrees.
This edge case could confuse users.
A NOTE acknowledging this in the proposal would help implementers avoid trying to "fix" it.

## Verdict

**Revise.** Two blocking issues must be addressed:

1. The bare-repo walk (step 3) must be made concrete to avoid an incorrect iterative implementation.
2. The git root discovery (walking up from cwd to find `.git`) is missing from the design and will cause silently absent git context for the common case where Claude runs in a project subdirectory.
3. The mtime cache state must be assigned a concrete home in the data model.

The non-blocking suggestions are improvements but not required for acceptance.

## Action Items

1. [blocking] Specify that bare-repo root resolution is `gitdir.parent().parent()` (not an iterative walk), and add a note ruling out false positives from repos nested under a directory named `worktrees/`.
2. [blocking] Add git root discovery: `resolve_git_dir(cwd)` must first walk up from cwd, checking each ancestor for a `.git` entry, before attempting to follow `.git` file indirection. Without this, git context will be silently absent whenever Claude's cwd is not the git root.
3. [blocking] Specify where git mtime cache state lives: either add `git_mtime`/`git_state` fields to `SessionFileState`, or introduce a parallel `HashMap` in `run_poll_cycle`. Document the choice and rationale.
4. [non-blocking] Clarify that the bare repo's own `HEAD` is excluded from the worktree enumeration result (it is not a linked worktree and would reflect a stale default branch).
5. [non-blocking] Specify the branch name truncation budget (character count) for Wide and Full tiers, consistent with existing `truncate_label` usage.
6. [non-blocking] Specify whether `process_cwd` is re-read from `/proc` per cycle for git resolution or stored on `SessionFileState`.
7. [non-blocking] Consider implementing `.git/packed-refs` parsing directly rather than subprocess fallback, to make Phase 1 entirely subprocess-free.
8. [non-blocking] Default Phase 3 to `--untracked-files=no` rather than making it an opt-in cost-reduction.
9. [non-blocking] Add a NOTE on submodule worktree enumeration behavior (will always be empty; this is correct, not a bug).
