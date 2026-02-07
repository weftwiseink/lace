---
review_of: cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-07T14:30:00-08:00
task_list: lace/feature-overhaul
type: review
state: live
status: done
tags: [fresh_agent, test_plan, integration_tests, feature_manifest, architecture]
---

# Review: Wezterm-Server Feature Scenario Tests for Feature Awareness v2

## Summary Assessment

This proposal defines six scenario tests (S1-S6) to validate lace's feature awareness v2 pipeline against the real wezterm-server devcontainer feature, filling the gap between the mock-subprocess integration tests and the devcontainers CLI feature installation tests. The proposal is well-structured, with thorough scenario coverage and a practical two-tier Docker gating design. However, there are several issues: the proposal's test code does not align with the actual `runUp()` API and result types as implemented, the `onAutoForward` field declared in the feature manifest is silently dropped by the port entry generator, and the existing `docker_smoke.test.ts` pattern is not referenced despite being the established Docker test precedent in this codebase. Verdict: **Revise** -- address the API mismatches and the `onAutoForward` gap before implementation.

## Section-by-Section Findings

### BLUF and Objective

The BLUF is accurate in characterizing the gap between integration tests and feature tests. However, it claims "Scenarios 35-46 in the existing test suite" cover both modes. The actual existing test file has scenarios through about scenario 41 (metadata validation scenarios 35-39, then feature awareness v2 scenarios covering auto-inject, static suppression, explicit template, asymmetric appPort, no-lace-ports, and metadata-unavailable-with-skip-validation). The claim of "Scenarios 35-46" appears to overcount slightly or reference scenario IDs that do not exist yet. **Non-blocking** -- cosmetic numbering issue, but the underlying claim about coverage is correct.

### Background: Current Test Coverage

The coverage description is accurate. The three levels (unit, integration, feature) map to the actual codebase. The claim of "~60 test cases" at the unit level is plausible given the three test files (`template-resolver.test.ts`, `port-allocator.test.ts`, `feature-metadata.test.ts`), though I did not count. The claim about `up.integration.test.ts` having "~1100 lines" matches the actual file at 1110 lines.

### Background: Current wezterm-server feature state

Accurate. The real `devcontainer-feature.json` currently has `version`, `createRuntimeDir`, no `sshPort`, and no `customizations.lace`. The `install.sh` does not manage sshd or ports. These claims are verified against the actual files.

### Background: The sshPort Option Semantics

The symmetric model description is correct per the v2 design. The NOTE clarifying that wezterm-server does not start sshd is important and accurate -- `install.sh` only places binaries and optionally creates the runtime directory.

However, there is a conceptual tension worth noting. The `sshPort` option is declared on the wezterm-server feature, but the actual sshd configuration would need to happen on the sshd feature or via container entrypoint. The proposal acknowledges this ("handled by the sshd devcontainer feature or by the container's own sshd setup") but does not specify **how** the sshd feature would learn about the allocated port. If `sshPort` on wezterm-server is just a lace coordination point, the sshd feature still defaults to port 2222 unless something passes it the allocated port. In the symmetric model this would mean sshd needs to listen on 22430 (the allocated port), but the sshd feature's own `port` option would need to receive this value. The scenario tests do not validate this end-to-end flow. **Non-blocking** -- this is a design question for the feature composition, not the test proposal, but the proposal's S3 claims SSH connectivity on the allocated port, which requires sshd to actually listen there. S3 may fail in practice unless the sshd feature's port option is also coordinated.

### Part 1: Update devcontainer-feature.json

The proposed JSON is well-formed. Key observations:

1. The `sshPort` option uses `"type": "string"` with default `"2222"` -- consistent with the devcontainer feature spec convention and the sshd feature's own pattern. Correct.

2. The `customizations.lace.ports.sshPort` declares `label`, `onAutoForward`, and `requireLocalPort`. However, looking at the actual `generatePortEntries()` function in `template-resolver.ts` (lines 298-346), the port attributes it generates only include `label` and `requireLocalPort`. The `onAutoForward` field is **not carried through** to the generated `portsAttributes`. The `extractLaceCustomizations()` function in `feature-metadata.ts` does parse `onAutoForward`, and the `LacePortDeclaration` type includes it, but `FeaturePortDeclaration` in `port-allocator.ts` only has `label` and `requireLocalPort`. The `buildFeaturePortMetadata()` function (lines 382-403 of `template-resolver.ts`) also only passes `label` and `requireLocalPort` to the result map. This means `onAutoForward: "silent"` is declared in the feature manifest but silently dropped before reaching the generated config. **Blocking** -- either the proposal should remove `onAutoForward` from the manifest (and note it as a future enhancement), or the proposal should include a fix to `generatePortEntries()` and `buildFeaturePortMetadata()` to carry `onAutoForward` through. Without this, S2's assertion about `portsAttributes` will pass (it only checks `label` and `requireLocalPort`), but the declared behavior (silent auto-forward) will not actually be configured.

