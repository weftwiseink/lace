---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T10:05:00-08:00
type: report
state: live
status: review_ready
tags: [lace, plugins, mounts, architecture, status]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-05T14:30:00-08:00
  round: 1
revisions:
  - at: 2026-02-05T15:00:00-08:00
    by: "@claude-opus-4-6"
    round: 1
    summary: >
      Applied review feedback: fixed test count inaccuracies across all modules
      (settings 12->18, plugin-clones 14->21, mounts 14->18, up.integration 10->11,
      parseRepoId 5->6), corrected PrebuildFeaturesResult line reference from
      devcontainer.ts:32-37 to devcontainer.ts:7-11, fixed systematic off-by-one
      in Appendix line counts, noted generateExtendedConfig is module-private,
      added downstream dependencies subsection with host setup RFP dependency
      and extractor pattern note, described errors field as structurally dead code.
---

# Lace Plugin System: Design and Implementation State

> BLUF: The lace plugin system is fully implemented across 7 phases as specified in the approved proposal. All core modules (settings, devcontainer extraction, plugin clones, mount resolution, resolve-mounts command, and lace up integration) are complete with 254+ passing tests. The system resolves plugins declared in `customizations.lace.plugins` against user overrides in `~/.config/lace/settings.json`, produces devcontainer mount strings, and generates an extended `.lace/devcontainer.json`. Two RFPs (conditional loading and host setup) remain in `request_for_proposal` status, neither has been promoted to a full proposal. The key extension points for future work (claude access, mount-enabled plugins) are the `ResolvedPlugin` interface, the `generateExtendedConfig` function, and the plugin manifest concept from the host setup RFP.

---

## 1. Architecture Overview

The plugin system is organized as a layered pipeline with clear data flow from project configuration through user settings to devcontainer arguments:

```
devcontainer.json                settings.json
(customizations.lace.plugins)    (~/.config/lace/settings.json)
         |                              |
         v                              v
    extractPlugins()              loadSettings()
         |                              |
         +----------+------------------+
                    |
                    v
          resolvePluginMounts()
           /          |          \
    validateNoConflicts   clonePlugin/updatePlugin
                    |
                    v
             ResolvedMounts
            /       |        \
  generateMountSpecs  generateSymlinkCommands
                    |
                    v
          generateExtendedConfig()
                    |
                    v
           .lace/devcontainer.json
                    |
                    v
            devcontainer up
```

### Layer Responsibilities

| Layer | Module | Responsibility |
|-------|--------|---------------|
| Project declaration | `devcontainer.ts` | Extract `customizations.lace.plugins` from devcontainer.json |
| User configuration | `settings.ts` | Discover and parse `~/.config/lace/settings.json` |
| Clone management | `plugin-clones.ts` | Shallow clone, update, and locate plugin repos |
| Mount resolution | `mounts.ts` | Resolve overrides vs clones, validate conflicts, generate specs |
| Orchestration (lib) | `resolve-mounts.ts` | Wire together the above layers, write `resolved-mounts.json` |
| Orchestration (cli) | `commands/resolve-mounts.ts` | CLI command entry point for `lace resolve-mounts` |
| Full workflow | `up.ts` | Orchestrate prebuild + resolve-mounts + config generation + devcontainer up |
| CLI entry | `index.ts` | Register all commands with citty |

### Key Design Patterns

1. **Discriminated unions for extraction results**: `PluginsResult` uses `kind: "plugins" | "absent" | "null" | "empty"` to distinguish valid plugin configs from various absence states. This mirrors the existing `PrebuildFeaturesResult` pattern (`packages/lace/src/lib/devcontainer.ts:7-11`).

2. **Injectable subprocess for testability**: All functions that invoke git (clone, fetch, reset) accept an optional `subprocess` parameter of type `RunSubprocess`. Tests inject mock functions; production uses `execFileSync` via `subprocess.ts`.

3. **Error class hierarchy**: Each module defines its own error class (`SettingsConfigError`, `PluginCloneError`, `MountsError`, `DevcontainerConfigError`) extending `Error`. Callers use `instanceof` checks to distinguish recoverable errors from unexpected failures.

