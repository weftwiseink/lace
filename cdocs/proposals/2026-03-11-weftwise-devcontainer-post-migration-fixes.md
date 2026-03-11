---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T18:00:00-06:00
task_list: lace/weftwise-migration
type: proposal
state: live
status: implementation_review
tags: [weftwise, devcontainer, mounts, features, git-extensions, post-migration, cleanup]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-11T21:00:00-06:00
  round: 2
related_to:
  - cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
  - cdocs/reports/2026-03-07-weftwise-lace-migration-failure-analysis.md
  - cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md
  - cdocs/proposals/2026-03-11-rebuild-prebuild-before-validation.md
  - cdocs/proposals/2026-03-11-feature-dockerfile-install-consistency.md
  - cdocs/devlogs/2026-01-31-devcontainer-feature-based-tooling.md
---

# Weftwise Devcontainer Post-Migration Fixes

> BLUF: The 7-phase weftwise-to-lace migration (March 3-5) correctly adopted
> lace idioms, but several lace improvements landed after the migration that
> weftwise has not yet picked up. The weftwise devcontainer.json still contains
> manual mount override strings (a workaround for unresolved `${_REMOTE_USER}`
> that lace now handles via `mount-resolver.ts`), hardcodes `CLAUDE_CONFIG_DIR`
> instead of using the `${lace.mount()}` template, pins the git prebuild
> feature to Debian's 2.39.x instead of `"latest"`, and is missing a nushell
> prebuild feature despite nushell being the primary shell. Additionally, lace's
> own Dockerfile still contains weftwise-specific Electron/Playwright content
> from the extraction phase. This proposal bundles these follow-up fixes into
> three phases.
>
> - **Original migration:** `cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md`
> - **`_REMOTE_USER` resolution:** `cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md`

> NOTE: The original draft of this proposal (round 1) included a `.dockerignore`
> fix, manual `CONTAINER_WORKSPACE_FOLDER` injection, and switching from
> `@weftwiseink` features to `@anthropics`/community features. Review
> established that weftwise already has a `.dockerignore`, that lace auto-injects
> `CONTAINER_WORKSPACE_FOLDER` via `generateExtendedConfig()` in `up.ts:773-786`,
> and that the `@weftwiseink` features exist specifically to carry lace mount
> metadata (`customizations.lace.mounts`) that official/community features lack.
> The proposal was rewritten to focus on the actual gaps.

## Objective

Bring weftwise's devcontainer.json in line with lace's current idioms. The
original migration adopted the lace config schema correctly, but lace has since
evolved: `_REMOTE_USER` resolution in mount targets eliminates the need for
manual mount overrides, the git feature should track latest for extension
support, and nushell should be installed via a feature. These are incremental
alignment changes — no architectural rethinking needed.

## Background

### Mount Override Workaround (Now Resolved)

The weftwise devcontainer.json contains two manual mount strings that override
feature-declared mount targets:

```jsonc
"mounts": [
  "source=${lace.mount(claude-code/config).source},target=/home/node/.claude,type=bind",
  "source=${lace.mount(neovim/plugins).source},target=/home/node/.local/share/nvim,type=bind"
]
```

These exist because the `@weftwiseink` claude-code and neovim features declare
mount targets using `${_REMOTE_USER}` (e.g., `/home/${_REMOTE_USER}/.claude`),
and lace's mount resolver previously passed this variable through verbatim.
Docker would create a literal `${_REMOTE_USER}` directory. The workaround
hardcodes `/home/node/` in the mount target.

The `_REMOTE_USER` resolution proposal (`2026-03-07`) implemented container
variable resolution in `mount-resolver.ts` (commit `b69475f`). The resolver
now substitutes `${_REMOTE_USER}` with the value from `remoteUser`,
Dockerfile `USER`, or a configurable default. The manual overrides are no
longer needed — lace auto-injects the resolved mounts from feature metadata.

> NOTE: Lace's own devcontainer.json uses a different approach: it references
> `@anthropics/claude-code` and `@devcontainers-extra/neovim-homebrew` (which
> lack mount metadata) and instead declares project-level mounts in
> `customizations.lace.mounts`. Weftwise uses `@weftwiseink` features that
> carry mount metadata in their `devcontainer-feature.json`. Both approaches
> are valid. See `cdocs/devlogs/2026-01-31-devcontainer-feature-based-tooling.md`
> for the rationale behind the custom features.

### Why Weftwise Uses `@weftwiseink` Features

The `@weftwiseink` devcontainer features (claude-code, neovim, wezterm-server)
are custom wrappers that add lace-specific metadata to the devcontainer feature
spec. They declare `customizations.lace.mounts` and `customizations.lace.ports`
in their `devcontainer-feature.json`, enabling:

