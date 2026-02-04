# Prebuild pipeline internals

Detailed reference for lace's prebuild pipeline, cache behavior, image tagging, and lock file integration. For usage and quick start, see the [README](../README.md).

## Supported configuration types

Lace prebuild supports both **Dockerfile-based** and **image-based** devcontainer configurations:

| Config type | Example | Prebuild behavior |
|-------------|---------|-------------------|
| Dockerfile | `"build": { "dockerfile": "Dockerfile" }` | Rewrites `FROM` line in Dockerfile |
| Image | `"image": "node:24"` | Rewrites `image` field in devcontainer.json |

When both `build.dockerfile` and `image` are present, Dockerfile takes precedence (this is standard devcontainer behavior).

## Pipeline steps

When you run `lace prebuild`, these steps execute in order:

1. **Read config.** Parse `.devcontainer/devcontainer.json` (JSONC-aware) and extract the `prebuildFeatures` map.

2. **Validate.** Check that no feature appears in both `prebuildFeatures` and `features`. Detection is version-insensitive: `git:1` and `git:2` are considered the same feature.

3. **Parse build source.** Depending on config type:
   - **Dockerfile:** Use AST-based parsing (via `dockerfile-ast`) to extract the first `FROM` instruction, including any `ARG` prelude, `--platform` flags, and `AS` aliases.
   - **Image:** Parse the image reference to extract the image name, tag, and digest.

4. **Generate temp context.** Create a minimal build context in `.lace/prebuild/` containing:
   - **Dockerfile config:** A Dockerfile with only the ARG prelude and the original FROM line.
   - **Image config:** A synthetic Dockerfile with `FROM <image>`.
   - A devcontainer.json that promotes `prebuildFeatures` to the `features` key.

5. **Cache check.** Compare the generated context against the cached context from the last build. If nothing changed, skip the build (unless `--force` is set).

6. **Build.** Shell out to `devcontainer build` with the temp context, tagging the resulting image with a `lace.local/` prefixed name.

7. **Rewrite source.**
   - **Dockerfile config:** Replace the Dockerfile's first `FROM` line with the pre-baked image reference. Platform flags and aliases are preserved.
   - **Image config:** Replace the `image` field in devcontainer.json with the pre-baked image reference. Comments and formatting are preserved (JSONC-aware).

8. **Merge lock file.** Write prebuild feature lock entries into the project's `devcontainer-lock.json` under the `lace.prebuiltFeatures` namespace.

9. **Write metadata.** Save the original FROM/image reference, prebuild tag, config type, and timestamp to `.lace/prebuild/metadata.json`.

If the build fails at step 6, the Dockerfile is not modified. The pipeline is atomic with respect to the Dockerfile: it is only rewritten on success.

## FROM rewriting (Dockerfile configs)

Lace rewrites only the first `FROM` instruction in the Dockerfile. It preserves:

- `--platform` flags (e.g., `--platform=linux/amd64`)
- `AS` aliases (e.g., `AS builder`)
- All other lines (comments, subsequent stages, etc.)

Before:
```dockerfile
ARG BASE=node:24-bookworm
FROM ${BASE} AS dev
RUN apt-get update
```

After `lace prebuild`:
```dockerfile
ARG BASE=node:24-bookworm
FROM lace.local/node:24-bookworm AS dev
RUN apt-get update
```

After `lace restore`:
```dockerfile
ARG BASE=node:24-bookworm
FROM node:24-bookworm AS dev
RUN apt-get update
```

If the Dockerfile already has a `lace.local/` FROM from a previous prebuild, lace automatically restores the original FROM before parsing. Re-running prebuild after a config change works without a manual `lace restore` first.

## Image field rewriting (image configs)

For image-based configurations, lace rewrites the `image` field in `devcontainer.json`. Comments and formatting are preserved using JSONC-aware modification.

Before:
```json
{
  // My devcontainer config
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {}
      }
    }
  }
}
```

After `lace prebuild`:
```json
{
  // My devcontainer config
  "image": "lace.local/mcr.microsoft.com/devcontainers/base:ubuntu",
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {}
      }
    }
  }
}
```

