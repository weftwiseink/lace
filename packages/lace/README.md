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
2. Auto-inject `${lace.port()}` and `${lace.mount()}` templates from declarations
3. Validate mount declarations (namespaces, target conflicts)
4. Resolve all templates (port allocation, mount path resolution)
5. Emit guided configuration for unconfigured mounts
6. Prebuild features (if `prebuildFeatures` configured)
7. Resolve repo mounts (if `repoMounts` configured)
8. Generate `.lace/devcontainer.json` with resolved ports, mounts, and symlinks
9. Invoke `devcontainer up`

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

Lace resolves `${lace.port()}` and `${lace.mount()}` expressions anywhere in the devcontainer config. Any other `${lace.*}` expression is a hard error — this catches typos and stale references.

### Port templates

`${lace.port(<label>)}` resolves to a port number. The label format is `featureShortId/optionName`:

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

### Port auto-injection

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

## Mount templates

Lace resolves `${lace.mount()}` expressions in the devcontainer config, producing complete Docker mount spec strings from mount declarations and user settings.

### Accessor forms

| Form | Resolves to | Use case |
|------|-------------|----------|
| `${lace.mount(ns/label)}` | Full mount spec: `source=X,target=Y,type=bind[,readonly]` | `mounts` array entries |
| `${lace.mount(ns/label).source}` | Absolute host path | Debugging, manual construction |
| `${lace.mount(ns/label).target}` | Container target path | `containerEnv`, lifecycle commands |

The label format is `namespace/label`. Project-level mounts use the reserved `project` namespace. Feature-level mounts use the feature's short ID (e.g., `claude-code/config`).

### Declarations

Mounts are declared in `customizations.lace.mounts` — either in the devcontainer config (project-level) or in a feature's `devcontainer-feature.json` (feature-level):

```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "bash-history": {
          "target": "/commandhistory",
          "description": "Bash command history persistence"
        },
        "claude-config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      }
    }
  }
}
```

Declaration fields:

| Field | Required | Description |
|-------|----------|-------------|
| `target` | Yes | Container target path |
| `recommendedSource` | No | Suggested host path, shown in guided config (never used as actual source) |
| `description` | No | Human-readable description |
| `readonly` | No | Mount as read-only (default: false) |
| `type` | No | Docker mount type (default: `"bind"`) |
| `consistency` | No | Docker consistency hint (`"delegated"`, `"cached"`) |

### Auto-injection

Declared mounts are auto-injected into the `mounts` array as `${lace.mount(ns/label)}` entries. If a declaration's label already appears in the mounts array in any accessor form, injection is suppressed — the user's explicit entry controls placement.

Both regular features and prebuild features participate in auto-injection. Mounts are runtime config (`docker run` flags), so there is no build/runtime lifecycle asymmetry as there is with ports.

### Source resolution

The host source path for each mount is resolved in this order:

1. **Settings override**: `settings.json` → `mounts["ns/label"].source` (must exist on disk; hard error if missing)
2. **Default path**: `~/.config/lace/<projectId>/mounts/<namespace>/<label>` (auto-created)

Features declare mount _needs_ (a target path), not mount _sources_ (host directories). The actual source is always user-controlled: either an explicit settings override or a lace-managed empty default. This prevents features from silently mounting arbitrary host directories.

The `recommendedSource` field is guidance only — it appears in console output to help users configure their settings, but is never used as an actual mount source path.

### Guided configuration

When mounts resolve to default paths (no settings override), lace emits actionable guidance:

```
Mount configuration:
  project/claude-config: using default path ~/.config/lace/myproject/mounts/project/claude-config
    → Recommended: configure source to ~/.claude in settings.json

To configure custom mount sources, add to ~/.config/lace/settings.json:
{
  "mounts": {
    "project/claude-config": { "source": "~/.claude" }
  }
}
```

Guidance is informational only — `lace up` always succeeds, even without user configuration.

### Validation

Lace validates mount declarations before resolution:

- **Namespace validation**: each label's namespace must be `project` or a known feature short ID. Unknown namespaces produce a hard error.
- **Target conflict detection**: no two declarations may share the same container target path.
- **Declaration existence**: referencing an undeclared label (e.g., `${lace.mount(project/unknown)}`) fails with an error listing available labels.

### Settings

Mount source overrides live in `~/.config/lace/settings.json`:

```jsonc
{
  "mounts": {
    "project/claude-config": { "source": "~/.claude" },
    "project/bash-history": { "source": "~/dev_records/bash/history" }
  }
}
```

Override paths must exist on disk. Tilde (`~`) is expanded to the user's home directory.

### Example

