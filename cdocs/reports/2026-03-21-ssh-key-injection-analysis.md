---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:35:00-07:00
task_list: session-management/ssh-key-injection
type: report
state: archived
status: done
tags: [lace-into, ssh, lace-sshd, authorized-keys]
---

# Missing SSH Key Injection with lace-sshd Feature

> BLUF: The migration from `wezterm-server` to `lace-sshd` dropped the `authorized_keys` bind mount declaration.
> The result: `lace-into` prompts for a password instead of using key-based auth, because no mechanism places the host's public key inside the container.
> The fix is to add a `customizations.lace.mounts` block to the `lace-sshd` feature metadata, mirroring what `wezterm-server` declared.
> This preserves the mount-resolver's auto-resolution capability and keeps the SSH concern self-contained within the feature.

## Problem Description

When connecting to a lace devcontainer via `lace-into`, SSH prompts for a password instead of authenticating with the ed25519 key at `~/.config/lace/ssh/id_ed25519`.

The host-side key exists:
- Private: `~/.config/lace/ssh/id_ed25519`
- Public: `~/.config/lace/ssh/id_ed25519.pub`

The container has the `.ssh` directory prepared by the Dockerfile (`.devcontainer/Dockerfile` lines 64-69):
```dockerfile
RUN mkdir -p /home/${USERNAME}/.ssh && \
    chmod 700 /home/${USERNAME}/.ssh && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/.ssh
```

`lace-into` configures SSH to use the lace key exclusively (`bin/lace-into` line 25):
```bash
LACE_SSH_KEY="$HOME/.config/lace/ssh/id_ed25519"
```

The missing link: nothing bind-mounts `id_ed25519.pub` to `/home/node/.ssh/authorized_keys` inside the container.
The sshd daemon has no authorized keys to match against, so it falls back to password authentication.

## Root Cause

The lace devcontainer migrated from the `wezterm-server` feature to the `lace-sshd` feature.
The `wezterm-server` feature declared an `authorized-keys` mount in its `customizations.lace.mounts` metadata.
The `lace-sshd` feature is metadata-only for port declarations and declares no mounts at all.

### What the Old System Did

The `wezterm-server` feature (previously at `devcontainers/features/src/wezterm-server/`) declared both ports and mounts in `customizations.lace`:

```json
"customizations": {
  "lace": {
    "ports": {
      "hostSshPort": { "label": "wezterm ssh", "onAutoForward": "silent", "requireLocalPort": true }
    },
    "mounts": {
      "authorized-keys": {
        "target": "/home/${_REMOTE_USER}/.ssh/authorized_keys",
        "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
        "description": "SSH public key for WezTerm SSH domain access",
        "readonly": true,
        "sourceMustBe": "file",
        "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N ''"
      }
    }
  }
}
```

During `lace up`, the mount-resolver pipeline would:
1. Extract the feature's `customizations.lace.mounts` declaration.
2. Namespace it as `wezterm-server/authorized-keys`.
3. Auto-inject `${lace.mount(wezterm-server/authorized-keys)}` into the `mounts` array.
4. Resolve the source path via settings override or `recommendedSource`.
5. Validate via `sourceMustBe: "file"` that the `.pub` file exists on the host.
6. Emit the resolved bind mount string into `.lace/devcontainer.json`.

### What the New System is Missing

The `lace-sshd` feature (`.devcontainer/features/lace-sshd/devcontainer-feature.json`) declares only port metadata:

```json
"customizations": {
  "lace": {
    "ports": {
      "sshPort": {
        "label": "sshd",
        "onAutoForward": "silent",
        "requireLocalPort": true
      }
    }
  }
}
```

No `mounts` block exists.
The source `devcontainer.json` (`.devcontainer/devcontainer.json`) has `customizations.lace.mounts` for `bash-history`, `claude-config`, and `claude-config-json`, but no entry for SSH authorized keys.
The generated `.lace/devcontainer.json` consequently has no `authorized_keys` bind mount.

### Evidence in Generated Config

The current `.lace/devcontainer.json` mounts array contains:
```json
"mounts": [
  "source=/home/mjr/.config/lace/lace/mounts/project/bash-history,target=/commandhistory,type=bind",
  "source=/home/mjr/.claude,target=/home/node/.claude,type=bind",
  "source=/home/mjr/.claude.json,target=/home/node/.claude/.claude.json,type=bind",
  "type=bind,source=/home/mjr/code/weft/clauthier/main,target=/var/home/mjr/code/weft/clauthier/main,readonly",
  "type=bind,source=/home/mjr/code/personal/dotfiles,target=/mnt/lace/repos/dotfiles"
]
```

No SSH key mount is present.

## Fix Options

### Option A: Add Mount Declaration to lace-sshd Feature Metadata

Add a `mounts` block to `.devcontainer/features/lace-sshd/devcontainer-feature.json`:

