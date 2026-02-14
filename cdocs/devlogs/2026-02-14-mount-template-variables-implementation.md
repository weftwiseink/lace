---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:59:00-08:00
task_list: lace/template-variables
type: devlog
state: live
status: review_ready
tags: [mount-resolver, template-variables, settings, extensibility]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:59:00-08:00
  round: 1
related_to:
  - cdocs/proposals/2026-02-14-mount-template-variables.md
---

# Mount Template Variables Implementation

## Objective

Implement the mount template variable system as specified in `cdocs/proposals/2026-02-14-mount-template-variables.md`. This introduces `${lace.mount.source(namespace/label)}` and `${lace.mount.target(namespace/label)}` template variables, following the architecture established by the port system.

## Phases

### Phase 1: MountPathResolver + Settings Extension
- **Status:** complete (commit 2eec3b8)
- **Scope:** `mount-resolver.ts`, `settings.ts`, tests for both
- Created `MountPathResolver` class with two-tier resolution (settings override → default path derivation)
- Extended `LaceSettings` with `MountOverrideSettings` and `mounts` key
- 17 new unit tests for mount-resolver, 4 new settings tests

### Phase 2: Template Resolution Integration
- **Status:** complete (commit 1f335cf)
- **Scope:** `template-resolver.ts`, template-resolver tests
- Added `LACE_MOUNT_SOURCE_PATTERN` regex
- Relaxed `LACE_UNKNOWN_PATTERN` with negative lookahead for `mount.source(` and `mount.target(`
- Extended `resolveStringValue()` for mount source resolution
- 11 new template-resolver tests

### Phase 3: Pipeline Wiring in up.ts
- **Status:** complete (commit 1782af0)
- **Scope:** `up.ts`, integration tests
- Wired `MountPathResolver` into `runUp()` pipeline
- Added graceful `SettingsConfigError` handling
- Added mount assignment reporting to console output
- 8 new integration tests

### Phase 4: Feature Mount Declarations
- **Status:** complete (commit 2f42de5)
- **Scope:** `feature-metadata.ts`, `template-resolver.ts`, `up.ts`
- Added `LaceMountDeclaration` interface and extended `LaceCustomizations`
- Added `autoInjectMountTemplates()` function
- Extended `extractLaceCustomizations()` to parse mount declarations
- Tests for declaration parsing and auto-injection

### Phase 5: ${lace.mount.target()} Resolution
- **Status:** complete (commit 798cf13)
- **Scope:** `template-resolver.ts`, `up.ts`, tests
- Added `LACE_MOUNT_TARGET_PATTERN` regex
- Added `buildMountTargetMap()` function
- Extended resolution chain with `mountTargetMap` parameter
- 14 new tests for target resolution

### Phase 6: Migrate Lace Devcontainer
- **Status:** complete (commit fb457a1)
- **Scope:** `.devcontainer/devcontainer.json`
- Replaced mounts[0] and mounts[1] with `${lace.mount.source()}` templates
- Left SSH and wezterm mounts unchanged (out of scope)

## Changes Made

| File | Change |
|------|--------|
| `packages/lace/src/lib/mount-resolver.ts` | Created: MountPathResolver class |
| `packages/lace/src/lib/settings.ts` | Extended: MountOverrideSettings, mounts key |
| `packages/lace/src/lib/template-resolver.ts` | Extended: mount source/target patterns, resolution, auto-injection, buildMountTargetMap |
| `packages/lace/src/lib/feature-metadata.ts` | Extended: LaceMountDeclaration, LaceCustomizations.mounts, extractLaceCustomizations |
| `packages/lace/src/lib/up.ts` | Extended: MountPathResolver creation, auto-injection, target map building |
| `.devcontainer/devcontainer.json` | Migrated: mounts[0] and mounts[1] to template variables |
| `packages/lace/src/lib/__tests__/mount-resolver.test.ts` | Created: 17 unit tests |
| `packages/lace/src/lib/__tests__/settings.test.ts` | Extended: 4 new mount override tests |
| `packages/lace/src/lib/__tests__/template-resolver.test.ts` | Extended: 25+ new tests (source, target, auto-injection) |
| `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` | Created: 8 integration tests |

## Verification

**Tests:**
```
 Test Files  23 passed (23)
      Tests  555 passed (555)
   Start at  12:27:09
   Duration  22.51s
```

Baseline was 510 tests across 22 files. Final is 555 tests across 23 files (+45 tests, +1 test file).

**Commits:**
```
798cf13 feat(template-resolver): add ${lace.mount.target()} resolution (Phase 5)
2f42de5 feat(mounts): add feature mount declarations and auto-injection (Phase 4)
fb457a1 feat(devcontainer): migrate lace mounts to template variables (Phase 6)
1782af0 feat(up): wire MountPathResolver into runUp pipeline (Phase 3)
1f335cf feat(template-resolver): integrate mount source resolution (Phase 2)
2eec3b8 feat(mount-resolver): add MountPathResolver and settings mount overrides
```

## Deviations from Proposal

- **Settings loading**: Phase 3 loads settings separately in up.ts rather than hoisting the existing `loadSettings()` call from `runResolveMounts()`. This was simpler and avoided changing the resolve-mounts interface. Both calls are lightweight (read a JSON file) so the duplication is acceptable.
- **Phase ordering**: Phase 6 was executed in parallel with Phase 4 since it only depended on Phase 3. This was more efficient.
