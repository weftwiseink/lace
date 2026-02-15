---
review_of: cdocs/devlogs/2026-02-15-mount-accessor-api-v2-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T22:00:00-08:00
task_list: lace/template-variables
type: review
state: live
status: done
tags: [fresh_agent, implementation, code_quality, test_coverage, api_design, security, regex]
---

# Review: Mount Accessor API v2 Implementation

## Summary Assessment

This devlog documents a 6-phase rework of the mount template system from v1 to v2, replacing `${lace.mount.source(label)}` / `${lace.mount.target(label)}` with a unified `${lace.mount(label)}` entrypoint with `.source` and `.target` property accessors.
The implementation is thorough and well-structured: declarations, resolver, auto-injection, validation, pipeline wiring, and migration are all cleanly separated into phases.
The code quality is high, with strong error messages, comprehensive test coverage (589 tests), and complete v1 cleanup.
The primary finding is a missing test for v1 syntax rejection by the unknown-pattern guard, which the proposal explicitly calls out as a success criterion.
Verdict: **Accept** with non-blocking suggestions.

## Source Code Findings

### mount-resolver.ts

**Declaration validation gap in `validateDeclaration()`** [non-blocking]

The method on line 126 checks `Object.keys(this.declarations).length > 0` before validating, which means an empty declarations map silently bypasses validation.
This is intentional for backwards compatibility (as tested in `"allows any label when declarations map is empty"`), but the pattern is fragile: if a caller forgets to pass declarations, errors are silently swallowed.
The `hasDeclarations()` method provides an explicit check, and `up.ts` always passes declarations when mount templates exist, so this is a minor concern.

**`resolveFullSpec()` duplicates declaration-existence check** [non-blocking]

`resolveFullSpec()` calls `resolveSource()` (which calls `validateDeclaration()` internally) and then separately checks `if (!decl)` on line 231.
The second check is dead code when declarations are non-empty because `resolveSource()` would have already thrown.
When declarations are empty, `resolveSource()` bypasses the check (per the backwards-compat logic), and then `resolveFullSpec()` catches the missing declaration at line 231.
This is functional but the flow is subtle.
Consider adding a comment explaining why both checks exist.

**Resolver always auto-creates default directories** [non-blocking]

`resolveSource()` calls `mkdirSync(defaultPath, { recursive: true })` unconditionally for non-override paths.
This is correct for the current use case (docker mount sources must exist), but worth noting that it has a side effect on the host filesystem during template resolution.
The tests properly clean up via `trackProjectMountsDir()`.

### template-resolver.ts

**Regex patterns are correct and safe** [positive]

The three mount patterns (`LACE_MOUNT_TARGET_PATTERN`, `LACE_MOUNT_SOURCE_PATTERN`, `LACE_MOUNT_PATTERN`) use `[^)]+` as the label capture, which prevents catastrophic backtracking: the character class is deterministic and the `+` is anchored between literal `(` and `)`.
The `LACE_UNKNOWN_PATTERN` correctly uses negative lookahead for `port\(` and `mount\(`, which means v1 syntax `${lace.mount.source(foo)}` starts with `mount.` (dot not paren) and is correctly rejected.

**Resolution order correctly handles pattern overlap** [positive]

The code resolves `.target` before `.source` before bare `${lace.mount(label)}`, preventing the bare pattern from partially matching an accessor form.
The `lastIndex` reset pattern (lines 569-584) is thorough and handles the global regex state correctly.

**`mountLabelReferencedInMounts()` regex construction** [non-blocking]

Line 422 escapes special regex characters in the label, which is good defensive coding.
However, mount labels are already validated by `LABEL_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+$/`, so the only special character that could appear is `/`.
The escape is still correct and harmless.

**`resolveStringValue()` mount resolution skipped when no resolver** [positive]

Lines 619-655 are guarded by `if (mountResolver)`, so mount templates pass through as literal strings when no resolver is supplied.
Test 17 explicitly verifies this behavior.
This is a clean separation of concerns.

**`buildMountDeclarationsMap()` processes feature and prebuild feature metadata identically** [positive]

The function iterates `metadataMap` entries uniformly.
Since `metadataMap` is built from both `features` and `prebuildFeatures` in `up.ts`, prebuild feature mounts are naturally included.
This matches the proposal's rationale that mounts are runtime config with no build/runtime asymmetry.

