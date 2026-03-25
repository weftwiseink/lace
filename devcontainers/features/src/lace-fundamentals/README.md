# Lace Fundamentals

Baseline developer environment for lace containers.
Consolidates hardened SSH, git identity, dotfiles integration (chezmoi), default shell configuration, and core utilities into a single feature.

## Usage

Reference the feature in your `devcontainer.json`:

```json
{
    "features": {
        "ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1": {}
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
| `sshPort` | string | `"2222"` | Container-side SSH port. Lace maps this asymmetrically: the host-side port is auto-allocated from the lace range (22425-22499). |
| `defaultShell` | string | `""` | Absolute path to the default login shell (e.g., `/usr/bin/nu`). Empty string means no shell change. Typically populated from `user.json` `defaultShell`. |
| `enableSshHardening` | boolean | `true` | Apply SSH hardening (key-only auth, no password, no root login). Disable only for debugging. |

## Dependencies

The feature declares `dependsOn` for two upstream features:

- `ghcr.io/devcontainers/features/sshd:1`: SSH daemon. Installed automatically; no need to declare it separately.
- `ghcr.io/devcontainers/features/git:1`: Git. Installed automatically; no need to declare it separately.

## Mount Declarations

The feature declares three lace mount slots in its metadata:

| Mount | Target | Description |
|-------|--------|-------------|
| `authorized-keys` | `/home/${_REMOTE_USER}/.ssh/authorized_keys` | SSH public key for lace access. Read-only file mount. |
| `dotfiles` | `/mnt/lace/repos/dotfiles` | Dotfiles repo for chezmoi apply at container start. |
| `screenshots` | `/mnt/lace/screenshots` | Host screenshots directory for Claude Code image references. Read-only. |

Mount sources are configured in `~/.config/lace/settings.json` or `~/.config/lace/user.json`.

## Init Script

The `lace-fundamentals-init` script is installed to `/usr/local/bin/` during the feature build.
It runs at container start (via `postCreateCommand`) and handles:

1. **Git identity**: reads `LACE_GIT_NAME`/`LACE_GIT_EMAIL` env vars (injected by lace from `user.json`) and writes them to `~/.gitconfig`.
2. **Dotfiles**: applies chezmoi from the dotfiles mount path. Defaults to `/mnt/lace/repos/dotfiles`; override with `LACE_DOTFILES_PATH` env var.

## Install Steps

The feature runs six install steps in order:

1. **staples**: ensures core utilities (curl, jq, less) are present.
2. **ssh-hardening**: disables password auth, enables pubkey-only, disables root login.
3. **ssh-directory**: prepares `~/.ssh` with correct ownership for the remote user.
4. **chezmoi**: installs chezmoi binary if not present.
5. **git-identity**: creates the `lace-fundamentals-init` runtime script.
6. **shell**: changes the remote user's login shell if `defaultShell` is set.
