// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrebuild } from "@/lib/prebuild";
import { runRestore } from "@/lib/restore";
import { runStatus } from "@/lib/status";
import type { RunSubprocess } from "@/lib/subprocess";

let workspaceRoot: string;
let devcontainerDir: string;

function createMock(): RunSubprocess {
  return (command, args) => {
    // Non-devcontainer commands (e.g. docker image inspect) — return success without side effects
    if (command !== "devcontainer") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    const wsFolder = args[args.indexOf("--workspace-folder") + 1];
    if (wsFolder) {
      writeFileSync(
        join(wsFolder, "devcontainer-lock.json"),
        JSON.stringify({
          features: {
            "ghcr.io/anthropics/devcontainer-features/claude-code:1": {
              version: "1.0.5",
              resolved: "ghcr.io/anthropics/devcontainer-features/claude-code@sha256:abc",
              integrity: "sha256:abc",
            },
          },
        }, null, 2),
        "utf-8",
      );
    }
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
}

const STANDARD_JSON = JSON.stringify({
  build: { dockerfile: "Dockerfile" },
  customizations: {
    lace: {
      prebuildFeatures: {
        "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
      },
    },
  },
  features: {
    "ghcr.io/devcontainers/features/git:1": {},
  },
}, null, 2);

const STANDARD_DOCKERFILE = "FROM node:24-bookworm\nRUN apt-get update\n";

function setupWorkspace(
  devcontainerJson: string = STANDARD_JSON,
  dockerfile: string = STANDARD_DOCKERFILE,
) {
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(join(devcontainerDir, "devcontainer.json"), devcontainerJson, "utf-8");
  writeFileSync(join(devcontainerDir, "Dockerfile"), dockerfile, "utf-8");
}

beforeEach(() => {
  workspaceRoot = join(tmpdir(), `lace-test-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("e2e: full lifecycle", () => {
  it("prebuild → status (active) → restore → status (cached)", () => {
    setupWorkspace();
    const mock = createMock();

    // Prebuild
    const prebuildResult = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(prebuildResult.exitCode).toBe(0);

    const dockerfile1 = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile1).toContain("FROM lace.local/node:24-bookworm");

    // Status shows active
    const status1 = runStatus({ workspaceRoot });
    expect(status1.message).toContain("Prebuild active");
    expect(status1.message).toContain("up to date");

    // Restore
    const restoreResult = runRestore({ workspaceRoot });
    expect(restoreResult.exitCode).toBe(0);

    const dockerfile2 = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile2).toBe(STANDARD_DOCKERFILE);

    // .lace/prebuild/ preserved after restore
    const prebuildDir = join(workspaceRoot, ".lace", "prebuild");
    expect(existsSync(prebuildDir)).toBe(true);

    // Status shows cached (not deleted)
    const status2 = runStatus({ workspaceRoot });
    expect(status2.message).toContain("Prebuild cached");
    expect(status2.message).toContain("restored");
  });
});

describe("e2e: prebuild → modify config → prebuild → restore", () => {
  it("handles config changes across prebuild cycles", () => {
    setupWorkspace();
    const mock = createMock();

    // First prebuild
    runPrebuild({ workspaceRoot, subprocess: mock });
    let dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

    // Modify config
    const newJson = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weft/devcontainer-features/wezterm-server:1": {},
          },
        },
      },
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
    }, null, 2);
    writeFileSync(join(devcontainerDir, "devcontainer.json"), newJson, "utf-8");

    // Status shows stale
    const status = runStatus({ workspaceRoot });
    expect(status.message).toContain("config changed");

    // Second prebuild
    const result2 = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result2.exitCode).toBe(0);
    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

    // Restore
    runRestore({ workspaceRoot });
    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);
  });
});

describe("e2e: prebuild → restore → prebuild (cache reactivation)", () => {
  it("re-prebuild after restore reactivates from cache without rebuild", () => {
    setupWorkspace();
    const mock = createMock();
    let mockCallCount = 0;
    const countingMock: RunSubprocess = (command, args, opts) => {
      mockCallCount++;
      return mock(command, args, opts);
    };

    // First prebuild — triggers Docker build
    runPrebuild({ workspaceRoot, subprocess: countingMock });
    expect(mockCallCount).toBe(1);
    let dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

    // Restore — Dockerfile restored, cache preserved
    runRestore({ workspaceRoot });
    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);

    // Re-prebuild — should reactivate from cache, NOT call Docker build
    // (docker image inspect is called but not devcontainer build, so count is 2 not 1)
    const result = runPrebuild({ workspaceRoot, subprocess: countingMock });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("reactivated from cache");
    expect(mockCallCount).toBe(2); // docker image inspect + no second Docker build
    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");
  });
});

describe("e2e: lock file integration", () => {
  it("prebuild writes namespaced lock entries", () => {
    setupWorkspace();
    const mock = createMock();

    runPrebuild({ workspaceRoot, subprocess: mock });

    const lockPath = join(devcontainerDir, "devcontainer-lock.json");
    const lockContent = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(lockContent["lace.prebuiltFeatures"]).toBeDefined();
    expect(lockContent["lace.prebuiltFeatures"]).toHaveProperty(
      "ghcr.io/anthropics/devcontainer-features/claude-code:1",
    );
  });
});
