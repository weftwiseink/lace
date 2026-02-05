---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T10:00:00-08:00
type: analysis
state: archived
status: done
tags: [chezmoi, dotfiles, migration, agent-workflows, research]
---

# Chezmoi Migration Research: Analysis for Dotfiles Repository

Research analysis for migrating `/home/mjr/code/personal/dotfiles/` from a custom symlink-based `setup.sh` to chezmoi, with focus on enabling a review step between agent changes and local application.

## BLUF (Bottom Line Up Front)

Chezmoi is well-suited for the migration with strong support for the desired review workflow via `chezmoi diff` and `chezmoi apply --dry-run --verbose`. The migration path from symlinks is straightforward using `chezmoi add --follow`. The key insight for agent-safe workflows: chezmoi's architecture naturally separates the "source state" (what the agent edits) from the "destination state" (what actually runs on your machine), with an explicit `apply` step required to bridge them.

## Context

### Current Setup Analysis

The existing `setup.sh` uses a `setup_symlink` function pattern:
- Creates symlinks from dotfiles repo to target locations (e.g., `bash/bashrc` -> `~/.bashrc`)
- Supports an `--overwrite` flag for replacing existing files
- Includes post-install hooks for dependencies (cargo install starship, git clone for blesh, etc.)
- Has platform-specific logic (macOS vs Linux via `uname -s`)
- Manages: bashrc, blerc, starship.toml, tmux.conf, firefox chrome/, tridactylrc, vscode configs

### Migration Motivation

The primary driver is introducing a **review step** between agent changes and local application. With the current symlink approach, any change to the source file is immediately reflected in the target. With chezmoi, changes to source files require an explicit `chezmoi apply` to take effect.

## Chezmoi Core Concepts

### Source State vs Target State vs Destination State

Understanding these three states is fundamental:

1. **Source State**: The desired state declared in `~/.local/share/chezmoi/` (the chezmoi repository). This is what you (or an agent) edits.

2. **Target State**: The computed desired state for the current machine. Source state + templates + machine-specific config = target state.

3. **Destination State**: The actual current state of files in your home directory.

The `chezmoi apply` command computes the target state and applies minimal changes to make the destination state match it.

### File Naming Conventions

Chezmoi uses filename prefixes to encode file attributes:

| Prefix | Effect |
|--------|--------|
| `dot_` | File starts with `.` in target |
| `executable_` | Sets executable permission |
| `private_` | Removes group/world permissions |
| `readonly_` | Removes write permissions |
| `encrypted_` | File is encrypted in source |
| `create_` | Only creates if target doesn't exist |
| `modify_` | Script that modifies existing content |
| `remove_` | Removes target file |
| `exact_` | (directories) Remove unlisted entries |
| `symlink_` | Creates a symlink instead of copying |
| `.tmpl` | File is a Go template |

Example: `dot_bashrc` becomes `~/.bashrc`, `executable_dot_local/bin/my-script` becomes `~/.local/bin/my-script` with execute permission.

### Templates

Templates use Go's `text/template` syntax with sprig extensions. Key variables:
- `.chezmoi.os` - operating system (darwin, linux, windows)
- `.chezmoi.arch` - architecture (amd64, arm64)
- `.chezmoi.hostname` - machine hostname
- Custom variables from `~/.config/chezmoi/chezmoi.toml`

```toml
# ~/.config/chezmoi/chezmoi.toml
[data]
email = "user@example.com"
machine_type = "personal"  # or "work"
```

```bash
# dot_gitconfig.tmpl
[user]
    email = {{ .email | quote }}
{{ if eq .machine_type "work" }}
    signingkey = ~/.ssh/work_key
{{ end }}
```

## Migration Strategy

### Phase 1: Initialize Chezmoi with Existing Files