4. **Two-tier devcontainer parsing**: `readDevcontainerConfigMinimal()` parses just JSONC without requiring a Dockerfile (used by resolve-mounts); `readDevcontainerConfig()` additionally resolves build sources (used by prebuild). This avoids unnecessary failures when only plugin data is needed.

---

## 2. Implementation Status

### Module-by-Module Assessment

#### `src/lib/settings.ts` -- Fully Implemented

**Functions**: `expandPath`, `resolveSettingsPath`, `findSettingsConfig`, `readSettingsConfig`, `loadSettings`

**Completeness**: All proposal Phase 1 deliverables implemented. Discovery order (LACE_SETTINGS env > `~/.config/lace/settings.json` > `~/.lace/settings.json`) matches spec exactly. Tilde expansion, JSONC parsing, and path resolution all present.

**Test coverage**: `src/lib/__tests__/settings.test.ts` -- 18 test cases covering:
- Path expansion (5 tests: tilde prefix, lone tilde, absolute, relative, mid-path tilde)
- Path resolution (1 test: tilde expand + resolve to absolute)
- Settings parsing (7 tests: valid JSON, full config, tilde expansion, missing file, invalid JSON, empty plugins, JSONC comments)
- Settings discovery (3 tests: LACE_SETTINGS env, non-existent env path, null return)
- Load integration (2 tests: no config, from env var)

**Gap**: The `findSettingsConfig` test for "null when no settings file exists" (line 212-225) has a comment acknowledging it is environment-dependent. The test does not truly verify the XDG or legacy path branches; it just checks the return type. This is a pragmatic compromise since mocking `homedir()` in a pure function is non-trivial without restructuring.

#### `src/lib/devcontainer.ts` -- Fully Implemented (Plugin Extensions)

**Plugin-related functions added**: `extractPlugins`, `derivePluginName`, `getPluginNameOrAlias`, `parseRepoId`

**Types added**: `PluginOptions`, `PluginsConfig`, `PluginsResult`

**Completeness**: All proposal Phase 2 deliverables implemented. The `parseRepoId` function correctly separates `github.com/user/repo/subdir` into clone URL (`https://github.com/user/repo.git`) and subdirectory (`subdir`). Minimum 3 segments validated.

**Test coverage**: `src/lib/__tests__/devcontainer.test.ts` includes:
- `extractPlugins` (7 tests: standard, with aliases, absent, null, empty, missing customizations, missing lace)
- `derivePluginName` (4 tests: simple repo, subdirectory, deep path, trailing slash)
- `getPluginNameOrAlias` (3 tests: with alias, no alias, subdirectory no alias)
- `parseRepoId` (6 tests: simple, subdirectory, deep subdirectory, gitlab, invalid too-few-segments, single segment)
- Fixture files: `plugins-standard.jsonc`, `plugins-with-alias.jsonc`, `plugins-null.jsonc`, `plugins-empty.jsonc`

**Gap**: None identified. Test coverage fully matches the proposal test plan for this module.

#### `src/lib/plugin-clones.ts` -- Fully Implemented

**Functions**: `deriveProjectId`, `getClonePath`, `getPluginsDir`, `clonePlugin`, `updatePlugin`, `ensurePlugin`, `getPluginSourcePath`

**Completeness**: All proposal Phase 3 deliverables implemented. Clone uses `git clone --depth 1`. Update uses `git fetch --depth 1 origin` then `git reset --hard origin/HEAD`. Network failures during update return `success: true, skipped: true` (warn-and-continue), while reset failures throw `PluginCloneError` (corrupted clone). Subdirectory verification after clone is present.

**Test coverage**: `src/lib/__tests__/plugin-clones.test.ts` -- 21 test cases covering:
- Project ID derivation (7 tests: simple path, special chars, nested, trailing slash, consecutive dashes, lowercase, numbers)
- Path generation (2 tests: clone path, plugins dir)
- Clone plugin (4 tests: success, failure, subdirectory exists, subdirectory missing)
- Update plugin (4 tests: success, fetch failure/cache, reset failure, clone dir missing)
- Ensure plugin (2 tests: new clone, existing update)
- Plugin source path (2 tests: no subdirectory, with subdirectory)

