---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T00:25:00-08:00
task_list: lace/dogfooding
type: devlog
state: archived
status: done
tags: [rename, refactor, wezterm-server, ports, devcontainer]
---

# Rename sshPort to hostSshPort

**Date:** 2026-02-10
**Scope:** wezterm-server feature metadata, lace port pipeline, all tests

## Context

The wezterm-server feature had a `sshPort` option that existed purely as metadata for lace's port allocator. It was never consumed by `install.sh`. The name `sshPort` was misleading because it implied a container-side SSH port configuration, when in reality it only describes the host-side port that lace allocates for SSH access to the container's wezterm mux server.

The rename to `hostSshPort` makes the semantics explicit: this is the HOST-side SSH port, not the container-side port (which is always 2222 for the prebaked sshd feature).

## Changes

### Feature manifest
- `devcontainers/features/src/wezterm-server/devcontainer-feature.json`:
  - Option renamed from `sshPort` to `hostSshPort`
  - `customizations.lace.ports` key renamed from `sshPort` to `hostSshPort`
  - Description updated to clarify metadata-only nature
  - TODO added to description: decouple SSH port handling into a thin sshd wrapper feature

### Devcontainer config
- `.devcontainer/devcontainer.json`: Template updated from `${lace.port(wezterm-server/sshPort)}` to `${lace.port(wezterm-server/hostSshPort)}`

### Source code (comments only)
- `packages/lace/src/lib/port-allocator.ts`: JSDoc example updated
- `packages/lace/src/lib/template-resolver.ts`: JSDoc example updated

### Tests (9 files)
- `packages/lace/src/__tests__/wezterm-server-scenarios.test.ts`
- `packages/lace/src/commands/__tests__/up.integration.test.ts`
- `packages/lace/src/lib/__tests__/port-allocator.test.ts`
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

All 445 tests pass.

## Not changed

- `install.sh` -- the variable was never used there (confirmed: only `VERSION` and `CREATERUNTIMEDIR` are read)
- cdocs (proposals, reports, reviews, devlogs) -- these are historical documents and should preserve the original naming at time of writing
- Existing `port-assignments.json` files on disk -- these use the label string `wezterm-server/sshPort` which will be naturally migrated on next `lace up` run (the allocator treats it as a new label and allocates a fresh port)

## Docker verification

The dotfiles devcontainer is running without port mappings (PORTS column empty). This is expected -- the container predates the port allocation fix and was started without `lace up`.
