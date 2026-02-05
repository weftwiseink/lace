---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T12:30:00-08:00
task_list: dotfiles/legacy-archive
type: proposal
state: live
status: review_ready
tags: [dotfiles, migration, archive, symlinks, bash, tmux, vscode, blackbox, legacy]
parent: cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-05T21:45:00-08:00
  round: 4
revisions:
  - at: 2026-02-05T12:50:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Corrected chezmoi run_once handling: scripts ARE managed (not ignored), removal safe due to run_once semantics"
      - "Clarified Phase 6 commit scope: repo-side only, system operations in Phases 3-4 are prerequisites"
      - "Added caveat to full rollback note: system-side symlinks require separate restoration"
  - at: 2026-02-05T19:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Expanded all implementation phases with exact commands, pre-conditions, validation steps, and rollback commands"
      - "Added pre-deletion checklist to Phase 5 and changed to git rm for cleaner history"
      - "Expanded edge cases: chezmoi apply between phases, local modifications to managed files, deleted symlink targets, Fedora 43 platform concerns (SELinux, Flatpak Firefox, atomic desktop paths)"
      - "Added non-breaking intermediate state smoke tests to Phase 2 validation"
      - "Added end-to-end smoke test to Phase 6 validation"
  - at: 2026-02-05T20:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Reduced archive scope: removed firefox/, tridactyl/, btrfs/, and macos/ from archive targets"
      - "Added 'Out of Scope' section documenting directories remaining in place"
      - "Removed Phase 4 (Firefox symlink update) entirely"
      - "Updated all phases, validation steps, rollback commands, and file counts to reflect reduced scope"
      - "Added note: firefox config migration handled in separate proposal; tridactyl/btrfs/macos remain as-is"
  - at: 2026-02-05T21:30:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Removed chezmoi references throughout: chezmoi was never applied on this machine, so no chezmoi state, chezmoi apply, chezmoi diff, chezmoi managed, or .chezmoiignore handling needed"
      - "Simplified Phase 0: git branch is sufficient backup, removed chezmoi snapshots and chezmoi doctor pre-condition"
      - "Removed per-phase Rollback subsections; collapsed top-level Rollback Strategy to one line (git reflog + manual fixup)"
      - "Removed edge cases that only applied to chezmoi: state drift, apply-between-phases, local modifications to managed files"
      - "Simplified Phase 5: removed .chezmoiignore update and chezmoi managed verification steps"
      - "Updated BLUF and Background to reflect that files are from old setup.sh symlink approach, not chezmoi"
---

# Dotfiles Legacy Archive Migration

> BLUF: Archive a subset of legacy configuration files in the dotfiles repo (`/home/mjr/code/personal/dotfiles/`) by moving them to `archive/legacy/`, while preserving a non-breaking intermediate state for the live bash/tmux/vscode environment. The migration must handle two categories of risk: (1) the live `~/.bashrc` (sourced from `dot_bashrc`) references files directly from the repo's `bash/`, `vscode/`, and `blackbox/` directories, requiring path rerouting before any move; and (2) two live symlinks on the system (`~/.config/Code/User/keybindings.json`, `~/.config/Code/User/settings.json`) point into the `vscode/` directory that will be relocated. The `run_once_*` scripts at the repo root are legacy artifacts that can simply be moved to the archive. Note: chezmoi has never been applied on this machine -- all system files are from the old `setup.sh` symlink approach or manual placement. Directories explicitly excluded from this archive scope: `firefox/`, `tridactyl/`, `btrfs/`, and `macos/` (see Out of Scope section). This proposal provides a complete file inventory, a phased migration plan, and a "left behind" report documenting all system artifacts for future cleanup.
>
> **Key Dependencies:**
> - [Parent: Dotfiles Migration and Config Extraction](2026-02-04-dotfiles-migration-and-config-extraction.md) -- establishes the overall migration direction
> - [Neovim/WezTerm Config Migration](2026-02-04-nvim-wezterm-config-migration.md) -- covers the modern config side (already handled)

## Objective

Complete the archival of legacy dotfiles configuration by:

1. Moving all legacy files to a structured `archive/legacy/` directory
2. Maintaining a non-breaking intermediate state throughout the migration
3. Removing or redirecting all live symlinks pointing into relocated directories
4. Documenting every system-side artifact left behind for future cleanup

## Background

### Current Repository State

The dotfiles repo at `/home/mjr/code/personal/dotfiles/` contains two parallel configuration systems:

**Modern (dot_* naming convention, to KEEP):**
- `dot_bashrc` -- source of truth for `~/.bashrc`
- `dot_blerc` -- source of truth for `~/.blerc`
- `dot_tmux.conf` -- source of truth for `~/.tmux.conf`
- `dot_config/starship.toml` -- source of truth for `~/.config/starship.toml`
- `dot_config/tridactyl/tridactylrc` -- source of truth for `~/.config/tridactyl/tridactylrc`
- `dot_config/wezterm/wezterm.lua` -- source of truth for `~/.config/wezterm/wezterm.lua`
- `dot_config/nvim/` -- source of truth for `~/.config/nvim/`
- `.chezmoiignore` -- chezmoi exclusion rules (present in repo but chezmoi has never been applied)
- `.devcontainer/` -- (if created per parent proposal)