3. The version bump from `1.0.0` to `1.1.0` is semantically correct -- new option with default value is backwards-compatible.

### Part 2: Docker Scenario Test Harness

The proposed `container-harness.ts` has a variable scoping bug in the cleanup function: `containerId` inside the closure refers to the outer variable, but `containerId` is a property on the returned object, not a closure variable. The `if (/* containerId exists */)` comment is a placeholder, but the actual implementation would need `if (ctx.containerId)` rather than a bare `containerId`. **Non-blocking** -- this is clearly a sketch, not production code.

The `isPortReachable()` function uses `bash -c "echo > /dev/tcp/localhost/${port}"`. This is a bashism that works on most Linux systems, but the existing codebase uses `net.Socket` for port checking (see `port-allocator.ts` lines 19-44). Using the existing `isPortAvailable()` (inverted) would be more consistent and avoid the external process dependency. **Non-blocking** -- style consistency suggestion.

The proposal places the harness at `packages/lace/src/__tests__/helpers/container-harness.ts` but Phase 2 creates `packages/lace/src/__tests__/helpers/scenario-utils.ts` with overlapping functionality. The two file names are inconsistent. **Non-blocking** -- Phase 2 supersedes Part 2 and should be the canonical helper file name.

### Part 3: Scenario Test File

**S1 (Explicit mode):** The test config uses `"./features/wezterm-server"` as a local-path feature reference. The proposal says `symlinkLocalFeature()` creates a symlink from the test workspace to the real feature source. The test then calls `runUp({ workspaceFolder: ctx.workspaceRoot, skipDevcontainerUp: true, cacheDir: metadataCacheDir })`.

Problem: `runUp()` does not accept a `cacheDir` parameter directly in the test code shown -- it is `options.cacheDir`. This is actually fine because `UpOptions` does include `cacheDir`. However, the test accesses `result.phases.portAssignment!.port!` -- this works because `UpResult.phases.portAssignment` includes `port?: number`. Correct.

The assertion `expect(features["./features/wezterm-server"].sshPort).toBe("2222")` checks that the user-provided static value is preserved. In the explicit mode config, the user writes `sshPort: "2222"` directly on the feature options AND `appPort: ["${lace.port(wezterm-server/sshPort)}:2222"]`. The template resolver should resolve the `${lace.port()}` in `appPort` but leave `sshPort: "2222"` as-is since it is a static value with no template. This is correct behavior per the auto-injection suppression logic.

However, there is a subtle issue: in S1, the feature's `sshPort` is set to `"2222"` statically, which means auto-injection is suppressed for that option (the `autoInjectPortTemplates()` function checks `if (optionName in featureOptions) continue`). But the `appPort` contains `${lace.port(wezterm-server/sshPort)}`, which allocates a port under the label `wezterm-server/sshPort`. This creates an asymmetric scenario: the allocated host port (e.g., 22425) maps to container port 2222. The assertion `expect(extended.appPort).toContain(\`${port}:2222\`)` is correct for this scenario. However, the test also needs to ensure no symmetric `appPort` entry is auto-generated -- the existing asymmetric appPort suppression logic in `generatePortEntries()` checks `String(entry).startsWith(\`${alloc.port}:\`)`, which would match `"22425:2222"` and suppress the symmetric `"22425:22425"`. This is correct. Good scenario design.

**S2 (Auto-injection mode):** The config has no explicit `sshPort` or `appPort`. Auto-injection should inject `"${lace.port(wezterm-server/sshPort)}"` into the feature options, template resolution allocates a port, and symmetric entries are generated. The test assertions check `appPort`, `forwardPorts`, and `portsAttributes`. This matches the existing integration test for auto-injection (lines 861-916 of `up.integration.test.ts`). The difference is that S2 uses a local-path feature reference with the real `devcontainer-feature.json` instead of a mock subprocess returning metadata. This is the value-add.

