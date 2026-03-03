---
title: "PR Merge Attribution Strategy for resurrect.wezterm Fork"
first_authored:
  by: "@claude"
  at: "2026-03-01T12:00:00-06:00"
type: report
subtype: analysis
state: archived
status: done
tags: [git, workflow, attribution, fork-management, resurrect-wezterm]
related_to:
  - cdocs/reports/2026-03-01-wezterm-config-and-plugin-state.md
  - cdocs/reports/2026-02-04-wezterm-plugin-research.md
---

# PR Merge Attribution Strategy for resurrect.wezterm Fork

> BLUF: The cleanest way to merge open PRs from `MLFlexer/resurrect.wezterm` into the
> `micimize/resurrect.wezterm` fork is **`curl .patch | git am`** -- GitHub's `.patch`
> URL produces `git am`-compatible mbox format that preserves original author, date, and
> commit message with zero manual attribution work. This was verified against all 6 open
> PRs. Multi-commit PRs are handled automatically. For conflicting patches, `git am --3way`
> falls back to standard three-way merge with conflict markers. The fork is currently
> identical to upstream (same HEAD at `47ce553`), so all patches apply cleanly against the
> current base.

## Context

The fork at `/home/mjr/code/libraries/resurrect.wezterm` (`micimize/resurrect.wezterm`)
tracks `MLFlexer/resurrect.wezterm` as its GitHub parent. As of 2026-03-01, the fork's
`main` branch is identical to upstream -- zero divergence in either direction. There are
6 open PRs against the upstream repo that may contain useful fixes we want to adopt
selectively in our fork without waiting for upstream review.

### Open PRs (as of 2026-03-01)

| PR  | Author          | Commits | Files Changed                              | Title                                              |
|-----|-----------------|---------|--------------------------------------------|----------------------------------------------------|
| 134 | lowjoel         | 1       | state_manager.lua, utils.lua               | fix: Windows compatibility for paths and file names |
| 130 | vike2000        | 2       | init.lua, utils.lua                        | Fix #125                                           |
| 128 | andreystepanov  | 1       | pane_tree.lua                              | Sanitize `/nix/store/*` paths in saved argv        |
| 127 | tdragon         | 1       | pane_tree.lua                              | fix(pane_tree): prevent nil pane access             |
| 123 | userux          | 2       | init.lua, tab_state.lua, window_state.lua  | Fix/module resurrect not found                     |
| 118 | fvalenza        | 1       | workspace_state.lua                        | Fix workspace name when restoring                  |

### Conflict Map (PRs touching the same files)

- **utils.lua**: PR #134 and PR #130 both modify `ensure_folder_exists`. They conflict --
  verified by applying #130 then attempting #134, which fails even with `--3way`.
- **pane_tree.lua**: PR #128 and PR #127 both modify `pane_tree.lua` but at different
  locations in the file (lines 75 vs 101). They should apply cleanly in sequence.
- **init.lua**: PR #130 and PR #123 both modify `init.lua`. PR #130's second commit
  changes the `keywords` table; PR #123 also changes `keywords`. They would conflict.

---

## Approaches Evaluated

### Approach A: GitHub `.patch` URL + `git am` (Recommended)

GitHub auto-generates a `.patch` URL for every PR at:
```
https://github.com/<owner>/<repo>/pull/<N>.patch
```

This produces standard `git am`-compatible mbox format with full metadata:
```
From eca8ed3d20c3... Mon Sep 17 00:00:00 2001
From: Joel Low <joel@joelsplace.sg>
Date: Sun, 1 Feb 2026 15:04:13 +0800
Subject: [PATCH] fix: Windows compatibility for paths and file names
```

**Verified behavior:**
- Single-commit PRs: produces one patch with correct `From:` header.
- Multi-commit PRs: produces sequential `[PATCH 1/N]`, `[PATCH 2/N]` entries, each with
  its own author/date/message. `git am` applies them as separate commits.
- Author attribution: the `Author` field on the resulting git commit matches the PR
  author exactly (verified: `tdragon <1210261+tdragon@users.noreply.github.com>`).
- The `Committer` field is set to whoever runs `git am` (you), which is standard git
  behavior and the correct semantic -- the author wrote it, you committed it to this repo.

**Pros:**
- Preserves original author, date, and full commit message automatically.
- Standard git workflow; no custom tooling needed.
- Works for both single-commit and multi-commit PRs.
- No leftover remotes or branches to clean up.
- `git log --format='%an <%ae>'` correctly shows the original author.
- `git log --format='%cn <%ce>'` correctly shows you as the committer.

**Cons:**
- Patch application is positional -- if other patches have already modified the same
  region, it will fail. Mitigated by `--3way` (see conflict handling below).
- Very long commit messages from the PR author are preserved verbatim (PR #130's first
  commit message is 4 lines of URL-laden explanation).

### Approach B: Add PR Author's Fork as Remote + Cherry-Pick

