---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T16:00:00-08:00
task_list: lace/dotfiles-migration
type: report
state: evolved
status: superseded
superseded_by: cdocs/reports/2026-02-05-dotfiles-modernization-project-assessment.md
tags: [status, dotfiles, executive-summary, nushell, wezterm, archive, launcher, migration, sequencing]
synthesizes:
  - cdocs/proposals/2026-02-05-dotfiles-bin-launcher-migration.md
  - cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
  - cdocs/proposals/2026-02-05-dotfiles-nushell-setup.md
  - cdocs/reviews/2026-02-05-review-of-dotfiles-bin-launcher-migration.md
  - cdocs/reviews/2026-02-05-review-of-dotfiles-legacy-archive-migration.md
  - cdocs/reviews/2026-02-05-review-of-dotfiles-nushell-setup.md
---

# Dotfiles Modernization: Executive Summary & Implementation Plan

> BLUF: Three proposals plus one investigation report chart a path from a cluttered, partially-broken dotfiles repo to a focused modern stack (wezterm + nvim + nushell). All three proposals have passed review with revisions applied. The recommended implementation order is: (1) legacy archive migration first (cleans the workspace), (2) bin launcher deduplication second (eliminates fork maintenance), (3) nushell setup third (adds the new shell on a clean foundation). Two P0 wezterm fixes from the investigation have already been applied. Total estimated effort across all proposals is 10 phases, completable in roughly 3 focused sessions, with 4 phases executable in parallel.

## Context / Background

The dotfiles repository (`/home/mjr/code/personal/dotfiles/`) has accumulated configuration for multiple generations of tooling: bash/ble.sh, tmux, VSCode, Firefox CSS, macOS utilities, btrfs backup scripts, and more. A recent migration to chezmoi management (Phase 3-4 of the parent dotfiles migration proposal) established the modern config infrastructure but left legacy files in place alongside their chezmoi equivalents.

Simultaneously, commit `1617aab` migrated the wezterm plugin to a separate `lace.wezterm` repository but left stale references in both the personal wezterm config and the `open-lace-workspace` launcher script, causing two P0 breakages.

This report synthesizes four deliverables that together define the complete modernization path:

1. **Wezterm Investigation Report** -- diagnosed and fixed two P0 issues (plugin path, stale WEZTERM_CONFIG_FILE override), both already applied
2. **Bin Launcher Migration Proposal** -- deduplicates the 374-line `open-*-workspace` scripts into a generic parameterized launcher
3. **Legacy Archive Migration Proposal** -- moves all pre-chezmoi config files to `archive/legacy/`, handling live symlinks and bashrc source paths
4. **Nushell Setup Proposal** -- introduces nushell as a secondary interactive shell with full comfort parity to the bash/ble.sh stack

## Current State Assessment

### What Works

- **Neovim**: Fully migrated to chezmoi at `dot_config/nvim/`, deployed to `~/.config/nvim/`
- **WezTerm**: Config at `dot_config/wezterm/wezterm.lua`, chezmoi-managed (P0 fixes applied)
- **Chezmoi**: Initialized with `dot_bashrc`, `dot_blerc`, `dot_tmux.conf`, `dot_config/starship.toml`, `dot_config/tridactyl/tridactylrc`
- **Lace devcontainer**: Functional with `open-lace-workspace`
- **Dotfiles devcontainer**: Functional with `open-dotfiles-workspace` (separate SSH port 2223)
- **lace.wezterm plugin**: Extracted to separate repo, packaged correctly

### What Is Broken or Stale

| Item | Status | Resolution |
|------|--------|------------|
| Plugin path in personal wezterm.lua | **Fixed (P0)** | Updated to `lace.wezterm` repo path |
| `WEZTERM_CONFIG_FILE` override in `open-lace-workspace` | **Fixed (P0)** | Removed stale reference to deleted config |
| Plugin API mismatch in wezterm.lua | **P1 -- not yet fixed** | Lace plugin section (lines 105-179) needs rewrite for new API |
| `wezterm connect lace` static domain | **P1 -- not yet fixed** | New plugin uses port-range discovery, not static domain names |

