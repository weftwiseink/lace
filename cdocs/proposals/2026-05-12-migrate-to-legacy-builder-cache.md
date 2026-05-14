---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T20:30:00-07:00
task_list: lace/prebuild-cache-rethink/legacy-builder-migration
type: proposal
state: live
status: implementation_ready
last_reviewed:
  status: accepted
  by: "@claude-opus-4-7"
  at: 2026-05-05T13:50:00-07:00
  round: 2
tags: [prebuild, migration, legacy_builder, podman, validated, lace_prebuild_deletion]
---

# Migrate Away From `lace prebuild` Using the Legacy Builder's Local Layer Cache

> BLUF: Delete `lace prebuild` as a separate phase and subcommand.
> Users move features from `customizations.lace.prebuildFeatures` into top-level `features`; lace invokes `devcontainer up --buildkit never` directly; the legacy builder's local layer cache provides acceptable warm-build performance (empirically: 234s cold, 16s warm on weftwise — 15x speedup, 57/63 instruction steps cached, all feature install scripts cached).
> The collision class that triggered the 2026-05-05 incident disappears for free (no `lace.local/*` shared tag to overwrite).
> Scope is intentionally narrow: local layer cache only, single project on single machine, no remote registries.
> Approximately 800-1000 LoC of source plus 200-300 LoC of tests deleted from lace; one user-facing behaviour change (feature install env-order) requires migration-time remediation per project.
>
> - Validating experiment: [`cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`](../reports/2026-05-12-experiment-legacy-builder-cache.md)
> - RFP this proposal serves: [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](./2026-05-05-rfp-rethink-prebuild-cache.md)
> - Options report: [`cdocs/reports/2026-05-05-prebuild-cache-system-options.md`](../reports/2026-05-05-prebuild-cache-system-options.md) (this proposal effectively chooses Bundle P6 sharpened against the legacy builder)
> - Source-analysis report: [`cdocs/reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md`](../reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md)

> NOTE(opus/prebuild/legacy-builder-migration/initial-scoping): Phase 1 (asymmetric `appPort` injection fix) is moot post `wezterm-server` feature deletion from lace's tree.
> Initial migration scope narrows to weftwise cleanups plus the `prebuildFeatures` -> `features` flip.
> A follow-up workstream owns portless integration and host-SSH replacement.
> See [`cdocs/reports/2026-05-13-initial-migration-scoping.md`](../reports/2026-05-13-initial-migration-scoping.md).

## Objective

Remove `lace prebuild` as a phase, subcommand, and configuration concept from lace.
Users keep getting fast warm builds via the legacy builder's local layer cache, which works without any lace-side cache management.

## Background

The 2026-05-05 prebuild tag collision incident exposed a structural fault in lace's cache: `generateTag()` derives the prebuild image tag solely from the original `FROM` line, so two projects sharing a base collide on the same `lace.local/*` tag regardless of feature set.
Investigation found that:

1. The original prebuild rationale was thin (single paragraph of intuition, no measurements, no alternatives weighed).
   See [`cdocs/reports/2026-05-06-prebuild-original-rationale.md`](../reports/2026-05-06-prebuild-original-rationale.md).
