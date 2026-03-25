---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-22T00:00:00-07:00
task_list: session-management/lace-sshd-evolution
type: proposal
state: deferred
status: evolved
tags: [lace-sshd, devcontainer-features, ghcr, architecture]
---

# Evolve lace-sshd from Local Stop-Gap to Published Feature

> NOTE(opus/usefun-real): This proposal has been subsumed by `lace-fundamentals`.
> The `lace-fundamentals` feature consolidates SSH hardening, git identity, chezmoi, shell config, and staples into a single published feature, replacing the need for a standalone `lace-sshd` feature.
> See `cdocs/proposals/2026-03-24-lace-fundamentals-feature.md`.

> BLUF: The current `lace-sshd` feature is a local, metadata-only stop-gap that declares port and mount metadata but has a no-op `install.sh`.
> This proposal designs a fully published version at `ghcr.io/weftwiseink/devcontainer-features/lace-sshd` that wraps the upstream `sshd` feature, hardens the SSH configuration, and declares both port and mount metadata for lace auto-resolution.
> The published feature replaces the local feature with a one-line reference change in any project's `devcontainer.json`.
> The existing CI workflow (`.github/workflows/devcontainer-features-release.yaml`) handles publishing with zero new infrastructure.

## Problem Statement

The `lace-sshd` feature at `.devcontainer/features/lace-sshd/` is a local feature that serves two purposes:

1. Declares `customizations.lace.ports` so lace auto-allocates an SSH host port from the lace range (22425-22499).
2. Declares `customizations.lace.mounts` so lace auto-injects the `authorized_keys` bind mount.

It has no `install.sh` logic: the actual sshd daemon is installed by the upstream `ghcr.io/devcontainers/features/sshd:1`, which must be declared separately.
The feature exists only because lace needs metadata on a feature reference to auto-resolve ports and mounts.

This creates three problems:

1. **Not reusable**: every project must vendor a copy of the local feature directory (two files, ~40 lines of JSON) and keep it synchronized.
2. **No SSH hardening**: the upstream sshd feature installs a permissive default configuration. Password authentication, root login, and other unnecessary access vectors are left enabled.
3. **Two feature declarations required**: consumers must declare both `ghcr.io/devcontainers/features/sshd:1` and `./features/lace-sshd` in their config, understanding the ordering dependency between them.

The old `wezterm-server` feature (published to `ghcr.io/weft/devcontainer-features/wezterm-server`) solved all three problems for its use case.
It was a single published feature that installed wezterm, configured sshd, declared lace metadata, and was reusable across projects.
When `lace-sshd` replaced `wezterm-server`, the architectural regression was intentional (minimal-viable migration), but the gap should be closed.

## Proposed Design

### Feature Identity

- **ID**: `lace-sshd`
- **Registry**: `ghcr.io/weftwiseink/devcontainer-features/lace-sshd`
- **Source**: `devcontainers/features/src/lace-sshd/`
- **Version**: `1.0.0`

### Feature Metadata (`devcontainer-feature.json`)

```json
{
    "id": "lace-sshd",
    "version": "1.0.0",
    "name": "Lace SSH Daemon",
    "description": "Wraps the upstream sshd feature with SSH hardening and lace metadata for automatic port allocation and authorized_keys injection.",
    "documentationURL": "https://github.com/weftwiseink/lace/tree/main/devcontainers/features/src/lace-sshd",
    "licenseURL": "https://github.com/weftwiseink/lace/blob/main/LICENSE",
    "options": {
        "sshPort": {
            "type": "string",
            "default": "2222",
            "description": "Container-side SSH port. Must match the sshd feature's port. Lace maps this asymmetrically: the host-side port is auto-allocated from the lace range (22425-22499)."
        }
    },
    "dependsOn": {
        "ghcr.io/devcontainers/features/sshd:1": {}
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
    }
}
```

Key design decisions:

- **`dependsOn` replaces `installsAfter`**: the current local feature uses `installsAfter` to ensure ordering. The published feature uses `dependsOn`, which both orders installation and declares the upstream sshd feature as a dependency. Consumers no longer need to declare `ghcr.io/devcontainers/features/sshd:1` separately: the devcontainer CLI installs it automatically.

> NOTE(opus/lace-sshd-evolution): The devcontainer spec distinguishes `dependsOn` (auto-install + order) from `installsAfter` (order only).
> Using `dependsOn` is the correct choice here because `lace-sshd` is meaningless without the upstream sshd feature.
> This matches the pattern used by `portless` (depends on `node:1`) and `claude-code` (depends on `node:1`).

- **Port and mount metadata are unchanged**: the `customizations.lace` block is identical to the current local feature (after the authorized-keys mount was added in the SSH key injection fix).
- **`sshPort` option retained**: this option exists so lace can read the container-side port value from feature metadata. The install script also uses it to validate that the sshd config matches.

### Install Script (`install.sh`)

The install script performs SSH hardening after the upstream sshd feature has installed OpenSSH:

