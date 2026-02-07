---
review_of: cdocs/devlogs/2026-02-07-wezterm-scenario-tests-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-07T08:30:00-08:00
task_list: lace/feature-overhaul
type: review
state: live
status: done
tags: [fresh_agent, implementation_review, testing, onAutoForward, code_quality, scenario_tests]
---

# Review: Wezterm-Server Scenario Tests Implementation Devlog

## Summary Assessment

This devlog documents the implementation of 6 scenario tests (S1-S6) for the wezterm-server feature, plus a fix to the `onAutoForward` pipeline gap and the addition of `sshPort`/`customizations.lace.ports` to the real feature manifest. The implementation is solid: all 6 scenarios pass (including S3 Docker integration), both R1 blocking findings from the proposal review are properly addressed, and the test helpers are well-designed. The main findings are minor: unused imports in the test file, inline type duplication in `up.ts` instead of reusing `FeaturePortDeclaration`, and the devlog does not document the sshd feature inclusion in S3 which is a subtle but important detail. Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### Plan Section

The plan accurately maps to the R1 review's two blocking findings. The devlog correctly identifies:
1. Threading `onAutoForward` through the pipeline (blocking 1)
2. Using asymmetric mapping for S3 (blocking 2)

The non-blocking items (consistent helper naming, `path.resolve` from `import.meta.url`, Docker test gating alignment) are all addressed in the implementation. No issues.

### Phase 1: Feature Manifest + onAutoForward Pipeline

**Production code changes verified against the diff:**

- `devcontainer-feature.json`: Correctly adds `sshPort` option (type string, default "2222") and `customizations.lace.ports.sshPort` with label, onAutoForward, requireLocalPort. Version bumped to 1.1.0. **Correct.**

- `port-allocator.ts`: Adds `onAutoForward?: string` to both `PortAttributes` and `FeaturePortDeclaration`. **Correct.**

- `template-resolver.ts`: Threads `onAutoForward` through `buildFeaturePortMetadata()` (conditionally set on the `FeaturePortDeclaration` entry) and `generatePortEntries()` (conditionally set on the `PortAttributes` result). The conditional pattern (`if (featureMeta?.onAutoForward)`) means the field is only present when explicitly declared, avoiding unnecessary `undefined` values in generated JSON. **Correct and clean.**

- `up.ts`: Updates the inline type for `featurePortMetadata` to include `onAutoForward?: string` in both the local variable declaration and `GenerateExtendedConfigOptions`. **Correct but has a type duplication issue** (see code quality finding below).

The onAutoForward fix is verified end-to-end: S1 and S2 both assert `onAutoForward: "silent"` in the generated `portsAttributes`, and these assertions pass. The pipeline gap identified in R1 is fully closed.

### Phase 2 + 3: Test Helpers and Scenarios

**scenario-utils.ts:**

The helper module is well-structured. Key design decisions are sound:
- `REPO_ROOT` computed via `import.meta.url` + `fileURLToPath` (5 levels up from `helpers/` to repo root). **Correct.**
- `symlinkLocalFeature()` returns the absolute symlink path for use as the devcontainer.json feature key, because `fetchFromLocalPath()` resolves relative to CWD, not workspace. **This addresses the R1 non-blocking finding about path resolution.**
- `copyLocalFeature()` exists separately for S3 because the devcontainer CLI's Docker build context does not follow symlinks. **Correct design.**
- `prepareGeneratedConfigForDocker()` handles the absolute-to-relative path rewriting needed for the two-phase S3 approach. The string replacement uses `JSON.stringify(absPath)` to handle JSON-escaped paths. **Correct.**
- `waitForPort()` and `getSshBanner()` use `net.Socket` consistent with the codebase's `port-allocator.ts`. **Addresses R1 non-blocking finding about consistency.**

**wezterm-server-scenarios.test.ts:**

- **S1 (Explicit mode):** Tests asymmetric appPort with user-set `sshPort: "2222"` and explicit `${lace.port()}` template. Correctly asserts allocated port in range, asymmetric mapping in appPort, no symmetric entry, sshPort preserved as "2222", forwardPorts/portsAttributes generated with onAutoForward. **Complete coverage.**

- **S2 (Auto-injection):** Tests zero-config with empty feature options. Correctly asserts auto-injected template, symmetric entries, type coercion (sshPort resolved to integer). **Complete coverage.**