```json
{
  "customizations": {
    "lace": {
      "ports": { ... },
      "mounts": {
        "authorized-keys": {
          "target": "/home/${_REMOTE_USER}/.ssh/authorized_keys",
          "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
          "description": "SSH public key for lace SSH access",
          "readonly": true,
          "sourceMustBe": "file",
          "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N ''"
        }
      }
    }
  }
}
```

This approach:
- Keeps the SSH key concern self-contained within the feature that requires it.
- The mount-resolver auto-resolves the source from `recommendedSource` or a `settings.json` override.
- The namespace becomes `lace-sshd/authorized-keys`, configurable via `settings.json`:
  ```json
  { "mounts": { "lace-sshd/authorized-keys": { "source": "~/.ssh/my_custom_key.pub" } } }
  ```
- `sourceMustBe: "file"` validates that the key exists before attempting the mount.
- No changes to the source `devcontainer.json` are needed.
- Consistent with how the `neovim` feature declares its plugin mount.

**Recommendation: this is the correct fix.**
It mirrors the old `wezterm-server` pattern, uses the existing mount-resolver infrastructure, and requires no changes to the lace core.

### Option B: Add Mount to devcontainer.json customizations.lace.mounts

Add an `authorized-keys` entry to `.devcontainer/devcontainer.json` under `customizations.lace.mounts`:

```json
"mounts": {
  "bash-history": { ... },
  "claude-config": { ... },
  "claude-config-json": { ... },
  "authorized-keys": {
    "target": "/home/node/.ssh/authorized_keys",
    "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
    "sourceMustBe": "file",
    "readonly": true,
    "description": "SSH public key for lace SSH access",
    "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N ''"
  }
}
```

This approach:
- Works with the mount-resolver (namespace becomes `project/authorized-keys`).
- Places an SSH concern in the project config rather than the feature that needs it.
- Forces every project using `lace-sshd` to independently declare the mount.
- Hardcodes `/home/node` instead of using `${_REMOTE_USER}`.

**Not recommended.** The mount logically belongs to the feature, not the project.

### Option C: Add Static Mount String to devcontainer.json mounts Array

Add a raw Docker mount string to the `mounts` array in `.devcontainer/devcontainer.json`:

```json
"mounts": [
  "source=${localEnv:HOME}/.config/lace/ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
]
```

This approach:
- Quick hack that works immediately.
- Bypasses the mount-resolver entirely: no `sourceMustBe` validation, no settings override, no guidance output.
- Hardcodes the key path and user.
- Not configurable per-user via `settings.json`.

**Not recommended.** This is a regression in capability from the old system.

## Mount-Resolver Auto-Resolution Capability

Only Options A and B preserve mount-resolver auto-resolution.
Option A is preferred because it:

1. Runs `sourceMustBe: "file"` validation, failing `lace up` early with a clear hint if the key is missing.
2. Supports `settings.json` overrides for users with non-default key locations.
3. Emits guidance during `lace up` showing where the key was resolved from.
4. Uses `${_REMOTE_USER}` for the target path, adapting to the container user.

The mount-resolver already has full support for file-type mounts via `sourceMustBe: "file"`.
The test suite exercises this path extensively (see `mount-resolver.test.ts` lines 622-660 and `up-mount.integration.test.ts` lines 770-1040).
No changes to mount-resolver code are needed.

## Impact on Other Projects

### Dotfiles Devcontainer

The dotfiles devcontainer (`~/code/personal/dotfiles/.lace/devcontainer.json`) still uses the old `wezterm-server` feature and has static authorized-keys mounts as a workaround:

```json
"mounts": [
  "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/vscode/.ssh/authorized_keys,type=bind,readonly",
  "source=/home/mjr/.config/lace/ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
]
```

> NOTE(opus/ssh-key-injection): The dotfiles devcontainer has two redundant mount entries targeting different users (`vscode` and `node`), indicating uncertainty about which user the container runs as.
> Once it migrates from `wezterm-server` to `lace-sshd`, the feature-level mount declaration with `${_REMOTE_USER}` would replace both entries.

### Other lace-sshd Consumers

Any project that currently uses `lace-sshd` (or migrates to it in the future) would automatically get the authorized-keys mount if Option A is implemented.
No per-project configuration is needed beyond including the feature.

## Summary

| Aspect | Old (`wezterm-server`) | Current (`lace-sshd`) | Fix (Option A) |
|--------|----------------------|----------------------|----------------|
| Mount declaration | Feature metadata | Missing | Feature metadata |
| Namespace | `wezterm-server/authorized-keys` | N/A | `lace-sshd/authorized-keys` |
| Source validation | `sourceMustBe: "file"` | None | `sourceMustBe: "file"` |
| Settings override | Supported | N/A | Supported |
| User path | Hardcoded `/home/node` | N/A | `${_REMOTE_USER}` |
| SSH auth result | Key-based | Password prompt | Key-based |
