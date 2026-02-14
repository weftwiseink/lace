---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T16:00:00-08:00
revisions:
  - at: 2026-02-13T19:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Consolidated parseFeatureId() to single digest-aware definition (R1 Finding 1)"
      - "Added full acquireTokenFromChallenge() implementation with WWW-Authenticate parsing (R1 Finding 3)"
      - "Reordered token flow: spec-compliant GET /v2/ challenge-response first, GHCR shortcut as optimization (R1 Finding 4)"
      - "Added POSIX extended header (pax) handling to tar parser -- typeflag check at byte 156 (R1 Finding 10)"
      - "Fixed MetadataFetchKind references: keep MetadataFetchError as-is (no kind field), OciRegistryError.kind provides internal granularity (R1 Finding 13)"
      - "Fixed Phase 2 up.ts contradiction: FetchOptions.subprocess made optional-ignored in Phase 2, removed in Phase 3 (R1 Finding 14)"
      - "Added Docker Hub hostname normalization as known limitation (R1 Finding 2, 8)"
      - "Changed probe URL from manifests/latest to GET /v2/ (R1 Finding 5)"
      - "Added scope diagnostic note for post-token 401 (R1 Finding 6)"
      - "Noted credHelpers as known limitation in Docker credential reading (R1 Finding 7)"
      - "Added manifest index media type to Accept header (R1 Finding 9)"
      - "Added tar checksum note (R1 Finding 11)"
      - "Added signal: AbortSignal.timeout(30_000) to all fetch() code drafts (R1 Finding 15)"
      - "Included URL in error messages (R1 Finding 16)"
      - "Specified fetch injection approach for testing: inject fetch as parameter (R1 Finding 18)"
      - "Added timeout test scenario (R1 Finding 19)"
      - "Relaxed Phase 2 oci-client.ts constraint to 'minimize changes' (R1 Finding 20)"
      - "Clarified Phase 3 scope: only remove subprocess pass-through to fetchAllFeatureMetadata (R1 Finding 21)"
task_list: lace/feature-metadata
type: proposal
state: live
status: evolved
superseded_by: cdocs/proposals/2026-02-13-hybrid-oci-metadata-fallback.md
tags: [feature-metadata, oci, http, native-client, tarball-fallback, performance, zero-dependencies]
references:
  - cdocs/proposals/2026-02-13-robust-metadata-fetching.md
  - cdocs/proposals/2026-02-06-lace-feature-metadata-management.md
  - cdocs/reports/2026-02-13-oci-metadata-annotation-missing-incident.md
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-10-devcontainer-metadata-and-lace-registry.md
  - cdocs/reviews/2026-02-13-review-of-native-oci-metadata-client.md
supersedes:
  - cdocs/proposals/2026-02-13-robust-metadata-fetching.md
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-13T17:30:00-08:00
  round: 1
---

# Native OCI Registry Client for Feature Metadata Fetching

> **BLUF:** Replace the subprocess-based `devcontainer features info manifest` approach in `feature-metadata.ts` with a pure Node.js OCI registry client that fetches feature metadata directly via HTTP. The client uses the standard OCI Distribution Spec `GET /v2/` challenge-response token flow, extracts `dev.containers.metadata` from the manifest annotation when present, and falls back to downloading the feature's OCI layer blob (a small tar containing `devcontainer-feature.json`) when the annotation is missing. This solves two problems simultaneously: (1) eliminates the `devcontainer` CLI subprocess dependency for metadata fetching (~1000ms per call), bringing latency down to ~370ms annotation-present / ~650ms with tarball fallback; and (2) makes missing annotations a transparent, automatically-resolved condition rather than an error or a silent null -- lace always gets the metadata, regardless of whether the feature publisher included the annotation. The implementation requires zero new npm dependencies (uses Node's built-in `fetch` + a ~20-line tar header parser), works with any OCI-compliant registry via the standard `WWW-Authenticate` token dance, and preserves the existing filesystem cache, `MetadataFetchError` class, and downstream `up.ts` integration unchanged. See [incident report](../reports/2026-02-13-oci-metadata-annotation-missing-incident.md) for the root cause that motivates the tarball fallback, and the [original metadata management proposal](2026-02-06-lace-feature-metadata-management.md) for the caching and validation architecture this builds on.

## Objective

Replace `fetchFromRegistry()` in `feature-metadata.ts` so that lace always retrieves complete feature metadata from any OCI-compliant registry without shelling out to the `devcontainer` CLI, with automatic fallback to tarball extraction when the `dev.containers.metadata` annotation is absent.

## Background

### The subprocess approach and its limitations

The [original metadata management proposal](2026-02-06-lace-feature-metadata-management.md) chose `devcontainer features info manifest` as the fetching mechanism because it handled registry auth automatically and added zero dependencies. The [manifest fetching options report](../reports/2026-02-06-feature-manifest-fetching-options.md) explicitly deferred the direct OCI HTTP API (Option 2) unless profiling showed subprocess overhead was a bottleneck.

Three things have changed since that decision:

1. **The subprocess is a bottleneck.** Measured on the development machine: `devcontainer features info manifest` takes ~1000ms per feature. A direct HTTP manifest fetch takes ~370ms. With 4-6 features, this is the difference between 1s and 4s wall time (sequential subprocess vs parallel HTTP).

2. **The annotation is missing on real features.** The [incident report](../reports/2026-02-13-oci-metadata-annotation-missing-incident.md) documented that `ghcr.io/eitsupi/devcontainer-features/nushell:0` lacks the `dev.containers.metadata` annotation entirely. The [robust metadata fetching proposal](2026-02-13-robust-metadata-fetching.md) addressed this by making missing annotations silently non-fatal (return null). But returning null means lace loses metadata-driven capabilities (auto-injection, option validation, port enrichment) for those features. The devcontainer CLI itself handles this by downloading the tarball and extracting `devcontainer-feature.json` from it. Lace should do the same.

3. **Auth is simpler than feared.** All public GHCR packages work with anonymous token auth (a single GET to the token endpoint). The OCI Distribution Spec defines a standard `WWW-Authenticate` challenge-response flow that works across registries. For private packages, Docker credentials from `~/.docker/config.json` provide the auth. This is ~50 lines of code, not the "significant complexity" originally estimated.

### The OCI Distribution Spec flow

The OCI Distribution Specification defines a standard HTTP API for interacting with container registries. The relevant operations for metadata fetching are:

1. **Token acquisition via challenge-response**: `GET https://{registry}/v2/` returns `401` with a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."` header. The client parses this header, then requests a token from the specified realm with the given service and scope parameters. For known registries (e.g., GHCR), the token endpoint can be called directly as an optimization, skipping the initial probe.

2. **Manifest fetch**: `GET https://{registry}/v2/{repo}/manifests/{tag}` with `Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json` and `Authorization: Bearer {token}`. Returns the OCI image manifest including annotations, or a manifest index for multi-arch images.

