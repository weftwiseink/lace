---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T13:25:00-07:00
task_list: lace/up-path-fixes
type: devlog
state: live
status: wip
tags: [lace_up, bugfix, iterate]
---

# Devlog: lace up path-fixes iterate (Bug 1 + Bug 2)

> BLUF: Implement `cdocs/proposals/2026-09-01-lace-up-path-fixes.md` (implementation_ready, R1-accepted): Bug 1 (canonicalize workspaceFolder + label-guarded name teardown) and Bug 2 (widen the drift fingerprint to features/build with a hybrid warn-live/auto-rebuild-idle response). Ship together.

## Brief (Turn 0)

**Proposal:** `cdocs/proposals/2026-09-01-lace-up-path-fixes.md` (accepted R1 after revision).
**Worktree/branch:** `/var/home/mjr/code/weft/lace/lace-up-fixes` on `lace-up-fixes` (off main @ da1af8a).
**Review:** `cdocs/reviews/2026-09-01-review-of-lace-up-path-fixes.md`.

### Scope
- Phase 1 (Bug 1): realpathSync-canonicalize workspaceFolder once at runUp entry (resolve() fallback); all three identity consumers read it; label-guarded (`lace.project_name`) name teardown before recreate.
- Phase 2 (Bug 2): add features + build to the drift fingerprint; hybrid response (running container -> warn+reuse; idle/absent -> auto-recreate) via a name-scoped podman ps probe that fails safe to warn.
- Both ship in one change set.

### Verification floor
`pnpm --filter lace typecheck` + `build` exit 0; the full lace test suite passes with the four rewritten config-drift exclusion tests (`:96-106`, `:108-118`, `:136-143`, `:261-271`) inverted, the hermetic Bug 1 identity test (temp-dir symlink, no host /home dependency), the label-guard negative test, the hybrid-branch tests, and the build-path-rewrite determinism guard all present and green.
Failure picture: canonicalization misses one of the three identity consumers so a `/home` vs `/var/home` mismatch still collides; OR the fingerprint change spuriously rebuilds every run (non-deterministic build hash); OR a running container gets auto-rebuilt out from under a live session; OR a load-bearing bit (`--buildkit never`, `dev_container_feature_content_temp` cleanup, prebuildFeatures guard) regressed.
Container-build proof is `deferred-to-followup` where it would need the four live containers; use throwaway fixtures/disposable names only.

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_proof | review_path | notes |
|---|---|---|---|---|---|---|
| 1 | impl-1 (opus-4-8) | pending | pending | - | - | Both phases implemented + committed. |

## Judge Log

| judge_iteration | trigger | verdict | rationale | judge_path |
|---|---|---|---|---|

## Turn 1 (impl-1): implementation narrative

Commits on `lace-up-fixes`:
- `7ef51a9` Phase 1 (Bug 1): canonicalization primitive + command-level use + identity tests.
- `1726c15` Phase 2 (Bug 2) + Bug 1 runUp wiring: widened fingerprint, hybrid response, teardown wiring, all tests.

### Phase 1 (Bug 1: path identity)
- `canonicalizeWorkspaceFolder(rawPath)` in `project-name.ts`: `realpathSync` with a `resolve()` fallback for non-existent paths.
  Co-located with the other identity functions so the hermetic identity test imports from one module.
- `runUp` (`up.ts`) canonicalizes once at entry (`rawWorkspaceFolder` -> `workspaceFolder`), before any identity is derived.
  All three consumers read the canonical value: the `devcontainer.local_folder` filter (`getContainerHostPorts`), `deriveProjectName`, and `--workspace-folder` (unchanged `runDevcontainerUp` reads the canonical `workspaceFolder`).
- `commands/up.ts` canonicalizes independently (review N1) so its `isContainerRunning` post-check and debug footer agree.
- Label-guarded teardown: `teardownStaleContainer(name, projectName, subprocess)` in `up.ts`, called before `devcontainer up` when `rebuild || recreateContainer`.
  Removes a container matching `name=^<resolvedName>$` AND `label=lace.project_name=<projectName>` only; tolerates probe/rm failure; WARNs when it actually removes something.

### Phase 2 (Bug 2: features/build drift)
- `config-drift.ts`: extended `RUNTIME_KEYS` with `"features"` and `"build"` (proposal shape 1). Comments renamed to "recreation fingerprint"; NOTE records the shape-2 (`BUILD_KEYS`) split as future work.
- Hybrid response in the `runUp` drift block: on `drift.drifted`, probe the running state (name-scoped `podman ps --filter status=running`).
  - `not-running` -> `recreateContainer = true`, log "Config changed (features, build, or runtime); container will be recreated."
  - `running` or `unknown` -> defer: WARN + reuse, and SKIP advancing the fingerprint so the change stays detectable next run. `--rebuild` still forces recreate.

### Deviation / design decision (surfaced per critical-analysis convention)
- **Shape-1 single fingerprint cannot distinguish features/build drift from runtime drift.**
  The proposal recommends shape 1 (one widened fingerprint) AND frames the hybrid as "features/build-specific."
  With one stored hash these are not separable, so the running-check hybrid is applied to ALL detected drift, not only features/build.
  Consequence: runtime-key drift (env/mount) on a *running* container now WARNs+reuses instead of recreating, whereas it previously recreated.
  This is consistent with the hard "never disrupt a live session / never auto-rebuild on ambiguity" directive and is the fail-safe reading; `--rebuild` is the override.
  The idle path is unchanged (still recreates).
  The affected existing test (`up.integration.test.ts` "auto-recreates ... without --rebuild") was updated to the idle path and a sibling running-branch test added.
  If the reviewer wants strict features/build-only gating, that requires a second fingerprint (shape 2).

### Verification
- `pnpm --filter lace typecheck`: exit 0.
- `pnpm --filter lace build`: exit 0.
- Full suite: 4 failures + 3 errors, ALL in `port-allocator.test.ts` (EADDRINUSE binding real ports 22430-22432 held by live containers). Reproduced identically on pristine `main`, so pre-existing and environmental, not a regression. All other 897 tests pass.
- Load-bearing bits confirmed untouched (`git diff` shows no change to `--buildkit never`, the `dev_container_feature_content_temp` rm/rmi, the `prebuildFeatures` guard, or the `--workspace-folder` push).
- Container-build failure pictures against live containers: deferred (constraint forbids rebuilding weftwise/clauthier/jif/whelm); all behavior is pinned by hermetic unit/integration tests with stubbed podman.
