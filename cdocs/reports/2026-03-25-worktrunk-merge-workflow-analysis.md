---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T12:00:00-07:00
task_list: tooling/worktrunk-merge-safety
type: report
state: live
status: review_ready
tags: [tooling, git, workflow, incident]
---

# Worktrunk Merge Workflow Analysis

> BLUF: `wt merge` merges the **current branch into the target**, not the other way around.
> This is the opposite of `git merge` semantics and the likely cause of the incident: running `wt merge` from the main worktree squash-merged main's history into the feature branch, then fast-forwarded the feature to include all of main.
> The worktree was removed as part of the merge cleanup step.
> The correct workflow is: always `cd` into (or `wt switch` to) the **feature worktree** before running `wt merge`.

## Context / Background

The user ran a worktrunk merge that squash-merged main into a feature branch instead of merging the feature into main.
The worktree folder was also removed as part of the merge cleanup.
This report documents the exact git operations `wt merge` performs, what went wrong, and the safe workflow going forward.

## Worktrunk Merge: Exact Operations

`wt merge [TARGET]` runs this pipeline from the **current worktree**:

1. **Squash**: stages uncommitted changes, combines all commits since diverging from TARGET into one commit (with LLM-generated message). Saves a backup ref to `refs/wt-backup/<branch>`.
2. **Rebase**: rebases the current branch onto TARGET if behind. Conflicts abort immediately.
3. **Pre-merge hooks**: run after rebase, before merge. Failures abort.
4. **Fast-forward merge**: updates TARGET's ref to point at the current branch's HEAD. Non-fast-forward merges are rejected.
5. **Pre-remove hooks**: run before worktree deletion.
6. **Cleanup**: removes the current worktree and deletes the branch. Switches back to the target worktree.
7. **Post-merge hooks**: run after cleanup (failures logged, don't abort).

The critical design point: **`wt merge` merges current into target**.
This is stated explicitly in the help text: "Unlike `git merge`, this merges current into target (not target into current). Similar to clicking 'Merge pull request' on GitHub, but locally."

The `step push` subcommand (used internally by merge) is equivalent to `git push . HEAD:<target>` - it fast-forwards the target branch to include the current branch's commits.

## What Went Wrong

The `wt list` output shows forensic evidence:

```
  user-fun    !  *    +4  -2K   ↑6 ↓12   2e921523  10h
  usefun-real      _                      7bee85ae  10m
```

`user-fun` is 2K commits behind main and 4 ahead.
`usefun-real` is at the same commit as main (`_`).

The most likely scenario: the user ran `wt merge` while in the **main worktree** (or with main as the current branch), with the feature branch as the target.
This caused worktrunk to:
1. Squash main's divergent commits into a single commit on main.
2. Rebase main onto the feature branch.
3. Fast-forward the feature branch to main's HEAD.

The result: main's entire commit history got squash-merged into the feature branch direction, and the worktree was cleaned up.

An alternative scenario: the user ran `wt merge` from the feature worktree but accidentally passed `main` as a target when the branch was already on main, or ran it from the wrong directory.
In either case, the directionality confusion is the root cause.

## Key Findings

- `wt merge` has **inverted semantics** compared to `git merge`. With `git merge feature`, you pull feature into your current branch. With `wt merge main`, you push your current branch into main.
- The TARGET argument defaults to the default branch (main). Running bare `wt merge` from a feature worktree does the right thing: merges feature into main.
- Running `wt merge` from the main worktree is dangerous: it tries to merge main into... main (or into whatever target you specify, treating main as the source).
- The cleanup step removes the source worktree automatically. There is no confirmation prompt unless you omit `-y`.
- Backup refs are saved to `refs/wt-backup/<branch>`, but only for the squash step. No backup refs were found in this repo, suggesting the merge may have been a no-op squash or the refs were cleaned up.
- The `--no-remove` flag preserves the worktree after merge but must be specified proactively.

## Footguns and UX Ambiguities

1. **Inverted merge direction is the primary footgun.** Every other git tool (including GitHub's merge button from the user's perspective) frames merge as "merge X into Y" where you specify the source. Worktrunk frames it as "merge current into TARGET" where you specify the destination. The help text documents this, but muscle memory from `git merge` works against it.

2. **No guard against merging from the default branch.** `wt merge` from the main worktree should arguably refuse or warn, since merging main into something else is almost never the intent. There is no such guard.

3. **Worktree removal is the default.** The cleanup step removes the worktree directory. Combined with the directional confusion, this means the wrong worktree disappears.

4. **`-y` skips all prompts.** Without `-y`, worktrunk shows the squash commit message for approval, which is a checkpoint where the user might notice something wrong (e.g., the commit message summarizes thousands of main commits instead of a small feature diff). With `-y`, that checkpoint is gone.

5. **The "step" subcommands share the same directional model.** `wt step push` fast-forwards the target to the current branch. Consistent with `wt merge`, but reinforces the inverted mental model.

## Safe Merge Workflow

### Standard: merge feature into main

```sh
# 1. Switch to the feature worktree
wt switch my-feature

# 2. Verify you're in the right place
wt list                    # @ marker should be on my-feature

# 3. Merge into main (default target)
wt merge                   # no target needed, defaults to main

# Worktrunk will:
#   - squash feature commits
#   - rebase onto main if needed
#   - fast-forward main to include feature
#   - remove the feature worktree
#   - switch you to the main worktree
```

### Conservative: keep worktree, inspect before cleanup

```sh
wt switch my-feature
wt merge --no-remove       # merge but keep the worktree
wt list                    # verify main has the commits
wt remove my-feature       # clean up manually
```

### Manual step-by-step: full control

```sh
wt switch my-feature
wt step squash             # review the squash commit message
wt step rebase             # rebase onto main
wt step push               # fast-forward main
wt remove                  # clean up worktree
```

### Pre-flight checklist

Before any `wt merge`:
1. Run `wt list` and confirm the `@` marker is on the **feature branch**, not main.
2. Confirm the `HEAD+` and `main^` columns look reasonable (small diff, not thousands of commits).
3. If not using `-y`, read the squash commit message carefully: if it describes the entire history of main, abort.

## Recommendations

- **Always run `wt merge` from the feature worktree.** The mental model is: "I am on feature, I want to merge myself into main."
- **Avoid `-y` until the workflow is habitual.** The squash message approval prompt is a useful safety net.
- **Use `wt list` before merging** to confirm directionality. The `@` marker and commit counts make the state obvious.
- **Consider `--no-remove` for high-stakes merges.** Inspect the result before the worktree disappears.
- **Recovery**: if a bad merge happens, the branch's pre-squash state may be in `refs/wt-backup/<branch>`. Check with `git for-each-ref refs/wt-backup/`. The target branch can be reset with `git branch -f main <correct-sha>` if caught quickly.

> NOTE(opus/tooling): Worktrunk could benefit from a guard that warns or refuses when `wt merge` is run from the default branch worktree.
> This is worth filing as a feature request at github.com/max-sixty/worktrunk.
