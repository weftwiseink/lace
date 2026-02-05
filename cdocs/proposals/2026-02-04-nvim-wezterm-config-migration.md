---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:15:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: live
status: accepted
tags: [nvim, wezterm, dotfiles, chezmoi, migration]
parent: cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:30:00-08:00
  round: 1
---

# Neovim and WezTerm Config Migration to Dotfiles

> BLUF: Migrate the neovim configuration from lace to dotfiles and clean up the lace wezterm config to be plugin-only. After this migration, the lace repo contains only the wezterm plugin (infrastructure), while all personal editor and terminal preferences live in the dotfiles repo managed by chezmoi. This is the final phase of personal config consolidation from the dotfiles migration proposal.
>
> **Key Dependencies:**
> - [Parent Proposal: Dotfiles Migration and Config Extraction](2026-02-04-dotfiles-migration-and-config-extraction.md)
> - [Neovim Assessment Report](../reports/2026-02-04-neovim-lace-assessment.md)
> - [WezTerm Plugin Extraction Devlog](../devlogs/2026-02-04-wezterm-plugin-extraction.md)
>
> **Status:** WezTerm personal config migration is already complete. This proposal covers the remaining neovim migration and lace cleanup.

## Objective

Complete the personal config consolidation by:

1. **Migrating neovim config** from `lace/config/nvim/` to `dotfiles/dot_config/nvim/`
2. **Cleaning up lace wezterm config** to be a minimal plugin demo (personal config already in dotfiles)
3. **Verifying chezmoi integration** for the complete dotfiles workflow

## Background

### Current State

**Lace Repository (`/var/home/mjr/code/weft/lace/`):**

| Path | Contents | Classification |
|------|----------|----------------|
| `config/nvim/` | LazyVim-based neovim config with personal preferences | Personal - migrate out |
| `config/wezterm/wezterm.lua` | Mixed personal + plugin loading | Needs cleanup |
| `config/wezterm/lace-plugin/` | Extracted lace-specific wezterm functionality | Infrastructure - keep |

**Dotfiles Repository (`/home/mjr/code/personal/dotfiles/`):**

| Path | Contents | Status |
|------|----------|--------|
| `dot_config/wezterm/wezterm.lua` | Personal wezterm config + plugin loading | Complete |
| `dot_config/nvim/` | Does not exist | Needs creation |

### What Has Already Been Done

Per the devlogs:

1. **Phase 1-2: WezTerm Plugin Extraction** - Complete
   - Lace-specific wezterm functionality extracted to `config/wezterm/lace-plugin/`
   - Plugin provides: SSH domain config, worktree picker, status bar, connect actions

2. **Phase 3: Dotfiles Devcontainer** - Complete
   - Minimal devcontainer at `dotfiles/.devcontainer/devcontainer.json`
   - Lace plugin declared for wezterm plugin access

3. **Phase 4: Chezmoi Initialization** - Complete
   - Core files migrated: bashrc, blerc, starship.toml, tmux.conf, tridactylrc
   - run_once scripts for starship, blesh, tpm

4. **WezTerm Personal Config** - Complete
   - Personal wezterm config at `dotfiles/dot_config/wezterm/wezterm.lua`
   - Loads lace plugin for both lace (port 2222) and dotfiles (port 2223) devcontainers

### What Remains

1. **Neovim config migration** - This proposal
2. **Lace wezterm.lua cleanup** - This proposal

## Proposed Solution

### Part 1: Neovim Config Migration

Copy the entire neovim configuration from lace to dotfiles:

**Source:** `/var/home/mjr/code/weft/lace/config/nvim/`
```
init.lua
lazy-lock.json
lua/plugins/
  colorscheme.lua
  editor.lua
  git.lua
  lsp.lua
  telescope.lua
  treesitter.lua
  ui.lua
```

**Destination:** `/home/mjr/code/personal/dotfiles/dot_config/nvim/`
```
init.lua
lazy-lock.json
lua/plugins/
  colorscheme.lua
  editor.lua
  git.lua
  lsp.lua
  telescope.lua
  treesitter.lua
  ui.lua
```

**Modifications to migrated files:**

