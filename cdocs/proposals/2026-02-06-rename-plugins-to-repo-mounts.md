---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T10:00:00-08:00
task_list: lace/rename-plugins-to-repo-mounts
type: proposal
state: live
status: review_ready
tags: [refactor, naming, repo-mounts, plugins, devcontainer, lace-cli]
revisions:
  - at: 2026-02-06T10:30:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Fixed BLUF: replaced inaccurate 'overrideMounts' with correct field names"
      - "Changed settings.json top-level key from 'overrides' to 'repoMounts' for consistency"
      - "Changed nested field from 'mount' to 'localMount' for descriptiveness"
      - "Added Out of Scope section for files with unrelated 'plugin' references"
      - "Added missing local variables to resolve-mounts.ts change list"
  - at: 2026-02-06T11:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Reverted nested field name from 'localMount' back to 'overrideMount' per user feedback"
      - "Updated design decision to justify keeping 'overrideMount' as the nested field name"
      - "Updated BLUF, schema examples, file-by-file change lists, and test data references accordingly"
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-06T11:15:00-08:00
  round: 2
---

# Rename Plugins to Repo Mounts

> BLUF: Rename `customizations.lace.plugins` to `customizations.lace.repoMounts` across the entire lace codebase, change the container mount path from `/mnt/lace/plugins/<name>` to `/mnt/lace/repos/<name>`, and restructure settings.json so the top-level `plugins` key becomes `repoMounts` (the nested `overrideMount` field is kept as-is). This is motivated by the [plugin architecture analysis report](../reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md), which concluded that "plugins" is misleading terminology since these are mounted repos (data), not behavioral plugins (code), and that devcontainer features are the actual extensibility mechanism.

## Objective

Align the codebase terminology with what the system actually does. The current "plugin" vocabulary implies behavioral extensibility -- code that runs and changes things. In reality, `customizations.lace.plugins` declares git repos to clone and bind-mount into containers. Renaming to `repoMounts` eliminates the conceptual mismatch and frees the "plugin" term for future use with devcontainer features as the behavioral extensibility mechanism.

## Background

### The Analysis Report

The [plugin architecture analysis report](../reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md) examined whether lace should build its own plugin system or lean into devcontainer features as the extensibility unit. Its key finding on terminology:

> The word "plugin" implies behavioral extensibility -- code that runs and changes things. Git-repo mounts are data, not behavior. Devcontainer features are the actual behavioral extensibility mechanism.

The report recommended renaming `customizations.lace.plugins` to `customizations.lace.repos` (or `mounts`). This proposal implements that recommendation using `repoMounts` as the key name, which is more descriptive than either `repos` or `mounts` alone.

### The Original Plugins Proposal

The [lace plugins system proposal](../proposals/2026-02-04-lace-plugins-system.md) established the current architecture. The underlying mechanics -- clone repos, resolve overrides, generate mount specs -- remain unchanged. Only the naming changes.

### Current State

The system is fully implemented and working. The rename is a pure refactoring exercise with no behavioral changes.

## Proposed Solution

### Schema Changes

**devcontainer.json** -- the key under `customizations.lace` changes:

```jsonc
// Before
{
  "customizations": {
    "lace": {
      "plugins": {
        "github.com/user/dotfiles": {},
        "github.com/user/utils": { "alias": "tools" }
      }
    }
  }
}

// After
{
  "customizations": {
    "lace": {
      "repoMounts": {
        "github.com/user/dotfiles": {},
        "github.com/user/utils": { "alias": "tools" }
      }
    }
  }
}
```

**settings.json** -- the top-level key changes:

```jsonc
// Before
{
  "plugins": {
    "github.com/user/dotfiles": {
      "overrideMount": { "source": "~/code/dotfiles" }
    }
  }
}

// After
{
  "repoMounts": {
    "github.com/user/dotfiles": {
      "overrideMount": { "source": "~/code/dotfiles" }
    }
  }
}
```

> NOTE: The top-level key in settings.json uses `repoMounts` to match the devcontainer.json key, providing consistency across both config surfaces. The nested `overrideMount` field is kept as-is because it accurately describes the field's purpose: overriding the default clone-based mount with a local path. Within the `repoMounts` context, `overrideMount` clearly communicates "use this mount instead of the default clone."

**Container mount paths** change from `/mnt/lace/plugins/<name>` to `/mnt/lace/repos/<name>`.

**Host clone paths** change from `~/.config/lace/<project>/plugins/<name>` to `~/.config/lace/<project>/repos/<name>`.

