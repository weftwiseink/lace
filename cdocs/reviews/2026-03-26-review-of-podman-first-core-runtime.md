---
review_of: cdocs/proposals/2026-03-26-podman-first-core-runtime.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T19:15:00-07:00
task_list: lace/podman-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, runtime_detection, source_verified]
---

# Review: Podman-First Container Runtime for lace Core TypeScript Package

## Summary Assessment

This proposal makes the lace TypeScript core runtime-agnostic by introducing `resolveContainerRuntime()` (podman-first, docker-fallback) and threading the result through all hardcoded `"docker"` subprocess calls.
The call site inventory is verified complete against the actual source: all 5 docker subprocess calls across 4 files are accounted for, and the 2 devcontainer CLI integration points are correctly identified.
The proposal is well-structured, with a clear phased plan, thorough edge case analysis, and a solid test strategy.
Two blocking findings: a minor inconsistency in the `which`-based detection approach (portability on NixOS/non-FHS systems) and a missing third devcontainer CLI call site that needs `--docker-path` consideration.

**Verdict: Revise** - address the two blocking findings below, then this is ready for implementation.

## Source Verification

The reviewer independently verified every claim in the proposal against the actual source code in `packages/lace/src/`.

### Docker call site inventory: VERIFIED COMPLETE

All 5 call sites are confirmed at the exact line numbers stated:
- `lib/up.ts:74` - `subprocess("docker", ["ps", "-q", ...])` - confirmed
- `lib/up.ts:82` - `subprocess("docker", ["port", containerId])` - confirmed
- `lib/prebuild.ts:212` - `run("docker", ["image", "inspect", ...])` - confirmed
- `commands/up.ts:13` - `defaultRunSubprocess("docker", ["ps", ...])` - confirmed
- `lib/workspace-detector.ts:506` - `subprocess("docker", ["exec", ...])` - confirmed

No additional `"docker"` subprocess calls exist in non-test source files.
The grep `"docker"` across `packages/lace/src/` (excluding test files) returns exactly these 5 lines.

### Devcontainer CLI call sites: MOSTLY VERIFIED

Sites #6 and #7 (`devcontainer up` at `lib/up.ts:1212` and `devcontainer build` at `lib/prebuild.ts:327`) are confirmed.
However, there is a third devcontainer CLI call in `lib/feature-metadata.ts:317` (`devcontainer features info manifest`).
This call is correctly excluded from the `--docker-path` consideration because it is an OCI registry operation, not a container runtime invocation.
The proposal should note this explicitly to prevent future confusion during implementation.

### Mount policy blocklist: VERIFIED

The current blocklist in `user-config.ts` (lines 48-81) contains exactly the docker entries stated: `~/.docker`, `/var/run/docker.sock`, `/run/docker.sock`.
Podman equivalents are indeed absent.

### Subprocess architecture: VERIFIED

The `RunSubprocess` interface (`lib/subprocess.ts`) takes `command: string` as its first argument.
All call sites pass `"docker"` as a literal string.
The interface does not need modification: confirmed.

### `isContainerRunning()` bypass: VERIFIED

`commands/up.ts:13` uses `defaultRunSubprocess` directly (not the injectable subprocess).
This is correctly identified as needing independent runtime resolution.

## Section-by-Section Findings

### BLUF and Summary

Clear and accurate.
The scope statement ("5 call sites in 4 source files, 2 devcontainer CLI integration points, 1 mount policy update") is verified correct.
The prerequisite relationship to the companion proposal is clearly stated.

### Background: Current State and Subprocess Architecture

Accurate.
The injectable `RunSubprocess` pattern is correctly described.
Minor note: the proposal says "`runUp()`, `runPrebuild()`, and `verifyContainerGitVersion()` all accept a `subprocess` parameter" but `getContainerHostPorts()` also accepts it. This is not an error (the sentence is illustrative, not exhaustive) but could be clearer.

### Background: Docker CLI Call Site Inventory

