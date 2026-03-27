---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-27T09:00:00-07:00
task_list: lace/podman-compatibility
type: proposal
state: live
status: request_for_proposal
tags: [podman, btrfs, bind_mount, compatibility]
---

# RFP: Podman Btrfs Bind Mount Path Resolution

> BLUF: When rootless podman bind-mounts a host directory into a container on btrfs, processes inside the container resolve their CWD to the host filesystem path rather than the container mount target.
> This is unexpected, may have useful applications, but also causes silent path encoding mismatches in tools that derive state from CWD.
>
> - **Motivated By:** `cdocs/reports/2026-03-26-sprack-tui-verification-gap.md`, commit `7ee4768`

## Objective

Understand the btrfs bind mount path resolution behavior in rootless podman, document when and why it occurs, evaluate whether it's a bug or feature, and determine how lace/sprack should handle it.

## Scope

- What exactly causes CWD to resolve to the host path? Is it btrfs-specific, overlay-specific, or a general podman/namespace behavior?
- Does this happen with all bind mounts, or only workspace mounts? What about `/mnt/sprack/`?
- Is this behavior documented anywhere in podman/buildah/OCI specs?
- Could this be useful? (e.g., host-side tools knowing the container's "real" path without translation)
- What are the risks? (e.g., Claude Code encoding session paths differently than expected)
- Should lace normalize paths at the mount boundary, or should consumers (sprack) handle both encodings?

## Open Questions

1. Is this reproducible on ext4 or xfs, or is it btrfs-specific?
2. Does `--userns=keep-id` (which lace uses) contribute to this behavior?
3. Does the devcontainer CLI's `--mount-workspace-git-root` flag affect this?