The assertion `expect(extended.portsAttributes?.[String(port)]).toEqual({ label: "wezterm ssh (lace)", requireLocalPort: true })` assumes `onAutoForward` is NOT in the output -- which is accurate per the current implementation gap described above. Consistent with the code, but see the blocking finding about `onAutoForward`.

**S3 (Docker integration):** This test actually starts a container and checks SSH connectivity. The config does not include the sshd feature's port option being coordinated with the allocated port. As noted above, `ghcr.io/devcontainers/features/sshd:1` defaults to port 2222 unless told otherwise. If lace allocates port 22430 and maps `22430:22430`, but sshd inside listens on 2222, SSH will not be reachable on port 22430 from the host. **Blocking** -- S3 needs to either: (a) configure the sshd feature to listen on the allocated port (but how?), or (b) use an asymmetric mapping where the host port maps to 2222 inside the container, or (c) acknowledge that S3 cannot validate SSH connectivity without additional sshd coordination and reduce the scope to verifying the container starts. The current test will fail at `waitForPort()` because nothing listens on the allocated port inside the container.

**S4 (Port stability):** Straightforward. Runs `runUp()` twice with `skipDevcontainerUp: true` against the same workspace and checks port reuse. This is already covered by `port-allocator.test.ts` at the unit level, but validating it through the full pipeline with a real feature is reasonable. No issues.

**S5 (User value suppresses injection):** The config sets `sshPort: "3333"` statically. The test asserts no port allocation and no `appPort`. This duplicates the existing `EXPLICIT_STATIC_CONFIG_JSON` test (lines 919-955 of `up.integration.test.ts`) but with a local-path feature. The assertion `expect(result.phases.portAssignment?.message).toContain("No port templates found")` is correct. The assertion `expect(extended.appPort).toBeUndefined()` is correct. No issues.

**S6 (Non-port options unaffected):** Checks that `version` passes through untouched while `sshPort` is auto-injected. Good defensive test. The assertion `expect(typeof features["./features/wezterm-server"].sshPort).toBe("number")` checks type coercion (the auto-injected template resolves to an integer). Correct.

### Important Design Decisions

**Decision 1 (Local-path feature references):** Sound reasoning. Local-path features trigger `fetchFromLocalPath()` in `feature-metadata.ts` (lines 292-322), which reads `devcontainer-feature.json` from disk. This avoids registry dependencies. However, `fetchFromLocalPath()` resolves the path relative to its argument -- it calls `join(featureId, "devcontainer-feature.json")`. For a feature referenced as `./features/wezterm-server`, this path is relative. The question is: relative to what? Looking at `fetchFeatureMetadata()`, for local paths it passes the `featureId` directly to `fetchFromLocalPath()`. If the process cwd is the test workspace, `./features/wezterm-server/devcontainer-feature.json` would resolve correctly if the symlink exists. But `runUp()` does not chdir to the workspace folder. The feature path resolution likely happens relative to the devcontainer.json location or the workspace folder. This needs verification. **Non-blocking** -- the `symlinkLocalFeature()` helper should ensure the symlink target resolves correctly regardless of process cwd.

**Decision 2 (Two tiers):** Sensible. Keeping 5 of 6 scenarios as config-generation-only preserves test speed. One Docker test is sufficient for smoke verification.

**Decision 3 (New file vs extending existing):** Appropriate separation. The existing file tests the system with mock metadata; the new file tests with real feature metadata from disk.

**Decision 4 (sshPort as string):** Correct. Matches the devcontainer feature spec convention.

**Decision 5 (Version 1.1.0):** Correct semver for a backwards-compatible addition.

**Decision 6 (Not modifying install.sh):** Correct. The `sshPort` option is not consumed by `install.sh` -- it exists only for lace's port allocation pipeline.

### Edge Cases

The edge cases are well-considered. E1 (port allocated but container fails) is accurate. E2 (no sshd alongside wezterm-server) is a valid user scenario. E3 (GHCR vs local path) is well-differentiated. E4 (port conflicts) is correctly scoped out. E5 (unpublished metadata) is a real timing concern. E6 (parallel test port collision) is correctly analyzed -- the `PortAllocator` scans for available ports sequentially, so parallel tests in separate workspaces will claim different ports naturally.

### Test Plan

The scenario index table is clear and the running instructions are practical. The Docker gating via `describe.skipIf(!isDockerAvailable())` is the right pattern -- it matches how the existing `docker_smoke.test.ts` is structured (though that file does not use `skipIf`, it simply runs with a long timeout and assumes Docker is present). The proposal should consider whether to match the existing pattern or introduce a new one. **Non-blocking** -- either approach works, but consistency with `docker_smoke.test.ts` would be ideal.

