// IMPLEMENTATION_VALIDATION
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RunSubprocess } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";
import { fetchFromBlob } from "./oci-blob-fallback";

// ── Types ──

/** Parsed devcontainer-feature.json content. */
export interface FeatureMetadata {
  id: string;
  version: string;
  name?: string;
  description?: string;
  options?: Record<string, FeatureOption>;
  customizations?: Record<string, unknown>;
}

export interface FeatureOption {
  type: "string" | "boolean";
  default?: string | boolean;
  description?: string;
  enum?: string[];
  proposals?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  kind: "unknown_option" | "port_key_mismatch";
  message: string;
  optionName?: string;
  featureId?: string;
}

export interface LacePortDeclaration {
  label?: string;
  onAutoForward?:
    | "silent"
    | "notify"
    | "openBrowser"
    | "openPreview"
    | "ignore";
  requireLocalPort?: boolean;
  protocol?: "http" | "https";
}

export interface LaceCustomizations {
  ports?: Record<string, LacePortDeclaration>;
}

export interface FetchOptions {
  /** Bypass filesystem cache for floating tags. Default: false. */
  noCache?: boolean;
  /** Skip metadata validation entirely (offline/emergency). Default: false. */
  skipValidation?: boolean;
  /** Subprocess runner override (for testing). */
  subprocess?: RunSubprocess;
  /** Override cache directory (for testing). Default: ~/.config/lace/cache/features */
  cacheDir?: string;
}

export type MetadataFetchKind =
  | "fetch_failed" // CLI non-zero exit (network, auth, registry)
  | "invalid_response" // CLI returned unparseable output
  | "annotation_invalid" // Annotation present but malformed JSON
  | "blob_fallback_failed"; // Blob download/extraction failed after annotation missing

/** Error thrown when metadata cannot be fetched and skipValidation is false. */
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

// ── Internal: Cache types ──

interface CacheEntry {
  /** The feature metadata itself. */
  metadata: FeatureMetadata;
  /** Cache bookkeeping, not part of the feature metadata. */
  _cache: {
    /** The feature ID as provided. */
    featureId: string;
    /** ISO 8601 timestamp when the cache entry was written. */
    fetchedAt: string;
    /**
     * TTL in milliseconds. null means permanent (pinned version).
     * 86400000 = 24h for floating tags.
     */
    ttlMs: number | null;
  };
}

interface ReadFsCacheOptions {
  /** When true, skip entries with non-null TTL (floating tags). Default: false. */
  skipFloating?: boolean;
}

// ── Internal: OCI manifest shape ──

/** Shape of the OCI manifest JSON returned by the devcontainer CLI. */
interface OciManifest {
  annotations?: Record<string, string>;
  layers?: Array<{ digest?: string; mediaType?: string; size?: number }>;
  manifest?: {
    annotations?: Record<string, string>;
    layers?: Array<{ digest?: string; mediaType?: string; size?: number }>;
  };
}

// ── Internal: In-memory cache ──

const memoryCache = new Map<string, FeatureMetadata>();

// ── Internal: Filesystem cache ──

const DEFAULT_CACHE_DIR = join(
  homedir(),
  ".config",
  "lace",
  "cache",
  "features",
);

const SEMVER_EXACT = /^.*:\d+\.\d+\.\d+$/; // :1.2.3
const DIGEST_REF = /^.*@sha256:[a-f0-9]{64}$/; // @sha256:abc...

const TTL_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Convert a feature ID to a filesystem-safe cache key using percent-encoding.
 * '/' -> '%2F', ':' -> '%3A', '%' -> '%25' (encode % first to avoid double-encoding)
 */
export function featureIdToCacheKey(featureId: string): string {
  return featureId
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/:/g, "%3A");
}

function cacheKeyToFilePath(featureId: string, cacheDir: string): string {
  return join(cacheDir, `${featureIdToCacheKey(featureId)}.json`);
}

/**
 * Determine the TTL for a feature ID based on its version format.
 * Pinned versions (exact semver, digest) are permanent (null TTL).
 * Floating tags (major, minor, latest, unversioned) get 24h TTL.
 */
export function getTtlMs(featureId: string): number | null {
  if (SEMVER_EXACT.test(featureId)) return null; // permanent
  if (DIGEST_REF.test(featureId)) return null; // permanent
  return TTL_24H_MS; // floating: 24h
}

function readFsCache(
  featureId: string,
  cacheDir: string,
  options: ReadFsCacheOptions = {},
): FeatureMetadata | null {
  const { skipFloating = false } = options;
  const filePath = cacheKeyToFilePath(featureId, cacheDir);
  if (!existsSync(filePath)) return null;

  let entry: CacheEntry;
  try {
    entry = JSON.parse(readFileSync(filePath, "utf-8")) as CacheEntry;
  } catch {
    // Corrupted cache file -- treat as miss, will be overwritten on next fetch
    return null;
  }

  // When skipFloating is true (--no-cache), only permanent entries are used.
  // Floating tags (non-null TTL) are treated as cache misses.
  if (skipFloating && entry._cache.ttlMs !== null) {
    return null;
  }

  // Check TTL for floating tags
  if (entry._cache.ttlMs !== null) {
    const age = Date.now() - new Date(entry._cache.fetchedAt).getTime();
    if (age > entry._cache.ttlMs) return null; // expired
  }

  return entry.metadata;
}

