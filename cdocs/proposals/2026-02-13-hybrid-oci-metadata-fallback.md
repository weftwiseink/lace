---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T20:00:00-08:00
task_list: lace/feature-metadata
type: proposal
state: live
status: implementation_wip
revisions:
  - at: 2026-02-14T00:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Fixed pax global header handling: added typeflag 0x67 check (R1 Finding 10)"
      - "Fixed pax path regex greediness: changed .+ to [^\\n]+ (R1 Finding 11)"
      - "Wrapped JSON.parse in fetchFromBlob with try/catch for descriptive errors (R1 Finding 24)"
      - "Separated fetchFromBlob errors from cache-write errors in AnnotationMissingError handler (R1 Finding 14)"
      - "Empirically verified CLI output includes layers array with sample output (R1 Finding 16)"
      - "Added encodeURIComponent to GHCR token URL (R1 Finding 6)"
      - "Added gzip magic byte detection in extractFromTar (R1 Finding 32)"
      - "Added multi-field pax data and malformed JSON test cases to test plan (R1 Findings 22, 23)"
tags: [feature-metadata, oci, tarball-fallback, error-handling, robustness, hybrid, nushell, third-party-features]
references:
  - cdocs/reports/2026-02-13-oci-metadata-annotation-missing-incident.md
  - cdocs/proposals/2026-02-13-robust-metadata-fetching.md
  - cdocs/proposals/2026-02-13-native-oci-metadata-client.md
  - cdocs/proposals/2026-02-06-lace-feature-metadata-management.md
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-10-devcontainer-metadata-and-lace-registry.md
supersedes:
  - cdocs/proposals/2026-02-13-native-oci-metadata-client.md
  - cdocs/proposals/2026-02-13-robust-metadata-fetching.md
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-14T00:00:00-08:00
  round: 1
---

# Hybrid OCI Metadata Fallback: Blob Download for Missing Annotations

> **BLUF:** When `devcontainer features info manifest` returns a valid OCI manifest but the `dev.containers.metadata` annotation is absent, download the feature's OCI layer blob directly via HTTP and extract `devcontainer-feature.json` from the tarball. This hybrid approach keeps the existing subprocess for manifest fetching (where it handles auth, registry quirks, and CLI evolution for free) and adds ~60 lines of native Node.js code for the fallback path only. The result: lace always gets metadata for public-registry features regardless of whether the publisher included the annotation, without the maintenance burden of a full OCI registry client. The `dev.containers.metadata` annotation is spec-optional (SHOULD, not MUST per the [devcontainer features distribution spec](https://containers.dev/implementors/features-distribution/)), and the devcontainer CLI itself has an equivalent tarball fallback. See [incident report](../reports/2026-02-13-oci-metadata-annotation-missing-incident.md) for root cause, [first proposal](../proposals/2026-02-13-robust-metadata-fetching.md) for the "return null" approach (rejected as giving up guarantees), and [native OCI proposal](../proposals/2026-02-13-native-oci-metadata-client.md) for the full replacement approach (rejected as over-engineered for the problem scope).

## Objective

Make `lace up` successfully handle features that lack the `dev.containers.metadata` OCI annotation by fetching metadata from the feature tarball as a fallback, without replacing the existing subprocess-based manifest fetch infrastructure.

## Background

### The problem

`lace up` fatally errors on third-party features that don't publish `dev.containers.metadata` OCI annotations (e.g., `ghcr.io/eitsupi/devcontainer-features/nushell:0`). The error message misleadingly blames the user's build environment. The annotation is spec-optional (RFC 2119 SHOULD, not MUST), and many features published before April 2023 or with non-standard tooling lack it permanently. See [incident report](../reports/2026-02-13-oci-metadata-annotation-missing-incident.md).

### Approaches considered

Three approaches were evaluated:

1. **Return null for missing annotations** ([first proposal](../proposals/2026-02-13-robust-metadata-fetching.md)): Makes `annotation_missing` silently non-fatal, returns null metadata. Rejected because it gives up all guarantees -- we can never know whether a feature has `customizations.lace` declarations that we're silently ignoring.

2. **Full native OCI registry client** ([native OCI proposal](../proposals/2026-02-13-native-oci-metadata-client.md)): Replaces the subprocess entirely with a pure Node.js HTTP client implementing the OCI Distribution Spec token dance, manifest fetch, and blob download. Technically sound but over-engineered: ~500 lines of new code, a full OCI auth implementation, Docker credential file parsing, and an ongoing maintenance burden tracking OCI spec changes -- all to avoid a subprocess that works fine for 99% of cases.

3. **Hybrid: subprocess + blob fallback** (this proposal): Keep the subprocess for manifest fetch. When annotation is missing, use the layer digest already present in the manifest JSON to download the blob via a single anonymous HTTP request. Extract `devcontainer-feature.json` from the tarball (~10KB, plain tar, zero dependencies). This adds ~60 lines of focused code to handle the one case where the subprocess output is insufficient.

