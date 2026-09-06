---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T00:00:00-07:00
task_list: lace/prebuild-cache-rethink/legacy-builder-migration
type: devlog
state: live
status: done
last_reviewed:
  status: accepted
  by: "@claude-opus-4-8"
  at: 2026-09-01T09:55:00-07:00
  round: 1
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

### Phase 5: test surface

Deleted whole test files: `lib/__tests__/{lockfile,metadata,validation}.test.ts`, `commands/__tests__/{prebuild,restore,status}.integration.test.ts`, `__tests__/e2e.test.ts`.

Trimmed prebuild cases from the surviving files:
- `template-resolver.test.ts`: removed the `extractPrebuildFeaturesRaw` suite, the `injectForPrebuildBlock` T1-T5 sub-cases, the prebuild mount-declaration cases, the `resolveTemplates` T4/T5 prebuild appPort cases, and the `warnPrebuildPortTemplates` / `warnPrebuildPortFeaturesStaticPort` suites. Converted the T6 feature-ID-collision case to a collision within the `features` block (collision detection now runs on `features` only).
- `devcontainer.test.ts`: removed the `extractPrebuildFeatures` and `generateTempDevcontainerJson` suites.
- `user-config-merge.test.ts`: dropped the "user features go into prebuildFeatures" case, replaced it with a same-id user/project merge case, and fixed `applyUserConfig` call arity (3 args).
- `up.integration.test.ts`: removed the prebuild-only, full-config-with-prebuild, and T9-T12 prebuild-port describes; rewrote Scenario 4 and the "no repo mounts" case to drop prebuild.
- `dockerfile.test.ts`: reduced to the `parseDockerfileUser` suite (the only retained function).
- `portless-scenarios.test.ts`: P1 (asymmetric) removed; P2 migrated to top-level `features` (symmetric mapping); P1 rewritten as the symmetric-injection case.
- `claude-code-scenarios.test.ts`: removed C7.
- `docker_smoke.test.ts`: the entire file was prebuild-lifecycle; gutted and repurposed as the home for the deferred warm-vs-cold scenario placeholder (`it.todo`, see below).

Fail-loud guard test: `validate.test.ts` now asserts a config carrying `customizations.lace.prebuildFeatures` exits non-zero with a message naming `prebuildFeatures`, `features`, and the migration doc.

Fixtures: deleted the four unused prebuild fixtures (`comments-and-trailing-commas`, `empty-prebuild`, `null-prebuild`, `overlap`); stripped the now-inert `customizations.lace.prebuildFeatures` block from the four still-used build-source fixtures (`standard`, `legacy-dockerfile-field`, `image-based`, `nested-build-path`).

Phase 5 substep 3 (warm-vs-cold cache-timing scenario): DEFERRED to follow-up. It requires two live container builds on the legacy builder, which the reboot constraint forbids. Left as `it.todo` with a `TODO(opus/prebuild-removal)` in `docker_smoke.test.ts` (behaviour already empirically validated: 234s cold / 16s warm in the validating experiment).

Verification-floor results (verbatim in the report). One test fails: `port-allocator.test.ts > reuses saved port when it is in ownedPorts even if port is blocked`.
This is ENVIRONMENTAL and pre-existing, not a regression: `port-allocator.ts` and its test are byte-identical to `main` (empty `git diff main`), and the failure is an OS-level `EADDRINUSE` on `::1:22431`, a port held by `pasta.avx2` (pid 1037058), the rootless-podman networking process of one of the reboot-protected running containers. The test binds a real socket to 22431 to simulate a blocked port; the live container already owns it. It cannot be fixed without killing that container (forbidden) or editing an unrelated test (out of scope). All 881 other tests pass (3 skipped, 1 todo).

### Phase 6: documentation