**Gap**: The proposal's test plan (in the "Integration Tests: resolve-mounts" section) mentions testing shallow clones end-to-end, which is covered in the integration tests rather than here. The unit tests mock subprocess calls, so actual git behavior is not tested. This is appropriate for unit tests.

#### `src/lib/mounts.ts` -- Fully Implemented

**Functions**: `validateNoConflicts`, `getDefaultTarget`, `resolvePluginMounts`, `generateMountSpec`, `generateSymlinkCommands`, `generateMountSpecs`

**Types**: `ResolvedPlugin`, `ResolvedMounts`, `ResolvePluginMountsOptions`

**Completeness**: All proposal Phase 4 deliverables implemented. Conflict validation produces helpful error messages with alias suggestions (line 81-82). Mount spec format: `type=bind,source=...,target=...[,readonly]`. Symlink commands use `mkdir -p`, `rm -f`, `ln -s` pattern with single-quoted paths.

**Test coverage**: `src/lib/__tests__/mounts.test.ts` -- 18 test cases covering:
- Conflict validation (4 tests: unique names, aliases resolve conflict, conflict without aliases, alias suggestion in error)
- Default target (1 test: mount target prefix)
- Mount resolution (6 tests: override, custom target with symlink, missing override source, clone fallback, name conflict, aliases)
- Mount spec generation (2 tests: readonly, writable)
- Symlink commands (4 tests: no symlinks, single, multiple with &&, special characters)
- Generate all specs (1 test: multiple plugins)

**Gap**: The proposal's test plan included a separate "symlinks.test.ts" file, but symlink tests are co-located in `mounts.test.ts` instead. This is a reasonable organizational choice. The test for paths containing literal single quotes (flagged in the implementation review as a known limitation) is not present.

#### `src/lib/resolve-mounts.ts` -- Fully Implemented

**Functions**: `runResolveMounts`

**Types**: `ResolveMountsOptions`, `ResolveMountsResult`

**Completeness**: All proposal Phase 5 deliverables implemented. The workflow:
1. Read devcontainer.json via `readDevcontainerConfigMinimal`
2. Extract plugins (handle absent/null/empty early returns)
3. Load user settings via `loadSettings`
4. Derive project ID from workspace folder
5. Validate no name conflicts (even in dry-run)
6. Resolve mounts (clone or override) via `resolvePluginMounts`
7. Generate mount specs and symlink commands
8. Write `.lace/resolved-mounts.json`
9. Return summary with counts

The dry-run mode (lines 136-153) displays planned actions without cloning or writing files. Error handling catches `DevcontainerConfigError`, `SettingsConfigError`, and `MountsError` and converts them to exit codes.

**Test coverage**: Covered by the integration tests below.

**Gap**: The resolved-mounts.json output uses `"errors": []` as shown in the proposal, but the Round 2 review suggested renaming to `warnings`. The `errors` field is structurally dead code: individual errors are collected in a local array but then thrown as an aggregate `MountsError` before the output is ever written, so the field is always `[]` in any successfully written file.

#### `src/commands/resolve-mounts.ts` -- Fully Implemented

**Completeness**: Thin CLI wrapper using citty's `defineCommand`. Accepts `--dry-run` (boolean) and `--workspace-folder` (string). Delegates to `runResolveMounts` from the lib module.

#### `src/lib/up.ts` -- Fully Implemented

**Functions**: `runUp` (async), `generateExtendedConfig` (private), `runDevcontainerUp` (private)

**Types**: `UpOptions`, `UpResult`

**Completeness**: All proposal Phase 6 deliverables implemented. The full workflow:
1. Port assignment for wezterm SSH server (22425-22499 range) -- this was added post-proposal
2. Prebuild (if `customizations.lace.prebuildFeatures` configured)
3. Resolve mounts (if `customizations.lace.plugins` declared)
4. Generate extended `.lace/devcontainer.json` (always runs now, for port mapping)
5. Invoke `devcontainer up` with `--config .lace/devcontainer.json`

