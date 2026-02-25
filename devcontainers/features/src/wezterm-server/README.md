# Wezterm Server (wezterm-server)

Installs `wezterm-mux-server` and `wezterm` CLI for headless terminal multiplexing via SSH domains. Extracts binaries from platform-native packages to avoid X11/Wayland GUI dependencies.

## Usage

Add to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  }
}
```

Pair with the [sshd feature](https://github.com/devcontainers/features/tree/main/src/sshd) for SSH domain multiplexing from the host:

```jsonc
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  }
  // The feature auto-starts the mux server via its entrypoint --
  // no postStartCommand needed.
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `20240203-110809-5046fc22` | WezTerm release version string. |
| `createRuntimeDir` | boolean | `true` | Create `/run/user/<uid>` runtime directory for `wezterm-mux-server` (UID resolved from `_REMOTE_USER`). |

## Workspace awareness

The feature installs a static `wezterm.lua` config that reads the `CONTAINER_WORKSPACE_FOLDER` environment variable at runtime. When set, new terminal panes open in the workspace directory instead of the user's home directory.

### How it works

- The entrypoint script starts `wezterm-mux-server` with `--config-file /usr/local/share/wezterm-server/wezterm.lua`.
- The config calls `os.getenv("CONTAINER_WORKSPACE_FOLDER")` and sets `config.default_cwd` if the variable is present.
- If the variable is not set, wezterm uses its default behavior (home directory). This means the feature degrades gracefully -- everything still works, panes just open in `$HOME`.

### Setting `CONTAINER_WORKSPACE_FOLDER`

**With lace:** The variable is injected automatically. No user configuration needed.

**Without lace:** Set the variable in your `devcontainer.json`:

```jsonc
{
  "containerEnv": {
    "CONTAINER_WORKSPACE_FOLDER": "${containerWorkspaceFolder}"
  }
}
```

## SSH key requirement (lace)

When used with [lace](https://github.com/weftwiseink/lace), this feature declares a validated mount for the SSH public key used to authenticate WezTerm SSH domain connections. Lace validates that the key file exists on the host **before** starting the container.

The key is mounted read-only at `/home/node/.ssh/authorized_keys` inside the container.

### One-time setup

Generate a dedicated SSH key for devcontainer access:

```sh
mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh
```

This creates `~/.config/lace/ssh/id_ed25519` (private key) and `~/.config/lace/ssh/id_ed25519.pub` (public key). Lace mounts the `.pub` file into the container.

### Using a different key

To use an existing SSH key instead, add an override to `~/.config/lace/settings.json`:

```jsonc
{
  "mounts": {
    "wezterm-server/authorized-keys": { "source": "~/.ssh/id_ed25519.pub" }
  }
}
```

The override path must point to an existing file.

### Skipping validation

If the SSH key is not available and you want to proceed anyway:

```sh
lace up --skip-validation
```

This downgrades the missing-key error to a warning. Docker will auto-create a directory at the key path, which means SSH authentication will not work until the key is properly configured.

## What gets installed

- `/usr/local/bin/wezterm-mux-server` -- headless multiplexer daemon
- `/usr/local/bin/wezterm` -- CLI for interacting with the mux server
- `/usr/local/share/wezterm-server/wezterm.lua` -- workspace-aware config (reads `CONTAINER_WORKSPACE_FOLDER`)
- `/usr/local/share/wezterm-server/entrypoint.sh` -- auto-starts mux server as the remote user

Binaries are extracted from the official `.deb` package without installing GUI dependencies.

## Supported platforms

- **Architectures**: x86_64 (amd64), aarch64 (arm64)
- **Distributions**: Debian, Ubuntu, and Debian derivatives

Fedora/RHEL (RPM) and AppImage support is planned for a future release.

## Lace mount declarations

This feature declares the following mount in its `devcontainer-feature.json` metadata (v1.2.0+):

| Label | Target | Type | Description |
|-------|--------|------|-------------|
| `wezterm-server/authorized-keys` | `/home/node/.ssh/authorized_keys` | file (readonly) | SSH public key for WezTerm SSH domain access |

When lace fetches the feature metadata from the OCI registry, it auto-injects a `${lace.mount(wezterm-server/authorized-keys)}` entry into the `mounts` array and validates the source file exists before container creation. If the devcontainer.json already has a static mount targeting `/home/node/.ssh/authorized_keys`, lace deduplicates it automatically.

## Feature ordering

This feature declares `installsAfter` for:
- `ghcr.io/devcontainers/features/common-utils` (provides `curl`)
- `ghcr.io/devcontainers/features/sshd` (SSH server for remote access)
