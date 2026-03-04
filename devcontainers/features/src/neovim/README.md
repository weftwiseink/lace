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

## What gets installed

- `/usr/local/bin/nvim`: Neovim binary
- `/usr/local/lib/nvim/`: Runtime libraries
- `/usr/local/share/nvim/`: Runtime files (syntax, ftplugin, etc.)

## Supported platforms

- **Architectures**: x86_64, aarch64 (arm64)
- **Distributions**: Any Linux (statically linked tarballs)

## Lace mount declarations

| Label | Target | Type | Description |
|-------|--------|------|-------------|
| `neovim/plugins` | `/home/${_REMOTE_USER}/.local/share/nvim` | directory | Neovim plugin cache, undo history, and shada |
