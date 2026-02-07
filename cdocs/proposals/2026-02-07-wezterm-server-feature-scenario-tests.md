---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-07T10:00:00-08:00
task_list: lace/feature-overhaul
type: proposal
state: live
status: review_ready
tags: [testing, wezterm-server, feature-awareness-v2, integration-tests, ports, devcontainer-features]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-07T14:30:00-08:00
  round: 1
references:
  - cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md
  - devcontainers/features/src/wezterm-server/devcontainer-feature.json
  - packages/lace/src/lib/template-resolver.ts
  - packages/lace/src/lib/port-allocator.ts
  - packages/lace/src/lib/feature-metadata.ts
  - packages/lace/src/lib/up.ts
---

# Wezterm-Server Feature Scenario Tests for Feature Awareness v2

> **BLUF:** Define two end-to-end scenario tests that validate lace's feature awareness v2 system using the wezterm-server devcontainer feature as the canonical integration target: (1) an **explicit mode** test where the user writes `"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]` and lace resolves it, and (2) an **auto-injection mode** test where the feature's `devcontainer-feature.json` declares `customizations.lace.ports.sshPort` and lace auto-generates all port entries with zero user configuration. The existing vitest + mock-subprocess test infrastructure in `up.integration.test.ts` already covers both scenarios at the config-generation level (Scenarios 35-46 in the existing test suite). This proposal adds: (a) a concrete `sshPort` option and `customizations.lace.ports` metadata to the real wezterm-server `devcontainer-feature.json`, (b) a new Docker-level scenario test file that boots actual containers and verifies SSH connectivity on the allocated port, and (c) a lightweight test harness for container lifecycle management during tests.

## Objective

Validate that lace's feature awareness v2 pipeline -- template resolution, port allocation, auto-injection, and config generation -- produces working devcontainer configurations when applied to the real wezterm-server feature. The existing unit-level and mock-subprocess integration tests verify config correctness in isolation. This proposal adds the missing layer: Docker-based scenario tests that prove the generated config actually works when a container is started.

## Background

### Current test coverage

Lace's feature awareness v2 system has extensive test coverage at two levels:

1. **Unit tests** (`template-resolver.test.ts`, `port-allocator.test.ts`, `feature-metadata.test.ts`): Cover template parsing, port allocation logic, metadata extraction, validation, and caching. ~60 test cases.

2. **Integration tests** (`up.integration.test.ts`): Cover the full `runUp()` pipeline with mock subprocesses. Key scenarios already tested:
   - Auto-injection from metadata (auto-injects `sshPort`, generates symmetric `appPort`/`forwardPorts`/`portsAttributes`)
   - User static value preventing auto-injection
   - Explicit template resolution identical to auto-injection
   - Asymmetric `appPort` suppressing auto-generated entry
   - Features without lace ports passing through unchanged
   - Metadata unavailable with `--skip-metadata-validation` fallback

3. **Feature tests** (`devcontainers/features/test/wezterm-server/`): Use the devcontainers CLI test framework (`dev-container-features-test-lib`) to verify the feature installs correctly on Debian/Ubuntu. These tests run inside containers and check that `wezterm-mux-server` and `wezterm` binaries are present.

### What is missing

The gap is between levels 2 and 3. The integration tests prove that `runUp()` generates correct JSON output, and the feature tests prove the feature installs binaries. Neither proves that:

- A container started with the generated config actually maps ports correctly
- SSH is accessible on the allocated port from the host
- The wezterm-mux-server can be reached through the SSH tunnel

Additionally, the real `devcontainer-feature.json` for wezterm-server does not yet declare `customizations.lace.ports` or an `sshPort` option. The test metadata objects in the test files use a hypothetical schema that needs to be made real.

### Current wezterm-server feature state

The feature (`devcontainers/features/src/wezterm-server/devcontainer-feature.json`) has:
- `version`: `"version"` option (wezterm release version string)
- `createRuntimeDir`: `"createRuntimeDir"` option (boolean, creates `/run/user/<uid>`)
- No `sshPort` option
- No `customizations.lace` section

The feature's `install.sh` downloads and installs `wezterm-mux-server` and `wezterm` CLI binaries. It does not configure sshd or manage ports -- that is handled by the separate `ghcr.io/devcontainers/features/sshd:1` feature (which the wezterm-server feature lists in `installsAfter`).

### The sshPort option semantics

