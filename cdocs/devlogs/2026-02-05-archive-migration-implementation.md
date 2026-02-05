---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:00:00-08:00
task_list: lace/dotfiles-migration
type: devlog
state: live
status: wip
tags: [implementation, archive, dotfiles, migration]
---

# Archive Migration Implementation

## Objective

Implement the legacy archive migration as specified in `cdocs/proposals/2026-02-05-dotfiles-legacy-archive-clean.md`. Move `bash/`, `vscode/`, `blackbox/`, `tmux.conf`, `init.vim`, and chezmoi run_once scripts for blesh/tpm from the dotfiles repo root into `archive/legacy/`, update `dot_bashrc` source paths, and materialize VSCode symlinks.

## Plan

1. **Phase 1: Pre-flight** -- Verify repo state, create backup branch, verify shell, check VSCode symlinks
2. **Phase 2: Copy Legacy Files to Archive** -- Create `archive/legacy/` structure, copy all files, verify with diff
3. **Phase 3: Reroute dot_bashrc Source Paths** -- Update 3 paths in `dot_bashrc`, deploy to `~/.bashrc`, verify
4. **Phase 4: Materialize VSCode Symlinks** -- Replace symlinks with regular file copies (if they exist)
5. **Phase 5: Delete Originals and Commit** -- `git rm` originals, stage archive, commit
6. **Phase 6: Post-flight Verification** -- Verify clean tree, shell works, starship present, legacy gone, out-of-scope untouched

## Implementation Notes

### Phase 1: Pre-flight

- Repo was on branch `weztime` with 2 pre-existing uncommitted changes (archive rename and wezterm.lua plugin path fix). Both left untouched.
- Created backup branch `pre-legacy-archive-backup` at the pre-migration state.
- Shell verification confirmed `BASHFILES_DIR=/home/mjr/code/personal/dotfiles/bash` (pre-migration path).
- VSCode symlinks found intact:
  - `~/.config/Code/User/keybindings.json` -> `/var/home/mjr/code/personal/dotfiles/vscode/keybindings.jsonc`
  - `~/.config/Code/User/settings.json` -> `/var/home/mjr/code/personal/dotfiles/vscode/settings.jsonc`

### Phase 2: Copy Legacy Files to Archive

Created `archive/legacy/{bash,vscode,blackbox,chezmoi_run_once}` directory structure. Copied all legacy files with `cp -a` to preserve permissions and timestamps. Verified all copies with `diff -r` -- all 7 comparisons passed:

```
bash: OK
vscode: OK
blackbox: OK
tmux: OK
init.vim: OK
blesh: OK
tpm: OK
```

Committed as `2ef5d95` ("archive: copy legacy files to archive/legacy/ (Phase 2)") -- 20 new files, 3199 insertions.

### Phase 3: Reroute dot_bashrc Source Paths

Three path changes made in `dot_bashrc`:

1. Line 18: `BASHFILES_DIR` changed from `$DOTFILES_DIR/bash` to `$DOTFILES_DIR/archive/legacy/bash`
2. Line 108: vscode source changed from `$DOTFILES_DIR/vscode/init.sh` to `$DOTFILES_DIR/archive/legacy/vscode/init.sh`
3. Line 112: blackbox source changed from `$DOTFILES_DIR/blackbox/blackbox.sh` to `$DOTFILES_DIR/archive/legacy/blackbox/blackbox.sh`

Deployed to `~/.bashrc` via `cp dot_bashrc ~/.bashrc`. Verified in subshell:
```
BASHFILES_DIR=/home/mjr/code/personal/dotfiles/archive/legacy/bash
```

Shell loaded successfully with all sourced files found at new paths.

### Phase 4: Materialize VSCode Symlinks

Both symlinks existed and pointed to valid targets. Materialized with `cp --remove-destination`:
- `~/.config/Code/User/keybindings.json` -- now a regular file (was symlink to `vscode/keybindings.jsonc`)
- `~/.config/Code/User/settings.json` -- now a regular file (was symlink to `vscode/settings.jsonc`)

