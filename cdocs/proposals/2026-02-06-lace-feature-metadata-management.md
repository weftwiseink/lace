---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T19:30:00-08:00
type: proposal
state: live
status: review_ready
tags: [features, metadata, oci, caching, validation, devcontainer-spec]
references:
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md
  - cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-06T22:30:00-08:00
  round: 2
revisions:
  - at: 2026-02-06T19:50:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "R1 blocking fix: replaced ambiguous double-dash cache key escaping with percent-encoding scheme"
      - "R1 blocking fix: added FetchOptions parameter to fetchFeatureMetadata() and fetchAllFeatureMetadata() for noCache flag threading"
      - "R1 non-blocking: clarified objective wording to distinguish port label validation from option name validation"
      - "R1 non-blocking: specified that callers must resolve relative local-path feature IDs to absolute paths before calling fetchFeatureMetadata()"
      - "R1 non-blocking: added edge case for feature IDs with no version tag (implicit :latest)"
      - "R1 non-blocking: noted that extractLaceCustomizations() performs runtime type narrowing, not type casting"
  - at: 2026-02-06T22:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "User feedback: changed semantics from best-effort/warn to required/error -- metadata fetch failures are build errors, not warnings"
      - "User feedback: added --skip-metadata-validation flag as the only escape hatch for offline/emergency use"
      - "User feedback: fixed port label naming to match v2 convention (featureId/optionName) -- ports keys must match actual option names in the feature schema"
      - "User feedback: added validation that customizations.lace.ports keys correspond to options with port semantics"
      - "User feedback: added detailed TypeScript code drafts for all key functions"
      - "User feedback: added concrete module structure with function signatures, types, and data flow"
      - "User feedback: replaced bullet-point test plan with concrete test scenarios including expected inputs/outputs"
      - "User feedback: added cache implementation details -- file format, key generation, TTL checking logic"
      - "User feedback: added error handling specifics -- error types, messages, surfacing strategy"
  - at: 2026-02-06T22:30:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "R2 blocking fix: readFsCache() now accepts skipFloating flag so --no-cache bypasses floating tags but preserves permanent (pinned) cache entries"
      - "R2 non-blocking: removed unused 'missing_port_option' from ValidationError kind union type"
      - "R2 non-blocking: documented null vs { ports: undefined } distinction in extractLaceCustomizations() JSDoc"
      - "R2 non-blocking: noted that extractFeatureIdsFromConfig() and getUserProvidedOptions() are external helpers in integration code sketch"
      - "R2 non-blocking: added test scenario 12a for customizations.lace exists without ports key"
---

# Devcontainer Feature Metadata Management

> **BLUF:** Lace needs a feature metadata module that retrieves, caches, and exposes `devcontainer-feature.json` content for features declared in `features`. This module uses `devcontainer features info manifest` for OCI-published features and direct filesystem reads for local-path features, with a two-tier cache (in-memory per-run, filesystem for pinned versions) and **strict error semantics** -- metadata fetch failures are build errors that abort `lace up`, because a failed fetch means the build environment (network, auth, registry) is broken. The only escape hatch is `--skip-metadata-validation` for offline/emergency use.

## Objective

Provide a reusable `feature-metadata.ts` module that other lace subsystems depend on for: (1) reading `customizations.lace.ports` declarations from feature metadata to generate enriched `portsAttributes`, (2) validating that `${lace.port(featureId/optionName)}` labels match feature-declared `customizations.lace.ports` entries whose keys correspond to actual option names in the feature schema, and (3) validating that option names provided in feature options exist in the feature's declared option schema.

## Background

The [manifest fetching report](../reports/2026-02-06-feature-manifest-fetching-options.md) evaluated five approaches to retrieving feature metadata and recommended `devcontainer features info manifest --output-format json` as the primary mechanism. The [plugin architecture analysis](../reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md) established that devcontainer features are the behavioral extensibility unit, with lace's role limited to host-side orchestration including template variable resolution and metadata-aware validation.

The [feature awareness v2 proposal](./2026-02-06-lace-feature-awareness-v2.md) depends on metadata for two purposes that cannot be achieved without it: reading feature-declared `customizations.lace.ports` (so lace knows what label, `onAutoForward`, and other attributes to apply to auto-generated `portsAttributes` entries), and validating that user-provided option names actually exist in the feature's option schema. The v2 proposal establishes the port label convention `featureId/optionName`, where the option name must be descriptive (e.g., `sshPort`, not `port`) and must match an actual option in the feature's schema.

The devcontainer feature spec stores the full `devcontainer-feature.json` as the `dev.containers.metadata` annotation on the OCI manifest. This means metadata is available without downloading the feature tarball -- a single CLI call retrieves it in under a second.

## Proposed Solution

### Module: `packages/lace/src/lib/feature-metadata.ts`

A single module with six exports:

