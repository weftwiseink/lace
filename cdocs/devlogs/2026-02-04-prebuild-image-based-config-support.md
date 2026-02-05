---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T15:00:00-08:00
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T16:30:00-08:00
  round: 1
task_list: lace/packages-lace-cli
type: devlog
state: archived
status: done
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

**Completed** via commit `bd13fca`.

Changes:
- Updated `runPrebuild()` to branch on `config.buildSource.kind`
- For image configs: use `parseImageRef()` and `generateImageDockerfile()`
- For image configs: rewrite devcontainer.json image field (not Dockerfile)
- Write `configType` to metadata for restore awareness
- Update dry-run and completion messages to reflect config type
- Added 8 integration tests for image-based prebuild

### Phase 6: Restore Pipeline Integration

**Completed** via commit `3abc864`.

Changes:
- Updated `runRestore()` to branch on config type
- Extracted `restoreDockerfile()` and `restoreImage()` helper functions
- For image configs: rewrite devcontainer.json image field to original
- Use bidirectional tag parsing (`parseTag`) as primary restore method
- Added 6 integration tests for image-based restore

### Phase 7: Documentation and Polish

**Completed** via commit `f82aeac`.

Changes:
- Added "Supported configuration types" section to prebuild.md
- Updated pipeline steps to describe branching behavior
- Added "Image field rewriting" section with examples
- Noted `lace.local/` prefix reservation
- Updated cache internals to mention configType in metadata

## Changes Made

| File | Change |
|------|--------|
| `packages/lace/src/lib/devcontainer.ts` | Added `ConfigBuildSource` type, `resolveBuildSource()`, `rewriteImageField()`, `hasLaceLocalImage()`, `getCurrentImage()` |
| `packages/lace/src/lib/dockerfile.ts` | Added `parseImageRef()`, `generateImageDockerfile()` |
| `packages/lace/src/lib/metadata.ts` | Added optional `configType` field to `PrebuildMetadata` |
| `packages/lace/src/lib/prebuild.ts` | Updated to handle both Dockerfile and image configs |
| `packages/lace/src/lib/restore.ts` | Updated to handle both Dockerfile and image configs |
| `packages/lace/src/lib/__tests__/devcontainer.test.ts` | Added tests for new functions |
| `packages/lace/src/lib/__tests__/dockerfile.test.ts` | Added tests for `parseImageRef`, `generateImageDockerfile`, round-trips |
| `packages/lace/src/lib/__tests__/metadata.test.ts` | Added backwards compatibility tests |
| `packages/lace/src/commands/__tests__/prebuild.integration.test.ts` | Added 8 image-based prebuild tests |
| `packages/lace/src/commands/__tests__/restore.integration.test.ts` | Added 6 image-based restore tests |
| `packages/lace/docs/prebuild.md` | Documented image-based config support |

## Verification

**Build & Lint:**
```
$ pnpm tsc --noEmit
# No output (success)
```

**Tests:**
```
$ pnpm vitest run --exclude '**/docker_smoke.test.ts'

 Test Files  15 passed (15)
      Tests  290 passed (290)
   Duration  588ms
```

All 290 tests pass, including:
- 13 new unit tests for `parseImageRef`, `generateImageDockerfile`, `rewriteImageField`, `resolveBuildSource`
- 3 new metadata backwards compatibility tests
- 8 new image-based prebuild integration tests
- 6 new image-based restore integration tests

**Commits:**
1. `90a0622` - feat(lace): add JSONC-preserving image field rewriting (Phases 1 & 3)
2. `927c84e` - feat(lace): add configType field to prebuild metadata (Phase 4)
3. `d79c4e0` - feat(lace): add parseImageRef and generateImageDockerfile functions (Phase 2)
4. `bd13fca` - feat(lace): integrate image-based config support into prebuild pipeline (Phase 5)
5. `3abc864` - feat(lace): integrate image-based config support into restore pipeline (Phase 6)
6. `f82aeac` - docs(lace): document image-based devcontainer prebuild support (Phase 7)