### What Is Legacy (To Be Archived or Replaced)

- `bash/`, `vscode/`, `tmux.conf`, `tridactyl/`, `firefox/`, `macos/`, `blackbox/`, `btrfs/`, `init.vim` -- all at repo root, duplicating chezmoi-managed equivalents
- Three `run_once_*` scripts at repo root -- already executed, tracked in chezmoi scriptState
- 374-line `open-dotfiles-workspace` script -- near-verbatim fork of `open-lace-workspace`
- Three live system symlinks pointing into legacy directories (2 VSCode, 1 Firefox)

### Target State

A focused dotfiles repo with:
- **Chezmoi-managed**: `dot_bashrc`, `dot_blerc`, `dot_tmux.conf`, `dot_config/` (nvim, wezterm, starship, tridactyl, nushell)
- **Archive**: All legacy files under `archive/legacy/` with preserved git history
- **Bin**: Thin wrapper `open-dotfiles-workspace` delegating to lace's generic `open-workspace`
- **Shell**: Nushell available as opt-in interactive shell alongside bash

## Cross-Proposal Dependencies and Sequencing

### Dependency Map

```
Wezterm Investigation (DONE)
  |
  v
Bin Launcher Migration -----> depends on lace repo (open-workspace lives there)
  |                           no dependency on archive or nushell
  v
[independent]

Legacy Archive Migration ----> must update dot_bashrc source paths
  |                            must handle live symlinks before file deletion
  |                            no dependency on launcher or nushell
  v
[independent]

Nushell Setup --------------> depends on dotfiles repo being in a clean state (nice-to-have)
  |                            depends on chezmoi being functional (already true)
  |                            no hard dependency on archive or launcher
  v
[independent]
```

The three proposals are **structurally independent** -- none blocks the other. However, there is a strong **sequencing preference** based on risk reduction and workspace cleanliness.

### Shared Assumptions

All three proposals assume:
1. Chezmoi is the dotfile management tool going forward (established by parent proposal)
2. The dotfiles repo is at `/home/mjr/code/personal/dotfiles/` and lace is at `~/code/weft/lace/`
3. Bash remains the default login shell throughout (nushell is opt-in)
4. The user has both lace and dotfiles repos checked out on the host

### Tensions Between Proposals

1. **Bashrc path changes vs. nushell timeline**: The archive proposal re-routes `dot_bashrc` to source from `archive/legacy/bash/`. If nushell becomes the primary shell soon, these sourced bash files become irrelevant. However, the archive proposal explicitly frames this as an intermediate state, deferring inlining to the nushell migration timeline. This is the right call -- do not let the future shell choice delay cleaning up the repo.

2. **Launcher deduplication vs. port-range migration**: The launcher proposal works within the current fixed-port model (ports 2222/2223). The lace.wezterm plugin is moving toward Docker-based port-range discovery (22425-22499). The generic `open-workspace` script will eventually need updating for the port-range model, but the proposal correctly avoids coupling to unfinished infrastructure. When port-range is ready, one script gets updated instead of two.

3. **Archive depth vs. cleanup scope**: The archive proposal moves files to `archive/legacy/` but does not delete them from history or slim the repo. The nushell proposal adds new files. The net repo size grows before it shrinks. This is acceptable -- git history preservation is more valuable than repo size.

## Recommended Implementation Order

### Step 1: Legacy Archive Migration (Phases 0-6)

**Why first:** This cleans the workspace. Having legacy files at the repo root creates confusion about what is active vs. archived. The archive migration is entirely within the dotfiles repo and has no external dependencies. It also resolves the "bashrc sources from legacy paths" problem, which is a latent risk if any legacy file is accidentally modified.

| Phase | Description | Effort | Risk |
|-------|-------------|--------|------|
| Phase 0 | Pre-flight snapshot and backup | S | None |
| Phase 1 | Create archive structure, copy files | S | None (originals preserved) |
| Phase 2 | Update dot_bashrc source paths, chezmoi apply | S | **Medium** -- shell breaks if paths wrong |
| Phase 3 | De-link VSCode symlinks (copy to regular files) | S | Low |
| Phase 4 | Update Firefox symlink to archive path | S | Low |
| Phase 5 | Delete original legacy files | S | Low (copies verified in Phase 1) |
| Phase 6 | Update .chezmoiignore, single atomic commit | S | None |