```sh
git remote add lowjoel https://github.com/lowjoel/resurrect.wezterm.git
git fetch lowjoel
git cherry-pick <sha>
git remote remove lowjoel
```

**Pros:**
- Full three-way merge via cherry-pick gives better conflict resolution.
- Handles any commit topology (merge commits, rebases, etc.).
- You can cherry-pick a subset of commits from a multi-commit PR.

**Cons:**
- Requires knowing the fork URL and branch name for each PR author.
- Multiple remote add/fetch/remove cycles for multiple PRs.
- Cherry-pick changes the commit hash, same as `git am`.
- More commands per PR.
- Clutters reflog with remote tracking branches.

### Approach C: `gh pr checkout`

```sh
gh pr checkout 127 --repo MLFlexer/resurrect.wezterm
```

**Pros:**
- Simplest command -- `gh` handles remote addition automatically.
- Creates a local branch with the PR's commits.

**Cons:**
- Switches your working branch, which is disruptive.
- Designed for review workflows, not for cherry-picking into your fork.
- You still need to cherry-pick or merge the branch into your main.
- Adds a remote automatically but does not clean it up.

### Approach D: `gh pr diff` + `git apply` + Manual Attribution

```sh
gh pr diff 127 --repo MLFlexer/resurrect.wezterm | git apply
git commit --author="tdragon <1210261+tdragon@users.noreply.github.com>" -m "..."
```

**Pros:**
- Works even when `git am` fails (raw diff, no positional constraints from mbox format).
- You control the commit message.

**Cons:**
- Manual attribution -- you must look up the author name and email.
- Loses original commit message (you must copy it manually).
- Multi-commit PRs are squashed into a single diff with no commit boundaries.
- Error-prone; easy to forget `--author` or get the email wrong.

---

## Recommended Workflow

### Standard Case: Apply a Single PR

```sh
cd /home/mjr/code/libraries/resurrect.wezterm

# 1. Ensure you're on main and up to date
git checkout main
git pull

# 2. Fetch and apply the patch (preserves author attribution automatically)
curl -sL "https://github.com/MLFlexer/resurrect.wezterm/pull/127.patch" | git am

# 3. Verify attribution
git log --format='%h %an <%ae> %s' -1
# Expected: <sha> tdragon <1210261+tdragon@users.noreply.github.com> fix(pane_tree): ...
```

### Conflict Case: When `git am` Fails

```sh
# Use --3way to get merge conflict markers instead of a flat failure
curl -sL "https://github.com/MLFlexer/resurrect.wezterm/pull/134.patch" | git am --3way

# If conflicts arise:
# 1. Resolve conflicts in the affected files
# 2. Stage the resolved files
git add plugin/resurrect/utils.lua

# 3. Continue the am session (preserves original author from the patch)
git am --continue

# If you need to bail out entirely:
git am --abort
```

The `--3way` flag is critical: without it, `git am` uses pure textual patching which
fails hard on any context mismatch. With `--3way`, git reconstructs the base tree from
the patch's index lines and performs a real three-way merge, producing standard conflict
markers that can be resolved normally.

### Multi-Commit PRs

No special handling needed. The `.patch` URL for a multi-commit PR produces a
concatenated mbox with `[PATCH 1/N]` through `[PATCH N/N]`. `git am` processes them
sequentially, creating one commit per patch with the correct author for each.

If you want to selectively apply only some commits from a multi-commit PR, save the
patch to a file and split it:

```sh
curl -sL "https://github.com/MLFlexer/resurrect.wezterm/pull/130.patch" > /tmp/pr130.patch

# Inspect the patches
grep '^Subject:' /tmp/pr130.patch

# Use git mailsplit to separate into individual patches
mkdir /tmp/pr130-parts
git mailsplit -o/tmp/pr130-parts /tmp/pr130.patch

# Apply selectively
git am /tmp/pr130-parts/0001  # apply only the first commit
```

### Batch Application with Conflict Ordering

When applying multiple PRs, order matters for conflict avoidance. Based on the file
overlap analysis above, a safe ordering for the current 6 PRs would be:

```sh
# Group 1: No file overlaps with anything else
curl -sL ".../pull/118.patch" | git am        # workspace_state.lua only

# Group 2: pane_tree.lua (non-overlapping regions)
curl -sL ".../pull/127.patch" | git am        # pane_tree.lua (line 75)
curl -sL ".../pull/128.patch" | git am        # pane_tree.lua (line 101+)

# Group 3: Conflicting PRs -- pick one or resolve manually
# PR #130 and #134 both rewrite ensure_folder_exists in utils.lua
# PR #130 and #123 both modify init.lua keywords
# Choose which to apply first, then handle conflicts with --3way

curl -sL ".../pull/123.patch" | git am        # tab_state.lua, window_state.lua, init.lua
curl -sL ".../pull/130.patch" | git am --3way # utils.lua, init.lua (may conflict on init.lua)
curl -sL ".../pull/134.patch" | git am --3way # utils.lua, state_manager.lua (will conflict on utils.lua)
```

