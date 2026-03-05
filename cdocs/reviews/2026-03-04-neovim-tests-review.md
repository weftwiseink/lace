---
review_of: cdocs/devlogs/2026-03-03-neovim-feature-tests-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-04T12:00:00-08:00
task_list: lace/devcontainer-features
type: review
state: archived
status: done
tags: [fresh_agent, test_plan, scenario_tests, neovim, devcontainer_features, code_quality, completeness]
---

# Review: Neovim Feature Tests Implementation

## Summary Assessment

This devlog documents the implementation of 10 new tests (3 unit, 5 scenario, 2 Docker smoke) for the neovim devcontainer feature, plus the addition of `recommendedSource` to the feature metadata and documentation updates.
The implementation is solid: tests follow the established `wezterm-server-scenarios.test.ts` patterns precisely, the `recommendedSource` addition is correct and well-motivated, and the devlog documents design decisions (especially the `${_REMOTE_USER}` edge case) clearly.
The main gap is that N5 tests a different failure mode than the proposal specified (non-existent settings override path vs. missing settings entirely), which is a pragmatic adaptation to the `recommendedSource` addition but should be explicitly acknowledged.
Verdict: **Accept** with minor non-blocking suggestions.

## Section-by-Section Findings

### Objective and Plan

The objective is clear and the six-phase plan is well-sequenced.
The plan correctly identifies the dependency chain: metadata fix (Phase 1) must precede scenario tests (Phase 3) because `recommendedSource` changes the mount resolution behavior.

### Testing Approach

The devlog states it follows `wezterm-server-scenarios.test.ts` patterns exactly.
Verified: the actual test file at `packages/lace/src/__tests__/neovim-scenarios.test.ts` mirrors the wezterm-server file's structure:

- Same imports from `scenario-utils.ts` (`createScenarioWorkspace`, `symlinkLocalFeature`, `copyLocalFeature`, `writeDevcontainerJson`, `readGeneratedConfig`, etc.)
- Same `beforeEach`/`afterEach` pattern with `clearMetadataCache` and `ctx.cleanup()`
- Same `describe.skipIf(!isDockerAvailable())` gating for Docker tests
- Same `ScenarioWorkspace` context pattern with `let ctx: ScenarioWorkspace`

One difference: the wezterm-server file creates a temp SSH key in `beforeEach` (top-level, for all scenarios), while the neovim file only calls `setupScenarioSettings` within individual test blocks.
This is appropriate since not all neovim scenarios need the same settings, whereas wezterm-server's authorized-keys mount is needed by every scenario.

### `${_REMOTE_USER}` Design Decision

The devlog documents this well: `${_REMOTE_USER}` is a devcontainer spec variable resolved at install time, but lace passes it through as a literal string.
The decision to keep it as-is and document it as a known limitation (proposal Edge Case E1) is pragmatic.
The tests correctly handle this by using `.includes(".local/share/nvim")` rather than asserting on the full target path, avoiding brittleness around the variable.

The devlog notes that "the wezterm-server feature hardcodes `/home/node/...`" as a contrast.
This inconsistency between features is worth a follow-up to standardize, but is correctly deferred here.
**Non-blocking.**

### `recommendedSource` Addition

The `devcontainer-feature.json` now includes `"recommendedSource": "~/.local/share/nvim"` on the plugins mount declaration.
Verified in the actual file: the addition is correct and matches what `MountPathResolver.resolveValidatedSource()` expects.
The mount resolver flow is: (1) check settings override, (2) try `recommendedSource` expanded via `expandPath()`, (3) error.
With this addition, users who have `~/.local/share/nvim` on their host get zero-config mount resolution.

The devlog's explanation of why this was added ("allows lace to resolve the mount without a settings override") is accurate and well-motivated.

### Scenario Test Design: N1-N4

All four config-generation scenarios are well-designed:

- **N1** (mount auto-injection): Verifies the core mount pipeline. Uses `setupScenarioSettings` to provide a temp directory, isolating from host state. Assertions check source path, target inclusion, and bind type. Solid.
- **N2** (no port allocation): Verifies the mount-only feature does not trigger the port subsystem. The `expect(result.phases.portAssignment?.message).toContain("No port templates found")` assertion matches the wezterm-server S5 pattern. Also verifies `appPort`, `forwardPorts`, and `portsAttributes` are all undefined. Thorough negative test.
- **N3** (coexistence): Tests neovim + wezterm-server together. Verifies both mounts appear and that wezterm-server's port allocation still works. The assertion `expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425)` adds a useful lower-bound check not present in the proposal. Good addition.
- **N4** (version passthrough): Clean test verifying feature options are not corrupted by the mount system. Mirrors wezterm-server S6.

### Scenario Test Design: N5

The proposal specified N5 as testing the case where "no settings override is provided and no `recommendedSource` exists."
However, since `recommendedSource` was added in Phase 1, the original N5 scenario no longer applies.
The devlog adapts N5 to test a different failure mode: pointing a settings override to a non-existent path (`/tmp/nonexistent-nvim-plugins-dir-lace-test`).
This exercises the `resolveValidatedSource` code path's override validation (`expandPath()` then `validateSourceType()`) rather than the "no source available" error.

This is a valid and useful test, but it tests a generic mount-resolver behavior (non-existent override path), not something neovim-specific.
The devlog's Implementation Notes section mentions this adaptation but could be more explicit about the change from the proposal.
**Non-blocking** -- the test exercises a real failure mode, just a different one than originally proposed.

### Scenario Test Design: N6 (Docker Smoke)

Follows the wezterm-server S3 pattern:

- Uses `copyLocalFeature` (not symlink) for Docker build compatibility
- Uses `prepareGeneratedConfigForDocker` for path rewriting
- Uses `devcontainer up` via `execSync` with proper timeout
- Verifies nvim binary, version output, and install location

One deviation from the proposal: the devlog's N6 does **not** verify plugin directory ownership (`ls -la` check), which was proposed.
Looking at the actual test code (lines 284-343 of `neovim-scenarios.test.ts`), the test checks `nvim --version` and `which nvim` but does not check directory existence or ownership.
The proposal's N6 included `docker exec ${containerId} ls -la /home/vscode/.local/share/nvim` to verify the directory and its ownership.
This was likely dropped because the `_REMOTE_USER` variable makes the path unpredictable without knowing which base image user is used.
**Non-blocking** -- the core smoke test value (neovim installs and runs) is preserved.

### Scenario Test Design: N7 (Deferred)

N7 (architecture detection for aarch64) is explicitly listed in the proposal as a manual verification step, not an automated test.
The proposal states: "This scenario cannot be tested directly on x86_64 CI."
The devlog correctly omits N7 from the implementation, and the test file skips from N6 to N8.
The deferral is justified: cross-architecture testing requires either an aarch64 host or QEMU emulation, neither of which is practical in a standard CI environment.
The `install.sh` architecture detection is a simple case statement (`x86_64 -> x86_64`, `aarch64 -> arm64`), low-risk enough that manual verification is proportionate.
**No issues.**

### Scenario Test Design: N8 (Docker, Missing Curl)

Clean implementation. Mounts `install.sh` into an alpine container (which lacks curl by default) and verifies the error message.
The approach differs slightly from the proposal: the actual implementation uses `-v` mount to inject the script rather than piping via stdin, and sets environment variables via `-e` flags.
This is more robust than the proposal's stdin piping approach.
**No issues.**

### Unit Tests

Three tests added to `feature-metadata.test.ts`:

1. **`extractLaceCustomizations` with neovim metadata**: Tests `sourceMustBe: "directory"` and `recommendedSource` extraction. Asserts all fields including `readonly: undefined`, `type: undefined`, `consistency: undefined`, `hint: undefined`. Thorough.
2. **Undefined ports for mount-only feature**: Verifies `ports` is undefined when only mounts are declared. Good negative assertion.
3. **`parseMountDeclarationEntry` with neovim-style fields**: Tests the low-level parser with the exact neovim mount shape.

All three tests use the actual `${_REMOTE_USER}` literal in the target path, matching the real feature JSON. Consistent.

The first test's metadata uses `"/home/${_REMOTE_USER}/.local/share/nvim"` as the target, matching the real `devcontainer-feature.json`.
The second test uses `"/home/vscode/.local/share/nvim"` as a hardcoded variant.
This minor inconsistency is harmless (both test the same code path) but is worth noting for future maintainers.
**Non-blocking.**