The `sshPort` option controls which port the SSH daemon inside the container listens on. When lace auto-injects `${lace.port(wezterm-server/sshPort)}`, the allocated port (e.g., 22430) is used as both:
- The container-internal SSH port (passed to the sshd feature or container configuration)
- The host-side port in the Docker `-p` mapping (`22430:22430`)

This symmetric model means the container's sshd must listen on the same port that Docker maps. The `sshPort` option value flows to the sshd feature's configuration.

> NOTE: The wezterm-server feature itself does not start sshd. The `sshPort` option exists so that lace can track which port the *combination* of wezterm-server + sshd uses, and so that the lace.wezterm plugin can discover which port to SSH into. The actual sshd configuration is either handled by the sshd devcontainer feature or by the container's own sshd setup.

## Proposed Solution

### Part 1: Update `devcontainer-feature.json`

Add an `sshPort` option and `customizations.lace.ports` metadata to the real feature manifest:

```json
{
    "name": "Wezterm Server",
    "id": "wezterm-server",
    "version": "1.1.0",
    "description": "Installs wezterm-mux-server and wezterm CLI for headless terminal multiplexing via SSH domains. Extracts binaries from platform-native packages to avoid X11/Wayland GUI dependencies.",
    "options": {
        "version": {
            "type": "string",
            "default": "20240203-110809-5046fc22",
            "description": "Wezterm release version string (e.g., 20240203-110809-5046fc22)"
        },
        "sshPort": {
            "type": "string",
            "default": "2222",
            "description": "SSH port for wezterm-mux-server access. When used with lace, this is auto-assigned from the 22425-22499 range."
        },
        "createRuntimeDir": {
            "type": "boolean",
            "default": true,
            "description": "Create /run/user/<uid> runtime directory for wezterm-mux-server (UID resolved from _REMOTE_USER)"
        }
    },
    "customizations": {
        "lace": {
            "ports": {
                "sshPort": {
                    "label": "wezterm ssh",
                    "onAutoForward": "silent",
                    "requireLocalPort": true
                }
            }
        }
    },
    "documentationURL": "https://github.com/weftwiseink/lace/tree/main/devcontainers/features/src/wezterm-server",
    "licenseURL": "https://github.com/weftwiseink/lace/blob/main/LICENSE",
    "installsAfter": [
        "ghcr.io/devcontainers/features/common-utils",
        "ghcr.io/devcontainers/features/sshd"
    ]
}
```

