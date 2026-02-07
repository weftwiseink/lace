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

### [`devcontainers/features`](devcontainers/features/)

Devcontainer features published to `ghcr.io/weftwiseink/devcontainer-features`:

| Feature | Description |
|---------|-------------|
| [`wezterm-server`](devcontainers/features/src/wezterm-server/) | Installs `wezterm-mux-server` and `wezterm` CLI for headless terminal multiplexing via SSH domains. |

## Quick start

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
│   └── lace/              # Devcontainer orchestration CLI
├── devcontainers/
│   └── features/          # Devcontainer features (OCI-published)
│       └── src/
│           └── wezterm-server/
├── .devcontainer/         # This project's own devcontainer config
├── config/                # Terminal environment configs (wezterm, nvim)
├── bin/                   # Launcher scripts
└── cdocs/                 # Project documentation
```

## License

MIT
