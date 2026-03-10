---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-07T09:15:00-08:00
task_list: lace/weftwise-migration
type: report
state: live
status: wip
tags: [investigation, migration, weftwise, docker-build, devcontainer, failure-analysis]
related_to:
  - cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
  - cdocs/devlogs/2026-03-03-weftwise-migration-implementation.md
  - cdocs/devlogs/2026-03-04-weftwise-migration-phases-6-7.md
  - cdocs/reviews/2026-03-04-review-of-weftwise-migration-implementation.md
---

# Weftwise Lace Migration Failure Analysis

> BLUF: `lace up` in weftwise/main fails at the `devcontainer up` phase due to a Docker build error (`cannot copy to non-directory: .../node_modules/tsx`). The root cause is a missing `.dockerignore` file combined with host-local `node_modules` created by `pnpm install` on January 30. This is a pre-existing Dockerfile defect that predates the lace migration, but was never encountered because the last successful container build (January 25) occurred before `node_modules` existed on the host. The lace migration itself (Phases 1-7) is correctly implemented; all phases up to config generation succeed. The migration was verified only with `--skip-devcontainer-up` and never with a full `devcontainer up`, so the Docker build failure was not caught.

## Context / Background

The weftwise project underwent a seven-phase migration to lace idioms between March 3-5, 2026. The migration replaced manual devcontainer configuration (hardcoded ports, static mounts, inline tool installation) with lace's declarative system (workspace layout detection, port allocation, mount declarations, prebuild features, host validation).

The user reports that `lace up` in `/home/mjr/code/weft/weftwise/main` fails to launch. This investigation reproduces and diagnoses the failure.

## Key Findings

- **Primary failure**: Docker build step `COPY --chown=node:node . .` (Dockerfile line 124) fails with `cannot copy to non-directory: .../workspace/node_modules/tsx`. This occurs because:
  1. The Dockerfile runs `pnpm install --frozen-lockfile` which creates `node_modules/tsx` as a pnpm symlink inside the container.
  2. `COPY . .` then tries to copy the host's `node_modules/tsx` (a real directory) over the symlink. Docker BuildKit cannot overwrite a non-directory (symlink) with a directory.

- **No `.dockerignore` exists** and never has in the weftwise repo. Without it, `COPY . .` sends the entire project directory as build context, including `node_modules`.

- **Host `node_modules` was created on January 30** (from `pnpm install` run on the host). The last successful container build was January 25 (image `vsc-weft-*`), before `node_modules` existed locally. Every Docker build after January 30 would fail identically.

- **The lace migration did not introduce this bug.** The same Dockerfile and `COPY . .` pattern existed before the migration (commit `4aada8a` and earlier). The migration correctly removed ~60 lines of generic tooling from the Dockerfile but did not modify the COPY step or add a `.dockerignore`.

- **Migration was verified only with `--skip-devcontainer-up`**. Both the Phase 1-5 devlog and the Phase 6-7 devlog document successful runs of `lace up --skip-devcontainer-up`. Neither documents a full `devcontainer up` or actual container creation. The devlog explicitly notes "What still needs manual verification: Actual container build with the reduced Dockerfile" but this was never completed.

- **No weftwise container has ever been created via lace.** Docker shows zero containers with `lace.project_name=weftwise`. The existing `vsc-weft-*` image from January 25 predates the migration entirely.

- **The prebuild image is healthy.** `lace.local/node:24-bookworm` (built March 7) contains all expected tools: `wezterm-mux-server`, `claude`, and `nvim` are all present and accessible.

- **All lace phases succeed up to `devcontainerUp`.** Workspace layout detection, host validation, metadata fetch, port allocation (22425), mount resolution (4 mounts), prebuild cache check, and config generation all complete without error. The failure occurs only when `devcontainer up` shells out to `docker buildx build`.

## Failure Reproduction

```
$ cd /var/home/mjr/code/weft/weftwise/main && lace up

Auto-configured for worktree 'main' in /var/home/mjr/code/weft/weftwise
Fetching feature metadata...
[... all phases succeed ...]
Starting devcontainer...
[... docker buildx build ...]
#18 [dev_container_auto_added_stage_label 14/15] COPY --chown=node:node . .
#18 ERROR: cannot copy to non-directory: /var/lib/docker/overlay2/.../workspace/node_modules/tsx
LACE_RESULT: {"exitCode":1,"failedPhase":"devcontainerUp","containerMayBeRunning":false}
```

