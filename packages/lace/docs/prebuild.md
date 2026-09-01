# Migration: `lace prebuild` removed

> BLUF: `lace prebuild` (and the `restore` and `status` subcommands, plus the `customizations.lace.prebuildFeatures` config key) has been removed.
> Move the features you kept in `prebuildFeatures` into the top-level `features` map.
> Warm builds stay fast through the legacy builder's local layer cache, with no lace-side cache management.

The design rationale lives in [`cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md`](../../../cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md).

## What changed

Lace no longer pre-bakes features into a `lace.local/*` image before the build.
Instead, `lace up` invokes `devcontainer up --buildkit never` directly, and the legacy builder produces a local layer cache in the container runtime's normal storage.
Subsequent `lace up` runs reuse that cache automatically (measured 15x speedup on the heaviest project in the ecosystem: 234s cold, 16s warm).

Removed:
- The `lace prebuild`, `lace restore`, and `lace status` subcommands.
- The `customizations.lace.prebuildFeatures` configuration key.
- `lace.local/*` image tagging, `FROM`/`image` rewriting, and the `.lace/prebuild/` cache directory.

Retained:
- `--buildkit never` at the `devcontainer up` invocation (load-bearing on rootless podman: see `containers/buildah#6503`).
- The `dev_container_feature_content_temp` cleanup before each build (keeps the legacy builder's content cache stable).

## Migration steps

1. Move every entry from `customizations.lace.prebuildFeatures` into the top-level `features` map.

   Before:
   ```jsonc
   "customizations": {
     "lace": {
       "prebuildFeatures": {
         "ghcr.io/devcontainers/features/git:1": {},
         "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
       }
     }
   }
   ```

   After:
   ```jsonc
   "features": {
     "ghcr.io/devcontainers/features/git:1": {},
     "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
   }
   ```

   If lace sees a config that still declares `customizations.lace.prebuildFeatures`, `lace up` exits non-zero with an error pointing back at this migration.

2. Check for feature install env-order conflicts.
   Features now install *after* your Dockerfile's `ENV` and `RUN` directives, not before.
   Audit the Dockerfile for `ENV` directives that affect tooling a feature installs (common culprits: `NPM_CONFIG_*`, `PATH` overrides, `GOPATH`, `NODE_PATH`, `PYTHONUSERBASE`).
   See [`troubleshooting.md`](./troubleshooting.md#3-feature-install-env-order-conflicts) for the fix.

3. Run `lace up` and confirm the container starts and each feature's tooling is present.
   A second consecutive `lace up` should complete in well under the cold-build time (the warm layer cache is reused).

## One-time cleanup of stale artifacts

After migrating, remove the artifacts the old pipeline left behind:

```sh
podman rmi $(podman images -q "lace.local/*") 2>/dev/null  # one-time, per host
rm -rf .lace/prebuild                                       # one-time, per project
```

Cleanup of the layer cache itself uses standard host tooling (`podman image prune`); lace does not add a cache-management subcommand.