```typescript
import type { RunSubprocess } from "./subprocess";

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
  onAutoForward?: "silent" | "notify" | "openBrowser" | "openPreview" | "ignore";
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
      `Use --skip-metadata-validation to bypass this check.`
    );
    this.name = "MetadataFetchError";
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
  options?: FetchOptions
): Promise<FeatureMetadata | null>;

/**
 * Fetch metadata for multiple features in parallel.
 * THROWS MetadataFetchError on any failure unless skipValidation is set.
 * Map entries are null ONLY when skipValidation is true and individual fetch fails.
 */
export async function fetchAllFeatureMetadata(
  featureIds: string[],
  options?: FetchOptions
): Promise<Map<string, FeatureMetadata | null>>;

/** Clear both in-memory and filesystem caches. */
export function clearMetadataCache(): void;

/** Validate that provided option names exist in the feature's schema. */
export function validateFeatureOptions(
  featureId: string,
  providedOptions: Record<string, unknown>,
  metadata: FeatureMetadata
): ValidationResult;

/**
 * Validate that customizations.lace.ports keys match actual option names
 * in the feature's schema. Per v2 convention, port keys use the
 * featureId/optionName pattern, and the optionName must exist in options.
 */
export function validatePortDeclarations(
  metadata: FeatureMetadata
): ValidationResult;

/**
 * Extract customizations.lace from feature metadata (runtime type narrowing).
 * Returns null if no customizations or no customizations.lace exists.
 * Returns { ports: undefined } if customizations.lace exists but has no ports.
 * Callers should check for both null and missing ports.
 */
export function extractLaceCustomizations(
  metadata: FeatureMetadata
): LaceCustomizations | null;
```

### Retrieval: OCI-published features

For features identified by registry path (e.g., `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`), the module spawns:

```
devcontainer features info manifest <featureId> --output-format json
```

This returns the OCI manifest as JSON. The `dev.containers.metadata` annotation contains the full `devcontainer-feature.json` as a JSON string. The module parses this annotation into a `FeatureMetadata` object.

The devcontainer CLI handles all registry authentication automatically via the Docker credential store, supporting ghcr.io, Docker Hub, ACR, ECR, and any OCI-compliant registry.

**Code draft -- OCI fetch logic:**

```typescript
import type { RunSubprocess } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";

/** Shape of the OCI manifest JSON returned by the devcontainer CLI. */
interface OciManifest {
  annotations?: Record<string, string>;
  // Other fields exist but we only need annotations
}

function fetchFromRegistry(
  featureId: string,
  subprocess: RunSubprocess = defaultRunSubprocess,
): FeatureMetadata {
  const result = subprocess("devcontainer", [
    "features", "info", "manifest",
    featureId,
    "--output-format", "json",
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
```

### Retrieval: local-path features

Features referenced as `./path`, `../path`, or absolute paths are read directly from the filesystem. The module reads `devcontainer-feature.json` from the referenced directory. No network call, no caching needed.

Detection rule: if the feature ID starts with `./`, `../`, or `/`, treat it as a local path. Callers must resolve relative paths to absolute paths (relative to the devcontainer.json's directory) before calling `fetchFeatureMetadata()`. This keeps the module's API simple -- it receives either a registry feature ID or an absolute local path, never a relative path it cannot resolve without external context.

**Code draft -- local-path fetch logic:**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function isLocalPath(featureId: string): boolean {
  return featureId.startsWith("./")
    || featureId.startsWith("../")
    || featureId.startsWith("/");
}

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
```

### Error semantics: fail-fast, not best-effort

**If metadata cannot be fetched, the build environment is broken.** The devcontainer CLI will need network and auth to pull the feature itself during `devcontainer up`. If `devcontainer features info manifest` fails, the subsequent `devcontainer up` is highly likely to fail too -- and it will fail with a less helpful error message deep in the Docker build. Lace surfaces the real problem early.

The degradation path:

1. **Fetch succeeds:** Full validation and enriched `portsAttributes` generation.
2. **Fetch fails (network error, CLI error, auth failure):** `MetadataFetchError` thrown. `lace up` aborts with a clear message naming the feature, the error, and suggesting `--skip-metadata-validation` if the user knows what they are doing.
3. **Offline with cache hit:** Cached metadata used. No degradation.
4. **Offline with cache miss:** `MetadataFetchError` thrown. Same as fetch failure.
5. **`--skip-metadata-validation` flag set:** Fetch is attempted. On failure, null is returned instead of throwing. Port attributes fall back to defaults. Option validation skipped. Warning logged.

The `--skip-metadata-validation` flag is the ONLY escape hatch. It exists for:
- Offline development with an empty cache
- Emergency deployments when a registry is temporarily down
- CI environments that pre-populate containers but do not need metadata validation

**Code draft -- fetchFeatureMetadata orchestration:**

```typescript
// In-memory cache: populated per-run, discarded on exit.
const memoryCache = new Map<string, FeatureMetadata>();

export async function fetchFeatureMetadata(
  featureId: string,
  options: FetchOptions = {},
): Promise<FeatureMetadata | null> {
  const { noCache = false, skipValidation = false, subprocess } = options;

  // 1. Check in-memory cache
  const cached = memoryCache.get(featureId);
  if (cached) return cached;

  // 2. Check filesystem cache (unless local-path)
  // When noCache is true, only pinned (permanent) cache entries are used.
  // Floating tags are bypassed.
  if (!isLocalPath(featureId)) {
    const fsCached = readFsCache(featureId, { skipFloating: noCache });
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
      writeFsCache(featureId, metadata);
    }

    return metadata;
  } catch (e) {
    if (e instanceof MetadataFetchError) {
      if (skipValidation) {
        console.warn(`[lace] WARNING: ${e.message} (continuing due to --skip-metadata-validation)`);
        return null;
      }
      throw e;
    }
    throw e;
  }
}

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
```

### Caching

**Tier 1: In-memory (per `lace up` run).** A `Map<string, FeatureMetadata>` populated during the first fetch for each feature ID. Prevents duplicate subprocess spawns when the same feature is referenced multiple times. Discarded when the process exits.

**Tier 2: Filesystem (across runs).** Location: `~/.config/lace/cache/features/<escaped-feature-id>.json`.

| Version format | Cache behavior |
|---------------|---------------|
| `:1.2.3` (exact semver) | Permanent -- OCI content is immutable at exact versions |
| `:1.2` (minor float) | 24h TTL |
| `:1` (major float) | 24h TTL |
| `:latest` | 24h TTL |
| `@sha256:abc...` (digest) | Permanent |
| `./local/path` | Never cached -- always read from disk |

The `noCache` option on `FetchOptions` (threaded from `lace up --no-cache`) forces cache bypass for floating tags. Pinned version caches are not affected by `noCache` since their content is immutable.

**Cache file format:**

```typescript
interface CacheEntry {
  /** The feature metadata itself. */
  metadata: FeatureMetadata;
  /** Cache bookkeeping, not part of the feature metadata. */
  _cache: {
    /** The feature ID as provided (e.g., "ghcr.io/org/features/foo:1"). */
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
```

**Cache key generation (percent-encoding):**

```typescript
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".config", "lace", "cache", "features");

function featureIdToCacheKey(featureId: string): string {
  // Percent-encode characters that are invalid in filenames.
  // '/' -> '%2F', ':' -> '%3A', '%' -> '%25' (encode % first to avoid double-encoding)
  return featureId
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/:/g, "%3A");
}

