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
import { clearMetadataCache, type FeatureMetadata } from "@/lib/feature-metadata";

let workspaceRoot: string;
let devcontainerDir: string;
let laceDir: string;
let metadataCacheDir: string;
let mockCalls: Array<{ command: string; args: string[]; cwd?: string }>;

/** Metadata for features that appear in prebuildFeatures but have no lace port declarations. */
const claudeCodeMetadata: FeatureMetadata = {
  id: "claude-code",
  version: "1.0.5",
  options: {},
};

/** Mock subprocess that handles devcontainer build, up, and metadata fetch commands. */
function createMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });

    // Handle metadata fetch: devcontainer features info manifest <featureId> --output-format json
    if (
      command === "devcontainer" &&
      args[0] === "features" &&
      args[1] === "info" &&
      args[2] === "manifest"
    ) {
      const featureId = args[3];
      // Return basic metadata for claude-code (no lace ports)
      if (featureId === "ghcr.io/anthropics/devcontainer-features/claude-code:1") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            annotations: {
              "dev.containers.metadata": JSON.stringify(claudeCodeMetadata),
            },
          }),
          stderr: "",
        };
      }
      // Unknown feature
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Error: feature not found: ${featureId}`,
      };
    }

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

    // Handle metadata fetch
    if (
      command === "devcontainer" &&
      args[0] === "features" &&
      args[1] === "info" &&
      args[2] === "manifest"
    ) {
      const featureId = args[3];
      if (featureId === "ghcr.io/anthropics/devcontainer-features/claude-code:1") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            annotations: {
              "dev.containers.metadata": JSON.stringify(claudeCodeMetadata),
            },
          }),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: `Error: feature not found: ${featureId}` };
    }

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
  metadataCacheDir = join(workspaceRoot, ".metadata-cache");
  mockCalls = [];
  mkdirSync(workspaceRoot, { recursive: true });
  clearMetadataCache(metadataCacheDir);

  // Set LACE_SETTINGS to point to our test settings location
  process.env.LACE_SETTINGS = join(
    workspaceRoot,
    ".config",
    "lace",
    "settings.json",
  );
});

afterEach(() => {
  clearMetadataCache(metadataCacheDir);
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
  it("generates extended config without port mapping when no features declared", async () => {
    setupWorkspace(MINIMAL_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.prebuild).toBeUndefined();
    expect(result.phases.resolveMounts).toBeUndefined();
    // No port templates found -> no port allocation
    expect(result.phases.portAssignment?.exitCode).toBe(0);
    expect(result.phases.portAssignment?.message).toContain(
      "No port templates found",
    );
    // Config is always generated
    expect(result.phases.generateConfig?.exitCode).toBe(0);

    // Verify extended config is generated (but no appPort without features)
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    expect(extended.appPort).toBeUndefined();
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

  it("preserves array-format postCreateCommand via object format", async () => {
    const configWithArrayPostCreate = JSON.stringify(
      {
        build: { dockerfile: "Dockerfile" },
        postCreateCommand: ["npm", "install", "--frozen-lockfile"],
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

    setupWorkspace(configWithArrayPostCreate, STANDARD_DOCKERFILE);

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

    // Should be object format, not a string
    expect(typeof extended.postCreateCommand).toBe("object");
    expect(Array.isArray(extended.postCreateCommand)).toBe(false);

    // Original array preserved under "lace:user-setup" key
    expect(extended.postCreateCommand["lace:user-setup"]).toEqual([
      "npm",
      "install",
      "--frozen-lockfile",
    ]);

    // Symlink command added under "lace:symlinks" key
    expect(extended.postCreateCommand["lace:symlinks"]).toBeDefined();
    expect(extended.postCreateCommand["lace:symlinks"]).toContain("ln -s");
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

// ── Feature metadata integration tests (Scenarios 35-41) ──

const weztermMetadata: FeatureMetadata = {
  id: "wezterm-server",
  version: "1.1.0",
  options: {
    version: { type: "string", default: "20240203-110809-5046fc22" },
    hostSshPort: { type: "string", default: "2222" },
    createRuntimeDir: { type: "boolean", default: true },
  },
  customizations: {
    lace: {
      ports: {
        hostSshPort: {
          label: "wezterm ssh",
          onAutoForward: "silent",
          requireLocalPort: true,
        },
      },
    },
  },
};

/** Create a mock that handles both metadata fetch and devcontainer build/up. */
function createMetadataMock(
  metadataByFeature: Record<string, FeatureMetadata>,
): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });

    // Handle metadata fetch: devcontainer features info manifest <featureId> --output-format json
    if (
      command === "devcontainer" &&
      args[0] === "features" &&
      args[1] === "info" &&
      args[2] === "manifest"
    ) {
      const featureId = args[3];
      const metadata = metadataByFeature[featureId];
      if (!metadata) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Error: feature not found: ${featureId}`,
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          annotations: {
            "dev.containers.metadata": JSON.stringify(metadata),
          },
        }),
        stderr: "",
      };
    }

    // Handle devcontainer build (prebuild)
    if (command === "devcontainer" && args[0] === "build") {
      const wsFolder = args[args.indexOf("--workspace-folder") + 1];
      if (wsFolder) {
        writeFileSync(
          join(wsFolder, "devcontainer-lock.json"),
          JSON.stringify({ features: {} }) + "\n",
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

/** Create a mock where metadata fetch always fails. */
function createFailingMetadataMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });

    if (
      command === "devcontainer" &&
      args[0] === "features" &&
      args[1] === "info" &&
      args[2] === "manifest"
    ) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "unauthorized: authentication required",
      };
    }

    return { exitCode: 0, stdout: '{"imageName":["test"]}', stderr: "" };
  };
}

