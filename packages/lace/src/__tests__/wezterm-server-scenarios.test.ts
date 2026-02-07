/**
 * Wezterm-Server Feature Scenario Tests
 *
 * Integration tests that validate lace's feature awareness v2 pipeline using
 * the real wezterm-server devcontainer feature as the integration target.
 *
 * Scenarios S1-S2, S4-S6 use skipDevcontainerUp: true (config-generation only).
 * Scenario S3 (Docker integration) actually starts a container and is gated
 * by Docker availability.
 *
 * @see cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runUp } from "@/lib/up";
import { clearMetadataCache } from "@/lib/feature-metadata";
import {
  createScenarioWorkspace,
  writeDevcontainerJson,
  symlinkLocalFeature,
  copyLocalFeature,
  readGeneratedConfig,
  readPortAssignments,
  prepareGeneratedConfigForDocker,
  isDockerAvailable,
  waitForPort,
  getSshBanner,
  stopContainer,
  cleanupWorkspaceContainers,
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";
import { execSync } from "node:child_process";

let ctx: ScenarioWorkspace;

beforeEach(() => {
  ctx = createScenarioWorkspace("wezterm");
  clearMetadataCache(ctx.metadataCacheDir);
});

afterEach(() => {
  clearMetadataCache(ctx.metadataCacheDir);
  ctx.cleanup();
});

// ── S1: Explicit mode -- user writes ${lace.port()} in appPort ──

describe("Scenario S1: explicit port template in appPort", () => {
  it("resolves template, allocates port, generates config with asymmetric mapping", async () => {
    // Setup: symlink the real wezterm-server feature into the workspace
    const featurePath = symlinkLocalFeature(ctx, "wezterm-server");

    // Setup: devcontainer.json with explicit ${lace.port()} in appPort
    // User provides sshPort: "2222" statically (auto-injection suppressed)
    // and an explicit appPort with the template for asymmetric mapping
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          sshPort: "2222",
        },
      },
      appPort: ["${lace.port(wezterm-server/sshPort)}:2222"],
    };

    writeDevcontainerJson(ctx, config);

    // Run lace up (config-generation only)
    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    // Assert: successful run with port allocation
    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.exitCode).toBe(0);

    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);
    expect(port).toBeLessThanOrEqual(22499);

    // Assert: generated config has the user's asymmetric appPort (resolved)
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toContain(`${port}:2222`);

    // Assert: no symmetric appPort entry (suppressed by user's asymmetric entry)
    expect(extended.appPort).not.toContain(`${port}:${port}`);

    // Assert: sshPort option stays "2222" (user set it, not overwritten)
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(features[featurePath].sshPort).toBe("2222");

    // Assert: forwardPorts and portsAttributes are auto-generated
    expect(extended.forwardPorts).toContain(port);
    expect(
      (extended.portsAttributes as Record<string, unknown>)?.[String(port)],
    ).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
      onAutoForward: "silent",
    });

    // Assert: port-assignments.json persisted
    const assignments = readPortAssignments(ctx);
    expect(assignments["wezterm-server/sshPort"].port).toBe(port);
  });
});

// ── S2: Auto-injection mode -- zero-config port allocation ──

describe("Scenario S2: auto-injection from feature metadata", () => {
  it("auto-injects sshPort template, allocates port, generates symmetric config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "wezterm-server");

    // Setup: devcontainer.json with NO explicit sshPort or appPort
    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    // Assert: port auto-injected and allocated
    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.exitCode).toBe(0);

    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);
    expect(port).toBeLessThanOrEqual(22499);

    // Assert: generated config has symmetric entries
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toContain(`${port}:${port}`);
    expect(extended.forwardPorts).toContain(port);

    // Assert: portsAttributes with onAutoForward from feature manifest
    expect(
      (extended.portsAttributes as Record<string, unknown>)?.[String(port)],
    ).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
      onAutoForward: "silent",
    });

    // Assert: feature option resolved to integer (auto-injected template)
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(features[featurePath].sshPort).toBe(port);

    // Assert: port-assignments.json persisted
    const assignments = readPortAssignments(ctx);
    expect(assignments["wezterm-server/sshPort"].port).toBe(port);
  });
});

// ── S3: Docker integration -- container starts with correct port mapping ──
// Uses asymmetric mapping: allocated host port maps to container port 2222
// where sshd actually listens (sshd defaults to 2222 inside the container).
//
// This test runs in two phases:
// Phase A: Run lace up with skipDevcontainerUp to get port allocation and
//   generate the config. Uses absolute feature paths for metadata resolution.
// Phase B: Rewrite the generated config with relative feature paths (the
//   devcontainer CLI rejects absolute paths), create symlinks in .lace/features/,
//   then invoke devcontainer up with the rewritten config.

describe.skipIf(!isDockerAvailable())(
  "Scenario S3: Docker integration -- SSH reachable on allocated port",
  { timeout: 180_000 },
  () => {
    let containerId: string | null = null;

    afterEach(() => {
      // Clean up by container ID if we captured it
      if (containerId) {
        stopContainer(containerId);
        containerId = null;
      }
      // Also clean up by workspace label as a fallback
      cleanupWorkspaceContainers(ctx.workspaceRoot);
    });

    it("starts container with generated config and SSH port is reachable", async () => {
      // Use copyLocalFeature instead of symlinkLocalFeature because the
      // devcontainer CLI's Docker build context does not follow symlinks.
      const featurePath = copyLocalFeature(ctx, "wezterm-server");

      // Use explicit asymmetric appPort: host's allocated port maps to
      // container's sshd default port (2222).
      const config = {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/devcontainers/features/sshd:1": {},
          [featurePath]: {
            sshPort: "2222",
          },
        },
        appPort: ["${lace.port(wezterm-server/sshPort)}:2222"],
      };

      writeDevcontainerJson(ctx, config);

      // Phase A: Run lace up for config generation only
      const result = await runUp({
        workspaceFolder: ctx.workspaceRoot,
        skipDevcontainerUp: true,
        cacheDir: ctx.metadataCacheDir,
      });

      expect(result.exitCode).toBe(0);
      const port = result.phases.portAssignment!.port!;
      expect(port).toBeGreaterThanOrEqual(22425);

      // Phase B: Prepare config for devcontainer CLI by copying the generated
      // config to .devcontainer/devcontainer.json with relative feature paths.
      // The devcontainer CLI does not support absolute paths or --config with
      // local features, so we must use the default config location.
      prepareGeneratedConfigForDocker(
        ctx,
        new Map([[featurePath, "wezterm-server"]]),
      );

      // Invoke devcontainer up (uses .devcontainer/devcontainer.json by default)
      try {
        const upOutput = execSync(
          `devcontainer up --workspace-folder "${ctx.workspaceRoot}"`,
          { stdio: "pipe", timeout: 120_000 },
        ).toString();

        // Extract container ID from devcontainer up output
        const parsed = JSON.parse(upOutput) as {
          outcome: string;
          containerId?: string;
        };
        if (parsed.containerId) {
          containerId = parsed.containerId;
        }
      } catch (err) {
        const error = err as { stderr?: Buffer; stdout?: Buffer };
        console.error(
          "devcontainer up failed:",
          error.stderr?.toString() ?? "",
        );
        console.error("stdout:", error.stdout?.toString() ?? "");
        throw new Error("devcontainer up failed in S3");
      }

      // Wait for SSH port to become reachable
      const reachable = await waitForPort(port, 15, 2000);
      expect(reachable).toBe(true);

      // Verify SSH banner (SSH servers respond with a version string)
      const banner = await getSshBanner(port);
      expect(banner).toMatch(/^SSH-/);
    });
  },
);

// ── S4: Port stability across restarts ──

describe("Scenario S4: port stability across lace up invocations", () => {
  it("reuses the same port on second invocation", async () => {
    const featurePath = symlinkLocalFeature(ctx, "wezterm-server");

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    // First invocation
    const result1 = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result1.exitCode).toBe(0);
    const port1 = result1.phases.portAssignment!.port!;

    // Clear metadata cache to force re-read (but port-assignments.json persists)
    clearMetadataCache(ctx.metadataCacheDir);

    // Second invocation (same workspace)
    const result2 = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result2.exitCode).toBe(0);
    const port2 = result2.phases.portAssignment!.port!;

    // Same port should be reused
    expect(port1).toBe(port2);
  });
});

// ── S5: Explicit sshPort value suppresses auto-injection ──

describe("Scenario S5: user sshPort value prevents auto-injection", () => {
  it("user-set sshPort is not overwritten, no port allocation occurs", async () => {
    const featurePath = symlinkLocalFeature(ctx, "wezterm-server");

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          sshPort: "3333",
        },
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.message).toContain(
      "No port templates found",
    );

    const extended = readGeneratedConfig(ctx);
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(features[featurePath].sshPort).toBe("3333");

    // No auto-generated appPort
    expect(extended.appPort).toBeUndefined();
    expect(extended.forwardPorts).toBeUndefined();
    expect(extended.portsAttributes).toBeUndefined();
  });
});

// ── S6: Version option unchanged by port system ──

describe("Scenario S6: non-port options unaffected", () => {
  it("version option passes through untouched while sshPort is auto-injected", async () => {
    const featurePath = symlinkLocalFeature(ctx, "wezterm-server");

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          version: "20240203-110809-5046fc22",
        },
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;

    // Version passes through untouched
    expect(features[featurePath].version).toBe(
      "20240203-110809-5046fc22",
    );

    // sshPort auto-injected (user did not set it) and resolved to integer
    expect(typeof features[featurePath].sshPort).toBe("number");

    // Port should be in the lace range
    const port = features[featurePath].sshPort as number;
    expect(port).toBeGreaterThanOrEqual(22425);
    expect(port).toBeLessThanOrEqual(22499);
  });
});
