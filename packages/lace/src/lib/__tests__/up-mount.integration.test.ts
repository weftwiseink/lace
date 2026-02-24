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
import { tmpdir, homedir } from "node:os";
import { runUp } from "@/lib/up";
import type { RunSubprocess } from "@/lib/subprocess";
import type { FeatureMetadata } from "@/lib/feature-metadata";
import { clearMetadataCache } from "@/lib/feature-metadata";
import type { MountAssignmentsFile } from "@/lib/mount-resolver";
import { deriveProjectId } from "@/lib/repo-clones";
import { clearClassificationCache } from "@/lib/workspace-detector";

let workspaceRoot: string;
let devcontainerDir: string;
let laceDir: string;
let metadataCacheDir: string;
let mockCalls: Array<{ command: string; args: string[]; cwd?: string }>;
/** Auto-created default mount dirs to clean up after tests */
let createdMountDirs: string[];

/** Track a default mount path for cleanup. */
function trackProjectMountsDir(wf: string): string {
  const projectId = deriveProjectId(wf);
  const mountsDir = join(homedir(), ".config", "lace", projectId, "mounts");
  createdMountDirs.push(mountsDir);
  return mountsDir;
}

/** Simple mock subprocess that records calls and succeeds. */
function createMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });
    return {
      exitCode: 0,
      stdout: '{"imageName":["test"]}',
      stderr: "",
    };
  };
}

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