const FEATURES_CONFIG_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        hostSshPort: "22430",
      },
    },
  },
  null,
  2,
);

const FEATURES_WITH_UNKNOWN_OPTION_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        hostSshPort: "22430",
        bogusOpt: "true",
      },
    },
  },
  null,
  2,
);

describe("lace up: metadata validation -- fetch success", () => {
  // Scenario 35: Full pipeline with metadata
  it("validates feature metadata successfully", async () => {
    setupWorkspace(FEATURES_CONFIG_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.metadataValidation?.exitCode).toBe(0);
    expect(result.phases.metadataValidation?.message).toContain(
      "Validated metadata for 1 feature(s)",
    );
  });
});

describe("lace up: metadata validation -- fetch failure aborts", () => {
  // Scenario 36: Metadata fetch failure aborts lace up
  it("aborts with clear error when metadata fetch fails", async () => {
    setupWorkspace(FEATURES_CONFIG_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createFailingMetadataMock(),
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Failed to fetch metadata");
    expect(result.message).toContain("--skip-metadata-validation");
    expect(result.phases.metadataValidation?.exitCode).toBe(1);

    // devcontainer up should NOT have been called
    expect(mockCalls).not.toContainEqual(
      expect.objectContaining({
        command: "devcontainer",
        args: expect.arrayContaining(["up"]),
      }),
    );
  });
});

describe("lace up: metadata validation -- skip-metadata-validation", () => {
  // Scenario 37: --skip-metadata-validation allows fallback
  it("succeeds with skipMetadataValidation when fetch fails", async () => {
    setupWorkspace(FEATURES_CONFIG_JSON, STANDARD_DOCKERFILE);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createFailingMetadataMock(),
      skipDevcontainerUp: true,
      skipMetadataValidation: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.metadataValidation?.exitCode).toBe(0);
    // Warning should have been logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("--skip-metadata-validation"),
    );

    warnSpy.mockRestore();
  });
});