The `generateExtendedConfig` function (lines 243-311) handles:
- Merging mount specs into `mounts` array
- Merging symlink commands into `postCreateCommand` (handles string, array, and object formats)
- Adding port mapping to `appPort` (filters out existing lace port range)

**Test coverage**: `src/commands/__tests__/up.integration.test.ts` -- 11 test cases covering:
- Plugins with all overridden (extended config with mounts)
- Plugins with clones (git clone called)
- Prebuild only (Dockerfile rewritten)
- Full config (all phases in order)
- No plugins or prebuild (port mapping only)
- Resolution failures abort before devcontainer up
- Symlink in postCreateCommand (new and merged)
- Devcontainer up integration (config path, workspace folder passed)
- Devcontainer up failure handling
- Missing devcontainer.json

**Gap**: The port assignment phase (wezterm SSH) was added after the plugin proposal and is not part of the plugin spec. However, it is now always-on in `runUp`, which means `generateExtendedConfig` is always called even when there are no plugins. This is a design evolution from the proposal's "generate extended config only if there are mounts" approach. The change is justified by the port mapping requirement.

#### `src/commands/up.ts` -- Fully Implemented

**Completeness**: Thin CLI wrapper using citty. Accepts `--workspace-folder` and passes remaining args to devcontainer. Extracts and filters `--workspace-folder` from rawArgs before passing to devcontainer.

#### `src/index.ts` -- Fully Implemented

**Completeness**: CLI entry point registers 5 commands: `prebuild`, `resolve-mounts`, `restore`, `status`, `up`. The `resolve-mounts` command was added as part of the plugin system work.

---

## 3. API Surface

### Exported Types

From `src/lib/devcontainer.ts`:
- `PluginOptions` -- `{ alias?: string }`
- `PluginsConfig` -- `{ [repoId: string]: PluginOptions }`
- `PluginsResult` -- discriminated union: `plugins | absent | null | empty`

From `src/lib/settings.ts`:
- `LaceSettings` -- `{ plugins?: { [repoId: string]: PluginSettings } }`
- `PluginSettings` -- `{ overrideMount?: { source: string; readonly?: boolean; target?: string } }`
- `SettingsConfigError` -- error class

From `src/lib/plugin-clones.ts`:
- `PluginCloneError` -- error class
- `ClonePluginOptions`, `ClonePluginResult`, `UpdatePluginOptions`, `UpdatePluginResult`

From `src/lib/mounts.ts`:
- `ResolvedPlugin` -- the central type describing a fully resolved plugin mount
- `ResolvedMounts` -- `{ version: 2, generatedAt: string, plugins: ResolvedPlugin[], errors: string[] }`
- `MountsError` -- error class
- `ResolvePluginMountsOptions`

From `src/lib/resolve-mounts.ts`:
- `ResolveMountsOptions`, `ResolveMountsResult`

From `src/lib/up.ts`:
- `UpOptions`, `UpResult`