**`emitMountGuidance()` outputs to `console.log`** [non-blocking]

The guidance function writes to `console.log` (line 408) rather than using a structured logger or returning strings.
This is consistent with other console output in `up.ts`, but makes it harder to test guidance content in integration tests.
The integration tests verify exit codes and output files rather than console output, which is pragmatic.

### feature-metadata.ts

**`parseMountDeclarationEntry()` is well-factored** [positive]

The shared helper (lines 579-600) validates all fields with proper type guards and returns `null` for invalid entries rather than throwing.
Both `extractLaceCustomizations()` and `extractProjectMountDeclarations()` use this helper, avoiding duplicated validation logic.
The `_key` parameter is unused (prefixed with underscore), which is clean.

**New fields (`recommendedSource`, `type`, `consistency`) have proper type guards** [positive]

Each optional field is checked with `typeof ... === "string"` or `typeof ... === "boolean"` before inclusion, and non-conforming values are silently dropped to `undefined`.
This gracefully handles malformed feature metadata without hard errors.

### up.ts

**Pipeline wiring is well-ordered** [positive]

The mount pipeline follows a clear sequence: extract project declarations (Step 3d) -> auto-inject (Step 3d) -> validate namespaces and targets (Step 3e) -> create resolver with declarations -> resolve templates -> emit guidance.
Validation happens before resolution, which means invalid configurations fail fast with clear error messages rather than producing confusing resolution errors.

**Step naming is slightly non-sequential** [non-blocking]

The steps are labeled 3d, 3e, 3b, 3c in the code comments (lines 227, 235, 259, 269).
This suggests they were added incrementally rather than renumbered.
The ordering in the actual code is correct (auto-inject mounts -> validate mounts -> warn prebuild ports -> create resolver), but the comment labels are confusing.
Consider renumbering to reflect actual execution order.

**Settings loaded with try/catch fallback** [positive]

Lines 270-279 handle `SettingsConfigError` gracefully by warning and continuing with empty settings.
This means a malformed `settings.json` does not prevent `lace up` from running: mount overrides simply do not apply, and the user sees a clear warning.

### .devcontainer/devcontainer.json

**Migration is clean and complete** [positive]

The two v1 mount template entries are removed from the `mounts` array.
`customizations.lace.mounts` declares both `bash-history` and `claude-config` with proper metadata.
`containerEnv.CLAUDE_CONFIG_DIR` uses the `.target` accessor.
Static mounts (SSH key, wezterm config) are correctly left as-is.
Build args (`COMMAND_HISTORY_PATH`, `USERNAME`) are unchanged since they are build-time values that cannot use lace templates.
The comments are informative and reference the mount declarations and settings override pattern.

## Test Coverage Findings

**Comprehensive coverage of all three accessor forms** [positive]

The template-resolver tests cover:
- Bare form resolving to full mount spec (Tests 13-15)
- `.source` accessor in mount strings, containerEnv, and nested objects (Tests 2, 3, 5, 6)
- `.target` accessor in containerEnv, lifecycle commands, and nested objects (Tests 9-11, 18-19)
- Mixed `.source` and `.target` in the same string (Test 12)
- Mixed port and mount templates (Test 4)
- No resolver supplied: mount expressions pass through (Test 17)

**Auto-injection suppression tested for all accessor forms** [positive]

Tests verify that existing `${lace.mount(label)}`, `${lace.mount(label).source}`, and `${lace.mount(label).target}` references all prevent duplicate injection.

**Validation functions have thorough test coverage** [positive]

`validateMountNamespaces` and `validateMountTargetConflicts` are both tested with pass, fail, empty, and multi-entry cases.
Error messages are verified to include useful context (conflicting labels, available namespaces).

**Integration tests cover the full pipeline** [positive]

`up-mount.integration.test.ts` covers: basic source resolution, multiple mounts, settings override, mixed port+mount, invalid label error, override path missing, no mount templates, containerEnv resolution, project declarations with auto-injection, mount target in containerEnv, target conflict validation, and feature mount declarations end-to-end.

**Missing test: v1 syntax rejection by unknown-pattern guard** [non-blocking]

