---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T18:30:00-08:00
task_list: lace/devcontainer-features
type: report
state: live
status: done
tags: [ghcr, github-actions, publishing, prerequisites, devcontainer-features]
---

# GHCR Publishing Prerequisites for Devcontainer Features

> BLUF: New org, minimal setup needed. Flip workflow permissions to read/write at the org level, set default package visibility to public, and run a dummy feature smoke test before real implementation.

## Settings to configure

### 1. Org Actions permissions

https://github.com/organizations/weftwiseink/settings/actions

- **Workflow permissions**: Set to "Read and write permissions"
- This grants GITHUB_TOKEN the `packages: write`, `contents: write`, and `pull-requests: write` scopes that `devcontainers/action@v1` needs

### 2. Org Packages defaults

https://github.com/organizations/weftwiseink/settings/packages

- **Default package visibility**: Set to "Public"
- Devcontainer features must be public for consumers to pull them

### 3. `features-namespace` (no setup needed)

The `features-namespace: "weftwiseink/devcontainer-features"` override in the workflow creates the OCI path `ghcr.io/weftwiseink/devcontainer-features/*` automatically on first publish. No pre-registration or namespace claiming required. The org owns everything under `ghcr.io/weftwiseink/*`.

## Smoke test

Before implementing the real feature, push a dummy feature via `workflow_dispatch` to verify the pipeline end-to-end:

1. Create a minimal `devcontainer-feature.json` + `install.sh` (just `echo "installed"`)
2. Trigger publish workflow manually
3. Verify package appears at https://github.com/orgs/weftwiseink/packages
4. Verify consumption: add `"ghcr.io/weftwiseink/devcontainer-features/dummy-test:0.0.1": {}` to a test `devcontainer.json`
5. Delete the dummy package and test artifacts

## Post first real publish

After publishing each feature, link the package back to the `weftwiseink/lace` repo (Package Settings > Connect repository) for discoverability.