### Comprehensive File-by-File Change List

#### Source Files

**`packages/lace/src/lib/devcontainer.ts`**

| Change | Details |
|--------|---------|
| Interface `PluginOptions` | Rename to `RepoMountOptions` |
| Interface `PluginsConfig` | Rename to `RepoMountsConfig` |
| Type `PluginsResult` | Rename to `RepoMountsResult` |
| Discriminant `kind: "plugins"` | Change to `kind: "repoMounts"` |
| Function `extractPlugins` | Rename to `extractRepoMounts` |
| Key lookup `lace.plugins` | Change to `lace.repoMounts` |
| Function `derivePluginName` | Rename to `deriveRepoName` |
| Function `getPluginNameOrAlias` | Rename to `getRepoNameOrAlias` |

**`packages/lace/src/lib/settings.ts`**

| Change | Details |
|--------|---------|
| Interface `LaceSettings.plugins` | Rename field to `repoMounts` |
| Interface `PluginSettings` | Rename to `RepoMountSettings` |
| Field `overrideMount` | Keep as-is (no rename) |
| All JSDoc referencing "plugin" | Update to "repo mount" |

**`packages/lace/src/lib/mounts.ts`**

| Change | Details |
|--------|---------|
| Constant `PLUGIN_MOUNT_PREFIX` | Rename to `REPO_MOUNT_PREFIX`, value changes from `/mnt/lace/plugins` to `/mnt/lace/repos` |
| Interface `ResolvedPlugin` | Rename to `ResolvedRepoMount` |
| Interface `ResolvedMounts.plugins` | Rename field to `repoMounts` |
| Function `validateNoConflicts` | Update error messages from "Plugin name conflict" to "Repo mount name conflict" |
| Function `resolvePluginMounts` | Rename to `resolveRepoMounts` |
| Interface `ResolvePluginMountsOptions.plugins` | Rename field to `repoMounts` |
| Interface `ResolvePluginOptions` | Rename to `ResolveRepoMountOptions` |
| Function `resolvePlugin` | Rename to `resolveRepoMount` |
| Interface `ResolveOverridePluginOptions` | Rename to `ResolveOverrideRepoMountOptions` |
| Function `resolveOverridePlugin` | Rename to `resolveOverrideRepoMount` |
| Interface `ResolveClonePluginOptions` | Rename to `ResolveCloneRepoMountOptions` |
| Function `resolveClonePlugin` | Rename to `resolveCloneRepoMount` |
| Function `generateMountSpec(plugin)` | Rename parameter to `repoMount` |
| Function `generateSymlinkCommands(plugins)` | Rename parameter to `repoMounts` |
| Function `generateMountSpecs(plugins)` | Rename parameter to `repoMounts` |
| Settings access `settings.plugins?.[repoId]` | Change to `settings.repoMounts?.[repoId]` |
| Settings access `pluginSettings?.overrideMount` | Change to `repoSettings?.overrideMount` (field name unchanged, only the variable prefix changes) |
| All error messages referencing "Plugin" | Change to "Repo mount" or "repo" as appropriate |
| All JSDoc referencing "plugin" | Update to "repo mount" |

**`packages/lace/src/lib/plugin-clones.ts`** -- rename file to `repo-clones.ts`

| Change | Details |
|--------|---------|
| Filename | `plugin-clones.ts` -> `repo-clones.ts` |
| Class `PluginCloneError` | Rename to `RepoCloneError` |
| Function `getClonePath` | Path changes from `plugins` to `repos` in the directory structure |
| Function `getPluginsDir` | Rename to `getReposDir`, path changes from `plugins` to `repos` |
| Interface `ClonePluginOptions` | Rename to `CloneRepoOptions` |
| Interface `ClonePluginResult` | Rename to `CloneRepoResult` |
| Function `clonePlugin` | Rename to `cloneRepo` |
| Interface `UpdatePluginOptions` | Rename to `UpdateRepoOptions` |
| Interface `UpdatePluginResult` | Rename to `UpdateRepoResult` |
| Function `updatePlugin` | Rename to `updateRepo` |
| Function `ensurePlugin` | Rename to `ensureRepo` |
| Function `getPluginSourcePath` | Rename to `getRepoSourcePath` |
| All error messages referencing "plugin" | Change to "repo" |
| All JSDoc referencing "plugin" | Update to "repo" |

**`packages/lace/src/lib/resolve-mounts.ts`**

