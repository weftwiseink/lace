---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T12:08:00-08:00
task_list: dotfiles/nushell-migration
type: proposal
state: live
status: review_ready
tags: [nushell, dotfiles, shell, vi-mode, starship, chezmoi, migration]
parent: cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:15:00-08:00
  round: 3
---

# Nushell Configuration Setup for Dotfiles

> BLUF: Set up nushell as the primary interactive shell, replacing the archived bash/ble.sh setup. The configuration preserves core preferences (vi-mode, solarized dark, starship, large history, safety aliases) while adopting nushell idioms -- structured pipelines, SQLite history, reedline, and carapace completions. The modular file layout (`dot_config/nushell/` with `scripts/` directory) is chezmoi-managed; bash remains available for scripting. Depends on the [archive migration](2026-02-05-dotfiles-legacy-archive-clean.md) being complete and adds carapace as a new dependency.

## Objective

Establish a nushell configuration that:

1. Preserves the ergonomics and preferences from the archived bash/ble.sh setup (vi-mode, solarized dark, starship, safety aliases, large history)
2. Uses nushell idioms rather than translating bash line-for-line
3. Stays modular and maintainable within the chezmoi-managed dotfiles
4. Provides a foundation for nushell-native workflows (structured pipelines, typed commands, rich completions)

## Background

### Archived Shell Stack

The previous bash setup has been archived to `archive/legacy/bash/` per the [archive migration proposal](2026-02-05-dotfiles-legacy-archive-clean.md). The archived configuration serves as reference for what to port:

| Component | Tool | Archive Location |
|-----------|------|------------------|
| Shell | bash | `archive/legacy/bash/bashrc` |
| Line editor | ble.sh | `archive/legacy/bash/` (referenced in bashrc) |
| Prompt | starship | `dot_config/starship.toml` (still active, shared) |
| Completions | bash-completion + fzf | `archive/legacy/bash/completions.sh` |
| History | flat file | `archive/legacy/bash/prompt_and_history.sh` |
| Aesthetics | ANSI/FZF/LESS colors | `archive/legacy/bash/aesthetics.sh` |
| Utilities | shell functions | `archive/legacy/bash/utils.sh` |

### Why Nushell

Nushell offers structural advantages over bash for interactive use:
- **Structured data**: commands return tables/records, not text streams. `ls | where size > 10mb` replaces `ls -la | awk '$5 > 10000000'`.
- **Type safety**: commands have typed parameters with built-in help.
- **SQLite history**: searchable structured history with per-session isolation and cross-session sharing.
- **Built-in viewers**: tables, JSON, YAML rendered with colors automatically.
- **Reedline**: modern line editor with vi-mode, syntax highlighting, completions menus.

### Nushell Version

Nushell v0.110.0 is installed and available:

```
$ nu --version
0.110.0
```

