---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T15:20:18-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [podman, fuse-overlayfs, storage_driver, runtime_validated, experiment, rfp_input]
---

# Experiment: Does `fuse-overlayfs` Sidestep `containers/buildah#6503`?

> BLUF: No.
> Switching podman's overlay `mount_program` to `/usr/bin/fuse-overlayfs` (userland FUSE implementation) does not avoid `containers/buildah#6503` on this host.
> The devcontainer build fails at the second feature install with the identical `Couldn't create temporary file /tmp/apt.conf.XXX` error, and `/tmp` regresses from `1777` to `755` at the first feature-install layer just as it does under the kernel `overlay` driver.
> The bug lives above the storage driver, in `containers/storage`'s overlay graph-driver layer-diff logic (which both backends share). Fuse-overlayfs does not unblock the upstream `BUILDKIT_INLINE_CACHE` path.

## Context

- Bug investigation: `cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`
- Pre-test experiment (chmod 1777 alone is insufficient): `cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`
- RFP this feeds: `cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`
- Hypothesis tested: fuse-overlayfs is a userland implementation with potentially different layer-diff semantics; if it inherits `/tmp`'s `1777` correctly when a layer blob omits the explicit `/tmp` entry, the kernel-overlay-only mitigation (`--buildkit never`) could be retired.

## Method

Isolated storage at `/tmp/lace-fuseovl-experiment/` to avoid touching `~/.local/share/containers/storage` (16G baseline, unchanged after).

```toml
# storage.conf
[storage]
driver = "overlay"
graphroot = "/tmp/lace-fuseovl-experiment/root"
runroot = "/tmp/lace-fuseovl-experiment/runroot"
[storage.options]
mount_program = "/usr/bin/fuse-overlayfs"
[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
```

> NOTE(opus/fuseovl-experiment): Podman 5.7.1 rejects `driver = "fuse-overlayfs"` as unknown.
> The supported pattern is `driver = "overlay"` + `mount_program = "/usr/bin/fuse-overlayfs"`, which routes mounts through the userland FUSE binary instead of the kernel overlay module.

Isolation verified before any build via `podman info`: `graphDriverName: overlay`, `mount_program: /usr/bin/fuse-overlayfs`, `graphRoot: /tmp/lace-fuseovl-experiment/root`.

Same fixture as the pre-test: `Dockerfile.with-chmod` (with `RUN chmod 1777 /tmp` early), `devcontainer.json` requesting `git:1` + `sshd:1`.
Build via `CONTAINERS_STORAGE_CONF=/tmp/lace-fuseovl-experiment/storage.conf devcontainer build ... --docker-path "$(which podman)"`.

Tool versions: podman 5.7.1, buildah 1.42.2, devcontainer CLI 0.83.0, fuse-overlayfs 1.13, kernel 6.17.12-300.fc43.

## Result

Exit code: 100 (failure), at the sshd feature install step.

Per-layer `/tmp` audit (using `podman run --rm <hash> stat -c '%a %U:%G' /tmp`):

| Layer | Stage / Role | `/tmp` |
| --- | --- | --- |
| `f546c3dc27a7` | Dockerfile final (after `chmod 1777 /tmp`) | `1777 root:root` |
| `0c499cde3da5` | feature normalize, USER root | `1777 root:root` |
| `5074ead00476` | feature normalize, `chmod -R 0755 /tmp/build-features/` | `1777 root:root` |
| `065176f825a3` | target stage USER root | `1777 root:root` |
| `46938d70a9d8` | `mkdir -p /tmp/dev-container-features` | `1777 root:root` |
| `14fea4974f80` | COPY feature normalize artifacts | `1777 root:root` |
| `a12aead8e33f` | append `_CONTAINER_USER_HOME` to env | `1777 root:root` |
| `0f1c324b8c01` | **git feature install (first feature)** | **`755 root:root`** |

