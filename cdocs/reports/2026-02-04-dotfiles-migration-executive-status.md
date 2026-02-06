---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T13:10:00-08:00
task_list: lace/dotfiles-migration
type: report
state: archived
status: done
tags: [status, dotfiles, chezmoi, devcontainer, plugins, executive-summary]
---

# Executive Status Report: Dotfiles Migration & Lace Plugins System

> BLUF: The dotfiles migration initiative is substantially complete, with core infrastructure (devcontainer, chezmoi) implemented and committed. A parallel effort to evolve the dev-dependency system into a comprehensive lace plugins architecture was completed with full proposal approval. The wezterm plugin extraction and personal config migration (Phases 5-6) are deferred pending future plugin implementation. Total commits: 3 across 2 repositories.

## Workstreams Completed

### 1. Lace Plugins System Evolution

**Status:** Approved and ready for implementation

The original dev-dependency cross-project mounts proposal was evolved into a full-fledged lace plugins system per user direction. Key architectural changes:

| Aspect | Original Proposal | Evolved Plugins System |
|--------|-------------------|------------------------|
| Terminology | `devDependencies` | `plugins` |
| Config location | `~/.config/lace/repos.json` | `~/.config/lace/settings.json` |
| Mount namespace | `/mnt/lace/local/dependencies/` | `/mnt/lace/plugins/` |
| Missing deps | Warning | Error (ensures consistency) |
| Path mirroring | `mirrorPath: true` | Target override + symlink bridging |
| CLI command | `lace resolve-deps` | `lace resolve-mounts` |
| Clone management | Not specified | Shallow clones to `~/.config/lace/$project/plugins/` |

**Deliverables:**
- `cdocs/proposals/2026-02-04-lace-plugins-system.md` - Comprehensive proposal (approved after 2 review rounds)
- `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md` - Future `when` field RFP
- `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md` - Host-side setup RFP
- `cdocs/reports/2026-02-04-lace-plugins-design-decisions.md` - Design rationale
- Original proposal marked superseded

### 2. Dotfiles Devcontainer (Phase 3)

**Status:** Accepted

Created a minimal devcontainer in the dotfiles repository for safe iteration:

**Files Created:**
- `.devcontainer/devcontainer.json` - Minimal config with wezterm-server feature
- `bin/open-dotfiles-workspace` - Full-featured connection script adapted from lace

**Configuration:**
- Base image: `mcr.microsoft.com/devcontainers/base:ubuntu`
- SSH port: 2223 (avoids conflict with lace on 2222)
- Features: git, sshd, wezterm-server
- SSH key: `~/.ssh/dotfiles_devcontainer` (separate from lace)

**Verification:**
- Container build: SUCCESS
- Container start: SUCCESS
- wezterm-mux-server running: SUCCESS
- SSH access: SUCCESS

**Commit:** `feat(devcontainer): add minimal devcontainer with wezterm-server`

### 3. Chezmoi Initialization (Phase 4)

**Status:** Review-ready

Migrated from symlink-based `setup.sh` to chezmoi-managed dotfiles:

**Files Created:**
- `dot_bashrc`, `dot_blerc`, `dot_tmux.conf` - Shell configs
- `dot_config/starship.toml`, `dot_config/tridactyl/tridactylrc` - App configs
- `run_once_before_10-install-starship.sh` - Starship installer
- `run_once_before_20-install-blesh.sh` - ble.sh installer
- `run_once_after_10-install-tpm.sh` - TPM installer
- `.chezmoiignore` - Excludes legacy directories
- `~/.config/chezmoi/chezmoi.toml` - Points sourceDir to dotfiles repo

**Key Decisions:**
- Kept legacy `bash/` directory for bashrc source dependencies
- Scripts placed at source root (not `.chezmoiscripts/`)
- Archived `setup.sh` → `setup.sh.archive`

**Commit:** `a494605 feat(chezmoi): initialize chezmoi-based dotfile management`

### 4. Dotfiles Proposal Amendment

**Status:** Complete

