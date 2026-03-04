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
  createTempSshKey,
  type ScenarioWorkspace,
} from "./helpers/scenario-utils";
import type { RunSubprocess } from "@/lib/subprocess";
import { execSync } from "node:child_process";

let ctx: ScenarioWorkspace;

beforeEach(() => {
  ctx = createScenarioWorkspace("claude-code");
  clearMetadataCache(ctx.metadataCacheDir);
});

afterEach(() => {
  clearMetadataCache(ctx.metadataCacheDir);
  delete process.env.LACE_SETTINGS;
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
    expect(mounts).toBeDefined();
    const claudeMount = mounts.find((m) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();
    expect(claudeMount).toContain(`source=${claudeDir}`);
    expect(claudeMount).toContain("target=/home/${_REMOTE_USER}/.claude");
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
