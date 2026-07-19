# Portless (portless)

Installs [portless](https://github.com/vercel-labs/portless) for localhost subdomain routing.
Declares a lace-managed proxy port with asymmetric mapping to portless's default port 1355.

## Version pin

The `version` option defaults to `0.15.3`, not `latest`.
portless 0.15.4 (published 2026-07-16) changed the proxy to bind loopback only, which breaks host ingress on rootless podman/pasta hosts: pasta delivers published ports to the container's interface address, which a loopback-only proxy never sees.
Versions 0.13.0 through 0.15.3 bind all interfaces, so the pinned proxy is reachable with no bridge process.
See [the pin proposal](https://github.com/weftwiseink/lace/blob/main/cdocs/proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md) for the full diagnosis.

Unpin condition: upstream ships an opt-in bind-address flag (or env var) decoupled from LAN/mDNS mode; then bump the pin and pass the flag explicitly.

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
| `version` | string | `0.15.3` | Portless version to install (npm version specifier). Pinned; see "Version pin" above. |

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