function writeFsCache(
  featureId: string,
  metadata: FeatureMetadata,
  cacheDir: string,
): void {
  mkdirSync(cacheDir, { recursive: true });

  const entry: CacheEntry = {
    metadata,
    _cache: {
      featureId,
      fetchedAt: new Date().toISOString(),
      ttlMs: getTtlMs(featureId),
    },
  };

  writeFileSync(
    cacheKeyToFilePath(featureId, cacheDir),
    JSON.stringify(entry, null, 2),
    "utf-8",
  );
}

// ── Internal: Local-path detection ──

export function isLocalPath(featureId: string): boolean {
  return (
    featureId.startsWith("./") ||
    featureId.startsWith("../") ||
    featureId.startsWith("/")
  );
}

// ── Internal: Sentinel for annotation-missing fallback ──

/**
 * Internal sentinel error thrown by fetchFromRegistry() when the OCI manifest
 * is fetched successfully but lacks the dev.containers.metadata annotation.
 * Caught by fetchFeatureMetadata() to trigger async blob fallback.
 * Not exported -- external callers see MetadataFetchError or success.
 */
class AnnotationMissingError extends Error {
  constructor(
    public readonly featureId: string,
    public readonly manifest: OciManifest,
  ) {
    super(`Annotation missing for ${featureId}`);
  }
}

// ── Internal: OCI fetch ──

function fetchFromRegistry(
  featureId: string,
  subprocess: RunSubprocess = defaultRunSubprocess,
): FeatureMetadata {
  const result = subprocess("devcontainer", [
    "features",
    "info",
    "manifest",
    featureId,
    "--output-format",
    "json",
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

  // The devcontainer CLI wraps the manifest under a "manifest" key in its JSON output.
  // Check both the top-level and nested locations for the annotations.
  const metadataStr =
    manifest.manifest?.annotations?.["dev.containers.metadata"] ??
    manifest.annotations?.["dev.containers.metadata"];
  if (!metadataStr) {
    // Annotation missing -- signal the async caller to attempt blob fallback.
    // This is a normal condition for features published before CLI v0.39.0.
    throw new AnnotationMissingError(featureId, manifest);
  }

  let metadata: FeatureMetadata;
  try {
    metadata = JSON.parse(metadataStr) as FeatureMetadata;
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `dev.containers.metadata annotation is not valid JSON: ${(e as Error).message}`,
      "annotation_invalid",
    );
  }

  return metadata;
}

// ── Internal: Local-path fetch ──

function fetchFromLocalPath(featureId: string): FeatureMetadata {
  const metadataPath = join(featureId, "devcontainer-feature.json");

  if (!existsSync(metadataPath)) {
    throw new MetadataFetchError(
      featureId,
      `devcontainer-feature.json not found at ${metadataPath}`,
      "fetch_failed",
    );
  }

  let raw: string;
  try {
    raw = readFileSync(metadataPath, "utf-8");
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `Failed to read ${metadataPath}: ${(e as Error).message}`,
      "fetch_failed",
      e as Error,
    );
  }

  try {
    return JSON.parse(raw) as FeatureMetadata;
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `${metadataPath} contains invalid JSON: ${(e as Error).message}`,
      "fetch_failed",
      e as Error,
    );
  }
}

// ── Exports ──

/**
 * Fetch metadata for a single feature.
 * THROWS MetadataFetchError on failure unless skipValidation is set.
 * Returns null ONLY when skipValidation is true and fetch fails.
 */