**Critical path item:** Phase 2 (bashrc path update) is the highest-risk moment. The copy-before-delete strategy (Phase 1 copies, Phase 5 deletes) provides a safety net. Rollback is a simple `git checkout -- . && chezmoi apply` plus manual symlink restoration.

**Estimated time:** 1 focused session (30-60 minutes for all 7 phases).

### Step 2: Bin Launcher Migration (Phases 1-3)

**Why second:** With the archive migration done, the dotfiles repo is clean. The launcher migration spans both the lace repo (generic script) and the dotfiles repo (thin wrapper + config). Doing this after the archive means the dotfiles-side changes land in a clean repo.

| Phase | Description | Effort | Repo |
|-------|-------------|--------|------|
| Phase 1 | Create generic `open-workspace` + lace wrapper | M | lace |
| Phase 2 | Create `.lace/workspace.conf` + dotfiles wrapper | S | dotfiles |
| Phase 3 | Documentation and adoption template | S | lace |

**Critical path item:** Phase 1 requires careful parameterization of the 374-line script. The REPO_ROOT resolution logic (when invoked cross-project via `LACE_WORKSPACE_CONF`) needs thorough testing with both lace and dotfiles invocations.

**Estimated time:** 1 focused session (45-90 minutes for all 3 phases).

### Step 3: Nushell Setup (Phases 1-3)

**Why third:** Nushell is entirely additive -- it creates new files under `dot_config/nushell/` and installs new software. It does not modify any existing configuration. Placing it last means it builds on a clean, well-organized repo. Phase 3 (nushell-native enhancements) is open-ended and can continue indefinitely.

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|-------------|
| Phase 1 | Minimal viable config (env.nu, config.nu, stubs) | M | nushell + starship installed |
| Phase 2 | Full comfort parity (colors, completions, hooks, utils) | L | carapace installed (optional) |
| Phase 3 | Nushell-native enhancements | L (ongoing) | Daily usage experience |

**Critical path item:** Phase 1 requires nushell to be installed (`cargo install nu --locked` or package manager). Phase 2 benefits from carapace (`go install github.com/carapace-sh/carapace-bin@latest`). Neither is currently installed.

**Estimated time:** Phase 1: 30-60 minutes. Phase 2: 1-2 hours. Phase 3: ongoing over days/weeks.

### Parallelism Opportunities

The following phases from different proposals can run in parallel because they modify non-overlapping files in different repos:

| Parallel Group | Phases | Constraint |
|----------------|--------|------------|
| Group A | Archive Phase 0-1 + Launcher Phase 1 | Different repos, no overlap |
| Group B | Archive Phase 3-4 (symlinks) + Nushell Phase 1 | Symlinks are system-side; nushell is repo-side |
| Group C | Launcher Phase 3 (docs) + Nushell Phase 2 | Documentation vs. config files |

However, the sequential approach is recommended for clarity and easier debugging. The total effort is small enough that parallelism saves minimal calendar time while increasing cognitive load.

## Risk Summary

### High Risk

| Risk | Source | Impact | Mitigation |
|------|--------|--------|------------|
| Shell breaks during bashrc re-routing | Archive Phase 2 | Every new terminal fails to load | Copy-before-delete strategy; backup at Phase 0; `cp /tmp/dotfiles-migration-backup/.bashrc ~/.bashrc` for immediate rollback |
| Nushell `overlay use` parse-time constraint | Nushell hooks.nu | Auto-venv activation fails | Review-identified fix: use string-based `code:` field pattern (already applied to proposal) |
| Keybindings overwrite (nushell) | Nushell keybindings.nu | All default nushell keybindings lost | Review-identified fix: use `++=` instead of `=` (already applied to proposal) |

### Medium Risk

