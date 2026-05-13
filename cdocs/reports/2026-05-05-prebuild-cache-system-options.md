---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-05T17:25:00-07:00
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-7"
  at: 2026-05-06T10:00:00-07:00
  round: 2
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [prebuild, caching, architecture, design_exploration, options, future_work]
---

# Prebuild Cache System: Options for a Rethink

> BLUF: This report enumerates options for replacing or restructuring lace's `lace.local/*` prebuild cache along five orthogonal axes: tag identity, storage backend, layer reuse, when features install, and cache validation.
> The recommendation, given the project's solo-dev audience, OCI/devcontainer-spec tolerance, user-owned cleanup expectation, and "best design by default" cadence, is **Lens 3 / Bundle P5 (runtime-install pivot)**: stop treating prebuild as a build-time bake of features and instead lean further on the existing `lace-fundamentals-init` style of runtime initialisation, with `B4` pre-fetched feature tarballs as the only durable cache.
> P4 (layer-decomposed sharing via per-feature OCI layers) is the credible fallback if first-start latency under P5 turns out to exceed user tolerance.
> P0–P2 are documented as the "ship-something-cosmetic" bundles and are explicitly *not* recommended given the user's stated cadence preference.
>
> - Companion RFP: [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md)
> - Triggering incident: [`cdocs/reports/2026-05-05-prebuild-tag-collision-incident.md`](./2026-05-05-prebuild-tag-collision-incident.md)
> - Round-1 review: [`cdocs/reviews/2026-05-05-review-of-prebuild-cache-system-options.md`](../reviews/2026-05-05-review-of-prebuild-cache-system-options.md)

## Context

The current prebuild cache (see `packages/lace/docs/prebuild.md`) bakes feature installs into a single image tagged `lace.local/<image>:<tag>` derived from the original `FROM` line.
The 2026-05-05 incident demonstrated that this single-tag-per-base design is unsafe: any two projects with the same `FROM` but different prebuild feature sets silently overwrite each other.

The patch path inside the current scheme (verify image label after a cache hit, force rebuild on mismatch) is straightforward and is already in the incident report's short-term recommendations.
This report is for the longer conversation: *should the scheme stay at all*, and if so, in what shape.

The user has explicitly opened the design space.
Conformance to devcontainer-spec primitives is no longer a hard constraint, although interoperability with existing devcontainer tooling is still desirable where cheap.

## Author Guidance Applied (Round-1 Revision)

This revision incorporates the author's answers to the round-1 reviewer's multi-choice questions.
The answers re-shape what falls inside vs. outside scope:

1. **Audience scope: solo developer.** Sharing is coincidence, not a goal. Cleanup is per-laptop. Drives recommendation toward bundles that don't optimise for cross-team sharing.
2. **Non-OCI primitives: stay inside OCI/devcontainer.** Nix-style content-addressed stores (C5) and distrobox/toolbx-style persistent containers (C6) are explicitly out of scope. Custom OCI layer composition (C2/C3) remains in scope.
3. **Cleanup ownership: user-owned, devcontainer-conforming.** No `lace cache prune` subcommand; cleanup happens via the runtime's existing `podman image prune` for image-namespace artefacts and via `rm -rf ~/.cache/lace/` for any lace-side caches. No domain-specific lace cleanup tooling.
4. **Cadence: best design by default.** Not "smallest fix this week." The recommendation should commit to Lens 3 (reframe the problem) rather than Lens 1/2.

> NOTE(opus/lace/prebuild-cache-rethink): The reviewer flagged a missing **Axis F: Distribution scope** (host-local / user-shared / team registry / community).
> Per (1) the project is solo-dev with no team-centric ambitions, so axis F collapses to "host-local" and is not load-bearing for this report.
> If the project later acquires team or community users, axis F should be reopened in a follow-up.

> NOTE(opus/lace/prebuild-cache-rethink): The reviewer also flagged missing options C5 (Nix-style content-addressed store), C6 (distrobox/toolbx persistent containers), and a registry-sidecar storage backend B5.
> Per (2)(a) all three are out of scope and intentionally not enumerated below.

## Framing: Five Axes

Most discussion of "the cache" conflates five independent decisions.
Pulling them apart makes the trade space tractable:

