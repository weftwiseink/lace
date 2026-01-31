---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T14:00:00-08:00
task_list: lace/packages-lace-cli
type: devlog
state: live
status: review_ready
tags: [devcontainer, cli, prebuild, npm, typescript, implementation]
---

# packages/lace CLI Implementation: Devlog

## Objective

Implement the `packages/lace` devcontainer wrapper CLI as specified in `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`.

The lace CLI pre-bakes devcontainer features onto base images at build time, eliminating cold-start installation delays during `devcontainer up`. It reads `customizations.lace.prebuildFeatures` from devcontainer.json, runs `devcontainer build` against a temporary context cached in `.lace/prebuild/`, and rewrites the Dockerfile's first `FROM` line to use the pre-baked image.

## Plan

Follow the proposal's six implementation phases sequentially:

1. **Phase 1**: Package scaffold — pnpm workspace, TypeScript, Vite, Vitest, CLI skeleton
2. **Phase 2**: Dockerfile parsing and rewriting — `dockerfile-ast`, FROM extraction, tag generation, rewrite/restore
3. **Phase 3**: devcontainer.json reading, validation, temp context generation — `jsonc-parser`, arktype, overlap detection
4. **Phase 4**: Prebuild pipeline orchestration — metadata, subprocess, cache comparison, --dry-run, --force
5. **Phase 5**: Lock file merging — namespaced `lace.prebuiltFeatures` entries
6. **Phase 6**: restore, status commands, end-to-end polish

## Testing Approach

Test-first methodology as specified in the proposal. Tests use vitest with fixtures in `src/__fixtures__/`. Integration tests mock the `devcontainer build` subprocess. All tests marked with `// IMPLEMENTATION_VALIDATION` comment.

## Implementation Notes

### Phase 1: Package scaffold
- Used `citty` for CLI framework (lightweight, ESM-native, subcommand support).
- Root `package.json` + `pnpm-workspace.yaml` created; `packages/lace/` is a workspace member.
- Vite builds to `dist/index.js` with shebang preserved.
- Added `@types/node` for TypeScript `console`/`process` globals.
- `.lace/`, `node_modules/`, `dist/` added to `.gitignore`.

### Phase 2: Dockerfile parsing
- `dockerfile-ast` separates `getRegistry()` from `getImageName()` — needed to recombine them for full image references like `ghcr.io/owner/image` or `registry:5000/node`.
- Round-trip invariant (parse → rewrite → restore = original) validated for all fixture types.
- Pure string-based module — no file I/O, no subprocess calls.

### Phase 3: devcontainer.json and validation
- `jsonc-parser` handles comments and trailing commas in devcontainer.json.
- Discriminated union result for `extractPrebuildFeatures`: features/absent/null/empty.
- Feature overlap comparison is version-insensitive (strips version tag after last colon).
- `arktype` imported as a dependency per proposal but not yet used for runtime validation — config shape is validated structurally. Can be wired in for stricter validation in a follow-up.

> NOTE(opus/implementation): arktype is listed as a dependency but not actively used for runtime type validation in this initial implementation. The structural checks are sufficient for v1; arktype schemas can be added for stricter validation without API changes.

### Phase 4: Prebuild pipeline
- Pipeline is atomic: `devcontainer build` failure leaves Dockerfile untouched.
- Temp context comparison normalizes JSON whitespace to avoid spurious rebuilds.
- When Dockerfile already has `lace.local/` FROM (from previous prebuild), it is restored to original before re-prebuild.
- Subprocess abstracted behind `RunSubprocess` type for clean test injection.

### Phase 5: Lock file merging
- Prebuild entries namespaced under `lace.prebuiltFeatures` in devcontainer-lock.json.
- Second prebuild cycle fully replaces first's namespaced entries.
- Top-level entries (from `devcontainer up`) never modified.

### Phase 6: restore, status, e2e
- `lace restore` reads original FROM from metadata, restores Dockerfile, cleans up `.lace/prebuild/`.
- `lace status` reports active prebuild state and detects config staleness.
- E2e tests validate full lifecycle: prebuild → status → restore → status, config changes, re-prebuild.

## Changes Made