**Legacy (to ARCHIVE):**
- `bash/` -- bashrc, blerc, aesthetics.sh, completions.sh, prompt_and_history.sh, utils.sh, starship.toml
- `vscode/` -- keybindings.jsonc, settings.jsonc, shell.sh, init.sh, _unused_settings.jsonc
- `tmux.conf` -- original tmux config (identical to `dot_tmux.conf`)
- `blackbox/` -- blackbox.sh, setup.sh, backup_exclude.txt, backup.sh (Linux platform setup; only sourced by bash config which is being archived)
- `init.vim` -- old neovim config (vim-plug based, commented out in setup.sh)
- `run_once_before_10-install-starship.sh` -- legacy install script (chezmoi was never applied; software was installed manually or via other means)
- `run_once_before_20-install-blesh.sh` -- legacy install script
- `run_once_after_10-install-tpm.sh` -- legacy install script

**Out of Scope (remaining in current location):**
- `firefox/` -- userChrome.css, userContent.css, linux_assets/. Firefox config migration is being handled in a separate proposal.
- `tridactyl/` -- original tridactylrc (identical to `dot_config/tridactyl/tridactylrc`). Remains as-is for now.
- `btrfs/` -- btrbk_aws.tf, btrbk_config, README.md. Remains as-is for now.
- `macos/` -- iterm_solarized.json, karabiner.json, macos.sh, setup.sh, slate.js. Remains as-is for now.

**Already archived:**
- `archive/setup.sh` -- the old symlink-based setup script
- `archive/staged_for_deletion/` -- arch_setup.sh, cachy-browser/, imbuebox_notes.txt

### Duplicate Files Inventory

Investigation confirms these pairs are duplicates (the legacy copy predates the `dot_*` copy):

| Legacy File | Modern File | Difference |
|---|---|---|
| `bash/bashrc` | `dot_bashrc` | dot_bashrc adds comments, bash/bashrc has pnpm block |
| `bash/blerc` | `dot_blerc` | Identical |
| `bash/starship.toml` | `dot_config/starship.toml` | Identical |
| `tmux.conf` | `dot_tmux.conf` | Identical |

> NOTE: `tridactyl/tridactylrc` is also a duplicate of `dot_config/tridactyl/tridactylrc` (identical), but tridactyl is out of scope for this migration.

### Live System State (Investigated 2026-02-05)

**Config files on system (placed by old setup.sh or manually, NOT by chezmoi):**
- `~/.bashrc` -- matches `dot_bashrc` content (placed manually or by setup.sh)
- `~/.blerc` -- matches `dot_blerc` content
- `~/.tmux.conf` -- matches `dot_tmux.conf` content
- `~/.config/starship.toml` -- matches `dot_config/starship.toml` content
- `~/.config/tridactyl/tridactylrc` -- matches `dot_config/tridactyl/tridactylrc` content
- `~/.config/wezterm/wezterm.lua` -- manually placed
- `~/.config/nvim/*` -- manually placed

**Live symlinks from old setup.sh (STILL ACTIVE, in archive scope):**
1. `~/.config/Code/User/keybindings.json` -> `/var/home/mjr/code/personal/dotfiles/vscode/keybindings.jsonc`
2. `~/.config/Code/User/settings.json` -> `/var/home/mjr/code/personal/dotfiles/vscode/settings.jsonc`

**Live symlinks from old setup.sh (STILL ACTIVE, out of scope):**
3. `~/.mozilla/firefox/h4hh8m1f.default-release/chrome` -> `/var/home/mjr/code/personal/dotfiles/firefox` (firefox is out of scope; symlink remains unchanged)

**Copy (not linked):**
- `~/.vscode/shell.sh` -- same content as `vscode/shell.sh` but on different device (inode 735832 on device 0,49 vs inode 149751 on device 0,41). Not a hard link or symlink.

**Installed software still in use:**
- `/usr/bin/starship` -- system-installed starship prompt
- `~/.local/share/blesh/` -- ble.sh (Bash Line Editor)
- `~/.tmux/plugins/tpm` -- Tmux Plugin Manager + managed plugins

### The Critical Dependency: bashrc Sources Legacy Files

The live `~/.bashrc` (whose source of truth is `dot_bashrc` in the repo) contains these source statements that reference legacy directories:

```bash
export DOTFILES_DIR="$HOME/code/personal/dotfiles"
export BASHFILES_DIR="$DOTFILES_DIR/bash"
# ...
source "$BASHFILES_DIR/aesthetics.sh"       # bash/aesthetics.sh
source "$BASHFILES_DIR/completions.sh"      # bash/completions.sh
source "$BASHFILES_DIR/prompt_and_history.sh" # bash/prompt_and_history.sh (loads starship + blesh)
source "$BASHFILES_DIR/utils.sh"            # bash/utils.sh
source "$DOTFILES_DIR/vscode/init.sh"       # vscode/init.sh
# Platform-specific:
source "$DOTFILES_DIR/blackbox/blackbox.sh" # on Linux (blackbox IS in archive scope)
# Platform-specific (macos is NOT in archive scope):
source "$DOTFILES_DIR/macos/macos.sh"     # on Darwin (stays in place)
```

Moving `bash/`, `vscode/`, or `blackbox/` without updating these paths will break every new shell session immediately. The `macos/macos.sh` source path is unaffected since macos is out of scope.

## Proposed Solution

### Archive Directory Structure

```
archive/
  setup.sh                              # (already present)
  staged_for_deletion/                  # (already present)
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
    tmux.conf
    blackbox/
      blackbox.sh
      setup.sh
      backup_exclude.txt
      backup.sh
    init.vim
    chezmoi_run_once/
      run_once_before_10-install-starship.sh
      run_once_before_20-install-blesh.sh
      run_once_after_10-install-tpm.sh
```

