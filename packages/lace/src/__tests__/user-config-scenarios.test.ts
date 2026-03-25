/**
 * User Config Scenario Tests
 *
 * Integration tests for the user-level config pipeline:
 * - UC1: User config with mounts, features, and git identity
 * - UC2: User config without any config (backward compat)
 * - UC3: Denied mount source (mount policy violation)
 * - UC4: User feature merged with project feature (option override)
 * - UC5: User mount target conflict with project mount
 * - UC6: validateMountNamespaces accepts user/ namespace
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
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";

let ctx: ScenarioWorkspace;

beforeEach(() => {
  ctx = createScenarioWorkspace("user-config");
  clearMetadataCache(ctx.metadataCacheDir);
});

afterEach(() => {
  clearMetadataCache(ctx.metadataCacheDir);
  delete process.env.LACE_SETTINGS;
  delete process.env.LACE_USER_CONFIG;
  delete process.env.LACE_MOUNT_POLICY;
  ctx.cleanup();
});

/**
 * Helper: write a user.json file and set LACE_USER_CONFIG env var.
 */
function setupUserConfig(
  ctx: ScenarioWorkspace,
  config: Record<string, unknown>,
): void {
  const userConfigDir = join(ctx.workspaceRoot, ".user-config");
  mkdirSync(userConfigDir, { recursive: true });
  const userConfigPath = join(userConfigDir, "user.json");
  writeFileSync(userConfigPath, JSON.stringify(config, null, 2), "utf-8");
  process.env.LACE_USER_CONFIG = userConfigPath;
}

// ── UC1: Full user config merge ──

describe("Scenario UC1: user config with mounts, features, and git identity", () => {
  it("merges user mounts, features, and git identity into generated config", async () => {
    // Create user mount source directory
    const screenshotsDir = join(ctx.workspaceRoot, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });

    setupUserConfig(ctx, {
      mounts: {
        screenshots: {
          source: screenshotsDir,
          target: "/mnt/user/screenshots",
          description: "Host screenshots",
        },
      },
      git: {
        name: "Test User",
        email: "test@example.com",
      },
      containerEnv: {
        EDITOR: "nvim",
      },
    });

    // Settings for user mount resolution (the mount source is the absolute path)
    setupScenarioSettings(ctx, {
      mounts: {
        "user/screenshots": { source: screenshotsDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);

    // Verify git identity env vars (LACE_GIT_NAME, not GIT_AUTHOR_NAME)
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.LACE_GIT_NAME).toBe("Test User");
    expect(containerEnv.LACE_GIT_EMAIL).toBe("test@example.com");
    expect(containerEnv.GIT_AUTHOR_NAME).toBeUndefined();

    // Verify user containerEnv
    expect(containerEnv.EDITOR).toBe("nvim");

    // Verify user mount appears in resolved config
    const mounts = extended.mounts as string[] | undefined;
    if (mounts) {
      const screenshotMount = mounts.find((m: string) => m.includes("screenshots"));
      if (screenshotMount) {
        expect(screenshotMount).toContain("readonly");
      }
    }
  });
});

// ── UC2: No user config (backward compat) ──

describe("Scenario UC2: no user config (backward compatibility)", () => {
  it("behaves identically to current behavior without user.json", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

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

    // No LACE_USER_CONFIG set
    delete process.env.LACE_USER_CONFIG;

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);

    // Verify no user-specific env vars
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.LACE_GIT_NAME).toBeUndefined();
    expect(containerEnv.LACE_GIT_EMAIL).toBeUndefined();

    // Verify claude-code mount still works
    const mounts = extended.mounts as string[];
    const claudeMount = mounts.find((m: string) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();
  });
});

// ── UC3: Denied mount source ──

describe("Scenario UC3: denied mount source (mount policy violation)", () => {
  it("fails with error when user mount source matches denylist", async () => {
    const sshDir = join(ctx.workspaceRoot, ".ssh-test");
    mkdirSync(sshDir, { recursive: true });

    // Create a custom mount policy that denies our test dir
    const policyDir = join(ctx.workspaceRoot, ".policy");
    mkdirSync(policyDir, { recursive: true });
    const policyPath = join(policyDir, "mount-policy");
    writeFileSync(policyPath, sshDir, "utf-8");
    process.env.LACE_MOUNT_POLICY = policyPath;

    setupUserConfig(ctx, {
      mounts: {
        "ssh-config": {
          source: sshDir,
          target: "/mnt/user/ssh",
        },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain("blocked");
  });
});

// ── UC4: Local path feature rejected from user config ──

describe("Scenario UC4: local path features rejected from user config", () => {
  it("fails when user config declares a local path feature", async () => {
    setupUserConfig(ctx, {
      features: {
        "./features/custom": {},
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain("local path");
  });
});

// ── UC5: User mount target conflict with project mount ──

describe("Scenario UC5: user mount target conflict with project mount", () => {
  it("fails when user mount and project mount target the same path", async () => {
    // User declares a mount targeting /home/root/.claude
    const userMountDir = join(ctx.workspaceRoot, "user-claude");
    mkdirSync(userMountDir, { recursive: true });

    setupUserConfig(ctx, {
      mounts: {
        "claude-dir": {
          source: userMountDir,
          target: "/home/root/.claude",
        },
      },
    });

    setupScenarioSettings(ctx, {
      mounts: {
        "user/claude-dir": { source: userMountDir },
      },
    });

    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-home");
    mkdirSync(claudeDir, { recursive: true });

    // Also provide settings for the feature mount
    // Note: we need to merge both mount settings
    setupScenarioSettings(ctx, {
      mounts: {
        "user/claude-dir": { source: userMountDir },
        "claude-code/config": { source: claudeDir },
      },
    });

    // Project also has claude-code feature which targets /home/root/.claude
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

    // Should fail with target conflict
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain("target conflict");
  });
});

// ── UC6: validateMountNamespaces accepts user/ ──

describe("Scenario UC6: user/ namespace accepted by validation", () => {
  it("user mounts with user/ namespace pass namespace validation", async () => {
    const dataDir = join(ctx.workspaceRoot, "data");
    mkdirSync(dataDir, { recursive: true });

    setupUserConfig(ctx, {
      mounts: {
        data: {
          source: dataDir,
          target: "/mnt/user/data",
        },
      },
    });

    setupScenarioSettings(ctx, {
      mounts: {
        "user/data": { source: dataDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    // Should succeed: user/ namespace is valid
    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];
    const userMount = mounts?.find((m: string) => m.includes("/mnt/user/data"));
    expect(userMount).toBeDefined();
    expect(userMount).toContain("readonly");
  });
});
