/**
 * Portless Feature Scenario Tests
 *
 * Integration tests that validate lace's feature port injection pipeline
 * using the portless devcontainer feature declared in the top-level `features`
 * map, which receives symmetric port mapping (same host and container port).
 *
 * All scenarios use skipDevcontainerUp: true with a mock subprocess to avoid
 * the actual devcontainer build (which rejects absolute paths for local features).
 * The tests focus on config generation: port injection, template resolution,
 * and portsAttributes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runUp } from "@/lib/up";
import { clearMetadataCache } from "@/lib/feature-metadata";
import type { RunSubprocess } from "@/lib/subprocess";
import {
  createScenarioWorkspace,
  writeDevcontainerJson,
  symlinkLocalFeature,
  readGeneratedConfig,
  readPortAssignments,
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";

let ctx: ScenarioWorkspace;

/**
 * Mock subprocess that succeeds for any devcontainer or container-runtime call.
 */
function createMockSubprocess(): RunSubprocess {
  return (command, _args, _opts) => {
    if (command === "devcontainer") {
      return {
        exitCode: 0,
        stdout: '{"imageName":["test:latest"]}',
        stderr: "",
      };
    }
    // container-runtime calls (podman) — return success
    return { exitCode: 0, stdout: "[{}]", stderr: "" };
  };
}

beforeEach(() => {
  ctx = createScenarioWorkspace("portless");
  clearMetadataCache(ctx.metadataCacheDir);
  // Isolate from host user config to prevent ~/.config/lace/user.json leaking
  // features, git identity, and mounts that the test mocks don't handle.
  const userConfigPath = join(ctx.workspaceRoot, ".user-config.json");
  writeFileSync(userConfigPath, "{}", "utf-8");
  process.env.LACE_USER_CONFIG = userConfigPath;
});

afterEach(() => {
  clearMetadataCache(ctx.metadataCacheDir);
  delete process.env.LACE_SETTINGS;
  delete process.env.LACE_USER_CONFIG;
  ctx.cleanup();
});

// ── P1: Symmetric auto-injection for a port-declaring feature ──

describe("Scenario P1: portless in features with auto-injection", () => {
  it("auto-injects a symmetric port mapping and generates correct config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "portless");

    // Setup: portless in top-level features with default options (no explicit proxyPort)
    const config = {
      image: "node:24-bookworm",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      subprocess: createMockSubprocess(),
      cacheDir: ctx.metadataCacheDir,
    });

    // Assert: successful run
    expect(result.exitCode).toBe(0);

    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);
    expect(port).toBeLessThanOrEqual(22499);

    // Assert: generated config has a symmetric appPort (host:host)
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toContain(`${port}:${port}`);

    // Assert: forwardPorts contains the host port
    expect(extended.forwardPorts).toContain(port);

    // Assert: portsAttributes with label from feature metadata
    expect(
      (extended.portsAttributes as Record<string, unknown>)?.[String(port)],
    ).toEqual({
      label: "portless proxy (lace)",
      requireLocalPort: true,
      onAutoForward: "silent",
    });

    // Assert: port-assignments.json persisted with portless label
    const assignments = readPortAssignments(ctx);
    expect(assignments["portless/proxyPort"].port).toBe(port);
  });
});

// ── P2: Port persistence -- same port on repeat runs ──

describe("Scenario P2: port persistence across runs", () => {
  it("allocates the same host port on second run", async () => {
    const featurePath = symlinkLocalFeature(ctx, "portless");

    const config = {
      image: "node:24-bookworm",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    const subprocess = createMockSubprocess();

    // First run
    const result1 = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      subprocess,
      cacheDir: ctx.metadataCacheDir,
    });
    expect(result1.exitCode).toBe(0);
    const port1 = result1.phases.portAssignment!.port!;

    // Second run (same workspace, port-assignments.json persists)
    const result2 = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      subprocess,
      cacheDir: ctx.metadataCacheDir,
    });
    expect(result2.exitCode).toBe(0);
    const port2 = result2.phases.portAssignment!.port!;

    // Assert: same port allocated both times
    expect(port2).toBe(port1);
  });
});

// NOTE(opus/test-health): P3 (portless + wezterm-server coexistence) removed.
// The wezterm-server feature was deleted in commit 7f6ca1d.
