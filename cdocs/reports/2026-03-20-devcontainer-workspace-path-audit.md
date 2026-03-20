---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-20T12:00:00-07:00
task_list: devcontainer/workspace-path-audit
type: report
state: live
status: wip
tags: [devcontainer, workspace_paths, configuration]
---

# Devcontainer Workspace Path Audit

> BLUF: The Dockerfile `COPY . .` bakes stale repo files (including `CLAUDE.md` and `.claude/rules/`) into the container image at `/workspace/`.
> The live repo is bind-mounted at `/workspace/lace/main`.
> Claude Code walks up the directory tree and finds the stale `/workspace/CLAUDE.md`, triggering "external imports" warnings because it's outside the git repo.
> The fix requires changing the Dockerfile's WORKDIR/COPY target to avoid shadowing the live workspace.

## Context / Background

On startup, Claude Code reported "external imports" from `/workspace/.claude/...`.
Investigation reveals this is caused by the container's directory layout creating two copies of `CLAUDE.md` and `.claude/rules/`: one live (bind-mounted), one stale (baked into the image).

## Key Findings

### Directory layout

- `/workspace/` is the container overlay filesystem (from `WORKDIR /workspace` + `COPY . .` in the Dockerfile).
- `/workspace/lace/` is a bind mount from the host (`/home/mjr/code` on btrfs).
- `/workspace/lace/main/` is the active git worktree and Claude Code's working directory.

### Stale file duplication

The Dockerfile's `COPY . .` at line 84 copies the full repo source into `/workspace/` at image build time.
This includes `CLAUDE.md` and `.claude/rules/*.md`.
These are on a different filesystem (overlay, device 214) than the bind-mounted live files (device 42):

| Path | Device | Inode | Source |
|------|--------|-------|--------|
| `/workspace/CLAUDE.md` | 214 (overlay) | 55346209 | Docker COPY (stale) |
| `/workspace/lace/main/CLAUDE.md` | 42 (btrfs) | 1862035 | Bind mount (live) |
| `/workspace/.claude/rules/writing-conventions.md` | 214 (overlay) | 55345375 | Docker COPY (stale) |
| `/workspace/lace/main/.claude/rules/writing-conventions.md` | 42 (btrfs) | 1890847 | Bind mount (live) |

### Claude Code's directory walk

Claude Code walks up from the `workspaceFolder` (`/workspace/lace/main`) looking for `CLAUDE.md` files.
It finds:
1. `/workspace/lace/main/CLAUDE.md` (inside git repo, normal)
2. `/workspace/CLAUDE.md` (outside any git repo, triggers "external imports" warning)

The second file's `@.claude/rules/...` imports DO resolve (the stale copies exist), but Claude Code flags them as external because `/workspace/` is not a git repository.

### Convention mismatch

The standard devcontainer convention uses `/workspaces/<project>` as the workspace root.
This project uses `/workspace/lace` instead.
The `/workspaces/` directory does not exist in the container.

## Analysis

The root cause is the Dockerfile using `/workspace` as both:
1. The build-time WORKDIR for `COPY . .` (to cache `pnpm install` with package files)
2. A parent directory of the runtime bind mount at `/workspace/lace`

This means the COPY'd build artifacts (the full repo snapshot) persist at `/workspace/` and are visible alongside the live bind mount.
Any tool that walks up the directory tree from `/workspace/lace/main` will encounter these stale files.

### Impact

- Claude Code loads stale `CLAUDE.md` rules on every startup (may diverge from live rules after edits).
- Startup warning about "external imports" is confusing.
- Risk of tools reading stale files instead of live ones if path resolution is ambiguous.

## Recommendations

1. **Change Dockerfile WORKDIR to an isolated build path** (e.g., `/build` or `/app-build`) so COPY'd files don't overlap with the runtime workspace mount.
   Only copy what's needed for `pnpm install` (package.json, lockfile, workspace config), not the full source.
2. **Adopt `/workspaces/lace`** as the mount target to align with devcontainer conventions.
   Update `customizations.lace.workspace.mountTarget` accordingly.
3. **Remove the `COPY . .` line** or scope it to a multi-stage build that doesn't persist into the final image layer at a path visible to the runtime workspace.
