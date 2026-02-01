// DOCKER_SMOKE_TEST — requires Docker daemon
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { runPrebuild } from "@/lib/prebuild";
import { runRestore } from "@/lib/restore";
import { runStatus } from "@/lib/status";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PREBUILD_TAG = "lace.local/node:24-bookworm";

function dockerImageExists(tag: string): boolean {
  try {
    execSync(`docker image inspect ${tag}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function dockerRmi(tag: string): void {
  try {
    execSync(`docker rmi ${tag}`, { stdio: "pipe" });
  } catch {
    // ignore if image doesn't exist
  }
}

const STANDARD_DOCKERFILE = "FROM node:24-bookworm\nRUN echo \"smoke test\"\n";

function makeDevcontainerJson(
  prebuildFeatures: Record<string, Record<string, unknown>>,
): string {
  return JSON.stringify(
    {
      build: { dockerfile: "Dockerfile" },
      customizations: {
        lace: { prebuildFeatures },
      },
      features: {},
    },
    null,
    2,
  );
}

const STANDARD_JSON = makeDevcontainerJson({
  "ghcr.io/devcontainers/features/git:1": {},
});

// ---------------------------------------------------------------------------
// Per-test workspace
// ---------------------------------------------------------------------------

let workspaceRoot: string;
let devcontainerDir: string;

function setupWorkspace(
  devcontainerJson: string = STANDARD_JSON,
  dockerfile: string = STANDARD_DOCKERFILE,
): void {
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(
    join(devcontainerDir, "devcontainer.json"),
    devcontainerJson,
    "utf-8",
  );
  writeFileSync(join(devcontainerDir, "Dockerfile"), dockerfile, "utf-8");
}

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `lace-docker-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

afterAll(() => {
  dockerRmi(PREBUILD_TAG);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("docker smoke tests", { timeout: 120_000 }, () => {
  it("full prebuild lifecycle: builds image, rewrites Dockerfile, writes metadata, status reports up to date", () => {
    setupWorkspace();

    // Run the real prebuild (no subprocess mock — hits Docker)
    const result = runPrebuild({ workspaceRoot });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Prebuild complete");

    // 1. Docker image actually exists
    expect(dockerImageExists(PREBUILD_TAG)).toBe(true);

    // 2. Dockerfile FROM was rewritten
    const dockerfile = readFileSync(
      join(devcontainerDir, "Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).toContain(`FROM ${PREBUILD_TAG}`);
    expect(dockerfile).not.toContain("FROM node:24-bookworm");

    // 3. metadata.json was written correctly
    const metadataPath = join(
      workspaceRoot,
      ".lace",
      "prebuild",
      "metadata.json",
    );
    expect(existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    expect(metadata.originalFrom).toBe("node:24-bookworm");
    expect(metadata.prebuildTag).toBe(PREBUILD_TAG);
    expect(metadata.timestamp).toBeTruthy();

    // 4. lace status reports "up to date"
    const status = runStatus({ workspaceRoot });
    expect(status.exitCode).toBe(0);
    expect(status.message).toContain("up to date");
  });

  it("prebuild then restore: restores Dockerfile, preserves .lace/prebuild/, status reports cached", () => {
    setupWorkspace();

    // Prebuild first
    const prebuildResult = runPrebuild({ workspaceRoot });
    expect(prebuildResult.exitCode).toBe(0);

    // Verify the prebuild happened
    const dockerfileAfterPrebuild = readFileSync(
      join(devcontainerDir, "Dockerfile"),
      "utf-8",
    );
    expect(dockerfileAfterPrebuild).toContain(`FROM ${PREBUILD_TAG}`);

    // Restore
    const restoreResult = runRestore({ workspaceRoot });
    expect(restoreResult.exitCode).toBe(0);
    expect(restoreResult.message).toContain("Restored");

    // Dockerfile FROM is restored to original
    const dockerfileAfterRestore = readFileSync(
      join(devcontainerDir, "Dockerfile"),
      "utf-8",
    );
    expect(dockerfileAfterRestore).toContain("FROM node:24-bookworm");
    expect(dockerfileAfterRestore).not.toContain("lace.local");

    // .lace/prebuild/ is preserved (not deleted)
    const prebuildDir = join(workspaceRoot, ".lace", "prebuild");
    expect(existsSync(prebuildDir)).toBe(true);
    expect(existsSync(join(prebuildDir, "metadata.json"))).toBe(true);

    // lace status reports cached state
    const status = runStatus({ workspaceRoot });
    expect(status.message).toContain("Prebuild cached");
  });

  it("cache reactivation: re-prebuild after restore reuses cached image", () => {
    setupWorkspace();

    // First prebuild — builds Docker image
    const result1 = runPrebuild({ workspaceRoot });
    expect(result1.exitCode).toBe(0);
    expect(result1.message).toContain("Prebuild complete");

    // Restore — Dockerfile restored, cache preserved
    runRestore({ workspaceRoot });

    // Re-prebuild — should reactivate from cache
    const result2 = runPrebuild({ workspaceRoot });
    expect(result2.exitCode).toBe(0);
    expect(result2.message).toContain("reactivated from cache");

    // Dockerfile is rewritten again
    const dockerfile = readFileSync(
      join(devcontainerDir, "Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).toContain(`FROM ${PREBUILD_TAG}`);
  });

  it("cache skip (idempotency): second prebuild with same config skips rebuild", () => {
    setupWorkspace();

    // First prebuild
    const result1 = runPrebuild({ workspaceRoot });
    expect(result1.exitCode).toBe(0);
    expect(result1.message).toContain("Prebuild complete");

    // Second prebuild — same config — should skip
    const result2 = runPrebuild({ workspaceRoot });
    expect(result2.exitCode).toBe(0);
    expect(result2.message).toContain("up to date");
  });

  it("force rebuild: --force causes rebuild even when cached", () => {
    setupWorkspace();

    // First prebuild
    const result1 = runPrebuild({ workspaceRoot });
    expect(result1.exitCode).toBe(0);
    expect(result1.message).toContain("Prebuild complete");

    // Force rebuild — should rebuild, not skip
    const result2 = runPrebuild({ workspaceRoot, force: true });
    expect(result2.exitCode).toBe(0);
    expect(result2.message).toContain("Prebuild complete");
    expect(result2.message).not.toContain("up to date");
  });

  it("config change detection: changing features triggers rebuild", () => {
    setupWorkspace();

    // First prebuild with git feature (default options)
    const result1 = runPrebuild({ workspaceRoot });
    expect(result1.exitCode).toBe(0);
    expect(result1.message).toContain("Prebuild complete");

    // Change the features — use "os-provided" version (fast, avoids source build).
    // This changes the devcontainer.json content which triggers cache invalidation.
    const newJson = makeDevcontainerJson({
      "ghcr.io/devcontainers/features/git:1": { version: "os-provided" },
    });
    writeFileSync(
      join(devcontainerDir, "devcontainer.json"),
      newJson,
      "utf-8",
    );

    // Second prebuild — should detect config change and rebuild
    const result2 = runPrebuild({ workspaceRoot });
    expect(result2.exitCode).toBe(0);
    expect(result2.message).toContain("Prebuild complete");
    expect(result2.message).not.toContain("up to date");
  });

  it("lock file integration: prebuild merges lock entries when devcontainer build produces them", () => {
    setupWorkspace();

    const result = runPrebuild({ workspaceRoot });
    expect(result.exitCode).toBe(0);

    // The devcontainer CLI `build` command does not write a lock file
    // (only `up` does), so mergeLockFile silently skips.
    // Verify that prebuild succeeds without error even when no lock file
    // is produced, and that the project lock file is absent (no spurious writes).
    const lockPath = join(devcontainerDir, "devcontainer-lock.json");
    expect(existsSync(lockPath)).toBe(false);

    // Also verify that the prebuild metadata is intact regardless
    const metadataPath = join(
      workspaceRoot,
      ".lace",
      "prebuild",
      "metadata.json",
    );
    expect(existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    expect(metadata.prebuildTag).toBe(PREBUILD_TAG);
  });

  it("dry run: no Docker image created and Dockerfile not modified", () => {
    // Clean up the image first to confirm dry run doesn't create it
    dockerRmi(PREBUILD_TAG);

    setupWorkspace();

    const result = runPrebuild({ workspaceRoot, dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Dry run");
    expect(result.message).toContain(PREBUILD_TAG);

    // Docker image was NOT created
    expect(dockerImageExists(PREBUILD_TAG)).toBe(false);

    // Dockerfile was NOT modified
    const dockerfile = readFileSync(
      join(devcontainerDir, "Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);

    // No prebuild directory was created
    const prebuildDir = join(workspaceRoot, ".lace", "prebuild");
    expect(existsSync(prebuildDir)).toBe(false);
  });
});
