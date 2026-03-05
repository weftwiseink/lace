---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T12:00:00-08:00
task_list: lace/weftwise-migration
type: proposal
state: live
status: result_accepted
tags: [migration, weftwise, devcontainer, wezterm-server, port-allocation, workspace-layout, mounts, prebuilds, host-validation]
related_to:
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md
  - cdocs/proposals/2026-02-09-prebuild-features-port-support.md
  - cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md
  - cdocs/proposals/2026-02-15-mount-accessor-api.md
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-03T14:00:00-08:00
  round: 1
---

# Migrate Weftwise Devcontainer to Lace Idioms

> BLUF: Weftwise's devcontainer manually implements WezTerm server installation, SSH port mapping, workspace layout, bind mounts, and tool installation that lace has formalized into reusable abstractions. This proposal migrates weftwise to lace idioms in seven incremental phases, replacing ~60 Dockerfile lines and five devcontainer.json declarations with lace features, port allocation, mount declarations, and prebuilds. After migration, the Dockerfile retains only project-specific concerns (Playwright, Electron, pnpm) while generic user tooling (neovim, claude-code, wezterm) moves to devcontainer features.

## Objective

Replace weftwise's hand-rolled devcontainer infrastructure with lace's declarative equivalents, achieving:

1. **Multi-project support**: eliminate the hardcoded port 2222 that prevents running devcontainers from multiple projects simultaneously (e.g., weftwise and lace each with their own container).
2. **Team portability**: replace hardcoded host paths (`${localEnv:HOME}/code/dev_records/weft/...`) with mount declarations that team members can override via `~/.config/lace/settings.json`.
3. **Fail-fast validation**: catch missing SSH keys and mount sources before Docker silently creates root-owned empty directories.
4. **Faster rebuilds**: cache Claude Code and Neovim installation across container rebuilds via lace prebuilds.
5. **Reduced Dockerfile surface**: move ~60 lines of generic tooling into reusable devcontainer features.

## Background

### Weftwise Current State

Weftwise is an Electron + Node.js application. Its devcontainer setup lives at `/home/mjr/code/weft/weftwise/main/.devcontainer/` and consists of:

**devcontainer.json** -- 86 lines of JSONC configuring:
- Build via a custom Dockerfile with `node:24-bookworm` base
- Two devcontainer features: `ghcr.io/devcontainers/features/git:1` and `ghcr.io/devcontainers/features/sshd:1`
- Hardcoded `appPort: ["2222:2222"]` for WezTerm SSH domain multiplexing
- Three bind mounts: bash history, Claude config directory, SSH public key for WezTerm access
- Manual workspace layout: `workspaceMount` pointing to the bare repo root, `workspaceFolder` at `/workspace/main`
- Manual `postCreateCommand` for `git config --global --add safe.directory '*'`
- Manual `postStartCommand` for `wezterm-mux-server --daemonize`
- VS Code extensions and settings

**Dockerfile** -- 186 lines installing:
- System dependencies for Playwright/Electron/Chromium (apt-get, ~30 lines) -- **project-specific, stays**
- pnpm/corepack setup (~5 lines) -- **project-specific, stays**
- Git Delta 0.18.2 (~5 lines) -- **could become a feature**
- Neovim 0.11.6 (~8 lines) -- **generic, migrates to neovim devcontainer feature**
- WezTerm 20240203 via dpkg extraction (~18 lines) -- **generic, migrates to wezterm-server devcontainer feature**
- Runtime dir, SSH dir, sudoers setup (~10 lines) -- **handled by wezterm-server feature**
- Claude Code 2.1.11 global npm install (~3 lines) -- **generic, migrates to claude-code devcontainer feature**
- Electron pre-install, Playwright browser install (~6 lines) -- **project-specific, stays**
- Project dependency install and build (~10 lines) -- **project-specific, stays**

### Lace Capabilities Used

Each lace subsystem maps to a specific weftwise manual configuration:

| Weftwise Manual Config | Lace Replacement | Key Source File |
|---|---|---|
| Dockerfile WezTerm install (lines 108-128) | `wezterm-server` devcontainer feature | `devcontainers/features/src/wezterm-server/install.sh` |
| `appPort: ["2222:2222"]` | `PortAllocator` (22425-22499 range) | `packages/lace/src/lib/port-allocator.ts` |
| `workspaceMount` + `workspaceFolder` + `postCreateCommand` | `applyWorkspaceLayout()` with bare-worktree detection | `packages/lace/src/lib/workspace-layout.ts` |
| Three manual mount strings | Mount declarations with `${lace.mount.source()}` | `packages/lace/src/lib/template-resolver.ts` |
| No pre-flight validation | `runHostValidation()` with `fileExists` checks | `packages/lace/src/lib/host-validator.ts` |
| Dockerfile Claude Code + Neovim install | `prebuildFeatures` with `lace.local/` image caching | `packages/lace/src/lib/prebuild.ts` |
| `devcontainer up` | `lace up` (orchestrates all phases) | `packages/lace/src/lib/up.ts` |