**Verified complete.** This is the strongest part of the proposal.
Line numbers are accurate.
No missing call sites.

### Background: Compatibility Analysis

The claim that all docker CLI subcommands used by lace produce identical output with podman is correct for the specific subcommands used (`ps`, `port`, `image inspect`, `exec`).
The claim that no `docker compose` usage exists is also verified correct.

### Proposed Solution 1: Runtime Detection Module

**Finding [blocking]: `which` is not universally available.**
The proposal uses `execFileSync("which", [candidate])` for runtime detection.
`which` is not POSIX-standard (it is not specified in POSIX.1-2017).
On NixOS and some minimal container environments, `which` may not be present.
The proposal's own NOTE acknowledges an alternative (`<binary> --version`) but dismisses it as slower.

A more portable approach is `execFileSync(candidate, ["--version"])`, which also validates the binary is functional.
The speed difference is negligible for a once-per-invocation check.
Alternatively, use `command -v` via a shell, though that requires spawning a shell.

**Recommendation:** Use `execFileSync(candidate, ["--version"], { stdio: "pipe" })` instead of `which`.
This is more portable, validates the binary is functional, and the performance difference is irrelevant for a single call at startup.

### Proposed Solution 2: Thread Runtime Through Call Sites

Mechanically sound.
The pattern of adding a `runtime` parameter to each function is consistent with the existing codebase's injection pattern.
The code examples are accurate transformations of the actual source.

### Proposed Solution 3: Devcontainer CLI `--docker-path` Integration

**Finding [blocking]: Inconsistency between section title and code.**
Section 3 header says "inject `--docker-path` with the resolved runtime's absolute path" but the NOTE at the bottom correctly states "Passing the binary name (`"podman"`) is sufficient."
The code example passes `options.runtime` (a string like `"podman"`, not an absolute path).
The section header should say "binary name" not "absolute path" to avoid confusion during implementation.

Also, the proposal should explicitly note that the third devcontainer CLI call (`devcontainer features info manifest` in `feature-metadata.ts:317`) does NOT need `--docker-path` because it is a registry-only operation.
An implementer reading the inventory table might wonder why it is excluded.

### Proposed Solution 4: Mount Policy Blocklist Update

Correct identification of missing entries.
The NOTE about `$XDG_RUNTIME_DIR` expansion is important and well-placed.

**Finding [non-blocking]: `~/.config/containers` blocklist entry.**
The proposal adds `~/.config/containers` to the blocklist.
This directory contains `containers.conf`, `registries.conf`, and `storage.conf`, which are configuration files, not credentials.
Some users may legitimately want to mount this directory to share container registry configuration with the devcontainer.
Consider whether this should be in the default blocklist or documented as a user-policy decision.

### Design Decisions

All decisions are well-reasoned:
- Podman-first ordering: correct for the target environment.
- Resolve once: correct for a CLI tool with a single invocation lifecycle.
- No runtime field in subprocess interface: correct, keeps the mock pattern simple.
- `CONTAINER_RUNTIME` env var: consistent with companion proposal.
- Unconditional `--docker-path`: eliminates edge cases, safe.

**Finding [non-blocking]: Invalid `CONTAINER_RUNTIME` values are silently ignored.**
The proposal says invalid values "fall through to auto-detection."
This could confuse users who make a typo.
Consider logging a warning: `"CONTAINER_RUNTIME='podmam' is not a valid value (expected 'podman' or 'docker'). Falling back to auto-detection."`.

### Edge Cases

Thorough coverage.
The `isContainerRunning()` bypass, test mock updates, and podman socket path expansion are all correctly identified.

**Finding [non-blocking]: Missing edge case for rootless podman and `docker exec`.**
`verifyContainerGitVersion()` runs `docker exec <containerName> git --version`.
With rootless podman, the container name resolution works differently in some podman versions (podman < 4.0 used different default naming).
The devcontainer CLI labels containers the same way regardless of runtime, so this should be fine, but it is worth noting.

### Test Plan

