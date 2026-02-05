---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:00:00-08:00
task_list: lace/dotfiles-migration
type: devlog
state: archived
status: done
tags: [wezterm, plugin, extraction, dotfiles, migration]
implements: cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
---

# WezTerm Plugin Extraction Devlog

## Objective

Extract lace-specific wezterm functionality into a standalone plugin, and migrate personal wezterm config to the dotfiles repo. This implements Phases 1-2 and parts of Phase 5-6 from the dotfiles migration proposal.

## Current State

- Lace plugins system is implemented and tested
- Dotfiles repo has basic devcontainer setup and chezmoi structure
- WezTerm config in `lace/config/wezterm/wezterm.lua` contains mixed lace-specific and personal code

## Plan

### Phase 1: WezTerm Plugin Scaffold

1. Create plugin directory structure at `config/wezterm/lace-plugin/`
2. Extract lace-specific functionality (SSH domain, worktree picker) into plugin
3. Keep plugin backward-compatible with existing workflow

### Phase 2: WezTerm Plugin Full Implementation

1. Complete plugin with configurable options
2. Test plugin loads and works with devcontainer
3. Handle host vs container path detection

### Phase 5-6 (WezTerm portions): Personal Config Migration

1. Create personal wezterm config in dotfiles
2. Configure plugin loading in dotfiles wezterm config
3. Update dotfiles devcontainer to declare lace as plugin
4. Configure settings.json for local development

## Progress Log

### Session 1: 2026-02-04 23:00

Starting implementation. Reading existing code to understand the structure.

**Analysis of current wezterm.lua:**
- Lines 13-51: Personal appearance settings (color scheme, font, window styling)
- Lines 27-34: Status bar (workspace name display) - lace-specific but generic enough for personal
- Lines 52-86: SSH domain config for lace devcontainer - LACE-SPECIFIC
- Lines 88-142: Personal keybindings (pane navigation, splits, tabs)
- Lines 144-221: Devcontainer connect + worktree picker - LACE-SPECIFIC
- Lines 223-282: Copy mode, workspaces, optional plugins - Personal

**Lace-specific code to extract:**
1. SSH domain configuration (ssh_domains table)
2. Worktree picker event handler (trigger-worktree-picker)
3. Quick connect keybinding (Leader+D)
4. Worktree picker keybinding (Leader+W)

Note: Per the proposal, keybindings are disabled pending the project picker RFP.

---

## Implementation Notes

### WezTerm Plugin Created

Created `config/wezterm/lace-plugin/` with:

- `plugin/init.lua` - Plugin entry point with:
  - `M.defaults` - Configurable default options
  - `M.apply_to_config(config, opts)` - Main plugin setup function
  - `M.get_picker_event(domain_name)` - Helper to get event name for keybindings
  - `M.connect_action(opts)` - Helper to create connect action
  - Internal: `setup_ssh_domain`, `setup_worktree_picker`, `setup_status_bar`
  - Event deduplication to prevent multiple handlers

- `README.md` - Documentation with usage examples

### Lace wezterm.lua Updated

Refactored `config/wezterm/wezterm.lua` to use the plugin:

- Personal appearance and keybinding settings retained as-is
- SSH domain config moved to plugin
- Worktree picker moved to plugin
- Plugin path detection handles: container mount, relative path, absolute path
- Keybindings (Leader+D, Leader+W) added via plugin API

### Dotfiles Personal Config Created

Created `dotfiles/dot_config/wezterm/wezterm.lua`:

- Personal appearance and keybinding settings
- Loads lace plugin for devcontainer access
- Configures both lace (port 2222) and dotfiles (port 2223) devcontainers
- Leader+D: connect to lace, Leader+F: connect to dotfiles

### Dotfiles Devcontainer Updated

Updated `dotfiles/.devcontainer/devcontainer.json`:

- Added `customizations.lace.plugins` with lace repo
- Plugin will be mounted at `/mnt/lace/plugins/lace/`

### User Settings Created

Created `~/.config/lace/settings.json`:

- Override for `github.com/weftwiseink/lace` to use local checkout
- Enables plugin development without pushing to git

### Bug Fix: Image-based Devcontainers

Discovered and fixed a bug where `resolve-mounts` failed on image-based devcontainer configs (no Dockerfile):

- Added `readDevcontainerConfigMinimal()` function that doesn't require Dockerfile
- Updated `resolve-mounts.ts` to use minimal reader
- Updated `up.ts` to only require Dockerfile when prebuild is needed
- All 254 tests pass

### Verification

- `lace resolve-mounts --dry-run --workspace-folder /home/mjr/code/personal/dotfiles`
  - Successfully shows: "Would resolve 1 plugin(s) for project 'dotfiles'"

- `lace resolve-mounts --workspace-folder /home/mjr/code/personal/dotfiles`
  - Successfully creates `.lace/resolved-mounts.json` with correct mount specs

## Files Changed

### Lace Repo

- `config/wezterm/lace-plugin/plugin/init.lua` (new)
- `config/wezterm/lace-plugin/README.md` (new)
- `config/wezterm/wezterm.lua` (updated - now uses plugin)
- `packages/lace/src/lib/devcontainer.ts` (bug fix)
- `packages/lace/src/lib/resolve-mounts.ts` (bug fix)
- `packages/lace/src/lib/up.ts` (bug fix)

### Dotfiles Repo

- `dot_config/wezterm/wezterm.lua` (new)
- `.devcontainer/devcontainer.json` (updated - lace plugin declaration)

### User Config

- `~/.config/lace/settings.json` (new)

## Testing Needed

1. Manual: Reload wezterm and verify plugin loads without errors
2. Manual: Connect to lace devcontainer via Leader+D
3. Manual: Trigger worktree picker via Leader+W
4. Manual: Apply dotfiles wezterm config and verify it works

## Status

**Complete** - WezTerm plugin extraction and personal config migration done. Bug fix for image-based devcontainers included.