describe("lace up: metadata validation -- unknown option", () => {
  // Scenario 38: Unknown option name aborts lace up
  it("aborts with error listing unknown option", async () => {
    setupWorkspace(FEATURES_WITH_UNKNOWN_OPTION_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("invalid options");
    expect(result.message).toContain("bogusOpt");
    expect(result.phases.metadataValidation?.exitCode).toBe(1);
  });
});

describe("lace up: metadata validation -- port key mismatch", () => {
  // Scenario 39: Port declaration key mismatch aborts lace up
  it("aborts when port key does not match option name", async () => {
    const badPortMetadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      options: {
        hostSshPort: { type: "string", default: "2222" },
      },
      customizations: {
        lace: {
          ports: {
            ssh: { label: "wezterm ssh" }, // WRONG: key should be "hostSshPort"
          },
        },
      },
    };

    setupWorkspace(FEATURES_CONFIG_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          badPortMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("invalid port declarations");
    expect(result.message).toContain("ssh");
    expect(result.message).toContain("does not match any option");
    expect(result.phases.metadataValidation?.exitCode).toBe(1);
  });
});

describe("lace up: metadata validation -- no features", () => {
  // Verify that configs without features skip metadata validation
  it("skips metadata validation when no features declared", async () => {
    setupWorkspace(MINIMAL_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.metadataValidation).toBeUndefined();
  });
});

// ── Feature awareness v2 integration tests ──

const AUTO_INJECT_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    },
  },
  null,
  2,
);

const EXPLICIT_STATIC_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        hostSshPort: "3333",
      },
    },
  },
  null,
  2,
);

const EXPLICIT_TEMPLATE_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
      },
    },
  },
  null,
  2,
);

const ASYMMETRIC_APPPORT_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        hostSshPort: "2222",
      },
    },
    appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
  },
  null,
  2,
);

const NO_LACE_PORTS_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/devcontainers/features/git:1": {},
    },
  },
  null,
  2,
);

const gitMetadataNoLace: FeatureMetadata = {
  id: "git",
  version: "1.0.0",
  options: { version: { type: "string", default: "latest" } },
};

describe("lace up: auto-inject port templates from metadata", () => {
  it("auto-injects and resolves port, generates symmetric appPort/forwardPorts/portsAttributes", async () => {
    setupWorkspace(AUTO_INJECT_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.exitCode).toBe(0);
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);
    expect(result.phases.portAssignment?.port).toBeLessThanOrEqual(22499);

    // Verify generated config
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const port = result.phases.portAssignment!.port!;

    // Feature option resolved to integer
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe(port);

    // Symmetric appPort
    expect(extended.appPort).toContain(`${port}:${port}`);

    // forwardPorts
    expect(extended.forwardPorts).toContain(port);

    // portsAttributes with feature-declared label and onAutoForward
    expect(extended.portsAttributes?.[String(port)]).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
      onAutoForward: "silent",
    });

    // Port assignments file persisted
    const assignmentsPath = join(laceDir, "port-assignments.json");
    expect(existsSync(assignmentsPath)).toBe(true);
    const assignments = JSON.parse(readFileSync(assignmentsPath, "utf-8"));
    expect(
      assignments.assignments["wezterm-server/hostSshPort"].port,
    ).toBe(port);
  });
});

