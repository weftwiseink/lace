/**
 * Lace Fundamentals Feature Scenario Tests
 *
 * Integration tests for the lace-fundamentals devcontainer feature:
 * - F1: Fundamentals with user.json (git identity, defaultShell, postCreateCommand)
 * - F2: Fundamentals without user.json (graceful degradation)
 * - F3: Feature metadata validation (dependsOn, mounts)
 * - F4: postCreateCommand auto-injection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
  ctx = createScenarioWorkspace("fundamentals");
  clearMetadataCache(ctx.metadataCacheDir);
  // Isolate from host user config to prevent ~/.config/lace/user.json leaking
  // features, git identity, and mounts that the test mocks don't handle.
  // Tests that need a user config call setupUserConfig() which overrides this.
  const userConfigPath = join(ctx.workspaceRoot, ".user-config.json");
  writeFileSync(userConfigPath, "{}", "utf-8");
  process.env.LACE_USER_CONFIG = userConfigPath;
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

// ── F1: Fundamentals with user.json ──

/**
 * Helper: create sources for all lace-fundamentals mounts and configure settings.
 */
function setupFundamentalsMounts(ctx: ScenarioWorkspace): void {
  const dotfilesDir = join(ctx.workspaceRoot, "dotfiles-repo");
  mkdirSync(dotfilesDir, { recursive: true });
  const screenshotsDir = join(ctx.workspaceRoot, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });

  setupScenarioSettings(ctx, {
    mounts: {
      "lace-fundamentals/dotfiles": { source: dotfilesDir },
      "lace-fundamentals/screenshots": { source: screenshotsDir },
    },
  });
}

describe("Scenario F1: fundamentals with user.json", () => {
  it("generates config with git identity env vars and fundamentals feature", async () => {
    const featurePath = symlinkLocalFeature(ctx, "lace-fundamentals");
    setupFundamentalsMounts(ctx);

    setupUserConfig(ctx, {
      git: {
        name: "Test User",
        email: "test@example.com",
      },
      defaultShell: "/usr/bin/nu",
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

    // Verify git identity uses LACE_GIT_NAME, NOT GIT_AUTHOR_NAME
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.LACE_GIT_NAME).toBe("Test User");
    expect(containerEnv.LACE_GIT_EMAIL).toBe("test@example.com");
    expect(containerEnv.GIT_AUTHOR_NAME).toBeUndefined();

    // Verify feature is present with defaultShell injected
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features[featurePath]).toBeDefined();
    expect(features[featurePath].defaultShell).toBe("/usr/bin/nu");

  });
});

// ── F2: Fundamentals without user.json ──

describe("Scenario F2: fundamentals without user.json", () => {
  it("works without user.json: no git env vars, feature still present", async () => {
    const featurePath = symlinkLocalFeature(ctx, "lace-fundamentals");
    setupFundamentalsMounts(ctx);

    // Simulate "no user config": LACE_USER_CONFIG points to empty {} file
    // (written by beforeEach). We cannot simply delete the env var because
    // the host may have ~/.config/lace/user.json which would leak into tests.

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

    // No git identity env vars
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.LACE_GIT_NAME).toBeUndefined();
    expect(containerEnv.LACE_GIT_EMAIL).toBeUndefined();

    // Feature is present
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features[featurePath]).toBeDefined();
  });
});

// ── F3: Feature metadata validation ──

describe("Scenario F3: feature metadata validation", () => {
  it("feature metadata declares correct mounts and dependsOn", () => {
    // Read the actual feature metadata directly
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const featureSourceDir = join(
      currentDir,
      "..",
      "..",
      "..",
      "..",
      "devcontainers",
      "features",
      "src",
      "lace-fundamentals",
    );
    const metadata = JSON.parse(
      readFileSync(join(featureSourceDir, "devcontainer-feature.json"), "utf-8"),
    );

    // Verify identity
    expect(metadata.id).toBe("lace-fundamentals");
    expect(metadata.version).toBe("2.0.0");

    // Verify dependsOn: git only (sshd removed in v2.0.0)
    expect(metadata.dependsOn).toBeDefined();
    expect(metadata.dependsOn["ghcr.io/devcontainers/features/git:1"]).toBeDefined();
    expect(metadata.dependsOn["ghcr.io/devcontainers/features/sshd:1"]).toBeUndefined();

    // Verify options: defaultShell only (sshPort, enableSshHardening removed in v2.0.0)
    expect(metadata.options.defaultShell).toBeDefined();
    expect(metadata.options.sshPort).toBeUndefined();
    expect(metadata.options.enableSshHardening).toBeUndefined();

    // Verify no lace port declarations (removed in v2.0.0)
    expect(metadata.customizations.lace.ports).toBeUndefined();

    // Verify lace mount declarations: dotfiles and screenshots only (authorized-keys removed)
    const laceMounts = metadata.customizations.lace.mounts;
    expect(laceMounts["authorized-keys"]).toBeUndefined();
    expect(laceMounts.dotfiles).toBeDefined();
    expect(laceMounts.dotfiles.target).toBe("/mnt/lace/repos/dotfiles");
    expect(laceMounts.screenshots).toBeDefined();
    expect(laceMounts.screenshots.target).toBe("/mnt/lace/screenshots");
    expect(laceMounts.screenshots.readonly).toBe(true);
  });
});

// ── F3.5: LACE_DOTFILES_PATH injection ──

describe("Scenario F3.5: LACE_DOTFILES_PATH containerEnv injection", () => {
  it("injects LACE_DOTFILES_PATH matching the dotfiles mount target", async () => {
    const featurePath = symlinkLocalFeature(ctx, "lace-fundamentals");
    setupFundamentalsMounts(ctx);

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
    const containerEnv = extended.containerEnv as Record<string, string>;

    expect(containerEnv.LACE_DOTFILES_PATH).toBeDefined();
    expect(containerEnv.LACE_DOTFILES_PATH).toBe("/mnt/lace/repos/dotfiles");
  });

  it("does not override LACE_DOTFILES_PATH if already set in containerEnv", async () => {
    const featurePath = symlinkLocalFeature(ctx, "lace-fundamentals");
    setupFundamentalsMounts(ctx);

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
      containerEnv: {
        LACE_DOTFILES_PATH: "/custom/dotfiles/path",
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
    const containerEnv = extended.containerEnv as Record<string, string>;

    expect(containerEnv.LACE_DOTFILES_PATH).toBe("/custom/dotfiles/path");
  });
});

// ── F4: postCreateCommand auto-injection ──

describe("Scenario F4: postCreateCommand auto-injection", () => {
  it("auto-injects lace-fundamentals-init into postCreateCommand", async () => {
    const featurePath = symlinkLocalFeature(ctx, "lace-fundamentals");
    setupFundamentalsMounts(ctx);

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

    // postCreateCommand should include lace-fundamentals-init regardless of format
    const postCreateCommand = extended.postCreateCommand;
    expect(postCreateCommand).toBeDefined();
    const serialized = JSON.stringify(postCreateCommand);
    expect(serialized).toContain("lace-fundamentals-init");
  });

  it("composes with existing postCreateCommand string", async () => {
    const featurePath = symlinkLocalFeature(ctx, "lace-fundamentals");
    setupFundamentalsMounts(ctx);

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
      postCreateCommand: "echo 'hello'",
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const postCreateCommand = extended.postCreateCommand;

    // Should have both the original command and the init script regardless of format
    expect(postCreateCommand).toBeDefined();
    const serialized = JSON.stringify(postCreateCommand);
    expect(serialized).toContain("echo 'hello'");
    expect(serialized).toContain("lace-fundamentals-init");
  });
});
