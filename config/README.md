# lace Terminal Configuration

WezTerm + Neovim configuration for worktree-oriented development.

## Quick Start

### WezTerm

```bash
# Option 1: Set environment variable
export WEZTERM_CONFIG_FILE=/workspace/main/lace/config/wezterm/wezterm.lua
wezterm

# Option 2: Symlink (persistent)
mkdir -p ~/.config/wezterm
ln -sf /workspace/main/lace/config/wezterm/wezterm.lua ~/.config/wezterm/wezterm.lua
```

### Neovim

```bash
# Option 1: Set NVIM_APPNAME (isolated config)
NVIM_APPNAME=lace nvim

# Option 2: Set XDG_CONFIG_HOME
XDG_CONFIG_HOME=/workspace/main/lace/config nvim

# Option 3: Symlink (replaces default config)
ln -sf /workspace/main/lace/config/nvim ~/.config/nvim
```

## Key Bindings Reference

### WezTerm

| Binding | Action |
|---------|--------|
| `Ctrl+H/J/K/L` | Navigate panes |
| `Alt+H/J/K/L` | Split pane (left/down/up/right) |
| `Alt+N` | Next tab |
| `Alt+P` | Previous tab |
| `Alt+Shift+N` | New tab |
| `Alt+W` | Close pane |
| `Alt+C` | Enter copy mode |
| `Alt+Z` (leader) | Prefix for workspace commands |
| `Leader+S` | Fuzzy workspace switcher |
| `Leader+Z` | Toggle pane zoom |
| `Leader+:` | Command palette |

### Neovim

| Binding | Action |
|---------|--------|
| `Space` | Leader key |
| `Ctrl+H/J/K/L` | Navigate windows |
| `Ctrl+N/P` | Next/previous buffer |
| `Ctrl+S` | Find files (telescope) |
| `Leader+n` | Toggle file explorer |
| `Leader+ff` | Find files |
| `Leader+fg` | Live grep |
| `Leader+fb` | Buffers |
| `gd` | Go to definition |
| `gr` | Go to references |
| `K` | Hover documentation |
| `ge/gE` | Next/previous diagnostic |
| `s/S` | Expand/shrink selection (treesitter) |

## Directory Structure

```
lace/config/
├── wezterm/
│   └── wezterm.lua      # Main wezterm config
└── nvim/
    ├── init.lua         # Neovim entry point
    └── lua/plugins/
        ├── colorscheme.lua
        ├── editor.lua
        ├── git.lua
        ├── lsp.lua
        ├── telescope.lua
        ├── treesitter.lua
        └── ui.lua
```

## First Run

Neovim will auto-install plugins on first launch:

1. Run `nvim` with the custom config
2. Wait for lazy.nvim to install plugins
3. Run `:Mason` to check LSP servers
4. Run `:checkhealth` to verify setup

## Worktree Workflow

```bash
# Create wezterm workspace per worktree
wezterm cli spawn --new-window --cwd /workspace/main --workspace main
wezterm cli spawn --new-window --cwd /workspace/feature --workspace feature

# Switch workspaces
# Leader+S (Alt+Z then S) opens fuzzy workspace picker
# Leader+1/2/3 for quick workspace access
```
