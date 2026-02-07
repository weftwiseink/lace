---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-07T01:00:00-08:00
type: devlog
state: live
status: complete
tags: [migration, dotfiles, feature-awareness, port-allocation, dogfooding]
references:
  - cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
---

# Dotfiles Migration to Feature Awareness v2

## Objective

Migrate the dotfiles devcontainer from hardcoded port mapping to lace's feature awareness v2 paradigm, serving as the first real-world validation of the template resolver and port allocator.

## Context

The dotfiles devcontainer at `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json` used a hardcoded `appPort: ["22426:2222"]` mapping for the wezterm SSH connection. Lace's new feature awareness v2 replaces this with `${lace.port(featureId/optionName)}` template expressions that dynamically allocate stable ports from the 22425-22499 range.

## Work Performed

### 1. Bug fix: OCI manifest parsing in feature-metadata.ts

**Discovery:** Running `lace up` against the dotfiles directory failed immediately with:

```
Failed to fetch metadata for feature "ghcr.io/devcontainers/features/git:1": OCI manifest missing dev.containers.metadata annotation
```

**Root cause:** The `devcontainer features info manifest` CLI command wraps the OCI manifest under a `"manifest"` key:

```json
{
  "manifest": {
    "annotations": {
      "dev.containers.metadata": "..."
    }
  },
  "canonicalId": "ghcr.io/..."
}
```

But `feature-metadata.ts` was looking for `annotations` at the top level of the parsed JSON. The existing unit tests used the top-level format (no `"manifest"` wrapper), so this mismatch was never caught in tests.

**Fix:** Updated `fetchFromRegistry()` to check `manifest.manifest?.annotations` first, then fall back to `manifest.annotations` for backwards compatibility with the test fixtures. Committed as `fix(lace): handle nested manifest key in devcontainer CLI JSON output`.

### 2. Devcontainer.json migration

Changed the dotfiles devcontainer.json:

**Before:**
```jsonc
"appPort": ["22426:2222"],
```

**After:**
```jsonc
"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"],
```

This uses the asymmetric mapping pattern: lace allocates a host port dynamically, and the container-side sshd continues listening on 2222. The label `wezterm-server/sshPort` references the wezterm-server feature (which must exist in `features`) and uses `sshPort` as the semantic label for the port allocation.

Also completed the rename of `customizations.lace.plugins` to `customizations.lace.repoMounts` (which had been partially done in the source but not committed).

### 3. End-to-end verification

Ran `lace up --workspace-folder /home/mjr/code/personal/dotfiles` successfully. Verified:

- **Template resolution:** `${lace.port(wezterm-server/sshPort)}` resolved to port 22426
- **Generated config (.lace/devcontainer.json):**
  - `appPort: ["22426:2222"]` -- asymmetric mapping with dynamically allocated host port
  - `forwardPorts: [22426]` -- auto-generated for VS Code compatibility
  - `portsAttributes: { "22426": { "label": "wezterm-server/sshPort (lace)", "requireLocalPort": true } }` -- auto-generated
  - Repo mount for lace correctly resolved from settings override
- **Port assignments persisted:** `.lace/port-assignments.json` contains `wezterm-server/sshPort: 22426`
- **Container running:** Docker port mapping confirmed: `0.0.0.0:22426->2222/tcp`
- **SSH connectivity:** Successfully connected via `ssh -p 22426 vscode@localhost`
- **wezterm-mux-server:** Running inside the container (verified via `ps aux`)
- **Repo mount:** `/mnt/lace/repos/lace/package.json` accessible inside the container

### 4. Existing test suite

All 409 unit tests pass. The 7 failures in `docker_smoke.test.ts` are pre-existing (unrelated prebuild Docker integration issues).

## Design Observations

### Asymmetric mapping is correct for sshd

The sshd devcontainer feature always listens on port 2222 inside the container and does not accept a configurable port option. The symmetric port model (same port on host and container) described in the v2 proposal requires features to accept a `sshPort` option. Until the wezterm-server feature is updated to manage sshd's listening port (or a separate sshd configuration mechanism exists), asymmetric mapping (`${lace.port(...)}: 2222`) is the correct pattern.

### Auto-injection requires feature metadata updates

The v2 auto-injection pipeline (where users just declare `"wezterm-server:1": {}` and lace auto-injects the port template) requires the wezterm-server feature's `devcontainer-feature.json` to declare `customizations.lace.ports`. The current published feature does not have this metadata. For now, explicit template usage in `appPort` works correctly. Auto-injection will activate once the feature metadata is updated and republished.

### Port label format accommodates future changes

Using `wezterm-server/sshPort` as the label (even though `sshPort` is not currently a real option of the wezterm-server feature) is forward-compatible. When the feature gains a `sshPort` option, the same label will be used by auto-injection, maintaining port stability via the persisted assignments file.

## Commits

1. **lace repo:** `fix(lace): handle nested manifest key in devcontainer CLI JSON output` -- fixes OCI manifest parsing to handle the `"manifest"` wrapper from the devcontainer CLI
2. **dotfiles repo:** `feat(devcontainer): migrate to lace feature awareness v2 port allocation` -- replaces hardcoded port with `${lace.port()}` template, completes plugins-to-repoMounts rename

## Next Steps

- Update the wezterm-server `devcontainer-feature.json` to add `sshPort` option and `customizations.lace.ports` metadata, enabling zero-config auto-injection
- Add a unit test in `feature-metadata.test.ts` covering the nested `"manifest"` wrapper format from the real CLI
- Investigate symmetric port support: could the wezterm-server feature configure sshd to listen on the lace-allocated port?
