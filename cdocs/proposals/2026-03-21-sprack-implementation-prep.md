---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T22:00:00-07:00
task_list: terminal-management/sprack-tui
type: proposal
state: live
status: implementation_wip
tags: [sprack, devcontainer, rust, tooling, implementation_prep]
---

# sprack Implementation Prep: Devcontainer Rust Toolchain

> BLUF: The lace devcontainer has no Rust toolchain, no tmux, and no sqlite3.
> This proposal adds them via a new devcontainer feature (`rust-dev`) and Dockerfile additions, creating a development environment sufficient for sprack Phase A (foundation) through Phase C (claude integration).
> It also scaffolds the Cargo workspace at `packages/sprack/` and validates the toolchain with a minimal build+test cycle.

## Current State

The lace devcontainer (`lace.local/node:24-bookworm`) is Node.js-oriented:

| Tool | Status |
|------|--------|
| Node.js 24 | Installed |
| pnpm | Installed |
| neovim | Installed (feature) |
| nushell | Installed (feature) |
| git | Installed (feature) |
| sshd | Installed (feature) |
| claude-code | Installed (feature) |
| **Rust toolchain** | **Missing** |
| **tmux** | **Missing** |
| **sqlite3** | **Missing** |
| **cargo-insta** | **Missing** |
| **VHS** | **Missing** |

## What Needs to Be Added

### Tier 1: Required for Phase A

| Tool | Purpose | Installation Method |
|------|---------|-------------------|
| `rustup` + `rustc` + `cargo` | Rust toolchain | Devcontainer feature: `ghcr.io/devcontainers/features/rust:1` |
| `clippy` | Lint enforcement | Included with rustup (component) |
| `rustfmt` | Code formatting | Included with rustup (component) |
| `rust-analyzer` | LSP for neovim/editor | Rustup component or standalone binary |
| `tmux` | Runtime dependency for sprack-poll | `apt-get install tmux` in Dockerfile |
| `sqlite3` | CLI debugging of sprack DB | `apt-get install sqlite3` in Dockerfile |

### Tier 2: Required for Phase B

| Tool | Purpose | Installation Method |
|------|---------|-------------------|
| `cargo-insta` | Snapshot test review (`cargo insta review`) | `cargo install cargo-insta` |
| `cargo-watch` | Auto-rebuild on save (`cargo watch -x test`) | `cargo install cargo-watch` |

### Tier 3: Nice-to-have for Phase B/C

| Tool | Purpose | Installation Method |
|------|---------|-------------------|
| VHS (`vhs`) | Terminal recording for visual regression | Go binary from charmbracelet, or `apt` |
| `cargo-nextest` | Faster test runner with better output | `cargo install cargo-nextest` |

## Implementation Plan

### Step 1: Add Rust devcontainer feature

Add to `.devcontainer/devcontainer.json` under `customizations.lace.prebuildFeatures`:

```jsonc
"ghcr.io/devcontainers/features/rust:1": {
    "version": "latest",
    "profile": "default"  // includes rustfmt, clippy
}
```

This is the standard devcontainer community feature for Rust.
It installs `rustup`, `rustc`, `cargo`, `clippy`, `rustfmt`, and adds them to PATH.

### Step 2: Add system dependencies to Dockerfile

Add to the existing `apt-get install` block:

```dockerfile
RUN apt-get update && apt-get install -y \
    curl \
    psmisc \
    sudo \
    tmux \
    sqlite3 \
    libsqlite3-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*
```

`libsqlite3-dev` and `pkg-config` are needed if using rusqlite without the `bundled` feature.
With `bundled` (our plan), they are optional but useful for system `sqlite3` CLI to match the bundled version's behavior.

> NOTE(opus/sprack-impl-prep): tmux is installed here rather than as a devcontainer feature because there is no standard tmux feature, and it is a single `apt-get` line.

### Step 3: Add rust-analyzer

rust-analyzer can be added as a rustup component:

```jsonc
// In the rust feature config
"ghcr.io/devcontainers/features/rust:1": {
    "version": "latest",
    "profile": "default"
}
```

Then in a postCreateCommand or the Dockerfile:
```bash
rustup component add rust-analyzer
```

> NOTE(opus/sprack-impl-prep): neovim integration with rust-analyzer depends on the user's neovim config (likely via `nvim-lspconfig`).
> This proposal does not configure neovim LSP, only ensures the binary is on PATH.

### Step 4: Install cargo tools (postCreateCommand)

Cargo tools should be installed in a lifecycle hook, not the Dockerfile, because they depend on the Rust toolchain feature being installed first:

```jsonc
// In devcontainer.json, add to postCreateCommand (or a dedicated script)
"postCreateCommand": "cargo install cargo-insta cargo-watch"
```

Alternatively, add a `scripts/setup-rust-tools.sh`:
```bash
#!/bin/bash
set -euo pipefail
cargo install cargo-insta cargo-watch
# Optional: cargo install cargo-nextest
```

