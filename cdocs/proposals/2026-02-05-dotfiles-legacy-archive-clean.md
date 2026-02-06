---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:55:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: archived
status: accepted
tags: [dotfiles, migration, archive, bash, tmux, vscode, blackbox, legacy, chezmoi]
supersedes: cdocs/proposals/2026-02-05-dotfiles-legacy-archive-migration.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-06T00:10:00-08:00
  round: 1
---

# Dotfiles Legacy Archive Migration (Clean Rewrite)

> BLUF: Move legacy bash/tmux/vscode/blackbox configuration files from the dotfiles repo root into `archive/legacy/`, update `dot_bashrc` source paths to point at the archive, and materialize the two VSCode symlinks into regular files. This is a repo-level file reorganization -- no chezmoi commands are run as part of this migration.

## Objective

Clear the dotfiles repo (`/home/mjr/code/personal/dotfiles/`) of legacy configuration by moving it to `archive/legacy/`, leaving the repo root clean for modern configs (nushell, neovim, wezterm) managed via chezmoi.

## Background

The dotfiles repo contains two generations of configuration side by side:

**Modern (staying at repo root):**
- `dot_bashrc`, `dot_blerc`, `dot_tmux.conf` -- chezmoi-managed config files
- `dot_config/` -- starship, wezterm, nvim, tridactyl configs
- `run_once_before_10-install-starship.sh` -- chezmoi run_once script (starship is shared by bash and nushell)
- `.chezmoiignore` -- chezmoi exclusion rules

**Legacy (moving to archive):**
- `bash/` -- sourced shell scripts (aesthetics, completions, prompt, utils, plus duplicate bashrc/blerc/starship.toml)
- `vscode/` -- keybindings, settings, shell integration
- `blackbox/` -- Linux platform setup scripts
- `tmux.conf` -- duplicate of `dot_tmux.conf`
- `init.vim` -- old vim-plug neovim config
- `run_once_before_20-install-blesh.sh` -- ble.sh installer (bash-specific)
- `run_once_after_10-install-tpm.sh` -- TPM installer (tmux-specific)

**Out of scope (staying at repo root as-is):**
- `firefox/`, `tridactyl/`, `btrfs/`, `macos/` -- handled separately or not urgent

**Already archived:**
- `archive/setup.sh` -- old symlink-based setup script
- `archive/staged_for_deletion/` -- arch_setup.sh, cachy-browser/, imbuebox_notes.txt

### The Critical Path: bashrc Sources Legacy Directories

The live `~/.bashrc` (source of truth: `dot_bashrc`) sources files via `$BASHFILES_DIR` and direct `$DOTFILES_DIR` paths:

```bash
export BASHFILES_DIR="$DOTFILES_DIR/bash"
source "$BASHFILES_DIR/aesthetics.sh"
source "$BASHFILES_DIR/completions.sh"
source "$BASHFILES_DIR/prompt_and_history.sh"
source "$BASHFILES_DIR/utils.sh"
source "$DOTFILES_DIR/vscode/init.sh"
source "$DOTFILES_DIR/blackbox/blackbox.sh"  # Linux only
```

Moving these directories without updating the paths breaks every new shell. The migration handles this with copy-then-reroute-then-delete phasing.

### Live VSCode Symlinks

Two symlinks on the system point into the repo's `vscode/` directory:

- `~/.config/Code/User/keybindings.json` -> `dotfiles/vscode/keybindings.jsonc`
- `~/.config/Code/User/settings.json` -> `dotfiles/vscode/settings.jsonc`

These must be materialized to regular files before `vscode/` is deleted.

### What About Starship?

Starship config lives at `dot_config/starship.toml`. It is NOT archived -- starship is shared between bash (current) and nushell (future). The duplicate at `bash/starship.toml` gets archived as part of the `bash/` directory move, but the canonical config stays put.

### What About Chezmoi?

Chezmoi has not been applied on this machine yet. This migration does NOT run any chezmoi commands. The repo is already structured for chezmoi (`dot_*` naming, `.chezmoiignore`, `run_once_*` scripts), and that structure is preserved. Chezmoi bootstrap will happen as a separate step -- either before this migration (in which case `chezmoi apply` after editing `dot_bashrc` deploys the change) or after (in which case we manually copy `dot_bashrc` to `~/.bashrc`). Either path works; this proposal is agnostic.

## Proposed Solution

