// IMPLEMENTATION_VALIDATION
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RunSubprocess } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";

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
}

/** Error thrown when metadata cannot be fetched and skipValidation is false. */
export class MetadataFetchError extends Error {
  constructor(
    public readonly featureId: string,
    public readonly reason: string,
    public readonly cause?: Error,
  ) {
    super(
      `Failed to fetch metadata for feature "${featureId}": ${reason}. ` +
        `This indicates a problem with your build environment (network, auth, or registry). ` +
        `Use --skip-metadata-validation to bypass this check.`,
    );
    this.name = "MetadataFetchError";
  }
}

// ── Internal: OCI manifest shape ──

/** Shape of the OCI manifest JSON returned by the devcontainer CLI. */
interface OciManifest {
  annotations?: Record<string, string>;
}

// ── Internal: In-memory cache ──

const memoryCache = new Map<string, FeatureMetadata>();

// ── Internal: Local-path detection ──

export function isLocalPath(featureId: string): boolean {
  return (
    featureId.startsWith("./") ||
    featureId.startsWith("../") ||
    featureId.startsWith("/")
  );
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
    );
  }

  let manifest: OciManifest;
  try {
    manifest = JSON.parse(result.stdout) as OciManifest;
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `CLI returned invalid JSON: ${(e as Error).message}`,
    );
  }

  const metadataStr = manifest.annotations?.["dev.containers.metadata"];
  if (!metadataStr) {
    throw new MetadataFetchError(
      featureId,
      "OCI manifest missing dev.containers.metadata annotation",
    );
  }

  let metadata: FeatureMetadata;
  try {
    metadata = JSON.parse(metadataStr) as FeatureMetadata;
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `dev.containers.metadata annotation is not valid JSON: ${(e as Error).message}`,
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
    );
  }

  let raw: string;
  try {
    raw = readFileSync(metadataPath, "utf-8");
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `Failed to read ${metadataPath}: ${(e as Error).message}`,
      e as Error,
    );
  }

  try {
    return JSON.parse(raw) as FeatureMetadata;
  } catch (e) {
    throw new MetadataFetchError(
      featureId,
      `${metadataPath} contains invalid JSON: ${(e as Error).message}`,
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
  const { skipValidation = false, subprocess } = options;

  // 1. Check in-memory cache
  const cached = memoryCache.get(featureId);
  if (cached) return cached;

  // 2. Fetch from source
  try {
    const metadata = isLocalPath(featureId)
      ? fetchFromLocalPath(featureId)
      : fetchFromRegistry(featureId, subprocess);

    // 3. Populate in-memory cache
    memoryCache.set(featureId, metadata);

    return metadata;
  } catch (e) {
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

/** Clear the in-memory metadata cache. */
export function clearMetadataCache(): void {
  memoryCache.clear();
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
