---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-20T15:15:00-07:00
task_list: devcontainer/weftwise-migration
type: proposal
state: live
status: implementation_wip
tags: [devcontainer, workspace_paths, weftwise, migration, clauthier, cdocs]
---

# Weftwise Devcontainer Migration

> BLUF: Migrate the weftwise devcontainer from `/workspace` to `/workspaces/weftwise`, isolate the Dockerfile build to `/build`, add clauthier repoMounts for cdocs plugin resolution, and add the `claude-config-json` file mount to fix the CLAUDE_CONFIG_DIR split-brain.
> All patterns are validated in the completed lace migration.
> The Electron build complication (weftwise uses `COPY . .` for a real build step) is handled by moving the build to the isolated `/build` directory.

## Summary

Four changes, all following patterns established and verified in the lace project:
1. Workspace path: `/workspace` -> `/workspaces/weftwise` (devcontainer.json + Dockerfile)
2. Dockerfile build isolation: COPY and build steps move to `/build`, eliminating stale-file shadowing
3. Clauthier repoMounts: declare in devcontainer.json so cdocs plugins resolve inside the container
4. Claude config split-brain fix: add `claude-config-json` file mount

See `cdocs/reports/2026-03-20-weftwise-devcontainer-migration-audit.md` for the full audit with inode-level analysis of the stale-file problem and the complete list of 26 files referencing `/workspace`.

> NOTE(opus/weftwise-migration): This proposal targets the weftwise project at `/var/home/mjr/code/weft/weftwise/main/`.
> All file paths in this proposal are relative to that root unless stated otherwise.

## Objective

Align the weftwise devcontainer with the conventions established in the lace project:
- Standard `/workspaces/<project>` path convention.
- No stale files from Dockerfile COPY visible in the runtime workspace.
- Clauthier marketplace accessible inside the container for cdocs plugin resolution.
- Claude Code config state correctly overlaid to prevent onboarding re-prompts.

## Background

The lace project completed an identical migration (workspace path + build isolation + repoMounts + config fix).
See:
- `cdocs/proposals/2026-03-20-devcontainer-workspace-path-migration.md` (lace workspace migration, archived)
- `cdocs/reports/2026-03-20-devcontainer-workspace-path-audit.md` (stale-file analysis, archived)
- `cdocs/proposals/2026-03-20-clauthier-repo-mount.md` (repoMounts pattern, archived)

The weftwise project uses the same lace-managed devcontainer infrastructure (bare-worktree layout, prebuild features, lace mount resolution).
The current weftwise config predates the lace migration and still uses the old conventions.

## Proposed Solution

### 1. Dockerfile: Isolate build to `/build`, migrate workspace to `/workspaces`

Current:
```dockerfile
RUN mkdir -p /workspace && \
    chown -R ${USERNAME}:${USERNAME} /workspace
WORKDIR /workspace
# ... dependency install ...
COPY --chown=${USERNAME}:${USERNAME} . .
RUN pnpm build:electron ...
```

Proposed:
```dockerfile
# Runtime workspace (created empty, populated by bind mount)
RUN mkdir -p /workspaces && \
    chown -R ${USERNAME}:${USERNAME} /workspaces

# Build-time dependency cache and Electron build (isolated from runtime workspace)
WORKDIR /build
COPY --chown=${USERNAME}:${USERNAME} package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=${USERNAME}:${USERNAME} . .
RUN pnpm build:electron 2>&1 | tee /tmp/electron_build.log || \
    (echo "WARNING: Electron build failed. See /tmp/electron_build.log" && true)

# Runtime workspace
WORKDIR /workspaces
```

The Electron and Playwright pre-install layers (`pnpm install "electron@..."`, `pnpm install "playwright@..."`) run before the WORKDIR change.
After the WORKDIR moves to `/build`, these layers' `node_modules/` land at `/build/node_modules/`, which is consistent with the subsequent `pnpm install --frozen-lockfile` that resolves all workspace dependencies.