### Exact Duplication Between Weftwise and Lace

The weftwise Dockerfile's WezTerm installation (lines 108-128) is a near-exact copy of the lace `wezterm-server` feature's `install.sh`:

```dockerfile
# Weftwise Dockerfile (lines 113-125):
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      DEB_NAME="wezterm-${WEZTERM_VERSION}.Debian12.deb"; \
    else \
      DEB_NAME="wezterm-${WEZTERM_VERSION}.Debian12.${ARCH}.deb"; \
    fi && \
    curl -fsSL -o /tmp/wezterm.deb \
      "https://github.com/wez/wezterm/releases/download/${WEZTERM_VERSION}/${DEB_NAME}" && \
    dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract && \
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/ && \
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/ && \
    rm -rf /tmp/wezterm.deb /tmp/wezterm-extract
```

```sh
# Lace wezterm-server feature install.sh (lines 51-63):
install_from_deb() {
    if [ "$ARCH" = "amd64" ]; then
        DEB_NAME="wezterm-${VERSION}.Debian12.deb"
    else
        DEB_NAME="wezterm-${VERSION}.Debian12.${ARCH}.deb"
    fi
    curl -fsSL -o /tmp/wezterm.deb \
        "https://github.com/wez/wezterm/releases/download/${VERSION}/${DEB_NAME}"
    dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/
    rm -rf /tmp/wezterm.deb /tmp/wezterm-extract
}
```

The feature additionally provides distro detection, workspace-aware wezterm.lua generation, and an entrypoint that auto-starts the mux server -- all of which weftwise currently handles manually or skips entirely.

## Proposed Solution

### Target devcontainer.json (After Full Migration)

```jsonc
{
  "name": "Weft Development (Worktrees)",
  "build": {
    "dockerfile": "Dockerfile",
    "args": {
      "TZ": "${localEnv:TZ:America/Los_Angeles}",
      "USERNAME": "node"
    },
    "context": ".."
  },
  "runArgs": [],
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "prisma.prisma",
        "ms-vscode.vscode-typescript-next",
        "christian-kohler.npm-intellisense",
        "formulahendry.auto-rename-tag",
        "naumovs.color-highlight",
        "oderwat.indent-rainbow",
        "yzhang.markdown-all-in-one",
        "anthropic.claude-code",
        "jackiotyu.git-worktree-manager"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.codeActionsOnSave": {
          "source.fixAll.eslint": "always"
        },
        "typescript.updateImportsOnFileMove.enabled": "always",
        "typescript.preferences.includePackageJsonAutoImports": "on",
        "editor.tabSize": 2,
        "files.trimTrailingWhitespace": true,
        "files.insertFinalNewline": true,
        "files.trimFinalNewlines": true,
        "claude.defaultMode": "bypassPermissions",
        "claudeCode.allowDangerouslySkipPermissions": true,
        "files.associations": {
          ".claude/settings.local.json": "jsonc",
          ".claude/settings.json": "jsonc"
        }
      }
    },
    "lace": {
      "workspace": {
        "layout": "bare-worktree",
        "mountTarget": "/workspace"
      },
      "mounts": {
        // Project-level mount: nushell is the primary shell, not managed by a feature
        "nushell-config": {
          "target": "/home/node/.config/nushell",
          "recommendedSource": "~/.config/nushell",
          "description": "Nushell configuration and history (primary shell)",
          "sourceMustBe": "directory"
        }
        // Feature-injected mounts (auto-declared by their respective features):
        //   claude-code/config → /home/node/.claude (from claude-code feature)
        //   neovim/plugins → /home/node/.local/share/nvim (from neovim feature)
        //   wezterm-server/authorized-keys → /home/node/.ssh/authorized_keys (from wezterm-server feature)
      },
      "validate": {
        "fileExists": [
          {
            "path": "~/.config/lace/ssh/id_ed25519.pub",
            "severity": "error",
            "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh"
          }
        ]
      },
      "prebuildFeatures": {
        "ghcr.io/weftwiseink/lace/wezterm-server:1": {},
        "ghcr.io/weftwiseink/lace/claude-code:1": { "version": "2.1.11" },
        "ghcr.io/weftwiseink/lace/neovim:1": { "version": "0.11.6" }
      }
    }
  },
  "containerEnv": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  },
  "features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/weftwiseink/lace/wezterm-server:1": {},
    "ghcr.io/weftwiseink/lace/claude-code:1": { "version": "2.1.11" },
    "ghcr.io/weftwiseink/lace/neovim:1": { "version": "0.11.6" }
  }
}
```

