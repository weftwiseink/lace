---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T19:00:00-08:00
task_list: lace/template-variables
type: devlog
state: live
status: review_ready
tags: [mount-resolver, template-variables, settings, api-design, auto-injection, validation]
related_to:
  - cdocs/proposals/2026-02-15-mount-accessor-api.md
  - cdocs/reports/2026-02-15-mount-api-design-rationale.md
  - cdocs/devlogs/2026-02-15-mount-api-evolution.md
  - cdocs/devlogs/2026-02-14-mount-template-variables-implementation.md
---

# Mount Accessor API v2 Implementation: Devlog

## Objective

Rework the mount template system from v1 (`${lace.mount.source()}` / `${lace.mount.target()}`) to v2 accessor API (`${lace.mount(ns/label)}` with `.source` and `.target` property accessors). This is a complete rework of the v1 implementation on the `mountvars` branch before merging to main. 6 phases per the accepted proposal at `cdocs/proposals/2026-02-15-mount-accessor-api.md`.

## Plan

1. **Phase 1**: Declaration Schema + MountPathResolver Rework
2. **Phase 2**: Template Patterns + Resolution Rework
3. **Phase 3**: Auto-Injection Rework
4. **Phase 4**: Pipeline Wiring + Validation + Guided Config
5. **Phase 5**: Migrate Lace Devcontainer
6. **Phase 6**: Smoke Test

Each phase verified with `npx tsc --noEmit` + `npx vitest run` before committing.

## Testing Approach

- Unit tests via vitest for each phase
- `npx tsc --noEmit` for type checking after each phase
- CLI smoke test via `npx tsx src/index.ts up --workspace-folder <path> --skip-devcontainer-up`
- Integration tests for the full pipeline in `up-mount.integration.test.ts`

## Implementation Notes

### Phase 1: Declaration Schema + MountPathResolver Rework (commit `6270359`)

- Extended `LaceMountDeclaration` with `recommendedSource`, `type`, `consistency` fields
- Added `parseMountDeclarationEntry()` shared helper in `feature-metadata.ts`
- Reworked `MountPathResolver`: constructor accepts declarations map, added `resolveTarget()`, `resolveFullSpec()`, renamed `resolve()` to `resolveSource()`
- `resolveFullSpec()` builds complete mount spec strings: `source=X,target=Y,type=bind[,readonly][,consistency=Z]`
- Declaration existence validation: labels not in declarations fail loudly
- All 31 mount-resolver tests + 163 template-resolver tests passing (194 total)

### Phase 2: Template Patterns + Resolution Rework (commit `1e1170d`)

- Replaced v1 regex patterns with v2 accessor-syntax patterns
- `LACE_MOUNT_TARGET_PATTERN`: `/\$\{lace\.mount\(([^)]+)\)\.target\}/g`
- `LACE_MOUNT_SOURCE_PATTERN`: `/\$\{lace\.mount\(([^)]+)\)\.source\}/g`
- `LACE_MOUNT_PATTERN`: `/\$\{lace\.mount\(([^)]+)\)\}/g` (bare form)
- Simplified `LACE_UNKNOWN_PATTERN` to single `mount\(` lookahead
- Reworked `resolveStringValue()` for three mount forms with correct match ordering (specific before general)
- Removed `buildMountTargetMap()` function (subsumed by `resolver.resolveTarget()`)
- Updated `autoInjectMountTemplates()` to emit bare `${lace.mount(label)}` form
- Updated all integration tests from v1 to v2 syntax
- 565 tests passing

### Phase 3: Auto-Injection Rework (commit `8a01395`)

- Reworked `autoInjectMountTemplates()` to accept `projectDeclarations` and `metadataMap`
- Added `buildMountDeclarationsMap()` for unified declarations from project + feature + prebuild feature
- Added `mountLabelReferencedInMounts()` for suppression detection in all accessor forms
- Return type: `MountAutoInjectionResult { injected, declarations }`
- Prebuild feature mount declarations treated identically to regular features (mounts are runtime config)
- Comprehensive suppression tests: bare, `.source`, `.target` forms all prevent duplicate injection
- 573 tests passing

### Phase 4: Pipeline Wiring + Validation + Guided Config (commit `4051963`)

