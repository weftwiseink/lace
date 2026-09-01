---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T00:00:00-07:00
task_list: lace/prebuild-cache-rethink/legacy-builder-migration
type: devlog
state: live
status: wip
tags: [prebuild, migration, lace_prebuild_deletion, iterate]
---

# Devlog: Prebuild Removal Iterate (Phases 4-6)

> BLUF: Resume `2026-05-12-migrate-to-legacy-builder-cache.md` (stalled at Phase 2/7) under an /iterate loop, scoped to the reboot-safe phases: Phase 4 (lace code deletion), Phase 5 (test surface), Phase 6 (docs), plus flipping lace's own devcontainer config and adding a fail-loud guard for a lingering `prebuildFeatures` key.
> Hard constraint: the running containers weftwise, clauthier, jif must not be rebuilt or rebooted.

## Brief (Turn 0)

**Proposal:** `cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md` (`implementation_ready`, accepted R2).
**Worktree/branch:** `/var/home/mjr/code/weft/lace/prebuild-removal` on `prebuild-removal` (branched from `main` @ 61ec1ec). Destructive deletion stays on this branch; merge is the user's call.
**Devlog choice:** fresh devlog (prior Phase 1-2 work was 2026-05; no live devlog with this task_list to append to).

### Scope (in)
- Phase 4: delete prebuild code from the lace package (subcommands, lib files, strip branches from `up.ts` / `template-resolver.ts` / `validation.ts` / `devcontainer.ts` / `user-config-merge.ts` / `user-config.ts` / `index.ts`), per the proposal's exact line references.
- Phase 5: delete/trim the prebuild test surface.
- Phase 6: documentation update.
- Verify Phase 1 is moot (wezterm-server feature already removed from lace's tree).
- Flip lace's own `.devcontainer/devcontainer.json` `prebuildFeatures` -> `features` (proposal Phase 7 substep 1; safe because lace's container is not running).
- De-risk: post-deletion lace must fail loudly on an unrecognized `prebuildFeatures` config key (already specified at proposal line 100), not silently drop features.

### Scope (out / deferred follow-up)
- Phase 3: migrate other live user projects (clauthier, jif, whelm, ...) — requires rebuilds.
- Phase 7 live dogfood: `lace up` rebuilds against running containers.
- Closing the weftwise container-side SSH/tools verification gap.
- Reason: the three named containers must not be rebooted. Merge is gated on the lace test suite passing, not Phase 7's live rebuild.

### Verification floor
After deletion: `pnpm --filter lace build` (tsc) compiles with zero type errors; the lace unit + integration test suite passes with prebuild test files deleted/trimmed; `grep -rn "prebuildFeatures" packages/lace/src` returns zero references outside the fail-loud guard and its test; `grep -rn "BUILDAH_LAYERS" packages/lace/src` returns empty; invoking the lace CLI against a fixture config that still declares `prebuildFeatures` exits non-zero with an error naming the migration.
Failure picture: lace builds green but a config carrying `prebuildFeatures` silently drops those features with no error, OR the test suite still imports deleted modules, OR `--buildkit never` / `dev_container_feature_content_temp` cleanup was removed from the retained `runDevcontainerUp` site.
Container-build proof (the new warm-vs-cold cache-timing scenario) is `deferred-to-followup`: it is already empirically validated (weftwise 15x in the validating experiment) and re-proving it needs a live container build, which the reboot constraint defers to the eventual Phase 7 dogfood. Throwaway fixture containers are permitted; the three named running containers are not.

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_proof | review_path | notes |
|---|---|---|---|---|---|---|

## Judge Log

| judge_iteration | trigger | verdict | rationale | judge_path |
|---|---|---|---|---|