```sh
#!/bin/sh
set -eu

SSH_PORT="${SSHPORT:-2222}"

echo "lace-sshd: Hardening SSH configuration..."

SSHD_CONFIG="/etc/ssh/sshd_config"

# Validate that sshd was installed by the upstream feature
if [ ! -f "$SSHD_CONFIG" ]; then
    echo "Error: sshd_config not found. Ensure ghcr.io/devcontainers/features/sshd:1 is installed."
    exit 1
fi

# Harden sshd_config
# The upstream sshd feature leaves password auth enabled and does not restrict
# authentication methods. For lace, key-based auth is the only supported path.

# Disable password authentication
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
if ! grep -q '^PasswordAuthentication' "$SSHD_CONFIG"; then
    echo "PasswordAuthentication no" >> "$SSHD_CONFIG"
fi

# Disable keyboard-interactive authentication (PAM-based password prompts)
sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' "$SSHD_CONFIG"
if ! grep -q '^KbdInteractiveAuthentication' "$SSHD_CONFIG"; then
    echo "KbdInteractiveAuthentication no" >> "$SSHD_CONFIG"
fi

# Ensure pubkey authentication is enabled (should be default, but be explicit)
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONFIG"
if ! grep -q '^PubkeyAuthentication' "$SSHD_CONFIG"; then
    echo "PubkeyAuthentication yes" >> "$SSHD_CONFIG"
fi

# Disable root login (the remoteUser is never root in lace containers)
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
if ! grep -q '^PermitRootLogin' "$SSHD_CONFIG"; then
    echo "PermitRootLogin no" >> "$SSHD_CONFIG"
fi

# Prepare authorized_keys location for the remote user
_REMOTE_USER="${_REMOTE_USER:-root}"
SSH_DIR="/home/${_REMOTE_USER}/.ssh"

if [ "$_REMOTE_USER" = "root" ]; then
    SSH_DIR="/root/.ssh"
fi

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
chown "${_REMOTE_USER}:${_REMOTE_USER}" "$SSH_DIR"

# Validate port consistency
CONFIGURED_PORT=$(grep -oP '(?<=^Port )\d+' "$SSHD_CONFIG" 2>/dev/null || echo "2222")
if [ "$CONFIGURED_PORT" != "$SSH_PORT" ]; then
    echo "WARNING: sshd port ($CONFIGURED_PORT) does not match sshPort option ($SSH_PORT)."
    echo "         Lace will allocate a host port mapped to container port $SSH_PORT."
fi

echo "lace-sshd: SSH hardened (password auth disabled, pubkey only, root login disabled)."
```

Design rationale for hardening choices:

- **Password auth disabled**: lace uses key-based auth exclusively. The key pair lives at `~/.config/lace/ssh/id_ed25519` and the public key is bind-mounted into the container. Password auth is a security risk in dev containers where the user password may be trivially guessable or empty.
- **Root login disabled**: lace containers use `remoteUser` (typically `node` or `vscode`), never root. Disabling root login reduces attack surface.
- **Keyboard-interactive disabled**: this catches PAM-based password prompts that survive `PasswordAuthentication no` on some distributions.
- **Port validation**: a warning (not error) is emitted if the sshd config port differs from the option value. This catches configuration drift without breaking the build.

### File Layout

```
devcontainers/features/src/lace-sshd/
  devcontainer-feature.json
  install.sh
  README.md
```

This matches the layout of the existing published features (`neovim`, `claude-code`, `portless`).
The `README.md` is auto-generated by the `devcontainers/action@v1` CI action, but an initial version should be provided.

## Migration Path

### For lace's own devcontainer

The lace project currently declares both features separately:

```json
"prebuildFeatures": {
    "ghcr.io/devcontainers/features/sshd:1": {},
    "./features/lace-sshd": {}
}
```

After publishing, this becomes:

```json
"prebuildFeatures": {
    "ghcr.io/weftwiseink/devcontainer-features/lace-sshd:1": {}
}
```

The explicit `sshd:1` declaration is no longer needed because `dependsOn` handles it.
The local `./features/lace-sshd` reference is replaced by the GHCR reference.

The local feature directory at `.devcontainer/features/lace-sshd/` can be deleted after publishing.

> NOTE(opus/lace-sshd-evolution): The prebuild copy at `.lace/prebuild/features/lace-sshd/` is also deleted.
> Lace fetches metadata from the GHCR registry (or its local cache) for published features.

### For the dotfiles devcontainer

The dotfiles devcontainer currently uses the old `wezterm-server` feature and has static `authorized_keys` mount workarounds.
Migration to `lace-sshd`:

1. Replace `ghcr.io/weft/devcontainer-features/wezterm-server:1` with `ghcr.io/weftwiseink/devcontainer-features/lace-sshd:1`.
2. Remove the explicit `ghcr.io/devcontainers/features/sshd:1` declaration (if present).
3. Remove the static `authorized_keys` mount strings from the `mounts` array.
4. The `${_REMOTE_USER}` variable in the mount target eliminates the dual-user mount workaround.

### For new projects

A new project adopting lace needs only:

```json
{
    "features": {
        "ghcr.io/weftwiseink/devcontainer-features/lace-sshd:1": {}
    }
}
```