3. **Blob fetch**: `GET https://{registry}/v2/{repo}/blobs/{digest}` with `Authorization: Bearer {token}`. Returns the layer content. For devcontainer features, this is a plain (uncompressed) tar archive, typically ~10KB, containing `devcontainer-feature.json` and an `install.sh`.

### The tarball structure

Every devcontainer feature published to an OCI registry contains a single layer blob. This blob is a tar archive (media type `application/vnd.devcontainers.layer.v1+tar`) containing at minimum:
- `devcontainer-feature.json` -- the feature metadata (ground truth)
- `install.sh` -- the installation script

The tar format uses 512-byte headers. A minimal parser that reads the file name (bytes 0-100), typeflag (byte 156), and file size (bytes 124-136, octal) can extract `devcontainer-feature.json` in ~20 lines with zero dependencies. The parser must skip POSIX extended header entries (typeflag `x` or `g`) to avoid misidentifying pax metadata blocks as file entries.

### Feature ID anatomy

A devcontainer feature ID like `ghcr.io/eitsupi/devcontainer-features/nushell:0` decomposes into:
- **Registry**: `ghcr.io`
- **Repository**: `eitsupi/devcontainer-features/nushell`
- **Tag**: `0`

Feature IDs may also use `@sha256:` digest references for immutable pinning (e.g., `ghcr.io/org/features/foo@sha256:abcdef...`), where the digest serves as the manifest reference instead of a tag.

For the OCI API, the namespace is the repository path. The feature spec uses the convention `{registry}/{namespace}/{feature}:{tag}`, but the OCI API sees it as `{registry}/v2/{namespace}/{feature}/manifests/{tag}`.

> NOTE: Feature IDs without a registry prefix (e.g., `devcontainer-features/nushell:0`) are not currently used in lace configs. All features in lace workspaces use fully-qualified registry paths. If support for unqualified IDs is needed later, a default registry resolution step can be added.

> NOTE: Docker Hub uses the alias `docker.io` in feature IDs, but the actual API endpoint is `registry-1.docker.io` and credentials in `~/.docker/config.json` are stored under `https://index.docker.io/v1/`. Docker Hub hostname normalization is a known limitation of this proposal. All current lace features are on GHCR, so this does not block initial implementation. If Docker Hub features are needed, a normalization step in `parseFeatureId()` can translate `docker.io` to the correct API and credential hostnames.

## Proposed Solution

### Architecture overview

Replace `fetchFromRegistry()` in `feature-metadata.ts` with a new internal module `oci-client.ts` that provides:

```typescript
// packages/lace/src/lib/oci-client.ts

export interface OciFeatureMetadata {
  metadata: FeatureMetadata;
  source: "annotation" | "tarball";
}

/**
 * Fetch feature metadata from an OCI registry.
 *
 * Flow:
 * 1. Parse feature ID into registry, repo, tag
 * 2. Acquire auth token via OCI Distribution Spec challenge-response
 * 3. Fetch OCI manifest
 * 4. Check for dev.containers.metadata annotation
 * 5. If present: parse and return
 * 6. If absent: download the layer blob, extract devcontainer-feature.json from tar
 * 7. Parse and return
 *
 * Throws OciRegistryError on network/auth/parse failures.
 *
 * @param fetchFn - Injected fetch implementation (defaults to global fetch).
 *   Accepts a fetch function parameter for testability: tests pass a mock
 *   fetch that intercepts by URL pattern, avoiding fragile global.fetch spying.
 */
export async function fetchOciFeatureMetadata(
  featureId: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<OciFeatureMetadata>;
```

The existing `fetchFromRegistry()` in `feature-metadata.ts` is replaced with a call to `fetchOciFeatureMetadata()`. All other code in `feature-metadata.ts` (caching, validation, error handling, local-path support) remains unchanged.

### Feature ID parsing

```typescript
export interface ParsedFeatureId {
  registry: string;     // "ghcr.io"
  repo: string;         // "eitsupi/devcontainer-features/nushell"
  tag: string;          // "0" or "sha256:abcdef..." for digest references
}

export function parseFeatureId(featureId: string): ParsedFeatureId {
  const firstSlash = featureId.indexOf("/");
  if (firstSlash === -1) {
    throw new Error(`Invalid feature ID: "${featureId}" (no registry prefix)`);
  }

  const registry = featureId.slice(0, firstSlash);
  const rest = featureId.slice(firstSlash + 1);

  // Handle @sha256: digest references (e.g., "org/feat@sha256:abcdef...")
  const digestIndex = rest.indexOf("@sha256:");
  if (digestIndex !== -1) {
    const repo = rest.slice(0, digestIndex);
    const tag = rest.slice(digestIndex + 1); // "sha256:abcdef..."
    return { registry, repo, tag };
  }

  // Handle tag-based references (e.g., "org/feat:1.2.3")
  // Split on last ':' to handle tags that don't contain colons
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) {
    // No tag specified, default to "latest"
    return { registry, repo: rest, tag: "latest" };
  }

  return {
    registry,
    repo: rest.slice(0, lastColon),
    tag: rest.slice(lastColon + 1),
  };
}
```

### Token acquisition

The auth flow follows the OCI Distribution Spec challenge-response pattern. The spec-compliant flow probes `GET /v2/` to receive a `WWW-Authenticate` challenge, then requests a token from the discovered realm. For GHCR specifically, a direct token endpoint call is used as an optimization to save a round-trip.