> NOTE: The following directories remain in their current repo-root locations (out of scope):
> `firefox/`, `tridactyl/`, `btrfs/`, `macos/`. See "Out of Scope" in the inventory above.

### Symlink De-linking Plan

**VSCode symlinks (2 symlinks):**

The VSCode keybindings and settings symlinks point to `vscode/keybindings.jsonc` and `vscode/settings.jsonc`. These are actively used if VSCode is still installed.

Strategy: Replace symlinks with regular file copies. This decouples the live config from the repo entirely, which is appropriate since VSCode is being superseded by neovim/wezterm. If the user still uses VSCode occasionally, the copied files continue to work. Future VSCode config changes would be made directly in `~/.config/Code/User/`.

```bash
# For each VSCode symlink:
cp --remove-destination "$(readlink -f ~/.config/Code/User/keybindings.json)" ~/.config/Code/User/keybindings.json
cp --remove-destination "$(readlink -f ~/.config/Code/User/settings.json)" ~/.config/Code/User/settings.json
```

**Firefox symlink (out of scope):**

The Firefox chrome directory symlink (`~/.mozilla/firefox/h4hh8m1f.default-release/chrome` -> `firefox/`) is NOT handled by this migration. The `firefox/` directory remains in its current location, so the existing symlink continues to work unchanged. Firefox config migration is being handled in a separate proposal.

### Bashrc Re-routing Plan

Update `dot_bashrc` to source files from `archive/legacy/` paths instead of the top-level directories. This is an intermediate step; a future migration could inline these files into `dot_bashrc` itself.

Changes to `dot_bashrc`:

```bash
# Before:
export DOTFILES_DIR="$HOME/code/personal/dotfiles"
export BASHFILES_DIR="$DOTFILES_DIR/bash"

# After:
export DOTFILES_DIR="$HOME/code/personal/dotfiles"
export BASHFILES_DIR="$DOTFILES_DIR/archive/legacy/bash"
```

And the vscode/init.sh source:

```bash
# Before:
source "$DOTFILES_DIR/vscode/init.sh"

# After:
source "$DOTFILES_DIR/archive/legacy/vscode/init.sh"
```

And the platform-specific blackbox source (Linux only; macos path is unchanged since macos is out of scope):

```bash
# Before:
case $(uname -s) in
  Darwin | FreeBSD) source "$DOTFILES_DIR/macos/macos.sh" ;;
  Linux) source "$DOTFILES_DIR/blackbox/blackbox.sh" ;;
esac

# After:
case $(uname -s) in
  Darwin | FreeBSD) source "$DOTFILES_DIR/macos/macos.sh" ;;          # unchanged (macos out of scope)
  Linux) source "$DOTFILES_DIR/archive/legacy/blackbox/blackbox.sh" ;; # updated
esac
```

After updating `dot_bashrc`, manually copy it to `~/.bashrc` (since chezmoi has never been applied on this machine, we just copy directly).

### run_once Script Handling

The three `run_once_*` scripts at the repo root are legacy install scripts written in chezmoi's naming convention. Since chezmoi has never been applied on this machine, these scripts have no associated chezmoi state -- they are simply shell scripts that were never executed by chezmoi. The software they install (starship, ble.sh, TPM) was installed by other means.

Moving these scripts to `archive/legacy/chezmoi_run_once/` is a straightforward `git mv` with no side effects. They are kept in the archive as documentation of what dependencies the legacy bash stack requires.

## Important Design Decisions

### Decision 1: Archive In-Place vs. Separate Repository

**Decision:** Archive legacy files within the same repository under `archive/legacy/`.

**Why:**
- Preserves git history for all files (no history loss from repo splitting)
- Keeps the migration atomic and reversible
- The existing `archive/` directory already establishes this pattern
- A separate "legacy-dotfiles" repo adds management overhead for files that are being retired

### Decision 2: Re-route bashrc Sources vs. Inline Everything

**Decision:** Re-route source paths to `archive/legacy/` as an intermediate step, rather than inlining all sourced files into `dot_bashrc`.

**Why:**
- Minimizes the diff in the critical `dot_bashrc` file (only path changes, no logic changes)
- Maintains the existing file structure and modularity during transition
- Inlining can be done as a separate follow-up when moving away from bash entirely (to nushell or similar)
- Reduces risk: a path change is trivially verifiable; inlining 300+ lines of shell code invites subtle bugs

### Decision 3: Replace VSCode Symlinks with Copies vs. Update Targets

**Decision:** Replace VSCode symlinks with regular file copies rather than updating them to point into `archive/legacy/`.

**Why:**
- VSCode is being superseded in the primary workflow by neovim + wezterm
- Copying decouples the system config from the repo entirely, which is the end goal
- If the user still opens VSCode, the config files continue to work
- Creating symlinks into an "archive" directory is semantically misleading (it implies active management)

### Decision 4: Keep run_once Scripts as Archive Reference

**Decision:** Move `run_once_*` scripts to `archive/legacy/chezmoi_run_once/` rather than deleting them.

**Why:**
- They document what software was installed and how
- They serve as a reference for what dependencies the legacy bash stack requires
- If chezmoi is ever actually applied in the future, they can be restored to the repo root

## Edge Cases / Challenging Scenarios

### Shell Break During Migration

If `dot_bashrc` is updated (Phase 2) but the files have not yet been moved (Phase 1), or vice versa, the shell will break.