- **Automatic mount resolution** — lace extracts mount declarations from
  feature metadata and auto-injects resolved mount specs
- **`sourceMustBe` validation** — pre-flight checks catch missing SSH keys
  and directories before Docker creates root-owned paths
- **Team-portable `settings.json` overrides** — team members can customize
  host source paths without modifying `devcontainer.json`
- **Dynamic port allocation** — wezterm-server declares `lace.ports.hostSshPort`
  for port range 22425-22499

The official `@anthropics/claude-code` and community
`@devcontainers-extra/neovim-homebrew` features are pure CLI installers with
no lace metadata. Lace's own devcontainer works around this with project-level
mount declarations, but weftwise's approach (feature-level metadata) is more
portable — the feature carries its own requirements.

Source code for these features lives in:
`/var/home/mjr/code/weft/lace/main/devcontainers/features/src/{claude-code,neovim,wezterm-server}/`

### `CLAUDE_CONFIG_DIR` in containerEnv

Both lace and weftwise explicitly set `CLAUDE_CONFIG_DIR` in `containerEnv`.
Lace uses a mount template accessor:

```jsonc
"CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"
```

Weftwise hardcodes the path:

```jsonc
"CLAUDE_CONFIG_DIR": "/home/node/.claude"
```

This env var is not auto-injected by the claude-code feature or by lace — it
is manually set in the devcontainer.json. It is also arguably redundant: Claude
Code defaults to `~/.claude`, which resolves to `/home/node/.claude` for user
`node`, exactly where the mount places the config. Both lace and weftwise set
it for explicitness (it was included as a required piece in the
`lace-claude-access-detailed-implementation` design).

The template form stays correct if the mount target changes and aligns with
how lace's own devcontainer.json references mount targets. While the hardcoded
value is functionally equivalent today, using the template maintains
consistency between the two devcontainer configs — the preferred approach.

### Git Extension Support

The weftwise bare-repo uses git extensions (`relativeWorktrees`,
`worktreeConfig`). Lace detects unsupported extensions and emits fatal errors
(commit `1b0a874`). Weftwise's git feature uses the default version (Debian
Bookworm's 2.39.x), which does not support `relativeWorktrees` (requires
2.48+). Setting `"version": "latest"` builds git from source.

> NOTE: The `rebuild-prebuild-before-validation` proposal (same date) addresses
> the chicken-and-egg problem where `lace up --rebuild` fails because workspace
> validation blocks before the prebuild can upgrade git. Until that proposal is
> implemented, `--skip-validation` is needed after upgrading the git feature.

### Missing Nushell Feature

Weftwise declares nushell as its primary shell and mounts nushell config from
the host (`customizations.lace.mounts.nushell-config`), but does not install
nushell inside the container via a feature. Lace uses
`ghcr.io/eitsupi/devcontainer-features/nushell:0` as a prebuild feature.
Without the feature, nushell is not available in the container unless installed
by some other mechanism.

### Lace Dockerfile Cleanup

During the "extracting lace" phase (commit `4aada8a`), lace's
`.devcontainer/Dockerfile` was copied from weftwise. It still contains
weftwise-specific content: Electron and Playwright installs,
`pnpm build:electron`, and related apt dependencies. The lace project is a
TypeScript CLI tool, not an Electron app. The base image is
`lace.local/node:24-bookworm` (the prebuild image), not the raw
`node:24-bookworm`.

## Proposed Solution

Four fixes across three phases, all independently implementable.

### Fix 1: Remove Manual Mount Overrides

Remove the two hardcoded mount strings from weftwise's `mounts` array. With
`_REMOTE_USER` resolution in the mount resolver, feature-declared mounts from
the `@weftwiseink` features are auto-injected with correct paths. The `mounts`
array should be empty (or contain only comments), matching lace's pattern.

**Before:**
```jsonc
"mounts": [
  "source=${lace.mount(claude-code/config).source},target=/home/node/.claude,type=bind",
  "source=${lace.mount(neovim/plugins).source},target=/home/node/.local/share/nvim,type=bind"
]
```

**After:**
```jsonc
"mounts": [
  // Feature-injected mounts (auto-resolved by lace from @weftwiseink feature metadata):
  //   claude-code/config -> /home/node/.claude
  //   neovim/plugins -> /home/node/.local/share/nvim
  //   wezterm-server/authorized-keys -> /home/node/.ssh/authorized_keys
]
```

### Fix 2: Upgrade Git Feature and Add Nushell

