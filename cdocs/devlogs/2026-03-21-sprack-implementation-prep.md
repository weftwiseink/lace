---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T23:00:00-07:00
task_list: terminal-management/sprack-tui
type: devlog
state: live
status: wip
tags: [sprack, devcontainer, rust, tooling]
---

# Devlog: sprack Implementation Prep

> BLUF: Implementing the sprack devcontainer prep proposal: adding Rust toolchain, tmux, sqlite3, and scaffolding the Cargo workspace.
> This is the foundation for all sprack development.

## Objective

Implement [sprack Implementation Prep](../proposals/2026-03-21-sprack-implementation-prep.md).
The proposal adds Rust toolchain, tmux, sqlite3, and a Cargo workspace scaffold to the lace devcontainer.

## Work Log

### Phase 1: Devcontainer Changes

**Dockerfile additions:**
- `tmux`, `sqlite3`, `libsqlite3-dev`, `pkg-config` added to apt-get block.

**devcontainer.json additions:**
- `ghcr.io/devcontainers/features/rust:1` added to `prebuildFeatures`.

### Phase 2: Cargo Workspace Scaffold

Created `packages/sprack/` with workspace Cargo.toml and four crates:
- `sprack-db`: shared SQLite library
- `sprack-poll`: tmux polling daemon
- `sprack`: main TUI binary
- `sprack-claude`: claude integration

Each crate has minimal scaffolding with a hello-world test.

### Phase 3: pnpm Coexistence

Updated `pnpm-workspace.yaml` to exclude `packages/sprack`.

### Phase 4: Container Rebuild and Verification

TODO(opus/sprack-impl-prep): Rebuild container with `lace-into --start --rebuild lace` and verify toolchain.

## Issues Encountered and Solved

TODO(opus/sprack-impl-prep): Document issues during rebuild/verification.

## Verification Record

TODO(opus/sprack-impl-prep): Record verification results from inside the container.