```typescript
interface TokenResponse {
  token: string;
}

/**
 * Parse a WWW-Authenticate header value into its component parameters.
 *
 * Handles the format: Bearer realm="...",service="...",scope="..."
 * Values may be quoted strings (which can contain commas and escaped quotes).
 *
 * Returns a map of parameter name -> value, or null if the header is not
 * a Bearer challenge.
 */
function parseWwwAuthenticate(
  header: string,
): Record<string, string> | null {
  if (!header.toLowerCase().startsWith("bearer ")) return null;

  const params: Record<string, string> = {};
  const rest = header.slice("bearer ".length);

  // Parse key="value" pairs, handling quoted strings correctly
  const re = /(\w+)="([^"]*)"(?:,\s*|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest)) !== null) {
    params[match[1]] = match[2];
  }

  return params;
}

/**
 * Acquire a token by following a WWW-Authenticate challenge.
 *
 * Constructs the token URL from the challenge's realm, service, and scope
 * parameters, then makes the token request with optional Docker credentials.
 */
async function acquireTokenFromChallenge(
  wwwAuth: string,
  repo: string,
  dockerAuth: string | null,
  fetchFn: typeof fetch,
): Promise<string> {
  const params = parseWwwAuthenticate(wwwAuth);
  if (!params?.realm) {
    throw new OciRegistryError(
      `WWW-Authenticate header missing realm: "${wwwAuth}"`,
      "auth_failed",
    );
  }

  const tokenUrl = new URL(params.realm);
  if (params.service) {
    tokenUrl.searchParams.set("service", params.service);
  }
  // Use the scope from the challenge if present, otherwise construct one
  tokenUrl.searchParams.set(
    "scope",
    params.scope ?? `repository:${repo}:pull`,
  );

  const headers: Record<string, string> = {};
  if (dockerAuth) {
    headers["Authorization"] = `Basic ${dockerAuth}`;
  }

  const resp = await fetchFn(tokenUrl.toString(), {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new OciRegistryError(
      `Token request failed: HTTP ${resp.status} ${resp.statusText} at ${tokenUrl.toString()}`,
      "auth_failed",
    );
  }

  const body = (await resp.json()) as TokenResponse;
  return body.token;
}

/**
 * Acquire an auth token for the given registry and repository.
 *
 * Strategy (OCI Distribution Spec compliant):
 * 1. For known registries (ghcr.io): try direct token endpoint as optimization
 * 2. For all registries: probe GET /v2/ to trigger WWW-Authenticate challenge
 * 3. Parse the challenge header to discover the token endpoint
 * 4. Request a token from the discovered endpoint
 * 5. If Docker credentials exist for this registry, include them as Basic auth
 */
async function acquireToken(
  registry: string,
  repo: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const dockerAuth = readDockerAuth(registry);
  const headers: Record<string, string> = {};
  if (dockerAuth) {
    headers["Authorization"] = `Basic ${dockerAuth}`;
  }

  // Optimization: for GHCR, try the well-known token endpoint directly
  // to avoid the extra round-trip of the challenge-response flow.
  if (registry === "ghcr.io") {
    const tokenUrl = `https://ghcr.io/token?scope=repository:${repo}:pull`;
    const resp = await fetchFn(tokenUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) {
      const body = (await resp.json()) as TokenResponse;
      return body.token;
    }
    // If the GHCR shortcut fails, fall through to the generic flow
  }

  // Spec-compliant flow: probe GET /v2/ to receive WWW-Authenticate challenge
  const probeUrl = `https://${registry}/v2/`;
  const probeResp = await fetchFn(probeUrl, {
    signal: AbortSignal.timeout(30_000),
  });

  if (probeResp.status === 401) {
    const wwwAuth = probeResp.headers.get("www-authenticate");
    if (wwwAuth) {
      return acquireTokenFromChallenge(wwwAuth, repo, dockerAuth, fetchFn);
    }
  }

  // If /v2/ returned 200 with no auth required (rare but valid for
  // open registries), proceed without a token
  if (probeResp.ok) {
    return ""; // No auth needed
  }

  throw new OciRegistryError(
    `Failed to acquire auth token for ${registry}/${repo}: ` +
      `GET ${probeUrl} returned ${probeResp.status}`,
    "auth_failed",
  );
}
```

> NOTE: A post-token 401 on a manifest or blob fetch may indicate an incorrect `scope` in the token request (e.g., the token was acquired for `repository:org/feat:pull` but the registry expects a different scope format). The error message surfaces the HTTP status and URL to aid debugging, but the client does not retry with a different scope. If this becomes a problem with specific registries, scope negotiation can be added.

### Docker credential reading

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Read Docker auth credentials for a registry from ~/.docker/config.json.
 * Returns the base64-encoded "user:token" string, or null if not found.
 *
 * Does NOT invoke docker-credential-* helpers. This handles the common case
 * where credentials are stored directly in config.json (the default for
 * `docker login` and `gh auth login --with-token`). For systems using
 * OS keychains, the user must ensure credentials are in config.json or
 * use the anonymous path (which works for all public packages).
 */
function readDockerAuth(registry: string): string | null {
  const configPath = join(homedir(), ".docker", "config.json");
  if (!existsSync(configPath)) return null;

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      auths?: Record<string, { auth?: string }>;
      credHelpers?: Record<string, string>;
    };

    // Check if a credential helper is configured but no direct auth exists.
    // Log a diagnostic hint so users understand why auth may fail.
    if (config.credHelpers?.[registry] && !config.auths?.[registry]?.auth) {
      console.debug(
        `[lace] Docker credential helper "${config.credHelpers[registry]}" ` +
          `is configured for ${registry}, but lace reads only direct auths ` +
          `from config.json. Private registry auth may fail.`,
      );
    }

    return config.auths?.[registry]?.auth ?? null;
  } catch {
    return null;
  }
}
```

> NOTE: This intentionally does not support `docker-credential-*` helpers (e.g., `docker-credential-desktop`, `docker-credential-pass`). These require spawning a subprocess to query an OS keychain, which reintroduces the subprocess dependency we are eliminating. For the vast majority of CI and development setups, credentials are either in `config.json` directly (Docker Hub, GHCR via `gh auth`) or not needed (public packages). If a user has private features behind an OS keychain, `--skip-metadata-validation` remains available as an escape hatch. Supporting credential helpers is a future enhancement if demand materializes.

> NOTE: `credHelpers` in `~/.docker/config.json` is a known limitation. When `credHelpers` is configured for a registry but `auths` has no direct entry, `readDockerAuth()` returns null and logs a debug hint. The user must either add credentials directly to `config.json`, use the anonymous path (public packages), or fall back to `--skip-metadata-validation`.

### Manifest fetching