### Exported Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `expandPath(path)` | settings | Tilde expansion |
| `resolveSettingsPath(path)` | settings | Tilde + resolve to absolute |
| `findSettingsConfig()` | settings | Discover settings.json |
| `readSettingsConfig(filePath)` | settings | Parse settings.json |
| `loadSettings()` | settings | Find + read settings |
| `extractPlugins(raw)` | devcontainer | Extract plugins from parsed config |
| `derivePluginName(repoId)` | devcontainer | Last segment of repoId |
| `getPluginNameOrAlias(repoId, options)` | devcontainer | Alias or derived name |
| `parseRepoId(repoId)` | devcontainer | Split into cloneUrl + subdirectory |
| `deriveProjectId(workspaceFolder)` | plugin-clones | Sanitized basename |
| `getClonePath(projectId, nameOrAlias)` | plugin-clones | `~/.config/lace/$project/plugins/$name` |
| `getPluginsDir(projectId)` | plugin-clones | `~/.config/lace/$project/plugins/` |
| `clonePlugin(options)` | plugin-clones | `git clone --depth 1` |
| `updatePlugin(options)` | plugin-clones | `git fetch + reset` |
| `ensurePlugin(options)` | plugin-clones | Clone or update |
| `getPluginSourcePath(cloneDir, subdirectory?)` | plugin-clones | Append subdirectory if present |
| `validateNoConflicts(plugins)` | mounts | Throws on name collisions |
| `getDefaultTarget(nameOrAlias)` | mounts | `/mnt/lace/plugins/$name` |
| `resolvePluginMounts(options)` | mounts | Core resolution logic |
| `generateMountSpec(plugin)` | mounts | `type=bind,source=...,target=...` |
| `generateSymlinkCommands(plugins)` | mounts | Shell commands for symlinks |
| `generateMountSpecs(plugins)` | mounts | Map over all plugins |
| `runResolveMounts(options)` | resolve-mounts | Full resolve-mounts workflow |
| `runUp(options)` | up | Full lace up workflow |

---

## 4. Mount Resolution Flow

End-to-end data flow from devcontainer.json declaration to container mount:

### Step 1: Plugin Declaration (devcontainer.json)

```jsonc
// .devcontainer/devcontainer.json
{
  "customizations": {
    "lace": {
      "plugins": {
        "github.com/user/dotfiles": {},
        "github.com/user/claude-plugins/plugins/my-plugin": {
          "alias": "claude"
        }
      }
    }
  }
}
```

### Step 2: Extraction

`extractPlugins(raw)` at `devcontainer.ts:236-257` traverses `raw.customizations.lace.plugins` and returns `{ kind: "plugins", plugins: PluginsConfig }`.

`parseRepoId("github.com/user/claude-plugins/plugins/my-plugin")` at `devcontainer.ts:292-315` produces `{ cloneUrl: "https://github.com/user/claude-plugins.git", subdirectory: "plugins/my-plugin" }`.

`getPluginNameOrAlias("github.com/user/claude-plugins/plugins/my-plugin", { alias: "claude" })` at `devcontainer.ts:277-282` returns `"claude"`.

### Step 3: User Settings

`loadSettings()` at `settings.ts:136-142` discovers `~/.config/lace/settings.json`, parses it, and expands tilde paths in override sources.

Example settings:
```jsonc
{
  "plugins": {
    "github.com/user/dotfiles": {
      "overrideMount": {
        "source": "~/code/personal/dotfiles"
      }
    }
  }
}
```

### Step 4: Resolution

`resolvePluginMounts()` at `mounts.ts:117-156` iterates each plugin:

- **dotfiles** (has override): `resolveOverridePlugin` validates source exists, uses override source, default target `/mnt/lace/plugins/dotfiles`, readonly true.
- **claude** (no override): `resolveClonePlugin` calls `ensurePlugin` which runs `git clone --depth 1 https://github.com/user/claude-plugins.git ~/.config/lace/$project/plugins/claude`, then uses `~/.config/lace/$project/plugins/claude/plugins/my-plugin` as source (subdirectory appended).

### Step 5: Output (resolved-mounts.json)

Written to `.lace/resolved-mounts.json`:
```json
{
  "version": 2,
  "generatedAt": "2026-02-05T...",
  "plugins": [
    {
      "repoId": "github.com/user/dotfiles",
      "nameOrAlias": "dotfiles",
      "source": "/home/user/code/personal/dotfiles",
      "target": "/mnt/lace/plugins/dotfiles",
      "readonly": true,
      "isOverride": true
    },
    {
      "repoId": "github.com/user/claude-plugins/plugins/my-plugin",
      "nameOrAlias": "claude",
      "source": "/home/user/.config/lace/myproject/plugins/claude/plugins/my-plugin",
      "target": "/mnt/lace/plugins/claude",
      "readonly": true,
      "isOverride": false
    }
  ],
  "errors": []
}
```

### Step 6: Mount Spec Generation

