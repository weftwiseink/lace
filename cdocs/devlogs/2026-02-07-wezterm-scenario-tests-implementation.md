---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-07T15:00:00-08:00
task_list: lace/feature-overhaul
type: devlog
state: live
status: done
tags: [testing, wezterm-server, feature-awareness-v2, implementation]
references:
  - cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md
  - cdocs/reviews/2026-02-07-review-of-wezterm-server-feature-scenario-tests.md
  - cdocs/reviews/2026-02-07-r2-review-of-wezterm-scenario-tests-implementation.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-07T08:30:00-08:00
  round: 1
---

# Devlog: Wezterm-Server Scenario Tests Implementation

## Plan

Implementing the proposal at `cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md` with fixes for the two R1 blocking issues:

1. **Blocking 1 (onAutoForward pipeline gap):** Add `onAutoForward` to `FeaturePortDeclaration`, `buildFeaturePortMetadata()`, and `generatePortEntries()` so the field flows from the feature manifest through to generated `portsAttributes`.

2. **Blocking 2 (S3 sshd port coordination):** Use asymmetric mapping for S3: `appPort: ["${lace.port(wezterm-server/sshPort)}:2222"]` so the allocated host port maps to container port 2222 where sshd actually listens.

Non-blocking items:
- Use `scenario-utils.ts` consistently (no `container-harness.ts`)
- Use `path.resolve` from `import.meta.url` for discovering feature source path
- Align Docker test gating with `docker_smoke.test.ts` pattern

## Phases

### Phase 1: Update devcontainer-feature.json + fix onAutoForward pipeline

- [x] Add sshPort option and customizations.lace.ports to wezterm-server feature
- [x] Bump version to 1.1.0
- [x] Add onAutoForward to FeaturePortDeclaration in port-allocator.ts
- [x] Add onAutoForward to PortAttributes in port-allocator.ts
- [x] Thread onAutoForward through buildFeaturePortMetadata() in template-resolver.ts
- [x] Thread onAutoForward through generatePortEntries() in template-resolver.ts
- [x] Update GenerateExtendedConfigOptions type in up.ts
- [x] Run tests -- verify all pass

### Phase 2: Create test helpers (scenario-utils.ts)

- [x] createScenarioWorkspace()
- [x] writeDevcontainerJson()
- [x] symlinkLocalFeature() -- uses import.meta.url for path resolution
- [x] copyLocalFeature() -- for Docker tests (devcontainer CLI doesn't follow symlinks)
- [x] readGeneratedConfig()
- [x] readPortAssignments()
- [x] prepareGeneratedConfigForDocker() -- rewrites abs paths to relative
- [x] isDockerAvailable()
- [x] waitForPort()
- [x] getSshBanner()
- [x] stopContainer()
- [x] cleanupWorkspaceContainers()

### Phase 3: Scenario test file (S1-S6)

- [x] S1: Explicit mode
- [x] S2: Auto-injection mode
- [x] S3: Docker integration (gated)
- [x] S4: Port stability
- [x] S5: User value suppresses injection
- [x] S6: Non-port options unaffected

### Phase 4: Update existing test metadata (optional)

- [x] Update weztermMetadata in up.integration.test.ts to include requireLocalPort, onAutoForward, version, createRuntimeDir

## Progress Log

### 2026-02-07 15:00 -- Starting Phase 1

Reading source files, understanding the pipeline gaps.

### 2026-02-07 15:15 -- Phase 1 implementation

Updated devcontainer-feature.json with sshPort option and customizations.lace.ports.
Fixed onAutoForward pipeline: FeaturePortDeclaration, PortAttributes, buildFeaturePortMetadata, generatePortEntries.
Updated GenerateExtendedConfigOptions in up.ts to include the new fields.
Existing test assertion updated to expect onAutoForward in portsAttributes.

### 2026-02-07 15:30 -- Phase 1 tests passing (417/417)

All existing tests pass with the onAutoForward pipeline changes.

### 2026-02-07 15:45 -- Phase 2 + 3 implementation

Created scenario-utils.ts with all test helpers.
Used import.meta.url + fileURLToPath for discovering the feature source path.
Feature path resolution: use absolute paths in devcontainer.json feature references
since fetchFromLocalPath resolves relative to CWD, not workspace.

Created wezterm-server-scenarios.test.ts with all 6 scenarios.
S3 uses asymmetric mapping per R1 blocking fix.
Docker gating uses describe.skipIf(!isDockerAvailable()).

### 2026-02-07 16:00 -- S3 Docker test debugging

Discovered two issues with S3:
1. The devcontainer CLI rejects absolute paths for local features ("An Absolute path to a local feature is not allowed.")
2. The devcontainer CLI (v0.83.0) does not resolve local feature paths when using `--config` with a config file outside `.devcontainer/`.
3. Directory symlinks not followed by the devcontainer CLI's Docker build context copy.

**Solution:** Two-phase approach for S3:
- Phase A: Run `lace up` with `skipDevcontainerUp: true` using absolute paths (metadata resolution works)
- Phase B: Copy the generated config to `.devcontainer/devcontainer.json` with relative paths, then run `devcontainer up` without `--config`

Also: use `copyLocalFeature()` instead of `symlinkLocalFeature()` for Docker tests, since the devcontainer CLI's Docker build context does not follow symlinks.

### 2026-02-07 16:15 -- All tests passing (423/423)

All 6 scenario tests pass:
- S1-S2, S4-S6: Config-generation tests (no Docker needed)
- S3: Docker integration test with SSH connectivity verification

### 2026-02-07 16:20 -- Phase 4: metadata alignment

Updated weztermMetadata in up.integration.test.ts to match real feature manifest.
Added version, createRuntimeDir options and requireLocalPort: true to port declaration.
All 423 tests still passing.

## Key Decisions

### Absolute paths for metadata, relative for Docker CLI

The local feature path resolution has different behavior in lace vs the devcontainer CLI:
- lace's `fetchFromLocalPath()` resolves relative to CWD (Node.js path.join behavior)
- The devcontainer CLI resolves `./features/name` relative to `.devcontainer/`

For config-generation tests (S1-S6 except S3), absolute paths work because only lace's metadata resolver needs them. For Docker tests (S3), a two-phase approach is used to bridge the gap.

### File copies vs symlinks for Docker

The devcontainer CLI copies feature files into a Docker build context. Symlinks (both file and directory level) are not followed during this copy. Using `cpSync()` with `recursive: true` ensures all feature files are real files that Docker can access.

### describe.skipIf for Docker gating

Using `describe.skipIf(!isDockerAvailable())` rather than a separate test file. This matches the developer experience of running all tests with `pnpm test` and getting clear skip messages when Docker is unavailable, without requiring special configuration.
