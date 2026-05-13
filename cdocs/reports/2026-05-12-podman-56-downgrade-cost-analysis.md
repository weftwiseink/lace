---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T15:30:00-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [podman, downgrade_analysis, workaround, rfp_input]
---

# Cost of Downgrading Podman 5.7.1 to 5.6.2 on Fedora 43 as Workaround for buildah#6503

> BLUF: Downgrading to `podman 5.6.2 / buildah 1.41.5` on Fedora 43 is technically straightforward but the evidence that 5.6 escapes `containers/buildah#6503` is circumstantial, not confirmed.
> The 5.7 -> 5.6 feature delta is small and mostly Quadlet- or remote-client-flavored; the substantive loss is the CVE-2025-52881 (runc escape) fix that shipped in 5.7.0.
> Upstream fix timeline is unbounded: the only fix in flight (`containers/container-libs#725`) has `changes_requested` against it with the maintainer preferring a kernel-level alternative (`#701`) that requires unreleased Linux kernel work.
> **Recommendation: keep the existing `--buildkit never` + `RUN chmod 1777 /tmp` stack; do not downgrade.**
> If a single-axis fix is desired later, try `fuse-overlayfs` before considering a downgrade.

## Context

This report informs the `lace/prebuild-cache-rethink` workstream's decision about whether to downgrade podman as an alternative to lace's `--buildkit never` workaround.
Related documents:

