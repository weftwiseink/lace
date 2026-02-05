---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:45:00-08:00
task_list: lace/dotfiles-migration
type: report
state: live
status: done
tags: [status, wezterm, dotfiles, lace-plugins, workstream-audit, migration]
---

# Workstream Status Report: Dotfiles Migration, Lace Plugins, and WezTerm Plugin

> BLUF: The 2026-02-04 workstreams have made significant progress. The lace plugins system is fully implemented (254 tests passing). WezTerm plugin extraction and neovim config migration are complete. Dotfiles devcontainer (Phase 3) and chezmoi initialization (Phase 4) are done. Proposal evolution chains are properly tracked (multi-project evolved into port-scanning). Key remaining work: (1) move wezterm plugin to weftwiseink/lace.wezterm repo, and (2) implement port-scanning discovery for multi-project support. Minor status updates needed for `lace-plugins-system.md` and `wezterm-project-picker.md`.

## Workstream Status Summary

| Workstream | Status | Evidence |
|------------|--------|----------|
| Lace Plugins System | **COMPLETE** | 254 tests, `lace resolve-mounts` and `lace up` commands working |
| WezTerm Plugin Extraction | **COMPLETE** | `config/wezterm/lace-plugin/plugin/init.lua` created |
| Neovim Config Migration | **COMPLETE** | Moved to dotfiles repo, removed from lace (commits d8c32b2, 4c31ea9) |
| Dotfiles Devcontainer (Phase 3) | **COMPLETE** | devcontainer.json, bin/open-dotfiles-workspace, SSH keys |
| Chezmoi Initialization (Phase 4) | **COMPLETE** | dot_* files, run_once scripts, .chezmoiignore |
| WezTerm Plugin to Separate Repo | **PENDING** | Accepted proposal at `wezterm-plugin-proper-packaging.md` |
| Port-Scanning Multi-Project Discovery | **PENDING** | Accepted proposal supersedes registry-based approach |

## Proposal Status Audit

### Proposals Needing Status Updates

| Proposal | Current Status | Should Be | Action Needed |
|----------|---------------|-----------|---------------|
| `wezterm-project-picker.md` | `status: draft` | `status: accepted` | Already marked `last_reviewed.status: accepted` but top-level status inconsistent |
| `lace-plugins-system.md` | `status: implementation_wip` | `status: implementation_complete` | All phases verified complete per devlog |

### Correctly Marked Proposals

| Proposal | Status | Notes |
|----------|--------|-------|
| `dev-dependency-cross-project-mounts.md` | `superseded` | Correctly superseded by `lace-plugins-system.md` |
| `multi-project-wezterm-plugin.md` | `evolved` | Correctly marked with `evolved_into: port-scanning-wezterm-discovery.md` |
| `port-scanning-wezterm-discovery.md` | `review_ready` | Correctly marked, evolved from multi-project proposal |
| `dotfiles-migration-and-config-extraction.md` | `wip` | Appropriate - Phase 5/6 not complete |
| `wezterm-plugin-proper-packaging.md` | `accepted` | Pending implementation |

### Evolution Chain Verification

**Dev Dependencies -> Lace Plugins:**
- `dev-dependency-cross-project-mounts.md` -> `lace-plugins-system.md`
- Status: Correctly marked with `supersedes`/`superseded_by` frontmatter

**WezTerm Project Picker Evolution:**
- `wezterm-project-picker.md` (original RFP)
- -> `multi-project-wezterm-plugin.md` (registry-based implementation)
- -> `port-scanning-wezterm-discovery.md` (decoupled implementation)
- Status: **CORRECT** - `multi-project-wezterm-plugin.md` properly marked with `state: evolved` and `evolved_into:`

## Completed Work Evidence

### Lace Plugins System Implementation

**Devlog:** `cdocs/devlogs/2026-02-04-lace-plugins-system-implementation.md`

**Key Files Created:**
- `packages/lace/src/lib/settings.ts` - Settings file discovery and parsing
- `packages/lace/src/lib/plugin-clones.ts` - Shallow clone management
- `packages/lace/src/lib/mounts.ts` - Mount resolution and conflict validation
- `packages/lace/src/lib/resolve-mounts.ts` - Workflow orchestration
- `packages/lace/src/commands/resolve-mounts.ts` - CLI command
- `packages/lace/src/commands/up.ts` - Umbrella command

**Verification:**
```
Test Files  16 passed (16)
     Tests  254 passed (254)
```

**CLI Output:**
```
$ lace --help
COMMANDS
        prebuild    Pre-bake devcontainer features onto the base image
  resolve-mounts    Resolve plugin mounts from devcontainer.json and user settings
         restore    Undo the prebuild FROM rewrite
          status    Show current prebuild state
              up    Start a devcontainer with prebuild features and plugin mounts
```

### WezTerm Plugin Extraction

**Devlog:** `cdocs/devlogs/2026-02-04-wezterm-plugin-extraction.md`

**Key Files:**
- `config/wezterm/lace-plugin/plugin/init.lua` - Plugin entry point (243 lines)
- `config/wezterm/lace-plugin/README.md` - Documentation
- `config/wezterm/wezterm.lua` - Reduced to minimal demo (67 lines)

**Features Extracted:**
- SSH domain configuration
- Worktree picker event handler
- Status bar workspace display
- Helper functions (`M.get_picker_event()`, `M.connect_action()`)

