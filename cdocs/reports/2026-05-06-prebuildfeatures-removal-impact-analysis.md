---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T17:18:27-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [prebuild, source_analysis, refactor_impact, investigation, rfp_input]
---

# `prebuildFeatures` Removal: Source-Level Impact Analysis

> BLUF: Removing `customizations.lace.prebuildFeatures` from lace would be a tractable refactor, not a structural rework.
> The mechanism has two genuine entanglements with the rest of lace - asymmetric `appPort` injection for prebuild-feature ports, and a user-config merge branch that routes user features into prebuild when present - and one cosmetic one (a `mountResolver` namespace check that already treats prebuild and regular features identically).
> Crucially, mounts and ports declared in `customizations.lace.{mounts,ports}` from feature metadata work *identically* whether the feature lives in `features` or `prebuildFeatures`; the entanglement is at the bake-vs-runtime layer, not at the lace-customization layer.
> Estimated removal size: ~400-700 LoC of source plus ~150-200 LoC of tests, concentrated in five files.

## Context

This report supports the prebuild-cache-rethink RFP and is the source-code companion to the historical and behavioral reports on the same workstream.

- RFP: [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md).
- Options exploration: [`cdocs/reports/2026-05-05-prebuild-cache-system-options.md`](./2026-05-05-prebuild-cache-system-options.md).
- Web research: [`cdocs/reports/2026-05-06-devcontainer-features-actual-behavior.md`](./2026-05-06-devcontainer-features-actual-behavior.md).
- Original rationale audit: [`cdocs/reports/2026-05-06-prebuild-original-rationale.md`](./2026-05-06-prebuild-original-rationale.md).
- Adjacent collision incident (motivates careful merge handling): [`cdocs/reports/2026-05-06-feature-id-short-id-collision-incident.md`](./2026-05-06-feature-id-short-id-collision-incident.md).

The author wants to know whether the "axe the special prebuild-feature treatment, use plain `features` everywhere" instinct can be acted on cleanly.
This report classifies every entanglement found in `packages/lace/src/` and the in-tree feature manifests.

## Method

Files read in full:
- `packages/lace/src/lib/devcontainer.ts`, `template-resolver.ts`, `feature-metadata.ts`, `up.ts`, `prebuild.ts`, `status.ts`, `restore.ts`, `resolve-mounts.ts`, `user-config.ts`, `user-config-merge.ts`, `validation.ts`.
- `packages/lace/src/commands/prebuild.ts`, `status.ts`, `validate.ts`.
- All five in-tree feature manifests under `devcontainers/features/src/`.
- All seven user-project `devcontainer.json` files under `~/code/` that contain `prebuildFeatures`.

Files spot-checked:
- `mount-resolver.ts`, `port-allocator.ts`, `workspace-layout.ts`, `host-validator.ts`, `settings.ts`.

Greps run (selected):
- `prebuildFeatures` across the whole tree (130 hits in 130 files; concentrated in tests + cdocs).
- `wrapper feature` / `local feature wrapper` (concept hunt; see Section "The Wrapper Feature Concept").
- `customizations\.lace\.\w+` and `lace\.(workspace|validate|mounts|ports|prebuildFeatures|repoMounts)` (key enumeration).
- `prebuild` in feature metadata (`devcontainers/features/src/*/devcontainer-feature.json`): zero hits.

## Entanglement Map

The entanglements fall into three categories: structural code-paths in the prebuild pipeline itself (entirely deletable), structural code-paths in the up pipeline that *branch* on prebuild (deletable with care), and shared abstractions where prebuild is one of two equivalent inputs (no impact).