`generateMountSpecs(plugins)` at `mounts.ts:328-330` produces:
```
["type=bind,source=/home/user/code/personal/dotfiles,target=/mnt/lace/plugins/dotfiles,readonly",
 "type=bind,source=/home/user/.config/lace/myproject/plugins/claude/plugins/my-plugin,target=/mnt/lace/plugins/claude,readonly"]
```

### Step 7: Extended Config Generation

`generateExtendedConfig()` at `up.ts:243-311`:
1. Reads original devcontainer.json
2. Merges mount specs into `mounts` array (preserving existing mounts)
3. Merges symlink commands into `postCreateCommand` (if any)
4. Adds port mapping to `appPort`
5. Writes to `.lace/devcontainer.json`

### Step 8: Devcontainer Up

`devcontainer up --config .lace/devcontainer.json --workspace-folder $workspace`

---

## 5. Extension Points

These are the specific locations in the architecture where future work (claude access, mount-enabled plugins, host setup) can integrate.

### 5.1 The `ResolvedPlugin` Interface (`mounts.ts:29-49`)

This is the central data type. Any future plugin metadata (permissions, lifecycle hooks, environment variables) would be added here. Current fields:

```typescript
interface ResolvedPlugin {
  repoId: string;
  nameOrAlias: string;
  source: string;
  target: string;
  readonly: boolean;
  isOverride: boolean;
  symlink?: { from: string; to: string; };
}
```

To add plugin-declared container environment variables, mounts, or lifecycle scripts, extend this interface.

### 5.2 The `PluginOptions` Interface (`devcontainer.ts:19-25`)

Currently only has `alias?: string`. Any new per-plugin project-level configuration (e.g., `when` conditions, `hostSetup` declarations, `env` mappings) would be added here.

### 5.3 The `PluginSettings` Interface (`settings.ts:19-28`)

Currently only has `overrideMount`. Any new per-plugin user-level configuration (e.g., `hostSetup.env` overrides, `skipScripts` flags) would be added here.

### 5.4 `generateExtendedConfig()` (`up.ts:243-311`)

This function assembles the final devcontainer.json. It already handles:
- `mounts` array (line 265-268)
- `postCreateCommand` merging in all formats: string, array, object (lines 271-289)
- `appPort` array (lines 293-303)

To add plugin-declared environment variables, extend this to merge into `remoteEnv` or `containerEnv`. To add plugin lifecycle hooks, merge additional commands into `postStartCommand`, `postAttachCommand`, etc.

**Note**: `generateExtendedConfig` is module-private (not exported from `up.ts`). Downstream code cannot call it directly or wrap it -- it can only be reached through `runUp`. If a downstream consumer needs to generate an extended config without running the full `lace up` workflow, this would require either exporting the function or duplicating logic.

### 5.5 The Resolve Pipeline (`resolve-mounts.ts:49-209`)

The `runResolveMounts` function orchestrates the full resolve workflow. It returns `ResolveMountsResult` which includes `mountSpecs`, `symlinkCommand`, and `resolved`. The caller (`runUp`) consumes these to generate the extended config.

To add host-side setup, a new phase would be inserted between resolution and config generation. The `resolved.plugins` array provides all the information needed to locate plugin manifests and run setup scripts.

### 5.6 The `ensurePlugin` Function (`plugin-clones.ts:186-200`)

This determines whether to clone or update. It currently checks for `.git` directory existence. A future extension could add version pinning (branch/tag) support here.

### 5.7 Downstream Dependencies

For downstream work on claude devcontainer bundling and claude-tools integration, the current plugin system handles mounting directories into the container but does not handle configuring the container's environment for a tool (environment variables, PATH modifications, lifecycle scripts). That capability depends on the host setup RFP's `plugin.lace.json` manifest concept (see Section 7). Until that RFP is implemented, any claude-tools-specific container setup would need to be hard-coded in the devcontainer.json or handled outside the plugin system.