| Change | Details |
|--------|---------|
| All imports | Update to new names from `devcontainer.ts`, `settings.ts`, `mounts.ts`, `repo-clones.ts` |
| `extractPlugins` call | Change to `extractRepoMounts` |
| `pluginsResult` variable | Rename to `repoMountsResult` |
| Switch cases `"plugins"` | Change to `"repoMounts"` |
| All user-facing messages | Change "plugins" to "repo mounts" (e.g., "No plugins configured" -> "No repo mounts configured") |
| `plugins` local variable (line 102) | Rename to `repoMounts` |
| `pluginCount` local variable (line 103) | Rename to `repoMountCount` |
| `resolvePluginMounts` call | Change to `resolveRepoMounts` |

**`packages/lace/src/lib/up.ts`**

| Change | Details |
|--------|---------|
| `extractPlugins` import/call | Change to `extractRepoMounts` |
| `hasPlugins` variable | Rename to `hasRepoMounts` |
| Console log "Resolving plugin mounts..." | Change to "Resolving repo mounts..." |
| Error message "Resolve mounts failed" | Keep as-is (still accurate) |

**`packages/lace/src/commands/resolve-mounts.ts`**

| Change | Details |
|--------|---------|
| Command description | Change "Resolve plugin mounts" to "Resolve repo mounts" |

**`packages/lace/src/commands/up.ts`**

| Change | Details |
|--------|---------|
| Command description | Change "plugin mounts" to "repo mounts" |

#### Test Files

**`packages/lace/src/lib/__tests__/devcontainer.test.ts`**

| Change | Details |
|--------|---------|
| `extractPlugins` references | Change to `extractRepoMounts` |
| `derivePluginName` references | Change to `deriveRepoName` |
| `getPluginNameOrAlias` references | Change to `getRepoNameOrAlias` |
| `kind: "plugins"` assertions | Change to `kind: "repoMounts"` |
| Test description strings referencing "plugins" | Update to "repo mounts" |

**`packages/lace/src/lib/__tests__/settings.test.ts`**

| Change | Details |
|--------|---------|
| All `plugins` keys in test JSON | Change to `repoMounts` |
| All `overrideMount` keys in test JSON | Keep as-is (no rename) |
| Property access paths like `result.plugins?.["..."]` | Change to `result.repoMounts?.["..."]` |
| Property access `overrideMount?.source` | Keep as-is (no rename) |

**`packages/lace/src/lib/__tests__/mounts.test.ts`**

| Change | Details |
|--------|---------|
| Import `ResolvedPlugin` | Change to `ResolvedRepoMount` |
| Import `resolvePluginMounts` | Change to `resolveRepoMounts` |
| Import `PluginsConfig` | Change to `RepoMountsConfig` |
| All `/mnt/lace/plugins/` paths in assertions | Change to `/mnt/lace/repos/` |
| `result.plugins` access | Change to `result.repoMounts` |
| `settings.plugins` in test data | Change to `settings.repoMounts` |
| `overrideMount` in test data | Keep as-is (no rename) |
| Error message assertions "Plugin name conflict" | Change to "Repo mount name conflict" |
| All test descriptions referencing "plugin" | Update |

**`packages/lace/src/lib/__tests__/plugin-clones.test.ts`** -- rename to `repo-clones.test.ts`

| Change | Details |
|--------|---------|
| Filename | `plugin-clones.test.ts` -> `repo-clones.test.ts` |
| All imports | Update to new names from `repo-clones.ts` |
| `getClonePath` assertion paths | Change `plugins` to `repos` |
| `getPluginsDir` references | Change to `getReposDir` |
| `clonePlugin` references | Change to `cloneRepo` |
| `updatePlugin` references | Change to `updateRepo` |
| `ensurePlugin` references | Change to `ensureRepo` |
| `getPluginSourcePath` references | Change to `getRepoSourcePath` |
| `PluginCloneError` references | Change to `RepoCloneError` |
| Error message assertions containing "plugin" | Update to "repo" |
| Test description strings | Update |

**`packages/lace/src/commands/__tests__/resolve-mounts.integration.test.ts`**

| Change | Details |
|--------|---------|
| All `"plugins"` keys in test JSON constants | Change to `"repoMounts"` |
| All `"plugins"` keys in settings objects | Change to `"repoMounts"` |
| All `"overrideMount"` keys | Keep as-is (no rename) |
| `result.resolved?.plugins` access | Change to `result.resolved?.repoMounts` |
| Message assertions "plugin(s)" | Change to "repo mount(s)" |
| Message assertions "No plugins configured" | Change to "No repo mounts configured" |
| Message assertions "Plugin name conflict" | Change to "Repo mount name conflict" |
| Message assertions "Failed to clone plugin" | Change to "Failed to clone repo" |
| `/mnt/lace/plugins/` path assertions | Change to `/mnt/lace/repos/` |

