---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T17:00:00-08:00
task_list: lace/worktree-support
type: report
state: live
status: wip
tags: [git, worktrees, devcontainer, executive-summary]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-13T18:00:00-08:00
  round: 1
---

# Worktree Support in Lace: Executive Summary

> NOTE: This summary and its [full analysis](./2026-02-13-worktree-aware-devcontainers.md) consider only the single-container model: mount the entire bare-repo root into one devcontainer, navigate between worktrees as sibling directories. The one-container-per-worktree model is out of scope.

> BLUF: Lace's own devcontainer already proves the all-worktrees-in-one-container pattern works. What's missing is making it automatic instead of manually configured. A `customizations.lace.worktree` config block that auto-generates the correct mount configuration would turn a bespoke, error-prone setup into a one-liner.

## The Problem in One Paragraph

When a project uses the bare-repo worktree pattern (`git clone --bare` + `git worktree add`), opening a worktree in a devcontainer breaks git. The worktree's `.git` file points to the parent directory's bare repo, but the container only mounts the worktree itself, so the path resolves to nothing. The fix is to mount the entire bare-repo root (containing all worktrees) and set `workspaceFolder` to a specific worktree inside it. Lace's own devcontainer does exactly this, manually. The question is whether lace should automate it.

## What Lace Already Has

- **Config generation pipeline** (`.lace/devcontainer.json`): lace already transforms the source config (resolving port templates, rebasing paths, merging port entries). Adding mount overrides for worktree support is architecturally consistent.
- **A working reference implementation**: lace's own `.devcontainer/devcontainer.json` proves the pattern with `workspaceMount: source=${localWorkspaceFolder}/..`.
- **Discovery** (`lace-discover` + `wez-into`): finds the running container and connects to it; the user then navigates worktrees via `cd ../feature-auth` within the session.

## What's Missing

- **No detection.** Lace doesn't know if it's running in a worktree. It passes `workspaceMount` through unchanged.
- **No validation.** A user who opens a worktree without the parent-mount override gets a cryptic `fatal: not a git repository` inside the container.
- **No automation.** Every bare-repo project must manually write the same `workspaceMount`/`workspaceFolder`/`safe.directory`/`repositoryScanMaxDepth` boilerplate.

## The Options

### Option 1: Validate only

`lace up` checks whether the workspace is a worktree and whether the config handles it correctly. Emits clear errors with fix suggestions. No config generation: the user still writes the mount config manually.

**Good for:** Catching mistakes. Low risk, low effort.
**Limited by:** Doesn't reduce the configuration burden.

### Option 2: Auto-configure (recommended)

A `customizations.lace.worktree` block in `devcontainer.json`:

```jsonc
{
  "customizations": {
    "lace": {
      "worktree": { "enabled": "auto" }
    }
  }
}
```

When `"auto"` detects a bare-repo worktree, lace generates the correct `workspaceMount` and `workspaceFolder` in `.lace/devcontainer.json`. Also injects `safe.directory` and `repositoryScanMaxDepth`. When not in a worktree, passes through normally, so the same `devcontainer.json` works for both bare-repo and normal-clone users.

**Good for:** Eliminating boilerplate. Making the pattern portable and accessible.
**Requires:** Reliable worktree detection. Clear behavior when detection is wrong.

## Key Risks

| Risk | Mitigation |
|---|---|
| Auto-detection misidentifies a normal clone as a worktree | `.git` file vs `.git` directory is unambiguous; false positives shouldn't happen |
| Absolute paths in `.git` file break container mounts | Validate and warn; the parent-mount approach sidesteps most absolute-path issues, but validation catches the edge cases |
| `safe.directory '*'` is overly permissive | Standard practice for devcontainers with bind mounts; scoped alternatives are fragile |
| `git gc --prune=now` deletes objects needed by other worktrees | Set `gc.pruneExpire=never` via `postCreateCommand`; document the risk |
| Shared stash across worktrees surprises agents | Document "use WIP commits, not stash"; optionally alias `git stash` to warn |

## Recommendation

**Implement Option 2**: the `customizations.lace.worktree` config block. It builds on lace's existing config generation pipeline, requires no new CLI commands, and solves the real adoption barrier (manual mount configuration). Include Option 1's validation checks as part of the implementation: they're a natural byproduct of the detection logic.