- Bug investigation: [`cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`](./2026-05-12-podman-tmp-buildkit-bug-investigation.md).
- Pretest experiment falsifying "chmod alone is enough": [`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](./2026-05-12-pretest-experiment-buildkit-never-drop.md).
- Prebuild RFP: [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md).

Host: Fedora 43, kernel 6.17.12, podman 5.7.1, buildah 1.42.2, devcontainer CLI 0.83.0 (Linuxbrew), crun 5.7.1, rootless mode, overlay graph driver.

## Method

Sources consulted (read-only):

- `containers/podman` release notes for v5.6.0 through v5.8.2 via `gh release view`.
- `containers/podman` open milestones (zero open milestones, no 5.9 / 6.0 listed) via `gh api`.
- `containers/buildah#6503` thread and cross-references via `gh issue view`.
- `containers/container-libs#725` and `#701` (active and RFC successor PRs to the closed `containers/storage#1653`).
- Fedora repo state via `dnf list --showduplicates podman` and `dnf list --showduplicates buildah`.
- Linuxbrew status via `brew info devcontainer`.
- `rpm -qi`, `podman info`, and `Grep` over `packages/lace/src/` for podman-version assumptions.

## 5.7 -> 5.6 Feature Delta

**Security loss:** CVE-2025-52881 (runc container escape via arbitrary write gadgets and procfs redirects) is patched in 5.7.0.
The host uses `crun` not `runc`, so direct exposure is limited, but a `dnf` operation could pull `runc` in as the package is `Recommends`-listed.

**Functional loss (5.7.0 features):** TLS / mTLS for the remote API and `podman system service`; `--creds` / `--cert-dir` on `podman run` / `podman create`; multi-file `podman kube play`; Quadlet additions (`HttpProxy`, `StopTimeout`, `.build` `BuildArg` / `IgnoreFile`, `.artifact` type, templated dependencies); machine-VM image-load optimization.
**None of these are exercised by lace.**

**Bugfixes lost (5.7.0):** runc `--userns=ns:/path` regression (irrelevant for crun); `podman build` SBOM-options handling; remote-client attach-output race; Windows WSL re-pull bug.
None observed by lace.

**5.7.1-specific:** four small bugfixes (FreeBSD device emulation, rootless `system migrate` panic, rootless user namespace recreation race, `kube play` fd leak).
The rootless-namespace-race fix is theoretically interesting but not observed.

**5.8.x additions also forgone:** `podman exec --no-session` perf flag, `podman update --ulimit`, Quadlet `AppArmor`, automatic BoltDB-to-SQLite migration.
None load-bearing.

**Net:** the feature regression on lace's specific host is **minimal in functional terms**; the substantive cost is the CVE-2025-52881 patch.

## Downgrade Procedure

Fedora 43 carries both versions in standard repositories:

```
podman.x86_64  5:5.6.2-1.fc43  fedora           # available downgrade target
podman.x86_64  5:5.7.1-1.fc43  updates-archive  # currently installed
podman.x86_64  5:5.8.2-1.fc43  updates          # current updates head
buildah.x86_64 2:1.41.5-1.fc43 fedora           # paired downgrade target
buildah.x86_64 2:1.42.2-1.fc43 updates-archive  # currently installed
buildah.x86_64 2:1.43.1-1.fc43 updates
```

5.6.2 is the last 5.6.x release upstream (5.6 jumped to 5.7 after 5.6.2).
Target pair: `podman-5.6.2-1.fc43` + `buildah-1.41.5-1.fc43`.

Steps (research only; do not execute):

```sh
sudo dnf downgrade --refresh podman-5:5.6.2-1.fc43 buildah-2:1.41.5-1.fc43
sudo dnf install python3-dnf-plugin-versionlock  # if missing
sudo dnf versionlock add podman-5:5.6.2-1.fc43 buildah-2:1.41.5-1.fc43
sudo dnf versionlock list  # verify
podman system migrate  # rootless, regenerate user namespace
```

Watch-outs:

- `crun` does not need a matching downgrade; 5.7.1 works with podman 5.6.2.
- Storage at `~/.local/share/containers/storage/` does not migrate; SQLite database is cross-compatible across 5.6 / 5.7 / 5.8.
- BoltDB / SQLite warning is moot; lace's host is already on SQLite (default since podman 5.0).
- The `excludepkgs=golang-github-nvidia-container-toolkit` line in `/etc/dnf/dnf.conf` is unrelated.
- Automatic re-upgrade vector is only `dnf upgrade`; versionlock blocks it.

## Compatibility Risks

**devcontainer CLI 0.83.0 (Linuxbrew):** `package.json` declares only `node >=20.0.0`; no documented podman version requirement.
The CLI shells out via `--docker-path` without version-gating.
Linuxbrew stable is 0.86.1, so the host is also behind on the CLI (unrelated to podman).
**Net risk: none.**

**buildah 1.42.2 -> 1.41.5 (forced as part of downgrade):** 1.41.0-1.41.4 had the `0700` mount-target regression (`containers/buildah#6233`); 1.41.5 contains `#6381` which fixed it.
1.41.5 is the regression-free floor for the `--mount` codepath.
**Net risk: 1.41.5 is a known-good buildah for this workflow.**

**crun 5.7.1:** unaffected by the downgrade; OCI runtime ABI is stable.
**Net risk: none.**

**Lace source:** `Grep` of `packages/lace/src/` finds no `>=5.7` checks, no API dependencies introduced in 5.7.
`--buildkit never` and `BUILDAH_LAYERS` predate 5.6.
**Net risk: none.**

**Image and container state:** no breaking format changes between 5.6.2 and 5.7.1.

## Upstream Fix Timeline

The bug investigation noted `containers/storage#1653` was closed without merge on 2025-08-26 when the repo migrated to `containers/container-libs`.
Two successor PRs are now open:

**[`containers/container-libs#725`](https://github.com/containers/container-libs/pull/725)** — "storage: preserve lower-layer metadata for implicit directories" by `@ProAdubois` (non-maintainer), opened 2026-03-29, +957 / -140 lines.
State: **OPEN with `CHANGES_REQUESTED`** as of 2026-03-30.
Maintainer `@mtrmac` review: "the desired behavior should be decided in the OCI spec ... #701 proposes a much simpler implementation."
No further commits or maintainer engagement since 2026-03-30.

**[`containers/container-libs#701`](https://github.com/containers/container-libs/pull/701)** — "RFC: overlay dirmeta_delegate design" by `@jeckersb` (Red Hat, bootc), opened 2026-03-17, draft.
Requires a new kernel feature (`CONFIG_OVERLAY_FS_DIRMETA_DELEGATE=y`) that is not yet upstream in Linux.
Author explicitly states they want feedback "before I start trying to clean up things and push on the kernel side."

**Maintainer position:** `@mtrmac` frames overlay-driver-only fixes as architecturally suboptimal; prefers OCI-spec resolution or kernel support.
Neither path has a public timeline.

**Issue #6503 itself:** last substantive comment 2026-05-11 (`@meklu`'s `apt-get` wrapper workaround); stale-bot pings 2025-12-14 and 2026-01-21.
Not assigned to any milestone (podman has zero open milestones as of 2026-05-12).

**Realistic ETA:**

- Optimistic (PR #725 negotiated to acceptance, vendored, packaged): **6-12 months**.
- Pessimistic (PR #701 path, kernel landing required): **>12 months**.
- **No fix is currently scheduled for podman 5.9 or 6.0.**
  Podman 6.0's only announced theme is BoltDB removal; #6503 is not on the roadmap.

## Recommendation

**Do not downgrade.**
Four reasons:

1. **The bug is suspected absent in 5.6 but not confirmed.**
   The earlier bug investigation framing ("5.6 lacks the bug") tested the wrong axis: PR #6381 fixed the `0700 -> 0755` regression, which is a separate bug from the `1777 -> 755` overlay-layer-diff issue `@nalind` attributes #6503 to.
   The overlay-implicit-parent-directory bug is structural to the overlay driver with `--layers` (default), not a 5.7 regression.
   No #6503 comment affirmatively reports 5.6.x as clean; the only "downgrade fixed it" comment from `@Kaniska244` targets the *different* `0700` regression already fixed in 5.6.2.
   Confidence in "5.6.2 escapes #6503" rests on absence of contrary reports, not positive evidence.

2. **Lace has two working mitigations already stacked.**
   `--buildkit never` plus `RUN chmod 1777 /tmp`, both proven necessary by the pretest experiment.
   Neither has measurable runtime cost on lace's workflow.
   Adding a third mitigation (downgrade) does not improve robustness.

3. **The security delta is non-zero.**
   CVE-2025-52881 was patched between 5.6.2 and 5.7.0.
   The host runs `crun`, so direct exposure is limited but not nil.
   Pinning to a pre-CVE podman creates a small but real attack surface plus ongoing CVE-monitoring burden.

4. **Upstream fix is not imminent but is not infinite.**
   Even on the pessimistic 12-month timeline, by the time #6503 resolves lace will likely have iterated past this concern.
   A downgrade-and-pin commits the host to manual unpinning later when the fix ships; the existing workaround imposes no such friction.

**Alternative: `fuse-overlayfs` storage driver.**
Not measured in this report.
Qualitative tradeoff: avoids the kernel-overlay bug entirely, at typical 10-30% performance penalty.
For lace's dev-loop workflow (occasional `up`, frequent inner-loop work), the throughput hit may be tolerable.
Preferable to a downgrade if a single-axis fix becomes desired, because it does not regress security and does not require pinning.

**Bottom line:** keep `--buildkit never` and `RUN chmod 1777 /tmp` as currently deployed.
Monitor `containers/container-libs#725` and `#701` for movement.
If a hard blocker emerges that the existing mitigations cannot route around, reconsider in this order: (a) try `fuse-overlayfs`, (b) try `buildah build` directly bypassing the CLI, (c) downgrade as last resort.

## Citations

- [containers/buildah#6503](https://github.com/containers/buildah/issues/6503) — primary upstream bug. OPEN. Last activity 2026-05-11.
- [containers/container-libs#725](https://github.com/containers/container-libs/pull/725) — successor fix PR. OPEN, CHANGES_REQUESTED 2026-03-30.
- [containers/container-libs#701](https://github.com/containers/container-libs/pull/701) — RFC dirmeta_delegate alternative requiring kernel work. OPEN draft.
- [containers/storage#1653](https://github.com/containers/storage/pull/1653) — `@nalind`'s closed-without-merge predecessor (2025-08-26).
- [containers/podman v5.6.0 release notes](https://github.com/containers/podman/releases/tag/v5.6.0) — feature baseline.
- [containers/podman v5.6.2 release notes](https://github.com/containers/podman/releases/tag/v5.6.2) — downgrade target.
- [containers/podman v5.7.0 release notes](https://github.com/containers/podman/releases/tag/v5.7.0) — features that would be lost; CVE-2025-52881 fix.
- [containers/podman v5.7.1 release notes](https://github.com/containers/podman/releases/tag/v5.7.1) — current host version.
- [containers/podman v5.8.2 release notes](https://github.com/containers/podman/releases/tag/v5.8.2) — current updates head.
- [CVE-2025-52881](https://nvd.nist.gov/vuln/detail/CVE-2025-52881) — runc escape addressed in 5.7.0.
- [Fedora package: podman](https://packages.fedoraproject.org/pkgs/podman/podman/) — source of `dnf` repo data.
- [Homebrew formula: devcontainer](https://formulae.brew.sh/formula/devcontainer) — Linuxbrew package; stable 0.86.1, no podman version constraint.
- [`cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`](./2026-05-12-podman-tmp-buildkit-bug-investigation.md) — companion bug investigation.
- [`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](./2026-05-12-pretest-experiment-buildkit-never-drop.md) — companion pretest.
- [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md) — parent RFP.