**Mitigation:** The copy-before-update-before-delete strategy eliminates this risk. The phasing is specifically:

1. Phase 1: Copy files to `archive/legacy/` (both old and new paths now work)
2. Phase 2: Update `dot_bashrc` to point to archive paths and apply (new shells use archive, old files still exist as fallback)
3. Phase 4: Delete originals (only after archive paths are verified working)

At no point during this sequence are the source files unavailable. The "non-breaking intermediate state" between Phases 1 and 4 is the key safety property: both the old and new paths resolve to identical files.

**Detection:** If a new terminal fails to load its prompt or shows `source: file not found` errors, the bashrc path update is wrong.

**Recovery:** In the recovery terminal (kept open from Phase 0):
```bash
# Restore the original dot_bashrc from the backup branch and copy to system:
git -C /home/mjr/code/personal/dotfiles show pre-legacy-archive-backup:dot_bashrc > ~/.bashrc
# New terminals will now use the original bashrc with old paths
```

### Symlink Target Already Deleted

If a symlink target has been deleted before the migration starts (e.g., someone already removed `vscode/keybindings.jsonc`), the Phase 3 `cp --remove-destination "$(readlink -f ...)"` command will fail because `readlink -f` resolves to a non-existent path.

**Detection (in Phase 0):**
```bash
# Check if symlink targets still exist:
test -e "$(readlink -f ~/.config/Code/User/keybindings.json)" && echo "keybindings target: exists" || echo "keybindings target: MISSING"
test -e "$(readlink -f ~/.config/Code/User/settings.json)" && echo "settings target: exists" || echo "settings target: MISSING"
```

**Mitigation for VSCode:** If the original target is gone but the archive copy exists (Phase 1 already ran), copy from the archive instead:
```bash
cp --remove-destination /home/mjr/code/personal/dotfiles/archive/legacy/vscode/keybindings.jsonc \
   ~/.config/Code/User/keybindings.json
```

If BOTH the original and archive copies are missing, the symlink should simply be removed (`rm` the dangling symlink) and the loss documented.

### VSCode Extensions Referencing Config Paths

Some VSCode extensions may have hardcoded references to `~/.vscode/shell.sh` (e.g., the terminal shell integration).

**Mitigation:** The `~/.vscode/shell.sh` file is a copy, not a symlink, and is not affected by this migration. It will continue to work. However, it references `$VSCODE_SESSION_PREFIX` which uses tmux -- if tmux config changes, this could break. Document in the "left behind" report.

### Concurrent tmux Sessions During Migration

If tmux is running during the migration, the `~/.tmux.conf` file is already loaded in memory. The migration does not modify `dot_tmux.conf` or `~/.tmux.conf`, so running sessions are unaffected.

**Mitigation:** No action needed. The legacy `tmux.conf` at the repo root is a duplicate that is not referenced by any live system path.

### Platform-Specific Concerns (Fedora 43)

This system runs Fedora 43 with kernel 6.17.x. Relevant platform considerations:

1. **Atomic/ostree desktops (Silverblue, Kinoite):** If this is an atomic Fedora variant, `/var/home/mjr` is the real home path (not `/home/mjr`, which is a symlink to `/var/home/mjr`). This proposal uses two path forms intentionally: `cd` commands and repo operations use `/home/mjr` (the `$HOME`-resolved path, which works on all Fedora variants), while symlink targets in Phase 3 use `/var/home/mjr` (the canonical filesystem path recorded by the original `setup.sh`). Both paths resolve to the same location. No special handling needed.

2. **SELinux context:** Fedora 43 runs SELinux in enforcing mode by default. Copying files (`cp -a`) preserves SELinux context labels. Creating new files in `archive/legacy/` will inherit the parent directory's context. Materializing symlinks to regular files (Phase 3) may change the SELinux context from the symlink target's context to the destination directory's context. This is generally fine for user config files in `~/.config/`, which share the same `user_home_t` context.

   **Detection if SELinux blocks access:**
   ```bash
   ausearch -m avc -ts recent 2>/dev/null | grep -i denied
   # If any denials appear related to dotfiles paths, restore context:
   restorecon -v ~/.config/Code/User/keybindings.json ~/.config/Code/User/settings.json
   ```

3. **Filesystem:** Fedora 43 defaults to btrfs on root. The dotfiles repo and home directory are on the same filesystem. No cross-device copy issues.

## Left Behind Files Report

After migration, the following files will remain on the system outside the dotfiles repo. These are artifacts of the legacy configuration that should be cleaned up when transitioning away from the bash/tmux stack.

### Active Config Files (Manually Placed, Tracked in Repo)

| System Path | Source of Truth | Notes |
|---|---|---|
| `~/.bashrc` | `dot_bashrc` | Will source from `archive/legacy/` paths |
| `~/.blerc` | `dot_blerc` | Standalone, no external deps |
| `~/.tmux.conf` | `dot_tmux.conf` | References TPM at `~/.tmux/plugins/tpm` |
| `~/.config/starship.toml` | `dot_config/starship.toml` | Used by starship prompt in bash |
| `~/.config/tridactyl/tridactylrc` | `dot_config/tridactyl/tridactylrc` | Browser extension config |
| `~/.config/wezterm/wezterm.lua` | `dot_config/wezterm/wezterm.lua` | Modern terminal config |
| `~/.config/nvim/*` | `dot_config/nvim/` | Modern editor config |

