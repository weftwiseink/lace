# lace

Devcontainer orchestration CLI. Manages port allocation, feature prebuilds, repo mounts, template resolution, workspace layout detection, and host-side validation on top of the standard `devcontainer` CLI.

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

1. Detect workspace layout and auto-configure `workspaceMount`/`workspaceFolder` (if `workspace` configured)
2. Run host-side validation checks (if `validate` configured)
3. Fetch and validate feature metadata from OCI registries
4. Auto-inject `${lace.port()}` and `${lace.mount()}` templates from declarations
5. Deduplicate static mounts superseded by declarations (same container target)
6. Validate mount declarations (namespaces, target conflicts)
7. Validate `sourceMustBe` mount declarations (file/directory existence checks)
8. Resolve all templates (port allocation, mount path resolution)
9. Warn about bind-mount sources that do not exist on the host
10. Emit guided configuration for unconfigured mounts
11. Prebuild features (if `prebuildFeatures` configured)
12. Resolve repo mounts (if `repoMounts` configured)
13. Generate `.lace/devcontainer.json` with resolved ports, mounts, and symlinks
14. Invoke `devcontainer up`

```sh
lace up [--workspace-folder <path>] [--no-cache] [--skip-metadata-validation] [--skip-validation]
```

| Flag | Effect |
|------|--------|
| `--workspace-folder <path>` | Workspace folder (defaults to cwd). |
| `--no-cache` | Bypass filesystem cache for floating feature tags (pinned versions still use cache). |
| `--skip-metadata-validation` | Skip feature metadata fetch/validation entirely (offline/emergency). |
| `--skip-validation` | Downgrade host-side validation errors to warnings (workspace layout mismatches, `fileExists` checks, and `sourceMustBe` mount validation). |

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

Mounts are declared in `customizations.lace.mounts` in two places:

**Project-level** (in `devcontainer.json`): labels are prefixed with the `project` namespace.

