---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-05T17:10:00-07:00
task_list: lace/prebuild-cache-rethink
type: proposal
state: live
status: request_for_proposal
tags: [prebuild, caching, architecture, future_work, open_design, rfp]
---

# Rethink the lace.local/* Prebuild Caching Mechanism

> BLUF(opus/prebuild-cache-rethink): The current `lace.local/<image>:<tag>` scheme tags prebuild images solely by their `FROM` line, so any two projects sharing a base image silently overwrite each other's bake.
> A real failure on 2026-05-05 (whelm vs. weftwise) confirmed this is not a theoretical concern.
> This RFP requests a proposal that reconsiders the whole mechanism — tag identity, storage backend, layer reuse philosophy, and cache validation — with no obligation to stay within current devcontainer-spec primitives.
>
> - **Motivated By:** [`cdocs/reports/2026-05-05-prebuild-tag-collision-incident.md`](../reports/2026-05-05-prebuild-tag-collision-incident.md)
> - **Related (narrower) RFP:** [`cdocs/proposals/2026-01-31-smart-prebuild-cache-busting.md`](./2026-01-31-smart-prebuild-cache-busting.md) — addresses cache *invalidation logic* within the current tag scheme; this RFP supersedes its scope.
> - **Companion options report:** [`cdocs/reports/2026-05-05-prebuild-cache-system-options.md`](../reports/2026-05-05-prebuild-cache-system-options.md) (to be written next; provides the design exploration this RFP asks for).

## Objective

Replace the current prebuild image cache mechanism with a design that:

1. Eliminates the cross-project tag collision class structurally (not by patching the cache-hit check).
2. Preserves or improves the performance benefit prebuild was introduced to deliver.
3. Has a defensible operational story for cleanup, drift detection, and migration of existing `.lace/prebuild/` directories.
4. Stays simple enough to reason about end-to-end without a separate cache-management subsystem.

The user has explicitly opened the design space: adherence to devcontainer-spec primitives is no longer a hard constraint.
The proposal should treat the current scheme as one option among many, not as the baseline.

## Scope

The full proposal must compare options along these axes and produce a recommendation (or a layered combination):

### Tag identity
- Per-project namespace (`lace.local/<projectName>/<image>:<tag>`) — cheapest fix, eliminates collisions, sacrifices cross-project sharing.
- Content-hashed (`lace.local/<image>:<tag>-<hash(features+dockerfile+args)>`) — preserves sharing when feature sets agree, otherwise distinct.
- Hybrid (default content-hash, fall back to per-project on hash failure or explicit opt-out).
- Drop tags entirely; rely on a content-addressed store outside the runtime registry.

### Storage backend
- Continue leaning on the container runtime's image store (current).
- Sidestep the registry entirely: an OCI layout directory under `~/.cache/lace/oci/`, materialised into the runtime as needed.
- Use podman volumes / overlay snapshots for prebuild artefacts, with the workspace image built thin on top.
- Pre-fetch feature tarballs (raw devcontainer feature OCI artefacts) and let the build assemble per-project — no cached intermediate image.

### Layer reuse philosophy
- Single shared base image with all features baked in (current).
- Per-feature OCI layers, composed into a project image via a recipe (`FROM <base>` + ordered feature layers). Reusable across projects when the per-feature layer hash matches.
- Buildah-driven manual layer composition outside the Dockerfile pipeline.
- No prebuild at all: install features at container start (extension of what `lace-fundamentals-init` already does for runtime concerns).

### Cache validation
- Per-project context fingerprint + image-exists check (current).
- Read `devcontainer.metadata` label and verify every requested feature id is present after a cache hit.
- Run a probe inside the cached image (`command -v <init scripts>`) to assert build-time invariants before container start.
- Abandon caching for users on fast hardware; rebuild every time and accept the latency.

