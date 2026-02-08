---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T23:00:00-08:00
type: devlog
state: archived
status: done
tags: [features, metadata, oci, caching, validation]
implements: cdocs/proposals/2026-02-06-lace-feature-metadata-management.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-06T23:45:00-08:00
  round: 1
---

# Devlog: Feature Metadata Management Implementation

## Overview

Implementing the feature metadata management module per the proposal at
`cdocs/proposals/2026-02-06-lace-feature-metadata-management.md`. This module
retrieves, caches, and exposes `devcontainer-feature.json` content for features
declared in devcontainer configs.

## Phase 1: Core retrieval, validation, and in-memory cache

**Status:** done
**Commit:** `570df53` feat(lace): add feature metadata module with OCI fetch, validation, and in-memory cache

### What was built
- `packages/lace/src/lib/feature-metadata.ts` -- all types, core functions
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts` -- 32 unit tests (scenarios 1-24)
- Types: `FeatureMetadata`, `FeatureOption`, `ValidationResult`, `ValidationError`,
  `LacePortDeclaration`, `LaceCustomizations`, `FetchOptions`, `MetadataFetchError`
- Functions: `fetchFeatureMetadata`, `fetchAllFeatureMetadata`, `clearMetadataCache`,
  `validateFeatureOptions`, `validatePortDeclarations`, `extractLaceCustomizations`, `isLocalPath`
- OCI fetch via `devcontainer features info manifest` subprocess
- Local-path fetch via filesystem read
- In-memory `Map` cache with deduplication
- `MetadataFetchError` with `--skip-metadata-validation` escape hatch
- Runtime type narrowing in `extractLaceCustomizations()`

## Phase 2: Filesystem cache

**Status:** done
**Commit:** `dedf382` feat(lace): add filesystem cache layer for feature metadata

### What was built
- Added `CacheEntry` type with `_cache.featureId`, `_cache.fetchedAt`, `_cache.ttlMs`
- `featureIdToCacheKey()` percent-encoding (/ -> %2F, : -> %3A, % -> %25)
- `readFsCache()` with TTL checking and `skipFloating` support
- `writeFsCache()` with auto-directory creation
- `getTtlMs()` version format detection (exact semver = permanent, floating = 24h)
- `--no-cache` bypasses floating tags, preserves pinned entries
- `clearMetadataCache()` extended to delete filesystem cache directory
- Injectable `cacheDir` for test isolation (default: `~/.config/lace/cache/features/`)
- 18 new tests (scenarios 25-34 plus TTL and cache key tests)

## Phase 3: Integration with `lace up` pipeline

**Status:** done
**Commit:** `ec35e2f` feat(lace): integrate feature metadata validation into lace up pipeline

### What was built
- New `metadataValidation` phase in `runUp()` pipeline (after config read, before prebuild)
- Extracts feature IDs from `devcontainer.json` `features` key
- Fetches metadata for all features via `fetchAllFeatureMetadata()`
- Validates user-provided options against feature schemas
- Validates port declaration keys match option names (v2 convention)
- `MetadataFetchError` aborts `lace up` with actionable error message
- `--skip-metadata-validation` and `--no-cache` CLI flags in `commands/up.ts`
- Skips validation entirely when no features are declared
- 6 new integration tests (scenarios 35-39 plus no-features case)

### Testing summary
- 50 unit tests in `feature-metadata.test.ts`
- 6 integration tests in `up.integration.test.ts`
- All 363 non-Docker tests pass
- Docker smoke tests have pre-existing infrastructure flakiness unrelated to this change

## Design decisions during implementation

### Injectable cacheDir for testing
The proposal specified `~/.config/lace/cache/features/` as the cache directory. During
implementation, we added a `cacheDir` field to `FetchOptions` so tests can use temp
directories without writing to the real user cache. This is consistent with the existing
`LACE_SETTINGS` env var pattern used by other tests.

### clearMetadataCache accepts optional cacheDir
The `clearMetadataCache()` function was extended to accept an optional `cacheDir` parameter
so tests can clean up their specific temp cache directories. Without this, tests would
need to manage cleanup manually, risking cross-test contamination.

### Metadata validation phase placement
The metadata validation phase runs after port assignment but before prebuild. This ensures
that if metadata fetch fails (indicating network/auth problems), the user gets a clear error
before any Docker builds start. The feature IDs come from the devcontainer.json's `features`
key, which is available from the minimal config read (no Dockerfile required).