The proposal's Phase 2 success criteria explicitly state: "v1 syntax `${lace.mount.source(foo)}` is rejected by unknown pattern guard."
The devlog confirms v1 references were removed via ripgrep, but no test verifies that `${lace.mount.source(foo/bar)}` triggers the `LACE_UNKNOWN_PATTERN` error.
The regex logic is correct (`.source(` does not start with `mount(`), but a regression test would document this important backward-incompatibility guarantee.

**Missing test: `parseMountDeclarationEntry` with `recommendedSource`, `type`, `consistency`** [non-blocking]

The `feature-metadata.test.ts` tests cover basic mount parsing (target, description, readonly) and non-boolean readonly filtering.
The `recommendedSource`, `type`, and `consistency` fields added in this v2 rework are parsed by `parseMountDeclarationEntry()` but are not directly tested through `extractLaceCustomizations`.
The mount-resolver tests exercise `type` and `consistency` via `resolveFullSpec()`, and `recommendedSource` is exercised by the guidance emission, so coverage is indirect but present.

**Test cleanup is disciplined** [positive]

All test files use `trackProjectMountsDir()` for cleanup of auto-created directories under `~/.config/lace`.
`LACE_SETTINGS` environment variable is set and cleaned per test in integration tests.
Temp directories use unique suffixes to prevent test interference.

## Proposal Compliance

**All 6 phases implemented as specified** [positive]

Each phase matches its proposal description: declaration schema, template patterns, auto-injection, pipeline wiring, devcontainer migration, and smoke test.
The devlog records commit hashes for phases 1-5 and detailed pipeline output for phase 6.

**All edge cases from the proposal are handled** [positive]

- Target conflict: validated by `validateMountTargetConflicts()`, tested in integration.
- Override path missing: hard error from `resolveSource()`, tested in integration.
- Mount referenced but no declaration: hard error during resolution, tested.
- Auto-injection + explicit override: suppression tested for all three accessor forms.
- `.source` accessor outside mounts array: tested in containerEnv (Test 3).
- Bare form outside mounts array: no special handling (resolves to full spec), documented in proposal as intentional.
- Prebuild features with mount declarations: treated identically, tested.
- Invalid label format: hard error, tested.
- Mixed lace templates and devcontainer variables: pass-through verified by existing spec-native variable tests.

**`recommendedSource` is guidance-only, never used as actual source** [positive, security]

The `recommendedSource` field appears only in `LaceMountDeclaration.recommendedSource` and is consumed exclusively by `emitMountGuidance()` for console output.
It is never passed to `resolveSource()`, never used to construct filesystem paths, and never included in the resolved mount spec string.
This matches the proposal's security requirement that features cannot opaquely mount host directories.

**No over-engineering detected** [positive]

The implementation follows the port system's established patterns closely.
The `buildMountDeclarationsMap()`, `validateMountNamespaces()`, and `validateMountTargetConflicts()` functions are all straightforward and single-purpose.
The guided config UX is simple console output without an interactive flow (which the proposal explicitly defers).

## Verdict

**Accept.**

The implementation is a clean, well-tested rework that follows the accepted proposal faithfully.
Code quality is high: error messages include available labels and conflicting targets, regex patterns are safe from backtracking, the security model for `recommendedSource` is correctly enforced, and legacy v1 code is fully removed.
All blocking proposal requirements are met.
The non-blocking suggestions below would strengthen the test suite and code clarity.

## Action Items

1. [non-blocking] Add a test verifying that v1 syntax `${lace.mount.source(foo/bar)}` is rejected by the `LACE_UNKNOWN_PATTERN` guard. This is a proposal success criterion for Phase 2.
2. [non-blocking] Add a comment in `resolveFullSpec()` explaining why both `resolveSource()` (which validates via `validateDeclaration()`) and the explicit `if (!decl)` check exist, given the backwards-compat bypass in `validateDeclaration()`.
3. [non-blocking] Renumber the pipeline step comments in `up.ts` (currently 3d, 3e, 3b, 3c) to reflect actual execution order.
4. [non-blocking] Consider adding a direct unit test for `parseMountDeclarationEntry()` with `recommendedSource`, `type`, and `consistency` fields to complement the indirect coverage through `resolveFullSpec()` tests.
