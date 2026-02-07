# lace

Devcontainer orchestration CLI. Manages port allocation, feature prebuilds, repo mounts, and template resolution on top of the standard `devcontainer` CLI.

## Install

Prerequisites: Node.js 22+, Docker, and the [Dev Containers CLI](https://github.com/devcontainers/cli) on your PATH.

```sh
npm install lace
```

## Quick start

```sh
lace up --workspace-folder .
```

`lace up` reads `.devcontainer/devcontainer.json`, resolves templates, allocates ports, runs prebuilds and repo mounts if configured, generates an extended config at `.lace/devcontainer.json`, and invokes `devcontainer up` with it.

## Commands

### `lace up`

The main command. Runs the full orchestration pipeline:

1. Fetch and validate feature metadata from OCI registries
2. Auto-inject `${lace.port()}` templates for features with port declarations
3. Resolve all templates (port allocation)
4. Prebuild features (if `prebuildFeatures` configured)
5. Resolve repo mounts (if `repoMounts` configured)
6. Generate `.lace/devcontainer.json` with resolved ports, mounts, and symlinks
7. Invoke `devcontainer up`

```sh
lace up [--workspace-folder <path>] [--no-cache] [--skip-metadata-validation]
```

| Flag | Effect |
|------|--------|
| `--workspace-folder <path>` | Workspace folder (defaults to cwd). |
| `--no-cache` | Bypass filesystem cache for floating feature tags (pinned versions still use cache). |
| `--skip-metadata-validation` | Skip feature metadata fetch/validation entirely (offline/emergency). |

Any unrecognized flags are passed through to `devcontainer up`.

### `lace prebuild`

Pre-bake features onto the base image. Supports both Dockerfile-based and image-based configs.

```sh
lace prebuild [--dry-run] [--force]
```

| Flag | Effect |
|------|--------|
| `--dry-run` | Show planned actions without building or modifying files. |
| `--force` | Bypass cache and force a full rebuild. |

### `lace restore`

Undo the prebuild rewrite, restoring the original Dockerfile FROM or devcontainer.json `image` field. The `.lace/prebuild/` cache is preserved for future reactivation.

```sh
lace restore
```

### `lace status`

Show current prebuild state: active, cached, or inactive. Reports the original image reference, prebuild tag, build timestamp, and whether the config has changed since the last build.

```sh
lace status
```

### `lace resolve-mounts`

Resolve repo mounts independently (normally run as part of `lace up`).

```sh
lace resolve-mounts [--workspace-folder <path>] [--dry-run]
```

## Port allocation

Lace allocates ports in the range 22425--22499 and uses a **symmetric port model**: the same port number is used on both the host and inside the container. This avoids port-mapping confusion when multiple containers run simultaneously.

Allocated ports are persisted in `.lace/port-assignments.json` and reused across runs for stability. If a previously assigned port is occupied, lace reassigns from the range.

For each allocated port, lace auto-generates:
- `appPort` entries (Docker `-p` bindings, e.g. `"22430:22430"`)
- `forwardPorts` entries (VS Code port forwarding)
- `portsAttributes` entries (labels and `requireLocalPort: true`)

User-provided entries in any of these fields suppress the corresponding auto-generated entry for that port.

## Template variables

Lace resolves `${lace.port(<label>)}` expressions anywhere in the devcontainer config. The label format is `featureShortId/optionName`:

```jsonc
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      "port": "${lace.port(sshd/port)}"
    }
  }
}
```

**Type coercion**: When a `${lace.port()}` expression is the entire string value, it resolves to an integer. When embedded in a larger string, it resolves to a string with the port number substituted.

### Auto-injection

Features can declare port options in their `devcontainer-feature.json` via `customizations.lace.ports`:

```jsonc
{
  "id": "sshd",
  "options": {
    "port": { "type": "string", "default": "2222" }
  },
  "customizations": {
    "lace": {
      "ports": {
        "port": {
          "label": "SSH",
          "requireLocalPort": true
        }
      }
    }
  }
}
```

When a feature declares `customizations.lace.ports`, lace auto-injects `${lace.port()}` templates for any port options the user has **not** explicitly set. This means zero-config port allocation -- just include the feature and lace handles the rest.

## Feature metadata

Lace fetches `devcontainer-feature.json` metadata from OCI registries (via `devcontainer features info manifest`) for every feature in your config. This enables:

- **Option validation**: warns if you pass an option name not in the feature's schema
- **Port declaration validation**: ensures `customizations.lace.ports` keys match option names
- **Auto-injection**: injects port templates for declared port options

Metadata is cached at `~/.config/lace/cache/features/`. Pinned versions (exact semver, digest refs) are cached permanently. Floating tags (major-only, `latest`) expire after 24 hours.

## Prebuilds

Features listed under `customizations.lace.prebuildFeatures` are pre-built into a cached local image before container creation:

```jsonc
{
  "build": { "dockerfile": "Dockerfile" },
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
      }
    }
  },
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {}
  }
}
```

Rules:
- A feature cannot appear in both `prebuildFeatures` and `features` (overlap detection is version-insensitive).
- Both Dockerfile-based and image-based configs are supported.
- Set `prebuildFeatures` to `null` to silently skip, or `{}` to skip with a message.
- `${lace.port()}` expressions in `prebuildFeatures` are **not** resolved (a warning is emitted). Prebuild features use their default option values.

The prebuild image is tagged `lace.local/<base-image>` and stored in the local Docker daemon only. After building, lace rewrites the Dockerfile FROM or `image` field to point at it. Use `lace restore` before committing to revert the rewrite.

## Repo mounts

Declare repos to clone and mount into the container:

```jsonc
{
  "customizations": {
    "lace": {
      "repoMounts": {
        "github.com/user/dotfiles": {},
        "github.com/user/shared-tools": { "alias": "tools" }
      }
    }
  }
}
```

Each repo is shallow-cloned to `~/.config/lace/<project>/repos/<name>` on the host and bind-mounted read-only at `/mnt/lace/repos/<name>` in the container. Repos with subdirectory paths (e.g., `github.com/user/repo/sub/dir`) clone the full repo but mount only the subdirectory.

The `alias` option provides an explicit name when multiple repos would derive the same name.

### Settings overrides

User-level settings at `~/.config/lace/settings.json` (or `~/.lace/settings.json`, or `$LACE_SETTINGS`) can override repo mounts to point at local paths instead of cloning:

```jsonc
{
  "repoMounts": {
    "github.com/user/dotfiles": {
      "overrideMount": {
        "source": "~/code/dotfiles",
        "readonly": true,
        "target": "/home/node/.dotfiles"
      }
    }
  }
}
```

When `target` differs from the default (`/mnt/lace/repos/<name>`), lace generates a symlink from the default location to the custom target via `postCreateCommand`.

## .gitignore

Add `.lace/` to your `.gitignore`. It contains machine-specific artifacts (port assignments, prebuild cache, generated configs):

```
.lace/
```

## Workflow

```sh
# Normal development
lace up

# Before committing (if using prebuilds)
lace restore
git add . && git commit
lace prebuild   # instant re-activation from cache

# Check prebuild state
lace status

# Force rebuild after changing prebuild features
lace prebuild --force
```
