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
import type { RunSubprocess } from "@/lib/subprocess";

let workspaceRoot: string;
let devcontainerDir: string;
let prebuildDir: string;
let mockCalls: Array<{ command: string; args: string[] }>;

/** Mock subprocess that always succeeds and writes a lock file. */
function createMock(options?: {
  exitCode?: number;
  stderr?: string;
}): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args });
    // Simulate devcontainer build writing a lock file in the prebuild dir
    const wsFolder = args[args.indexOf("--workspace-folder") + 1];
    if (wsFolder && (options?.exitCode ?? 0) === 0) {
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
        }, null, 2) + "\n",
        "utf-8",
      );
    }
    return {
      exitCode: options?.exitCode ?? 0,
      stdout: options?.exitCode ? "" : `{"imageName":["test"]}`,
      stderr: options?.stderr ?? "",
    };
  };
}

function setupWorkspace(devcontainerJson: string, dockerfile: string) {
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(join(devcontainerDir, "devcontainer.json"), devcontainerJson, "utf-8");
  writeFileSync(join(devcontainerDir, "Dockerfile"), dockerfile, "utf-8");
}

/** Setup workspace for image-based config (no Dockerfile). */
function setupImageWorkspace(devcontainerJson: string) {
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(join(devcontainerDir, "devcontainer.json"), devcontainerJson, "utf-8");
}