Update weftwise's `prebuildFeatures`:

```jsonc
"prebuildFeatures": {
  "ghcr.io/devcontainers/features/git:1": { "version": "latest" },
  "ghcr.io/devcontainers/features/sshd:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/neovim:1": {},
  "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
}
```

Changes from the current config:
- `git`: add `"version": "latest"` for extension support
- `claude-code`: drop version pin (`2.1.11`); prebuild cache provides stability
- `neovim`: drop version pin (`v0.11.6`); prebuild cache provides stability
- `nushell`: add `ghcr.io/eitsupi/devcontainer-features/nushell:0` (primary shell)

### Fix 3: Use Mount Template for `CLAUDE_CONFIG_DIR`

Replace the hardcoded path with lace's mount template accessor:

**Before:**
```jsonc
"CLAUDE_CONFIG_DIR": "/home/node/.claude"
```

**After:**
```jsonc
"CLAUDE_CONFIG_DIR": "${lace.mount(claude-code/config).target}"
```

The `claude-code/config` namespace comes from the `@weftwiseink` claude-code
feature's mount metadata declaration. This template resolves to
`/home/node/.claude` after `_REMOTE_USER` substitution, so behavior is
unchanged. This aligns weftwise's `containerEnv` with lace's pattern of
referencing mount targets via templates rather than hardcoded paths,
maintaining consistency between the two devcontainer configs.

### Fix 4: Simplify Lace's Own Dockerfile

Remove weftwise-specific content from lace's `.devcontainer/Dockerfile`:

**Remove:**
- `ARG ELECTRON_VERSION`, `ARG PLAYWRIGHT_VERSION`
- All Playwright/Chromium/Electron apt dependencies
- `xvfb`, `xauth`, GTK deps
- Electron pre-install (`pnpm install "electron@..."`)
- Playwright pre-install and `npx playwright install chromium`
- `pnpm build:electron` step
- Sculptor TODO comments

**Keep:**
- `FROM lace.local/node:24-bookworm` (prebuild base image)
- System tools (`curl`, `psmisc`, `sudo`)
- Corepack/pnpm setup
- Git-delta install
- Workspace and config directories
- Bash history persistence (used by `bash-history` mount declaration)
- SSH `authorized_keys` directory setup (wezterm-server feature comment
  confirms this is still needed for bind-mounted authorized_keys)
- Passwordless sudo
- npm global directory
- `COPY` and `pnpm install --frozen-lockfile` steps

**Also:** Create `/var/home/mjr/code/weft/lace/main/.dockerignore` to prevent
the same latent `COPY . .` bug class that affected weftwise. Lace currently
avoids it because `node_modules` lives under `packages/lace/`, but this is
fragile.

## Important Design Decisions

### Decision: Keep `@weftwiseink` Features, Not Switch to Official/Community

**Decision:** Retain `@weftwiseink/devcontainer-features/claude-code` and
`@weftwiseink/devcontainer-features/neovim` rather than switching to
`@anthropics` and `@devcontainers-extra`.

**Why:** The `@weftwiseink` features exist specifically to carry lace mount
metadata in their `devcontainer-feature.json`. The official Anthropic
claude-code feature and community neovim-homebrew feature are pure CLI
installers with no `customizations.lace.mounts` declarations. Without this
metadata, lace cannot auto-inject mounts, validate sources, or support
team-portable `settings.json` overrides. Lace's own devcontainer works around
this with project-level mount declarations, but weftwise's feature-level
approach is more portable and was the design intent of the custom features.

### Decision: Drop Feature Version Pins

**Decision:** Remove the version pins on claude-code (`2.1.11`) and neovim
(`v0.11.6`).

**Why:** The prebuild cache provides version stability — the same feature
version is used across container recreations unless `--rebuild` is invoked.
Pinning creates maintenance burden (manual bumps) and can block security
updates. The `@weftwiseink` features wrap the actual install, so the installed
tool version is whatever the feature's install script resolves, not the
feature OCI tag version.

### Decision: `"version": "latest"` for Git Rather Than a Pinned Version

**Decision:** Use `"version": "latest"` for the git feature.

**Why:** The git feature's `"latest"` resolves to the latest stable release at
build time. The weftwise bare-repo uses `relativeWorktrees` (requires 2.48+),
and future extensions may require even newer versions. This matches lace's own
configuration.

### Decision: Add Nushell Feature Rather Than Relying on Host-Mounted Config

**Decision:** Add `ghcr.io/eitsupi/devcontainer-features/nushell:0` as a
prebuild feature.

