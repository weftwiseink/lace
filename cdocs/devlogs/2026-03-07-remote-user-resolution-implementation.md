---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-07T17:00:00-06:00
task_list: lace/mount-resolver
type: devlog
state: archived
status: done
related_to:
  - cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md
---

# Devlog: Remote User Resolution in Mount Targets

## Objective

Implement the accepted proposal at `cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md` to resolve `${_REMOTE_USER}` and `${containerWorkspaceFolder}` in mount target paths within `MountPathResolver`.

## Task List

- [x] Phase 1: Core resolution in `MountPathResolver`
- [x] Phase 2: Remote user extraction from config
- [x] Phase 3: Pipeline integration in `up.ts`
- [x] Phase 4: Update tests and documentation

## Session Log

### Phase 1: Core resolution in MountPathResolver

Added `ContainerVariables` interface and `resolveTargetVariables()` private method to `mount-resolver.ts`. Modified constructor to accept optional `containerVars` parameter. Deep-copies declarations with resolved targets on construction.

Key decisions:
- `resolveTargetVariables` is a no-op when `containerVars` is undefined (backwards compat)
- Deep copy prevents mutation of original declaration objects
- Eager resolution at construction time ensures conflict detection sees resolved paths

Tests added for: variable resolution with containerVars, passthrough without containerVars, resolveFullSpec with resolved targets, containerWorkspaceFolder resolution, multiple variables in one target.

### Phase 2: Remote user extraction

Added `parseDockerfileUser()` to existing `dockerfile.ts`. Uses `DockerfileParser` (already imported) with bottom-up instruction iteration.

> NOTE(opus/cdocs): The proposal's code snippet used `args.getContent()` but the actual `dockerfile-ast` API has `getArguments()` returning `Argument[]` where each has `.getValue()`. Used `getArgumentsContent()` on the instruction directly for the cleanest approach, which returns the raw arguments string.

Added `extractRemoteUser()` to `devcontainer.ts`. Uses `resolveBuildSource()` with try/catch (not `tryResolveBuildSource` which doesn't exist).

### Phase 3: Pipeline integration

Wired `extractRemoteUser()` into `runUp()` in `up.ts`. Container variables are extracted before `MountPathResolver` construction. Added import for `extractRemoteUser` from devcontainer and `ContainerVariables` from mount-resolver.

### Phase 4: Test and documentation updates

Updated scenario test assertions from `${_REMOTE_USER}` to resolved paths. Added cross-reference comment in `bin/lace-discover`.

## Verification

All tests pass after each phase. Full test suite green at completion.
