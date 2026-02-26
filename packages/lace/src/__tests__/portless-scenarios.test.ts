/**
 * Portless Feature Scenario Tests
 *
 * Integration tests that validate lace's prebuild feature port injection
 * pipeline using the portless devcontainer feature.
 *
 * Unlike wezterm-server (top-level feature with symmetric mapping), portless
 * uses prebuildFeatures with asymmetric mapping: the host port is lace-allocated
 * and maps to portless's default container port 1355.
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
  createTempSshKey,
  setupScenarioSettings,
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";

let ctx: ScenarioWorkspace;

/**
 * Mock subprocess that succeeds for devcontainer build (prebuild phase)
 * and docker image inspect. Writes a minimal lock file to satisfy the
 * prebuild pipeline's post-build expectations.
 */
function createMockSubprocess(): RunSubprocess {
  return (command, args, _opts) => {
    if (command === "devcontainer") {
      // Simulate successful devcontainer build with a lock file
      const wsFolderIdx = args.indexOf("--workspace-folder");
      if (wsFolderIdx >= 0) {
        const wsFolder = args[wsFolderIdx + 1];
        writeFileSync(
          join(wsFolder, "devcontainer-lock.json"),
          JSON.stringify({ features: {} }, null, 2) + "\n",
          "utf-8",
        );
      }
      return {
        exitCode: 0,
        stdout: '{"imageName":["lace.local/test:latest"]}',
        stderr: "",
      };
    }
    // docker image inspect — return success
    return { exitCode: 0, stdout: "[{}]", stderr: "" };
  };
}

beforeEach(() => {
  ctx = createScenarioWorkspace("portless");
  clearMetadataCache(ctx.metadataCacheDir);
});

afterEach(() => {
  clearMetadataCache(ctx.metadataCacheDir);
  delete process.env.LACE_SETTINGS;
  ctx.cleanup();
});

// ── P1: Prebuild auto-injection -- asymmetric port mapping ──

describe("Scenario P1: portless in prebuildFeatures with auto-injection", () => {
  it("auto-injects asymmetric appPort entry and generates correct config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "portless");

    // Setup: portless in prebuildFeatures with default options (no explicit proxyPort)
    const config = {
      image: "node:24-bookworm",
      customizations: {
        lace: {
          prebuildFeatures: {
            [featurePath]: {},
          },
        },
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

    // Assert: generated config has asymmetric appPort (host:1355)
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toContain(`${port}:1355`);

    // Assert: no symmetric entry alongside the asymmetric one
    expect(extended.appPort).not.toContain(`${port}:${port}`);

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
      customizations: {
        lace: {
          prebuildFeatures: {
            [featurePath]: {},
          },
        },
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

// ── P3: Multi-feature coexistence with wezterm-server ──

describe("Scenario P3: portless + wezterm-server coexistence", () => {
  it("allocates distinct host ports for portless and wezterm-server", async () => {
    const portlessPath = symlinkLocalFeature(ctx, "portless");
    const weztermPath = symlinkLocalFeature(ctx, "wezterm-server");

    // wezterm-server needs an SSH key mount for validation
    const keyPath = createTempSshKey(ctx);
    setupScenarioSettings(ctx, {
      mounts: {
        "wezterm-server/authorized-keys": { source: keyPath },
      },
    });

    const config = {
      image: "node:24-bookworm",
      features: {
        [weztermPath]: {},
      },
      customizations: {
        lace: {
          prebuildFeatures: {
            [portlessPath]: {},
          },
        },
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      subprocess: createMockSubprocess(),
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    // Assert: both features got distinct ports
    const assignments = readPortAssignments(ctx);
    const portlessPort = assignments["portless/proxyPort"].port;
    const weztermPort = assignments["wezterm-server/hostSshPort"].port;

    expect(portlessPort).not.toBe(weztermPort);
    expect(portlessPort).toBeGreaterThanOrEqual(22425);
    expect(weztermPort).toBeGreaterThanOrEqual(22425);

    // Assert: generated config has both port entries
    const extended = readGeneratedConfig(ctx);
    const appPort = extended.appPort as string[];

    // Portless: asymmetric (prebuild feature)
    expect(appPort).toContain(`${portlessPort}:1355`);
    // Wezterm: symmetric (top-level feature, auto-injected)
    expect(appPort).toContain(`${weztermPort}:${weztermPort}`);

    // Assert: both have portsAttributes
    const attrs = extended.portsAttributes as Record<string, unknown>;
    expect(attrs[String(portlessPort)]).toBeDefined();
    expect(attrs[String(weztermPort)]).toBeDefined();
  });
});
