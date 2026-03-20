---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-20T15:00:00-07:00
task_list: devcontainer/weftwise-migration
type: report
state: archived
status: done
tags: [devcontainer, workspace_paths, weftwise, migration, audit]
---

# Weftwise Devcontainer Migration Audit

> BLUF: The weftwise devcontainer has four issues carried over from the pre-migration lace setup: (1) workspace path at `/workspace` instead of `/workspaces/weftwise`, (2) `COPY . .` in the Dockerfile creating stale-file shadowing, (3) missing clauthier repoMounts for cdocs plugin resolution, and (4) missing `claude-config-json` file mount causing the CLAUDE_CONFIG_DIR split-brain.
> All four issues have known fixes validated in the lace project's migration.

## Context / Background

The lace project completed a workspace path migration from `/workspace/lace` to `/workspaces/lace` (see `cdocs/proposals/2026-03-20-devcontainer-workspace-path-migration.md`, archived).
That migration also established patterns for clauthier repoMounts and the `claude-config-json` split-brain fix.
The weftwise project uses the same lace-managed devcontainer infrastructure but has not yet adopted these patterns.

## Key Findings

### 1. Workspace path: `/workspace` (non-standard)

**Current state:**
- `customizations.lace.workspace.mountTarget`: `"/workspace"`
- Generated `workspaceMount`: `source=.../weftwise,target=/workspace`
- Generated `workspaceFolder`: `/workspace/main`
- Dockerfile: `WORKDIR /workspace`, `mkdir -p /workspace`

**Issue:**
Standard devcontainer convention is `/workspaces/<project>`.
The `/workspace` path is non-standard and creates the same parent-directory collision risk documented in the lace audit.

**Target state:** `mountTarget: "/workspaces/weftwise"`, Dockerfile WORKDIR at `/workspaces`.

### 2. Dockerfile `COPY . .` creates stale-file shadowing

**Current state (`.devcontainer/Dockerfile`):**
```dockerfile
WORKDIR /workspace
COPY --chown=${USERNAME}:${USERNAME} package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=${USERNAME}:${USERNAME} . .
RUN pnpm build:electron ...
```

**Issue:**
The full-source `COPY . .` bakes the entire repo into the image at `/workspace/`.
At runtime, the live repo is bind-mounted at `/workspace/` (same path), so the overlay files are hidden.
However, any files in the image layer that are NOT in the bind mount remain visible as stale artifacts.
If the mount target changes to `/workspaces/weftwise`, the old `/workspace/` contents become fully visible stale files (identical to the problem lace had).

**Complication:** Unlike lace, weftwise uses `COPY . .` for a real purpose: building the Electron renderer SPA at image build time (`pnpm build:electron`).
This means the COPY cannot simply be removed.
The fix requires a multi-stage or isolated-path approach.

### 3. No clauthier repoMounts declaration

**Current state:**
- `.devcontainer/devcontainer.json` has no `customizations.lace.repoMounts` section.
- `.claude/settings.json` registers plugins including marketplace plugins, but clauthier is not mounted into the container.
- The global `~/.config/lace/settings.json` has clauthier repoMount overrides (added for lace), which would apply to any project declaring the repoMount.

**Issue:**
Without declaring `repoMounts: { "github.com/weftwiseink/clauthier": {} }`, the clauthier marketplace is not mounted into the weftwise container.
Any cdocs plugins registered via `cdocs@clauthier` (or similar marketplace references) will fail to resolve inside the container.

**Fix:** Add the repoMounts declaration to `.devcontainer/devcontainer.json`.
The global settings.json override already has the correct source/target for host-path mirroring.

### 4. Missing `claude-config-json` file mount (split-brain)

**Current state:**
- `containerEnv.CLAUDE_CONFIG_DIR`: `"${lace.mount(claude-code/config).target}"` (resolves to `/home/node/.claude`)
- The claude-code feature injects a `claude-code/config` mount targeting `/home/node/.claude`.
- No separate `claude-config-json` mount exists.

**Issue:**
Setting `CLAUDE_CONFIG_DIR=/home/node/.claude` causes Claude Code to look for `.claude.json` at `/home/node/.claude/.claude.json`.
The host's `.claude.json` (with `hasCompletedOnboarding`, account state) lives at `~/.claude.json` (outside the `.claude/` directory).
The bind mount for `~/.claude` -> `/home/node/.claude` does not include `~/.claude.json`.
Result: Claude Code inside the container may re-prompt for onboarding or lack account state.

**Fix:** Add a `claude-config-json` mount declaration (same pattern as lace):
```jsonc
"claude-config-json": {
  "target": "/home/node/.claude/.claude.json",
  "recommendedSource": "~/.claude.json",
  "sourceMustBe": "file",
  "description": "Claude Code state (onboarding, account cache)",
  "hint": "Run 'claude' on the host first to create this file"
}
```

## Additional Migration Surface: `/workspace` in Documentation and Scripts

26 files in the weftwise repo reference `/workspace` paths.
Key categories:

| Category | Files | Notes |
|----------|-------|-------|
| Active config | `.devcontainer/devcontainer.json`, `.devcontainer/Dockerfile` | Core migration targets |
| Claude commands | `.claude/commands/worktree.md` | References `/workspace/<name>` throughout |
| Project CLAUDE.md | `CLAUDE.md` | Quick reference section uses `/workspace/feature-name` |
| Active docs | `docs/worktree_development.md`, `docs/claude_session_management.md` | Worktree path references |
| Scripts | `scripts/worktree.sh`, `scripts/validate_wezterm_ssh.sh`, `scripts/migrate_devcontainer_volumes.sh` | Hardcoded `/workspace` paths |
| Historical docs/devlogs | 16+ files in `docs/devlogs/`, `docs/proposals/`, `docs/reports/` | Lower priority, historical context |
| Archived docs | 4 files in `_archive/` | Lowest priority |

The active config, commands, CLAUDE.md, and scripts are the critical migration targets.
Historical docs and archived files can be updated opportunistically or left as-is (they document what was true at the time).

## Electron Build Complication

The weftwise Dockerfile has a legitimate use for `COPY . .`: building the Electron renderer SPA at image build time.
This differs from the lace case where `COPY . .` was purely for dependency caching.

Options:
1. **Multi-stage build**: COPY into a build stage, build Electron, copy only the output artifact to the runtime stage.
   This eliminates all stale source files from the final image.
2. **Isolated build path**: COPY to `/build`, build Electron there, copy artifact to a known location.
   Simpler than multi-stage but leaves the full source at `/build` (hidden from workspace, harmless).
3. **Remove build-time Electron build**: Defer to `postCreateCommand` or manual step.
   Simplest, but increases container startup time.

> NOTE(opus/weftwise-migration): Option 2 (isolated `/build` path) aligns with the pattern used in the lace migration and handles the Electron build.
> The build output at `/build/` is invisible to the workspace mount and Claude Code's directory walk.

## Recommendations

1. **Migrate workspace path** from `/workspace` to `/workspaces/weftwise` (Dockerfile, devcontainer.json mountTarget).
2. **Isolate Dockerfile build** to `/build` directory, move `COPY . .` and Electron build there.
3. **Add clauthier repoMounts** declaration to `.devcontainer/devcontainer.json`.
4. **Add claude-config-json mount** to fix the split-brain issue.
5. **Update active docs and scripts** that reference `/workspace` paths.
6. **Leave historical docs as-is** (they document the state at time of writing).