### Why hybrid wins

The subprocess already handles:
- Registry authentication (Docker credential helpers, `~/.docker/config.json`)
- OCI Distribution Spec compliance (manifest negotiation, media types, redirects)
- Registry-specific quirks (Docker Hub hostname normalization, GHCR token flow)
- Version updates (new CLI versions gain new features/fixes automatically)

The only gap is: the CLI returns the manifest successfully but it lacks the annotation. The manifest JSON the CLI returns already contains the layer digest. One HTTP request to download that blob fills the gap completely.

### OCI blob structure

Feature tarballs are the first (and usually only) layer blob in the OCI manifest. They are:
- Plain tar (not gzipped) -- `.tar` not `.tar.gz`
- Small: typically 5-15KB
- Always contain `devcontainer-feature.json` at the root level (this is the ground truth for feature metadata, per the [distribution spec](https://containers.dev/implementors/features-distribution/))
- Downloadable anonymously from public registries (GHCR, Docker Hub, etc.) via a simple token exchange

The devcontainer CLI itself uses this exact fallback path in `containerFeaturesOrder.ts` and `containerFeaturesConfiguration.ts` for backwards compatibility with pre-annotation features.

### Verified CLI output structure

The `devcontainer features info manifest --output-format json` output includes the full OCI manifest with `layers`. Empirically verified against `ghcr.io/eitsupi/devcontainer-features/nushell:0`:

```json
{
  "manifest": {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.manifest.v1+json",
    "config": { "mediaType": "application/vnd.devcontainers", "digest": "sha256:e3b0c44...", "size": 0 },
    "layers": [
      {
        "mediaType": "application/vnd.devcontainers.layer.v1+tar",
        "digest": "sha256:4782d0e1b185d5c148fba82eefc2f550ee0fc626129cc4280dbf98474726779c",
        "size": 10240,
        "annotations": { "org.opencontainers.image.title": "devcontainer-feature-nushell.tgz" }
      }
    ],
    "annotations": { "com.github.package.type": "devcontainer_feature" }
  },
  "canonicalId": "ghcr.io/eitsupi/devcontainer-features/nushell@sha256:c35933c..."
}
```

Key observations: (1) `layers` is present under `manifest.layers`, (2) the layer `digest` is the `sha256:` reference needed for blob download, (3) the layer `size` is 10240 bytes (10KB), (4) despite the annotation title saying `.tgz`, the blob is plain tar (verified: first bytes are `./`, not gzip magic `0x1f 0x8b`), (5) no `dev.containers.metadata` annotation is present (only `com.github.package.type`).

## Proposed Solution

### Architecture overview

```
fetchFromRegistry(featureId, subprocess)
  │
  ├── subprocess: devcontainer features info manifest <featureId>
  │     │
  │     ├── CLI exits non-zero → throw MetadataFetchError (kind: fetch_failed)
  │     ├── CLI returns invalid JSON → throw MetadataFetchError (kind: invalid_response)
  │     ├── Annotation present + valid → return FeatureMetadata ✓
  │     ├── Annotation present + invalid → throw MetadataFetchError (kind: annotation_invalid)
  │     └── Annotation missing → enter fallback path ↓
  │
  └── fallbackFromBlob(featureId, manifest)
        │
        ├── Extract layer digest from manifest JSON
        ├── Parse registry + repository from featureId
        ├── Acquire anonymous token from registry
        ├── GET /v2/<repo>/blobs/<digest> → tar bytes
        ├── Extract devcontainer-feature.json from tar
        ├── Parse JSON → return FeatureMetadata ✓
        └── Any failure → throw MetadataFetchError (kind: blob_fallback_failed)
```

### 1. Add `kind` field to `MetadataFetchError`

Categorize errors so the catch block and error messages can discriminate:

```typescript
export type MetadataFetchKind =
  | "fetch_failed"          // CLI non-zero exit (network, auth, registry)
  | "invalid_response"      // CLI returned unparseable output
  | "annotation_invalid"    // Annotation present but malformed JSON
  | "blob_fallback_failed"; // Blob download/extraction failed after annotation missing

export class MetadataFetchError extends Error {
  constructor(
    public readonly featureId: string,
    public readonly reason: string,
    public readonly kind: MetadataFetchKind,
    public readonly cause?: Error,
  ) {
    super(MetadataFetchError.formatMessage(featureId, reason, kind));
    this.name = "MetadataFetchError";
  }

  private static formatMessage(
    featureId: string,
    reason: string,
    kind: MetadataFetchKind,
  ): string {
    const base = `Failed to fetch metadata for feature "${featureId}": ${reason}.`;
    switch (kind) {
      case "fetch_failed":
        return `${base} This indicates a problem with your build environment (network, auth, or registry). Use --skip-metadata-validation to bypass this check.`;
      case "invalid_response":
        return `${base} The devcontainer CLI returned unexpected output. Use --skip-metadata-validation to bypass this check.`;
      case "annotation_invalid":
        return `${base} The feature's metadata annotation is malformed. Contact the feature maintainer. Use --skip-metadata-validation to bypass this check.`;
      case "blob_fallback_failed":
        return `${base} The feature lacks an OCI annotation and the tarball fallback also failed. Use --skip-metadata-validation to bypass this check.`;
    }
  }
}
```

### 2. Parse registry and repository from feature ID

Extract the components needed to construct OCI API URLs:

```typescript
interface ParsedFeatureId {
  registry: string;   // "ghcr.io"
  repository: string; // "eitsupi/devcontainer-features/nushell"
  tag: string;        // "0" (or "latest" if unspecified)
}

