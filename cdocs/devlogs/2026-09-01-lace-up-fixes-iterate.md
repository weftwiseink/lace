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

## Judge Log

| judge_iteration | trigger | verdict | rationale | judge_path |
|---|---|---|---|---|
