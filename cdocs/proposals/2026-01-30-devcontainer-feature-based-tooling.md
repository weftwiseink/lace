---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-30T18:00:00-08:00
task_list: lace/devcontainer-features
type: proposal
state: live
status: implementation_ready
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-30T18:30:00-08:00
  round: 2
tags: [devcontainer, features, tooling, composability]
---

# Migrate Lace Devcontainer to Feature-Based Tooling

> BLUF: The lace devcontainer Dockerfile manually installs neovim, wezterm-mux-server, and claude code through ad-hoc shell commands (tarball extraction, .deb unpacking, npm global install).
> These should be replaced with [devcontainer features](https://containers.dev/features) for composability and encapsulated installation logic.
> An official Anthropic feature covers claude code (`ghcr.io/anthropics/devcontainer-features/claude-code:1`), neovim uses a community feature from `devcontainers-extra` (`neovim-apt-get` or `neovim-homebrew`), wezterm-server requires a new feature from our own features repo (proposed in a sibling proposal), and nushell is added via `ghcr.io/eitsupi/devcontainer-features/nushell` as a new shell option.
> The migration proceeds in five phases ordered by risk: claude code (lowest), neovim, wezterm, nushell (additive), and final Dockerfile cleanup.
> Features install as root after the Dockerfile build completes, which differs from the current node-user installs: each phase accounts for this context change.

## Objective

Replace ad-hoc tool installations in the lace Dockerfile with declarative devcontainer features.
This reduces Dockerfile complexity, encapsulates platform-specific installation logic (architecture detection, download URLs, extraction), and aligns with the devcontainer ecosystem's composability model.

## Background

The current `.devcontainer/Dockerfile` (186 lines) handles several concerns:

1. **System dependencies**: Playwright/Chromium libs, Electron headless testing deps (xvfb, GTK), psmisc.
2. **Package management**: corepack/pnpm setup.
3. **User/permissions**: node user, sudo, SSH directory, runtime directory.
4. **Tool installations**: neovim (tarball), wezterm-mux-server (.deb extraction), claude code (npm global), git-delta (.deb).
5. **Project build**: electron pre-install, playwright install, pnpm install, electron build.

Category 4 (tool installations) accounts for roughly 40 lines and involves architecture detection, download URL construction, and manual extraction: exactly the kind of work devcontainer features are designed to encapsulate.

The devcontainer features spec ([containers.dev/implementors/features](https://containers.dev/implementors/features/)) provides a standard mechanism for installing tools into dev containers.
Features are declared in `devcontainer.json` under the `features` key, versioned via OCI tags, and composed automatically during container build.

The current `devcontainer.json` already uses two features:

```json
"features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/sshd:1": {}
}
```

### Available Features

- **claude code**: `ghcr.io/anthropics/devcontainer-features/claude-code:1` (latest: v1.0.5) installs the claude code CLI globally and adds the VS Code extension.
  This is an official Anthropic-maintained feature.
  It requires Node.js (auto-installs if missing, though the `node:24-bookworm` base image already provides it).
- **neovim**: The `devcontainers-extra` registry offers two neovim features: `ghcr.io/devcontainers-extra/features/neovim-apt-get:1` and `ghcr.io/devcontainers-extra/features/neovim-homebrew:1`.
  No appimage-based feature exists in `devcontainers-extra`.
  The apt-get variant installs from system repos (which on Debian bookworm gives v0.7, too old); the homebrew variant can install newer versions.
  `ghcr.io/duduribeiro/devcontainer-features/neovim:1` is another option that supports specifying versions including `nightly`.
- **wezterm-server**: No existing feature.
  A sibling proposal covers scaffolding `ghcr.io/weft/devcontainer-features/wezterm-server:1` in a new features repository.
- **nushell**: `ghcr.io/eitsupi/devcontainer-features/nushell:1` provides nushell installation.
  No nushell feature exists in `devcontainers-extra` (checked: 442 features, nushell not among them).
  Nushell is a structured-data shell useful for build scripting and interactive exploration of JSON/YAML configs.
- **git-delta**: Already installed via .deb in the Dockerfile.
  Could become a feature in the future, but is lower priority and out of scope for this proposal.

### Feature Execution Context

Devcontainer features install as root during a post-build phase, after the Dockerfile build completes.
This differs from the current Dockerfile, which switches to `USER node` at line 141 and installs claude code as the node user.
The implications:

- Features have root access by default, which simplifies installation (no permission issues) but changes file ownership of installed artifacts.
- The claude code feature installs npm packages globally as root.
  The current Dockerfile uses `NPM_CONFIG_PREFIX=/usr/local/share/npm-global` and installs as the node user, giving the node user ownership.
  The feature's install script manages its own npm global directory: the `NPM_CONFIG_PREFIX` and PATH setup in the Dockerfile may need adjustment or removal after the feature handles this.
- Neovim and wezterm features install binaries to system paths as root, which matches the current behavior (those installs run before `USER node`).
- The `remoteUser` setting in devcontainer.json (defaulting to the Dockerfile's USER) controls which user runs inside the container at runtime, regardless of which user installed features.

## Proposed Solution

Replace each tool installation block in the Dockerfile with a corresponding feature entry in `devcontainer.json`.

### Target devcontainer.json features block

```json
"features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {
        "version": "2.1.11"
    },
    "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {
        "version": "0.11.6"
    },
    "ghcr.io/weft/devcontainer-features/wezterm-server:1": {
        "version": "20240203-110809-5046fc22"
    },
    "ghcr.io/eitsupi/devcontainer-features/nushell:1": {}
}
```

> NOTE(opus/devcontainer-features): The neovim feature choice (`neovim-homebrew` vs `duduribeiro/neovim`) should be validated during Phase 2 implementation.
> The `neovim-apt-get` variant is not viable because Debian bookworm repos only provide v0.7, and we need v0.11+.
> The homebrew variant should provide newer versions but requires homebrew to be installed in the container (the feature handles this).
> `ghcr.io/duduribeiro/devcontainer-features/neovim:1` is a fallback if the homebrew overhead is unacceptable.

### Target Dockerfile changes

Remove these blocks from the Dockerfile:

1. **Lines 97-106**: Neovim tarball download, extraction, and symlink.
2. **Lines 108-125**: Wezterm .deb download, extraction, and binary installation.
3. **Lines 159-160**: Claude code npm global install and the `CLAUDE_CODE_VERSION` ARG (lines 8).

Retain these blocks (they are project-specific, not tool installations):

- System dependencies (Playwright, Electron, xvfb).
- corepack/pnpm setup.
- User/permissions/sudo setup.
- git-delta installation (out of scope for this proposal).
- Wezterm runtime directory creation (line 128): should move into the wezterm-server feature's install script, since it is a wezterm-specific requirement.
- SSH directory setup (lines 130-133): stays, used by the sshd feature.
- Electron/Playwright pre-install and project build steps.

## Important Design Decisions

### Decision 1: Phase the migration rather than doing it all at once

**Decision**: Migrate one tool at a time across five phases.

**Why**: Each feature has different maturity levels.
The claude code feature is official and well-tested.
The neovim feature is community-maintained and the best variant needs to be identified during implementation.
The wezterm-server feature does not exist yet and depends on a sibling proposal.
Nushell is purely additive.
Phasing allows validation at each step and easy rollback if a feature misbehaves.

### Decision 2: Use community features for neovim and nushell rather than writing our own

**Decision**: Prefer existing community features: `devcontainers-extra` for neovim (homebrew variant), `eitsupi/devcontainer-features` for nushell.

**Why**: Writing and maintaining devcontainer features has overhead (OCI publishing, CI, versioning).
Community features for common tools handle architecture detection, version pinning, and clean installation.
If a community feature proves unreliable, we can fork or replace it.
The neovim choice requires validation during implementation: the homebrew variant installs homebrew into the container (added overhead), while `duduribeiro/neovim` is an alternative with direct version support.

### Decision 3: Build our own wezterm-server feature

**Decision**: Create `ghcr.io/weft/devcontainer-features/wezterm-server:1` rather than using a community feature.

**Why**: No community feature exists for headless wezterm-mux-server installation.
Our use case is specific: we extract only the mux-server and CLI binaries from the .deb, deliberately avoiding GUI dependencies.
This extraction logic is non-trivial and project-specific enough to warrant a dedicated feature.
The feature is proposed in a sibling proposal for the weft devcontainer-features repository.

### Decision 4: Add nushell as a new capability rather than replacing bash

**Decision**: Install nushell alongside bash, not as a replacement.

**Why**: Bash remains the default shell for compatibility with existing scripts, devcontainer lifecycle commands (`postCreateCommand`, `postStartCommand`), and developer muscle memory.
Nushell provides structured data pipelines (native JSON/YAML parsing), which is useful for inspecting `devcontainer.json`, `package.json`, and build outputs without `jq` or `grep` chains.
It is also useful for build automation scripts that need to manipulate structured config files.
This is additive and non-breaking: nushell is available for interactive use and new scripts without affecting existing bash workflows.

### Decision 5: Keep git-delta in the Dockerfile for now

**Decision**: Do not extract git-delta into a feature in this proposal.

**Why**: git-delta is a simple .deb install (3 lines) and is not a high-value target for feature extraction.
It can be addressed in a future cleanup pass.
Keeping it reduces the scope of this proposal.

## Edge Cases / Challenging Scenarios

### Feature install order conflicts

Devcontainer features install in the order they appear in the `features` object in `devcontainer.json`, with an optional `overrideFeatureInstallOrder` property to control sequencing explicitly.
Features may conflict if two features try to install the same tool, modify the same paths, or run conflicting `apt-get install` operations.
The existing `git:1` feature and the base `node:24-bookworm` image both provide git: this already works today, so feature ordering is not a new risk.
However, if the neovim homebrew feature runs `apt-get update` and installs packages, this could interact with the Playwright dependencies already installed in the Dockerfile.

**Mitigation**: Test each feature addition in isolation before combining.
If ordering issues arise, use `overrideFeatureInstallOrder` to sequence features explicitly.

### Base image coupling

Features that assume Debian bookworm package names, paths, or package manager availability may break if the base image changes (e.g., upgrading from `node:24-bookworm` to a future `node:26-*` based on a different Debian release or Ubuntu).
The neovim homebrew feature is more resilient to this since homebrew manages its own package ecosystem, but the apt-get variant would be directly affected.

**Mitigation**: When changing the base image, rebuild and test all features.
Pin the base image to a specific Debian release (bookworm) rather than a generic tag.

### Wezterm-server feature not yet available

Phase 3 depends on a sibling proposal being implemented.
If that proposal is delayed or rejected, the wezterm installation remains in the Dockerfile.

**Mitigation**: Phase 3 is explicitly gated on the sibling proposal.
The other phases are independent.

### Community feature deprecation or abandonment

Community features may stop being maintained.
If the neovim or nushell feature breaks on a future base image update, we would need to fork or replace it.

**Mitigation**: Pin feature versions with the `:1` major version tag.
Monitor for breakage during regular devcontainer rebuilds.
The Dockerfile retains the original installation commands in git history for reference if a rollback is needed.

### Version pinning semantics differ between features

The claude code feature may accept a `version` option, but not all features support version pinning.
Some use `latest` by default.

**Mitigation**: Check each feature's `devcontainer-feature.json` for supported options before implementation.
Where version pinning is not supported, document the behavior and consider whether the feature is acceptable.

### ARG removal may affect downstream layers

The `CLAUDE_CODE_VERSION` ARG is only used for the npm install line.
Removing it is safe.
The `NEOVIM_VERSION` and `WEZTERM_VERSION` ARGs are similarly self-contained.
Verify no other Dockerfile lines reference these ARGs before removing them.

## Test Plan

Each phase has its own verification steps:

- **Build test**: `docker build` (or devcontainer CLI `devcontainer build`) completes without errors.
- **Tool presence**: The installed tool is available on `$PATH` and reports the expected version.
- **Functional test**: The tool performs its primary function (e.g., `nvim --version`, `wezterm-mux-server --help`, `claude --version`, `nu --version`).
- **Integration test**: The full devcontainer starts, the `postStartCommand` succeeds (wezterm mux daemon), and existing workflows (pnpm dev, pnpm test:e2e) are unaffected.
- **Rollback test**: For each phase, verify that reverting the `devcontainer.json` change and restoring the Dockerfile block produces a working container.
  This ensures a safe fallback path if a feature misbehaves in production use after the initial validation.

## Implementation Phases

### Phase 1: Replace claude code Dockerfile install with Anthropic feature

This is the lowest-risk change because the feature is officially maintained by Anthropic.

**Steps**:

1. Add `"ghcr.io/anthropics/devcontainer-features/claude-code:1": { "version": "2.1.11" }` to the `features` block in `devcontainer.json`.
2. Remove the `ARG CLAUDE_CODE_VERSION="2.1.11"` line from the Dockerfile.
3. Remove the `RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"` line from the Dockerfile.
4. Remove the comment on line 7 (`# https://www.npmjs.com/package/@anthropic-ai/claude-code?activeTab=versions`) that references the removed ARG.
5. Keep the `anthropic.claude-code` entry in `customizations.vscode.extensions`: the feature installs the extension, but the explicit entry ensures it is present even if the feature's extension installation mechanism changes.
   Having a duplicate extension entry is harmless.
6. Verify that the feature's root-context npm install does not conflict with the `NPM_CONFIG_PREFIX` and PATH settings in the Dockerfile.
   The feature manages its own global install path; the Dockerfile's `NPM_CONFIG_PREFIX` is used by the node user at runtime.
   These should not conflict, but verify by checking `which claude` and confirming the binary is on `$PATH`.
7. Verify: rebuild the devcontainer, confirm `claude --version` returns the expected version.

**Success criteria**: `claude --version` works inside the container.
Existing claude code settings (`CLAUDE_CONFIG_DIR`, mounted `.claude` directory) function correctly.
The `NPM_CONFIG_PREFIX` setup in the Dockerfile does not interfere with the feature-installed claude binary.

### Phase 2: Replace neovim Dockerfile install with community feature

**Steps**:

1. Evaluate the available neovim features:
   - `ghcr.io/devcontainers-extra/features/neovim-homebrew:1`: installs via homebrew, supports newer versions, but adds homebrew as a dependency in the container.
   - `ghcr.io/duduribeiro/devcontainer-features/neovim:1`: supports specifying versions directly, lighter weight.
   - `ghcr.io/devcontainers-extra/features/neovim-apt-get:1`: not viable (Debian bookworm repos only have v0.7).
2. Test the chosen feature with version pinning to v0.11.6 or later.
3. Add the feature to `devcontainer.json`.
4. Remove the `ARG NEOVIM_VERSION` and the neovim tarball download/extract/symlink block from the Dockerfile.
5. Remove the associated comment block (lines 97-98).
6. Verify: rebuild, confirm `nvim --version` reports v0.11.6+.

**Success criteria**: `nvim --version` works and reports the expected version.
Neovim configuration files (if any are mounted or copied) load correctly.

### Phase 3: Replace wezterm Dockerfile install with weft feature

> NOTE(opus/devcontainer-features): This phase is gated on the sibling proposal for `ghcr.io/weft/devcontainer-features/wezterm-server:1` being implemented and published.

**Steps**:

1. Add `"ghcr.io/weft/devcontainer-features/wezterm-server:1": { "version": "20240203-110809-5046fc22" }` to `devcontainer.json`.
2. Remove the `ARG WEZTERM_VERSION` and the wezterm .deb download/extract block (lines 112-125) from the Dockerfile.
3. Remove line 128 (`mkdir -p /run/user/1000 && chown ...`) from the Dockerfile.
   The wezterm-server feature's install script should handle creating the runtime directory, since this is a wezterm-specific requirement.
4. Verify: rebuild, confirm `wezterm-mux-server --help` works.
5. Verify: the `postStartCommand` (`wezterm-mux-server --daemonize`) succeeds.
6. Verify: SSH domain multiplexing through port 2222 still works.

**Success criteria**: `wezterm-mux-server --daemonize` starts without errors.
SSH connections to port 2222 with wezterm CLI work from the host.

### Phase 4: Add nushell feature

This is purely additive: no existing functionality is removed.

**Steps**:

1. Add `"ghcr.io/eitsupi/devcontainer-features/nushell:1": {}` to `devcontainer.json`.
   This is the only confirmed community feature for nushell (not available in `devcontainers-extra`).
2. Verify: rebuild, confirm `nu --version` works.
3. Optionally add nushell configuration defaults to the devcontainer (e.g., `config.nu` with project-specific settings).

**Success criteria**: `nu` launches an interactive nushell session inside the container.
Bash remains the default shell; nushell is available as an alternative.

### Phase 5: Dockerfile cleanup and verification

After all tool installations have been extracted to features, clean up the Dockerfile.

**Steps**:

1. Remove any orphaned comments referencing the removed tool install blocks.
2. Consolidate related `RUN` layers if extraction created gaps.
3. Review remaining ARGs and ENV variables: remove any that are no longer referenced.
4. Verify the Dockerfile is focused on: base image, system dependencies, pnpm setup, user/permissions, and project build steps.
   Confirm that the `USER` directive is still present in the Dockerfile or that `remoteUser` is explicitly set in `devcontainer.json` to ensure the container runs as the node user at runtime.
5. Full integration test: rebuild from scratch, run `pnpm install`, `pnpm build:electron`, `pnpm test:e2e`.
6. Verify all tools are present: `git`, `claude`, `nvim`, `wezterm-mux-server`, `nu`, `delta`.

**Success criteria**: Clean devcontainer build.
All tools functional.
Dockerfile is shorter and focused on project-specific concerns.
No regressions in existing workflows.