The flip happens at exactly the same architectural location as under kernel overlay: the first feature-install `RUN --mount=type=bind,target=/tmp/build-features-src/<id>` layer.
git itself is `os-provided` so apt was not invoked there; the regression nonetheless materializes in the resulting layer, and the next feature (sshd) inherits `/tmp 755` and immediately fails `apt-get update`.

## Conclusion

Fuse-overlayfs does not unblock the upstream-cache path on this host.
The bug is not in the kernel overlay module - it is in `containers/storage`'s overlay graph driver (the Go code that interprets layer tar blobs and synthesizes parent directories absent from the blob).
That code is shared between the kernel `overlay` driver and the userland `fuse-overlayfs`-backed `overlay` configuration, so swapping the mount program changes nothing.
`--buildkit never` remains load-bearing for lace on Fedora 43 + podman 5.7.1.

## Implications

For lace's rootless podman workflow on this host:
- The `--buildkit never` mitigation in `packages/lace/src/up.ts:1311` and `packages/lace/src/prebuild.ts` must stay.
- Recommending fuse-overlayfs to users as a workaround is not justified: it has the bug and adds runtime cost.
- The RFP's "Option D: opt in to BuildKit caching once #6503 is fixed upstream" remains the only realistic path to `BUILDKIT_INLINE_CACHE` support on rootless podman + Fedora.

If a future buildah release fixes #6503, fuse-overlayfs should be re-tested - but the fix and the storage driver are independent variables, and the fix alone is sufficient (kernel overlay should work).
There is no reason to require fuse-overlayfs.

## Caveats and Performance Notes

One fixture on one host.
Different kernel, podman, or fuse-overlayfs versions could in principle behave differently, though the architectural argument (shared `containers/storage` code path) suggests they will not.

Fuse-overlayfs is userland FUSE: every filesystem operation traverses user space, imposing a non-trivial cost vs the kernel overlay driver.
The containers project documents it as the rootless fallback for filesystems where the kernel module is unavailable (older kernels, some btrfs-on-btrfs setups); on a modern Fedora kernel where native overlay works, fuse-overlayfs is strictly slower.
> NOTE(opus/fuseovl-experiment): No benchmarks collected here; the slowdown is a well-known property of userland FUSE, not an empirical claim from this experiment.

## Raw Log

```
[3/3] STEP 6/10: RUN --mount=type=bind,from=...source=git_0... ./devcontainer-features-install.sh ...
Feature       : Git (from source)
Detected existing system install: git version 2.39.5
--> 0f1c324b8c01
[3/3] STEP 7/10: RUN --mount=type=bind,from=...source=sshd_1... ./devcontainer-features-install.sh ...
Feature       : SSH server
Running apt-get update...
Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]
Get:2 http://deb.debian.org/debian bookworm-updates InRelease [55.4 kB]
Err:1 http://deb.debian.org/debian bookworm InRelease
  Couldn't create temporary file /tmp/apt.conf.ZyAKIT for passing config to apt-key
Err:2 http://deb.debian.org/debian bookworm-updates InRelease
  Couldn't create temporary file /tmp/apt.conf.2MLejn for passing config to apt-key
Err:3 http://deb.debian.org/debian-security bookworm-security InRelease
  Couldn't create temporary file /tmp/apt.conf.3IBDFj for passing config to apt-key
W: GPG error: ... Couldn't create temporary file /tmp/apt.conf.ZyAKIT for passing config to apt-key
E: The repository 'http://deb.debian.org/debian bookworm InRelease' is not signed.
ERROR: Feature "SSH server" (ghcr.io/devcontainers/features/sshd) failed to install!
Error: building at STEP "RUN --mount=type=bind,...,source=sshd_1,...": exit status 100
Exit code 100
```

Image `0f1c324b8c01` (post-git-feature) inspected directly: `stat -c '%a %U:%G' /tmp` -> `755 root:root`.
Identical failure mode to the pre-test under the kernel overlay driver.
