---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-21T22:50:00-07:00
task_list: session-management/ssh-key-injection
type: proposal
state: live
status: wip
tags: [lace-into, ssh, lace-sshd, authorized-keys]
---

# Fix Missing SSH Key Injection for lace-sshd

> BLUF: The `lace-sshd` feature is missing the `customizations.lace.mounts` declaration for `authorized_keys` that the old `wezterm-server` feature provided.
> This causes `lace-into` to prompt for a password instead of using key-based auth.
> The fix is a single metadata addition to `devcontainer-feature.json`: no code changes to lace core are needed.
> The mount-resolver pipeline already supports feature-level mount declarations with `sourceMustBe: "file"` validation.
> See `cdocs/reports/2026-03-21-ssh-key-injection-analysis.md` for the full root-cause analysis.

## Problem Statement

When connecting to a lace devcontainer via `lace-into`, SSH falls back to password authentication because the container has no `authorized_keys` file.
The host-side key pair exists at `~/.config/lace/ssh/id_ed25519{,.pub}`, and `lace-into` passes the private key via `-i`.
The missing piece: no bind mount injects the `.pub` file into the container's `~/.ssh/authorized_keys`.

The root cause is that the migration from `wezterm-server` to `lace-sshd` dropped the `mounts` block from the feature metadata.
The analysis report covers the full chain: `cdocs/reports/2026-03-21-ssh-key-injection-analysis.md`.

## Proposed Solution

Add a `mounts` block to the `lace-sshd` feature's `customizations.lace` metadata, mirroring the declaration the old `wezterm-server` feature provided.

This approach:
- Keeps the SSH key concern self-contained within the feature that requires it.
- Uses the existing mount-resolver pipeline with no code changes.
- Produces the namespace `lace-sshd/authorized-keys`, configurable via `settings.json`.
- Validates key existence at `lace up` time via `sourceMustBe: "file"`, with a clear hint if the key is missing.
- Uses `${_REMOTE_USER}` for the target path, adapting to the container's configured user.

### How the Pipeline Works

The mount-resolver already handles feature-level mount declarations end-to-end:

1. `buildMountDeclarationsMap()` in `template-resolver.ts` iterates feature metadata, calls `extractLaceCustomizations()`, and namespaces each mount as `<featureShortId>/<mountName>`.
2. `extractLaceCustomizations()` in `feature-metadata.ts` parses and validates the `customizations.lace.mounts` block via `parseMountDeclarationEntry()`.
3. `MountPathResolver.resolveValidatedSource()` in `mount-resolver.ts` resolves the source from a settings override or `recommendedSource`, then validates via `statSync()` that the path exists and is the correct type.
4. `resolveFullSpec()` emits the complete Docker mount string into the generated `.lace/devcontainer.json`.

No changes to any of these modules are required.

## Exact JSON Change

Both copies of the feature metadata must be updated identically:
- `.devcontainer/features/lace-sshd/devcontainer-feature.json` (source)
- `.lace/prebuild/features/lace-sshd/devcontainer-feature.json` (prebuild copy)

> NOTE(opus/ssh-key-injection): Both files are currently identical. The prebuild copy exists so that `lace up` can read feature metadata without needing to fetch from a registry. Both must declare the mount.

Add the `mounts` key as a sibling to `ports` inside `customizations.lace`:

```json
{
    "name": "Lace SSH Port Metadata",
    "id": "lace-sshd",
    "version": "0.1.0",
    "description": "Declares lace port metadata for the sshd feature. No-op install: the actual SSH daemon is installed by ghcr.io/devcontainers/features/sshd. This feature exists solely to provide customizations.lace.ports so lace can auto-allocate and inject SSH port bindings.",
    "options": {
        "sshPort": {
            "type": "string",
            "default": "2222",
            "description": "Container-side SSH port (must match sshd feature default). Used by lace for asymmetric appPort injection: the host-side port is auto-allocated from the lace range (22425-22499), mapped to this container port."
        }
    },
    "customizations": {
        "lace": {
            "ports": {
                "sshPort": {
                    "label": "sshd",
                    "onAutoForward": "silent",
                    "requireLocalPort": true
                }
            },
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
    },
    "installsAfter": [
        "ghcr.io/devcontainers/features/sshd"
    ]
}
```

The diff is the addition of the `"mounts"` key and its contents.

## Implementation Phases

### Phase 1: Add mounts declaration to feature metadata

Edit `.devcontainer/features/lace-sshd/devcontainer-feature.json` and `.lace/prebuild/features/lace-sshd/devcontainer-feature.json` to include the `mounts` block shown above.

### Phase 2: Rebuild and verify generated config

Run `lace up --rebuild` to regenerate `.lace/devcontainer.json`.
Verify the output contains a mount entry with `target=/home/node/.ssh/authorized_keys` (or the appropriate `remoteUser`).
The mount string should follow the pattern:

```
source=/home/mjr/.config/lace/ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly
```

### Phase 3: Test coverage

The mount-resolver test suite already exercises the `sourceMustBe: "file"` validation path extensively (`mount-resolver.test.ts` lines 622-660, `up-mount.integration.test.ts` lines 770-1040).
The `buildMountDeclarationsMap()` function in `template-resolver.ts` is tested for feature-level mount extraction in `template-resolver.test.ts`.

Review whether existing tests cover the `lace-sshd` namespace specifically, or whether they use generic feature IDs.
If tests use generic IDs (e.g., `test-feature/some-mount`), no new tests are needed: the mount-resolver is namespace-agnostic.
If tests reference `wezterm-server/authorized-keys` by name, add parallel coverage for `lace-sshd/authorized-keys`.

## Verification Plan

1. **Generated config check**: After `lace up --rebuild`, inspect `.lace/devcontainer.json` for the authorized_keys bind mount entry.
2. **SSH connection test**: Run `lace-into` and verify key-based authentication succeeds without a password prompt.
3. **Missing key error**: Temporarily rename `~/.config/lace/ssh/id_ed25519.pub` and run `lace up`. Verify the mount-resolver emits the hint message and fails with a clear error.
4. **Settings override**: Add a `settings.json` override for `lace-sshd/authorized-keys` with an alternate key path and verify it resolves correctly.

## Impact on Dotfiles Devcontainer

The dotfiles devcontainer (`~/code/personal/dotfiles/`) currently uses the old `wezterm-server` feature and has two static `authorized_keys` mount entries as a workaround, targeting both `/home/vscode` and `/home/node` due to user uncertainty.

Once `lace-sshd` has the mount declaration with `${_REMOTE_USER}`:
- The dotfiles devcontainer can migrate from `wezterm-server` to `lace-sshd`.
- Both static mount entries can be removed.
- The `${_REMOTE_USER}` variable eliminates the need to guess the container user.

This migration is out of scope for this proposal but becomes unblocked by it.
