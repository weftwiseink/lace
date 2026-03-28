// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runUp } from "@/lib/up";
import type { RunSubprocess } from "@/lib/subprocess";
import { clearMetadataCache } from "@/lib/feature-metadata";
import { clearClassificationCache } from "@/lib/workspace-detector";
import { resetPodmanCommandCache } from "@/lib/container-runtime";

let workspaceRoot: string;
let devcontainerDir: string;
let metadataCacheDir: string;
let mockCalls: Array<{ command: string; args: string[]; cwd?: string }>;

function createMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });
    return { exitCode: 0, stdout: '{"imageName":["test"]}', stderr: "" };
  };
}

function setupWorkspace(devcontainerJson: string) {
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(
    join(devcontainerDir, "devcontainer.json"),
    devcontainerJson,
    "utf-8",
  );
}

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `lace-test-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  metadataCacheDir = join(workspaceRoot, ".metadata-cache");
  mockCalls = [];
  mkdirSync(workspaceRoot, { recursive: true });
  clearMetadataCache(metadataCacheDir);
  clearClassificationCache();
  resetPodmanCommandCache();

  const userConfigPath = join(workspaceRoot, ".user-config.json");
  writeFileSync(userConfigPath, "{}", "utf-8");
  process.env.LACE_USER_CONFIG = userConfigPath;

  const settingsDir = join(workspaceRoot, ".config", "lace");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, "settings.json"), "{}", "utf-8");
  process.env.LACE_SETTINGS = join(settingsDir, "settings.json");
});

afterEach(() => {
  clearMetadataCache(metadataCacheDir);
  resetPodmanCommandCache();
  rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env.LACE_USER_CONFIG;
  delete process.env.LACE_SETTINGS;
});

describe("lace validate (via runUp with validateOnly)", () => {
  it("valid workspace returns exit code 0 and validation passed message", async () => {
    setupWorkspace(
      JSON.stringify({ image: "node:24-bookworm" }),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      validateOnly: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toBe("Validation passed.");
  });

  it("workspace with missing bind mount source returns exit code 1", async () => {
    setupWorkspace(
      JSON.stringify({
        image: "node:24-bookworm",
        mounts: [
          "source=/nonexistent/path/validate/test,target=/mnt/data,type=bind",
        ],
      }),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      validateOnly: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Bind mount source(s) do not exist on host");
    expect(result.phases.mountValidation).toBeDefined();
  });

  it("validateOnly: true skips prebuild phase", async () => {
    setupWorkspace(
      JSON.stringify({
        image: "node:24-bookworm",
        build: { dockerfile: "Dockerfile" },
        customizations: {
          lace: {
            prebuildFeatures: {
              "ghcr.io/example/feature:1": {},
            },
          },
        },
      }),
    );
    // Write a Dockerfile so config parsing doesn't fail
    writeFileSync(join(devcontainerDir, "Dockerfile"), "FROM node:24-bookworm", "utf-8");

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      validateOnly: true,
      cacheDir: metadataCacheDir,
      skipMetadataValidation: true,
    });

    // Should pass without running prebuild
    expect(result.exitCode).toBe(0);
    expect(result.phases.prebuild).toBeUndefined();
    // No devcontainer build call should have been made
    const buildCalls = mockCalls.filter(c => c.command === "devcontainer" && c.args[0] === "build");
    expect(buildCalls.length).toBe(0);
  });

  it("returns logPath for the validate run", async () => {
    setupWorkspace(
      JSON.stringify({ image: "node:24-bookworm" }),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      validateOnly: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.logPath).toBeDefined();
    expect(existsSync(result.logPath!)).toBe(true);
  });

  it("generates extended config even in validate mode", async () => {
    setupWorkspace(
      JSON.stringify({ image: "node:24-bookworm" }),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      validateOnly: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.generateConfig).toBeDefined();
    expect(result.phases.generateConfig!.exitCode).toBe(0);
    expect(existsSync(join(workspaceRoot, ".lace", "devcontainer.json"))).toBe(true);
  });
});
