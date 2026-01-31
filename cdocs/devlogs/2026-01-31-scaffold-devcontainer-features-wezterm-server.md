---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T22:00:00-08:00
task_list: lace/devcontainer-features
type: devlog
state: live
status: review_ready
tags: [devcontainer-features, wezterm, implementation, phase-1a, phase-2]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T23:55:00-08:00
  round: 2
---

# Scaffold devcontainer features with Wezterm Server: Devlog

## Objective

Implement the accepted proposal `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`.

Create the `devcontainers/features/` directory structure with a wezterm-server devcontainer feature that extracts wezterm binaries from `.deb` packages for headless use. Set up CI/CD workflows for testing and publishing to GHCR.

Scope for this session: Phase 1a (Debian-only feature) and Phase 2 (CI/CD workflows). Phase 0 (GHCR prerequisites) is a human task (org settings). Phase 1b (cross-platform) and Phase 3 (Dockerfile migration) are deferred per the proposal.

## Plan

1. Create directory scaffold (`devcontainers/features/src/wezterm-server/`, `devcontainers/features/test/wezterm-server/`)
2. Write `devcontainer-feature.json` with options schema
3. Write `install.sh` (Debian-only with distro detection scaffolding)
4. Write `test.sh` and `scenarios.json` for Phase 1a scenarios
5. Create CI/CD workflows (test + release)
6. Run shellcheck on install.sh
7. Commit each logical unit

## Testing Approach

- `shellcheck install.sh` for POSIX compliance
- JSON validation of `devcontainer-feature.json`
- Local `devcontainer features test` if Docker is available (requires human to run)
- CI workflow will run scenario-based tests on PR

## Implementation Notes

- `install.sh` is a direct lift of the proven `.deb` extraction logic from the existing Dockerfile (lines 97-110), adapted to POSIX sh with distro detection scaffolding for future Phase 1b cross-platform support.
- Distro detection uses `/etc/os-release` sourcing with `ID` and `ID_LIKE` fallback. Non-Debian distros get a clear error message rather than a silent failure.
- Architecture detection uses `uname -m` (portable) instead of `dpkg --print-architecture` (Debian-only), per proposal guidance.
- The `no_runtime_dir` test scenario uses bare `debian:bookworm` (no devcontainer base image) to test the feature on a minimal image without `createRuntimeDir`.
- CI/CD workflows use `paths:` triggers scoped to `devcontainers/features/**` to avoid running on unrelated repo changes.
- Release workflow uses `features-namespace: "weftwiseink/devcontainer-features"` to publish under the preferred OCI namespace rather than the default `weftwiseink/lace/*`.

### Review round 1 fixes

Addressed all findings from `cdocs/reviews/2026-01-31-review-of-wezterm-server-feature-implementation.md`:

- **[blocking]** Created `no_runtime_dir.sh` scenario-specific test that asserts the runtime dir does NOT exist (shared `test.sh` would have failed for this scenario)
- Added `common-utils` feature to `no_runtime_dir` scenario so curl is available on bare `debian:bookworm`
- `detect_arch` now prints the unsupported architecture name to stderr before failing
- Test workflow now has explicit `permissions: contents: read`

## Changes Made

| File | Description |
|------|-------------|
| `devcontainers/features/src/wezterm-server/devcontainer-feature.json` | Feature metadata: options (version, createRuntimeDir), installsAfter deps |
| `devcontainers/features/src/wezterm-server/install.sh` | Debian-only installer with distro/arch detection scaffolding |
| `devcontainers/features/test/wezterm-server/test.sh` | Feature test: binary presence, version, runtime dir |
| `devcontainers/features/test/wezterm-server/no_runtime_dir.sh` | Scenario-specific test: asserts runtime dir absent |
| `devcontainers/features/test/wezterm-server/scenarios.json` | 4 test scenarios: debian, ubuntu, custom version, no runtime dir |
| `.github/workflows/devcontainer-features-test.yaml` | CI test workflow on PR/push with path trigger |
| `.github/workflows/devcontainer-features-release.yaml` | Release workflow: publish to GHCR on merge to main |
| `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md` | Status updated: `implementation_ready` -> `implementation_wip` |

## Verification

**shellcheck:**
```
shellcheck -e SC1091 install.sh  # SC1091: external source not followed (expected)
# Clean — no warnings or errors
```

**JSON validation:**
```
python3 -m json.tool devcontainer-feature.json  # valid
python3 -m json.tool scenarios.json              # valid
```

**Local container testing:**
Deferred to human operator — requires Docker daemon and `devcontainer` CLI:
```sh
cd devcontainers/features
devcontainer features test --features wezterm-server --base-image mcr.microsoft.com/devcontainers/base:debian
devcontainer features test --features wezterm-server  # all scenarios
```

**Remaining work (not in scope for this session):**
- Phase 0: Human must configure GHCR org settings per `cdocs/reports/2026-01-31-ghcr-publishing-prerequisites.md`
- Phase 1b: Cross-platform (RPM, AppImage) — deferred until Debian path validated in production
- Phase 3: Dockerfile migration — gated on feature being published to GHCR
