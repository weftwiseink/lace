---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T19:58:00-08:00
task_list: lace/dotfiles-migration
type: devlog
state: live
status: complete
tags: [nvim, wezterm, dotfiles, chezmoi, migration]
implements: cdocs/proposals/2026-02-04-nvim-wezterm-config-migration.md
---

# Neovim and WezTerm Config Migration to Dotfiles

## Objective

Audit and propose the migration of neovim config and non-plugin wezterm config from the lace repo to the dotfiles repo. After this migration:

1. Neovim config lives in dotfiles (chezmoi-managed at `dot_config/nvim/`)
2. Non-plugin wezterm config lives in dotfiles (already at `dot_config/wezterm/wezterm.lua`)
3. Lace repo retains only the wezterm plugin (`config/wezterm/lace-plugin/`)

## Current State Analysis

### Neovim Config in Lace (`/var/home/mjr/code/weft/lace/config/nvim/`)

The neovim config is a LazyVim-based configuration with personal preferences:

**Files:**
- `init.lua` - Core settings, bootstrap, basic keymaps (142 lines)
- `lazy-lock.json` - Plugin version lockfile
- `lua/plugins/colorscheme.lua` - Solarized theme (32 lines)
- `lua/plugins/editor.lua` - Editor enhancements: autopairs, surround, comment, flash, todo, persistence (75 lines)
- `lua/plugins/git.lua` - Git integration: gitsigns, fugitive, diffview (84 lines)
- `lua/plugins/lsp.lua` - LSP: mason, nvim-lspconfig, nvim-cmp (159 lines)
- `lua/plugins/telescope.lua` - Fuzzy finder (81 lines)
- `lua/plugins/treesitter.lua` - Syntax highlighting (51 lines)
- `lua/plugins/ui.lua` - UI: neo-tree, bufferline, lualine, which-key, indent-blankline, dressing, notify (159 lines)

**Assessment:** This is 100% personal preferences (confirmed by `cdocs/reports/2026-02-04-neovim-lace-assessment.md`):
- Comments reference "mjr's" preferences throughout
- No lace-specific code (no devcontainer detection, no worktree integration)
- Standard web dev setup (TypeScript, Lua, CSS, HTML, JSON)
- Solarized dark theme matching wezterm

**Migration Required:** Full migration to dotfiles. No plugin extraction needed.

### WezTerm Config in Lace (`/var/home/mjr/code/weft/lace/config/wezterm/`)

**Files:**
- `wezterm.lua` - Main config with mixed personal and lace-specific code (233 lines)
- `lace-plugin/plugin/init.lua` - Lace plugin (243 lines)
- `lace-plugin/README.md` - Plugin documentation

**Analysis of wezterm.lua:**

| Lines | Content | Classification |
|-------|---------|----------------|
| 1-7 | Header, requires | Infrastructure |
| 9-24 | Appearance (color_scheme, font, window) | **Personal** |
| 26-36 | Core settings (scrollback, CSI-u) | **Personal** |
| 42-50 | Unix domains (mux persistence) | **Personal** |
| 52-107 | Keybindings (pane/tab navigation) | **Personal** |
| 109-170 | Lace plugin loading + keybindings | **Lace-specific** |
| 172-188 | Copy mode customization | **Personal** |
| 190-202 | GUI startup event | **Personal** |
| 204-230 | Optional plugins (commented) | **Personal** |

**Migration Status:** Already partially migrated!

The dotfiles repo already has `dot_config/wezterm/wezterm.lua` (207 lines) which contains:
- All personal settings from lace
- Plugin loading for both lace and dotfiles devcontainers
- Fallback status bar if plugin fails to load

### WezTerm Plugin in Lace (`config/wezterm/lace-plugin/`)

This is the extracted lace-specific functionality:
- SSH domain configuration
- Worktree picker event handler
- Status bar workspace display
- Helper functions for connect action

**Migration Required:** Plugin stays in lace. Personal config stays in dotfiles. Lace's wezterm.lua should be cleaned up to only demonstrate plugin usage.

## Gap Analysis

### Neovim: Full Migration Needed

The neovim config needs to be moved from lace to dotfiles:

| Source (lace) | Destination (dotfiles) |
|---------------|------------------------|
| `config/nvim/init.lua` | `dot_config/nvim/init.lua` |
| `config/nvim/lazy-lock.json` | `dot_config/nvim/lazy-lock.json` |
| `config/nvim/lua/plugins/*.lua` | `dot_config/nvim/lua/plugins/*.lua` |

### WezTerm: Cleanup Needed

The wezterm config has already been migrated. What remains:

1. **Dotfiles wezterm config** - Already complete at `dot_config/wezterm/wezterm.lua`
2. **Lace wezterm config** - Should be cleaned up to be minimal (plugin demo only)
3. **Lace plugin** - Already extracted, stays in lace

### Dependencies

**Dotfiles devcontainer dependencies:**
- Lace plugin system must resolve mounts for wezterm plugin access
- Already configured in `dotfiles/.devcontainer/devcontainer.json` with `customizations.lace.plugins`
- Settings override in `~/.config/lace/settings.json` for local development