2. The cache-busting bug that motivated prebuild (`devcontainers/cli` issue #313) was substantially fixed upstream by 2023's PR #382 and fully addressed for feature paths in CLI 0.83.0 (Jan 2026).
   See [`cdocs/reports/2026-05-06-devcontainer-features-actual-behavior.md`](../reports/2026-05-06-devcontainer-features-actual-behavior.md).
3. Source analysis confirmed `prebuildFeatures` is loosely coupled with the rest of lace: `customizations.lace.{mounts,ports,workspace,validate,repoMounts}` all work identically whether features sit in `features` or `prebuildFeatures`. One asymmetric appPort injection path (`autoInjectPortTemplates` for prebuild features → `appPort`, only exercised by weftwise's `wezterm-server`) is the sole entanglement.
4. The first migration attempt was via BuildKit + `BUILDKIT_INLINE_CACHE`, blocked indefinitely on rootless podman by `containers/buildah#6503` (a `containers/storage` overlay graph-driver bug; no upstream fix scheduled).
   Three workaround paths were tested and ruled out: chmod alone, fuse-overlayfs, podman 5.6 downgrade.
   See `cdocs/reports/2026-05-12-{podman-tmp-buildkit-bug-investigation,pretest-experiment-buildkit-never-drop,experiment-fuse-overlayfs-bypass,podman-56-downgrade-cost-analysis}.md`.
5. The legacy builder (which lace already uses through `--buildkit never`) is structurally immune to `#6503` because it uses `COPY --from` instead of `RUN --mount=type=bind` for feature install.
   The 2026-05-12 cache experiment ([`cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`](../reports/2026-05-12-experiment-legacy-builder-cache.md)) measured Build 1 cold at 234s and Build 2 warm at 16s — a 15x speedup with 57 of 63 instruction steps cached and all feature install scripts cached.

The empirical evidence supports deleting `lace prebuild`.
The legacy builder's local layer cache is sufficient for the author's stated constraint (acceptable warm-build times within one project on one machine).

## Proposed Solution

### Pipeline change

The lace `up` pipeline becomes:

```
workspaceLayout -> hostValidation -> userConfigLoad -> featureMetadata -> templateResolution
  -> mountValidation -> resolveMounts -> generateConfig -> runDevcontainerUp -> containerVerification
```

No prebuild phase.
No FROM rewriting.
No `.lace/prebuild/` directory written.
No `lace.local/*` images created.

`runDevcontainerUp` continues to invoke `devcontainer up --buildkit never` (with the existing `dev_container_feature_content_temp` cleanup beforehand).
The legacy builder produces a local layer cache stored in podman's normal storage; subsequent `lace up` runs benefit automatically.

### Configuration change for users

Before:
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/devcontainers/features/git:1": {},
      "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
    }
  }
}
```

After:
```jsonc
"features": {
  "ghcr.io/devcontainers/features/git:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
}
```

The `prebuildFeatures` key is removed from the schema entirely. Lace surfaces a clear error if a config still contains it, pointing at this migration document.

### What stays in lace

The five-week investigation surfaced specific machinery in lace that is load-bearing for the legacy-builder path and must be retained:

1. **The `--buildkit never` flag** at the `runDevcontainerUp` invocation site.
   Now durably load-bearing for podman users; `containers/buildah#6503` has no upstream fix scheduled.
2. **The `dev_container_feature_content_temp` cleanup** (`podman rm -f -a --filter ancestor=dev_container_feature_content_temp` + `podman rmi -f dev_container_feature_content_temp`) before each build.
   Workaround for a SEPARATE bug (legacy builder caching `FROM scratch + COPY` content image with stale feature content).
   Empirically required by the validating experiment for the cache to be stable across runs.
3. **The defensive `RUN chmod 1777 /tmp`** in lace's own `.devcontainer/Dockerfile:19`.
   Belt-and-suspenders; the pre-test experiment showed it does not by itself prevent `#6503`, but it remains harmless and may help in adjacent bug variants.
4. **The user-config merge layer** at `user-config-merge.ts`.
   Continues to function; the merge target shifts from `prebuildFeatures` to `features` (one-line change).
5. **`customizations.lace.{mounts,ports,workspace,validate,repoMounts}`** handling.
   These keys are prebuild-agnostic per source analysis.
   No changes needed.

### What leaves lace