Updated the dotfiles-migration-and-config-extraction proposal to align with the evolved plugins system:
- Changed `devDependencies` → `plugins` terminology
- Updated mount paths to `/mnt/lace/plugins/`
- Updated `lace resolve-deps` → `lace resolve-mounts` references
- Noted plugin phases (1-2) deferred to followup

## Deferred Work

The following items were intentionally deferred per user direction (leaving plugin bit for followup):

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1-2 | Wezterm lace-plugin extraction | Deferred - requires plugin system implementation |
| Phase 5 | Personal config migration (nvim, wezterm) | Partially deferred - wezterm depends on plugin |
| Phase 6 | Plugin documentation and cleanup | Deferred - depends on Phase 1-2 |

## Issues Encountered

### 1. Non-Existent Reference URL
The evolution review referenced `https://github.com/imbue-ai/command-on-key-when` for the `when` field RFP. This URL returned 404. Resolved by referencing VS Code's when-clause contexts documentation instead.

### 2. Chezmoi Script Placement
Initial implementation placed scripts in `.chezmoiscripts/` per the proposal example. This was incorrect - chezmoi expects `run_once_*` scripts at the source root. Documented in devlog as a lesson learned.

### 3. Bashrc Source Dependencies
The existing bashrc sources files from `$DOTFILES_DIR/bash/`. Converting to fully self-contained chezmoi templates was deemed out of scope for Phase 4. The legacy directories are kept but excluded from chezmoi management via `.chezmoiignore`.

## Artifacts Summary

### Lace Repository (`/var/home/mjr/code/weft/lace/`)

| Document | Type | Status |
|----------|------|--------|
| `cdocs/proposals/2026-02-04-lace-plugins-system.md` | Proposal | Approved |
| `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md` | RFP | Stub |
| `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md` | RFP | Stub |
| `cdocs/proposals/2026-02-04-dev-dependency-cross-project-mounts.md` | Proposal | Superseded |
| `cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md` | Proposal | Amended |
| `cdocs/reports/2026-02-04-lace-plugins-design-decisions.md` | Report | Done |
| `cdocs/reviews/2026-02-04-review-of-lace-plugins-system.md` | Review | R1 Revise |
| `cdocs/reviews/2026-02-04-r2-review-of-lace-plugins-system.md` | Review | R2 Approve |
| `cdocs/reviews/2026-02-04-review-of-dotfiles-devcontainer-phase3.md` | Review | Accept |
| `cdocs/devlogs/2026-02-04-dotfiles-devcontainer-phase3.md` | Devlog | Review-ready |
| `cdocs/devlogs/2026-02-04-chezmoi-initialization-phase4.md` | Devlog | Review-ready |

### Dotfiles Repository (`/home/mjr/code/personal/dotfiles/`)

| Change | Type | Commit |
|--------|------|--------|
| `.devcontainer/devcontainer.json` | New | Phase 3 |
| `bin/open-dotfiles-workspace` | New | Phase 3 |
| `dot_bashrc`, `dot_blerc`, `dot_tmux.conf` | New | Phase 4 |
| `dot_config/starship.toml`, `dot_config/tridactyl/tridactylrc` | New | Phase 4 |
| `run_once_*.sh` (3 scripts) | New | Phase 4 |
| `.chezmoiignore` | New | Phase 4 |
| `setup.sh` → `setup.sh.archive` | Renamed | Phase 4 |

## Recommendations

1. **Proceed with lace plugins implementation** - The proposal is approved and provides a clear path for the shared dev resources use case.

2. **Test chezmoi apply on fresh system** - Phase 4 is verified via `chezmoi status` and `chezmoi diff`, but a full `chezmoi apply` test on a clean container would validate the run_once scripts.

3. **Defer Phase 5-6 until plugins exist** - The wezterm plugin extraction and personal config migration should wait for the lace plugins system to be implemented.

4. **Consider WezTerm domain config** - The dotfiles devcontainer works but requires manual WezTerm SSH domain configuration. This will be addressed naturally when the plugin system enables automatic domain setup.