- Added `validateMountNamespaces()`: validates each label's namespace is `project` or a known feature shortId
- Added `validateMountTargetConflicts()`: detects duplicate target paths across declarations
- Added `emitMountGuidance()`: emits guided config with `recommendedSource` suggestions
- Wired validation in `up.ts` between auto-injection and resolution (Step 3e)
- Wired guided config emission after resolution
- Added integration tests: project declarations with auto-injection, mount target in containerEnv, target conflict validation, feature mount declarations (end-to-end)
- Added unit tests for both validation functions
- 589 tests passing

### Phase 5: Migrate Lace Devcontainer (commit `f51de51`)

- Added `customizations.lace.mounts` section with `bash-history` and `claude-config` declarations
- Removed v1 mount template entries from mounts array (auto-injection handles them)
- Updated `containerEnv.CLAUDE_CONFIG_DIR` to `${lace.mount(project/claude-config).target}`
- Kept static mounts (SSH key, wezterm config) as-is
- 589 tests passing (no code changes, config migration only)

### Phase 6: Smoke Test

Ran `npx tsx src/index.ts up --workspace-folder /var/home/mjr/code/weft/lace --skip-devcontainer-up`:

**Pipeline output verified:**
- Fetched metadata for 6 features
- Auto-injected port templates: `wezterm-server/hostSshPort`
- Auto-injected mount templates: `project/bash-history, project/claude-config`
- Allocated port: `wezterm-server/hostSshPort: 22425`
- Resolved mount sources: default paths under `~/.config/lace/lace/mounts/project/`
- Guided config emitted with `recommendedSource` for `claude-config`
- Prebuild ran (up to date)
- Generated extended config

**Output `.lace/devcontainer.json` verified:**
- 4 mounts: 2 static + 2 auto-injected with concrete source paths
- `containerEnv.CLAUDE_CONFIG_DIR`: `/home/node/.claude` (resolved from `.target` accessor)
- Port entries: `appPort: ["22425:2222"]`, `forwardPorts: [22425]`, `portsAttributes` for wezterm-server
- Auto-created directories exist: `/home/mjr/.config/lace/lace/mounts/project/bash-history` and `claude-config`
- `mount-assignments.json`: 2 entries with correct paths, both `isOverride: false`

**Legacy v1 verification:**
- No `lace.mount.source(` or `lace.mount.target(` patterns remain in source code or config
- No `buildMountTargetMap` or `mountTargetMap` references remain

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/feature-metadata.ts` | Extended `LaceMountDeclaration`, added `parseMountDeclarationEntry()` |
| `packages/lace/src/lib/mount-resolver.ts` | Reworked: declarations-aware, `resolveSource/Target/FullSpec()` |
| `packages/lace/src/lib/template-resolver.ts` | v2 patterns, resolution rework, auto-injection, validation, guided config |
| `packages/lace/src/lib/up.ts` | Pipeline wiring: declarations, validation, resolver, guided config |
| `packages/lace/src/lib/__tests__/mount-resolver.test.ts` | Reworked for v2 API |
| `packages/lace/src/lib/__tests__/template-resolver.test.ts` | Reworked mount tests for v2, added validation tests |
| `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` | Reworked for v2, added declaration/validation tests |
| `packages/lace/src/lib/__tests__/feature-metadata.test.ts` | Extended for new declaration fields |
| `.devcontainer/devcontainer.json` | Migrated to v2: declarations + auto-injection |

## Verification

**Build & Lint:**
```
$ npx tsc --noEmit
(clean - no errors)
```

**Tests:**
```
Test Files  23 passed (23)
     Tests  589 passed (589)
  Duration  22.81s
```

**Runtime Verification:**
```
$ npx tsx src/index.ts up --workspace-folder /var/home/mjr/code/weft/lace
Fetching feature metadata...
Validated metadata for 6 feature(s)
Auto-injected port templates for: wezterm-server/hostSshPort
Auto-injected mount templates for: project/bash-history, project/claude-config
Allocated ports:
  wezterm-server/hostSshPort: 22425
Resolved mount sources:
  project/bash-history: /home/mjr/.config/lace/lace/mounts/project/bash-history
  project/claude-config: /home/mjr/.config/lace/lace/mounts/project/claude-config
Mount configuration:
  project/bash-history: using default path /home/mjr/.config/lace/lace/mounts/project/bash-history
  project/claude-config: using default path /home/mjr/.config/lace/lace/mounts/project/claude-config
    -> Recommended: configure source to ~/.claude in settings.json
```

**No legacy v1 code paths remain** - verified via ripgrep for `lace.mount.source(`, `lace.mount.target(`, `buildMountTargetMap`, `mountTargetMap`.