Source files deleted entirely:
- `packages/lace/src/commands/prebuild.ts` (the subcommand)
- `packages/lace/src/commands/restore.ts` (only exists to undo prebuild's FROM rewrite)
- `packages/lace/src/commands/status.ts` (the subcommand's entire purpose is reporting prebuild state; nothing to report post-deletion)
- `packages/lace/src/lib/prebuild.ts` (the pipeline; ~440 LoC). Note: this includes the `BUILDAH_LAYERS=false` env-var manipulation at `prebuild.ts:330-331` and its restoration at `prebuild.ts:352-357`. **The post-deletion lace does NOT re-introduce `BUILDAH_LAYERS=false` anywhere.** The validating experiment confirmed layer caching works correctly without it, provided the `dev_container_feature_content_temp` cleanup runs before each build.
- `packages/lace/src/lib/status.ts` (the pipeline behind `lace status`; ~117 LoC)
- `packages/lace/src/lib/restore.ts` (the pipeline behind `lace restore`; ~155 LoC)
- `packages/lace/src/lib/dockerfile.ts` (`parseDockerfile`, `generateTag`, `parseTag`, `rewriteFrom`, `restoreFrom`, `generatePrebuildDockerfile`, `parseImageRef`, `generateImageDockerfile` — all prebuild-only)
- `packages/lace/src/lib/metadata.ts` (per-project prebuild metadata)
- `packages/lace/src/lib/lockfile.ts` (feature lock file under `lace.prebuiltFeatures` namespace)

Strip from existing files (specific function/line references from the source-analysis report at `cdocs/reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md`):
- `packages/lace/src/lib/up.ts`:
  - Lines 347-353 (user-config Phase 0c `mergedPrebuildFeatures` write-back)
  - Lines 393-394, 888-926 (entire prebuild phase block + Dockerfile read for prebuild)
  - Lines 797-800 (`extractPrebuildFeaturesRaw` from `allFeatureRefs`)
  - Lines 806-836 (lace-fundamentals `defaultShell` injection: prebuild branch; keep only the `features[fundamentalsRef]` arm)
  - Lines 408, 545-550 (`{...features, ...prebuildFeatures}` spread → just `features`)
  - **Retain** `--buildkit never` and `dev_container_feature_content_temp` cleanup at the single `runDevcontainerUp` invocation site (`up.ts:1311`, `1315-1316`).
- `packages/lace/src/lib/template-resolver.ts`:
  - `extractPrebuildFeaturesRaw` (lines 56-79)
  - `injectForPrebuildBlock` (lines 226-268)
  - `warnPrebuildPortTemplates` (lines 901-932)
  - `warnPrebuildPortFeaturesStaticPort` (lines 944-994)
  - Lines 564-566: replace `{...features, ...prebuildFeatures}` with just `features`
- `packages/lace/src/lib/validation.ts`:
  - `validateNoOverlap` (lines 23-39) and its private helper `featureIdentifier` (lines 10-14)
- `packages/lace/src/lib/user-config-merge.ts` (lines 158-173): delete the prebuild-routing branch in `applyUserConfig`; drop `mergedPrebuildFeatures` from the return type.
- `packages/lace/src/lib/user-config.ts`: remove `prebuildFeatures` from the schema.
- `packages/lace/src/lib/devcontainer.ts`: remove `extractPrebuildFeatures` (lines 137-163) and `generateTempDevcontainerJson` (lines 228-241).
- `packages/lace/src/index.ts`: drop the three subcommand registrations (`prebuild`, `restore`, `status`).

Tests deleted entirely:
- `packages/lace/src/lib/__tests__/dockerfile.test.ts`
- `packages/lace/src/lib/__tests__/lockfile.test.ts`
- `packages/lace/src/lib/__tests__/metadata.test.ts`
- `packages/lace/src/commands/__tests__/prebuild.integration.test.ts`
- `packages/lace/src/commands/__tests__/restore.integration.test.ts`
- `packages/lace/src/commands/__tests__/status.integration.test.ts`
- `packages/lace/src/__tests__/e2e.test.ts` (purely the prebuild lifecycle e2e)

Tests trimmed (delete prebuild-specific cases, keep file):
- `packages/lace/src/lib/__tests__/template-resolver.test.ts` (47 prebuild references; ~30-40% of file deleted including `injectForPrebuildBlock` tests T1-T5 and the prebuild-only sub-cases at lines 826, 851, 1235, 1263, 1305)
- `packages/lace/src/lib/__tests__/devcontainer.test.ts` (delete `extractPrebuildFeatures` tests at lines 48-241)
- `packages/lace/src/lib/__tests__/user-config-merge.test.ts` (delete the "user features go into prebuildFeatures when project has them" case at line 249-)
- `packages/lace/src/commands/__tests__/up.integration.test.ts` (delete prebuild-specific cases; keep file)
- `packages/lace/src/commands/__tests__/validate.test.ts` (delete the "validateOnly: true skips prebuild phase" case at lines 110-138)
- `packages/lace/src/__tests__/portless-scenarios.test.ts` (delete the P1 prebuild-specific scenario)
- `packages/lace/src/__tests__/claude-code-scenarios.test.ts` (delete C7)
- `packages/lace/src/__tests__/docker_smoke.test.ts` (delete the prebuild-runs section)

New scenario added:
- Back-to-back `lace up` cache reuse on a multi-feature project, asserting the warm wall time is < 30% of the cold.

Configuration:
- `customizations.lace.prebuildFeatures` is removed from the schema and from documentation.

User state cleanup (one-time, per host):
- `lace.local/*` images in podman storage.
- `.lace/prebuild/` directory under each user project.

Approximately 800-1000 LoC source (revised up from initial 400-700 estimate) + 200-300 LoC tests deleted, per the source-analysis report.
The initial under-estimate omitted `status.ts`, `validation.ts`'s `validateNoOverlap`, and the trimmed test files.

## Important Design Decisions

### Why the legacy builder is acceptable as the durable cache mechanism

The validating experiment showed Build 2 at 6.65% of Build 1 wall time on weftwise (the heaviest project in the lace ecosystem).
All seven feature install scripts cached.
The cache reuse extends through the heavy layers (Electron, Playwright, `COPY . .`, `pnpm build:electron`) without re-execution.
This is a 15x improvement, comfortably below the < 50% pass criterion the experiment used.

Cross-machine and cross-project sharing are explicitly forfeited by this proposal per the author's stated constraint.
A registry-backed migration would re-open both, but requires either `#6503` to be fixed upstream (no scheduled timeline) or a substantive workaround we have ruled out experimentally.
The cost of forfeiting cross-machine sharing is one cold build per (project, machine) pair, not per build.

### Why we don't try to preserve the clean-environment guarantee

The current prebuild flow installs features into the base image *before* the user's Dockerfile's `ENV` and `RUN` directives run.
This is an emergent property of the prebuild flow, not a design intent.
Reinventing it post-deletion (e.g., via a multi-stage Dockerfile that runs features in an isolated stage) would amount to re-implementing prebuild.

The post-deletion flow is the standard upstream devcontainer-CLI behaviour: features install after the user's Dockerfile, inheriting whatever ENVs the user set.
Most users will not have conflicting ENVs; those who do (e.g., weftwise's `NPM_CONFIG_PREFIX` vs the transitively-pulled `node` feature) can be remediated per-project at migration time.

### Why we don't introduce `lace cache prune`

Per the user-stated cleanup ownership preference (covered in the options report's author-guidance section), cleanup happens via `podman image prune` and standard host tooling.
This proposal does not add a `lace cache prune` subcommand.
The one-time migration cleanup (deleting `lace.local/*` images and `.lace/prebuild/` directories) is documented in the migration guide; users run a one-off command, not a recurring `lace cache` invocation.

### Why we don't auto-inject the `chmod 1777 /tmp` workaround

The pre-test experiment ([`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](../reports/2026-05-12-pretest-experiment-buildkit-never-drop.md)) empirically confirmed that `chmod 1777 /tmp` in the base image does not by itself prevent `#6503` from corrupting `/tmp` at subsequent feature install layers — both Variant 1 (no chmod) and Variant 2 (chmod only) failed identically at the same `apt-get update` step.
The bug re-fires at every `RUN --mount=type=bind` feature install layer regardless of base-image state.
On the legacy builder (which this proposal commits to), the bug doesn't fire at all because `COPY --from` is used instead.
Auto-injection would be defensive against a bug we don't trigger.
The chmod stays in lace's own Dockerfile as harmless belt-and-suspenders.
The separate RFP at [`cdocs/proposals/2026-05-12-rfp-auto-inject-tmp-workaround.md`](./2026-05-12-rfp-auto-inject-tmp-workaround.md) was authored before the pre-test experiment falsified its core motivation; it should be retired (preferred) or substantially repurposed (e.g., as documentation guidance for any users who do choose BuildKit despite the bug).

## Edge Cases / Challenging Scenarios

### Feature install env-order conflicts

The validating experiment surfaced exactly one such conflict: weftwise's `ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global` plus the transitively-pulled `ghcr.io/devcontainers/features/node` (nvm-based) → exit 11 during node feature install.

In the current prebuild flow, the node feature installs into the base image before the user's `ENV NPM_CONFIG_PREFIX` runs, so the conflict doesn't manifest.
In the post-deletion flow, features run on top of the user's Dockerfile, inheriting `NPM_CONFIG_PREFIX`, which conflicts with nvm.

Remediation at migration time:

1. Audit each project's `.devcontainer/Dockerfile` for `ENV` directives that affect tooling installed by features.
   Common culprits: `NPM_CONFIG_*`, `PATH` overrides, `GOPATH`, `NODE_PATH`, `PYTHONUSERBASE`.
2. For each conflicting ENV:
   - If the user's Dockerfile sets up something the feature now provides (npm globals dir in weftwise's case), delete the ENV.
   - If the ENV is genuinely needed at runtime but not at feature-install time, move it from `ENV` (Dockerfile, build-time) to `containerEnv` (devcontainer.json, runtime-only).
3. Verify the migrated project's `lace up` completes successfully.

Discovery beyond the known weftwise case is part of the per-project phases.

> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): If a project surfaces an env-order conflict that cannot be resolved by deletion or `containerEnv` shift, the project's migration is paused and the case is documented as a regression report.
> If multiple projects hit the same uncloseable case, the migration may need a follow-up RFP for a per-feature pre-install ENV-clear mechanism.
> The expectation is that this is rare; the validating experiment found one case across two real projects and the fix was trivial.

### wezterm-server asymmetric port injection

`autoInjectPortTemplates` at `packages/lace/src/lib/template-resolver.ts:162-268` has a separate code path for prebuild features → `appPort` (vs. regular features → ports allocator).
The lace-side mechanism that resolves the wezterm-server feature's `hostSshPort` declaration into a host port binding currently runs through this asymmetric path.

Post-deletion, `appPort` injection for prebuild features no longer exists.
The wezterm-server feature must be exercised via the regular features-to-ports-allocator path.
Source analysis confirmed this is a small change but is the *one* entanglement worth calling out.

Remediation:
- Verify the wezterm-server feature's port declaration metadata is consumed by the regular allocator path when the feature is in `features` (not `prebuildFeatures`).
- If the regular allocator doesn't currently honour the feature's `hostSshPort` declaration, extend it to do so.
- Migrate weftwise's port handling: either (a) rely on the now-unified allocator path or (b) declare a static `appPort` in weftwise's `devcontainer.json` (e.g., `"appPort": 22427`) and let the wezterm-server feature bind to it at runtime.
- Verify the host can ssh into the container post-migration.

### `dev_container_feature_content_temp` cleanup must be retained

The legacy builder caches `FROM scratch + COPY` content layers across builds, including stale feature content.
Lace's current `up.ts:1315-1316` cleanup (`podman rm -f -a --filter ancestor=...` then `podman rmi -f ...`) is required for cache stability.
This is a SEPARATE bug from `#6503`; do not delete this cleanup as part of deleting prebuild.
The validating experiment confirmed the cleanup is load-bearing for the warm build cache to be reliable.

### Drift in user Dockerfiles independent of lace

The validating experiment found weftwise's `corepack prepare pnpm@latest-10 --activate` broken against current registry state — pnpm 11.1.1 enforces `approve-builds` and breaks the build.
This is a user-Dockerfile drift bug, orthogonal to lace.
The migration should not catch the blame for these.
Migration steps include a "verify the project builds on plain podman" precheck before attempting the prebuild→features move, so unrelated breakage is surfaced cleanly.

### One-time migration cleanup of stale prebuild artefacts

Existing `lace.local/*` images and `.lace/prebuild/` directories should be cleaned up post-migration.
Document in the migration guide:

```sh
podman rmi $(podman images -q "lace.local/*") 2>/dev/null  # one-time, all hosts
rm -rf .lace/prebuild  # one-time, per project
```

These do not need a dedicated `lace cache cleanup` subcommand.

## Test Plan

### Pre-migration baseline (per project)

For each project being migrated, before changing anything:
1. Capture current `lace up` cold and warm wall times.
2. Capture the list of currently-installed images: `podman images --format '{{.Repository}}:{{.Tag}}'`.
3. Capture `.lace/prebuild/metadata.json` content.

These are baselines, not pass/fail gates; they document the pre-migration state.

### Per-project verification (during migration)

After moving `prebuildFeatures` → `features` for a project:

1. **Build succeeds**: `lace up` exits 0.
2. **Container starts**: `podman ps --filter name=<project>` shows the container in `Up` state.
3. **All features functional**: spot-check the tools each feature installs (e.g., for weftwise: `nu --version`, `nvim --version`, `claude --version`, `ssh` into the container via the wezterm-server-assigned port, etc.).
4. **Warm build caches**: a second consecutive `lace up` completes in < 30% of the cold-build wall time.
5. **No `lace.local/*` images created**: `podman images | grep lace.local` returns empty.
6. **No `.lace/prebuild/` written**: `ls .lace/prebuild` returns "no such directory."

### Lace-side test suite

After Phase 4 (code deletion):

1. All existing scenario tests under `packages/lace/src/__tests__/*-scenarios.test.ts` pass after their prebuild-specific cases are removed/replaced.
2. New scenario: a two-feature project builds, then re-builds, and the second build's wall time is < 30% of the first's. Implemented via shell-based timing in the scenario test harness.
3. All existing unit tests pass (the prebuild-related test files are deleted, not re-tested).

### Dogfooding

The lace project's own devcontainer must work post-migration: `lace up` in `~/code/weft/lace/main` builds, the container starts, and lace's own scenario tests run inside the container.

## Verification Methodology

The implementer iterates per-project (weftwise → whelm → lace's own) with the following loop:

1. Snapshot the project's current `.devcontainer/` (git status clean, last successful `lace up` recorded).
2. Move `prebuildFeatures` into `features`.
3. `lace up` (still on a pre-deletion lace binary that retains `--buildkit never`; this confirms the config change works before lace's code is touched).
4. If it fails: read the failure, attribute it (env-order conflict / Dockerfile drift / wezterm-server port / etc.), remediate per the project's `.devcontainer/`, retry.
5. Once it passes, capture warm-build timing as the new baseline.

After all projects are migrated, the lace code-deletion phases proceed.
Lace is rebuilt and the projects re-run on the new lace binary.
The cache behaviour must remain identical to the pre-code-deletion state (since the legacy builder's cache is the only mechanism).

## Implementation Phases

> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): Phase 1 (handle wezterm-server) precedes Phase 2 (migrate weftwise) because weftwise uses the wezterm-server feature, which currently relies on the asymmetric `autoInjectPortTemplates` path for prebuild features. Migrating weftwise's features out of `prebuildFeatures` without first ensuring the regular allocator handles wezterm-server's `hostSshPort` would break the host SSH binding.

### Phase 1: Handle wezterm-server port injection (lace-side fix, prerequisite for weftwise migration)

Substeps:
1. Read `packages/lace/src/lib/template-resolver.ts:162-268` (the `autoInjectPortTemplates` asymmetric path).
2. Determine whether the regular features-to-ports allocator already honours wezterm-server's `hostSshPort` metadata when the feature sits in `features` rather than `prebuildFeatures`.
3. If extension needed: implement it on a feature branch of lace; add a unit test against the wezterm-server metadata.
4. Independent of (2/3), prepare a "static `appPort` fallback" recipe: declare `"appPort": 22427` (or the project's allocated port) directly in `devcontainer.json` so the wezterm-server feature has a known port to bind even without lace-side allocator extension. Document this as the weftwise migration's chosen path if (3) turns out non-trivial.

Success criteria: wezterm-server-style port allocation works through the regular features pipeline, or the static-appPort fallback is documented and ready to apply in Phase 2. Either way, weftwise's host SSH port binding has a clear path post-prebuild-deletion.

### Phase 2: Migrate weftwise

> Surfaces any unknown env-order conflicts before lace code is touched.
> Depends on Phase 1 (wezterm-server port handling) being resolved (either the allocator extension or the static-appPort fallback).

Substeps:
1. Verify weftwise's working tree is clean.
2. Apply orthogonal fixes uncovered by the validating experiment:
   - Pin pnpm explicitly in the Dockerfile (replace `corepack prepare pnpm@latest-10 --activate` with a specific pinned version, e.g., `corepack prepare pnpm@10.26.2 --activate`).
   - Remove `ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global` from the Dockerfile (resolves the conflict with the transitively-pulled `ghcr.io/devcontainers/features/node` feature).
3. Move all six prebuildFeatures to top-level `features` in `devcontainer.json`.
4. Apply Phase 1's wezterm-server resolution: either rely on the extended allocator, or set `"appPort": <allocated>` in `devcontainer.json`.
5. Run `lace restore` once to undo any prior FROM rewrite.
6. Verify `lace up` works; container starts; all features functional (including SSH access via wezterm-server's port).
7. Verify warm-build < 30% cold-build wall time.
8. Commit the changes to weftwise.

Success criteria: weftwise's `lace up` works without `customizations.lace.prebuildFeatures` set. Warm build wall time < 30% of cold. Host can ssh into the container.

### Phase 3: Survey and migrate remaining user projects

The sanity-check review surfaced that beyond weftwise and whelm, the author has additional projects (e.g., `backup`, `clauthier`, `dotfiles`, `lace`-worktree variants) that may or may not currently use `prebuildFeatures`.

Substeps:
1. Survey: `for d in ~/code/*/main ~/code/*/*/main; do test -f "$d/.devcontainer/devcontainer.json" && grep -l prebuildFeatures "$d/.devcontainer/devcontainer.json"; done` (or equivalent).
2. For each project that uses `prebuildFeatures`:
   - Verify working tree clean.
   - Survey `.devcontainer/Dockerfile` for env-order conflict patterns (`NPM_CONFIG_*`, `PATH` overrides, `GOPATH`, `NODE_PATH`, `PYTHONUSERBASE`).
   - Move features from `prebuildFeatures` to `features`.
   - Apply remediation for any env-order conflicts surfaced by `lace up`.
   - Verify `lace up` works; container starts.
   - Verify warm-build < 30% cold-build wall time.
   - Commit changes per project.
3. Specifically: migrate whelm (`lace-fundamentals + ./features/sprack` project-level, plus user-config-merged `neovim, nushell, claude-code`).

Success criteria: every project that previously used `prebuildFeatures` works without it. No `lace.local/*` images created during their `lace up` runs.

### Phase 4: Lace code deletion

Substeps:
1. Delete entire subcommand files: `packages/lace/src/commands/{prebuild,restore,status}.ts`.
2. Delete entire library files: `packages/lace/src/lib/{prebuild,restore,status,dockerfile,metadata,lockfile}.ts`. Per "What leaves lace" above, this also removes the `BUILDAH_LAYERS=false` env-var manipulation that lived inside `prebuild.ts:330-357` — the post-deletion lace must not re-introduce it anywhere.
3. Strip prebuild branches from `packages/lace/src/lib/up.ts` per the line references in "What leaves lace":
   - Lines 347-353, 393-394, 797-800, 806-836, 408, 545-550, 888-926.
   - Retain `--buildkit never` flag and `dev_container_feature_content_temp` cleanup at `up.ts:1311, 1315-1316`.
4. Strip from `packages/lace/src/lib/template-resolver.ts`:
   - `extractPrebuildFeaturesRaw` (lines 56-79)
   - `injectForPrebuildBlock` (lines 226-268; post-Phase 1 — only safe to delete after wezterm-server allocator path is resolved)
   - `warnPrebuildPortTemplates` (lines 901-932)
   - `warnPrebuildPortFeaturesStaticPort` (lines 944-994)
   - Lines 564-566 spread collapse.
5. Strip from `packages/lace/src/lib/validation.ts`: `validateNoOverlap` (lines 23-39) and its private helper `featureIdentifier` (lines 10-14).
6. Strip from `packages/lace/src/lib/devcontainer.ts`: `extractPrebuildFeatures` (lines 137-163), `generateTempDevcontainerJson` (lines 228-241).
7. Update `packages/lace/src/lib/user-config-merge.ts` (lines 158-173): delete the prebuild-routing branch in `applyUserConfig`; drop `mergedPrebuildFeatures` from the return type.
8. Update `packages/lace/src/lib/user-config.ts`: remove `prebuildFeatures` from the schema.
9. Update `packages/lace/src/index.ts`: drop the three subcommand registrations (`prebuild`, `restore`, `status`).

Success criteria: lace builds; existing scenario tests pass (modulo Phase 5 updates); no `prebuildFeatures` references remain in source; `BUILDAH_LAYERS=false` does not appear anywhere in lace source.

> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): This phase is a destructive code deletion. The implementer should work on a branch and gate the merge behind Phase 7's verification, not commit-by-commit to main.

### Phase 5: Test surface update

Substeps:
1. Delete entire test files per "What leaves lace":
   - `packages/lace/src/lib/__tests__/{dockerfile,lockfile,metadata,validation}.test.ts`
   - `packages/lace/src/commands/__tests__/{prebuild,restore,status}.integration.test.ts`
   - `packages/lace/src/__tests__/e2e.test.ts`
2. Trim prebuild-specific cases from (per the source-analysis report enumeration):
   - `packages/lace/src/lib/__tests__/template-resolver.test.ts` (~30-40% of file: `injectForPrebuildBlock` tests T1-T5, prebuild sub-cases at lines 826/851/1235/1263/1305, `warnPrebuildPortTemplates` tests around 1602+)
   - `packages/lace/src/lib/__tests__/devcontainer.test.ts` (delete `extractPrebuildFeatures` tests at lines 48-241)
   - `packages/lace/src/lib/__tests__/user-config-merge.test.ts` (delete the "user features go into prebuildFeatures" case at line 249-)
   - `packages/lace/src/commands/__tests__/up.integration.test.ts` (delete prebuild-specific cases)
   - `packages/lace/src/commands/__tests__/validate.test.ts` (delete "validateOnly: true skips prebuild phase" at lines 110-138)
   - `packages/lace/src/__tests__/portless-scenarios.test.ts` (delete P1 scenario)
   - `packages/lace/src/__tests__/claude-code-scenarios.test.ts` (delete C7)
   - `packages/lace/src/__tests__/docker_smoke.test.ts` (delete prebuild-runs section)
3. Add one new scenario: a two-feature project builds, then re-builds; warm build is < 30% of cold. Implementation via the scenario test harness's wall-time capture mechanism.

Success criteria: all remaining tests pass on the post-deletion lace binary; new cache-reuse scenario passes.

### Phase 6: Documentation update

Substeps:
1. `packages/lace/docs/prebuild.md` — convert to "Migration: removed `lace prebuild`" with the migration steps from this proposal.
2. `packages/lace/README.md` — remove `lace prebuild` subcommand mentions; remove `prebuildFeatures` from the example config.
3. `packages/lace/docs/migration.md` — add a new section "Migrating off `lace prebuild` (2026-05)."
4. `packages/lace/docs/troubleshooting.md` — remove prebuild-specific troubleshooting; add the env-order conflict guidance from this proposal's Edge Cases section.
5. The `customizations.lace.prebuildFeatures` schema documentation is removed.

Success criteria: README's example config builds via the new lace; migration doc is followable end-to-end by a user who has only `prebuildFeatures` knowledge.

### Phase 7: Dogfood and ship

Substeps:
1. Migrate lace's own `.devcontainer/devcontainer.json` (move `prebuildFeatures` if present; ensure the working tree configuration is clean).
2. Run lace's full test suite on the post-deletion binary.
3. Verify `lace up` works in all three projects (lace, weftwise, whelm) on the post-deletion binary.
4. Merge the branch.
5. Communicate the change to other lace users (if any) along with the migration steps.
6. After merge: run the one-time user-state cleanup script (delete `lace.local/*` images, remove `.lace/prebuild/` directories).

Success criteria: lace's `lace up` works on the post-deletion binary. All scenario tests pass. No prebuild references remain in source or documentation. weftwise, whelm, and lace itself dogfood the new path successfully.

## Summary

This proposal closes the five-week investigation into lace's prebuild cache.
The bug that originally motivated prebuild (devcontainer-CLI cache-busting) is no longer a blocker; the cache-busting Bug (`devcontainers/cli#313`) was substantially fixed upstream by 2023's PR #382 and fully addressed in 0.83.0 (Jan 2026).
What does still bite us is `containers/buildah#6503`, which makes BuildKit unusable for devcontainer feature install on rootless podman; but lace's existing `--buildkit never` workaround sidesteps it entirely.

The legacy builder produces a usable local layer cache (15x speedup on Build 2 in the validating experiment).
Deleting `lace prebuild` is roughly 800-1000 LoC of source and 200-300 LoC of tests.
The collision class that triggered the 2026-05-05 incident disappears for free; one per-project remediation (env-order conflicts at feature install time) is required.

The proposal is intentionally narrow scope: local layer cache, single project, single machine.
Cross-machine and cross-project sharing are forfeited.
If `#6503` is fixed upstream in the future, a registry-backed migration becomes a separate, additive follow-up RFP.

> NOTE(opus/lace/prebuild-cache-rethink/legacy-builder-migration): The chmod-injection RFP at `cdocs/proposals/2026-05-12-rfp-auto-inject-tmp-workaround.md` should be retired or substantially repurposed.
> Its original motivation (defense-in-depth against `#6503` for users on the BuildKit path) does not apply since this migration commits to the legacy builder.
> The chmod stays in lace's own Dockerfile as harmless belt-and-suspenders but does not need an auto-injection mechanism.