Verification confirmed both are regular files (not symlinks).

### Phase 5: Delete Originals and Commit

Removed originals via `git rm`:
- `git rm -rf bash/` (7 files)
- `git rm -rf vscode/` (5 files)
- `git rm -rf blackbox/` (4 files)
- `git rm -f tmux.conf`
- `git rm -f init.vim`
- `git rm -f run_once_before_20-install-blesh.sh`
- `git rm -f run_once_after_10-install-tpm.sh`

Staged `dot_bashrc` (the only modified file). Committed as `a61ba74` ("archive: move legacy bash/tmux/vscode/blackbox to archive/legacy/") -- 21 files changed, 3 insertions, 3202 deletions.

### Phase 6: Post-flight Verification

All checks passed. See Verification section below.

## Changes Made

| File/Dir | Action | Notes |
|----------|--------|-------|
| `archive/legacy/bash/` | Created | 7 files: aesthetics.sh, bashrc, blerc, completions.sh, prompt_and_history.sh, starship.toml, utils.sh |
| `archive/legacy/vscode/` | Created | 5 files: init.sh, keybindings.jsonc, settings.jsonc, shell.sh, _unused_settings.jsonc |
| `archive/legacy/blackbox/` | Created | 4 files: blackbox.sh, setup.sh, backup_exclude.txt, backup.sh |
| `archive/legacy/tmux.conf` | Created | Copy of root tmux.conf |
| `archive/legacy/init.vim` | Created | Copy of root init.vim |
| `archive/legacy/chezmoi_run_once/` | Created | 2 files: run_once_before_20-install-blesh.sh, run_once_after_10-install-tpm.sh |
| `bash/` | Deleted | git rm -rf (7 files) |
| `vscode/` | Deleted | git rm -rf (5 files) |
| `blackbox/` | Deleted | git rm -rf (4 files) |
| `tmux.conf` | Deleted | git rm |
| `init.vim` | Deleted | git rm |
| `run_once_before_20-install-blesh.sh` | Deleted | git rm |
| `run_once_after_10-install-tpm.sh` | Deleted | git rm |
| `dot_bashrc` | Modified | 3 path changes: BASHFILES_DIR, vscode/init.sh, blackbox/blackbox.sh |
| `~/.bashrc` | Deployed | Manual copy of dot_bashrc |
| `~/.config/Code/User/keybindings.json` | Materialized | Was symlink, now regular file |
| `~/.config/Code/User/settings.json` | Materialized | Was symlink, now regular file |

## Verification

### git status (clean except pre-existing changes)

```
On branch weztime
Your branch is ahead of 'origin/weztime' by 2 commits.

Changes not staged for commit:
	deleted:    archive/setup.sh.archive
	modified:   dot_config/wezterm/wezterm.lua

Untracked files:
	archive/setup.sh
```

Only pre-existing uncommitted changes remain -- the archive migration itself is fully committed.

### Shell works

```
BASHFILES_DIR=/home/mjr/code/personal/dotfiles/archive/legacy/bash starship=/usr/bin/starship
```

### Starship config present

```
starship config: present
starship run_once: present
```

### Legacy dirs removed from root

```
bash: removed OK
vscode: removed OK
blackbox: removed OK
```

### Out-of-scope dirs untouched

```
firefox: still present OK
tridactyl: still present OK
btrfs: still present OK
macos: still present OK
```

### VSCode configs materialized

```
keybindings: regular file OK
settings: regular file OK
```

## Commits

| Hash | Message | Files |
|------|---------|-------|
| `2ef5d95` | archive: copy legacy files to archive/legacy/ (Phase 2) | 20 new files |
| `a61ba74` | archive: move legacy bash/tmux/vscode/blackbox to archive/legacy/ | 21 files changed |
