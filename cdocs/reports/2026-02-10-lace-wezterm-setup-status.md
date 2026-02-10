---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T22:00:00-08:00
task_list: lace/wezterm-plugin
type: report
subtype: status
state: live
status: done
tags: [status, wezterm, devcontainer, lace, wez-into, discovery, ports, snapshot]
related_to:
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
  - cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md
  - cdocs/proposals/2026-02-10-wez-into-end-to-end-integration-testing.md
  - cdocs/proposals/2026-02-10-wez-into-workstream-closeout.md
  - cdocs/reports/2026-02-10-devcontainer-metadata-and-lace-registry.md
---

# Lace/WezTerm Devcontainer Setup Status

> **BLUF:** As of 2026-02-10, both the lace and dotfiles devcontainers are fully lacified and verified working end-to-end. The `wez-into` CLI connects to both projects with interactive picker, `--start` for cold-starting stopped containers, `--list`, `--status`, and `--dry-run` support. Port allocation uses the 22425-22499 range with asymmetric host-to-container mapping, and the wezterm-server feature v1.1.0 is published to GHCR with correct `hostSshPort` metadata. The nushell module was cancelled in favor of a bash-only approach.

## Working End-to-End

The following have been tested and verified on live containers:

- **`wez-into lace`** -- Connects to the lace devcontainer via `wezterm connect lace:22426`
- **`wez-into dotfiles`** -- Connects to the dotfiles devcontainer via its allocated port
- **`wez-into`** (no args) -- Interactive picker using fzf (with bash select fallback) showing all running lace devcontainers
- **`wez-into --start lace`** -- Cold-starts a stopped lace container using `lace up`, waits for SSH readiness, then connects
- **`wez-into --start`** (no args) -- Picker for stopped containers with Docker label-based workspace path detection
- **`wez-into --list`** -- Lists running project names
- **`wez-into --status`** -- Shows running projects with ports, users, and workspace paths
- **`wez-into --dry-run <project>`** -- Prints the `wezterm connect` command without executing
- **`lace-discover`** -- Finds running containers in the 22425-22499 port range via Docker labels
- **`lace-discover --json`** -- JSON output for programmatic consumption
- **lace.wezterm plugin picker** -- WezTerm-native project picker that registers SSH domains dynamically
- **Host key management** -- Dedicated `~/.ssh/lace_known_hosts` file shared between `wez-into` and the lace.wezterm plugin

## Architecture Summary

The system has four layers:

1. **Devcontainer features** -- The `wezterm-server` feature (GHCR) installs `wezterm-mux-server` and declares `hostSshPort` metadata. The `sshd` feature provides the SSH listener on container port 2222.

2. **Lace port pipeline** -- `lace up` reads `devcontainer.json`, resolves `${lace.port(...)}` templates from feature metadata, allocates ports from 22425-22499 per-project, writes resolved config to `.lace/devcontainer.json`, and passes it to `devcontainer up`.

3. **Discovery** -- `lace-discover` queries Docker for running containers with `devcontainer.local_folder` labels and port mappings in the lace range. For `--start`, Docker labels on stopped containers provide the `local_folder` (workspace path) needed to invoke `lace up`.

4. **Connection** -- `wez-into` (bash script in `lace/bin/`) calls `lace-discover`, maps project names to ports, and invokes `wezterm connect lace:PORT`. The `lace.wezterm` plugin does the same from within WezTerm's Lua config, registering SSH domains on-the-fly.

## Known Limitations

- **No cross-project port collision detection.** The port allocator is per-project (`.lace/port-assignments.json`). Two projects could theoretically allocate the same port. Runtime TCP probing mitigates this in practice.
- **`--start` requires `lace up` to be functional for the target project.** If a project's `devcontainer.json` is broken, `--start` will fail with the underlying `devcontainer up` error.
- **Host key regeneration on container rebuild.** Rebuilding a container changes its SSH host key. `wez-into` handles this automatically by stripping and re-adding the key in `~/.ssh/lace_known_hosts`, but manual WezTerm SSH connections will prompt.
- **No nushell module.** The planned nushell wrapper with tab completions was cancelled. `wez-into` is bash-only. Nushell users invoke it as an external command without completions.
- **`wezterm-server` feature owns SSH port metadata.** The `hostSshPort` option logically belongs to an sshd wrapper feature, not wezterm-server. This coupling is documented in the feature's `devcontainer-feature.json` as a TODO.
- **lace port range is fixed at 22425-22499.** Only 75 ports available. Sufficient for current use but would need expansion for large teams.

## Deferred Work

- **Nushell module for wez-into** -- Cancelled. Bash script covers all use cases. Tab completions would be nice but not worth the maintenance burden of a dual-language CLI.
- **wez-into as a standalone distributable** -- Analysis complete (see packaging analysis report), but not pursued. The script lives in `lace/bin/` and is added to PATH via nushell `env.nu`. No chezmoi packaging needed.
- **Symmetric prebuild port binding** -- Investigated and rejected. Asymmetric mapping (host port in lace range, container port at 2222) is simpler and avoids sshd reconfiguration complexity.
- **Global lace registry** -- Investigated and rejected. Docker itself is the registry -- container labels provide all the metadata needed for discovery and `--start`.
- **sshd wrapper feature** -- Decoupling SSH port metadata from wezterm-server into a dedicated feature. Low priority since current approach works.

## Component Inventory

| Component | Location | Version/State |
|-----------|----------|---------------|
| `wez-into` | `lace/bin/wez-into` | Bash script, feature-complete |
| `lace-discover` | `lace/bin/lace-discover` | Bash script, feature-complete |
| `lace.wezterm` plugin | `/home/mjr/code/weft/lace.wezterm/plugin/init.lua` | WezTerm Lua plugin, handles SSH domains + picker + host keys |
| `wezterm-server` feature | `lace/devcontainers/features/src/wezterm-server/` | v1.1.0, published to `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` |
| Lace devcontainer config | `lace/.devcontainer/devcontainer.json` | Lacified, port 22426:2222, prebuild split |
| Lace resolved config | `lace/.lace/devcontainer.json` | Generated by `lace up`, port 22426 resolved |
| Lace port assignments | `lace/.lace/port-assignments.json` | `wezterm-server/hostSshPort` -> 22426 |
| Dotfiles devcontainer | `dotfiles/.devcontainer/devcontainer.json` | Lacified, port in 22425-22499 range |
| Lace CLI (`lace up`) | `lace/packages/lace/` | TypeScript, handles template resolution + port allocation |
| Host SSH key | `~/.ssh/lace_devcontainer` | Ed25519 keypair, shared across all lace containers |
| Known hosts | `~/.ssh/lace_known_hosts` | Dedicated file for lace container host keys |