```typescript
interface OciManifest {
  schemaVersion: number;
  mediaType?: string;
  config: { digest: string; mediaType: string };
  layers: Array<{ digest: string; mediaType: string; size: number }>;
  annotations?: Record<string, string>;
}

async function fetchManifest(
  registry: string,
  repo: string,
  tag: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<OciManifest> {
  const url = `https://${registry}/v2/${repo}/manifests/${tag}`;
  const resp = await fetchFn(url, {
    headers: {
      Accept: [
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.oci.image.index.v1+json",
      ].join(", "),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new OciRegistryError(
      `Manifest fetch failed: HTTP ${resp.status} ${resp.statusText} at ${url}`,
      resp.status === 401 || resp.status === 403 ? "auth_failed" : "fetch_failed",
    );
  }

  return (await resp.json()) as OciManifest;
}
```

### Blob fetching (for tarball fallback)

```typescript
async function fetchBlob(
  registry: string,
  repo: string,
  digest: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<Buffer> {
  const url = `https://${registry}/v2/${repo}/blobs/${digest}`;
  const resp = await fetchFn(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // Follow redirects (GHCR redirects blob requests to a storage backend)
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new OciRegistryError(
      `Blob fetch failed: HTTP ${resp.status} ${resp.statusText} at ${url}`,
      "fetch_failed",
    );
  }

  return Buffer.from(await resp.arrayBuffer());
}
```

### Tar extraction

The feature tarball is a plain (uncompressed) tar archive. The tar format is simple: 512-byte headers followed by file data padded to 512-byte boundaries. The parser must handle POSIX extended headers (pax format), which use typeflag `x` (per-file) or `g` (global) at byte 156 of the header. These entries contain metadata in a separate data block and must be skipped to reach the actual file entries.

```typescript
/**
 * Extract a file from a tar archive buffer.
 *
 * Tar format:
 * - Each file has a 512-byte header
 * - Bytes 0-100: filename (null-terminated ASCII)
 * - Bytes 124-136: file size in octal (null-terminated ASCII)
 * - Byte 156: typeflag (0/'0' = regular file, 'x' = pax extended header,
 *   'g' = pax global header)
 * - File data follows the header, padded to 512-byte boundary
 *
 * Checksum validation (bytes 148-156) is intentionally skipped. The tarballs
 * are fetched over HTTPS, which provides transport-level integrity. For the
 * small, well-formed archives produced by devcontainer CLI publish, the
 * cost of checksum validation outweighs the benefit.
 *
 * Returns the file content as a string, or null if not found.
 */
export function extractFromTar(buf: Buffer, targetFile: string): string | null {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const name = buf
      .toString("ascii", offset, offset + 100)
      .replace(/\0/g, "")
      .trim();
    if (!name) break; // Empty header = end of archive

    const sizeStr = buf
      .toString("ascii", offset + 124, offset + 136)
      .replace(/\0/g, "")
      .trim();
    const size = parseInt(sizeStr, 8);

    if (isNaN(size)) break; // Invalid size = corrupted archive

    // Check typeflag at byte 156 for POSIX extended headers (pax format).
    // Typeflag 'x' (0x78) = per-file extended header
    // Typeflag 'g' (0x67) = global extended header
    // These entries contain metadata, not actual files. Skip them.
    const typeflag = buf[offset + 156];
    if (typeflag === 0x78 || typeflag === 0x67) {
      // Skip past the pax header data block
      const dataBlocks = Math.ceil(size / 512);
      offset += 512 + dataBlocks * 512;
      continue;
    }

    if (name === targetFile || name === "./" + targetFile) {
      return buf.toString("utf-8", offset + 512, offset + 512 + size);
    }

    // Advance past header + data (padded to 512-byte boundary)
    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
  }
  return null;
}
```

### Top-level fetch orchestration

```typescript
export class OciRegistryError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth_failed" | "fetch_failed" | "parse_failed",
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "OciRegistryError";
  }
}

