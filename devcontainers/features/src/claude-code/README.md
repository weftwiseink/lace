# Claude Code (claude-code)

Installs the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI globally via npm.
Declares a lace mount for persistent Claude configuration, credentials, and session state.

## Usage

Add to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
  }
}
```

Pin a specific version:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
      "version": "1.0.20"
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `latest` | Claude Code version to install (npm version specifier). |

## Persistent configuration (lace)

This feature declares a lace mount for `~/.claude` inside the container.
When used with [lace](https://github.com/weftwiseink/lace), the host's `~/.claude` directory is automatically bind-mounted into the container, preserving authentication tokens, configuration, and session state across container rebuilds.

Without the mount, Claude Code will need to re-authenticate each time the container is rebuilt.

## Lace mount declarations

This feature declares the following mount in its `devcontainer-feature.json` metadata:

| Label | Target | Type | Description |
|-------|--------|------|-------------|
| `claude-code/config` | `/home/${_REMOTE_USER}/.claude` | directory | Claude Code configuration, credentials, and session state |

When lace fetches the feature metadata from the OCI registry, it auto-injects a mount entry and validates the source directory exists before container creation.

## What gets installed

- `claude` CLI installed globally via `npm install -g @anthropic-ai/claude-code`
- `/home/${_REMOTE_USER}/.claude` directory created with appropriate ownership and permissions (mode 700)
