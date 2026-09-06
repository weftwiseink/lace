---
review_of: cdocs/proposals/2026-09-06-cross-project-port-allocation.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T12:30:00-07:00
task_list: lace/port-allocation
type: review
state: live
status: done
tags: [fresh_agent, architecture, port-allocation, concurrency, test_plan, runtime_validated]
---

# Review: Cross-project host-port allocation (locked global ledger + live-podman reconciliation)

## Summary Assessment

The proposal promotes the cross-project port-collision RFP into a full design: a lock-guarded global ledger at `~/.config/lace/port-ledger.json`, reconciled on each `lace up` against a machine-wide `podman ps -a` enumeration, feeding an exclusion set into the existing per-project `PortAllocator`.
The core architecture is sound and well-reasoned: the occupancy-vs-ownership decomposition ("union wins for exclusion, live podman wins for ownership") is the right conceptual frame, the Background is accurate against the real code, and the test plan is genuinely hermetic.
Verdict: **Revise.**
Two blocking issues: (1) the exclusion set is only wired into `findAvailablePort`, but the reuse branch in `_allocate` (`port-allocator.ts:170`) bypasses it and reintroduces the exact collision on a project's re-`up` after ownership has flipped; (2) the corrupt/lost-ledger degradation claim is internally contradictory with the "podman may not report stopped ports" hedge on the same load-bearing behavior. I ran that behavior empirically (podman 5.8.2) and it holds, which points to a clean resolution rather than a redesign.

## Runtime verification performed

I probed the load-bearing podman behavior directly on the user's machine (podman 5.8.2), since finding #2 turns on it:

- `podman run -d -p 22488:2222 ...` then `podman stop`: `podman ps -a --format json` reports the stopped container with `State: "exited"` and a populated `Ports: [{ container_port: 2222, host_port: 22488, protocol: "tcp" }]`. So the flagged assumption **holds** on this version.
- `podman port <stopped>` returns **empty** for the exited container. This corroborates the Background's root-cause claim: the current `getContainerHostPorts` (which uses `podman port`, `up.ts:106`) genuinely cannot see a stopped sibling's port.
- `podman inspect --format '{{json .HostConfig.PortBindings}}'` returns `{"2222/tcp":[{"HostIp":"0.0.0.0","HostPort":"22488"}]}` for the stopped container: a config-sourced view that persists across stop and is the natural version-robust fallback.

