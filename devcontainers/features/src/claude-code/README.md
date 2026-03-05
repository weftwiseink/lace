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

## Dependencies

This feature requires Node.js (specifically `npm`) to install the Claude Code CLI.

| Dependency | Why | Auto-installed? |
|------------|-----|-----------------|
| `ghcr.io/devcontainers/features/node:1` | Provides `npm` for global CLI installation | Yes (via `dependsOn`) |

**Automatic dependency resolution:** On tools that support `dependsOn` (devcontainer CLI v0.44.0+, VS Code), the node feature is installed automatically. You do not need to add it to your `devcontainer.json` manually.

**DevPod users:** DevPod does not currently support `dependsOn`. You must manually add `ghcr.io/devcontainers/features/node:1` to your `devcontainer.json` features, or use a base image that includes Node.js.

**Base images with Node.js:** If your base image already includes `npm` (e.g., `mcr.microsoft.com/devcontainers/javascript-node`), the node feature dependency is satisfied by the base image and `dependsOn` will not install a duplicate.

The install script exits with an error if `npm` is not found.

## What gets installed

- `claude` CLI installed globally via `npm install -g @anthropic-ai/claude-code`
- `/home/${_REMOTE_USER}/.claude` directory created with appropriate ownership and permissions (mode 700)