### Neovim Config Migration

**Devlog:** `cdocs/devlogs/2026-02-04-nvim-wezterm-migration-to-dotfiles.md`

**Commits:**
- `d8c32b2` - Remove nvim config from lace (migrated to dotfiles)
- `4c31ea9` - Reduce wezterm.lua to minimal plugin demo
- `a0012d0` (dotfiles) - Add neovim config

**Dotfiles Location:** `dotfiles/dot_config/nvim/`

### Dotfiles Devcontainer (Phase 3)

**Devlog:** `cdocs/devlogs/2026-02-04-dotfiles-devcontainer-phase3.md`

**Key Files:**
- `dotfiles/.devcontainer/devcontainer.json` - Minimal config with wezterm-server
- `dotfiles/bin/open-dotfiles-workspace` - WezTerm connection script
- `~/.ssh/dotfiles_devcontainer` - SSH key pair

**Verification:**
- Container build: SUCCESS
- wezterm-mux-server: Running
- SSH access on port 2223: Working

### Chezmoi Initialization (Phase 4)

**Devlog:** `cdocs/devlogs/2026-02-04-chezmoi-initialization-phase4.md`

**Key Files:**
- `dotfiles/dot_bashrc`, `dot_blerc`, `dot_tmux.conf` - Core dotfiles
- `dotfiles/dot_config/starship.toml`, `dot_config/tridactyl/tridactylrc`
- `dotfiles/run_once_before_10-install-starship.sh`
- `dotfiles/run_once_before_20-install-blesh.sh`
- `dotfiles/run_once_after_10-install-tpm.sh`
- `dotfiles/.chezmoiignore` - Platform exclusions
- `~/.config/chezmoi/chezmoi.toml` - Source directory config

**Verification:**
```
$ chezmoi managed --exclude=scripts
.bashrc
.blerc
.config/starship.toml
.config/tridactyl/tridactylrc
.tmux.conf
```

## Pending Work

### 1. WezTerm Plugin to Separate Repository

**Proposal:** `cdocs/proposals/2026-02-04-wezterm-plugin-proper-packaging.md`
**Status:** Accepted, not yet implemented

**Tasks:**
1. Create `github.com/weftwiseink/lace.wezterm` repository
2. Copy `plugin/init.lua` from `config/wezterm/lace-plugin/`
3. Update dotfiles wezterm config to use GitHub URL
4. Remove `config/wezterm/lace-plugin/` from lace repo
5. Update documentation

**Rationale:** WezTerm's plugin system requires `plugin/init.lua` at repository root. A separate repo enables standard `wezterm.plugin.require('https://github.com/weftwiseink/lace.wezterm')` loading.

### 2. Port-Scanning Multi-Project Discovery

**Proposal:** `cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md`
**Status:** Accepted, not yet implemented

**Key Changes from Registry-Based Approach:**
- No central settings.json registry for projects
- Port range 22425-22499 (memorable: w=22, e=4, z=25)
- Docker CLI discovery at picker invocation time
- Uses `devcontainer.local_folder` Docker label for project identity

**Implementation Phases:**
1. Port assignment in `lace up`
2. Docker discovery function
3. WezTerm plugin with Docker discovery
4. CLI update (`wez-lace-into`)
5. End-to-end integration testing

### 3. Dotfiles Migration Remaining Phases

**Proposal:** `cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md`

Phases 1-4 complete. Remaining:
- Phase 5: Test chezmoi in devcontainer
- Phase 6: Documentation and cleanup

## Recommendations

### Immediate Actions

1. **Update `lace-plugins-system.md` status:**
   - Change `status: implementation_wip` to `status: implementation_complete`
   - All phases verified complete per devlog

2. **Reconcile `wezterm-project-picker.md` status:**
   - Change `status: draft` to `status: accepted`
   - Aligns with `last_reviewed.status: accepted`

### Next Implementation Priority

Based on dependency analysis:

1. **Port-Scanning Discovery** - Enables multi-project support without central registry
2. **WezTerm Plugin Repo Migration** - Enables portable plugin distribution
3. **Dotfiles Phase 5/6** - Lower priority, current state is functional

## Related Documents

### Proposals (2026-02-04)
- `dev-dependency-cross-project-mounts.md` - Superseded by lace-plugins-system
- `lace-plugins-system.md` - Implemented (status needs update to `implementation_complete`)
- `wezterm-project-picker.md` - Accepted (status needs update from `draft`)
- `multi-project-wezterm-plugin.md` - Evolved into port-scanning-wezterm-discovery
- `port-scanning-wezterm-discovery.md` - Accepted, pending implementation
- `wezterm-plugin-proper-packaging.md` - Accepted, pending implementation
- `dotfiles-migration-and-config-extraction.md` - WIP (Phases 1-4 complete)

### Devlogs (2026-02-04)
- `lace-plugins-system-implementation.md` - Complete
- `wezterm-plugin-extraction.md` - Complete
- `nvim-wezterm-migration-to-dotfiles.md` - Complete
- `dotfiles-devcontainer-phase3.md` - Complete
- `chezmoi-initialization-phase4.md` - Complete

### Reports (2026-02-04)
- `wezterm-plugin-research.md` - Background research
- `lace-plugins-design-decisions.md` - Design rationale
- `port-scanning-project-discovery-research.md` - Discovery mechanism research
