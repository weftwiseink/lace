---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T12:00:00-08:00
task_list: lace/feature-metadata
type: report
state: live
status: done
tags: [incident, oci, metadata, feature-metadata, nushell, error-handling, devcontainer-spec]
related_to:
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-10-devcontainer-metadata-and-lace-registry.md
  - cdocs/proposals/2026-02-13-robust-metadata-fetching.md
---

# Incident: `lace up` Fails on Features Without OCI Metadata Annotations

> **BLUF:** `lace up` fatally errors on `ghcr.io/eitsupi/devcontainer-features/nushell:0` because that feature's OCI manifest does not include a `dev.containers.metadata` annotation. The error message incorrectly blames the user's build environment ("network, auth, or registry") when the actual cause is normal spec-compliant behavior -- the `dev.containers.metadata` annotation is a **SHOULD** (not MUST) per the [devcontainer features distribution spec](https://containers.dev/implementors/features-distribution/). The devcontainer CLI itself has explicit backwards-compatibility fallback when the annotation is absent. Lace's treatment of it as a hard requirement was an incorrect assumption. See [proposal](../proposals/2026-02-13-robust-metadata-fetching.md) for the fix.

## Context / Background

A user running `lace up` in a workspace with the following features in `.devcontainer/devcontainer.json` encounters a hard failure:

```jsonc
"features": {
  "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
  "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
  "ghcr.io/eitsupi/devcontainer-features/nushell:0": {},
  "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": { "version": "..." }
}
```

The error:

```
Fetching feature metadata...
Failed to fetch metadata for feature "ghcr.io/eitsupi/devcontainer-features/nushell:0":
OCI manifest missing dev.containers.metadata annotation.
This indicates a problem with your build environment (network, auth, or registry).
Use --skip-metadata-validation to bypass this check.
```

The `wez-into` CLI already works around this by passing `--skip-metadata-validation` (line 130 of `bin/wez-into`), but `lace up` invoked directly still fails.

## Key Findings

### 1. The error attribution is wrong

The `MetadataFetchError` class (`feature-metadata.ts:74-87`) wraps **all** failure modes with the same message:

> "This indicates a problem with your build environment (network, auth, or registry)."

This is only accurate for one of the four failure modes:

| Failure Mode | Error Reason | Environment Problem? |
|---|---|---|
| CLI exits non-zero | Network/auth/registry failure | **Yes** |
| CLI returns invalid JSON | Possible CLI bug or corruption | Maybe |
| Annotation missing from manifest | Feature publisher didn't include it | **No** |
| Annotation contains invalid JSON | Feature publisher published bad metadata | **No** |

When the annotation is missing, the `devcontainer features info manifest` command **succeeded** -- it connected to GHCR, authenticated, fetched the manifest, and returned valid JSON. The problem is that the nushell feature simply does not embed `dev.containers.metadata` as an OCI annotation.

### 2. The annotation is spec-optional (SHOULD, not MUST)

The devcontainer features distribution spec uses RFC 2119 **"should"** language for the `dev.containers.metadata` annotation -- it is a recommendation, not a requirement. The devcontainer CLI treats it accordingly:

- **At install time**: The CLI has explicit backwards-compatibility fallback in two code paths (`containerFeaturesOrder.ts`, `containerFeaturesConfiguration.ts`). When the annotation is missing, it downloads the feature tarball and extracts `devcontainer-feature.json` from it.
- **At publish time**: `devcontainer features publish` only started setting the annotation in CLI v0.39.0 (April 2023). The publish command **skips already-existing versions**, so features published before v0.39.0 will permanently lack the annotation unless a new version is released.
- **At manifest query time**: `devcontainer features info manifest` returns the raw OCI manifest as-is, with no expectation that any particular annotation exists.

The nushell feature was published before annotation support was added. Versions 0.1.0 and 0.1.1 will never gain the annotation retroactively. From the 2026-02-10 metadata report, the nushell feature's Docker metadata entry has only `"id"` -- no options, no customizations, no ports. This feature has zero interaction surface with lace.

**Lace's treatment of the annotation as a hard requirement was an incorrect assumption based on our own publishing workflow (which uses the modern CLI).**

### 3. The failure is all-or-nothing

`fetchAllFeatureMetadata()` uses `Promise.all()` and any single `MetadataFetchError` aborts the entire batch (`up.ts:141-153`). There is no partial success path -- even if 5 out of 6 features have metadata, one failure kills `lace up`.

### 4. Features without lace customizations don't need metadata

Lace fetches metadata for two purposes:
1. **Option validation**: Verify user-provided options match the feature's schema.
2. **Port/customization extraction**: Read `customizations.lace.ports` for auto-injection.

For features like nushell that:
- Have no user-provided options (`{}` in devcontainer.json)
- Have no `customizations.lace` section
- Declare no lace-managed ports

...metadata is informational only. The failure blocks `lace up` for no functional benefit.

## Code Path Analysis

```
lace up
  → runUp()                           [up.ts:122]
    → fetchAllFeatureMetadata()        [feature-metadata.ts:391]
      → fetchFeatureMetadata()         [feature-metadata.ts:331] (per feature)
        → memoryCache.get()            [cache miss]
        → readFsCache()               [cache miss or expired]
        → fetchFromRegistry()          [feature-metadata.ts:235]
          → subprocess("devcontainer", ["features", "info", "manifest", ...])
          → EXIT CODE 0, valid JSON returned
          → manifest.manifest?.annotations?.["dev.containers.metadata"]  →  undefined
          → manifest.annotations?.["dev.containers.metadata"]            →  undefined
          → THROW MetadataFetchError("OCI manifest missing dev.containers.metadata annotation")
    → MetadataFetchError caught
    → ABORT lace up (unless --skip-metadata-validation)
```

The critical issue is at `feature-metadata.ts:270-274`: the absence of the annotation is treated identically to a network failure.

## Impact

- **User-facing**: `lace up` fails with a misleading error that sends users on a wild goose chase investigating their network/auth/registry setup.
- **Workaround tax**: `--skip-metadata-validation` disables ALL metadata validation, including legitimate checks on features that do have metadata.
- **Third-party feature compatibility**: Any feature without `dev.containers.metadata` breaks `lace up`. This is a class of failure, not a one-off.
- **`wez-into` divergence**: `wez-into` already uses `--skip-metadata-validation` as a blanket workaround, which means it silently skips validation for features that would benefit from it.

## Test Coverage Assessment

Existing tests in `feature-metadata.test.ts`:

| Scenario | Coverage | Gap? |
|---|---|---|
| Successful metadata parse | Scenario 1 (line 97) | None |
| CLI non-zero exit | Scenario 2 (line 117) | None |
| skipValidation on failure | Scenario 3 (line 141) | None |
| Invalid JSON from CLI | Scenario 4 (line 164) | None |
| Missing annotation | Scenario 5 (line 201) | Tests the throw, but not graceful handling |
| Malformed annotation JSON | Scenario 6 (line 214) | None |

**Gaps:**
- No test for mixed-feature batches where some features have metadata and some don't.
- No test distinguishing error messages by failure mode.
- No test for graceful degradation (returning partial results instead of aborting).
- No integration test verifying `lace up` succeeds when non-lace features lack annotations.

## Recommendations

### R1: Distinguish "missing annotation" from "fetch failure" (high priority)

Introduce a distinct error type or error kind for "annotation not present." The `MetadataFetchError` message should reflect the actual failure:

- **Network/auth failure**: "Could not fetch manifest from registry (network, auth, or registry problem)."
- **Missing annotation**: "Feature does not publish `dev.containers.metadata` OCI annotation. This feature may not support metadata-based validation."

### R2: Make missing annotations non-fatal by default (high priority)

When a feature's OCI manifest is successfully fetched but lacks the `dev.containers.metadata` annotation:
- Log a warning (not an error).
- Return `null` metadata for that feature.
- Continue with other features.
- Skip option/port validation for that feature (same as `--skip-metadata-validation` behavior, but only for the affected feature).

This is safe because: if the feature has no annotation, it also has no `customizations.lace` section, so there's nothing for lace to validate or auto-inject.

### R3: Validate features that have metadata, skip those that don't (medium priority)

The `--skip-metadata-validation` flag is too coarse. A finer-grained approach:
- Features with metadata: full validation (options, ports, customizations).
- Features without metadata: warning + skip. No need for a CLI flag.
- `--skip-metadata-validation`: still available as an escape hatch for when even the fetch itself fails (network down, auth expired).

### R4: Improve error message specificity (medium priority)

The `MetadataFetchError` constructor should accept a `kind` field that categorizes the failure. The user-facing message should vary based on kind:

| Kind | Message |
|---|---|
| `fetch_failed` | "Could not reach registry. Check network, auth, and registry availability." |
| `invalid_response` | "Registry returned unexpected data. This may indicate a CLI or registry bug." |
| `annotation_missing` | "Feature does not include OCI metadata annotations. Metadata-based validation skipped." |
| `annotation_invalid` | "Feature published invalid metadata. Contact the feature maintainer." |

### R5: Add targeted test coverage (low priority)

- Test that `fetchAllFeatureMetadata` returns partial results when some features lack annotations.
- Test that `lace up` completes successfully with mixed metadata availability.
- Test that error messages differ by failure mode.