beforeEach(() => {
  workspaceRoot = join(tmpdir(), `lace-test-prebuild-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  prebuildDir = join(workspaceRoot, ".lace", "prebuild");
  mockCalls = [];
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

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

describe("prebuild: happy path", () => {
  it("runs full pipeline and rewrites Dockerfile", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock();

    const result = runPrebuild({
      workspaceRoot,
      subprocess: mock,
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Prebuild complete");

    // Verify Dockerfile was rewritten
    const dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

    // Verify temp context exists
    expect(existsSync(join(prebuildDir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(prebuildDir, "devcontainer.json"))).toBe(true);
    expect(existsSync(join(prebuildDir, "metadata.json"))).toBe(true);

    // Verify devcontainer build was called correctly
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].command).toBe("devcontainer");
    expect(mockCalls[0].args).toContain("build");
    expect(mockCalls[0].args).toContain("--workspace-folder");
    expect(mockCalls[0].args).toContain(prebuildDir);
    expect(mockCalls[0].args).toContain("--image-name");
    expect(mockCalls[0].args).toContain("lace.local/node:24-bookworm");
  });
});

describe("prebuild: idempotency", () => {
  it("skips rebuild when context is unchanged", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock();

    // First run
    const result1 = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result1.exitCode).toBe(0);
    expect(mockCalls).toHaveLength(1);

    // Second run — should be a no-op
    const result2 = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result2.exitCode).toBe(0);
    expect(result2.message).toContain("up to date");
    expect(mockCalls).toHaveLength(1); // Not called again
  });
});

describe("prebuild: rebuild on config change", () => {
  it("rebuilds when prebuildFeatures change", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock();

    // First run
    runPrebuild({ workspaceRoot, subprocess: mock });
    expect(mockCalls).toHaveLength(1);

    // Change prebuildFeatures
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

    // Second run — should rebuild
    const result = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result.exitCode).toBe(0);
    expect(mockCalls).toHaveLength(2);
  });
});

describe("prebuild: --force", () => {
  it("rebuilds even when cache is fresh", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock();

    runPrebuild({ workspaceRoot, subprocess: mock });
    expect(mockCalls).toHaveLength(1);

    // Force rebuild
    const result = runPrebuild({
      workspaceRoot,
      subprocess: mock,
      force: true,
    });
    expect(result.exitCode).toBe(0);
    expect(mockCalls).toHaveLength(2);
  });
});

describe("prebuild: --dry-run", () => {
  it("reports planned actions without side effects", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock();

    const result = runPrebuild({
      workspaceRoot,
      subprocess: mock,
      dryRun: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Dry run");
    expect(result.message).toContain("lace.local/node:24-bookworm");
    expect(result.message).toContain("claude-code");

    // No side effects
    expect(existsSync(prebuildDir)).toBe(false);
    expect(mockCalls).toHaveLength(0);

    // Dockerfile unchanged
    const dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);
  });
});

describe("prebuild: atomicity on failure", () => {
  it("does not modify Dockerfile on build failure", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock({ exitCode: 1, stderr: "build failed: OOM" });

    const result = runPrebuild({ workspaceRoot, subprocess: mock });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("build failed");
    expect(result.message).toContain("OOM");

    // Dockerfile unchanged
    const dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toBe(STANDARD_DOCKERFILE);
  });
});

describe("prebuild: rebuild after previous prebuild", () => {
  it("restores original FROM before re-prebuild", () => {
    setupWorkspace(STANDARD_JSON, STANDARD_DOCKERFILE);
    const mock = createMock();

    // First prebuild
    runPrebuild({ workspaceRoot, subprocess: mock });

    // Verify FROM was rewritten
    let dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

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

    // Second prebuild
    const result = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result.exitCode).toBe(0);

    // The build should use the ORIGINAL base image, not lace.local
    // (because we restore before rebuilding)
    dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");
    expect(dockerfile).not.toContain("FROM lace.local/lace.local");
  });
});

describe("prebuild: absent/null/empty features", () => {
  it("exits 0 with message when prebuildFeatures is absent", () => {
    const json = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      features: {},
    }, null, 2);
    setupWorkspace(json, STANDARD_DOCKERFILE);

    const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("No prebuildFeatures configured");
  });

  it("exits 0 silently when prebuildFeatures is null", () => {
    const json = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      customizations: { lace: { prebuildFeatures: null } },
      features: {},
    }, null, 2);
    setupWorkspace(json, STANDARD_DOCKERFILE);

    const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
    expect(result.exitCode).toBe(0);
    expect(result.message).toBe("");
  });

  it("exits 0 with message when prebuildFeatures is empty", () => {
    const json = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      customizations: { lace: { prebuildFeatures: {} } },
      features: {},
    }, null, 2);
    setupWorkspace(json, STANDARD_DOCKERFILE);

    const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("empty");
  });
});

describe("prebuild: error cases", () => {
  it("errors on feature overlap", () => {
    const json = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/devcontainers/features/git:1": {},
          },
        },
      },
      features: {
        "ghcr.io/devcontainers/features/git:2": {},
      },
    }, null, 2);
    setupWorkspace(json, STANDARD_DOCKERFILE);

    const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("overlap");
    expect(result.message).toContain("ghcr.io/devcontainers/features/git");
  });

  it("errors when devcontainer.json missing", () => {
    // No devcontainer dir created
    const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Cannot read devcontainer.json");
  });
});

// ============================================================================
// Image-based config tests
// ============================================================================

const IMAGE_JSON = JSON.stringify({
  image: "mcr.microsoft.com/devcontainers/base:ubuntu",
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

describe("prebuild: image-based config happy path", () => {
  it("runs full pipeline for image-based config and rewrites devcontainer.json", () => {
    setupImageWorkspace(IMAGE_JSON);
    const mock = createMock();

    const result = runPrebuild({ workspaceRoot, subprocess: mock });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Prebuild complete");
    expect(result.message).toContain("devcontainer.json image");

    // Verify devcontainer.json was rewritten
    const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
    expect(config).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");

    // Verify temp context
    expect(existsSync(join(prebuildDir, "Dockerfile"))).toBe(true);
    const tempDockerfile = readFileSync(join(prebuildDir, "Dockerfile"), "utf-8");
    expect(tempDockerfile).toBe("FROM mcr.microsoft.com/devcontainers/base:ubuntu\n");

    // Verify metadata includes configType
    const metadata = JSON.parse(readFileSync(join(prebuildDir, "metadata.json"), "utf-8"));
    expect(metadata.configType).toBe("image");
    expect(metadata.originalFrom).toBe("mcr.microsoft.com/devcontainers/base:ubuntu");

    // Verify devcontainer build was called correctly
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].args).toContain("--image-name");
    expect(mockCalls[0].args).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");
  });
});

describe("prebuild: image-based idempotency", () => {
  it("skips rebuild when image config is unchanged", () => {
    setupImageWorkspace(IMAGE_JSON);
    const mock = createMock();

    runPrebuild({ workspaceRoot, subprocess: mock });
    expect(mockCalls).toHaveLength(1);

    const result = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("up to date");
    expect(mockCalls).toHaveLength(1);  // Not called again
  });
});

describe("prebuild: image-based dry-run", () => {
  it("reports planned actions for image config without side effects", () => {
    setupImageWorkspace(IMAGE_JSON);
    const mock = createMock();

    const result = runPrebuild({ workspaceRoot, subprocess: mock, dryRun: true });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Dry run");
    expect(result.message).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");
    expect(result.message).toContain("image field");

    // No side effects
    expect(existsSync(prebuildDir)).toBe(false);
    const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
    expect(config).not.toContain("lace.local/");
  });
});

describe("prebuild: image-based atomicity on failure", () => {
  it("does not modify devcontainer.json on build failure", () => {
    setupImageWorkspace(IMAGE_JSON);
    const mock = createMock({ exitCode: 1, stderr: "build failed: OOM" });

    const result = runPrebuild({ workspaceRoot, subprocess: mock });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("build failed");

    // devcontainer.json unchanged
    const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
    expect(config).toBe(IMAGE_JSON);
  });
});

describe("prebuild: image-based absent/null/empty features", () => {
  it("exits 0 with message when image config has no prebuildFeatures", () => {
    const json = JSON.stringify({
      image: "node:24",
      features: {},
    }, null, 2);
    setupImageWorkspace(json);

    const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("No prebuildFeatures configured");
  });
});

describe("prebuild: mixed config (Dockerfile takes precedence)", () => {
  it("uses Dockerfile when both Dockerfile and image are present", () => {
    const json = JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      image: "ignored:tag",  // Should be ignored
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
          },
        },
      },
    }, null, 2);
    setupWorkspace(json, "FROM node:24-bookworm\n");
    const mock = createMock();

    runPrebuild({ workspaceRoot, subprocess: mock });

    // Verify Dockerfile was rewritten, not devcontainer.json image field
    const dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

    const config = JSON.parse(readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8"));
    expect(config.image).toBe("ignored:tag");  // Unchanged

    // Verify metadata shows dockerfile type
    const metadata = JSON.parse(readFileSync(join(prebuildDir, "metadata.json"), "utf-8"));
    expect(metadata.configType).toBe("dockerfile");
  });
});

describe("prebuild: image-based rebuild after previous prebuild", () => {
  it("restores original image before re-prebuild when config changes", () => {
    setupImageWorkspace(IMAGE_JSON);
    const mock = createMock();

    // First prebuild
    runPrebuild({ workspaceRoot, subprocess: mock });
    expect(mockCalls).toHaveLength(1);

    // Verify image was rewritten
    let config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
    expect(config).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");

    // Change prebuildFeatures (triggers rebuild)
    const newJson = JSON.stringify({
      image: "lace.local/mcr.microsoft.com/devcontainers/base:ubuntu",  // Already rewritten
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weft/devcontainer-features/wezterm-server:1": {},  // Changed
          },
        },
      },
    }, null, 2);
    writeFileSync(join(devcontainerDir, "devcontainer.json"), newJson, "utf-8");

    // Second prebuild - should restore original first, then rebuild
    const result = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result.exitCode).toBe(0);
    expect(mockCalls).toHaveLength(2);

    // Should NOT have nested lace.local
    config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
    expect(config).not.toContain("lace.local/lace.local");
    expect(config).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");
  });

  it("rebuilds when base image changes", () => {
    setupImageWorkspace(IMAGE_JSON);
    const mock = createMock();

    // First prebuild
    runPrebuild({ workspaceRoot, subprocess: mock });
    expect(mockCalls).toHaveLength(1);

    // Change base image (but keep same prebuildFeatures)
    const newJson = JSON.stringify({
      image: "mcr.microsoft.com/devcontainers/base:jammy",  // Changed from :ubuntu
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
    writeFileSync(join(devcontainerDir, "devcontainer.json"), newJson, "utf-8");

    // Second prebuild - should rebuild due to different base image in temp Dockerfile
    const result = runPrebuild({ workspaceRoot, subprocess: mock });
    expect(result.exitCode).toBe(0);
    expect(mockCalls).toHaveLength(2);

    // Verify the new tag uses the new base image
    const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
    expect(config).toContain("lace.local/mcr.microsoft.com/devcontainers/base:jammy");
  });
});