```jsonc
// devcontainer.json
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

These become `project/bash-history` and `project/claude-config` in the template system.

**Feature-level** (in `devcontainer-feature.json`): labels are prefixed with the feature's short ID. A feature that wants persistent state can declare mounts in its own metadata:

```jsonc
// devcontainer-feature.json (inside a feature like ghcr.io/example/my-feature)
{
  "id": "my-feature",
  "version": "1.0.0",
  "customizations": {
    "lace": {
      "mounts": {
        "cache": {
          "target": "/home/node/.cache/my-feature",
          "description": "Build cache persistence"
        }
      }
    }
  }
}
```

This becomes `my-feature/cache` in the template system. Lace reads feature-level declarations from OCI metadata (the same `devcontainer features info manifest` data used for port declarations).

Declaration fields:

| Field | Required | Description |
|-------|----------|-------------|
| `target` | Yes | Container target path |
| `recommendedSource` | No | Suggested host path, shown in guided config. For validated mounts (`sourceMustBe` set), also used as the default source path when no settings override is configured. |
| `description` | No | Human-readable description |
| `readonly` | No | Mount as read-only (default: false) |
| `type` | No | Docker mount type (default: `"bind"`) |
| `consistency` | No | Docker consistency hint (`"delegated"`, `"cached"`) |
| `sourceMustBe` | No | `"file"` or `"directory"`. When set, the resolved source must already exist as the specified type. Validation runs before template resolution; failure aborts `lace up` with an actionable error. See [Validated mounts](#validated-mounts). |
| `hint` | No | Remediation command shown when a validated source is missing (e.g., `"Run: ssh-keygen ..."`) |

### Auto-injection

Declared mounts are auto-injected into the `mounts` array as `${lace.mount(ns/label)}` entries. If a declaration's label already appears in the mounts array in any accessor form, injection is suppressed — the user's explicit entry controls placement.

Both regular features and prebuild features participate in auto-injection. Mounts are runtime config (`docker run` flags), so there is no build/runtime lifecycle asymmetry as there is with ports.

### Validated mounts

When a mount declaration sets `sourceMustBe`, lace validates that the source path exists and is the correct type (file or directory) **before** template resolution. This catches missing prerequisites early with actionable error messages instead of letting Docker silently auto-create an empty directory in their place.

Validated mounts follow a different resolution path than regular mounts:

1. **Settings override** (`settings.json`): used if configured. Must exist and match the expected type.
2. **`recommendedSource`**: used as the actual source (expanded via tilde). Must exist and match the expected type.
3. **No source available**: error with guidance to configure one in settings.

This differs from regular mounts, which fall back to an auto-created default directory under `~/.config/lace/`. Validated mounts never auto-create -- the source must already exist.

When validation fails, the error message includes:
- The feature name and required type (`wezterm-server requires file: ~/.config/lace/ssh/id_ed25519.pub`)
- The declaration's `description` (if set)
- The `hint` field as a remediation command (if set)
- Guidance on how to override the path via `settings.json`

The `--skip-validation` flag downgrades validated-mount errors to warnings. Lace continues but prints a warning that Docker will create a directory at the expected path, which silently breaks file mounts.

### Mount target deduplication

When a mount declaration and a static mount string in the `mounts` array share the same container target path, lace removes the static mount. This prevents Docker bind-mount conflicts when a feature adds a mount declaration for a target that previously required a manual static mount entry.

Deduplication only removes plain mount strings -- `${lace.mount()}` template entries are never removed. This runs automatically before template resolution.

### Source resolution

The host source path for each mount is resolved in this order:

1. **Settings override**: `settings.json` → `mounts["ns/label"].source` (must exist on disk; hard error if missing)
2. **Default path**: `~/.config/lace/<projectId>/mounts/<namespace>/<label>` (auto-created)

Features declare mount _needs_ (a target path), not mount _sources_ (host directories). For regular mounts (no `sourceMustBe`), the actual source is always user-controlled: either an explicit settings override or a lace-managed empty default. This prevents features from silently mounting arbitrary host directories.

The `recommendedSource` field serves two roles depending on `sourceMustBe`:
- **Without `sourceMustBe`**: guidance only -- appears in console output to help users configure their settings, but is never used as an actual mount source path.
- **With `sourceMustBe`**: used as the actual source path (after tilde expansion) when no settings override is configured. The source must already exist and match the expected type.

### Guided configuration

When mounts resolve to default paths (no settings override), `lace up` prints guidance to the console showing what was auto-created and how to configure it. This is not interactive — there is no prompt or wizard. Lace creates the default directory and proceeds, then tells you what happened:

```
Mount configuration:
  wezterm-server/authorized-keys: /home/user/.config/lace/ssh/id_ed25519.pub (file)
  project/bash-history: using default path /home/user/.config/lace/myproject/mounts/project/bash-history
  project/claude-config: using default path /home/user/.config/lace/myproject/mounts/project/claude-config
    → Optional: configure source to ~/.claude in settings.json

To configure custom mount sources, add to ~/.config/lace/settings.json:
{
  "mounts": {
    "project/claude-config": { "source": "~/.claude" }
  }
}
```

Validated mounts (those with `sourceMustBe`) are shown with their type annotation -- `(file)` or `(directory)` -- and are excluded from the generic settings.json hint since they handle their own resolution.

The `→ Recommended` line appears only when a declaration includes `recommendedSource` — a hint from the feature or project author about where the mount _should_ point (e.g., `~/.claude` for Claude config). Without a settings override, the mount still works but uses an empty auto-created directory, which may not have the data the feature expects.

The typical workflow: run `lace up`, read the guidance, then add overrides to `~/.config/lace/settings.json` for mounts where you want a specific host directory. Subsequent `lace up` runs use the override and suppress the recommendation.

### Validation

Lace validates mount declarations before resolution:

- **Namespace validation**: each label's namespace must be `project` or a known feature short ID. Unknown namespaces produce a hard error.
- **Target conflict detection**: no two declarations may share the same container target path.
- **Declaration existence**: referencing an undeclared label (e.g., `${lace.mount(project/unknown)}`) fails with an error listing available labels.
- **Source type validation**: declarations with `sourceMustBe` are checked before template resolution. The resolved source (from settings override or `recommendedSource`) must exist and match the declared type. See [Validated mounts](#validated-mounts).

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

> NOTE: Regular mount declarations (without `sourceMustBe`) auto-create the source as a directory via `mkdir -p`, so they only support directory mounts. For file mounts -- like SSH public keys or config files that must exist as files, not directories -- use `sourceMustBe: "file"` in the declaration. This validates the source exists as a file instead of auto-creating a directory. See [Validated mounts](#validated-mounts).

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

## Portless (localhost subdomain routing)

The portless devcontainer feature gives each dev server a stable `{name}.localhost` URL inside lace-managed containers. This eliminates port conflicts when running multiple services across worktrees.

### Setup

Add portless to `prebuildFeatures` in your devcontainer.json:

```jsonc
{
  "image": "node:24-bookworm",
  // Suppress VS Code auto-forward notifications for portless's internal app ports.
  "portsAttributes": {
    "4000-4999": { "onAutoForward": "silent" }
  },
  "customizations": {
    "lace": {
      "workspace": { "layout": "bare-worktree" },
      "prebuildFeatures": {
        "ghcr.io/weft/devcontainer-features/portless:0": {}
      }
    }
  }
}
```

Lace allocates a host port and maps asymmetrically to portless's default port 1355 inside the container (e.g., `22435:1355`).

### Usage

Start services through portless using the `{service}.{worktree}` naming convention:

```sh
# In worktree: /workspaces/lace/main
portless web.main next dev
# → http://web.main.localhost:22435