### Script: Apply a PR with Validation

```sh
#!/usr/bin/env bash
# Usage: apply-upstream-pr.sh <PR_NUMBER>
set -euo pipefail

PR_NUM="${1:?Usage: apply-upstream-pr.sh <PR_NUMBER>}"
REPO="MLFlexer/resurrect.wezterm"
PATCH_URL="https://github.com/${REPO}/pull/${PR_NUM}.patch"

echo "Fetching PR #${PR_NUM} from ${REPO}..."
PATCH=$(curl -sfL "$PATCH_URL") || { echo "Failed to fetch patch"; exit 1; }

echo "Patch contents:"
echo "$PATCH" | grep -E '^(From |Subject:|---$)' | head -20

echo ""
echo "Applying with git am --3way..."
if echo "$PATCH" | git am --3way; then
    echo ""
    echo "Applied successfully. New commits:"
    # Show commits added (count Subject lines to know how many)
    COUNT=$(echo "$PATCH" | grep -c '^Subject:')
    git log --format='  %h %an <%ae> %s' -"${COUNT}"
else
    echo ""
    echo "Conflicts detected. Resolve them, then run:"
    echo "  git add <resolved-files>"
    echo "  git am --continue"
    echo ""
    echo "Or abort with: git am --abort"
    exit 1
fi
```

---

## Gotchas and Edge Cases

### GPG Signatures

The `.patch` format does not include GPG signatures from the original commits. If the
fork requires signed commits, you would need to sign them yourself during `git am` with
`git am --gpg-sign` or configure `commit.gpgSign = true`. The original author's signature
is not transferable since you are creating new commit objects.

### Merge Commits in PRs

If a PR contains merge commits (e.g., the author merged `main` into their branch), the
`.patch` URL only includes the non-merge commits -- the actual changes. This is usually
the desired behavior. If you need the merge commit topology, use Approach B (cherry-pick
from the author's remote).

### PR #130 Has a Questionable Second Commit

PR #130 (vike2000) has two commits. The second commit changes the `keywords` table in
`init.lua` to remove `"github"` and `"MLFlexer"` from the dev.wezterm plugin loader
keywords. This is specific to vike2000's fork workflow and is almost certainly not
desirable for our fork. Use `git mailsplit` to apply only the first commit (the actual
bug fix for `ensure_folder_exists`).

### PR #123 Hardcodes Fork Username

PR #123 (userux) changes `keywords` in `init.lua` from `"MLFlexer"` to `"userux"` in
its first commit, then reverts it in the second commit. The net effect on `init.lua` is
zero, but the changes to `tab_state.lua` and `window_state.lua` (using direct module
requires instead of going through the `resurrect` module) are the real fix. Applying
both commits is safe since the second commit undoes the first commit's `init.lua` change.

### Committer vs Author

`git am` sets `Author` to the patch's `From:` field and `Committer` to your git identity.
This is the standard and correct behavior -- `git log` shows the author by default,
`git log --format='%cn'` shows the committer. GitHub's web UI shows both. No extra
`--author` flag is needed.

### Keeping Track of Applied PRs

After applying PRs, there is no automatic link back to the upstream PR. Consider adding
a note in the commit message body or using a convention like:

```sh
curl -sL ".../pull/127.patch" | git am --message-id
```

The `--message-id` flag adds a `Message-Id:` header to the commit, but this is not the
same as a PR reference. A more practical approach is to append a trailer during or after
application:

```sh
# After git am, amend the last commit to add a reference
git commit --amend -m "$(git log -1 --format='%B')

Upstream-PR: https://github.com/MLFlexer/resurrect.wezterm/pull/127"
```

Or for multi-commit PRs, do this for each commit (tedious) or just for the last one.

---

## Summary

| Criterion                     | `.patch` + `git am` | Remote + cherry-pick | `gh pr checkout` | `gh pr diff` + manual |
|-------------------------------|:-------------------:|:--------------------:|:----------------:|:---------------------:|
| Author attribution            | Automatic           | Automatic            | Automatic        | Manual                |
| Commit message preserved      | Yes                 | Yes                  | Yes              | No                    |
| Multi-commit PR support       | Yes (sequential)    | Yes (selective)      | Yes              | No (squashed)         |
| Conflict resolution           | `--3way`            | Native               | Native           | `git apply --reject`  |
| Cleanup required              | None                | Remove remote        | Remove remote     | None                  |
| Commands per PR               | 1                   | 4                    | 2-3              | 3+                    |

**Recommendation: Use Approach A (`curl .patch | git am --3way`) as the default.** It
gives correct attribution with the least friction, handles multi-commit PRs automatically,
and the `--3way` flag provides real merge conflict resolution when patches overlap. Fall
back to Approach B (remote + cherry-pick) only when you need to selectively pick commits
from a large multi-commit PR where `git mailsplit` would be unwieldy.
