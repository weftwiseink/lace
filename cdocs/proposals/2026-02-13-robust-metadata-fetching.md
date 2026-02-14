---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T12:30:00-08:00
task_list: lace/feature-metadata
type: proposal
state: live
status: evolved
tags: [feature-metadata, oci, error-handling, robustness, nushell, third-party-features]
references:
  - cdocs/reports/2026-02-13-oci-metadata-annotation-missing-incident.md
  - cdocs/proposals/2026-02-06-lace-feature-metadata-management.md
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-10-devcontainer-metadata-and-lace-registry.md
superseded_by: cdocs/proposals/2026-02-13-native-oci-metadata-client.md
---

# Robust Metadata Fetching: Graceful Handling of Missing OCI Annotations

> **BLUF:** `lace up` fatally errors on third-party features that don't publish `dev.containers.metadata` OCI annotations (e.g., `ghcr.io/eitsupi/devcontainer-features/nushell:0`), with a misleading error blaming the user's build environment. The annotation is a **SHOULD** (not MUST) in the [devcontainer features distribution spec](https://containers.dev/implementors/features-distribution/), and the `devcontainer` CLI itself has explicit backwards-compatibility fallback when it's absent. Lace's treatment of it as a hard requirement was an incorrect assumption. The fix: treat "annotation missing" as a normal, silent condition. When a feature's OCI manifest is successfully retrieved but lacks the annotation, return `null` metadata and move on -- no warning, no error. Debug-level logging only. This preserves strict error semantics for real failures (network, auth, registry) while correctly handling the spec-optional nature of the annotation. The change touches `MetadataFetchError` (add a `kind` field), `fetchFromRegistry()` (return `null` for missing annotations), and error message construction (kind-specific messages). Downstream code in `up.ts` already handles `null` metadata correctly via existing `if (!metadata) continue;` guards. See [incident report](../reports/2026-02-13-oci-metadata-annotation-missing-incident.md) for full root cause analysis.

## Objective

Make `lace up` correctly handle the spec-optional `dev.containers.metadata` OCI annotation, without weakening validation for features that do publish metadata. Missing annotations should be invisible to the user since they represent normal spec-compliant behavior, not an error condition.

## Background

The [feature metadata management proposal](./2026-02-06-lace-feature-metadata-management.md) established strict error semantics: metadata fetch failures abort `lace up` because they signal a broken build environment. This was the correct decision for actual fetch failures -- if the CLI can't reach the registry, `devcontainer up` will fail too.

However, the implementation conflates two fundamentally different conditions under the same `MetadataFetchError`:

1. **Fetch failure** (CLI exits non-zero): Network, auth, or registry problem. The build environment is broken. Fatal error is correct.
2. **Annotation missing** (CLI succeeds, returns valid JSON, but no `dev.containers.metadata`): Normal spec-compliant behavior. Fatal error is wrong.

### The annotation is spec-optional

The devcontainer features distribution spec states the annotation **"should"** be populated -- RFC 2119 SHOULD, not MUST. The `devcontainer` CLI itself treats it as optional with explicit fallback:

- **At install time** (`containerFeaturesOrder.ts`, `containerFeaturesConfiguration.ts`): When the annotation is missing, the CLI downloads the feature tarball and extracts `devcontainer-feature.json` from it. This is documented in the CLI source as "backwards compatibility."
- **At publish time** (`publish.ts`): The CLI only started setting the annotation in v0.39.0 (April 2023). Features published before that -- or published with non-standard tooling -- permanently lack it unless a new version is released.
- **At manifest query time** (`info.ts`): `devcontainer features info manifest` returns the raw OCI manifest as-is, with no expectation that any particular annotation exists.

The nushell feature (`ghcr.io/eitsupi/devcontainer-features/nushell:0`) was published before annotation support was added, and the publish command skips already-existing versions. It will lack the annotation until a new version (0.1.2+) is released.

### Current workaround

`wez-into` passes `--skip-metadata-validation` (`bin/wez-into:153-155`), which disables ALL metadata validation including legitimate checks on features that do have metadata.

## Proposed Solution

### 1. Add `kind` field to `MetadataFetchError`

Categorize failures so error messages match the actual condition:

```typescript
export type MetadataFetchKind =
  | "fetch_failed"        // CLI non-zero exit (network, auth, registry)
  | "invalid_response"    // CLI returned unparseable output
  | "annotation_missing"  // Manifest fetched OK but no dev.containers.metadata
  | "annotation_invalid"; // Annotation present but not valid JSON

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
      case "annotation_missing":
        return `${base} This feature does not publish the optional dev.containers.metadata OCI annotation.`;
      case "annotation_invalid":
        return `${base} The feature's metadata annotation is malformed. Contact the feature maintainer. Use --skip-metadata-validation to bypass this check.`;
    }
  }
}
```

### 2. Make `annotation_missing` silently non-fatal in `fetchFeatureMetadata()`

The key behavioral change: `annotation_missing` errors are caught and converted to `null` return silently (debug log only), regardless of `skipValidation`. Other error kinds retain existing behavior (fatal unless `skipValidation` is set).

```typescript
// In fetchFeatureMetadata(), replace the existing catch block:
} catch (e) {
  if (e instanceof MetadataFetchError) {
    // Annotation-missing is a normal condition: the dev.containers.metadata
    // OCI annotation is spec-optional (SHOULD, not MUST). Many third-party
    // features don't publish it. Silent null return, no user-visible output.
    if (e.kind === "annotation_missing") {
      return null;
    }
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
```

### 3. Update `fetchFromRegistry()` throw sites with `kind`

Each existing throw gets its appropriate `kind`:

```typescript
// CLI exits non-zero
throw new MetadataFetchError(featureId,
  `devcontainer CLI exited with code ${result.exitCode}: ${result.stderr.trim()}`,
  "fetch_failed");

// CLI returns invalid JSON
throw new MetadataFetchError(featureId,
  `CLI returned invalid JSON: ${(e as Error).message}`,
  "invalid_response");

// Annotation missing
throw new MetadataFetchError(featureId,
  "OCI manifest missing dev.containers.metadata annotation",
  "annotation_missing");

// Annotation invalid JSON
throw new MetadataFetchError(featureId,
  `dev.containers.metadata annotation is not valid JSON: ${(e as Error).message}`,
  "annotation_invalid");
```

### 4. Downstream handling (no changes needed)

The existing code in `up.ts` already handles `null` metadata correctly:

```typescript
// up.ts:154 -- already present
if (!metadata) continue;
```

After this change, `null` also appears when annotation is missing. The comment should be updated to reflect both cases, but the logic is unchanged.

## Design Decisions

### Decision: `annotation_missing` is silently non-fatal, no flag needed

**Why:** The `dev.containers.metadata` annotation is spec-optional (SHOULD, not MUST). Its absence is not an error, a warning, or even noteworthy -- it's normal behavior for features published before April 2023 or with non-standard tooling. The devcontainer CLI itself handles this silently with a fallback path. Lace should do the same.

**Alternative rejected -- warn on missing:** Warnings imply something is wrong. Nothing is wrong. The user cannot fix it and has no reason to care. A warning would be misleading noise.

**Alternative rejected -- fatal with better message:** The user still can't fix it. They'd have to add `--skip-metadata-validation` every time, which weakens validation for features that do have metadata.

### Decision: `annotation_invalid` remains fatal

**Why:** If the annotation exists but contains malformed JSON, the publisher intended to publish metadata but did it wrong. This is a genuine bug in the feature, unlike annotation absence which is a normal spec-compliant state. Fatal error with a clear message is appropriate.

### Decision: Keep `MetadataFetchError` as a single class with `kind` rather than separate error classes

**Why:** The error handling logic in `fetchFeatureMetadata()` already catches `MetadataFetchError` by class. Adding a `kind` field is a smaller change than introducing `MetadataAnnotationMissingError`, `MetadataFetchFailedError`, etc. The `kind` field provides the same discrimination power with less type surface area.

### Decision: Don't cache `null` results for missing annotations

**Why:** A feature publisher could add the annotation in a future release. If we cache the "missing" result, users on floating tags wouldn't pick up the new annotation until the cache expires. Since the `devcontainer features info manifest` call takes <1s, the cost of re-checking is low. The in-memory cache still prevents duplicate subprocess spawns within a single `lace up` run.

## Edge Cases

### Feature gains metadata annotation in a new release

User is on floating tag `:0`. Feature publisher adds `dev.containers.metadata` in a new release. On next `lace up` after the 24h cache TTL expires (or with `--no-cache`), metadata is fetched and cached normally. The feature transitions from "no metadata" to "full metadata" seamlessly.

### Feature with lace customizations but missing annotation

If a feature declares `customizations.lace.ports` in its `devcontainer-feature.json` but doesn't publish the annotation, lace cannot discover those port declarations. This is the feature publisher's oversight -- they need to use `devcontainer features publish` (CLI v0.39.0+) to ensure the annotation is set. No lace-side mitigation is possible.

### All features lack annotations

If every feature in the workspace lacks annotations, `metadataMap` will contain all `null` entries. Validation is skipped entirely. Port attributes use defaults. `lace up` proceeds normally.

### Mixed batch: some features have metadata, some don't

Features with metadata get full validation (options, port declarations). Features without metadata return `null` silently. This is the primary use case -- the nushell feature lacks metadata while wezterm-server has it.

### `fetchFromLocalPath()` is unaffected

Local-path features read `devcontainer-feature.json` from disk. If the file doesn't exist, that's still a fatal error (the feature is broken, not just missing an OCI annotation). Local-path errors use `kind: "fetch_failed"`.

## Implementation Phases

### Phase 1: `MetadataFetchError` kind field and non-fatal annotation handling

**Files modified:**
- `packages/lace/src/lib/feature-metadata.ts`
- `packages/lace/src/lib/up.ts` (comment update only)

**Changes:**
1. Add `MetadataFetchKind` type and `kind` field to `MetadataFetchError`.
2. Update `MetadataFetchError` constructor to accept `kind` and generate kind-specific messages via static `formatMessage()`.
3. Update all four throw sites in `fetchFromRegistry()` with appropriate `kind` values.
4. Update `fetchFromLocalPath()` throw sites with `kind: "fetch_failed"`.
5. Update the catch block in `fetchFeatureMetadata()` to silently return `null` for `annotation_missing`.
6. Update the comment on `up.ts:154` to reflect both `skipValidation` and `annotation_missing` cases.

**Success criteria:**
- `lace up` succeeds in a workspace with `nushell:0` without `--skip-metadata-validation`.
- No user-visible output for the missing annotation (debug-level only).
- `lace up` still fails on actual fetch failures (CLI non-zero exit) unless `--skip-metadata-validation` is set.
- Features with metadata still get full validation.

### Phase 2: Test coverage

**Files modified:**
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`
- `packages/lace/src/commands/__tests__/up.integration.test.ts`

**New unit tests:**
- `MetadataFetchError.kind` is set correctly for each throw site.
- `MetadataFetchError.message` varies by kind (no "build environment" text for `annotation_missing`).
- `fetchFeatureMetadata()` returns `null` silently for `annotation_missing` (without `skipValidation`).
- `fetchFeatureMetadata()` throws for `fetch_failed` (without `skipValidation`).
- `fetchFeatureMetadata()` returns `null` for `fetch_failed` when `skipValidation` is set.
- Mixed-feature batch: `fetchAllFeatureMetadata()` returns metadata for features that have it and `null` for those that don't, without throwing.

**New integration tests:**
- `lace up` succeeds with a mix of features with and without metadata annotations.
- Features with metadata are validated; features without are skipped silently.
- Existing error scenarios (CLI failure, unknown option, port mismatch) still work.

**Success criteria:**
- All existing tests pass (no regressions).
- New tests cover all four `MetadataFetchKind` values.
- Mixed-batch test demonstrates partial success.

### Phase 3: Cleanup

**Files modified:**
- `bin/wez-into`

**Changes:**
- Remove `--skip-metadata-validation` from the `lace up` invocation in `start_and_connect()` (line 155). The flag is no longer needed since `annotation_missing` is silently non-fatal.
- Remove or update the comment block (lines 153-155) that explained the workaround.

**Success criteria:**
- `wez-into --start` works without `--skip-metadata-validation` for workspaces with `nushell:0`.
- `wez-into --start` still works for workspaces where all features have metadata.
