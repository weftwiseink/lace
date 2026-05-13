---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T14:50:30-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [podman, buildkit, runtime_validated, experiment, rfp_input]
---

# Pretest: Can `--buildkit never` Be Dropped If We Keep `RUN chmod 1777 /tmp`?

> BLUF: No.
> On Fedora 43 + podman 5.7.1 + buildah 1.42.2, `RUN chmod 1777 /tmp` in the base Dockerfile is NOT sufficient to work around `containers/buildah#6503`.
> The chmod survives the base image build (verified: `/tmp` is `1777 root:root` in the standalone built image), but subsequent devcontainer-CLI feature-install layers re-corrupt `/tmp` via the `RUN --mount=type=bind,target=/tmp/build-features-src/<id>` pattern.
> The second feature's `apt-get update` fails identically in both variants.
> **`--buildkit never` is load-bearing.** It cannot be dropped from `up.ts:1311` or `prebuild.ts` without breaking feature installs on this host.

## Context

- Bug investigation: `cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`
- Lace mitigation lives in `packages/lace/src/up.ts:1311` (`--buildkit never`) and `packages/lace/src/prebuild.ts`, plus `RUN chmod 1777 /tmp` in lace's base Dockerfile.
- The investigation speculated that chmod alone may suffice. This experiment falsifies that hypothesis.

## Experiment Setup

Two minimal devcontainer fixtures at `/tmp/lace-tmpbug-experiment/.devcontainer/`, each with the same two features (`git:1`, `sshd:1`) and identical base image (`node:24-bookworm`).
The only difference is the presence of `RUN chmod 1777 /tmp` in the Dockerfile.
Both invoked the devcontainer CLI WITHOUT `--buildkit never`:

```sh
devcontainer build --workspace-folder . \
  --config .devcontainer/devcontainer.<variant>.json \
  --docker-path "$(which podman)" \
  --image-name tmpbug-experiment-<variant>:latest
```

Tooling: devcontainer CLI 0.83.0, podman 5.7.1, buildah 1.42.2.

## Variant 1 (no chmod) Result

Exit code: **1**.
The `git` feature installs cleanly.
The `sshd` feature's `apt-get update` fails with the exact bug signature:

```
[3/3] STEP 7/10: RUN --mount=type=bind,from=dev_containers_feature_content_source,source=sshd_1,target=/tmp/build-features-src/sshd_1 ...
Running apt-get update...
Err:1 http://deb.debian.org/debian bookworm InRelease
  Couldn't create temporary file /tmp/apt.conf.Cz1aDt for passing config to apt-key
Err:2 http://deb.debian.org/debian bookworm-updates InRelease
  Couldn't create temporary file /tmp/apt.conf.i3HfOi for passing config to apt-key
Err:3 http://deb.debian.org/debian-security bookworm-security InRelease
  Couldn't create temporary file /tmp/apt.conf.7iZNXN for passing config to apt-key
ERROR: Feature "SSH server" (ghcr.io/devcontainers/features/sshd) failed to install!
Error: building at STEP ... exit status 100
```

Reproduces the bug as predicted.

## Variant 2 (chmod only) Result

Exit code: **1**.
Identical failure mode. The `git` feature installs (its first `RUN --mount=type=bind` produces the layer-diff that corrupts `/tmp`), then `sshd`'s `apt-get update` fails:

```
[3/3] STEP 7/10: RUN --mount=type=bind,from=dev_containers_feature_content_source,source=sshd_1,target=/tmp/build-features-src/sshd_1 ...
Err:1 http://deb.debian.org/debian bookworm InRelease
  Couldn't create temporary file /tmp/apt.conf.sZXeQd for passing config to apt-key
Err:2 ... /tmp/apt.conf.zD3942 ...
Err:3 ... /tmp/apt.conf.ccfMNP ...
```

Sanity check on the base image (built directly with `podman build`, no devcontainer features, no `--mount=type=bind`):

```
$ podman run --rm tmpbug-base-chmod-check:latest stat -c '%a %U:%G' /tmp
1777 root:root
```

The chmod DID hold at base-image build time. The corruption occurs LATER, during the devcontainer CLI's feature-install layers that use `RUN --mount=type=bind`. Re-applying the chmod once at base time does not protect subsequent layers.

## Conclusion

**`--buildkit never` cannot be dropped.**
The buildah `/tmp`-corruption bug manifests on each `RUN --mount=type=bind` layer that has on-disk write-modify activity in `/tmp` outside the bind target.
A one-time chmod in the base layer does not propagate forward through subsequent corrupted layers.
To make `RUN --mount=type=bind` safe under buildah's layered builder on this host, every such RUN would need to re-chmod `/tmp` itself - and lace does not control the devcontainer feature template.

The `--buildkit never` flag in `up.ts:1311` is correct as written. It forces the legacy non-cached path that does NOT trip the bug.

## Implications

**For the H2 test plan in `cdocs/proposals/2026-05-12-podman-prebuild-cache-rethink.md`:**
The hypothesis "chmod alone in lace's Dockerfile suffices" must be reframed as falsified.
The test plan should retain `--buildkit never` as a hard requirement for any podman-backed feature install path, not an optional optimization.

**For a potential lace patch:**
Do not drop `--buildkit never` from `up.ts:1311` or `prebuild.ts`. Doing so will break every multi-feature devcontainer build on Fedora 43 + podman 5.7.1.
The chmod in lace's base Dockerfile remains useful as defense-in-depth for non-devcontainer-CLI consumers of the image, but it is not sufficient on its own.

> NOTE(opus/prebuild-cache-rethink): The bug is layer-diff-induced, not base-image-state-induced. Any future workaround that aims to drop `--buildkit never` must address the corruption at each `RUN --mount=type=bind` layer, not at base image construction time. Upstream fix in buildah is the only clean path.

## Raw Logs

Logs were captured in `/tmp/lace-tmpbug-experiment/{no-chmod,with-chmod,base-build}.log` during the run. The relevant 10-line snippets are inlined above in the Variant 1 and Variant 2 sections. The temporary fixture and logs are removed during cleanup; the failure signatures and exit codes captured here are the artifacts of record.