The failure reproduces identically with `--no-cache`, confirming it is not a stale Docker layer cache issue.

## Root Cause Analysis

The Dockerfile follows a common Docker pattern for Node.js projects:

```dockerfile
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
```

This pattern assumes the build context does NOT contain `node_modules`. The intent is:
1. Copy lockfiles, install deps (cached layer).
2. Copy source code over the installed deps.

When `node_modules` exists in the build context (the host), step 2 tries to merge the host's `node_modules` into the container's `node_modules`. Pnpm creates symlinks for packages in `node_modules`; the host has real directories. Docker BuildKit cannot replace a symlink with a directory, causing the fatal `cannot copy to non-directory` error.

This is a well-known Docker + pnpm interaction. The standard fix is a `.dockerignore` that excludes `node_modules`.

## Secondary Issues Discovered

### 1. All features in `prebuildFeatures`, none in `features`

The `a473a1e` ("lace cleanup") commit moved `git:1` and `sshd:1` from the top-level `features` section to `prebuildFeatures`. The weftwise devcontainer.json now has NO `features` section at all. All five features (git, sshd, wezterm-server, claude-code, neovim) are exclusively in `prebuildFeatures`.

This contradicts the Phase 6 devlog, which states: "Lace's prebuild system enforces mutual exclusivity between `features` and `prebuildFeatures`" and that features should be in "only ONE of the two sections." However, the lace project's own devcontainer.json also uses this pattern (all features in `prebuildFeatures`, none in `features`), and its container runs successfully.

The concern is whether feature entrypoints (particularly the sshd init script that starts the SSH server) are properly activated when features are only in `prebuildFeatures`. The lace project's working container suggests the devcontainer CLI does discover entrypoints from prebuild lock files, but this should be verified for weftwise once the Docker build issue is resolved.

### 2. Lace `.devcontainer/Dockerfile` is a copy of weftwise's

The lace project's `.devcontainer/Dockerfile` contains weftwise-specific content (Electron, Playwright, pnpm build steps). This appears to be a leftover from the "extracting lace" phase (`4aada8a`) and was never cleaned up. It works because the lace project root has no `node_modules` (dependencies live under `packages/lace/node_modules/`).

### 3. Verification gap in migration devlogs

Both migration devlogs document `lace up --skip-devcontainer-up` as the verification method. The Phase 1-5 devlog explicitly lists "Actual container build with the reduced Dockerfile" under "What still needs manual verification." This verification was never performed, and the Phase 6-7 devlog does not mention it either. The review (`2026-03-04-review-of-weftwise-migration-implementation.md`) also did not flag the absence of an actual build test.

## Recommendations for Troubleshooting Agent

### Immediate fix (unblocks `lace up`)

Create a `.dockerignore` file at the weftwise project root (`/var/home/mjr/code/weft/weftwise/main/.dockerignore`) that excludes `node_modules` and other build artifacts from the Docker build context:

```dockerignore
node_modules
.lace
dist
dist-electron
.output
.next
coverage
test-output
playwright-report
.pnpm-store
.tanstack
```

This mirrors what `.gitignore` already excludes and is the standard solution for the pnpm + Docker COPY conflict.

### Verify after fix

After creating `.dockerignore`, run `lace up` (without `--skip-devcontainer-up`) and verify:
1. Docker build succeeds.
2. Container starts and tools are available (`wezterm-mux-server --version`, `claude --version`, `nvim --version`).
3. SSH connection works on port 22425 (`ssh -p 22425 node@localhost`).
4. Mounts are correctly bound (check `/home/node/.config/nushell`, `/home/node/.claude`, etc.).
5. The sshd feature entrypoint activates correctly (sshd is running inside the container).

### Additional cleanup

- The lace project's `.devcontainer/Dockerfile` should be reviewed and likely simplified to remove weftwise-specific content (Electron, Playwright build steps).
- Consider adding a `.dockerignore` to the `.devcontainer/` directory as well, since the devcontainer CLI may use different context paths.
- The migration devlog should be updated to document this failure and its resolution as a post-migration fix.
