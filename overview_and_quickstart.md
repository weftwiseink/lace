# lace: limited agentic coding environments
Terminal-Native Worktree Development

> BLUF: WezTerm + Neovim + terminal Claude provides a worktree-friendly alternative to VSCode's folder-bound architecture.
> `Leader+D` connects to the devcontainer, `Leader+W` picks a worktree — browse changes, run claude, merge back, all without window-switching friction.

## Why This Exists

VSCode devcontainers bind one folder to one window.
Switching worktrees means closing/reopening or using multi-root workspaces (clunky).
The Claude Code VSCode extension also has terminal rendering bugs.

Terminal-native tooling eliminates these constraints:
- WezTerm **SSH domain** connects directly to the devcontainer with native performance
- WezTerm **workspaces** map 1:1 to worktrees via cwd
- Neovim runs anywhere, no folder binding
- Terminal claude is first-class

## Devcontainer Entry

WezTerm connects to the devcontainer via an SSH domain that multiplexes through a `wezterm-mux-server` daemon inside the container.
This provides native terminal performance — rendering happens locally, only commands/state sync over SSH.

### One-Time Setup

```bash
brew tap wezterm/wezterm-linuxbrew
brew install --formula wezterm
brew install devcontainer
brew install neovim

# 1. Generate dedicated SSH key for container access
ssh-keygen -t ed25519 -f ~/.ssh/weft_devcontainer -N "" -C "weft-devcontainer-access"

# 2. Point wezterm at the lace config (symlink or env var)
ln -s /path/to/weft/main/lace/config/wezterm/wezterm.lua ~/.config/wezterm/wezterm.lua

# 3. Rebuild container to pick up wezterm-mux-server + SSH config
devcontainer up --workspace-folder ~/code/apps/weft/main
```

### Connecting

```bash
# Start container (if not already running)
devcontainer up --workspace-folder ~/code/apps/weft/main

# In wezterm:
# Leader+D  → Connect to container at /workspace/main
# Leader+W  → Worktree picker (lists /workspace/* via SSH)
# Leader+S  → Fuzzy workspace switcher (switch between open workspaces)
```

The SSH domain uses a dedicated key pair (`~/.ssh/weft_devcontainer`) that only grants access to the local container.
No GitHub/production keys enter the container, preserving sandbox isolation.

See [WezTerm Devcontainer Multiplexing](../proposals/wezterm_devcontainer_multiplexing.md) for architecture details.

---

## Quick Reference

### Launch Commands

```bash
# Start wezterm with lace config
WEZTERM_CONFIG_FILE=$PWD/lace/config/wezterm/wezterm.lua wezterm

# Start neovim with lace config
XDG_CONFIG_HOME=$PWD/lace/config nvim

# Or use the launcher script
./lace/bin/nvim
```

### Key Bindings Cheatsheet

| Context | Binding | Action |
|---------|---------|--------|
| **WezTerm** | `Ctrl+H/J/K/L` | Navigate panes |
| | `Alt+H/J/K/L` | Split pane |
| | `Alt+N/P` | Next/prev tab |
| | `Alt+Shift+N` | New tab |
| | `Alt+C` | Copy mode |
| | `Leader (Alt+Z) + D` | Connect to devcontainer |
| | `Leader + W` | Worktree picker (container) |
| | `Leader + S` | Fuzzy workspace switcher |
| | `Leader + 1/2/3` | Quick local workspace switch |
| **Neovim** | `Space` | Leader |
| | `Ctrl+H/J/K/L` | Navigate windows |
| | `Ctrl+N/P` | Next/prev buffer |
| | `Ctrl+S` | Find files |
| | `Leader+n` | File explorer |
| | `Leader+fg` | Live grep |
| | `gd / gr` | Go to def / refs |
| | `ge / gE` | Next/prev diagnostic |

---

## Worktree Workflow: End-to-End

### 1. Create or Switch to a Worktree

```bash
# List existing worktrees
scripts/worktree.sh list

# Create new worktree (creates branch from current HEAD)
scripts/worktree.sh add loro_migration

# Or track existing remote branch
scripts/worktree.sh add loro_migration --track origin/loro_migration
```

### 2. Open Worktree in WezTerm Workspace

**From host wezterm (preferred):**
- `Leader+D`: Connect to devcontainer at `/workspace/main`
- `Leader+W`: Worktree picker — lists `/workspace/*` directories, opens selected worktree as a new workspace

**Switching between open workspaces:**
- `Leader+S`: Fuzzy workspace switcher (shows all open workspaces)
- `Leader+1/2/3`: Quick switch to numbered local workspaces

**Manual CLI alternative (from inside container):**
```bash
wezterm cli spawn --new-window --cwd /workspace/loro_migration --workspace loro_migration
```

### 3. Browse Changed Files

**In Neovim (recommended):**
```bash
cd /workspace/loro_migration
nvim

# Inside neovim:
# :Git diff main       (fugitive - diff against main)
# :DiffviewOpen main   (diffview - visual diff)
# Leader+fg            (telescope grep for changes)
# Leader+n             (neo-tree file browser)
```

**Quick Terminal Commands:**
```bash
# What changed vs main?
git diff main --stat
git diff main --name-only

# What's uncommitted?
git status

# View specific file diff
git diff main -- packages/weft/src/some_file.ts
```