**devcontainer.json** (source):
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "bash-history": { "target": "/commandhistory" },
        "claude-config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude"
        }
      }
    }
  },
  "mounts": [
    // Static mounts (not managed by lace):
    "source=${localEnv:HOME}/.ssh/key.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
    // project/bash-history and project/claude-config auto-injected from declarations
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"
  }
}
```

**Resolved `.lace/devcontainer.json`** (with `"project/claude-config": { "source": "~/.claude" }` in settings):
```jsonc
{
  "mounts": [
    "source=/home/user/.ssh/key.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=/home/user/.config/lace/myproject/mounts/project/bash-history,target=/commandhistory,type=bind",
    "source=/home/user/.claude,target=/home/node/.claude,type=bind"
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  }
}
```

> NOTE: Lace does not currently detect overlapping mount paths (e.g., `/home/node` and `/home/node/.claude`). If ordering matters, write explicit `${lace.mount()}` entries to control placement.

> NOTE: Only directory mounts with auto-creation are supported. Static file mounts (like SSH keys) should remain as plain mount strings, not lace declarations.

> NOTE: Multi-project mount sharing is not first-class. Two projects declaring `project/bash-history` get isolated directories (different project IDs). Share by pointing both to the same path via settings overrides.

## Feature metadata

Lace fetches `devcontainer-feature.json` metadata from OCI registries (via `devcontainer features info manifest`) for every feature in your config. This enables:

- **Option validation**: warns if you pass an option name not in the feature's schema
- **Port declaration validation**: ensures `customizations.lace.ports` keys match option names
- **Port auto-injection**: injects `${lace.port()}` templates for declared port options
- **Mount auto-injection**: injects `${lace.mount()}` templates for declared mount points

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

User-level settings at `~/.config/lace/settings.json` (or `$LACE_SETTINGS`) can override repo mounts to point at local paths instead of cloning:

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

## User-level data
> NOTE: Updated 2026-02-14

Lace stores data in three locations: a per-project `.lace/` directory, a user-level `~/.config/lace/` tree, and the local Docker daemon.

### File layout

```
~/.config/lace/
  settings.json                          # User settings (JSONC, manually created)
  cache/features/<encoded-id>.json       # OCI feature metadata cache
  <project-id>/repos/<name-or-alias>/    # Shallow git clones for repo mounts
  <project-id>/mounts/<ns>/<label>/      # Default mount source directories

<workspace>/.lace/                       # Per-project, gitignored
  devcontainer.json                      # Generated extended config
  port-assignments.json                  # Persisted port allocations
  mount-assignments.json                 # Persisted mount path assignments
  resolved-mounts.json                   # Resolved repo mount specs
  prebuild.lock                          # flock(1) exclusion file
  prebuild/
    Dockerfile, devcontainer.json        # Temp prebuild context
    devcontainer-lock.json               # Seeded lock for version pinning
    metadata.json                        # Prebuild state (original image, tag, timestamp)

Docker images: lace.local/<image>:<tag>  # Local-only prebuild images
```

Lace also modifies `.devcontainer/Dockerfile` (the FROM line) and `.devcontainer/devcontainer.json` (the `image` field) during prebuild; `lace restore` reverts these.

> NOTE(mjr): original design goal was for lace to be very minimalist/lightweight,
> thus the efforts to maintain devcontainer spec compliance,
> but the surface area for preprocessing/prebuilds has grown such that it may no longer be sensible.

### Configuration

**Settings file** (`~/.config/lace/settings.json`, JSONC format): discovered via `$LACE_SETTINGS` env var, then `~/.config/lace/settings.json`. Supports `mounts` overrides (see [Mount templates > Settings](#settings)) and `repoMounts` overrides (see [Settings overrides](#settings-overrides)).

**Environment variables**: `LACE_SETTINGS` — override path to settings file (must exist if set).

### Hardcoded defaults

Values that are fixed today but could become user-configurable:

| Value | Location | Current default |
|-------|----------|-----------------|
| Port range | `port-allocator.ts` | 22425–22499 |
| Port-check timeout | `port-allocator.ts` | 100 ms |
| Metadata cache TTL (floating tags) | `feature-metadata.ts` | 24 hours |
| Metadata cache dir | `feature-metadata.ts` | `~/.config/lace/cache/features/` |
| OCI token timeout | `oci-blob-fallback.ts` | 10 s |
| OCI blob download timeout | `oci-blob-fallback.ts` | 30 s |
| Git clone depth | `repo-clones.ts` | `--depth 1` |
| Container mount prefix (repo mounts) | `mounts.ts` | `/mnt/lace/repos` |
| Default mount source dir | `mount-resolver.ts` | `~/.config/lace/<projectId>/mounts/<ns>/<label>` |
| Docker image tag prefix | `dockerfile.ts` | `lace.local/` |

Note: paths under `~/.config/lace/` do not currently honor `$XDG_CONFIG_HOME` or `$XDG_CACHE_HOME`. The cache directory is stored alongside config rather than under `$XDG_CACHE_HOME`.
