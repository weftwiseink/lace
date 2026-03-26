---
first_authored:
  by: "@claude-opus-4-6-20251101"
  at: 2026-03-26T13:00:00-07:00
task_list: lace/podman-buildkit-fix
type: devlog
state: archived
status: done
tags: [podman, rootless, buildkit, devcontainer]
---

# Fix: rootless podman BuildKit /tmp corruption

> BLUF: BuildKit's `RUN --mount=type=bind` corrupts `/tmp` permissions (1777 to 755) in rootless podman/buildah, breaking `apt-get` GPG verification.
> Fixed by disabling BuildKit (`--buildkit never`) for all devcontainer CLI invocations and adding a defensive `chmod 1777 /tmp` in the project Dockerfile.

## Root cause

Rootless podman's overlay filesystem driver does not correctly preserve parent directory permissions when `RUN --mount=type=bind` creates an overlayfs mount at a subdirectory.
After a `RUN --mount=type=bind,...,target=/tmp/build-features-src/...` step writes to `/tmp` subdirectories, `/tmp` permissions change from `1777` (sticky + world-writable) to `755`.
The `_apt` user (used by apt for GPG verification) cannot create temp files in a 755 `/tmp`, causing `apt-get update` to fail with `Couldn't create temporary file /tmp/apt.conf.XXXXX for passing config to apt-key`.

This affects both the prebuild phase (feature installations on the base image) and the devcontainer up phase (Dockerfile build on top of the prebuild).

## Fix

Three changes:

1. **Dockerfile**: `RUN chmod 1777 /tmp` before `apt-get update` in `.devcontainer/Dockerfile`.
   Defensive fix for when the prebuild image has corrupted `/tmp`.

2. **prebuild.ts**: Pass `--buildkit never` to `devcontainer build`.
   Disables BuildKit, which avoids `RUN --mount=type=bind` entirely.
   The non-BuildKit codepath uses `COPY --from` instead, which does not corrupt `/tmp`.
   Also sets `BUILDAH_LAYERS=false` to prevent podman from caching stale `FROM scratch + COPY` layers.

3. **up.ts**: Pass `--buildkit never` to `devcontainer up`.
   Same rationale as prebuild.
   Also removes stale `dev_container_feature_content_temp` image before building.

## Issues encountered

The `--buildkit never` codepath in the devcontainer CLI (v0.83.0) has its own issue: it builds a `dev_container_feature_content_temp` scratch image to hold feature files, and podman caches this image even when the build context changes.
Mitigated by setting `BUILDAH_LAYERS=false` in the environment (disables podman layer caching) and removing the stale image before each build.

## Verification

`lace up` from a clean state (no prebuild image, no containers) completes successfully.
Container starts, `podman ps` shows it healthy with port 22426 mapped.
Container git version is 2.53.0 (meets the 2.48.0+ requirement for relativeworktrees).