This single declaration:
- Installs OpenSSH server (via `dependsOn` on the upstream sshd feature).
- Hardens the SSH configuration.
- Declares port metadata for lace auto-allocation.
- Declares mount metadata for authorized_keys injection.
- Prepares the `~/.ssh` directory with correct ownership.

No knowledge of the upstream sshd feature, port ranges, or authorized_keys plumbing is required.

## Publishing Pipeline

The existing CI workflow at `.github/workflows/devcontainer-features-release.yaml` publishes features from `devcontainers/features/src/` to GHCR on push to `main`.

The workflow uses `devcontainers/action@v1` with:
- `base-path-to-features: "./devcontainers/features/src"`
- `features-namespace: "weftwiseink/devcontainer-features"`

Adding a new feature to `devcontainers/features/src/lace-sshd/` is sufficient.
The action discovers all features in the base path and publishes each one.
The resulting OCI artifact is at `ghcr.io/weftwiseink/devcontainer-features/lace-sshd:1`.

No CI changes are needed.

## Test Strategy

### Unit/Integration Tests

The existing test suite uses `wezterm-server` as the feature name in many scenario tests (e.g., `claude-code-scenarios.test.ts`, `neovim-scenarios.test.ts`, `portless-scenarios.test.ts`, `port-allocator.test.ts`).
These tests reference `wezterm-server` by name via `symlinkLocalFeature(ctx, "wezterm-server")`.

Since the `wezterm-server` feature source no longer exists at `devcontainers/features/src/wezterm-server/`, these tests likely already fail or have been updated.
The migration path for tests:

1. Create the `lace-sshd` feature source at `devcontainers/features/src/lace-sshd/`.
2. Update `symlinkLocalFeature` calls from `"wezterm-server"` to `"lace-sshd"`.
3. Update settings overrides from `"wezterm-server/authorized-keys"` to `"lace-sshd/authorized-keys"`.
4. Update port allocation labels from `"wezterm-server/hostSshPort"` to `"lace-sshd/sshPort"`.

> NOTE(opus/lace-sshd-evolution): The option name changed from `hostSshPort` to `sshPort` during the `wezterm-server` to `lace-sshd` migration.
> This is reflected in the port allocation label namespace.

### Manual Verification

1. Build a devcontainer with the published `lace-sshd` feature.
2. Verify `sshd_config` has password auth disabled and pubkey auth enabled.
3. Verify `lace-into` connects with key-based auth without password prompt.
4. Verify `lace up` fails cleanly when `~/.config/lace/ssh/id_ed25519.pub` is missing, with the remediation hint.
5. Verify settings override for `lace-sshd/authorized-keys` with a custom key path.

## Implementation Phases

### Phase 1: Create Feature Source

Create `devcontainers/features/src/lace-sshd/` with:
- `devcontainer-feature.json` (metadata as specified above)
- `install.sh` (hardening script as specified above)
- `README.md` (basic usage documentation)

### Phase 2: Update Test Suite

Update scenario tests that reference `wezterm-server` to use `lace-sshd`:
- `claude-code-scenarios.test.ts`: C5 scenario
- `neovim-scenarios.test.ts`: N3 scenario
- `portless-scenarios.test.ts`: P3 scenario
- `port-allocator.test.ts`: all `wezterm-server/hostSshPort` references
- `e2e.test.ts`: feature references
- `devcontainer.test.ts`: fixture references
- `template-resolver.test.ts`: feature references
- `standard.jsonc` fixture

### Phase 3: Migrate Lace's Own Devcontainer

- Update `.devcontainer/devcontainer.json` to use `ghcr.io/weftwiseink/devcontainer-features/lace-sshd:1`.
- Remove `.devcontainer/features/lace-sshd/` local feature directory.
- Remove `.lace/prebuild/features/lace-sshd/` prebuild copy.
- Remove `ghcr.io/devcontainers/features/sshd:1` from `prebuildFeatures`.

> NOTE(opus/lace-sshd-evolution): Phase 3 depends on the feature being published to GHCR first.
> The merge to `main` triggers the CI workflow, which publishes the feature.
> Phase 3 can be a follow-up PR after the publish confirms success.

### Phase 4: Publish and Verify

- Merge Phase 1 to `main`.
- Verify the CI workflow publishes `lace-sshd` to GHCR.
- Verify `devcontainer features info manifest ghcr.io/weftwiseink/devcontainer-features/lace-sshd:1` returns correct metadata.
- Execute Phase 3 migration.

## Open Questions

1. **Should the install script also configure `AuthorizedKeysFile`?** The default `~/.ssh/authorized_keys` matches the mount target, so no change is needed. But an explicit `AuthorizedKeysFile` directive would make the configuration self-documenting and resilient to upstream changes.

2. **Should the feature set `PermitEmptyPasswords no`?** This is already the OpenSSH default, but being explicit adds defense-in-depth. The install script could include it alongside the other hardening directives.

3. **Version pinning of the upstream sshd feature**: `dependsOn` uses `ghcr.io/devcontainers/features/sshd:1` (floating major). Should this be pinned to a specific minor version for reproducibility? The tradeoff is security patches vs build reproducibility.
