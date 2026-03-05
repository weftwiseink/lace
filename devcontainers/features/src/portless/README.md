# Portless (portless)

Installs [portless](https://github.com/nicobrinkkemper/portless) for localhost subdomain routing.
Declares a lace-managed proxy port with asymmetric mapping to portless's default port 1355.

## Usage

Add to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/portless:1": {}
  }
}
```

Pin a specific version:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/portless:1": {
      "version": "1.2.3"
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `proxyPort` | string | `1355` | Container-internal portless proxy port. With lace, used as the container side of an asymmetric port mapping. |
| `version` | string | `latest` | Portless version to install (npm version specifier). |

## Dependencies

This feature requires Node.js (specifically `npm`) to install portless.

| Dependency | Why | Auto-installed? |
|------------|-----|-----------------|
| `ghcr.io/devcontainers/features/node:1` | Provides `npm` for global CLI installation | Yes (via `dependsOn`) |

**Automatic dependency resolution:** On tools that support `dependsOn` (devcontainer CLI v0.44.0+, VS Code), the node feature is installed automatically. You do not need to add it to your `devcontainer.json` manually.

**DevPod users:** DevPod does not currently support `dependsOn`. You must manually add `ghcr.io/devcontainers/features/node:1` to your `devcontainer.json` features, or use a base image that includes Node.js.

**Base images with Node.js:** If your base image already includes `npm`, the node feature dependency is satisfied by the base image and `dependsOn` will not install a duplicate.

The install script exits with an error if `npm` is not found.

## What gets installed

- `portless` CLI installed globally via `npm install -g portless`
- `/usr/local/share/portless-feature/entrypoint.sh`: auto-starts portless proxy daemon on port 1355

## Lace port declarations

This feature declares the following port in its `devcontainer-feature.json` metadata:

| Label | Default Port | Description |
|-------|-------------|-------------|
| `portless proxy` | `1355` | Portless proxy listener. Lace maps asymmetrically (e.g., `22435:1355`). |

## Feature ordering

This feature declares `installsAfter` for:
- `ghcr.io/devcontainers/features/common-utils`
