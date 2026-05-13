---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T14:30:00-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [podman, buildkit, bug_investigation, infrastructure, rfp_input]
---

# Podman / Buildah `/tmp` Permission Corruption Bug: Upstream Investigation

> BLUF: The bug is real and the lace diagnosis is substantially correct, with one important correction: the corruption is caused by buildah / containers-storage (the overlay driver layer-merge path), not by anything BuildKit-specific.
> The relevant upstream issue ([containers/buildah#6503](https://github.com/containers/buildah/issues/6503)) is OPEN as of 2026-05-11, one day before this report, with users reporting it on podman 5.7.1 and 5.8.1.
> Disabling BuildKit (`--buildkit never`) does *not* address the root cause; lace's workaround works because it forces the devcontainer CLI down a `COPY --from` codepath that does not trigger the `RUN --mount=type=bind` permission-merge bug, not because BuildKit is itself the cause.
> The defensive `RUN chmod 1777 /tmp` in `.devcontainer/Dockerfile:19` remains necessary on the host's `podman 5.7.1 / buildah 1.42.2`; the `--buildkit never` flag is a secondary mitigation whose value depends on the codepath the devcontainer CLI takes.

## Context

The lace project disables BuildKit globally for `devcontainer build` and `devcontainer up` invocations.
This dates to [`cdocs/devlogs/2026-03-26-podman-buildkit-tmp-fix.md`](../devlogs/2026-03-26-podman-buildkit-tmp-fix.md), which attributes `apt-get update` failures during devcontainer feature install to BuildKit's `RUN --mount=type=bind` corrupting `/tmp` permissions from `1777` to `755` under rootless podman.
The empirical test plan at [`cdocs/proposals/2026-05-06-empirical-test-upstream-feature-cache.md`](../proposals/2026-05-06-empirical-test-upstream-feature-cache.md) flags this as the hidden gating risk (H2): if BuildKit is unusable on the host, the treatment cannot run at all.
This report exists because the proposal author wants to know whether the diagnosis is still load-bearing before designing around it.

The host configuration in scope: Fedora 43, kernel 6.17.12, podman 5.7.1, buildah 1.42.2, devcontainer CLI 0.83.0, rootless mode with overlay graph driver.

## Method

Primary sources consulted:

- `containers/buildah` issue tracker, full read of issue #6503 (the smoking-gun report) via `gh issue view`.
- `devcontainers/images` issue tracker, full read of issue #1556 (the downstream devcontainer symptom report).
- `containers/podman` issue tracker, issue #27131 (a related but distinct permission regression).
- `containers/buildah` PRs #6233 (regression introduction), #6381 (partial fix), and `containers/storage` PR #1653 (incomplete fix for the deeper bug).
- `containers/podman` release-tag metadata via `gh release view` for v5.7.0, v5.7.1, v5.8.0, v5.8.1, v5.8.2.
- `containers/buildah` release-tag metadata for v1.42.0, v1.42.2, v1.43.0.
- `devcontainers/cli` source for the feature-install Dockerfile template (`spec-configuration/containerFeaturesConfiguration.ts`) to confirm whether it matches the #6503 reproducer pattern.

Searches performed via WebSearch and direct GitHub queries.
Sources cited inline; full URL list in the Citations section.

## The Lace Diagnosis as Stated

From [`cdocs/devlogs/2026-03-26-podman-buildkit-tmp-fix.md`](../devlogs/2026-03-26-podman-buildkit-tmp-fix.md):

> Rootless podman's overlay filesystem driver does not correctly preserve parent directory permissions when `RUN --mount=type=bind` creates an overlayfs mount at a subdirectory.
> After a `RUN --mount=type=bind,...,target=/tmp/build-features-src/...` step writes to `/tmp` subdirectories, `/tmp` permissions change from `1777` (sticky + world-writable) to `755`.
> The `_apt` user (used by apt for GPG verification) cannot create temp files in a 755 `/tmp`, causing `apt-get update` to fail with `Couldn't create temporary file /tmp/apt.conf.XXXXX for passing config to apt-key`.

And from `up.ts:1308-1311`:

> Disable BuildKit for podman compatibility.
> BuildKit's RUN --mount=type=bind corrupts /tmp permissions (1777 -> 755) in rootless podman/buildah, breaking apt-get GPG verification in subsequent build steps.

The diagnosis attributes the bug to "BuildKit" specifically.
This framing is partially incorrect: see below.

## Primary Source Evidence

### Buildah #6503 — the smoking gun

[`containers/buildah#6503`](https://github.com/containers/buildah/issues/6503), opened 2025-11-13 by `@limwa`, titled "Permissions of /tmp are set to 755 after a bind mount is placed under /tmp under specific conditions."
Status as of 2026-05-12: **OPEN**, `kind/bug`, last activity 2026-05-11.

The minimal reproducer:

```dockerfile
FROM docker.io/library/ubuntu:22.04
RUN mkdir -p /tmp/a/
RUN --mount=type=bind,source=.,target=/tmp/b/ touch /tmp/a/example.txt
RUN ls -la /tmp/
```

Three conditions are required:

1. A directory already exists under `/tmp` (`/tmp/a`).
2. A bind mount is placed under `/tmp` in the same RUN (`target=/tmp/b/`).
3. A file is created under the pre-existing directory during that RUN (`touch /tmp/a/example.txt`).

When all three hold, `/tmp` permissions change from `1777` to `755`.

Critically, `@limwa` documents that the bug **occurs with `podman build` but NOT with `buildah build` directly**.
The difference: `podman build` enables `--layers` by default, `buildah build` does not.

### Maintainer attribution

[Comment from maintainer `@nalind` (Nalin Dahyabhai), 2025-11-13](https://github.com/containers/buildah/issues/6503#issuecomment-3530073110):

> This looks like a consequence of us not adding an entry for "tmp" in the layer that creates "tmp/a/example.txt" when the `--layers` flag is used (the flag is enabled by default for `podman build` but not `buildah build`), in combination with using the overlay storage driver.
> In the overlay driver, the contents of each layer are stored in a separate directory tree.
> When the layer that includes "tmp/a/example.txt" is being written to disk, because the layer blob doesn't include an entry that would cause "tmp" to have already been created for that layer with known permissions and ownership, the directory has to be created by the driver, and the driver currently uses the same default permissions and ownership for any such directory that it has to create.
> I started working on something to address this in [containers/storage#1653](https://github.com/containers/storage/pull/1653), but didn't finish it.

This is dispositive on the root cause.
The bug is **not in BuildKit**, not in podman's BuildKit frontend, and not specifically in `RUN --mount=type=bind`.
The bug is in the overlay graph driver (`containers/storage`): when a layer blob omits a tar entry for a parent directory (e.g., `/tmp`) but contains entries for paths underneath it (e.g., `/tmp/a/example.txt`), the driver invents the parent directory with default permissions (`755`) rather than inheriting the parent's permissions from the layer below.

The `RUN --mount=type=bind` pattern is one trigger because the mount target (`/tmp/b/`) is excluded from the resulting layer diff but its parent `/tmp` may not be explicitly included either.
Any sequence of operations that produces a layer diff with `/tmp/<something>` entries but no `/tmp` entry can hit the same bug.

### The partial-fix arc

[Buildah PR #6233](https://github.com/containers/buildah/pull/6233) (merged 2025-06-22, shipped in buildah v1.41.0): introduced cleanup of mount target parent directories in the resulting layer diff.
This PR is the *regression source* for a related-but-different bug (mount target dir permissions of `700` rather than `755`).

[Buildah PR #6381](https://github.com/containers/buildah/pull/6381) (merged 2025-09-16, shipped in buildah v1.41.5 and v1.42.0+): relaxed those mount target parent directories from `700` to `755`.
Title: "Run: create parent directories of mount targets with mode 0755."
Release note: "Parent directories created for mounts used by `buildah run` or by RUN instructions in `buildah build` will be world-readable again."
This fixed a different symptom (the `--mount=type=secret` and `--mount=type=cache` permission-denied errors tracked in [`containers/podman#27044`](https://github.com/containers/podman/issues/27044) and [#27131](https://github.com/containers/podman/issues/27131)).

[containers/storage PR #1653](https://github.com/containers/storage/pull/1653): nalind's incomplete attempt to fix the deeper overlay-driver bug.
Opened 2023-06-28, **closed without merge** on 2025-08-26 due to the repository's migration to `containers/container-libs`.
Never released.

### Downstream confirmation

[`devcontainers/images#1556`](https://github.com/devcontainers/images/issues/1556) (OPEN), reporting `/tmp` at `755` in `typescript-node:22`, with confirmation comments from `@riker09` on 2026-03-10 ("still happening with podman v5.7.1") and `@cbernard-rm25` on 2026-04-26 ("still occurring with podman v5.8.1").
[`@limwa` comment 2025-11-12](https://github.com/devcontainers/images/issues/1556#issuecomment-3524052032): "I think this is still happening in Podman 5.7.0 (which ships with Buildah 1.42.0, the first version to include #6381). The permissions are still 755 instead of 1777."
This explicitly establishes that PR #6381 does **not** fix the `1777 -> 755` corruption; it only addresses the `700 -> 755` mount-target regression.

[`@MexHigh` comment on #6503, 2025-12-21](https://github.com/containers/buildah/issues/6503#issuecomment-3678680954) reports the apt-key symptom directly:

> I also observe this issue when installing stuff via `apt` using podman buildx (buildah).
> It tries to copy some GPG keys to /tmp for verification, which fails and prevents the installation of packages.

[`@meklu` comment 2026-05-11](https://github.com/containers/buildah/issues/6503#issuecomment-4422156323): describes a VS Code devcontainer workaround that wraps `apt-get` with `mkdir -p /tmp/ && chmod 1777 /tmp/` before exec, citing `docker-in-docker` feature install as the trigger.
This is structurally identical to lace's `RUN chmod 1777 /tmp` defensive line in `.devcontainer/Dockerfile`.

### The devcontainer CLI feature install template matches the reproducer

The devcontainer CLI v2 features Dockerfile template (from `containerFeaturesConfiguration.ts` in `devcontainers/cli`) generates one `RUN --mount` block per feature:

```
RUN --mount=type=bind,from=dev_containers_feature_content_source,source=${source},target=/tmp/build-features-src/${feature.consecutiveId}
    cp -ar /tmp/build-features-src/${folder} ${FEATURES_CONTAINER_TEMP_DEST_FOLDER}
    && chmod -R 0755 ${dest}
    && ./devcontainer-features-install.sh
    && rm -rf ${dest}
```

For the *first* feature this is benign.
For the *second* feature, the first feature's mount target directory (`/tmp/build-features-src/0`) was committed into the previous layer, so a directory under `/tmp` already exists when the second feature's `--mount` block runs.
The second feature's RUN writes to `/tmp/build-features-dst` (via its install script — apt downloads GPG keys to `/tmp/apt.conf.XXX`, etc.), which is also under `/tmp`.
This satisfies all three #6503 reproducer conditions.

So the lace-observed symptom path is exactly what #6503 predicts.
The "BuildKit-specific" framing is wrong; the trigger is `--layers` (default in `podman build`) plus the overlay driver plus the devcontainer CLI's BuildKit-style feature install template.

## Alternative Hypotheses

I evaluated each alternative the brief raised:

| Hypothesis | Verdict |
|---|---|
| Devcontainer CLI bug rather than podman | Partially. The CLI template *triggers* the bug by combining `RUN --mount=type=bind` with sequential feature installs writing to `/tmp`. The CLI is not "wrong" — its template is valid BuildKit syntax that works on docker. The bug is in buildah/containers-storage. |
| Buildah-specific BuildKit-compat frontend bug | No. `@nalind`'s attribution points to `containers/storage` overlay driver layer-merge, not the buildah BuildKit frontend. |
| Specific feature's install script | No. The symptom reproduces with the minimal #6503 Containerfile, no devcontainer features required. |
| Base image (`node:24-bookworm`) | No. Reproduces on `ubuntu:22.04` per #6503. |
| `--userns=keep-id` interaction | No evidence. The #6503 reproducer does not use `--userns`. |
| Old podman/buildah version | No. Reported open on 5.7.0, 5.7.1, 5.8.1 as of late April 2026. |
| `RUN --mount=type=bind` specifically vs other mount types | The reproducer uses `type=bind`. The bug is more general (any layer diff omitting a tmp tar entry while including children); other mount types likely hit the same path. |

The "BuildKit" framing in lace's diagnosis is therefore misleading but not catastrophically so.
The flag `--buildkit never` works because it forces the devcontainer CLI to a different codepath (`COPY --from` from a scratch image rather than `RUN --mount=type=bind`), which avoids the offending pattern.
But disabling BuildKit per se is not the fix; the fix is avoiding the `RUN --mount` codepath in combination with `podman build --layers`.

## Current Status of the Bug

| Component | Affected versions | Status |
|---|---|---|
| buildah 1.40.x and earlier | Not affected by either regression | n/a |
| buildah 1.41.0 to 1.41.4 | Mount-target dirs at `0700` (PR #6233 regression). Not the same as the `1777 -> 755` bug. | Fixed in 1.41.5 / 1.42.0 |
| buildah 1.41.5+ / 1.42.x / 1.43.x | `0700 -> 0755` fixed (PR #6381). `1777 -> 755` overlay-layer-diff bug **still present**. | OPEN (#6503) |
| podman 5.6.0 - 5.6.1 | Bundled buildah 1.41.x with the `0700` regression | Fixed in 5.6.2 |
| podman 5.7.0 (bundled buildah 1.42.0) | `0700` issue fixed; `1777 -> 755` overlay bug present | Open |
| podman 5.7.1 (lace host) | Same: `1777 -> 755` overlay bug present | Open |
| podman 5.8.0 / 5.8.1 / 5.8.2 (latest as of 2026-04-14) | Same | Open |

The host's `podman 5.7.1 / buildah 1.42.2` falls firmly within the affected range.
Comments on #1556 from `@cbernard-rm25` on 2026-04-26 confirm the bug persists in podman 5.8.1.
No buildah or containers-storage release as of 2026-05-12 contains a fix for the underlying overlay-driver layer-diff bug.

The fix is gated on someone resurrecting `nalind`'s storage PR #1653 (closed Aug 2025, never merged, repository since migrated) and shipping it through `containers/container-libs -> containers/storage -> buildah -> podman`.
There is no public timeline.
The issue saw a friendly-bot stale ping on 2025-12-14 and another on 2026-01-21; the only substantive recent activity is users confirming it still affects them.

## Workarounds (Authoritative)

Documented in the upstream threads:

1. **Defensive `chmod 1777 /tmp` in the consuming Dockerfile**, before any `apt-get` step.
   Used by `@meklu` (#6503), by lace (`.devcontainer/Dockerfile:19`), and recommended in the devcontainers/images #1556 thread.
   This is the de facto community workaround.

2. **Wrap `apt-get` with a shim that runs `chmod 1777 /tmp` first**, then exec the real binary.
   `@meklu`'s solution in #6503.
   Equivalent to (1) but injected via `COPY` rather than `RUN`.

3. **Downgrade podman to <= 5.5.2**.
   `@Kaniska244` recommendation in #1556 from 2025-09-26 (note: this targets the *different* `0700` regression that was already fixed in 5.6.2; not applicable to the `1777 -> 755` bug).

4. **Switch from `libkrun` to `applehv` (macOS-only)**.
   `@cbernard-rm25` reports partial relief in #6503; not relevant for Linux hosts.

5. **Use `buildah build` directly instead of `podman build`**.
   The bug does not reproduce with `buildah build` because that codepath does not pass `--layers` by default.
   The devcontainer CLI does not expose this option; lace would need to invoke buildah directly, bypassing the CLI's `--docker-path` mechanism.

6. **Use a different storage driver (vfs instead of overlay)**.
   Implied by `@nalind`'s root-cause analysis — the bug is overlay-specific.
   Severe performance penalty; not recommended for daily-driver dev workflows.

7. **Disable BuildKit (`--buildkit never`)**.
   Lace's primary workaround.
   Not endorsed in the upstream threads, but functionally effective because it routes the devcontainer CLI through `COPY --from` instead of `RUN --mount=type=bind`.

The brief asked whether `--security-opt no-new-privileges:false` or `BUILDAH_LAYERS=true/false` mitigates this.
No evidence either does.
`BUILDAH_LAYERS=false` is used in lace's prebuild.ts for a *different* reason: it disables podman's layer caching of `FROM scratch + COPY` images, which is needed because lace's `--buildkit never` codepath uses scratch images for feature content.
That is a workaround-for-the-workaround, unrelated to the `/tmp` bug.

## Implications for the Empirical Test Plan

The test plan as written should keep the `RUN chmod 1777 /tmp` line in any treatment Dockerfile (`Dockerfile.test`).
Removing it risks an `apt-get update` failure in the treatment run that has nothing to do with cache engagement; that would muddy the comparison.

The plan's hypothesis H2 ("BuildKit can be enabled for treatment runs without reproducing the `/tmp 1777 -> 755` corruption bug") should be reframed.
H2 is gated not on BuildKit per se but on whether `podman build --layers` plus the devcontainer CLI's `RUN --mount=type=bind` template still triggers #6503 on the host.
Given the unfixed-upstream status and the matching reproducer pattern, **H2 should be expected to fail without mitigation**.
The plan should explicitly include `chmod 1777 /tmp` as a defensive line in `Dockerfile.test` and *not* rely on the bug having gone away.

The plan should also add a small **pre-test side experiment**: run the lace `up.ts` pipeline with `--buildkit never` removed and observe whether the existing `RUN chmod 1777 /tmp` in `.devcontainer/Dockerfile` is sufficient to keep `apt-get update` working.
If the defensive chmod alone is enough, the `--buildkit never` flag is a candidate for removal in a follow-up PR — modulo the secondary `dev_container_feature_content_temp` caching issue that lace's `prebuild.ts:317-326` works around separately.
If `apt-get update` still fails despite the chmod, the workaround set is load-bearing and the test plan should record that as a finding.

Recommended pre-test addition (one paragraph in the plan):

> Before the main test runs, do a single `lace up` with `up.ts:1311` patched to omit `--buildkit never` and `BUILDAH_LAYERS` unset.
> Observe whether `apt-get update` succeeds in the resulting feature install or the project Dockerfile build.
> Outcome A (succeeds): the defensive `chmod 1777 /tmp` line in `.devcontainer/Dockerfile` is the load-bearing mitigation; `--buildkit never` is optional.
> Outcome B (fails): both mitigations are needed; the test plan must keep both in `Dockerfile.test`.

## Honest Assessment

The lace diagnosis was 80% right and 20% wrong, with the wrong 20% being a mislabel rather than a category error:

- **Right**: the symptom (apt-key `Couldn't create temporary file /tmp/apt.conf.*`), the proximate cause (`/tmp` permissions at `755` instead of `1777`), the trigger (`RUN --mount=type=bind` patterns generated by the devcontainer CLI), the affected runtime (rootless podman with overlay driver), and the choice of `chmod 1777 /tmp` as the defensive line.
- **Wrong**: attributing the bug to "BuildKit." It is not a BuildKit bug.
  It is a `containers/storage` overlay driver bug, triggered by `podman build --layers` (the default), exposed by any Dockerfile pattern that produces a layer diff containing entries under `/tmp` without an explicit `/tmp` entry.
  BuildKit syntax (`RUN --mount=type=bind`) is one such trigger because the mount target excludes itself from the diff while the install script writes files near it.
- **Outdated**: the diagnosis is dated 2026-03-26, predating the public upstream issue (#6503, 2025-11-13).
  Lace correctly identified the symptom independently of the upstream report.
  The upstream report has since narrowed the root cause more precisely than the lace devlog.

The `--buildkit never` flag is correct as a workaround **for now** but for the wrong stated reason.
It works because it routes the devcontainer CLI through a feature-install template that uses `COPY --from` instead of `RUN --mount=type=bind`.
On a future podman/buildah release that fixes #6503, the flag becomes unnecessary; on a parallel-universe podman with a different feature-install path that hits the same overlay-diff bug, the flag would not help.
The defensive `RUN chmod 1777 /tmp` in `.devcontainer/Dockerfile` is the more robust mitigation: it works against the symptom directly, regardless of which codepath produces it.

Net recommendation for the project author: keep both mitigations until #6503 is fixed upstream, but rewrite the comment at `up.ts:1308-1311` to reference #6503 by URL and accurately describe the trigger (overlay layer-diff omission, not "BuildKit corruption").
The empirical test plan should expect the bug to still bite on this host and should not gamble on its absence.

## Citations

- [containers/buildah#6503](https://github.com/containers/buildah/issues/6503) — primary upstream issue, OPEN, dated 2025-11-13, with maintainer attribution to overlay driver layer-merge.
- [containers/buildah#6503 nalind comment](https://github.com/containers/buildah/issues/6503#issuecomment-3530073110) — maintainer diagnosis pointing at containers/storage layer-diff handling.
- [containers/buildah#6503 MexHigh comment](https://github.com/containers/buildah/issues/6503#issuecomment-3678680954) — apt-key/GPG symptom report matching lace's exact failure mode.
- [containers/buildah#6503 meklu comment](https://github.com/containers/buildah/issues/6503#issuecomment-4422156323) — community workaround wrapping `apt-get` with `chmod 1777 /tmp`, structurally identical to lace's mitigation.
- [containers/storage#1653](https://github.com/containers/storage/pull/1653) — nalind's incomplete fix for the overlay parent-permission inheritance. Closed without merge 2025-08-26.
- [containers/buildah#6233](https://github.com/containers/buildah/pull/6233) — introduced mount-target parent dir creation at mode 0700 (regression source for the related but distinct issue).
- [containers/buildah#6381](https://github.com/containers/buildah/pull/6381) — relaxed mount-target parent dirs to 0755, merged 2025-09-16, shipped in buildah 1.41.5 and 1.42.0+. Does **not** fix #6503.
- [containers/podman#27044](https://github.com/containers/podman/issues/27044) — the 0700 mount-target regression in podman 5.6.x. Fixed in 5.6.2.
- [containers/podman#27131](https://github.com/containers/podman/issues/27131) — duplicate of #27044. Closed 2025-09-30.
- [devcontainers/images#1556](https://github.com/devcontainers/images/issues/1556) — downstream symptom report on devcontainers base images. OPEN. Confirms bug persists in podman 5.7.0, 5.7.1, 5.8.1.
- [devcontainers/images#1556 limwa comment](https://github.com/devcontainers/images/issues/1556#issuecomment-3524052032) — confirms PR #6381 does not fix the `1777 -> 755` corruption.
- [devcontainers/images#1556 Kaniska244 comment](https://github.com/devcontainers/images/issues/1556#issuecomment-3338640346) — community investigation summary pointing at PR #6233 / PR #6381.
- [devcontainers/cli `containerFeaturesConfiguration.ts`](https://github.com/devcontainers/cli/blob/main/src/spec-configuration/containerFeaturesConfiguration.ts) — source of the `RUN --mount=type=bind,target=/tmp/build-features-src/...` template that triggers the bug in lace's environment.
- [containers/podman v5.7.1 release](https://github.com/containers/podman/releases/tag/v5.7.1) — host's installed version, published 2025-12-10.
- [containers/buildah v1.42.2 release](https://github.com/containers/buildah/releases/tag/v1.42.2) — host's installed buildah, published 2025-12-02.
- [containers/buildah v1.42.0 release](https://github.com/containers/buildah/releases/tag/v1.42.0) — first release including PR #6381.
