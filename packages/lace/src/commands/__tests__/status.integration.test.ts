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
import { runStatus } from "../../lib/status.js";
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
  workspaceRoot = join(tmpdir(), `lace-test-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("status: no prebuild active", () => {
  it("reports no active prebuild", () => {
    setupWorkspace();
    const result = runStatus({ workspaceRoot });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("No active prebuild");
  });

  it("reports no active prebuild when .lace/ missing", () => {
    setupWorkspace();
    const result = runStatus({ workspaceRoot });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("No active prebuild");
  });
});

describe("status: prebuild active, config fresh", () => {
  it("reports up to date", () => {
    setupWorkspace();
    runPrebuild({ workspaceRoot, subprocess: createMock() });

    const result = runStatus({ workspaceRoot });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Prebuild active");
    expect(result.message).toContain("node:24-bookworm");
    expect(result.message).toContain("lace.local/node:24-bookworm");
    expect(result.message).toContain("up to date");
  });
});

describe("status: prebuild active, config stale", () => {
  it("reports config changed", () => {
    setupWorkspace();
    runPrebuild({ workspaceRoot, subprocess: createMock() });

    // Change config
    const newJson = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weft/devcontainer-features/wezterm-server:1": {},
          },
        },
      },
      features: {},
    }, null, 2);
    writeFileSync(join(devcontainerDir, "devcontainer.json"), newJson, "utf-8");

    const result = runStatus({ workspaceRoot });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("config changed since last prebuild");
  });
});