| File | Description |
|------|-------------|
| `package.json` | Root workspace package.json |
| `pnpm-workspace.yaml` | pnpm workspace with packages/* |
| `.gitignore` | Added .lace/, node_modules/, dist/ |
| `packages/lace/package.json` | CLI package with citty, arktype, dockerfile-ast, jsonc-parser |
| `packages/lace/tsconfig.json` | Node16 ESM strict TypeScript config |
| `packages/lace/vite.config.ts` | Vite build for Node CLI |
| `packages/lace/src/index.ts` | CLI entry point with citty subcommands |
| `packages/lace/src/commands/prebuild.ts` | Prebuild command (citty wrapper) |
| `packages/lace/src/commands/restore.ts` | Restore command (citty wrapper) |
| `packages/lace/src/commands/status.ts` | Status command (citty wrapper) |
| `packages/lace/src/lib/dockerfile.ts` | Dockerfile parsing, tag gen, rewrite/restore |
| `packages/lace/src/lib/devcontainer.ts` | devcontainer.json JSONC reading, config extraction |
| `packages/lace/src/lib/validation.ts` | Feature overlap validation |
| `packages/lace/src/lib/prebuild.ts` | Full prebuild pipeline orchestration |
| `packages/lace/src/lib/metadata.ts` | .lace/prebuild/ metadata read/write/compare |
| `packages/lace/src/lib/lockfile.ts` | Lock file namespaced merging |
| `packages/lace/src/lib/subprocess.ts` | Mockable subprocess wrapper |
| `packages/lace/src/lib/restore.ts` | Restore pipeline logic |
| `packages/lace/src/lib/status.ts` | Status pipeline logic |
| `packages/lace/src/__fixtures__/` | 15 Dockerfile, 8 devcontainer.json, 4 lockfile fixtures |
| `packages/lace/src/lib/__tests__/` | Unit tests for dockerfile, devcontainer, validation, metadata, lockfile |
| `packages/lace/src/commands/__tests__/` | Integration tests for prebuild, restore, status |
| `packages/lace/src/__tests__/e2e.test.ts` | End-to-end lifecycle tests |

## Verification

### Build & Typecheck

```
> lace@0.1.0 typecheck
> tsc --noEmit
(clean — no errors)

> lace@0.1.0 build
> vite build
✓ 13 modules transformed.
dist/index.js  18.02 kB │ gzip: 4.52 kB │ map: 44.94 kB
✓ built in 81ms
```

### Tests

```
 ✓ src/lib/__tests__/validation.test.ts (10 tests)
 ✓ src/lib/__tests__/lockfile.test.ts (13 tests)
 ✓ src/lib/__tests__/metadata.test.ts (10 tests)
 ✓ src/lib/__tests__/devcontainer.test.ts (17 tests)
 ✓ src/lib/__tests__/dockerfile.test.ts (43 tests)
 ✓ src/commands/__tests__/prebuild.integration.test.ts (12 tests)
 ✓ src/commands/__tests__/restore.integration.test.ts (3 tests)
 ✓ src/commands/__tests__/status.integration.test.ts (4 tests)
 ✓ src/__tests__/e2e.test.ts (4 tests)

 Test Files  9 passed (9)
      Tests  116 passed (116)
```

### CLI Verification

```
$ lace --help
Devcontainer orchestration CLI (lace v0.1.0)

USAGE lace prebuild|restore|status

COMMANDS
  prebuild    Pre-bake devcontainer features onto the base image for faster startup
   restore    Undo the prebuild FROM rewrite, restoring the original Dockerfile
    status    Show current prebuild state (original image, prebuild image, staleness)
```

### Deferred Work

- **arktype runtime validation**: Listed as a dependency but not actively used. Config shape is validated structurally. Can add arktype schemas in a follow-up for stricter validation.
- **Manual verification against real Docker**: Requires Docker daemon. Tagged `// REQUIRES_DOCKER` per proposal. Should be done in a Docker-available environment.
- **Lock file restoration in temp context**: When running prebuild, the previous namespaced lock entries should be extracted and placed in the temp context's lock file for version pinning. Currently the prebuild works without this (devcontainer CLI resolves fresh), but for lock file reproducibility this should be wired.
