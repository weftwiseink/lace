---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-07T15:00:00-08:00
task_list: lace/feature-overhaul
type: devlog
state: live
status: in_progress
tags: [testing, wezterm-server, feature-awareness-v2, implementation]
references:
  - cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md
  - cdocs/reviews/2026-02-07-review-of-wezterm-server-feature-scenario-tests.md
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
- [x] readGeneratedConfig()
- [x] readPortAssignments()
- [x] isDockerAvailable()
- [x] waitForPort()
- [x] getSshBanner()

### Phase 3: Scenario test file (S1-S6)

- [x] S1: Explicit mode
- [x] S2: Auto-injection mode
- [x] S3: Docker integration (gated)
- [x] S4: Port stability
- [x] S5: User value suppresses injection
- [x] S6: Non-port options unaffected

### Phase 4: Update existing test metadata (optional)

- [x] Update weztermMetadata in up.integration.test.ts to include requireLocalPort and onAutoForward

## Progress Log

### 2026-02-07 15:00 -- Starting Phase 1

Reading source files, understanding the pipeline gaps.

### 2026-02-07 15:15 -- Phase 1 implementation

Updated devcontainer-feature.json with sshPort option and customizations.lace.ports.
Fixed onAutoForward pipeline: FeaturePortDeclaration, PortAttributes, buildFeaturePortMetadata, generatePortEntries.
Updated GenerateExtendedConfigOptions in up.ts to include the new fields.

### 2026-02-07 15:30 -- Phase 1 tests passing

All existing tests pass with the onAutoForward pipeline changes.

### 2026-02-07 15:45 -- Phase 2 implementation

Created scenario-utils.ts with all test helpers.
Used import.meta.url + fileURLToPath for discovering the feature source path.
Feature path resolution: use absolute paths in devcontainer.json feature references
since fetchFromLocalPath resolves relative to CWD, not workspace.

### 2026-02-07 16:00 -- Phase 3 implementation

Created wezterm-server-scenarios.test.ts with all 6 scenarios.
S3 uses asymmetric mapping per R1 blocking fix.
Docker gating uses describe.skipIf(!isDockerAvailable()).

### 2026-02-07 16:15 -- Phase 4 implementation

Updated weztermMetadata in up.integration.test.ts to match real feature manifest.
Added requireLocalPort: true and onAutoForward: "silent".
Updated assertions to expect onAutoForward in portsAttributes.
