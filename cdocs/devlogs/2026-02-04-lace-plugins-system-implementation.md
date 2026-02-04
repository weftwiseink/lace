---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T22:30:00-08:00
task_list: lace/plugins-system
type: devlog
state: live
status: wip
tags: [devcontainer, mounts, plugins, lace-cli, implementation]
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
- [ ] Add `src/lib/settings.ts` module
- [ ] `findSettingsConfig()`: Locate settings.json following discovery order
- [ ] `readSettingsConfig(path)`: Parse and validate the file
- [ ] `expandPath(path)`: Handle tilde expansion and resolve to absolute
- [ ] Tests: `src/lib/__tests__/settings.test.ts`

### Phase 2: Plugins Extraction
- [ ] Extend `src/lib/devcontainer.ts` with `extractPlugins(raw)`
- [ ] Type definitions for `PluginOptions`
- [ ] Name derivation logic (from repoId or alias)
- [ ] Tests: Add cases to `src/lib/__tests__/devcontainer.test.ts`

### Phase 3: Plugin Clone Management
- [ ] Add `src/lib/plugin-clones.ts` module
- [ ] `clonePlugin(repoId, targetDir)`: Shallow clone a plugin repo
- [ ] `updatePlugin(cloneDir)`: Update existing clone to latest
- [ ] `getClonePath(project, nameOrAlias)`: Resolve clone location
- [ ] Tests: `src/lib/__tests__/plugin-clones.test.ts`

### Phase 4: Mount Resolution Logic
- [ ] Add `src/lib/mounts.ts` module
- [ ] `resolvePluginMounts(plugins, settings, project)`: Core resolution logic
- [ ] `validateNoConflicts(plugins)`: Check for name/alias conflicts
- [ ] `generateMountSpec(mount)`: Produce devcontainer mount string
- [ ] `generateSymlinkSpec(symlink)`: Produce symlink creation command
- [ ] Tests: `src/lib/__tests__/mounts.test.ts`

### Phase 5: resolve-mounts Command
- [ ] Add `src/commands/resolve-mounts.ts`
- [ ] Wire up parsing, cloning, resolution, and output
- [ ] Write `.lace/resolved-mounts.json`
- [ ] Handle errors with clear messages
- [ ] Tests: `src/commands/__tests__/resolve-mounts.integration.test.ts`

### Phase 6: lace up Integration
- [ ] Extend `src/commands/up.ts`
- [ ] Run `lace resolve-mounts` as part of `lace up` workflow
- [ ] Generate extended devcontainer.json with mounts
- [ ] Add postCreateCommand entries for symlink creation
- [ ] Tests: `src/commands/__tests__/up.integration.test.ts`

### Phase 7: Documentation and Polish
- [ ] Update lace CLI help text
- [ ] Handle edge cases discovered during testing
- [ ] Update proposal status to implementation_accepted

## Testing Approach

Following the proposal's test plan:
- Unit tests for each library module (settings, plugins extraction, clone management, mounts)
- Integration tests for CLI commands (resolve-mounts, up)
- Test-first approach where practical, with tests committed alongside implementation

## Implementation Notes

*(To be updated as implementation proceeds)*

## Changes Made

| File | Description |
|------|-------------|

## Verification

*(To be completed at end of implementation)*