> NOTE(opus/weftwise-migration): The Electron build output at `/build/` is invisible to Claude Code's directory walk from `/workspaces/weftwise/main` upward.
> The pnpm content-addressable store is shared, so runtime `pnpm install` benefits from the cached packages.

`containerEnv` is unchanged: `CLAUDE_CONFIG_DIR` and `NODE_OPTIONS` remain as-is.

### 2. devcontainer.json: Migrate mountTarget and add declarations

```jsonc
"customizations": {
  "lace": {
    "workspace": {
      "layout": "bare-worktree",
      "mountTarget": "/workspaces/weftwise"  // was "/workspace"
    },
    "mounts": {
      "nushell-config": { /* unchanged */ },
      // Add: claude-config-json split-brain fix
      "claude-config-json": {
        "target": "/home/node/.claude/.claude.json",
        "recommendedSource": "~/.claude.json",
        "sourceMustBe": "file",
        "description": "Claude Code state (onboarding, account cache)",
        "hint": "Run 'claude' on the host first to create this file"
      }
    },
    // Add: clauthier marketplace for cdocs plugin resolution
    "repoMounts": {
      "github.com/weftwiseink/clauthier": {}
    }
  }
}
```

### 3. Update CLAUDE.md and worktree command

Replace `/workspace/<name>` references with `/workspaces/weftwise/<name>` in:
- `CLAUDE.md` (quick reference section)
- `.claude/commands/worktree.md` (all path references)

### 4. Update active scripts and docs

Replace `/workspace` references in:
- `scripts/worktree.sh`
- `scripts/validate_wezterm_ssh.sh`
- `scripts/migrate_devcontainer_volumes.sh`
- `docs/worktree_development.md`
- `docs/claude_session_management.md`

Historical docs and archived files are left as-is (they document the state at time of writing).

## Important Design Decisions

**Why `/workspaces/weftwise` (not `/workspaces/weft`)?**
The project name in lace config is `weftwise` (matching the `LACE_PROJECT_NAME` and container name).
The mount target should match the project identity, not the package name.

**Why keep `COPY . .` (moved to `/build`) instead of removing it?**
Unlike lace, weftwise uses the COPY for a real purpose: building the Electron renderer SPA at image build time.
Moving it to `/build` preserves this functionality while isolating it from the runtime workspace.

**Why not multi-stage build?**
An isolated `/build` directory is simpler and sufficient.
Multi-stage would add complexity without meaningful benefit since the `/build` contents are harmless (not on the directory walk path).

**Why add `claude-config-json` as a project mount rather than feature-injected?**
The claude-code feature injects the `claude-code/config` mount for the `.claude/` directory.
The `.claude.json` file mount is a project-level concern (it fixes the CLAUDE_CONFIG_DIR split-brain specific to how this project sets containerEnv).
Keeping it in the project's mount declarations makes the relationship explicit.

## Edge Cases / Challenging Scenarios

**Electron build at `/build` path.**
The Electron build may reference `__dirname` or relative paths.
If `pnpm build:electron` fails at `/build`, the error is non-fatal (existing `|| true` pattern) and can be resolved at runtime.
The build output is for pre-warming only; the runtime bind mount provides the actual source.

**Existing container state.**
Users with an existing weftwise container must rebuild after this change.
`lace up --rebuild` handles this.

**Global settings.json repoMount overrides.**
The clauthier repoMount override in `~/.config/lace/settings.json` already uses host-path mirroring (`target: "/var/home/mjr/code/weft/clauthier/main"`).
Adding the declaration in devcontainer.json is sufficient; no settings.json changes needed.

**Scripts with hardcoded `/workspace` paths.**
`scripts/worktree.sh` likely uses `/workspace` as a base for worktree operations.
These must be updated to use an environment variable or the new hardcoded path.

> NOTE(opus/weftwise-migration): Consider using `$CONTAINER_WORKSPACE_FOLDER` parent (strip last path component) instead of hardcoding, for portability.
> However, matching lace's approach of explicit paths is simpler and more debuggable.

## Test Plan