**Why:** Weftwise declares nushell as its primary shell and mounts config from
the host, but does not install nushell in the container. The nushell feature
ensures the shell is available in the prebuild image, following lace's
convention: features handle tool installation, Dockerfile handles application
dependencies.

## Edge Cases / Challenging Scenarios

### E1: Git Feature Rebuild Requires `--rebuild` and `--skip-validation`

After changing the git feature version, `lace up --rebuild --skip-validation`
is needed. The `--rebuild` forces a prebuild rebuild; `--skip-validation`
bypasses the extension check that would fail against the old image. Once the
`rebuild-prebuild-before-validation` proposal is implemented, only `--rebuild`
will be needed.

### E2: Nushell Feature May Conflict With Host-Mounted Config

Adding the nushell feature installs nushell inside the container. The existing
`nushell-config` mount binds the host's `~/.config/nushell` into the container.
If the feature creates default config files that conflict with the mounted
config, there could be issues at container startup.

**Handling:** The bind mount overlays the feature's default config, so the
host config takes precedence. This is the intended behavior — the feature
provides the binary, the mount provides the configuration.

### E3: Lace Dockerfile Cleanup May Affect Running Containers

Simplifying the Dockerfile does not affect running containers. The next
`lace up --rebuild` produces a new image. This is expected — lace developers
do not need Electron or Playwright.

### E4: Mount Template Resolution Depends on Feature Metadata Fetch

The `${lace.mount(claude-code/config).target}` template requires lace to
successfully fetch the `@weftwiseink` claude-code feature's metadata from
GHCR. If metadata fetch fails (network error, registry outage), the template
cannot resolve and `lace up` fails.

**Handling:** This is the existing behavior for all lace mount templates. The
`--skip-metadata-fetch` flag (if implemented) or cached metadata would
mitigate. Not a new risk introduced by this proposal.

## Implementation Phases

### Phase 1: Update Git Feature and Add Nushell

**Changes:**
- Edit `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`:
  - Change `"ghcr.io/devcontainers/features/git:1": {}` to
    `"ghcr.io/devcontainers/features/git:1": { "version": "latest" }`.
  - Drop version pins from claude-code and neovim features.
  - Add `"ghcr.io/eitsupi/devcontainer-features/nushell:0": {}` to
    `prebuildFeatures`.

**Verification:**
- `lace up --rebuild --skip-validation` succeeds in weftwise.
- `git --version` inside the container reports 2.48+.
- `claude --version`, `nvim --version`, `nu --version` all work.

**Constraints:**
- Do NOT modify the Dockerfile in this phase.
- Do NOT change feature OCI namespaces — keep `@weftwiseink` features.

### Phase 2: Remove Mount Overrides and Align Templates

**Changes:**
- Edit `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`:
  - Remove the two manual mount strings from the `mounts` array (Fix 1).
  - Replace hardcoded `CLAUDE_CONFIG_DIR` with
    `"${lace.mount(claude-code/config).target}"` (Fix 3).

**Verification:**
- `lace up` (or `lace up --skip-validation`) succeeds.
- `.lace/devcontainer.json` shows auto-injected mount specs with resolved
  `/home/node/` paths (not `${_REMOTE_USER}`).
- `CLAUDE_CONFIG_DIR` in container env resolves to `/home/node/.claude`.
- Claude Code works inside the container (config persists across sessions).

**Constraints:**
- Do NOT modify the Dockerfile in this phase.
- If auto-injected mounts produce incorrect paths, revert and investigate
  `_REMOTE_USER` resolution for the specific feature.

### Phase 3: Simplify Lace's Own Dockerfile

**Changes:**
- Edit `/var/home/mjr/code/weft/lace/main/.devcontainer/Dockerfile`:
  - Remove all weftwise-specific content as specified in Fix 4.
  - Keep the `lace.local/node:24-bookworm` base image, bash history
    infrastructure, SSH directory setup, and all other lace-relevant content.
- Create `/var/home/mjr/code/weft/lace/main/.dockerignore` with entries
  appropriate for the lace project (`node_modules`, `.lace`, `dist`, etc.).

**Verification:**
- `lace up --rebuild` in the lace repo succeeds.
- Container starts and lace CLI tools work (`lace --help`, `lace status`).
- No Electron or Playwright binaries present in the container.
- `pnpm install --frozen-lockfile` succeeds inside the container.

**Constraints:**
- Preserve `FROM lace.local/node:24-bookworm` (prebuild base image).
- Preserve corepack/pnpm setup (lace uses pnpm workspaces).
- Preserve bash history and SSH directory setup.
- Do NOT modify the lace `devcontainer.json` in this phase.