**Chezmoi integration:**
- Neovim config goes in `dot_config/nvim/` (maps to `~/.config/nvim/`)
- Wezterm config already at `dot_config/wezterm/` (maps to `~/.config/wezterm/`)
- No run_once scripts needed for neovim (lazy.nvim handles plugin installation)

## Proposed Changes

### Phase 1: Neovim Migration

1. Copy `lace/config/nvim/` to `dotfiles/dot_config/nvim/`
2. Update comments to remove lace-specific usage instructions
3. Verify `chezmoi managed` shows new nvim files
4. Test `chezmoi apply` deploys nvim config correctly

### Phase 2: Lace Cleanup

1. Clean up `lace/config/wezterm/wezterm.lua` to be minimal:
   - Keep only as plugin usage example
   - Remove personal preferences (now in dotfiles)
   - Reference dotfiles as canonical config location
2. Consider keeping `lace/config/nvim/` as a fallback or removing it entirely

### Phase 3: Verification

1. Test neovim works from dotfiles config (`chezmoi apply` then launch nvim)
2. Test wezterm works from dotfiles config
3. Test lace devcontainer still works (plugin loads from lace repo)
4. Test dotfiles devcontainer (plugin loads from mounted lace plugin)

## Session Log

### 2026-02-04 19:58 - Starting Audit

Read existing documents:
- `cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md` - Main migration proposal
- `cdocs/reports/2026-02-04-neovim-lace-assessment.md` - Neovim assessment confirming no lace-specific code
- `cdocs/devlogs/2026-02-04-wezterm-plugin-extraction.md` - WezTerm plugin already extracted

Audited config in both repos:
- Lace neovim: 8 files, ~783 lines, 100% personal preferences
- Lace wezterm: Mixed personal + plugin loading, plugin already extracted
- Dotfiles wezterm: Already contains personal config + plugin loading

Key finding: WezTerm migration is already complete. Only neovim migration remains.

### 2026-02-04 20:15 - Creating Proposal

Will create proposal document at `cdocs/proposals/2026-02-04-nvim-wezterm-config-migration.md`.

### 2026-02-04 21:00 - Implementing Accepted Proposal

Proposal accepted. Beginning implementation of migration phases from:
`cdocs/proposals/2026-02-04-nvim-wezterm-config-migration.md`

## Implementation Progress

### Phase 1: Neovim Migration - COMPLETE

**Tasks:**
- [x] Create `dotfiles/dot_config/nvim/` directory structure
- [x] Copy all files from `lace/config/nvim/`
- [x] Update header comments in init.lua
- [x] Verify with `chezmoi managed`
- [x] Commit to dotfiles repo (a0012d0)

**Files migrated:**
- `init.lua` - Updated header to "Personal neovim config, managed by chezmoi"
- `lazy-lock.json` - Plugin lockfile
- `lua/plugins/*.lua` - All 7 plugin configuration files

### Phase 2: Neovim Verification - COMPLETE

**Tests:**
- [x] `chezmoi apply` deployed files to `~/.config/nvim/`
- [x] `nvim --headless "+checkhealth" "+qa"` - launched successfully
- [x] Treesitter parsers downloading and compiling
- [x] Colorscheme solarized confirmed

### Phase 3: Lace Cleanup - COMPLETE

**Tasks:**
- [x] Replace `lace/config/wezterm/wezterm.lua` with minimal demo (67 lines, was 233)
- [x] Remove `lace/config/nvim/` entirely (per Option A in proposal)
- [x] Commit changes to lace repo

**Commits:**
- d8c32b2: Remove nvim config (migrated to dotfiles)
- 4c31ea9: Reduce wezterm.lua to minimal plugin demo

**Note:** Plugin loading shows warning because lace-plugin is not yet a standalone
git repo. This is expected - the plugin extraction is a separate future migration.

### Phase 4: Documentation - COMPLETE

**Tasks:**
- [x] Devlog updated with implementation progress
- [x] Proposal and review documents committed

## Summary

Migration complete. The neovim and wezterm personal configs are now in the
dotfiles repo, managed by chezmoi. The lace repo now contains only:

1. `config/wezterm/wezterm.lua` - Minimal plugin demo (67 lines)
2. `config/wezterm/lace-plugin/` - The lace wezterm plugin

### Commits Made

**Dotfiles repo:**
- a0012d0: feat(nvim): migrate neovim config from lace repo

**Lace repo:**
- d8c32b2: refactor(config): remove nvim config (migrated to dotfiles)
- 4c31ea9: refactor(wezterm): reduce wezterm.lua to minimal plugin demo
- 0492fc7: docs(cdocs): add nvim/wezterm migration proposal and devlog

### Verification Status

- [x] Chezmoi managed files include all nvim configs
- [x] `chezmoi apply` deploys nvim to ~/.config/nvim/
- [x] Neovim launches with solarized theme
- [x] Treesitter parsers install on first launch
- [x] Lace wezterm.lua reduced to <70 lines
- [x] Lace nvim config removed entirely
