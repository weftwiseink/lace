---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T10:15:00-08:00
task_list: lace/feature-overhaul
type: report
state: live
status: review_ready
tags: [investigation, features, oci, devcontainer-cli, caching, architecture]
---

# Feature Manifest Fetching Options

> **BLUF:** The `devcontainer features info` CLI command is the best mechanism for fetching feature metadata at lace orchestration time. It returns the complete `devcontainer-feature.json` via OCI manifest annotations, adds zero new dependencies, handles registry auth automatically, and is already tested and working. Local-path features are handled by direct filesystem read. A two-tier cache (in-memory per-run, filesystem for pinned versions) eliminates redundant lookups.

## Context / Background

Lace's proposed `customizations.lace.features` section needs feature metadata at `lace up` time for three purposes: (1) validating that template variables (e.g., `${lace.local.openPort()}`) target real feature options, (2) detecting conflicts between lace-templated features and standard `features` declarations, and (3) understanding what a feature provides (mounts, env vars, lifecycle hooks) before promoting it into the extended config.

The devcontainer feature spec stores metadata in `devcontainer-feature.json` inside the feature tarball, but also publishes it as the `dev.containers.metadata` annotation on the OCI manifest -- meaning the full metadata is available without downloading the tarball.

This report evaluates five approaches to retrieving that metadata, with attention to external dependencies, auth handling, caching, and offline behavior.

## Key Findings

- **`devcontainer features info manifest` works exactly as needed.** Tested: `devcontainer features info manifest ghcr.io/devcontainers/features/git:1 --output-format json` returns the full OCI manifest with the `dev.containers.metadata` annotation in <1s. The metadata contains: `id`, `version`, `name`, `options` (with types, defaults, proposals, enums), `customizations`, `installsAfter`, `description`, `documentationURL`.
- **The `verbose` mode adds published tags.** `devcontainer features info verbose <id> --output-format json` returns everything from `manifest` plus the full list of published version tags and a `canonicalId` with SHA256 digest.
- **`devcontainer features resolve-dependencies`** resolves the full dependency graph from a workspace config. Could be useful for validating that lace-promoted features don't conflict with existing dependency chains, though this is a stretch goal.
- **Local-path features bypass all of this.** Features referenced as `./features/my-feature` or absolute paths just have a `devcontainer-feature.json` file in that directory. No network or CLI call needed.
- **OCI metadata is immutable for pinned versions.** A feature at `ghcr.io/org/features/foo:1.2.3` will always return the same metadata. Floating tags (`:1`, `:latest`) resolve to different digests over time but are stable within a single `lace up` run.

## Options Analysis

### Option 1: `devcontainer features info` CLI (Recommended)

Spawn `devcontainer features info manifest <feature-id> --output-format json` and parse the JSON response. Extract `dev.containers.metadata` from `manifest.annotations`.

| Aspect | Assessment |
|--------|-----------|
| New dependencies | None -- devcontainer CLI already required |
| Auth handling | Inherits Docker credential store automatically |
| Registry compatibility | Works with any OCI-compliant registry (ghcr.io, Docker Hub, ACR, ECR) |
| Performance | ~500ms-1s per feature (subprocess spawn + network) |
| Local features | Not supported -- separate code path needed |
| Error handling | CLI returns non-zero exit + stderr on failure |
| Maturity | Stable, part of `@devcontainers/cli` since v0.50+ |

**Parallelization note:** Multiple `devcontainer features info` calls can run concurrently via `Promise.all()` on spawned subprocesses. A project with 3-5 features would complete metadata fetching in ~1s wall time.

### Option 2: Direct OCI Registry HTTP API

Use Node's `fetch()` to call the OCI distribution API directly: acquire a token, then fetch the manifest with the appropriate `Accept` header.

```
GET https://ghcr.io/token?scope=repository:<ns>/<feature>:pull
GET /v2/<ns>/<feature>/manifests/<tag>  (Accept: application/vnd.oci.image.manifest.v1+json)
```

| Aspect | Assessment |
|--------|-----------|
| New dependencies | None (uses built-in `fetch`) |
| Auth handling | Must implement: credential store lookup, token refresh, bearer auth |
| Registry compatibility | Token endpoints differ per registry; requires per-registry logic |
| Performance | ~200-500ms per feature (no subprocess overhead), parallelizable |
| Local features | Not applicable |
| Error handling | Must handle HTTP errors, rate limiting, network failures |
| Maturity | Would be new code; significant surface area |

This is the fastest option but the auth complexity makes it a poor first choice. Every OCI registry has a slightly different token endpoint format, and private registries require reading Docker's `~/.docker/config.json` credential store (which may use OS keychains via `docker-credential-*` helpers). Reimplementing this correctly is nontrivial.