| Axis | What it decides |
|---|---|
| **A. Tag identity** | How a built artefact is named, and therefore who can collide with whom. |
| **B. Storage backend** | Where the artefact physically lives. |
| **C. Layer reuse philosophy** | Whether the artefact is monolithic or decomposable, and whether components are shared across artefacts. |
| **D. When features install** | Build time vs. first container start vs. each container start. |
| **E. Cache validation** | How a cache hit is checked for correctness before being used. |

A complete proposal must take a position on all five.
The current scheme's choice on each is: A: per-FROM tag, B: container runtime image store, C: monolithic single image, D: build time, E: per-project context fingerprint + image-exists check.

## Axis A: Tag Identity

### A1. Per-FROM tag (current)
`lace.local/<image>:<tag>` derived from the original `FROM`.

- Pro: simple, human-readable.
- Pro: maximal cross-project sharing when feature sets coincidentally match.
- Con: collisions when feature sets differ (the incident).
- Con: silent overwrites; the most recent project to bake "wins" the tag.

### A2. Per-project namespace
`lace.local/<projectName>/<image>:<tag>`.

- Pro: collisions structurally impossible.
- Pro: minimal change to the tag generator and rewriting machinery.
- Con: zero sharing; a developer with N projects sharing a `FROM` pays N× disk and N× initial build.
- Note: in practice many lace projects probably want a similar but not identical feature set, so the realised cost is somewhere between the worst case and current.

### A3. Content-hashed tag suffix
`lace.local/<image>:<tag>-<hash(features+dockerfile+args)>`.

- Pro: shares automatically when feature sets actually agree.
- Pro: no collisions even when they don't.
- Pro: tag is self-describing for `podman images` triage.
- Con: more tags accumulate over time; per (3)(a) this becomes user-visible cruft in `podman images`. Acceptable but not pleasant.
- Con: hash inputs need a stable canonicalisation (feature ordering, default args) — design care required. The narrower [`2026-01-31-smart-prebuild-cache-busting RFP`](./2026-01-31-smart-prebuild-cache-busting.md) is the natural place for this canonicalisation work and should be pulled forward into any A3-shaped proposal.

### A4. Hybrid
Default to A3 (content-hashed); fall back to A2 (per-project) when an explicit opt-in is set, e.g., for projects that want hard isolation.

- Pro: covers both extremes without forcing a global choice.
- Con: two tag conventions in the same store; harder to reason about.

### A5. No tags at all
Identify cached artefacts by content digest only; resolve to local images on demand.
The runtime image store becomes a derived view, not the source of truth.

- Pro: nothing to collide with.
- Pro: straightforward `lace cache prune` semantics.
- Con: requires a layer between lace and the runtime; loses easy `podman images` discoverability.
- Con: per (3)(a), introduces a `lace cache prune` semantic the user has explicitly said they do not want. De-favoured.

### A6. Image digest references, no `lace.local/*` rewrite
Pin the prebuilt artefact via its content digest in the project's `Dockerfile` or `image` field (e.g. `FROM node@sha256:abc...`).
The runtime's pull-by-digest semantics handle disambiguation; nothing is "rewritten" because the digest is the identity.

- Pro: collisions structurally impossible, by the same mechanism that prevents two identically-tagged manifests from sharing a digest.
- Pro: no `lace.local/*` namespace at all; nothing for lace to garbage-collect.
- Con: the project's source-controlled `Dockerfile`/`devcontainer.json` now contains digests that must rotate when the prebuild rebuilds. Requires automated rewrite.
- Con: digests are opaque in `podman images`; users lose human-readable triage.

## Axis B: Storage Backend

### B1. Container runtime image store (current)
`lace.local/*` lives in podman/docker storage.
Cleanup is the user's `podman image prune`.

- Pro: zero new infra; the runtime already does layer dedup, GC, sharing.
- Con: shared namespace with everything else the user runs; tag collisions and accidental prunes are easy.
- Con: tied to a single runtime instance; cross-host portability requires registry push/pull.

### B2. OCI layout directory under `~/.cache/lace/oci/`
A standard OCI image layout (`oci-layout` + `index.json` + `blobs/`) on disk.
Materialise into the runtime via `podman load` or `skopeo copy oci:... containers-storage:...` only when a build/run needs it.

- Pro: completely under lace's control; no namespace pollution.
- Pro: portable; cross-host sharing is `rsync` or a registry sync.
- Pro: easy `lace cache prune` by manifest digest.
- Con: extra materialisation step on each use (cheap if blobs are already in the runtime store, otherwise a copy).
- Con: another moving part to test.