Notable removals from the current config:
- `appPort` -- generated by lace port allocation
- `mounts` -- generated by lace mount template resolution (feature-injected mounts + project-level `nushell-config`)
- `workspaceMount` -- generated by workspace layout detection
- `workspaceFolder` -- generated by workspace layout detection
- `postCreateCommand` -- generated by workspace layout (safe.directory)
- `postStartCommand` -- handled by wezterm-server feature entrypoint
- `bash-history` mount -- removed; nushell is now the primary shell

### Target Dockerfile (After Full Migration)

```dockerfile
# don't upgrade to 25! for some reason corepack doesn't come installed with it.
FROM node:24-bookworm

ARG ELECTRON_VERSION="39.2.7"
ARG PLAYWRIGHT_VERSION="1.57.0"
ARG GIT_DELTA_VERSION="0.18.2"
ARG USERNAME=node
ARG TZ
ENV TZ="$TZ"
ENV DEVCONTAINER=true

# Install essential system tools and Playwright dependencies
RUN apt-get update && apt-get install -y \
    git curl psmisc sudo \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libcairo2 libatspi2.0-0 \
    xvfb xauth libgtk-3-0 libnotify4 libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack
RUN corepack install -g pnpm@10.26.2+sha1.$(npm view pnpm@10.26.2 dist.shasum)
RUN corepack enable && corepack prepare pnpm@latest-10 --activate

# npm global directory
RUN mkdir -p /usr/local/share/npm-global && \
    chown -R node:node /usr/local/share

# Create workspace directory
RUN mkdir -p /workspace && \
    chown -R ${USERNAME}:${USERNAME} /workspace

WORKDIR /workspace

# Install git-delta
RUN ARCH=$(dpkg --print-architecture) && \
    wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# REMOVED: Neovim install (now neovim devcontainer feature)
# REMOVED: WezTerm install (now wezterm-server devcontainer feature)
# REMOVED: /run/user/1000 creation (now wezterm-server feature)
# REMOVED: SSH authorized_keys dir (now wezterm-server feature)
# REMOVED: Claude Code install (now claude-code devcontainer feature)
# REMOVED: bash history persistence (nushell is now primary shell)

# Enable passwordless sudo for container user
RUN echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} && \
    chmod 0440 /etc/sudoers.d/${USERNAME}

USER ${USERNAME}

ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Pre-install larger packages
RUN pnpm install "electron@${ELECTRON_VERSION}" && \
    node node_modules/electron/install.js

RUN pnpm install "playwright@${PLAYWRIGHT_VERSION}" && \
    npx playwright install chromium

# Copy and install project dependencies
COPY --chown=${USERNAME}:${USERNAME} package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=${USERNAME}:${USERNAME} . .

RUN pnpm build:electron 2>&1 | tee /tmp/electron_build.log || \
    (echo "WARNING: Electron build failed. See /workspace/electron_build_error.log" && \
     cp /tmp/electron_build.log /workspace/electron_build_error.log)
```

Lines removed: ~60 (WezTerm install, runtime dir, SSH dir, Neovim install, Claude Code install, bash history persistence). Project-specific concerns (Playwright, Electron, pnpm, system deps) stay in the Dockerfile; generic user tools (neovim, claude-code, wezterm) are now devcontainer features.

## Important Design Decisions

### Decision: Feature Reference Strategy (Published OCI References)

**Decision:** Use published OCI references (`ghcr.io/weftwiseink/lace/<feature>:1`) for all features. The wezterm-server feature already exists in the lace repository and has scenario tests; claude-code and neovim features are being created as new devcontainer feature packages.

**Why:** Published OCI references make features consumable by any project without cross-repository dependencies. All three features (wezterm-server, claude-code, neovim) must be published to GHCR before phases that depend on them can proceed. During active development of new features, local path references may be used temporarily, but the target state uses published references for consistency and cacheability.

### Decision: Hybrid Feature Strategy (Generic vs. Project-Specific)

**Decision:** Generic user tools (neovim, claude-code, wezterm-server) become devcontainer features. Project-specific tools (Playwright, Electron, pnpm, system dependencies) stay in the Dockerfile.

**Why:** Devcontainer features are reusable across projects and can be cached via prebuilds. Project-specific tools are tightly coupled to the project's build requirements and change at the project's cadence, not the tool's cadence. This separation means the Dockerfile only changes when project dependencies change, while tool upgrades are isolated to feature version bumps.

### Decision: Port Allocation Over Hardcoded Ports

**Decision:** Replace `"appPort": ["2222:2222"]` with lace's symmetric port allocation rather than simply choosing a different hardcoded port.

