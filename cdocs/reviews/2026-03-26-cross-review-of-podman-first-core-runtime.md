---
review_of: cdocs/proposals/2026-03-26-podman-first-core-runtime.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T19:45:00-07:00
task_list: lace/podman-migration
type: review
state: live
status: done
tags: [fresh_agent, cross_review, architecture, podman, prerequisite_coverage, contract_consistency, companion_proposals]
---

# Cross-Review: Podman-First Core Runtime as Prerequisite for Podman Exec Container Entry

> BLUF: Proposal 1 (core runtime) provides most of what proposal 2 (exec entry) assumes, but there are five concrete gaps: (1) `lace-discover` is not covered by either proposal's implementation phases despite being the most `docker`-hardcoded bin script, (2) proposal 2's `resolve_runtime()` omits the `CONTAINER_RUNTIME` env var override that proposal 1 defines, creating a behavioral split between TypeScript and bash runtime detection, (3) `sanitizeContainerName()` exists in the TypeScript codebase but proposal 2 references it without acknowledging it is a TypeScript function inaccessible from bash, (4) the devcontainer CLI's podman compatibility is assumed but not verified for the `podman exec` use cases in proposal 2, and (5) proposal 2's phases can partially overlap with proposal 1 but have a hard dependency on Phase 1 completing first on podman-only systems.
> The test infrastructure gap is small: both proposals use different test harnesses (vitest mocks vs bash mocks) with no shared utilities, which is appropriate given the language boundary.
> Verdict: **Revise** - three blocking gaps require resolution before these proposals form a consistent implementation plan.

## Summary Assessment

Proposal 1 makes the TypeScript core (`packages/lace/`) runtime-agnostic by introducing `resolveContainerRuntime()` and threading it through five call sites.
Proposal 2 replaces SSH with `podman exec` across six bash scripts and assumes the core package works with podman.
The proposals are well-scoped to their respective language boundaries (TypeScript vs bash), but the interface between them has gaps that would cause implementation friction.
The most serious gap is `lace-discover`: it is a bash script that hardcodes `docker` in six places, proposal 1 explicitly excludes bin scripts from scope, and proposal 2 lists `lace-discover` in its `resolve_runtime()` adoption list but does not include it in any implementation phase deliverable.

## Prerequisite Coverage Analysis

This section evaluates each assumption proposal 2 makes about proposal 1, verified against the actual codebase.

### Does proposal 1 cover runtime detection for the TypeScript side?

**Yes, fully.**
Proposal 1 introduces `resolveContainerRuntime()` in TypeScript that checks for `podman` then `docker` on PATH, with a `CONTAINER_RUNTIME` env var override.
Proposal 2 introduces `resolve_runtime()` in bash with the same detection order (podman-first, docker-fallback).
Both proposals agree on the preference order.

However, proposal 2's bash function omits `CONTAINER_RUNTIME` support (see Finding 2 below).
Proposal 1 explicitly claims consistency with the companion proposal's shell function (line 305: "The env var name `CONTAINER_RUNTIME` is consistent with the companion proposal's `resolve_runtime()` shell function"), but this consistency does not exist in proposal 2's code.

### Does proposal 1 support label-based container discovery?

**Yes, already present.**
Proposal 1's call site inventory shows `docker ps --filter label=devcontainer.local_folder=...` (call sites #1 and #4).
After proposal 1, these become `podman ps --filter label=...`, which supports the same label queries.
Proposal 2's `lace-discover` rewrite uses the same `devcontainer.local_folder` label and adds `lace.project_name`.
Both proposals agree on the label contract.