| # | Entanglement | File:Lines | Classification |
|---|--------------|------------|----------------|
| 1 | `extractPrebuildFeatures` discriminated-union extractor | `lib/devcontainer.ts:137-163` | Easy-redirect (delete) |
| 2 | `generateTempDevcontainerJson` (writes prebuild context) | `lib/devcontainer.ts:228-241` | Easy-redirect (delete with prebuild.ts) |
| 3 | `extractPrebuildFeaturesRaw` raw accessor | `lib/template-resolver.ts:56-79` | Easy-redirect (delete + collapse callers) |
| 4 | `autoInjectPortTemplates` symmetric/asymmetric branch | `lib/template-resolver.ts:162-188`, `injectForPrebuildBlock` at 226-268 | **Blocking-light**: see "appPort asymmetry" below |
| 5 | `validateNoOverlap` (prebuild vs features) | `lib/validation.ts:23-39` | Easy-redirect (delete) |
| 6 | `warnPrebuildPortTemplates` | `lib/template-resolver.ts:901-932` | Easy-redirect (delete - warning becomes obsolete) |
| 7 | `warnPrebuildPortFeaturesStaticPort` | `lib/template-resolver.ts:944-994` | Easy-redirect (delete - warning becomes obsolete) |
| 8 | `resolveTemplates` unified-feature merge `{...features, ...prebuildFeatures}` | `lib/template-resolver.ts:564-565` | Easy-redirect (drop second spread) |
| 9 | `up.ts` `hasPrebuildFeatures` gate around prebuild + Dockerfile read | `lib/up.ts:393-394`, `888-899`, `902-926` | Easy-redirect (delete entire branch) |
| 10 | `up.ts` user-config merged `prebuildFeatures` write-back | `lib/up.ts:347-353` | Easy-redirect (delete branch) |
| 11 | `up.ts` lace-fundamentals `defaultShell` injection: prebuild branch | `lib/up.ts:806-836` | Easy-redirect (only `features` path needed) |
| 12 | `user-config-merge.ts` `applyUserConfig` route-into-prebuild branch | `lib/user-config-merge.ts:158-173` | **Blocking-light**: see "User-config merge semantics" below |
| 13 | `user-config-merge.ts` `mergeUserFeatures` itself | `lib/user-config-merge.ts:54-76` | No impact (still needed for plain `features`) |
| 14 | Feature ID map `buildFeatureIdMap({...features, ...prebuildFeatures})` | `lib/template-resolver.ts:131-147` (callers in up.ts, template-resolver.ts) | No impact (drop second spread; collision detection still wanted) |
| 15 | `featureShortIds` set built from both blocks for namespace validation | `lib/up.ts:545-550`, `template-resolver.ts:325-346` | No impact (drop second spread) |
| 16 | `prebuild.ts` (the entire pipeline) | `lib/prebuild.ts:64-395` | Easy-redirect (delete) |
| 17 | `restore.ts` (entire pipeline) | `lib/restore.ts:1-153` | Easy-redirect (delete) |
| 18 | `status.ts` (entire pipeline) | `lib/status.ts:1-117` | Easy-redirect (delete or repurpose) |
| 19 | `dockerfile.ts` `parseTag`/`generateTag`/`rewriteFrom`/`generatePrebuildDockerfile`/`parseImageRef`/`generateImageDockerfile` | `lib/dockerfile.ts` | Easy-redirect (delete with prebuild.ts) |
| 20 | `metadata.ts` (the `.lace/prebuild/metadata.json` writer) | `lib/metadata.ts` | Easy-redirect (delete) |
| 21 | `lockfile.ts` (lockfile merge for prebuild) | `lib/lockfile.ts` | Easy-redirect (delete) |
| 22 | `commands/prebuild.ts`, `restore.ts`, `status.ts` | All three command files | Easy-redirect (delete CLI subcommands) |
| 23 | `mount-resolver.ts` namespace check, ports allocator | files are prebuild-agnostic | No impact |

### The load-bearing question: do `customizations.lace.{mounts,ports}` work in plain `features`?

Yes. Both `customizations.lace.mounts` and `customizations.lace.ports` declared in feature metadata are honored identically whether the feature is in `features` or `prebuildFeatures`.
The unification happens in two places, both of which feed both blocks into the same downstream code:

- `template-resolver.ts:564-565` (`resolveTemplates`): `const allFeatures = { ...features, ...prebuildFeatures }` then `buildFeatureIdMap(allFeatures)` for port-template resolution.
- `up.ts:408-409` (`runUp`): `const allRawFeatures = { ...rawFeatures, ...rawPrebuildFeatures }` then `fetchAllFeatureMetadata(allFeatureIds, ...)`.

Mount declarations are explicitly described as block-agnostic: `template-resolver.ts:287-289` documents that "Mounts are runtime config (docker run flags), so prebuild features are treated identically to regular features - no build/runtime asymmetry," and `buildMountDeclarationsMap` (lines 290-313) iterates the unified `metadataMap` without distinguishing the source block.
The integration test `claude-code-scenarios.test.ts:355-392` (Scenario C7) explicitly validates this: "mount still auto-injected when feature is in prebuildFeatures."

