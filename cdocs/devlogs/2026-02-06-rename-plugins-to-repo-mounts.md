---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T11:37:00-08:00
task_list: lace/rename-plugins-to-repo-mounts
type: devlog
state: live
status: done
tags: [implementation, refactor, naming, repo-mounts]
---

# Rename Plugins to Repo Mounts -- Implementation Devlog

## Objective

Implement the rename specified in `cdocs/proposals/2026-02-06-rename-plugins-to-repo-mounts.md`. Rename `customizations.lace.plugins` to `customizations.lace.repoMounts` across the entire lace codebase, following the proposal's 5 phases.

## Pre-flight

- Verified TypeScript compiles: `pnpm tsc --noEmit` passes
- Verified all 315 tests pass: `pnpm test` passes
- Read all source files, test files, fixture files, and README

## Phase 1: Rename types and interfaces

**Files:** `devcontainer.ts`, `settings.ts`, `mounts.ts`

- `PluginOptions` -> `RepoMountOptions`
- `PluginsConfig` -> `RepoMountsConfig`
- `PluginsResult` -> `RepoMountsResult` (discriminant `kind: "plugins"` -> `kind: "repoMounts"`)
- `PluginSettings` -> `RepoMountSettings`
- `ResolvedPlugin` -> `ResolvedRepoMount`
- `ResolvedMounts.plugins` -> `ResolvedMounts.repoMounts`
- `LaceSettings.plugins` -> `LaceSettings.repoMounts`
- `ResolvePluginMountsOptions` -> `ResolveRepoMountsOptions` (`.plugins` field -> `.repoMounts`)
- `ResolvePluginOptions` -> `ResolveRepoMountOptions`
- `ResolveOverridePluginOptions` -> `ResolveOverrideRepoMountOptions`
- `ResolveClonePluginOptions` -> `ResolveCloneRepoMountOptions`

Verification: `pnpm tsc --noEmit` -- PASS

## Phase 2: Rename functions, constants, and file

- `extractPlugins` -> `extractRepoMounts`
- `derivePluginName` -> `deriveRepoName`
- `getPluginNameOrAlias` -> `getRepoNameOrAlias`
- `PLUGIN_MOUNT_PREFIX` -> `REPO_MOUNT_PREFIX` (value: `/mnt/lace/repos`)
- `resolvePluginMounts` -> `resolveRepoMounts`
- `resolvePlugin` -> `resolveRepoMount`
- `resolveOverridePlugin` -> `resolveOverrideRepoMount`
- `resolveClonePlugin` -> `resolveCloneRepoMount`
- `PluginCloneError` -> `RepoCloneError`
- `getPluginsDir` -> `getReposDir`
- `clonePlugin` -> `cloneRepo`
- `updatePlugin` -> `updateRepo`
- `ensurePlugin` -> `ensureRepo`
- `getPluginSourcePath` -> `getRepoSourcePath`
- File rename: `plugin-clones.ts` -> `repo-clones.ts`
- Updated all imports across all consuming modules (`mounts.ts`, `resolve-mounts.ts`, `up.ts`)

Verification: `pnpm tsc --noEmit` -- PASS

## Phase 3: Update string literals and paths

- Mount path prefix: `/mnt/lace/plugins` -> `/mnt/lace/repos`
- Clone directory: `plugins` -> `repos` in path construction
- Error messages: "Plugin name conflict" -> "Repo mount name conflict", "Failed to clone plugin" -> "Failed to clone repo", etc.
- User-facing log messages: "Resolving plugin mounts..." -> "Resolving repo mounts...", "No plugins configured" -> "No repo mounts configured"
- Command descriptions: "Resolve plugin mounts" -> "Resolve repo mounts", "plugin mounts" -> "repo mounts"
- Dry run messages: "plugin(s)" -> "repo mount(s)"

Verification: grep for remaining "plugin" in `packages/lace/src/` -- PASS (only test data with repo paths like `github.com/user/claude-plugins/plugins/my-plugin` remain, which are valid external path segments, not lace terminology)

## Phase 4: Rename fixture files and update tests

- Fixture files renamed:
  - `plugins-standard.jsonc` -> `repo-mounts-standard.jsonc`
  - `plugins-with-alias.jsonc` -> `repo-mounts-with-alias.jsonc`
  - `plugins-empty.jsonc` -> `repo-mounts-empty.jsonc`
  - `plugins-null.jsonc` -> `repo-mounts-null.jsonc`
- Test file renamed: `plugin-clones.test.ts` -> `repo-clones.test.ts`
- All 5 test files updated with new names, imports, assertions, and test data
- `overrideMount` field name kept as-is throughout (per proposal)

Verification: `pnpm test` -- PASS (315/315 tests pass)

## Phase 5: Update README

- Section heading: "Plugin System (Repo Mounts)" -> "Repo Mounts"
- Schema examples: `customizations.lace.plugins` -> `customizations.lace.repoMounts`
- Mount path: `/mnt/lace/plugins/<name>` -> `/mnt/lace/repos/<name>`
- Clone path: `~/.config/lace/<project>/plugins/<name>` -> `~/.config/lace/<project>/repos/<name>`
- Settings example: `"plugins"` -> `"repoMounts"`
- Prose: "plugins" -> "repo mounts"

Verification: Manual review -- PASS

## Summary

All 5 phases completed successfully. The rename is comprehensive and consistent:
- 8 source files modified (6 lib, 2 commands)
- 5 test files modified (3 lib tests, 2 integration tests)
- 4 fixture files renamed and updated
- 1 file renamed (`plugin-clones.ts` -> `repo-clones.ts`)
- 1 test file renamed (`plugin-clones.test.ts` -> `repo-clones.test.ts`)
- 1 documentation file updated (README.md)
- TypeScript compilation and all 315 tests pass

## Progress Log

- 11:37 -- Pre-flight complete, beginning implementation
- 11:38 -- Phase 1 complete (types/interfaces renamed)
- 11:40 -- Phase 2 complete (functions/constants/file renamed)
- 11:41 -- Phase 3 complete (string literals/paths updated)
- 11:44 -- Phase 4 complete (fixtures renamed, tests updated, 315/315 pass)
- 11:45 -- Phase 5 complete (README updated)
- 11:46 -- Implementation complete, all verifications pass