```bash
# Initialize chezmoi (creates ~/.local/share/chezmoi)
chezmoi init

# For each symlinked file, use --follow to capture the actual content
chezmoi add --follow ~/.bashrc
chezmoi add --follow ~/.blerc
chezmoi add --follow ~/.config/starship.toml
chezmoi add --follow ~/.tmux.conf
# ... etc
```

The `--follow` flag is critical: it tells chezmoi to add the *target* of the symlink, not the symlink itself. After `chezmoi apply`, the symlink will be replaced with a regular file containing the same content.

### Phase 2: Convert Platform-Specific Logic to Templates

Current setup.sh logic:
```bash
case $(uname -s) in
  Darwin | FreeBSD) source "$DOTFILES_DIR/macos/setup.sh" ;;
  Linux) source "$DOTFILES_DIR/blackbox/setup.sh" ;;
esac
```

Chezmoi equivalent using `.chezmoiignore`:
```
# .chezmoiignore (this is a template)
{{- if ne .chezmoi.os "darwin" }}
.config/karabiner/
.slate.js
{{- end }}
{{- if ne .chezmoi.os "linux" }}
# Linux-specific files to ignore on non-Linux
{{- end }}
```

Or using conditionals within template files:
```bash
# dot_bashrc.tmpl
{{ if eq .chezmoi.os "darwin" -}}
export PATH="/opt/homebrew/bin:$PATH"
{{ else if eq .chezmoi.os "linux" -}}
export PATH="$HOME/.local/bin:$PATH"
{{ end -}}
```

### Phase 3: Convert Install Hooks to Scripts

Current setup.sh has post-install hooks:
```bash
function _install_bashrc_dependencies {
  cargo install starship --locked
}
setup_symlink bash/bashrc ~/.bashrc _install_bashrc_dependencies
```

Chezmoi equivalent using `run_once_` scripts:
```bash
# .chezmoiscripts/run_once_before_10-install-starship.sh
#!/bin/bash
if ! command -v starship &> /dev/null; then
    cargo install starship --locked
fi
```

Script naming conventions:
- `run_` - runs every apply
- `run_once_` - runs once per unique content (hash-tracked)
- `run_onchange_` - runs when content changes
- `before_` / `after_` - timing relative to file updates
- Numeric prefixes control order: `run_once_before_00-curl.sh` runs before `run_once_before_10-starship.sh`

### Phase 4: Git Repository Setup

```bash
# From within ~/.local/share/chezmoi
git init
git remote add origin git@github.com:username/dotfiles-chezmoi.git
git add .
git commit -m "Initial chezmoi migration"
git push -u origin main
```

Or migrate the existing repo:
```bash
# Option A: Use .chezmoiroot for gradual migration
# In existing dotfiles repo:
mkdir home
echo "home" > .chezmoiroot
chezmoi add --follow ~/.bashrc  # Goes into home/dot_bashrc

# Option B: Fresh start, archive old repo
mv ~/code/personal/dotfiles ~/code/personal/dotfiles-archive
chezmoi init --apply --source ~/.local/share/chezmoi
```

## Review Workflow Capabilities

### The Core Review Commands

```bash
# Preview what would change (equivalent to apply --dry-run --verbose)
chezmoi diff

# See what would happen without making changes
chezmoi apply --dry-run --verbose
# or shorthand:
chezmoi apply -nv

# Apply changes after review
chezmoi apply
```

### The `-n -v` Pattern

The combination of `-n` (dry-run) and `-v` (verbose) is the primary review mechanism:
- Shows exactly what files would be created/modified/deleted
- Shows content diffs for file changes
- Shows which scripts would run (without running them)
- Makes no actual changes to the destination directory

### Merge Conflict Resolution

When local changes exist that differ from source state:
```bash
# See differences
chezmoi diff ~/.bashrc

# Three-way merge using configured tool (vimdiff by default)
chezmoi merge ~/.bashrc

# Or selectively apply
chezmoi apply --include=files ~/.bashrc
```

## Agent-Safe Dotfile Management Patterns

