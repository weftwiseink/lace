---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T20:00:00-08:00
task_list: lace/documentation
type: devlog
state: live
status: done
tags: [documentation, architecture, troubleshooting, migration, contributing]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-04T12:00:00-08:00
  round: 1
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

### Phase 1: Architecture Overview
- Created `packages/lace/docs/architecture.md`
- Pipeline flow narrative with ASCII diagram
- Layer-to-step mapping table (10 layers to 14 README steps)
- Dependency flow explanation
- Two worked examples (port resolution, mount resolution)
- Settings and state files section
- Commit: `docs: add architecture overview with pipeline flow diagram`

### Phase 2: Troubleshooting Guide
- Created `packages/lace/docs/troubleshooting.md`
- 10 entries, all error messages grep-verified against source:
  1. Port exhaustion (`All ports in range 22425-22499 are in use`)
  2. Stale metadata cache (24h TTL)
  3. Prebuild image missing (`Prebuild image missing (...)`)
  4. Docker auto-creates dir (`Bind mount source does not exist`)
  5. Unknown template (`Unknown template variable`)
  6. Default path mount (`using default path`)
  7. Workspace mismatch (`bare-worktree declared but ... normal git clone`)
  8. Metadata fetch failure (`Failed to fetch metadata for feature`)
  9. Namespace validation (`Unknown mount namespace(s)`)
  10. Lock contention (`Another lace operation is already running`)
- Commit: `docs: add troubleshooting guide with verified error messages`

### Phase 3: Migration Guide
- Created `packages/lace/docs/migration.md`
- 6 incremental steps with before/after configs
- "What NOT to migrate" section
- Commit: `docs: add migration guide from devcontainer CLI to lace`

### Phase 4: Contributing Guidelines
- Created `CONTRIBUTING.md` at repo root
- 7 codebase idioms with verified code snippets
- Testing patterns section
- Conventions section with NOTE about source verification
- Commit: `docs: add CONTRIBUTING.md with codebase idioms and testing patterns`
- Added cross-reference comments in 11 source files
- Build verified after source changes
- Commit: `docs: add source cross-reference comments for CONTRIBUTING.md`

### Phase 5: Cross-Linking
- Added "Documentation" section to root `README.md`
- Added "Further reading" section to `packages/lace/README.md`
- Commit: `docs: cross-link new documentation from READMEs`

## Verification

### Cross-reference validity
- All `../README.md#section` links verified against actual heading slugs:
  `#lace-up`, `#port-allocation`, `#template-variables`, `#mount-templates`,
  `#workspace-layout`, `#host-side-validation`, `#user-level-data`,
  `#hardcoded-defaults`
- `../../CONTRIBUTING.md` relative path from `packages/lace/README.md` confirmed
- All `packages/lace/docs/*.md` files exist and are linked from both READMEs

### Error message verification
- Every error message in troubleshooting.md was grep-verified against source:
  - `All ports in range` -> port-allocator.ts:157
  - `Prebuild image missing` -> prebuild.ts:206
  - `Bind mount source does not exist` -> up.ts:482
  - `Unknown template variable` -> template-resolver.ts:642
  - `using default path` -> template-resolver.ts:396
  - `bare-worktree declared but` -> workspace-layout.ts:128
  - `Failed to fetch metadata for feature` -> feature-metadata.ts:126
  - `Unknown mount namespace` -> template-resolver.ts:341
  - `Another lace operation is already running` -> flock.ts:34
  - `Mount override source does not exist` -> mount-resolver.ts:222

### Code snippet verification
- `DevcontainerConfigError` constructor matches devcontainer.ts:39-44
- `PrebuildFeaturesResult` type matches devcontainer.ts:7-11
- `UpResult` interface matches up.ts:69-83
- `RunSubprocess` type matches subprocess.ts:14-18
- `LACE_PORT_FULL_MATCH` regex matches template-resolver.ts:45
- `LACE_UNKNOWN_PATTERN` regex matches template-resolver.ts:44
- `LABEL_PATTERN` regex matches mount-resolver.ts:38

### Pipeline accuracy
- Layer-to-step mapping verified against runUp() in up.ts and README's 14-step list
- All 14 steps accounted for in the mapping table

### Build verification
- `pnpm --filter lace build` passes after all source cross-reference comments
