// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { runUp } from "@/lib/up";
import type { RunSubprocess } from "@/lib/subprocess";
import { clearMetadataCache } from "@/lib/feature-metadata";
import { deriveProjectId } from "@/lib/repo-clones";
import { clearClassificationCache } from "@/lib/workspace-detector";
import {
  createBareRepoWorkspace,
} from "../../__tests__/helpers/scenario-utils";

let workspaceRoot: string;
let devcontainerDir: string;
let laceDir: string;
let metadataCacheDir: string;
let mockCalls: Array<{ command: string; args: string[]; cwd?: string }>;
let createdMountDirs: string[];

function trackProjectMountsDir(wf: string): string {
  const projectId = deriveProjectId(wf);
  const mountsDir = join(homedir(), ".config", "lace", projectId, "mounts");
  createdMountDirs.push(mountsDir);
  return mountsDir;
}

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

function setupWorkspace(config: Record<string, unknown>) {
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(
    join(devcontainerDir, "devcontainer.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

function readGeneratedConfig(): Record<string, unknown> {
  const configPath = join(laceDir, "devcontainer.json");
  return JSON.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `lace-test-up-project-name-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  laceDir = join(workspaceRoot, ".lace");
  metadataCacheDir = join(workspaceRoot, ".metadata-cache");
  mockCalls = [];
  createdMountDirs = [];
  mkdirSync(workspaceRoot, { recursive: true });
  clearMetadataCache(metadataCacheDir);
  clearClassificationCache();

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
  for (const dir of createdMountDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.LACE_SETTINGS;
});

describe("lace up: project name injection", () => {
  it("injects label and --name into runArgs for normal workspace", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupWorkspace({
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generated = readGeneratedConfig();
    const runArgs = generated.runArgs as string[];
    expect(runArgs).toBeDefined();

    // basename of workspaceRoot is the project name
    const expectedName = workspaceRoot.split("/").pop()!;
    expect(runArgs).toContain("--label");
    expect(runArgs).toContain(`lace.project_name=${expectedName}`);
    expect(runArgs).toContain("--name");
  });

  it("preserves user --name in space form", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupWorkspace({
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      runArgs: ["--name", "my-custom"],
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generated = readGeneratedConfig();
    const runArgs = generated.runArgs as string[];

    // User's --name should be preserved
    expect(runArgs).toContain("--name");
    expect(runArgs).toContain("my-custom");

    // Label should still be injected
    expect(runArgs).toContain("--label");
    const labelIdx = runArgs.indexOf("--label");
    expect(runArgs[labelIdx + 1]).toMatch(/^lace\.project_name=/);

    // Should NOT have a second --name
    const nameCount = runArgs.filter((a) => a === "--name").length;
    expect(nameCount).toBe(1);
  });

  it("preserves user --name in equals form", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupWorkspace({
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      runArgs: ["--name=my-custom"],
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generated = readGeneratedConfig();
    const runArgs = generated.runArgs as string[];

    // User's --name= should be preserved
    expect(runArgs).toContain("--name=my-custom");

    // Label should still be injected
    expect(runArgs).toContain("--label");

    // Should NOT inject another --name
    const nameArgs = runArgs.filter(
      (a) => a === "--name" || a.startsWith("--name="),
    );
    expect(nameArgs).toHaveLength(1);
  });

  it("preserves existing runArgs and appends new entries", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupWorkspace({
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      runArgs: ["--label", "other=value", "--cap-add", "SYS_PTRACE"],
    });

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generated = readGeneratedConfig();
    const runArgs = generated.runArgs as string[];

    // Original entries preserved
    expect(runArgs).toContain("other=value");
    expect(runArgs).toContain("--cap-add");
    expect(runArgs).toContain("SYS_PTRACE");

    // New entries appended
    const projectLabelIdx = runArgs.findIndex((a) =>
      a.startsWith("lace.project_name="),
    );
    expect(projectLabelIdx).toBeGreaterThan(-1);
  });

  it("sanitized name differs from label when project name has special chars", async () => {
    // Create a workspace with special chars in the name
    const specialRoot = join(
      tmpdir(),
      `lace-test-up-project-name-${Date.now()}-special`,
      "my project!",
    );
    const specialDevcontainerDir = join(specialRoot, ".devcontainer");
    const specialLaceDir = join(specialRoot, ".lace");
    mkdirSync(specialDevcontainerDir, { recursive: true });
    writeFileSync(
      join(specialDevcontainerDir, "devcontainer.json"),
      JSON.stringify(
        { image: "mcr.microsoft.com/devcontainers/base:ubuntu" },
        null,
        2,
      ),
      "utf-8",
    );

    trackProjectMountsDir(specialRoot);
    process.env.LACE_SETTINGS = join(
      specialRoot,
      ".config",
      "lace",
      "settings.json",
    );

    const result = await runUp({
      workspaceFolder: specialRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generated = JSON.parse(
      readFileSync(join(specialLaceDir, "devcontainer.json"), "utf-8"),
    ) as Record<string, unknown>;
    const runArgs = generated.runArgs as string[];

    // Label uses raw project name (unsanitized)
    const labelIdx = runArgs.indexOf("--label");
    expect(runArgs[labelIdx + 1]).toBe("lace.project_name=my project!");

    // --name uses sanitized version
    const nameIdx = runArgs.indexOf("--name");
    expect(runArgs[nameIdx + 1]).toBe("my-project");

    // Cleanup
    rmSync(specialRoot, { recursive: true, force: true });
  });

  it("uses repo name for worktree workspace WITHOUT layout config (fallback)", async () => {
    // Create a bare-repo workspace with worktree but no customizations.lace.workspace
    const bareWorkspace = createBareRepoWorkspace(
      workspaceRoot,
      "my-project",
      ["main"],
    );
    const worktreeDir = bareWorkspace.worktrees.main;

    // Write devcontainer.json WITHOUT workspace layout config
    const worktreeDevcontainerDir = join(worktreeDir, ".devcontainer");
    mkdirSync(worktreeDevcontainerDir, { recursive: true });
    writeFileSync(
      join(worktreeDevcontainerDir, "devcontainer.json"),
      JSON.stringify(
        {
          image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        },
        null,
        2,
      ),
      "utf-8",
    );

    trackProjectMountsDir(worktreeDir);
    process.env.LACE_SETTINGS = join(
      worktreeDir,
      ".config",
      "lace",
      "settings.json",
    );

    const result = await runUp({
      workspaceFolder: worktreeDir,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generatedPath = join(worktreeDir, ".lace", "devcontainer.json");
    const generated = JSON.parse(
      readFileSync(generatedPath, "utf-8"),
    ) as Record<string, unknown>;
    const runArgs = generated.runArgs as string[];

    // Even without layout config, project name should be "my-project" (repo name)
    // via the classifyWorkspace fallback, not "main" (worktree name)
    const labelIdx = runArgs.indexOf("--label");
    expect(runArgs[labelIdx + 1]).toBe("lace.project_name=my-project");
    const nameIdx = runArgs.indexOf("--name");
    expect(runArgs[nameIdx + 1]).toBe("my-project");
  });

  it("uses repo name (not worktree name) for worktree workspace", async () => {
    // Create a bare-repo workspace with worktree
    const bareWorkspace = createBareRepoWorkspace(
      workspaceRoot,
      "my-project",
      ["main"],
    );
    const worktreeDir = bareWorkspace.worktrees.main;

    // Write devcontainer.json into the worktree
    const worktreeDevcontainerDir = join(worktreeDir, ".devcontainer");
    mkdirSync(worktreeDevcontainerDir, { recursive: true });
    writeFileSync(
      join(worktreeDevcontainerDir, "devcontainer.json"),
      JSON.stringify(
        {
          image: "mcr.microsoft.com/devcontainers/base:ubuntu",
          customizations: {
            lace: { workspace: { layout: "bare-worktree" } },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    trackProjectMountsDir(worktreeDir);
    process.env.LACE_SETTINGS = join(
      worktreeDir,
      ".config",
      "lace",
      "settings.json",
    );

    const result = await runUp({
      workspaceFolder: worktreeDir,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);
    const generatedPath = join(worktreeDir, ".lace", "devcontainer.json");
    const generated = JSON.parse(
      readFileSync(generatedPath, "utf-8"),
    ) as Record<string, unknown>;
    const runArgs = generated.runArgs as string[];

    // Project name should be "my-project" (repo name), not "main" (worktree name)
    expect(runArgs).toContain("--label");
    const labelIdx = runArgs.indexOf("--label");
    expect(runArgs[labelIdx + 1]).toBe("lace.project_name=my-project");
    expect(runArgs).toContain("--name");
    const nameIdx = runArgs.indexOf("--name");
    expect(runArgs[nameIdx + 1]).toBe("my-project");
  });
});