### B3. Podman volumes / overlay snapshots
Cache feature install state in podman volumes (or `containers-storage` overlay snapshots), composed into the workspace image at run time.

- Pro: leverages podman primitives we already depend on.
- Con: docker users (still nominally supported) lack equivalent volume-as-cache patterns.
- Con: harder to reason about; mounting versus baking has subtle implications for `--userns=keep-id` and uid remapping.

### B4. Pre-fetched feature tarballs only
No cached intermediate image at all.
Cache is just `~/.cache/lace/features/<sha>/<feature>.tar` (the OCI artefacts that devcontainer features ship as).
Each `lace up` runs a fresh build that consumes the local cache, skipping network.

- Pro: zero collision class.
- Pro: storage is bounded by the number of distinct features, not projects.
- Pro: the cache is human-inspectable and trivially prunable.
- Con: still pays the build CPU cost per project per feature change; only saves network.
- Con: doesn't help if the feature install itself is expensive (apt-get etc.) — only helps with the download.

## Axis C: Layer Reuse Philosophy

### C1. Monolithic image (current)
One image with all features baked in, treated as a single artefact.

- Pro: simple to think about.
- Con: zero internal reuse; adding one feature rebuilds the whole image.
- Con: forces axis A to choose how to scope the monolith.

### C2. Per-feature OCI layers, recipe-composed
Each feature becomes a content-addressed OCI layer.
A project image is `FROM <base>` + `<ordered feature layers>` composed by lace.
Layers are reused across projects whenever the per-feature install hash matches.

- Pro: maximum sharing without tag-level collisions.
- Pro: changing one feature rebuilds only that feature's layer.
- Con: requires lace to drive layer composition (buildah, custom builder, or unusual `devcontainer build` invocations).
- Con: feature install order matters; ordering must be canonicalised.
- Con: not every feature is layer-clean (some assume a writeable rootfs across multiple steps).

### C3. Buildah-driven explicit layers
Use `buildah` to construct images by `buildah from` / `buildah run` / `buildah commit`, with each feature install committed as its own layer.

- Pro: explicit, scriptable, no Dockerfile gymnastics.
- Con: introduces a hard buildah dependency for image construction (currently optional).
- Con: docker users on macOS lose this path.

### C4. No layer reuse, every project pays full cost
Drop the prebuild concept entirely.
Each `lace up` runs the standard devcontainer feature install fresh, relying only on the runtime's own layer cache (which deduplicates identical RUN steps automatically).

- Pro: simplest possible system.
- Pro: no lace-side cache to maintain.
- Con: feature downloads happen per project; first build is slow.
- Con: relies on podman/docker's automatic layer cache being good enough — empirically it can be flaky for `RUN curl | sh` patterns.

## Axis D: When Features Install

### D1. Build time, baked into image (current)
Features are part of the image. Container creation is fast; image build is slow.

- Pro: container start is `podman run` only.
- Con: every cache miss triggers a full image rebuild.
- Con: feature install runs as root in the build context; some features (chezmoi, dotfiles) actually want to run at runtime as the user.

### D2. First container start (lazy)
Image is the bare base.
A runtime init script (extending what `lace-fundamentals-init` already does) installs features the first time the container starts, marks completion in a volume.

- Pro: image cache problem largely disappears — the image is `FROM <base>` with no project-specific bake.
- Pro: features that already want runtime context (env vars, mounts) are first-class.
- Con: first start is much slower; users see "container created" then a long pause.
- Con: a stopped/recreated container loses install state unless the marker volume persists.
- Con: not all features tolerate runtime install (some assume root-only access available only in the build phase).

### D3. Hybrid: split features by install phase
Some features baked at build time (the ones that are slow + project-stable: language runtimes, system packages); others run at first start (the user-facing ones: chezmoi, git identity, dotfiles).

- Pro: matches the project's existing direction with `lace-fundamentals-init`, which already embodies the runtime-init pattern.
- Pro: shrinks the cached image to the heavy invariant parts; lighter parts move out and stop driving cache invalidation.
- Con: forces a classification of every feature; mistakes leak across the boundary silently.
- Con: two install pipelines to maintain.