- `docs/prebuild.md`: rewritten from a pipeline-internals reference into a "Migration: `lace prebuild` removed" note (what changed, migration steps, one-time cleanup).
- `README.md`: dropped the `lace prebuild`/`restore`/`status` subcommand sections and the `## Prebuilds` section (replaced with `## Features and warm builds`); removed the prebuild pipeline step; retitled the workflow, file-layout, and hardcoded-defaults sections; migrated the portless section from asymmetric `prebuildFeatures` to symmetric top-level `features`. Remaining prebuild mentions are qualifying migration callouts.
- `docs/migration.md`: Step 4 converted from "add prebuilds" to "Warm builds" plus a "Migrating off `lace prebuild` (2026-05)" subsection; fixed the "What NOT to migrate" Dockerfile-rewrite claims.
- `docs/troubleshooting.md`: replaced the obsolete "Prebuild image missing" section with "Feature install env-order conflicts" (the env-order guidance from the proposal's Edge Cases), and removed the now-obsolete "Lock file contention" section (no flock remains in `lace up`; it lived only in the deleted subcommands). Renumbered the trailing sections.
- `docs/architecture.md` (not enumerated in the proposal but listed in the source-analysis report's doc set): removed the Prebuilds pipeline box, the layer-to-step Prebuilds row (13 steps now), the prebuild dependency-flow bullet, and the `lace.local/*` / `.lace/prebuild` storage references.

House conventions followed: history-agnostic framing (the removed approach appears only in qualifying migration callouts), colons over em-dashes, no emoji. Cross-doc anchor links to the new env-order section point at `#3-feature-install-env-order-conflicts`.

Deviation note: `docs/architecture.md` and the portless docs were touched beyond the five enumerated Phase 6 substeps, because leaving them describing the deleted pipeline as current would violate history-agnostic framing. `flock.ts` is now unreferenced dead code (its only callers were the deleted subcommands); left in place since it is not on the proposal's deletion list and is harmless.

### Verification Results (final)

- `pnpm --filter lace typecheck` (tsc --noEmit): exit 0, zero type errors.
- `pnpm --filter lace build` (vite): exit 0, `dist/index.js 154.39 kB`.
- `pnpm --filter lace test`: `Test Files 1 failed | 35 passed | 1 skipped`, `Tests 1 failed | 881 passed | 3 skipped | 1 todo`. The single failure is the environmental `port-allocator.test.ts` case (see Phase 5 note: port 22431 held by `pasta.avx2` pid 1037058, a reboot-protected running container; file byte-identical to `main`).
- `grep -rn "prebuildFeatures" packages/lace/src`: only the fail-loud guard (`up.ts:237-249`) and its test (`validate.test.ts:110-138`).
- `grep -rn "BUILDAH_LAYERS" packages/lace/src`: no matches (exit 1).
- Fail-loud guard demonstration (built CLI against a fixture carrying `prebuildFeatures`, no container built):
  ```
  customizations.lace.prebuildFeatures is no longer supported. Move these entries into the top-level `features` map in .devcontainer/devcontainer.json. See cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md for the migration.
  LACE_RESULT: {"exitCode":1,"failedPhase":"unknown","containerMayBeRunning":false}
  GUARD_CLI_EXIT=1
  ```

### Commits (branch `prebuild-removal`)

| phase | sha | subject |
|---|---|---|
| scaffold | 1d816ee | scaffold iterate devlog |
| Phase 4 | 8eda854 | delete lace prebuild code and add fail-loud migration guard |
| devcontainer flip | d4b01ae | flip own devcontainer prebuildFeatures into top-level features |
| Phase 5 | ef9ea24 | trim prebuild test surface and add fail-loud guard test |
| Phase 6 | 09ca47f | rewrite prebuild docs as a migration note |

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_proof | review_path | notes |
|---|---|---|---|---|---|---|
| 1 | impl-1 (general-purpose) | rev-1 (cdocs:reviewer) | accept | confirmed | cdocs/reviews/2026-09-01-prebuild-removal-r1.md | Deletion-correctness floor empirically re-verified by rev-1 (typecheck/build exit 0, guard demo exit 1 no container, retained bits byte-identical to main, no live imports of deleted modules). Sole test failure is the environmental `port-allocator` EADDRINUSE (jif holds :22431), overseer-confirmed byte-identical to main. Container warm-vs-cold timing + live dogfood deferred-to-followup (needs a rebuild). Overseer cleared 2 nits post-accept: 2 branch-introduced em-dashes (README, architecture.md); N3 phantom `bash-history` deletion needs no action for a merge. Open follow-up: `flock.ts` dead code left in place. |

## Judge Log

| judge_iteration | trigger | verdict | rationale | judge_path |
|---|---|---|---|---|
| n/a | n/a | n/a | Loop terminated on a round-1 accept; the judge runs from the Nth revise verdict onward and no revise occurred. | inline |
