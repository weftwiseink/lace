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

### Phase 4: allocator exclusions (done)

Extended `PortAllocator` with a `PortAllocatorOptions` second-constructor form (`{ ownedPorts, exclusions, exclusionHolders, isPortAvailable }`), still accepting a bare `Set<number>` as `ownedPorts` for backward compatibility.
Exclusions are consumed by BOTH `findAvailablePort` (skips `assignments ∪ exclusions` before the probe) AND the `_allocate` reuse short-circuit: reuse `existing` only if `!exclusions.has(existing.port)` AND (`ownedPorts.has(existing.port)` OR probe free); otherwise fall through to a fresh port.
Exclusion gates AHEAD of `ownedPorts`, so an ownership flip wins even if `ownedPorts` still lists the port.
Exhaustion error now appends cross-project reservation holders from `exclusionHolders` when present.
`isPortAvailable` is injectable (`this.probe`) so all new tests are hermetic.

6 hermetic tests (`port-allocator-exclusions.test.ts`), all green: excluded-but-probe-free never returned by `findAvailablePort`, the finding-#1 ownership-flip reuse regression (stored `.lace` port now excluded, `ownedPorts` empty, probe free -> not reused, falls through to fresh), unexcluded stored port still reused, exclusion-wins-over-ownedPorts, exhaustion error lists holders, bare-Set backward compat. No real binds. Existing `port-allocator.test.ts` unchanged (its EADDRINUSE failures are the pre-recorded environmental baseline). typecheck clean.

### Phase 5: coordinator wiring (done)

Replaced the seam at `up.ts` (formerly 726-727). The allocation step now runs inside `withLedgerLock(resolveLedgerPath(), ...)`:
enumerate `getAllPublishedHostPorts(subprocess)`, `reconcileLedger(loadLedger(path), live, existsSync, now)`, `computeExclusions` + `describeExclusions` for the workspace, seed `new PortAllocator(workspaceFolder, { ownedPorts, exclusions, exclusionHolders })`, `resolveTemplates`, `portAllocator.save()` + `mountResolver.save()`, then `upsertAssignments` into the reconciled ledger and one atomic `saveLedger`.
The single final save commits both the merge-back and the reconcile-pass GC.
`resolveLedgerPath()` honors `LACE_PORT_LEDGER` so the ledger is temp-homeable without touching `$HOME`.
Added `describeExclusions` (port -> holder/reason, live-podman-wins attribution) for the actionable exhaustion error.
The `.lace/port-assignments.json` per-project record is retained unchanged.

Coordinator composition test (`port-allocation-coordinator.test.ts`), 4 hermetic cases, all green: the whelm/jif stopped-sibling regression (ledger + `ps -a`; another project must not get 22428), lost/corrupt-ledger degradation to the `ps -a` arm alone still excluding the stopped sibling, the ownership-flip no-reuse regression through the full reconcile->exclude->allocate path, and two sequential projects receiving distinct ports with both ledger entries surviving.
These exercise the real modules in the exact locked sequence `up.ts` uses; the full container-driven `up()` E2E is the proposal's deferred Phase 6.

## Verification

Commands run from the worktree root (`/var/home/mjr/code/weft/lace/impl-port-allocation`).

- `pnpm --filter lace typecheck`: clean (tsc --noEmit, no errors).
- `pnpm --filter lace build`: clean (vite build, 32 modules, dist/index.js emitted).
- `pnpm --filter lace test`: 5 failed / 930 passed / 3 skipped / 1 todo.
  - Passing count rose from the 892 baseline by exactly 38, the count of new hermetic tests (8 podman-ports + 14 port-ledger + 6 lock + 6 exclusions + 4 coordinator).
  - The 5 failures are byte-for-byte the pre-change environmental baseline, none introduced by this work:
    - `port-allocator.test.ts` (4): `reuses existing assignment ...`, `reassigns when existing port is in use`, `reuses saved port when it is in ownedPorts ...`, `reassigns when saved port is blocked ...`. All bind or probe real host ports 22430-22432 that live containers on this host hold (EADDRINUSE / probe-in-use). They reproduce on pristine `main`. Not touched: this work adds a NEW hermetic file rather than editing them.
    - `fundamentals-scenarios.test.ts` (1): `Scenario F3: feature metadata validation` — unrelated to port allocation, failing at baseline.

All new tests are hermetic: podman is a stubbed `RunSubprocess`, ledgers live under `tmpdir()`, and `isPortAvailable` is stubbed, so no new test binds a real host port.
