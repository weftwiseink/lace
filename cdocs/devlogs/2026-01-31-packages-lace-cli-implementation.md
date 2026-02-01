---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T14:00:00-08:00
task_list: lace/packages-lace-cli
type: devlog
state: archived
status: completed
tags: [devcontainer, cli, prebuild, npm, typescript, implementation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T20:30:00-08:00
  round: 2
---

# packages/lace CLI Implementation: Devlog

## Objective

Implement the `packages/lace` devcontainer wrapper CLI as specified in `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`.

The lace CLI pre-bakes devcontainer features onto base images at build time, eliminating cold-start installation delays during `devcontainer up`. It reads `customizations.lace.prebuildFeatures` from devcontainer.json, runs `devcontainer build` against a temporary context cached in `.lace/prebuild/`, and rewrites the Dockerfile's first `FROM` line to use the pre-baked image.

## Plan

Follow the proposal's six implementation phases sequentially:

1. **Phase 1**: Package scaffold — pnpm workspace, TypeScript, Vite, Vitest, CLI skeleton
2. **Phase 2**: Dockerfile parsing and rewriting — `dockerfile-ast`, FROM extraction, tag generation, rewrite/restore
3. **Phase 3**: devcontainer.json reading, validation, temp context generation — `jsonc-parser`, overlap detection
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
- `arktype` was listed in the proposal but removed during cleanup — structural validation is sufficient for v1, and carrying an unused dependency adds noise.

### Phase 4: Prebuild pipeline
- Pipeline is atomic: `devcontainer build` failure leaves Dockerfile untouched.
- Temp context comparison normalizes JSON whitespace to avoid spurious rebuilds.
- When Dockerfile already has `lace.local/` FROM (from previous prebuild), it is restored to original before re-prebuild.
- Subprocess abstracted behind `RunSubprocess` type for clean test injection.
- The `devcontainer build` invocation requires an explicit `--config` flag because the temp context writes files to `.lace/prebuild/` (not `.lace/prebuild/.devcontainer/`). This was a latent bug found during Docker smoke testing — all prior tests used mocked subprocesses and didn't exercise the real CLI.

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
| `packages/lace/package.json` | CLI package with citty, dockerfile-ast, jsonc-parser |
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
| `packages/lace/src/__tests__/docker_smoke.test.ts` | Docker smoke tests (real devcontainer CLI + Docker) |
| `packages/lace/README.md` | Full package documentation |

## Verification

### Build & Typecheck

```
> lace@0.1.0 typecheck
> tsc --noEmit
(clean — no errors)

> lace@0.1.0 build
> vite build
✓ 13 modules transformed.
dist/index.js  18.19 kB │ gzip: 4.56 kB │ map: 45.02 kB
✓ built in 80ms
```

### Tests

```
 ✓ src/lib/__tests__/validation.test.ts (10 tests)
 ✓ src/lib/__tests__/lockfile.test.ts (13 tests)
 ✓ src/lib/__tests__/metadata.test.ts (10 tests)
 ✓ src/lib/__tests__/devcontainer.test.ts (21 tests)
 ✓ src/lib/__tests__/dockerfile.test.ts (47 tests)
 ✓ src/commands/__tests__/prebuild.integration.test.ts (12 tests)
 ✓ src/commands/__tests__/restore.integration.test.ts (3 tests)
 ✓ src/commands/__tests__/status.integration.test.ts (4 tests)
 ✓ src/__tests__/e2e.test.ts (4 tests)
 ✓ src/__tests__/docker_smoke.test.ts (7 tests) 35342ms

 Test Files  10 passed (10)
      Tests  131 passed (131)
```

### Docker Smoke Tests

7 tests exercise the real `devcontainer` CLI and Docker daemon:

1. Full prebuild lifecycle — verifies Docker image exists, Dockerfile rewritten, metadata written, status reports "up to date"
2. Prebuild then restore — verifies Dockerfile restored, `.lace/prebuild/` cleaned, status reports inactive
3. Cache skip (idempotency) — second run with same config returns "up to date"
4. Force rebuild — `--force` bypasses cache
5. Config change detection — changing feature options triggers rebuild
6. Lock file integration — graceful behavior when `devcontainer build` produces no lock file
7. Dry run — no Docker image created, no filesystem modifications

These tests found a latent bug: the `devcontainer build` invocation was missing the `--config` flag. The temp context at `.lace/prebuild/` writes `devcontainer.json` directly (not under `.devcontainer/`), so the explicit path is required. All prior tests used mocked subprocesses and didn't exercise this code path.

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

## Cleanup Round

After the initial implementation and two review rounds, a cleanup pass addressed:

### Code fixes
- **Bug fix (from Docker smoke tests)**: Added `--config` flag to `devcontainer build` invocation in `prebuild.ts` — latent bug only exposed by real Docker execution.
- **Error context**: Bare `catch` block in `prebuild.ts` Dockerfile read now captures the underlying error reason (`ENOENT`, `EACCES`, etc.).
- **Removed unused `arktype` dependency**: Removed from `package.json` and `vite.config.ts` externals. Structural validation is sufficient.
- **Removed unused imports**: `vi` from `prebuild.integration.test.ts`, `extractPrebuildFeatures` from `restore.ts`.

### Test improvements
- Added `arg-prelude.Dockerfile` and `arg-substitution.Dockerfile` to the round-trip test suite (core correctness invariant).
- Added tests exercising 4 previously unused fixtures: `image-based.jsonc`, `overlap.jsonc`, `legacy-dockerfile-field.jsonc`, `nested-build-path.jsonc`.
- Added Docker smoke test suite (7 tests against real Docker, ~35s).

### Documentation
- `packages/lace/README.md`: Full package documentation covering usage, configuration, pipeline internals, `lace.local/` convention, API reference, and workflow tips.

### Deferred Work

- **Lock file restoration in temp context**: When running prebuild, the previous namespaced lock entries should be extracted and placed in the temp context's lock file for version pinning. Currently the prebuild works without this (devcontainer CLI resolves fresh), but for lock file reproducibility this should be wired. The `extractPrebuiltEntries()` function is tested and ready to wire in.

---

## Checkpoint: Phases 1-6 Complete

**Date**: 2026-01-31
**State**: All 6 proposal phases implemented, reviewed (2 rounds, accepted), cleanup round complete.

### What's done

- Full prebuild pipeline: config extraction, Dockerfile AST parsing, temp context generation, `devcontainer build` invocation, FROM rewriting, lock file merging, metadata caching.
- CLI commands: `lace prebuild` (with `--dry-run`, `--force`), `lace restore`, `lace status`.
- 131 tests across 10 files, including 7 Docker smoke tests against real Docker.
- README.md with full usage, API, and internals documentation.
- Clean typecheck, 18KB build.

### What remains (from proposal amendments)

Three post-implementation amendments were added to the proposal to guide the next phase of work:

1. **Preserve `.lace/prebuild/` on restore**: Currently `lace restore` deletes the directory. Change it to only rewrite the Dockerfile FROM line, leaving cached context intact for re-prebuild and debugging.

2. **Unix flock for concurrency**: Add file locking using the Unix `flock` API to prevent concurrent prebuilds from corrupting shared state. No Windows support needed.

3. **Metadata-free restore (bidirectional tags)**: `lace restore` currently depends on `.lace/prebuild/metadata.json` to recover the original FROM reference. The `lace.local/` tag format should be reversible from the tag alone — add a `parseTag` function as the inverse of `generateTag`, and make `lace restore` use it as the primary path (metadata as optional fallback). Add round-trip tests for all tag formats.

Plus the existing deferred item:

4. **Lock file version pinning in temp context**: Wire `extractPrebuiltEntries()` into the prebuild pipeline to feed prior lock entries into the temp context for reproducibility.

### Testing and debugging methodology

The approach used throughout this implementation, for reference when resuming:

**Test structure**: Three tiers — unit tests (pure functions on strings/objects, fixture-based), integration tests (real filesystem with mocked subprocess), and Docker smoke tests (real `devcontainer` CLI + Docker daemon). Unit and integration tests run in ~500ms; smoke tests in ~35s.

**Test-first**: Each module's tests were written before implementation, following the proposal's test plan tables. Tests marked `// IMPLEMENTATION_VALIDATION` per the proposal convention.

**Fixture-based**: Static fixture files in `src/__fixtures__/` (15 Dockerfiles, 8 devcontainer JSONs, 4 lock files) are shared across test suites. New edge cases are added as fixtures, not inline strings, so they're reusable.

**Subprocess injection**: The `RunSubprocess` type in `subprocess.ts` allows integration tests to inject a mock that captures calls and returns canned responses, without patching globals. Docker smoke tests omit this parameter to use the real implementation.

**Round-trip invariant**: The core correctness check is `parse → rewrite → restore = original`, validated for every valid Dockerfile fixture. This catches subtle rewriting bugs that individual assertions might miss.

**Bug surfacing through smoke tests**: The `--config` flag bug was only found by the Docker smoke tests — mocked subprocess tests couldn't detect that the real `devcontainer` CLI needs explicit config paths when the workspace doesn't use `.devcontainer/` layout. This validates the value of the smoke test tier.

**Review-driven iteration**: Two cdocs review rounds caught issues (regex in status.ts, missing test coverage for fixtures, unused imports/dependencies) that were addressed in a cleanup pass before the checkpoint.