This is the answer to the headline question and it is the most important finding of this report: **no `lace.mounts` or `lace.ports` declaration is silently lost by moving a feature from `prebuildFeatures` to `features`**.

### The one true asymmetry: `appPort` injection

The single material behavioral difference is in `autoInjectPortTemplates` (`template-resolver.ts:162-268`):

- For features in `features`, an undefined port-declared option is filled with `${lace.port(short/option)}` *as the option value itself* ("symmetric injection" - same port host:container).
- For features in `prebuildFeatures`, the option value is left untouched and an `appPort` entry of the form `${lace.port(short/option)}:DEFAULT_FROM_METADATA` is appended ("asymmetric injection" - lace-allocated host port mapped to the metadata-declared default container port).

The rationale (documented at `template-resolver.ts:225-268` and the proposal `cdocs/proposals/2026-02-09-prebuild-features-port-support.md`) is that prebuild features have their option values baked into the image at build time and cannot receive a runtime-allocated port via the option mechanism, so the host port must be supplied via the runtime-only `appPort` array.

This is the only place in lace where the *container-internal* listening port is treated as fixed-by-prebuild rather than dynamic.
Two integration tests cover the asymmetry: `template-resolver.test.ts:421-486` ("injects asymmetric appPort entry for prebuild features", "skips injection for prebuild feature when user provides explicit value") and `portless-scenarios.test.ts:83-150` (P1 scenario uses portless in prebuildFeatures).

If `prebuildFeatures` is removed and all features become plain `features`, the asymmetric path becomes unreachable and can be deleted along with `injectForPrebuildBlock`, `warnPrebuildPortTemplates`, `warnPrebuildPortFeaturesStaticPort`, and tests T1-T5 plus the portless scenario. The symmetric path already covers the new world.

> NOTE(opus/prebuild-cache-rethink): The symmetric path uses the same lace-allocated port on host and container.
> Some users today rely on the asymmetric mapping when an in-image service genuinely cannot be told what port to listen on - portless's `proxyPort` default `1355` is the canonical example.
> If those services are moved to plain `features`, the user must instead either (a) accept the symmetric mapping and configure the service via runtime env, or (b) keep `appPort` mappings hand-written.
> This is a downstream behavioral change, not a lace refactor concern, but the RFP author should be aware of it.

### The user-config merge branch

`user-config-merge.ts:158-173` implements a routing rule: if the project has *any* `prebuildFeatures`, user features go into `prebuildFeatures`; otherwise into `features`.

```ts
if (Object.keys(projectPrebuildFeatures).length > 0) {
  mergedPrebuildFeatures = mergeUserFeatures(userConfig.features, projectPrebuildFeatures);
} else {
  mergedFeatures = mergeUserFeatures(userConfig.features, projectFeatures);
}
```

If `prebuildFeatures` is removed, this whole branch becomes dead code and the second arm runs unconditionally.
The `mergeUserFeatures` function itself stays (still needed for plain features).
This is straightforward to remove but requires updating `applyUserConfig`'s return shape (drop `mergedPrebuildFeatures`) and three callsites in `up.ts` (lines 338-353, 808-836).

The 2026-05-06 collision-incident report flagged that this routing rule produces a phantom-merge bug (user-layer entries surviving as duplicates of project-layer ones at short-ID granularity).
Removing `prebuildFeatures` simplifies away that defect class for free.

## The "Wrapper Feature" Concept

A "wrapper feature" in lace's vocabulary is a thin local devcontainer feature that *delegates* to one or more upstream features via `dependsOn`, while adding lace-specific metadata in `customizations.lace`.
The term appears in three distinct contexts in the codebase:

1. **As a remediation hint for short-ID collisions** (`template-resolver.ts:141`, `template-resolver.test.ts:236`): when two features in a single config share a short ID, lace emits "Rename one using a local feature wrapper to disambiguate." The 2026-05-06 collision-incident report explicitly notes this remediation is "rarely the correct response" and "reads as design hand-waving in the common case."

