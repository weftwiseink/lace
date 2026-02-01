---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T16:30:00-08:00
task_list: lace/devcontainer-features
type: report
state: live
status: done
tags: [devcontainer-features, wezterm, design-decisions, cross-platform, oci-namespace]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T17:00:00-08:00
  round: 1
---

# Design Decisions: Wezterm Server Devcontainer Feature

Reference document for the design decisions behind `ghcr.io/weftwiseink/devcontainer-features/wezterm-server`.
See the proposal: `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`.

## 1. Monorepo subdirectory, not a separate repository

Feature source lives at `devcontainers/features/` within the lace repo.
The `devcontainers/action@v1` `features-namespace` input overrides the default `<owner>/<repo>` OCI namespace, so the monorepo still publishes to `ghcr.io/weftwiseink/devcontainer-features/*`.

Lace is the primary consumer. Co-location simplifies iteration during initial development.
If features later serve multiple unrelated projects, extract into a dedicated `weftwiseink/devcontainer-features` repo (which also eliminates the namespace override).

## 2. Extract from .deb/.rpm/AppImage rather than package-manager install

The wezterm `.deb` and `.rpm` packages pull in X11, Wayland, and GUI toolkit dependencies (100+ MB).
In a headless devcontainer only `wezterm-mux-server` and `wezterm` CLI binaries are needed.

- **Debian/Ubuntu**: `dpkg -x` extracts binaries from `.deb` without dependency resolution.
- **Fedora/RHEL**: `rpm2cpio | cpio -idmv` extracts from `.rpm` the same way.
- **Other glibc-based** (Arch, openSUSE, etc.): AppImage extraction via `--appimage-extract` as a fallback.
- **Alpine/musl**: Unsupported. Wezterm does not publish musl-compatible binaries. The install script detects musl and exits with a clear error.

This is the proven pattern from the lace Dockerfile, generalized across distro families.

## 3. Cross-platform distro detection via /etc/os-release

The install script detects the Linux distribution by sourcing `/etc/os-release` and branching on the `ID` and `ID_LIKE` fields.
This is the standard pattern used by `devcontainers/features/common-utils` and other well-built features.

Three installation paths plus an unsupported path:

| Distro family | Detection | Package format | Extraction method |
|---|---|---|---|
| Debian/Ubuntu | `ID=debian` or `ID_LIKE=*debian*` | `.deb` | `dpkg -x` |
| Fedora/RHEL | `ID=fedora` or `ID_LIKE=*rhel*` | `.rpm` | `rpm2cpio \| cpio` |
| Other glibc-based | Fallback | AppImage | `--appimage-extract` |
| Alpine/musl | Early detection | N/A | Error with clear message |

The `.deb` path is the most tested (it is the existing Dockerfile logic).
The `.rpm` path uses Fedora-specific naming (`fc39` suffix) with a generic fallback; openSUSE and other non-Fedora RPM distros route to AppImage instead.
The AppImage path requires glibc and is x86_64 only.

## 4. Depend on sshd feature via installsAfter

The wezterm-mux-server feature is designed for SSH domain multiplexing, which requires an sshd running in the container.
Declaring `installsAfter: ["ghcr.io/devcontainers/features/sshd"]` ensures sshd is installed first when both features are present.

This is a soft dependency: the feature does not fail without sshd (users may have their own SSH setup), but it documents the intended composition.
The `installsAfter` for `common-utils` is retained to ensure `curl` availability.

## 5. Use _REMOTE_USER for runtime directory ownership

The devcontainer spec sets `_REMOTE_USER` and `_REMOTE_USER_HOME` during feature installation.
Using these instead of hardcoded `node` or UID `1000` makes the feature portable across base images with different default users.

## 6. Workflows at repo root with path filters

GitHub Actions only reads workflow files from `.github/workflows/` at the repository root.
Path-scoped triggers (`paths: [devcontainers/features/**]`) ensure workflows only run when feature source changes.

## 7. Wezterm release URL conventions

Wezterm's naming conventions vary by distro and architecture:

- `.deb`: `wezterm-{VERSION}.{DISTRO}.deb` (amd64 omits arch suffix; arm64 appends `.arm64`)
- `.rpm`: Available via Copr repos and direct download for Fedora/CentOS/openSUSE
- AppImage: `WezTerm-{VERSION}-Ubuntu20.04.AppImage` (x86_64 only for stable releases)

The install script must handle these naming differences per-platform.
The `set -eu` plus `curl -f` pattern ensures download failures are caught immediately rather than propagating corrupt files to extraction.

## 8. Phase 4 (additional features) deferred to other workstreams

The original proposal included a Phase 4 for neovim-appimage, nushell, and git-delta features.
These are handled by the parallel feature-based-tooling migration (`cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md`) which uses community features instead.
The wezterm-server proposal focuses solely on the wezterm feature and directory scaffold.

## Usage Context

The wezterm-server feature enables headless terminal multiplexing in devcontainers.
The host runs wezterm with an SSH domain configured to connect to the container's sshd on port 2222.
Inside the container, `wezterm-mux-server --daemonize` listens for mux protocol connections.
This gives the host wezterm full multiplexing capabilities (tabs, panes, splits) over the SSH transport, without GUI dependencies inside the container.

SSH key management for this connection is a separate concern addressed in `cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md`.
