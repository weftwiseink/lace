---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T00:00:00-08:00
task_list: lace/devcontainer-features
type: devlog
state: live
status: review_ready
tags: [devcontainer, features, tooling, implementation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T12:00:00-08:00
  round: 1
---

# Devlog: Migrate Lace Devcontainer to Feature-Based Tooling

## Objective

Implement the proposal at `cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md`.

Replace ad-hoc tool installations in the lace Dockerfile with declarative devcontainer features, following the five-phase migration plan.

## Plan

Phases per proposal:

1. **Phase 1**: Replace claude code Dockerfile install with Anthropic feature
2. **Phase 2**: Replace neovim Dockerfile install with community feature
3. **Phase 3**: Replace wezterm Dockerfile install with weft feature (gated on sibling proposal)
4. **Phase 4**: Add nushell feature
5. **Phase 5**: Dockerfile cleanup and verification

## Implementation Notes

### Phase 1: Claude Code Feature

Commit: `737b5b5`

Straightforward migration. Removed:
- `ARG CLAUDE_CODE_VERSION="2.1.11"` and its NPM URL comment
- `RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"` (was running as node user)

Added to devcontainer.json features:
```json
"ghcr.io/anthropics/devcontainer-features/claude-code:1": {
    "version": "2.1.11"
}
```

Retained `NPM_CONFIG_PREFIX` and `PATH` settings in the Dockerfile. The feature installs as root with its own npm global path, so these don't conflict. The Dockerfile settings remain useful for any future npm global installs by the node user.

Retained `anthropic.claude-code` in vscode extensions list per proposal guidance (harmless duplicate, ensures extension presence regardless of feature behavior).

### Phase 2: Neovim Feature

Commit: `e4d5d52`

**Decision: `neovim-homebrew` over `duduribeiro/neovim`**

Evaluated both community options:
- `ghcr.io/duduribeiro/devcontainer-features/neovim:1`: Builds neovim from source. Adds significant build time. Not suitable for a dev container that needs fast rebuilds.
- `ghcr.io/devcontainers-extra/features/neovim-homebrew:1`: Installs via homebrew. Adds homebrew dependency but uses pre-built bottles, much faster than source compilation.
- `ghcr.io/devcontainers-extra/features/neovim-apt-get:1`: Not viable (bookworm repos only have v0.7).

Chose `neovim-homebrew` per proposal recommendation. The homebrew overhead is a tradeoff but acceptable given the alternative is compiling from source.

> NOTE(opus/devcontainer-features): The user's note about AppImage was considered. No existing devcontainer feature uses the AppImage approach. The tarball-based approach from the original Dockerfile was already essentially the same pattern (download pre-built binary, extract, symlink). The homebrew feature does something similar but with better version management. An AppImage-based feature could be created in the future if homebrew overhead becomes a problem.

Removed:
- `ARG NEOVIM_VERSION="v0.11.6"` and the 10-line tarball download/extract/symlink block

Added to devcontainer.json features:
```json
"ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {
    "version": "0.11.6"
}
```

### Phase 3: Wezterm Feature

**SKIPPED** - gated on sibling proposal.

The sibling proposal (`cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`) is `implementation_ready` but has not been implemented yet. The `ghcr.io/weft/devcontainer-features/wezterm-server:1` feature does not exist at this time.

The wezterm installation block (ARG, .deb download/extraction, runtime directory creation) remains in the Dockerfile. It will be removed when the weft feature is published and Phase 3 can proceed.

### Phase 4: Nushell Feature

Commit: `0b8a89a`

Purely additive. Added to devcontainer.json features:
```json
"ghcr.io/eitsupi/devcontainer-features/nushell:1": {}
```

No version pin since the feature doesn't appear to support one via its options. Using `:1` major version tag for stability.

No Dockerfile changes needed. Bash remains the default shell.

### Phase 5: Cleanup

Commit: `7d22ad0`

Minimal cleanup since Phase 3 was skipped (wezterm blocks remain):
- Removed extra blank line after `ENV DEVCONTAINER=true`
- Removed extra blank line before `# Default command` at end of file
- Added trailing newline to `devcontainer.json` (was missing, consistent with `files.insertFinalNewline` setting)

No orphaned ARGs or ENV variables found. No orphaned comments referencing removed blocks. The `USER` directive remains at line 126.

Dockerfile went from 186 lines to 166 lines (20 lines removed). Once Phase 3 is completed, another ~22 lines will be removed.

## Changes Made

### devcontainer.json
- Added 3 new features to the `features` block:
  - `ghcr.io/anthropics/devcontainer-features/claude-code:1` (version: 2.1.11)
  - `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` (version: 0.11.6)
  - `ghcr.io/eitsupi/devcontainer-features/nushell:1`
- Added trailing newline

### Dockerfile
- Removed `ARG CLAUDE_CODE_VERSION` and associated comment (3 lines)
- Removed `RUN npm install -g claude-code` and comment (3 lines)
- Removed `ARG NEOVIM_VERSION` and tarball download/extract block (10 lines)
- Removed 2 extra blank lines
- Net reduction: 20 lines (186 → 166)

### Proposal status
- Updated from `implementation_ready` to `implementation_wip`

## Verification

**Cannot perform container build verification in this environment** (no Docker daemon available on the host). The changes are structural and follow the devcontainer features spec. Verification should be done by rebuilding the devcontainer:

1. `claude --version` - should report 2.1.11 (from Anthropic feature)
2. `nvim --version` - should report v0.11.6 (from neovim-homebrew feature)
3. `nu --version` - should report current nushell version (from eitsupi feature)
4. `wezterm-mux-server --help` - should work (still installed via Dockerfile)
5. `delta --version` - should work (still installed via Dockerfile)
6. `wezterm-mux-server --daemonize` - postStartCommand should succeed

## Deviations from Proposal

1. **Phase 3 skipped**: The wezterm-server feature does not exist yet. This was anticipated by the proposal ("Phase 3 is explicitly gated on the sibling proposal") and is not a surprise deviation.
2. **No NPM_CONFIG_PREFIX removal**: The proposal mentioned this "may need adjustment or removal." Kept it because it doesn't conflict with the feature and remains useful for future npm global installs by the node user.
3. **Nushell not version-pinned**: The proposal showed `{}` (no version) for nushell, which is what was implemented. The feature's options were checked and no version pinning beyond the `:1` major tag is available.
