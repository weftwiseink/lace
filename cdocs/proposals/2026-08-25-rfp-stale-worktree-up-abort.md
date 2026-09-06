---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-08-25T12:30:00-07:00
task_list: lace/workspace-validation
type: proposal
state: archived
status: evolved
superseded_by: cdocs/proposals/2026-09-06-stale-worktree-classification.md
tags: [workspace-detection, worktree, error-handling, dev-infra, rfp]
---

# RFP: `lace up` aborts on stale/prunable worktrees that `git worktree prune` would fix

> BLUF: The absolute-gitdir validation promoted to a hard error in [`2026-02-16-worktree-gitdir-error-promotion.md`](../devlogs/2026-02-16-worktree-gitdir-error-promotion.md) does not distinguish a STALE/prunable worktree entry (safely removable by `git worktree prune`) from a live worktree with a genuinely broken gitdir.
> So a dead entry left behind by a normal merge blocks every `lace up` until the user discovers `--skip-validation`, even though the correct remedy is one command.
> Related root cause: creating a worktree from INSIDE the container writes exactly the absolute `/workspace/<project>/...` gitdir that this validation then rejects, so the failure state is produced by ordinary use.

## Problem

Observed on the `jif` project (single-container bare-worktree layout):

```
$ git worktree list
/var/home/mjr/code/weft/jif/main             d3be3f0f [main]
...
/workspace/jif/home-dashboard    2da57a78 [web/home-dashboard]      prunable
/workspace/jif/nukani-terminology d3be3f0f [chore/nukani-terminology] prunable
$ git worktree prune -n -v
Removing worktrees/home-dashboard: gitdir file points to non-existent location
Removing worktrees/nukani-terminology: gitdir file points to non-existent location
```

Both entries are dead: their branches were merged and the working dirs are gone, but the admin `worktrees/<name>/gitdir` back-pointers hold absolute container paths (`/workspace/jif/home-dashboard/.git`).
Healthy host-created worktrees in the same repo carry relative back-pointers (`../../../main/.git`) because `worktree.useRelativePaths=true` is set host-side.
The two broken ones were created container-side, where git did not write relative paths, so their gitdirs are absolute and dangle from the host.

`lace up`'s workspace-layout validation classifies these as `absolute-gitdir` and returns `status: "error"`, aborting before it writes config.
The only escape is `lace up --skip-validation`, which downgrades ALL validation, not just this benign case.
Nothing tells the user the actual fix is `git worktree prune`.

## Why the current promotion does not cover this

The promotion devlog correctly reasons that a LIVE worktree with an absolute gitdir will not resolve inside the container, so it is a real defect worth stopping on.
But it treats "absolute gitdir" as a single class.
A `prunable` entry (forward pointer resolves to nothing / working dir absent) is not a broken live worktree; it is administrative dead weight that `git worktree prune` removes with zero risk.
Aborting `lace up` on it, with no auto-remediation and no remedy string, converts routine post-merge residue into a hard stop.

## Suggested direction (for a full proposal to flesh out)

1. **Classify prunable separately from broken-live.** In `workspace-detector` / `classifyWorkspace`, split the `absolute-gitdir` signal: if the entry is prunable (git's own `worktree prune -n` criteria: gitdir points to a non-existent location, or working tree missing), emit a distinct `stale-worktree` code.
2. **Auto-remediate the stale class, or make the remedy one line.** Options to weigh:
   - Run `git worktree prune` automatically during `lace up` when the only offenders are prunable (and log what was pruned), OR
   - Keep it a warning-not-error for the prunable class and print the exact `git worktree prune` remedy, reserving the hard error for genuinely broken LIVE worktrees.
3. **Address the source, not just the symptom.** Container-side `git worktree add` writes absolute `/workspace/<project>/...` gitdirs that this very validation rejects. Consider: ensuring the container git config carries `worktree.useRelativePaths=true` (bake it into the lace container/dotfiles), and/or documenting "create/remove worktrees from the host" as the supported path. A worktree layout whose normal creation flow produces its own validation's failure state is a footgun worth closing at the source.

## Notes

- Reproduced 2026-08-25 during the `jif` in-container-emulator durability work; the `--skip-validation` workaround was needed only to regenerate `.lace/devcontainer.json`, and the two stale entries were left in place (a co-tenant agent was live in the container, so pruning shared worktree admin state was deferred).
- Distinct from [`2026-08-24-rfp-cross-project-port-allocation-collision.md`](2026-08-24-rfp-cross-project-port-allocation-collision.md); that is host-port allocation, this is worktree validation.
