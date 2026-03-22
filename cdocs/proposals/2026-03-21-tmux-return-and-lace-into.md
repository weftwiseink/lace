---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T12:25:00-07:00
task_list: terminal-management/tmux-migration
type: proposal
state: archived
status: implementation_accepted
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T17:30:00-07:00
  round: 2
tags: [architecture, terminal_management, tmux, migration, lace_into]
---

# Return to tmux and Create lace-into

> BLUF: Replace the wezterm multiplexing layer with tmux in the dotfiles repo, modernizing the archived legacy tmux.conf (176 lines) with the "modern tmux" stack (tmux 3.6 + catppuccin + sesh + tmux-floax + smart-splits + tmux-resurrect/continuum).
>
> Create `lace-into` as a tmux-oriented replacement for `wez-into` (856 lines of bash), reusing the same `lace-discover` infrastructure and argument interface but targeting `tmux new-session`/`send-keys` instead of `wezterm cli spawn`.
>
> The legacy tmux.conf provides a strong foundation: Alt-z prefix, vim-aware smart pane navigation, Alt-HJKL splits, Alt-c copy mode, vscode session naming, and status bar hiding for nested contexts.
>
> These patterns carry forward with additions: pane titles via `pane-border-status`, nushell as default shell, catppuccin theme, and conditional UI for vscode/nested contexts.

## Summary