The concrete JSON shape matters for the parser spec (see non-blocking #4): the field is `Ports[].host_port`, an integer, present/non-zero only when a host port is actually published.

## Section-by-Section Findings

### Background and Objective (accurate)

Verified against the code. `up.ts:726-727` builds `ownedPorts = getContainerHostPorts(...)` then `new PortAllocator(...)`; `getContainerHostPorts` (`up.ts:93-101`) is label-filtered to the current project; `_allocate` consults `ownedPorts` only on the reuse path (`port-allocator.ts:170`); `findAvailablePort` (`port-allocator.ts:205-214`) excludes only `this.assignments` then trusts the TCP probe; the in-process `queue` is at `:111`.
All citations check out. Non-blocking: the file cites `findAvailablePort` as `202-214`; the scan loop is `205-214` (the doc-comment starts ~200). Immaterial.

### Hybrid authority (sound, with one wiring gap)

The union-for-exclusion / live-podman-for-ownership split is correct, and the conservatism argument (false exclusion costs one skipped port; false inclusion costs a `podman run` failure) is the right tradeoff.
Reconcile-before-computeExclusions ordering (Proposed Solution steps 2 then 3) is necessary and correctly specified, so a stale current-project entry is rewritten to the live owner before exclusions are computed.

**Blocking (finding #1): the exclusion set does not gate the reuse branch.**
Component 3 and Phase 4 wire exclusions into `findAvailablePort` only. But `_allocate` short-circuits before ever reaching `findAvailablePort`:

```ts
const existing = this.assignments.get(label);
if (existing && (this.ownedPorts.has(existing.port) || await isPortAvailable(existing.port))) {
  return existing;   // port-allocator.ts:170 — exclusions never consulted
}
```

`this.assignments` is loaded from the project's own `.lace/port-assignments.json`. Scenario that reintroduces the bug:
1. P allocates 22428, writes its `.lace` file and a ledger entry `P -> 22428`.
2. In a degraded path (ledger empty/corrupt during migration, or a manual `podman run -p 22428`), Q ends up publishing 22428; reconciliation applies live-podman-wins and rewrites ledger ownership to `Q -> 22428`. Now 22428 is in P's exclusion set.
3. P re-runs `lace up`. `_allocate` sees `existing.port === 22428`, P's container is down so `ownedPorts` is empty, and `isPortAvailable(22428)` returns true (Q is stopped or reserved-but-unbound). It returns 22428 and collides with Q.

The proposal's "the probe remains a final reality check" does not save this: the probe passes precisely for a stopped/unbound sibling, which is the case the whole design exists to cover.
Fix: the reuse branch must also reject `exclusions.has(existing.port)` (reuse only if the current project still owns the port per the reconciled ledger), and Phase 4's success criterion and the test plan must cover it. This is a one-line semantic, but it is load-bearing and currently unspecified.

### Podman-ports enumeration and the stopped-container assumption

**Blocking (finding #2): the corrupt/lost-ledger degradation claim contradicts the stopped-ports hedge.**
The "Hybrid authority" section hedges: "depending on podman version, [live enumeration] may not report port bindings for non-running containers." The "Corrupt or missing ledger" edge case then asserts a lost ledger "degrades to 'misses only the resolve-before-run window', not to the original bug." That second claim is only true if `podman ps -a` **does** report stopped-container host ports. The proposal simultaneously treats this behavior as uncertain (arm 2) and as certain (degradation analysis). If the pessimistic reading is right, a lost ledger degrades to the **original stopped-sibling bug**, not to a narrow window, because neither arm would then cover a stopped sibling.

This is the one axis where the two arms are **not** independent: for the observed whelm/jif stopped-sibling case, only the ledger covers it unless `ps -a` reports stopped ports. The "defense in depth" framing overstates the redundancy there.

Resolution (cheap, no redesign): commit to the behavior I verified above. Pin the expectation with a NOTE citing the podman-version behavior, specify `getAllPublishedHostPorts` reads `Ports[].host_port` from `podman ps -a --format json`, and add `podman inspect .HostConfig.PortBindings` as a config-sourced fallback for versions/runtimes where `ps -a` omits stopped host ports (verified to persist across stop). Then correct the degradation claim to state its dependency explicitly. Absent this, the corrupt-ledger risk analysis is wrong for the headline scenario.

### Garbage collection (correct)

Reclaim-on-removal / never-on-stop is correct and empirically supported: a stopped container retains its `-p` binding (`inspect` shows `HostConfig.PortBindings` intact; `ps -a` shows `host_port` for the exited container), so its port must stay reserved. The three reclaim triggers (workspace-gone, superseded-by-live, aged-out) are reasonable.

Non-blocking (#5): `projectExists = existsSync(workspaceFolder)` can transiently false-negative if a workspace lives on an unmounted volume or a path not visible to the `lace up` process, causing premature reclaim and a later collision when it remounts. Add a NOTE and consider only reclaiming on workspace-gone when combined with no live container AND age, rather than workspace-gone alone.

### Lockfile and interaction with the in-process queue (mostly correct)

The orthogonality argument is right and clearly stated: the `queue` mutex serializes `allocate()` within one process and does nothing across processes; the ledger lock does the converse. Not touching the queue is the correct constraint.

Non-blocking (#3): the critical section is longer than "read-reconcile-allocate-write" implies. Allocation happens inside `await resolveTemplates`, which drives many `isPortAvailable` TCP probes (100ms each) under the held lock. Stale-lock detection ("pid liveness plus lock mtime") must make mtime strictly subordinate to pid-liveness: break the lock only when the owner pid is dead. If a fixed "short timeout" on mtime can break a lock held by a live-but-slow `lace up`, a waiter steals it mid-resolution and both processes allocate against divergent ledger states. Either state "break only if pid dead (mtime is a secondary heuristic for pid-reuse/cross-host)" or have the holder heartbeat the lock mtime during resolution.

### Test Plan (hermetic, one coverage gap)

Genuinely hermetic: stubbed `RunSubprocess`, tmpdir ledger and workspaces, real `isPortAvailable` sockets (the existing pattern). The pure `reconcileLedger`/`computeExclusions` split makes the hard logic directly unit-testable, and the cross-process lock test using two real coordinators against one temp lockfile is the right shape. Deferring live multi-container proof (Phase 6) is honest and correctly justified.

Non-blocking (#6): add the finding-#1 regression (a re-`up` whose stale `.lace` port is now owned by another project must NOT be reused), and a lock-liveness test (a live-but-slow holder is not preempted by the stale-lock path).

### Implementation Phases (well-ordered)

Phases 1-4 are genuinely independent and land behind no behavior change; Phase 5 wires them; Phase 6 is deferred. Each has a clear success criterion. Good fit for subagent-driven execution. Phase 4's criterion should be extended to the reuse-branch case per finding #1.

### Convention compliance (good)

BLUF present and substantive; RFP back-link present in BLUF and Objective; sentence-per-line honored; Mermaid used for the data-flow; no em-dashes in prose; history-agnostic framing.
Non-blocking (#7): a handful of semicolons (lines ~107, 111, 144, 148) where conventions prefer sparing use. Trivial.

## Verdict

**Revise.** The architecture is sound and should proceed, but two blocking items must be resolved first: the exclusion set must gate the `_allocate` reuse branch (#1), and the ledger-degradation risk analysis must be reconciled with the stopped-ports behavior it depends on (#2), ideally by committing to the empirically verified behavior plus an `inspect` fallback. The remaining items are clarifications and hardening.

## Action Items

1. [blocking] Gate the reuse branch: `_allocate` (`port-allocator.ts:170`) must reuse `existing` only if `!exclusions.has(existing.port)`. Update Component 3, Phase 4's success criterion, and add a test.
2. [blocking] Reconcile finding #2: commit to the verified `podman ps -a --format json` stopped-port behavior (NOTE the version dependency, parse `Ports[].host_port`), add a `podman inspect .HostConfig.PortBindings` fallback, and correct the "Corrupt or missing ledger" degradation claim to state its dependency on that behavior.
3. [non-blocking] Make mtime-based stale-lock breaking strictly subordinate to owner-pid liveness (or heartbeat the lock during resolution), so a live-but-slow `lace up` holding the lock across TCP probes is never preempted.
4. [non-blocking] Specify the enumeration parser against the real JSON shape (`Ports[].host_port`, non-zero only when a host port is published) rather than generic text parsing.
5. [non-blocking] Guard GC against transient `existsSync(workspaceFolder)` false-negatives (unmounted/invisible workspace paths) causing premature reclaim.
6. [non-blocking] Add the finding-#1 reuse-after-ownership-flip regression and a lock-liveness (no-preempt-live-holder) test to the plan.
7. [non-blocking] Trim the incidental semicolons per writing conventions.

## Questions for the author (multiple choice)

1. On the stopped-ports assumption, which direction?
   a. Commit to verified `ps -a` behavior + `inspect` fallback (recommended; matches the empirical result above).
   b. Keep `ps -a` only and correct the degradation claim to acknowledge the stopped-sibling gap when the ledger is lost.
   c. Switch the enumeration seam to `podman inspect` per container as the primary source (config-sourced, run-state-independent) and treat `ps -a` as the fast path.

2. For the reuse-branch fix (#1), reuse-eligibility should be decided by:
   a. `!exclusions.has(existing.port)` (exclusions already encode reconciled ownership; simplest).
   b. An explicit "current project still owns this port in the reconciled ledger" check passed alongside exclusions.
