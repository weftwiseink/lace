# lace

**Limited Agent Computing Environments**

Secure, reproducible workspaces for AI coding agents using devcontainers, git worktrees, and terminal-native tooling.

## Packages

### [`packages/lace`](packages/lace/)

Devcontainer orchestration CLI. Wraps the standard `devcontainer` CLI with:

- **Port allocation** -- auto-assigns ports in the 22425--22499 range with symmetric host/container mapping
- **Template variables** -- `${lace.port(featureId/optionName)}` expressions resolved at build time
- **Feature metadata** -- fetches and validates `devcontainer-feature.json` from OCI registries, auto-injects port templates
- **Prebuilds** -- pre-bakes slow features (neovim, claude code) into cached local images for fast startup
- **Repo mounts** -- clones repos and bind-mounts them into the container, with local override support

```sh
npm install lace
lace up --workspace-folder .
```

See [`packages/lace/README.md`](packages/lace/README.md) for full documentation.

### [`packages/sprack`](packages/sprack/)

Tree-style tmux session browser built as cooperating Rust binaries sharing a SQLite database (WAL mode).
Renders a responsive, collapsible view of every tmux session, window, and pane, grouped by lace devcontainer.
Includes deep Claude Code integration: thinking/idle/error status, subagent counts, context usage.

Three binaries: `sprack` (TUI), `sprack-poll` (tmux state poller), `sprack-claude` (Claude Code summarizer).

```sh
cd packages/sprack && cargo build --release
```

See [`packages/sprack/README.md`](packages/sprack/README.md) for full documentation.

### [`devcontainers/features`](devcontainers/features/)

Devcontainer features published to `ghcr.io/weftwiseink/devcontainer-features`:

| Feature | Description |
|---------|-------------|
| [`claude-code`](devcontainers/features/src/claude-code/) | Installs Claude Code CLI via npm. Declares a lace mount for persistent `~/.claude` configuration. |
| [`neovim`](devcontainers/features/src/neovim/) | Installs Neovim from GitHub releases with lace mount for persistent plugin state. |
| [`wezterm-server`](devcontainers/features/src/wezterm-server/) | Installs `wezterm-mux-server` and `wezterm` CLI for headless terminal multiplexing via SSH domains. |

## Dogfooding

To use your local build of `lace` against other projects (e.g. a dotfiles devcontainer):

```sh
# Build and link globally (one-time setup)
pnpm install
pnpm --filter lace build
cd packages/lace && npm link

# Now `lace` is available everywhere
cd ~/code/personal/dotfiles
lace up
```

The global link is a symlink to the source directory, so future `pnpm --filter lace build` runs update the CLI automatically -- no need to re-link.

## Development

```sh
# Install dependencies
pnpm install

# Build the lace CLI
pnpm --filter lace build

# Run tests
pnpm --filter lace test
```

## Project structure

```
lace/
├── packages/
│   ├── lace/              # Devcontainer orchestration CLI
│   └── sprack/            # tmux session browser (Rust workspace)
├── devcontainers/
│   └── features/          # Devcontainer features (OCI-published)
│       └── src/
│           ├── claude-code/
│           ├── neovim/
│           └── wezterm-server/
├── .devcontainer/         # This project's own devcontainer config
├── config/                # Terminal environment configs (wezterm, nvim)
├── bin/                   # Launcher scripts
└── cdocs/                 # Project documentation
```

## Documentation

- [Architecture overview](packages/lace/docs/architecture.md) -- pipeline flow, layer dependencies, worked examples
- [Troubleshooting guide](packages/lace/docs/troubleshooting.md) -- common failure modes and fixes
- [Migration guide](packages/lace/docs/migration.md) -- from standard `devcontainer` CLI to lace
- [Prebuild internals](packages/lace/docs/prebuild.md) -- cache behavior, image tagging, lock files
- [Contributing guidelines](CONTRIBUTING.md) -- codebase idioms, testing patterns, conventions

## License

MIT
