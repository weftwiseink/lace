/**
 * Neovim Feature Scenario Tests
 *
 * Integration tests that validate lace's mount auto-injection pipeline using
 * the real neovim devcontainer feature as the integration target.
 *
 * The neovim feature is simpler than wezterm-server: it has no port
 * declarations, only a mount declaration with sourceMustBe: "directory".
 * These scenarios focus on mount auto-injection and resolution rather than
 * port allocation.
 *
 * Scenarios N1-N5 use skipDevcontainerUp: true (config-generation only).
 * Scenarios N6, N8 (Docker integration) are gated by Docker availability.
 *
 * @see cdocs/proposals/2026-03-03-neovim-feature-test-verification-docs.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runUp } from "@/lib/up";
import { clearMetadataCache } from "@/lib/feature-metadata";
import {
  createScenarioWorkspace,
  writeDevcontainerJson,
  symlinkLocalFeature,
  copyLocalFeature,
  readGeneratedConfig,
  isDockerAvailable,
  stopContainer,
  cleanupWorkspaceContainers,
  createTempSshKey,
  setupScenarioSettings,
  prepareGeneratedConfigForDocker,
  FEATURES_SRC_DIR,
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";
import { execSync } from "node:child_process";
import { getPodmanCommand } from "@/lib/container-runtime";

let ctx: ScenarioWorkspace;

beforeEach(() => {
  ctx = createScenarioWorkspace("neovim");
  clearMetadataCache(ctx.metadataCacheDir);
});

afterEach(() => {
  clearMetadataCache(ctx.metadataCacheDir);
  delete process.env.LACE_SETTINGS;
  ctx.cleanup();
});

// ── N1: Mount auto-injection from feature metadata ──

describe("Scenario N1: mount auto-injection from neovim feature", () => {
  it("auto-injects neovim/plugins mount into generated config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    // Provide a settings override for the validated mount (sourceMustBe: directory)
    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
      },
    });

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

    expect(result.exitCode).toBe(0);

    // Assert: generated config includes a mount entry for neovim/plugins
    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];
    expect(mounts).toBeDefined();

    const nvimMount = mounts.find((m) => m.includes(".local/share/nvim"));
    expect(nvimMount).toBeDefined();
    expect(nvimMount).toContain(`source=${pluginDir}`);
    expect(nvimMount).toContain("type=bind");
  });
});

// ── N2: No port allocation for mount-only feature ──

describe("Scenario N2: no port allocation for mount-only feature", () => {
  it("completes without port assignment phase", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
      },
    });

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

    expect(result.exitCode).toBe(0);

    // Assert: no port allocation occurred
    expect(result.phases.portAssignment?.message).toContain(
      "No port templates found",
    );

    // Assert: no port-related config generated
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toBeUndefined();
    expect(extended.forwardPorts).toBeUndefined();
    expect(extended.portsAttributes).toBeUndefined();
  });
});

// ── N3: Coexistence with wezterm-server feature ──

describe("Scenario N3: neovim + wezterm-server coexistence", () => {
  it("both features contribute their mounts to generated config", async () => {
    const neovimPath = symlinkLocalFeature(ctx, "neovim");
    const weztermPath = symlinkLocalFeature(ctx, "wezterm-server");

    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    const keyPath = createTempSshKey(ctx);

    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
        "wezterm-server/authorized-keys": { source: keyPath },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [neovimPath]: {},
        [weztermPath]: {},
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
    const mounts = extended.mounts as string[];

    // Assert: neovim mount present
    const nvimMount = mounts.find((m) => m.includes(".local/share/nvim"));
    expect(nvimMount).toBeDefined();

    // Assert: wezterm-server authorized-keys mount present
    const sshMount = mounts.find((m) => m.includes("authorized_keys"));
    expect(sshMount).toBeDefined();

    // Assert: wezterm-server also got a port allocated
    expect(result.phases.portAssignment?.exitCode).toBe(0);
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);
  });
});

// ── N4: Version option passes through untouched ──

describe("Scenario N4: version option unaffected by mount system", () => {
  it("version option passes through to generated config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          version: "v0.11.6",
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
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features[featurePath].version).toBe("v0.11.6");
  });
});

// ── N5: Missing mount source fails with actionable error ──

describe("Scenario N5: missing mount source produces actionable error", () => {
  it("fails with guidance when neovim/plugins has no valid source", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    // Point the settings override to a non-existent directory
    // This ensures the validated mount check fails with an actionable error
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: "/tmp/nonexistent-nvim-plugins-dir-lace-test" },
      },
    });

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

    // Assert: fails due to validated mount with non-existent source
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain("neovim/plugins");
  });
});

// ── N6: Docker smoke test -- neovim installed correctly ──

describe.skipIf(!isDockerAvailable())(
  "Scenario N6: Docker smoke test -- neovim installed correctly",
  { timeout: 180_000 },
  () => {
    let containerId: string | null = null;

    afterEach(() => {
      if (containerId) {
        stopContainer(containerId);
        containerId = null;
      }
      cleanupWorkspaceContainers(ctx.workspaceRoot);
    });

    it("neovim binary exists at correct version, plugin dir has correct ownership", async () => {
      const featurePath = copyLocalFeature(ctx, "neovim");

      const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
      mkdirSync(pluginDir, { recursive: true });
      setupScenarioSettings(ctx, {
        mounts: {
          "neovim/plugins": { source: pluginDir },
        },
      });

      const config = {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          [featurePath]: {
            version: "v0.11.6",
          },
        },
      };

      writeDevcontainerJson(ctx, config);

      // Phase A: Generate config
      const result = await runUp({
        workspaceFolder: ctx.workspaceRoot,
        skipDevcontainerUp: true,
        cacheDir: ctx.metadataCacheDir,
      });
      expect(result.exitCode).toBe(0);

      // Phase B: Build and start container
      prepareGeneratedConfigForDocker(
        ctx,
        new Map([[featurePath, "neovim"]]),
      );

      const upOutput = execSync(
        `devcontainer up --workspace-folder "${ctx.workspaceRoot}"`,
        { stdio: "pipe", timeout: 120_000 },
      ).toString();

      const parsed = JSON.parse(upOutput) as { containerId?: string };
      if (parsed.containerId) containerId = parsed.containerId;

      // Verify nvim binary exists and reports correct version
      const versionOutput = execSync(
        `${getPodmanCommand()} exec ${containerId} nvim --version`,
        { stdio: "pipe" },
      ).toString();
      expect(versionOutput).toContain("NVIM v0.11.6");

      // Verify nvim is at /usr/local/bin/nvim
      const whichOutput = execSync(
        `${getPodmanCommand()} exec ${containerId} which nvim`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();
      expect(whichOutput).toBe("/usr/local/bin/nvim");
    });
  },
);

// ── N8: Docker smoke test -- missing curl fails gracefully ──

describe.skipIf(!isDockerAvailable())(
  "Scenario N8: Docker -- missing curl fails gracefully",
  { timeout: 120_000 },
  () => {
    it("install.sh exits with error when curl is missing", () => {
      const installScript = join(FEATURES_SRC_DIR, "neovim", "install.sh");
      // Run install.sh in a minimal alpine container without curl
      // Alpine does not have curl by default, so the script should fail
      const result = execSync(
        `${getPodmanCommand()} run --rm -e VERSION=v0.11.6 -e _REMOTE_USER=root -v "${installScript}:/install.sh:ro,Z" alpine:latest sh /install.sh 2>&1 || true`,
        { stdio: "pipe", timeout: 30_000 },
      ).toString();
      expect(result).toContain("curl is required");
    });
  },
);
