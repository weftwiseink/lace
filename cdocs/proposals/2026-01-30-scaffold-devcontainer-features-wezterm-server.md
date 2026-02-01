---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-30T18:30:00-08:00
task_list: lace/devcontainer-features
type: proposal
state: live
status: implementation_complete
tags: [devcontainer-features, wezterm, ci-cd, publishing, infrastructure, oci-namespace, cross-platform]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T18:00:00-08:00
  round: 4
revised:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T17:15:00-08:00
  reason: "Split Phase 1 into 1a (Debian-only, proven path) and 1b (cross-platform, validated incrementally). Add Phase 0 GHCR prerequisites. Fix org name weft->weftwiseink."
---

# Scaffold devcontainers/features/ with Wezterm Server Feature

> BLUF: Extract the wezterm-mux-server installation logic from the lace Dockerfile into a standalone devcontainer feature published at `ghcr.io/weftwiseink/devcontainer-features/wezterm-server`, following the structure and CI/CD patterns established by [anthropics/devcontainer-features](https://github.com/anthropics/devcontainer-features).
> Phase 1a ships the proven Debian/Ubuntu path (`.deb` extraction) to unblock the lace Dockerfile migration. Phase 1b adds cross-platform support (Fedora `.rpm`, AppImage fallback) after the Debian path is validated in production.
> The feature declares `installsAfter` dependencies on both `common-utils` and `sshd`, lives at `devcontainers/features/` within the lace monorepo, and publishes to GHCR via `devcontainers/action@v1`.
> Phase 0 verifies GHCR prerequisites; Phase 2 adds CI/CD; Phase 3 migrates the lace Dockerfile (coordinated with the parallel feature-based-tooling migration).

## Objective

The lace project's Dockerfile contains inline installation logic for wezterm-mux-server that is non-trivial: it downloads the `.deb`, extracts binaries without installing GUI dependencies, and sets up runtime directories.
This logic should be reusable by any devcontainer, not locked inside a single Dockerfile.
Publishing it as a devcontainer feature at `ghcr.io/weftwiseink/devcontainer-features/wezterm-server` makes it installable with a single JSON line in any `devcontainer.json`.

## Background

### Devcontainer features specification

The [devcontainer features spec](https://containers.dev/implementors/features/) defines a standard format for shareable, composable units of container configuration.
Each feature is a directory containing `devcontainer-feature.json` (metadata, options, lifecycle hooks) and `install.sh` (the installation script).
Features are published as OCI artifacts to container registries (typically GHCR) and referenced in `devcontainer.json` by their OCI address.

### Reference implementation: anthropics/devcontainer-features

The [anthropics/devcontainer-features](https://github.com/anthropics/devcontainer-features) repository provides the pattern this proposal follows:

```
src/
  claude-code/
    devcontainer-feature.json
    install.sh
test/
  claude-code/
    test.sh
    scenarios.json
.github/workflows/
    release.yaml      # devcontainers/action@v1 publishes to GHCR on push to main
    test.yaml          # matrix tests across debian:latest, ubuntu:latest, mcr base image
    validate.yaml
```

Key patterns observed:
- `devcontainers/action@v1` handles OCI packaging and GHCR publishing.
- The release workflow auto-generates README docs and creates a PR for them.
- Tests use `devcontainer features test` CLI with `dev-container-features-test-lib`.
- `scenarios.json` defines test scenarios with specific base images and feature combinations.

### Existing wezterm logic in the lace Dockerfile

The current Dockerfile (`.devcontainer/Dockerfile`, lines 97-113) installs wezterm headlessly.
The version `20240203-110809-5046fc22` is the latest stable release and is the proven-working version in the lace devcontainer:

```dockerfile
ARG WEZTERM_VERSION="20240203-110809-5046fc22"
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      DEB_NAME="wezterm-${WEZTERM_VERSION}.Debian12.deb"; \
    else \
      DEB_NAME="wezterm-${WEZTERM_VERSION}.Debian12.${ARCH}.deb"; \
    fi && \
    curl -fsSL -o /tmp/wezterm.deb \
      "https://github.com/wez/wezterm/releases/download/${WEZTERM_VERSION}/${DEB_NAME}" && \
    dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract && \
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/ && \
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/ && \
    rm -rf /tmp/wezterm.deb /tmp/wezterm-extract
```

Additional Dockerfile lines handle:
- Runtime directory creation: `mkdir -p /run/user/1000 && chown ${USERNAME}:${USERNAME} /run/user/1000`
- SSH directory setup: `mkdir -p /home/${USERNAME}/.ssh && chmod 700 /home/${USERNAME}/.ssh && chown ${USERNAME}:${USERNAME} /home/${USERNAME}/.ssh`

The `devcontainer.json` starts the mux server via `postStartCommand` and exposes port 2222 for SSH domain connections.

### Wezterm release availability

Wezterm publishes packages in multiple formats (stable release `20240203-110809-5046fc22`):

| Format | Platforms | Architectures |
|---|---|---|
| `.deb` | Debian 11/12, Ubuntu 20/22/24 | amd64, arm64 |
| `.rpm` | Fedora (directly tested; other RPM distros via Copr) | x86_64, aarch64 |
| AppImage | Generic Linux (glibc-based) | x86_64 |

The `.deb` and `.rpm` packages bundle GUI dependencies that are unnecessary for headless use.
All three formats contain the `wezterm-mux-server` and `wezterm` binaries needed for the feature.

Note: Alpine Linux (musl libc) is unsupported. Wezterm does not publish musl-compatible binaries, and AppImage extraction requires glibc.

### Related workstreams

- **Feature-based tooling migration** (`cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md`, status: `implementation_wip`): Migrates neovim, claude-code, and nushell from Dockerfile installs to community features. Phase 3 of that proposal (wezterm migration) is gated on this proposal's feature being published. The two proposals share Phase 3.
- **SSH key auto-management** (`cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md`, status: `request_for_proposal`): Spun off from feedback on this proposal. The lace CLI should automate SSH key lifecycle for devcontainer SSH domain connections, rather than requiring manual `ssh-keygen`.

## Proposed Solution

### Directory layout

```
devcontainers/
  features/
    src/
      wezterm-server/
        devcontainer-feature.json
        install.sh
    test/
      wezterm-server/
        test.sh
        scenarios.json
.github/
  workflows/
    devcontainer-features-test.yaml
    devcontainer-features-release.yaml
```

The `devcontainers/features/` directory contains the feature source and tests.
The workflow files live at the repo root `.github/workflows/` (the only location GitHub Actions reads) and use `paths:` triggers scoped to `devcontainers/features/**` to avoid running on unrelated changes.

> NOTE(opus/lace-devcontainer-features): If monorepo workflow complexity becomes burdensome, the features can be extracted into a separate `weftwiseink/devcontainer-features` repository, which would also simplify the OCI namespace (eliminating the need for the `features-namespace` override).

### devcontainer-feature.json

```json
{
    "name": "Wezterm Server",
    "id": "wezterm-server",
    "version": "1.0.0",
    "description": "Installs wezterm-mux-server and wezterm CLI for headless terminal multiplexing via SSH domains. Extracts binaries from platform-native packages to avoid X11/Wayland GUI dependencies.",
    "options": {
        "version": {
            "type": "string",
            "default": "20240203-110809-5046fc22",
            "description": "Wezterm release version string (e.g., 20240203-110809-5046fc22)"
        },
        "createRuntimeDir": {
            "type": "boolean",
            "default": true,
            "description": "Create /run/user/<uid> runtime directory for wezterm-mux-server (UID resolved from _REMOTE_USER)"
        }
    },
    "documentationURL": "https://github.com/weftwiseink/lace/tree/main/devcontainers/features/src/wezterm-server",
    "licenseURL": "https://github.com/weftwiseink/lace/blob/main/LICENSE",
    "installsAfter": [
        "ghcr.io/devcontainers/features/common-utils",
        "ghcr.io/devcontainers/features/sshd"
    ]
}
```

### install.sh

The install script detects the Linux distribution and routes to the appropriate installation path.
Phase 1a ships with Debian/Ubuntu support (the proven `.deb` extraction from the existing Dockerfile). Other distros get a clear "not yet supported" message with the distro family detected for future use.
Phase 1b adds RPM and AppImage paths after validating URL patterns against real wezterm releases.

**Phase 1a version** (Debian/Ubuntu only, with distro detection scaffolding):

```sh
#!/bin/sh
set -eu

VERSION="${VERSION:-20240203-110809-5046fc22}"
CREATERUNTIMEDIR="${CREATERUNTIMEDIR:-true}"

# Verify curl is available
command -v curl >/dev/null 2>&1 || {
    echo "Error: curl is required. Install it or add ghcr.io/devcontainers/features/common-utils."
    exit 1
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64)  echo "amd64" ;;
        aarch64) echo "arm64" ;;
        *)       echo "unsupported"; return 1 ;;
    esac
}

ARCH=$(detect_arch)

# Detect distro family via /etc/os-release
detect_distro_family() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            debian|ubuntu|linuxmint|pop) echo "debian" ;;
            fedora|centos|rhel|rocky|alma) echo "redhat" ;;
            opensuse*|sles) echo "suse" ;;
            alpine) echo "alpine" ;;
            *) # Check ID_LIKE for derivatives
                case "${ID_LIKE:-}" in
                    *debian*) echo "debian" ;;
                    *rhel*|*fedora*) echo "redhat" ;;
                    *suse*) echo "suse" ;;
                    *) echo "unknown" ;;
                esac ;;
        esac
    else
        echo "unknown"
    fi
}

DISTRO_FAMILY=$(detect_distro_family)

echo "Installing wezterm-mux-server and wezterm CLI (version: ${VERSION}, arch: ${ARCH}, distro: ${DISTRO_FAMILY})..."

# Extract binaries from .deb without installing dependencies
install_from_deb() {
    command -v dpkg >/dev/null 2>&1 || { echo "Error: dpkg not found on Debian-family system."; exit 1; }
    if [ "$ARCH" = "amd64" ]; then
        DEB_NAME="wezterm-${VERSION}.Debian12.deb"
    else
        DEB_NAME="wezterm-${VERSION}.Debian12.${ARCH}.deb"
    fi
    curl -fsSL -o /tmp/wezterm.deb \
        "https://github.com/wez/wezterm/releases/download/${VERSION}/${DEB_NAME}"
    dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/
    rm -rf /tmp/wezterm.deb /tmp/wezterm-extract
}

# Route to the appropriate installer
case "$DISTRO_FAMILY" in
    debian)
        install_from_deb ;;
    *)
        echo "Error: ${DISTRO_FAMILY} is not yet supported by wezterm-server feature."
        echo "Currently supported: Debian, Ubuntu, and Debian derivatives."
        echo "Fedora/RHEL (RPM) and AppImage support planned for a future release."
        exit 1 ;;
esac

# Optional: create runtime directory
if [ "$CREATERUNTIMEDIR" = "true" ]; then
    _REMOTE_USER="${_REMOTE_USER:-root}"
    USER_ID=$(id -u "$_REMOTE_USER" 2>/dev/null || echo "1000")
    mkdir -p "/run/user/${USER_ID}"
    chown "${_REMOTE_USER}:${_REMOTE_USER}" "/run/user/${USER_ID}"
fi

echo "wezterm-mux-server and wezterm CLI installed successfully."
wezterm-mux-server --version || true
```

**Phase 1b additions** (after Debian path validated in production):

The `install_from_rpm` and `install_from_appimage` functions are added, and the routing `case` expands to:

```sh
case "$DISTRO_FAMILY" in
    debian)
        install_from_deb ;;
    redhat)
        install_from_rpm ;;
    alpine)
        echo "Error: wezterm does not publish musl-compatible binaries."
        echo "Alpine Linux and other musl-based distributions are not supported."
        echo "Use a glibc-based image (Debian, Ubuntu, Fedora) instead."
        exit 1 ;;
    *)
        echo "No native package for ${DISTRO_FAMILY}; falling back to AppImage extraction..."
        install_from_appimage ;;
esac
```

The RPM and AppImage functions must be validated against actual wezterm release URLs before implementation. Key verification steps:

1. **RPM**: Download `https://github.com/wez/wezterm/releases/download/{VERSION}/` and inspect actual `.rpm` filenames. The Fedora version suffix (`fc39`, `fc41`, etc.) varies between releases.
2. **AppImage**: Verify `WezTerm-{VERSION}-Ubuntu20.04.AppImage` exists, and that `--appimage-extract` produces binaries at `squashfs-root/usr/bin/`.
3. **Alpine**: Confirm that wezterm binaries are glibc-linked (they are, based on upstream build system).

### test.sh

```sh
#!/bin/bash
set -e

source dev-container-features-test-lib

check "wezterm-mux-server installed" command -v wezterm-mux-server
check "wezterm cli installed" command -v wezterm
check "wezterm-mux-server version" wezterm-mux-server --version
check "runtime dir exists for current user" bash -c 'test -d /run/user/$(id -u)'

reportResults
```

### scenarios.json

**Phase 1a** (Debian/Ubuntu only):

```json
{
    "debian_default": {
        "image": "mcr.microsoft.com/devcontainers/base:debian",
        "features": {
            "wezterm-server": {}
        }
    },
    "ubuntu_default": {
        "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
        "features": {
            "wezterm-server": {}
        }
    },
    "custom_version": {
        "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
        "features": {
            "wezterm-server": {
                "version": "20240203-110809-5046fc22"
            }
        }
    },
    "no_runtime_dir": {
        "image": "debian:bookworm",
        "features": {
            "wezterm-server": {
                "createRuntimeDir": false
            }
        }
    }
}
```

**Phase 1b additions** (after validating URL patterns against real releases):

```json
{
    "fedora_39": {
        "image": "fedora:39",
        "features": {
            "ghcr.io/devcontainers/features/common-utils:2": {},
            "wezterm-server": {}
        }
    },
    "fedora_41_rpm_fallback": {
        "image": "fedora:41",
        "features": {
            "ghcr.io/devcontainers/features/common-utils:2": {},
            "wezterm-server": {}
        }
    },
    "archlinux_appimage": {
        "image": "archlinux:latest",
        "features": {
            "ghcr.io/devcontainers/features/common-utils:2": {},
            "wezterm-server": {}
        }
    }
}
```

### Lace Dockerfile migration

After the feature is published, the lace `devcontainer.json` adds the wezterm-server feature.
This is coordinated with the feature-based-tooling migration (`cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md`, Phase 3), which is gated on this feature being published:

```json
"features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {
        "version": "2.1.11"
    },
    "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
    "ghcr.io/eitsupi/devcontainer-features/nushell:0": {},
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        "version": "20240203-110809-5046fc22"
    }
}
```

The corresponding Dockerfile lines (ARG WEZTERM_VERSION through the `rm -rf` cleanup, runtime dir creation, and SSH dir setup) are removed.

### Publishing namespace

By default, `devcontainers/action@v1` derives the OCI namespace from the source repository: `ghcr.io/<owner>/<repo>/<feature-id>`.
For the `weftwiseink/lace` monorepo, this would produce `ghcr.io/weftwiseink/lace/wezterm-server`.
To publish under the preferred `ghcr.io/weftwiseink/devcontainer-features/wezterm-server` address instead, the release workflow uses the action's `features-namespace` input:

```yaml
- uses: devcontainers/action@v1
  with:
    publish-features: "true"
    base-path-to-features: "./devcontainers/features/src"
    features-namespace: "weftwiseink/devcontainer-features"
```

## Design Requirements

> Full rationale for each decision: `cdocs/reports/2026-01-31-wezterm-server-feature-design-decisions.md`

1. **Monorepo subdirectory** (`devcontainers/features/` in lace repo).
   `features-namespace` override publishes to `ghcr.io/weftwiseink/devcontainer-features/*`.
2. **Extract binaries from packages**, not `apt-get install` / `dnf install`.
   Avoids 100+ MB of GUI dependencies in headless containers.
3. **Cross-platform via distro detection** (`/etc/os-release`).
   Debian/Ubuntu: `.deb`. Fedora/RHEL: `.rpm`. Other glibc-based: AppImage. Alpine/musl: unsupported with clear error.
4. **Depend on sshd** via `installsAfter`.
   Wezterm SSH domain multiplexing requires sshd; soft dependency documents the composition.
5. **`_REMOTE_USER`** for runtime directory ownership.
   Portable across base images with different default users.
6. **Workflows at repo root** with `paths: [devcontainers/features/**]` triggers.
7. **Phase 4 (additional features) deferred** to the feature-based-tooling workstream.

## Edge Cases / Challenging Scenarios

### Wezterm release URL format varies by distro and architecture

`.deb` naming: amd64 omits arch suffix, arm64 appends `.arm64.deb`.
`.rpm` naming: includes Fedora version suffix (e.g., `fc39`) and uses `x86_64`/`aarch64` arch names. The install script hardcodes `fc39` as the primary RPM filename; if wezterm stops publishing `fc39` RPMs or the user runs a newer Fedora, the primary URL will 404 and the fallback generic URL is attempted. This is a known fragility. openSUSE and other RPM distros route to the AppImage fallback instead, since their RPM naming conventions differ from Fedora's.
AppImage: only available for x86_64, requires glibc.

Mitigation: `curl -f` + `set -eu` ensures download failures halt the script immediately. The Fedora RPM path includes a fallback URL pattern. Non-Fedora RPM distros fall through to AppImage.

### AppImage extraction requires glibc

The `--appimage-extract` flag extracts AppImage contents without FUSE (which is typically absent in containers).
However, the AppImage binary itself requires glibc to execute the extraction.
Alpine Linux and other musl-based distributions cannot use AppImage extraction.
The install script detects musl and exits with a clear error before attempting extraction.

### Alpine Linux is unsupported

Wezterm does not publish musl-compatible binaries.
Alpine uses musl libc, which is incompatible with both AppImage (glibc-linked extraction stub) and the pre-built binaries inside `.deb`/`.rpm` packages.
The install script detects Alpine/musl early and exits with a clear error message rather than failing with a confusing dynamic linker error.

### RPM extraction tools may be absent

Fedora/RHEL base images include `rpm2cpio` and `cpio` by default.
Minimal images may not. The install script checks for both tools and exits with a clear error suggesting `dnf install rpm2cpio cpio`.

### Non-standard UID for runtime directory

If the container runs as root (UID 0), the path becomes `/run/user/0`.
This is a known devcontainer pattern; wezterm handles it correctly via `XDG_RUNTIME_DIR`.

### Feature ordering with sshd

The feature declares `installsAfter: ["ghcr.io/devcontainers/features/sshd"]` to ensure sshd configuration is in place.
If a user does not include sshd in their features list, the `installsAfter` is a no-op (it only affects ordering when both features are present). The feature installs successfully without sshd; SSH domain connectivity simply requires the user to provide their own sshd.

### GHCR publishing permissions

Publishing to `ghcr.io/weftwiseink/devcontainer-features/` requires the `weftwiseink` GitHub organization to have packages enabled and the repository's GITHUB_TOKEN to have `packages: write` permission.
Mitigation: document the one-time org/repo setup in the feature README.

## Implementation Phases

### Phase 0: Verify GHCR prerequisites

Before implementing any feature code, verify the `weftwiseink` GitHub organization is configured for GHCR publishing.
See `cdocs/reports/2026-01-31-ghcr-publishing-prerequisites.md` for the full checklist.

#### Step 0.1: Verify org-level Actions permissions

Navigate to `https://github.com/organizations/weftwiseink/settings/actions` and confirm workflow permissions.
Recommendation: keep restrictive defaults (read-only) and use explicit `permissions` blocks in workflows.

#### Step 0.2: Dummy feature smoke test

Publish a minimal dummy feature to `ghcr.io/weftwiseink/devcontainer-features/dummy-test` using a `workflow_dispatch` workflow.
This verifies:
- GITHUB_TOKEN has `packages: write` permission
- The `features-namespace` override works
- Package visibility can be set to public

See the GHCR prerequisites report Section 6.2 for the full smoke test procedure.

#### Step 0.3: Clean up

Delete the dummy package from GHCR, remove the test workflow, and delete the test branch.

**Success criteria for Phase 0:**

- Dummy feature publishes successfully to `ghcr.io/weftwiseink/devcontainer-features/dummy-test`
- Package can be set to public visibility
- Package can be consumed in a test `devcontainer.json`

**Stop here if smoke test fails.** Resolve all GHCR/permissions issues before proceeding.

### Phase 1a: Directory scaffold and Debian-only feature

Create the directory structure and feature files with Debian/Ubuntu support only.
The Debian `.deb` extraction path is proven (it is the existing Dockerfile logic). Phase 1a ships the known-working path; cross-platform support is deferred to Phase 1b.

The implementer should work in a develop/test/debug loop using `devcontainer features test` locally.

#### Step 1a.1: Create directory scaffold

```sh
mkdir -p devcontainers/features/src/wezterm-server
mkdir -p devcontainers/features/test/wezterm-server
```

#### Step 1a.2: Create devcontainer-feature.json

Write `devcontainers/features/src/wezterm-server/devcontainer-feature.json` with the schema defined in the Proposed Solution section above.

Verify the JSON is valid: `cat devcontainer-feature.json | python3 -m json.tool`

#### Step 1a.3: Create install.sh

Write `devcontainers/features/src/wezterm-server/install.sh` with the Debian-only install script defined in the Proposed Solution section (Phase 1a version).

Mark executable: `chmod +x devcontainers/features/src/wezterm-server/install.sh`

Key implementation details:
- The script must be POSIX `sh` compatible (no bashisms). Test with `shellcheck install.sh`.
- Use `uname -m` for architecture detection (works everywhere), not `dpkg --print-architecture` (Debian-only).
- The `/etc/os-release` sourcing pattern should handle missing file gracefully (the `[ -f /etc/os-release ]` check).
- The `detect_distro_family` function and `detect_arch` function are included in full even though only the `debian` case is active. This scaffolds the cross-platform structure for Phase 1b.
- Non-Debian distros hit a clear error message explaining that only Debian/Ubuntu is currently supported, with RPM and AppImage support planned.
- The `.deb` extraction path is a direct lift from the working Dockerfile: `dpkg -x` extracts without dependency resolution.

#### Step 1a.4: Create test.sh

Write `devcontainers/features/test/wezterm-server/test.sh` as defined in the Proposed Solution section.

Mark executable: `chmod +x devcontainers/features/test/wezterm-server/test.sh`

#### Step 1a.5: Create scenarios.json

Write `devcontainers/features/test/wezterm-server/scenarios.json` with the Phase 1a scenarios only: `debian_default`, `ubuntu_default`, `custom_version`, and `no_runtime_dir`.

#### Step 1a.6: Local testing loop

Prerequisites:
- Docker daemon running locally
- `devcontainer` CLI installed (`npm install -g @devcontainers/cli`)

**Primary test command** (Debian, the most-tested path):

```sh
cd devcontainers/features
devcontainer features test \
    --features wezterm-server \
    --base-image mcr.microsoft.com/devcontainers/base:debian
```

This runs `test.sh` inside a container built from the specified base image with the feature applied.

**Scenario-based tests** (all Phase 1a scenarios):

```sh
cd devcontainers/features
devcontainer features test \
    --features wezterm-server
```

This runs all scenarios defined in `scenarios.json`. Each scenario specifies its own base image.

**Debug workflow when tests fail:**

1. **Read the test output carefully.** The `devcontainer features test` output includes the full install script log. Look for:
   - curl errors (404 = wrong URL, connection errors = network issues)
   - `dpkg -x` errors (corrupt download, missing dpkg)
   - `install: cannot stat` errors (binary not found at expected path in extracted package)
   - Permission errors (missing `chmod +x` on install.sh)

2. **Test install.sh interactively.** Start a container and run the script manually:
   ```sh
   docker run --rm -it mcr.microsoft.com/devcontainers/base:debian bash
   # Inside the container:
   export VERSION="20240203-110809-5046fc22"
   export CREATERUNTIMEDIR="true"
   # Copy/paste install.sh contents and run step by step
   ```

3. **Verify binary locations in extracted packages.** The wezterm `.deb` places binaries at `usr/bin/wezterm-mux-server` and `usr/bin/wezterm` relative to the extraction root. Verify this hasn't changed:
   ```sh
   # Inside a debian container:
   curl -fsSL -o /tmp/wezterm.deb "https://github.com/wez/wezterm/releases/download/20240203-110809-5046fc22/wezterm-20240203-110809-5046fc22.Debian12.deb"
   dpkg -x /tmp/wezterm.deb /tmp/extract
   ls -la /tmp/extract/usr/bin/
   ```

4. **ShellCheck.** Run `shellcheck install.sh` to catch POSIX compliance issues. Common problems:
   - `[[` instead of `[` (bashism)
   - `function` keyword (bashism)
   - Process substitution `<()` (bashism)
   - Arrays (bashism)

**Success criteria for Phase 1a:**

- `devcontainer features test --features wezterm-server --base-image mcr.microsoft.com/devcontainers/base:debian` passes
- `devcontainer features test --features wezterm-server --base-image mcr.microsoft.com/devcontainers/base:ubuntu` passes
- `devcontainer features test --features wezterm-server` (all Phase 1a scenarios) passes
- `shellcheck install.sh` reports no errors
- `wezterm-mux-server --version` and `wezterm --version` succeed inside test containers
- Runtime directory `/run/user/<uid>` exists with correct ownership when `createRuntimeDir=true`
- Runtime directory is absent when `createRuntimeDir=false`

**Constraints:**
- Do not modify the lace Dockerfile yet; the feature must be published before the Dockerfile can reference it.
- Keep `install.sh` POSIX-compatible (no bashisms).
- Do not implement RPM or AppImage paths yet; they are Phase 1b.

Dependencies: Phase 0 (GHCR prerequisites verified).

### Phase 1b: Cross-platform support (deferred)

> This phase is deferred until after Phase 3 (Dockerfile migration). The Debian-only feature is sufficient for the lace devcontainer, which uses a Debian base image. Cross-platform support broadens the feature's utility for other consumers but is not on the critical path.

When ready, Phase 1b adds:

1. **RPM path** (`install_from_rpm`): Fedora/RHEL support via `rpm2cpio | cpio` extraction. The RPM filename includes a Fedora version suffix (e.g., `fc39`) that varies between releases; the script tries the versioned name with a generic fallback. Only Fedora is directly tested; openSUSE and other RPM distros route to the AppImage fallback.

2. **AppImage path** (`install_from_appimage`): Universal glibc fallback via `--appimage-extract`. x86_64 only. Includes musl/Alpine detection with a clear error message (wezterm does not publish musl-compatible binaries).

3. **Additional test scenarios**: `fedora_39` (RPM primary path), `fedora_41` (RPM fallback path), `archlinux` (AppImage path).

Key implementation details for Phase 1b:
- The RPM path must handle the Fedora URL naming convention. Since the exact Fedora version may vary, the script should try common patterns with fallback.
- AppImage extraction via `--appimage-extract` produces a `squashfs-root/` directory. The binaries are at `squashfs-root/usr/bin/`.
- Alpine/musl detection should happen early in `install_from_appimage` to exit with a clear error before attempting extraction.
- RPM extraction should use a subshell for `cd` to avoid changing the parent process working directory.

**Success criteria for Phase 1b:**

- All Phase 1a scenarios continue to pass
- `devcontainer features test --features wezterm-server` passes for Fedora 39, Fedora 41 (RPM fallback), and Arch Linux (AppImage)
- Alpine triggers a clear error message, not a confusing dynamic linker failure

Dependencies: Phase 3 (Dockerfile migration complete, proving the Debian path end-to-end).

### Phase 2: CI/CD workflows

Set up GitHub Actions for automated testing and publishing.

#### Step 2.1: Test workflow

Create `.github/workflows/devcontainer-features-test.yaml`:

```yaml
name: "Test Devcontainer Features"
on:
  pull_request:
    paths:
      - 'devcontainers/features/**'
  push:
    branches: [main]
    paths:
      - 'devcontainers/features/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: "Install devcontainer CLI"
        run: npm install -g @devcontainers/cli

      - name: "Test wezterm-server feature"
        run: |
          cd devcontainers/features
          devcontainer features test --features wezterm-server
```

#### Step 2.2: Release workflow

Create `.github/workflows/devcontainer-features-release.yaml`:

```yaml
name: "Release Devcontainer Features"
on:
  push:
    branches: [main]
    paths:
      - 'devcontainers/features/src/**'

permissions:
  packages: write
  contents: write
  pull-requests: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: "Publish features"
        uses: devcontainers/action@v1
        with:
          publish-features: "true"
          base-path-to-features: "./devcontainers/features/src"
          features-namespace: "weftwiseink/devcontainer-features"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: "Create generated docs PR"
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "docs: auto-generate devcontainer feature docs"
          title: "Auto-generated devcontainer feature docs"
          branch: "auto-docs/devcontainer-features"
```

#### Step 2.3: GHCR permissions setup

Verified during Phase 0. The `weftwiseink` GitHub organization must have:
- GitHub Packages enabled
- The repository's Actions workflows must have `packages: write` permission (configured in the workflow yaml above and optionally in repository Settings > Actions > General > Workflow permissions)

See `cdocs/reports/2026-01-31-ghcr-publishing-prerequisites.md` for the full setup checklist.

#### Step 2.4: Verification

1. Open a PR that modifies `devcontainers/features/src/wezterm-server/install.sh` (e.g., whitespace change).
2. Verify the test workflow triggers and passes.
3. Merge the PR to `main`.
4. Verify the release workflow triggers and publishes the OCI artifact.
5. Verify the feature is pullable: `devcontainer features info ghcr.io/weftwiseink/devcontainer-features/wezterm-server`

**Debug workflow when CI fails:**

- **Test job fails:** Read the full log. Most failures will be identical to local test failures. The CI environment is `ubuntu-latest` which has Docker pre-installed.
- **Publish job fails with 403:** GHCR permissions issue. Check that the workflow has `packages: write` permission and that the `weftwiseink` org has packages enabled. See GHCR prerequisites report for troubleshooting.
- **Publish job fails with "namespace not found":** The `features-namespace: "weftwiseink/devcontainer-features"` requires the namespace to be writable. This should have been verified during Phase 0's dummy feature smoke test.
- **Generated docs PR fails:** The `peter-evans/create-pull-request` action requires `contents: write` and `pull-requests: write` permissions.

**Success criteria for Phase 2:**

- Test workflow triggers on PRs modifying `devcontainers/features/**`
- Release workflow publishes the feature OCI artifact to GHCR on merge to main
- The feature is pullable via `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`
- The feature info shows the correct version, description, and options

Dependencies: Phase 1a (feature files must exist for workflows to test/publish).

### Phase 3: Migrate lace Dockerfile

This phase is shared with the feature-based-tooling migration (`cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md`, Phase 3).
It should be implemented as part of that workstream's Phase 3 to avoid duplicating the migration effort.

Once the feature is published to GHCR:

#### Step 3.1: Add feature to devcontainer.json

Add to the `features` block in `.devcontainer/devcontainer.json`:

```json
"ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
    "version": "20240203-110809-5046fc22"
}
```

#### Step 3.2: Remove Dockerfile wezterm blocks

Remove from `.devcontainer/Dockerfile`:
- `ARG WEZTERM_VERSION="20240203-110809-5046fc22"` and the entire `RUN` block that downloads and extracts the `.deb` (lines 97-110 approximately)
- `RUN mkdir -p /run/user/1000 && chown ${USERNAME}:${USERNAME} /run/user/1000` (runtime directory, now handled by the feature)
- `RUN mkdir -p /home/${USERNAME}/.ssh ...` (SSH directory setup). Verify first that the `sshd` feature creates per-user `.ssh` directories for `_REMOTE_USER`; if it does not, this line must be retained or moved into the wezterm-server feature

#### Step 3.3: Verification

Rebuild the devcontainer from scratch and verify:

1. **Feature installation**: During container build, the feature install log should show wezterm downloading and installing.
2. **Binary presence**: `wezterm-mux-server --version` and `wezterm --version` succeed.
3. **Mux server startup**: The `postStartCommand` (`wezterm-mux-server --daemonize 2>/dev/null || true`) succeeds.
4. **SSH domain connectivity**: From the host, verify SSH connection to port 2222 works and wezterm multiplexing is functional.
5. **Runtime directory**: `/run/user/1000` exists and is owned by the `node` user.
6. **No regressions**: Run existing development workflows (`pnpm install`, `pnpm build:electron`, `pnpm test:e2e`) to verify nothing is broken.

**Debug workflow if migration fails:**

- **Feature not found during build:** Check that the feature was actually published to GHCR. Run `devcontainer features info ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` from the host.
- **wezterm-mux-server not on PATH:** The feature installs to `/usr/local/bin/`. Verify the feature's install script ran (check container build logs). If it ran but binaries are missing, the extraction path may differ for the specific wezterm version.
- **Mux server fails to start:** Check `XDG_RUNTIME_DIR` is set correctly. The `postStartCommand` runs as the `node` user; verify `/run/user/1000` exists and is owned by `node`.
- **SSH connectivity broken:** Verify `sshd` feature is still in the features list and running. Check `authorized_keys` mount is still in place.

**Success criteria for Phase 3:**

- The lace devcontainer builds and starts correctly using the published feature
- `wezterm-mux-server --daemonize` succeeds
- SSH domain multiplexing from the host continues to work
- Dockerfile is shorter by ~15-20 lines
- No regressions in existing development workflows

Dependencies: Phase 2 (feature must be published to GHCR).
Coordination: Align with feature-based-tooling migration Phase 3 to avoid duplicate effort.