The reviewer asked whether "build vs. runtime" is the only axis on which to slice. It is not — alternatives include:
- **By stability**: rebake-on-feature-rev (slow-changing) vs. on every start (fast-changing). Time-rate of change, not build/runtime.
- **By trust boundary**: features that need root vs. features that run as the user. Naturally maps to build vs. runtime, but the boundary is ownership, not phase.
- **By cost asymmetry**: features whose install is dominated by network (apt-get, npm install) vs. by CPU (compilation). Pre-fetched tarballs (B4) help only the former.
- **By failure mode**: features that fail loudly at build time (good) vs. silently at runtime (bad). The current bug puts a build-time invariant violation in the second bucket.

Picking among these slicings is a design decision the proposer should make explicitly rather than inheriting build/runtime by default.

### D4. Every container start (no install caching)
Features install every time a container is created.
No image-side cache, no first-start marker.

- Pro: no cache invalidation problem to solve.
- Con: dev iteration slows; recreating a container costs a full feature install.
- Likely only viable if combined with B4 (pre-fetched tarballs) so the network is at least cached.

## Axis E: Cache Validation

### E1. Per-project context fingerprint + image-exists (current)
Compare the project's `.lace/prebuild/.devcontainer/` to the temp build context.
On match, check the image tag exists.

- Con: the bug. Doesn't detect that another project overwrote the shared tag.

### E2. + Read `devcontainer.metadata` label
After a cache hit, inspect the tagged image's `devcontainer.metadata` label.
Confirm every requested feature id is present.
On mismatch, force rebuild and warn.

- Pro: closes the incident's root cause without changing the tag scheme.
- Pro: cheap (`podman inspect`).
- Con: relies on devcontainer CLI continuing to write that label correctly.
- Con: doesn't catch differences in *feature options* (e.g., same feature, different version pin).

### E3. + In-image probe
Run `podman run --rm <image> sh -c 'command -v lace-fundamentals-init && command -v <other expected scripts>'`.
Probes the post-install state directly.

- Pro: catches anything that should have been installed but wasn't.
- Con: requires a list of probes per feature; not all features install a named script.
- Con: a `podman run` per cache hit adds latency. Order-of-magnitude estimate based on local `podman run --rm <small-image> true` (typically 200-500 ms cold, 50-150 ms warm); the proposer should measure on representative hardware before committing.

### E4. Trust the cache
If the project's local context is unchanged and the tag exists, use it. Period.
Pair with strong tag identity (A2 or A3) so trust is justified.

- Pro: zero validation cost.
- Con: only safe if tag identity makes collisions impossible by construction.

## Forced-Pair Couplings Between Axes

The axes are independent in principle but not in practice; some choices on one axis force or strongly constrain choices on others:

- **C2 (per-feature OCI layers) → B2 or registry-like B**: composed layers need somewhere to live independent of any single project image. A pure B1 (runtime image store) approach can work if each layer is materialised as its own intermediate image, but cleanup gets messy.
- **D2 (runtime install) + C4 (no layer reuse) ≈ no prebuild at all**: combining these collapses the system to "vanilla devcontainer with a runtime init script." This is a coherent endpoint, not an accident.
- **E4 (trust the cache) requires A2 or A3**: trust without verification is only safe if tag identity makes collisions impossible by construction. Pairing E4 with A1 reproduces the current bug.
- **A6 (digest references) ≈ A5 (no tags) for runtime users** but with very different developer-facing ergonomics: A6 keeps the digest visible in source control; A5 hides identity entirely.
- **B4 (pre-fetched tarballs) is most useful with D2/D3 (runtime install)**: if the install runs at runtime, the tarball cache is the only durable artefact; if the install runs at build time, the tarball merely speeds up network on rebuilds without changing structure.

## Bundled Configurations (Concrete Combinations)

The axes above are independent in principle, but a few combinations form coherent design points.
The "podman images visibility" column captures what a user would see in their local image list under each bundle — the load-bearing operational signal under (3)(a) user-owned cleanup:

### Configuration P0: Minimal patch
A1 (current tag) + B1 (current store) + C1 (monolithic) + D1 (build time) + **E2** (+ label verification).

- Closes the incident.
- Doesn't address the underlying flip-flop pattern.
- Smallest possible change.

### Configuration P1: Per-project, no sharing
A2 (per-project tag) + B1 + C1 + D1 + E1.

