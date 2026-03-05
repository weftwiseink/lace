# Neovim (neovim)

Installs Neovim from GitHub releases. Pre-built tarballs are statically linked and work on any Linux distro.

## Usage

Add to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/neovim:1": {}
  }
}
```

Pin a specific version:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/neovim:1": {
      "version": "v0.11.6"
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `v0.11.6` | Neovim release tag (e.g., `v0.11.6`, `stable`, `nightly`). |

## Plugin persistence (lace mount)

This feature declares a lace mount for `/home/${_REMOTE_USER}/.local/share/nvim`, which holds:

- Plugin files (lazy.nvim, mason, etc.)
- Undo history
- Shada (shared data: marks, registers, command history)

When the mount is active, plugin state persists across container rebuilds. Without the mount, plugins re-download on each rebuild (~30s depending on your plugin set).

By default, lace uses `~/.local/share/nvim` on the host as the mount source (the standard neovim data directory). If this directory exists on your host, your host plugins will be shared with the container. To use a different path, add a settings override to `~/.config/lace/settings.json`:

```json
{
  "mounts": {
    "neovim/plugins": { "source": "/path/to/your/nvim-data" }
  }
}
```

## Dependencies

This feature requires `curl` to download Neovim release tarballs. No feature-level dependencies are needed.

| Dependency | Why | Auto-installed? |
|------------|-----|-----------------|
| `curl` | Downloads Neovim release tarballs from GitHub | No -- must be in base image |

Most devcontainer base images include `curl`. If yours does not, add `ghcr.io/devcontainers/features/common-utils` to your `devcontainer.json` features.

The install script exits with an error if `curl` is not found.

## What gets installed

- `/usr/local/bin/nvim`: Neovim binary
- `/usr/local/lib/nvim/`: Runtime libraries
- `/usr/local/share/nvim/`: Runtime files (syntax, ftplugin, etc.)

## Supported platforms

- **Architectures**: x86_64, aarch64 (arm64)
- **Distributions**: Any Linux (statically linked tarballs)

## Lace mount declarations

| Label | Target | Type | Default Source | Description |
|-------|--------|------|----------------|-------------|
| `neovim/plugins` | `/home/${_REMOTE_USER}/.local/share/nvim` | directory | `~/.local/share/nvim` | Neovim plugin cache, undo history, and shada |