**Why:** The fundamental problem is not that port 2222 is a bad choice, but that any hardcoded port prevents running devcontainers from multiple projects simultaneously (e.g., weftwise and lace each with their own container). Within a single project, the bare-worktree layout mounts the parent directory (containing `.bare/` and all worktrees) into ONE container, so all worktrees share a single port allocation. But across projects, each project gets its own container and needs its own ports. Lace's port allocator assigns from the 22425-22499 range, persists assignments in `.lace/port-assignments.json`, and detects conflicts. This supports the multi-project workflow without manual port management.

### Decision: SSH Key Path Migration

**Decision:** Migrate from `~/.ssh/weft_devcontainer.pub` to lace's recommended path `~/.config/lace/ssh/id_ed25519.pub` for the container SSH authorized key.

**Why:** The wezterm-server feature's mount declaration specifies `recommendedSource: "~/.config/lace/ssh/id_ed25519.pub"` as the default SSH public key path. Aligning with this convention means weftwise benefits from the feature's built-in validation (`sourceMustBe: "file"`) and remediation hints. Users who prefer the existing path can override it in `~/.config/lace/settings.json`. This is a one-time migration: generate the new key or copy the existing one.

### Decision: Workspace Layout Auto-Detection Over Explicit Configuration

**Decision:** Use `"layout": "bare-worktree"` in `customizations.lace.workspace` rather than keeping the manual `workspaceMount`/`workspaceFolder` declarations.

**Why:** The manual declarations duplicate information that lace can derive from the filesystem. The workspace detector (`workspace-detector.ts`) reads the `.git` file, follows the `gitdir:` pointer, identifies the bare repo root, and derives the worktree name. The layout applier (`workspace-layout.ts`) then generates the correct `workspaceMount`, `workspaceFolder`, and `postCreateCommand`. This eliminates the fragile coupling between the devcontainer.json and the repository's physical layout. It also warns about absolute gitdir paths that would break inside the container -- a failure mode the manual configuration silently ignores.

### Decision: Prebuild Features Require New Feature Packages

**Decision:** Claude Code and Neovim prebuilds require creating new devcontainer features. These features are being created now (see Prerequisites table). They are prerequisites for Phases 2 and 6.

**Why:** Lace's prebuild system (`prebuild.ts`) works by promoting `prebuildFeatures` into a temporary devcontainer context, running `devcontainer build`, and caching the result as a `lace.local/` Docker image. This requires each prebuilt tool to be packaged as a devcontainer feature with an `install.sh` script. Claude Code and Neovim installations are currently inline in the weftwise Dockerfile and need to be extracted into feature packages. The wezterm-server feature already exists and has scenario tests; claude-code and neovim features are being created as new packages in the lace repository.

### Decision: Incremental Migration, Not Big Bang

**Decision:** The seven phases are designed to be independently adoptable where dependencies allow, though the recommended sequence minimizes risk.

**Why:** Weftwise is an active development environment. A big-bang migration risks extended downtime if any phase introduces a regression. Each phase is self-contained where possible: adopting workspace layout detection does not require also adopting port allocation. The phases compose -- each one removes a manual configuration and replaces it with a lace declaration. Key dependencies: Phase 3 (port allocation) depends on Phase 2 (wezterm-server feature provides the `hostSshPort` metadata), Phase 6 (prebuilds) depends on claude-code and neovim feature packages being created and published, and Phase 7 (lace up as entry point) depends on all prior phases. Note that after Phase 4 (mount declarations), `devcontainer up` without lace will produce a container without mounts or port mappings -- lace becomes effectively required at that point.

### Decision: Nushell as Primary Shell

**Decision:** Nushell is the primary shell in the container. Bash history persistence is removed; nushell configuration is mounted instead.

**Why:** The development workflow has migrated to nushell. Persisting bash history is no longer needed. The `nushell-config` mount declaration provides nushell configuration and history persistence across container rebuilds. A nushell installation feature or Dockerfile addition may be needed in the future, but is out of scope for this migration proposal.

## Edge Cases / Challenging Scenarios

### Multiple Projects With Different Containers Running

After migration, multiple projects (e.g., weftwise and lace) can run devcontainers simultaneously because lace allocates different ports from the 22425-22499 range for each project's container. Within a single project like weftwise, all worktrees (`main`, `feature-x`, etc.) share ONE container -- the bare-worktree parent directory is mounted, giving access to all worktrees as sibling directories inside the same container. Port allocation matters for the multi-project case, not for multi-worktree within one project.

However, the host WezTerm SSH domain configuration must be updated to use dynamic port discovery rather than a hardcoded port. If the host config is not updated, connections will target the wrong port.