- Eliminates collisions structurally.
- Loses cross-project sharing.
- Disk cost: ~3.8 GB × N projects in the whelm-style baseline.

### Configuration P2: Content-addressed sharing
A3 (content-hashed) + B1 + C1 + D1 + E2.

- Restores cross-project sharing only when feature sets actually agree.
- Adds a hash function (canonicalised feature spec) and a sweep policy.
- Probably the best "evolution-not-revolution" target.

### Configuration P3: Lace-owned cache
A5 (no tags) + B2 (OCI layout under `~/.cache/lace/oci/`) + C1 + D1 + E2.

- Fully decouples lace's cache from the runtime image namespace.
- Materialise into runtime only when needed.
- Most operationally clean; biggest engineering investment.

### Configuration P4: Layer-decomposed sharing
A3 + B2 + **C2** (per-feature layers) + D1 + E2.

- Maximum sharing; one feature change rebuilds one layer.
- Requires a layer composer (custom build pipeline, not `devcontainer build`).
- Aligns with how OCI registries already think about images.
- Probably the most "right-feeling" long-term answer; also the largest investment.

### Configuration P5: Runtime-install pivot
A2 + B4 (tarballs) + **D2** or **D3** (runtime / hybrid) + E lite.

- Sidesteps most of the cache problem by moving the work elsewhere.
- Bigger conceptual shift; first-start latency becomes the new tension.
- Plays well with where lace is already heading (`lace-fundamentals-init`, dotfiles applied at runtime, git identity injected from env).

