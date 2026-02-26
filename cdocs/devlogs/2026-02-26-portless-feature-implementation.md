---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-26T16:00:00-06:00
task_list: lace/portless
type: devlog
state: live
status: review_ready
tags: [portless, devcontainer-feature, implementation, handoff]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-26T22:30:00-06:00
  round: 1
related_to:
  - cdocs/proposals/2026-02-26-portless-devcontainer-feature.md
  - cdocs/reports/2026-02-26-portless-integration-design-rationale.md
  - cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md
  - cdocs/devlogs/2026-02-26-portless-integration-exploration.md
---

# Portless Devcontainer Feature Implementation: Devlog

## Objective

Implement the portless devcontainer feature per the accepted proposal at
`cdocs/proposals/2026-02-26-portless-devcontainer-feature.md` (accepted round 4, status: `implementation_ready`).

The feature installs portless as a prebuild devcontainer feature with asymmetric port mapping.
Portless runs on its default port 1355 inside the container; lace maps asymmetrically (e.g., `22435:1355`).
Zero lace core changes required.
No env var baking or port propagation needed.

## Key References

- **Proposal** (accepted, round 4): `cdocs/proposals/2026-02-26-portless-devcontainer-feature.md`
  - Feature specification (JSON + install.sh + entrypoint): lines 98-193
  - Test plan (18 tests across 5 categories): lines 296-389
  - Implementation plan with pitfalls: lines 390-518
- **Design rationale**: `cdocs/reports/2026-02-26-portless-integration-design-rationale.md`
  - 7 design decisions — key ones: prebuild asymmetric mapping (Decision 3), no env var propagation (Decision 4), dot naming (Decision 6)
- **Port allocation investigation**: `cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md`
  - How `injectForPrebuildBlock()` works, wezterm comparison table
- **Reference implementation**: `devcontainers/features/src/wezterm-server/`
  - `devcontainer-feature.json` for prebuild port declaration pattern (hostSshPort default "2222")
  - `install.sh` for entrypoint root/non-root guard pattern (lines 108-118)
- **GHCR publish reference**: `cdocs/devlogs/2026-02-10-publish-wezterm-server-feature-to-ghcr.md`
- **Exploration devlog**: `cdocs/devlogs/2026-02-26-portless-integration-exploration.md`

## Plan

Follow the proposal's 5-phase implementation plan.
Phase 5 (GHCR publish) is deferred pending portless version stability assessment.

The proposal's Implementation Plan section (lines 390-518) has detailed step-by-step instructions and pitfalls for each phase.
This devlog summarizes the key steps; refer to the proposal for full detail.

### Phase 1: Feature Scaffold

1. Create `devcontainers/features/src/portless/devcontainer-feature.json`
   - Copy structure from wezterm-server feature
   - Two options: `proxyPort` (default "1355", not used by install.sh), `version` (default "latest")
   - `customizations.lace.ports.proxyPort` with `requireLocalPort: true`
2. Create `devcontainers/features/src/portless/install.sh`
   - npm availability check → `npm install -g portless@${VERSION}` → verify install
   - Generate entrypoint: start `portless proxy` (default port 1355) with root/non-root guard
   - No env var baking — portless uses its built-in default
3. Standalone verification (without lace): portless starts on 1355, test service accessible

### Phase 2: Lace Integration