### Pattern 1: Bind-Mount Source Directory (Recommended)

For agent workflows where the agent operates in a container with bind-mounted dotfiles:

```
Host filesystem:
  ~/.local/share/chezmoi/  <-- source state (bind-mounted into container)
  ~/.bashrc, ~/.config/... <-- destination state (NOT mounted)

Container:
  /workspace/dotfiles/     <-- bind mount of source state
  Agent edits files here
```

The agent edits the source state. Changes do NOT automatically apply to the host's destination state. The user reviews via:
```bash
# On host
chezmoi diff      # See what agent changed
chezmoi apply -nv # Dry-run to verify
chezmoi apply     # Apply if satisfied
```

This is the natural separation chezmoi provides - no additional tooling needed.

### Pattern 2: Git-Based Review

Agent commits changes to the source state:
```bash
# Agent workflow (in container or CI)
cd ~/.local/share/chezmoi
# ... make changes ...
git add -A
git commit -m "Update bashrc for new tool"
git push

# User workflow (on host)
chezmoi update --dry-run  # Pull and preview
chezmoi diff              # Review
chezmoi update            # Pull and apply
```

### Pattern 3: PR-Based Review

For maximum control, use a separate branch:
```bash
# Agent creates PR
git checkout -b agent/update-bashrc
# ... changes ...
git push origin agent/update-bashrc
gh pr create

# User reviews PR on GitHub, then:
chezmoi update  # After merge
```

### Auto-Commit/Auto-Push (Use with Caution)

Chezmoi supports automatic commits:
```toml
# ~/.config/chezmoi/chezmoi.toml
[git]
autoCommit = true
autoPush = true
```

For agent workflows, you likely want these **disabled** on the host to maintain manual control, but potentially enabled in the agent environment to capture all changes.

## Secrets Management

### Age Encryption (Recommended)

```bash
# Generate key
chezmoi age-keygen --output=$HOME/.config/chezmoi/key.txt

# Configure
# ~/.config/chezmoi/chezmoi.toml
encryption = "age"
[age]
    identity = "~/.config/chezmoi/key.txt"
    recipient = "age1..."  # public key from keygen output
```

```bash
# Add encrypted file
chezmoi add --encrypt ~/.ssh/config
```

Encrypted files are stored as `encrypted_dot_ssh/config` in source state. They're decrypted during `chezmoi apply`.

### Password Manager Integration

Chezmoi integrates with 1Password, Bitwarden, pass, and others:
```
# dot_gitconfig.tmpl
[user]
    signingkey = {{ onepasswordRead "op://Personal/GPG Key/private key" }}
```

### Best Practice for Agent Workflows

- Never commit unencrypted secrets
- Use `.chezmoiignore` to exclude sensitive files from agent-accessible source state
- Consider keeping secrets in a separate, non-agent-accessible chezmoi config

## Mapping Current Dotfiles to Chezmoi

| Current Path | Chezmoi Source | Notes |
|--------------|----------------|-------|
| `bash/bashrc` -> `~/.bashrc` | `dot_bashrc.tmpl` | Template for platform conditionals |
| `bash/blerc` -> `~/.blerc` | `dot_blerc` | Static file |
| `bash/starship.toml` -> `~/.config/starship.toml` | `dot_config/starship.toml` | Static file |
| `tmux.conf` -> `~/.tmux.conf` | `dot_tmux.conf` | Static file |
| `tridactyl/tridactylrc` -> `~/.config/tridactyl/tridactylrc` | `dot_config/tridactyl/tridactylrc` | Static file |
| `vscode/settings.jsonc` -> VSCode config | `dot_config/Code/User/settings.json` | Platform-dependent path |
| `firefox/` -> Firefox chrome/ | `.chezmoiexternal.toml` or direct | Consider if needed |

### Install Scripts Mapping

