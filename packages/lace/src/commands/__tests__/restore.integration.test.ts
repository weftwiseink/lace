// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPrebuild } from "../../lib/prebuild.js";
import { runRestore } from "../../lib/restore.js";
import type { RunSubprocess } from "../../lib/subprocess.js";

let workspaceRoot: string;
let devcontainerDir: string;

function createMock(): RunSubprocess {
  return (command, args) => {
    const wsFolder = args[args.indexOf("--workspace-folder") + 1];
    if (wsFolder) {
      writeFileSync(
        join(wsFolder, "devcontainer-lock.json"),
        JSON.stringify({ features: {} }, null, 2),
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
  features: {},
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
  workspaceRoot = join(tmpdir(), `lace-test-restore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("restore: after prebuild", () => {
  it("restores Dockerfile to original", () => {
    setupWorkspace();

    // Prebuild
    runPrebuild({ workspaceRoot, subprocess: createMock() });
    let dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

    // Restore
    const result = runRestore({ workspaceRoot });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Restored");

    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);
  });
});

describe("restore: no active prebuild", () => {
  it("exits 0 with informational message", () => {
    setupWorkspace();

    const result = runRestore({ workspaceRoot });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("No active prebuild");

    // Dockerfile unchanged
    const dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);
  });
});

describe("restore: preserves non-prebuild edits", () => {
  it("only undoes FROM rewrite, not other Dockerfile changes", () => {
    const modifiedDockerfile =
      "FROM node:24-bookworm\n# Added by user\nRUN apt-get update\n";
    setupWorkspace(STANDARD_JSON, modifiedDockerfile);

    // Prebuild
    runPrebuild({ workspaceRoot, subprocess: createMock() });
    let dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");
    expect(dockerfile).toContain("# Added by user");

    // Restore
    runRestore({ workspaceRoot });
    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(modifiedDockerfile);
  });
});
