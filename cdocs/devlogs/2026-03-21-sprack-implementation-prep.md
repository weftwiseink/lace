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

> BLUF: Implementation complete and verified.
> Rust toolchain, tmux, sqlite3, and Cargo workspace scaffold are working in the lace devcontainer.
> One issue found and fixed: the Rust devcontainer feature's `rustlang` group membership was not applied to the `node` user due to prebuild user resolution.
> One known issue: `lace up --rebuild` does not allocate SSH ports (pre-existing lace bug).

## Objective

Implement [sprack Implementation Prep](../proposals/2026-03-21-sprack-implementation-prep.md).
The proposal adds Rust toolchain, tmux, sqlite3, and a Cargo workspace scaffold to the lace devcontainer.

## Work Log

### Phase 1: Devcontainer Changes

**Dockerfile additions:**
- `tmux`, `sqlite3`, `libsqlite3-dev`, `pkg-config` added to apt-get block.
- `usermod -aG rustlang ${USERNAME}` added before `USER` switch (see Issues below).

**devcontainer.json additions:**
- `ghcr.io/devcontainers/features/rust:1` with `version: "latest"` and `profile: "default"` added to `prebuildFeatures`.

### Phase 2: Cargo Workspace Scaffold

Created `packages/sprack/` with workspace Cargo.toml and four crates:
- `sprack-db`: shared SQLite library (with hello-world test)
- `sprack-poll`: tmux polling daemon
- `sprack`: main TUI binary
- `sprack-claude`: claude integration

Added `.cargo/config.toml` with `rustflags = ["-D", "warnings"]` per style guide.

### Phase 3: pnpm Coexistence

Updated `pnpm-workspace.yaml` to exclude `packages/sprack` via `!packages/sprack`.
Verified pnpm does not list sprack in `pnpm list --recursive`.

### Phase 4: Container Rebuild and Verification

Rebuilt container via `lace up --workspace-folder <path> --rebuild`.
Two rebuilds were necessary: first to discover the rustlang group issue, second to verify the fix.

## Issues Encountered and Solved

### Issue 1: rustlang group membership (FIXED)

**Symptom:** `cargo build` failed with `Permission denied (os error 13)` when writing to `/usr/local/cargo/registry/`.

**Root cause:** The Rust devcontainer feature installs to `/usr/local/cargo` with `root:rustlang` ownership and setgid.
It adds `_CONTAINER_USER` to the `rustlang` group, but `_CONTAINER_USER` is resolved from the prebuild image's USER, which is `root` (the base `node:24-bookworm` image has no USER set).
The actual container user (`node`) is only set via `USER node` in the main Dockerfile, which runs after prebuild features.

**Fix (applied):** Added `RUN usermod -aG rustlang ${USERNAME}` in the Dockerfile before the `USER ${USERNAME}` switch.
This ensures the container user has write access to the cargo registry.

**Proper fix (deferred):** The lace prebuild generator (`generateTempDevcontainerJson()` in `packages/lace/src/lib/devcontainer.ts`) should propagate `remoteUser` into the temp devcontainer.json.
The `extractRemoteUser()` function already exists and resolves the correct user.
This would cause the devcontainer CLI to set `_REMOTE_USER=node` during prebuild, and the Rust feature would add `node` to the `rustlang` group automatically.
The Dockerfile workaround can then be removed.

### Issue 2: SSH port not allocated on --rebuild (NOT FIXED, pre-existing)

**Symptom:** After `lace up --rebuild`, the container has no SSH port mapping.
`lace-discover` cannot find the container. sshd is running inside the container on port 2222, but no host port is bound.

**Root cause:** `lace up` reports "No port templates found, skipping port allocation."
The sshd feature's port templates are not being detected during the --rebuild flow.
This appears to be a pre-existing lace issue unrelated to the Rust feature addition.

> WARN(opus/sprack-impl-prep): This means `lace-into` cannot connect to the container after a `--rebuild`.
> The container is accessible via `docker exec` but not via SSH.
> This should be investigated separately.

## Verification Record

All verification performed inside the rebuilt container (container ID `05674a348465`) via `docker exec`.
No manual group workarounds applied: the Dockerfile fix resolves the permission issue at build time.

| Check | Result |
|-------|--------|
| `rustc --version` | rustc 1.94.0 (4a4ef493e 2026-03-02) |
| `cargo --version` | cargo 1.94.0 (85eff7c80 2026-01-15) |
| `cargo clippy --version` | clippy 0.1.94 |
| `rustfmt --version` | rustfmt 1.8.0-stable |
| `rust-analyzer --version` | rust-analyzer 1.94.0 |
| `tmux -V` | tmux 3.3a |
| `sqlite3 --version` | 3.40.1 |
| `id` (groups) | node rustlang |
| `cargo build` | PASS (all 4 crates) |
| `cargo test` | PASS (1 test in sprack-db) |
| `cargo clippy` | PASS (0 warnings) |
| `cargo fmt -- --check` | PASS |
| tmux smoke test | PASS (create/list/kill session) |
| pnpm coexistence | PASS (sprack not listed) |

### Proposal Test Plan Checklist

1. [x] Rust feature installs successfully (`rustc --version`, `cargo --version`)
2. [x] clippy and rustfmt available
3. [x] rust-analyzer on PATH
4. [x] tmux installed
5. [x] sqlite3 installed
6. [x] Cargo workspace builds
7. [x] Cargo workspace tests pass
8. [x] clippy passes
9. [x] rustfmt passes
10. [ ] cargo-insta installed: deferred to a postCreateCommand in a follow-up
11. [x] pnpm does not interfere with Cargo workspace
12. [x] tmux smoke test

> NOTE(opus/sprack-impl-prep): cargo-insta and cargo-watch (Tier 2 tools from the proposal) are not yet installed.
> They require `cargo install` which compiles from source and takes several minutes.
> The proposal suggests a postCreateCommand or script for these.
> This is deferred to avoid baking compile time into the Docker image build.