- **S3 (Docker integration):** Uses `describe.skipIf(!isDockerAvailable())` for graceful gating. Includes `ghcr.io/devcontainers/features/sshd:1` alongside the local wezterm-server feature -- this is the fix for the R1 blocking finding about sshd port coordination. The asymmetric mapping `${lace.port(wezterm-server/sshPort)}:2222` maps the allocated host port to container port 2222 where sshd defaults. The two-phase approach (lace up for config, then devcontainer up with rewritten config) is well-documented in the test comments. Container cleanup uses both ID-based and label-based approaches for robustness. **Correctly addresses R1 blocking finding.**

- **S4 (Port stability):** Runs `runUp()` twice, clears metadata cache between runs (but port-assignments.json persists), asserts same port. **Correct.**

- **S5 (Suppression):** User sets `sshPort: "3333"`, no appPort. Asserts no allocation, no auto-generated entries. **Correct.**

- **S6 (Non-port options):** User sets `version` but not `sshPort`. Asserts version passes through, sshPort auto-injected as integer. **Correct.**

### Phase 4: Metadata Alignment

The `weztermMetadata` constant in `up.integration.test.ts` now matches the real feature manifest: adds `version` and `createRuntimeDir` options, adds `requireLocalPort: true` to the port declaration, and bumps version to "1.1.0". All 415 non-Docker tests continue to pass. **Correct.**

### Key Decisions Section

The three documented decisions (absolute paths for metadata / relative for Docker CLI, file copies vs symlinks for Docker, `describe.skipIf` for Docker gating) are all well-reasoned and correctly implemented. No issues.

### Devlog Completeness

The progress log entries are timestamped and track the actual implementation sequence. The S3 debugging section documents the three issues discovered (absolute path rejection, local feature path with `--config`, symlink following) and the two-phase solution. This is valuable for future maintainers.

**Missing from devlog:** The devlog does not mention including `ghcr.io/devcontainers/features/sshd:1` in S3's feature list. This was a critical part of addressing the R1 blocking finding about sshd port coordination. The choice to include sshd (so port 2222 is actually listening inside the container) is the reason S3's SSH connectivity assertion works. **Non-blocking** -- the code is self-documenting, but the devlog should note this decision since it directly addresses a blocking review finding.

## Code Quality Findings

### Unused imports in test file (fixed during review)

`wezterm-server-scenarios.test.ts` imported `readFileSync`, `existsSync` from `node:fs` and `join` from `node:path`, none of which were used directly (all file reading goes through helper functions). **Fixed during this review** by removing the unused imports. Tests pass after fix.

### Type duplication in up.ts (fixed during review)

`up.ts` used inline `{ label?: string; requireLocalPort?: boolean; onAutoForward?: string }` in two places instead of importing `FeaturePortDeclaration` from `port-allocator.ts`. **Fixed during this review** by importing and using the named type. Typecheck and all tests pass after fix.

### Container ID quoting in stopContainer (fixed during review)

`stopContainer()` passed `containerId` to `docker rm -f` without shell quoting. While container IDs from `devcontainer up` JSON output are hex strings and safe in practice, quoting is defensive and costs nothing. **Fixed during this review** by adding double quotes.

## Verification

- All 6 scenario tests pass (including S3 Docker integration): 6/6 green
- All non-Docker tests pass: 415/415 green
- TypeScript type checking passes with no errors
- The 4 failures in `docker_smoke.test.ts` are pre-existing and unrelated to this implementation

## Verdict

**Accept.** Both R1 blocking findings are properly addressed in the implementation. The `onAutoForward` pipeline gap is fixed with correct conditional threading through three files. The S3 Docker test uses asymmetric mapping with the sshd feature to achieve SSH connectivity on the allocated port. Test helpers are well-designed and robust. The three minor code quality issues found during review have been fixed directly.

## Action Items

1. [non-blocking] Update the devlog's S3 debugging section to note the inclusion of `ghcr.io/devcontainers/features/sshd:1` in S3's feature list and explain that this is what makes sshd listen on port 2222 inside the container, enabling the SSH connectivity assertion.

2. [non-blocking] The pre-existing `docker_smoke.test.ts` failures (4 tests) should be investigated separately -- they appear to be an environment issue with the `devcontainer build` command, not related to this implementation.
