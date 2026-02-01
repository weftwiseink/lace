---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T10:00:00-08:00
task_list: lace/packages-lace-cli
type: devlog
state: archived
status: completed
tags: [devcontainer, cli, prebuild, amendments, flock, bidirectional-tags]
---

# packages/lace Post-Implementation Amendments: Devlog

## Objective

Apply the four post-implementation amendments from the proposal checkpoint, plus cleanup. These amendments address design gaps identified after the initial 6-phase implementation:

1. **Preserve `.lace/prebuild/` on restore** — keep cache for re-prebuild and debugging
2. **Unix flock for concurrency** — prevent concurrent prebuilds from corrupting state
3. **Bidirectional tags (`parseTag`)** — restore should derive original FROM from `lace.local/` tag alone
4. **Lock file version pinning** — wire `extractPrebuiltEntries()` into prebuild for reproducibility

## Plan

1. Add `parseTag` to `dockerfile.ts` as inverse of `generateTag`, with round-trip tests
2. Update `restore.ts`: use `parseTag` as primary path, metadata as fallback; remove `rmSync` cleanup
3. Update `prebuild.ts`: add cache reactivation path (rewrite FROM without rebuild when cache is fresh but Dockerfile is restored)
4. Update `status.ts`: distinguish "active" vs "cached" states
5. Add `flock.ts`: thin wrapper using Unix `flock(1)` command + fd passing
6. Wire flock into `prebuild.ts` and `restore.ts`
7. Wire `extractPrebuiltEntries()` into prebuild temp context generation
8. Update all affected tests (unit, integration, e2e, smoke)
9. Run full test suite + typecheck

## Testing Approach

Test-first for `parseTag` (round-trip property tests against `generateTag`). For behavioral changes (restore preservation, cache reactivation), update existing tests to match new semantics. Flock tested with unit tests for acquisition, release, error propagation, and reacquisition.

## Implementation Notes

### Amendment 3: `parseTag` (bidirectional tags)

`parseTag` reverses `generateTag` by stripping the `lace.local/` prefix and detecting the `from_` digest encoding:

- `lace.local/node:24-bookworm` → `node:24-bookworm` (strip prefix)
- `lace.local/ghcr.io/owner/image:v2` → `ghcr.io/owner/image:v2` (strip prefix)
- `lace.local/node:from_sha256__abc123` → `node@sha256:abc123` (detect `from_` prefix, convert `__` back to `:`)
- `lace.local/node:latest` → `node:latest` (acceptable ambiguity: original may have been untagged)

The tag-colon separator is found by searching for the first colon after the last slash, which correctly handles registry:port images like `lace.local/registry:5000/node:24`.

### Amendment 1: Preserve `.lace/prebuild/` on restore

Removed `rmSync` and `existsSync` from `restore.ts`. The cached context, metadata, and lock data persist after restore. This enables:

- **Cache reactivation**: `lace prebuild` after `lace restore` detects the cache is fresh and rewrites the Dockerfile without rebuilding the Docker image.
- **Debugging**: inspect `.lace/prebuild/` to see what the last prebuild used.

### Cache reactivation (emergent from Amendment 1)

With `.lace/prebuild/` preserved after restore, a new code path was needed in `prebuild.ts`: when `contextsChanged()` returns false (cache fresh) but the Dockerfile doesn't have `lace.local/` (restored), the pipeline rewrites the FROM line and updates metadata without calling `devcontainer build`. This is the fast path for the `restore → commit → re-prebuild` workflow.

### Amendment 3 in restore: metadata-free path

`restore.ts` now uses `parseTag` as the primary path to determine the original FROM reference. It parses the Dockerfile to get the current `lace.local/` image reference, then calls `parseTag` to reverse it. Metadata is a fallback for edge cases where parsing fails. This means `lace restore` works even if `.lace/prebuild/metadata.json` is missing or corrupted.

### Amendment 1+3 in status: active vs cached

`status.ts` now distinguishes three states:
- **No active prebuild**: no metadata exists
- **Prebuild active**: metadata exists AND Dockerfile has `lace.local/` reference
- **Prebuild cached**: metadata exists but Dockerfile has been restored

The cached state includes a hint: `restored (run \`lace prebuild\` to reactivate)`.

### Amendment 2: flock

`withFlockSync` in `flock.ts` uses the Unix `flock(1)` command with fd passing via `spawnSync`. The approach:

1. Open the lock file (`openSync`)
2. Pass the fd as `stdio[3]` to the child process
3. Child runs `flock -xn 3` — acquires exclusive non-blocking lock on the shared file description
4. Lock persists in the parent process (same file description) after child exits
5. `closeSync` releases the lock in the `finally` block

If `flock(1)` is not available (unlikely on Linux), the wrapper degrades gracefully with a warning. If the lock is held by another process, it throws immediately.

Flock is wired into the CLI command layer (`commands/prebuild.ts` and `commands/restore.ts`), not the library layer. This means the lock is only acquired when running via the CLI, and tests (which call library functions directly) run without contention.

### Amendment 4: Lock file version pinning

`extractPrebuiltEntries()` is now called in the prebuild pipeline before `devcontainer build`. It reads the `lace.prebuiltFeatures` namespace from the project lock file and writes those entries as `features` in the temp context's lock file. This gives `devcontainer build` prior version pins for reproducibility.

### Status updated across all modules

`parseTag` is now used consistently in `prebuild.ts` (for restoring lace.local FROM before re-prebuild) and `status.ts` (for restoring before context comparison), in addition to `restore.ts`. All three use metadata as a fallback.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/dockerfile.ts` | Added `parseTag()` as inverse of `generateTag()` |
| `packages/lace/src/lib/restore.ts` | Metadata-free restore via `parseTag`, removed `rmSync` cleanup |
| `packages/lace/src/lib/prebuild.ts` | Cache reactivation path, `parseTag`-based FROM restoration, lock file seeding |
| `packages/lace/src/lib/status.ts` | Active vs cached state distinction, `parseTag` for FROM restoration |
| `packages/lace/src/lib/flock.ts` | NEW: `withFlockSync` using Unix flock(1) with fd passing |
| `packages/lace/src/commands/prebuild.ts` | Wire flock around prebuild pipeline |
| `packages/lace/src/commands/restore.ts` | Wire flock around restore pipeline |
| `packages/lace/src/lib/__tests__/dockerfile.test.ts` | Added 14 `parseTag` tests + 6 round-trip tests |
| `packages/lace/src/lib/__tests__/flock.test.ts` | NEW: 4 flock unit tests |
| `packages/lace/src/commands/__tests__/restore.integration.test.ts` | Added metadata-free tests, preservation tests |
| `packages/lace/src/commands/__tests__/status.integration.test.ts` | Added cached state test |
| `packages/lace/src/__tests__/e2e.test.ts` | Updated lifecycle for cached state, added cache reactivation test |
| `packages/lace/src/__tests__/docker_smoke.test.ts` | Updated for preserved cache, added cache reactivation smoke test |

## Verification

### Build & Typecheck

```
> lace@0.1.0 typecheck
> tsc --noEmit
(clean — no errors)

> lace@0.1.0 build
> vite build
✓ 14 modules transformed.
dist/index.js  21.56 kB │ gzip: 5.31 kB │ map: 53.82 kB
✓ built in 80ms
```

### Tests

```
 ✓ src/lib/__tests__/validation.test.ts (10 tests)
 ✓ src/lib/__tests__/metadata.test.ts (10 tests)
 ✓ src/lib/__tests__/lockfile.test.ts (13 tests)
 ✓ src/lib/__tests__/flock.test.ts (4 tests)
 ✓ src/lib/__tests__/devcontainer.test.ts (21 tests)
 ✓ src/lib/__tests__/dockerfile.test.ts (61 tests)
 ✓ src/commands/__tests__/restore.integration.test.ts (6 tests)
 ✓ src/commands/__tests__/prebuild.integration.test.ts (12 tests)
 ✓ src/commands/__tests__/status.integration.test.ts (5 tests)
 ✓ src/__tests__/e2e.test.ts (4 tests)
 ✓ src/__tests__/docker_smoke.test.ts (8 tests) 40078ms

 Test Files  11 passed (11)
      Tests  154 passed (154)
```

### Docker Smoke Tests

8 tests against real Docker daemon (~40s):

1. Full prebuild lifecycle — verified
2. Prebuild then restore — verified `.lace/prebuild/` preserved, status reports "cached"
3. **Cache reactivation** (NEW) — verified re-prebuild after restore reuses cache without Docker build
4. Cache skip (idempotency) — verified
5. Force rebuild — verified
6. Config change detection — verified
7. Lock file integration — verified
8. Dry run — verified