**Handling:** Phase 2 explicitly includes updating the host WezTerm SSH domain config. The `wez-into` CLI discovers ports dynamically via `lace-discover`, which queries Docker container labels and port mappings at runtime (`docker ps` filtering for the `devcontainer.local_folder` label and ports in the 22425-22499 range). `wez-into` does **not** read `.lace/port-assignments.json` directly -- port discovery is entirely Docker-label-based, which means it works even if the `.lace/` directory is not accessible from the host shell's CWD. For manual SSH domain configs without `wez-into`, the `lace status` command displays the allocated port.

### Existing SSH Key at Old Path

Users who have `~/.ssh/weft_devcontainer` will need to either generate a new key at `~/.config/lace/ssh/id_ed25519` or add a settings override pointing to the existing key.

**Handling:** Document both options. The host validation (`fileExists` check) will fail with a remediation hint on the first `lace up` run, clearly directing the user to either generate a new key or configure the override.

### Docker Creates Root-Owned Directories for Missing Mount Sources

If a mount source path does not exist, Docker silently creates it as a root-owned directory. This is the current failure mode for weftwise when mount paths are misconfigured. Lace's `sourceMustBe` validation catches this before container creation.

**Handling:** Mount declarations with `sourceMustBe: "directory"` or `sourceMustBe: "file"` trigger pre-flight validation in `runUp()`. Missing sources produce a hard error with the mount's `hint` or `description`. Users can bypass with `--skip-validation` (downgrades errors to warnings) for emergency situations.

### Build Context Path Changes

The weftwise Dockerfile uses `"context": ".."` to reference the parent directory (bare repo root). When lace generates `.lace/devcontainer.json`, the `build.context` path must be rewritten relative to the `.lace/` directory. The `generateExtendedConfig()` function in `up.ts` already handles this rewriting.

**Handling:** No special action needed. The existing path rewriting in `up.ts` (lines 657-686) handles both `build.dockerfile` and `build.context` relative path adjustment.

### Prebuild Image Freshness After Dockerfile Changes

If the Dockerfile changes (e.g., upgrading the base image from `node:24` to `node:26`), the prebuild cache must be invalidated. Lace's `contextsChanged()` function compares the Dockerfile and temp devcontainer.json against the cached versions.

**Handling:** Lace automatically detects when the base image or prebuild features change and triggers a rebuild. Users can also force a rebuild with `lace prebuild --force`.

### Feature Install Order

The wezterm-server feature declares `installsAfter: ["ghcr.io/devcontainers/features/sshd"]`, ensuring the sshd feature creates the SSH server before wezterm-server sets up the mux daemon. If sshd is not present, the wezterm-server feature still installs successfully (it only needs the SSH client, not server), but the WezTerm SSH domain will not function.

**Handling:** The weftwise config retains `ghcr.io/devcontainers/features/sshd:1` in the `features` section. The `installsAfter` declaration in the wezterm-server feature ensures correct ordering.

## Prerequisites

| Prerequisite | Status | Blocks | Notes |
|---|---|---|---|
| lace CLI installation method | **needed** | Phase 1+ | Currently: `npm link` from lace repo checkout, or run via `packages/lace/bin/lace` directly. No global npm publish yet. `wez-into` locates it via known paths or PATH. |
| GHCR publication pipeline for wezterm-server | **needed** | Phase 2 | Feature exists in lace repo with scenario tests. Needs OCI publication to `ghcr.io/weftwiseink/lace/wezterm-server`. Can use local path reference during development. |
| claude-code devcontainer feature | **being created** | Phase 2, Phase 6 | New feature package. Must extract Claude Code npm install into `install.sh` with version parameterization. |
| neovim devcontainer feature | **being created** | Phase 2, Phase 6 | New feature package. Must extract Neovim binary install into `install.sh` with version and architecture parameterization. |

> All four prerequisites must be resolved before Phase 7 (full `lace up` integration). Phases 1 (workspace layout), 3 (port allocation), 4 (mount declarations), and 5 (host validation) can proceed with only the lace CLI prerequisite.

## Implementation Phases

### Phase 1: Adopt Workspace Layout Detection

**Goal:** Replace manual `workspaceMount`, `workspaceFolder`, and `postCreateCommand` with lace's automatic bare-worktree detection.

**Files to modify in weftwise:**
- `.devcontainer/devcontainer.json`: remove `workspaceMount`, `workspaceFolder`, `postCreateCommand`; add `customizations.lace.workspace`

**Changes:**
- Remove three manual declarations:
  ```jsonc
  // REMOVE:
  "workspaceMount": "source=${localWorkspaceFolder}/..,target=/workspace,type=bind,consistency=delegated",
  "workspaceFolder": "/workspace/main",
  "postCreateCommand": "git config --global --add safe.directory '*'",
  ```
- Add lace workspace configuration:
  ```jsonc
  "customizations": {
    "lace": {
      "workspace": {
        "layout": "bare-worktree",
        "mountTarget": "/workspace"
      }
    }
  }
  ```