### Installed Software (Active, Not Repo-Managed)

| System Path | Installed By | In Active Use | Cleanup Notes |
|---|---|---|---|
| `/usr/bin/starship` | System package manager | Yes (bash prompt) | Remove when moving to nushell |
| `~/.local/share/blesh/` | Manual install (script in archive) | Yes (bash line editor) | `rm -rf ~/.local/share/blesh` when moving to nushell |
| `~/.tmux/plugins/tpm` | Manual install (script in archive) | Yes (tmux plugin mgr) | `rm -rf ~/.tmux/plugins` when retiring tmux |
| `~/.tmux/plugins/tmux-sensible` | TPM | Yes | Removed with TPM |
| `~/.tmux/plugins/tmux-battery` | TPM | Yes | Removed with TPM |
| `~/.tmux/plugins/tmux-yank` | TPM | Yes | Removed with TPM |
| `~/.tmux/plugins/tmux-resurrect` | TPM | Yes | Removed with TPM |
| `~/.tmux/plugins/tmux-continuum` | TPM | Yes | Removed with TPM |

### Orphaned Files (No Longer Managed)

| System Path | Origin | Status | Cleanup Action |
|---|---|---|---|
| `~/.vscode/shell.sh` | Old setup.sh (copy) | Not managed, still functional | `rm ~/.vscode/shell.sh` when retiring VSCode |
| `~/.config/Code/User/keybindings.json` | Will be converted from symlink to copy | Not managed | Edit directly or remove with VSCode |
| `~/.config/Code/User/settings.json` | Will be converted from symlink to copy | Not managed | Edit directly or remove with VSCode |
| `~/.mozilla/firefox/.../chrome` | Symlink to `firefox/` in dotfiles repo | Not affected by this migration (out of scope) | Handled by separate firefox migration proposal |
| `~/.full_history` | Written by `_prompt_func` in bash | Growing file | `rm ~/.full_history` when retiring bash |

## Implementation Phases

### Phase 0: Pre-flight Snapshot

#### Pre-conditions

- Current working directory can be anything (all paths are absolute)
- The dotfiles repo is clean (`git -C /home/mjr/code/personal/dotfiles status` shows no uncommitted changes to tracked files)
- The user has an open terminal session that can be used as a recovery shell if new shells break

#### Tasks

**Step 0.1: Verify current shell works.**

```bash
# In a NEW terminal (not the recovery shell), confirm the full prompt stack loads:
bash -li -c 'echo "shell=$SHELL bashfiles=$BASHFILES_DIR starship=$(command -v starship) blesh=$BLESH_DIR"'
# Expected output should include:
#   bashfiles=/home/mjr/code/personal/dotfiles/bash
#   starship=/usr/bin/starship
#   blesh=/home/mjr/.local/share/blesh
```

**Step 0.2: Verify VSCode config is accessible (if VSCode is installed).**

```bash
# Check both symlinks resolve to real files:
file ~/.config/Code/User/keybindings.json
file ~/.config/Code/User/settings.json
# Expected: "symbolic link to /var/home/mjr/code/personal/dotfiles/vscode/keybindings.jsonc"
# Expected: "symbolic link to /var/home/mjr/code/personal/dotfiles/vscode/settings.jsonc"

# Verify the targets exist and are non-empty:
test -s "$(readlink -f ~/.config/Code/User/keybindings.json)" && echo "keybindings OK" || echo "FAIL"
test -s "$(readlink -f ~/.config/Code/User/settings.json)" && echo "settings OK" || echo "FAIL"
```

**Step 0.3: Create a backup branch.**

```bash
cd /home/mjr/code/personal/dotfiles
git checkout -b pre-legacy-archive-backup
git checkout -  # switch back to the working branch
# The backup branch preserves the exact repo state before any changes.
# If anything goes wrong: git checkout pre-legacy-archive-backup
```

#### Expected State After Completion

- A `pre-legacy-archive-backup` branch exists at the current HEAD
- No files in the dotfiles repo or on the system have been modified
- The recovery terminal remains open

### Phase 1: Create Archive Structure and Copy Files

#### Pre-conditions

- Phase 0 completed (backup branch exists)
- Dotfiles repo working tree is clean: `git -C /home/mjr/code/personal/dotfiles diff --quiet`
- The `archive/` directory already exists (contains `setup.sh` and `staged_for_deletion/`)

#### Tasks

**Step 1.1: Create the archive directory tree.**

```bash
cd /home/mjr/code/personal/dotfiles
mkdir -p archive/legacy/{bash,vscode,blackbox,chezmoi_run_once}
```

**Step 1.2: Copy all legacy files (preserving permissions and timestamps).**

```bash
cd /home/mjr/code/personal/dotfiles

# Bash files
cp -a bash/aesthetics.sh bash/completions.sh bash/prompt_and_history.sh bash/utils.sh \
      bash/bashrc bash/blerc bash/starship.toml archive/legacy/bash/

# VSCode files
cp -a vscode/* archive/legacy/vscode/

# Standalone config files
cp -a tmux.conf archive/legacy/
cp -a init.vim archive/legacy/

# Directory-based configs
cp -a blackbox/* archive/legacy/blackbox/

# Chezmoi run_once scripts
cp -a run_once_before_10-install-starship.sh archive/legacy/chezmoi_run_once/
cp -a run_once_before_20-install-blesh.sh archive/legacy/chezmoi_run_once/
cp -a run_once_after_10-install-tpm.sh archive/legacy/chezmoi_run_once/
```

