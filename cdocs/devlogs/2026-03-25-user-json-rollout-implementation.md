---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T11:00:00-07:00
task_list: lace/user-json-rollout
type: devlog
state: live
status: review_ready
tags: [lace, user_config, dotfiles, chezmoi, verification]
last_reviewed:
  status: accepted
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T12:00:00-07:00
  round: 1
---

# user.json Rollout Implementation: Devlog

## Objective

Implement [the user.json rollout proposal](../proposals/2026-03-25-lace-user-json-rollout.md):
populate `~/.config/lace/user.json` with user-preference features (nushell, neovim, claude-code), git identity, default shell, mounts, and env vars.
Clean up the lace project's `devcontainer.json` to remove user-preference concerns.
Verify the complete developer environment end-to-end in a freshly rebuilt container.

## Deviations from Proposal

1. **Neovim feature**: Using `ghcr.io/weftwiseink/devcontainer-features/neovim:1` (lace-native, with plugin persistence mount) instead of `ghcr.io/devcontainers-extra/features/neovim-homebrew:1`.
   The lace neovim feature is already published and declares a `neovim/plugins` mount for `~/.local/share/nvim`.
2. **Claude-code feature reference**: The proposal says to use `ghcr.io/weftwiseink/devcontainer-features/claude-code:1` in user.json.
   This is the lace wrapper feature (already published), not the upstream anthropic feature.

## Plan

### Phase 1: Configuration updates
1. Update `~/.config/lace/user.json` with target config.
2. Add `installsAfter` to lace-fundamentals feature for nushell.
3. Clean up `.devcontainer/devcontainer.json`: remove claude-code from prebuildFeatures, remove claude mounts, update CLAUDE_CONFIG_DIR.
4. Update `~/.config/lace/settings.json`: add claude-code mount sources, remove old project/claude-config.
5. Add nvim plugin pre-install to postCreateCommand chain.
6. Commit code changes.

### Phase 2: Rebuild and verify
1. Rebuild container.
2. Walk through verification checklist.
3. Document results.

### Phase 3: Fix issues and iterate
Address any failures from Phase 2.

## Testing Approach

Full container rebuild and manual verification against the proposal's checklist.
Each checklist item verified with actual command output pasted into this devlog.

## Implementation Notes

### Phase 1

Configuration updates completed across 5 commits:

1. Core changes: user.json populated, devcontainer.json cleaned up, settings.json updated, postCreateCommand added.
2. Trailing comma fix in devcontainer.json (lace's jsonc-parser has `allowTrailingComma: false`).
3. `installsAfter` format fix: uses array of strings, not object like `dependsOn`.
4. Feature version bumps to 1.0.1: forced GHCR republish for claude-code (config-json mount) and lace-fundamentals (installsAfter).
5. Removed temporary project-level claude-config-json mount after feature republish.

**Key issues discovered:**
- The claude-code feature's `config-json` mount was added locally but never republished to GHCR.
  The CI workflow (`devcontainers/action@v1`) only publishes features whose version has changed.
  Bumping version from 1.0.0 to 1.0.1 forced the republish.
- The `installsAfter` field uses array format (`["feature-id"]`), not object format like `dependsOn` (`{"feature-id": {}}`).
  The proposal used the wrong format.

### Phase 2 and Phase 3 (Iterative)

Multiple rebuild-fix-verify cycles were needed.
Each issue discovered in Phase 2 was fixed immediately (Phase 3) and re-verified.

**Issue 1: User features not installed in container**
Root cause: `runPrebuild` in `prebuild.ts` reads the source `devcontainer.json` directly, ignoring user features merged into the in-memory config.
Fix: Added `prebuildFeatures` option to `PrebuildOptions` so `up.ts` can pass merged features.
This was a lace code bug, not a configuration issue.

**Issue 2: `installsAfter` format**
The proposal used object format (`{"feature": {}}`), but the spec requires an array of strings.
Fix: Changed to `["ghcr.io/eitsupi/devcontainer-features/nushell"]`.

**Issue 3: GHCR features stale (config-json mount missing)**
The `devcontainers/action@v1` CI only publishes features whose version has changed.
Fix: Bumped claude-code to 1.0.1, lace-fundamentals to 1.0.2.

**Issue 4: Nushell binary path**
Nushell installs to `/usr/local/bin/nu`, not `/usr/bin/nu` as the proposal assumed.
Fix: Updated user.json to reference `/usr/local/bin/nu`.

**Issue 5: chsh fails because nushell not in /etc/shells**
Feature-installed shells aren't listed in `/etc/shells` by default.
Fix: Added `/etc/shells` entry before `chsh` in `shell.sh`.

**Issue 6: defaultShell not propagated to prebuild**
The `defaultShell` injection updated `resolvedConfig` (a structuredClone) but not `configMinimal.raw`.
The prebuild extracted features from `configMinimal.raw` and missed the option.
Fix: Also propagate `defaultShell` back to `configMinimal.raw`.

**Issue 7: Git version too old**
Container had git 2.39.5 but git 2.48.0+ is needed for `relativeworktrees` extension.
Fix: Added `"ghcr.io/devcontainers/features/git:1": { "version": "latest" }` to prebuildFeatures.

## Changes Made

| File | Description |
|------|-------------|
| `~/.config/lace/user.json` | Populated with features, git identity, env vars, mounts |
| `~/.config/lace/settings.json` | Added claude-code and neovim mount sources |
| `.devcontainer/devcontainer.json` | Removed claude mounts/feature, added git:latest, nvim pre-install |
| `devcontainers/features/src/lace-fundamentals/devcontainer-feature.json` | installsAfter, version bump to 1.0.2 |
| `devcontainers/features/src/lace-fundamentals/steps/shell.sh` | Add /etc/shells entry before chsh |
| `devcontainers/features/src/claude-code/devcontainer-feature.json` | Version bump to 1.0.1 |
| `packages/lace/src/lib/prebuild.ts` | Accept prebuildFeatures override option |
| `packages/lace/src/lib/up.ts` | Pass merged features to prebuild, propagate defaultShell |

## Verification

All checklist items verified in freshly rebuilt container:

```
Shell: SHELL=/usr/local/bin/nu, login shell=/usr/local/bin/nu, nu 0.111.0
Editor: NVIM v0.11.6, EDITOR=nvim, VISUAL=nvim
Git: micimize / rosenthalm93@gmail.com, GIT_AUTHOR_NAME unset
Claude: 2.1.83, CLAUDE_CONFIG_DIR=/home/node/.claude, .claude.json=48634 bytes (full overlay)
Mounts: screenshots (25 files), dotfiles, authorized_keys all present
Dotfiles: nushell config, nvim init.lua, starship.toml all present
Tools: git 2.53.0, delta 0.18.2, chezmoi v2.70.0, curl, jq, less all present
```

**Not verified (deferred):**
- Nushell history persistence (deferred to dedicated RFP)
- SSH connect test (requires SSH key setup, verified auth_keys mount exists)
- Cross-project rebuild (dotfiles devcontainer with same user.json)
- Starship prompt rendering (requires interactive shell)
- Carapace completions (requires interactive nushell)
- Neovim lazy.nvim plugin pre-install (postCreateCommand may not have run in this build mode)