**Verification:**
- Run `lace up --skip-devcontainer-up` and inspect `.lace/devcontainer.json` for correct `workspaceMount`, `workspaceFolder`, and `postCreateCommand`
- Verify `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` are injected into `containerEnv`
- Confirm `git.repositoryScanMaxDepth: 2` is merged into VS Code settings (currently set manually; lace injects it by default)

**Constraints:**
- This phase requires `lace up` to be available on the host (install lace CLI first)
- Does not modify the Dockerfile
- VS Code settings that are already present in weftwise's config take precedence over lace-injected defaults

### Phase 2: Adopt wezterm-server Feature

**Goal:** Replace the manual WezTerm install in the Dockerfile and the `postStartCommand` with the lace `wezterm-server` devcontainer feature.

**Files to modify in weftwise:**
- `.devcontainer/Dockerfile`: remove WezTerm install (lines 108-128), runtime dir creation (line 128), SSH dir setup (lines 131-133)
- `.devcontainer/devcontainer.json`: remove `postStartCommand`; add wezterm-server to `features`

**Dockerfile removals (~25 lines):**
```dockerfile
# REMOVE: WezTerm install (lines 108-125)
ARG WEZTERM_VERSION="20240203-110809-5046fc22"
RUN ARCH=$(dpkg --print-architecture) && ...

# REMOVE: Runtime dir (line 128)
RUN mkdir -p /run/user/1000 && chown ${USERNAME}:${USERNAME} /run/user/1000

# REMOVE: SSH dir (lines 131-133)
RUN mkdir -p /home/${USERNAME}/.ssh && ...
```

**devcontainer.json changes:**
```jsonc
// REMOVE:
"postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true",

// ADD to features (required for entrypoint/mux server auto-start):
"ghcr.io/weftwiseink/lace/wezterm-server:1": {},
"ghcr.io/weftwiseink/lace/claude-code:1": { "version": "2.1.11" },
"ghcr.io/weftwiseink/lace/neovim:1": { "version": "0.11.6" }
// Or local references during development:
// "./path/to/lace/devcontainers/features/src/wezterm-server": {}
```

The wezterm-server feature **must** be in the `features` section (not just `prebuildFeatures`) because the entrypoint that auto-starts the mux server is only activated when the feature is installed at container creation time. In Phase 6, it optionally _also_ goes into `prebuildFeatures` for faster rebuilds, but it must remain in `features` regardless.

**Verification:**
- Rebuild container and verify `wezterm-mux-server --version` returns the expected version
- Verify `wezterm cli list` returns a pane table
- Verify `/usr/local/share/wezterm-server/wezterm.lua` exists with workspace-aware config
- Verify the mux server starts automatically (feature entrypoint) without `postStartCommand`

**Constraints:**
- The wezterm-server, claude-code, and neovim features must be accessible (published to GHCR or referenced by local path). See Prerequisites table.
- The feature's default version (20240203) matches weftwise's current version
- The sudoers setup in the Dockerfile remains (needed by sshd feature, not just wezterm)

### Phase 3: Adopt Port Allocation

**Goal:** Replace hardcoded `appPort: ["2222:2222"]` with lace's dynamic port allocation in the 22425-22499 range.

**Files to modify in weftwise:**
- `.devcontainer/devcontainer.json`: remove `appPort`

**Files to modify on host:**
- WezTerm SSH domain config: update to use `wez-into` CLI (which discovers ports dynamically via Docker labels) or manually query `lace status` for the allocated port

**Changes:**
```jsonc
// REMOVE from devcontainer.json:
"appPort": ["2222:2222"],
```

The wezterm-server feature declares `hostSshPort` in its `customizations.lace.ports` metadata. During `lace up`, the template resolver auto-injects `${lace.port(wezterm-server/hostSshPort)}` and the port allocator assigns a port from 22425-22499. The generated `.lace/devcontainer.json` includes the correct `appPort`, `forwardPorts`, and `portsAttributes`.

**Verification:**
- Run `lace up --skip-devcontainer-up` and inspect `.lace/devcontainer.json` for `appPort` with a port in 22425-22499
- Verify `.lace/port-assignments.json` contains the allocation
- Start containers from two different projects simultaneously and confirm both allocate different ports
- Verify WezTerm SSH connection succeeds on the allocated port

**Constraints:**
- Host WezTerm config MUST be updated before this phase takes effect
- Existing port 2222 sessions will stop working after migration
- The sshd feature still defaults to listening on port 2222 inside the container; the lace port mapping is host-side only

### Phase 4: Adopt Mount Declarations

**Goal:** Replace the three hardcoded mount strings with lace mount declarations that support team overrides and pre-flight validation. The mount strategy is now per-tool, feature-injected: features declare their own mounts, and the project only explicitly declares mounts not owned by a feature.

