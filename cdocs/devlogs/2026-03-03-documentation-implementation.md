---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T20:00:00-08:00
task_list: lace/documentation
type: devlog
state: live
status: wip
tags: [documentation, architecture, troubleshooting, migration, contributing]
---

# Documentation Implementation

## Objective

Implement the 5-phase documentation proposal (`cdocs/proposals/2026-03-03-documentation-idioms-and-usage-guide.md`):
1. Architecture overview (`packages/lace/docs/architecture.md`)
2. Troubleshooting guide (`packages/lace/docs/troubleshooting.md`)
3. Migration guide (`packages/lace/docs/migration.md`)
4. Contributing guidelines (`CONTRIBUTING.md`)
5. Cross-linking from existing READMEs

## Plan

1. Deep codebase study -- read `up.ts` pipeline, all error-producing modules, all pattern-bearing source files
2. Phase 1: Architecture overview with pipeline flow, ASCII diagram, layer mapping, worked examples
3. Phase 2: Troubleshooting guide with grep-verified error messages
4. Phase 3: Migration guide with incremental steps
5. Phase 4: CONTRIBUTING.md with verified code snippets and source cross-references
6. Phase 5: Cross-link from root and package READMEs
7. Self-review: verify all cross-references, error messages, code snippets, and link paths

## Implementation Notes

### Codebase study findings

**Pipeline order in `runUp()`:**
- Phase 0a: Workspace layout detection (`applyWorkspaceLayout`)
- Phase 0b: Host-side validation (`runHostValidation`)
- Extract prebuild features, repo mounts, feature IDs
- Step 1: Fetch feature metadata (`fetchAllFeatureMetadata`) + validate options + validate port declarations
- Step 2: Warn about `${lace.port()}` in prebuildFeatures
- Step 3: Auto-inject port templates (`autoInjectPortTemplates`)
- Step 4: Auto-inject mount templates (`autoInjectMountTemplates`)
- Step 4.5: Deduplicate static mounts (`deduplicateStaticMounts`)
- Step 5: Validate mount declarations (namespaces, target conflicts)
- Step 6: Warn about prebuild features with static ports
- Step 7: Load settings, create mount resolver
- Step 7.5: Validate sourceMustBe declarations
- Step 8: Resolve all templates (`resolveTemplates`) + save allocations
- Post-resolution: Inferred mount validation (bind-mount source existence)
- Build feature port metadata
- Prebuild phase (if configured)
- Resolve repo mounts (if configured)
- Generate extended config
- Invoke devcontainer up

**Error classes found:**
- `DevcontainerConfigError` (devcontainer.ts)
- `MetadataFetchError` (feature-metadata.ts) -- with `kind` discriminant
- `AnnotationMissingError` (feature-metadata.ts, internal)
- `RepoCloneError` (repo-clones.ts)
- `DockerfileParseError` (dockerfile.ts)
- `MountsError` (mounts.ts)
- `SettingsConfigError` (settings.ts)

**Discriminated unions found:**
- `PrebuildFeaturesResult`: kind: "features" | "absent" | "null" | "empty"
- `ConfigBuildSource`: kind: "dockerfile" | "image"
- `RepoMountsResult`: kind: "repoMounts" | "absent" | "null" | "empty"
- `ValidationError`: kind: "unknown_option" | "port_key_mismatch"
- `MetadataFetchKind`: "fetch_failed" | "invalid_response" | "annotation_invalid" | "blob_fallback_failed"

## Changes Made

_(Updated as commits are made)_

## Verification

_(Updated after self-review)_