1. Update header comment in `init.lua`:
   ```lua
   -- Personal neovim config
   -- Managed by chezmoi - edit in dotfiles repo, then `chezmoi apply`
   ```
   Remove the lace-specific usage instructions.

2. No other code changes needed - the config is already generic.

**Chezmoi integration:**
- Files at `dot_config/nvim/` map to `~/.config/nvim/`
- No run_once scripts needed (lazy.nvim handles plugin installation on first launch)
- Add to `.chezmoiignore` if needed for platform-specific exclusions (none expected)

### Part 2: Lace WezTerm Cleanup

Reduce `lace/config/wezterm/wezterm.lua` to a minimal plugin usage example:

**Before (current - 233 lines):**
- Full personal config
- Plugin loading
- Comments mixing infrastructure and personal

**After (proposed - ~50 lines):**
```lua
-- Lace WezTerm Plugin Usage Example
-- For personal wezterm config, see: https://github.com/<user>/dotfiles
-- This file demonstrates loading the lace plugin for devcontainer access.

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Minimal config for plugin demonstration
config.color_scheme = "Solarized Dark (Gogh)"

-- Load the lace plugin
local function get_plugin_path()
  local config_dir = debug.getinfo(1, "S").source:sub(2):match("(.*/)")
  if config_dir then
    return "file://" .. config_dir .. "lace-plugin"
  end
  return "file://" .. wezterm.home_dir .. "/code/weft/lace/config/wezterm/lace-plugin"
end

local ok, lace = pcall(wezterm.plugin.require, get_plugin_path())
if ok then
  lace.apply_to_config(config, {
    ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
    domain_name = "lace",
    ssh_port = "localhost:2222",
  })
end

return config
```

### Part 3: Lace Neovim Decision

**Option A: Remove entirely**
- Delete `lace/config/nvim/` after migration
- Simplest, avoids duplication

**Option B: Keep as reference**
- Archive to `lace/config/nvim.archive/`
- Useful if contributors want to see the original

**Option C: Keep minimal stub**
- Reduce to just a README pointing to dotfiles
- Documents the migration

**Recommendation:** Option A (remove entirely). The neovim assessment report documents that there is no lace-specific code. Keeping it creates confusion about which config is canonical.

## Important Design Decisions

### Decision 1: No Neovim Plugin Extraction

**Decision:** Do not create a lace-nvim plugin.

**Rationale:**
- The neovim assessment found zero lace-specific code
- Creating an empty plugin adds complexity without benefit
- If lace-specific nvim features are desired later, build from scratch

### Decision 2: Full File Copy, Not Symlink

**Decision:** Copy neovim files to dotfiles rather than symlinking.

**Rationale:**
- Chezmoi manages files, not symlinks (by design)
- Files in dotfiles are the source of truth
- Copying enables chezmoi templating if needed later

### Decision 3: Keep lazy-lock.json

**Decision:** Include `lazy-lock.json` in the migration.

**Rationale:**
- Provides reproducible plugin versions
- lazy.nvim will update it as plugins are updated
- Prevents surprise breakages from plugin updates

### Decision 4: Lace WezTerm as Demo Only

**Decision:** Reduce lace's wezterm.lua to a minimal plugin demo.

**Rationale:**
- Personal config is now authoritative in dotfiles
- Lace config should only demonstrate the plugin
- Avoids confusion about which config is canonical

## Test Plan

### Pre-Migration Verification

1. Confirm chezmoi source directory is configured:
   ```bash
   chezmoi source-path
   # Should show: /home/mjr/code/personal/dotfiles
   ```

2. Confirm current neovim works:
   ```bash
   NVIM_APPNAME=lace/config/nvim nvim --headless "+checkhealth" "+qa"
   ```

### Migration Verification

1. After copying files, verify chezmoi sees them:
   ```bash
   chezmoi managed | grep nvim
   # Should show:
   # .config/nvim
   # .config/nvim/init.lua
   # .config/nvim/lazy-lock.json
   # .config/nvim/lua
   # .config/nvim/lua/plugins
   # .config/nvim/lua/plugins/colorscheme.lua
   # ... etc
   ```

