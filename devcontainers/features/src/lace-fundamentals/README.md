# Lace Fundamentals

Baseline developer environment for lace containers.
Consolidates git identity, dotfiles integration (chezmoi), default shell configuration, and core utilities into a single feature.

## Usage

Reference the feature in your `devcontainer.json`:

```json
{
    "features": {
        "ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:2": {}
    }
}
```

Add the init script to `postCreateCommand` to activate runtime configuration (git identity, dotfiles):

```json
{
    "postCreateCommand": "lace-fundamentals-init"
}
```

When using `lace up`, the init script injection is automatic: lace detects the feature and composes `lace-fundamentals-init` into `postCreateCommand`.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultShell` | string | `""` | Absolute path to the default login shell (e.g., `/usr/bin/nu`). Empty string means no shell change. Typically populated from `user.json` `defaultShell`. |

## Dependencies

The feature declares `dependsOn` for one upstream feature:

- `ghcr.io/devcontainers/features/git:1`: Git. Installed automatically; no need to declare it separately.

## Mount Declarations

The feature declares two lace mount slots in its metadata:

| Mount | Target | Description |
|-------|--------|-------------|
| `dotfiles` | `/mnt/lace/repos/dotfiles` | Dotfiles repo for chezmoi apply at container start. |
| `screenshots` | `/mnt/lace/screenshots` | Host screenshots directory for Claude Code image references. Read-only. |

Mount sources are configured in `~/.config/lace/settings.json` or `~/.config/lace/user.json`.

## Init Script

The `lace-fundamentals-init` script is installed to `/usr/local/bin/` during the feature build.
It runs at container start (via `postCreateCommand`) and handles:

1. **Git identity**: reads `LACE_GIT_NAME`/`LACE_GIT_EMAIL` env vars (injected by lace from `user.json`) and writes them to `~/.gitconfig`.
2. **Dotfiles**: applies chezmoi from the dotfiles mount path. Defaults to `/mnt/lace/repos/dotfiles`; override with `LACE_DOTFILES_PATH` env var.

## Install Steps

The feature runs four install steps in order:

1. **staples**: ensures core utilities (curl, jq, less) are present.
2. **chezmoi**: installs chezmoi binary if not present.
3. **git-identity**: creates the `lace-fundamentals-init` runtime script.
4. **shell**: changes the remote user's login shell if `defaultShell` is set.
