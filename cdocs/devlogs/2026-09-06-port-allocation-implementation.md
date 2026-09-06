---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T15:51:45-07:00
task_list: lace/port-allocation
type: devlog
state: live
status: wip
tags: [port-allocation, dev-infra, bugfix]
---

# Devlog: Cross-project host-port allocation implementation

> BLUF: Implementing the accepted proposal [cross-project host-port allocation](../proposals/2026-09-06-cross-project-port-allocation.md) (implementation_ready, R2 accept).
> A lock-guarded global ledger at `~/.config/lace/port-ledger.json`, reconciled on each `lace up` against a machine-wide `podman ps -a` enumeration, feeds an exclusion set into the per-project `PortAllocator`.
> Exclusions gate BOTH `findAvailablePort` AND the `_allocate` reuse short-circuit.
> All work is hermetic: podman is a stubbed subprocess seam, the ledger lives under a temp dir, and new tests stub `isPortAvailable` so they never bind real host ports.

## Plan

Five landing phases (proposal Implementation Phases), each committed independently.
Phases 1-4 land behind no behavior change; Phase 5 wires them into `up.ts`.

1. `podman-ports.ts`: machine-wide `getAllPublishedHostPorts(subprocess)` via `podman ps -a --format json`, parsing `Ports[].host_port` + `devcontainer.local_folder` label, with a `podman inspect .HostConfig.PortBindings` fallback for stopped containers.
2. `port-ledger.ts`: types, atomic `loadLedger`/`saveLedger` (corrupt-tolerant), pure `reconcileLedger` and `computeExclusions`.
3. `withLedgerLock(path, fn)`: cross-process lock, pid-liveness primary, mtime subordinate, guaranteed release.
4. `PortAllocator` exclusions: injected set consumed by BOTH `findAvailablePort` AND the reuse short-circuit; exhaustion error lists ledger holders. `isPortAvailable` made injectable for hermetic tests.
5. Coordinator in `up.ts` (~726-727): within `withLedgerLock`, enumerate podman + reconcile ledger + compute exclusions, seed allocator, persist ledger + per-project file.

## Environmental baseline (pre-change test run)

Recorded on a pristine checkout before any edits, so introduced regressions are separable from the environment.

`pnpm --filter lace test`: 5 failed / 892 passed / 3 skipped / 1 todo.
- `port-allocator.test.ts` (4 failed): all bind or probe real host ports 22430-22432, which live containers on this host already hold. `reuses existing assignment ...`, `reassigns when existing port is in use`, `reuses saved port when it is in ownedPorts ...`, `reassigns when saved port is blocked ...`. EADDRINUSE / probe-returns-in-use. Pre-existing and environmental, not touched by this work.
- `fundamentals-scenarios.test.ts` (1 failed): `Scenario F3: feature metadata validation` — unrelated to port allocation.

These are the environmental baseline; new tests below are hermetic (stub `isPortAvailable`, tmpdir ledger, stubbed podman) and must never bind real ports.

## Work Log

### Phase 1: machine-wide podman enumeration (done)

Added `podman-ports.ts` with `getAllPublishedHostPorts(subprocess): PublishedPort[]`.
Runs `podman ps -a --format json` behind the `RunSubprocess` seam and `getPodmanCommand()`, parses `Ports[].host_port` (integer, > 0) and the `devcontainer.local_folder` label per container.
Per-container `podman inspect <id> --format '{{json .HostConfig.PortBindings}}'` fallback fires only when `ps -a` reports zero host ports for a listed container, covering podman versions that omit stopped host ports from `ps -a`.
Fails safe: non-zero `ps -a` exit or unparseable output returns `[]` so allocation degrades to the ledger arm.

8 hermetic tests (`podman-ports.test.ts`), all green: running/stopped/non-lace parse + attribution, empty/absent Ports, inspect fallback, no-inspect-when-ps-has-ports, empty list, non-zero exit, unparseable output, zero/non-integer host_port filtering.
No wiring. typecheck clean.

### Phase 2: ledger module, pure core (done)

Added `port-ledger.ts`: `LedgerEntry`/`PortLedger` types, `loadLedger`/`saveLedger` (atomic temp-file + rename, `mkdir -p` parent, corrupt/missing tolerant with a warning), and the pure `reconcileLedger` and `computeExclusions`, plus a pure `upsertAssignments` helper for the coordinator's merge-back.

`reconcileLedger`: live-podman-wins ownership rewrite; lastSeen refresh for any port with a live container of any run-state (so a stopped-but-defined sibling never ages out); reclaim only when no live reference AND aged past threshold.
`computeExclusions`: union of ledger-other-projects and live-non-current ports; excludes nothing the current project owns.

Deviation (documented in code NOTE): the proposal names workspace-gone as a reclaim contributor but specifies no distinct threshold, only that it requires no-live AND age and never reclaims on a single failed stat.
Implemented as a shorter accelerated window (`WORKSPACE_GONE_STALE_MS` = 7 days) versus the default 30 days, gating `projectExists` so it has a real, bounded effect while never reclaiming a live or recently-seen reservation.

14 hermetic tests (`port-ledger.test.ts`), all green, including reclaim-on-removal-not-on-stop, ownership rewrite, union exclusion across projects, stopped-sibling exclusion via the live arm, reserved-but-unbound exclusion via the ledger arm, atomic round-trip, corrupt/missing/malformed degradation. typecheck clean.

### Phase 3: cross-process lock (done)

Added `withLedgerLock(ledgerPath, fn, options)` to `port-ledger.ts`.
Acquisition is an atomic `mkdirSync` of `${ledgerPath}.lock` (OS-level arbiter); owner pid/host/time recorded in `owner.json` inside the lock dir.
Stale detection is pid-liveness PRIMARY (`kill(pid,0)`, EPERM counts as alive): a held lock is broken only when the recorded owner pid on this host is dead.
mtime is strictly SUBORDINATE, consulted only when the owner is cross-host or its record is unreadable, and never preempts a live local pid.
Guaranteed release (`rmSync`) in `finally`, so a throwing critical section still frees the lock.
`isPidAlive` and `now` are injectable for hermetic tests; `lockPathFor` exported.

6 hermetic tests (`port-ledger-lock.test.ts`), all green: concurrent-coordinator serialization with both writes surviving (no lost update), dead-pid break-and-acquire, no-preempt-live-holder even with a tiny mtime threshold, waiter-blocks-until-real-release ordering, release-on-throw, return-value passthrough. No real ports bound. typecheck clean.