#### Validation

```bash
cd /home/mjr/code/personal/dotfiles

# Verify all directory copies match originals byte-for-byte:
diff -r bash/ archive/legacy/bash/ && echo "bash: OK" || echo "bash: MISMATCH"
diff -r vscode/ archive/legacy/vscode/ && echo "vscode: OK" || echo "vscode: MISMATCH"
diff -r blackbox/ archive/legacy/blackbox/ && echo "blackbox: OK" || echo "blackbox: MISMATCH"

# Verify standalone files:
diff tmux.conf archive/legacy/tmux.conf && echo "tmux.conf: OK" || echo "tmux.conf: MISMATCH"
diff init.vim archive/legacy/init.vim && echo "init.vim: OK" || echo "init.vim: MISMATCH"

# Verify run_once scripts:
diff run_once_before_10-install-starship.sh archive/legacy/chezmoi_run_once/run_once_before_10-install-starship.sh && echo "starship script: OK"
diff run_once_before_20-install-blesh.sh archive/legacy/chezmoi_run_once/run_once_before_20-install-blesh.sh && echo "blesh script: OK"
diff run_once_after_10-install-tpm.sh archive/legacy/chezmoi_run_once/run_once_after_10-install-tpm.sh && echo "tpm script: OK"

# Confirm originals are still in place:
test -d bash/ && test -d vscode/ && test -f tmux.conf && echo "Originals intact" || echo "ORIGINALS MISSING"
```

#### Expected State After Completion

- `archive/legacy/` contains a complete copy of all legacy files
- All `diff -r` comparisons report no differences
- Original files remain untouched at repo root
- Running shells are unaffected

### Phase 2: Update dot_bashrc Source Paths

#### Pre-conditions

- Phase 1 completed (all files exist under `archive/legacy/`)
- The archive copies have been verified against originals (all diffs clean)
- A recovery terminal is open (in case new shells break)

#### Tasks

**Step 2.1: Edit `dot_bashrc` to reroute source paths.**

Three changes are required in `/home/mjr/code/personal/dotfiles/dot_bashrc`:

1. Change `BASHFILES_DIR` (line 18):
   ```bash
   # Before:
   export BASHFILES_DIR="$DOTFILES_DIR/bash"
   # After:
   export BASHFILES_DIR="$DOTFILES_DIR/archive/legacy/bash"
   ```

2. Change vscode source (line 108):
   ```bash
   # Before:
   source "$DOTFILES_DIR/vscode/init.sh"
   # After:
   source "$DOTFILES_DIR/archive/legacy/vscode/init.sh"
   ```

3. Change the blackbox source path (Linux platform; macos path is unchanged since macos is out of scope):
   ```bash
   # Before:
     Linux) source "$DOTFILES_DIR/blackbox/blackbox.sh" ;;
   # After:
     Linux) source "$DOTFILES_DIR/archive/legacy/blackbox/blackbox.sh" ;;
   ```

**Step 2.2: Copy the updated dot_bashrc to the live system.**

```bash
# Since chezmoi has never been applied, we copy directly:
cp /home/mjr/code/personal/dotfiles/dot_bashrc ~/.bashrc
```

**Step 2.3: Verify in a new shell.**

```bash
# Open a NEW terminal window/tab (not sourcing in the current shell).
# In the new terminal, run:
echo "BASHFILES_DIR=$BASHFILES_DIR"
# Expected: /home/mjr/code/personal/dotfiles/archive/legacy/bash

type starship
# Expected: starship is /usr/bin/starship (starship prompt loaded)

echo "ble_version=$BLE_VERSION"
# Expected: a version string (ble.sh loaded)

# Test tab completion (type "git sta" then press Tab):
# Expected: completes to "git status" or shows completions

# Test vscode init.sh loaded:
type nametab 2>/dev/null && echo "nametab: OK" || echo "nametab: not found (check vscode/init.sh)"
```

#### Validation: Non-breaking Intermediate State Smoke Test

At this point, BOTH the original files and the archive copies exist. The bashrc now sources from the archive copies. This is the safe intermediate state.

```bash
# Verify the archive copy is what's being sourced:
bash -li -c 'echo $BASHFILES_DIR'
# Expected: /home/mjr/code/personal/dotfiles/archive/legacy/bash

# Verify the original files still exist (safety net):
test -f /home/mjr/code/personal/dotfiles/bash/aesthetics.sh && echo "Original bash/ still exists" || echo "MISSING"

# Verify tmux is unaffected (dot_tmux.conf was not modified):
tmux new-session -d -s migration-test 'echo tmux-ok' && sleep 1 && tmux kill-session -t migration-test && echo "tmux: OK"
```

#### Expected State After Completion

- `~/.bashrc` sources from `archive/legacy/` paths
- New shells load successfully with starship prompt, ble.sh, tab completion, and all aliases
- Original legacy files still exist at repo root (fallback available)

### Phase 3: De-link VSCode Symlinks

#### Pre-conditions

- Phase 2 completed (bashrc rerouting verified)
- Both VSCode symlinks still resolve to existing files:
  ```bash
  test -L ~/.config/Code/User/keybindings.json && test -e ~/.config/Code/User/keybindings.json && echo "keybindings symlink OK"
  test -L ~/.config/Code/User/settings.json && test -e ~/.config/Code/User/settings.json && echo "settings symlink OK"
  ```
- If either symlink is already broken (target deleted), skip directly to the archive copy strategy (see Edge Cases section)

#### Tasks

