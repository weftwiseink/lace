/**
 * Claude Code Feature Scenario Tests
 *
 * Integration tests that validate lace's mount auto-injection pipeline using
 * the real claude-code devcontainer feature as the integration target.
 *
 * The claude-code feature is mount-only (no port declarations), making it
 * architecturally distinct from wezterm-server (ports + mounts) and portless
 * (ports only). It declares a validated mount with sourceMustBe: "directory"
 * for persistent ~/.claude configuration.
 *
 * Scenarios C1-C3, C5-C8 use skipDevcontainerUp: true (config-generation only).
 * Scenario C4 (Docker integration) actually starts a container and is gated
 * by Docker availability.
 *
 * @see cdocs/proposals/2026-03-03-claude-code-feature-test-verification-plan.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runUp } from "@/lib/up";
import { clearMetadataCache } from "@/lib/feature-metadata";
import {
  createScenarioWorkspace,
  writeDevcontainerJson,
  symlinkLocalFeature,
  readGeneratedConfig,
  setupScenarioSettings,
  isDockerAvailable,
  copyLocalFeature,
  prepareGeneratedConfigForDocker,
  stopContainer,
  cleanupWorkspaceContainers,
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";
import type { RunSubprocess } from "@/lib/subprocess";
import { execSync } from "node:child_process";
import { getPodmanCommand } from "@/lib/container-runtime";

let ctx: ScenarioWorkspace;

beforeEach(() => {
  ctx = createScenarioWorkspace("claude-code");
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

// ── C1: Mount auto-injection from feature metadata ──

describe("Scenario C1: mount auto-injection from feature metadata", () => {
  it("auto-injects mount template for claude-code/config into mounts array", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    // Create a directory for sourceMustBe: "directory" validation
    const claudeDir = join(ctx.workspaceRoot, ".claude-home");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
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

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];

    // Assert: mounts array contains the auto-injected claude-code/config mount
    // Target should be resolved: image-based config with no remoteUser defaults to "root"
    expect(mounts).toBeDefined();
    const claudeMount = mounts.find((m) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();
    expect(claudeMount).toContain(`source=${claudeDir}`);
    expect(claudeMount).toContain("target=/home/root/.claude");
    expect(claudeMount).not.toContain("${_REMOTE_USER}");
    expect(claudeMount).toContain("type=bind");

    // Assert: no port allocation (claude-code declares no ports)
    expect(extended.appPort).toBeUndefined();
    expect(extended.forwardPorts).toBeUndefined();
    expect(extended.portsAttributes).toBeUndefined();
  });
});

// ── C2: Mount resolution with settings override ──

describe("Scenario C2: mount resolution with settings override", () => {
  it("uses settings override source instead of recommendedSource", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const customSource = join(ctx.workspaceRoot, "custom-claude-dir");
    mkdirSync(customSource, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: customSource },
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

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];
    const claudeMount = mounts.find((m) => m.includes("claude"));
    expect(claudeMount).toContain(`source=${customSource}`);
  });
});

// ── C3: sourceMustBe validation rejects missing source ──

describe("Scenario C3: sourceMustBe validation rejects missing source", () => {
  it("fails when source directory does not exist and settings point to nonexistent path", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    // Point settings override to a nonexistent directory to ensure
    // validation fails regardless of whether host ~/.claude exists.
    const nonexistentDir = join(ctx.workspaceRoot, "nonexistent-claude-dir");
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: nonexistentDir },
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

    // Expect validation failure -- source does not exist
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain("does not exist");
  });
});

// ── C4: Docker smoke test ──

describe.skipIf(!isDockerAvailable())(
  "Scenario C4: Docker smoke test -- claude installed and config dir exists",
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

    it("builds container with claude CLI and .claude directory", async () => {
      // Use copyLocalFeature (not symlink) because Docker build context
      // does not follow symlinks.
      const featurePath = copyLocalFeature(ctx, "claude-code");

      // Provide a source directory for the mount
      const claudeDir = join(ctx.workspaceRoot, ".claude-source");
      mkdirSync(claudeDir, { recursive: true });
      setupScenarioSettings(ctx, {
        mounts: {
          "claude-code/config": { source: claudeDir },
        },
      });

      // Use node base image (has npm preinstalled) to avoid feature
      // ordering issues -- claude-code install.sh requires npm.
      const config = {
        image: "node:24-bookworm",
        features: {
          [featurePath]: {},
        },
      };

      writeDevcontainerJson(ctx, config);

      // Phase A: Run lace up for config generation only
      const result = await runUp({
        workspaceFolder: ctx.workspaceRoot,
        skipDevcontainerUp: true,
        cacheDir: ctx.metadataCacheDir,
      });

      expect(result.exitCode).toBe(0);

      // Phase B: Prepare config for devcontainer CLI with relative paths
      prepareGeneratedConfigForDocker(
        ctx,
        new Map([[featurePath, "claude-code"]]),
      );

      // Invoke devcontainer up
      try {
        const upOutput = execSync(
          `devcontainer up --workspace-folder "${ctx.workspaceRoot}"`,
          { stdio: "pipe", timeout: 120_000 },
        ).toString();

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
        throw new Error("devcontainer up failed in C4");
      }

      // Verify claude is installed
      const claudeVersion = execSync(
        `${getPodmanCommand()} exec ${containerId} claude --version`,
        { stdio: "pipe", timeout: 10_000 },
      )
        .toString()
        .trim();
      expect(claudeVersion).toBeTruthy();
    });
  },
);

// NOTE(opus/test-health): C5 (claude-code + wezterm-server coexistence) removed.
// The wezterm-server feature was deleted in commit 7f6ca1d.

// ── C6: Version pinning passes through ──

describe("Scenario C6: version pinning passes through to feature options", () => {
  it("version option is preserved in generated config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          version: "1.0.20",
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
    expect(features[featurePath].version).toBe("1.0.20");
  });
});

// ── C7: Feature in prebuildFeatures ──

/**
 * Mock subprocess that succeeds for devcontainer build (prebuild phase)
 * and docker image inspect. Writes a minimal lock file to satisfy the
 * prebuild pipeline's post-build expectations.
 */
function createMockSubprocess(): RunSubprocess {
  return (command, args, _opts) => {
    if (command === "devcontainer") {
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
    // docker image inspect -- return success
    return { exitCode: 0, stdout: "[{}]", stderr: "" };
  };
}

describe("Scenario C7: claude-code in prebuildFeatures", () => {
  it("mount still auto-injected when feature is in prebuildFeatures", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

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

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];

    // Mount should be auto-injected even for prebuild features
    // (mounts are runtime config, not build-time)
    const claudeMount = mounts?.find((m) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();
    expect(claudeMount).toContain(`source=${claudeDir}`);
  });
});

// ── C8: Explicit mount suppresses auto-injection ──

describe("Scenario C8: explicit mount entry suppresses auto-injection", () => {
  it("user-written mount for claude-code/config prevents auto-injection duplicate", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
      mounts: ["${lace.mount(claude-code/config)}"],
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

    // Assert: the explicit claude-code/config mount should not be duplicated.
    // The config-json mount (targeting .claude.json) is a separate declaration
    // and is correctly auto-injected alongside the explicit config mount.
    const configMounts = mounts.filter(
      (m) => m.includes(".claude") && !m.includes(".claude.json"),
    );
    expect(configMounts).toHaveLength(1);
  });
});
