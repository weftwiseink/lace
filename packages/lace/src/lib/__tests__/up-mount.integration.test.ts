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

// ── End-to-end mount source resolution ──

describe("lace up: mount source template resolution (end-to-end)", () => {
  it("resolves ${lace.mount.source()} in mounts array and persists assignments", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        mounts: [
          "source=${lace.mount.source(project/data)},target=/data,type=bind",
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
    expect(mounts[0]).not.toContain("${lace.mount.source(");
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
          "source=${lace.mount.source(project/data)},target=/data,type=bind",
          "source=${lace.mount.source(project/cache)},target=/cache,type=bind",
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
    expect(mounts[0]).not.toContain("${lace.mount.source(");
    expect(mounts[1]).not.toContain("${lace.mount.source(");

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
          "source=${lace.mount.source(project/data)},target=/data,type=bind",
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
  it("resolves both ${lace.port()} and ${lace.mount.source()} in the same config", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        },
        mounts: [
          "source=${lace.mount.source(project/data)},target=/data,type=bind",
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
    expect(mounts[0]).not.toContain("${lace.mount.source(");
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
          "source=${lace.mount.source(invalid label)},target=/data,type=bind",
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
          "source=${lace.mount.source(project/data)},target=/data,type=bind",
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
  it("resolves ${lace.mount.source()} in containerEnv values", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        containerEnv: {
          DATA_DIR: "${lace.mount.source(project/data)}",
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
    expect(containerEnv.DATA_DIR).not.toContain("${lace.mount.source(");
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
