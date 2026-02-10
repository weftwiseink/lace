---
first_authored:
  by: "claude-opus-4-6"
  at: "2026-02-09T12:00:00-08:00"
task_list: devcontainer/self-hosting
type: proposal
state: live
status: accepted
tags: [devcontainer, lace, self-hosting, port-allocation, dogfooding, prebuild]
last_reviewed:
  status: accepted
  by: "claude-opus-4-6"
  at: "2026-02-09T10:00:00-08:00"
  round: 4
---

# Migrate Lace Devcontainer to Lace Idioms (Self-Hosting)

> BLUF: The lace monorepo's own devcontainer predates lace's port provisioning and feature awareness systems. It uses a hardcoded `appPort: "2222:2222"` outside the lace discovery range (22425-22499), meaning `lace-discover`, `wez-lace-into`, and the wezterm plugin picker cannot find it. This proposal migrates to lace idioms: stable infrastructure features (git, sshd) move to `customizations.lace.prebuildFeatures` for baking into the base image, while port-declaring features (wezterm-server) and project-specific features (claude-code, neovim, nushell) stay in the standard `features` block. The hardcoded `appPort` is replaced with an explicit `${lace.port(wezterm-server/hostSshPort)}:2222` template using asymmetric mapping. The Dockerfile wezterm.lua COPY is replaced by a bind mount, `default_cwd` is fixed from `/workspace/lace` to `/workspace/main`, and `bin/open-lace-workspace` is deleted (superseded by Gen 2 tooling: `wez-lace-into`, `lace-discover`, plugin picker).
>
> NOTE: R1/R2 review identified that `up.ts` auto-injection only reads from the `features` block, not `prebuildFeatures`. This means port-declaring features like wezterm-server MUST stay in `features`. Non-port features (git, sshd) can safely move to `prebuildFeatures`. R3 feedback requested the prebuildFeatures split and open-lace-workspace removal.

## Objective

Make the lace devcontainer discoverable by lace's own tooling (`lace-discover`, `wez-lace-into`, the wezterm plugin project picker) by migrating from legacy hardcoded port and manual feature setup to lace's `customizations.lace` idioms.

## Background

### Current state

The lace devcontainer (`.devcontainer/devcontainer.json`, 92 lines) uses patterns that predate lace's feature awareness system:

- **`appPort: ["2222:2222"]`** -- hardcoded port 2222, which is outside the lace discovery range of 22425-22499. `lace-discover` scans for ports in 22425-22499 mapped to container port 2222, so this container is invisible.
- **`features` block** -- sshd, git, wezterm-server, claude-code, neovim, nushell are installed as standard devcontainer features. No `customizations.lace` section exists, so the devcontainer is not recognized by lace tooling.
- **Dockerfile SSH setup** (lines 93-98) -- manually creates `/home/node/.ssh` with correct permissions. The sshd feature handles this.
- **Dockerfile wezterm config** (lines 101-105) -- creates `.config/wezterm/` and COPYs `.devcontainer/wezterm.lua` into the container image. This bakes a path into the image layer.
- **Container-side `wezterm.lua`** -- sets `default_cwd = "/workspace/lace"`, but the actual `workspaceFolder` is `/workspace/main` (the worktree directory). This is a latent bug.
- **`bin/open-lace-workspace`** -- 379-line Gen 1 launcher with hardcoded `SSH_PORT=2222`. Superseded by Gen 2 tooling (`wez-lace-into`, `lace-discover`, plugin picker) and broken after port migration anyway.

### Reference: dotfiles devcontainer

The dotfiles devcontainer (`.devcontainer/devcontainer.json`, 39 lines) demonstrates the modern pattern:

- No `appPort` -- lace assigns a port in 22425-22499 via `${lace.port()}` template auto-injection.
- `customizations.lace.prebuildFeatures` for git, sshd, wezterm-server.
- `customizations.lace.repoMounts` for cross-project access.
- No Dockerfile at all (uses prebuild image).
- No container-side wezterm.lua.

### How lace port provisioning works

