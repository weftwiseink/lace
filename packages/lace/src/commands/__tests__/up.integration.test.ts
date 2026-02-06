// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runUp } from "@/lib/up";
import type { RunSubprocess } from "@/lib/subprocess";

let workspaceRoot: string;
let devcontainerDir: string;
let laceDir: string;
let mockCalls: Array<{ command: string; args: string[]; cwd?: string }>;

/** Mock subprocess that handles devcontainer build and up commands. */
function createMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });

    // Simulate devcontainer build writing a lock file in the prebuild dir
    if (command === "devcontainer" && args[0] === "build") {
      const wsFolder = args[args.indexOf("--workspace-folder") + 1];
      if (wsFolder) {
        writeFileSync(
          join(wsFolder, "devcontainer-lock.json"),
          JSON.stringify({
            features: {
              "ghcr.io/anthropics/devcontainer-features/claude-code:1": {
                version: "1.0.5",
                resolved:
                  "ghcr.io/anthropics/devcontainer-features/claude-code@sha256:abc",
                integrity: "sha256:abc",
              },
            },
          }) + "\n",
          "utf-8",
        );
      }
    }

    return {
      exitCode: 0,
      stdout: '{"imageName":["test"]}',
      stderr: "",
    };
  };
}

/** Mock subprocess that fails devcontainer up. */
function createFailingDevcontainerUpMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });

    // Simulate devcontainer build writing a lock file in the prebuild dir
    if (command === "devcontainer" && args[0] === "build") {
      const wsFolder = args[args.indexOf("--workspace-folder") + 1];
      if (wsFolder) {
        writeFileSync(
          join(wsFolder, "devcontainer-lock.json"),
          JSON.stringify({ features: {} }) + "\n",
          "utf-8",
        );
      }
      return { exitCode: 0, stdout: '{"imageName":["test"]}', stderr: "" };
    }

    if (command === "devcontainer" && args[0] === "up") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Error: Container failed to start",
      };
    }

    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

function setupWorkspace(devcontainerJson: string, dockerfile?: string) {
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(
    join(devcontainerDir, "devcontainer.json"),
    devcontainerJson,
    "utf-8",
  );
  if (dockerfile) {
    writeFileSync(join(devcontainerDir, "Dockerfile"), dockerfile, "utf-8");
  }
}