# In worktree: /workspaces/lace/add-websockets
portless web.add-websockets next dev
# → http://web.add-websockets.localhost:22435
```

Portless auto-starts the proxy, allocates an internal port for your app, and registers the `{name}.localhost` route. The `PORT` and `HOST` env vars are injected into the child process.

### Naming convention

| Worktree | Service | Name | URL |
|----------|---------|------|-----|
| main | web | `web.main` | `http://web.main.localhost:22435` |
| main | api | `api.main` | `http://api.main.localhost:22435` |
| main | (default) | `main` | `http://main.localhost:22435` |
| add-websockets | web | `web.add-websockets` | `http://web.add-websockets.localhost:22435` |

For single-service worktrees, the service prefix can be omitted: just `{worktree}`.

### URL access patterns

| Setup | URL pattern | Requirements |
|-------|-------------|--------------|
| Feature + lace | `http://web.main.localhost:22435` | Add the feature to prebuildFeatures |
| Feature, no lace | `http://web.main.localhost:1355` | Manual port forwarding for 1355 |
| No feature | `http://localhost:3000` | Raw dev server (port conflicts across worktrees) |

### How it works

Portless runs its proxy on port 1355 (default) inside the container. Lace allocates a host port from the 22425-22499 range and creates an asymmetric Docker mapping (e.g., `22435:1355`). The `*.localhost` domain resolves to `127.0.0.1` via RFC 6761 / nss-myhostname on Linux.

No lace core changes are needed -- the existing prebuild features pipeline handles asymmetric port injection automatically.

### Troubleshooting

If the portless proxy is running but no traffic arrives:

- **Docker port mapping**: `docker port <container>` -- verify the asymmetric mapping exists
- **Host DNS**: `getent hosts web.main.localhost` -- must resolve to `127.0.0.1`
- **Portless routes**: `portless list` inside the container -- verify the route is registered
- **Proxy status**: `curl -sf http://localhost:1355/` inside the container -- should return HTTP 404 (no routes match)
- **Host access**: `curl -H "Host: web.main.localhost" http://localhost:22435/` -- bypasses DNS

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

User-level settings at `~/.config/lace/settings.json` (or `$LACE_SETTINGS`) can override repo mounts to point at local paths instead of cloning.