The `workspace-detector.ts` function `verifyContainerGitVersion()` (call site #5) uses `docker exec <containerName>`, which works identically with podman.
Proposal 1 threads the resolved runtime through this call site.

### Is `sanitizeContainerName()` covered in proposal 1?

**No, but it does not need to be.**
`sanitizeContainerName()` in `packages/lace/src/lib/project-name.ts` is a pure string function that does not call `docker` or `podman`.
It derives container names from project names and is already used by `up.ts` to set `--name` on container creation.
Proposal 1 does not modify it because it has no runtime dependency.

The gap is on proposal 2's side: see Finding 3 below.

## Cross-Proposal Findings

### 1. `lace-discover` Ownership Gap (blocking)

`lace-discover` is the critical bridge between proposals 1 and 2.
It is a bash script that proposal 2's `lace-into` consumes, and it hardcodes `docker` in six locations: `command -v docker` (line 44), `docker info` (line 52), `docker ps` (line 62), and three `docker inspect` calls (lines 103, 111, 120).

**Proposal 1** explicitly excludes bin scripts: "This proposal covers only the TypeScript core package. The bin scripts (`lace-discover`, `lace-inspect`, `lace-into`, etc.) are covered by the companion proposal" (line 28).

**Proposal 2** lists `lace-discover` in the `resolve_runtime()` adoption scope (line 107) and specifies six scripts that need the treatment.
But proposal 2's Phase 1 (line 510) introduces `resolve_runtime()` only in `lace-into` and `lace-split`.
Phase 2 (line 528) rewrites `lace-discover` for the output format change (dropping the port field, adding `container_name`), but does not explicitly list `resolve_runtime()` adoption as a Phase 2 deliverable for `lace-discover`.

The implicit assumption is that Phase 2's rewrite of `lace-discover` naturally includes `$RUNTIME` substitution.
This should be made explicit: Phase 2 step 1 should include `resolve_runtime()` adoption for `lace-discover` alongside the output format change.
Without it, an implementer could rewrite the output format while leaving the `docker` hardcoding intact.

### 2. `resolve_runtime()` Behavioral Divergence (blocking)

Proposal 1's TypeScript `resolveContainerRuntime()` supports `CONTAINER_RUNTIME` env var override (lines 116-119):

```typescript
const override = process.env.CONTAINER_RUNTIME;
if (override === "podman" || override === "docker") {
  return override;
}
```

Proposal 2's bash `resolve_runtime()` (lines 95-103) has no such check:

```bash
resolve_runtime() {
  if command -v podman &>/dev/null; then
    echo "podman"
  elif command -v docker &>/dev/null; then
    echo "docker"
  else
    echo ""
  fi
}
```

If a user sets `CONTAINER_RUNTIME=docker`, the TypeScript core (`lace up`) would use docker while the bash scripts (`lace-into`, `lace-discover`) would still prefer podman.
This split would cause confusing behavior on systems with both runtimes installed.

Proposal 1's design decision section (line 305) claims: "The env var name `CONTAINER_RUNTIME` is consistent with the companion proposal's `resolve_runtime()` shell function."
This claim is false as written.

Additionally, proposal 2's `resolve_runtime()` returns an empty string when no runtime is found.
Proposal 1 throws an error with a clear message.
This behavioral divergence means a user with neither runtime gets a clear error from `lace up` but a confusing failure from `lace-into` (the empty `$RUNTIME` variable produces something like `: command not found` or `exec: : not found`).

### 3. `sanitizeContainerName()` Cross-Language Ambiguity (blocking)

Proposal 2 references `sanitizeContainerName(projectName)` frequently (lines 125, 289, 295, 376) as the derivation for container names stored in `@lace_container`.
This function exists in TypeScript at `packages/lace/src/lib/project-name.ts`.

Proposal 2 is a bash implementation.
The bash scripts do not and cannot call TypeScript functions.
They consume the container name indirectly via `lace-discover`, which reads it from `docker inspect --format '{{.Name}}'` or the `lace.project_name` label.

The critical ambiguity: the Docker container name (output of `sanitizeContainerName()` as set via `--name` in `up.ts`) and the `lace.project_name` label value (the raw, unsanitized project name) can differ.
For a project path `/home/user/code/my-project!`:
- `lace.project_name` label: `my-project!` (raw basename)
- Docker container name: `my-project` (sanitized, the `!` is removed)

Proposal 2's `lace-discover` rewrite (Phase 2) resolves the container name from the `lace.project_name` label, falling back to `basename` of `local_folder`.
But `@lace_container` needs to store the Docker container name (as used by `podman exec $container_name`), which is the sanitized version.

Proposal 2 should clarify whether `lace-discover` returns the sanitized Docker container name (from `docker inspect --format '{{.Name}}'`) or the `lace.project_name` label value.
The `container_name` field added in Phase 1 (line 517) says "resolved from `lace.project_name` label -> `docker inspect --format '{{.Name}}'`" with an arrow suggesting a fallback chain, but the semantics are ambiguous: is it the label value or the inspect output?

For `podman exec` to work, the value must be the Docker/podman container name (sanitized), not the label (unsanitized).

### 4. Port Allocator Under Podman (non-blocking)

Both proposals state the port allocator is retained.
Proposal 1's call sites #1 and #2 (`docker ps` and `docker port`) are used by `getContainerHostPorts()` for owned-port detection.
After proposal 1, these become `podman ps` and `podman port`.

Proposal 1's compatibility analysis (line 76) claims identical output, which is correct for the specific commands used.
The port allocator itself (`port-allocator.ts`) does not call Docker directly; it uses file-based locking and port range management.
The only runtime-dependent part is the query in `getContainerHostPorts()`, which proposal 1 covers.

One nuance: rootless podman with the `pasta` network backend may behave differently than `slirp4netns` for port forwarding, but the `podman port` output format is consistent across backends.
No action needed, but worth a note in proposal 1's compatibility analysis.

### 5. `devcontainer up` Integration and Transitive Dependency (non-blocking)

Proposal 1 covers `--docker-path` for `devcontainer up` and `devcontainer build`.
Proposal 2 assumes containers are already running when scripts execute.

The transitive dependency: if `--docker-path podman` causes `devcontainer up` to fail (e.g., due to an older devcontainer CLI version), no container exists for proposal 2's `podman exec` to target.
Proposal 1's WARN callout (line 339) acknowledges this risk and recommends pinning the minimum devcontainer CLI version.
Proposal 2 does not mention this dependency.

The devcontainer CLI's podman support via `--docker-path` is well-established (since v0.30.0, released 2023), so this is low risk.
But proposal 2 should acknowledge the dependency chain: "containers are created by `lace up`, which must successfully pass `--docker-path` to the devcontainer CLI."

### 6. Phase Ordering and Parallelism (non-blocking)

**Proposal 2 Phase 1** (bash `resolve_runtime()`) has no dependency on proposal 1.
It is a pure bash change that can land independently.

**Proposal 2 Phase 2** (core transport swap) has a conditional dependency on proposal 1:
- On systems with `podman-docker` installed: no dependency. The `docker` symlink works for both `lace up` (TypeScript) and `lace-into` (bash).
- On systems without `podman-docker`: hard dependency on proposal 1's Phases 2-3. Without proposal 1, `lace up` fails because the TypeScript code calls `docker` which does not exist. No container means nothing for `podman exec` to connect to.

**Proposal 2 Phases 3-5** (ancillary scripts, feature cleanup, host-side cleanup) operate on existing containers and have no proposal 1 dependency beyond Phase 2's transitive need for containers to exist.

Neither proposal documents this nuance.
A clean implementation order: proposal 1 Phases 1-3 first, then proposal 2 Phases 1-5.
But for `podman-docker` environments, both proposals can proceed in parallel.

### 7. Test Infrastructure (non-blocking)

Proposal 1 uses vitest with `RunSubprocess` mocks in TypeScript.
Proposal 2 uses `bin/test/test-lace-into.sh` with bash function mocks.

No shared test utilities exist or are needed.
The language boundary is the natural test boundary.

Proposal 1's Phase 5 updates `scenario-utils.ts` (which makes real `docker info`, `docker rm`, `docker ps` calls via `execSync`) to use `resolveContainerRuntime()`.
Proposal 2's Phase 2 updates `test-lace-into.sh` to mock `podman exec` instead of `ssh`.
These are independent changes with no conflict potential.

The `__tests__/docker_smoke.test.ts` file in proposal 1's test plan makes real docker CLI calls.
Once updated, it enables CI on podman-only runners, which benefits both proposals.

## Verdict

**Revise**: Three blocking gaps require resolution.
The proposals are individually well-designed and their scope boundaries (TypeScript vs bash) are appropriate.
The gaps are at the interface: behavioral consistency of runtime detection, ownership of `lace-discover`'s runtime abstraction, and clarity on the container name derivation chain.
None require architectural changes; they are specification gaps needing explicit documentation and alignment.

The existing R1 review of proposal 1 identified two different blocking issues (`which` portability and `--docker-path` wording).
This cross-review's three blocking findings are additive: they concern cross-proposal consistency, not internal proposal quality.

## Action Items

1. [blocking] Add `lace-discover` explicitly to proposal 2's Phase 1 or Phase 2 deliverables for `resolve_runtime()` adoption. The current Phase 1 lists only `lace-into` and `lace-split`. Phase 2 rewrites `lace-discover`'s output format but does not explicitly list runtime abstraction as a deliverable. Make the `$RUNTIME` substitution an explicit Phase 2 step 1 sub-item.

2. [blocking] Add `CONTAINER_RUNTIME` env var support to proposal 2's `resolve_runtime()` bash function. Check `$CONTAINER_RUNTIME` as the first branch, matching proposal 1's TypeScript behavior. Also add a fail-fast error when no runtime is found (matching proposal 1's throw behavior) instead of returning an empty string.

3. [blocking] Clarify in proposal 2 whether `@lace_container` stores the Docker container name (sanitized, from `docker inspect --format '{{.Name}}'`) or the `lace.project_name` label value (unsanitized). For `podman exec` to work, it must be the container name. Document the derivation chain: project path -> `deriveProjectName()` -> `sanitizeContainerName()` -> `--name` flag -> `docker inspect` -> `@lace_container`. Specify that `lace-discover`'s `container_name` field comes from `docker inspect`, not the label.

4. [non-blocking] Add a note to proposal 2 acknowledging the transitive dependency on proposal 1 for podman-only systems: containers can only be created if proposal 1's `--docker-path` integration is complete. Document the recommended implementation order.

5. [non-blocking] Add rootless podman network backend note to proposal 1's compatibility analysis. The `podman port` output format is consistent across `pasta` and `slirp4netns` backends, but the routing differs. This does not affect lace's port allocator.

6. [non-blocking] Remove proposal 1's false claim of consistency with proposal 2's `resolve_runtime()` (line 305) until proposal 2 is updated to actually include `CONTAINER_RUNTIME` support.