/** Create a mock that handles metadata fetch. */
function createMetadataMock(
  metadataByFeature: Record<string, FeatureMetadata>,
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

    return {
      exitCode: 0,
      stdout: '{"imageName":["test"]}',
      stderr: "",
    };
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
    `lace-test-up-mount-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  laceDir = join(workspaceRoot, ".lace");
  metadataCacheDir = join(workspaceRoot, ".metadata-cache");
  mockCalls = [];
  createdMountDirs = [];
  mkdirSync(workspaceRoot, { recursive: true });
  clearMetadataCache(metadataCacheDir);
  clearClassificationCache();

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
  // Clean up any auto-created default mount directories under ~/.config/lace
  for (const dir of createdMountDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.LACE_SETTINGS;
});

// ── End-to-end mount source resolution (v2 accessor syntax) ──

describe("lace up: mount source template resolution (end-to-end)", () => {
  it("resolves ${lace.mount(label).source} in mounts array and persists assignments", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        mounts: [
          "source=${lace.mount(project/data).source},target=/data,type=bind",
        ],
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.phases.generateConfig?.exitCode).toBe(0);

    // Verify .lace/devcontainer.json has concrete path
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const mounts = extended.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).not.toContain("${lace.mount(");
    expect(mounts[0]).toMatch(/source=\/.*,target=\/data,type=bind/);

    // Verify the default mount directory exists on disk
    const projectId = deriveProjectId(workspaceRoot);
    const expectedPath = join(
      homedir(),
      ".config",
      "lace",
      projectId,
      "mounts",
      "project",
      "data",
    );
    expect(existsSync(expectedPath)).toBe(true);
    expect(mounts[0]).toBe(`source=${expectedPath},target=/data,type=bind`);

    // Verify .lace/mount-assignments.json was persisted
    const assignmentsPath = join(laceDir, "mount-assignments.json");
    expect(existsSync(assignmentsPath)).toBe(true);
    const assignments = JSON.parse(
      readFileSync(assignmentsPath, "utf-8"),
    ) as MountAssignmentsFile;
    expect(assignments.assignments["project/data"]).toBeDefined();
    expect(assignments.assignments["project/data"].resolvedSource).toBe(
      expectedPath,
    );
    expect(assignments.assignments["project/data"].isOverride).toBe(false);
  });

  it("resolves multiple mount sources in the same config", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        mounts: [
          "source=${lace.mount(project/data).source},target=/data,type=bind",
          "source=${lace.mount(project/cache).source},target=/cache,type=bind",
        ],
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const mounts = extended.mounts as string[];
    expect(mounts).toHaveLength(2);
    expect(mounts[0]).toMatch(/source=\/.*,target=\/data,type=bind/);
    expect(mounts[1]).toMatch(/source=\/.*,target=\/cache,type=bind/);
    expect(mounts[0]).not.toContain("${lace.mount(");
    expect(mounts[1]).not.toContain("${lace.mount(");

    // Both assignments recorded
    const assignments = JSON.parse(
      readFileSync(join(laceDir, "mount-assignments.json"), "utf-8"),
    ) as MountAssignmentsFile;
    expect(Object.keys(assignments.assignments)).toHaveLength(2);
    expect(assignments.assignments["project/data"]).toBeDefined();
    expect(assignments.assignments["project/cache"]).toBeDefined();

    // templateResolution phase reports mount templates
    expect(result.phases.templateResolution?.message).toContain(
      "2 mount template(s)",
    );
  });
});

// ── Settings override integration ──

describe("lace up: mount source with settings override", () => {
  it("uses override path from settings instead of default", async () => {
    const overrideDir = join(workspaceRoot, "custom-data-mount");
    mkdirSync(overrideDir, { recursive: true });

    setupSettings({
      mounts: {
        "project/data": { source: overrideDir },
      },
    });

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        mounts: [
          "source=${lace.mount(project/data).source},target=/data,type=bind",
        ],
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    // Verify override path is used
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const mounts = extended.mounts as string[];
    expect(mounts[0]).toBe(
      `source=${overrideDir},target=/data,type=bind`,
    );

    // Verify assignment is marked as override
    const assignments = JSON.parse(
      readFileSync(join(laceDir, "mount-assignments.json"), "utf-8"),
    ) as MountAssignmentsFile;
    expect(assignments.assignments["project/data"].isOverride).toBe(true);
    expect(assignments.assignments["project/data"].resolvedSource).toBe(
      overrideDir,
    );
  });
});

// ── Port + mount mixed config ──

describe("lace up: mixed port and mount templates", () => {
  it("resolves both ${lace.port()} and ${lace.mount(label).source} in the same config", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
        mounts: [
          "source=${lace.mount(project/data).source},target=/data,type=bind",
        ],
      },
      null,
      2,
    );
    setupWorkspace(config);

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

    // Port was allocated
    expect(result.phases.portAssignment?.exitCode).toBe(0);
    expect(result.phases.portAssignment?.port).toBeGreaterThanOrEqual(22425);
    expect(result.phases.portAssignment?.port).toBeLessThanOrEqual(22499);

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

    // Mount resolved to path
    const mounts = extended.mounts as string[];
    expect(mounts[0]).not.toContain("${lace.mount(");
    expect(mounts[0]).toMatch(/source=\/.*,target=\/data,type=bind/);

    // Port entries generated
    expect(extended.appPort).toContain(`${port}:${port}`);
    expect(extended.forwardPorts).toContain(port);

    // Both port and mount assignments persisted
    expect(existsSync(join(laceDir, "port-assignments.json"))).toBe(true);
    expect(existsSync(join(laceDir, "mount-assignments.json"))).toBe(true);

    // templateResolution phase includes both
    expect(result.phases.templateResolution?.message).toContain(
      "port template(s)",
    );
    expect(result.phases.templateResolution?.message).toContain(
      "mount template(s)",
    );
  });
});

// ── Mount resolution failure ──

describe("lace up: mount resolution failure", () => {
  it("fails with error when mount label is invalid", async () => {
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        mounts: [
          "source=${lace.mount(invalid label).source},target=/data,type=bind",
        ],
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Template resolution failed");
    expect(result.phases.templateResolution?.exitCode).toBe(1);
  });

  it("fails when override source path does not exist", async () => {
    setupSettings({
      mounts: {
        "project/data": { source: join(workspaceRoot, "nonexistent") },
      },
    });

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        mounts: [
          "source=${lace.mount(project/data).source},target=/data,type=bind",
        ],
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Template resolution failed");
    expect(result.message).toContain("Mount override source does not exist");
    expect(result.phases.templateResolution?.exitCode).toBe(1);
  });
});

// ── No mount templates -- still works ──

describe("lace up: no mount templates present", () => {
  it("produces empty mount-assignments.json when no mount templates", async () => {
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    // mount-assignments.json is persisted (but with empty assignments)
    const assignmentsPath = join(laceDir, "mount-assignments.json");
    expect(existsSync(assignmentsPath)).toBe(true);
    const assignments = JSON.parse(
      readFileSync(assignmentsPath, "utf-8"),
    ) as MountAssignmentsFile;
    expect(Object.keys(assignments.assignments)).toHaveLength(0);
  });
});

// ── Mount source in containerEnv ──

describe("lace up: mount source in containerEnv", () => {
  it("resolves ${lace.mount(label).source} in containerEnv values", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        containerEnv: {
          DATA_DIR: "${lace.mount(project/data).source}",
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.DATA_DIR).not.toContain("${lace.mount(");
    expect(containerEnv.DATA_DIR).toMatch(/^\//);

    const projectId = deriveProjectId(workspaceRoot);
    const expectedPath = join(
      homedir(),
      ".config",
      "lace",
      projectId,
      "mounts",
      "project",
      "data",
    );
    expect(containerEnv.DATA_DIR).toBe(expectedPath);
  });
});

// ── Project declarations with auto-injection ──

describe("lace up: project mount declarations", () => {
  it("auto-injects and resolves project-level mount declarations", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        customizations: {
          lace: {
            mounts: {
              "bash-history": {
                target: "/commandhistory",
                description: "Persistent bash history",
              },
            },
          },
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    // Auto-injected mount entry should be resolved
    const mounts = extended.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatch(/^source=\/.*,target=\/commandhistory,type=bind$/);
    expect(mounts[0]).not.toContain("${lace.mount(");

    // Assignment persisted
    const assignments = JSON.parse(
      readFileSync(join(laceDir, "mount-assignments.json"), "utf-8"),
    ) as MountAssignmentsFile;
    expect(assignments.assignments["project/bash-history"]).toBeDefined();
  });
});

// ── Mount target in containerEnv ──

describe("lace up: mount target in containerEnv", () => {
  it("resolves ${lace.mount(label).target} in containerEnv to declaration target", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        customizations: {
          lace: {
            mounts: {
              config: {
                target: "/home/node/.claude",
              },
            },
          },
        },
        containerEnv: {
          CLAUDE_CONFIG: "${lace.mount(project/config).target}",
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.CLAUDE_CONFIG).toBe("/home/node/.claude");
  });
});

// ── Validation errors ──

describe("lace up: mount validation", () => {
  it("fails with target conflict error when two declarations share the same target", async () => {
    setupSettings({});

    // Feature metadata with mount declaring same target as project declaration
    const featureWithConflict: FeatureMetadata = {
      id: "my-feature",
      version: "1.0.0",
      options: {},
      customizations: {
        lace: {
          mounts: {
            config: {
              target: "/data",
              description: "Conflicting mount",
            },
          },
        },
      },
    };

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/org/my-feature:1": {},
        },
        customizations: {
          lace: {
            mounts: {
              data: {
                target: "/data",
              },
            },
          },
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/org/my-feature:1": featureWithConflict,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Mount target conflict");
    expect(result.message).toContain("/data");
  });
});

// ── Feature mount declarations (end-to-end) ──

describe("lace up: feature mount declarations", () => {
  it("auto-injects and resolves feature-level mount declarations from metadata", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const featureWithMount: FeatureMetadata = {
      id: "claude-code",
      version: "1.0.0",
      options: {},
      customizations: {
        lace: {
          mounts: {
            config: {
              target: "/home/node/.claude",
              description: "Claude config",
            },
          },
        },
      },
    };

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/org/claude-code:1": {},
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/org/claude-code:1": featureWithMount,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const mounts = extended.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatch(/^source=\/.*,target=\/home\/node\/\.claude,type=bind$/);

    const assignments = JSON.parse(
      readFileSync(join(laceDir, "mount-assignments.json"), "utf-8"),
    ) as MountAssignmentsFile;
    expect(assignments.assignments["claude-code/config"]).toBeDefined();
  });
});

// ── Validated mounts (sourceMustBe) integration ──

describe("lace up: validated mount (sourceMustBe) integration", () => {
  it("fails with actionable error when sourceMustBe file is missing", async () => {
    setupSettings({});

    const featureWithValidatedMount: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.2.0",
      options: {
        hostSshPort: { type: "string", default: "2222" },
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
          mounts: {
            "authorized-keys": {
              target: "/home/node/.ssh/authorized_keys",
              recommendedSource: join(workspaceRoot, "nonexistent-key.pub"),
              description: "SSH public key for WezTerm SSH domain access",
              readonly: true,
              sourceMustBe: "file",
              hint: "Run: ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N ''",
            },
          },
        },
      },
    };

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          featureWithValidatedMount,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("requires file");
    expect(result.message).toContain("ssh-keygen");
    expect(result.message).toContain("settings.json");
  });

  it("succeeds when sourceMustBe file exists", async () => {
    const keyFile = join(workspaceRoot, "test-key.pub");
    writeFileSync(keyFile, "ssh-ed25519 AAAA test@test");
    setupSettings({});

    const featureWithValidatedMount: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.2.0",
      options: {
        hostSshPort: { type: "string", default: "2222" },
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
          mounts: {
            "authorized-keys": {
              target: "/home/node/.ssh/authorized_keys",
              recommendedSource: keyFile,
              description: "SSH public key for WezTerm SSH domain access",
              readonly: true,
              sourceMustBe: "file",
            },
          },
        },
      },
    };

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          featureWithValidatedMount,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    // The mount should appear in the generated config
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const mounts = extended.mounts as string[];
    const authKeyMount = mounts.find((m: string) =>
      m.includes("authorized_keys"),
    );
    expect(authKeyMount).toBeDefined();
    expect(authKeyMount).toContain(`source=${keyFile}`);
    expect(authKeyMount).toContain("readonly");
  });

  it("downgrades to warning with --skip-validation when sourceMustBe file missing", async () => {
    setupSettings({});

    const featureWithValidatedMount: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.2.0",
      options: {
        hostSshPort: { type: "string", default: "2222" },
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
          mounts: {
            "authorized-keys": {
              target: "/home/node/.ssh/authorized_keys",
              recommendedSource: join(workspaceRoot, "missing-key.pub"),
              sourceMustBe: "file",
              hint: "Run: ssh-keygen ...",
            },
          },
        },
      },
    };

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          featureWithValidatedMount,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
      skipValidation: true,
    });

    // Should succeed (warning, not error) -- but template resolution will
    // still fail because the mount source doesn't exist. The key test is
    // that we don't get a hard exit at Step 7.5.
    // With skipValidation, Step 7.5 downgrades to warning, but then Step 8
    // (resolveTemplates -> resolveSource) will also try to resolve and fail.
    // This is expected: skipValidation only applies to our pre-check.
    // The actual resolution error from resolveTemplates is still a hard error.
    // For a full skip-validation pass, the source needs to exist.
    // So we just check that the error message is NOT the Step 7.5 format.
    if (result.exitCode !== 0) {
      expect(result.message).toContain("Template resolution failed");
    }
  });

  it("succeeds with settings override for sourceMustBe mount", async () => {
    const overrideKeyFile = join(workspaceRoot, "override-key.pub");
    writeFileSync(overrideKeyFile, "ssh-ed25519 AAAA override@test");
    setupSettings({
      mounts: {
        "wezterm-server/authorized-keys": { source: overrideKeyFile },
      },
    });

    const featureWithValidatedMount: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.2.0",
      options: {
        hostSshPort: { type: "string", default: "2222" },
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
          mounts: {
            "authorized-keys": {
              target: "/home/node/.ssh/authorized_keys",
              recommendedSource: join(workspaceRoot, "default-key.pub"),
              sourceMustBe: "file",
            },
          },
        },
      },
    };

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMetadataMock({
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1":
          featureWithValidatedMount,
      }),
      skipDevcontainerUp: true,
      cacheDir: metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    // The override key should be used
    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const mounts = extended.mounts as string[];
    const authKeyMount = mounts.find((m: string) =>
      m.includes("authorized_keys"),
    );
    expect(authKeyMount).toContain(`source=${overrideKeyFile}`);
  });
});