export async function fetchOciFeatureMetadata(
  featureId: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<OciFeatureMetadata> {
  const { registry, repo, tag } = parseFeatureId(featureId);

  // Step 1: Auth
  const token = await acquireToken(registry, repo, fetchFn);

  // Step 2: Manifest
  const manifest = await fetchManifest(registry, repo, tag, token, fetchFn);

  // Step 3: Try annotation first (fast path)
  const annotationStr = manifest.annotations?.["dev.containers.metadata"];
  if (annotationStr) {
    try {
      const metadata = JSON.parse(annotationStr) as FeatureMetadata;
      return { metadata, source: "annotation" };
    } catch (e) {
      throw new OciRegistryError(
        `dev.containers.metadata annotation is not valid JSON for "${featureId}": ${(e as Error).message}`,
        "parse_failed",
        e as Error,
      );
    }
  }

  // Step 4: Fallback to tarball extraction
  // Find the feature layer (media type: application/vnd.devcontainers.layer.v1+tar)
  const featureLayer = manifest.layers.find(
    (l) =>
      l.mediaType === "application/vnd.devcontainers.layer.v1+tar" ||
      l.mediaType === "application/vnd.oci.image.layer.v1.tar",
  );

  if (!featureLayer) {
    throw new OciRegistryError(
      `No feature layer found in manifest for "${featureId}". ` +
        `Expected media type application/vnd.devcontainers.layer.v1+tar.`,
      "parse_failed",
    );
  }

  const blobBuf = await fetchBlob(registry, repo, featureLayer.digest, token, fetchFn);
  const decompressed = maybeDecompress(blobBuf);
  const jsonStr = extractFromTar(decompressed, "devcontainer-feature.json");

  if (!jsonStr) {
    throw new OciRegistryError(
      `devcontainer-feature.json not found in feature tarball for "${featureId}"`,
      "parse_failed",
    );
  }

  try {
    const metadata = JSON.parse(jsonStr) as FeatureMetadata;
    return { metadata, source: "tarball" };
  } catch (e) {
    throw new OciRegistryError(
      `devcontainer-feature.json in tarball is not valid JSON for "${featureId}": ${(e as Error).message}`,
      "parse_failed",
      e as Error,
    );
  }
}
```

### Integration with `feature-metadata.ts`

The existing `fetchFromRegistry()` function is replaced. The `MetadataFetchError` class is preserved exactly as-is -- it has no `kind` field in the current codebase, and this proposal does not add one. The `OciRegistryError` from `oci-client.ts` is caught and translated to `MetadataFetchError` at the boundary:

> NOTE: The superseded [robust metadata fetching proposal](2026-02-13-robust-metadata-fetching.md) proposed adding a `MetadataFetchKind` union and a `kind` field to `MetadataFetchError`. That proposal was never implemented, so `MetadataFetchKind` does not exist in the codebase. Since the OCI client's tarball fallback eliminates `annotation_missing` as a caller-visible condition, there is no need to introduce `MetadataFetchKind`. The existing `MetadataFetchError(featureId, reason, cause?)` signature is sufficient. `OciRegistryError.kind` provides internal granularity within `oci-client.ts` for debugging, but this detail does not leak into the `feature-metadata.ts` error interface.

```typescript
// In feature-metadata.ts, replace fetchFromRegistry():

import { fetchOciFeatureMetadata, OciRegistryError } from "./oci-client";

async function fetchFromRegistry(featureId: string): Promise<FeatureMetadata> {
  try {
    const result = await fetchOciFeatureMetadata(featureId);
    return result.metadata;
  } catch (e) {
    if (e instanceof OciRegistryError) {
      throw new MetadataFetchError(
        featureId,
        e.message,
        e.cause,
      );
    }
    throw e;
  }
}
```

Key change: `fetchFromRegistry()` becomes `async` (it was previously synchronous because `execFileSync` is blocking). The call site in `fetchFeatureMetadata()` already uses `await` on the result of the ternary:

```typescript
// Updated call site in fetchFeatureMetadata():
const metadata = await (isLocalPath(featureId)
  ? Promise.resolve(fetchFromLocalPath(featureId))
  : fetchFromRegistry(featureId));
```

### What disappears: `annotation_missing` as a concept

With the tarball fallback, missing annotations are handled transparently inside `oci-client.ts`. The caller never sees a null result for annotation absence -- it always gets `FeatureMetadata`. The existing `fetchFeatureMetadata()` catch block (which checks `e instanceof MetadataFetchError` and either re-throws or returns null based on `skipValidation`) continues to work unchanged. No new error kinds are introduced; no existing error kinds are removed.

### Parallel fetches with connection reuse

All `fetch()` calls to the same registry reuse TCP connections via Node's built-in HTTP agent. `fetchAllFeatureMetadata()` already uses `Promise.all()` for parallelism. With the subprocess approach, each parallel call spawns a new process with its own TCP connection. With native HTTP, all calls share the same connection pool.

For a workspace with 4 features on GHCR:
- **Subprocess (current)**: 4 parallel processes, 4 TCP connections, 4 TLS handshakes, ~1000ms each = ~1000ms wall time
- **Native HTTP**: 4 parallel fetches, 1-2 TCP connections (HTTP/2 multiplexing or keepalive), 1-2 TLS handshakes, ~370ms each = ~400ms wall time

### The `subprocess.ts` dependency is removed from the metadata path

After this change, `feature-metadata.ts` no longer imports `RunSubprocess` or `runSubprocess`. The `FetchOptions.subprocess` field is deprecated in Phase 2 (made optional and ignored) and removed in Phase 3. Tests mock at the HTTP transport level by injecting a mock `fetchFn` parameter instead.

> NOTE: The `subprocess.ts` module is still used by other parts of lace (`prebuild.ts`, `resolve-mounts.ts`, the `devcontainer up` invocation in `up.ts`). Only the metadata-fetching path drops the subprocess dependency.

## Important Design Decisions

### Decision: Tarball fallback instead of returning null for missing annotations

**Why:** The [robust metadata fetching proposal](2026-02-13-robust-metadata-fetching.md) treats missing annotations as silently non-fatal, returning null. This is correct in spirit (the annotation is spec-optional) but incomplete in practice: returning null means lace loses auto-injection, option validation, and port enrichment for those features. The devcontainer CLI itself handles missing annotations by downloading the tarball -- it never returns null. The tarball always contains `devcontainer-feature.json` because the feature spec requires it. Since the tarball download adds only ~280ms (blob fetch for a ~10KB file), the cost is negligible compared to the benefit of always having metadata.

**Alternative rejected -- return null for missing annotations:** This was the approach in the robust metadata fetching proposal. It works but leaves metadata gaps. The nushell feature (`ghcr.io/eitsupi/devcontainer-features/nushell:0`) has options (e.g., `version`) that lace cannot validate without metadata. More importantly, any future feature with `customizations.lace.ports` that publishes with older tooling (pre-annotation) would silently lose port enrichment.

### Decision: Dedicated `oci-client.ts` module instead of inlining in `feature-metadata.ts`

**Why:** The OCI client has its own concerns (token management, HTTP transport, tar parsing) that are orthogonal to the metadata caching, validation, and error classification in `feature-metadata.ts`. Separating them keeps each module focused and testable. `oci-client.ts` can be tested with HTTP mocking (injecting a mock `fetchFn`), while `feature-metadata.ts` tests can mock `fetchOciFeatureMetadata()` as a single function, matching the current pattern of mocking `subprocess`.

### Decision: Do not implement `docker-credential-*` helpers

**Why:** Credential helpers require spawning subprocesses to query OS keychains (`docker-credential-desktop`, `docker-credential-pass`, etc.). This reintroduces the subprocess dependency for private registries. For the current use case (all features on public GHCR), anonymous auth works. For private features, Docker credentials in `~/.docker/config.json` (the default storage for `docker login`, `gh auth login`) are supported. If a user's system uses an OS keychain exclusively, `--skip-metadata-validation` is the escape hatch. Supporting credential helpers is a bounded future enhancement.

**Alternative rejected -- shell out to `docker login` or `docker credential-helpers`:** This would handle all Docker auth scenarios but defeats the purpose of eliminating subprocesses.

### Decision: Zero npm dependencies for tar parsing

**Why:** The feature tarball is a plain (uncompressed) tar archive with a simple structure. A ~20-line parser that reads the fixed-position filename, typeflag, and size fields is sufficient. Adding `tar`, `tar-stream`, or similar packages for this would be dependency overhead for no capability gain. The tar format's header layout has been stable since 1979.

**Alternative rejected -- use `tar-stream` npm package:** Adds a runtime dependency for ~20 lines of code. The feature tarballs are small (~10KB) and well-formed (produced by the devcontainer CLI's publish command). There is no need for streaming, compression handling, or edge-case tolerance.

### Decision: `OciRegistryError` is a separate error class from `MetadataFetchError`

**Why:** `OciRegistryError` represents a transport-level failure (network, auth, blob not found). `MetadataFetchError` represents a metadata-level failure (missing metadata, invalid JSON, validation error). The `fetchFromRegistry()` bridge translates between them. This keeps the OCI client reusable -- if lace ever needs to interact with OCI registries for other purposes (e.g., checking feature versions), `oci-client.ts` can be used without coupling to the metadata error taxonomy.

### Decision: Inject `fetch` as parameter for testability

**Why:** The `fetchOciFeatureMetadata()` function accepts an optional `fetchFn` parameter (defaulting to `globalThis.fetch`). This allows tests to inject a mock fetch that intercepts by URL pattern, without fragile `vi.spyOn(global, 'fetch')` patching that affects all fetch calls in the test process. Internal functions (`acquireToken`, `fetchManifest`, `fetchBlob`, `acquireTokenFromChallenge`) pass through the same `fetchFn`, so the entire HTTP layer is mockable from a single injection point. The API surface change is minimal -- production callers omit the parameter and get the real `fetch`.

### Decision: Spec-compliant token flow with GHCR optimization

**Why:** The OCI Distribution Spec defines a standard flow: `GET /v2/` to trigger a `401` with `WWW-Authenticate`, then request a token from the realm specified in the challenge. This works with any compliant registry. For GHCR specifically, the token endpoint (`https://ghcr.io/token?scope=...`) is well-known and stable, so the client calls it directly as a single-round-trip optimization, falling back to the standard challenge-response flow if the shortcut fails. This ordering avoids the extra round-trip for the most common case (GHCR) while maintaining compatibility with Docker Hub, ACR, and other registries via the spec-compliant path.

### Decision: Preserve the existing filesystem cache unchanged

**Why:** The filesystem cache stores parsed `FeatureMetadata` objects, not raw manifests or tarballs. Since the native OCI client produces the same `FeatureMetadata` output as the subprocess approach, the cache format is unchanged. Existing cache entries remain valid. The only difference is the source: `FeatureMetadata` now comes from `fetchOciFeatureMetadata()` instead of subprocess + JSON parsing.

### Decision: Keep `MetadataFetchError` unchanged (no `kind` field)

**Why:** The superseded [robust metadata fetching proposal](2026-02-13-robust-metadata-fetching.md) proposed a `MetadataFetchKind` type and a `kind` field on `MetadataFetchError`. That proposal was never implemented -- the current `MetadataFetchError` takes `(featureId, reason, cause?)` with no `kind`. Since the OCI client's tarball fallback eliminates `annotation_missing` as a caller-visible condition, and the remaining failure modes (network, auth, parse) are all treated identically by the caller (re-throw or skip based on `skipValidation`), there is no need to add error classification at the `MetadataFetchError` level. `OciRegistryError.kind` provides sufficient internal granularity for debugging within `oci-client.ts`.

## Edge Cases / Challenging Scenarios

### Feature tarball is gzip-compressed

Some older OCI implementations or non-standard publishers may produce gzip-compressed layers (media type `application/vnd.oci.image.layer.v1.tar+gzip`). The current implementation handles only plain tar. If a gzip layer is encountered, detect it via the first two bytes (`0x1f 0x8b` = gzip magic number) and decompress with Node's built-in `zlib.gunzipSync()` before tar extraction. This should be handled from the start since it is a low-cost safeguard:

```typescript
import { gunzipSync } from "node:zlib";

function maybeDecompress(buf: Buffer): Buffer {
  // Gzip magic number: 0x1f 0x8b
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf);
  }
  return buf;
}
```

### Registry rate limiting

GHCR has generous anonymous rate limits (5000 requests/hour for authenticated, lower for anonymous). A typical `lace up` makes 4-10 requests total (1 token + 1 manifest per feature, plus occasional blob fetches). This is well within limits. If a 429 response is received, the error is surfaced as a `MetadataFetchError` with a clear message including the `Retry-After` header value if present.

### Token expiry during a batch fetch

Tokens from GHCR are valid for 300 seconds (5 minutes). A `lace up` batch fetch completes in <2 seconds. Token expiry mid-batch is not a realistic concern, but if a 401 is received on a manifest or blob fetch after a token was successfully acquired, the error is surfaced as `auth_failed` rather than retried. Token caching across `lace up` runs is not implemented -- tokens are acquired fresh each run.

### Multi-arch manifest (manifest index/list)

Some OCI registries return an OCI Image Index (manifest list) instead of a direct manifest. The `Accept` header includes both `application/vnd.oci.image.manifest.v1+json` and `application/vnd.oci.image.index.v1+json` so the client can handle either response. Devcontainer features are single-arch (they are shell scripts, not binaries), so they should always return a direct manifest. If an index is received, extract the first manifest reference and fetch it. This is a defensive measure:

```typescript
interface OciManifestIndex {
  schemaVersion: number;
  mediaType: string;
  manifests: Array<{ digest: string; mediaType: string; platform?: unknown }>;
}

// In fetchManifest(), after parsing the response:
if (parsed.mediaType === "application/vnd.oci.image.index.v1+json") {
  const index = parsed as unknown as OciManifestIndex;
  if (index.manifests.length === 0) {
    throw new OciRegistryError(
      `Empty manifest index for ${registry}/${repo}:${tag}`,
      "parse_failed",
    );
  }
  // Fetch the first (and likely only) manifest
  return fetchManifest(registry, repo, index.manifests[0].digest, token, fetchFn);
}
```

### Private registry with non-standard token endpoint

Some enterprise registries (Azure ACR, AWS ECR) have token endpoints that don't follow the GHCR pattern. The `WWW-Authenticate` challenge-response flow handles this generically. AWS ECR is a special case: it uses `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for auth, not Docker credentials. If the `WWW-Authenticate` challenge points to an AWS endpoint, the current implementation will fail. This is acceptable for now -- all lace features are on GHCR. ECR support can be added later by detecting the `ecr` hostname pattern and using the AWS SDK.

### `devcontainer-feature.json` not found in tarball

This indicates a corrupted or non-standard feature package. The error is surfaced as a `MetadataFetchError` with a message indicating the tarball does not contain the expected file. This is a genuine feature publishing error and should be treated as fatal.

### Docker Hub hostname normalization

Docker Hub feature IDs use `docker.io` as the registry hostname, but the OCI API endpoint is `registry-1.docker.io` and Docker's `~/.docker/config.json` stores credentials under `https://index.docker.io/v1/`. The current implementation does not perform this hostname translation. This is a known limitation -- all current lace features are on GHCR. If Docker Hub support is needed, a normalization step should be added to `parseFeatureId()` and `readDockerAuth()`:
- `docker.io` -> `registry-1.docker.io` for API calls
- `docker.io` -> `https://index.docker.io/v1/` for credential lookup

### Concurrent fetches for same feature from different registries

Not a concern -- the in-memory cache in `feature-metadata.ts` uses the full feature ID (including registry) as the key. Different registries are different features.

### Network timeout

Node's `fetch()` does not have a default timeout. All fetch calls include `signal: AbortSignal.timeout(30_000)` (30 seconds). This prevents a single stalled connection from blocking the entire `lace up` pipeline indefinitely.

## Test Plan

### Unit: `oci-client.test.ts` -- Feature ID parsing

**Scenario P1: Standard GHCR feature ID**

Input: `"ghcr.io/eitsupi/devcontainer-features/nushell:0"`

Expected: `{ registry: "ghcr.io", repo: "eitsupi/devcontainer-features/nushell", tag: "0" }`

**Scenario P2: Feature ID with exact semver tag**

Input: `"ghcr.io/org/features/foo:1.2.3"`

Expected: `{ registry: "ghcr.io", repo: "org/features/foo", tag: "1.2.3" }`

**Scenario P3: Feature ID with no tag (defaults to latest)**

Input: `"ghcr.io/org/features/foo"`

Expected: `{ registry: "ghcr.io", repo: "org/features/foo", tag: "latest" }`

**Scenario P4: Feature ID with sha256 digest**

Input: `"ghcr.io/org/features/foo@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"`

Expected: `{ registry: "ghcr.io", repo: "org/features/foo", tag: "sha256:abcdef..." }`

**Scenario P5: Invalid feature ID (no registry)**

Input: `"just-a-name"`

Expected: Throws error containing "no registry prefix".

### Unit: `oci-client.test.ts` -- Tar extraction

**Scenario T1: Extract devcontainer-feature.json from valid tar**

Setup: Construct a tar buffer with a `devcontainer-feature.json` entry containing `{"id":"test","version":"1.0.0"}`.

Expected: `extractFromTar(buf, "devcontainer-feature.json")` returns `'{"id":"test","version":"1.0.0"}'`.

**Scenario T2: Extract from tar with ./ prefix**

Setup: Construct a tar buffer where the filename is `./devcontainer-feature.json`.

Expected: `extractFromTar(buf, "devcontainer-feature.json")` returns the content (matches with or without `./` prefix).

**Scenario T3: File not found in tar**

Setup: Construct a tar buffer with only `install.sh`.

Expected: `extractFromTar(buf, "devcontainer-feature.json")` returns `null`.

**Scenario T4: Empty tar (all-zero headers)**

Setup: A 1024-byte buffer of zeros (two empty 512-byte headers = end of archive).

Expected: `extractFromTar(buf, "devcontainer-feature.json")` returns `null`.

**Scenario T5: Gzip-compressed tar decompression**

Setup: gzip a tar buffer containing `devcontainer-feature.json`.

Expected: `maybeDecompress()` detects gzip magic bytes and decompresses; `extractFromTar()` on the result returns the content.

**Scenario T6: Tar with POSIX extended headers (pax format)**

Setup: Construct a tar buffer with a pax extended header entry (typeflag `x` at byte 156) preceding the `devcontainer-feature.json` entry.

Expected: `extractFromTar(buf, "devcontainer-feature.json")` skips the pax header entry and returns the correct file content.

### Unit: `oci-client.test.ts` -- Token acquisition (mocked fetch)

**Scenario A1: Anonymous token acquisition for public GHCR (shortcut path)**

Mock: `fetchFn("https://ghcr.io/token?scope=...")` returns `{ token: "test-token" }`.

Expected: `acquireToken("ghcr.io", "org/feat", fetchFn)` returns `"test-token"`. Only one fetch call made (no `/v2/` probe).

**Scenario A2: Token acquisition with Docker credentials**

Setup: Write a mock `~/.docker/config.json` with `auths.ghcr.io.auth = base64("user:pass")`.

Mock: `fetchFn("https://ghcr.io/token?scope=...", { headers: { Authorization: "Basic ..." } })` returns token.

Expected: Credentials are included in the token request.

**Scenario A3: WWW-Authenticate challenge-response for non-GHCR registry**

Mock: `fetchFn("https://registry.example.com/v2/")` returns 401 with `WWW-Authenticate: Bearer realm="https://auth.example.com/token",service="registry.example.com",scope="repository:org/feat:pull"`. `fetchFn("https://auth.example.com/token?service=...&scope=...")` returns `{ token: "alt-token" }`.

Expected: `acquireToken("registry.example.com", "org/feat", fetchFn)` returns `"alt-token"`.

**Scenario A4: Auth failure (no valid token source)**

Mock: All token endpoints return 401/403.

Expected: Throws `OciRegistryError` with `kind: "auth_failed"`.

**Scenario A5: GHCR shortcut fails, falls through to challenge-response**

Mock: `fetchFn("https://ghcr.io/token?scope=...")` returns 500. `fetchFn("https://ghcr.io/v2/")` returns 401 with valid `WWW-Authenticate`. Challenge token request succeeds.

Expected: `acquireToken("ghcr.io", "org/feat", fetchFn)` returns the token from the challenge-response fallback.

### Unit: `oci-client.test.ts` -- Full metadata fetch (mocked fetch)

**Scenario F1: Annotation present (fast path)**

Mock: Token endpoint returns token. Manifest endpoint returns manifest with `dev.containers.metadata` annotation containing valid JSON.

Expected: Returns `{ metadata: {...}, source: "annotation" }`. No blob fetch made.

**Scenario F2: Annotation missing, tarball fallback succeeds**

Mock: Token returns token. Manifest returns manifest without `dev.containers.metadata` but with a layer of type `application/vnd.devcontainers.layer.v1+tar`. Blob endpoint returns a tar buffer containing `devcontainer-feature.json`.

Expected: Returns `{ metadata: {...}, source: "tarball" }`. Blob fetch made exactly once.

**Scenario F3: Annotation missing, tarball has no devcontainer-feature.json**

Mock: Same as F2 but tar buffer contains only `install.sh`.

Expected: Throws `OciRegistryError` with `kind: "parse_failed"` and message about missing `devcontainer-feature.json`.

**Scenario F4: Annotation present but invalid JSON**

Mock: Manifest annotation contains `"{invalid json"`.

Expected: Throws `OciRegistryError` with `kind: "parse_failed"`.

**Scenario F5: Network failure on manifest fetch**

Mock: Manifest endpoint returns HTTP 500.

Expected: Throws `OciRegistryError` with `kind: "fetch_failed"`.

**Scenario F6: Network failure on blob fetch (annotation missing)**

Mock: Manifest succeeds (no annotation), blob endpoint returns HTTP 500.

Expected: Throws `OciRegistryError` with `kind: "fetch_failed"`.

**Scenario F7: Manifest is an OCI Image Index (multi-arch)**

Mock: First manifest fetch returns an index with one manifest entry. Second manifest fetch (to the indexed digest) returns the actual manifest with annotation.

Expected: Returns metadata from the nested manifest.

**Scenario F8: Gzip-compressed layer blob**

Mock: Manifest has no annotation. Blob returns a gzip-compressed tar. Content includes `devcontainer-feature.json`.

Expected: Gzip is detected and decompressed. Returns `{ metadata: {...}, source: "tarball" }`.

**Scenario F9: Fetch timeout**

Mock: `fetchFn` returns a promise that never resolves. Use a short `AbortSignal.timeout(100)` override for the test.

Expected: Fetch aborts with a timeout error, which surfaces as an `OciRegistryError`.

### Unit: `feature-metadata.test.ts` -- Updated integration with OCI client

**Scenario M1: fetchFromRegistry delegates to OCI client**

Mock: `fetchOciFeatureMetadata` returns `{ metadata: weztermMetadata, source: "annotation" }`.

Expected: `fetchFeatureMetadata("ghcr.io/org/feat:1")` returns `weztermMetadata`.

**Scenario M2: OciRegistryError translated to MetadataFetchError**

Mock: `fetchOciFeatureMetadata` throws `OciRegistryError("auth failed", "auth_failed")`.

Expected: `fetchFeatureMetadata("ghcr.io/org/feat:1")` throws `MetadataFetchError` with the OCI error's message as the `reason`.

**Scenario M3: Feature with missing annotation returns metadata via tarball**

Mock: `fetchOciFeatureMetadata` returns `{ metadata: nushellMetadata, source: "tarball" }`.

Expected: `fetchFeatureMetadata("ghcr.io/eitsupi/devcontainer-features/nushell:0")` returns `nushellMetadata` (not null).

**Scenario M4: Existing cache, validation, and local-path tests still pass**

Expected: All existing test scenarios in `feature-metadata.test.ts` pass without modification except for the mocking approach (mock `fetchOciFeatureMetadata` instead of `subprocess`).

### Integration: `up.integration.test.ts` -- Features without annotations get full metadata

**Scenario I1: Feature without annotation gets auto-injection via tarball fallback**

Setup: devcontainer.json with a feature that would previously return null metadata (annotation missing). Mock OCI client returns metadata with `customizations.lace.ports` via tarball source.

Expected: Port templates are auto-injected, ports are allocated, `portsAttributes` are enriched with feature-declared labels. The feature is fully functional.

**Scenario I2: Mixed features -- some annotation, some tarball**

Setup: Two features in config. One returns metadata via annotation, one via tarball.

Expected: Both features get full metadata-driven treatment. No nulls in the metadata map.

## Implementation Phases

### Phase 1: `oci-client.ts` -- Core OCI HTTP client

**New file:** `packages/lace/src/lib/oci-client.ts`

**New file:** `packages/lace/src/lib/__tests__/oci-client.test.ts`

**Scope:**
- `parseFeatureId()` -- feature ID to registry/repo/tag decomposition (digest-aware)
- `extractFromTar()` -- tar header parser with POSIX extended header (pax) support
- `maybeDecompress()` -- gzip detection and decompression using `node:zlib`
- `readDockerAuth()` -- read `~/.docker/config.json` for registry credentials (with `credHelpers` diagnostic)
- `parseWwwAuthenticate()` -- `WWW-Authenticate` header parsing for challenge-response
- `acquireTokenFromChallenge()` -- token acquisition from a parsed challenge
- `acquireToken()` -- OCI Distribution Spec token acquisition (GHCR shortcut + generic challenge-response)
- `fetchManifest()` -- OCI manifest fetch with `Accept` header for both manifest and index media types
- `fetchBlob()` -- OCI blob fetch with redirect following
- `fetchOciFeatureMetadata()` -- top-level orchestration (manifest -> annotation or tarball fallback)
- `OciRegistryError` class with `kind` field
- All `fetch()` calls use `signal: AbortSignal.timeout(30_000)`
- Manifest index handling (detect and resolve nested manifests)
- `fetchFn` parameter on all HTTP-making functions for testability

**Tests:** Scenarios P1-P5, T1-T6, A1-A5, F1-F9 (all using injected `fetchFn` mock).

**Success criteria:**
- `fetchOciFeatureMetadata("ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1")` returns metadata from annotation
- `fetchOciFeatureMetadata("ghcr.io/eitsupi/devcontainer-features/nushell:0")` returns metadata from tarball fallback
- All unit tests pass
- No npm dependencies added

**Constraints:**
- Do NOT modify `feature-metadata.ts` yet
- Do NOT modify `up.ts`
- Do NOT modify any test files outside `oci-client.test.ts`

### Phase 2: Wire OCI client into `feature-metadata.ts`

**Modified files:**
- `packages/lace/src/lib/feature-metadata.ts`
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

**Scope:**
1. Import `fetchOciFeatureMetadata` and `OciRegistryError` from `oci-client.ts`
2. Replace `fetchFromRegistry()` body with delegation to `fetchOciFeatureMetadata()`, translating `OciRegistryError` to `MetadataFetchError`
3. Make `fetchFromRegistry()` async (it was sync due to `execFileSync`)
4. Remove `import type { RunSubprocess }` and `import { runSubprocess }` -- the subprocess dependency is no longer needed for registry fetches
5. Make `FetchOptions.subprocess` optional and ignored (deprecated). Do not remove it yet -- `up.ts` still passes it. Add a `@deprecated` JSDoc tag.
6. Update all tests to mock `fetchOciFeatureMetadata` instead of `subprocess`

**Tests:** Scenarios M1-M4. Existing test scenarios 1-34 updated for new mocking approach.

**Success criteria:**
- All existing feature-metadata tests pass (after mock migration)
- No subprocess imported or used for metadata fetching
- `FetchOptions.subprocess` is deprecated but still accepted (no TypeScript errors in `up.ts`)
- Existing `MetadataFetchError` class unchanged (no `kind` field added)

**Constraints:**
- Do NOT modify `up.ts` yet -- it still passes `subprocess`, which is now ignored
- Minimize changes to `oci-client.ts` (it was finalized in Phase 1; adjust only if integration reveals issues)
- Preserve all existing `FetchOptions` fields (including `subprocess` as deprecated)
- Preserve caching behavior exactly as-is

### Phase 3: Integration tests and `up.ts` cleanup

**Modified files:**
- `packages/lace/src/commands/__tests__/up.integration.test.ts`
- `packages/lace/src/lib/up.ts` (minor: remove the `subprocess` pass-through to `fetchAllFeatureMetadata()`)
- `packages/lace/src/lib/feature-metadata.ts` (minor: remove deprecated `FetchOptions.subprocess` field)

**Scope:**
1. Remove `FetchOptions.subprocess` field entirely (callers updated in this phase)
2. Update `up.ts`: remove the `subprocess` parameter from the `fetchAllFeatureMetadata()` call on line 148. The `subprocess` parameter is still used by `up.ts` for other purposes (`runPrebuild()`, `runResolveMounts()`, `runDevcontainerUp()`), so it is NOT removed from `up.ts` entirely -- only the pass-through to metadata fetching is removed.
3. Update integration test mocks: replace `subprocess`-based metadata mocks with OCI client mocks or `fetchFn` injection
4. Add integration test I1: feature without annotation gets full metadata via tarball
5. Add integration test I2: mixed annotation/tarball features both get metadata
6. Verify that `wez-into`'s `--skip-metadata-validation` workaround is no longer needed for annotation-missing features (the tarball fallback resolves it transparently)
7. Update `up.ts` comments to reflect that metadata is always available (not conditionally null for annotation-missing features)

**Tests:** Scenarios I1-I2. All existing integration tests pass.

**Success criteria:**
- `lace up` succeeds with nushell feature (previously failed without `--skip-metadata-validation`)
- Feature metadata is populated for all features, including those without annotations
- All existing integration tests pass
- No regressions in port allocation, auto-injection, or validation
- `FetchOptions.subprocess` fully removed

**Constraints:**
- Minimize changes to `oci-client.ts` (finalized in Phase 1)
- Do NOT remove `--skip-metadata-validation` flag (it remains useful for genuine network failures)

### Phase 4: Remove subprocess workarounds

**Modified files:**
- `bin/wez-into` (remove `--skip-metadata-validation` from the `lace up` invocation if it was added as a workaround for annotation-missing features)

**Scope:**
1. Remove `--skip-metadata-validation` from `wez-into`'s `lace up` call if it was added solely for the nushell annotation issue
2. Update comments explaining the workaround

**Success criteria:**
- `wez-into --start` works without `--skip-metadata-validation` for workspaces with annotation-missing features
- `wez-into --start` still works for workspaces where all features have annotations
- `--skip-metadata-validation` is still available as a CLI flag for genuine network/auth failures

**Constraints:**
- This phase is a cleanup step. It should not change any behavior -- the tarball fallback already resolves the underlying issue.