| Risk | Source | Impact | Mitigation |
|------|--------|--------|------------|
| REPO_ROOT points to wrong project in cross-project invocation | Launcher Phase 1 | `devcontainer up` targets wrong workspace | LACE_WORKSPACE_CONF + CONF_DIR derivation logic (review blocking item -- addressed in revision) |
| Nushell breaking changes between versions | Nushell all phases | Config stops working after `cargo install nu` upgrade | Pin version or check release notes; note added to proposal |
| Carapace not available | Nushell Phase 2 | No external command completions | Graceful degradation: completer returns null, built-in file completion remains |

### Low Risk

| Risk | Source | Impact | Mitigation |
|------|--------|--------|------------|
| Lace checkout not found by dotfiles wrapper | Launcher Phase 2 | `open-dotfiles-workspace` fails with clear error | Error message instructs user to set LACE_ROOT |
| Firefox profile path changes | Archive Phase 4 | Symlink becomes stale | Pre-existing issue, documented in left-behind report |
| Chezmoi scriptState stale entries | Archive Phase 5 | Harmless DB entries | `chezmoi state delete-bucket --bucket=scriptState` to clean |
| Config file overrides script internals | Launcher Phase 1 | Unexpected behavior | Source config before internal state; document allowed variables |

### Review-Identified Issues (All Resolved in Revisions)

All three proposals underwent self-review. Blocking issues were identified and revisions applied:

| Proposal | Blocking Issues Found | Status |
|----------|----------------------|--------|
| Bin Launcher | 2: incomplete difference accounting; missing REPO_ROOT resolution logic | Revisions applied |
| Legacy Archive | 1: inaccurate chezmoi run_once handling claim | Revisions applied |
| Nushell Setup | 3: overlay use parse-time error; keybindings overwrite; completions partial overwrite | Revisions applied |

## Left Behind: Items Needing Future Attention

### Wezterm P1 Issues (From Investigation Report)

These were identified but not yet resolved:

1. **Plugin API mismatch in wezterm.lua (lines 105-179)**: The personal wezterm config still calls methods that do not exist in the new lace.wezterm plugin API (`connect_action`, wrong `apply_to_config` options, wrong `get_picker_event` signature). The entire lace plugin section needs rewriting. This is in the **dotfiles repo**, not lace.

2. **`wezterm connect lace` static domain model**: The `open-lace-workspace` script uses `wezterm connect lace` (line 352), but the new plugin uses port-based domain names (`lace:<port>`). The connection logic may need updating for the new discovery model.

### Bash Stack Retirement (Future)

When nushell becomes the primary shell, the following become candidates for removal:

| Item | Current State | Cleanup Action |
|------|--------------|----------------|
| `dot_bashrc` | Chezmoi-managed, sources from archive | Keep as fallback or remove |
| `dot_blerc` | Chezmoi-managed | Remove when bash is secondary |
| `dot_tmux.conf` | Chezmoi-managed | Remove if wezterm replaces tmux |
| `dot_config/starship.toml` | Shared with nushell | Keep (both shells use it) |
| `~/.local/share/blesh/` | Installed by run_once script | `rm -rf ~/.local/share/blesh` |
| `~/.tmux/plugins/` | Installed by run_once script + TPM | `rm -rf ~/.tmux/plugins` |
| `/usr/bin/starship` | System package | Keep (nushell uses it too) |
| `~/.full_history` | Written by bash PROMPT_COMMAND | Keep or merge with nushell history |

### Dotfiles Repo Orphans

| File | Notes |
|------|-------|
| `~/.vscode/shell.sh` | Copy (not link), functional; remove when retiring VSCode |
| `~/.config/Code/User/*.json` | Will be converted from symlinks to copies; edit directly or remove |
| `~/.mozilla/firefox/.../chrome` | Symlink updated to point into archive; remove when retiring Firefox CSS |

## Open Questions Requiring User Input

1. **Nushell as default shell -- when?** All three proposals keep bash as default. The nushell proposal defers this decision to "after Phase 2 is comfortable." There is no prescribed timeline. The user should evaluate after daily-driving nushell for a week or two.