**Files to modify in weftwise:**
- `.devcontainer/devcontainer.json`: remove `mounts` array; add mount declarations to `customizations.lace`

**Changes:**
```jsonc
// REMOVE entire mounts array:
"mounts": [
  "source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind",
  "source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind",
  "source=${localEnv:HOME}/.ssh/weft_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
],

// ADD to customizations.lace:
"mounts": {
  // Project-level mount (not owned by any feature):
  "nushell-config": {
    "target": "/home/node/.config/nushell",
    "recommendedSource": "~/.config/nushell",
    "description": "Nushell configuration and history (primary shell)",
    "sourceMustBe": "directory"
  }
}
```

Feature-injected mounts (auto-declared by their respective features, no project-level declaration needed):
- `claude-code/config` -> `/home/node/.claude` (from claude-code feature)
- `neovim/plugins` -> `/home/node/.local/share/nvim` (from neovim feature)
- `wezterm-server/authorized-keys` -> `/home/node/.ssh/authorized_keys` (from wezterm-server feature)

The bash-history mount is **removed** -- nushell is now the primary shell (see Design Decisions).

**Mount resolution defaults:** `recommendedSource` is **user-facing guidance** shown in `lace status` output and docs. It is NOT a runtime fallback. Without settings overrides, lace resolves mount sources to managed directories under `~/.config/lace/<projectId>/mounts/<namespace>/<label>`. This is by design -- it means new team members get a working (empty) container without host path dependencies. Existing team members who want to persist data across rebuilds should set source overrides in `~/.config/lace/settings.json`.

**User setup (one-time, for data persistence):**
- Create `~/.config/lace/settings.json` with mount source overrides:
  ```jsonc
  {
    "mounts": {
      "nushell-config": {
        "source": "~/.config/nushell"
      },
      "claude-code/config": {
        "source": "~/code/dev_records/weft/claude"
      },
      "wezterm-server/authorized-keys": {
        "source": "~/.ssh/weft_devcontainer.pub"
      }
    }
  }
  ```

**Verification:**
- Run `lace up --skip-devcontainer-up` and inspect `.lace/devcontainer.json` for concrete mount strings
- Verify mount sources resolve to the settings override paths when overrides are present
- Without settings overrides, verify lace resolves to managed directories under `~/.config/lace/<projectId>/mounts/` (empty but functional)
- Test `sourceMustBe` validation: point a mount source at a non-existent path and verify lace fails with a descriptive error

**Constraints:**
- Without settings overrides, mounts resolve to lace-managed empty directories. This is functional but means no data persistence across rebuilds. Team members who want persistence should configure `~/.config/lace/settings.json` with source overrides.
- The `CLAUDE_CONFIG_DIR` container env var must remain in `containerEnv` regardless of mount source
- After this phase, `devcontainer up` without lace will produce a container **without** mounts or port mappings. Lace becomes effectively required (see Phase 7 fallback note).

### Phase 5: Adopt Host Validation

**Goal:** Add pre-flight validation for the SSH key and mount source directories.

**Files to modify in weftwise:**
- `.devcontainer/devcontainer.json`: add `validate` section to `customizations.lace`

**Changes:**
```jsonc
// ADD to customizations.lace:
"validate": {
  "fileExists": [
    {
      "path": "~/.config/lace/ssh/id_ed25519.pub",
      "severity": "error",
      "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh"
    }
  ]
}
```

> NOTE: The `sourceMustBe` validation on mount declarations (Phase 4) provides a second layer of validation for mount source paths. The `validate.fileExists` checks run in Phase 0b of the `lace up` pipeline, before mount resolution. The `sourceMustBe` checks run during template resolution (Phase 3+ of the pipeline). Together they cover both the SSH key and the mount directories.

**Verification:**
- Remove the SSH public key and verify `lace up` fails with the hint message
- Verify `--skip-validation` downgrades the error to a warning
- Verify all `sourceMustBe` checks pass with correct settings

**Constraints:**
- This phase is purely additive -- it does not change any existing behavior, only adds failure detection
- The SSH key path in the validation must match the wezterm-server feature's `recommendedSource`

### Phase 6: Adopt Prebuilds

**Goal:** Add prebuild caching for the features already installed in Phase 2, so container rebuilds are faster. This phase does NOT move tools from Dockerfile to features -- that happened in Phase 2. This phase adds `prebuildFeatures` declarations so lace can bake feature installations into a cached `lace.local/` Docker image.

**Prerequisites:**
- Phase 2 must be complete (features are in `features` section)
- All three features must be published to GHCR (see Prerequisites table)