After `lace restore`:
```json
{
  // My devcontainer config
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {}
      }
    }
  }
}
```

If the `image` field already has a `lace.local/` prefix from a previous prebuild, lace automatically restores the original image before parsing.

## The `lace.local/` image naming convention

Pre-baked images are tagged with a `lace.local/` prefix. These images exist only in the local Docker daemon and are never pushed to a registry. The prefix signals that the FROM line (Dockerfile) or image field (devcontainer.json) has been modified by lace.

> **Note:** The `lace.local/` prefix is reserved for lace-managed images. Avoid manually setting images to `lace.local/...` outside of the prebuild workflow.

| Original FROM | Pre-baked image tag |
|---|---|
| `node:24-bookworm` | `lace.local/node:24-bookworm` |
| `ubuntu:22.04` | `lace.local/ubuntu:22.04` |
| `node@sha256:abc123...` | `lace.local/node:from_sha256__abc123...` |
| `node` (no tag) | `lace.local/node:latest` |

For digest-based references, the digest is converted to a tag-safe format (`sha256:abc` becomes `from_sha256__abc`), since Docker tags cannot contain the `@` character. Tags exceeding Docker's 128-character limit are truncated.

### Bidirectional tag format

The tag format is bidirectional: `generateTag` and `parseTag` are inverses. `lace restore` uses `parseTag` to recover the original image reference from the `lace.local/` tag without requiring metadata:

| Pre-baked tag | Recovered original |
|---|---|
| `lace.local/node:24-bookworm` | `node:24-bookworm` |
| `lace.local/ghcr.io/owner/image:v2` | `ghcr.io/owner/image:v2` |
| `lace.local/node:from_sha256__abc123` | `node@sha256:abc123` |
| `lace.local/node:latest` | `node:latest` |

The only minor ambiguity is `node:latest`: the original may have been untagged `FROM node`, but `node:latest` is semantically equivalent.

## Cache internals

Lace caches the build context from the last prebuild in `.lace/prebuild/`:

| File | Purpose |
|------|---------|
| `Dockerfile` | The minimal Dockerfile used for the last prebuild (or synthetic `FROM <image>` for image configs) |
| `devcontainer.json` | The temp devcontainer.json used for the last prebuild |
| `metadata.json` | Original FROM/image, prebuild tag, config type, and timestamp |

On subsequent runs, lace compares the newly generated context against the cached files. If they match (normalized for whitespace/formatting differences), the build is skipped:

```
Prebuild is up to date (lace.local/node:24-bookworm). Use --force to rebuild.
```

### Cache reactivation

After `lace restore`, the `.lace/prebuild/` cache is preserved. When you run `lace prebuild` again with the same configuration, lace detects the cache is fresh and reactivates the prebuild by rewriting the source without running `devcontainer build`:

For Dockerfile configs:
```
Prebuild reactivated from cache. Dockerfile FROM rewritten to: lace.local/node:24-bookworm
```

For image configs:
```
Prebuild reactivated from cache. devcontainer.json image rewritten to: lace.local/mcr.microsoft.com/devcontainers/base:ubuntu
```

This makes the restore-commit-prebuild workflow instant.

## Lock file integration

When `devcontainer build` runs during prebuild, it generates a `devcontainer-lock.json` in the temp context directory. Lace merges these lock entries into the project's `.devcontainer/devcontainer-lock.json` under a separate namespace:

```json
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      "version": "1.0.0",
      "resolved": "ghcr.io/devcontainers/features/sshd@sha256:..."
    }
  },
  "lace.prebuiltFeatures": {
    "ghcr.io/devcontainers/features/git:1": {
      "version": "1.0.0",
      "resolved": "ghcr.io/devcontainers/features/git@sha256:..."
    }
  }
}
```

The `lace.prebuiltFeatures` namespace keeps prebuild lock entries separate from the regular `features` entries that `devcontainer up` manages. This prevents conflicts and makes it clear which features were pre-baked.