**Step 3.1: Materialize symlinks as regular files.**

```bash
# Resolve the symlink target and copy the real file content over the symlink:
cp --remove-destination "$(readlink -f ~/.config/Code/User/keybindings.json)" \
   ~/.config/Code/User/keybindings.json

cp --remove-destination "$(readlink -f ~/.config/Code/User/settings.json)" \
   ~/.config/Code/User/settings.json
```

#### Validation

```bash
# Confirm they are now regular files (not symlinks):
test -L ~/.config/Code/User/keybindings.json && echo "FAIL: still a symlink" || echo "keybindings: regular file OK"
test -L ~/.config/Code/User/settings.json && echo "FAIL: still a symlink" || echo "settings: regular file OK"

# Confirm the files have content:
test -s ~/.config/Code/User/keybindings.json && echo "keybindings: non-empty OK" || echo "FAIL: empty"
test -s ~/.config/Code/User/settings.json && echo "settings: non-empty OK" || echo "FAIL: empty"

# Confirm content matches the original source (use archive copy if originals are already deleted):
diff ~/.config/Code/User/keybindings.json /home/mjr/code/personal/dotfiles/vscode/keybindings.jsonc && echo "keybindings content: OK"
diff ~/.config/Code/User/settings.json /home/mjr/code/personal/dotfiles/vscode/settings.jsonc && echo "settings content: OK"
# NOTE: After Phase 4, the originals at vscode/ will be gone. For re-validation, use:
#   diff ~/.config/Code/User/keybindings.json /home/mjr/code/personal/dotfiles/archive/legacy/vscode/keybindings.jsonc
```

#### Expected State After Completion

- `~/.config/Code/User/keybindings.json` is a regular file with the same content as `vscode/keybindings.jsonc`
- `~/.config/Code/User/settings.json` is a regular file with the same content as `vscode/settings.jsonc`
- If VSCode is installed, it loads settings correctly (open VSCode and verify)
- The files are now fully decoupled from the dotfiles repo

### Phase 4: Delete Original Legacy Files

#### Pre-conditions

- ALL of Phases 1-3 are completed and verified
- New shells work correctly (Phase 2 verified)
- VSCode symlinks are materialized (Phase 3 verified)
- There is a clean fallback path: `pre-legacy-archive-backup` branch and git history

**Pre-deletion checklist (run all; every line must print OK):**

```bash
cd /home/mjr/code/personal/dotfiles

# Phase 1: Archive copies exist
test -f archive/legacy/bash/aesthetics.sh && echo "archive bash: OK" || echo "FAIL"
test -f archive/legacy/vscode/init.sh && echo "archive vscode: OK" || echo "FAIL"
test -f archive/legacy/blackbox/blackbox.sh && echo "archive blackbox: OK" || echo "FAIL"
test -f archive/legacy/tmux.conf && echo "archive tmux: OK" || echo "FAIL"

# Phase 2: Bashrc sources from archive
bash -li -c 'echo $BASHFILES_DIR' | grep -q 'archive/legacy/bash' && echo "bashrc rerouted: OK" || echo "FAIL"

# Phase 3: VSCode files are regular (not symlinks)
test ! -L ~/.config/Code/User/keybindings.json && echo "vscode keybindings delinked: OK" || echo "FAIL"
test ! -L ~/.config/Code/User/settings.json && echo "vscode settings delinked: OK" || echo "FAIL"
```

#### Tasks

**Step 4.1: Use `git rm` to delete original legacy files (preserves git history for the delete).**

```bash
cd /home/mjr/code/personal/dotfiles

git rm -rf bash/
git rm -rf vscode/
git rm -f tmux.conf
git rm -rf blackbox/
git rm -f init.vim
git rm -f run_once_before_10-install-starship.sh
git rm -f run_once_before_20-install-blesh.sh
git rm -f run_once_after_10-install-tpm.sh
```

> NOTE: Using `git rm` rather than plain `rm` stages the deletions for commit in Phase 5. This makes the commit atomic and the history clean. If you prefer unstaged deletions, use plain `rm -rf` and `git add -A` later, but `git rm` is cleaner.
>
> The following directories are NOT deleted (out of scope): `firefox/`, `tridactyl/`, `btrfs/`, `macos/`. They remain at the repo root.

#### Validation

```bash
cd /home/mjr/code/personal/dotfiles

# Verify deleted directories are gone:
for d in bash vscode blackbox; do
  test -d "$d" && echo "FAIL: $d still exists" || echo "$d removed: OK"
done

# Verify deleted files are gone:
for f in tmux.conf init.vim run_once_before_10-install-starship.sh run_once_before_20-install-blesh.sh run_once_after_10-install-tpm.sh; do
  test -f "$f" && echo "FAIL: $f still exists" || echo "$f removed: OK"
done

# Verify out-of-scope directories are still present:
for d in firefox tridactyl btrfs macos; do
  test -d "$d" && echo "$d still in place: OK" || echo "WARNING: $d missing (should not have been deleted)"
done

# Verify keep-files are still present:
for f in dot_bashrc dot_blerc dot_tmux.conf; do
  test -f "$f" && echo "$f present: OK" || echo "FAIL: $f missing"
done
test -d dot_config && echo "dot_config present: OK" || echo "FAIL: dot_config missing"
test -d archive && echo "archive present: OK" || echo "FAIL: archive missing"

# Critical: verify shell still works with originals gone:
bash -li -c 'echo "shell OK, BASHFILES_DIR=$BASHFILES_DIR"'
# Expected: shell OK, BASHFILES_DIR=/home/mjr/code/personal/dotfiles/archive/legacy/bash
```

