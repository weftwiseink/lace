---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T16:00:00-08:00
task_list: lace/packages-lace-cli
type: proposal
state: live
status: request_for_proposal
tags: [ssh, security, lace-cli, devcontainer, automation, key-management]
---

# Secure SSH Key Auto-Management for Lace CLI

> BLUF(opus/lace-cli): The lace CLI should automatically generate, rotate, and manage SSH key pairs for devcontainer SSH domain connections, eliminating manual `ssh-keygen` steps and reducing the risk of stale or overly-permissive keys.
>
> - **Motivated by:** `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md` (wezterm SSH multiplexing requires SSH keys mounted into the container)

## Objective

The current wezterm SSH domain setup requires users to manually generate an ed25519 key pair (`ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""`), mount the public key into the container as `authorized_keys`, and configure their host wezterm to use the private key.
This is error-prone (wrong permissions, forgotten key generation, stale keys) and has no rotation or scope-limiting mechanism.

The lace CLI should provide a `lace ssh` (or similar) subcommand that automates key lifecycle management for devcontainer SSH domain connections.

## Scope

The full proposal should explore:

- **Key generation**: Automatic creation of project-scoped or container-scoped ed25519 key pairs on first `lace prebuild` or `lace up` invocation.
- **Key storage**: Where keys live on the host (`~/.ssh/lace/`, `~/.config/lace/ssh/`, or project-local `.lace/ssh/`). Tradeoffs between per-project and shared keys.
- **Mount injection**: Whether lace should auto-add the `authorized_keys` mount to devcontainer.json (via `customizations.lace`) or document it as a manual step.
- **Key rotation**: Automatic rotation policy (per-rebuild, time-based, manual). How to invalidate old keys without breaking active sessions.
- **Host SSH config**: Whether lace should generate or update `~/.ssh/config` entries for container access (e.g., `Host lace-dev` stanzas).
- **Wezterm config integration**: Whether lace should generate wezterm SSH domain configuration snippets.
- **Security model**: Passphrase-less keys (current approach) vs. ssh-agent integration. Scope limitation (keys only valid for the specific container/port).
- **Multi-container support**: How key management works when multiple devcontainers run concurrently on different ports.

## Open Questions

1. Should keys be per-project or per-user? Per-project is more isolated but requires key management per repo. Per-user is simpler but a compromised key exposes all containers.
2. Should lace manage host `~/.ssh/config` entries, or is that too invasive for a devcontainer tool?
3. How does this interact with the `sshd` devcontainer feature's own key management?
4. Should key generation happen at `lace prebuild` time or at container start time?
5. Is there value in supporting `ssh-agent` forwarding as an alternative to mounted keys?

## Prior Art

- The devcontainer `sshd` feature (`ghcr.io/devcontainers/features/sshd:1`) handles sshd daemon setup but not client-side key management.
- VS Code Remote-SSH manages its own SSH connections but uses a different transport than wezterm SSH domains.
- The current manual setup is documented in the `devcontainer.json` mount comments: `ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""`.