> WARN(opus/sprack-impl-prep): `cargo install` compiles from source.
> First-time setup for cargo-insta + cargo-watch takes ~2-3 minutes.
> These should be cached in a Docker layer if possible.

### Step 5: Scaffold Cargo workspace

Create the workspace structure:

```
packages/sprack/
  Cargo.toml              # workspace definition
  crates/
    sprack-db/
      Cargo.toml
      src/
        lib.rs
    sprack-poll/
      Cargo.toml
      src/
        main.rs
    sprack/
      Cargo.toml
      src/
        main.rs
    sprack-claude/
      Cargo.toml
      src/
        main.rs
```

Workspace `Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = [
    "crates/sprack-db",
    "crates/sprack-poll",
    "crates/sprack",
    "crates/sprack-claude",
]

[workspace.dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
thiserror = "2"
anyhow = "1"
ratatui = "0.29"
crossterm = "0.28"
tui-tree-widget = "0.22"
signal-hook = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
catppuccin = { version = "3", features = ["ratatui"] }
insta = "1"
```

Each crate's `Cargo.toml` references workspace dependencies:
```toml
[dependencies]
rusqlite = { workspace = true }
thiserror = { workspace = true }
```

### Step 6: Validate with minimal build+test

Create a minimal `sprack-db/src/lib.rs`:
```rust
/// sprack-db: shared SQLite library for the sprack ecosystem.
pub fn hello() -> &'static str {
    "sprack-db"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello() {
        assert_eq!(hello(), "sprack-db");
    }
}
```

Validation commands:
```bash
cd packages/sprack
cargo build          # compiles all workspace members
cargo test           # runs all workspace tests
cargo clippy         # lint check
cargo fmt -- --check # format check
```

Exit criteria: all four commands pass.

### Step 7: Validate tmux + sqlite3

```bash
tmux -V              # should print tmux version
sqlite3 --version    # should print sqlite3 version

# Integration smoke test
tmux new-session -d -s test-session
tmux list-panes -a -F "#{session_name}:#{window_index}:#{pane_id}"
tmux kill-session -t test-session
```

## Changes to Existing Files

| File | Change |
|------|--------|
| `.devcontainer/devcontainer.json` | Add Rust feature to `prebuildFeatures` |
| `.devcontainer/Dockerfile` | Add `tmux`, `sqlite3`, `libsqlite3-dev`, `pkg-config` to apt-get |
| `packages/sprack/` (new) | Cargo workspace scaffold |

## pnpm Workspace Coexistence

The lace repo is a pnpm workspace (`pnpm-workspace.yaml`).
The Cargo workspace at `packages/sprack/` coexists naturally: pnpm ignores non-JS packages, and Cargo ignores non-Rust packages.

Verify that pnpm does not try to process sprack:
```bash
# pnpm should not list sprack
pnpm list --recursive --depth 0
```

If pnpm picks up sprack, exclude it in `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - '!packages/sprack'
```

## clippy and rustfmt Configuration

No custom `rustfmt.toml` is needed: the defaults (100-char line width, standard formatting) are correct.

For clippy, add a workspace-level config in `packages/sprack/.cargo/config.toml`:
```toml
[build]
rustflags = ["-D", "warnings"]
```

This treats clippy warnings as errors, enforcing the [style guide](../reports/2026-03-21-sprack-rust-style-guide.md).

## Test Plan

1. [ ] Rust feature installs successfully (`rustc --version`, `cargo --version`)
2. [ ] clippy and rustfmt available (`cargo clippy --version`, `rustfmt --version`)
3. [ ] rust-analyzer on PATH (`rust-analyzer --version`)
4. [ ] tmux installed (`tmux -V`)
5. [ ] sqlite3 installed (`sqlite3 --version`)
6. [ ] Cargo workspace builds (`cd packages/sprack && cargo build`)
7. [ ] Cargo workspace tests pass (`cargo test`)
8. [ ] clippy passes (`cargo clippy`)
9. [ ] rustfmt passes (`cargo fmt -- --check`)
10. [ ] cargo-insta installed (`cargo insta --version`)
11. [ ] pnpm does not interfere with Cargo workspace
12. [ ] tmux smoke test (create session, list panes, kill session)

## Related Documents

| Document | Relationship |
|----------|-------------|
| [Implementation Roadmap](2026-03-21-sprack-design-refinements.md) | Parent: sequencing, Phase A is first consumer |
| [sprack-db](2026-03-21-sprack-db.md) | First crate to implement after scaffold |
| [sprack-poll](2026-03-21-sprack-poll.md) | Needs tmux on PATH |
| [Rust Style Guide](../reports/2026-03-21-sprack-rust-style-guide.md) | Code conventions for the workspace |
| [Testing Report](../reports/2026-03-21-ratatui-testing-and-verification.md) | cargo-insta usage patterns |