The optional `target` field controls where the repo appears inside the container. Two common reasons to set a custom target:
- **Semantic paths**: place a dotfiles repo at `~/.dotfiles` instead of the default `/mnt/lace/repos/dotfiles`.
- **Host-path mirroring**: mount at the exact host path (e.g., `/var/home/user/code/tool-registry`) so that tools which store absolute host paths in bind-mounted config files can still resolve them inside the container. See [Tool integration patterns](#tool-integration-patterns) for details.
- **Cross-repo work**: When working on a cross-cutting concern, directly editing a downstream repo by utilizing `"readonly": false` is sensible.

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

## Workspace layout

Lace can detect bare-repo worktree layouts and auto-generate the correct `workspaceMount`, `workspaceFolder`, and `postCreateCommand` settings. This eliminates the need to manually coordinate four settings when using the nikitabobko bare-worktree convention.

### Configuration

Add a `workspace` block to `customizations.lace`:

```jsonc
{
  "customizations": {
    "lace": {
      "workspace": {
        "layout": "bare-worktree",   // "bare-worktree" | false
        "mountTarget": "/workspaces", // container mount path (default: "/workspaces")
        "postCreate": {
          "safeDirectory": true,     // inject safe.directory '*' (default: true)
          "scanDepth": 2             // git.repositoryScanMaxDepth (default: 2)
        }
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `layout` | `"bare-worktree" \| false` | required | Layout type to detect and configure. |
| `mountTarget` | `string` | `"/workspaces"` | Container mount target for the bare-repo root. |
| `postCreate.safeDirectory` | `boolean` | `true` | Inject `git config --global --add safe.directory '*'` into `postCreateCommand`. |
| `postCreate.scanDepth` | `number` | `2` | Set `git.repositoryScanMaxDepth` in VS Code settings. |

### How it works

When `layout: "bare-worktree"` is set, lace inspects the workspace directory's `.git` file to determine the layout:

1. **Worktree detected**: The `.git` file points to `.bare/worktrees/<name>`. Lace sets `workspaceMount` to mount the bare-repo root and `workspaceFolder` to the worktree subdirectory.
2. **Bare-root detected**: The `.git` file points to `.bare`. Lace sets `workspaceMount` to mount the current directory and `workspaceFolder` to the mount target root.
3. **Normal clone detected**: `.git` is a directory (not a file). Lace returns an error — the layout declaration does not match the workspace.

Detection is filesystem-only (no `git` binary required). It parses the `.git` file content and resolves relative paths.

Lace sets `CONTAINER_WORKSPACE_FOLDER` in `containerEnv` to the resolved `workspaceFolder` path. Tools inside the container can use this to determine their working directory without relying on host paths.

### Example

For a worktree at `/home/user/code/project/main` with bare-repo root at `/home/user/code/project`:

**Source `devcontainer.json`:**
```jsonc
{
  "image": "node:24-bookworm",
  "customizations": {
    "lace": {
      "workspace": { "layout": "bare-worktree" }
    }
  }
}
```

**Generated `.lace/devcontainer.json`:**
```jsonc
{
  "image": "node:24-bookworm",
  "workspaceMount": "source=/home/user/code/project,target=/workspaces,type=bind,consistency=delegated",
  "workspaceFolder": "/workspaces/main",
  "postCreateCommand": "git config --global --add safe.directory '*'"
}
```

### Overrides

If you set `workspaceMount` or `workspaceFolder` explicitly in your `devcontainer.json`, lace respects your values and does not override them. The workspace detection still runs for validation but skips auto-generation of the fields you have already set.

## Host-side validation

Lace can check that required host resources exist before invoking `devcontainer up`, producing actionable error messages instead of cryptic Docker failures.

### Configuration

Add a `validate` block to `customizations.lace`:

```jsonc
{
  "customizations": {
    "lace": {
      "validate": {
        "fileExists": [
          {
            "path": "~/.ssh/lace_devcontainer.pub",
            "severity": "error",
            "hint": "Run: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ''"
          },
          {
            "path": "~/.claude",
            "severity": "warn",
            "hint": "Claude Code config directory. Create with: mkdir -p ~/.claude"
          }
        ]
      }
    }
  }
}
```

### `fileExists` checks

Each entry validates that a file or directory exists on the host before container creation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | `string` | required | Host path. `~` is expanded to `$HOME`. |
| `severity` | `"error" \| "warn"` | `"error"` | `error` aborts `lace up`; `warn` prints a warning and continues. |
| `hint` | `string` | none | Remediation guidance printed alongside the error/warning. |

A bare string is shorthand for `{ "path": "<string>", "severity": "error" }`:

```jsonc
{
  "validate": {
    "fileExists": [
      "~/.ssh/lace_devcontainer.pub",
      { "path": "~/.claude", "severity": "warn" }
    ]
  }
}
```

### Inferred mount validation

In addition to explicit `validate` checks, lace automatically scans the resolved `mounts` array and `workspaceMount` for bind-mount sources that do not exist on the host. This catches common mistakes like a missing SSH public key in a bind mount.

- Mount sources containing `${` (devcontainer variables like `${localEnv:HOME}`, `${localWorkspaceFolder}`) are skipped — these are resolved by the devcontainer CLI, not lace.
- Missing bind-mount sources produce **warnings**, not errors, because Docker auto-creates missing directory sources. Only missing file sources cause Docker failures.
- Non-bind mounts (volume, tmpfs) are not checked.

This runs automatically after template resolution with no configuration needed.

### `--skip-validation`

The `--skip-validation` flag downgrades all `severity: "error"` checks to warnings, allowing `lace up` to proceed despite validation failures. This applies to `fileExists` checks, workspace layout mismatches (detection still runs since it generates config), and `sourceMustBe` mount validation. For validated mounts, the warning notes that Docker will auto-create a directory at the expected path, which silently breaks file mounts.

```sh
lace up --skip-validation
```

## Tool integration patterns

Host-side tools that persist configuration in bind-mounted directories can break inside containers when path assumptions don't hold. This section documents common patterns and fixes.

### Nested file mounts

Some tools look for a config file *inside* a directory that is also a standalone file on the host. When `CLAUDE_CONFIG_DIR` is set to a directory (e.g., `/home/node/.claude`), Claude Code reads `$CLAUDE_CONFIG_DIR/.claude.json` — inside the directory. On the host, that file lives at `~/.claude.json` — a sibling *outside* `~/.claude/`. A directory bind mount of `~/.claude` never includes `~/.claude.json`.

The fix is a second mount declaration with `sourceMustBe: "file"` that overlays the specific file onto the directory mount:

```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "claude-config": {
          "target": "/home/node/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code credentials, session data, and settings"
        },
        "claude-config-json": {
          "target": "/home/node/.claude/.claude.json",
          "recommendedSource": "~/.claude.json",
          "sourceMustBe": "file",
          "description": "Claude Code state (onboarding, account cache)",
          "hint": "Run 'claude' on the host first to create this file"
        }
      }
    }
  },
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"
  }
}
```

**General pattern:** when a tool changes where it looks for a config file based on an env var or directory convention, check whether the host stores that file at a different relative path. If so, add a file mount that overlays it.

### Host-path-dependent tools

Tools that store absolute host paths in their configuration files (plugin registries, marketplace directories, project path mappings) break inside containers because those paths don't exist in the container's filesystem namespace. The config files arrive via bind mount with the host paths baked in.

Two approaches:

1. **Prefer network-backed references.** If the tool supports both local-path and remote (e.g., GitHub) references, use the remote variant. Remote references cache their data inside the config directory, which is already bind-mounted. Example: Claude Code plugins can be installed from a GitHub-backed marketplace (`cdocs@weft-marketplace`) instead of a local directory marketplace (`cdocs@clauthier`).

2. **Mirror the host path with `overrideMount.target`.** For tools that only support local paths, use a repo mount with `overrideMount.target` set to the exact host path. This makes the host path resolve inside the container. See [Settings overrides](#settings-overrides) for syntax.

> NOTE: Avoid modifying bind-mounted config files (like `installed_plugins.json`) to add container-specific path entries. The file is shared between host and container — changes from one side affect the other. Prefer approaches that don't mutate shared state.

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
  ssh/                                   # SSH keys for devcontainer access (user-created)
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

## Further reading

- [Architecture overview](docs/architecture.md) -- how `lace up` transforms your config through its pipeline
- [Troubleshooting guide](docs/troubleshooting.md) -- common failure modes with symptoms, causes, and fixes
- [Migration guide](docs/migration.md) -- incremental steps from `devcontainer` CLI to lace
- [Prebuild internals](docs/prebuild.md) -- FROM rewriting, cache behavior, image tagging
- [Contributing guidelines](../../CONTRIBUTING.md) -- codebase idioms, testing patterns, conventions