describe("lace up: user static value prevents auto-injection", () => {
  it("uses user value, no port allocation or appPort generation", async () => {
    setupWorkspace(EXPLICIT_STATIC_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    // No port allocation (user provided static value, injection skipped)
    expect(result.phases.portAssignment?.message).toContain(
      "No port templates found",
    );

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe("3333");

    // No auto-generated appPort
    expect(extended.appPort).toBeUndefined();
  });
});

describe("lace up: explicit template same as auto-injection", () => {
  it("resolves explicit template the same as auto-injection would", async () => {
    setupWorkspace(EXPLICIT_TEMPLATE_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const port = result.phases.portAssignment!.port!;

    // Feature option resolved to integer (same as auto-injection)
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe(port);

    // Symmetric entries generated
    expect(extended.appPort).toContain(`${port}:${port}`);
  });
});

describe("lace up: asymmetric appPort suppresses auto-generated entry", () => {
  it("resolves template in user appPort and suppresses auto-generated entry", async () => {
    setupWorkspace(ASYMMETRIC_APPPORT_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    const port = result.phases.portAssignment!.port!;

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );

    // hostSshPort stays literal "2222" (user provided static value)
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe("2222");

    // appPort has user's asymmetric mapping (resolved)
    expect(extended.appPort).toContain(`${port}:2222`);

    // No duplicate symmetric entry (suppressed because user already has port:...)
    const symmetricEntry = `${port}:${port}`;
    expect(extended.appPort).not.toContain(symmetricEntry);

    // forwardPorts and portsAttributes still generated
    expect(extended.forwardPorts).toContain(port);
    expect(extended.portsAttributes?.[String(port)]).toBeDefined();
  });
});

describe("lace up: no lace port metadata -- no injection or allocation", () => {
  it("passes through config unchanged when features have no lace ports", async () => {
    setupWorkspace(NO_LACE_PORTS_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/devcontainers/features/git:1": gitMetadataNoLace,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.message).toContain(
      "No port templates found",
    );

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    // No port-related entries
    expect(extended.appPort).toBeUndefined();
    expect(extended.forwardPorts).toBeUndefined();
    expect(extended.portsAttributes).toBeUndefined();
  });
});

describe("lace up: metadata unavailable with skip-metadata-validation", () => {
  it("does not auto-inject when metadata fails but skip-validation set", async () => {
    // Feature with explicit template works even without metadata
    setupWorkspace(EXPLICIT_TEMPLATE_CONFIG_JSON);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createFailingMetadataMock(),
      skipDevcontainerUp: true,
      skipMetadataValidation: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    // Port should still be allocated (user explicitly wrote the template)
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const port = result.phases.portAssignment!.port!;

    // Template resolved
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe(port);

    // portsAttributes uses label fallback (no metadata to enrich)
    expect(extended.portsAttributes?.[String(port)]?.label).toBe(
      "wezterm-server/hostSshPort (lace)",
    );

    warnSpy.mockRestore();
  });
});

// ── Prebuild features port support integration tests (T9-T12) ──

const PREBUILD_WEZTERM_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
      },
    },
  },
  null,
  2,
);

const PREBUILD_WEZTERM_EXPLICIT_APPPORT_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
            hostSshPort: "2222",
          },
        },
      },
    },
    appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
  },
  null,
  2,
);

const PREBUILD_NO_PORTS_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/devcontainers/features/git:1": {},
          "ghcr.io/devcontainers/features/sshd:1": {},
        },
      },
    },
  },
  null,
  2,
);

const sshdMetadataNoLace: FeatureMetadata = {
  id: "sshd",
  version: "1.0.0",
  options: { version: { type: "string", default: "latest" } },
};

const MIXED_BLOCKS_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    },
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/weftwiseink/devcontainer-features/debug-proxy:1": {},
        },
      },
    },
  },
  null,
  2,
);

const debugProxyMetadataFull: FeatureMetadata = {
  id: "debug-proxy",
  version: "1.0.0",
  options: {
    debugPort: { type: "string", default: "9229" },
  },
  customizations: {
    lace: {
      ports: {
        debugPort: {
          label: "debug",
          onAutoForward: "silent",
          requireLocalPort: true,
        },
      },
    },
  },
};

describe("lace up: T9 -- prebuild feature with ports, full pipeline (asymmetric)", () => {
  it("auto-injects and resolves asymmetric appPort for prebuild-only wezterm-server", async () => {
    setupWorkspace(PREBUILD_WEZTERM_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.exitCode).toBe(0);
    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);
    expect(port).toBeLessThanOrEqual(22499);

    // Verify generated config
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );

    // Asymmetric appPort mapping (lace host port -> feature default container port 2222)
    expect(extended.appPort).toContain(`${port}:2222`);

    // No symmetric entry
    expect(extended.appPort).not.toContain(`${port}:${port}`);

    // forwardPorts and portsAttributes generated
    expect(extended.forwardPorts).toContain(port);
    expect(extended.portsAttributes?.[String(port)]).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
      onAutoForward: "silent",
    });

    // Port assignments file persisted
    const assignmentsPath = join(laceDir, "port-assignments.json");
    expect(existsSync(assignmentsPath)).toBe(true);
    const assignments = JSON.parse(readFileSync(assignmentsPath, "utf-8"));
    expect(
      assignments.assignments["wezterm-server/hostSshPort"].port,
    ).toBe(port);

    // Prebuild feature option hostSshPort should NOT be in the generated config's prebuild block
    const prebuildFeatures = (
      extended.customizations as Record<string, Record<string, unknown>>
    )?.lace?.prebuildFeatures as Record<string, Record<string, unknown>> | undefined;
    if (prebuildFeatures) {
      const weztermOpts = prebuildFeatures[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ];
      expect(weztermOpts?.hostSshPort).toBeUndefined();
    }
  });
});

