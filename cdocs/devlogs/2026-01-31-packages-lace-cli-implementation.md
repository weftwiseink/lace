---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T14:00:00-08:00
task_list: lace/packages-lace-cli
type: devlog
state: live
status: wip
tags: [devcontainer, cli, prebuild, npm, typescript, implementation]
---

# packages/lace CLI Implementation: Devlog

## Objective

Implement the `packages/lace` devcontainer wrapper CLI as specified in `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`.

The lace CLI pre-bakes devcontainer features onto base images at build time, eliminating cold-start installation delays during `devcontainer up`. It reads `customizations.lace.prebuildFeatures` from devcontainer.json, runs `devcontainer build` against a temporary context cached in `.lace/prebuild/`, and rewrites the Dockerfile's first `FROM` line to use the pre-baked image.

## Plan

Follow the proposal's six implementation phases sequentially:

1. **Phase 1**: Package scaffold — pnpm workspace, TypeScript, Vite, Vitest, CLI skeleton
2. **Phase 2**: Dockerfile parsing and rewriting — `dockerfile-ast`, FROM extraction, tag generation, rewrite/restore
3. **Phase 3**: devcontainer.json reading, validation, temp context generation — `jsonc-parser`, arktype, overlap detection
4. **Phase 4**: Prebuild pipeline orchestration — metadata, subprocess, cache comparison, --dry-run, --force
5. **Phase 5**: Lock file merging — namespaced `lace.prebuiltFeatures` entries
6. **Phase 6**: restore, status commands, end-to-end polish

## Testing Approach

Test-first methodology as specified in the proposal. Each phase writes failing tests before implementation code. Tests use vitest with fixtures in `src/__fixtures__/`. Integration tests mock the `devcontainer build` subprocess. All tests marked with `// IMPLEMENTATION_VALIDATION` comment.

## Implementation Notes

*(Updated as work proceeds)*

## Changes Made

| File | Description |
|------|-------------|

## Verification

*(Updated on completion)*
