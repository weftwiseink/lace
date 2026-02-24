---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-24T21:05:00-06:00
task_list: lace/wezterm-server
type: devlog
state: live
status: wip
tags: [ssh, mount-templates, wezterm-server, validation, implementation]
related_to:
  - cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md
  - cdocs/reports/2026-02-24-mount-validation-design-rationale.md
---

# Implementing Validated Mount Declarations with SSH Key Support

## Objective

Implement the accepted proposal
`cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md`:
add `sourceMustBe: "file" | "directory"` to the mount declaration system,
wire it through the resolver and `lace up` pipeline, update wezterm-server
feature metadata, add mount target deduplication, update devcontainer.json
paths, and polish guidance output.

User instruction: no backwards compat or migrations needed -- overhaul
aggressively, remove legacy code, no commented-out code.

## Plan

6 phases from the proposal, executed sequentially with commits after each:

1. `sourceMustBe` in declaration model and parser (feature-metadata.ts + mount-resolver.ts)
2. Feature-level validation in lace up pipeline (up.ts)
3. wezterm-server feature metadata update (devcontainer-feature.json)
4. Mount target deduplication (template-resolver.ts)
5. Update devcontainer.json paths
6. Mount guidance and error message polish

## Testing Approach

Test-first where practical. Each phase has specific test cases in the proposal.
Run full test suite after each phase to catch regressions.

## Implementation Notes

### Phase 1: sourceMustBe in declaration model and resolver

Added `sourceMustBe?: "file" | "directory"` and `hint?: string` to `LaceMountDeclaration`.
Updated `parseMountDeclarationEntry()` to parse the new fields.
Added `resolveValidatedSource()` private method to `MountPathResolver` — uses settings override
or `recommendedSource` (expanded via tilde), validates via `statSync()`.
Added `validateSourceType()` with actionable error messages differentiating override vs. recommended
source paths. 13 new unit tests covering all edge cases including symlinks, type mismatches,
and broken symlinks. All 47 mount-resolver + 71 feature-metadata tests pass.

### Phase 2: Feature-level validation in pipeline

Added Step 7.5 in `up.ts` between `MountPathResolver` construction and template resolution.
Iterates `mountDeclarations` entries with `sourceMustBe` set, calls `resolveSource()` for each,
collects errors or downgrades to warnings when `skipValidation` is true. 4 new integration tests.
All 16 integration tests pass.

### Phase 3: wezterm-server feature metadata

Added `mounts.authorized-keys` declaration to wezterm-server `devcontainer-feature.json`:
`target: "/home/node/.ssh/authorized_keys"`, `recommendedSource: "~/.config/lace/ssh/id_ed25519.pub"`,
`sourceMustBe: "file"`, `readonly: true`, with ssh-keygen hint. Bumped version to 1.2.0.
Updated wezterm-server scenario tests (S1-S6) to provide a temp SSH key via `setupScenarioSettings()`
since the feature now validates mount sources. Added 1 new integration test for five-element error messages.

### Phase 4: Mount target deduplication

Added `deduplicateStaticMounts()` to `template-resolver.ts` — removes static mount strings
from the config's mounts array when their targets conflict with auto-injected declaration targets.
Parses `target=<value>` from comma-separated mount strings and `.target` from object-form mounts.
Skips `${lace.mount()}` templates. Wired into `up.ts` as Step 4.5. 8 new unit tests + 1 integration test.

### Phase 5: devcontainer.json path update

Updated 3 locations in `.devcontainer/devcontainer.json`:
- `fileExists` check: `~/.ssh/lace_devcontainer.pub` → `~/.config/lace/ssh/id_ed25519.pub`
- Static mount source: `${localEnv:HOME}/.ssh/lace_devcontainer.pub` → `${localEnv:HOME}/.config/lace/ssh/id_ed25519.pub`
- Comment: updated one-time setup command to use the new path with `mkdir -p` and `chmod 700`

### Phase 6: Guidance polish

Updated `emitMountGuidance()` to show validated mounts as `<label>: <path> (file)` or `(directory)`
instead of `using default path <path>`. Excluded validated mounts from the generic "To configure
custom mount sources" settings.json hint. 3 new unit tests.

## Changes Made

| File | Change |
|------|--------|
| `packages/lace/src/lib/feature-metadata.ts` | Added `sourceMustBe`, `hint` fields to `LaceMountDeclaration`, updated parser |
| `packages/lace/src/lib/mount-resolver.ts` | Added `resolveValidatedSource()`, `validateSourceType()`, `statSync` import |
| `packages/lace/src/lib/template-resolver.ts` | Added `deduplicateStaticMounts()`, updated `emitMountGuidance()` for validated mounts |
| `packages/lace/src/lib/up.ts` | Added Step 4.5 (deduplication), Step 7.5 (validated mount checking) |
| `devcontainers/features/src/wezterm-server/devcontainer-feature.json` | Added `mounts.authorized-keys` declaration, bumped to v1.2.0 |
| `.devcontainer/devcontainer.json` | Updated SSH key paths from `~/.ssh/lace_devcontainer` to `~/.config/lace/ssh/id_ed25519` |
| `packages/lace/src/lib/__tests__/mount-resolver.test.ts` | 13 new tests for validated mounts |
| `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` | 6 new integration tests |
| `packages/lace/src/lib/__tests__/template-resolver.test.ts` | 11 new tests (deduplication + guidance) |
| `packages/lace/src/__tests__/helpers/scenario-utils.ts` | Added `setupScenarioSettings()`, `createTempSshKey()` |
| `packages/lace/src/__tests__/wezterm-server-scenarios.test.ts` | Updated beforeEach/afterEach for SSH key setup |
| `packages/lace/src/commands/up.ts` | Exposed `--skip-devcontainer-up` CLI flag |

### E2E bug fix: override state change detection

During E2E testing, discovered that `resolveSource()` returned cached assignments
from `mount-assignments.json` even when settings overrides were added/removed/changed.
Fixed by detecting three cases of override state change before returning cached results:
1. Non-override persisted but settings override now exists
2. Override persisted but settings override was removed
3. Override persisted but settings override path changed

Also added `expandPath()` to override paths in both `resolveSource()` and
`resolveValidatedSource()` for tilde expansion consistency.

## Verification

**Full test suite (post Phase 6):**
```
Test Files  29 passed (29)
     Tests  781 passed (781)
  Duration  28.21s
```

**E2E testing against actual devcontainer:**

| Test | Result | Notes |
|------|--------|-------|
| Error case (missing SSH key) | PASS | Exit code 1, `failedPhase: "hostValidation"`, actionable error with hint |
| Success case (key present) | PASS | Exit code 0, 4 mounts correctly resolved, deduplication active |
| Settings override | PASS (after fix) | Override path used, shown as `(override)` |
| Override removal | PASS (after fix) | Reverts to recommended source |
| Skip validation | PASS | Downgrades to warning, Docker auto-create warning also shown |
| Generated config review | PASS | Valid JSON, all fields correct |
| Full test suite after E2E fixes | PASS | 29 files, 781 tests |

> NOTE: The published wezterm-server feature on ghcr.io is still v1.1.0 (without mount
> declarations). Until v1.2.0 is published, the `sourceMustBe` validation activates only
> via the `customizations.lace.validate.fileExists` fallback in devcontainer.json. Once
> published, the full mount declaration flow (deduplication, `(file)` guidance, metadata-
> driven validation) activates automatically.