**Finding [non-blocking]: Test parameterization recommendation is underspecified.**
The proposal recommends parameterizing only `getContainerHostPorts` and `verifyContainerGitVersion` tests.
The justification is that these "contain the output parsing logic."
However, `isContainerRunning()` in `commands/up.ts` also parses output (checks `stdout.trim() !== ""`).
It should be included in the parameterization recommendation.

**Finding [non-blocking]: Missing test for `--docker-path` injection.**
The test plan covers runtime detection and call site updates but does not explicitly list a test case for verifying that `--docker-path` is correctly injected into the devcontainer CLI args.
This is a critical integration point and should have explicit test coverage:
- Verify `devcontainer up` args include `--docker-path podman` when runtime is podman.
- Verify `devcontainer build` args include `--docker-path podman` when runtime is podman.
- Verify `devcontainer up` args include `--docker-path docker` when runtime is docker.

### Test Plan: Scenario Utils and Smoke Tests

The proposal correctly identifies that `scenario-utils.ts` uses real `docker` CLI calls (`docker info`, `docker rm`, `docker ps`) via `execSync` (not through `RunSubprocess`).
These calls use string interpolation (`execSync("docker info")`) rather than the subprocess interface.
The proposal says to update them with `resolveContainerRuntime()`, which is correct.

### Verification Methodology

The manual verification checklist is comprehensive.
The step-by-step podman-only verification (uninstall `podman-docker`, verify, reinstall, verify again) is thorough and covers the key transition.

### Implementation Phases

Well-ordered.
Phase 1 is additive-only (no existing code changes), which is a safe starting point.
Each phase has clear success criteria.

**Finding [non-blocking]: Phase 6 scope may be larger than expected.**
"No hardcoded 'Docker' references remain in non-test source files" is a broad criterion.
The string "Docker" appears in JSDoc comments, error messages, and log messages throughout the codebase (e.g., "Docker will create a directory" in `lib/up.ts:585`, "Docker will auto-create" in `lib/up.ts:687`).
These are user-facing messages.
Clarify whether these should say "Docker/podman", "the container runtime", or remain as-is.
Some messages (like docker.sock references in mount policy comments) are docker-specific and should stay.

### Open Questions

All three open questions are addressed with recommendations.
The recommendations are reasonable.

## Verdict

**Revise.**

Two blocking findings must be addressed before this proposal is implementation-ready:
1. The `which`-based detection should be replaced with a more portable approach.
2. The "absolute path" wording inconsistency in Section 3 should be corrected, and the third devcontainer CLI call site (`feature-metadata.ts`) should be explicitly noted as excluded.

The remaining non-blocking findings are improvements that can be addressed during implementation.

## Action Items

1. [blocking] Replace `execFileSync("which", [candidate])` with `execFileSync(candidate, ["--version"], { stdio: "pipe" })` in the `resolveContainerRuntime()` implementation. `which` is not POSIX-standard and may be absent on NixOS and minimal environments.
2. [blocking] Fix the Section 3 header: change "absolute path" to "binary name" to match the actual code and the NOTE at the bottom of the section. Add a sentence explicitly noting that `feature-metadata.ts:317` (`devcontainer features info manifest`) does not need `--docker-path` because it is a registry operation.
3. [non-blocking] Consider logging a warning when `CONTAINER_RUNTIME` is set to an invalid value rather than silently falling through to auto-detection.
4. [non-blocking] Add explicit test cases for `--docker-path` injection into `devcontainer up` and `devcontainer build` args to the test plan.
5. [non-blocking] Evaluate whether `~/.config/containers` belongs in the default blocklist or should be a user-policy decision (it contains configuration, not credentials).
6. [non-blocking] Include `isContainerRunning()` in the test parameterization recommendation alongside `getContainerHostPorts` and `verifyContainerGitVersion`.
7. [non-blocking] Clarify Phase 6 scope: specify which "Docker" references in user-facing messages should be updated and which should remain runtime-specific.
