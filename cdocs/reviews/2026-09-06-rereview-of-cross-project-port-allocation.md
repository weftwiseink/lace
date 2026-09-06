---
review_of: cdocs/proposals/2026-09-06-cross-project-port-allocation.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T11:24:07-07:00
task_list: lace/port-allocation
type: review
state: live
status: done
tags: [rereview_agent, architecture, port-allocation, concurrency, test_plan]
---

# Re-review (R2): Cross-project host-port allocation (locked global ledger + live-podman reconciliation)

## Summary Assessment

Focused round-2 re-review of the revised proposal, confirming closure of the two R1 blocking findings without re-litigating accepted design.
Both blockers are genuinely resolved and internally consistent across the Components, Design Decisions, Edge Cases, Phase, and Test Plan sections; the three non-blocking hardening items are also addressed.
Verdict: **Accept.**
One residual convention nit remains (two em-dashes at lines 82-83, pre-existing, flagged-but-untouched by the revise pass), which does not block acceptance.

## Verification of R1 blocking findings

### Blocking #1: exclusions gate the reuse short-circuit — RESOLVED

The fix is present and consistent in all three required places:
- **Component 3 (lines 85-91).** The design text now states the reuse branch guard explicitly (line 89): reuse `existing` only if `!exclusions.has(existing.port)` AND (`ownedPorts.has(existing.port)` OR `isPortAvailable(existing.port)`), otherwise fall through to `findAvailablePort`. Line 87 makes the "ALSO gate `_allocate`, not just `findAvailablePort`" requirement primary, and line 90 preserves the correct rationale (ownership flip -> `ownedPorts` empty because own container is down -> TCP probe passes because the new owner is stopped/unbound -> collision).
- **Phase 4 success criterion (lines 219-221).** The injected exclusions set is consumed by BOTH `findAvailablePort` AND the `_allocate` reuse short-circuit (`port-allocator.ts:170`), and the criterion explicitly requires that a stored `.lace` port now excluded is not reused (falls through to a fresh port).
- **Test Plan (line 186).** "Reuse-branch gating (finding #1 regression)": a stored assignment whose port is now in the exclusion set (ownership flipped) must NOT be reused on re-`up`, even with empty `ownedPorts` and a TCP probe reporting free, and must receive a fresh unexcluded port.

The guard semantics, the phase criterion, and the regression test agree on the same behavior. No gap remains.

### Blocking #2: lost-ledger degradation reconciled with stopped-ports behavior — RESOLVED

The former contradiction (behavior treated as uncertain in the hybrid-authority arm but certain in the degradation analysis) is gone, and the load-bearing behavior is now committed to with an honest dependency statement:
- **Component 1 (lines 64-70).** The parsed JSON shape is specified: each `podman ps -a --format json` element carries a `Ports` array of `{ host_ip, host_port, container_port, protocol }`, and the parser reads the integer `host_port` (present/non-zero only when a host port is published) plus the `devcontainer.local_folder` label. The version NOTE (line 68) pins the `Ports[].host_port`-for-exited-container behavior to podman 5.8.2 and flags it version-dependent. The `podman inspect <id> --format '{{json .HostConfig.PortBindings}}'` fallback (line 70) is added as the config-sourced, run-state-independent view for versions/runtimes that omit stopped host ports from `ps -a`.
- **Hybrid authority (lines 128-130).** Now affirmatively states live enumeration DOES cover stopped-and-defined siblings (verified, with inspect fallback), removing the old "may not report" hedge on the same behavior.
- **Corrupt or missing ledger (line 174).** Now honest and non-contradictory: a lost ledger degrades to the podman-enumeration arm, which still covers the whelm/jif stopped-sibling case (enumeration sees the stopped container's `22428`); what is lost is only the reserved-but-no-container-yet window and any port reserved but not yet handed to `podman run`. It further states the residual dependency plainly: on a podman version where neither `ps -a` nor `inspect` reports stopped host ports, a lost ledger degrades back to the original bug, which is why the ledger is retained as defense-in-depth rather than treated as redundant with enumeration.

This matches the R1 runtime verification (podman 5.8.2) and states its own dependency explicitly rather than overstating redundancy. Closed.

## Verification of R1 non-blocking findings

- **#3 pid-liveness primary over mtime — addressed.** Design Decisions (lines 155-160) makes owner-pid liveness the PRIMARY stale signal and mtime strictly SUBORDINATE, never a standalone timeout, with the reasoning tied to the long critical section (lock held across `resolveTemplates` and its ~100ms TCP probes) and a heartbeat option noted for cross-host/pid-reuse. Phase 3 (line 216) and the Stale-lock edge case (line 175) match.
- **#5 GC existsSync false-negative — addressed.** Reclaim triggers (lines 142-143) now require workspace-gone to be combined with no-live-container AND age; a bare `existsSync(project) === false` is no longer a standalone reclaim trigger, and the NOTE (line 145) explains the unmounted/invisible-path transient false-negative.
- **#6 reuse regression + lock-liveness tests — addressed.** Test Plan adds the finding-#1 reuse regression (line 186) and a lock-liveness "no-preempt-live-holder" test (line 188).
- **#4 parser against real JSON shape — addressed** via Component 1 lines 64-66 (covered under blocking #2 above).
- **#7 incidental semicolons — partially addressed / immaterial.** A few semicolons remain (for example lines 155, 158); conventions say "sparingly," not "never," so these read acceptably. Not worth another round.

## Residual nit (non-blocking)

**Em-dashes at lines 82-83 (Component 2 bullets).** The `reconcileLedger(...)` and `computeExclusions(...)` bullets use ` — ` (em-dash) where writing conventions prefer a colon or spaced hyphen. These predate the revision and the revise pass flagged-but-left them. Mechanical: replace ` — a **pure** function` with `: a **pure** function`. Does not block acceptance; a nit-fix pass or the next edit can clear it.

No new inconsistencies were introduced by the fixes. Spot checks confirm signature agreement between the Component 2 declarations and the coordinator call sites (`reconcileLedger(..., projectExists, now)` vs `reconcileLedger(..., existsSync, now)`; `computeExclusions(..., currentProject)` vs `computeExclusions(..., workspaceFolder)`), and the reuse-guard wording is identical between Component 3 and Phase 4.

## Verdict

**Accept.** Both R1 blocking findings are genuinely closed and consistent across design text, phase criteria, and test plan; the non-blocking hardening items are addressed. The design is ready to move to `implementation_ready`. The only residual is the two-em-dash convention nit at lines 82-83, which can be swept mechanically and does not gate acceptance.

## Action Items

1. [non-blocking] Replace the em-dashes at lines 82-83 with colons (`: a **pure** function ...`) to clear the last convention nit.