No automated test suite in the weftwise project tests workspace paths directly (unlike lace's `workspace-layout.test.ts`).
Verification is entirely manual/container-based.

1. **Dockerfile builds successfully** with the isolated `/build` pattern.
2. **`lace up`** generates correct config with `/workspaces/weftwise` paths.
3. **Container rebuild** succeeds and the workspace is accessible.
4. **No stale files** at `/workspaces/` root or `/workspace/`.
5. **Clauthier mount** resolves inside the container at the expected host-mirror path.
6. **Claude Code** starts without onboarding re-prompt (claude-config-json fix).
7. **Worktree operations** work with updated paths.

## Verification Methodology

After each phase, run `lace up` from the lace project directory (targeting weftwise) and verify the generated `.lace/devcontainer.json`.
After the final phase, rebuild the container and verify inside it:

```bash
# Verify workspace mount
ls -la /workspaces/weftwise/main/CLAUDE.md

# Verify no stale files
ls /workspaces/CLAUDE.md 2>&1  # should fail
ls /workspace/ 2>&1             # should fail

# Verify clauthier mount (host-path mirrored inside container)
ls /var/home/mjr/code/weft/clauthier/main/

# Verify clauthier symlink
readlink /mnt/lace/repos/clauthier

# Verify Claude config
cat /home/node/.claude/.claude.json | head -5

# Verify pnpm works
pnpm --version
```

## Implementation Phases

### Phase 1: Dockerfile changes

1. Change `mkdir -p /workspace` to `mkdir -p /workspaces`.
2. Change `chown -R ${USERNAME}:${USERNAME} /workspace` to reference `/workspaces`.
3. Change `WORKDIR /workspace` (line 72) to `WORKDIR /build`.
4. The Electron/Playwright pre-install layers now run under the `/build` WORKDIR; their `node_modules/` land at `/build/node_modules/`, consistent with the subsequent `pnpm install`.
5. Keep `COPY --chown=${USERNAME}:${USERNAME} package.json ...` (now targets `/build`).
6. Keep `COPY --chown=${USERNAME}:${USERNAME} . .` (now copies to `/build`).
7. Keep `pnpm build:electron` (now runs at `/build`).
8. Update the Electron build error handling: change the `cp` fallback to simply log to `/tmp/electron_build_error.log` (the `/workspace/` copy target no longer makes sense).
9. Add final `WORKDIR /workspaces` after the build steps.

**Constraint:** Do not modify the Playwright/Electron pre-install layers or system package installs.

### Phase 2: devcontainer.json changes

1. Change `mountTarget` from `"/workspace"` to `"/workspaces/weftwise"`.
2. Add `claude-config-json` mount declaration to `customizations.lace.mounts`.
3. Add `repoMounts` section with clauthier declaration.
4. Run `lace up` from the weftwise worktree directory (`/var/home/mjr/code/weft/weftwise/main/`) and verify the generated `.lace/devcontainer.json` has correct paths.

**Constraint:** Do not modify vscode settings, prebuildFeatures, or validate sections.

### Phase 3: CLAUDE.md, commands, and script updates

1. Update `CLAUDE.md` worktree quick reference: `/workspace/feature-name` -> `/workspaces/weftwise/feature-name`.
2. Update `.claude/commands/worktree.md`: all `/workspace/<name>` references -> `/workspaces/weftwise/<name>`.
3. Update `scripts/worktree.sh`: hardcoded `/workspace` paths.
4. Update `scripts/validate_wezterm_ssh.sh` if it references `/workspace`.
5. Update `scripts/migrate_devcontainer_volumes.sh`: hardcoded `/workspace` path.
6. Update `docs/worktree_development.md` and `docs/claude_session_management.md`.

**Constraint:** Do not modify historical devlogs, proposals, or archived docs.

### Phase 4: Verification

1. `lace up` from the lace project directory.
2. `lace up --rebuild` to rebuild the weftwise container.
3. Verify all test plan items inside the container.
4. Verify worktree operations work with new paths.