### Target Archive Structure

```
archive/
  setup.sh                                  # (already present)
  staged_for_deletion/                      # (already present)
  legacy/
    bash/
      bashrc
      blerc
      aesthetics.sh
      completions.sh
      prompt_and_history.sh
      utils.sh
      starship.toml
    vscode/
      keybindings.jsonc
      settings.jsonc
      shell.sh
      init.sh
      _unused_settings.jsonc
    blackbox/
      blackbox.sh
      setup.sh
      backup_exclude.txt
      backup.sh
    tmux.conf
    init.vim
    chezmoi_run_once/
      run_once_before_20-install-blesh.sh
      run_once_after_10-install-tpm.sh
```

### What Stays at Repo Root

| File/Dir | Reason |
|----------|--------|
| `dot_bashrc` | Chezmoi source for `~/.bashrc` (updated to source from archive paths) |
| `dot_blerc` | Chezmoi source for `~/.blerc` (legacy, but still actively deployed; cleanup deferred to nushell migration) |
| `dot_tmux.conf` | Chezmoi source for `~/.tmux.conf` (legacy, but still actively deployed; cleanup deferred to nushell migration) |
| `dot_config/` | Starship, wezterm, nvim, tridactyl configs |
| `run_once_before_10-install-starship.sh` | Starship shared by bash + nushell |
| `.chezmoiignore` | Already ignores `archive/`, `bash/`, etc. |
| `firefox/`, `tridactyl/`, `btrfs/`, `macos/` | Out of scope |
| `archive/` | The archive itself |
| `bin/`, `.devcontainer/`, `README.md` | Repo infrastructure |

### Why Archive the run_once Scripts for blesh and tpm?

These are chezmoi run_once scripts that install bash-specific (ble.sh) and tmux-specific (TPM) tooling. Since bash and tmux are the legacy stack being archived, these installers should not execute on future `chezmoi apply` runs. Moving them out of the repo root (into `archive/legacy/chezmoi_run_once/`) prevents chezmoi from seeing them, since `.chezmoiignore` already excludes `archive/`.

The starship run_once script stays because starship is used by nushell too.

## Implementation Phases

### Phase 1: Pre-flight

**Keep a terminal open as a recovery shell for the duration of the migration.**

```bash
cd /home/mjr/code/personal/dotfiles

# Verify the repo is clean
git status

# Create a backup branch
git checkout -b pre-legacy-archive-backup
git checkout -

# Verify current shell works
bash -li -c 'echo "BASHFILES_DIR=$BASHFILES_DIR"'
# Expected: BASHFILES_DIR=/home/mjr/code/personal/dotfiles/bash

# Check VSCode symlinks (if VSCode is installed)
file ~/.config/Code/User/keybindings.json 2>/dev/null
file ~/.config/Code/User/settings.json 2>/dev/null
# Expected: "symbolic link to .../vscode/keybindings.jsonc" (or "No such file" if VSCode not installed)
```

### Phase 2: Copy Legacy Files to Archive

```bash
cd /home/mjr/code/personal/dotfiles
mkdir -p archive/legacy/{bash,vscode,blackbox,chezmoi_run_once}

# Copy all legacy files (preserving permissions/timestamps)
cp -a bash/aesthetics.sh bash/completions.sh bash/prompt_and_history.sh \
      bash/utils.sh bash/bashrc bash/blerc bash/starship.toml \
      archive/legacy/bash/
cp -a vscode/* archive/legacy/vscode/
cp -a blackbox/* archive/legacy/blackbox/
cp -a tmux.conf archive/legacy/tmux.conf
cp -a init.vim archive/legacy/init.vim
cp -a run_once_before_20-install-blesh.sh archive/legacy/chezmoi_run_once/
cp -a run_once_after_10-install-tpm.sh archive/legacy/chezmoi_run_once/

# Verify copies match originals
diff -r bash/ archive/legacy/bash/ && echo "bash: OK"
diff -r vscode/ archive/legacy/vscode/ && echo "vscode: OK"
diff -r blackbox/ archive/legacy/blackbox/ && echo "blackbox: OK"
diff tmux.conf archive/legacy/tmux.conf && echo "tmux: OK"
diff init.vim archive/legacy/init.vim && echo "init.vim: OK"
```

At this point both old and new paths exist. Shells still work.

### Phase 3: Reroute dot_bashrc Source Paths

