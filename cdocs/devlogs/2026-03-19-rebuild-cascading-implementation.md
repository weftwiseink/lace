---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-19T10:00:00-07:00
task_list: lace/devcontainer-lifecycle
type: devlog
state: live
status: wip
tags: [rebuild, config-drift, devcontainer, implementation]
---

# Implementation: Rebuild Cascading and Config Drift Detection

> BLUF: Implementing the accepted proposal
> `cdocs/proposals/2026-03-18-rebuild-cascading-and-config-drift.md` in two phases:
> (1) forward `--rebuild` to `devcontainer up` as `--remove-existing-container`,
> (2) add config drift detection via runtime fingerprinting.
> Both phases verified against the live system with container recreation and
> drift detection confirmed via docker inspect.

## Objective

Implement the proposal to fix `lace up --rebuild` cascading and add config drift
detection.
The proposal was accepted after two review rounds.

## Approach

Subagent-driven implementation with iterative ground-truth testing:

- **Phase 1**: Minimal fix to forward `--rebuild` flag through to container lifecycle.
- **Phase 2**: Config drift detection with runtime fingerprinting.
- **Phase 2 addendum**: `wez-into --rebuild` passthrough.
- Each phase verified against the real system (container creation/destruction).

## Work Log

### Phase 1: Forward `--rebuild` to `devcontainer up`

**Changes:**
- `lib/up.ts`: Added `removeExistingContainer?: boolean` to `RunDevcontainerUpOptions`.
  When true, pushes `--remove-existing-container` into the devcontainer CLI args.
  Passed through from `rebuild` at the call site.
- `commands/up.ts`: Updated `--rebuild` description from "Force rebuild of prebuild
  image (bypass cache)" to "Force full rebuild: rebuild prebuild image and recreate
  container".
- 3 integration tests added for the flag forwarding behavior.

### Phase 2: Config Drift Detection

**Changes:**
- New module `lib/config-drift.ts`: Implements `computeRuntimeFingerprint()` using
  SHA-256 over deterministically serialized runtime-affecting config properties.
  Uses `sortedStringify()` for key-order-independent comparison.
- `lib/up.ts`: Integrated drift detection after config generation but before
  `devcontainer up`. Fingerprint written after successful container start.
- 24 unit tests for fingerprinting determinism, drift detection, and warning behavior.
- 3 integration tests for fingerprint lifecycle (write after up, skip on skip-devcontainer-up, delete on rebuild).

### Phase 2 Addendum: `wez-into --rebuild`

**Changes:**
- `bin/wez-into`: Added `--rebuild` flag to option parsing.
  When set, passes `--rebuild` to `lace up` in `start_and_connect()`.
  Updated help text, usage line, description paragraph, and examples.
  Dry-run output includes `--rebuild` flag.
  Info message includes `--rebuild` flag.

## Issues Encountered and Solved

### Port Allocator False-Positive Drift (Critical Finding)

During ground-truth testing, drift detection triggered false positives on every re-run
of `lace up` while the container was already running.

**Root cause:** The port allocator detects the container's own SSH port as "in use" and
reassigns it to a new port. The generated config then has a different `forwardPorts`
value, causing the fingerprint to change and trigger a drift warning.

**Fix:** Excluded `forwardPorts` and `appPort` from `RUNTIME_KEYS`. These are managed
by the port allocator (which has its own persistence in `.lace/port-assignments.json`)
and are non-deterministic across runs when the container is running. Including them
creates a feedback loop: container holds port -> allocator picks new port ->
fingerprint changes -> drift warning -> repeat.

This is a pragmatic deviation from the proposal (which included these keys) that
eliminates a class of false positives without losing meaningful drift coverage.
Manually specified port changes are rare and would typically accompany other config
changes (containerEnv, mounts) that are still fingerprinted.

## Verification Records

### Phase 1: Container Recreation

| Check | Before Rebuild | After Rebuild | Result |
|---|---|---|---|
| Container ID | `30e9dc3bd86b` | `2907d5e25c97` | Container recreated |
| CONTAINER_WORKSPACE_FOLDER | `/workspace/lace/main` | `/workspace/lace/main` | Correct |
| LACE_PROJECT_NAME | `lace` | `lace` | Correct |
| CLI help text | "Force rebuild of prebuild image (bypass cache)" | "Force full rebuild: rebuild prebuild image and recreate container" | Updated |

### Phase 2: Drift Detection

| Test | Expected | Actual | Result |
|---|---|---|---|
| First run (no fingerprint) | No warning | No warning | Pass |
| Second run (same config) | No warning | No warning | Pass |
| After adding containerEnv var | Drift warning | Drift warning | Pass |
| With `--rebuild` flag | No warning (rebuild message) | Container recreated | Pass |
| Port reassignment (container running) | No warning | No warning | Pass (after RUNTIME_KEYS fix) |

### Test Suite

- 918 tests across 33 test files: all passing.
- 24 new config-drift unit tests.
- 6 new integration tests (3 rebuild forwarding, 3 fingerprint lifecycle).

## Deviations from Proposal

### 1. Excluded `forwardPorts` and `appPort` from RUNTIME_KEYS

The proposal listed these in the fingerprint keys. Implementation excludes them because
the port allocator manages these values with its own persistence, and including them
causes false-positive drift on every re-run when the container is running.
See "Port Allocator False-Positive Drift" above for details.

> NOTE(opus/devcontainer-lifecycle): This deviation was discovered during ground-truth
> testing, not anticipated in the proposal or review. The proposal's original list was
> reasonable for a system without dynamic port allocation, but lace's port allocator
> makes these values non-deterministic.
