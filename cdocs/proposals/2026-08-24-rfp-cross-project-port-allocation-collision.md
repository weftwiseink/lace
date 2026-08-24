---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-08-24T14:40:00-07:00
task_list: lace/port-allocation
type: proposal
state: live
status: request_for_proposal
tags: [port-allocation, devcontainer, networking, dev-infra, rfp]
---

# RFP: cross-project host-port allocation collisions

> BLUF: `PortAllocator` reserves host ports per-project and only excludes the CURRENT project's already-bound container ports, so two different lace projects can allocate the same host port and collide on `podman run`.
> This is distinct from, and NOT fixed by, the same-project concurrency mutex in [`fix/port-allocator-concurrency`](../../packages/lace/src/lib/port-allocator.ts); that mutex only serializes allocations within one project's allocator.

## Problem

Each project gets its own `PortAllocator` instance seeded with `ownedPorts = getContainerHostPorts(workspaceFolder, ...)` (`packages/lace/src/lib/up.ts:667`).
`getContainerHostPorts` (`up.ts:99`) filters `podman ps` by `label=devcontainer.local_folder=${workspaceFolder}`, i.e. the CURRENT project's container only.
So project A's allocator has no knowledge of the host ports project B has reserved or published.
The only cross-project guard is the live `isPortAvailable()` TCP probe in `findAvailablePort()`, which misses whenever the sibling project's container is stopped (its published port is not currently listening) or the probe races container start/stop.

Observed: `whelm.localhost` and `jif.localhost` were both allocated host port `22428`.
When both containers try to publish `22428`, the second `podman run` fails.

## Why the concurrency mutex does not cover this

The mutex serializes `allocate()` calls on a single `PortAllocator` instance, guaranteeing distinct ports among labels within one project.
Two projects use two separate allocator instances in two separate `lace up` processes; there is no shared queue, no shared ledger, and each excludes only its own container's ports.
Cross-project distinctness needs a global reservation source, not per-instance serialization.

## Suggested direction (for a full proposal to flesh out)

Seed the allocator's exclusion set from a GLOBAL view of reserved host ports, not just the current project's container:

- Enumerate ALL podman-published host ports on the machine (e.g. `podman ps --format ...` across every container, or `podman port` per container), not only the label-filtered current one, and add them to `ownedPorts`/the used set.
- And/or read every sibling `.lace/port-assignments.json` reservation under a known projects root, so a stopped project's reserved port is still excluded (the TCP probe cannot see a stopped container's port).
- Consider a global lace-level port ledger under `~/.config/lace/` so reservations are authoritative regardless of container run-state.

Open questions for the proposal: which source is authoritative when the two disagree (a stale ledger entry vs a live bind), how to garbage-collect abandoned reservations, and whether allocation should move to a single lace-level broker rather than N independent per-project allocators.

## Scope

Stub only.
Filed as follow-up to the same-project concurrency fix, which unblocked the immediate portless-plus-sshd container-start failure but leaves this cross-project class open.
