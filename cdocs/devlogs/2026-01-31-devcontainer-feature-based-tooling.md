---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T00:00:00-08:00
task_list: lace/devcontainer-features
type: devlog
state: archived
status: completed
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

Commit: `737b5b5`, fix: `b51d424`

Removed:
- `ARG CLAUDE_CODE_VERSION="2.1.11"` and its NPM URL comment
- `RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"` (was running as node user)

Added to devcontainer.json features:
```json
"ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
```

> NOTE(opus/devcontainer-features): The proposal specified `"version": "2.1.11"` but build verification revealed the Anthropic feature has **no `version` option** in its `devcontainer-feature.json` (options object is empty). The parameter was silently ignored and the feature always installs the latest npm release. Removed the dead config in commit `b51d424`. The feature installed v2.1.27 (current latest) successfully.

Retained `NPM_CONFIG_PREFIX` and `PATH` settings in the Dockerfile. The feature installs as root with its own npm global path, so these don't conflict. The Dockerfile settings remain useful for any future npm global installs by the node user.

Retained `anthropic.claude-code` in vscode extensions list per proposal guidance (harmless duplicate, ensures extension presence regardless of feature behavior).

### Phase 2: Neovim Feature

Commit: `e4d5d52`, fix: `2bdb634`

**Decision: `neovim-homebrew` with default version (no pin)**

Evaluated all community options with actual build testing:

- `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` with `version: "0.11.6"`: **FAILED**. The feature constructs `brew install neovim@0.11.6` but homebrew has no versioned formula for neovim. Only the unversioned `neovim` formula exists.
- `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` with `version: "latest"` (default): **SUCCESS**. Installs via `brew install neovim` which currently provides v0.11.6 via pre-built bottles.
- `ghcr.io/duduribeiro/devcontainer-features/neovim:1` with `version: "0.11.6"`: **FAILED**. The feature downloads source but then fails with `can't cd to /tmp/neovim-v0.11.6` - broken extraction logic.
- `ghcr.io/devcontainers-extra/features/neovim-apt-get:1`: Not tested (bookworm repos only have v0.7, per proposal).

> NOTE(opus/devcontainer-features): Neither community neovim feature supports reliable version pinning. The homebrew variant works only with default/latest. The duduribeiro variant is broken for version 0.11.6. This means neovim version will float with whatever homebrew provides. Currently that's 0.11.6 which meets our requirement. If a specific version is needed in the future, the original tarball approach (preserved in git history) would need to be restored or a custom feature built.

> NOTE(opus/devcontainer-features): The user's note about AppImage was considered. No existing devcontainer feature uses the AppImage approach. An AppImage-based feature could be created in the future if homebrew overhead becomes a problem.

Removed:
- `ARG NEOVIM_VERSION="v0.11.6"` and the 10-line tarball download/extract/symlink block

Added to devcontainer.json features:
```json
"ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {}
```

### Phase 3: Wezterm Feature

**SKIPPED** - gated on sibling proposal.

The sibling proposal (`cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`) is `implementation_ready` but has not been implemented yet. The `ghcr.io/weft/devcontainer-features/wezterm-server:1` feature does not exist at this time.

The wezterm installation block (ARG, .deb download/extraction, runtime directory creation) remains in the Dockerfile. It will be removed when the weft feature is published and Phase 3 can proceed.

### Phase 4: Nushell Feature

Commit: `0b8a89a`, fix: `a2b7675`

Added to devcontainer.json features:
```json
"ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
```

> NOTE(opus/devcontainer-features): The proposal specified `:1` but the nushell feature has never reached a 1.x release. The highest major version tag is `:0` (currently 0.1.1). The `:1` tag does not exist in the registry, causing `devcontainer build` to fail with "manifest unknown". Fixed to `:0` in commit `a2b7675`.

No Dockerfile changes needed. Bash remains the default shell. Nushell 0.110.0 installed successfully.

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
  - `ghcr.io/anthropics/devcontainer-features/claude-code:1` (no version pin, installs latest)
  - `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` (no version pin, installs latest via homebrew)
  - `ghcr.io/eitsupi/devcontainer-features/nushell:0` (note: `:0` not `:1`)
- Added trailing newline

### Dockerfile
- Removed `ARG CLAUDE_CODE_VERSION` and associated comment (3 lines)
- Removed `RUN npm install -g claude-code` and comment (3 lines)
- Removed `ARG NEOVIM_VERSION` and tarball download/extract block (10 lines)
- Removed 2 extra blank lines
- Net reduction: 20 lines (186 -> 166)

### Proposal status
- Updated from `implementation_ready` to `implementation_wip`

## Verification

**Full container build verification performed.** Built a test image with all 5 features (git, sshd, claude-code, neovim-homebrew, nushell) plus the Dockerfile's wezterm and delta installs.

### Build result: SUCCESS

All features resolved and installed without errors.

### Tool verification results (all PASS):

| Tool | Binary Path | Version |
|------|------------|---------|
| claude | `/usr/local/share/npm-global/bin/claude` | 2.1.27 (latest) |
| nvim | `/home/linuxbrew/.linuxbrew/bin/nvim` | NVIM v0.11.6 |
| nu | `/usr/local/bin/nu` | 0.110.0 |
| wezterm-mux-server | `/usr/local/bin/wezterm-mux-server` | 20240203-110809-5046fc22 |
| wezterm | `/usr/local/bin/wezterm` | 20240203-110809-5046fc22 |
| delta | `/usr/bin/delta` | 0.18.2 |
| git | `/usr/bin/git` | 2.39.5 |
| node | `/usr/local/bin/node` | v24.13.0 |
| pnpm | `/usr/local/bin/pnpm` | 10.28.2 |

### Environment verification (all PASS):

- Running as `node` user
- `DEVCONTAINER=true`
- `NPM_CONFIG_PREFIX=/usr/local/share/npm-global`
- `/run/user/1000` exists
- `/workspace` exists

### Not tested (requires full project source):
- `pnpm install`, `pnpm build:electron`, `pnpm test:e2e` (build context doesn't include project source files in this environment)
- `postStartCommand` (`wezterm-mux-server --daemonize`)
- Rollback tests

## Deviations from Proposal

1. **Phase 3 skipped**: The wezterm-server feature does not exist yet. This was anticipated by the proposal ("Phase 3 is explicitly gated on the sibling proposal") and is not a surprise deviation.
2. **No NPM_CONFIG_PREFIX removal**: The proposal mentioned this "may need adjustment or removal." Kept it because it doesn't conflict with the feature and remains useful for future npm global installs by the node user.
3. **Nushell feature tag `:0` not `:1`**: The proposal assumed the nushell feature was at major version 1, but it has never reached 1.x. The `:1` tag doesn't exist. Using `:0` (currently 0.1.1).
4. **Claude code version not pinned**: The Anthropic feature has no `version` option. It always installs the latest release. The proposal's version pin was based on incorrect assumptions about the feature's capabilities.
5. **Neovim version not pinned**: The homebrew feature's version option doesn't work as expected (constructs invalid versioned formula names). Using default/latest, which currently provides 0.11.6. This means the neovim version will float with homebrew updates.
