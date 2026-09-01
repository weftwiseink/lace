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

## Work Narrative

### Phase 1 moot check (confirmed moot)

The `wezterm-server` feature no longer exists in lace's tree.
The in-tree feature source directories are: `blesh`, `claude-code`, `lace-fundamentals`, `neovim`, `portless`, `sprack` (under `devcontainers/features/src/`).
There is no `wezterm-server` feature source or directory anywhere outside `node_modules`.
Test comments record the deletion directly: `claude-code-scenarios.test.ts:281` and `portless-scenarios.test.ts:187` both state "The wezterm-server feature was deleted in commit 7f6ca1d."
Residual `wezterm-server` references are docs prose (`README.md`, `architecture.md`, `troubleshooting.md`), test fixtures, and `port-allocator.ts` example-label comments: none is a live feature that exercises the asymmetric `appPort` injection path.
Conclusion: no in-tree feature drives `injectForPrebuildBlock`, so its deletion (Phase 4 substep 4) is unblocked.

### Phase 4: lace code deletion

Deleted whole files: `commands/{prebuild,restore,status}.ts`, `lib/{prebuild,restore,status,metadata,lockfile,validation}.ts`.
`validation.ts` went entirely (both `validateNoOverlap` and its private `featureIdentifier` were prebuild-only and imported only by the deleted `prebuild.ts`).

Stripped prebuild branches from the retained files:
- `up.ts`: removed the prebuild imports, the `hasPrebuildFeatures` gate, the `runPrebuild` phase and its full-config read, the `rawPrebuildFeatures`/`allRawFeatures` spread (now `allFeatureIds = Object.keys(rawFeatures)`), the Step-2 `warnPrebuildPortTemplates` and Step-6 `warnPrebuildPortFeaturesStaticPort` calls, the prebuild spread in the mount-namespace `featureShortIds` set, the prebuild arm of the lace-fundamentals `defaultShell` injection (kept the `features[fundamentalsRef]` arm), the Phase-0c `mergedPrebuildFeatures` write-back, and `phases.prebuild`. Retained `--buildkit never` and the `dev_container_feature_content_temp` cleanup verbatim at the `runDevcontainerUp` site.
- `template-resolver.ts`: removed `extractPrebuildFeaturesRaw`, `injectForPrebuildBlock`, `warnPrebuildPortTemplates`, `warnPrebuildPortFeaturesStaticPort`; collapsed `autoInjectPortTemplates` and `resolveTemplates` to the `features`-only path.
- `validation.ts` deleted; `devcontainer.ts` lost `extractPrebuildFeatures`, `generateTempDevcontainerJson`, and the `PrebuildFeaturesResult` type; `user-config-merge.ts` `applyUserConfig` lost the `projectPrebuildFeatures` param and the `mergedPrebuildFeatures` return field and routing branch; `index.ts` lost the three subcommand registrations.

Fail-loud guard (scope item 3): added an early check in `runUp` (`up.ts` ~237) that exits non-zero with a migration-pointing error when a parsed config still carries `customizations.lace.prebuildFeatures`. This is the sole remaining `prebuildFeatures` reference in non-test source.

`BUILDAH_LAYERS=false` was removed with `prebuild.ts` and is not re-introduced anywhere.

Deviations from the proposal's literal instructions:
- **`dockerfile.ts` NOT deleted wholesale.** It still exports `parseDockerfileUser`, which the retained `devcontainer.ts:extractRemoteUser` depends on and which is not in the proposal's prebuild-only function list. The file was reduced to just `parseDockerfileUser` (+ its `DockerfileParser` import); every prebuild-only helper (`parseDockerfile`, `generateTag`, `parseTag`, `rewriteFrom`, `restoreFrom`, `generatePrebuildDockerfile`, `parseImageRef`, `generateImageDockerfile`) was removed. The `dockerfile.test.ts` deletion is correspondingly partial (see Phase 5).
- **Phase 4 substep 8 (`user-config.ts`: remove `prebuildFeatures` from the schema) was a no-op.** `user-config.ts`'s `UserConfig` interface never had a `prebuildFeatures` field, and there are no JSON-schema files in the package carrying the key. Nothing to remove.
- Also cleaned up now-inaccurate user-facing text: the `git prebuild feature` remediation strings in `workspace-detector.ts` and the `lace up` help text became `git feature` / prebuild-free wording (history-agnostic framing).

Non-test src typecheck: 0 errors after the strip (test-file errors remain until Phase 5).

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_proof | review_path | notes |
|---|---|---|---|---|---|---|

## Judge Log

| judge_iteration | trigger | verdict | rationale | judge_path |
|---|---|---|---|---|
