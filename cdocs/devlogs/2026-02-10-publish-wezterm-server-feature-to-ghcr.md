---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T09:30:00-08:00
task_list: lace/dogfooding
type: devlog
state: live
status: done
tags: [publish, ghcr, wezterm-server, auto-injection, ports, devcontainer]
---

# Publish wezterm-server v1.1.0 to GHCR and verify auto-injection

**Date:** 2026-02-10
**Scope:** GHCR publishing, dotfiles devcontainer workaround removal, lace auto-injection verification

## Context

The wezterm-server devcontainer feature was updated to v1.1.0 with two key additions:
- `hostSshPort` option (renamed from `sshPort` in a previous commit)
- `customizations.lace.ports` section declaring port metadata for auto-injection

However, the feature had not been published to GHCR since v1.0.0. This meant lace could not fetch the updated metadata from the registry, and auto-injection of `appPort` templates was non-functional for any config referencing `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`.

A workaround (commit `1e3103b` in dotfiles repo) added an explicit `appPort` template to the dotfiles devcontainer.json. This devlog covers publishing the updated feature, removing the workaround, and verifying auto-injection works end-to-end.

## Investigation

### GHCR state before publishing

The `:1` tag on GHCR pointed to v1.0.0 with only `version` and `createRuntimeDir` options. No `hostSshPort` or `customizations.lace.ports` existed in the OCI manifest annotations.

Verified via:
```
skopeo inspect --raw docker://ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1
devcontainer features info manifest ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1 --output-format json
```

### Publishing mechanism

The repo uses a GitHub Actions workflow (`.github/workflows/devcontainer-features-release.yaml`) that triggers on push to `main` when files under `devcontainers/features/src/**` change. It uses the `devcontainers/action@v1` action with `packages: write` permission.

Local publishing via `devcontainer features publish` was attempted but failed because the `gh` CLI token only has `repo` scope, not `write:packages`. GHCR returns 403 without a `WWW-Authenticate` header, which the devcontainer CLI's OCI client cannot handle.

### Resolution: push to trigger CI

Local `main` was 30 commits ahead of `origin/main`, including the feature metadata changes (commits `e9adaf0` and `2deab8d`). Pushing to origin triggered the release workflow.

## Changes

### GHCR publish
- Pushed 30 local commits to `origin/main`
- Release workflow (run `21875673265`) completed successfully in 13s
- GHCR `:1` tag updated to v1.1.0 with `hostSshPort` and `customizations.lace.ports`

### Dotfiles workaround removal
- Removed explicit `appPort` template from `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`
- The line `"appPort": ["${lace.port(wezterm-server/hostSshPort)}:2222"]` was the workaround
- Committed as `e47e2c8` in dotfiles repo

### Verification
- Cleared stale metadata cache entry (`~/.config/lace/cache/features/ghcr.io%2Fweftwiseink%2Fdevcontainer-features%2Fwezterm-server%3A1.json`)
- Ran `lace up --workspace-folder /home/mjr/code/personal/dotfiles --no-cache`
- Output confirmed: "Auto-injected port templates for: wezterm-server/hostSshPort"
- Generated `.lace/devcontainer.json` contains `"appPort": ["22425:2222"]` (asymmetric mapping)
- `docker ps` confirms port mapping `0.0.0.0:22425->2222/tcp`

## Key findings

1. **devcontainer CLI local publish requires `write:packages` scope** -- the `gh` CLI default token scopes (`repo`, `read:org`, etc.) are insufficient for GHCR pushes. The CI workflow uses `GITHUB_TOKEN` which gets scoped correctly by the workflow's `permissions` block.

2. **Auto-injection for prebuild features produces asymmetric appPort entries** -- `injectForPrebuildBlock` in `template-resolver.ts` generates `${lace.port(shortId/optionName)}:DEFAULT_PORT` entries, where DEFAULT_PORT comes from the feature metadata's option default value (2222 for sshd).

3. **The metadata cache TTL for floating tags (`:1`) is 24h** -- after publish, clearing the cache or using `--no-cache` is required to pick up changes immediately.

4. **Explicit `appPort` plus auto-injection would duplicate entries** -- removing the workaround was necessary to avoid duplicate port mappings. The auto-injection code does not check for existing appPort entries with the same template.