2. Dry-run apply:
   ```bash
   chezmoi apply -nv
   # Should show nvim files would be created/updated
   ```

3. Apply and test:
   ```bash
   chezmoi apply
   nvim --headless "+checkhealth" "+qa"
   # Should exit 0 with no errors
   ```

4. Test plugin installation:
   ```bash
   nvim --headless "+Lazy sync" "+qa"
   # Should install/update plugins
   ```

### Post-Cleanup Verification

1. Test lace wezterm config still loads plugin:
   ```bash
   WEZTERM_CONFIG_FILE=/var/home/mjr/code/weft/lace/config/wezterm/wezterm.lua \
     wezterm --config-only
   # Should show no errors
   ```

2. Test dotfiles wezterm config:
   ```bash
   wezterm --config-only
   # Should show no errors, plugin loads
   ```

## Implementation Phases

### Phase 1: Neovim Migration (10 min)

**Tasks:**
- Create `dotfiles/dot_config/nvim/` directory structure
- Copy all files from `lace/config/nvim/`
- Update header comments
- Verify with `chezmoi managed`
- Commit to dotfiles repo

**Success Criteria:**
- `chezmoi managed | grep nvim` shows all files
- `chezmoi apply -nv` shows files would be created

### Phase 2: Neovim Verification (5 min)

**Tasks:**
- Run `chezmoi apply`
- Test neovim launches without errors
- Test plugin installation works
- Test LSP attaches to a TypeScript file

**Success Criteria:**
- Neovim launches with solarized theme
- Telescope works (Ctrl+Space finds files)
- LSP provides completions in .ts files

### Phase 3: Lace Cleanup (10 min)

**Tasks:**
- Replace `lace/config/wezterm/wezterm.lua` with minimal demo
- Remove or archive `lace/config/nvim/`
- Update any documentation referencing these configs
- Commit to lace repo

**Success Criteria:**
- Lace wezterm.lua is <60 lines
- Lace config/nvim/ is removed
- `wezterm --config-only` works with lace config

### Phase 4: Documentation (5 min)

**Tasks:**
- Update dotfiles README with nvim config notes
- Update lace wezterm plugin README if needed
- Create handoff devlog

**Success Criteria:**
- Documentation is accurate
- Migration is fully documented

## Open Questions

1. **lazy-lock.json in git?**
   The lockfile should be committed for reproducibility. Should it be excluded from chezmoi's tracking to prevent conflicts when plugins update? (Recommendation: include it - manual conflicts are acceptable for the reproducibility benefit.)

2. **Platform-specific neovim config?**
   Currently none identified. If needed later, chezmoi templates can handle platform differences. (Recommendation: keep simple for now, template if needed.)

3. **Container neovim config?**
   When developing in devcontainers, neovim config comes from the host via chezmoi or is installed separately. Should the devcontainer feature install neovim and point to a mounted config? (Recommendation: out of scope for this proposal - handle in devcontainer feature work.)

## Appendix: File Listing

### Files to Copy (lace -> dotfiles)

```
config/nvim/init.lua                      -> dot_config/nvim/init.lua
config/nvim/lazy-lock.json                -> dot_config/nvim/lazy-lock.json
config/nvim/lua/plugins/colorscheme.lua   -> dot_config/nvim/lua/plugins/colorscheme.lua
config/nvim/lua/plugins/editor.lua        -> dot_config/nvim/lua/plugins/editor.lua
config/nvim/lua/plugins/git.lua           -> dot_config/nvim/lua/plugins/git.lua
config/nvim/lua/plugins/lsp.lua           -> dot_config/nvim/lua/plugins/lsp.lua
config/nvim/lua/plugins/telescope.lua     -> dot_config/nvim/lua/plugins/telescope.lua
config/nvim/lua/plugins/treesitter.lua    -> dot_config/nvim/lua/plugins/treesitter.lua
config/nvim/lua/plugins/ui.lua            -> dot_config/nvim/lua/plugins/ui.lua
```

### Files to Modify

```
lace/config/wezterm/wezterm.lua           -> Reduce to minimal plugin demo
```

### Files to Remove

```
lace/config/nvim/                         -> Remove after migration verified
```
