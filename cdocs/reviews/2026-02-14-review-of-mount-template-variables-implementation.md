---
review_of: cdocs/devlogs/2026-02-14-mount-template-variables-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:59:00-08:00
task_list: lace/template-variables
type: review
state: live
status: done
tags: [fresh_agent, code_quality, test_coverage, proposal_alignment, mount-resolver]
---

# Review: Mount Template Variables Implementation

## Summary Assessment

This devlog covers a 6-phase implementation adding `${lace.mount.source()}` and `${lace.mount.target()}` template variables to the lace devcontainer pipeline.
The implementation is well-structured, closely follows the port system's architecture as specified in the proposal, and delivers comprehensive test coverage (+45 tests across 4 files).
The most significant finding is a bug in the `SettingsConfigError` handling in `up.ts` that silently swallows genuine config errors (malformed JSON, bad `LACE_SETTINGS` path) rather than reporting them.
Verdict: **Revise** to fix the settings error handling; remaining findings are non-blocking.

## Section-by-Section Findings

### Phase 1: MountPathResolver + Settings Extension

The `MountPathResolver` class in `mount-resolver.ts` is clean and well-designed.
It follows the proposal's two-tier resolution pattern (settings override then default path derivation) and includes proper label validation, assignment persistence, and idempotent resolution.

**Finding 1 (non-blocking): Stale assignment persistence.**
When a mount label is removed from a devcontainer.json, the resolver still loads old assignments from `.lace/mount-assignments.json` and returns the cached path on the next `resolve()` call (line 131-133 of `mount-resolver.ts`).
This is harmless in practice because the label would not appear in any template, but the assignments file accumulates stale entries indefinitely.
The proposal explicitly defers cleanup to a future `lace clean` command, so this is consistent with design intent.

**Finding 2 (non-blocking): No validation of override path type.**
The resolver checks `existsSync()` for override paths but does not verify the path is a directory (vs. a file).
A user could accidentally set an override to a regular file, and the error would only surface at Docker mount time rather than at resolution time.
Low priority since this is a user-configuration problem with a clear error from Docker.

The `settings.ts` extension is minimal and clean: `MountOverrideSettings` with `source: string`, path expansion in `readSettingsConfig()`, and proper tilde handling via `resolveSettingsPath()`.
The 4 new settings tests cover parsing, tilde expansion, empty section, and undefined behavior.

The 17 mount-resolver tests cover all the proposal's test plan items: default derivation, settings override, auto-create, no auto-create for overrides, missing override error, persistence, label validation (spaces, uppercase, missing namespace, empty, too many slashes), valid labels, idempotent resolution, and projectId derivation.

### Phase 2: Template Resolution Integration

The regex patterns `LACE_MOUNT_SOURCE_PATTERN` and `LACE_MOUNT_TARGET_PATTERN` follow the established port pattern conventions.
The `LACE_UNKNOWN_PATTERN` relaxation with negative lookaheads for both `mount.source(` and `mount.target(` is correct and forward-looking (both were relaxed in Phase 2 even though target resolution arrives in Phase 5).

The `resolveStringValue()` extension is well-integrated: mount source resolution runs after port resolution, and mount target resolution runs after mount source resolution.
The collect-then-replace pattern matches the existing port resolution approach.

**Finding 3 (non-blocking): Updated error message.**
The proposal's Phase 2 constraints specified updating the unknown-pattern error message from "The only supported template is `${lace.port(...)}`" to list all supported templates.
The implementation at line 372-374 of `template-resolver.ts` does this correctly:
```
Supported templates: ${lace.port(featureId/optionName)}, ${lace.mount.source(namespace/label)}, ${lace.mount.target(namespace/label)}.
```

The 11 new template-resolver tests for mount source cover: unknown pattern relaxation, embedded resolution, standalone resolution, mixed port+mount, nested config, mounts array, no templates passthrough, invalid label, unresolved target passthrough, mountAssignments population, and no-resolver passthrough.

### Phase 3: Pipeline Wiring in up.ts

**Finding 4 (blocking): Silent swallowing of `SettingsConfigError`.**
Lines 241-251 of `up.ts` catch `SettingsConfigError` and silently continue with empty settings:

```typescript
try {
  settings = loadSettings();
} catch (err) {
  if (err instanceof SettingsConfigError) {
    // Settings not available -- mount overrides will not apply...
  } else {
    throw err;
  }
}
```

The comment says "settings not available," but `loadSettings()` already returns `{}` when no settings file exists (line 150-153 of `settings.ts`).
`SettingsConfigError` is only thrown for genuine errors: `LACE_SETTINGS` env var pointing to a non-existent file, or malformed JSON in an existing settings file.
Both are user configuration errors that should be surfaced, not silently swallowed.

This means if a user has a typo in their `settings.json` (malformed JSON), `lace up` silently ignores all mount overrides and falls back to defaults with no warning.
This is the same class of failure mode the proposal explicitly warns about for Docker ("Silently proceeding would cause Docker to create a root-owned directory, which is a worse failure mode than stopping early with a clear message").

**Recommended fix:** Either propagate the error (fail fast like the rest of the pipeline), or at minimum log a warning:
```typescript
if (err instanceof SettingsConfigError) {
  console.warn(`Warning: ${err.message}. Mount overrides will not apply.`);
}
```

**Finding 5 (non-blocking): Proposal deviation: settings not hoisted.**
The proposal's Phase 3 constraints state: "Phase 3 should hoist the `loadSettings()` call to `runUp()` level so the result can be passed to both `MountPathResolver` and `runResolveMounts()`."
The implementation loads settings separately in `up.ts` and `resolve-mounts.ts`, resulting in `loadSettings()` being called twice during `lace up` when repo mounts are configured.
The devlog acknowledges this deviation and justifies it as simpler and acceptable since `loadSettings()` is lightweight.
This is reasonable for now but introduces a subtle correctness risk: if the settings file changes between the two reads (unlikely but possible), the two callers see different config.

