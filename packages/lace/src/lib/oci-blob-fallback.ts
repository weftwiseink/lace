/**
 * OCI blob fallback: download a feature's layer blob and extract
 * devcontainer-feature.json when the dev.containers.metadata annotation
 * is missing from the OCI manifest.
 *
 * This is a focused fallback path (~60 lines of core logic) that supplements
 * the subprocess-based manifest fetch. It handles anonymous token acquisition,
 * blob download, and tar extraction for public registries.
 *
 * See: cdocs/proposals/2026-02-13-hybrid-oci-metadata-fallback.md
 */

import type { FeatureMetadata } from "./feature-metadata";

// ── Types ──

export interface ParsedFeatureId {
  registry: string; // "ghcr.io"
  repository: string; // "eitsupi/devcontainer-features/nushell"
  tag: string; // "0" (or "latest" if unspecified)
}

export interface OciManifestWithLayers {
  annotations?: Record<string, string>;
  layers?: Array<{ digest?: string; mediaType?: string; size?: number }>;
  manifest?: {
    annotations?: Record<string, string>;
    layers?: Array<{ digest?: string; mediaType?: string; size?: number }>;
  };
}

// ── Feature ID parsing ──

/**
 * Parse a devcontainer feature OCI reference into registry, repository, and tag.
 * e.g., "ghcr.io/eitsupi/devcontainer-features/nushell:0"
 *   -> { registry: "ghcr.io", repository: "eitsupi/devcontainer-features/nushell", tag: "0" }
 */
export function parseFeatureOciRef(featureId: string): ParsedFeatureId {
  const tagSep = featureId.lastIndexOf(":");
  const hasTag = tagSep > featureId.indexOf("/"); // Avoid matching port in registry
  const ref = hasTag ? featureId.substring(0, tagSep) : featureId;
  const tag = hasTag ? featureId.substring(tagSep + 1) : "latest";

  const firstSlash = ref.indexOf("/");
  const registry = ref.substring(0, firstSlash);
  const repository = ref.substring(firstSlash + 1);

  return { registry, repository, tag };
}

// ── Anonymous token acquisition ──

/**
 * Acquire an anonymous pull-scoped token from a public registry.
 * Uses GHCR shortcut for ghcr.io, generic WWW-Authenticate challenge for others.
 * Returns null if token acquisition fails (e.g., private registry).
 */
export async function acquireAnonymousToken(
  registry: string,
  repository: string,
): Promise<string | null> {
  try {
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
    if (!realmMatch) return null;

    const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
    const realm = realmMatch[1];
    const service = serviceMatch?.[1] ?? registry;
    const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=repository:${encodeURIComponent(repository)}:pull`;

    const tokenResp = await fetch(tokenUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResp.ok) return null;
    const tokenBody = (await tokenResp.json()) as {
      token?: string;
      access_token?: string;
    };
    return tokenBody.token ?? tokenBody.access_token ?? null;
  } catch {
    // Timeout or network error
    return null;
  }
}

// ── Blob download ──

/**
 * Download an OCI layer blob by digest.
 * Returns null on non-2xx response or timeout.
 */
export async function downloadBlob(
  registry: string,
  repository: string,
  digest: string,
  token: string | null,
): Promise<Buffer | null> {
  const url = `https://${registry}/v2/${repository}/blobs/${digest}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });

    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    // Timeout or network error
    return null;
  }
}

// ── Tar extraction ──

/**
 * Extract a named file from a plain tar archive buffer.
 * Handles pax extended headers (typeflag 0x78 per-file, 0x67 global).
 * Returns null if the target file is not found.
 * Throws on gzip-compressed input (magic bytes 0x1f 0x8b).
 */
export function extractFromTar(
  tarBuffer: Buffer,
  targetName: string,
): Buffer | null {
  // Detect gzip-compressed blobs (magic bytes 0x1f 0x8b) and fail with a clear message
  if (
    tarBuffer.length >= 2 &&
    tarBuffer[0] === 0x1f &&
    tarBuffer[1] === 0x8b
  ) {
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
      // Pax extended header (0x78 = per-file, 0x67 = global):
      // parse "length path=value\n" entries
      const paxData = tarBuffer
        .subarray(dataStart, dataEnd)
        .toString("utf-8");
      const pathMatch = paxData.match(/\d+ path=([^\n]+)\n/);
      if (pathMatch) paxPath = pathMatch[1];
    } else {
      // Regular file entry (typeflag '0'/0x30, '\0'/0x00, or other non-pax types)
      const name =
        paxPath ??
        header
          .subarray(0, 100)
          .toString("ascii")
          .replace(/\0/g, "")
          .trim();
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

// ── Blob fetch orchestration ──

/**
 * Fetch feature metadata by downloading and extracting the OCI layer blob.
 * Used as a fallback when the dev.containers.metadata annotation is missing.
 *
 * @param featureId - The feature OCI reference (e.g., "ghcr.io/org/features/name:1")
 * @param manifest - The OCI manifest JSON (already fetched by the subprocess)
 * @returns The parsed devcontainer-feature.json content
 * @throws Error on any failure (caller wraps as MetadataFetchError)
 */
export async function fetchFromBlob(
  featureId: string,
  manifest: OciManifestWithLayers,
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
    throw new Error(
      `First layer has no valid digest (got: ${digest ?? "undefined"})`,
    );
  }

  // Acquire anonymous token (may return null for private registries)
  const token = await acquireAnonymousToken(registry, repository);

  // Download blob
  const blob = await downloadBlob(registry, repository, digest, token);
  if (!blob) {
    throw new Error(
      `Failed to download blob ${digest} from ${registry}/${repository}` +
        (token
          ? ""
          : " (no anonymous token available -- private registry?)"),
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