**`packages/lace/src/commands/__tests__/up.integration.test.ts`**

| Change | Details |
|--------|---------|
| All `"plugins"` keys in test JSON constants | Change to `"repoMounts"` |
| All `"plugins"` keys in settings objects | Change to `"repoMounts"` |
| All `"overrideMount"` keys | Keep as-is (no rename) |
| Message assertions containing "plugin" | Update |
| Test description strings referencing "plugin" | Update |

#### Fixture Files

**`packages/lace/src/__fixtures__/devcontainers/plugins-standard.jsonc`** -- rename to `repo-mounts-standard.jsonc`

| Change | Details |
|--------|---------|
| Filename | `plugins-standard.jsonc` -> `repo-mounts-standard.jsonc` |
| `"plugins"` key | Change to `"repoMounts"` |

**`packages/lace/src/__fixtures__/devcontainers/plugins-with-alias.jsonc`** -- rename to `repo-mounts-with-alias.jsonc`

| Change | Details |
|--------|---------|
| Filename | `plugins-with-alias.jsonc` -> `repo-mounts-with-alias.jsonc` |
| `"plugins"` key | Change to `"repoMounts"` |

**`packages/lace/src/__fixtures__/devcontainers/plugins-empty.jsonc`** -- rename to `repo-mounts-empty.jsonc`

| Change | Details |
|--------|---------|
| Filename | `plugins-empty.jsonc` -> `repo-mounts-empty.jsonc` |
| `"plugins"` key | Change to `"repoMounts"` |

**`packages/lace/src/__fixtures__/devcontainers/plugins-null.jsonc`** -- rename to `repo-mounts-null.jsonc`

| Change | Details |
|--------|---------|
| Filename | `plugins-null.jsonc` -> `repo-mounts-null.jsonc` |
| `"plugins"` key | Change to `"repoMounts"` |

#### Documentation

**`packages/lace/README.md`**

| Change | Details |
|--------|---------|
| Section heading "Plugin System (Repo Mounts)" | Change to "Repo Mounts" |
| All `customizations.lace.plugins` references | Change to `customizations.lace.repoMounts` |
| Mount path `/mnt/lace/plugins/<name>` | Change to `/mnt/lace/repos/<name>` |
| Clone path `~/.config/lace/<project>/plugins/<name>` | Change to `~/.config/lace/<project>/repos/<name>` |
| `"plugins"` key in settings.json example | Change to `"repoMounts"` |
| `"overrideMount"` in settings.json example | Keep as-is (no rename) |
| All prose references to "plugins" in the repo mount section | Change to "repo mounts" |

#### Out of Scope

The following files contain the word "plugin" but refer to unrelated concepts (the lace.wezterm plugin, neovim plugins, or wezterm plugins) and are **not** part of this rename:

- `overview_and_quickstart.md` -- references resurrect.wezterm plugin and neovim `lua/plugins/` directory
- `bin/open-lace-workspace` -- references the lace.wezterm plugin migration
- `bin/wez-lace-into` -- references the lace.wezterm plugin's SSH domain registration

These files use "plugin" in its conventional sense (behavioral extension to another tool), not in the lace-specific "mounted repo" sense being renamed here.

## Important Design Decisions

### Decision: Use `repoMounts` instead of `repos` or `mounts`

**Why:** The analysis report suggested `repos` or `mounts`. Neither is fully descriptive on its own. `repos` does not convey that mounting is the purpose. `mounts` is too generic -- lace may have other kinds of mounts in the future. `repoMounts` is self-documenting: it is a mount whose source is a git repo.

### Decision: Use `repoMounts` as the top-level key in both devcontainer.json and settings.json

**Why:** Consistency across both config surfaces. A user looking at `customizations.lace.repoMounts` in devcontainer.json and `repoMounts` in settings.json immediately understands they are configuring the same system. An earlier draft considered `overrides` for the settings.json key, but this is too generic -- as lace gains more settings (e.g., feature template options, port range config), `overrides` would become ambiguous.

### Decision: Keep `overrideMount` as the nested field name in per-repo settings