### Implementation Phases

The four phases are well-sequenced. Phase 1 (manifest update) has no code dependencies. Phase 2 (test helpers) depends on Phase 1. Phase 3 (test file) depends on Phases 1 and 2. Phase 4 (align existing test metadata) is optional and non-blocking.

One concern: Phase 1 says "Bump version from `1.0.0` to `1.1.0`" but the existing feature tests (`devcontainers/features/test/wezterm-server/`) may reference or depend on the version. The scenarios.json and test scripts should be checked for version sensitivity. **Non-blocking** -- feature test scripts typically do not depend on the version field.

Phase 2's success criteria includes "`symlinkLocalFeature()` correctly resolves the path from the test workspace to `devcontainers/features/src/`". This is the critical path -- the symlink must bridge from the tmp test workspace to the monorepo's feature source directory. The helper needs to compute the absolute path to `devcontainers/features/src/wezterm-server/` from the repo root, not from the test workspace. The proposal does not specify how this absolute path is discovered at runtime (e.g., via `import.meta.url`, `__dirname`, or a hardcoded relative path from the test file). **Non-blocking** -- implementation detail, but worth specifying.

### Open Questions

1. **Should install.sh accept SSHPORT?** The proposal correctly identifies this as a separate concern. If sshd needs to listen on the allocated port (required for S3 to work), something needs to configure it. This connects to the blocking S3 finding above.

2. **Feature publishing cadence:** Out of scope for this proposal. Correct to flag.

3. **Docker test gating:** The `describe.skipIf` approach is more graceful than a separate filename convention. The existing `docker_smoke.test.ts` uses a different approach (it is always included in the test suite and just has long timeouts). Either approach works, but the proposal's `skipIf` pattern is cleaner for CI environments without Docker.

### Frontmatter

The frontmatter is well-structured. The `references` list is complete and accurate -- all referenced files exist in the codebase. The `task_list` matches the feature-overhaul workstream. Tags are descriptive.

## Verdict

**Revise.** Two blocking issues must be addressed:

1. The `onAutoForward` field declared in the feature manifest is silently dropped by the current `generatePortEntries()` and `buildFeaturePortMetadata()` pipeline. The proposal should either remove `onAutoForward` from the proposed manifest and note it as a gap, or include a fix to thread `onAutoForward` through to the generated `portsAttributes`.

2. Scenario S3 claims SSH connectivity on the allocated port, but the sshd feature inside the container will default to port 2222 unless explicitly configured with the allocated port. The test as written will fail because nothing listens on the allocated port inside the container. S3 needs redesign: either coordinate the sshd feature's port option, use an asymmetric mapping, or reduce the scope to verifying the container starts without connectivity assertions.

## Action Items

1. [blocking] Resolve the `onAutoForward` gap: either drop it from the proposed manifest changes (with a note about the implementation gap) or add the `onAutoForward` field to `FeaturePortDeclaration`, `buildFeaturePortMetadata()`, and `generatePortEntries()` so it flows through to the generated `portsAttributes`.

2. [blocking] Fix S3's sshd port coordination. Either: (a) add the sshd feature with its port option set to `${lace.port(wezterm-server/sshPort)}` or a fixed value matching the Docker mapping, (b) use an asymmetric mapping (`allocatedPort:2222`) so sshd's default port works, or (c) scope S3 down to verifying container start and port mapping without SSH connectivity.

3. [non-blocking] Consolidate the helper file naming: Part 2 introduces `container-harness.ts` but Phase 2 creates `scenario-utils.ts`. Pick one name and use it consistently.

4. [non-blocking] Specify how `symlinkLocalFeature()` discovers the absolute path to `devcontainers/features/src/wezterm-server/` at runtime. Using `import.meta.url` relative path resolution or `path.resolve(__dirname, ...)` are both viable.

5. [non-blocking] Verify that `fetchFromLocalPath()` correctly resolves `./features/wezterm-server` relative to the workspace folder (not process cwd) when called through the `runUp()` pipeline. If it resolves relative to cwd, the symlink approach may need adjustment.

6. [non-blocking] Consider aligning Docker test gating with the existing `docker_smoke.test.ts` pattern for consistency, or document the intentional divergence in the test file header.

7. [non-blocking] Correct the "Scenarios 35-46" count in the BLUF to match the actual scenario numbering in `up.integration.test.ts`.