2. **Bash/dot_bashrc pnpm divergence:** The legacy `bash/bashrc` has a pnpm PATH block that `dot_bashrc` lacks. Should `dot_bashrc` incorporate it before archival, or is the omission intentional?

3. **Should `.lace/workspace.conf` be committed in dotfiles?** The launcher proposal recommends committing it (project config, not secret). However, SSH key paths may differ per machine. The user should decide whether to commit or gitignore.

4. **Wezterm plugin section rewrite (P1):** The investigation report provides a minimal correct version. Should this be done as part of these three proposals, or tracked separately? It is currently unscheduled.

5. **Nushell in devcontainers:** Should lace devcontainer features include nushell as an option? Deferred to a separate proposal, but relevant for the user who iterates on config inside containers.

6. **Reedline vi-mode adequacy:** Is reedline's vi-mode sufficient for daily use? No visual mode, limited text objects, no register support. Only answerable through real usage.

## Effort Estimates

### By Proposal

| Proposal | Phases | Total Effort | Calendar Estimate |
|----------|--------|-------------|-------------------|
| Legacy Archive Migration | 7 (Phases 0-6) | **S-M** | 30-60 min |
| Bin Launcher Migration | 3 | **M** | 45-90 min |
| Nushell Setup (Phase 1-2) | 2 | **M-L** | 1.5-3 hours |
| Nushell Setup (Phase 3) | 1 (ongoing) | **L** | Days/weeks |
| **Total (through Nushell Phase 2)** | **12** | **M-L** | **~3-5 hours** |

### By Phase (Detailed)

| # | Phase | Effort | Risk | Parallelizable? |
|---|-------|--------|------|----------------|
| 1 | Archive Phase 0: Pre-flight snapshot | S | None | -- |
| 2 | Archive Phase 1: Copy to archive structure | S | None | Yes (with Launcher P1) |
| 3 | Archive Phase 2: Update bashrc paths + apply | S | **Medium** | No (depends on P1) |
| 4 | Archive Phase 3: De-link VSCode symlinks | S | Low | Yes (with Nushell P1) |
| 5 | Archive Phase 4: Update Firefox symlink | S | Low | Yes |
| 6 | Archive Phase 5: Delete originals | S | Low | No (depends on P2-P4) |
| 7 | Archive Phase 6: Update .chezmoiignore, commit | S | None | No (depends on P5) |
| 8 | Launcher Phase 1: Generic open-workspace | M | Medium | Yes (with Archive P0-P1) |
| 9 | Launcher Phase 2: Dotfiles wrapper + conf | S | Low | No (depends on L-P1) |
| 10 | Launcher Phase 3: Documentation | S | None | Yes (with anything) |
| 11 | Nushell Phase 1: Minimal viable config | M | Low | Yes (with Archive P3-P4) |
| 12 | Nushell Phase 2: Full comfort parity | L | Medium | No (depends on N-P1) |

## Recommendations

1. **Execute in the recommended order (Archive, Launcher, Nushell).** The proposals are independent, but this sequence provides the cleanest progression: clean the workspace, deduplicate the tooling, then add the new shell.

2. **Do not parallelize across proposals unless under time pressure.** The total effort is small enough (3-5 hours) that sequential execution is clearer and easier to debug. Parallelism saves perhaps 30 minutes while increasing cognitive overhead.

3. **Address the wezterm P1 issues separately.** The plugin API mismatch in the personal wezterm.lua is a real usability issue (broken keybindings, unrecognized config options) but is orthogonal to these three proposals. Track it as its own task.

4. **Install nushell and carapace before starting Nushell Phase 1.** These are prerequisites that can be done at any time: `cargo install nu --locked` and `go install github.com/carapace-sh/carapace-bin@latest`.

5. **Commit the archive migration as one atomic commit.** Phase 6 of the archive proposal specifies this. The commit captures file copies, bashrc path edits, original file deletions, and .chezmoiignore updates. System-side operations (symlink changes) are prerequisites but not version-controlled.

6. **Revisit the bash retirement question after 2 weeks of nushell daily use.** There is no urgency to remove bash. The archive migration preserves all bash infrastructure in a functional state. The nushell setup is designed to coexist indefinitely.
