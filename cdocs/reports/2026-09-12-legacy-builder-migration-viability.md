---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-12T07:14:51-07:00
task_list: devcontainer/legacy-builder-viability
type: report
state: live
status: review_ready
tags: [devcontainer, buildkit, build-cache, dev-infra, podman]
---

# Legacy Builder Migration Viability

> BLUF: Dropping `devcontainer up --buildkit never` is NOT viable today.
> The blocking factor is a correctness bug, not a caching-capability gap: [`containers/buildah#6503`](https://github.com/containers/buildah/issues/6503) (an overlay-driver parent-permission fault in `containers/storage`) remains OPEN with no activity since 2026-05-11 and no merged fix, so enabling BuildKit on lace's rootless-podman substrate reintroduces the `/tmp` `1777 -> 755` corruption that breaks multi-feature `apt-get` installs outright.
> BuildKit's cache machinery (`--cache-to`/`--cache-from`, `type=local|registry|inline`, cache mounts) is mature and would meet or exceed lace's warm-build behavior, but that is moot while the feature-install codepath itself is unusable on the host.
> Separately and importantly: getting off the legacy builder would NOT by itself fix the Claude Code version freeze, because any effective layer cache (BuildKit included) freezes `@latest` at the feature-install layer just the same.
> Recommendation: not-yet. Re-evaluate when #6503 is fixed upstream and shipped in the installed podman/buildah.

## Summary

Lace invokes `devcontainer up --buildkit never` for every build (`packages/lace/src/lib/up.ts:1695`).
The stated migration question is whether recent devcontainer CLI, Docker BuildKit, and podman/buildah updates now let lace stop forcing the legacy builder.

The answer separates cleanly into two independent axes that the framing tends to conflate:

1. Correctness: can BuildKit even run lace's feature installs on the host without breaking them?
   No. This is the hard blocker.
2. Caching: if it could, would BuildKit reproduce (or beat) the legacy builder's warm-build cache?
   Yes, comfortably, and with cross-machine sharing the legacy builder cannot do.

Because axis 1 fails, axis 2 is academic on the current substrate.
The recommendation is driven entirely by axis 1.

## Background: Why `--buildkit never` Today

Two distinct rationales accreted onto the same flag.
The migration-proposal narrative foregrounds the second; the empirical investigation established the first as the actually load-bearing one.

### The correctness reason (load-bearing)

`--buildkit never` routes the devcontainer CLI's feature install through a `COPY --from` template instead of the BuildKit-style `RUN --mount=type=bind,target=/tmp/build-features-src/<id>` template.
On rootless podman with the overlay graph driver, the `RUN --mount` template trips [`containers/buildah#6503`](https://github.com/containers/buildah/issues/6503): a layer blob that omits a tar entry for `/tmp` while carrying entries beneath it causes the overlay driver to invent `/tmp` at mode `755` instead of inheriting `1777`.
The `_apt` user then cannot write GPG temp files, and `apt-get update` fails with `Couldn't create temporary file /tmp/apt.conf.XXXXX` on the second and subsequent feature installs.

The maintainer (`@nalind`) attributes this to the `containers/storage` overlay driver, triggered by `podman build --layers` (the default), not to BuildKit per se.
See [`cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`](2026-05-12-podman-tmp-buildkit-bug-investigation.md).
A pre-test experiment confirmed the base-image `RUN chmod 1777 /tmp` mitigation is not sufficient on its own: the corruption re-fires at each `RUN --mount` layer, so `--buildkit never` is the load-bearing mitigation.
See [`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](2026-05-12-pretest-experiment-buildkit-never-drop.md).

This is why `--buildkit never` cannot simply be removed: on the host, BuildKit-path multi-feature builds do not merely run slower, they fail.

### The caching reason (real, but secondary)

The legacy builder also happens to produce a persistent local layer cache.
The 2026-05-12 experiment measured weftwise at 234s cold and 16s warm (a 15x speedup, 57 of 63 instruction steps cached, all feature install scripts cached).
See [`cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`](2026-05-12-experiment-legacy-builder-cache.md).
This cache is what let lace delete `lace prebuild` entirely: the legacy builder's local cache replaced lace's bespoke prebuild-image machinery.
See [`cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md`](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md).

The original BuildKit-based migration attempt (`BUILDKIT_INLINE_CACHE`, registry-backed cross-machine cache) was abandoned precisely because it required the BuildKit codepath, which is blocked by #6503.
So the caching axis was never the reason to stay on the legacy builder; it is a benefit that the legacy builder incidentally provides once the correctness bug forces that choice.

## Findings

### Finding 1: The blocking bug is unchanged as of 2026-09-12

Queried directly via the GitHub API on 2026-09-12:

- [`containers/buildah#6503`](https://github.com/containers/buildah/issues/6503): state OPEN, last updated 2026-05-11.
  Four months of no activity beyond users re-confirming the workaround.
  The buildah repo migrated to `podman-container-tools/buildah` in mid-2026; the issue is OPEN under both remotes.
- [`containers/storage#1653`](https://github.com/containers/storage/pull/1653), the only candidate fix (nalind's `[RFC] overlay: make sure directories omitted from layers have the right permissions`): state CLOSED, never merged, closed 2025-08-26.
- No newer containers/storage or buildah PR fixing the overlay parent-permission inheritance was found via search.
- Latest #6503 comments remain workaround reports: an `apt-get` shim that `chmod 1777 /tmp` before exec, and the macOS-only `applehv`-over-`libkrun` switch (with a caveat that it is not fully reliable).

The bug is therefore in the same state the May investigation recorded: real, upstream, unfixed, no scheduled timeline.

### Finding 2: The host toolchain advanced but stays in the affected range

Installed on the host as of this report:

| Tool | May 2026 report | 2026-09-12 |
|------|-----------------|------------|
| devcontainer CLI | 0.83.0 | 0.87.0 |
| podman | 5.7.1 | 5.8.2 |
| buildah | 1.42.2 | 1.43.1 |

The May investigation already recorded #6503 reproducing on podman 5.7.0/5.7.1/5.8.0/5.8.1 and buildah 1.42.x/1.43.x.
podman 5.8.2 / buildah 1.43.1 fall squarely inside that range, and no fix has shipped since.
Nothing in the version bump changes the correctness picture.

> WARN(opus/devcontainer/legacy-builder-viability): This report did not re-run the empirical `--buildkit never`-dropped build on the current 0.87.0 / 5.8.2 / 1.43.1 toolchain.
> The conclusion rests on the upstream bug remaining OPEN with an unmerged fix, which is a strong negative signal, plus the unchanged devcontainer-CLI feature-install template.
> A one-shot re-run (Open Questions) would convert "expected to still fail" into "confirmed still fails" on the exact installed versions.

### Finding 3: BuildKit's caching is not the constraint

BuildKit's cache capabilities are mature and, on a supporting backend, would meet or exceed the legacy builder:

- Persistent cache export/import via `docker buildx build --cache-to`/`--cache-from` with `type=local` (on-disk), `type=registry` (cross-machine, shareable), and `type=inline` (cache embedded in the image).
- `RUN --mount=type=cache` cache mounts for package-manager and build-artifact reuse across builds.
- The devcontainer CLI supports `BUILDKIT_INLINE_CACHE` for the feature path and exposes cache-from wiring.
  See [devcontainers/cli CHANGELOG](https://github.com/devcontainers/cli/blob/main/CHANGELOG.md).

Registry-backed cache (`type=registry`) would additionally give cross-machine and cross-project warm builds, which the legacy builder's local-only cache explicitly forfeits.
So if the correctness blocker were gone, BuildKit would be a caching upgrade, not a regression.

The catch is entirely on the runtime side: lace runs rootless podman, whose BuildKit-compatible frontend is buildah, and buildah's `--layers` + overlay path is exactly what #6503 corrupts.
podman/buildah's support for the full BuildKit cache-exporter matrix is also less complete than `docker buildx`, but that gap is irrelevant while the feature-install codepath itself is unusable.

### Finding 4: Dropping the legacy builder does NOT fix the version freeze

This is the point most likely to be misread, so it is stated plainly.

The Claude Code version freeze (see [`cdocs/proposals/2026-09-11-claude-code-feature-updatability.md`](../proposals/2026-09-11-claude-code-feature-updatability.md)) is caused by the feature-install layer being cached, so `npm install ...@latest` is never re-resolved on rebuild.
That is a property of layer caching in general, not of the legacy builder specifically.
BuildKit caches the same layer on the same cache key, and its caching is if anything more aggressive.
Switching from the legacy builder to BuildKit would therefore leave `@latest` frozen exactly as before, and a registry-backed BuildKit cache could freeze it across machines too.

The only builder-level way to re-resolve versions on every rebuild is to disable caching (per-build `--no-cache` / `--build-no-cache`), which defeats the entire warm-build rationale and is not what "get off the legacy builder" means.
The accepted feature-updatability fix (a create-time `postCreateCommand` wrapper that reinstalls outside the image-layer cache) is builder-agnostic and is the correct solution independent of this report.

Conclusion for the arc: the legacy-builder question and the version-freeze question are orthogonal.
Neither is a lever on the other.

## Options and Tradeoffs

### Option A: Stay on `--buildkit never` (status quo)

- Pro: correct on the host; no regression; warm builds already fast (16s on weftwise); zero work.
- Con: local-only cache, no cross-machine or cross-project sharing; the flag is a standing dependency on an unfixed upstream bug; `dev_container_feature_content_temp` cleanup stays load-bearing.
- Verdict: the only currently-safe option.

### Option B: Switch to BuildKit now

- Pro: registry-backed cross-machine cache; cache mounts; aligns with upstream defaults; `docker buildx` cache matrix.
- Con: reintroduces #6503; multi-feature `apt-get`-based feature installs fail outright on rootless podman + overlay.
  Not a performance regression, a correctness failure.
- Verdict: not viable on the current substrate.

### Option C: BuildKit with a non-overlay storage driver (e.g. vfs)

- Pro: sidesteps the overlay-specific #6503.
- Con: severe performance penalty (vfs copies whole layers); unacceptable for a daily-driver dev loop; trades a caching win for a much larger caching loss.
- Verdict: self-defeating.

### Option D: Invoke `buildah build` directly (bypass `--layers`)

- Pro: `buildah build` does not pass `--layers` by default, so it does not trip #6503.
- Con: the devcontainer CLI does not expose this; lace would have to reimplement the CLI's feature-install orchestration or shim `--docker-path`; and dropping `--layers` also drops the layer cache, losing warm builds.
- Verdict: high effort, loses the very cache the migration wants.

### Option E: Docker (moby) backend instead of rootless podman

- Pro: BuildKit is the native default on moby and #6503 does not apply; full cache-exporter support.
- Con: lace's entire ecosystem is deliberately rootless podman (see project memory and the podman-migration arc); this is an environment change, not a build-flag change.
- Verdict: out of scope as a build-tooling decision; would be a platform decision with far wider blast radius.

## Recommendation

Not-yet.
Keep `devcontainer up --buildkit never`.

Concrete blocking factor: [`containers/buildah#6503`](https://github.com/containers/buildah/issues/6503) is OPEN and unfixed as of 2026-09-12, its only candidate fix ([`containers/storage#1653`](https://github.com/containers/storage/pull/1653)) is closed unmerged, and lace's runtime is rootless podman + overlay, where enabling BuildKit reintroduces the `/tmp` `1777 -> 755` corruption that breaks multi-feature feature installs.
This is a correctness blocker, not a BuildKit caching-readiness gap.

Re-evaluation trigger: a merged `containers/storage` fix for overlay parent-directory permission inheritance, shipped in a podman/buildah release installed on the host, empirically confirmed by re-running a `--buildkit never`-dropped multi-feature `lace up` without the `apt.conf` failure.
At that point BuildKit becomes not just viable but a caching upgrade (registry-backed cross-machine cache), and a registry-backed migration can be reopened as a separate additive RFP.

Do not couple this to the feature-updatability work: dropping the legacy builder neither helps nor is required by that fix.

## Open Questions

- Exact-version re-confirmation: has #6503 been re-tested on the currently installed devcontainer CLI 0.87.0 / podman 5.8.2 / buildah 1.43.1?
  A single `lace up` with `up.ts:1695` patched to omit `--buildkit never` on a two-feature `apt`-based project would confirm the failure still fires (expected: it does).
- Devcontainer CLI template drift: does CLI 0.87.0 still emit the `RUN --mount=type=bind,target=/tmp/build-features-src/<id>` feature-install template?
  The May report cited it from `containerFeaturesConfiguration.ts`; a quick source check on the 0.87.0 tag would close the assumption that the trigger is unchanged.
- Podman/buildah BuildKit cache-exporter coverage: if #6503 is ever fixed, which of `type=local|registry|inline` does the installed buildah actually support end-to-end, versus `docker buildx`?
  This determines whether a future migration gains cross-machine caching or only matches the local cache.
- Repo migration bookkeeping: buildah moved to `podman-container-tools/buildah` in mid-2026; internal references to `containers/buildah#6503` still resolve, but future watchers should track the new remote.
