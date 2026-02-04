---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T22:30:00-08:00
task_list: lace/plugins-system
type: devlog
state: live
status: review_ready
tags: [devcontainer, mounts, plugins, lace-cli, implementation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T22:38:00-08:00
  round: 1
---

# Lace Plugins System Implementation: Devlog

## Objective

Implement the approved [Lace Plugins System proposal](../proposals/2026-02-04-lace-plugins-system.md).

Key deliverables:
1. New `lace resolve-mounts` CLI command
2. Plugin configuration in `~/.config/lace/settings.json`
3. Shallow clone management to `~/.config/lace/$project/plugins/`
4. Mount generation for devcontainer.json
5. Symlink bridging for target overrides
6. Conflict detection for plugin names/aliases

## Plan

Following the proposal's implementation phases:

### Phase 1: Settings File Support
- [x] Add `src/lib/settings.ts` module
- [x] `findSettingsConfig()`: Locate settings.json following discovery order
- [x] `readSettingsConfig(path)`: Parse and validate the file
- [x] `expandPath(path)`: Handle tilde expansion and resolve to absolute
- [x] Tests: `src/lib/__tests__/settings.test.ts`

### Phase 2: Plugins Extraction
- [x] Extend `src/lib/devcontainer.ts` with `extractPlugins(raw)`
- [x] Type definitions for `PluginOptions`
- [x] Name derivation logic (from repoId or alias)
- [x] Tests: Add cases to `src/lib/__tests__/devcontainer.test.ts`

### Phase 3: Plugin Clone Management
- [x] Add `src/lib/plugin-clones.ts` module
- [x] `clonePlugin(repoId, targetDir)`: Shallow clone a plugin repo
- [x] `updatePlugin(cloneDir)`: Update existing clone to latest
- [x] `getClonePath(project, nameOrAlias)`: Resolve clone location
- [x] Tests: `src/lib/__tests__/plugin-clones.test.ts`

### Phase 4: Mount Resolution Logic
- [x] Add `src/lib/mounts.ts` module
- [x] `resolvePluginMounts(plugins, settings, project)`: Core resolution logic
- [x] `validateNoConflicts(plugins)`: Check for name/alias conflicts
- [x] `generateMountSpec(mount)`: Produce devcontainer mount string
- [x] `generateSymlinkCommands(symlink)`: Produce symlink creation command
- [x] Tests: `src/lib/__tests__/mounts.test.ts`

### Phase 5: resolve-mounts Command
- [x] Add `src/commands/resolve-mounts.ts`
- [x] Wire up parsing, cloning, resolution, and output
- [x] Write `.lace/resolved-mounts.json`
- [x] Handle errors with clear messages
- [x] Tests: `src/commands/__tests__/resolve-mounts.integration.test.ts`

### Phase 6: lace up Integration
- [x] Add `src/commands/up.ts`
- [x] Run `lace resolve-mounts` as part of `lace up` workflow
- [x] Generate extended devcontainer.json with mounts
- [x] Add postCreateCommand entries for symlink creation
- [x] Tests: `src/commands/__tests__/up.integration.test.ts`

### Phase 7: Documentation and Polish
- [x] Update lace CLI help text (citty auto-generates from meta.description)
- [x] Handle edge cases discovered during testing (dry-run conflict detection)
- [ ] Update proposal status to implementation_accepted (pending user acceptance)

## Testing Approach

Following the proposal's test plan:
- Unit tests for each library module (settings, plugins extraction, clone management, mounts)
- Integration tests for CLI commands (resolve-mounts, up)
- Test-first approach where practical, with tests committed alongside implementation

## Implementation Notes

### Phase 1 Notes
- Settings file discovery follows priority: LACE_SETTINGS env var > ~/.config/lace/settings.json > ~/.lace/settings.json
- Path expansion handles tilde (~) to home directory and resolves to absolute paths

### Phase 2 Notes
- Added `PluginsResult` discriminated union type matching the pattern used for `PrebuildFeaturesResult`
- `parseRepoId()` extracts clone URL and subdirectory from repo identifier format `github.com/user/repo[/subdir]`
- `derivePluginName()` takes the last path segment as the plugin name

### Phase 3 Notes
- `deriveProjectId()` sanitizes workspace folder basename: lowercase, non-alphanumeric to dash, collapse consecutive dashes
- Clone uses `git clone --depth 1` for efficiency
- Update uses `git fetch --depth 1 origin && git reset --hard origin/HEAD`
- Network failures during update are warnings (use cached), but reset failures are errors (corrupted clone)

### Phase 4 Notes
- Conflict validation provides helpful error messages with alias examples
- Symlink generation uses single quotes for paths to handle spaces
- Mount specs follow devcontainer format: `type=bind,source=...,target=...[,readonly]`

### Phase 5 Notes
- Dry run mode shows what would happen without cloning or writing files
- Outputs summary with counts of overrides, clones, and symlinks

### Phase 6 Notes
- Had to use `workspaceRoot` (not `workspaceFolder`) when calling `runPrebuild()` to match its interface
- Extended devcontainer.json merges with original config, adding mounts and postCreateCommand
- postCreateCommand merging handles string, array, and object formats

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/settings.ts` | Settings file discovery, parsing, path expansion |
| `packages/lace/src/lib/__tests__/settings.test.ts` | Unit tests for settings module |
| `packages/lace/src/lib/devcontainer.ts` | Added extractPlugins, derivePluginName, parseRepoId |
| `packages/lace/src/lib/__tests__/devcontainer.test.ts` | Added tests for plugins extraction |
| `packages/lace/src/__fixtures__/devcontainers/plugins-*.jsonc` | Plugin fixtures |
| `packages/lace/src/lib/plugin-clones.ts` | Shallow clone management |
| `packages/lace/src/lib/__tests__/plugin-clones.test.ts` | Unit tests for clone management |
| `packages/lace/src/lib/mounts.ts` | Mount resolution, conflict validation, spec generation |
| `packages/lace/src/lib/__tests__/mounts.test.ts` | Unit tests for mounts module |
| `packages/lace/src/lib/resolve-mounts.ts` | resolve-mounts workflow logic |
| `packages/lace/src/commands/resolve-mounts.ts` | CLI command definition |
| `packages/lace/src/commands/__tests__/resolve-mounts.integration.test.ts` | Integration tests |
| `packages/lace/src/lib/up.ts` | lace up workflow orchestration |
| `packages/lace/src/commands/up.ts` | CLI command definition |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Integration tests |
| `packages/lace/src/index.ts` | Registered resolve-mounts and up commands |

## Verification

### Build & Typecheck
```
> lace@0.1.0 typecheck
> tsc --noEmit
(no errors)
```

### Tests
```
Test Files  16 passed (16)
     Tests  254 passed (254)
```

All new functionality covered by unit and integration tests.

### Manual CLI Verification
```bash
$ lace --help
Devcontainer orchestration CLI (lace v0.1.0)

USAGE lace prebuild|resolve-mounts|restore|status|up

COMMANDS
        prebuild    Pre-bake devcontainer features onto the base image for faster startup
  resolve-mounts    Resolve plugin mounts from devcontainer.json and user settings
         restore    Undo the prebuild FROM rewrite, restoring the original Dockerfile
          status    Show current prebuild state (original image, prebuild image, staleness)
              up    Start a devcontainer with prebuild features and plugin mounts

$ lace resolve-mounts --dry-run --workspace-folder /tmp/test
Dry run: Would resolve 2 plugin(s) for project 'test':
  - github.com/user/dotfiles [override]
  - github.com/user/monorepo/plugins/my-plugin (alias: my-plugin) [clone]
```

### Conflict Detection
```bash
$ lace resolve-mounts --dry-run --workspace-folder /tmp/conflict-test
Plugin name conflict: 'github.com/alice/utils' and 'github.com/bob/utils' resolve to name 'utils'. Add explicit aliases:

  "github.com/alice/utils": { "alias": "utils-1" },
  "github.com/bob/utils": { "alias": "utils-2" }
```
