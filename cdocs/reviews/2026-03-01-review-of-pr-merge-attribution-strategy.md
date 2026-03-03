---
review_of: cdocs/reports/2026-03-01-pr-merge-attribution-strategy.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-01T14:00:00-06:00
type: review
state: archived
status: done
tags: [git, workflow, attribution, fork-management, resurrect-wezterm]
---

# Review: PR Merge Attribution Strategy for resurrect.wezterm Fork

## Summary Assessment

The report's core recommendation -- `.patch` + `git am` for preserving attribution -- is
sound and verified. The patch format, author headers, and `git am` behavior are all
accurately described. However, the conflict analysis between PRs contains one material
error (PR #123 vs #130 on `init.lua`), the helper script has a robustness issue with
storing patches in shell variables, the `Upstream-PR:` trailer recommendation uses an
unnecessarily clumsy mechanism when `git interpret-trailers` can do it in a pipeline, and
the recommended workflow inconsistently uses `--3way` only for conflict cases while the
script correctly defaults to it always. The "what happens after fork diverges" gotcha is
acknowledged but underexplored.

## Verified Claims

### Attribution preservation: Correct

Verified against all 6 PRs. The `.patch` URL produces valid mbox `From:` headers:
- PR #127: `From: tdragon <1210261+tdragon@users.noreply.github.com>`
- PR #134: `From: Joel Low <joel@joelsplace.sg>`
- PR #130: `From: vike <vike2000@gmail.com>` (both commits)
- PR #123: `From: userux <20521624+userux@users.noreply.github.com>` (both commits)
- PR #128: `From: andreystepanov <472885+andreystepanov@users.noreply.github.com>`
- PR #118: `From: Florian Valenza <florian.valenza@gmail.com>`

`git am` sets the `Author` field from `From:` and `Committer` from local git config.
This is standard behavior and the report's description is accurate.

### Fork state: Correct

Fork HEAD at `47ce553` matches upstream HEAD at `47ce553e07bb2c183d10487c56c406454aa50f36`.
Zero divergence confirmed via `gh api repos/MLFlexer/resurrect.wezterm/commits/main`.

### Files changed per PR: Partially correct

| PR  | Report claims                             | Actual files in `.patch`                                  | Accurate? |
|-----|-------------------------------------------|-----------------------------------------------------------|-----------|
| 134 | state_manager.lua, utils.lua              | state_manager.lua, utils.lua                              | Yes       |
| 130 | init.lua, utils.lua                       | utils.lua (commit 1), init.lua (commit 2)                 | Yes       |
| 128 | pane_tree.lua                             | pane_tree.lua                                             | Yes       |
| 127 | pane_tree.lua                             | pane_tree.lua                                             | Yes       |
| 123 | init.lua, tab_state.lua, window_state.lua | init.lua + tab_state.lua + window_state.lua (commit 1), init.lua (commit 2) | See below |
| 118 | workspace_state.lua                       | workspace_state.lua                                       | Yes       |

**Finding on PR #123: [non-blocking, misleading]** The report lists `init.lua` in
PR #123's files, which is technically correct -- commits 1 and 2 both touch `init.lua`.
However, the **net diff** of PR #123 against the base changes zero lines in `init.lua`
(commit 1 replaces `"MLFlexer"` with `"userux"`, commit 2 reverts it). The report
acknowledges this in the Gotchas section ("The net effect on `init.lua` is zero") but
still lists `init.lua` in the PR table, which feeds into a downstream error in the
conflict analysis.

## Findings

### 1. init.lua conflict analysis is wrong [blocking]

The conflict map states:

> **init.lua**: PR #130 and PR #123 both modify `init.lua`. PR #130's second commit
> changes the `keywords` table; PR #123 also changes `keywords`. They would conflict.

This is incorrect when applying both commits of PR #123 via `git am`. Since `git am`
applies commits sequentially, after both commits of #123, `init.lua` is back to its
original state (identical to baseline). PR #130's commit 2 (which modifies the
`keywords` line) would then apply cleanly because the base content matches.

The conflict would only arise if:
1. Only commit 1 of PR #123 is applied (without commit 2), or
2. PR #130 is applied first, then PR #123 commit 1 would fail because the `keywords`
   line has already been modified.

The batch ordering in the "Batch Application with Conflict Ordering" section places
#123 before #130, which happens to be the safe order. But the reasoning given for
using `--3way` on #130 ("may conflict on init.lua") is wrong -- it will apply cleanly
in this order. The conflict analysis should be corrected to note that the init.lua
overlap is only relevant if commits are cherry-picked selectively, not when full PRs
are applied via `git am`.

### 2. Standard workflow inconsistently omits `--3way` [non-blocking]

The "Standard Case" section shows:
```sh
curl -sL ".../pull/127.patch" | git am
```

But the helper script always uses `git am --3way`. The `--3way` flag has zero
downside when patches apply cleanly -- it only activates when context matching fails.
The standard workflow should recommend `--3way` by default, not just for the
conflict case. This eliminates the need for users to decide "will this conflict?"
before choosing the command variant.

### 3. `Upstream-PR:` trailer via `git commit --amend` is suboptimal [non-blocking]

The report recommends:
```sh
git commit --amend -m "$(git log -1 --format='%B')

Upstream-PR: https://github.com/MLFlexer/resurrect.wezterm/pull/127"
```

This approach has several problems:
- For multi-commit PRs, you would need to amend each commit (the report acknowledges
  this as "tedious").
- The `$(git log -1 --format='%B')` substitution is fragile with special characters
  in the original commit message.
- It rewrites commit hashes needlessly.

A better approach is `git interpret-trailers` applied to the patch *before* `git am`:

```sh
curl -sL ".../pull/127.patch" \
  | git interpret-trailers --trailer "Upstream-PR: https://github.com/MLFlexer/resurrect.wezterm/pull/127" \
  | git am --3way
```

This was verified to work -- the trailer is cleanly inserted into each patch's commit
message body before the `---` separator, preserving the original author and message.
For multi-commit PRs, every commit in the mbox gets the trailer automatically. No
post-hoc amending needed.

### 4. Helper script stores patch in shell variable [non-blocking]

```sh
PATCH=$(curl -sfL "$PATCH_URL") || { echo "Failed to fetch patch"; exit 1; }
```

Storing the entire patch in a Bash variable has two risks:
- Shell variable size limits (typically 1-4 MB depending on platform) could truncate
  very large patches silently.
- `echo "$PATCH"` can mangle patches containing special characters or binary content
  (though git patches are typically ASCII-safe).

A more robust approach uses a temp file:

```sh
PATCH_FILE=$(mktemp)
trap 'rm -f "$PATCH_FILE"' EXIT
curl -sfL "$PATCH_URL" -o "$PATCH_FILE" || { echo "Failed to fetch patch"; exit 1; }
git am --3way "$PATCH_FILE"
```

Or, even simpler, just pipe directly:

```sh
curl -sfL "$PATCH_URL" | git am --3way
```

The script needs the variable to count `Subject:` lines for the verification step,
but that could also be done by counting new commits via `git rev-list`.

### 5. Fork divergence gotcha is underexplored [non-blocking]

The report notes the fork is currently at zero divergence, and all patches apply
cleanly against the current base. But it does not discuss what happens after the fork
starts accumulating its own commits (which is the entire point of having a fork).

Once the fork diverges:
- `--3way` becomes **essential**, not optional, because patch context lines may no
  longer match positionally even when the patched region is untouched.
- Patches that were verified to "apply cleanly" against the current base may fail
  if fork commits have modified nearby lines (within the 3-line context window).
- The batch ordering analysis becomes invalid because the fork's own commits
  change the file state unpredictably.
- If the fork regularly syncs with upstream (merges or rebases), upstream PRs that
  have been merged will conflict when the fork tries to apply them again. The
  workflow needs a tracking mechanism (like the `Upstream-PR:` trailer) to prevent
  double-application.

The report should include a brief section on the diverged-fork workflow, at minimum
recommending `--3way` as the unconditional default and suggesting `git log --grep`
on the `Upstream-PR:` trailer to check for already-applied PRs.

### 6. PR #130 first commit has a fundamentally broken approach [non-blocking, outside scope]

This is not a flaw in the report itself, but worth noting: PR #130's pure-Lua
`ensure_folder_exists` implementation attempts to create directories by writing a
temp file inside them (`io.open(current .. sep .. ".mkdir_tmp", "w")`). This cannot
work -- `io.open` cannot create a file inside a directory that does not yet exist.
The entire function would silently fail and return `false`. If the fork adopts
PR #130, the implementation would need to be replaced with something that actually
works (e.g., `os.execute` with proper quoting, or `wezterm.run_child_process`).

The report correctly identifies PR #130's second commit as undesirable but does not
flag this bug in the first commit. Since the report is about merge mechanics rather
than code quality, this is outside scope, but it affects the practical value of
including PR #130 in the batch.

### 7. Approach comparison table is accurate [no issues]

The comparison table correctly identifies the trade-offs between the four approaches.
The `gh pr checkout` description accurately notes it switches the working branch and
adds a remote without cleanup. The `gh pr diff` description correctly notes it squashes
multi-commit PRs into a single diff.

### 8. PR #123 gotcha analysis is accurate and valuable [no issues]

The note about PR #123's first commit hardcoding `"userux"` and the second commit
reverting it is correct and important. The recommendation to apply both commits
(since the net effect is correct) is sound.

### 9. PR #130 gotcha analysis is accurate and valuable [no issues]

The note about PR #130's second commit being specific to vike2000's fork workflow
is correct. The `git mailsplit` recommendation for applying only the first commit
is the right approach.

## Verdict

**Accept with corrections.** The core recommendation is well-researched and verified.
The `.patch` + `git am` approach is clearly the best option for this use case. Three
items need attention before the report is used as a reference:

1. **[blocking]** Correct the init.lua conflict analysis between PR #123 and PR #130.
   The claimed conflict does not occur when full PRs are applied via `git am` in the
   recommended order.
2. **[non-blocking]** Recommend `--3way` as the default in the standard workflow,
   matching the script's behavior.
3. **[non-blocking]** Replace the `git commit --amend` trailer approach with
   `git interpret-trailers` piped before `git am`.

## Action Items

1. [blocking] Fix the conflict map entry for init.lua. Replace "They would conflict"
   with a note that the conflict only arises if commits are selectively applied or
   if the order is reversed.
2. [non-blocking] Change the "Standard Case" example from `git am` to `git am --3way`
   for consistency with the script and to eliminate the user decision about when
   `--3way` is needed.
3. [non-blocking] Add a `git interpret-trailers` pipeline example to the "Keeping
   Track of Applied PRs" section, replacing or supplementing the `git commit --amend`
   approach.
4. [non-blocking] Rewrite the helper script to use a temp file or direct pipe instead
   of storing the patch in a shell variable.
5. [non-blocking] Add a "Diverged Fork" subsection to the Gotchas covering the
   implications of fork-local commits on patch applicability and the need for
   double-application prevention.
6. [non-blocking] Note that PR #130's first commit implementation is likely
   non-functional (cannot create directories via `io.open` into non-existent paths)
   and would need rework if adopted.