describe("lace up: T10 -- prebuild feature with ports + explicit asymmetric appPort", () => {
  it("resolves user-provided appPort template for prebuild feature", async () => {
    setupWorkspace(PREBUILD_WEZTERM_EXPLICIT_APPPORT_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    const port = result.phases.portAssignment!.port!;

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );

    // Asymmetric mapping resolved
    expect(extended.appPort).toContain(`${port}:2222`);

    // No duplicate symmetric entry
    expect(extended.appPort).not.toContain(`${port}:${port}`);

    // forwardPorts and portsAttributes generated
    expect(extended.forwardPorts).toContain(port);
    expect(extended.portsAttributes?.[String(port)]).toBeDefined();
  });
});

describe("lace up: T11 -- prebuild features without ports, no allocation", () => {
  it("produces no port allocation when prebuild features have no port metadata", async () => {
    setupWorkspace(PREBUILD_NO_PORTS_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/devcontainers/features/git:1": gitMetadataNoLace,
        "ghcr.io/devcontainers/features/sshd:1": sshdMetadataNoLace,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.portAssignment?.message).toContain(
      "No port templates found",
    );

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    expect(extended.appPort).toBeUndefined();
  });
});

describe("lace up: T12 -- mixed blocks, ports from both", () => {
  it("allocates ports for features in both blocks with distinct ports", async () => {
    setupWorkspace(MIXED_BLOCKS_CONFIG_JSON);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          weztermMetadata,
        "ghcr.io/weftwiseink/devcontainer-features/debug-proxy:1":
          debugProxyMetadataFull,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );

    // Both features should have appPort entries
    expect(extended.appPort).toBeDefined();
    expect(extended.appPort.length).toBeGreaterThanOrEqual(2);

    // wezterm-server in features block: symmetric injection -> symmetric appPort
    // debug-proxy in prebuildFeatures: asymmetric injection -> asymmetric appPort
    const appPorts = extended.appPort as string[];

    // Find the two distinct ports
    const portNumbers = appPorts.map((entry: string) =>
      parseInt(entry.split(":")[0], 10),
    );
    expect(new Set(portNumbers).size).toBe(2); // distinct ports

    // debug-proxy has asymmetric mapping (host:9229)
    const debugEntry = appPorts.find((entry: string) =>
      entry.endsWith(":9229"),
    );
    expect(debugEntry).toBeDefined();

    // forwardPorts has both
    expect(extended.forwardPorts).toHaveLength(2);

    // portsAttributes has both
    expect(Object.keys(extended.portsAttributes)).toHaveLength(2);
  });
});

// ── Blob fallback integration tests ──

/** Build a minimal tar entry. */
function tarEntry(
  name: string,
  content: string,
  typeflag: number = 0x30,
): Buffer {
  const contentBuf = Buffer.from(content, "utf-8");
  const header = Buffer.alloc(512);
  header.write(name, 0, Math.min(name.length, 100), "ascii");
  const sizeOctal = contentBuf.length.toString(8).padStart(11, "0");
  header.write(sizeOctal, 124, 12, "ascii");
  header[156] = typeflag;
  const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
  const data = Buffer.alloc(paddedSize);
  contentBuf.copy(data);
  return Buffer.concat([header, data]);
}