### Creative directions to explore (the user asked for an open mind)
- **Drop the prebuild concept entirely.** Use the runtime's own layer cache plus a content-addressed `.lace/cache/` of feature install bundles. No `lace.local/*` namespace, no project-shared tag.
- **Stop sharing across projects by default.** Treat per-project images as the baseline; promote sharing to an explicit opt-in optimisation.
- **Move feature install out of build time entirely.** Treat features as runtime initialisation: the image is stable, the features manifest at first start. Trades startup latency for zero collision and minimal cleanup surface.
- **OCI artefacts as the unit of cache.** Each feature is an OCI artefact (or layer); each project's prebuild is a recipe of artefact references plus an order. The runtime image store becomes a downstream consumer rather than the source of truth.

## Out of Scope

- The exit-127 surfacing of cache failures at postCreateCommand time.
  Covered separately under the short-term recommendations in the incident report (label verification on cache hit + invariant probe).
  Should be tackled as small fixes regardless of which broader direction this RFP's elaborated proposal picks.
- The "fast path for unchanged-config `lace up`" that skips `devcontainer up` when the fingerprint matches and the container is already running.
  Independent ergonomic improvement; deserves its own thread.
- Smart cache *invalidation* logic within the current tag scheme.
  Covered by [`cdocs/proposals/2026-01-31-smart-prebuild-cache-busting.md`](./2026-01-31-smart-prebuild-cache-busting.md).
  If the elaborated proposal here keeps the current scheme as one branch, it should harmonise with that RFP rather than duplicate it.

## Open Questions

1. **Sharing as goal or coincidence?** The current design treats cross-project image sharing as a desirable property. Is it actually load-bearing for any user workflow, or is it an emergent side-effect of using a single namespace?
   The answer informs whether per-project images (cheap) are sufficient, or whether content-addressed sharing (more complex) is justified.
2. **Storage budget.** The whelm `vsc-whelm-...` image is 3.8 GB; the prebuild base is 2.24 GB. With per-project images, a developer with 5 projects pays ~5x. Is that acceptable, or is it the constraint that forces sharing?
3. **Where does `devcontainer up` fit?** The current scheme exists partly because devcontainer CLI doesn't natively support a separate prebuild step. If lace stops using devcontainer CLI for the build path (or wraps it more thinly), more options open. How committed is lace to invoking `devcontainer up` for image construction vs. only for run-time orchestration?
4. **Migration story.** Existing users have `.lace/prebuild/` directories and `lace.local/*` images on disk. Does the proposal need a clean migration (auto-upgrade on first `lace up` after change), or is "delete `.lace/` and re-run" acceptable for a tool at this maturity stage?
5. **Cleanup ownership.** Whichever direction is chosen, who owns garbage-collecting stale artefacts? Lace? The runtime's normal prune flow? An explicit `lace cache prune`?
6. **Test surface.** The current scheme has integration tests against the per-project context comparison. Whatever replaces it needs an equivalent test surface, ideally covering the cross-project collision scenario explicitly.

## Prior Art

- `packages/lace/src/lib/dockerfile.ts:110-200` — current tag generation, parse, restore.
- `packages/lace/src/lib/prebuild.ts:50-280` — full prebuild pipeline including the cache-hit branch.
- `packages/lace/src/lib/up.ts:880-925` — how prebuild result feeds into `devcontainer up`.
- [`cdocs/reports/2026-05-05-prebuild-tag-collision-incident.md`](../reports/2026-05-05-prebuild-tag-collision-incident.md) — the failure mode that triggered this.
- [`cdocs/proposals/2026-01-31-smart-prebuild-cache-busting.md`](./2026-01-31-smart-prebuild-cache-busting.md) — narrower related RFP.
- [`cdocs/proposals/2026-02-04-prebuild-image-based-config-support.md`](./2026-02-04-prebuild-image-based-config-support.md) — accepted; image-based config support; defines current symmetric Dockerfile/image handling.
- [`cdocs/proposals/2026-03-11-rebuild-prebuild-before-validation.md`](./2026-03-11-rebuild-prebuild-before-validation.md) — related pipeline ordering work.
- Devcontainer CLI feature install reference: `@devcontainers/cli` 0.83.0 (`/var/home/linuxbrew/.linuxbrew/Cellar/devcontainer/0.83.0/`).
- OCI image spec, OCI artefact spec — relevant if the proposal explores layer-as-cache or artefact-as-cache models.