### Configuration P6: Drop the prebuild concept entirely
**No `lace.local/*` namespace.** No `lace prebuild` step. No tag rewriting. The Dockerfile's `FROM` stays as the user wrote it.
`devcontainer build` runs every `lace up` (or relies on the runtime's own layer cache for unchanged steps).
This is structurally distinct from P1: P1 still has a prebuild step and a `lace.local/<projectName>/...` namespace, just per-project-scoped.
P6 abolishes the namespace.

- Pro: nothing to colocate, nothing to migrate, nothing to invalidate.
- Pro: most honest answer if cache complexity hasn't earned its keep.
- Con: feature install runs every container creation (even in development cycles); no amortisation across projects.
- Con: the fast-iteration developer loop (rebuild after a Dockerfile tweak) loses the prebuild speedup.

### Bundle visibility summary

| Bundle | What `podman images` shows | New cleanup obligation |
|---|---|---|
| P0 | `lace.local/<image>:<tag>` (one per `FROM`); `vsc-<project>-<hash>` (one per project) | None beyond current `podman image prune` |
| P1 | `lace.local/<projectName>/<image>:<tag>`; `vsc-<project>-<hash>` | Tags grow O(projects); user runs `podman image prune` more often |
| P2 | `lace.local/<image>:<tag>-<hash>` (one per distinct feature set); `vsc-...` | Old hashes accumulate; same `podman image prune` story but more entries |
| P3 | Nothing user-recognisable in `podman images` (lace materialises on demand from `~/.cache/lace/oci/`) | `rm -rf ~/.cache/lace/oci/` for full reset; nothing else lace-specific |
| P4 | Per-feature intermediate layer images plus per-project final images | Tags grow O(distinct features × projects); requires deliberate sweep policy |
| P5 | Just the `vsc-...` workspace image. No `lace.local/*` at all. Plus `~/.cache/lace/features/<sha>.tar` files. | `rm -rf ~/.cache/lace/features/`; no image-namespace cleanup |
| P6 | Just the `vsc-...` workspace image. No `lace.local/*` at all. | None beyond current `podman image prune` |

## Cross-Cutting Considerations

### Migration
Whatever ships, existing users have on-disk state:
- `.lace/prebuild/` directories with metadata + temp contexts.
- `lace.local/*` images in their runtime store.
- Dockerfiles and devcontainer.json files with `lace.local/...` FROM/image fields.

Three plausible migration stances:
1. **Auto-detect on first `lace up`**: scan, restore the original FROM/image, and bootstrap the new scheme. Preserves user state but requires migration code.
2. **Document-and-delete**: ship a `lace cache migrate` (or just `lace cache prune --all`) that the user runs once. Simpler.
3. **Forward-compatible**: design the new scheme so the old tags become harmless leftovers that the runtime garbage-collects. Possible with A3 (old per-FROM tags simply never get a hit).

### Cleanup ownership
Per (3)(a), the user owns cleanup, in the same coarse-grained way they already own it for `devcontainer build` artefacts: `podman image prune` for image-namespace artefacts and `rm -rf ~/.cache/lace/` for any lace-side caches.
No `lace cache prune` subcommand.

The proposer's only real obligation here is to be honest about *which* bundles add to the user's manual cleanup burden.
The bundle visibility summary table above is the load-bearing artefact; the proposal should preserve a version of that table in its summary section so the user can see the cleanup consequence at a glance.

### Failure-mode UX
Each bundle introduces a different "what does failure look like to the user" surface.
The proposer should design for the failure mode being legible without external context.
Examples per bundle:

- **P0/P1/P2 (image-namespace bundles)**: failures look like "image not found" or "image build failed"; users debug via `podman images` and `podman build`. Familiar.
- **P3 (lace-owned OCI cache)**: failures can manifest as "manifest not found in `~/.cache/lace/oci/`" or "materialisation step failed"; needs a `lace cache status` or equivalent diagnostic to make the lace-side state visible.
- **P4 (layer-decomposed)**: failures can occur at any of N layer compose steps; needs structured layer-by-layer error reporting (which feature failed, what its install log was).
- **P5 (runtime-install pivot)**: failures move to runtime — postCreateCommand-style errors, exit codes from feature install scripts. The current incident is exactly this kind of failure surfaced badly. Requires investing in the existing exit-127 surfacing problem regardless.
- **P6 (no prebuild)**: failures are the standard `devcontainer build` failures users already see in vanilla projects; least new failure surface.

The bundle that is *cheapest to ship correctly* is often the one whose failure modes are the most familiar.
The bundle that is *most architecturally clean* may carry the steepest failure-UX investment.
The proposal should make this trade-off explicit rather than letting it surface during implementation.

### Testing surface
The current bug exists partly because the test suite doesn't have a multi-project scenario.
Whatever ships, an integration test that runs `lace up` in two projects with overlapping but non-identical feature sets is mandatory.
The test should:
1. Run prebuild for project A; assert tag and feature set.
2. Run prebuild for project B (different features, same FROM); assert it does not corrupt A.
3. Re-run `lace up` in A; assert A still works and uses A's bake, not B's.

### Devcontainer CLI coupling
The current scheme leans on `devcontainer build` for the heavy lifting.
That CLI imposes constraints: it expects a `.devcontainer/` directory, it owns feature install ordering, it writes the `devcontainer.metadata` label.

If the proposal moves toward C2/C3 (custom layer composition), it will likely have to drop or thin the `devcontainer build` dependency.
That's a one-way gate worth flagging in the proposal: once lace owns the build path, regaining devcontainer-CLI parity is non-trivial.

### Sharing as goal vs. coincidence
Per (1)(a), the project is currently solo-developer with no team-centric ambitions.
Sharing is therefore *coincidence, not goal*.
This collapses much of the design space:
- A1 (current, per-FROM tag) loses its rationale: it exists to enable cross-project sharing, but cross-project sharing isn't load-bearing.
- A2 (per-project tag) is no worse than A1 for a solo dev; it just costs slightly more disk for the same correctness.
- A3 (content-hashed) is over-engineered for the solo-dev case unless cross-project sharing emerges naturally between similar projects.
- C2 (per-feature layers) provides intra-project reuse even without cross-project sharing — adding one feature only rebuilds one layer. This benefit *does* survive the solo-dev framing.

The "best design by default" framing under (4)(c) does not mean "the most sharing-aware design." It means the design with the cleanest invariants. C2 stands on its own merits; A3/A5/registry-style options largely do not in this context.

## Lenses for Picking

Three framings for the proposer.
Per (4)(c) "best design by default," **Lens 3 is the recommended primary**; Lenses 1 and 2 are documented as fallback positions if Lens 3 turns out to be infeasible during proposal-stage scoping.

### Lens 1: Minimum viable correctness — **not recommended**
"Just stop the bug." Pick P0 (label verification) or P1 (per-project tag). Ship in days.
The user's stated cadence preference rules this out as the primary direction; document for completeness.

### Lens 2: Right-shaped evolution — **not recommended**
"Keep the prebuild concept, fix the identity model." Pick P2 (content-hashed tag) or P3 (lace-owned OCI cache).
This preserves the existing mental model but inherits its complexity; under "best design by default" the right move is to reconsider the model itself, not refine its identity scheme.

### Lens 3: Reframe the problem — **recommended**
"The prebuild was a workaround for slow feature install. Stop treating it as a build-time bake."
The project already has working runtime initialisation in `lace-fundamentals-init`; extending that pattern is the natural next step.

Within Lens 3:
- **Bundle P5 (runtime-install pivot)** is the primary recommendation. It pays a first-start latency cost in exchange for collapsing most of the cache problem into `~/.cache/lace/features/` (a flat tarball directory the user can `rm -rf`).
- **Bundle P4 (layer-decomposed sharing)** is the credible fallback if P5's first-start latency turns out to exceed user tolerance after measurement. It preserves build-time install but decomposes the monolith into per-feature layers, recovering intra-project reuse.
- **Bundle P6 (drop the prebuild concept entirely)** is the "everything else turned out wrong" minimal answer; documented but not preferred.

> NOTE(opus/lace/prebuild-cache-rethink): A *fourth* path to consider is contributing a per-feature-layer build mode upstream to the devcontainer CLI itself.
> If `devcontainer build --layer-per-feature` (or equivalent) existed, P4 would not require lace to own a custom layer composer.
> This is a long-tail option but worth listing in the proposal's prior-art section so the proposer knows it is not just "fork everything or stay put."

## Open Questions for the Proposer

Resolved by author guidance (kept here for the proposal author's reference):
- ~~Concrete usage pattern~~ → solo dev, sharing is coincidence (1)(a).
- ~~Cleanup story user expectation~~ → user-owned via `podman image prune` (3)(a).

Still open for the proposer:

1. **Disk budget under P5.** With features moved to runtime, the per-project image is essentially `vsc-<project>-<hash>` over a vanilla `node:24-bookworm`. Roughly: how much disk does a fully-runtime-installed feature set add to the workspace image vs. a vanilla base? Measurement, not estimate.
2. **First-start latency budget under P5/D2.** What's the acceptable wait between "container started" and "shell prompt" the first time a container is created? This is the primary axis on which P5 vs. P4 lives or dies.
3. **Devcontainer-build coupling under P4.** If P4 is chosen, lace has to either drive `devcontainer build` in an unusual way, contribute upstream support for per-feature layers, or assume responsibility for layer composition (buildah). Which is the project willing to commit to?
4. **Phase relationship between `prebuild` and `up`.** Today `prebuild` is a separate phase that rewrites the Dockerfile FROM. In a P5/P6 world that phase mostly disappears. The proposal should be explicit about whether `lace prebuild` survives (and if so, what it does), or whether it becomes a no-op / removed subcommand.
5. **Migration shape.** Existing `.lace/prebuild/` directories and `lace.local/*` images on disk — auto-migrate, or `rm -rf .lace/` and rebuild?

## Recommendation Posture

**Recommendation: Lens 3 / Bundle P5 (runtime-install pivot), with P4 as a measured fallback.**

The author's "best design by default" framing rules out Lens 1 (P0/P1) as a primary direction even though those bundles are the cheapest fixes.
The "stay inside OCI/devcontainer" guidance rules out the more exotic non-OCI directions (Nix-style, distrobox-style).
The "user-owned cleanup like devcontainer's" guidance rules out designs that would require lace to introduce its own cache-management subcommands.
What survives this filtering is:

- **P5 primary.** Pre-fetched feature tarballs in `~/.cache/lace/features/` (cleanup: `rm -rf`, no new tooling); features install at first container start (D2 or D3 hybrid); the workspace image is thin and disposable; no `lace.local/*` namespace, no shared bake to collide with. The trade is first-start latency, which the proposer should measure rather than assume.
- **P4 fallback.** If P5's first-start latency proves unacceptable, fall back to per-feature OCI layers composed at build time. This requires a custom layer composer (or upstream devcontainer-CLI support); larger lift, but recovers cache amortisation while still eliminating the collision class.

P2/P3 are not recommended even as transitional steps: they invest in fixing the current scheme's identity model, which under "best design by default" is the wrong place to invest.
P0 stays useful as a *short-term mitigation* for the live bug while the P5 design work proceeds — it should ship as the small fixes already itemised in the incident report's short-term recommendations, not as the destination.
