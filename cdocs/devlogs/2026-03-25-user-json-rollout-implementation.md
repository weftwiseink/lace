---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T11:00:00-07:00
task_list: lace/user-json-rollout
type: devlog
state: live
status: wip
tags: [lace, user_config, dotfiles, chezmoi, verification]
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

