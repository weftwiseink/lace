---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T20:15:00-08:00
task_list: lace/dogfooding
type: devlog
state: archived
status: done
tags: [proposal, review, ports, prebuild, architecture, asymmetric_injection]
---

# Prebuild Features Port Support Proposal: Devlog

## Objective

Write a design proposal for fixing the silent failure where port-declaring features in `customizations.lace.prebuildFeatures` are invisible to the port allocation pipeline, then iterate through self-review rounds until accepted. The [port allocation investigation](../reports/2026-02-09-lace-port-allocation-investigation.md) identified this bug as the root cause of the dotfiles container having zero port bindings.

## Plan

1. Read all relevant source files to understand the port allocation pipeline end-to-end
2. Write a comprehensive proposal using the `/propose` skill
3. Self-review via `/review`, apply all blocking feedback
4. Iterate reviews until accepted
5. Write this devlog

## Analysis Phase

### Source files examined

The full pipeline from config reading through port generation:

- **`up.ts`** -- Main `lace up` pipeline. Lines 121-126 extract features only from the top-level `features` key. Line 133 gates the metadata pipeline on `featureIds.length > 0`. Line 205 creates `structuredClone` for resolution. Line 260+ runs prebuild from disk independently.
- **`template-resolver.ts`** -- `autoInjectPortTemplates()`, `resolveTemplates()`, `generatePortEntries()`, `mergePortEntries()`, `buildFeatureIdMap()`, `warnPrebuildPortTemplates()`. The auto-injection only reads `config.features`. The `generatePortEntries` suppression logic checks `String(entry).startsWith("PORT:")`.
- **`feature-metadata.ts`** -- `fetchAllFeatureMetadata()`, `FeatureMetadata` type with `options` containing `default` values. `extractLaceCustomizations()` reads `customizations.lace.ports` from feature metadata.
- **`validation.ts`** -- `validateNoOverlap()` rejects features in both blocks (version-insensitive comparison).
- **`devcontainer.ts`** -- `extractPrebuildFeatures()` with discriminated union result type.
- **`prebuild.ts`** -- `runPrebuild()` reads config from disk independently via `readDevcontainerConfig(configPath)`.
- **`port-allocator.ts`** -- Label-based, range 22425-22499. Block-agnostic.

### Key architectural insight: prebuild reads from disk

The prebuild pipeline at `prebuild.ts` line 70 reads the devcontainer.json from disk via `readDevcontainerConfig(configPath)`. It does NOT receive the in-memory `configForResolution` from `up.ts`. This means:
- Auto-injected values exist only in the `structuredClone` used for template resolution
- The prebuild sees original on-disk values and installs features with defaults
- Port reassignment does NOT invalidate the prebuild cache (desirable)

This separation is correct for build-time vs runtime concerns but has a critical implication for port mapping (see R2 discovery below).

## Implementation Notes

### R1 review: Three blocking issues

The initial proposal had three blocking problems:

1. **Write-back to merged copy.** The initial code sketch merged `features` and `prebuildFeatures` into `allFeatures = { ...features, ...prebuildFeatures }` and iterated over the merged object. Writes to this merged copy do not propagate back to the original config blocks because the spread creates a new object. Fix: iterate over each block separately via `injectForBlock()` using direct references.

2. **Diagnostic warning contradictory conditions.** The warning fired when "a prebuild feature declares ports AND no appPort references it." But auto-injection handles this case automatically, so the warning would either never fire (useless) or fire between injection and entry generation (wrong timing). Fix: narrow the warning to fire only when the user opts out of auto-injection with a static port value AND has no `appPort`.

3. **D5 factual inaccuracy.** The proposal claimed "by the time prebuild runs, `${lace.port()}` values have been replaced with concrete port numbers." This is wrong -- the prebuild reads from disk. Fix: correct D5 and E8 to accurately describe the disk-read separation.

### R2 review: The asymmetric injection discovery

This was the most significant finding. The R2 review accepted all R1 fixes but discovered a fundamental correctness issue:

**Symmetric auto-injection (`port:port`) is broken for prebuild features.** Here is why:

- Top-level features are installed at runtime by the devcontainer CLI, which passes the resolved option value (e.g., `sshPort: 22430`). The feature's install script configures the service on that port. Symmetric mapping `22430:22430` works.
- Prebuild features are installed at IMAGE BUILD TIME with default option values (e.g., `sshPort: "2222"`). The devcontainer CLI does NOT reinstall features already in the prebuild image. The resolved value in the extended config's `prebuildFeatures` block is dead data. The container has sshd on port 2222, but symmetric `appPort: ["22430:22430"]` maps host 22430 to container 22430 where nothing is listening.

This required a fundamental change to the injection model: prebuild features need **asymmetric injection**. Instead of injecting `${lace.port()}` into the feature option (which produces symmetric mapping), inject an asymmetric `appPort` entry that maps the lace-allocated host port to the feature's default container port: `"${lace.port(wezterm-server/sshPort)}:2222"`.

The fix required:
- New `injectForPrebuildBlock()` function targeting `appPort` instead of feature options
- Reading the feature's default port from `metadata.options[optionName].default`
- New design decision D5 explaining the asymmetric model
- Updated E6 (primary fix target) showing asymmetric behavior
- Updated test plan T1, T5, T9 for asymmetric expectations
- NOTE on E2 warning about `${lace.port()}` in prebuild feature options being a misconfiguration

### R3 review: Accepted

The R3 review verified:
- The suppression logic in `generatePortEntries` correctly suppresses symmetric entries when asymmetric entries exist (the `startsWith("PORT:")` check matches both symmetric and asymmetric formats)
- The `resolveStringValue` function handles embedded templates in `appPort` correctly (the `:2222` suffix means it goes through the embedded replacement path, not the full-match integer coercion path)
- All edge cases are internally consistent with the asymmetric model
- Three non-blocking suggestions were noted (test for `!defaultPort` guard, Phase 3 acceptance criteria wording, duplicate `appPort` entry when user provides both explicit `appPort` and no feature option)

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/proposals/2026-02-09-prebuild-features-port-support.md` | Full proposal: unified feature collection, asymmetric auto-injection for prebuild features, extended feature-ID map, diagnostic warning, test plan, implementation phases |
| `cdocs/reviews/2026-02-09-review-of-prebuild-features-port-support.md` | R1 review: 3 blocking issues (write-back, warning, D5/E8 factual errors) |
| `cdocs/reviews/2026-02-09-review-of-prebuild-features-port-support-r2.md` | R2 review: 1 blocking issue (symmetric mapping broken for prebuild features) |
| `cdocs/reviews/2026-02-09-review-of-prebuild-features-port-support-r3.md` | R3 review: accepted with non-blocking suggestions |
| `cdocs/devlogs/2026-02-09-prebuild-features-port-support-proposal.md` | This devlog |

## Key Decisions

1. **Unified collection, not pipeline duplication.** Merge features from both blocks into a single map at the pipeline entry point. This preserves the single-pass invariant of the port pipeline while extending its input scope.

2. **Asymmetric injection for prebuild features.** The core design decision. Prebuild features get `appPort` entries with `host:default_container_port` instead of `${lace.port()}` templates in feature options. This is because prebuild features are installed at image build time with defaults; the devcontainer CLI does not reinstall them at runtime.

3. **No changes to prebuild pipeline, validateNoOverlap, or PortAllocator.** The fix is contained within the port pipeline's input collection and injection phases. The prebuild pipeline's disk-read independence is preserved as a feature, not a bug.

4. **Diagnostic warning only for static-port opt-out.** The warning is narrowly scoped to catch the specific case where a user provides a static port value in a prebuild feature (opting out of auto-injection) without providing an `appPort` entry.

## Verification

This work session produced proposal and review documents only -- no code changes. Verification is structural:

- Proposal accepted at R3 after resolving all blocking issues from R1 (3 issues) and R2 (1 issue)
- R3 review has verdict "Accept" with only non-blocking suggestions
- Proposal frontmatter updated to `last_reviewed.status: accepted`, `round: 3`
- All code sketches verified against actual source files for correctness
- `generatePortEntries` suppression logic verified to correctly handle asymmetric `appPort` entries

## Deferred Work

- **Implementation** of the proposal (7 phases defined in the proposal)
- **Non-blocking R3 items:** test for `!defaultPort` guard, Phase 3 acceptance criteria rewording, duplicate `appPort` entry handling
- **Dotfiles devcontainer fix** (Phase 7, downstream in a different repository)