export async function fetchFeatureMetadata(
  featureId: string,
  options: FetchOptions = {},
): Promise<FeatureMetadata | null> {
  const {
    noCache = false,
    skipValidation = false,
    subprocess,
    cacheDir = DEFAULT_CACHE_DIR,
  } = options;

  // 1. Check in-memory cache
  const cached = memoryCache.get(featureId);
  if (cached) return cached;

  // 2. Check filesystem cache (unless local-path)
  // When noCache is true, only pinned (permanent) cache entries are used.
  // Floating tags are bypassed.
  if (!isLocalPath(featureId)) {
    const fsCached = readFsCache(featureId, cacheDir, {
      skipFloating: noCache,
    });
    if (fsCached) {
      memoryCache.set(featureId, fsCached);
      return fsCached;
    }
  }

  // 3. Fetch from source
  try {
    const metadata = isLocalPath(featureId)
      ? fetchFromLocalPath(featureId)
      : fetchFromRegistry(featureId, subprocess);

    // 4. Populate caches
    memoryCache.set(featureId, metadata);
    if (!isLocalPath(featureId)) {
      writeFsCache(featureId, metadata, cacheDir);
    }

    return metadata;
  } catch (e) {
    // Annotation missing: attempt blob fallback (async)
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

/**
 * Fetch metadata for multiple features in parallel.
 * THROWS MetadataFetchError on any failure unless skipValidation is set.
 * Map entries are null ONLY when skipValidation is true and individual fetch fails.
 */
export async function fetchAllFeatureMetadata(
  featureIds: string[],
  options: FetchOptions = {},
): Promise<Map<string, FeatureMetadata | null>> {
  // Deduplicate feature IDs
  const unique = [...new Set(featureIds)];

  const entries = await Promise.all(
    unique.map(async (id) => {
      const metadata = await fetchFeatureMetadata(id, options);
      return [id, metadata] as const;
    }),
  );

  return new Map(entries);
}

/**
 * Clear both in-memory and filesystem caches.
 * If cacheDir is provided, deletes that directory; otherwise deletes the default.
 */
export function clearMetadataCache(cacheDir?: string): void {
  memoryCache.clear();
  const dir = cacheDir ?? DEFAULT_CACHE_DIR;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore errors -- cache directory may not exist
  }
}

/** Validate that provided option names exist in the feature's schema. */
export function validateFeatureOptions(
  featureId: string,
  providedOptions: Record<string, unknown>,
  metadata: FeatureMetadata,
): ValidationResult {
  const errors: ValidationError[] = [];
  const schemaKeys = new Set(Object.keys(metadata.options ?? {}));

  for (const key of Object.keys(providedOptions)) {
    if (!schemaKeys.has(key)) {
      errors.push({
        kind: "unknown_option",
        message:
          `Option "${key}" is not declared in the schema for feature "${featureId}". ` +
          `Available options: ${[...schemaKeys].join(", ") || "(none)"}`,
        optionName: key,
        featureId,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that customizations.lace.ports keys match actual option names
 * in the feature's schema. Per v2 convention, port keys use the
 * featureId/optionName pattern, and the optionName must exist in options.
 */
export function validatePortDeclarations(
  metadata: FeatureMetadata,
): ValidationResult {
  const errors: ValidationError[] = [];
  const lace = extractLaceCustomizations(metadata);
  if (!lace?.ports) return { valid: true, errors: [] };

  const schemaKeys = new Set(Object.keys(metadata.options ?? {}));

  for (const portKey of Object.keys(lace.ports)) {
    if (!schemaKeys.has(portKey)) {
      errors.push({
        kind: "port_key_mismatch",
        message:
          `customizations.lace.ports key "${portKey}" does not match any option ` +
          `in feature "${metadata.id}". Port keys must correspond to option names ` +
          `(per the featureId/optionName convention). ` +
          `Available options: ${[...schemaKeys].join(", ") || "(none)"}`,
        optionName: portKey,
        featureId: metadata.id,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract customizations.lace from feature metadata (runtime type narrowing).
 * Returns null if no customizations or no customizations.lace exists.
 * Returns { ports: undefined } if customizations.lace exists but has no ports.
 * Callers should check for both null and missing ports.
 */
export function extractLaceCustomizations(
  metadata: FeatureMetadata,
): LaceCustomizations | null {
  const customizations = metadata.customizations;
  if (!customizations || typeof customizations !== "object") return null;

  const lace = (customizations as Record<string, unknown>).lace;
  if (!lace || typeof lace !== "object") return null;

  const laceObj = lace as Record<string, unknown>;
  const ports = laceObj.ports;

  if (!ports || typeof ports !== "object") {
    // No ports declared -- valid, just no enrichment
    return { ports: undefined };
  }

  // Validate each port entry shape
  const validatedPorts: Record<string, LacePortDeclaration> = {};
  for (const [key, value] of Object.entries(
    ports as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    validatedPorts[key] = {
      label: typeof entry.label === "string" ? entry.label : undefined,
      onAutoForward: isValidAutoForward(entry.onAutoForward)
        ? entry.onAutoForward
        : undefined,
      requireLocalPort:
        typeof entry.requireLocalPort === "boolean"
          ? entry.requireLocalPort
          : undefined,
      protocol: isValidProtocol(entry.protocol) ? entry.protocol : undefined,
    };
  }

  return { ports: validatedPorts };
}

// ── Internal: Type guards ──

function isValidAutoForward(
  v: unknown,
): v is LacePortDeclaration["onAutoForward"] {
  return (
    typeof v === "string" &&
    ["silent", "notify", "openBrowser", "openPreview", "ignore"].includes(v)
  );
}

function isValidProtocol(v: unknown): v is LacePortDeclaration["protocol"] {
  return typeof v === "string" && ["http", "https"].includes(v);
}