2. **As a packaged-domain-knowledge feature**: published features under `ghcr.io/weftwiseink/devcontainer-features/` that wrap upstream features and bolt on lace customization metadata. Examples found in user configs:
   - `weftwiseink/claude-code` wraps `anthropics/claude-code` and adds `customizations.lace.mounts.{config, config-json}`.
   - `weftwiseink/lace-fundamentals` (in `devcontainers/features/src/lace-fundamentals/`) is a runtime-init feature that depends on `git:1`, declares two lace mounts (`dotfiles`, `screenshots`), and is paired at runtime with `lace-fundamentals-init` injected into `postCreateCommand` by `up.ts:840-879`.
   - The proposal corpus references hypothetical `lace-sshd`, `wezterm-server`, `nushell-history` wrappers; some are published, some are still aspirational.

3. **As a coupling-decoupling tool**: when upstream features own metadata that "logically belongs elsewhere" (e.g., `wezterm-server`'s `hostSshPort` option, which belongs in an `sshd` wrapper), the documented remediation is to author a thin wrapper feature.

**Wrapper features have no special relationship to `prebuildFeatures`.**
The lace-fundamentals manifest at `devcontainers/features/src/lace-fundamentals/devcontainer-feature.json` declares `customizations.lace.mounts` only - nothing prebuild-aware.
Users place `lace-fundamentals` in `prebuildFeatures` (see whelm, weftwise, clauthier devcontainers) purely because it's an install-time-heavy feature, not because anything in lace requires it.
The wrapper pattern is orthogonal to the prebuild question.

The one place wrapper-features and prebuild touch is the `lace-fundamentals` integration in `up.ts:793-881`, which detects the feature in *either* block and injects `defaultShell` and `LACE_DOTFILES_PATH`.
The prebuild branch (lines 816-836) includes a documented foot-gun (a NOTE callout warning about shared object references through the extraction chain).
Removing `prebuildFeatures` collapses this dual-branch block to the single-branch case and incidentally retires the foot-gun.

## Subcommand Impact Map

| Subcommand | Source | Prebuild dependency | Removal impact |
|------------|--------|---------------------|----------------|
| `lace up` | `commands/up.ts` -> `lib/up.ts` | Branches on `hasPrebuildFeatures` (line 393); skips prebuild phase if absent. | Delete the branch + the entire prebuild phase block (`up.ts:888-926`). Deletes ~70 LoC. |
| `lace prebuild` | `commands/prebuild.ts` -> `lib/prebuild.ts` | Entire pipeline. | Delete subcommand + library. ~440 LoC. |
| `lace status` | `commands/status.ts` -> `lib/status.ts` | Entire pipeline reports prebuild state. | Delete or repurpose. ~120 LoC. |
| `lace restore` | `commands/restore.ts` -> `lib/restore.ts` | Entire pipeline restores Dockerfile from `lace.local/`. | Delete. ~155 LoC. |
| `lace resolve-mounts` | `commands/resolve-mounts.ts` -> `lib/resolve-mounts.ts` | None. Reads `customizations.lace.repoMounts` only. | No change. |
| `lace validate` | `commands/validate.ts` -> `lib/up.ts` (`validateOnly: true`) | Inherits `up.ts` branching but skips prebuild phase by design. | One conditional becomes always-true; one test (`validate.test.ts:110-138`) becomes vestigial. |

Three of six subcommands disappear (`prebuild`, `restore`, `status`).
None of the remaining three structurally branch on prebuild after the removal.

## Custom `customizations.lace.*` Keys

Enumerated by grepping `customizations\.lace\.\w+` and reading the schema files:

| Key | Defined where | Read where | Prebuild-aware? |
|-----|---------------|------------|-----------------|
| `prebuildFeatures` | `devcontainer.ts:137-163` (`extractPrebuildFeatures`), `template-resolver.ts:56-79` (`extractPrebuildFeaturesRaw`) | All over up.ts and prebuild.ts | **Yes (the subject of removal)** |
| `repoMounts` | `devcontainer.ts:246-267` (`extractRepoMounts`) | `resolve-mounts.ts:79`, `up.ts:395` | No |
| `mounts` (project-level) | `template-resolver.ts:88-110` (`extractProjectMountDeclarations`) | `up.ts:497-499` | No |
| `workspace` | `workspace-layout.ts:7-20`, extracted at lines 40-72 | `up.ts:223-251` | No |
| `validate` | `host-validator.ts:27-54` | `up.ts:256-282` | No |
| `mounts` (feature-level metadata) | `feature-metadata.ts:88-89`, `extractLaceCustomizations:641-689` | `template-resolver.ts:290-313` (block-agnostic) | No (declared on features in either block, treated identically) |
| `ports` (feature-level metadata) | `feature-metadata.ts:87`, `extractLaceCustomizations:641-689` | `template-resolver.ts:162-268` (block-aware: see "appPort asymmetry") | **Partial** (asymmetric injection differs) |

Six of the seven keys are prebuild-agnostic.
Only `prebuildFeatures` itself and the `ports`/`appPort` injection mechanism are coupled.

## Test Surface Impact

Tests that explicitly test prebuild behavior and would need rewrite-or-delete (file: prebuild-reference count from grep):

- `packages/lace/src/lib/__tests__/template-resolver.test.ts` (47 references): keep tests for `buildFeatureIdMap`, `autoInjectPortTemplates` symmetric path, mounts injection. Delete tests for `extractPrebuildFeaturesRaw`, `injectForPrebuildBlock` (T1, T2, T4-T5), `warnPrebuildPortTemplates` (1602+), and the prebuild-only sub-cases inside other suites (lines 826, 851, 1235, 1263, 1305). Estimated 30-40% of file deleted.
- `packages/lace/src/lib/__tests__/devcontainer.test.ts` (8 references): delete `extractPrebuildFeatures` tests (lines 48-241). ~50 lines.
- `packages/lace/src/lib/__tests__/validation.test.ts` (1 reference): delete `validateNoOverlap` tests entirely.
- `packages/lace/src/lib/__tests__/user-config-merge.test.ts` (3 references): delete the "user features go into prebuildFeatures when project has them" case (line 249-).
- `packages/lace/src/lib/__tests__/dockerfile.test.ts`, `metadata.test.ts`, `lockfile.test.ts`: delete entirely. These cover prebuild-only library code.
- `packages/lace/src/commands/__tests__/prebuild.integration.test.ts` (68 references): delete entirely.
- `packages/lace/src/commands/__tests__/restore.integration.test.ts` (27 references): delete entirely.
- `packages/lace/src/commands/__tests__/status.integration.test.ts` (13 references): delete entirely.
- `packages/lace/src/commands/__tests__/up.integration.test.ts` (38 references): keep file; delete prebuild-specific cases.
- `packages/lace/src/commands/__tests__/validate.test.ts` (4 references): delete the "validateOnly: true skips prebuild phase" case (line 110-138).
- `packages/lace/src/__tests__/e2e.test.ts` (18 references): delete entirely (file is purely the prebuild lifecycle e2e).
- `packages/lace/src/__tests__/portless-scenarios.test.ts` (8 references): keep file; delete the P1 prebuild-specific scenario.
- `packages/lace/src/__tests__/claude-code-scenarios.test.ts` (~5 references): delete C7.
- `packages/lace/src/__tests__/docker_smoke.test.ts`: delete the prebuild-runs section.

Estimate: 4 test files deleted entirely (`prebuild.integration`, `restore.integration`, `status.integration`, `e2e`, plus prebuild-only library tests `dockerfile`, `metadata`, `lockfile`).
8 files trimmed.
~150-200 LoC of test code removed.

The fixtures `__fixtures__/devcontainers/null-prebuild.jsonc`, `empty-prebuild.jsonc`, `overlap.jsonc`, `comments-and-trailing-commas.jsonc` (where it includes prebuild) become irrelevant.

## Real Project Configurations

Seven `devcontainer.json` files under `~/code/` use `prebuildFeatures`. Inventoried:

| Project | Path | `prebuildFeatures` contents | Move-to-features feasibility |
|---------|------|------------------------------|------------------------------|
| whelm | `~/code/apps/whelm/.devcontainer/devcontainer.json:20-23` | `weftwiseink/lace-fundamentals:1`, `./features/sprack` | Trivial. Neither feature has port metadata. |
| backup | `~/code/apps/backup/.devcontainer/devcontainer.json:20-23` | Identical to whelm (clone of whelm) | Trivial. |
| weftwise | `~/code/weft/weftwise/main/.devcontainer/devcontainer.json:87-94` | `git:1`, `sshd:1`, `wezterm-server:1`, `weftwiseink/claude-code:1`, `weftwiseink/neovim:1`, `nushell:0` | Mostly trivial. The `wezterm-server` feature carries a `hostSshPort` port declaration that today gets the asymmetric `appPort` mapping. Moving to `features` would either change the mapping semantics or require a hand-written `appPort` entry. |
| lace (this repo) | `~/code/weft/lace/main/.devcontainer/devcontainer.json:42-52` | `weftwiseink/lace-fundamentals:1`, `git:1`, `rust:1`, `./features/sprack` | Trivial. No port-declaring features. |
| clauthier | `~/code/weft/clauthier/main/.devcontainer/devcontainer.json:19-26` | `git:1`, `weftwiseink/lace-fundamentals:1`, `danzilberdan/opencode:0` | Trivial. |
| dotfiles | `~/code/personal/dotfiles/.devcontainer/devcontainer.json:13-18` | `git:1`, `sshd:1` | Trivial. |
| lace worktree | `~/code/weft/lace/.claude/worktrees/agent-adc14f21/.devcontainer/devcontainer.json:60-73` | Stale snapshot of an older lace config | N/A (auto-generated). |

Of seven user configs, six are trivially convertible.
Only `weftwise` has a port-declaring feature (`wezterm-server`/`hostSshPort`) in `prebuildFeatures`, and that single edge case is the one place where the asymmetric-injection behavior currently kicks in for real-world users.

## What "Delete prebuildFeatures" Would Look Like Concretely

Function-level changes (not redesign, just deletion mechanics):

1. **Delete entirely.**
   - `lib/devcontainer.ts`: `extractPrebuildFeatures` (137-163), `generateTempDevcontainerJson` (228-241).
   - `lib/template-resolver.ts`: `extractPrebuildFeaturesRaw` (56-79), `injectForPrebuildBlock` (226-268), `warnPrebuildPortTemplates` (901-932), `warnPrebuildPortFeaturesStaticPort` (944-994).
   - `lib/validation.ts`: `validateNoOverlap` (23-39), `featureIdentifier` (10-14, only used by the former).
   - `lib/prebuild.ts`: entire file.
   - `lib/restore.ts`: entire file.
   - `lib/status.ts`: entire file.
   - `lib/dockerfile.ts`: entire file (its tag-rewriting helpers exist solely for prebuild).
   - `lib/metadata.ts`: entire file (`.lace/prebuild/metadata.json` writer).
   - `lib/lockfile.ts`: entire file (lockfile merge is prebuild-only).
   - `commands/prebuild.ts`, `commands/restore.ts`, `commands/status.ts`: entire files.
   - `src/index.ts`: drop the three subcommand registrations.

2. **Collapse.**
   - `lib/up.ts:393-394`: drop `hasPrebuildFeatures`.
   - `lib/up.ts:402-409`: drop `rawPrebuildFeatures` and `allRawFeatures`; rename to `rawFeatures`/`featureIds`.
   - `lib/up.ts:545-550`: drop the second `Object.keys(prebuildFeatures)` spread in `featureShortIds`.
   - `lib/up.ts:797-800`: drop `extractPrebuildFeaturesRaw` from `allFeatureRefs`.
   - `lib/up.ts:809-836`: keep only the `features[fundamentalsRef]` arm of the lace-fundamentals `defaultShell` injection; delete the `prebuildFeatures[fundamentalsRef]` arm and its NOTE-callout warning.
   - `lib/up.ts:888-926`: delete the entire prebuild phase block.
   - `lib/up.ts:347-353`: in user-config Phase 0c, drop the `mergedPrebuildFeatures` write-back.
   - `lib/template-resolver.ts:564-566`: replace `{...features, ...prebuildFeatures}` with just `features`. Same in `lib/up.ts:408`, `546-550`.
   - `lib/user-config-merge.ts:158-173`: delete the prebuild-routing branch in `applyUserConfig`. Drop `mergedPrebuildFeatures` from the return type.

3. **Validate-and-rename.**
   - `commands/validate.ts:38`: drop `validateOnly: true` plumbing if no remaining branch needs it. (It's still used to skip the devcontainer-up phase, so keep but rename.)
   - All seven user `devcontainer.json` files: rename `prebuildFeatures` -> `features`. The `weftwise` config additionally needs to either accept symmetric port mapping or hand-write its `appPort`.

4. **Documentation.**
   - `packages/lace/docs/prebuild.md`, `migration.md`, `architecture.md`, `troubleshooting.md`, `README.md`: substantial rewrites. Out of scope for the source refactor itself but tracked here for completeness.

## Honest Assessment

This is a 400-700 LoC source refactor plus 150-200 LoC of test cleanup. Not a 100-line tweak; not a 1000-line rework.
It is the *opposite* of what the author probably feared: prebuild has *not* grown roots into the rest of lace.
The mechanism is broad but shallow.
The lines are concentrated in five files, three of which are deleted outright.

Three risks to call out, in declining order of severity:

1. **Asymmetric port mapping is a real behavioral change for `weftwise`.**
   `wezterm-server`'s `hostSshPort` is the only port-declaring feature presently in any `prebuildFeatures` block in any user config.
   Today its container-side port is the metadata default (whatever it is) and lace allocates the host side.
   Symmetric mapping would unify the two.
   Either the wezterm-server feature must be made runtime-configurable for the SSH listening port (a feature change, not a lace change), or the user must accept a different mapping, or the user must hand-write the `appPort` entry.
   This is the only entanglement in the whole report classifiable as "blocking" in any meaningful sense, and even it is blocking only the *removal* path that goes through `weftwise` without a workaround.

2. **The `lace-fundamentals` integration's prebuild arm hides a foot-gun whose removal is a feature.**
   `up.ts:828-836` warns in a NOTE callout about shared object references through the extraction chain when mutating prebuild-feature options.
   Deleting the arm retires the foot-gun.
   No risk; just upside.

3. **The collision-incident report (2026-05-06) gets resolved for free.**
   The dedup-granularity mismatch between `mergeUserFeatures` (full-ref) and `buildFeatureIdMap` (short-ID) only matters because user-layer features get routed into `prebuildFeatures` separately from `features`.
   If both layers go into one `features` block, the collision check still fires but the regression class disappears.
   Same reasoning: no risk; upside.

The "axe the special feature treatment" instinct is sound.
The hard part of removal is not lace itself; it is the user-level decision of what to do with prebuild-as-a-performance-feature, which is the actual question the RFP exists to answer.
The lace code is ready to give up the abstraction whenever the design is.

## Citations

Source files cited:
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/devcontainer.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/template-resolver.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/feature-metadata.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/up.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/prebuild.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/status.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/restore.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/resolve-mounts.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/user-config.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/user-config-merge.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/validation.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/mount-resolver.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/workspace-layout.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/host-validator.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/prebuild.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/status.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/validate.ts`

Feature manifests cited:
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/lace-fundamentals/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/claude-code/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/portless/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/neovim/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/sprack/devcontainer-feature.json`

User configs cited:
- `/home/mjr/code/apps/whelm/.devcontainer/devcontainer.json`
- `/home/mjr/code/apps/backup/.devcontainer/devcontainer.json`
- `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`
- `/home/mjr/code/weft/clauthier/main/.devcontainer/devcontainer.json`
- `/home/mjr/code/weft/lace/main/.devcontainer/devcontainer.json`
- `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`
- `/home/mjr/code/weft/lace/.claude/worktrees/agent-adc14f21/.devcontainer/devcontainer.json`

Test files surveyed:
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/__tests__/template-resolver.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/__tests__/devcontainer.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/__tests__/validation.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/__tests__/user-config-merge.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/__tests__/prebuild.integration.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/__tests__/restore.integration.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/__tests__/status.integration.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/__tests__/up.integration.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/__tests__/validate.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/__tests__/e2e.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/__tests__/portless-scenarios.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/__tests__/claude-code-scenarios.test.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/__tests__/fundamentals-scenarios.test.ts`

Related cdocs:
- `/var/home/mjr/code/weft/lace/main/cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-05-05-prebuild-cache-system-options.md`
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-05-06-devcontainer-features-actual-behavior.md`
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-05-06-prebuild-original-rationale.md`
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-05-06-feature-id-short-id-collision-incident.md`
- `/var/home/mjr/code/weft/lace/main/cdocs/proposals/2026-02-09-prebuild-features-port-support.md`
