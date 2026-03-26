---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T17:00:00-07:00
task_list: sprack/devcontainer-feature
type: devlog
state: live
status: wip
tags: [sprack, devcontainer, container]
---

# Sprack Devcontainer Feature: Devlog

> BLUF: Implementing the accepted proposal at `cdocs/proposals/2026-03-26-sprack-devcontainer-feature.md`.
> Three phases: feature scaffold with mount resolver extension, container verification, and host-side Rust discovery changes.

## Objective

Enable the sprack hook bridge to work inside lace containers by creating a `sprack` devcontainer feature that mounts `~/.local/share/sprack/lace/<projectName>/` on the host to `/mnt/sprack/` in the container, with `SPRACK_EVENT_DIR=/mnt/sprack/claude-events`.

## Plan

1. **Phase 1: Feature scaffold + mount resolver extension**
   - Create `devcontainers/features/src/sprack/` with `devcontainer-feature.json` and `install.sh`
   - Extend `MountPathResolver.resolveValidatedSource()` to support `${lace.projectName}` in `recommendedSource`
   - Add tests for the new substitution
   - Commit

2. **Phase 2: Container verification**
   - Add sprack feature to lace's `.devcontainer/devcontainer.json`
   - Rebuild container and verify mount, env var, permissions
   - Commit

3. **Phase 3: Host-side discovery (sprack-claude Rust changes)**
   - Replace `default_event_dir()` with `event_dirs()` returning multiple directories
   - Update call site in `main.rs`
   - Add unit tests
   - Commit

## Testing Approach

- Phase 1: `pnpm test` in `packages/lace/` for mount resolver unit tests
- Phase 2: Manual container verification via `podman exec`
- Phase 3: `cargo test --workspace` in `packages/sprack/`

## Implementation Notes

*Updated as work progresses.*

## Changes Made

| File | Description |
|------|-------------|

## Verification

*Pending implementation.*