Additionally, the `extractPlugins`/`extractPrebuildFeatures` two-tier extraction pattern in `devcontainer.ts` serves as a template for adding new `customizations.lace.*` sections. If claude tooling needs its own customizations section (e.g., `customizations.lace.claudeTools`), a new extractor following the same discriminated-union pattern can be added alongside the existing ones.

---

## 6. Known Gaps / Open Issues

### 6.1 `errors` Field in `ResolvedMounts` Is Structurally Dead Code

The `ResolvedMounts` interface includes an `errors: string[]` field (from the proposal), but it is structurally dead code in the current implementation. The mechanism: `resolvePluginMounts()` collects individual plugin errors in a local `errors` array (lines 126, 139), but then throws a `MountsError` aggregating them all (lines 144-148) before the `errors: []` output is ever constructed at line 154. This means the field is always `[]` in any successfully written file -- not because errors are absent, but because any error causes an exception before the output path is reached. The Round 2 review suggested renaming to `warnings` for non-fatal issues like update failures. Currently, update failures (network during `git fetch`) log a warning message but this warning does not propagate into the resolved-mounts.json output. The warning is in the `UpdatePluginResult.message` field but `resolveClonePlugin()` in `mounts.ts:252-278` discards the result of `ensurePlugin()`.

### 6.2 Update Result Discarded

In `mounts.ts:265`, `ensurePlugin(cloneOptions)` is called but its return value is not used. This means:
- Update warnings (network failures using cached version) are silently swallowed
- Clone success/failure messages are lost
- The `UpdatePluginResult.skipped` flag is not surfaced to the user

The `runResolveMounts` summary only reports counts (overrides, clones, symlinks), not individual plugin statuses.

### 6.3 Synchronous Subprocess for Git Operations

All git operations use `execFileSync` via `subprocess.ts`. For projects with many non-overridden plugins, sequential clone/update operations could be slow. Parallel clone support would require moving to async subprocess calls, which would cascade through the call chain. Currently `runUp` is async (for port assignment) but `runResolveMounts` is synchronous.

### 6.4 No Plugin Version Pinning

The proposal's Open Question #2 identified this: non-overridden plugins always track HEAD of the default branch. There is no way to pin a specific commit, tag, or branch. This limits reproducibility for team environments.

### 6.5 postCreateCommand Array Format Handling

Flagged in the implementation review: when the original `postCreateCommand` is an array `["command", "arg1", "arg2"]`, the code joins with space and appends the symlink command (`up.ts:278-281`). This loses proper argument quoting if args contain spaces. A minor edge case but could cause subtle breakage.

### 6.6 Single-Quote Shell Quoting in Symlink Commands

Symlink commands use single quotes around paths (`mounts.ts:311-313`). Paths containing literal single quotes would break the shell command. The implementation review flagged this as a known limitation.

### 6.7 Settings Discovery Test Coverage

The `findSettingsConfig` test for the null path (no settings file found) is environment-dependent and does not truly verify the XDG or legacy location branches, as noted in `settings.test.ts:221-224`.

### 6.8 No Plugin Manifest Support

The current system only handles mounts. Plugins cannot declare their own environment variables, lifecycle scripts, additional mounts, or host-side requirements. The host setup RFP outlines a `plugin.lace.json` manifest concept, but no implementation exists.

---

## 7. RFP Status

### RFP: Plugin Conditional Loading (`when` field)

**File**: `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md`
**Status**: `request_for_proposal` (no full proposal written)
**State**: `live`

**Summary**: Proposes a `when` field on plugin declarations to conditionally load plugins based on file presence, environment variables, or project metadata. Inspired by VS Code's when-clause context system.

**Scope**:
- Expression language design (boolean operators, file existence checks, env var checks)
- Evaluation timing (at `lace resolve-mounts` time, host-side)
- Interaction with error-on-missing behavior (skipped != missing)
- Schema extension to `PluginOptions`

**Assessment**: This is a straightforward extension. It would add a `when?: string` field to `PluginOptions` and add an evaluation step in `resolvePlugin()` (in `mounts.ts:169-194`) before checking for overrides or cloning. A `when` expression evaluating to false would skip the plugin entirely without error. The main design work is in the expression language -- keeping it simple (file existence + env checks + boolean operators) would be practical without requiring a full parser.