> NOTE: Nushell has historically made breaking configuration changes between minor releases (e.g., `$env.config` record structure changes, command renames). After upgrading nushell, check the [release notes](https://www.nushell.sh/blog/) and [migration guide](https://www.nushell.sh/book/configuration.html) for any config adjustments needed.

## Proposed Solution

### File Structure

All nushell configuration lives under `dot_config/nushell/` in the dotfiles repo, mapping to `~/.config/nushell/` on the host via chezmoi.

```
dot_config/nushell/
  env.nu                    # Environment variables, PATH, starship env
  config.nu                 # Core config: sources scripts, sets $env.config
  login.nu                  # Login shell extras (tmux auto-start)
  scripts/
    aliases.nu              # Safety aliases, convenience aliases
    colors.nu               # Solarized dark color_config for nushell tables
    completions.nu          # Carapace setup + custom completions
    hooks.nu                # Full history logging, pre_prompt
    keybindings.nu          # Vi-mode keybinding customizations
    utils.nu                # Utility commands (ssh-del, showip, extract, etc.)
```

> NOTE: Nushell's `$nu.default-config-dir` points to `~/.config/nushell/` on Linux. The `scripts/` subdirectory is loaded via `source` statements in `config.nu`. An alternative is to use nushell's autoload dirs, but explicit sourcing makes the load order clear and keeps the config self-documenting.

### env.nu -- Environment Setup

```nu
# env.nu -- loaded first, before config.nu

# Core environment
$env.EDITOR = "nvim"
$env.VISUAL = "nvim"
$env.PAGER = "less"
$env.LESS = "-R"
$env.LANG = ($env.LANG? | default "en_US.UTF-8")

# XDG
$env.XDG_CONFIG_HOME = ($env.HOME | path join ".config")

# PATH management
use std/util "path add"
path add "~/.local/bin"
path add "~/.cargo/bin"
path add "/opt/local/bin"

# FZF solarized dark (still used for ad-hoc fzf invocations)
$env.FZF_DEFAULT_OPTS = ([
  "--color=bg+:#073642,bg:#002b36,spinner:#2aa198,hl:#268bd2"
  "--color=fg:#839496,header:#268bd2,info:#b58900,pointer:#2aa198"
  "--color=marker:#2aa198,fg+:#eee8d5,prompt:#b58900,hl+:#268bd2"
] | str join " ")

# LESS colors (man page highlighting)
# NOTE: These use char escape to produce CSI sequences (\e[...).
# Verify during implementation that the escape codes render correctly in `man`.
$env.LESS_TERMCAP_mb = $"(char escape)[01;31m"
$env.LESS_TERMCAP_md = $"(char escape)[01;31m"
$env.LESS_TERMCAP_me = $"(char escape)[0m"
$env.LESS_TERMCAP_se = $"(char escape)[0m"
$env.LESS_TERMCAP_so = $"(char escape)[01;44;33m"
$env.LESS_TERMCAP_ue = $"(char escape)[0m"
$env.LESS_TERMCAP_us = $"(char escape)[01;32m"

# Hostname (cached for use in pre_execution hook -- avoids calling sys host on every command)
$env._HOSTNAME = (sys host | get hostname)

# Starship
$env.STARSHIP_SHELL = "nu"

# Carapace (if installed)
if (which carapace | is-not-empty) {
  $env.CARAPACE_BRIDGES = "zsh,fish,bash,inshellisense"
  mkdir ~/.cache/carapace
  carapace _carapace nushell | save -f ~/.cache/carapace/init.nu
}

# Starship init (generates vendor autoload file)
if (which starship | is-not-empty) {
  mkdir ($nu.data-dir | path join "vendor/autoload")
  starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
}
```

### config.nu -- Core Configuration

```nu
# config.nu -- loaded after env.nu

# ── Disable banner ──
$env.config.show_banner = false

# ── Editor ──
$env.config.buffer_editor = "nvim"

# ── Vi mode ──
$env.config.edit_mode = "vi"
$env.config.cursor_shape = {
  vi_insert: line
  vi_normal: block
  emacs: line
}

# ── History (SQLite, 1M entries, shared across sessions) ──
$env.config.history.file_format = "sqlite"
$env.config.history.max_size = 1_000_000
$env.config.history.sync_on_enter = true
$env.config.history.isolation = false

# ── Completions ──
$env.config.completions.case_sensitive = false
$env.config.completions.quick = true
$env.config.completions.partial = true
$env.config.completions.algorithm = "fuzzy"
$env.config.completions.use_ls_colors = true

# ── Prompt indicators (starship handles the main prompt) ──
$env.PROMPT_INDICATOR_VI_INSERT = ": "
$env.PROMPT_INDICATOR_VI_NORMAL = "> "
$env.PROMPT_MULTILINE_INDICATOR = "::: "

# ── Source modular config scripts ──
# All six scripts must exist (nushell's source is a parse-time keyword).
source ($nu.default-config-dir | path join "scripts/aliases.nu")
source ($nu.default-config-dir | path join "scripts/colors.nu")
source ($nu.default-config-dir | path join "scripts/completions.nu")
source ($nu.default-config-dir | path join "scripts/hooks.nu")
source ($nu.default-config-dir | path join "scripts/keybindings.nu")
source ($nu.default-config-dir | path join "scripts/utils.nu")
```

### scripts/aliases.nu -- Aliases

```nu
# Safety aliases (nushell's rm already uses trash by default,
# but these cover the external command variants)
alias crm = ^rm -i     # "careful rm" -- interactive external rm
alias cmv = ^mv -i     # "careful mv"
alias ccp = ^cp -i     # "careful cp"

# ls variants (nushell's built-in ls returns structured data;
# these aliases are for the external ls when you want classic output)
alias lse = ^ls --color=always -hF
alias lle = ^ls --color=always -hlF
alias lsd = ^ls --color=always -hdlF */

# Nushell-native ls is already excellent for interactive use:
#   ls | sort-by size | reverse    -- sort by size descending
#   ls | where type == dir         -- directories only
#   ls **/*.rs                     -- recursive glob

# Editor
alias vim = ^nvim

# Quick exit (vi habit)
alias ':q' = exit

# Disk usage
alias duf = ^df -h
alias duh = ^du -h -c
```

> NOTE: Nushell's built-in `rm` command has a `--trash` flag (enabled by default in some builds) and a `--permanent` flag. The safety story is different from bash: nushell does not clobber by default in many operations. The `crm`/`cmv`/`ccp` aliases prefix with "c" for "careful" to avoid shadowing nushell builtins while preserving muscle memory for cautious file operations via external commands.

### scripts/colors.nu -- Solarized Dark Theme

```nu
# Solarized dark color configuration for nushell table rendering
# Reference: https://ethanschoonover.com/solarized/

let solarized_dark = {
  separator: dark_gray
  leading_trailing_space_bg: { attr: n }
  header: { fg: "#b58900" attr: b }         # yellow, bold
  empty: "#586e75"                           # base01
  bool: "#2aa198"                            # cyan
  int: "#268bd2"                             # blue
  float: "#268bd2"                           # blue
  filesize: "#2aa198"                        # cyan
  duration: "#2aa198"                        # cyan
  date: "#6c71c4"                            # violet
  range: "#268bd2"                           # blue
  string: "#839496"                          # base0 (default fg)
  nothing: "#586e75"                         # base01
  binary: "#6c71c4"                          # violet
  cell_path: "#839496"                       # base0
  row_index: { fg: "#859900" attr: b }       # green, bold
  record: "#839496"                          # base0
  list: "#839496"                            # base0
  block: "#839496"                           # base0
  hints: "#586e75"                           # base01
  search_result: { fg: "#002b36" bg: "#b58900" } # base03 on yellow

  shape_and: { fg: "#6c71c4" attr: b }
  shape_binary: { fg: "#6c71c4" attr: b }
  shape_block: { fg: "#268bd2" attr: b }
  shape_bool: "#2aa198"
  shape_closure: { fg: "#859900" attr: b }
  shape_custom: "#859900"
  shape_datetime: { fg: "#2aa198" attr: b }
  shape_directory: "#2aa198"
  shape_external: "#2aa198"
  shape_externalarg: { fg: "#859900" attr: b }
  shape_external_resolved: { fg: "#2aa198" attr: b }
  shape_filepath: "#2aa198"
  shape_flag: { fg: "#268bd2" attr: b }
  shape_float: { fg: "#6c71c4" attr: b }
  shape_garbage: { fg: "#fdf6e3" bg: "#dc322f" attr: b }
  shape_glob_interpolation: { fg: "#2aa198" attr: b }
  shape_globpattern: { fg: "#2aa198" attr: b }
  shape_int: { fg: "#6c71c4" attr: b }
  shape_internalcall: { fg: "#2aa198" attr: b }
  shape_keyword: { fg: "#6c71c4" attr: b }
  shape_list: { fg: "#2aa198" attr: b }
  shape_literal: "#268bd2"
  shape_match_pattern: "#859900"
  shape_matching_brackets: { attr: u }
  shape_nothing: "#2aa198"
  shape_operator: "#b58900"
  shape_or: { fg: "#6c71c4" attr: b }
  shape_pipe: { fg: "#6c71c4" attr: b }
  shape_range: { fg: "#b58900" attr: b }
  shape_raw_string: { fg: "#fdf6e3" attr: b }
  shape_record: { fg: "#2aa198" attr: b }
  shape_redirection: { fg: "#6c71c4" attr: b }
  shape_signature: { fg: "#859900" attr: b }
  shape_string: "#859900"
  shape_string_interpolation: { fg: "#2aa198" attr: b }
  shape_table: { fg: "#268bd2" attr: b }
  shape_variable: { fg: "#6c71c4" attr: b }
  shape_vardecl: { fg: "#6c71c4" attr: b }
}

$env.config.color_config = $solarized_dark
```

### scripts/completions.nu -- Carapace Integration

```nu
# External completer setup
# Uses carapace if installed, otherwise gracefully degrades to no external completions

let external_completer = if (which carapace | is-not-empty) {
  # Carapace provides completions for 1000+ commands out of the box
  let carapace_completer = {|spans: list<string>|
    carapace $spans.0 nushell ...$spans | from json
  }
  {|spans: list<string>|
    # Resolve aliases before passing to carapace
    let expanded_alias = (scope aliases | where name == $spans.0 | get -i 0.expansion)
    let spans = if $expanded_alias != null {
      $spans | skip 1 | prepend ($expanded_alias | split row " " | take 1)
    } else {
      $spans
    }
    do $carapace_completer $spans
  }
} else {
  {|spans: list<string>| null }  # No external completions available
}

$env.config.completions.external = {
  enable: true
  completer: $external_completer
}
```

### scripts/hooks.nu -- Hooks

```nu
# Full history logging (mirrors bash's ~/.full_history)
$env.config.hooks.pre_execution ++= [{||
  let cmd = (commandline)
  if ($cmd | str trim | is-not-empty) {
    let entry = $"(date now | format date '%Y-%m-%d--%H-%M-%S') ($env._HOSTNAME) ($env.PWD) ($cmd)"
    $"($entry)\n" | save --append ~/.full_history
  }
}]
```

### scripts/keybindings.nu -- Vi-Mode Customizations

```nu
# Vi-mode keybinding customizations
# Mirrors the ble.sh keybindings from the archived dot_blerc
# Uses ++= to append to (not overwrite) nushell's default keybindings

$env.config.keybindings ++= [
  # Ctrl-C: discard current line in both insert and normal mode
  {
    name: discard_line
    modifier: control
    keycode: char_c
    mode: [vi_insert vi_normal]
    event: [
      { edit: Clear }
    ]
  }
  # Ctrl-R: reverse history search in normal mode
  {
    name: history_search
    modifier: control
    keycode: char_r
    mode: [vi_normal]
    event: {
      send: SearchHistory
    }
  }
  # Ctrl-R: reverse history search in insert mode too
  {
    name: history_search_insert
    modifier: control
    keycode: char_r
    mode: [vi_insert]
    event: {
      send: SearchHistory
    }
  }
  # Tab: completion menu
  {
    name: completion_menu
    modifier: none
    keycode: tab
    mode: [vi_insert]
    event: {
      send: menu
      name: completion_menu
    }
  }
  # Shift-Tab: completion menu previous
  {
    name: completion_previous
    modifier: shift
    keycode: backtab
    mode: [vi_insert]
    event: {
      send: menuprevious
    }
  }
]
```

### scripts/utils.nu -- Utility Commands

```nu
# Delete line from SSH known_hosts by line number
def ssh-del [line: int] {
  let hosts = (open ~/.ssh/known_hosts | lines)
  $hosts | drop nth ($line - 1) | save -f ~/.ssh/known_hosts
  print $"Deleted line ($line) from known_hosts"
}

# Show current public IP
def showip [] {
  http get https://checkip.amazonaws.com | str trim
}

# Universal archive extraction
def extract [file: path] {
  let ext = ($file | path parse | get extension)
  match $ext {
    "gz" => {
      if ($file | str ends-with ".tar.gz") or ($file | str ends-with ".tgz") {
        ^tar xzf $file
      } else {
        ^gunzip $file
      }
    }
    "bz2" => {
      if ($file | str ends-with ".tar.bz2") or ($file | str ends-with ".tbz2") {
        ^tar xjf $file
      } else {
        ^bunzip2 $file
      }
    }
    "tar" => { ^tar xf $file }
    "zip" => { ^unzip $file }
    "rar" => { ^rar x $file }
    "7z" => { ^7z x $file }
    "Z" => { ^uncompress $file }
    _ => { error make { msg: $"Cannot extract '($file)': unknown extension '($ext)'" } }
  }
}

# Track all remote git branches locally
def git-track-all [] {
  ^git branch -r
    | lines
    | where { |line| not ($line | str contains "->") }
    | each { |line| $line | str trim | str replace "origin/" "" }
    | each { |branch|
        ^git branch --track $branch $"origin/($branch)" 2> /dev/null
        $branch
    }
  print "Now tracking all remote branches."
  print "To update, run: git fetch --all && git pull --all"
}

# Docker cleanup
def docker-clean [] {
  print "Removing stopped containers..."
  ^docker rm -v (^docker ps -a -q -f status=exited | lines) 2> /dev/null
  print "Removing dangling images..."
  ^docker rmi (^docker images -f "dangling=true" -q | lines) 2> /dev/null
  print "Done."
}

# Kill tmux sessions by prefix (skip current)
def tmux-kill-sessions [prefix: string] {
  let current = if ($env.TMUX? | is-not-empty) {
    ^tmux display-message -p "#S" | str trim
  } else {
    ""
  }

  ^tmux list-sessions -F "#{session_name}"
    | lines
    | where { |s| ($s | str starts-with $prefix) and ($s != $current) }
    | each { |s|
        ^tmux kill-session -t $s
        print $"Killed session: ($s)"
    }
}

# Preview 256 colors
def colors-256 [] {
  0..255 | each { |i|
    let color = $"\u{1b}[48;5;($i)m(($i | fill -a right -w 4))\u{1b}[0m"
    if $i == 15 or ($i > 15 and (($i - 15) mod 6 == 0)) {
      $"($color)\n"
    } else {
      $color
    }
  } | str join ""
}

# Process search (replaces `ps -ef | grep`)
def searchjobs [pattern: string] {
  ps | where name =~ $pattern
}
```

### login.nu -- Login Shell Extras

```nu
# login.nu -- only runs when nushell is a login shell

# Auto-start tmux (mirrors bash behavior)
# Uncomment if tmux auto-attach is desired:
# if ($env.TMUX? | is-empty) and ($env.TERM? | default "" | str contains "tmux" | not $in) {
#   ^tmux
# }
```

> NOTE: Tmux auto-start is commented out by default. The user's environment uses wezterm as the terminal multiplexer, which may reduce the need for tmux. Enable if tmux remains part of the workflow.

### Starship Integration

Starship works unchanged with nushell. The existing `dot_config/starship.toml` (which was NOT archived -- it remains active) is shared between bash and nushell. Starship handles nushell natively.

The `env.nu` file generates the starship init script via vendor autoload:

```nu
starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
```

The `custom.dir` module in starship.toml uses a bash command for short-path generation. This works in nushell because starship's `custom` commands always invoke via `sh -c`. No changes to starship.toml are needed.

Note: the archived `bash/starship.toml` (at `archive/legacy/bash/starship.toml`) is a duplicate of `dot_config/starship.toml` and can be ignored.

### Chezmoi Integration

The nushell config integrates with the existing chezmoi-managed dotfiles:

```
dotfiles/
  dot_config/
    nushell/
      env.nu
      config.nu
      login.nu
      scripts/
        aliases.nu
        colors.nu
        completions.nu
        hooks.nu
        keybindings.nu
        utils.nu
    starship.toml          # (existing, shared between bash and nushell)
```

A `run_once` script handles carapace installation:

```bash
#!/bin/bash
# run_once_before_30-install-carapace.sh
# Installs carapace for nushell completions (nushell itself is already installed)

if ! command -v carapace &> /dev/null; then
    if command -v go &> /dev/null; then
        go install github.com/carapace-sh/carapace-bin@latest
    else
        echo "carapace: go not found. Install manually:"
        echo "  go install github.com/carapace-sh/carapace-bin@latest"
        echo "  OR download from https://github.com/carapace-sh/carapace-bin/releases"
        echo "  (Optional: nushell works without carapace, with reduced completions)"
    fi
fi
```

## Feature Mapping: Bash to Nushell

| Bash Feature | Bash Implementation | Nushell Approach | Status |
|---|---|---|---|
| Vi-mode editing | `set -o vi` + ble.sh | `$env.config.edit_mode = "vi"` (reedline) | Port |
| Solarized dark | ANSI escapes, FZF_DEFAULT_OPTS, LSCOLORS | `$env.config.color_config` + FZF_DEFAULT_OPTS | Port |
| Starship prompt | `eval "$(starship init bash)"` | `starship init nu` vendor autoload | Port |
| History (1M lines) | HISTSIZE + flat file + histappend | SQLite, `max_size: 1_000_000` | Reimagine (better) |
| History sharing | `bleopt history_share=1` | `sync_on_enter: true` | Port |
| FZF completions | ble.sh fzf-completion integration | Carapace (richer, structured) | Reimagine |
| Safety aliases | `rm -i`, `mv -i`, `cp -i` | `crm`, `cmv`, `ccp` (nushell builtins are already safer) | Reimagine |
| `ls` variants | `ls -hF`, `ll`, `lsd` | Nushell `ls` is structured; `lse`/`lle` for external | Reimagine |
| `:q` exit | `alias ":q"="exit"` | `alias ':q' = exit` | Port |
| `vim` -> `nvim` | `alias vim=nvim` | `alias vim = ^nvim` | Port |
| cdspell | `shopt -s cdspell` | Not available (different paradigm) | Skip |
| noclobber | `set -o noclobber` | Nushell `save` requires `--force` to overwrite by default | Skip (built-in) |
| ignoreeof | `set -o ignoreeof` | Not directly available; Ctrl-D behavior differs | Skip |
| `stty -ixon` | Free Ctrl-S/Ctrl-Q | Reedline handles terminal directly | Skip |
| dotglob/extglob/globstar | `shopt -s` settings | Nushell `glob` command, `**` patterns | Skip (built-in) |
| tmux auto-start | bashrc conditional | `login.nu` (commented out) | Defer |
| Full history log | `~/.full_history` with timestamps | `pre_execution` hook | Port |
| ssh-del | `sed -i` on known_hosts | Structured: `open \| lines \| drop nth \| save` | Reimagine |
| showip | lynx + awk + sed | `http get` (built-in) | Reimagine |
| extract | case/esac | `match` expression with typed `path` param | Port |
| git-track-all | pipe chain with sed | Structured pipeline with `lines`, `where`, `each` | Reimagine |
| searchjobs | `ps -ef \| grep` | `ps \| where name =~ pattern` | Reimagine |
| Color escape exports | Function with export statements | Not needed (nushell has color types) | Skip |
| bash-completion | Source scripts | Carapace provides universal completions | Reimagine |
| lesspipe | `eval "$(lesspipe)"` | Not needed (nushell has built-in viewers) | Skip |
| margin_pane/unmargin_pane | tmux pane styling for writing | Could port but low priority | Defer |
| HISTIGNORE | Ignore common commands in history | Not directly available; use history search instead | Skip |

## Important Design Decisions

### Decision 1: Nushell as Primary, Bash for Scripting

**Decision:** Nushell is the primary interactive shell. Bash remains available for scripts and any tool that requires it.

**Why:**
- The bash config is already archived; the switch is happening now
- Shell scripts throughout the ecosystem assume bash/POSIX sh -- bash stays installed for that
- WezTerm's `default_prog` points to nushell; new tabs launch nushell directly
- If something is fundamentally broken, switching `default_prog` back to bash is a one-line revert

### Decision 2: Carapace Over FZF for Completions

**Decision:** Use carapace as the primary completion engine rather than attempting to integrate fzf into nushell's completion system.

**Why:**
- Carapace is designed for nushell's structured completion pipeline. It returns typed records with descriptions.
- fzf integration with nushell's reedline is awkward -- fzf expects text streams, reedline expects structured completion candidates.
- Carapace provides completions for 1000+ commands out of the box (vs. bash-completion scripts).
- fzf remains available via `^fzf` for ad-hoc fuzzy finding in pipelines.

### Decision 3: `scripts/` Directory Over Autoload Dirs

**Decision:** Use a `scripts/` subdirectory with explicit `source` statements in `config.nu` rather than nushell's user autoload directories.

**Why:**
- Explicit load order: `source` statements in config.nu make the dependency order visible.
- Discoverability: new users (or future-self) can read config.nu to see what is loaded.
- Chezmoi compatibility: autoload dirs (`$nu.user-autoload-dirs`) may resolve to a data dir outside the config dir, complicating chezmoi management.
- The scripts/ pattern mirrors the archived bash `bash/` directory structure.

### Decision 4: Prefixed Safety Aliases (`crm`, `cmv`, `ccp`)

**Decision:** Use `crm`/`cmv`/`ccp` rather than shadowing nushell's built-in `rm`/`mv`/`cp` commands.

**Why:**
- Nushell's built-in `rm` has its own safety features (trash support, confirmation prompts).
- Shadowing builtins with aliases to external commands loses nushell's structured error handling.
- The `c`-prefix ("careful") is a small muscle-memory adjustment but avoids confusion about which `rm` is running.
- Users who want maximum safety can add `$env.config.rm.always_trash = true` for nushell's built-in rm.

### Decision 5: SQLite History with No Isolation

**Decision:** Use `isolation: false` for history sharing between sessions.

**Why:**
- The archived bash setup used `bleopt history_share=1` for cross-session history sharing.
- `isolation: false` replicates this: all sessions see each other's history immediately.
- `sync_on_enter: true` ensures commands are written to the database after each entry.
- SQLite is crash-safe, unlike bash's flat-file append approach.

## Edge Cases / Challenging Scenarios

### External Commands That Expect Bash

Some tools produce bash-specific init output (e.g., `eval "$(rbenv init -)"`, `eval "$(direnv hook bash)"`). In nushell, these need nushell-specific init commands or manual environment setup. Each tool should be handled case-by-case as encountered.

### Nushell Inside Devcontainers

If nushell is installed in a devcontainer, the config needs to be available inside the container. Options:
- Mount `~/.config/nushell/` as a bind mount (chezmoi-managed host config)
- Include nushell config in the devcontainer feature
- Use nushell's `$env.NU_CONFIG_DIR` override

This is out of scope for this proposal but should be considered in the lace devcontainer feature work.

### Starship custom.dir Module

The starship.toml `custom.dir` command uses bash syntax (`if [[ ... ]]`, `sed`). Starship runs custom commands via `sh -c`, so this works regardless of the user's interactive shell. No changes needed.

### Carapace Not Installed

If carapace is not available, the completions.nu script degrades gracefully. Both `env.nu` (conditional init file generation) and `completions.nu` (conditional completer closure) check for carapace's presence via `which carapace | is-not-empty`. When carapace is absent, the external completer returns `null` and nushell falls back to its built-in file/directory completion.

### Reedline Vi-Mode Limitations

Reedline's vi-mode is less complete than ble.sh. Known gaps:
- Limited text objects compared to vim
- No register support (yank/paste use system clipboard only)

Mitigation: accept these limitations. For visual selection, WezTerm's copy mode (`Alt+C`) provides character and line selection with vi keybindings, which is sufficient. For complex editing, use `Ctrl-X Ctrl-E` to edit the command buffer in nvim. Reedline is actively developed and gaps are closing.

## Nushell-Specific Gotchas

This section documents nushell behaviors that differ from bash in ways that are likely to cause confusion or bugs during implementation.

### Gotcha 1: Keybinding Append vs. Overwrite

**The problem:** `$env.config.keybindings = [...]` replaces ALL default keybindings with only the ones you list. This silently removes Ctrl-A (beginning of line), Ctrl-E (end of line), Ctrl-W (delete word), and many others.

**The fix:** Always use `++=` to append:

```nu
$env.config.keybindings ++= [
  # your custom bindings here
]
```

**Why it matters:** This is not obvious from the docs. The first time you set custom keybindings with `=`, everything seems to work until you try a default binding that you did not explicitly re-add. The same pattern applies to `$env.config.hooks.pre_execution` and other list-valued config fields.

### Gotcha 2: Environment Variable Scoping

**The problem:** In bash, `export FOO=bar` makes `FOO` available to all child processes and persists for the session. In nushell, environment variable scope depends on whether you are in a *block* (which propagates) or a *closure* passed to a command (which does not):

```nu
# This DOES work in nushell v0.100+ -- if/match/for blocks propagate env
if true {
  $env.FOO = "bar"
}
$env.FOO  # "bar" -- if blocks propagate to the calling scope

# This does NOT work -- closures passed to commands (each, do, where) do not propagate
[1] | each { |_| $env.BAZ = "qux" }
$env.BAZ  # Error: BAZ not found -- closures are isolated

# Hook closures are the exception -- nushell merges their env back into the session
$env.config.hooks.env_change.PWD = [{|before, after|
  $env.FOO = "bar"  # This propagates because hook closures are special
}]
```

**Key differences from bash:**
- `if`, `match`, `for`, and `loop` blocks DO propagate environment changes to the parent scope (as of nushell v0.93+). This is similar to bash.
- Closures passed to pipeline commands (`each`, `where`, `do`, `reduce`, `par-each`) do NOT propagate environment changes. This is the primary scoping trap.
- Hook closures (env_change, pre_execution, pre_prompt) are special -- nushell merges the hook's environment back into the calling scope.
- `def` commands do NOT propagate environment changes to the caller unless the command is defined as `def --env`.
- `$env.config` is mutable at the top level and in config files but behaves like any other env var in terms of scoping.

### Gotcha 3: Module Loading Order

**The problem:** Nushell loads configuration in a strict order:

1. `default_env.nu` (built-in defaults)
2. `env.nu` (user environment)
3. Vendor autoload files (`$nu.vendor-autoload-dirs`) -- alphabetical order
4. `default_config.nu` (built-in config defaults)
5. `config.nu` (user config)
6. User autoload files (`$nu.user-autoload-dirs`) -- alphabetical order
7. `login.nu` (only for login shells)

**Why it matters:**
- Starship init goes to vendor autoload (generated in `env.nu`), so it loads BETWEEN `env.nu` and `config.nu`. This means starship's prompt is set up before `config.nu` runs. If `config.nu` sets `$env.PROMPT_COMMAND`, it overrides starship. The `PROMPT_INDICATOR_VI_*` variables are safe to set in `config.nu` because starship does not touch them.
- `source` statements in `config.nu` execute at config.nu parse time. If a sourced file depends on an environment variable set earlier in config.nu, that works. If it depends on something set in a vendor autoload file, that also works (vendor autoload runs before config.nu).
- Carapace's init.nu (generated in env.nu, saved to vendor autoload) registers the external completer. But `completions.nu` (sourced from config.nu) also sets the external completer. The config.nu version wins because it runs later. This is intentional -- we want the alias-resolving wrapper completer from completions.nu, not carapace's raw completer.

### Gotcha 4: Bash Features That Do Not Translate

The following bash features have **no nushell equivalent** and should be expected losses:

| Bash Feature | Why It Does Not Translate | Workaround |
|---|---|---|
| `cdspell` (auto-correct cd typos) | Nushell has no equivalent `shopt`. Reedline does not intercept cd arguments for fuzzy matching. | Use tab completion or `z` (zoxide) for fuzzy directory jumping. |
| `ignoreeof` (prevent Ctrl-D logout) | Reedline handles Ctrl-D directly. There is no config to disable it. | Muscle memory: stop pressing Ctrl-D. Or rebind Ctrl-D to a no-op. |
| `HISTIGNORE` (exclude commands from history) | Nushell's SQLite history records everything. There is no ignore pattern. | Use `history \| where command !~ "^(ls\|cd)"` for filtered history search. |
| `stty -ixon` (free Ctrl-S/Ctrl-Q) | Reedline takes over the terminal directly. Ctrl-S and Ctrl-Q are free by default. | None needed -- this is better in nushell. |
| `set -o noclobber` | Nushell's `save` requires `--force` (`-f`) to overwrite by default. However, `>` redirection does overwrite. | Use `save` for file writing (nushell idiomatic) instead of `>`. |
| Vi text objects (`ci"`, `da(`, etc.) | Reedline supports basic motions (`w`, `b`, `e`, `0`, `$`) but not text objects. | Use word-level motions instead. Or edit in nvim via buffer_editor. |
| Vi registers (`"ay`, `"ap`) | Reedline has a single yank buffer, no named registers. | System clipboard is available via Ctrl-Shift-V (terminal) or the single yank buffer. |
| `eval "$(tool init bash)"` pattern | Nushell cannot eval arbitrary strings as code (by design, for safety). Tools must provide nushell-specific init. | Check if the tool supports `tool init nu`. If not, manually translate the env var settings. |
| Brace expansion `{a,b,c}` in commands | Nushell does not expand `{a,b,c}` in the same way. | Use list spread: `["a" "b" "c"] \| each { \|x\| echo $x }`. Or use `glob` for file expansion. |

### Gotcha 5: Wezterm Compatibility

Wezterm and nushell interact through the terminal protocol layer. Known considerations:

**CSI u (enhanced keyboard protocol):** Wezterm supports the CSI u / Kitty keyboard protocol. Nushell's reedline also supports it. When both are enabled, keybindings work more reliably (e.g., Ctrl-Shift combinations, F-keys). Wezterm enables this by default. No special configuration needed.

**Escape sequence timing:** In bash with vi-mode, the `keyseq-timeout` (set to 1ms in the archived bashrc) controls how long to wait after Escape before deciding it is a standalone Escape rather than the start of a sequence. Reedline has its own timeout mechanism and does not use stty or readline settings. If Escape feels sluggish or too fast in nushell vi-mode, the relevant reedline setting is not currently exposed via nushell config. This is a known reedline limitation.

**Shell integration (OSC 7, OSC 133):** Wezterm supports shell integration escape sequences for tracking the current working directory (OSC 7) and command boundaries (OSC 133). Nushell handles both natively via `$env.config.shell_integration`: OSC 7 (cwd reporting) is enabled by default, and OSC 133 (command boundary markers) is also enabled by default. This means wezterm features like "scroll to previous command output" and "copy last command output" work with nushell out of the box.

**`default_prog` for nushell:** To launch nushell in new wezterm tabs/windows:

```lua
config.default_prog = { '/home/mjr/.cargo/bin/nu' }
```

This should be set as part of Phase 1 (see Implementation Phases below).

## Test Plan

### Phase 1 Verification

**1. Clean startup:**

```bash
# Verify clean startup (no errors, no banner)
nu -c "print 'startup OK'"  # Should print "startup OK" with no warnings

# Verify config files are loaded
nu -c "$nu.default-config-dir"  # Should show ~/.config/nushell
```

**2. Starship prompt renders correctly:**

```nu
# Inside nushell:
# - The prompt should show: [time] [short_path] [git_branch] [git_status]
# - Colors should match solarized dark (cyan time, purple path, yellow git branch)
# Verify starship is active:
$env.STARSHIP_SHELL  # Should show "nu"
```

**3. Vi-mode editing:**

```nu
# Press Escape -- cursor should change from line to block
# Press i -- cursor should change from block to line
# In normal mode: h/j/k/l should move cursor / navigate history
# In normal mode: w/b should move by word
# In normal mode: dd should clear the line
# Verify vi mode indicator:
$env.PROMPT_INDICATOR_VI_NORMAL  # Should show "> "
$env.PROMPT_INDICATOR_VI_INSERT  # Should show ": "
```

**4. Environment variables:**

```nu
$env.EDITOR     # Should show "nvim"
$env.VISUAL     # Should show "nvim"
$env.PAGER      # Should show "less"
$env.LESS       # Should show "-R"
$env.PATH | where {|p| $p =~ ".local/bin"}   # Should have at least one match
$env.PATH | where {|p| $p =~ ".cargo/bin"}   # Should have at least one match
```

**5. History persistence:**

```nu
# Session 1: run a unique command
echo "history-test-12345"
exit

# Session 2: verify it persisted
history | where command =~ "history-test-12345"  # Should return a row
```

**6. Keybindings:**

```nu
# Type some text, then press Ctrl-C -- the line should clear (not exit nushell)
# Type some text, then press Escape, then Ctrl-R -- history search should open
# In insert mode, press Ctrl-R -- history search should open
# Press Tab after typing "git " -- completion menu should appear
# Press Shift-Tab -- completion menu should select previous item
```

**7. Aliases:**

```nu
:q       # Should exit nushell (same as exit)
vim      # Should open nvim (verify with `which vim` showing alias)
crm      # Should show help for rm -i (external)
```

**8. Carapace completions:**

```nu
# Type "git " then press Tab:
# - Should show subcommands (add, commit, push, etc.) with descriptions

# Type "docker " then press Tab:
# - Should show docker subcommands

# Type "cargo " then press Tab:
# - Should show cargo subcommands

# Verify the completer is registered:
$env.config.completions.external.enable  # Should be true
```

**9. Solarized dark colors:**

```nu
# Table output should use solarized colors:
ls  # Headers should be yellow bold, row indices green bold

# Verify the color config is loaded:
$env.config.color_config.header  # Should show { fg: "#b58900" attr: b }

# Syntax highlighting should use solarized:
# Type: ls | where size > 1mb
# "ls" should be cyan, "|" violet, "where" cyan, "1mb" violet
```

**10. Full history logging:**

```nu
# Run a command:
echo "full-history-test"

# Check ~/.full_history:
open ~/.full_history | lines | last 1
# Should contain a line like: 2026-02-05--14-30-00 hostname /home/mjr echo "full-history-test"
```

**11. Utility commands:**

```nu
# showip:
showip  # Should return a valid IPv4 address

# extract (test with a real archive):
"test content" | save /tmp/test-extract.txt
cd /tmp && ^tar czf test-extract.tar.gz test-extract.txt && rm test-extract.txt
extract /tmp/test-extract.tar.gz
open /tmp/test-extract.txt  # Should show "test content"

# searchjobs:
searchjobs nu  # Should show at least the current nushell process

# colors-256:
colors-256  # Should render a grid of 256 colored blocks
```

**12. Startup performance:**

```bash
# From bash, measure nushell startup time:
time nu -c "exit"  # Target: under 500ms

# Inside nushell:
$nu.startup-time  # Shows total config parse+eval time
```

**13. WezTerm integration:**

```nu
# Verify OSC 7 (cwd tracking) works:
# Click on a directory path in wezterm output -- should open or navigate

# Verify OSC 133 (command boundaries) works:
# Use wezterm's "scroll to previous command" (Ctrl-Shift-UpArrow) -- should jump between command outputs
```

### Phase 2 Verification

**1. Nushell-native workflows:**

```nu
# File exploration:
ls | where size > 1mb | sort-by modified | reverse  # Large files, newest first

# Config inspection:
open ~/.config/starship.toml  # Should render as a structured table/record

# Structured history search:
history | where command =~ "git" | select command start_timestamp | last 10

# System information:
sys host | get hostname  # Should show the machine hostname
sys mem | get used      # Should show memory usage
```

**2. Git utility:**

```nu
# In a repo with multiple remote branches:
cd /var/home/mjr/code/weft/lace
git-track-all  # Should report tracking remote branches
^git branch -a  # Verify local branches were created
```

**3. Full history log integrity:**

```nu
# After using nushell for several commands:
open ~/.full_history | lines | length  # Should show entry count
# Verify no line concatenation (each line should start with a date):
open ~/.full_history | lines | where { |l| not ($l =~ "^\\d{4}-\\d{2}-\\d{2}") }
# Should return empty (all lines start with a date)
```

## Implementation Phases

### Phase 1: Full Nushell Setup

**Goal:** Nushell is fully configured and set as the default interactive shell in WezTerm.

**Prerequisites:**
- The [archive migration](2026-02-05-dotfiles-legacy-archive-clean.md) is complete. Bash config is at `archive/legacy/bash/`, `~/.bashrc` sources from archive paths.
- Chezmoi is functional (can run `chezmoi apply` to deploy config files).

#### Step 1.1: Create Chezmoi Directory Structure

```bash
# In the dotfiles repo:
cd /home/mjr/code/personal/dotfiles
mkdir -p dot_config/nushell/scripts
```

#### Step 1.2: Create All Config Files

Create the following files with the full contents shown in the corresponding sections above:

- `dot_config/nushell/env.nu` -- [env.nu section](#envnu----environment-setup)
- `dot_config/nushell/config.nu` -- [config.nu section](#confignu----core-configuration)
- `dot_config/nushell/login.nu` -- [login.nu section](#loginnu----login-shell-extras)
- `dot_config/nushell/scripts/aliases.nu` -- [aliases.nu section](#scriptsaliasesnu----aliases)
- `dot_config/nushell/scripts/colors.nu` -- [colors.nu section](#scriptscolorsnu----solarized-dark-theme)
- `dot_config/nushell/scripts/completions.nu` -- [completions.nu section](#scriptscompletionsnu----carapace-integration)
- `dot_config/nushell/scripts/hooks.nu` -- [hooks.nu section](#scriptshooksnu----hooks)
- `dot_config/nushell/scripts/keybindings.nu` -- [keybindings.nu section](#scriptskeybindingsnu----vi-mode-customizations)
- `dot_config/nushell/scripts/utils.nu` -- [utils.nu section](#scriptsutilsnu----utility-commands)

#### Step 1.3: Install Carapace

```bash
# Via Go (preferred):
go install github.com/carapace-sh/carapace-bin@latest

# Via prebuilt binary (if Go unavailable):
# Download from https://github.com/carapace-sh/carapace-bin/releases
# Place in ~/.local/bin/carapace

# Verify:
carapace --version

# Generate the initial nushell bridge:
mkdir -p ~/.cache/carapace
carapace _carapace nushell > ~/.cache/carapace/init.nu
```

#### Step 1.4: Create Chezmoi run_once Script

Create `run_once_before_30-install-carapace.sh` at the dotfiles repo root (see [Chezmoi Integration](#chezmoi-integration) above).

#### Step 1.5: Apply and Test

```bash
chezmoi apply -v

# Verify files are in place:
ls ~/.config/nushell/
# Should show: env.nu  config.nu  login.nu  scripts/

ls ~/.config/nushell/scripts/
# Should show: aliases.nu  colors.nu  completions.nu  hooks.nu  keybindings.nu  utils.nu

# Launch nushell:
nu

# Run ALL Phase 1 Verification tests (see Test Plan above)
```

#### Step 1.6: Set WezTerm Default to Nushell

Once Phase 1 verification passes, update `wezterm.lua`:

```lua
config.default_prog = { '/home/mjr/.cargo/bin/nu' }
```

New WezTerm tabs will now launch nushell directly.

**Success Criteria:**
- `nu` starts with starship prompt, vi-mode active, no banner, solarized colors
- All aliases work (`:q` exits, `vim` opens nvim, `crm`/`cmv`/`ccp` work)
- History persists across sessions (SQLite)
- Ctrl-C clears line, Ctrl-R searches history
- Carapace completions work for git, docker, cargo, etc.
- Full history logging to `~/.full_history`
- All utility commands work (showip, extract, searchjobs, etc.)
- `time nu -c "exit"` completes in under 500ms
- WezTerm launches nushell in new tabs

### Phase 2: Nushell-Native Enhancements

**Goal:** Take advantage of nushell's unique strengths beyond bash parity.

#### Step 2.1: Explore Nushell-Native Patterns

Document and practice these patterns that have no bash equivalent:

```nu
# File exploration with structured data:
ls | where size > 10mb | sort-by modified | reverse

# Deep file search with metadata:
glob **/*.rs | each { |f| ls $f } | flatten | sort-by size | reverse | first 20

# JSON/YAML/TOML config inspection:
open ~/.config/starship.toml | get git_branch
open package.json | get dependencies

# Structured history analysis:
history | where command =~ "docker" | group-by { |r| $r.start_timestamp | format date "%Y-%m-%d" } | transpose day commands | sort-by day

# System monitoring:
sys mem  # Memory usage as a record
sys cpu  # CPU info
sys host # Hostname, OS, kernel

# HTTP requests with structured output:
http get https://api.github.com/repos/nushell/nushell/releases/latest | get tag_name
```

#### Step 2.2: Consider Custom Completions

For project-specific tools (e.g., chezmoi, lace CLI) that carapace may not cover well:

```nu
# Example: custom chezmoi completions
# dot_config/nushell/scripts/completions/chezmoi.nu
module chezmoi-completions {
  export extern "chezmoi" [
    command?: string@chezmoi-commands
    --config(-c): path
    --verbose(-v)
  ]

  def chezmoi-commands [] {
    ["apply" "diff" "edit" "managed" "status" "update" "add" "forget"]
  }
}
```

#### Step 2.3: Document Patterns

Add a section to the dotfiles repo documenting:
- Common nushell idioms used in daily work
- Bash-to-nushell translation reference for commands used frequently
- Known limitations and workarounds

**Success Criteria:**
- User is comfortable using nushell for all daily interactive work
- Nushell-native patterns (structured pipelines, `open`, `http get`) are in regular use
- Any gaps documented with workarounds

## Rollback Plan

If nushell turns out to have a deal-breaking problem:

1. **Switch WezTerm back to bash:** In `wezterm.lua`, change `config.default_prog` to `{ '/bin/bash' }` (or remove the line entirely). New tabs immediately use bash.

2. **Bash is fully functional:** The archived bash config at `archive/legacy/bash/` is still sourced by `~/.bashrc`. Opening a bash shell works exactly as before.

That is the complete rollback. Nushell config files can be left in place (they do nothing when bash is the shell) or removed via `rm -rf ~/.config/nushell/ && rm -rf dot_config/nushell/` in the dotfiles repo.

## Open Questions

1. **Carapace availability on Fedora:** Carapace is written in Go. The `run_once` script installs via `go install`. If Go is not available, the user needs to download a prebuilt binary. Should we add Fedora COPR as a fallback? The prebuilt binary download is documented as a fallback in Step 1.3.

2. **Nushell in devcontainers:** Should the lace devcontainer feature include nushell as an option? This would let the user iterate on nushell config inside containers. Deferred to a separate proposal.

3. **Startup performance budget:** The test plan targets 500ms for `nu -c "exit"`. If config pushes startup over this threshold, should the starship/carapace init be moved from env.nu (runs every startup) to a chezmoi run_once script (runs once at apply time)? The tradeoff: run_once is faster at startup but requires `chezmoi apply` after upgrading starship/carapace to regenerate the init files.