### Documentation Updates

- **Root README**: Verified. The neovim feature appears in the features table alongside `claude-code` and `wezterm-server`, alphabetically sorted. Description is accurate.
- **Feature README**: Verified. Includes `recommendedSource` guidance, settings override instructions, and a mount declarations table with a "Default Source" column. Well-written.

### Verification Evidence

The devlog includes pasted build and test output:

- **Test results**: 812 tests, 32 files, all passing. The baseline comparison (790 before, 812 after, +22 total, 10 attributed to this work) is credible. The +22 vs. +10 discrepancy is explained by "parallel branches" contributing the other 12.
- **Build results**: Vite build succeeds, 30 modules, 125kB output. Credible.

The test count breakdown (3 unit + 5 scenario + 2 Docker = 10) matches what is in the code.
However, the devlog's Changes Made section says "7 tests" in the scenario file, not 10 total.
Reading more carefully: it says "New file with 7 tests: N1, N2, N3, N4, N5, N6, N8" for the scenario file and "Added 3 test cases" for the unit tests.
7 + 3 = 10 total, matching the Verification section's claim. Consistent.

### Adherence to Proposal

The implementation follows the proposal closely with a few justified adaptations:

1. **N5 adapted**: Changed from "no source available" to "non-existent override path" due to `recommendedSource` addition. Justified.
2. **N6 scope reduced**: Plugin directory ownership check dropped. Justified by `_REMOTE_USER` unpredictability.
3. **N7 deferred**: As proposed. Documented as manual verification.
4. **N8 approach improved**: Volume mount instead of stdin pipe. Better than proposed.
5. **Unit test metadata**: Uses the actual `${_REMOTE_USER}` literal from the real feature JSON rather than the `/home/node/` hardcoded path in the proposal's example code. More accurate.

All five deviations are improvements or justified adaptations.

### Devlog Quality

The devlog is well-structured with clear sections: Objective, Plan, Testing Approach, Implementation Notes, Changes Made, and Verification.
The Implementation Notes section documents three design decisions: `${_REMOTE_USER}` handling, `recommendedSource` rationale, and scenario test design choices.
The Changes Made section is organized by phase and lists specific files and changes.

One omission: the devlog does not mention the N5 adaptation from the proposal (testing non-existent path rather than missing settings).
This would help future readers understand why N5 differs from the proposal specification.
**Non-blocking.**

### Frontmatter

- `first_authored.by`: `@claude-opus-4-6` -- valid model identifier.
- `first_authored.at`: `2026-03-03T20:00:00-08:00` -- includes timezone.
- `task_list`: `lace/devcontainer-features` -- matches the workstream.
- `type`: `devlog` -- correct.
- `state`: `live` -- correct.
- `status`: `done` -- appropriate for completed work with verification.
- `tags`: `[neovim, testing, scenario-tests, devcontainer-features]` -- descriptive.
- Missing `last_reviewed` field -- this will be added as part of this review.

## Verdict

**Accept.** The implementation is complete, well-tested, and follows established patterns.
The 10 new tests cover the neovim feature's key integration points (mount auto-injection, port absence, coexistence, validation errors, Docker smoke).
The `recommendedSource` addition is correct and improves the user experience.
All deviations from the proposal are justified.
The non-blocking suggestions below are improvements for documentation clarity and test robustness, not prerequisites for acceptance.

## Action Items

1. [non-blocking] Add a sentence to the devlog's N5 description noting the adaptation from the proposal (testing non-existent override path instead of missing settings entirely, due to the `recommendedSource` addition in Phase 1).
2. [non-blocking] Consider adding the plugin directory existence check back to N6, using a generic path that avoids the `_REMOTE_USER` variable (e.g., checking `/usr/local/share/nvim/` runtime files instead of the per-user data directory).
3. [non-blocking] Standardize the target path in unit tests: the first neovim unit test uses `${_REMOTE_USER}` while the second uses `vscode`. Both are valid but the inconsistency may confuse future readers.
4. [non-blocking] Consider filing a follow-up issue to standardize `_REMOTE_USER` usage across features (neovim uses the variable, wezterm-server hardcodes `/home/node/`).