### Option 3: `oras` CLI

Spawn `oras manifest fetch <registry>/<feature>:<tag>` and parse the OCI manifest from stdout.

| Aspect | Assessment |
|--------|-----------|
| New dependencies | **`oras` binary must be installed separately** |
| Auth handling | Inherits Docker credential store |
| Registry compatibility | Good -- designed for OCI |
| Performance | Similar to Option 1 (~500ms-1s) |
| Local features | Not applicable |

Rejected: adds an external dependency for no advantage over the devcontainer CLI, which lace already requires.

### Option 4: Collection Metadata (`devcontainer-collection.json`)

Fetch the collection manifest at `<registry>/<namespace>:latest`, which aggregates all feature metadata for a namespace in one call.

| Aspect | Assessment |
|--------|-----------|
| New dependencies | Depends on fetch mechanism (CLI or HTTP) |
| Auth handling | Same as the fetch mechanism used |
| Batch efficiency | One call per namespace vs. one per feature |
| Version accuracy | **Only reflects latest published versions, not pinned versions** |
| Practical value | Low -- lace queries specific features at specific versions |

Rejected for primary use: version mismatch risk. Could be useful as a supplementary discovery mechanism for tooling that lists available features, but not for `lace up` validation.

### Option 5: Local Path Filesystem Read

For features referenced as relative (`./features/foo`) or absolute paths, read `devcontainer-feature.json` directly from the filesystem.

| Aspect | Assessment |
|--------|-----------|
| New dependencies | None |
| Performance | <1ms (filesystem I/O) |
| Applicability | Only for local development features |

This is required regardless of which remote option is chosen. Detection: if the feature identifier starts with `./`, `../`, or `/`, treat it as a local path.

## Caching Scheme

### Two-tier cache

**Tier 1: In-memory (per `lace up` run)**
- A `Map<string, FeatureMetadata>` populated during feature resolution
- Avoids duplicate subprocess spawns if the same feature is referenced multiple times
- No persistence -- discarded when the process exits

**Tier 2: Filesystem (across runs)**
- Location: `~/.config/lace/cache/features/<escaped-feature-id>.json`
- Cache key: the `canonicalId` from CLI output (includes `@sha256:...` digest)
- For pinned versions (`:1.2.3`): cached indefinitely (OCI content-addressable, immutable)
- For floating tags (`:1`, `:latest`): cached with a TTL of 24h, with a `--no-cache` flag to force refresh
- Format: the parsed `devcontainer-feature.json` object plus a `_cacheMetadata` field with `canonicalId`, `fetchedAt`, and `ttl`

### Cache invalidation

| Version format | Cache behavior |
|---------------|---------------|
| `:1.2.3` (exact) | Permanent -- content is immutable |
| `:1.2` (minor float) | 24h TTL |
| `:1` (major float) | 24h TTL |
| `:latest` | 24h TTL |
| `@sha256:abc...` (digest) | Permanent |
| `./local/path` | Never cached (always read from disk) |

### Offline / disconnected behavior

1. If filesystem cache hit: use cached metadata regardless of network state
2. If cache miss + network available: fetch, cache, continue
3. If cache miss + no network: log a warning, skip metadata validation, continue with `lace up`
4. Feature metadata fetching is **best-effort** -- lace's core workflow (template resolution, config generation, devcontainer up) does not require it. The only degradation is: lace cannot validate that template variable targets match real feature options.

## Recommendations

1. **Use `devcontainer features info manifest --output-format json` as the primary fetching mechanism.** Zero new dependencies, handles auth, proven stable.

2. **Implement local-path detection** as a separate code path: if the feature ID starts with `./`, `../`, or `/`, read `devcontainer-feature.json` from that directory.

3. **Add a two-tier cache** (in-memory + filesystem) with digest-based keys for immutable caching and 24h TTL for floating tags.

4. **Make metadata fetching optional and non-blocking.** If fetching fails, log a warning and proceed. Lace's template resolution and feature promotion do not strictly require metadata -- validation is a nice-to-have, not a gate.

5. **Defer the direct OCI HTTP API** (Option 2) unless profiling shows subprocess overhead is a real bottleneck. With 3-5 features and in-memory caching, it will not be.

6. **New module: `packages/lace/src/lib/feature-metadata.ts`** with exports:
   - `fetchFeatureMetadata(featureId: string): Promise<FeatureMetadata | null>` -- single feature lookup with cache
   - `fetchAllFeatureMetadata(featureIds: string[]): Promise<Map<string, FeatureMetadata>>` -- parallel batch fetch
   - `clearMetadataCache(): void` -- for testing and manual cache bust