Key additions:
- `sshPort` option with default `"2222"` and type `"string"` (devcontainer feature options that represent port numbers use strings; the template resolver's type coercion handles the numeric conversion)
- `customizations.lace.ports.sshPort` with label, `onAutoForward: "silent"` (SSH connections should not trigger VS Code notifications), and `requireLocalPort: true` (the lace.wezterm plugin needs the exact port)

### Part 2: Docker scenario test harness

Create a test harness module that manages container lifecycle for scenario tests. This harness wraps `devcontainer up` / `devcontainer exec` / `devcontainer down` (or `docker run`/`docker stop`/`docker rm`) with timeout management and cleanup guarantees.

**File:** `packages/lace/src/__tests__/helpers/container-harness.ts`

```typescript
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ContainerTestContext {
  workspaceRoot: string;
  devcontainerDir: string;
  laceDir: string;
  containerId: string | null;
  cleanup: () => void;
}

export interface ScenarioConfig {
  devcontainerJson: Record<string, unknown>;
  /** Additional files to write into .devcontainer/ (e.g., Dockerfile) */
  extraFiles?: Record<string, string>;
}

/**
 * Create a temporary workspace with a devcontainer.json and run `lace up`
 * against it, then capture the container ID for assertions.
 */
export function createTestWorkspace(name: string): ContainerTestContext {
  const workspaceRoot = join(
    tmpdir(),
    `lace-scenario-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const devcontainerDir = join(workspaceRoot, ".devcontainer");
  const laceDir = join(workspaceRoot, ".lace");

  mkdirSync(devcontainerDir, { recursive: true });

  return {
    workspaceRoot,
    devcontainerDir,
    laceDir,
    containerId: null,
    cleanup: () => {
      // Stop and remove container if running
      if (/* containerId exists */) {
        try { execSync(`docker rm -f ${containerId}`, { stdio: "pipe" }); } catch {}
      }
      rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Check if a port is accepting TCP connections on localhost.
 */
export function isPortReachable(port: number, timeoutMs = 2000): boolean {
  try {
    execSync(
      `timeout ${timeoutMs / 1000} bash -c "echo > /dev/tcp/localhost/${port}"`,
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a port to become reachable, with retries.
 */
export async function waitForPort(
  port: number,
  maxRetries = 10,
  intervalMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (isPortReachable(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
```

### Part 3: Scenario test file

**File:** `packages/lace/src/__tests__/wezterm-server-scenarios.test.ts`

This file contains two primary scenarios plus supporting edge-case scenarios:

#### Scenario S1: Explicit mode -- user writes `${lace.port()}` in appPort

```typescript
describe("Scenario S1: explicit port template in appPort", { timeout: 120_000 }, () => {
  it("resolves template, allocates port, generates config with asymmetric mapping", async () => {
    // Setup: devcontainer.json with explicit ${lace.port()} in appPort
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        "ghcr.io/devcontainers/features/sshd:1": {},
        "./features/wezterm-server": {
          sshPort: "2222",
        },
      },
      appPort: ["${lace.port(wezterm-server/sshPort)}:2222"],
    };

    // Write devcontainer.json + symlink local feature
    writeDevcontainerJson(ctx, config);
    symlinkLocalFeature(ctx, "wezterm-server");

    // Run lace up (skipDevcontainerUp for config-only check)
    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    // Assert: port allocated in lace range
    expect(result.exitCode).toBe(0);
    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);
    expect(port).toBeLessThanOrEqual(22499);

    // Assert: generated config has asymmetric appPort
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toContain(`${port}:2222`);

    // Assert: sshPort option stays "2222" (user override, not replaced)
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features["./features/wezterm-server"].sshPort).toBe("2222");

    // Assert: port-assignments.json persisted
    const assignments = readPortAssignments(ctx);
    expect(assignments["wezterm-server/sshPort"].port).toBe(port);
  });
});
```

#### Scenario S2: Auto-injection mode -- zero-config port allocation

```typescript
describe("Scenario S2: auto-injection from feature metadata", { timeout: 120_000 }, () => {
  it("auto-injects sshPort template, allocates port, generates symmetric config", async () => {
    // Setup: devcontainer.json with NO explicit sshPort or appPort
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        "ghcr.io/devcontainers/features/sshd:1": {},
        "./features/wezterm-server": {},
      },
    };

    writeDevcontainerJson(ctx, config);
    symlinkLocalFeature(ctx, "wezterm-server");

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    // Assert: port auto-injected and allocated
    expect(result.exitCode).toBe(0);
    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);

    // Assert: generated config has symmetric entries
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toContain(`${port}:${port}`);
    expect(extended.forwardPorts).toContain(port);
    expect(extended.portsAttributes?.[String(port)]).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
    });

    // Assert: feature option resolved to integer
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features["./features/wezterm-server"].sshPort).toBe(port);
  });
});
```

#### Scenario S3: Docker integration -- container actually starts with correct port mapping

```typescript
describe("Scenario S3: Docker integration -- SSH reachable on allocated port",
  { timeout: 180_000 }, () => {

  it("starts container with generated config and SSH port is reachable", async () => {
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        "ghcr.io/devcontainers/features/sshd:1": {},
        "./features/wezterm-server": {},
      },
    };

    writeDevcontainerJson(ctx, config);
    symlinkLocalFeature(ctx, "wezterm-server");

    // Run full lace up (NOT skipping devcontainer up)
    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    const port = result.phases.portAssignment!.port!;

    // Wait for SSH port to become reachable
    const reachable = await waitForPort(port, 15, 2000);
    expect(reachable).toBe(true);

    // Verify SSH banner (SSH servers respond with a version string)
    const banner = getSshBanner(port);
    expect(banner).toMatch(/^SSH-/);
  });
});
```

#### Scenario S4: Port stability across restarts

```typescript
describe("Scenario S4: port stability across lace up invocations", () => {
  it("reuses the same port on second invocation", async () => {
    // First invocation
    const result1 = await runUp({ ... skipDevcontainerUp: true });
    const port1 = result1.phases.portAssignment!.port!;

    // Second invocation (same workspace)
    const result2 = await runUp({ ... skipDevcontainerUp: true });
    const port2 = result2.phases.portAssignment!.port!;

    expect(port1).toBe(port2);
  });
});
```

#### Scenario S5: Explicit sshPort value suppresses auto-injection

```typescript
describe("Scenario S5: user sshPort value prevents auto-injection", () => {
  it("user-set sshPort is not overwritten, no port allocation occurs", async () => {
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        "./features/wezterm-server": {
          sshPort: "3333",
        },
      },
    };

    const result = await runUp({ ... skipDevcontainerUp: true });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.message).toContain("No port templates found");

    const extended = readGeneratedConfig(ctx);
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features["./features/wezterm-server"].sshPort).toBe("3333");
    expect(extended.appPort).toBeUndefined();
  });
});
```

#### Scenario S6: Version option unchanged by port system

```typescript
describe("Scenario S6: non-port options unaffected", () => {
  it("version option passes through untouched", async () => {
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        "./features/wezterm-server": {
          version: "20240203-110809-5046fc22",
        },
      },
    };

    const result = await runUp({ ... skipDevcontainerUp: true });

    const extended = readGeneratedConfig(ctx);
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features["./features/wezterm-server"].version).toBe("20240203-110809-5046fc22");
    // sshPort auto-injected (user did not set it)
    expect(typeof features["./features/wezterm-server"].sshPort).toBe("number");
  });
});
```

## Important Design Decisions

### Decision 1: Local-path feature references in scenario tests

**Decision:** Scenario tests use `./features/wezterm-server` as a local-path reference, pointing to the real feature source via a symlink from the test workspace.

**Why:** This avoids depending on a published GHCR version of the feature that may not have the new `customizations.lace.ports` metadata yet. Local-path references trigger `fetchFromLocalPath()` in `feature-metadata.ts`, which reads the `devcontainer-feature.json` directly from disk -- no OCI manifest fetch, no subprocess mock needed. This makes the tests self-contained and runnable without network access or registry authentication.

### Decision 2: Two tiers of Docker integration tests

**Decision:** Scenarios S1, S2, S4, S5, S6 use `skipDevcontainerUp: true` (config-generation only). Only S3 actually starts a Docker container.

**Why:** Starting a container is slow (~30-60 seconds per test) and requires Docker. Most of the value is in verifying the generated config structure. The single Docker-level test (S3) proves the config *works* when applied. This keeps the fast test suite fast (~1s) while providing a Docker smoke test that can run in CI or on-demand.

### Decision 3: Extending `up.integration.test.ts` vs. a new file

**Decision:** Create a new file `wezterm-server-scenarios.test.ts` rather than adding more tests to `up.integration.test.ts`.

**Why:** `up.integration.test.ts` already has ~1100 lines and covers generic feature awareness v2 scenarios using hypothetical feature metadata. The new file focuses specifically on the wezterm-server feature as a real-world integration target, using the actual `devcontainer-feature.json` from the repo rather than inline metadata objects. This separation clarifies intent: the existing file tests the system's *mechanics*, the new file tests a specific feature's *integration*.

### Decision 4: `sshPort` as a string-type option

**Decision:** The `sshPort` option in `devcontainer-feature.json` uses `"type": "string"` with a default of `"2222"`.

**Why:** Devcontainer feature options that represent port numbers conventionally use string types (e.g., the official `sshd` feature uses `"type": "string"` for its port option). Lace's template resolver handles type coercion: when the entire option value is a single `${lace.port()}` expression, it resolves to an integer; when embedded in a larger string like `"${lace.port(wezterm-server/sshPort)}:2222"`, it remains a string. Using string type maintains compatibility with the devcontainer spec's expectations.

### Decision 5: Feature version bump to 1.1.0

**Decision:** Bump the feature version from `1.0.0` to `1.1.0` when adding the `sshPort` option and `customizations.lace.ports`.

**Why:** Adding a new option with a default value is backwards-compatible (existing users who do not set `sshPort` get `"2222"`, which matches the current implicit behavior). The `customizations` section is invisible to the devcontainer CLI. A minor version bump signals the addition of new functionality without breaking existing consumers.

### Decision 6: Not modifying `install.sh`

**Decision:** The `install.sh` script does not need changes for the `sshPort` option.

**Why:** The `sshPort` option is consumed by lace's port allocation system, not by the feature's install script. The install script's job is to place `wezterm-mux-server` and `wezterm` binaries on the PATH and optionally create the runtime directory. SSH daemon configuration (which port sshd listens on) is handled by the sshd devcontainer feature or the container's own setup, not by the wezterm-server feature. The `sshPort` option exists purely as a lace-level coordination point.

## Edge Cases / Challenging Scenarios

### E1: Port allocated but container fails to start

If `devcontainer up` fails after port allocation, the port assignment is persisted in `.lace/port-assignments.json`. On the next `lace up`, the same port is reused (if still available). No cleanup of port assignments is needed on failure -- stale assignments are harmless and get reassigned if the port becomes unavailable.

### E2: The sshd feature is not installed alongside wezterm-server

If a user installs wezterm-server without sshd, the `sshPort` is allocated and mapped, but no SSH daemon is listening inside the container. The port is reachable but gets connection-refused. This is a valid user configuration (maybe they configure sshd differently). The test suite handles this by including `ghcr.io/devcontainers/features/sshd:1` in scenarios that need SSH connectivity (S3).

### E3: Feature used from GHCR registry vs. local path

When the feature is consumed from `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`, lace fetches metadata via OCI manifest. When used as `./features/wezterm-server`, lace reads the local `devcontainer-feature.json`. Both paths extract `customizations.lace.ports` the same way. Scenario tests use the local path; the existing `up.integration.test.ts` tests cover the OCI path via mock subprocess.

### E4: sshPort conflicts with existing service

If the user sets `sshPort: "22"` (the default SSH port), the container's sshd would conflict with any existing sshd. This is not a lace problem -- it is standard Docker port conflict behavior. Lace's symmetric model avoids this for auto-allocated ports (22425-22499 range is unlikely to conflict).

### E5: devcontainer-feature.json updated but not yet published

Between the time `devcontainer-feature.json` is updated locally and the feature is published to GHCR, there is a window where the GHCR metadata lacks `customizations.lace.ports`. Users consuming the published feature during this window will not get auto-injection. This is expected -- the feature needs to be republished. Scenario tests use local-path references and are immune to this.

### E6: Test port collision during parallel test runs

If CI runs multiple scenario tests in parallel, they could compete for ports in the 22425-22499 range. Each test creates its own workspace directory and port-assignments file, but the port availability check (`isPortAvailable`) is system-wide. Mitigation: the `PortAllocator` scans for the first available port, so parallel tests naturally claim different ports as long as the range is not exhausted.

## Test Plan

### Scenario index

| ID | Description | Docker required | Level |
|----|-------------|:-:|-------|
| S1 | Explicit `${lace.port()}` in appPort | No | Config generation |
| S2 | Auto-injection from feature metadata | No | Config generation |
| S3 | Container starts, SSH reachable | Yes | Docker integration |
| S4 | Port stability across invocations | No | Config generation |
| S5 | User sshPort suppresses injection | No | Config generation |
| S6 | Non-port options unaffected | No | Config generation |

### Running tests

- **Fast suite (S1, S2, S4-S6):** `pnpm test` -- runs with the standard vitest suite, no Docker needed.
- **Docker suite (S3):** Tests tagged with `{ timeout: 180_000 }` and gated by a Docker availability check. Skipped when Docker is unavailable. Can be run explicitly via vitest filter: `pnpm test -- --grep "Docker integration"`.

### Verification criteria

Each scenario has explicit assertions listed in the Proposed Solution. At a high level:

- **Config correctness:** Generated `.lace/devcontainer.json` has the expected `appPort`, `forwardPorts`, `portsAttributes`, and feature option values.
- **Port allocation:** Port is in the 22425-22499 range and persisted in `.lace/port-assignments.json`.
- **Port stability:** Same port is returned on repeated invocations for the same label.
- **Suppression:** User-provided values prevent auto-injection and auto-generation.
- **Connectivity (S3 only):** TCP connection to `localhost:${port}` succeeds within timeout, and the SSH banner is received.

## Implementation Phases

### Phase 1: Update `devcontainer-feature.json`

**Files to modify:**
- `devcontainers/features/src/wezterm-server/devcontainer-feature.json`

**Changes:**
- Add `sshPort` option (type string, default "2222", description noting lace integration)
- Add `customizations.lace.ports.sshPort` with label, onAutoForward, requireLocalPort
- Bump version from `1.0.0` to `1.1.0`

**Do NOT modify:**
- `install.sh` (the sshPort option is not consumed by the install script)
- The existing `version` and `createRuntimeDir` options (only add, do not change)

**Success criteria:**
- Existing feature tests (`devcontainers/features/test/wezterm-server/`) still pass (new option has a default value, no behavioral change)
- `extractLaceCustomizations()` returns `{ ports: { sshPort: { label: "wezterm ssh", onAutoForward: "silent", requireLocalPort: true } } }` when given the updated metadata
- `validatePortDeclarations()` returns `{ valid: true }` for the updated metadata (the `sshPort` port key matches the `sshPort` option name)

### Phase 2: Test helpers

**Files to create:**
- `packages/lace/src/__tests__/helpers/scenario-utils.ts`

**Contents:**
- `createScenarioWorkspace(name)` -- creates temp directory, `.devcontainer/` subdirectory, returns context object with cleanup function
- `writeDevcontainerJson(ctx, config)` -- writes JSON to `.devcontainer/devcontainer.json`
- `symlinkLocalFeature(ctx, featureName)` -- creates a symlink from `ctx.devcontainerDir/features/featureName` to the real `devcontainers/features/src/featureName/` directory, enabling local-path metadata resolution
- `readGeneratedConfig(ctx)` -- reads and parses `.lace/devcontainer.json`
- `readPortAssignments(ctx)` -- reads and parses `.lace/port-assignments.json`
- `isDockerAvailable()` -- checks if Docker daemon is running (for test gating)
- `waitForPort(port, maxRetries, intervalMs)` -- TCP connect retry loop
- `getSshBanner(port)` -- opens a TCP socket, reads the first line, returns it (SSH servers send `SSH-2.0-...`)
- `stopContainer(containerId)` -- `docker rm -f`

**Do NOT modify:**
- Existing test helpers or test files
- `up.integration.test.ts` (this is additive, not modifying existing tests)

**Success criteria:**
- Helper module compiles without errors
- `symlinkLocalFeature()` correctly resolves the path from the test workspace to `devcontainers/features/src/`

### Phase 3: Scenario test file

**Files to create:**
- `packages/lace/src/__tests__/wezterm-server-scenarios.test.ts`

**Contents:**
- Import helpers from Phase 2
- Import `runUp` from `@/lib/up`
- Import `clearMetadataCache` from `@/lib/feature-metadata`
- `beforeEach` / `afterEach` for workspace and cache setup/teardown
- Scenarios S1 through S6 as described in the Proposed Solution
- S3 (Docker integration) wrapped in `describe.skipIf(!isDockerAvailable())`

**Dependencies:**
- Phase 1 (feature manifest must have `customizations.lace.ports` for auto-injection tests)
- Phase 2 (helper functions)

**Do NOT modify:**
- `up.integration.test.ts` (existing tests remain as-is)
- `template-resolver.test.ts`, `port-allocator.test.ts`, `feature-metadata.test.ts` (existing unit tests remain as-is)

**Success criteria:**
- `pnpm test` passes with S1, S2, S4-S6 (no Docker required)
- S3 passes when Docker is available (can be verified manually or in CI)
- S3 is skipped gracefully (with a clear skip message) when Docker is unavailable

### Phase 4: Update existing test metadata to match reality

**Files to modify:**
- `packages/lace/src/commands/__tests__/up.integration.test.ts` (optional, non-blocking)

**Changes:**
- Update the `weztermMetadata` constant to include `requireLocalPort: true` to match the real feature manifest (currently it omits this field)
- Add `onAutoForward: "silent"` to match the real manifest
- These are non-breaking alignment changes -- the existing assertions still pass

**Do NOT modify:**
- Test logic or assertions (only the metadata constant)

**Success criteria:**
- All existing tests in `up.integration.test.ts` continue to pass
- The `weztermMetadata` constant matches the structure of the real `devcontainer-feature.json`

## Open Questions

1. **Should `install.sh` accept `SSHPORT` and configure sshd?** Currently the sshPort option is purely a lace coordination point. If the feature should also configure sshd to listen on the specified port, `install.sh` would need to write an sshd config snippet. This is a separate concern from the test proposal and could be addressed in a follow-up.

2. **Feature publishing cadence:** The `customizations.lace.ports` metadata only takes effect when the feature is consumed from a registry (GHCR) with the updated manifest. When should the feature be republished? This is blocked by the GHCR publishing pipeline being set up (see `cdocs/reports/2026-01-31-ghcr-publishing-prerequisites.md`).

3. **Should the Docker integration test (S3) be in the default `pnpm test` run or require an explicit flag?** The current proposal uses `describe.skipIf(!isDockerAvailable())` which auto-skips when Docker is unavailable. An alternative is to put S3 in a separate test file with a filename convention (e.g., `*.docker.test.ts`) that is excluded from the default vitest config.
