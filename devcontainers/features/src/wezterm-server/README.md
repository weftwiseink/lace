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
  },
  "postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `20240203-110809-5046fc22` | WezTerm release version string. |
| `createRuntimeDir` | boolean | `true` | Create `/run/user/<uid>` runtime directory for `wezterm-mux-server` (UID resolved from `_REMOTE_USER`). |

## What gets installed

- `/usr/local/bin/wezterm-mux-server` -- headless multiplexer daemon
- `/usr/local/bin/wezterm` -- CLI for interacting with the mux server

Binaries are extracted from the official `.deb` package without installing GUI dependencies.

## Supported platforms

- **Architectures**: x86_64 (amd64), aarch64 (arm64)
- **Distributions**: Debian, Ubuntu, and Debian derivatives

Fedora/RHEL (RPM) and AppImage support is planned for a future release.

## Feature ordering

This feature declares `installsAfter` for:
- `ghcr.io/devcontainers/features/common-utils` (provides `curl`)
- `ghcr.io/devcontainers/features/sshd` (SSH server for remote access)