When `lace up` processes a devcontainer.json:
1. It extracts feature IDs from the standard `features` block (NOT from `prebuildFeatures`).
2. For features with `customizations.lace.ports` in their `devcontainer-feature.json` (like wezterm-server's `hostSshPort`), it auto-injects `${lace.port(wezterm-server/hostSshPort)}` templates into the feature options.
3. Template resolution allocates a port in 22425-22499 via `PortAllocator`.
4. The resolved config is written to `.lace/devcontainer.json` with concrete `appPort`, `forwardPorts`, and `portsAttributes` entries.
5. `devcontainer up` is invoked with `--config .lace/devcontainer.json`.

> NOTE: Auto-injection only reads from `features`, not `prebuildFeatures`. This means features with `customizations.lace.ports` metadata (like wezterm-server's `hostSshPort`) MUST remain in the `features` block for auto-injection to work. Features without port declarations (git, sshd) can safely live in either block. The `prebuildFeatures` block feeds the prebuild image pipeline, which is separate from port provisioning.

### Scripts that reference port 2222

- **`bin/open-lace-workspace`** (DELETED) -- Gen 1 launcher with `SSH_PORT=2222` hardcoded on line 44. Superseded by Gen 2 tooling and broken after port migration. Removed as part of this change.
- **`bin/lace-discover`** -- searches for ports in 22425-22499 range; correctly would NOT find port 2222. After migration it will find the lace container.
- **`bin/wez-lace-into`** -- uses `lace-discover` output, connects via `wezterm connect "lace:$PORT"`. Will work automatically after migration.

## Proposed Solution

### 1. devcontainer.json changes

Replace the hardcoded `appPort` with a `${lace.port()}` template using asymmetric mapping. Add a `customizations.lace` section with `prebuildFeatures` for stable infrastructure features. Keep port-declaring and project-specific features in the standard `features` block:

```jsonc
{
  // ... existing build, runArgs unchanged ...

  "customizations": {
    "vscode": { /* unchanged */ },
    // Lace self-hosting: prebuild stable features into the base image layer.
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/devcontainers/features/sshd:1": {}
      }
    }
  },

  // Asymmetric mapping: host port in lace range -> container port 2222 (sshd default)
  // lace up resolves the template to e.g. "22425:2222"
  "appPort": ["${lace.port(wezterm-server/hostSshPort)}:2222"],

  // Project-specific features installed at container build time.
  // wezterm-server MUST be here (not in prebuildFeatures) because
  // lace up auto-injection reads port metadata only from the features block.
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
    "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
    "ghcr.io/eitsupi/devcontainer-features/nushell:0": {},
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "version": "20240203-110809-5046fc22"
    }
  },

  // Keep existing mounts, postStartCommand, workspaceMount, etc.
}
```

The feature split rationale:
- **`prebuildFeatures`** (git, sshd): Stable infrastructure features with no port metadata. Baked into the prebuild image via `lace prebuild`, which rewrites the Dockerfile FROM to `lace.local/node:24-bookworm-...`. These change rarely and benefit from image layer caching.
- **`features`** (wezterm-server, claude-code, neovim, nushell): Port-declaring features (wezterm-server has `customizations.lace.ports.hostSshPort`) MUST be here for `lace up` auto-injection to work. Project-specific features (claude-code, neovim, nushell) are here because they are development tooling that may change more frequently.

The asymmetric `appPort` mapping is critical: sshd inside the container listens on port 2222 (its default), while the host port is allocated from the lace range (22425-22499). `lace-discover` looks for Docker port patterns matching `<lace_port>->2222/tcp`, which this mapping satisfies. This matches the S1 "explicit mode" pattern from the wezterm-server scenario tests.

> NOTE: `validateNoOverlap()` in `validation.ts` prevents the same feature from appearing in both `prebuildFeatures` and `features`. The split above respects this constraint -- no feature appears in both blocks.

### 2. Dockerfile changes

Remove the wezterm.lua COPY (replaced by bind mount). Keep the SSH directory setup and the wezterm config directory creation (the bind mount target needs to exist):

```dockerfile
# KEEP: SSH directory setup (sshd feature does NOT create per-user .ssh directories)
RUN mkdir -p /home/${USERNAME}/.ssh && \
    chmod 700 /home/${USERNAME}/.ssh && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/.ssh

# KEEP: wezterm config directory (bind mount target needs to exist)
RUN mkdir -p /home/${USERNAME}/.config/wezterm && \
    chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config

# REMOVE: wezterm.lua COPY (replaced by bind mount in devcontainer.json)
# COPY --chown=${USERNAME}:${USERNAME} .devcontainer/wezterm.lua /home/${USERNAME}/.config/wezterm/wezterm.lua
```

> NOTE: The sshd feature (`ghcr.io/devcontainers/features/sshd:1`) installs openssh-server but does NOT create per-user `.ssh` directories. The existing Dockerfile comment (line 94) documents this accurately. The `.ssh` directory must remain in the Dockerfile for the `authorized_keys` bind mount to work.

Everything else in the Dockerfile stays: node base image, apt-get for playwright/electron deps, pnpm, git-delta, sudoers, the build steps.

### 3. Container-side wezterm.lua

The file `.devcontainer/wezterm.lua` is kept but updated:

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()
config.default_cwd = "/workspace/main"
return config
```

The `default_cwd` changes from `/workspace/lace` to `/workspace/main` because the `workspaceFolder` is `/workspace/main` (the main worktree). The old value `/workspace/lace` is wrong -- that path does not exist in the container.

This file is delivered into the container via a bind mount added to the `mounts` array:

```jsonc
"source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
```

Using a mount instead of COPY means changes to the file take effect without rebuilding the container.

### 4. postStartCommand stays

The `postStartCommand: "wezterm-mux-server --daemonize 2>/dev/null || true"` stays unchanged. This is required regardless of how features are organized -- the mux server must start after the container starts.

## Important Design Decisions

### Split features between prebuildFeatures and features

**Decision:** Move git and sshd to `customizations.lace.prebuildFeatures`. Keep wezterm-server, claude-code, neovim, and nushell in the standard `features` block.

**Why:** The split follows two principles:
1. **Port auto-injection constraint**: `up.ts` extracts feature IDs exclusively from `config.features` (lines 120-125). `autoInjectPortTemplates()` iterates `config.features` only (lines 88-94 of `template-resolver.ts`). Features with `customizations.lace.ports` metadata (wezterm-server) MUST be in `features` for port allocation to work.
2. **Stable infrastructure vs. project tooling**: git and sshd are stable infrastructure features that change rarely -- ideal for prebuild image baking. Claude-code, neovim, and nushell are project-specific development tooling that benefits from standard feature installation at container build time.

This approach matches the dotfiles devcontainer pattern (git, sshd in `prebuildFeatures`) while respecting the port auto-injection constraint that the dotfiles container sidesteps by not needing explicit `appPort` templates.

### Use asymmetric appPort mapping, not symmetric

**Decision:** Use `appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"]` (asymmetric) instead of letting lace auto-generate symmetric `port:port` mapping.

**Why:** The sshd feature always configures sshd to listen on port 2222 inside the container (its hardcoded default). The `wezterm-server` feature's `hostSshPort` option is lace-level metadata only -- it does not configure sshd. A symmetric mapping like `22425:22425` would map to a port nothing is listening on. The asymmetric pattern maps the allocated host port to container port 2222 where sshd actually listens. This also aligns with `lace-discover`'s `->2222/tcp` search pattern.

### Deliver wezterm.lua via bind mount, not COPY

**Decision:** Replace the Dockerfile `COPY` with a bind mount in `mounts`.

**Why:** The COPY approach bakes the wezterm config into the image layer, requiring a full rebuild to update it. A bind mount reflects changes immediately. The dotfiles devcontainer does not use a container-side wezterm.lua at all (wezterm-mux-server starts with default config), but the lace container benefits from setting `default_cwd` to the worktree directory since the workspace mount structure (`/workspace` containing `main/`, `feature-branch/`, etc.) means wezterm would otherwise start in `/` or the container's WORKDIR.

### Delete open-lace-workspace

**Decision:** Delete `bin/open-lace-workspace` entirely rather than updating it.

**Why:** The script is a Gen 1 launcher (379 lines) with hardcoded `SSH_PORT=2222`, SSH polling, container detection, and WezTerm connection logic. Gen 2 tooling (`wez-lace-into`, `lace-discover`, the wezterm plugin picker) supersedes all of its functionality with a cleaner architecture. The port migration breaks the script anyway, and maintaining it alongside the Gen 2 tools would be wasted effort. Historical references in cdocs documents are left intact as archival records.

### Fix default_cwd from /workspace/lace to /workspace/main

**Decision:** Change the container-side wezterm.lua `default_cwd` from `/workspace/lace` to `/workspace/main`.

**Why:** The devcontainer's `workspaceFolder` is `/workspace/main`. The parent `/workspace` is the bare repo root, and `main` is the worktree directory. `/workspace/lace` does not exist in the container. This was a latent bug -- wezterm-mux-server would have fallen back to `/` or the user's home directory.

## Edge Cases / Challenging Scenarios

### First lace up after migration

The first `lace up` after this change will:
1. Allocate a new port in 22425-22499 for `wezterm-server/hostSshPort`.
2. Write it to `.lace/port-assignments.json` (gitignored).
3. Generate `.lace/devcontainer.json` with the concrete port.
4. Invoke `devcontainer up --config .lace/devcontainer.json`.

The container will need a full rebuild since the Dockerfile changed (removed layers). Subsequent `lace up` runs will reuse the assigned port.

### SSH authorized_keys mount requires .ssh directory

The SSH authorized_keys mount (`source=~/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys`) requires the `.ssh` directory to exist. The sshd feature does NOT create per-user `.ssh` directories (verified by inspecting the feature's install.sh). The Dockerfile's SSH directory setup block is retained to ensure the mount target exists.

### Prebuild image rewrites Dockerfile FROM

With `prebuildFeatures` configured, `lace prebuild` will rewrite the Dockerfile `FROM node:24-bookworm` to `FROM lace.local/node:24-bookworm-...` (a local image with git and sshd baked in). The `prebuild.ts` pipeline handles this via `rewriteFrom()`. On the first run after migration, a full prebuild will occur. Subsequent runs reuse the cached prebuild image unless the prebuild context changes (e.g., feature version bumps).

Unlike the dotfiles devcontainer (which is image-based and has ALL features in `prebuildFeatures`), the lace container keeps project-specific features in the standard `features` block because it has Dockerfile-level build steps (playwright, electron, pnpm) that run on top of the prebuild image.

## Implementation Phases

### Phase 1: Update devcontainer.json

1. Replace `"appPort": ["2222:2222"]` with `"appPort": ["${lace.port(wezterm-server/hostSshPort)}:2222"]`.
2. Add `customizations.lace.prebuildFeatures` with git and sshd.
3. Move git and sshd from `features` to `prebuildFeatures`.
4. Keep wezterm-server, claude-code, neovim, nushell in `features`.
5. Add wezterm.lua bind mount to `mounts`.
6. Validate the resulting JSONC is well-formed.

### Phase 2: Update Dockerfile

1. Keep the SSH directory setup block -- sshd feature does NOT create per-user `.ssh` directories.
2. Keep the wezterm config directory creation (mount target needs to exist) but remove the COPY.
3. Keep all other Dockerfile content unchanged.

### Phase 3: Update wezterm.lua

1. Change `default_cwd` from `"/workspace/lace"` to `"/workspace/main"`.

### Phase 4: Delete open-lace-workspace

1. Delete `bin/open-lace-workspace` (superseded by Gen 2 tooling).
2. Delete `lace_workspace_error.log` (stale error log from the deleted script).
3. Leave cdocs references intact (historical archives, not code).

### Phase 5: Verification (manual, post-merge)

1. Run `lace up` from the repo root.
2. Verify `.lace/port-assignments.json` is created with a port in 22425-22499.
3. Verify `lace-discover` lists the lace container.
4. Verify `wez-lace-into` connects successfully.
5. Verify SSH access works with `ssh -p <assigned-port> -i ~/.ssh/lace_devcontainer node@localhost`.
6. Verify wezterm-mux-server panes open in `/workspace/main`.