#### Expected State After Completion

- Repo root contains modern files plus out-of-scope legacy dirs: `dot_bashrc`, `dot_blerc`, `dot_tmux.conf`, `dot_config/`, `archive/`, `firefox/`, `tridactyl/`, `btrfs/`, `macos/`, `.chezmoiignore`, `.devcontainer/`, `bin/`, `README.md`
- `git status` shows staged deletions (from `git rm`)
- Shells work correctly (sourcing from archive paths)

### Phase 5: Commit

#### Pre-conditions

- Phase 4 completed (original legacy files deleted and staged)
- `git status` shows only staged deletions and the `dot_bashrc` modification from Phase 2
- `archive/legacy/` directory is populated and intact

#### Tasks

**Step 5.1: Stage and commit.**

```bash
cd /home/mjr/code/personal/dotfiles
git add dot_bashrc archive/legacy/
# Note: the git rm deletions from Phase 4 are already staged.

git status
# Review carefully: should show dot_bashrc modified,
# archive/legacy/* added, and in-scope legacy files deleted.
# firefox/, tridactyl/, btrfs/, macos/ should NOT appear in the diff.

git commit -m "archive: move in-scope legacy config files to archive/legacy/

Move bash/, vscode/, tmux.conf, blackbox/, init.vim, and run_once_*
scripts to archive/legacy/. Update dot_bashrc to source from
archive/legacy/ paths.

Out of scope (remain at repo root): firefox/, tridactyl/, btrfs/, macos/.
Firefox config migration is tracked in a separate proposal.

System-side changes (not in this commit):
- VSCode symlinks materialized to regular files (Phase 3)
- ~/.bashrc updated to match dot_bashrc"
```

#### Validation

```bash
cd /home/mjr/code/personal/dotfiles

# Verify clean working tree:
git status
# Expected: "nothing to commit, working tree clean"

# Verify the commit contains the expected changes:
git show --stat HEAD
# Expected: files renamed/deleted for bash/, vscode/, blackbox/, tmux.conf, init.vim,
#           run_once_* scripts. dot_bashrc modified.
#           NO changes to firefox/, tridactyl/, btrfs/, macos/.

# Final end-to-end smoke test:
bash -li -c '
  echo "BASHFILES_DIR=$BASHFILES_DIR"
  echo "starship=$(command -v starship)"
  echo "blesh=$BLE_VERSION"
  type nametab 2>/dev/null && echo "vscode init: OK" || echo "vscode init: missing"
  echo "shell: OK"
'

# Verify tmux still works:
tmux new-session -d -s final-test 'sleep 1' && tmux kill-session -t final-test && echo "tmux: OK"

# Verify out-of-scope directories are untouched:
for d in firefox tridactyl btrfs macos; do
  test -d "$d" && echo "$d: still in place OK" || echo "WARNING: $d missing"
done
```

#### Expected State After Completion

- Single atomic commit captures the entire repo-side migration
- `git status` is clean
- Shell, tmux, and VSCode config all functional
- The dotfiles repo root contains: `dot_*`, `dot_config/`, `archive/`, `firefox/`, `tridactyl/`, `btrfs/`, `macos/`, `.chezmoiignore`, `.devcontainer/`, `bin/`, `README.md`

## Rollback Strategy

Use `git reflog` and manual fixup if needed. The `pre-legacy-archive-backup` branch from Phase 0 preserves the exact pre-migration state.

## Open Questions

1. **Should the `bash/bashrc` vs `dot_bashrc` divergence be reconciled?** The `bash/bashrc` has a pnpm PATH block that `dot_bashrc` lacks. Should `dot_bashrc` incorporate the pnpm block, or is it intentionally omitted? For this migration, the archive preserves `bash/bashrc` as-is, and `dot_bashrc` remains the source of truth.

2. **When to inline the sourced bash files?** The re-routing to `archive/legacy/` is an intermediate state. Eventually, the sourced files (`aesthetics.sh`, `completions.sh`, `prompt_and_history.sh`, `utils.sh`, `vscode/init.sh`, `blackbox/blackbox.sh`) should be inlined into `dot_bashrc` or otherwise consolidated. This is deferred to the nushell migration timeline.

3. **Should `~/.vscode/shell.sh` be removed?** It is a copy (not a link) and functional. If VSCode terminal integration depends on it, removing it would break that. Safest to leave it and document in the "left behind" report.

## Out of Scope Notes

The following directories were originally planned for archival but have been excluded from this migration:

- **`firefox/`**: Firefox config migration is being handled in a separate proposal. The existing Firefox chrome symlink (`~/.mozilla/firefox/h4hh8m1f.default-release/chrome` -> `firefox/`) remains unchanged.

- **`tridactyl/`**: Remains at repo root for now. The legacy `tridactyl/tridactylrc` is a duplicate of `dot_config/tridactyl/tridactylrc` but does not cause conflicts.

- **`btrfs/`**: Remains at repo root for now. Contains btrfs backup infrastructure (`btrbk_aws.tf`, `btrbk_config`) that is not actively referenced by any config being archived.

- **`macos/`**: Remains at repo root for now. The `macos/macos.sh` is still sourced by `dot_bashrc` on Darwin/FreeBSD platforms via the `case $(uname -s)` block. Since this migration does not change the macos source path, the existing behavior is preserved.
