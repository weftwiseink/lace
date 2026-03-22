---
review_of: cdocs/proposals/2026-03-21-ssh-key-injection-fix.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T23:15:00-07:00
task_list: session-management/ssh-key-injection
type: review
state: live
status: done
tags: [fresh_agent, ssh, lace-sshd, mount-resolver, test_coverage]
---

# Review: Fix Missing SSH Key Injection for lace-sshd

## Summary Assessment

This proposal identifies a clean, well-scoped regression: the migration from `wezterm-server` to `lace-sshd` dropped the `authorized_keys` mount declaration.
The proposed fix (adding a `mounts` block to the `lace-sshd` feature metadata) is correct and requires zero code changes to the mount-resolver pipeline.
The analysis is thorough and the proposal correctly identifies the architecture: feature-level mount declarations flow through `buildMountDeclarationsMap()`, `extractLaceCustomizations()`, and `MountPathResolver.resolveValidatedSource()` unchanged.
The one substantive concern is that the existing test suite uses `wezterm-server/authorized-keys` as the namespace in all validated mount tests, and the proposal's guidance on whether to add parallel `lace-sshd/authorized-keys` test coverage is vague.

Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF

Clear and accurate.
The BLUF correctly states the root cause, the fix scope, and that no code changes are needed.
The reference to the analysis report is appropriate.

### Problem Statement

**No issues.** The chain from host key pair through `lace-into` to missing `authorized_keys` bind mount is explained precisely with the correct file paths.

### Proposed Solution

**No issues.** The solution correctly identifies that `customizations.lace.mounts` in feature metadata is the right place for this declaration, and accurately describes the pipeline flow.

The four-step pipeline walkthrough (lines 44-48) is verified against the source code:
1. `buildMountDeclarationsMap()` at `template-resolver.ts:290-313` does iterate feature metadata, call `extractLaceCustomizations()`, and namespace as `<shortId>/<mountName>`.
2. `extractLaceCustomizations()` at `feature-metadata.ts:641-689` does parse and validate mounts via `parseMountDeclarationEntry()`.
3. `MountPathResolver.resolveValidatedSource()` at `mount-resolver.ts:310-355` does resolve from settings override or `recommendedSource` with `statSync()` validation.
4. `resolveFullSpec()` at `mount-resolver.ts:435-465` does emit the Docker mount string.

### ${_REMOTE_USER} Support

**Verified.** The mount-resolver's `resolveTargetVariables()` method (`mount-resolver.ts:117-132`) substitutes `${_REMOTE_USER}` with `containerVars.remoteUser` via regex replacement.
The `up.ts` pipeline constructs `containerVars` at line 370 using `extractRemoteUser()` from the devcontainer config and passes it to `MountPathResolver` at line 436.
The test suite confirms this works (`mount-resolver.test.ts` lines 884-926).

### Both devcontainer-feature.json Copies

**Verified.** Both `.devcontainer/features/lace-sshd/devcontainer-feature.json` and `.lace/prebuild/features/lace-sshd/devcontainer-feature.json` exist, are currently identical, and both lack a `mounts` block.
The NOTE callout explaining why both copies must be updated is accurate.

### Exact JSON Change

**No issues.** The JSON block is syntactically valid and consistent with the existing `customizations.lace.ports` structure already present in the file.

### Test Coverage (Phase 3)

**Non-blocking concern.** The proposal acknowledges that the mount-resolver test suite exercises `sourceMustBe: "file"` extensively, but the guidance on test updates is hedging ("review whether existing tests cover the lace-sshd namespace specifically, or whether they use generic feature IDs").

Having read the tests, the answer is clear: all validated mount tests in both `mount-resolver.test.ts` (lines 622-877) and `up-mount.integration.test.ts` (lines 766-1099) use `wezterm-server/authorized-keys` as the namespace.
The mount-resolver is namespace-agnostic (the namespace string is just a label prefix), so these tests do validate the same code path.
No new tests are strictly required for correctness, but the existing tests now reference a feature ID (`wezterm-server`) that is no longer used in this project's configuration.

Two options:
1. Leave the existing tests as-is. They still exercise the correct code paths. The `wezterm-server` namespace is just a string label in the tests.
2. Add one or two parallel tests using `lace-sshd/authorized-keys` for documentation value, or rename the existing test fixtures to `lace-sshd`. This would make the tests match the actual production configuration.

Neither is blocking.
The proposal should make this recommendation explicit rather than leaving it as a review-time question.

### Verification Plan

**Well-structured.** The four steps cover generated config inspection, live SSH connection testing, missing key error path, and settings override.
This is a practical verification plan that exercises the full pipeline end-to-end.

### Impact on Dotfiles Devcontainer

**Non-blocking.** Correctly scoped as out-of-band.
The `${_REMOTE_USER}` advantage is real: the dotfiles devcontainer's dual mounts (targeting both `/home/vscode` and `/home/node`) would collapse to a single feature-level declaration.

### Writing Conventions

- Sentence-per-line is mostly followed.
- No emojis.
- BLUF is present and well-formed.
- The NOTE callout at line 57 has proper attribution.
- One minor convention note: the proposal uses "mirroring the declaration the old `wezterm-server` feature provided" (line 31), which is slightly history-referential. This is acceptable for a fix proposal that exists to address a regression, so context about what was lost is necessary.

## Verdict

**Accept.**

The proposal is technically correct, well-scoped, and thorough.
The pipeline claims are verified against source code.
The fix requires only JSON metadata changes with no code modifications.
The supporting analysis report provides full root-cause context.

## Action Items

1. [non-blocking] Make the test coverage recommendation explicit. The existing `wezterm-server/authorized-keys` tests cover the code path; no new tests are required for correctness. Optionally add a `lace-sshd/authorized-keys` fixture for documentation alignment.
2. [non-blocking] Consider whether the existing `wezterm-server/authorized-keys` test fixtures should be renamed to `lace-sshd/authorized-keys` as a follow-up, since `wezterm-server` is no longer the active feature in this project.
3. [non-blocking] The analysis report (`cdocs/reports/2026-03-21-ssh-key-injection-analysis.md`) references the old `wezterm-server` feature metadata block from what appears to be a previous feature that no longer exists in-tree. Verify the quoted JSON in the "What the Old System Did" section is historically accurate or mark it as reconstructed.
