---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T15:00:00-08:00
task_list: lace/packages-lace-cli
type: devlog
state: live
status: wip
tags: [devcontainer, prebuild, image, lace, implementation]
---

# Devlog: Implementing Prebuild Image-Based Config Support

## Objective

Implement the proposal at [`cdocs/proposals/2026-02-04-prebuild-image-based-config-support.md`](../proposals/2026-02-04-prebuild-image-based-config-support.md) to extend `lace prebuild` to support image-based devcontainer configurations alongside Dockerfile-based ones.

**Key deliverables:**
1. Config type detection (`ConfigBuildSource` discriminated union)
2. Image reference parsing (`parseImageRef`, `generateImageDockerfile`)
3. JSONC-preserving image field rewriting
4. Metadata extension with `configType`
5. Prebuild pipeline integration
6. Restore pipeline integration
7. Documentation updates

## Plan

Following the 7 implementation phases from the proposal:

1. **Phase 1: Config Type Detection** - Modify `devcontainer.ts`
2. **Phase 2: Image Reference Parsing** - Add functions to `dockerfile.ts`
3. **Phase 3: Devcontainer.json Modification** - Add JSONC rewriting functions
4. **Phase 4: Metadata Extension** - Add `configType` field
5. **Phase 5: Prebuild Pipeline Integration** - Update `runPrebuild()`
6. **Phase 6: Restore Pipeline Integration** - Update `runRestore()`
7. **Phase 7: Documentation and Polish** - Update docs

Each phase will be committed separately with tests. Will use subagents to parallelize independent work where possible.

## Testing Approach

- **Unit tests**: For all new functions (`parseImageRef`, `generateImageDockerfile`, `rewriteImageField`, `resolveBuildSource`)
- **Integration tests**: Full pipeline tests for image-based prebuild/restore
- **Regression tests**: Ensure existing Dockerfile-based workflow still works
- **TDD where practical**: Write tests first for pure functions (Phase 2, 3), integration tests after implementation for pipeline changes (Phase 5, 6)

## Implementation Notes

### Phase 1: Config Type Detection

**Completed** via commit `90a0622` (merged with Phase 3).

Changes:
- Added `ConfigBuildSource` discriminated union type
- Updated `DevcontainerConfig` interface with `buildSource` and `configPath` fields
- Refactored `resolveDockerfilePath()` to `resolveBuildSource()` internally
- Maintained backwards compatibility with deprecated `dockerfilePath` field
- Added comprehensive unit tests for all config variations

### Phase 2: Image Reference Parsing

**Completed** via commit `d79c4e0`.

Changes:
- Added `parseImageRef()` function to extract imageName/tag/digest from image strings
- Added `generateImageDockerfile()` to create minimal `FROM <image>` Dockerfiles
- Added comprehensive unit tests including registry ports, digests, and round-trip tests

### Phase 3: Devcontainer.json Modification

**Completed** via commit `90a0622`.

Changes:
- Added `rewriteImageField()` using jsonc-parser's modify/applyEdits (preserves comments)
- Added `hasLaceLocalImage()` and `getCurrentImage()` helpers
- Added unit tests verifying comment preservation in JSONC files

### Phase 4: Metadata Extension

**Completed** via commit `927c84e`.

Changes:
- Added optional `configType` field to `PrebuildMetadata` interface
- Field is optional for backwards compatibility
- Added tests verifying old metadata files (without configType) still parse correctly

### Phase 5: Prebuild Pipeline Integration

_Pending..._

### Phase 6: Restore Pipeline Integration

_Pending..._

### Phase 7: Documentation and Polish

_Pending..._

## Changes Made

| File | Change |
|------|--------|
| _TBD_ | _TBD_ |

## Verification

_Pending completion of implementation..._

**Build & Lint:**
```
[Pending]
```

**Tests:**
```
[Pending]
```
