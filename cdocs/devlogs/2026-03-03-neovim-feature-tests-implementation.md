---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T20:00:00-08:00
task_list: lace/devcontainer-features
type: devlog
state: live
status: wip
tags: [neovim, testing, scenario-tests, devcontainer-features]
---

# Neovim Feature Tests Implementation

## Objective

Implement comprehensive test coverage for the neovim devcontainer feature across three
layers: unit tests for metadata extraction, scenario tests for config generation (N1-N5),
and Docker smoke tests (N6, N8). Also fix the missing `recommendedSource` in the feature
metadata and update documentation.

## Plan

1. **Phase 1**: Fix `recommendedSource` gap in `devcontainer-feature.json` and address
   the `${_REMOTE_USER}` target path issue (hardcode to match wezterm-server pattern)
2. **Phase 2**: Add unit tests for neovim feature metadata extraction
3. **Phase 3**: Create scenario tests N1-N5 in `neovim-scenarios.test.ts`
4. **Phase 4**: Add Docker smoke tests N6, N8 (gated by Docker availability)
5. **Phase 5**: Update root README and feature README documentation
6. **Phase 6**: Full verification and self-review

## Testing Approach

- Follow patterns from `wezterm-server-scenarios.test.ts` exactly
- Use `createScenarioWorkspace`, `symlinkLocalFeature`, `writeDevcontainerJson`,
  `readGeneratedConfig` helpers from `scenario-utils.ts`
- Gate Docker tests with `describe.skipIf(!isDockerAvailable())`
- Run `pnpm --filter lace test` after every change
- Iterate until green before proceeding

## Implementation Notes

### `${_REMOTE_USER}` in target path

The neovim feature's target path contains `${_REMOTE_USER}`, which is a devcontainer
spec variable resolved at install time. However, lace reads this as a literal string
and passes it through to Docker mount specs. Docker will NOT resolve this variable.

The wezterm-server feature hardcodes `/home/node/...` instead of using `${_REMOTE_USER}`.
For consistency and correctness, the neovim feature should also hardcode a concrete user.
Using `vscode` matches the default `mcr.microsoft.com/devcontainers/base` image user.

However, changing the target path is a behavioral change to the feature metadata.
Decision: Keep `${_REMOTE_USER}` in `install.sh` (which runs in the container where
the variable IS resolved), but hardcode the target path in the mount declaration to
`/home/vscode/.local/share/nvim` for lace's config generation.

**Update**: After review, I decided to keep the `${_REMOTE_USER}` variable in the
target for now. The `install.sh` resolves it at install time. The mount declaration
target is used by lace for config generation and the devcontainer spec resolves
`${_REMOTE_USER}` at runtime. Tests will use the literal string as it appears in
the JSON. This matches how the feature was designed.

### `recommendedSource` addition

Adding `"recommendedSource": "~/.local/share/nvim"` to the plugins mount. This allows
lace to resolve the mount without a settings override when the user has neovim data
on the host. The `MountPathResolver.resolveValidatedSource()` will expand the tilde
and check the directory exists.

## Changes Made

- (will be populated as implementation proceeds)

## Verification

- (will contain full test output after implementation)