function setupSettings(settings: object) {
  const settingsDir = join(workspaceRoot, ".config", "lace");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
}

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `lace-test-up-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  laceDir = join(workspaceRoot, ".lace");
  mockCalls = [];
  mkdirSync(workspaceRoot, { recursive: true });

  // Set LACE_SETTINGS to point to our test settings location
  process.env.LACE_SETTINGS = join(
    workspaceRoot,
    ".config",
    "lace",
    "settings.json",
  );
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env.LACE_SETTINGS;
});

const STANDARD_DOCKERFILE = "FROM node:24-bookworm\nRUN apt-get update\n";

const REPO_MOUNTS_ONLY_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    customizations: {
      lace: {
        repoMounts: {
          "github.com/user/dotfiles": {},
        },
      },
    },
  },
  null,
  2,
);

const PREBUILD_ONLY_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
        },
      },
    },
  },
  null,
  2,
);

const FULL_CONFIG_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
        },
        repoMounts: {
          "github.com/user/dotfiles": {},
        },
      },
    },
  },
  null,
  2,
);

const MINIMAL_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
  },
  null,
  2,
);

describe("lace up: repo mounts with all overridden", () => {
  it("generates extended config and invokes devcontainer", async () => {
    setupWorkspace(REPO_MOUNTS_ONLY_JSON, STANDARD_DOCKERFILE);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: { source: overrideSource },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true, // Skip actual devcontainer up for unit tests
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.resolveMounts?.exitCode).toBe(0);
    expect(result.phases.generateConfig?.exitCode).toBe(0);

    // Verify extended config was generated
    expect(existsSync(join(laceDir, "devcontainer.json"))).toBe(true);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    expect(extended.mounts).toBeDefined();
    expect(extended.mounts).toContainEqual(
      expect.stringContaining("dotfiles"),
    );
  });
});

describe("lace up: repo mounts with clones", () => {
  it("clones repos and generates extended config", async () => {
    setupWorkspace(REPO_MOUNTS_ONLY_JSON, STANDARD_DOCKERFILE);
    setupSettings({});

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.resolveMounts?.message).toContain("1 clone(s)");

    // Verify git clone was called
    expect(mockCalls).toContainEqual(
      expect.objectContaining({
        command: "git",
        args: expect.arrayContaining(["clone"]),
      }),
    );
  });
});

describe("lace up: prebuild only", () => {
  it("runs prebuild and generates extended config", async () => {
    setupWorkspace(PREBUILD_ONLY_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.prebuild?.exitCode).toBe(0);
    expect(result.phases.prebuild?.message).toContain("Prebuild");

    // Dockerfile should be rewritten
    const dockerfile = readFileSync(
      join(devcontainerDir, "Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).toContain("lace.local");
  });
});

describe("lace up: full config (prebuild + repo mounts)", () => {
  it("runs all phases in order", async () => {
    setupWorkspace(FULL_CONFIG_JSON, STANDARD_DOCKERFILE);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: { source: overrideSource },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.prebuild?.exitCode).toBe(0);
    expect(result.phases.resolveMounts?.exitCode).toBe(0);
    expect(result.phases.generateConfig?.exitCode).toBe(0);
  });
});

describe("lace up: no repo mounts or prebuild", () => {
  it("assigns port and generates extended config with port mapping", async () => {
    setupWorkspace(MINIMAL_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.prebuild).toBeUndefined();
    expect(result.phases.resolveMounts).toBeUndefined();
    // Port assignment always happens
    expect(result.phases.portAssignment?.exitCode).toBe(0);
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);
    expect(result.phases.portAssignment?.port).toBeLessThanOrEqual(22499);
    // Config is always generated now (for port mapping)
    expect(result.phases.generateConfig?.exitCode).toBe(0);

    // Verify extended config contains the port mapping
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    expect(extended.appPort).toBeDefined();
    expect(extended.appPort[0]).toMatch(/^224\d{2}:2222$/);
  });
});

describe("lace up: resolution failures abort before devcontainer up", () => {
  it("aborts on resolve-mounts failure", async () => {
    setupWorkspace(REPO_MOUNTS_ONLY_JSON, STANDARD_DOCKERFILE);
    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: { source: join(workspaceRoot, "nonexistent") },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Resolve mounts failed");

    // devcontainer up should not have been called
    expect(mockCalls).not.toContainEqual(
      expect.objectContaining({
        command: "devcontainer",
        args: expect.arrayContaining(["up"]),
      }),
    );
  });
});

describe("lace up: symlink generation", () => {
  it("adds symlink command to postCreateCommand", async () => {
    setupWorkspace(REPO_MOUNTS_ONLY_JSON, STANDARD_DOCKERFILE);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: overrideSource,
            target: "/home/user/dotfiles",
          },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    expect(extended.postCreateCommand).toBeDefined();
    expect(extended.postCreateCommand).toContain("ln -s");
  });

  it("merges with existing postCreateCommand string", async () => {
    const configWithPostCreate = JSON.stringify(
      {
        build: { dockerfile: "Dockerfile" },
        postCreateCommand: "echo hello",
        customizations: {
          lace: {
            repoMounts: {
              "github.com/user/dotfiles": {},
            },
          },
        },
      },
      null,
      2,
    );

    setupWorkspace(configWithPostCreate, STANDARD_DOCKERFILE);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: overrideSource,
            target: "/home/user/dotfiles",
          },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    expect(extended.postCreateCommand).toContain("echo hello");
    expect(extended.postCreateCommand).toContain("&&");
    expect(extended.postCreateCommand).toContain("ln -s");
  });
});

describe("lace up: devcontainer up integration", () => {
  it("passes through to devcontainer up with extended config", async () => {
    setupWorkspace(REPO_MOUNTS_ONLY_JSON, STANDARD_DOCKERFILE);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: { source: overrideSource },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      // Don't skip devcontainer up
    });

    expect(result.exitCode).toBe(0);

    // Verify devcontainer up was called with --config pointing to extended config
    const upCall = mockCalls.find(
      (c) => c.command === "devcontainer" && c.args[0] === "up",
    );
    expect(upCall).toBeDefined();
    expect(upCall?.args).toContain("--config");
    expect(upCall?.args).toContainEqual(
      expect.stringContaining(".lace/devcontainer.json"),
    );
    expect(upCall?.args).toContain("--workspace-folder");
  });

  it("handles devcontainer up failure", async () => {
    setupWorkspace(REPO_MOUNTS_ONLY_JSON, STANDARD_DOCKERFILE);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: { source: overrideSource },
        },
      },
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createFailingDevcontainerUpMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("devcontainer up failed");
    expect(result.phases.devcontainerUp?.exitCode).toBe(1);
  });
});

describe("lace up: devcontainer.json missing", () => {
  it("exits with error", async () => {
    // Don't set up workspace
    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Cannot read devcontainer.json");
  });
});