The companion reports ([Zellij Feasibility](../reports/2026-03-21-zellij-migration-feasibility.md), [tmux vs Zellij Decision](../reports/2026-03-21-tmux-vs-zellij-multiplexer-decision.md)) established tmux as the recommended multiplexer, primarily due to its unmatched copy mode (42 vim motions vs zellij's 8).


This proposal covers two deliverables:

1. **Dotfiles tmux config**: modernized chezmoi-managed `dot_config/tmux/tmux.conf` replacing the archived legacy config.
2. **lace-into**: a bash script in `bin/lace-into` replacing `bin/wez-into`, targeting tmux instead of wezterm for devcontainer connections.

Key design decisions:

- Nushell is the default shell (`set -g default-shell ~/.cargo/bin/nu`), continuing the current adoption trajectory.
- Pane titles and tab UI are enabled by default but conditionally hidden when nested inside vscode (preserving the existing `after-new-session` hook pattern from the legacy config).
- Wezterm remains as the host terminal emulator (already set up, works fine for rendering), but its multiplexing config is deleted, not deprecated. The wezterm config is stripped to a minimal "dumb terminal" config: font, theme, and keybindings that pass through to tmux. All mux, domain, plugin, and session logic is removed.
- `wez-into` and the wezterm-server devcontainer feature are deleted, not deprecated. Clean cuts over soft deprecations.

> NOTE(opus/terminal-management): This proposal does not cover host terminal emulator selection (ghostty, kitty, etc.).
> Wezterm stays as the host terminal for now. It can be replaced later without affecting the tmux layer.

## Objective

Replace the wezterm multiplexing layer with tmux across the dotfiles and lace repos, delivering:

1. Full vim copy mode (f/F/t/T, W/B/E, counts, visual modes, yank).
2. Session-per-project architecture with tmux session persistence.
3. A `lace-into` CLI tool for devcontainer connection that parallels `wez-into`'s interface.
4. Nushell-native tmux config with pane titles and modern UI.


## Background

### Legacy tmux.conf (`archive/legacy/tmux.conf`, 176 lines)

The archived config provides a proven keybinding scheme:

- **Prefix**: `Alt-z` (ergonomic, non-standard, avoids Ctrl-b)
- **Smart pane nav**: `Ctrl-h/j/k/l` with vim-awareness via `is_vim` shell check
- **Pane creation**: `Alt-H/J/K/L` with current path inheritance
- **Window nav**: `Alt-n/p` (next/prev), `Alt-N` (new)
- **Copy mode**: `Alt-c` entry, vi mode, `v` to begin selection, clipboard integration
- **Plugins**: TPM, sensible, battery, yank, resurrect, continuum
- **Theme**: Solarized dark, status bar at top, 2-line status
- **VSCode hook**: `after-new-session` hides status for sessions named `vscode*`
- **Shell**: `$SHELL` (was bash, now nushell)


### VSCode Shell Entrypoint (`archive/legacy/vscode/shell.sh`, 47 lines)

Creates per-workspace tmux sessions with deterministic naming: `vscode_{dir}_{hash}/0_tmux`.

Reuses unattached sessions, increments numbering for new ones.

`init.sh` provides session management helpers (`nametab`, `vscode_pack_sessions`).


### wez-into (`bin/wez-into`, 856 lines)

Mature bash script with:

- `lace-discover` integration for Docker container discovery
- SSH key and known-hosts management
- Three-tier connection fallback (ExecDomain > raw SSH spawn > wezterm connect)
- `--start` / `--rebuild` for container lifecycle
- `--list` / `--status` for discovery queries
- `--dry-run` for debugging
- Interactive fzf picker
- Duplicate tab detection
- Structured `LACE_RESULT` parsing for error diagnostics


### lace-discover (`bin/lace-discover`, 149 lines)

Stateless Docker query tool: filters containers by `devcontainer.local_folder` label, SSH port in 22425-22499 range.

Output: `name:port:user:path` (text) or JSON.

This tool is multiplexer-agnostic and carries forward unchanged.


## Proposed Solution

### 1. Dotfiles: tmux.conf

New file: `dot_config/tmux/tmux.conf` (chezmoi-managed).

The config preserves the legacy keybinding scheme while modernizing the plugin stack and adding pane titles.


#### Core Settings

```tmux
# Shell: nushell
set -g default-shell ~/.cargo/bin/nu
set -g default-command ~/.cargo/bin/nu

# History and timing
set -g history-limit 99999
set -s escape-time 10

# Prefix: Alt-z (carried forward from legacy)
set -g prefix M-z
unbind C-b
bind M-z send-prefix

# Mouse
set -g mouse on

# Vi mode
setw -g mode-keys vi

# Terminal features
set -g default-terminal "tmux-256color"
set -as terminal-features ',*:clipboard'
set -g set-clipboard on

# Titles
set -g set-titles on
```

#### Keybindings (Preserved from Legacy)

```tmux
# Smart pane navigation (vim-aware)
# These manual is_vim bindings serve as a fallback if smart-splits.nvim
# is not installed. When smart-splits IS configured with the tmux backend,
# it overrides these bindings with its own bidirectional navigation.
is_vim="ps -o state= -o comm= -t '#{pane_tty}' \
  | grep -iqE '^[^TXZ ]+ +(\\S+\\/)?g?(view|l?n?vim?x?)(diff)?$'"
bind -n C-h if-shell "$is_vim" "send-keys C-h" "select-pane -L"
bind -n C-j if-shell "$is_vim" "send-keys C-j" "select-pane -D"
bind -n C-k if-shell "$is_vim" "send-keys C-k" "select-pane -U"
bind -n C-l if-shell "$is_vim" "send-keys C-l" "select-pane -R"

# Pane creation with current path (preserved Alt-HJKL)
bind -n M-L split-window -h -c '#{pane_current_path}'
bind -n M-H split-window -h -c '#{pane_current_path}' \; swap-pane -U
bind -n M-J split-window -v -c '#{pane_current_path}'
bind -n M-K split-window -v -c '#{pane_current_path}' \; swap-pane -U

# Window management (preserved)
bind -n M-N new-window -c '#{pane_current_path}'
bind -n M-n next-window
bind -n M-p previous-window

# Command line
bind -n M-\; command-prompt

# Copy mode (preserved Alt-c entry, enhanced bindings)
# Clipboard handled by tmux-yank plugin (auto-detects wl-copy/xclip/pbcopy).
# Manual copy-pipe bindings removed to avoid conflict with tmux-yank.
bind -n M-c copy-mode
bind -T copy-mode-vi v send-keys -X begin-selection
bind -T copy-mode-vi V send-keys -X select-line
bind -T copy-mode-vi C-v send-keys -X rectangle-toggle
```

#### Pane Titles (New)

```tmux
# Display pane titles in borders
set -g pane-border-status top
set -g pane-border-format " #{pane_title} "

# Pane border colors (solarized-inspired, refined by catppuccin)
set -g pane-border-style fg=colour238
set -g pane-active-border-style fg=colour75
```

#### Conditional UI for VSCode/Nested Contexts

```tmux
# Hide status bar and pane borders when nested in vscode
# Preserves legacy pattern: sessions starting with "vscode" get minimal UI
set-hook -g after-new-session {
  if-shell 'echo "#{session_name}" | grep -iqE "^vscode"' \
    "set status off; set pane-border-status off" \
    "set status on; set pane-border-status top"
}

# Also respect TMUX_NESTED env var for other nesting scenarios
if-shell '[ -n "$TMUX_NESTED" ]' \
  "set status off; set pane-border-status off"
```

#### Plugin Stack

```tmux
set -g @plugin 'tmux-plugins/tpm'
set -g @plugin 'tmux-plugins/tmux-sensible'
set -g @plugin 'tmux-plugins/tmux-yank'
set -g @plugin 'tmux-plugins/tmux-resurrect'
set -g @plugin 'tmux-plugins/tmux-continuum'
set -g @plugin 'fcsonline/tmux-thumbs'
set -g @plugin 'omerxx/tmux-floax'
set -g @plugin 'catppuccin/tmux'
set -g @plugin 'b0o/tmux-autoreload'

# Resurrect + continuum
set -g @continuum-restore 'on'
set -g @continuum-save-interval '15'

# Catppuccin theme (mocha flavor)
# Replaces the hand-rolled solarized dark theme from the legacy config.
# Reasons for switching:
#   - Modular status bar: battery, CPU, session, git modules via config, not format strings
#   - Active maintenance: catppuccin/tmux is the most popular tmux theme (5k+ stars)
#   - Consistent palette across tools: catppuccin has ports for neovim, bat, fzf, etc.
#   - The legacy theme was ~30 lines of manual set-option color assignments
set -g @catppuccin_flavor 'mocha'
set -g @catppuccin_window_status_style 'rounded'

# Floax
set -g @floax-bind 'M-f'

# Status bar position (top, like legacy)
set -g status-position top

# Initialize TPM (must be last)
run '~/.tmux/plugins/tpm/tpm'
```

#### Chezmoi Structure

```
dot_config/
  tmux/
    tmux.conf           # Main config
```

TPM and plugins are installed at runtime (`~/.tmux/plugins/`) and not checked into dotfiles.

A `run_once_after_20-install-tpm.sh` chezmoi script bootstraps TPM if absent.


### 2. lace-into

New file: `bin/lace-into` replacing `bin/wez-into`.

#### Interface (Preserved from wez-into)


```
lace-into                       Interactive picker (fzf or bash select)
lace-into <project>             Connect to named project
lace-into --start <project>     Start a stopped container, then connect
lace-into --start               Pick from stopped containers to start
lace-into --start --rebuild <p> Full rebuild, then connect
lace-into --list                List running project names
lace-into --status              Show running projects table
lace-into --dry-run <project>   Print tmux commands without executing
lace-into --help                Show help
```

#### Connection Model

Instead of wez-into's three-tier wezterm fallback, lace-into uses a single connection model:


1. **Create or attach to a named tmux session** for the project.
2. **Create windows with SSH panes** to the container.
3. **Set pane titles** to meaningful names.

```bash
do_connect() {
  local project="$1"
  local port="$2"
  local user
  user=$(resolve_user_for_port "$port")

  # SSH connection args (reused across panes)
  local ssh_base=(
    ssh
    -o "IdentityFile=$LACE_SSH_KEY"
    -o "IdentitiesOnly=yes"
    -o "UserKnownHostsFile=$LACE_KNOWN_HOSTS"
    -o "StrictHostKeyChecking=no"
    -o "ControlMaster=auto"
    -o "ControlPath=$HOME/.ssh/lace-ctrl-%C"
    -o "ControlPersist=600"
    -t
    -p "$port"
    "${user}@localhost"
  )

  # Check for existing session.
  # Verify the session's @lace_port matches to avoid name collisions.
  if tmux has-session -t "=$project" 2>/dev/null; then
    local existing_port
    existing_port=$(tmux show-option -t "=$project" -qv @lace_port 2>/dev/null)
    if [ "$existing_port" = "$port" ] || [ -z "$existing_port" ]; then
      info "attaching to existing session: $project"
      if [ -n "$TMUX" ]; then
        tmux switch-client -t "=$project"
      else
        exec tmux attach-session -t "=$project"
      fi
      return 0
    else
      # Port mismatch: disambiguate session name
      project="${project}-${port}"
      info "session name conflict, using: $project"
    fi
  fi

  # Create new session with SSH pane
  refresh_host_key "$port"

  tmux new-session -d -s "$project" -e "LACE_PORT=$port" "${ssh_base[@]}"
  tmux set-option -t "$project" remain-on-exit on
  tmux select-pane -t "$project" -T "shell"

  # Store the container port as a session-level user option for split automation.
  tmux set-option -t "$project" @lace_port "$port"
  tmux set-option -t "$project" @lace_user "$user"

  if [ -n "$TMUX" ]; then
    tmux switch-client -t "=$project"
  else
    exec tmux attach-session -t "=$project"
  fi
}
```

#### Key Differences from wez-into

| Aspect | wez-into | lace-into |

|--------|----------|-----------|
| Multiplexer | wezterm CLI (spawn, set-tab-title) | tmux (new-session, send-keys, select-pane -T) |
| Connection | ExecDomain > raw SSH > wezterm connect | tmux session with SSH command pane |
| Duplicate detection | wezterm CLI list + python3 JSON parse | `tmux has-session -t "=$project"` |
| Session reuse | Tab activation in existing window | `tmux switch-client` or `tmux attach` |
| Split inheritance | ExecDomain identity (automatic) | SSH ControlMaster (shared TCP connection) |
| Dependencies | wezterm, python3 | tmux, ssh |
| Host key mgmt | Identical | Identical (refresh_host_key carries forward) |
| Discovery | lace-discover (identical) | lace-discover (identical) |
| Start/rebuild | lace up (identical) | lace up (identical) |
| Picker | fzf with wezterm formatting | fzf with tmux formatting |

#### What Carries Forward Unchanged

These components from wez-into are multiplexer-agnostic and transfer directly:

- `LACE_KNOWN_HOSTS` / `LACE_SSH_KEY` constants
- `locate_lace_cli()` / `verify_lace_cli()` functions
- `discover()` / `discover_stopped()` helpers
- `refresh_host_key()` SSH key management
- `resolve_user_for_port()` user resolution
- `start_and_connect()` container lifecycle (minus `do_connect` call at the end)
- All argument parsing (`--start`, `--rebuild`, `--list`, `--status`, `--dry-run`, `--help`)
- Interactive picker (fzf and bash-select fallback)
- Error handling and diagnostics (LACE_RESULT parsing, retry loop)

Estimated reuse: ~600 of 856 lines carry forward with minimal modification.

The main rewrite is `do_connect()` (~90 lines wezterm-specific, replaced with ~40 lines tmux-specific).


#### SSH ControlMaster for Split Inheritance

wez-into's ExecDomain gave "free" split inheritance: all splits in a tab automatically SSH'd to the same container.

With tmux, this is achieved via SSH `ControlMaster`:


```
-o "ControlMaster=auto"
-o "ControlPath=$HOME/.ssh/lace-ctrl-%C"
-o "ControlPersist=600"
```

New splits created via `Alt-H/J/K/L` inherit the current pane's working directory and shell.

Since the shell is an SSH session, the new pane runs a new SSH connection that reuses the existing ControlMaster socket, making it nearly instant.


ControlMaster does not give true domain identity like ExecDomains.
New panes created via `Alt-H/J/K/L` land in a local nushell shell, not the container.
This is addressed by a `lace-split` keybinding added in Phase 2 (see below).

#### lace-split: Auto-SSH Splits

lace-into stores the container port and user as tmux session-level user options (`@lace_port`, `@lace_user`) when creating a session.
The tmux.conf includes a `lace-split` keybinding that reads these options and SSHs into the container automatically:

```tmux
# lace-split: create a new split that auto-SSHs into the current session's container.
# Only active in sessions created by lace-into (those with @lace_port set).
bind -n M-S run-shell '\
  port=$(tmux show-option -qv @lace_port); \
  user=$(tmux show-option -qv @lace_user); \
  if [ -n "$port" ]; then \
    tmux split-window -h \
      "ssh -o IdentityFile=$HOME/.config/lace/ssh/id_ed25519 \
           -o IdentitiesOnly=yes \
           -o UserKnownHostsFile=$HOME/.ssh/lace_known_hosts \
           -o StrictHostKeyChecking=no \
           -o ControlMaster=auto \
           -o \"ControlPath=$HOME/.ssh/lace-ctrl-%C\" \
           -o ControlPersist=600 \
           -t -p $port ${user:-node}@localhost"; \
  else \
    tmux split-window -h -c "#{pane_current_path}"; \
  fi'
```

The existing `Alt-H/J/K/L` bindings remain for local splits.
`Alt-S` provides container-aware splits in lace-into sessions.
In non-lace sessions (where `@lace_port` is unset), `Alt-S` falls back to a normal local split.

## Important Design Decisions

### Alt-z Prefix (Preserved)

The legacy config used `Alt-z` as the tmux prefix.

This is non-standard (most configs use `Ctrl-a` or `Ctrl-b`) but ergonomic and avoids conflicts with terminal apps.

The wezterm config also used `Alt-z` as the leader key.

Preserving this maintains muscle memory across the migration.


### Nushell as Default Shell

The current workflow has adopted nushell.

Setting `default-shell` and `default-command` to nushell means new panes and windows launch nushell directly.

The nushell config (`dot_config/nushell/`) requires updates to remove wezterm-specific hooks (OSC 1337 session persistence) and add tmux-aware equivalents.


> TODO(opus/terminal-management): The nushell `wez-session.nu` module needs a tmux equivalent for session save/restore.
> tmux-resurrect handles this at the tmux level, so the nushell module may become unnecessary.

### Pane Titles Enabled by Default

The legacy config did not use pane titles (they were excluded for vscode nesting compatibility).

The new config enables `pane-border-status top` by default, showing `#{pane_title}` in pane borders.

The `after-new-session` hook disables this for vscode-named sessions, preserving compatibility.

lace-into sets pane titles via `tmux select-pane -T "name"` when creating project sessions.


### Conditional UI for Nested Contexts

The legacy `after-new-session` hook checked for `vscode*` session names and hid the status bar.

This pattern is preserved and extended:

- `vscode*` sessions: status bar off, pane borders off
- `$TMUX_NESTED` env var: status bar off, pane borders off (future-proofing)
- All other sessions: full UI with status bar and pane titles


### SSH ControlMaster Instead of ExecDomains

wez-into relied on wezterm ExecDomains for transparent SSH routing in splits.

tmux has no equivalent concept.

SSH `ControlMaster` provides connection multiplexing (shared TCP connection) but not automatic SSH routing for new panes.

This is a known trade-off accepted in the migration.

New splits require the user to SSH manually (or use a keybinding/alias).

A future enhancement could add a tmux keybinding that automatically SSHs into the container of the current session.


## Edge Cases / Challenging Scenarios

### Container Restart Mid-Session

If a container restarts, SSH connections in existing panes die.

tmux-resurrect saves the session layout but cannot restore SSH connections.

The user must manually reconnect each pane or run `lace-into <project>` to get a fresh session.

Mitigation: `remain-on-exit on` preserves the pane and session layout when SSH dies, showing a "Pane is dead" message.
The user can respawn the pane with `prefix + R` (tmux `respawn-pane`) to reconnect.

> NOTE(opus/terminal-management): SSH `ControlPersist=600` keeps the master socket alive for 10 minutes after the last *multiplexed* client disconnects voluntarily.
> It does not help when the remote host goes away (the TCP connection breaks regardless).


### Multiple Panes to Same Container

SSH ControlMaster ensures all panes sharing a session reuse one TCP connection.

If the master connection dies, all dependent panes lose connectivity simultaneously.

Mitigation: `ServerAliveInterval=30` and `ServerAliveCountMax=3` in SSH config detect dead connections within 90 seconds.


### tmux Already Running (Attach vs Switch)

lace-into must handle two cases:

- Called from outside tmux: `tmux attach-session -t "$project"`
- Called from inside tmux: `tmux switch-client -t "$project"`

The `$TMUX` env var distinguishes these.


### Session Name Conflicts

Project names come from Docker labels or directory basenames.

If two containers have the same project name, the second `lace-into` call attaches to the first session.

Mitigation: `lace-into` checks if the existing session's SSH port matches the requested project.

If not, it creates a session with a disambiguated name (e.g., `project-22426`).


## Known Limitations

1. **No true domain identity for splits**: `Alt-H/J/K/L` splits open local shells, not container shells. `Alt-S` (lace-split) provides container-aware splits, but the user must learn a new keybinding. This is a conscious trade-off: tmux has no equivalent to wezterm ExecDomains.
2. **Session resurrection does not restore SSH connections**: tmux-resurrect saves layout and working directories, but SSH commands are serialized as shell commands. On restore, panes show "Press ENTER to run..." (with `@resurrect-processes` config) or are dead. The user must manually reconnect or run `lace-into` again.
3. **No battery indicator**: The legacy status bar included `#{battery_percentage}`. The catppuccin theme replaces this with its own module system. Battery can be re-added via catppuccin's battery module if needed.

## Test Plan

### tmux.conf Verification

1. **Keybindings**: verify all preserved bindings (Alt-z prefix, Ctrl-hjkl nav, Alt-HJKL splits, Alt-np windows, Alt-c copy mode).
2. **Smart-splits**: verify vim-aware pane navigation works bidirectionally with neovim.
3. **Copy mode**: verify v/V/Ctrl-v selection, y yank, f/F/t/T char find, counts, marks.
4. **Pane titles**: verify `select-pane -T` displays in borders.
5. **Conditional UI**: create a session named `vscode_test` and verify status bar and pane borders are hidden.
   Create a normal session and verify they are shown.
6. **Plugins**: verify TPM installs all plugins, resurrect saves/restores, continuum auto-saves.
7. **Nushell**: verify new panes launch nushell, not bash.
8. **Floax**: verify `Alt-f` toggles floating scratchpad.
9. **Theme**: verify catppuccin mocha renders correctly with solarized-compatible colors.


### lace-into Verification

1. **`lace-into --list`**: verify output matches `wez-into --list`.
2. **`lace-into --status`**: verify table format matches `wez-into --status`.
3. **`lace-into <project>`**: verify tmux session is created with SSH pane to container, pane title is set.
4. **`lace-into <project>` (duplicate)**: verify existing session is attached/switched to (not duplicated).
5. **`lace-into --start <project>`**: verify stopped container starts and connects.
6. **`lace-into --start --rebuild <project>`**: verify rebuild + connect.
7. **`lace-into --dry-run <project>`**: verify tmux commands are printed without executing.
8. **`lace-into` (interactive)**: verify fzf picker works, selection connects.
9. **Inside tmux**: verify `switch-client` is used instead of `attach-session`.
10. **Outside tmux**: verify `attach-session` is used with `exec`.
11. **Container restart**: verify pane shows "Pane is dead" (not silent disappearance), session layout preserved.
12. **tmux server not running**: verify `lace-into` auto-starts the tmux server (implicit in `tmux new-session`).
13. **Concurrent calls**: run `lace-into project` twice simultaneously, verify no duplicate sessions (second call attaches to the first).
14. **lace-split in non-lace session**: verify `Alt-S` falls back to local split when `@lace_port` is unset.


## Implementation Phases

### Phase 1: tmux.conf in Dotfiles

**Scope**: Create `dot_config/tmux/tmux.conf` in the dotfiles repo.

Create `run_once_after_20-install-tpm.sh` for TPM bootstrapping.


**Steps**:

1. Create `dot_config/tmux/tmux.conf` with the full config as specified in Proposed Solution.
2. Create `run_once_after_20-install-tpm.sh` that clones TPM if `~/.tmux/plugins/tpm` doesn't exist.
3. Apply chezmoi and verify tmux launches with correct settings.
4. Run through the tmux.conf test plan items 1-9.

4. Strip the wezterm config (`dot_config/wezterm/wezterm.lua`) to a minimal "dumb terminal" config: font, theme, basic settings. Remove all mux domains, plugin loading (lace.wezterm, resurrect.wezterm), ExecDomains, SSH domain pre-registration, smart-splits IPC, Unix domain mux, and session logic. Wezterm becomes a rendering-only terminal.
5. Archive the Slate/solarized theme from the wezterm config to `archive/themes/slate-solarized.lua` before stripping. The theme palette is useful reference material and may be adapted for catppuccin customization or a future terminal emulator switch.

**Constraints**: Do not modify or delete the legacy `archive/legacy/tmux.conf` (it is reference material).

**Success criteria**: tmux launches with nushell, all keybindings work, pane titles display, vscode hook hides UI, plugins install and function. Wezterm launches as a dumb terminal with no multiplexing.


### Phase 2: lace-into Script

**Scope**: Create `bin/lace-into` in the lace repo.
Delete `bin/wez-into`.

**Steps**:

1. Copy `bin/wez-into` to `bin/lace-into`.
2. Replace the `do_connect()` function with the tmux-oriented version.
3. Update help text, script name references, and dry-run output.
4. Remove wezterm-specific code (XKB_LOG_LEVEL, python3 pane listing, ExecDomain/mux domain references).
5. Add SSH ControlMaster options to ssh_args.
6. Add `$TMUX` detection for attach vs switch-client.
7. Add session existence check via `tmux has-session`.
8. Update duplicate detection to use `tmux has-session` instead of wezterm CLI list.
9. Store `@lace_port` and `@lace_user` session options in `do_connect()` for the lace-split keybinding.
10. Add the `lace-split` keybinding (`Alt-S`) to `dot_config/tmux/tmux.conf` (reads `@lace_port`/`@lace_user` to auto-SSH splits).
11. Run through the lace-into test plan items 1-14.

11. Delete `bin/wez-into` after lace-into passes all tests.

**Constraints**: Do not modify `bin/lace-discover`.
Do not modify devcontainer features yet (Phase 4).

**Success criteria**: `lace-into <project>` creates a tmux session with an SSH pane to the container.
All `wez-into` flags work equivalently.
Interactive picker functions.


### Phase 3: Nushell Config Updates

**Scope**: Update nushell config in dotfiles to remove wezterm-specific hooks and add tmux-aware equivalents.

**Steps**:

1. Delete the `wez-session.nu` module (OSC 1337 IPC is wezterm-specific, no longer needed).
2. Delete the wezterm session restoration pre-prompt hook from `config.nu`.
3. Add a tmux-aware startup hook: if inside tmux, source tmux-specific aliases/completions.
4. Add `alias sshc` or similar convenience for SSH ControlMaster reconnection.
5. Verify nushell starts cleanly in tmux without wezterm errors.

**Constraints**: Do not break nushell when running outside tmux.

**Success criteria**: nushell starts cleanly in tmux.
No wezterm-related errors or dead references.
`wez-session.nu` is deleted.


### Phase 4: Cleanup and Integration Testing

**Scope**: Delete wezterm-server devcontainer feature, clean up lace.wezterm references, end-to-end testing.

**Steps**:

1. Delete the wezterm-server devcontainer feature (`devcontainers/features/src/wezterm-server/`).
2. Remove the wezterm-server feature reference from `.devcontainer/devcontainer.json`.
3. Delete or archive `lace.wezterm` plugin repo (coordinate with dotfiles repo).
4. Remove wezterm-related test files (`packages/lace/src/__tests__/wezterm-server-scenarios.test.ts`).
5. Full workflow test: `lace-into --start <project>` from cold state, verify session creation, pane titles, copy mode, smart-splits.
6. Test session persistence: kill tmux server, restart, verify resurrect restores sessions.
7. Test conditional UI: start a `vscode_test` session, verify minimal UI.
8. Add `lace-into` to PATH via the same mechanism as wez-into was (co-located in `bin/`, found via `$SCRIPT_DIR`).

**Constraints**: Keep sshd devcontainer feature (still needed for tmux SSH panes).

**Success criteria**: Complete lace-into workflow functions end-to-end.
tmux session persistence works across server restarts.
No wezterm-server, wez-into, or lace.wezterm references remain in active code.