### 4. Start Claude in Worktree

```bash
cd /workspace/loro_migration
claude

# Claude session is indexed by path - separate history per worktree
```

Claude sees the worktree's `.claude/WORKTREE_CONTEXT.md` for context.
Edit this file to help Claude understand the worktree's purpose.

### 5. Merge Back to Main

**Option A: Merge in main worktree**
```bash
# Switch to main workspace (Leader+S, or Leader+W and select "main")
cd /workspace/main
git fetch origin
git merge loro_migration    # or: git merge origin/loro_migration
```

**Option B: Rebase and push**
```bash
cd /workspace/loro_migration
git fetch origin
git rebase origin/main
git push origin loro_migration
# Then create PR via gh or web UI
```

### 6. Clean Up Worktree

```bash
scripts/worktree.sh remove loro_migration
# Prompts to delete branch if desired
```

---

## Session Persistence

**Local sessions:** WezTerm workspaces persist across terminal restarts if using the unix domain multiplexer.
The config includes `unix_domains` setup but auto-connect is commented out.

To enable persistence:
```lua
-- In wezterm.lua, uncomment:
config.default_gui_startup_args = { "connect", "unix" }
```

**Container sessions:** The SSH domain connection to the devcontainer's `wezterm-mux-server` provides
persistence across disconnects.
Closing wezterm and reconnecting (`Leader+D`) resumes the container session with all tabs/panes intact,
as long as the container is still running.

For full session save/restore (including pane layouts), enable the resurrect.wezterm plugin (commented in config).

---

## Typical Session Layout

```
Host WezTerm
│
├── [SSH Domain: "weft"] ─── Devcontainer (/workspace/)
│   │
│   ├── Workspace: "loro_migration"  (cwd: /workspace/loro_migration)
│   │   ├── Tab 1: neovim (editing)
│   │   ├── Tab 2: dev server (pnpm dev)
│   │   ├── Tab 3: claude session
│   │   └── Tab 4: shell (git, tests)
│   │
│   └── Workspace: "main"           (cwd: /workspace/main)
│       ├── Tab 1: neovim
│       └── Tab 2: shell
│
└── Local workspaces (host-side, not in container)
    └── Workspace: "scratch"
```

- `Leader+D`: Connect to container (opens "weft" workspace)
- `Leader+W`: Pick a worktree to open as a workspace
- `Leader+S`: Fuzzy-switch between all open workspaces

---

## Loose Ends and Known Issues

### Working

- [x] WezTerm config loads (fixed `escape_timeout_milliseconds`, hardcoded cwd)
- [x] Neovim config loads without blocking errors
- [x] lazy.nvim bootstraps and installs plugins
- [x] Treesitter highlighting works (new main branch API)
- [x] LSP config uses native vim.lsp.config (neovim 0.11+)

### Needs Manual Testing

- [ ] WezTerm keybindings work as expected (splits, pane nav, copy mode)
- [ ] LSP provides completions/diagnostics in TypeScript files
- [ ] Telescope fuzzy finding works
- [ ] Neo-tree file explorer works
- [ ] Git plugins (fugitive, gitsigns, diffview) work

### Known Issues

1. **xkbcommon dead_hamza warnings**: Harmless X11 compose key warnings from system keyboard definitions
2. **Wayland cursor "hand" not found**: Cursor theme issue, cosmetic only
3. **nvim-treesitter-textobjects disabled**: Needs API verification for new main branch

### Future Improvements

1. **Session persistence**: Enable resurrect.wezterm plugin for full layout save/restore
2. **Claude integration**: Custom command to spawn claude in split pane
3. **Dev server management**: Per-worktree port configuration and auto-start
4. **Container status indicator**: Show container running/stopped in wezterm tab bar

---

## File Locations

```
lace/
├── bin/nvim                    # Launcher script
└── config/
    ├── README.md                   # Quick reference
    ├── wezterm/wezterm.lua         # WezTerm config
    └── nvim/
        ├── init.lua                # Neovim entry point
        ├── lazy-lock.json          # Plugin lockfile
        └── lua/plugins/
            ├── colorscheme.lua     # Solarized theme
            ├── editor.lua          # Buffer management, autopairs
            ├── git.lua             # Fugitive, gitsigns, diffview
            ├── lsp.lua             # LSP + completion (native API)
            ├── telescope.lua       # Fuzzy finder
            ├── treesitter.lua      # Syntax highlighting
            └── ui.lua              # Neo-tree, bufferline, lualine
```

---

## Related Documentation

- [WezTerm Devcontainer Multiplexing](../docs/proposals/wezterm_devcontainer_multiplexing.md): SSH domain architecture and implementation
- [Worktree Development Guide](../docs/worktree_development.md): Git worktree setup and usage
- [WezTerm/Neovim Adoption Report](../docs/reports/2026-01-27_wezterm_neovim_adoption.md): Full analysis and rationale
- [Troubleshooting Devlog](../docs/devlogs/2026-01-27_wezterm_neovim_troubleshooting.md): Issues fixed during setup
- [VSCode Worktree Integration Research](../docs/reports/2026-01-26_vscode_worktree_integration_research.md): Why VSCode is problematic
