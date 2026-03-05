---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-04T14:30:00-08:00
task_list: lace/weftwise-migration
type: devlog
state: archived
status: done
tags: [migration, weftwise, devcontainer, oci, prebuild, ghcr]
related_to:
  - cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
  - cdocs/devlogs/2026-03-03-weftwise-migration-implementation.md
---

# Weftwise Devcontainer Lace Migration: Phases 6 and 7

## Objective

Complete Phases 6 and 7 of the weftwise devcontainer lace migration as defined in the
[migration proposal](../proposals/2026-03-03-weftwise-devcontainer-lace-migration.md).
These phases switch from local path feature references to published GHCR OCI references,
add prebuild feature declarations, and verify `lace up` as the entry point.

## Phase 6: Switch to GHCR OCI Refs and Add Prebuild Features

### Changes Made

In `.devcontainer/devcontainer.json`:

1. **Replaced local path feature references with GHCR OCI refs.** The three lace features
   were previously referenced via relative local paths requiring a lace repo checkout:
   ```jsonc
   // Before:
   "../../lace/main/devcontainers/features/src/wezterm-server": {},
   "../../lace/main/devcontainers/features/src/claude-code": { "version": "2.1.11" },
   "../../lace/main/devcontainers/features/src/neovim": { "version": "0.11.6" }
   ```

2. **Moved lace features to `prebuildFeatures` section** (not `features`). Lace's prebuild
   system enforces mutual exclusivity between `features` and `prebuildFeatures` via
   `validateNoOverlap()`. Features in `prebuildFeatures` are baked into a cached
   `lace.local/` Docker image; the devcontainer CLI discovers their entrypoints through
   the lock file, so they do not need to also appear in `features`:
   ```jsonc
   // After:
   "features": {
     "ghcr.io/devcontainers/features/git:1": {},
     "ghcr.io/devcontainers/features/sshd:1": {}
   },
   // In customizations.lace:
   "prebuildFeatures": {
     "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
     "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": { "version": "2.1.11" },
     "ghcr.io/weftwiseink/devcontainer-features/neovim:1": { "version": "v0.11.6" }
   }
   ```

3. **Removed TODO comments** about OCI refs (they are no longer TODOs).

### Important Correction: OCI Namespace

The migration proposal incorrectly specified `ghcr.io/weftwiseink/lace/<feature>` as the
OCI namespace. The correct namespace (confirmed by the GitHub Actions release workflow) is
`ghcr.io/weftwiseink/devcontainer-features/<feature>`.

### Important Correction: prebuildFeatures vs features Overlap

The proposal stated features MUST remain in both `features` and `prebuildFeatures`. This
is incorrect. Lace's `validateNoOverlap()` in `packages/lace/src/lib/validation.ts`
enforces that the same feature identifier cannot appear in both sections. The prebuild
system bakes features into the base image and the devcontainer CLI discovers entrypoints
through the lock file merge (`packages/lace/src/lib/lockfile.ts`). Features should be in
only ONE of the two sections.

## Phase 7: Verify `lace up` as Entry Point

### Issue Discovered: Neovim Version Format

The neovim feature's `install.sh` constructs download URLs using the version option
directly. Neovim GitHub releases use v-prefixed tags (`v0.11.6`), but the devcontainer.json
specified `"version": "0.11.6"` (without `v`), causing a 404 during prebuild.

**Fix in weftwise**: Changed version to `"version": "v0.11.6"`.

**Fix in lace**: Added version normalization to `devcontainers/features/src/neovim/install.sh`:
```sh
case "$VERSION" in
    v*) ;;
    *)  VERSION="v${VERSION}" ;;
esac
```

### Verification Output

```
$ lace up --skip-devcontainer-up

Auto-configured for worktree 'main' in /var/home/mjr/code/weft/weftwise
Fetching feature metadata...
Validated metadata for 5 feature(s)
Auto-injected port templates for: wezterm-server/hostSshPort
Auto-injected mount templates for: project/nushell-config, wezterm-server/authorized-keys, claude-code/config, neovim/plugins
Allocated ports:
  wezterm-server/hostSshPort: 22425
Resolved mount sources:
  project/nushell-config: /home/mjr/.config/nushell
  wezterm-server/authorized-keys: /home/mjr/.config/lace/ssh/id_ed25519.pub
  claude-code/config: /home/mjr/.claude
  neovim/plugins: /home/mjr/.local/share/nvim
Mount configuration:
  project/nushell-config: /home/mjr/.config/nushell (directory)
  wezterm-server/authorized-keys: /home/mjr/.config/lace/ssh/id_ed25519.pub (file)
  claude-code/config: /home/mjr/.claude (directory)
  neovim/plugins: /home/mjr/.local/share/nvim (directory)
Running prebuild...
Building prebuild image: lace.local/node:24-bookworm
Features: ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1, ghcr.io/weftwiseink/devcontainer-features/claude-code:1, ghcr.io/weftwiseink/devcontainer-features/neovim:1
Prebuild complete. Dockerfile FROM rewritten to: lace.local/node:24-bookworm
Generating extended devcontainer.json...
lace up completed (devcontainer up skipped)
LACE_RESULT: {"exitCode":0,"failedPhase":null,"containerMayBeRunning":false}
```

### Generated Config Verification

The `.lace/devcontainer.json` confirms:

- **Features from GHCR**: Only `git:1` and `sshd:1` in `features`; lace features in `prebuildFeatures`
- **Port allocation**: `appPort: ["22425:2222"]` -- port 22425 is in the 22425-22499 range
- **Mounts resolved**: 4 mounts from declarations and feature metadata:
  - `nushell-config` -> `/home/node/.config/nushell`
  - `wezterm-server/authorized-keys` -> `/home/node/.ssh/authorized_keys` (readonly)
  - `claude-code/config` -> `/home/${_REMOTE_USER}/.claude`
  - `neovim/plugins` -> `/home/${_REMOTE_USER}/.local/share/nvim`
- **Workspace layout**: `workspaceMount` -> bare repo root, `workspaceFolder` -> `/workspace/main`
- **Container env**: `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` auto-injected
- **Project labeling**: `--label lace.project_name=weftwise` and `--name weftwise` in `runArgs`
- **Port assignments**: `.lace/port-assignments.json` created with `wezterm-server/hostSshPort: 22425`
- **Prebuild image**: Dockerfile FROM rewritten to `lace.local/node:24-bookworm`

### Commits

In weftwise repo (`implement/lace-migration` branch):
1. `feat(devcontainer): switch to GHCR OCI refs and add prebuild features` -- Phase 6
2. `fix(devcontainer): use v-prefixed neovim version for GHCR feature` -- Phase 7 fix

In lace repo (`main` branch):
1. `fix(neovim): normalize version to v-prefix in install.sh` -- Robustness fix