function buildTar(...entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

const nushellMetadata: FeatureMetadata = {
  id: "nushell",
  version: "0.1.1",
  options: {},
};

/** Mock subprocess that returns annotation for wezterm-server but no annotation for nushell. */
function createMixedAnnotationMock(
  metadataByFeature: Record<string, FeatureMetadata>,
  noAnnotationFeatures: string[],
): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });

    if (
      command === "devcontainer" &&
      args[0] === "features" &&
      args[1] === "info" &&
      args[2] === "manifest"
    ) {
      const featureId = args[3];

      if (noAnnotationFeatures.includes(featureId)) {
        // Return manifest without dev.containers.metadata but with layers
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            manifest: {
              schemaVersion: 2,
              layers: [
                {
                  digest: "sha256:abc123",
                  mediaType: "application/vnd.devcontainers.layer.v1+tar",
                  size: 10240,
                },
              ],
              annotations: { "com.github.package.type": "devcontainer_feature" },
            },
          }),
          stderr: "",
        };
      }

      const metadata = metadataByFeature[featureId];
      if (!metadata) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Error: feature not found: ${featureId}`,
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          annotations: {
            "dev.containers.metadata": JSON.stringify(metadata),
          },
        }),
        stderr: "",
      };
    }

    if (command === "devcontainer" && args[0] === "build") {
      const wsFolder = args[args.indexOf("--workspace-folder") + 1];
      if (wsFolder) {
        writeFileSync(
          join(wsFolder, "devcontainer-lock.json"),
          JSON.stringify({ features: {} }) + "\n",
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

const MIXED_ANNOTATION_CONFIG_JSON = JSON.stringify(
  {
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    features: {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      "ghcr.io/eitsupi/devcontainer-features/nushell:0": {},
    },
  },
  null,
  2,
);

describe("lace up: mixed features with blob fallback", () => {
  it("succeeds when one feature has annotation and one uses blob fallback", async () => {
    setupWorkspace(MIXED_ANNOTATION_CONFIG_JSON);

    const featureTar = buildTar(
      tarEntry("devcontainer-feature.json", JSON.stringify(nushellMetadata)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/token")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          });
        }
        if (url.includes("/blobs/")) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () =>
              Promise.resolve(
                featureTar.buffer.slice(
                  featureTar.byteOffset,
                  featureTar.byteOffset + featureTar.byteLength,
                ),
              ),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMixedAnnotationMock(
        {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
            weztermMetadata,
        },
        ["ghcr.io/eitsupi/devcontainer-features/nushell:0"],
      ),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.metadataValidation?.exitCode).toBe(0);
    // wezterm-server should have port allocation, nushell should not
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);

    vi.unstubAllGlobals();
  });

  it("fails with blob_fallback_failed when blob download fails and skipValidation is false", async () => {
    setupWorkspace(MIXED_ANNOTATION_CONFIG_JSON);

    // Mock fetch that always fails for blob download
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMixedAnnotationMock(
        {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
            weztermMetadata,
        },
        ["ghcr.io/eitsupi/devcontainer-features/nushell:0"],
      ),
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("blob fallback");

    vi.unstubAllGlobals();
  });

  it("succeeds with skipMetadataValidation when blob fallback fails", async () => {
    setupWorkspace(MIXED_ANNOTATION_CONFIG_JSON);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMixedAnnotationMock(
        {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
            weztermMetadata,
        },
        ["ghcr.io/eitsupi/devcontainer-features/nushell:0"],
      ),
      skipDevcontainerUp: true,
      skipMetadataValidation: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("--skip-metadata-validation"),
    );

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

// ── Workspace layout integration tests ──

describe("lace up: workspace layout — worktree auto-generation", () => {
  it("auto-generates workspaceMount and workspaceFolder for worktree workspace", async () => {
    // Create bare-repo layout in the test workspace
    const bareDir = join(workspaceRoot, ".bare");
    mkdirSync(join(bareDir, "objects"), { recursive: true });
    mkdirSync(join(bareDir, "refs"), { recursive: true });
    writeFileSync(join(bareDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");
    writeFileSync(join(workspaceRoot, ".git"), "gitdir: ./.bare\n", "utf-8");

    // Create a worktree directory
    const worktreeDir = join(workspaceRoot, "main");
    const worktreeGitStateDir = join(bareDir, "worktrees", "main");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(worktreeGitStateDir, { recursive: true });
    writeFileSync(join(worktreeDir, ".git"), "gitdir: ../.bare/worktrees/main\n", "utf-8");
    writeFileSync(join(worktreeGitStateDir, "commondir"), "../..\n", "utf-8");
    writeFileSync(join(worktreeGitStateDir, "gitdir"), join(worktreeDir, ".git") + "\n", "utf-8");

    // Create devcontainer.json inside the worktree
    const worktreeDevcontainerDir = join(worktreeDir, ".devcontainer");
    mkdirSync(worktreeDevcontainerDir, { recursive: true });
    writeFileSync(
      join(worktreeDevcontainerDir, "devcontainer.json"),
      JSON.stringify({
        image: "node:24-bookworm",
        customizations: {
          lace: {
            workspace: { layout: "bare-worktree" },
          },
        },
      }),
      "utf-8",
    );

    const result = await runUp({
      workspaceFolder: worktreeDir,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.workspaceLayout).toBeDefined();
    expect(result.phases.workspaceLayout?.exitCode).toBe(0);
    expect(result.phases.workspaceLayout?.message).toContain("worktree");

    // Check generated config has auto-generated fields
    const generatedConfig = JSON.parse(
      readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
    );
    expect(generatedConfig.workspaceMount).toBe(
      `source=${workspaceRoot},target=/workspace,type=bind,consistency=delegated`,
    );
    expect(generatedConfig.workspaceFolder).toBe("/workspace/main");
    // postCreateCommand should have safe.directory
    expect(generatedConfig.postCreateCommand).toContain("safe.directory");
  });
});

describe("lace up: workspace layout — normal clone with no workspace config", () => {
  it("skips workspace phase when no workspace config present", async () => {
    setupWorkspace(MINIMAL_JSON, STANDARD_DOCKERFILE);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);
    // workspaceLayout phase should not be present (skipped)
    expect(result.phases.workspaceLayout).toBeUndefined();
  });
});

describe("lace up: workspace layout — normal clone with workspace declared", () => {
  it("returns error when bare-worktree declared but workspace is normal clone", async () => {
    // Create a normal .git directory
    const gitDir = join(workspaceRoot, ".git");
    mkdirSync(join(gitDir, "objects"), { recursive: true });
    mkdirSync(join(gitDir, "refs"), { recursive: true });
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");

    setupWorkspace(
      JSON.stringify({
        build: { dockerfile: "Dockerfile" },
        customizations: {
          lace: {
            workspace: { layout: "bare-worktree" },
          },
        },
      }),
      STANDARD_DOCKERFILE,
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.phases.workspaceLayout).toBeDefined();
    expect(result.phases.workspaceLayout?.exitCode).toBe(1);
    expect(result.phases.workspaceLayout?.message).toContain("normal git clone");
  });
});

describe("lace up: workspace layout — skip-validation downgrades error", () => {
  it("downgrades workspace error to warning with --skip-validation", async () => {
    // Create a normal .git directory (mismatch)
    const gitDir = join(workspaceRoot, ".git");
    mkdirSync(join(gitDir, "objects"), { recursive: true });
    mkdirSync(join(gitDir, "refs"), { recursive: true });
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");

    setupWorkspace(
      JSON.stringify({
        build: { dockerfile: "Dockerfile" },
        customizations: {
          lace: {
            workspace: { layout: "bare-worktree" },
          },
        },
      }),
      STANDARD_DOCKERFILE,
    );

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
      skipValidation: true,
      cacheDir: metadataCacheDir,
    });

    // Should succeed due to skip-validation
    expect(result.exitCode).toBe(0);
    expect(result.phases.workspaceLayout).toBeDefined();
    expect(result.phases.workspaceLayout?.exitCode).toBe(0);
    expect(result.phases.workspaceLayout?.message).toContain("downgraded");
  });
});