function cacheKeyToFilePath(featureId: string): string {
  return join(CACHE_DIR, `${featureIdToCacheKey(featureId)}.json`);
}

// Example:
// "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
// -> "ghcr.io%2Fweftwiseink%2Fdevcontainer-features%2Fwezterm-server%3A1.json"
```

**TTL determination:**

```typescript
const SEMVER_EXACT = /^.*:\d+\.\d+\.\d+$/;       // :1.2.3
const DIGEST_REF = /^.*@sha256:[a-f0-9]{64}$/;    // @sha256:abc...

const TTL_24H_MS = 24 * 60 * 60 * 1000;

function getTtlMs(featureId: string): number | null {
  if (SEMVER_EXACT.test(featureId)) return null;   // permanent
  if (DIGEST_REF.test(featureId)) return null;      // permanent
  return TTL_24H_MS;                                // floating: 24h
}
```

**Cache read with TTL check:**

```typescript
import { readFileSync, existsSync } from "node:fs";

interface ReadFsCacheOptions {
  /** When true, skip entries with non-null TTL (floating tags). Default: false. */
  skipFloating?: boolean;
}

function readFsCache(
  featureId: string,
  options: ReadFsCacheOptions = {},
): FeatureMetadata | null {
  const { skipFloating = false } = options;
  const path = cacheKeyToFilePath(featureId);
  if (!existsSync(path)) return null;

  let entry: CacheEntry;
  try {
    entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry;
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
```

**Cache write:**

```typescript
import { writeFileSync, mkdirSync } from "node:fs";

function writeFsCache(featureId: string, metadata: FeatureMetadata): void {
  mkdirSync(CACHE_DIR, { recursive: true });

  const entry: CacheEntry = {
    metadata,
    _cache: {
      featureId,
      fetchedAt: new Date().toISOString(),
      ttlMs: getTtlMs(featureId),
    },
  };

  writeFileSync(cacheKeyToFilePath(featureId), JSON.stringify(entry, null, 2), "utf-8");
}
```

### Validation: option names

`validateFeatureOptions()` compares the keys of user-provided options against the keys of the feature's `options` schema. Unknown option names produce `ValidationError` entries with `kind: "unknown_option"`. The function returns a `ValidationResult` -- it does not throw. The caller decides whether to error or warn based on context.

**Code draft:**

```typescript
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
        message: `Option "${key}" is not declared in the schema for feature "${featureId}". ` +
          `Available options: ${[...schemaKeys].join(", ") || "(none)"}`,
        optionName: key,
        featureId,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### Validation: port declaration keys match option names

Per the [v2 feature awareness convention](./2026-02-06-lace-feature-awareness-v2.md), `customizations.lace.ports` keys in a feature's `devcontainer-feature.json` must correspond to actual option names in that feature's `options` schema. This is because the port label convention is `featureId/optionName`, and the option name in the `ports` declaration is the same `optionName` used in template expressions like `${lace.port(wezterm-server/sshPort)}`.

If a feature declares `customizations.lace.ports.sshPort` but has no option named `sshPort`, that is a metadata authoring error. `validatePortDeclarations()` catches this.

**Code draft:**

```typescript
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
        message: `customizations.lace.ports key "${portKey}" does not match any option ` +
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
```

### `customizations.lace.ports` extraction

`extractLaceCustomizations()` navigates the metadata's `customizations.lace` object and returns a typed `LaceCustomizations` with the `ports` map. The function performs runtime type narrowing -- it validates that `customizations` is an object, that `customizations.lace` is an object, and that `customizations.lace.ports` (if present) contains objects with the expected shape. Returns null if the path does not exist, is the wrong type, or is malformed.

Example feature metadata containing `customizations.lace.ports`, using the correct v2 convention where the port key matches the option name:

```jsonc
{
  "id": "wezterm-server",
  "version": "1.0.0",
  "options": {
    "sshPort": {
      "type": "string",
      "default": "2222",
      "description": "SSH port for wezterm mux server"
    }
  },
  "customizations": {
    "lace": {
      "ports": {
        "sshPort": {
          "label": "wezterm ssh",
          "onAutoForward": "silent"
        }
      }
    }
  }
}
```

The port key `sshPort` matches the option name `sshPort`. When used in a template expression, this becomes `${lace.port(wezterm-server/sshPort)}`, and lace generates `portsAttributes` using the declared label `"wezterm ssh"`.

**WRONG example (violates v2 convention):**

```jsonc
// DON'T DO THIS -- port key "ssh" does not match option name "port"
{
  "options": { "port": { "type": "string", "default": "2222" } },
  "customizations": {
    "lace": {
      "ports": {
        "ssh": { "label": "wezterm ssh" }  // WRONG: key should be "port" or option should be "sshPort"
      }
    }
  }
}
```

**Code draft -- extraction with type narrowing:**

```typescript
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
  for (const [key, value] of Object.entries(ports as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    validatedPorts[key] = {
      label: typeof entry.label === "string" ? entry.label : undefined,
      onAutoForward: isValidAutoForward(entry.onAutoForward) ? entry.onAutoForward : undefined,
      requireLocalPort: typeof entry.requireLocalPort === "boolean" ? entry.requireLocalPort : undefined,
      protocol: isValidProtocol(entry.protocol) ? entry.protocol : undefined,
    };
  }

  return { ports: validatedPorts };
}

function isValidAutoForward(v: unknown): v is LacePortDeclaration["onAutoForward"] {
  return typeof v === "string" && ["silent", "notify", "openBrowser", "openPreview", "ignore"].includes(v);
}

function isValidProtocol(v: unknown): v is LacePortDeclaration["protocol"] {
  return typeof v === "string" && ["http", "https"].includes(v);
}
```

### Parallelization

`fetchAllFeatureMetadata()` spawns all CLI subprocess calls concurrently via `Promise.all()`. With 3-5 features, total wall time is ~1s regardless of count (bound by the slowest single fetch). The in-memory cache deduplicates if the same feature ID appears multiple times in the input array.

### Integration with `lace up`

The metadata module integrates into the `lace up` pipeline as follows:

```typescript
// In up.ts, after reading devcontainer.json and before template resolution.
// NOTE: extractFeatureIdsFromConfig() and getUserProvidedOptions() are helpers
// defined outside this module (in template-resolver.ts or devcontainer.ts).

// 1. Collect feature IDs that use ${lace.*} templates
const featureIds = extractFeatureIdsFromConfig(config);

// 2. Fetch all metadata (errors abort unless --skip-metadata-validation)
const metadataMap = await fetchAllFeatureMetadata(featureIds, {
  noCache: cliFlags.noCache,
  skipValidation: cliFlags.skipMetadataValidation,
  subprocess,
});

// 3. Validate each feature's options and port declarations
for (const [featureId, metadata] of metadataMap) {
  if (!metadata) continue; // null only when skipValidation=true

  // Validate user-provided options exist in schema
  const optionResult = validateFeatureOptions(
    featureId,
    getUserProvidedOptions(config, featureId),
    metadata,
  );
  if (!optionResult.valid) {
    // Option validation errors abort lace up
    throw new Error(
      `Feature "${featureId}" has invalid options:\n` +
      optionResult.errors.map(e => `  - ${e.message}`).join("\n"),
    );
  }

  // Validate port declaration keys match option names
  const portResult = validatePortDeclarations(metadata);
  if (!portResult.valid) {
    throw new Error(
      `Feature "${featureId}" has invalid port declarations:\n` +
      portResult.errors.map(e => `  - ${e.message}`).join("\n"),
    );
  }
}

// 4. Proceed to template resolution with metadata available for port enrichment
```

## Design Decisions

### Decision: `devcontainer features info manifest` over direct OCI HTTP API

The CLI adds ~200ms subprocess overhead compared to direct HTTP, but handles all registry auth automatically. Reimplementing auth for ghcr.io, Docker Hub, ACR, ECR, and private registries with `docker-credential-*` helpers is significant complexity for marginal performance gain. See the [manifest fetching report](../reports/2026-02-06-feature-manifest-fetching-options.md) for the full options analysis.

### Decision: Two-tier cache with permanent storage for pinned versions

Pinned versions (`1.2.3`, `@sha256:...`) are immutable in OCI registries. Caching them permanently avoids unnecessary network calls for the common case of locked feature versions. Floating tags get a 24h TTL as a balance between freshness and avoiding fetches on every `lace up`.

### Decision: Metadata fetch failures are errors, not warnings

If the devcontainer CLI cannot retrieve a feature's manifest, the build environment has a problem: network connectivity, registry authentication, or a misconfigured feature reference. The same problem will cause `devcontainer up` to fail later when it tries to pull the feature layer -- but with a less helpful error message buried in Docker build output. Failing early at the metadata stage gives the user a clear, actionable error that names the feature and the root cause.

The alternative (best-effort with warnings) was rejected because it silently degrades validation and port attribute enrichment, producing a container that may work but with wrong port labels, missing auto-forward settings, or undetected typos in option names. Users who need to bypass metadata validation for legitimate reasons (offline, registry outage) can use `--skip-metadata-validation` explicitly.

### Decision: Port declaration keys must match option names (v2 convention)

The v2 feature awareness proposal establishes that port labels follow the `featureId/optionName` pattern. For this to work, `customizations.lace.ports` keys in the feature's metadata must be the same option names that appear in the `options` schema. This is validated by `validatePortDeclarations()`. A mismatch (e.g., key is `ssh` but the option is `sshPort`) is an error in the feature's metadata authoring, not a lace user error, and should be caught early.

### Decision: Local-path features bypass caching entirely

Local features are read from disk on every invocation. They change during development, and filesystem reads are sub-millisecond. Caching would add staleness risk with no performance benefit.

### Decision: `extractLaceCustomizations()` as a separate function rather than baked into `fetchFeatureMetadata()`

Keeps the fetch function generic -- it returns the full `FeatureMetadata` object. Callers that need lace-specific customizations call `extractLaceCustomizations()` explicitly. This separation makes the module useful for future consumers that may need other parts of the metadata (option schemas, dependency info) without lace-specific coupling.

### Decision: Cache location in `~/.config/lace/cache/features/` rather than per-project `.lace/`

Feature metadata is not project-specific. The same feature at the same version returns the same metadata regardless of which project references it. A shared user-level cache avoids redundant fetches across projects.

## Edge Cases

### Feature ID with non-URL-safe characters

Feature IDs like `ghcr.io/org/features/my-feature:1.2.3` contain `/` and `:` which are invalid in filenames. The filesystem cache key uses percent-encoding for these characters: `/` becomes `%2F`, `:` becomes `%3A`, and `%` itself becomes `%25`. Example: `ghcr.io/org/features/my-feature:1.2.3` becomes `ghcr.io%2Forg%2Ffeatures%2Fmy-feature%3A1.2.3.json`. This encoding is reversible and unambiguous -- feature IDs containing literal hyphens (common) are preserved without collision.

### Feature ID with no version tag

A feature ID without a `:` or `@` suffix (e.g., `ghcr.io/org/features/my-feature`) is equivalent to `:latest` in OCI semantics. For caching purposes, it is treated identically to `:latest` -- 24h TTL, bypassed by `--no-cache`.

### CLI not installed or too old

If `devcontainer features info manifest` is not available (old CLI version), the subprocess exits non-zero. `MetadataFetchError` is thrown with a message suggesting the user update `@devcontainers/cli`. If `--skip-metadata-validation` is set, null is returned with a warning.

### Malformed metadata annotation

If `dev.containers.metadata` exists but is not valid JSON, `MetadataFetchError` is thrown naming the feature and including the parse error.

### Feature with no `options` declared

Valid. `validateFeatureOptions()` treats any user-provided options as unknown (since the schema is empty). This produces `ValidationError` entries with `kind: "unknown_option"`.

### Feature with no `customizations` declared

Valid. `extractLaceCustomizations()` returns null. The port allocator uses default attributes: label `"featureId/optionName (lace)"`, `onAutoForward: "silent"`, `requireLocalPort: true`.

### Race condition: parallel fetches for the same feature

The in-memory cache is checked before spawning a subprocess. If two calls for the same feature ID arrive concurrently before either completes, both spawn subprocesses. The second to resolve overwrites the first in the cache with identical data. This is harmless -- deduplication is best-effort for performance, not a correctness concern. `fetchAllFeatureMetadata()` deduplicates its input array to avoid this case.

### Floating tag resolves to a new version mid-session

Within a single `lace up` run, the in-memory cache ensures consistency -- the first fetch wins. Across runs, the 24h TTL means a tag update is picked up within a day. The `--no-cache` flag forces immediate refresh.

### Port declaration key does not match any option

`validatePortDeclarations()` catches this as a `port_key_mismatch` error. Example error message:

```
customizations.lace.ports key "ssh" does not match any option in feature "wezterm-server".
Port keys must correspond to option names (per the featureId/optionName convention).
Available options: sshPort
```

## Test Plan

### Unit: `feature-metadata.test.ts` -- OCI fetch

**Scenario 1: Successful metadata parsing from CLI output**

Input (mock subprocess returns):
```json
{
  "annotations": {
    "dev.containers.metadata": "{\"id\":\"wezterm-server\",\"version\":\"1.0.0\",\"options\":{\"sshPort\":{\"type\":\"string\",\"default\":\"2222\"}},\"customizations\":{\"lace\":{\"ports\":{\"sshPort\":{\"label\":\"wezterm ssh\",\"onAutoForward\":\"silent\"}}}}}"
  }
}
```

Expected output:
```typescript
{
  id: "wezterm-server",
  version: "1.0.0",
  options: { sshPort: { type: "string", default: "2222" } },
  customizations: {
    lace: { ports: { sshPort: { label: "wezterm ssh", onAutoForward: "silent" } } }
  }
}
```

Verify: subprocess called with `["features", "info", "manifest", "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1", "--output-format", "json"]`.

**Scenario 2: CLI exits non-zero (registry auth failure)**

Input: mock subprocess returns `{ exitCode: 1, stdout: "", stderr: "unauthorized: authentication required" }`.

Expected: `MetadataFetchError` thrown with message containing `"Failed to fetch metadata for feature"`, the feature ID, and `"unauthorized: authentication required"`.

**Scenario 3: CLI exits non-zero with --skip-metadata-validation**

Same input as Scenario 2, but `options.skipValidation = true`.

Expected: returns `null`, console.warn called with message containing `"--skip-metadata-validation"`.

**Scenario 4: CLI returns invalid JSON**

Input: mock subprocess returns `{ exitCode: 0, stdout: "not json", stderr: "" }`.

Expected: `MetadataFetchError` thrown with message containing `"CLI returned invalid JSON"`.

**Scenario 5: Missing dev.containers.metadata annotation**

Input: mock subprocess returns valid JSON but no `annotations` field: `{ "schemaVersion": 2 }`.

Expected: `MetadataFetchError` thrown with message containing `"missing dev.containers.metadata annotation"`.

**Scenario 6: Malformed metadata annotation JSON**

Input: mock subprocess returns `{ "annotations": { "dev.containers.metadata": "{invalid json" } }`.

Expected: `MetadataFetchError` thrown with message containing `"not valid JSON"`.

### Unit: `feature-metadata.test.ts` -- local-path fetch

**Scenario 7: Successful local-path read**

Setup: write a valid `devcontainer-feature.json` to a temp directory.

Input: `fetchFeatureMetadata("/tmp/test-feature")`.

Expected: returns parsed metadata matching the written file. No subprocess spawned.

**Scenario 8: Local-path -- file not found**

Input: `fetchFeatureMetadata("/tmp/nonexistent-feature")`.

Expected: `MetadataFetchError` thrown with message containing `"devcontainer-feature.json not found"`.

**Scenario 9: Local-path detection**

Verify `isLocalPath()` returns true for `./features/foo`, `../features/foo`, `/absolute/path` and false for `ghcr.io/org/feature:1`, `docker.io/library/feature:latest`.

### Unit: `feature-metadata.test.ts` -- extractLaceCustomizations

**Scenario 10: Extract ports from well-formed metadata**

Input metadata:
```typescript
{
  id: "wezterm-server", version: "1.0.0",
  options: { sshPort: { type: "string", default: "2222" } },
  customizations: {
    lace: { ports: { sshPort: { label: "wezterm ssh", onAutoForward: "silent" } } }
  }
}
```

Expected:
```typescript
{ ports: { sshPort: { label: "wezterm ssh", onAutoForward: "silent", requireLocalPort: undefined, protocol: undefined } } }
```

**Scenario 11: No customizations key**

Input metadata: `{ id: "foo", version: "1.0.0" }` (no `customizations` field).

Expected: returns `null`.

**Scenario 12: No customizations.lace key**

Input metadata: `{ id: "foo", version: "1.0.0", customizations: { vscode: {} } }`.

Expected: returns `null`.

**Scenario 12a: customizations.lace exists but no ports key**

Input metadata: `{ id: "foo", version: "1.0.0", customizations: { lace: { someOtherField: true } } }`.

Expected: returns `{ ports: undefined }` (NOT `null` -- the distinction is meaningful: `null` means no lace customizations at all, `{ ports: undefined }` means lace customizations exist but no ports declared).

**Scenario 13: Invalid onAutoForward value filtered out**

Input metadata with `onAutoForward: "bogus"` in a port entry.

Expected: port entry returned with `onAutoForward: undefined` (invalid value stripped during type narrowing).

### Unit: `feature-metadata.test.ts` -- validateFeatureOptions

**Scenario 14: All options valid**

Input: `providedOptions = { sshPort: "22430" }`, metadata has `options: { sshPort: { type: "string" } }`.

Expected: `{ valid: true, errors: [] }`.

**Scenario 15: Unknown option detected**

Input: `providedOptions = { sshPort: "22430", bogusOpt: "true" }`, metadata has `options: { sshPort: { type: "string" } }`.

Expected: `{ valid: false, errors: [{ kind: "unknown_option", message: "...bogusOpt...", optionName: "bogusOpt", featureId: "wezterm-server" }] }`.

**Scenario 16: Empty provided options**

Input: `providedOptions = {}`, metadata has `options: { sshPort: { type: "string" } }`.

Expected: `{ valid: true, errors: [] }`.

**Scenario 17: Feature has no options schema**

Input: `providedOptions = { anything: "value" }`, metadata has no `options` field.

Expected: `{ valid: false, errors: [{ kind: "unknown_option", optionName: "anything", ... }] }`.

### Unit: `feature-metadata.test.ts` -- validatePortDeclarations

**Scenario 18: Port key matches option name**

Input metadata: `{ id: "wezterm-server", options: { sshPort: { type: "string" } }, customizations: { lace: { ports: { sshPort: { label: "wezterm ssh" } } } } }`.

Expected: `{ valid: true, errors: [] }`.

**Scenario 19: Port key does NOT match any option (v2 violation)**

Input metadata: `{ id: "wezterm-server", options: { sshPort: { type: "string" } }, customizations: { lace: { ports: { ssh: { label: "wezterm ssh" } } } } }`.

Expected: `{ valid: false, errors: [{ kind: "port_key_mismatch", message: "...ssh...does not match any option...Available options: sshPort", optionName: "ssh", featureId: "wezterm-server" }] }`.

**Scenario 20: No port declarations**

Input metadata with no `customizations.lace.ports`.

Expected: `{ valid: true, errors: [] }`.

**Scenario 21: Multiple port keys, one mismatched**

Input metadata:
```typescript
{
  id: "multi-port-feature",
  options: { httpPort: { type: "string" }, debugPort: { type: "string" } },
  customizations: { lace: { ports: {
    httpPort: { label: "HTTP" },
    debug: { label: "Debug" }  // WRONG: should be "debugPort"
  }}}
}
```

Expected: one error for `debug` key, `httpPort` passes.

### Unit: `feature-metadata.test.ts` -- in-memory cache

**Scenario 22: Deduplication within a run**

Call `fetchFeatureMetadata("ghcr.io/org/feat:1")` twice. Mock subprocess.

Expected: subprocess called exactly once. Second call returns cached result.

**Scenario 23: clearMetadataCache resets in-memory cache**

Call `fetchFeatureMetadata(...)`, then `clearMetadataCache()`, then `fetchFeatureMetadata(...)` again.

Expected: subprocess called twice (cache was cleared between calls).

**Scenario 24: fetchAllFeatureMetadata deduplicates input**

Input: `["ghcr.io/org/feat:1", "ghcr.io/org/feat:1", "ghcr.io/org/other:2"]`.

Expected: subprocess called twice (once per unique ID), not three times.

### Unit: `feature-metadata.test.ts` -- filesystem cache

**Scenario 25: Pinned version writes permanent cache entry**

Call `fetchFeatureMetadata("ghcr.io/org/feat:1.2.3")` with successful mock.

Expected: cache file written to `~/.config/lace/cache/features/ghcr.io%2Forg%2Ffeat%3A1.2.3.json` with `_cache.ttlMs: null`.

**Scenario 26: Floating tag writes 24h TTL cache entry**

Call `fetchFeatureMetadata("ghcr.io/org/feat:1")` with successful mock.

Expected: cache file written with `_cache.ttlMs: 86400000`.

**Scenario 27: Cache hit for pinned version**

Pre-populate cache file for `ghcr.io/org/feat:1.2.3`, then call `fetchFeatureMetadata(...)`.

Expected: no subprocess spawned, returns cached metadata.

**Scenario 28: Cache hit within TTL for floating tag**

Pre-populate cache file with `fetchedAt` = 1 hour ago, `ttlMs` = 86400000.

Expected: cache hit, no subprocess spawned.

**Scenario 29: Cache miss -- expired TTL for floating tag**

Pre-populate cache file with `fetchedAt` = 25 hours ago, `ttlMs` = 86400000.

Expected: cache expired, subprocess spawned, cache file overwritten.

**Scenario 30: --no-cache bypasses filesystem cache for floating tags**

Pre-populate cache file for `ghcr.io/org/feat:1` (valid, not expired).

Call `fetchFeatureMetadata(...)` with `{ noCache: true }`.

Expected: subprocess spawned despite valid cache (floating tag). Cache overwritten.

**Scenario 31: --no-cache does NOT bypass permanent cache**

Pre-populate cache file for `ghcr.io/org/feat:1.2.3` (pinned).

Call with `{ noCache: true }`.

Expected: cache hit, no subprocess spawned (pinned versions are immutable, --no-cache only affects floating).

**Scenario 32: Cache directory auto-created**

Delete `~/.config/lace/cache/features/` directory. Call `fetchFeatureMetadata(...)`.

Expected: directory created, cache file written, no error.

**Scenario 33: Corrupted cache file treated as miss**

Write invalid JSON to a cache file path. Call `fetchFeatureMetadata(...)`.

Expected: cache miss, subprocess spawned, cache file overwritten with valid content.

**Scenario 34: Cache key escaping round-trip**

Verify that `featureIdToCacheKey("ghcr.io/org/feat%special:1.2.3")` produces `"ghcr.io%2Forg%2Ffeat%25special%3A1.2.3"` and that the resulting filename is valid.

### Integration (extends `up.integration.test.ts`)

**Scenario 35: Full pipeline with metadata -- portsAttributes enriched**

Setup: devcontainer.json with `${lace.port(wezterm-server/sshPort)}`, mock metadata returns `customizations.lace.ports.sshPort` with label `"wezterm ssh"`.

Expected: generated config has `portsAttributes` with the feature-declared label, not the default.

**Scenario 36: Full pipeline without metadata -- error aborts lace up**

Setup: mock subprocess for metadata fetch returns exit code 1.

Expected: `lace up` exits with non-zero, error message contains `"Failed to fetch metadata"` and `"--skip-metadata-validation"`.

**Scenario 37: Full pipeline with --skip-metadata-validation -- fallback to defaults**

Setup: mock subprocess returns exit code 1, `--skip-metadata-validation` flag set.

Expected: `lace up` succeeds, `portsAttributes` uses default label `"wezterm-server/sshPort (lace)"`, warning logged.

**Scenario 38: Unknown option name -- error aborts lace up**

Setup: devcontainer.json has `"bogusOpt": "value"` for a feature, metadata confirms `bogusOpt` is not in the schema.

Expected: `lace up` exits with non-zero, error message lists the unknown option and available options.

**Scenario 39: Port declaration key mismatch -- error aborts lace up**

Setup: feature metadata has `customizations.lace.ports.ssh` but option is named `sshPort`.

Expected: `lace up` exits with non-zero, error message explains the key must match the option name.

**Scenario 40: Offline with cache hit -- no degradation**

Setup: pre-populate filesystem cache, mock subprocess to fail.

Expected: cache hit, metadata used, no error thrown.

**Scenario 41: Offline with cache miss -- error (no --skip-metadata-validation)**

Setup: empty cache, mock subprocess to fail.

Expected: `MetadataFetchError` thrown, `lace up` aborts.

## Implementation Phases

### Phase 1: Core retrieval, validation, and in-memory cache

**New files:**
- `packages/lace/src/lib/feature-metadata.ts`
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

**Scope:**
- `FeatureMetadata`, `FeatureOption`, `ValidationResult`, `ValidationError`, `LacePortDeclaration`, `LaceCustomizations`, `FetchOptions`, `MetadataFetchError` types
- `fetchFeatureMetadata()` with subprocess spawning, JSON parsing, and strict error semantics
- `fetchAllFeatureMetadata()` with `Promise.all()` parallelization and input deduplication
- In-memory `Map` cache (no filesystem cache yet)
- Local-path feature detection via `isLocalPath()` and filesystem read
- `extractLaceCustomizations()` extraction with runtime type narrowing
- `validateFeatureOptions()` -- checks user-provided options against schema
- `validatePortDeclarations()` -- checks `customizations.lace.ports` keys match option names
- `clearMetadataCache()` for test isolation
- `--skip-metadata-validation` support via `FetchOptions.skipValidation`

**Success criteria:**
- All unit tests for scenarios 1-24 pass
- `MetadataFetchError` thrown on fetch failure (not null return)
- `MetadataFetchError` suppressed to null return + warning when `skipValidation` is true
- Port declaration keys validated against option names (v2 convention enforced)
- Local-path features read correctly from filesystem

### Phase 2: Filesystem cache

**Modified files:**
- `packages/lace/src/lib/feature-metadata.ts` -- add filesystem cache layer
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts` -- add cache tests

**Scope:**
- `CacheEntry` type with `_cache.featureId`, `_cache.fetchedAt`, `_cache.ttlMs`
- `featureIdToCacheKey()` percent-encoding function
- `readFsCache()` with TTL checking
- `writeFsCache()` with auto-directory creation
- `getTtlMs()` version format detection
- `--no-cache` flag support (bypasses floating tags, not pinned)
- `clearMetadataCache()` extended to delete filesystem cache directory

**Success criteria:**
- Scenarios 25-34 pass
- Pinned versions cached permanently, floating tags with 24h TTL
- Cache hits bypass subprocess spawning
- `--no-cache` forces fresh fetch for floating tags only
- Cache directory auto-created
- Corrupted cache files treated as misses

### Phase 3: Integration with `lace up` pipeline

**Modified files:**
- `packages/lace/src/lib/up.ts` -- call `fetchAllFeatureMetadata()` after config read, validate options and port declarations, pass `LaceCustomizations` to port attribute generation
- `packages/lace/src/commands/up.ts` -- add `--skip-metadata-validation` and `--no-cache` CLI flags

**Scope:**
- Wire metadata fetch into `lace up` pipeline before template resolution
- Validate all feature options and port declarations; abort on error
- Pass `customizations.lace.ports` attributes to `portsAttributes` generation
- Thread `--skip-metadata-validation` and `--no-cache` from CLI to `FetchOptions`
- Error messages include feature ID, root cause, and `--skip-metadata-validation` hint

**Success criteria:**
- Integration tests for scenarios 35-41 pass
- `lace up` aborts with clear error on metadata fetch failure
- `lace up` succeeds with `--skip-metadata-validation` using default attributes
- Port attributes enriched when metadata is present
- Option and port declaration validation errors abort with actionable messages
