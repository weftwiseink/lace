# lace

A devcontainer CLI that pre-bakes features onto base images at build time, eliminating cold-start installation delays during `devcontainer up`.

## Install

Prerequisites: Node.js 22+, Docker, and the [Dev Containers CLI](https://github.com/devcontainers/cli) on your PATH.

```sh
npm install lace
```

## Quick start

1. Add `prebuildFeatures` to your `.devcontainer/devcontainer.json`:

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

2. Prebuild, then start your devcontainer as usual:

```sh
lace prebuild
devcontainer up --workspace-folder .
```

3. Restore the Dockerfile before committing (the rewritten FROM is local-only):

```sh
lace restore
git add . && git commit
lace prebuild   # instant re-activation from cache
```

## Configuration

Lace reads `.devcontainer/devcontainer.json`. The only lace-specific key is `customizations.lace.prebuildFeatures`, which uses the same format as the top-level `features` key.

```jsonc
{
  "build": { "dockerfile": "Dockerfile" },
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/devcontainers/features/node:1": { "version": "22" }
      }
    }
  },
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {}
  }
}
```

Rules:

- A feature cannot appear in both `prebuildFeatures` and `features`. Overlap detection is version-insensitive.
- A Dockerfile-based build is required. Image-based configs are not supported.
- Set `prebuildFeatures` to `null` to silently skip prebuild, or `{}` to skip with a message.
- If `customizations.lace` is absent, lace reports nothing to prebuild and exits cleanly.

## Commands

### `lace prebuild`

Pre-bake features onto the base image. Rewrites the Dockerfile FROM line to point to the local pre-baked image.

```sh
lace prebuild [--dry-run] [--force]
```

| Flag | Effect |
|------|--------|
| `--dry-run` | Show planned actions without building or modifying files. |
| `--force` | Bypass cache and force a full rebuild. |

If a previous cache is still fresh (e.g., after `lace restore`), lace reactivates the prebuild by rewriting the Dockerfile without rebuilding. See [prebuild internals](docs/prebuild.md) for the full pipeline.

### `lace restore`

Undo the FROM rewrite, restoring the Dockerfile to its original state. The `.lace/prebuild/` cache is preserved for future reactivation.

```sh
lace restore
```

### `lace status`

Show the current prebuild state: active, cached, or inactive. Reports the original FROM reference, pre-baked tag, build timestamp, and whether the config has drifted since the last build.

```sh
lace status
```

## How it works

Lace splits your devcontainer features into two groups: prebuild features are baked into the base image once, while runtime features install normally via `devcontainer up`. On prebuild, lace generates a temporary build context, runs `devcontainer build` to produce a local image tagged `lace.local/...`, then rewrites your Dockerfile's FROM line to use it.

The `lace.local/` prefix is a local-only convention. These images live only in the local Docker daemon and are never pushed to a registry. The tag format is bidirectional, so `lace restore` can recover the original FROM reference from the tag alone.

For the full pipeline walkthrough, FROM rewriting details, cache internals, and lock file integration, see [docs/prebuild.md](docs/prebuild.md).

## .gitignore and workflow

Add `.lace/` to your `.gitignore`. It contains machine-specific build artifacts.

```
.lace/
```

Always restore before committing. The rewritten FROM points to `lace.local/...`, which only exists locally:

```sh
lace restore
git add . && git commit
lace prebuild
```

Use `lace status` to check whether a prebuild is active or stale, and `lace prebuild --dry-run` to preview actions without modifying anything.

## API

Lace exports its core functions for programmatic use:

```ts
import { runPrebuild, runRestore, runStatus } from "lace";
```

### Orchestration

| Function | Signature | Description |
|----------|-----------|-------------|
| `runPrebuild` | `(options?: PrebuildOptions) => PrebuildResult` | Run the full prebuild pipeline. |
| `runRestore` | `(options?: RestoreOptions) => RestoreResult` | Restore the Dockerfile (cache preserved). |
| `runStatus` | `(options?: StatusOptions) => StatusResult` | Report current prebuild state. |

### Dockerfile utilities

| Function | Description |
|----------|-------------|
| `parseDockerfile(content)` | AST-based parsing of the first FROM instruction and its ARG prelude. |
| `generateTag(imageName, tag, digest)` | Generate a `lace.local/` image tag. |
| `parseTag(laceTag)` | Reverse a `lace.local/` tag to the original image reference. |
| `rewriteFrom(content, newImageRef)` | Rewrite the first FROM line, preserving platform and alias. |
| `restoreFrom(content, originalImageRef)` | Restore the first FROM line to the original reference. |
| `generatePrebuildDockerfile(parsed)` | Generate a minimal Dockerfile from parsed data. |

### Config utilities

| Function | Description |
|----------|-------------|
| `readDevcontainerConfig(filePath)` | Read and parse a devcontainer.json (JSONC). |
| `extractPrebuildFeatures(raw)` | Extract `prebuildFeatures` with discriminated result types. |
| `validateNoOverlap(prebuild, features)` | Check for duplicate features across both maps. |

### Metadata and cache utilities

| Function | Description |
|----------|-------------|
| `readMetadata(dir)` | Read prebuild metadata from `.lace/prebuild/`. Returns null if absent. |
| `writeMetadata(dir, data)` | Write prebuild metadata. |
| `contextsChanged(dir, dockerfile, devcontainerJson)` | Compare current context against cache. Returns true if rebuild needed. |
| `mergeLockFile(projectLockPath, prebuildDir)` | Merge prebuild lock entries into the project lock file. |