### RFP: Plugin Host Setup and Runtime Scripts

**File**: `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md`
**Status**: `request_for_proposal` (no full proposal written)
**State**: `live`

**Summary**: Proposes allowing plugins to declare host-side setup requirements (SSH keys, daemons) and container-side lifecycle scripts. Introduces a `plugin.lace.json` manifest format with `hostSetup` and `containerSetup` sections.

**Scope**:
- Plugin manifest format (`plugin.lace.json`)
- Host-side script execution with trust model
- Container lifecycle hook integration (postCreate, postStart, postAttach)
- Security considerations (script trust, credential handling)
- User override capabilities (skip scripts, override env)

**Assessment**: This is the more complex of the two RFPs. It requires:
1. A manifest discovery mechanism (look for `plugin.lace.json` in each resolved plugin's source directory)
2. Host-side script execution with user trust/consent
3. Merging multiple plugins' lifecycle hooks into devcontainer lifecycle commands (ordering, error handling)
4. The security model is the hardest part -- running arbitrary host scripts from cloned repos is a significant trust surface

**Relevance to future claude access work**: If claude tooling needs to be mounted as a plugin with specific environment variables or container setup, the host setup RFP's `containerSetup.env` and `containerSetup.postCreate` patterns would be the mechanism. Without this RFP implemented, such configuration would need to be hard-coded in the devcontainer.json or handled outside the plugin system.

---

## Appendix: File Reference

| File | Lines | Role |
|------|-------|------|
| `packages/lace/src/lib/settings.ts` | 142 | Settings discovery, parsing, path expansion |
| `packages/lace/src/lib/settings.test.ts` | 261 | Unit tests for settings |
| `packages/lace/src/lib/devcontainer.ts` | 341 | Config parsing, plugins extraction, repo ID parsing |
| `packages/lace/src/lib/devcontainer.test.ts` | 488 | Unit tests for devcontainer (including plugins) |
| `packages/lace/src/lib/plugin-clones.ts` | 209 | Clone management, project ID derivation |
| `packages/lace/src/lib/plugin-clones.test.ts` | 364 | Unit tests for clone management |
| `packages/lace/src/lib/mounts.ts` | 330 | Mount resolution, conflict validation, spec generation |
| `packages/lace/src/lib/mounts.test.ts` | 427 | Unit tests for mounts |
| `packages/lace/src/lib/resolve-mounts.ts` | 209 | Resolve-mounts workflow orchestration |
| `packages/lace/src/commands/resolve-mounts.ts` | 38 | CLI command definition |
| `packages/lace/src/commands/resolve-mounts.integration.test.ts` | 424 | Integration tests for resolve-mounts |
| `packages/lace/src/lib/up.ts` | 343 | Full lace up workflow |
| `packages/lace/src/commands/up.ts` | 54 | CLI command definition |
| `packages/lace/src/commands/up.integration.test.ts` | 513 | Integration tests for lace up |
| `packages/lace/src/lib/subprocess.ts` | 43 | Subprocess execution wrapper |
| `packages/lace/src/index.ts` | 24 | CLI entry point |

## Related Documents

- **Proposal**: `cdocs/proposals/2026-02-04-lace-plugins-system.md` (status: implementation_complete, approved)
- **Devlog**: `cdocs/devlogs/2026-02-04-lace-plugins-system-implementation.md` (status: done, accepted)
- **Review Round 1**: `cdocs/reviews/2026-02-04-review-of-lace-plugins-system.md` (verdict: revise)
- **Review Round 2**: `cdocs/reviews/2026-02-04-r2-review-of-lace-plugins-system.md` (verdict: approve)
- **Implementation Review**: `cdocs/reviews/2026-02-04-review-of-lace-plugins-system-implementation.md` (verdict: accept)
- **RFP Conditional Loading**: `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md`
- **RFP Host Setup**: `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md`
- **Design Decisions**: `cdocs/reports/2026-02-04-lace-plugins-design-decisions.md`
