# lace

**Limited Agent Computing Environments**

Secure, reproducible workspaces for AI coding agents using devcontainers, git worktrees, and terminal-native tooling.

## What is lace?

Lace provides infrastructure for managing isolated agent workspaces:

- **Devcontainer features** for agent-oriented tooling (claude code, neovim, wezterm mux, nushell)
- **Worktree-aware containers** that expose multiple branches through a single container
- **Terminal-native development** via WezTerm SSH domain multiplexing + Neovim
- **Pre-baked images** that layer devcontainer features onto base images at build time

## Project Structure

```
lace/
├── .devcontainer/         # Reference devcontainer setup
├── config/                # Terminal environment configs (wezterm, nvim)
├── devcontainers/
│   └── features/          # Devcontainer features for publishing
├── packages/
│   └── lace/              # Devcontainer wrapper CLI (npm)
├── bin/                   # Launcher scripts
└── cdocs/                 # Project documentation
```

## Key Concepts

**Worktree-mounted containers**: A bare git repo is mounted at `/workspace`, giving the container access to all worktrees simultaneously. Each worktree gets its own WezTerm workspace via SSH domain multiplexing.

**Feature-based tooling**: Agent tools (claude, neovim, wezterm-mux-server, nushell) are installed as devcontainer features rather than baked into Dockerfiles, making them composable across projects.

**Pre-baked images**: The `lace` CLI can pre-build feature layers onto base images using the devcontainer CLI, caching them as `lace.local/<base-image>` to avoid cold-start installation at container creation time.

## Development

```bash
pnpm install
```

## License

MIT