**Why:** `overrideMount` accurately describes the field's purpose: it overrides the default clone-based mount with a local path. Within the `repoMounts` context, `overrideMount` clearly communicates "use this mount instead of the default clone." An earlier revision considered renaming to `localMount` to describe what the field *is* rather than what it *does*, but `overrideMount` is more informative -- it tells the user both that this is a mount source *and* that it takes precedence over the default cloning behavior. The slight redundancy of `repoMounts.*.overrideMount` is acceptable because the outer key describes the system (repo mounts) while the inner key describes the action (overriding the mount source).

### Decision: Rename container path from `/mnt/lace/plugins/` to `/mnt/lace/repos/`

**Why:** The container path should match the terminology. `/mnt/lace/repos/` communicates that these are repository checkouts, not plugin installations.

### Decision: Rename host clone path from `plugins/` to `repos/`

**Why:** Consistency with the container path and the new terminology. The host directory `~/.config/lace/<project>/repos/<name>` mirrors the container directory `/mnt/lace/repos/<name>`.

### Decision: Rename the file `plugin-clones.ts` to `repo-clones.ts`

**Why:** The file name should reflect the module's purpose. It manages cloning and updating of repos, not plugins.

### Decision: No backward compatibility shim

**Why:** The plugin system has no external consumers yet. There are no published packages depending on these interfaces. The rename can be done cleanly in a single pass without maintaining deprecated aliases.

## Edge Cases / Challenging Scenarios

### Existing clone directories on disk

Users who have already run `lace up` will have repos cloned under `~/.config/lace/<project>/plugins/<name>`. After the rename, lace will look for them under `~/.config/lace/<project>/repos/<name>` and re-clone. The old `plugins/` directories become orphaned.

**Mitigation:** Document in the changelog that users should delete `~/.config/lace/<project>/plugins/` directories after upgrading. No automated migration is needed -- re-cloning is cheap (shallow clones).

### External documentation and cdocs references

Many cdocs documents reference "plugins" in the context of repo mounts. These are historical documents and should not be rewritten -- cdocs follows history-agnostic framing in live documents but archived/completed documents retain their original language.

**Mitigation:** No changes to cdocs documents with `status: implementation_complete`, `status: evolved`, or `state: archive`. Only the README and live source code are updated.

### The `resolved-mounts.json` output file

The `.lace/resolved-mounts.json` file currently has a `plugins` array. This changes to `repoMounts`. Since this file is machine-generated and consumed only by lace itself (written during resolve-mounts, read by no one except for debugging), there is no compatibility concern.

## Test Plan

All existing tests are renamed and updated to use the new terminology. No new test logic is needed -- the behavior is unchanged. The test plan is:

1. Run the full test suite after all renames and verify zero failures.
2. Verify that fixture files load correctly with the new key names.
3. Verify that error messages use the new terminology (e.g., "Repo mount name conflict" instead of "Plugin name conflict").
4. Verify that mount paths in assertions use `/mnt/lace/repos/` instead of `/mnt/lace/plugins/`.

## Implementation Phases

### Phase 1: Rename types and interfaces

Update all TypeScript interfaces, types, and type discriminants across `devcontainer.ts`, `settings.ts`, and `mounts.ts`. This is the foundation -- all other changes depend on these types compiling.

**Files:** `devcontainer.ts`, `settings.ts`, `mounts.ts`
**Verification:** `tsc --noEmit` passes.

### Phase 2: Rename functions and constants

Rename all exported and internal functions, constants, and error classes. Update import statements across all consuming modules.

**Files:** `devcontainer.ts`, `settings.ts`, `mounts.ts`, `plugin-clones.ts` (renamed to `repo-clones.ts`), `resolve-mounts.ts`, `up.ts`, `commands/resolve-mounts.ts`, `commands/up.ts`
**Verification:** `tsc --noEmit` passes.

### Phase 3: Update string literals and paths

Change all string constants: mount path prefix, clone directory paths, error messages, user-facing log messages, command descriptions.

**Files:** All source files listed above.
**Verification:** `grep -r "plugin" packages/lace/src/` returns zero hits (excluding cdocs references and any third-party imports).

### Phase 4: Rename fixture files and update tests

Rename the four fixture files. Update all test files to use the new fixture names, new import names, new assertion strings, and new test data structures.

**Files:** All fixture `.jsonc` files (4 files), all test files (5 files).
**Verification:** `pnpm test` passes with zero failures.

### Phase 5: Update documentation

Update `packages/lace/README.md` with the new terminology, schema examples, and paths.

**Files:** `packages/lace/README.md`
**Verification:** Manual review of README accuracy.

> NOTE: All five phases can be executed as a single atomic commit since there are no intermediate stable states -- partial renames would leave the codebase in a broken state.