| Current Function | Chezmoi Script |
|------------------|----------------|
| `_install_bashrc_dependencies` (starship) | `run_once_before_10-install-starship.sh` |
| `_setup_blerc_dir` (blesh) | `run_once_before_20-install-blesh.sh` |
| `_install_tmux_plugins` (tpm) | `run_once_after_10-install-tpm.sh` |
| `_install_tridactyl_native` | `run_once_after_20-install-tridactyl-native.sh` |

## Underspecifications and Questions for User

1. **Firefox Profile Handling**: The current setup uses `$FIREFOX_PROFILE_DIR/chrome`. How is this variable determined? Is it consistent across machines? Consider whether to template this or use a fixed profile path.

2. **VSCode Config Path**: `$VSCODE_CONFIG_DIR` varies by platform (`~/.config/Code/User` on Linux, `~/Library/Application Support/Code/User` on macOS). Should chezmoi manage this with platform-specific paths, or is VSCode settings sync preferred?

3. **Secrets in Current Setup**: Are there any sensitive values in the current dotfiles that should be encrypted in chezmoi? (API tokens, SSH configs, etc.)

4. **Machine Classification**: How do you want to distinguish machines? By hostname, by a custom variable (personal/work), by OS? This affects template design.

5. **Migration Timing**: Do you want:
   - **Big bang**: Migrate everything at once, archive old repo
   - **Incremental**: Use `.chezmoiroot` to gradually migrate files while keeping the old structure working

6. **Agent Bind Mount Details**: What specific path would the agent container mount for dotfiles editing? This affects whether any path remapping is needed in chezmoi config.

7. **blesh Installation**: Current setup clones and builds blesh. Should this remain a `run_once_` script, or would you prefer using chezmoi's `external_` feature with `git-repo` type?

## Recommendations

1. **Start with Core Files**: Migrate bashrc, starship.toml, and tmux.conf first. These are the most frequently used and have the clearest mapping.

2. **Use Templates Sparingly**: Only add `.tmpl` suffix to files that genuinely need machine-specific content. Start with static files and add templating as needed.

3. **Keep `run_once_` Scripts Idempotent**: Always check if a tool/directory exists before installing. This makes scripts safe to re-run.

4. **Embrace the Review Workflow**: Make `chezmoi diff` part of your routine. Consider aliasing it:
   ```bash
   alias cdiff='chezmoi diff'
   alias capply='chezmoi apply'
   ```

5. **For Agent Integration**: The bind-mount approach with explicit `chezmoi apply` on the host provides the cleanest review boundary. No special tooling needed beyond chezmoi's native workflow.

6. **Document Machine Setup**: Create a `run_once_before_00-prerequisites.sh` that installs any tools chezmoi needs (curl, git) before other scripts run.

## Sources

- [Chezmoi Official Documentation](https://www.chezmoi.io/)
- [Chezmoi GitHub Repository](https://github.com/twpayne/chezmoi)
- [Migrating from Another Dotfile Manager](https://www.chezmoi.io/migrating-from-another-dotfile-manager/)
- [Chezmoi Design FAQ](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)
- [Chezmoi Templates](https://www.chezmoi.io/user-guide/templating/)
- [Chezmoi Scripts](https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/)
- [Chezmoi Age Encryption](https://www.chezmoi.io/user-guide/encryption/age/)
- [Chezmoi Application Order](https://www.chezmoi.io/reference/application-order/)
- [Chezmoi Concepts](https://www.chezmoi.io/reference/concepts/)
- [Chezmoi Daily Operations](https://www.chezmoi.io/user-guide/daily-operations/)
- [Chezmoi Machine-to-Machine Differences](https://www.chezmoi.io/user-guide/manage-machine-to-machine-differences/)
- [Chezmoi Include Files from Elsewhere](https://www.chezmoi.io/user-guide/include-files-from-elsewhere/)
- [Customize Source Directory (.chezmoiroot)](https://www.chezmoi.io/user-guide/advanced/customize-your-source-directory/)