Edit `/home/mjr/code/personal/dotfiles/dot_bashrc` with three changes:

1. **BASHFILES_DIR** (line 18):
   ```bash
   # Before:
   export BASHFILES_DIR="$DOTFILES_DIR/bash"
   # After:
   export BASHFILES_DIR="$DOTFILES_DIR/archive/legacy/bash"
   ```

2. **vscode/init.sh** (line 108):
   ```bash
   # Before:
   source "$DOTFILES_DIR/vscode/init.sh"
   # After:
   source "$DOTFILES_DIR/archive/legacy/vscode/init.sh"
   ```

3. **blackbox.sh** (line 112):
   ```bash
   # Before:
   Linux) source "$DOTFILES_DIR/blackbox/blackbox.sh" ;;
   # After:
   Linux) source "$DOTFILES_DIR/archive/legacy/blackbox/blackbox.sh" ;;
   ```

Then deploy to the live system:

```bash
# Chezmoi is NOT bootstrapped yet (the expected case), so copy manually:
cp dot_bashrc ~/.bashrc

# (If chezmoi has been bootstrapped separately, use: chezmoi apply --verbose)
```

**Verify in a new terminal:**

```bash
echo "BASHFILES_DIR=$BASHFILES_DIR"
# Expected: /home/mjr/code/personal/dotfiles/archive/legacy/bash

# Verify starship, ble.sh, and aliases load
type starship && echo "starship: OK"
```

### Phase 4: Materialize VSCode Symlinks

```bash
# Replace symlinks with copies of the actual file content
cp --remove-destination "$(readlink -f ~/.config/Code/User/keybindings.json)" \
   ~/.config/Code/User/keybindings.json

cp --remove-destination "$(readlink -f ~/.config/Code/User/settings.json)" \
   ~/.config/Code/User/settings.json

# Verify they are now regular files
test ! -L ~/.config/Code/User/keybindings.json && echo "keybindings: regular file OK"
test ! -L ~/.config/Code/User/settings.json && echo "settings: regular file OK"
```

If VSCode is not installed or the symlinks are already broken, skip this phase.

### Phase 5: Delete Originals and Commit

```bash
cd /home/mjr/code/personal/dotfiles

# Delete legacy files from repo root (staged via git rm)
git rm -rf bash/
git rm -rf vscode/
git rm -rf blackbox/
git rm -f tmux.conf
git rm -f init.vim
git rm -f run_once_before_20-install-blesh.sh
git rm -f run_once_after_10-install-tpm.sh

# Stage the new archive and updated bashrc
git add archive/legacy/ dot_bashrc

# Verify what will be committed
git status

# Commit
git commit -m "archive: move legacy bash/tmux/vscode/blackbox to archive/legacy/

Move bash/, vscode/, blackbox/, tmux.conf, init.vim, and chezmoi run_once
scripts for blesh and tpm to archive/legacy/. Update dot_bashrc to source
from archive/legacy/ paths.

Preserved at repo root:
- run_once_before_10-install-starship.sh (starship shared with nushell)
- dot_config/starship.toml (shared config, not archived)
- All dot_* chezmoi sources and .chezmoiignore

Out of scope: firefox/, tridactyl/, btrfs/, macos/"
```

### Phase 6: Post-flight Verification

```bash
# Clean working tree
git status
# Expected: nothing to commit, working tree clean

# Shell still works
bash -li -c 'echo "BASHFILES_DIR=$BASHFILES_DIR starship=$(command -v starship)"'
# Expected: archive/legacy/bash path, starship present

# Starship config is at repo root (not archived)
test -f dot_config/starship.toml && echo "starship config: present"

# Starship run_once script is at repo root
test -f run_once_before_10-install-starship.sh && echo "starship run_once: present"

# Legacy directories are gone from repo root
for d in bash vscode blackbox; do
  test ! -d "$d" && echo "$d: removed OK"
done

# Out-of-scope directories are untouched
for d in firefox tridactyl btrfs macos; do
  test -d "$d" && echo "$d: still present OK"
done
```

## Important Design Decisions

### Decision 1: Repo-level File Moves Only -- No chezmoi Commands

The migration is purely `cp`, `git rm`, `git add`, and `git commit` within the dotfiles repo plus one manual `cp dot_bashrc ~/.bashrc` to deploy the updated paths. Chezmoi bootstrap is a separate concern that can happen before or after this migration.