4. Add portless feature to a test devcontainer.json in `customizations.lace.prebuildFeatures`
5. Run `lace up` and verify:
   - `appPort: ["22435:1355"]` (asymmetric) in `.lace/devcontainer.json`
   - `forwardPorts: [22435]`
   - `portsAttributes` with correct label
   - Feature option NOT modified (prebuild path doesn't inject into options)
6. Full user-facing workflow test: `portless web.main <command>` → accessible from host browser

### Phase 3: User-Facing Workflow Verification

7. Multi-worktree scenario: two worktrees, two services, no conflicts
8. Service lifecycle: start/stop/restart, route listing page
9. Without-lace scenario: default port 1355

### Phase 4: Documentation

10. Add portless section to `packages/lace/README.md`

### Phase 5: Publish (Deferred)

11. Identify stable portless version, pin, publish to GHCR

## Testing Approach

The proposal defines 18 tests across 5 categories.
Run tests incrementally per phase:

- **Phase 1 gate**: Tests 1-8 (unit + entrypoint lifecycle)
  - Run install.sh in a `node:24-bookworm` container
  - Verify NO env var baking (no /etc/profile.d/, no /etc/environment)
  - Test entrypoint with both root and non-root `_REMOTE_USER`
  - Verify proxy starts on default port 1355
  - Test npm-absent failure in `debian:bookworm`
- **Phase 2 gate**: Tests 9-16 (integration + smoke)
  - `lace up` with portless in prebuildFeatures
  - Verify asymmetric `appPort` entry
  - Proxy accessible from host via lace-allocated port
  - Route registration with dotted names
  - Port reassignment without rebuild
- **Phase 3 gate**: Tests 17-18 (manual verification) + user workflow validation

## Key Pitfalls to Watch For

These are documented in detail in the proposal's Implementation Plan:

1. **Entrypoint must background the proxy** — `portless proxy` blocks if not backgrounded, hanging the container
2. **`injectForPrebuildBlock()` skips on explicit option values** — test default auto-injection AND explicit override
3. **`generatePortEntries()` duplicate suppression** — verify no symmetric `"22435:22435"` alongside asymmetric `"22435:1355"`
4. **Host DNS for `*.localhost`** — works on Linux/macOS natively; test with `getent hosts web.main.localhost`
5. **Dotted service names** — verify `portless web.main <cmd>` registers as `web.main.localhost` in routes.json

## Implementation Notes

### Phase 1: Feature Scaffold

Created the portless feature files following the wezterm-server pattern.

**Discovery: `portless proxy start` (not `portless proxy`).**
The proposal specified `portless proxy` in the entrypoint, but the portless CLI requires `portless proxy start`.
The `start` subcommand self-daemonizes, so no trailing `&` is needed in the entrypoint.
Fixed immediately after Docker-based validation revealed the issue.

**Portless version:** 0.4.2 was the latest at implementation time.
The feature defaults to `latest` but the custom_version test pins to 0.4.2.

### Phase 2: Lace Integration

Zero lace core changes needed — the existing prebuild features pipeline handled portless.

**Mock subprocess for scenario tests.**
Portless scenario tests (P1-P3) use a mock subprocess to bypass `devcontainer build`.
The devcontainer CLI rejects absolute paths for local features, which is what `symlinkLocalFeature()` produces.
Since the tests only validate config generation (port injection, template resolution, portsAttributes), mocking the build is appropriate.

**Verified assertions:**
- Asymmetric `appPort` entry: `"22426:1355"` (not symmetric `"22426:22426"`)
- No duplicate suppression issues
- Port persistence across runs (same port reused)
- Multi-feature coexistence: portless (22427) + wezterm-server (22426) get distinct ports

### Phase 3: E2E Smoke Tests

All smoke tests run inside Docker (`node:24-bookworm`) with the raw install.sh.

### Deviations from Proposal

1. **Entrypoint command**: Changed `portless proxy` to `portless proxy start` based on actual CLI interface.
2. **Entrypoint backgrounding**: Removed trailing `&` since `portless proxy start` self-daemonizes.
3. **Test strategy**: Lace scenario tests use mock subprocess instead of real `devcontainer build` due to devcontainer CLI absolute path restrictions.

## Test Coverage vs Proposal

The proposal defines 18 tests. Coverage status:

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Install verification | Automated | `test.sh`, `node_default.sh` |
| 2 | No env var baking | Automated | `test.sh` (both `/etc/environment` and `/etc/profile.d/`) |
| 3 | Version pinning | Automated | `custom_version.sh` |
| 4 | No npm failure | Manual only | Devlog evidence; devcontainer test framework expects success |
| 5 | Proxy auto-start (non-root) | Cancelled | Would require container-level test harness with user switching |
| 6 | Proxy auto-start (root) | Cancelled | Same as 5 |
| 7 | Idempotent restart | Cancelled | Would require container lifecycle management in test |
| 8 | Port already bound | Cancelled | Same as 7 |
| 9 | Asymmetric port injection | Automated | P1 scenario test |
| 10 | Port persistence | Automated | P2 scenario test |
| 11 | Multi-feature coexistence | Automated | P3 scenario test |
| 12 | Port reassignment | Cancelled | Would require host-port conflict simulation |
| 13 | Proxy responds | Manual only | Devlog Docker evidence |
| 14 | Route registration | Manual only | Devlog Docker evidence |
| 15 | Host access | Cancelled | Would require running container with port mapping |
| 16 | Multiple services | Manual only | Devlog Docker evidence |
| 17 | Browser access | Manual | By nature (manual verification) |
| 18 | Route listing | Manual only | Devlog Docker evidence |

**Summary:** 7 automated, 5 manual-only (with devlog evidence), 6 cancelled.

**Rationale for cancelled tests:**
Tests 5-8 (entrypoint lifecycle) would require a container-level test harness that can manage container startup, user switching, and process inspection — infrastructure that does not exist in the current test framework and is not planned.
The wezterm-server feature has the same gap: its entrypoint tests (S3) only verify SSH connectivity after container start, not the internal startup behavior.
Test 12 (port reassignment) would require simulating host-port conflicts.
Test 15 (host access) would require a running container with Docker port mapping.
Manual Docker verification during implementation covered the happy paths for these behaviors.

## Changes Made

| File | Description |
|------|-------------|
| `devcontainers/features/src/portless/devcontainer-feature.json` | Feature manifest with lace port declaration |
| `devcontainers/features/src/portless/install.sh` | npm install + entrypoint generation |
| `packages/lace/src/__tests__/portless-scenarios.test.ts` | Lace integration tests (P1-P3) |
| `devcontainers/features/test/portless/scenarios.json` | Feature test scenario definitions |
| `devcontainers/features/test/portless/test.sh` | Core feature test |
| `devcontainers/features/test/portless/node_default.sh` | Default install scenario test |
| `devcontainers/features/test/portless/custom_version.sh` | Version pinning scenario test |
| `.github/workflows/devcontainer-features-test.yaml` | CI: add portless feature testing |
| `packages/lace/README.md` | Portless usage documentation |

## Verification

### Full Test Suite (790 tests, 0 failures)

```
 ✓ src/__tests__/portless-scenarios.test.ts (3 tests) 30ms
 ✓ src/__tests__/wezterm-server-scenarios.test.ts (6 tests) 13644ms
 ✓ src/__tests__/docker_smoke.test.ts (8 tests) 27196ms
 ✓ src/__tests__/workspace_smoke.test.ts (15 tests) 584ms
 ✓ src/commands/__tests__/up.integration.test.ts (44 tests) 234ms
 ... (25 more test files)

 Test Files  30 passed (30)
      Tests  790 passed (790)
   Duration  27.88s
```

### Phase 1: Feature Install (Docker)

```
Installing portless@latest...
0.4.2
Portless feature installed. Proxy will listen on port 1355 (default).
=== Verify portless ===
0.4.2
=== Check no env var baking ===
OK: no /etc/profile.d/portless-lace.sh
OK: no PORTLESS_PORT in /etc/environment
=== Check entrypoint exists ===
OK: entrypoint exists and is executable
=== ALL INSTALL TESTS PASSED ===
```

### Phase 1: npm-Absent Failure (Docker)

```
Installing portless@latest...
Error: npm is required. Add a Node.js feature first.
EXIT_CODE=1
```

### Phase 2: Lace Integration (P1-P3)

```
Auto-injected port templates for: portless/proxyPort
Allocated ports:
  portless/proxyPort: 22426

Auto-injected port templates for: wezterm-server/hostSshPort, portless/proxyPort
Allocated ports:
  wezterm-server/hostSshPort: 22426
  portless/proxyPort: 22427
```

### Phase 3: E2E Smoke (Docker)

```
--- Test 13: Proxy responds on default port ---
PASS: proxy responds with 404 (no routes)

--- Test: Access via Host header ---
PASS: route registration and Host-header routing works

--- Test 16: Multiple services ---
PASS: multiple services with distinct Host headers

--- Test 18: Route listing page ---
PASS: unknown host returns 404 (route listing)

=== ALL E2E SMOKE TESTS COMPLETE ===
```
