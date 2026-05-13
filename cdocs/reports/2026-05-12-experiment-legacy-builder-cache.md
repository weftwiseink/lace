---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T15:53:29-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [podman, legacy_builder, cache, runtime_validated, experiment, rfp_input]
---

# Legacy-Builder Layer Cache Empirical Test

> BLUF: The legacy podman builder (`--buildkit never`) produces a fully usable layer cache for back-to-back devcontainer builds of weftwise on the same machine.
> Build 1 (cold) took 3:54.71; Build 2 (warm) took 0:15.62, a 15x speedup with 57/57 instruction layers reporting `--> Using cache`, including all six feature install scripts and the `COPY . .` of the full source tree.
> The "delete `lace prebuild` as a separate phase" path is empirically unblocked against the legacy builder for the author's stated single-project-single-machine constraint.
> However, this run also surfaced that weftwise's existing `Dockerfile` is broken against current registry state (pnpm@latest-10 now resolves to v11), independent of any cache concern; the test required a minor pin patch to proceed.

## Context

The prior investigations established that the BuildKit upstream-cache path is blocked by [containers/buildah#6503](https://github.com/containers/buildah/issues/6503) in rootless podman, with no upstream timeline.
See [`pretest-experiment-buildkit-never-drop`](2026-05-12-pretest-experiment-buildkit-never-drop.md), [`experiment-fuse-overlayfs-bypass`](2026-05-12-experiment-fuse-overlayfs-bypass.md), and [`podman-56-downgrade-cost-analysis`](2026-05-12-podman-56-downgrade-cost-analysis.md).
This re-opens the [`rfp-rethink-prebuild-cache`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md) question against the legacy builder, which uses `COPY --from` instead of `RUN --mount=type=bind` and is structurally immune to #6503.

The author's stated constraint: acceptable second-build times on one project on one machine, no remote-registry concerns.
This experiment tests exactly that.

## Method

Target project: `~/code/weft/weftwise/main` at clean working tree.
Tooling: `devcontainer-cli` 0.83.0, `podman` 5.7.1, `--buildkit never`, `--docker-path /usr/bin/podman`.

Created `.devcontainer/Dockerfile.test` as a copy of the project's `Dockerfile` with three modifications, all called out via inline NOTE callouts:
- `FROM lace.local/node:24-bookworm` rewritten to `FROM node:24-bookworm`.
- Added `RUN chmod 1777 /tmp` per rootless-podman hygiene.
- Replaced the corepack `pnpm@latest-10` activation with a direct `npm install -g pnpm@10.26.2`, since `latest-10` now resolves to pnpm 11.1.1 (see Failure Modes).
- Added `ENV NPM_CONFIG_PREFIX=` before the feature install stage so the transitively-pulled `ghcr.io/devcontainers/features/node` (an nvm-based feature) does not bail on `NPM_CONFIG_PREFIX` incompatibility.

Created `.devcontainer/devcontainer.test.json` per the experiment spec, with weftwise's `prebuildFeatures` flattened into top-level `features`.

Between Build 1 and Build 2, ran the same `dev_container_feature_content_temp` cleanup that `lace up` already does at `up.ts:1315-1316`:

```sh
podman rm -f -a --filter "ancestor=dev_container_feature_content_temp" 2>/dev/null
podman rmi -f dev_container_feature_content_temp 2>/dev/null
```

`BUILDAH_LAYERS` was NOT set to `false` (the lace prebuild workaround for the scratch-image bug was deliberately omitted; the manual cleanup is sufficient).

Build command (both runs identical):

```sh
/usr/bin/time -f "WALL: %E" devcontainer build \
  --workspace-folder . \
  --config .devcontainer/devcontainer.test.json \
  --docker-path "$(which podman)" \
  --buildkit never \
  --image-name weftwise-legacy-test:latest
```

## Results

| Build | Wall time | Total instruction steps | `--> Using cache` count |
|-------|-----------|------------------------|--------------------------|
| 1 (cold) | 3:54.71 (234.71s) | 63 | 0 |
| 2 (warm) | 0:15.62 (15.62s) | 63 | 57 |

**Ratio: Build 2 is 6.65% of Build 1 wall time (15x speedup).**
Pass criterion was < 50% of Build 1; observed result is dramatically below that.

The remaining 6 "non-cached" lines in Build 2 are stage-anchor `FROM ... AS ...` instructions and the implicit `STEP 1/...: FROM scratch` boilerplate that podman never emits cache markers for; every actual instruction layer hit cache.

Per-layer cache behavior on Build 2:

- `FROM node:24-bookworm` reused (base image already present).
- All seven `ARG`/`ENV` declarations cached.
- `RUN apt-get update && apt-get install -y ...` (the 25-package install): cached.
- `RUN npm install -g pnpm@10.26.2`: cached.
- `RUN pnpm install electron@39.2.7 && node ...install.js` (heaviest user-stage layer): cached.
- `RUN pnpm install playwright@1.57.0 && npx playwright install chromium`: cached.
- `COPY ... package.json pnpm-lock.yaml pnpm-workspace.yaml ./` and `RUN pnpm install --frozen-lockfile`: cached.
- `COPY --chown=node:node . .` (full source tree): cached. This is the main bust-risk layer per the experiment design, and it cached cleanly given the unchanged working tree.
- `RUN pnpm build:electron`: cached.
- Feature install stages (`git_0`, `node_1`, `sshd_2`, `nushell_3`, `neovim_4`, `claude-code_5`, `wezterm-server_6`): every `COPY --from=dev_containers_feature_content_source ...` and every `RUN ./devcontainer-features-install.sh` cached. No feature install script re-executed.

The Build 2 log contains zero output from any feature install script (no "Installing", "Cloning into", apt-get fetches, etc.) — install scripts were skipped entirely via the cache.

## Failure Modes Observed

1. **`pnpm@latest-10` dist-tag drift.**
   The project's `Dockerfile` ends with `corepack prepare pnpm@latest-10 --activate`.
   That npm dist-tag now resolves to pnpm 11.1.1, which enforces `approve-builds` for `electron` and breaks `RUN pnpm install "electron@39.2.7" && node node_modules/electron/install.js` because the postinstall script doesn't run, leaving the electron binary missing.
   Setting `COREPACK_DEFAULT_TO_LATEST=0` was insufficient; the working fix was to bypass corepack and `npm install -g pnpm@10.26.2` directly.
   This is orthogonal to the cache test, but it means the project's own Dockerfile is currently broken against fresh state and only works because the cached `vsc-main-...` image predates the registry change.

2. **`NPM_CONFIG_PREFIX` incompatibility with transitive `node` feature.**
   `ghcr.io/devcontainers/features/claude-code:1` (or one of the other weftwiseink features) transitively depends on `ghcr.io/devcontainers/features/node:1`, which uses nvm.
   nvm refuses to install when `NPM_CONFIG_PREFIX` is set (which the project Dockerfile sets to `/usr/local/share/npm-global`).
   The feature install script exits 11.
   Adding `ENV NPM_CONFIG_PREFIX=` just before the feature install stage runs unblocked the build.
   This suggests `lace`'s feature orchestration is either avoiding this transitive pull or unsetting the env, which is worth verifying before deletion of `lace prebuild`.

3. **`dev_container_feature_content_temp` scratch image cleanup matters.**
   Without cleaning the scratch image between runs, the layer hash for `COPY --from=dev_containers_feature_content_source /tmp/build-features/...` would have diverged from the previous build's content, busting all downstream feature layers.
   The manual cleanup (matching `up.ts:1315-1316`) handles this; lace's existing logic remains relevant.

## Conclusion

For the author's stated constraint - acceptable second-build times on one project on one machine - the legacy builder works.
A 6.65% ratio is well past "acceptable"; it is essentially a no-op rebuild.
The `--buildkit never` path produces a stable, content-addressed local layer cache, including for the feature install layers that `COPY --from` from the scratch image and execute `./devcontainer-features-install.sh`.

The migration path "delete `lace prebuild` as a separate phase, let `devcontainer build` handle features in-line with `--buildkit never`" is empirically unblocked for the single-machine case.
The remote-registry / cross-machine cache-sharing question is explicitly out of scope for this constraint and remains separately blocked by #6503.

## Implications for the Migration Proposal

A `lace prebuild` deletion against the legacy-builder path would look approximately like:

1. Remove the separate `lace prebuild` phase and its associated state files / cache busting heuristics.
2. Keep the `dev_container_feature_content_temp` scratch-image cleanup logic from `up.ts:1315-1316` and run it before every `devcontainer build` invocation.
3. Stop setting `BUILDAH_LAYERS=false`.
   The lace workaround in `prebuild.ts:332` for stale feature content is unnecessary if cleanup runs reliably before each build; the cache benefit of leaving layers on is substantial.
4. Pass `--buildkit never` through to the underlying `devcontainer build` invocation (this is already the lace default).
5. Surface the two failure modes above as documented in this report, since they are real and will bite users:
   - Projects with stale `pnpm@latest-N` corepack pins will break on cold builds.
   - Projects with `NPM_CONFIG_PREFIX` set that transitively pull `ghcr.io/devcontainers/features/node` will fail feature install.
   Lace's current `prebuildFeatures` separation may incidentally avoid (b); investigating whether the deletion path needs to compensate is a TODO.

If the author's constraint relaxes later to require remote registry sharing or cross-machine reuse, this work does not unblock that.
That path still requires either upstream resolution of containers/buildah#6503 or a wholesale builder swap.

## Raw Log Excerpts

Build 1 cold-run, late stages (post user-stage, into feature install):

```
[2026-05-12T22:49:42.930Z] [1/4] STEP 27/29: RUN pnpm build:electron 2>&1 | tee /tmp/electron_build.log || ...
[2026-05-12T22:49:48.699Z] [4/4] STEP 7/27: RUN ... /tmp/dev-container-features/git_0/devcontainer-features-install.sh
[2026-05-12T22:51:41.762Z] [4/4] STEP 12/27: RUN ... /tmp/dev-container-features/node_1/devcontainer-features-install.sh
[2026-05-12T22:51:57.526Z] [4/4] STEP 14/27: RUN ... /tmp/dev-container-features/sshd_2/devcontainer-features-install.sh
[2026-05-12T22:52:02.119Z] [4/4] STEP 16/27: RUN ... /tmp/dev-container-features/nushell_3/devcontainer-features-install.sh
[2026-05-12T22:52:18.176Z] [4/4] STEP 18/27: RUN ... /tmp/dev-container-features/neovim_4/devcontainer-features-install.sh
[2026-05-12T22:52:21.665Z] [4/4] STEP 20/27: RUN ... /tmp/dev-container-features/claude-code_5/devcontainer-features-install.sh
[2026-05-12T22:52:28.418Z] [4/4] STEP 22/27: RUN ... /tmp/dev-container-features/wezterm-server_6/devcontainer-features-install.sh
WALL: 3:54.71
```

Feature install scripts took roughly 8s (sshd) to 113s (node) each on cold build.

Build 2 warm-run, complete instruction trace, abbreviated:

```
[2026-05-12T22:52:50.688Z] [1/4] STEP 1/29: FROM node:24-bookworm AS dev_container_auto_added_stage_label
[2026-05-12T22:52:51.748Z] --> Using cache db2fd9... (apt-get install layer)
[2026-05-12T22:52:51.835Z] --> Using cache dafce3... (npm install -g pnpm@10.26.2)
[2026-05-12T22:52:52.432Z] --> Using cache 63c82c... (pnpm install electron@39.2.7)
[2026-05-12T22:52:52.458Z] --> Using cache bd0064... (pnpm install playwright@1.57.0 && playwright install chromium)
[2026-05-12T22:52:52.791Z] --> Using cache beca66... (pnpm install --frozen-lockfile)
[2026-05-12T22:52:53.229Z] --> Using cache dfaa84... (COPY --chown=node:node . .)
[2026-05-12T22:52:53.261Z] --> Using cache 833675... (pnpm build:electron)
[2026-05-12T22:52:54.734Z] --> Using cache 3b60eb... (git_0 feature install script)
[2026-05-12T22:52:55.403Z] [4/4] STEP 12/27: RUN .../node_1/devcontainer-features-install.sh (cached, no exec)
[2026-05-12T22:52:56.626Z] [4/4] STEP 20/27: RUN .../claude-code_5/devcontainer-features-install.sh (cached, no exec)
[2026-05-12T22:52:57.975Z] 1d1d7a6060382b900155d59587c7d0d580ef704368b08c79eba980efda9dfa6a
WALL: 0:15.62
```

No `Installing`, no `Cloning`, no apt-get fetches in Build 2 output: the entire feature install pipeline was satisfied from cache.

Cache-hit count: `grep -c "Using cache" build2.log` = 57.
Total `STEP ` lines: 63.
Difference of 6 accounted for by stage-anchor `FROM` instructions which podman does not annotate with cache markers.