**Why:** Coupling the migration to chezmoi bootstrap makes two complex operations dependent on each other. Keeping them separate means either can fail independently and be retried.

### Decision 2: Reroute Source Paths Rather Than Inline

`dot_bashrc` is updated to source from `archive/legacy/bash/` rather than inlining all the sourced files. This keeps the diff minimal (3 path changes) and preserves the existing modular structure.

**Why:** Inlining ~300 lines of shell code into `dot_bashrc` risks introducing bugs and makes the diff hard to review. Path rerouting is trivially verifiable.

### Decision 3: Materialize VSCode Symlinks as Copies

Replace VSCode config symlinks with regular file copies rather than redirecting them into the archive.

**Why:** VSCode is being superseded by neovim/wezterm. Symlinks into an "archive" directory are semantically misleading. Copies decouple the system config from the repo entirely.

### Decision 4: Archive blesh/tpm run_once Scripts, Keep Starship

The starship installer stays at repo root; the blesh and tpm installers move to archive.

**Why:** Starship is used by both bash (current) and nushell (future). Blesh and tpm are bash/tmux-specific and should not run on future chezmoi applies.

### Decision 5: Starship Config Is Explicitly Preserved

`dot_config/starship.toml` stays at its current location. It is NOT archived. The duplicate copy at `bash/starship.toml` moves to `archive/legacy/bash/starship.toml` as part of the `bash/` directory move.

**Why:** Starship is the prompt for both bash and nushell. The nushell setup proposal depends on `dot_config/starship.toml` being available.

## Edge Cases / Challenging Scenarios

### Shell Break During Migration

If `dot_bashrc` is updated (Phase 3) but files have not been moved (Phase 2), or vice versa, the shell breaks.

**Mitigation:** The phasing ensures both old and new paths exist simultaneously between Phase 2 (copy) and Phase 5 (delete). The reroute in Phase 3 happens while originals are still in place. At no point during the sequence are source files unavailable.

**Recovery:** From the recovery terminal, restore `dot_bashrc`:
```bash
git checkout -- dot_bashrc
cp dot_bashrc ~/.bashrc
```

### VSCode Symlinks Already Broken

If the symlink targets were already deleted, `cp --remove-destination "$(readlink -f ...)"` fails.

**Mitigation:** Check symlinks in Phase 1 pre-flight. If broken, either copy from the archive version or just remove the dangling symlink.

### Someone Sources the Old Paths Directly

If external scripts or other machines reference `/home/mjr/code/personal/dotfiles/bash/` directly, those paths break after Phase 5.

**Mitigation:** This repo is only used on one machine. The only consumer of these paths is `dot_bashrc`, which is updated in Phase 3. No other known consumers exist.

### `.chezmoiignore` Already Covers Archive

The existing `.chezmoiignore` already lists `archive/`, `bash/`, `vscode/`, `blackbox/`, `init.vim`, and `tmux.conf`. No changes to `.chezmoiignore` are needed for this migration. After the migration, the entries for `bash/`, `vscode/`, `blackbox/`, `init.vim`, and `tmux.conf` become redundant (those paths no longer exist) but are harmless to leave in place.

## Rollback Strategy

Full rollback is a single `git revert` of the commit from Phase 5, plus restoring `~/.bashrc`:

```bash
cd /home/mjr/code/personal/dotfiles
git revert HEAD
cp dot_bashrc ~/.bashrc
```

The `pre-legacy-archive-backup` branch from Phase 1 also preserves the exact pre-migration repo state.

Note: The VSCode symlink materialization (Phase 4) is a system-side change not captured in git. If rollback is needed, the symlinks would need to be manually re-created.

## Test Plan

1. After Phase 2: `diff -r bash/ archive/legacy/bash/` reports no differences
2. After Phase 3: New terminal loads with `BASHFILES_DIR` pointing to `archive/legacy/bash/`
3. After Phase 3: Starship prompt renders, ble.sh loads, tab completion works
4. After Phase 4: VSCode config files are regular files (not symlinks)
5. After Phase 5: `git status` is clean
6. After Phase 6: `dot_config/starship.toml` exists, `run_once_before_10-install-starship.sh` exists
7. After Phase 6: `bash/`, `vscode/`, `blackbox/` are gone from repo root
8. After Phase 6: `firefox/`, `tridactyl/`, `btrfs/`, `macos/` are untouched