function parseFeatureOciRef(featureId: string): ParsedFeatureId {
  // Feature IDs follow the pattern: registry/path/name:tag
  // e.g., "ghcr.io/eitsupi/devcontainer-features/nushell:0"
  const tagSep = featureId.lastIndexOf(":");
  const hasTag = tagSep > featureId.indexOf("/"); // Avoid matching port in registry
  const ref = hasTag ? featureId.substring(0, tagSep) : featureId;
  const tag = hasTag ? featureId.substring(tagSep + 1) : "latest";

  const firstSlash = ref.indexOf("/");
  const registry = ref.substring(0, firstSlash);
  const repository = ref.substring(firstSlash + 1);

  return { registry, repository, tag };
}
```

### 3. Anonymous token acquisition

For public registries, acquire a pull-scoped token anonymously. GHCR uses `ghcr.io/token`, other registries use the `WWW-Authenticate` challenge from `GET /v2/`:

```typescript
async function acquireAnonymousToken(
  registry: string,
  repository: string,
): Promise<string | null> {
  // GHCR shortcut (most common case for devcontainer features)
  if (registry === "ghcr.io") {
    const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${encodeURIComponent(repository)}:pull`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { token?: string };
    return body.token ?? null;
  }

  // Generic: probe GET /v2/ for WWW-Authenticate challenge
  const probeResp = await fetch(`https://${registry}/v2/`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (probeResp.status !== 401) return null;

  const wwwAuth = probeResp.headers.get("www-authenticate");
  if (!wwwAuth) return null;

  // Parse: Bearer realm="...",service="...",scope="..."
  const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
  const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
  if (!realmMatch) return null;

  const realm = realmMatch[1];
  const service = serviceMatch?.[1] ?? registry;
  const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=repository:${encodeURIComponent(repository)}:pull`;

  const tokenResp = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
  if (!tokenResp.ok) return null;
  const tokenBody = (await tokenResp.json()) as { token?: string; access_token?: string };
  return tokenBody.token ?? tokenBody.access_token ?? null;
}
```

### 4. Blob download

Fetch the layer blob using the digest from the manifest:

```typescript
async function downloadBlob(
  registry: string,
  repository: string,
  digest: string,
  token: string | null,
): Promise<Buffer | null> {
  const url = `https://${registry}/v2/${repository}/blobs/${digest}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });

  if (!resp.ok) return null;
  return Buffer.from(await resp.arrayBuffer());
}
```

### 5. Tar extraction

Extract `devcontainer-feature.json` from a plain tar archive. Tar headers are 512-byte blocks: filename at offset 0 (100 bytes), file size at offset 124 (12 bytes, octal). Pax extended headers (typeflag `x` at byte 156) precede entries and override the filename.

```typescript
function extractFromTar(tarBuffer: Buffer, targetName: string): Buffer | null {
  // Detect gzip-compressed blobs (magic bytes 0x1f 0x8b) and fail with a clear message
  if (tarBuffer.length >= 2 && tarBuffer[0] === 0x1f && tarBuffer[1] === 0x8b) {
    throw new Error(
      "Feature tarball appears to be gzip-compressed; expected plain tar",
    );
  }

  let offset = 0;
  let paxPath: string | null = null;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    // End-of-archive: two consecutive zero blocks
    if (header.every((b) => b === 0)) break;

    const typeflag = header[156];
    const sizeStr = header.subarray(124, 136).toString("ascii").trim();
    const size = parseInt(sizeStr, 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (typeflag === 0x78 || typeflag === 0x67) {
      // Pax extended header (0x78 = per-file, 0x67 = global): parse "length path=value\n" entries
      const paxData = tarBuffer.subarray(dataStart, dataEnd).toString("utf-8");
      const pathMatch = paxData.match(/\d+ path=([^\n]+)\n/);
      if (pathMatch) paxPath = pathMatch[1];
    } else {
      // Regular file entry (typeflag '0'/0x30, '\0'/0x00, or other non-pax types)
      const name = paxPath ?? header.subarray(0, 100).toString("ascii").replace(/\0/g, "").trim();
      paxPath = null; // Consume pax override

      // Match target: exact name or ./name (tar tools vary)
      if (name === targetName || name === `./${targetName}`) {
        return tarBuffer.subarray(dataStart, dataEnd);
      }
    }

    // Advance: header (512) + data (padded to 512-byte boundary)
    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return null;
}
```

### 6. Fallback orchestration in `fetchFromRegistry()`

When the annotation is missing, attempt the blob fallback before throwing:

```typescript
function fetchFromRegistry(
  featureId: string,
  subprocess: RunSubprocess = defaultRunSubprocess,
): FeatureMetadata {
  const result = subprocess("devcontainer", [
    "features", "info", "manifest", featureId, "--output-format", "json",
  ]);

  if (result.exitCode !== 0) {
    throw new MetadataFetchError(
      featureId,
      `devcontainer CLI exited with code ${result.exitCode}: ${result.stderr.trim()}`,
      "fetch_failed",
    );
  }

  let manifest: OciManifest;
  try {
    manifest = JSON.parse(result.stdout) as OciManifest;
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `CLI returned invalid JSON: ${(e as Error).message}`,
      "invalid_response",
    );
  }

  // Try annotation first (fast path)
  const metadataStr =
    manifest.manifest?.annotations?.["dev.containers.metadata"] ??
    manifest.annotations?.["dev.containers.metadata"];

  if (metadataStr) {
    try {
      return JSON.parse(metadataStr) as FeatureMetadata;
    } catch (e) {
      throw new MetadataFetchError(
        featureId,
        `dev.containers.metadata annotation is not valid JSON: ${(e as Error).message}`,
        "annotation_invalid",
      );
    }
  }

  // Annotation missing -- attempt blob fallback (async, but we need sync here)
  // See Design Decision: sync vs async for why this throws and the caller handles it
  throw new AnnotationMissingError(featureId, manifest);
}
```

### 7. Async fallback in `fetchFeatureMetadata()`

The blob download is async (uses `fetch`), so the fallback logic lives in the async `fetchFeatureMetadata()` caller:

```typescript
// Internal sentinel error (not exported)
class AnnotationMissingError extends Error {
  constructor(
    public readonly featureId: string,
    public readonly manifest: OciManifest,
  ) {
    super(`Annotation missing for ${featureId}`);
  }
}

export async function fetchFeatureMetadata(
  featureId: string,
  options: FetchOptions = {},
): Promise<FeatureMetadata | null> {
  // ... existing cache logic unchanged ...

  try {
    const metadata = isLocalPath(featureId)
      ? fetchFromLocalPath(featureId)
      : fetchFromRegistry(featureId, subprocess);

    memoryCache.set(featureId, metadata);
    if (!isLocalPath(featureId)) {
      writeFsCache(featureId, metadata, cacheDir);
    }
    return metadata;
  } catch (e) {
    // Annotation missing: attempt blob fallback
    if (e instanceof AnnotationMissingError) {
      // Separate blob-fetch errors from cache-write errors:
      // Only blob-fetch failures should be wrapped as blob_fallback_failed.
      // Cache-write errors (EACCES, ENOSPC, etc.) propagate naturally.
      let metadata: FeatureMetadata;
      try {
        metadata = await fetchFromBlob(e.featureId, e.manifest);
      } catch (blobErr) {
        const fallbackError = new MetadataFetchError(
          featureId,
          `OCI annotation missing and blob fallback failed: ${(blobErr as Error).message}`,
          "blob_fallback_failed",
          blobErr as Error,
        );
        if (skipValidation) {
          console.warn(
            `[lace] WARNING: ${fallbackError.message} (continuing due to --skip-metadata-validation)`,
          );
          return null;
        }
        throw fallbackError;
      }

      // Cache population outside the blob-error try/catch
      memoryCache.set(featureId, metadata);
      if (!isLocalPath(featureId)) {
        writeFsCache(featureId, metadata, cacheDir);
      }
      return metadata;
    }

    if (e instanceof MetadataFetchError) {
      if (skipValidation) {
        console.warn(
          `[lace] WARNING: ${e.message} (continuing due to --skip-metadata-validation)`,
        );
        return null;
      }
      throw e;
    }
    throw e;
  }
}
```

### 8. Blob fetch orchestration

The `fetchFromBlob()` function ties together token acquisition, blob download, and tar extraction:

```typescript
async function fetchFromBlob(
  featureId: string,
  manifest: OciManifest,
): Promise<FeatureMetadata> {
  const { registry, repository } = parseFeatureOciRef(featureId);

  // Extract layer digest from manifest (layers live under manifest.manifest
  // in the devcontainer CLI's JSON output -- see "Verified CLI output structure")
  const layers = manifest.manifest?.layers ?? manifest.layers;
  if (!layers || layers.length === 0) {
    throw new Error("No layers found in OCI manifest");
  }
  const digest = layers[0].digest;
  if (!digest || !digest.startsWith("sha256:")) {
    throw new Error(`First layer has no valid digest (got: ${digest ?? "undefined"})`);
  }

  // Acquire anonymous token (may return null for private registries)
  const token = await acquireAnonymousToken(registry, repository);

  // Download blob
  const blob = await downloadBlob(registry, repository, digest, token);
  if (!blob) {
    throw new Error(
      `Failed to download blob ${digest} from ${registry}/${repository}` +
        (token ? "" : " (no anonymous token available -- private registry?)"),
    );
  }

  // Extract devcontainer-feature.json from tar
  const featureJsonBuf = extractFromTar(blob, "devcontainer-feature.json");
  if (!featureJsonBuf) {
    throw new Error(
      "devcontainer-feature.json not found in feature tarball",
    );
  }

  try {
    return JSON.parse(featureJsonBuf.toString("utf-8")) as FeatureMetadata;
  } catch (e) {
    throw new Error(
      `devcontainer-feature.json in tarball for "${featureId}" contains invalid JSON: ${(e as Error).message}`,
    );
  }
}
```

### 9. Update `OciManifest` type

Extend the interface to include the `layers` field needed for digest extraction:

```typescript
interface OciManifest {
  annotations?: Record<string, string>;
  layers?: Array<{ digest?: string; mediaType?: string }>;
  manifest?: {
    annotations?: Record<string, string>;
    layers?: Array<{ digest?: string; mediaType?: string }>;
  };
}
```

### 10. Update `up.ts` comment

```typescript
// up.ts line 154 -- update comment to reflect new behavior
if (!metadata) continue; // null when skipValidation=true and both annotation + blob fallback fail
```

### 11. Remove `--skip-metadata-validation` from `wez-into`

In `bin/wez-into`, remove lines 158-160 (the `--skip-metadata-validation` flag and its comment block) from the `lace up` invocation. The flag is no longer needed since annotation-missing triggers the blob fallback instead of a fatal error.

## Important Design Decisions

### Decision: Hybrid over full native OCI client

**Why:** The subprocess handles 99% of cases correctly and benefits from CLI updates automatically. The only gap is annotation-missing, which requires one additional HTTP request to fill. A full native OCI client (~500 lines) replaces infrastructure that works, introduces a parallel auth implementation to maintain, and must track OCI spec evolution independently. The hybrid adds ~60 lines of focused fallback code with no impact on the working path.

### Decision: `AnnotationMissingError` as internal sentinel, not an exported error class

**Why:** `fetchFromRegistry()` is synchronous (uses `execFileSync`). The blob fallback requires `fetch` (async). Rather than making `fetchFromRegistry()` async (which would require changing the subprocess interface), throw an internal sentinel that `fetchFeatureMetadata()` catches and handles in its existing async context. The sentinel is not exported -- external callers see `MetadataFetchError` with `kind: "blob_fallback_failed"` if both paths fail, or successful metadata if the fallback works.

### Decision: Anonymous tokens only (no Docker credential file parsing)

**Why:** The subprocess already handles authenticated manifest fetch via Docker credential helpers. The blob fallback only runs when the manifest was successfully fetched (CLI exit 0) but lacks the annotation. For public registries (GHCR, Docker Hub, etc.), anonymous tokens suffice for blob download. For private registries, if anonymous token acquisition fails, the fallback throws and `--skip-metadata-validation` is available. Adding Docker credential file parsing would duplicate the auth infrastructure the subprocess already provides, for a scenario (private registry + missing annotation) that is vanishingly rare.

### Decision: GHCR shortcut with generic `WWW-Authenticate` fallback

**Why:** The vast majority of devcontainer features are hosted on GHCR. A direct `ghcr.io/token` request is simpler and faster than the challenge-response flow. For non-GHCR registries, the standard `GET /v2/` → `401` → `WWW-Authenticate` → token exchange flow provides spec-compliant coverage. This is the same approach the full native OCI proposal used, but scoped to anonymous tokens only.

### Decision: Keep `MetadataFetchError` as a single class with `kind` field

**Why:** The error handling in `fetchFeatureMetadata()` already catches by class. A `kind` field provides discrimination with less type surface than separate error classes. The `kind` enables clear, context-appropriate error messages: "build environment problem" for `fetch_failed` vs. "blob fallback failed" for `blob_fallback_failed`.

### Decision: Cache blob-fallback results identically to annotation results

**Why:** The metadata extracted from the tarball is the same `devcontainer-feature.json` that the annotation contains (the annotation is just a pre-extracted copy). Caching it with the same TTL semantics means: (a) subsequent `lace up` runs don't re-download the blob, and (b) if the feature publisher later adds the annotation, the cache TTL expiration naturally picks it up.

### Decision: `blob_fallback_failed` is fatal (not silently null)

**Why:** Unlike the first proposal's approach of silently returning null, a failed blob fallback is a real problem -- we tried to get the metadata and couldn't. The user should know, and `--skip-metadata-validation` is available for emergency bypass. This preserves the strict error semantics established in the [original metadata management proposal](../proposals/2026-02-06-lace-feature-metadata-management.md).

## Stories

### Third-party feature without annotation (primary motivator)

A user has `ghcr.io/eitsupi/devcontainer-features/nushell:0` in their devcontainer.json. Today: `lace up` fails with a misleading error. After this change: lace detects the missing annotation, downloads the ~10KB tarball, extracts `devcontainer-feature.json`, confirms nushell has no `customizations.lace` declarations, and proceeds normally. No user-visible output for the fallback path beyond debug logging.

### Feature with lace customizations but missing annotation

A hypothetical feature publisher declares `customizations.lace.ports` in their `devcontainer-feature.json` but published with old tooling that didn't set the annotation. Today: lace fails, and even with `--skip-metadata-validation`, the port declarations are silently ignored. After this change: the blob fallback extracts the full `devcontainer-feature.json`, discovers the lace customizations, and applies auto-injection and validation. The user gets full lace functionality despite the missing annotation.

### Private registry feature without annotation

A corporate feature on a private registry lacks the annotation. The subprocess succeeds (authenticated via Docker credential helpers) but returns no annotation. Anonymous blob download fails (401). Result: `MetadataFetchError` with `kind: "blob_fallback_failed"` and a message mentioning "private registry". User can use `--skip-metadata-validation`. This is an edge case (private registry + missing annotation) with a clear fallback path.

## Edge Cases

### Manifest index (multi-platform image)

Some features publish a manifest index rather than a manifest directly. The devcontainer CLI resolves the index to the platform-specific manifest. The CLI's JSON output may wrap this under a `manifest` key. The layer digest extraction checks both `manifest.manifest.layers` and `manifest.layers` to handle both formats.

### Tar with pax extended headers

Some tar tools write POSIX extended (pax) headers before entries (typeflag `x` at byte 156). These override the filename in the standard header. The tar parser handles this by checking typeflag and parsing `path=` entries from pax data.

### Empty or malformed tarball

If the blob downloads but is empty or contains no `devcontainer-feature.json`, `extractFromTar()` returns null and `fetchFromBlob()` throws with "devcontainer-feature.json not found in feature tarball". This becomes a `blob_fallback_failed` error.

### Feature gains annotation in future release

User is on floating tag `:0`. Publisher releases a new version with the annotation. After the 24h cache TTL expires (or `--no-cache`), lace fetches the manifest, finds the annotation, and uses the fast path. The blob fallback is never triggered. Seamless transition.

### `fetchFromLocalPath()` unchanged

Local-path features (`./features/foo`) read `devcontainer-feature.json` from disk directly. They never go through OCI manifest fetch and are unaffected by this change. Their errors use `kind: "fetch_failed"`.

### Network failure during blob download

If the blob `fetch()` times out (30s) or returns a non-2xx status, `downloadBlob()` returns null and `fetchFromBlob()` throws. The error message includes whether a token was available, helping diagnose private-registry vs. network issues.

### Registry returns gzipped blob

While the spec says feature tarballs are plain tar, some registries may apply content-encoding. Node's `fetch` handles `Content-Encoding: gzip` transparently (decompresses before returning the body). If the blob itself is gzipped (not content-encoding but actual `.tar.gz`), the tar parser will fail to find entries and `extractFromTar()` returns null, resulting in a clear error message. This is a theoretical edge case -- no known registries do this for feature blobs.

### Docker Hub hostname normalization

Docker Hub features may use `docker.io/library/...` or just `library/...`. The `parseFeatureOciRef()` function takes the registry as the text before the first `/`. Docker Hub features in devcontainer configs typically use the full `docker.io/...` form. If short-form references are encountered, the blob fallback may fail to acquire a token; the subprocess still handles the manifest fetch correctly via its own normalization. This is noted as a known limitation.

## Test Plan

### Unit tests: `feature-metadata.test.ts`

**`MetadataFetchError` kind discrimination:**
- Error with `kind: "fetch_failed"` includes "build environment" in message
- Error with `kind: "invalid_response"` includes "unexpected output" in message
- Error with `kind: "annotation_invalid"` includes "malformed" in message
- Error with `kind: "blob_fallback_failed"` includes "blob fallback" in message
- All kinds include `--skip-metadata-validation` hint

**`parseFeatureOciRef()`:**
- Standard GHCR ref: `ghcr.io/org/features/name:1` -> `{ registry: "ghcr.io", repository: "org/features/name", tag: "1" }`
- No tag: `ghcr.io/org/features/name` -> tag defaults to `"latest"`
- Exact semver tag: `ghcr.io/org/features/name:1.2.3` -> tag `"1.2.3"`
- Docker Hub: `docker.io/library/feature:1` -> `{ registry: "docker.io", ... }`

**`extractFromTar()`:**
- Extracts file from standard tar (512-byte headers)
- Extracts file with `./` prefix in filename
- Returns null when target file not found
- Handles pax per-file extended headers (typeflag `0x78`) overriding filename
- Handles pax global extended headers (typeflag `0x67`) without misidentifying as regular file
- Handles pax data with multiple fields (e.g., `mtime` + `path`) -- regex matches correctly
- Handles empty/zero-block tar gracefully (returns null, no crash)
- Throws with clear message on gzip-compressed input (magic bytes `0x1f 0x8b`)

**`fetchFromBlob()` (with mocked fetch):**
- Succeeds with valid blob containing `devcontainer-feature.json`
- Throws when no layers in manifest
- Throws when layer digest is missing or malformed (no `sha256:` prefix)
- Throws when blob download returns non-2xx
- Throws when `devcontainer-feature.json` not found in tar
- Throws with descriptive message when extracted JSON is malformed (not a raw SyntaxError)

**`fetchFeatureMetadata()` blob fallback integration:**
- Annotation missing + blob fallback succeeds → returns metadata, caches it
- Annotation missing + blob fallback fails + `skipValidation: false` → throws `MetadataFetchError` with `kind: "blob_fallback_failed"`
- Annotation missing + blob fallback fails + `skipValidation: true` → returns null, warns
- Annotation present → uses annotation (blob fallback not attempted)
- CLI failure → throws `MetadataFetchError` with `kind: "fetch_failed"` (blob fallback not attempted)

**`fetchAllFeatureMetadata()` mixed batch:**
- Feature A has annotation, Feature B lacks annotation but blob fallback succeeds → both return metadata
- Feature A has annotation, Feature B blob fallback fails, `skipValidation: false` → throws
- Feature A has annotation, Feature B blob fallback fails, `skipValidation: true` → A returns metadata, B returns null

### Unit tests: `oci-blob-fallback.test.ts` (new file)

Dedicated tests for the blob fallback module internals:

**`acquireAnonymousToken()` (with mocked fetch):**
- GHCR: returns token from `ghcr.io/token` response
- GHCR: returns null on non-2xx response
- Generic registry: parses `WWW-Authenticate` challenge and acquires token
- Generic registry: returns null when no `WWW-Authenticate` header
- Generic registry: returns null when `realm` not found in challenge
- Timeout: returns null on fetch timeout (does not hang)

**`downloadBlob()` (with mocked fetch):**
- Returns buffer on 2xx response
- Returns null on non-2xx response
- Passes Authorization header when token provided
- Omits Authorization header when token is null
- Returns null on timeout

### Integration tests: `up.integration.test.ts`

**Mixed feature scenario:**

Extend the existing mock subprocess to handle a feature that returns a valid manifest JSON without the `dev.containers.metadata` annotation. Mock `fetch` (via `vi.stubGlobal`) to simulate the blob fallback path.

- `lace up` with Feature A (has annotation) + Feature B (no annotation, blob fallback succeeds): exits 0, validates A, resolves B via fallback
- `lace up` with Feature A (has annotation) + Feature B (no annotation, blob fallback fails): exits 1 with `blob_fallback_failed` message
- `lace up` with `--skip-metadata-validation` and Feature B (blob fallback fails): exits 0, Feature B metadata is null

### Smoke test: live registry

A manual smoke test script (not in CI) that validates the blob fallback against the actual `ghcr.io/eitsupi/devcontainer-features/nushell:0` feature:

```bash
# Run from the lace repo root
# Requires: node, devcontainer CLI
npx vitest run --testPathPattern='feature-metadata' --reporter=verbose

# Or: direct lace up in a workspace with nushell feature
cd /path/to/workspace-with-nushell
npx lace up --workspace-folder .
# Expected: succeeds without --skip-metadata-validation
# Expected: "Fetching feature metadata..." completes without error
```

Additionally, `wez-into --start` in the lace devcontainer (which has `nushell:0`) should succeed without `--skip-metadata-validation`.

## Implementation Phases

### Phase 1: `MetadataFetchError` kind field and blob fallback infrastructure

**Files created:**
- `packages/lace/src/lib/oci-blob-fallback.ts`

**Files modified:**
- `packages/lace/src/lib/feature-metadata.ts`

**Changes:**

1. Create `oci-blob-fallback.ts` with the following exports:
   - `parseFeatureOciRef()` -- parse registry, repository, tag from feature ID
   - `acquireAnonymousToken()` -- GHCR shortcut + generic `WWW-Authenticate` flow
   - `downloadBlob()` -- fetch blob by digest with optional auth
   - `extractFromTar()` -- extract named file from plain tar buffer
   - `fetchFromBlob()` -- orchestrate token + download + extract for a feature

2. In `feature-metadata.ts`:
   - Add `MetadataFetchKind` type and `kind` field to `MetadataFetchError` constructor
   - Add `formatMessage()` static method with kind-specific messages
   - Update all four throw sites in `fetchFromRegistry()` with appropriate `kind` values
   - Update `fetchFromLocalPath()` throw sites with `kind: "fetch_failed"`
   - Add internal `AnnotationMissingError` sentinel class
   - Replace the `throw new MetadataFetchError(... "annotation missing" ...)` with `throw new AnnotationMissingError(featureId, manifest)`
   - Update `OciManifest` interface to include `layers`
   - Update `fetchFeatureMetadata()` catch block to handle `AnnotationMissingError` by calling `fetchFromBlob()`, with cache population on success and `MetadataFetchError(kind: "blob_fallback_failed")` on failure

**Do not change:**
- `up.ts` logic (beyond comment update)
- `template-resolver.ts`
- Cache TTL semantics
- `FetchOptions` interface
- `fetchAllFeatureMetadata()` (behavior changes flow from `fetchFeatureMetadata()` naturally)

**Success criteria:**
- `fetchFromRegistry()` throws `AnnotationMissingError` instead of `MetadataFetchError` when annotation is missing
- `fetchFeatureMetadata()` catches `AnnotationMissingError` and calls `fetchFromBlob()`
- Blob fallback succeeds for GHCR features without annotations (tested with mocked fetch)
- Blob fallback failure produces `MetadataFetchError` with `kind: "blob_fallback_failed"`
- All existing tests pass (update test for scenario 5 which currently expects `MetadataFetchError` on missing annotation -- it now expects success via blob fallback, or `blob_fallback_failed` if fetch is not mocked)

### Phase 2: Test coverage

**Files created:**
- `packages/lace/src/lib/__tests__/oci-blob-fallback.test.ts`

**Files modified:**
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`
- `packages/lace/src/commands/__tests__/up.integration.test.ts`

**Changes:**

1. Create `oci-blob-fallback.test.ts` with tests for:
   - `parseFeatureOciRef()` (4 cases)
   - `extractFromTar()` (8 cases: standard, `./` prefix, not found, pax per-file `0x78`, pax global `0x67`, multi-field pax data, empty tar, gzip detection)
   - `acquireAnonymousToken()` with mocked `fetch` (6 cases)
   - `downloadBlob()` with mocked `fetch` (5 cases)
   - `fetchFromBlob()` with mocked `fetch` (6 cases including malformed JSON in tarball)

2. Update `feature-metadata.test.ts`:
   - Add tests for `MetadataFetchError.kind` and kind-specific messages
   - Update scenario 5 ("Missing dev.containers.metadata annotation") to mock `fetch` for the blob fallback path:
     - Sub-scenario 5a: blob fallback succeeds → returns metadata
     - Sub-scenario 5b: blob fallback fails (fetch not mocked / returns error) → throws with `kind: "blob_fallback_failed"`
   - Add mixed-batch test in `fetchAllFeatureMetadata`: one feature with annotation, one without (blob fallback succeeds)

3. Update `up.integration.test.ts`:
   - Add a feature to the mock that returns a manifest without annotations
   - Mock `fetch` for the blob fallback path
   - Test: `lace up` with mixed features (annotation present + annotation missing) succeeds
   - Test: `lace up` with blob fallback failure reports correct error

**Mocking strategy for `fetch`:**

Use `vi.stubGlobal("fetch", mockFetch)` in test setup. The mock should:
- Match on URL pattern to distinguish token requests from blob requests
- Return a mock token for `ghcr.io/token?...` requests
- Return a pre-built tar buffer for `/v2/.../blobs/...` requests
- The tar buffer can be constructed in the test: 512-byte header + `devcontainer-feature.json` content padded to 512-byte boundary

**Success criteria:**
- All new tests pass
- All existing tests pass (no regressions)
- Tests cover all four `MetadataFetchKind` values
- Mixed-batch test demonstrates partial annotation coverage working

### Phase 3: `wez-into` cleanup

**Files modified:**
- `bin/wez-into`

**Changes:**
- Remove `--skip-metadata-validation` from the `lace up` invocation in `start_and_connect()` (around line 158)
- Remove the comment block explaining the workaround (lines 158-160)

**Success criteria:**
- `wez-into --start` works without `--skip-metadata-validation` for workspaces with `nushell:0`
- `wez-into --start` works for workspaces where all features have metadata annotations

### Phase 4: Smoke test validation

**Not a code change** -- manual validation against live registries.

**Steps:**
1. Run `npx vitest run` in the lace package -- all tests pass
2. Run `lace up` in the lace devcontainer (has `nushell:0`) -- succeeds without `--skip-metadata-validation`
3. Run `wez-into --start lace` -- connects successfully
4. Verify no user-visible output about the nushell feature's missing annotation (debug log only)
5. Verify wezterm-server feature (which has the annotation) still gets full validation and auto-injection

**Success criteria:**
- All automated tests pass
- Live `lace up` with nushell succeeds
- No regressions in wezterm-server metadata handling
- `wez-into` works end-to-end