**Files to modify in weftwise:**
- `.devcontainer/Dockerfile`: remove any remaining inline tool installs (Claude Code, Neovim) if not already removed in Phase 2
- `.devcontainer/devcontainer.json`: add `prebuildFeatures` to `customizations.lace`

**devcontainer.json changes:**
```jsonc
// ADD to customizations.lace:
"prebuildFeatures": {
  "ghcr.io/weftwiseink/lace/wezterm-server:1": {},
  "ghcr.io/weftwiseink/lace/claude-code:1": { "version": "2.1.11" },
  "ghcr.io/weftwiseink/lace/neovim:1": { "version": "0.11.6" }
}
```

> NOTE: The wezterm-server, claude-code, and neovim features remain in the `features` section (required for entrypoints and runtime behavior). Adding them to `prebuildFeatures` is _in addition to_ `features`, not a replacement. Prebuilding bakes the feature installations into a cached image layer, saving ~30-60 seconds per rebuild. The feature must still be in `features` for its entrypoint (e.g., mux server auto-start) to activate.

**Verification:**
- Run `lace prebuild --dry-run` and verify planned actions list all three features
- Run `lace prebuild` and verify `lace.local/...` image is created
- Rebuild container and verify `nvim --version`, `claude --version`, and `wezterm-mux-server --version` all report expected versions
- Modify the Neovim version and verify `lace prebuild` detects the change and rebuilds

**Constraints:**
- This phase depends on all three features being published to GHCR
- Features must be compatible with the `node:24-bookworm` base image
- The Dockerfile `ARG` declarations for removed tools (`CLAUDE_CODE_VERSION`, `NEOVIM_VERSION`, `WEZTERM_VERSION`) should also be removed if not already cleaned up in Phase 2

### Phase 7: Use lace up as Entry Point

**Goal:** Replace `devcontainer up` with `lace up` as the standard way to start the weftwise devcontainer.

**Files to modify in weftwise:**
- `.gitignore`: add `.lace/` directory
- Documentation: update any references to `devcontainer up`

**Changes:**
```gitignore
# Add to .gitignore:
.lace/
```

**User workflow change:**
```bash
# Before:
devcontainer up --workspace-folder ~/code/weft/weftwise/main

# After:
cd ~/code/weft/weftwise/main
lace up
```

**Verification:**
- Full end-to-end: `lace up` from a clean state (no `.lace/` directory) creates the container with all phases completing
- Verify `.lace/devcontainer.json` contains all generated configuration
- Verify `.lace/port-assignments.json` contains port allocation
- Verify container starts and all tools are available
- Verify WezTerm SSH connection works on the allocated port

**Constraints:**
- All team members must have the lace CLI installed (see Prerequisites table)
- After Phase 4, `devcontainer up` without lace produces a container **without** mounts, port mappings, or workspace layout. The static `.devcontainer/devcontainer.json` contains lace declarations that `devcontainer up` ignores. Lace is effectively required after Phase 4 -- this phase formalizes that dependency.
- CI/CD pipelines that use `devcontainer up` should be updated to use `lace up`

## Open Questions

1. **Feature publication pipeline**: The wezterm-server feature exists in the lace repo but may not yet be published to GHCR. Should weftwise reference it by local path (requires lace repo checkout on the host), git submodule, or published OCI reference? Published OCI is the cleanest but requires establishing a publication pipeline.

2. **Git Delta as a feature**: Git Delta is installed in the Dockerfile and is a generic dev tool. Should it be extracted into a devcontainer feature and moved to prebuilds? It is a small installation (~5 lines, one .deb download) so the ROI of featurizing it is low, but it would complete the separation between project-specific and generic tooling.

3. **Settings.json bootstrapping**: The first `lace up` after migration will fail host validation if the user has not created `~/.config/lace/settings.json` with mount overrides. Should lace provide a `lace init` command that generates a starter settings.json from the project's mount declarations and recommended sources? This would reduce onboarding friction.

4. **CLAUDE_CONFIG_DIR env var**: The weftwise config sets `CLAUDE_CONFIG_DIR: "/home/node/.claude"` in `containerEnv`. This path must match the `claude-code/config` feature-injected mount's target. Once the claude-code feature declares its own mount target, the env var should reference `${lace.mount.target(claude-code/config)}` instead of a hardcoded path. This is a mount target template concern (per the mount accessor API proposal) and is deferred.

5. **sshd port inside the container**: The `ghcr.io/devcontainers/features/sshd:1` feature listens on port 2222 inside the container. Lace's port allocation maps a host port (22425-22499) to container port 2222. If multiple containers run on the same Docker network, they could theoretically conflict on the internal port. In practice, each container has its own network namespace, so this is not a real issue. But the wezterm-server feature's TODO note about decoupling SSH port handling into a thin sshd wrapper feature is relevant for a future cleanup.
