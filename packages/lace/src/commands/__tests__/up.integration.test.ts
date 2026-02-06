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
  version: "1.0.0",
  options: {
    sshPort: { type: "string", default: "2222" },
  },
  customizations: {
    lace: {
      ports: {
        sshPort: { label: "wezterm ssh", onAutoForward: "silent" },
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
        sshPort: "22430",
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
        sshPort: "22430",
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
        sshPort: { type: "string", default: "2222" },
      },
      customizations: {
        lace: {
          ports: {
            ssh: { label: "wezterm ssh" }, // WRONG: key should be "sshPort"
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
        sshPort: "3333",
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
        sshPort: "${lace.port(wezterm-server/sshPort)}",
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
        sshPort: "2222",
      },
    },
    appPort: ["${lace.port(wezterm-server/sshPort)}:2222"],
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
      ].sshPort,
    ).toBe(port);

    // Symmetric appPort
    expect(extended.appPort).toContain(`${port}:${port}`);

    // forwardPorts
    expect(extended.forwardPorts).toContain(port);

    // portsAttributes with feature-declared label
    expect(extended.portsAttributes?.[String(port)]).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
    });

    // Port assignments file persisted
    const assignmentsPath = join(laceDir, "port-assignments.json");
    expect(existsSync(assignmentsPath)).toBe(true);
    const assignments = JSON.parse(readFileSync(assignmentsPath, "utf-8"));
    expect(
      assignments.assignments["wezterm-server/sshPort"].port,
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
      ].sshPort,
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
      ].sshPort,
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

    // sshPort stays literal "2222" (user provided static value)
    const features = extended.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort,
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
      ].sshPort,
    ).toBe(port);

    // portsAttributes uses label fallback (no metadata to enrich)
    expect(extended.portsAttributes?.[String(port)]?.label).toBe(
      "wezterm-server/sshPort (lace)",
    );

    warnSpy.mockRestore();
  });
});
