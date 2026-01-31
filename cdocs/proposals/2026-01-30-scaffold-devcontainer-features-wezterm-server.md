---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-30T18:30:00-08:00
task_list: lace/devcontainer-features
type: proposal
state: live
status: implementation_ready
tags: [devcontainer-features, wezterm, ci-cd, publishing, infrastructure, oci-namespace]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-30T19:00:00-08:00
  round: 2
---

> NOTE(mjr): Main things I see that could be issues here:
> - Because our setup also depends on sshd we should depend on it.
> - We sould spin off an rfp on how to add more secure ssh key auto-management to the lace cli being dev'd in parallel
> - We should make an effort to make our feature cross-platform like other features do

# Scaffold devcontainers/features/ with Wezterm Server Feature

> BLUF: Extract the wezterm-mux-server installation logic from the lace Dockerfile into a standalone devcontainer feature published at `ghcr.io/weft/devcontainer-features/wezterm-server`, following the structure and CI/CD patterns established by the [anthropics/devcontainer-features](https://github.com/anthropics/devcontainer-features) repository.
> The feature directory lives at `devcontainers/features/` within the lace monorepo rather than in a separate repository, with GitHub Actions workflows handling test, validation, and GHCR publishing via the official `devcontainers/action@v1`.
> Phase 1 delivers the wezterm-server feature and directory scaffold; Phase 2 adds CI/CD; Phase 3 migrates the Dockerfile; Phase 4 adds additional features (neovim-appimage, nushell, git-delta).
> The `devcontainers/action@v1` `features-namespace` input enables publishing to the `ghcr.io/weft/devcontainer-features/*` namespace from the monorepo.

## Objective

The lace project's Dockerfile contains inline installation logic for wezterm-mux-server that is non-trivial: it downloads the `.deb`, extracts binaries without installing GUI dependencies, and sets up runtime directories.
This logic should be reusable by any devcontainer, not locked inside a single Dockerfile.
Publishing it as a devcontainer feature at `ghcr.io/weft/devcontainer-features/wezterm-server` makes it installable with a single JSON line in any `devcontainer.json`.

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

The current Dockerfile (`.devcontainer/Dockerfile`, lines 112-125) installs wezterm headlessly.
The version `20240203-110809-5046fc22` is the latest stable release as of the Dockerfile's authoring and is the proven-working version in the lace devcontainer:

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

The `devcontainer.json` also starts the mux server via `postStartCommand` and exposes port 2222 for SSH domain connections.

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

> NOTE(opus/lace-devcontainer-features): If monorepo workflow complexity becomes burdensome, the features can be extracted into a separate `weft/devcontainer-features` repository, which would also simplify the OCI namespace (eliminating the need for the `features-namespace` override).

### devcontainer-feature.json

```json
{
    "name": "Wezterm Server",
    "id": "wezterm-server",
    "version": "1.0.0",
    "description": "Installs wezterm-mux-server and wezterm CLI for headless terminal multiplexing via SSH domains. Extracts from .deb to avoid X11/Wayland GUI dependencies.",
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
    "documentationURL": "https://github.com/weft/lace/tree/main/devcontainers/features/src/wezterm-server",
    "licenseURL": "https://github.com/weft/lace/blob/main/LICENSE",
    "installsAfter": [
        "ghcr.io/devcontainers/features/common-utils"
    ]
}
```

### install.sh

The install script translates the existing Dockerfile logic into a portable POSIX shell script:

```sh
#!/bin/sh
set -eu

VERSION="${VERSION:-20240203-110809-5046fc22}"
CREATERUNTIMEDIR="${CREATERUNTIMEDIR:-true}"

# Verify required tools
command -v curl >/dev/null 2>&1 || { echo "Error: curl is required. Install it or add ghcr.io/devcontainers/features/common-utils."; exit 1; }
command -v dpkg >/dev/null 2>&1 || { echo "Error: dpkg is required. This feature only supports Debian/Ubuntu-based images."; exit 1; }

ARCH=$(dpkg --print-architecture)
if [ "$ARCH" = "amd64" ]; then
    DEB_NAME="wezterm-${VERSION}.Debian12.deb"
else
    DEB_NAME="wezterm-${VERSION}.Debian12.${ARCH}.deb"
fi

echo "Installing wezterm-mux-server and wezterm CLI (version: ${VERSION}, arch: ${ARCH})..."

# Download and extract without installing (avoids GUI dependency chain)
curl -fsSL -o /tmp/wezterm.deb \
    "https://github.com/wez/wezterm/releases/download/${VERSION}/${DEB_NAME}"
dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract

install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/
install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/

rm -rf /tmp/wezterm.deb /tmp/wezterm-extract

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

### test.sh

```sh
#!/bin/bash
set -e

source dev-container-features-test-lib

check "wezterm-mux-server installed" command -v wezterm-mux-server
check "wezterm cli installed" command -v wezterm
check "wezterm-mux-server version" wezterm-mux-server --version
check "runtime dir exists" test -d /run/user/1000

reportResults
```

### scenarios.json

```json
{
    "basic": {
        "image": "mcr.microsoft.com/devcontainers/base:debian",
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

### Lace Dockerfile migration

After the feature is published, the lace `devcontainer.json` replaces the Dockerfile's inline wezterm logic with:

```json
"features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/weft/devcontainer-features/wezterm-server:1": {
        "version": "20240203-110809-5046fc22"
    }
}
```

The corresponding Dockerfile lines (ARG WEZTERM_VERSION through the `rm -rf` cleanup, plus the runtime dir and SSH dir setup) are removed.

### Publishing namespace

By default, `devcontainers/action@v1` derives the OCI namespace from the source repository: `ghcr.io/<owner>/<repo>/<feature-id>`.
For the `weft/lace` monorepo, this would produce `ghcr.io/weft/lace/wezterm-server`.
To publish under the preferred `ghcr.io/weft/devcontainer-features/wezterm-server` address instead, the release workflow uses the action's `features-namespace` input:

```yaml
- uses: devcontainers/action@v1
  with:
    publish-features: "true"
    base-path-to-features: "./devcontainers/features/src"
    features-namespace: "weft/devcontainer-features"
```

The `base-path-to-features` parameter points to `devcontainers/features/src` (relative to repo root), and `features-namespace` overrides the default `weft/lace` namespace.

## Important Design Decisions

### Decision 1: Monorepo subdirectory vs. separate repository

**Decision:** Place features under `devcontainers/features/` within the lace repo.

**Why:** The lace project is the primary consumer of these features.
Co-location keeps the feature source next to the Dockerfile that currently contains the logic, making it easy to iterate and test during initial development.
The anthropics pattern uses a dedicated repo, but that makes more sense for a widely shared feature.
The `devcontainers/action@v1` supports a `features-namespace` input that overrides the default `<owner>/<repo>` OCI namespace, so the monorepo can still publish to the preferred `ghcr.io/weft/devcontainer-features/*` address.
If the features grow to serve multiple unrelated projects, they can be extracted into a dedicated `weft/devcontainer-features` repository later.

### Decision 2: Extract from .deb rather than apt-get install

**Decision:** Continue the `dpkg -x` extraction approach rather than `dpkg -i` or `apt-get install`.

**Why:** The wezterm `.deb` package pulls in X11, Wayland, and GUI toolkit dependencies via `dpkg -i`.
In a headless devcontainer, these are unnecessary bloat (100+ MB of dependencies).
Extracting only `wezterm-mux-server` and `wezterm` binaries via `dpkg -x` avoids the dependency chain entirely.
This is an established, tested pattern already proven in the lace Dockerfile.

### Decision 3: Use _REMOTE_USER for runtime directory ownership

**Decision:** Use the devcontainer spec's `_REMOTE_USER` variable instead of hardcoding `node` or `1000`.

**Why:** Devcontainer features should be portable across base images with different default users.
The `_REMOTE_USER` and `_REMOTE_USER_HOME` environment variables are set by the devcontainer runtime during feature installation, providing the correct user context.
This is more portable than the current Dockerfile's hardcoded `${USERNAME}` approach.

### Decision 4: Debian-only .deb extraction

**Decision:** The initial feature only supports Debian/Ubuntu-based containers (architectures: amd64, arm64).

**Why:** Wezterm publishes `.deb` packages for Debian and Ubuntu.
The `dpkg -x` extraction approach is Debian-specific.
Alpine, Fedora, and other base images would require different installation paths (AppImage, tarball, or building from source).
The vast majority of devcontainers use Debian or Ubuntu base images, so this covers the common case.
Support for other distributions can be added later by detecting the OS in `install.sh`.

### Decision 5: Workflows at repo root with path filters

**Decision:** Place the actual GitHub Actions workflow files at `.github/workflows/` (repo root) with `paths:` triggers scoped to `devcontainers/features/**`.

**Why:** GitHub Actions only reads workflow files from `.github/workflows/` at the repository root.
Placing workflow files in a subdirectory `.github/` would have no effect.
Path-scoped triggers ensure workflows only run when feature source changes, avoiding unnecessary CI runs for unrelated lace changes.

## Edge Cases / Challenging Scenarios

### Wezterm release URL format changes

Wezterm's `.deb` naming convention differs between amd64 (no arch suffix) and arm64 (`.arm64.deb` suffix).
If future releases change this pattern, the install script breaks silently (curl returns 404, `dpkg -x` fails on the empty/error file).
Mitigation: the install script uses `set -eu` so curl's `-f` flag will fail the script on HTTP errors.
The test matrix should cover both amd64 and arm64.

### Non-standard UID for runtime directory

The `createRuntimeDir` option creates `/run/user/${USER_ID}` based on the resolved `_REMOTE_USER`.
If the container runs as root (UID 0), the path becomes `/run/user/0`, which some tools may not expect.
Mitigation: this is a known devcontainer pattern and wezterm handles it correctly via the `XDG_RUNTIME_DIR` environment variable.

### Feature ordering and installsAfter

The feature declares `installsAfter: ["ghcr.io/devcontainers/features/common-utils"]` to ensure basic utilities (curl, etc.) are available.
If a base image already has curl, this dependency is satisfied implicitly.
If a user omits common-utils and uses a minimal base image without curl, the feature fails at the `curl` invocation.
Mitigation: the install script checks for `curl` and `dpkg` at startup and produces a clear error message with guidance (suggesting `common-utils` or noting the Debian/Ubuntu requirement).

### GHCR publishing permissions

Publishing to `ghcr.io/weft/devcontainer-features/` requires the `weft` GitHub organization to have packages enabled and the repository's GITHUB_TOKEN to have `packages: write` permission.
If the org doesn't exist or permissions are misconfigured, the release workflow fails.
Mitigation: document the one-time org/repo setup in the feature README.

## Implementation Phases

### Phase 1: Directory scaffold and wezterm-server feature

Create the directory structure and feature files:

1. Create `devcontainers/features/src/wezterm-server/devcontainer-feature.json` with the schema defined above.
2. Create `devcontainers/features/src/wezterm-server/install.sh` translating the Dockerfile logic to a portable POSIX script using `_REMOTE_USER` and feature options.
3. Create `devcontainers/features/test/wezterm-server/test.sh` and `scenarios.json`.
4. Verify `install.sh` works by running `devcontainer features test -f wezterm-server` locally against a Debian base image.

Success criteria:
- `devcontainer features test -f wezterm-server -i debian:bookworm devcontainers/features/` passes.
- `wezterm-mux-server --version` succeeds inside the test container.
- `wezterm --version` succeeds inside the test container.

Constraints:
- Do not modify the lace Dockerfile yet; the feature must be published before the Dockerfile can reference it.
- Keep `install.sh` POSIX-compatible (no bashisms).

### Phase 2: CI/CD workflows

Set up GitHub Actions for automated testing and publishing:

1. Create `.github/workflows/devcontainer-features-test.yaml` with `paths: [devcontainers/features/**]` trigger, running `devcontainer features test` across a matrix of base images (debian:bookworm, ubuntu:latest, mcr.microsoft.com/devcontainers/base:debian).
2. Create `.github/workflows/devcontainer-features-release.yaml` using `devcontainers/action@v1` to publish to GHCR on push to main, scoped to `devcontainers/features/**` path changes.
3. Configure GHCR publishing permissions in the repository settings.
4. Verify end-to-end: push a change to the feature source, confirm the test workflow runs, confirm the release workflow publishes to `ghcr.io/weft/devcontainer-features/wezterm-server`.

Success criteria:
- Test workflow triggers on PRs modifying `devcontainers/features/**`.
- Release workflow publishes the feature OCI artifact to GHCR on merge to main.
- The feature is pullable via `ghcr.io/weft/devcontainer-features/wezterm-server:1`.

Dependencies: Phase 1 (feature files must exist for workflows to test/publish).

### Phase 3: Migrate lace Dockerfile

Once the feature is published:

1. Replace the wezterm installation block in `.devcontainer/Dockerfile` with a feature reference in `.devcontainer/devcontainer.json`.
2. Remove the runtime directory and SSH directory setup from the Dockerfile (handled by the feature's `createRuntimeDir` option and existing sshd feature).
3. Verify the devcontainer builds, starts, and functions correctly.

Success criteria:
- The lace devcontainer builds and starts correctly using the published feature instead of inline Dockerfile logic.
- `wezterm-mux-server --daemonize` succeeds in the running container.
- SSH domain multiplexing from the host continues to work.

Dependencies: Phase 2 (feature must be published to GHCR before the Dockerfile can reference it).

> NOTE(mjr): The "feature-based-tooling" proposal is now being worked on in parallel, so we should factor that into our workstream here

### Phase 4: Additional features

Scope and implement additional devcontainer features extracted from the Dockerfile:

1. **neovim-appimage**: Extract the neovim tarball installation logic (lines 97-106 of the Dockerfile) into a feature with a `version` option.
2. **nushell**: Package nushell installation as a feature.
3. **git-delta**: Extract the git-delta `.deb` installation (lines 87-90) into a feature.
4. Each feature follows the same structure: `devcontainer-feature.json`, `install.sh`, `test.sh`, `scenarios.json`.

> NOTE(mjr): This can be cut -we'll let other workstreams focus on this

Success criteria:
- Each feature passes `devcontainer features test` against the standard base image matrix.
- The lace Dockerfile is progressively simplified as features replace inline installation logic.

Dependencies: Phase 3 (migration validates the pattern end-to-end before scaling to additional features).