The 8 integration tests in `up-mount.integration.test.ts` are thorough: end-to-end resolution with persistence verification, multiple mounts, settings override, mixed port+mount, invalid label error, missing override error, no-templates passthrough, and mount source in containerEnv.

### Phase 4: Feature Mount Declarations

The `LaceMountDeclaration` interface in `feature-metadata.ts` and the `autoInjectMountTemplates()` function in `template-resolver.ts` cleanly parallel the port auto-injection system.
Mount declarations are parsed with proper runtime type narrowing in `extractLaceCustomizations()`, and the `target` field is correctly required (entries without `target` are skipped).

**Finding 6 (non-blocking): `autoInjectMountTemplates` skips prebuild features.**
The function only iterates `config.features`, not `extractPrebuildFeaturesRaw(config)`.
By contrast, `autoInjectPortTemplates` has separate handling for both feature blocks (symmetric injection for top-level, asymmetric for prebuild).
This is likely intentional since prebuild features are baked into the image and their mounts would need to be present at build time, but it is not explicitly documented as a design decision in the proposal or devlog.
If a prebuild feature declares `customizations.lace.mounts`, the declaration would be silently ignored.

The feature-metadata tests cover: well-formed mount extraction, missing target skipping, all-fields parsing, combined ports+mounts, and non-boolean readonly filtering.
The template-resolver tests cover: single mount injection, multiple mounts, readonly mount, skipping features without metadata, appending to existing mounts array.

### Phase 5: `${lace.mount.target()}` Resolution

The `buildMountTargetMap()` function and target resolution in `resolveStringValue()` are straightforward and correct.
The error messages for missing labels are descriptive and include the list of available labels.
The 14 new tests cover: basic resolution, missing label error, containerEnv resolution, lifecycle command resolution, mixed source+target in same string, nested config, array elements, empty target map, and combined port+target.

**Finding 7 (non-blocking): Target resolution error message asymmetry.**
When a mount target label is not found, the error says "not found in feature metadata" and lists available labels.
When a port label references a non-existent feature, the error says "Feature not found in config."
The mount target error refers to "feature metadata" while the mount source error (from `MountPathResolver.resolve()`) throws about invalid labels or missing override paths.
These are different failure modes so the different messages are appropriate, but the inconsistency in framing ("feature metadata" vs. "config") is worth noting.

### Phase 6: Migrate Lace Devcontainer

The `.devcontainer/devcontainer.json` migration is clean.
Mounts 0 and 1 now use `${lace.mount.source(project/bash-history)}` and `${lace.mount.source(project/claude-config)}` respectively.
Mounts 2 (SSH key) and 3 (wezterm config) are correctly left unchanged per the proposal's exclusion rationale.
The inline comments (`// NOTE: Tied to mounts[0]`) in the build args section remain accurate since the targets have not changed.

### Deviations from Proposal

The devlog documents two deviations:

1. **Settings loading not hoisted:** Justified as simpler. Covered in Finding 5 above.
2. **Phase ordering (Phase 6 parallel with Phase 4):** This is a process optimization, not a design deviation. The commit order in the Verification section shows Phase 6 (commit fb457a1) was committed between Phase 3 and Phase 4, consistent with the claim. No impact on correctness.

**Undocumented deviation:** The proposal's Phase 3 constraints say "Settings are loaded once and shared between mount resolution and repo mount resolution. [...] This requires adding a `settings` parameter to `runResolveMounts()`." This was not done. The deviation is related to Finding 5 but the devlog's explanation only covers the `up.ts` side, not the `runResolveMounts()` interface change that was skipped.

### Test Coverage Assessment

The implementation adds 45 tests across 4 files, from a baseline of 510 to 555.
Coverage is comprehensive across all phases:

- `mount-resolver.test.ts`: 17 unit tests covering all resolver behavior
- `settings.test.ts`: 4 new tests for mount override settings
- `template-resolver.test.ts`: ~25 new tests for source resolution, target resolution, auto-injection, and buildMountTargetMap
- `up-mount.integration.test.ts`: 8 integration tests covering end-to-end pipeline

**Missing test scenarios (non-blocking):**

1. No test for `SettingsConfigError` handling in `up.ts` (related to Finding 4). There should be a test that verifies behavior when settings.json is malformed.
2. No test for a prebuild feature with `customizations.lace.mounts` declarations (related to Finding 6). This would document expected behavior (silent skip) or catch a regression if the behavior changes.
3. No test for duplicate mount labels across features (e.g., two features both declaring a mount named "config"). The `buildMountTargetMap` would silently overwrite the first with the second.

## Verdict

**Revise.** One blocking issue (Finding 4: silent `SettingsConfigError` swallowing) must be addressed.
The implementation is otherwise solid, well-tested, and faithfully follows the proposal's architecture.

## Action Items

1. [blocking] Fix `SettingsConfigError` handling in `up.ts` (lines 241-251). Either propagate the error or log a warning. Do not silently swallow genuine config errors.
2. [non-blocking] Add a test in `up-mount.integration.test.ts` that verifies behavior when `settings.json` contains malformed JSON.
3. [non-blocking] Document in the devlog or as a code comment that `autoInjectMountTemplates` intentionally skips prebuild features and why.
4. [non-blocking] Consider adding a test for duplicate mount labels across features in `buildMountTargetMap` (last-write-wins behavior should be documented or guarded).
5. [non-blocking] Consider validating that override paths are directories (not files) in `MountPathResolver.resolve()`.
