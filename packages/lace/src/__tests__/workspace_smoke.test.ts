/**
 * Workspace smoke tests — acceptance tests against real git repositories.
 *
 * These tests scaffold real git bare-repo and normal-clone structures using
 * `git init --bare`, `git worktree add`, etc., then verify that the workspace
 * detection and lace up pipeline work correctly against authentic git-produced
 * filesystem layouts.
 *
 * Unlike the unit tests in workspace-detector.test.ts which use fabricated
 * filesystem stubs, these tests exercise real git metadata (pack files, config,
 * worktree linkage) to confirm the filesystem-only detection approach handles
 * all of it.
 *
 * Set LACE_TEST_KEEP_FIXTURES=1 to preserve temp directories for manual inspection.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { classifyWorkspace } from "@/lib/workspace-detector";
import { runUp } from "@/lib/up";
import type { RunSubprocess } from "@/lib/subprocess";

// ── Git availability gate ──

const gitAvailable = (() => {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

// ── Fixture lifecycle ──

const KEEP_FIXTURES = process.env.LACE_TEST_KEEP_FIXTURES === "1";

let fixtureRoot: string;

// ── Fixture helpers (local to this file — require git binary) ──

interface RealBareWorktreeRepo {
  root: string;
  worktrees: Record<string, string>;
  bareDir: string;
}

/**
 * Create a real bare-worktree repo using the nikitabobko convention.
 * Uses actual git commands to produce authentic filesystem structures.
 */
function createRealBareWorktreeRepo(
  parentDir: string,
  name: string,
  worktreeNames: string[] = ["main"],
): RealBareWorktreeRepo {
  const root = join(parentDir, name);
  mkdirSync(root, { recursive: true });

  const bareDir = join(root, ".bare");

  // Initialize bare repo and set default branch to main
  execSync(`git init --bare "${bareDir}"`, { stdio: "pipe" });
  execSync(`git -C "${bareDir}" symbolic-ref HEAD refs/heads/main`, {
    stdio: "pipe",
  });

  // Write the .git file pointer (nikitabobko convention)
  writeFileSync(join(root, ".git"), "gitdir: ./.bare\n", "utf-8");

  // Create an initial commit using plumbing commands (bare repos have no work tree)
  const emptyTree = execSync(
    `git -C "${bareDir}" hash-object -t tree --stdin`,
    { input: "", stdio: ["pipe", "pipe", "pipe"] },
  ).toString().trim();
  const commit = execSync(
    `git -C "${bareDir}" commit-tree ${emptyTree} -m "initial commit"`,
    {
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    },
  ).toString().trim();
  execSync(`git -C "${bareDir}" update-ref refs/heads/main ${commit}`, {
    stdio: "pipe",
  });

  // Add worktrees — first one checks out main, others create new branches
  const worktrees: Record<string, string> = {};
  for (const wtName of worktreeNames) {
    const worktreeDir = join(root, wtName);
    if (wtName === "main") {
      // Check out the existing main branch
      execSync(
        `git -C "${bareDir}" worktree add "${worktreeDir}" main`,
        { stdio: "pipe" },
      );
    } else {
      // Create a new branch based on main
      execSync(
        `git -C "${bareDir}" worktree add -b "${wtName}" "${worktreeDir}" main`,
        { stdio: "pipe" },
      );
    }
    worktrees[wtName] = worktreeDir;
  }

  return { root, worktrees, bareDir };
}

/**
 * Create a real normal git clone (standard .git directory, not a file).
 */
function createRealNormalClone(
  parentDir: string,
  name: string,
): string {
  const root = join(parentDir, name);
  execSync(`git init "${root}"`, { stdio: "pipe" });
  execSync(
    `git -C "${root}" commit --allow-empty -m "initial commit"`,
    {
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    },
  );
  return root;
}

// ── Mock subprocess for pipeline tests ──

function createMockSubprocess(): RunSubprocess {
  return (command, args, opts) => {
    // Handle metadata fetch
    if (
      command === "devcontainer" &&
      args[0] === "features" &&
      args[1] === "info" &&
      args[2] === "manifest"
    ) {
      return { exitCode: 1, stdout: "", stderr: "Error: feature not found" };
    }
    return { exitCode: 0, stdout: '{"imageName":["test"]}', stderr: "" };
  };
}

// ── Tests ──

describe.skipIf(!gitAvailable)("workspace smoke tests", () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "lace-smoke-workspace-"));
    if (KEEP_FIXTURES) {
      console.log(
        `LACE_TEST_KEEP_FIXTURES=1 — fixtures at: ${fixtureRoot}`,
      );
    }
  });

  afterAll(() => {
    if (!KEEP_FIXTURES) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    } else {
      console.log(`Fixtures preserved at: ${fixtureRoot}`);
    }
  });

  // ── Section 1: Workspace detection against real git structures ──

  describe("workspace detection — real git repos", () => {
    it("classifies real normal clone", () => {
      const root = createRealNormalClone(fixtureRoot, "normal-clone");
      const result = classifyWorkspace(root);
      expect(result.classification.type).toBe("normal-clone");
    });

    it("classifies real bare-root", () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "bare-root-test",
        [],
      );
      const result = classifyWorkspace(repo.root);
      expect(result.classification.type).toBe("bare-root");
      if (result.classification.type === "bare-root") {
        expect(result.classification.bareRepoRoot).toBe(resolve(repo.root));
      }
    });

    it("classifies real worktree", () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "worktree-test",
        ["main"],
      );
      const result = classifyWorkspace(repo.worktrees.main);
      expect(result.classification.type).toBe("worktree");
      if (result.classification.type === "worktree") {
        expect(result.classification.bareRepoRoot).toBe(resolve(repo.root));
        expect(result.classification.worktreeName).toBe("main");
      }
    });

    it("classifies real standard bare repo", () => {
      const bareDir = join(fixtureRoot, "standard-bare");
      execSync(`git init --bare "${bareDir}"`, { stdio: "pipe" });
      const result = classifyWorkspace(bareDir);
      expect(result.classification.type).toBe("standard-bare");
    });

    it("detects multiple worktrees with same bare-root", () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "multi-worktree",
        ["main", "develop", "feature-x"],
      );
      const resolvedRoot = resolve(repo.root);

      for (const name of ["main", "develop", "feature-x"]) {
        const result = classifyWorkspace(repo.worktrees[name]);
        expect(result.classification.type).toBe("worktree");
        if (result.classification.type === "worktree") {
          expect(result.classification.bareRepoRoot).toBe(resolvedRoot);
          expect(result.classification.worktreeName).toBe(name);
        }
      }
    });

    it("handles worktree with slashes in branch name", () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "slash-branch",
        ["main"],
      );
      // Create a worktree with a slash in the branch name but a flat directory name
      const featureDir = join(repo.root, "feature-foo");
      execSync(
        `git -C "${repo.bareDir}" worktree add "${featureDir}" -b "feature/foo"`,
        { stdio: "pipe" },
      );

      const result = classifyWorkspace(featureDir);
      expect(result.classification.type).toBe("worktree");
      if (result.classification.type === "worktree") {
        // worktreeName is the directory basename, not the branch name
        expect(result.classification.worktreeName).toBe("feature-foo");
      }
    });

    it("handles detached HEAD worktree", () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "detached-head",
        ["main"],
      );
      const detachedDir = join(repo.root, "detached");
      execSync(
        `git -C "${repo.bareDir}" worktree add --detach "${detachedDir}"`,
        { stdio: "pipe" },
      );

      const result = classifyWorkspace(detachedDir);
      expect(result.classification.type).toBe("worktree");
      if (result.classification.type === "worktree") {
        expect(result.classification.worktreeName).toBe("detached");
      }
    });
  });

  // ── Section 2: Full pipeline with real bare-worktree repos ──

  describe("lace up pipeline — real bare-worktree repos", () => {
    it("generates workspaceMount + workspaceFolder for worktree", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "pipeline-worktree",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      // Write devcontainer.json inside the worktree
      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: { workspace: { layout: "bare-worktree" } },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-pipeline-worktree"),
      });

      expect(result.exitCode).toBe(0);
      expect(result.phases.workspaceLayout).toBeDefined();
      expect(result.phases.workspaceLayout?.exitCode).toBe(0);

      const generated = JSON.parse(
        readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
      );
      expect(generated.workspaceMount).toBe(
        `source=${resolve(repo.root)},target=/workspace,type=bind,consistency=delegated`,
      );
      expect(generated.workspaceFolder).toBe("/workspace/main");
    });

    it("generates correct config for bare-root entry", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "pipeline-bare-root",
        [],
      );

      const devcontainerDir = join(repo.root, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: { workspace: { layout: "bare-worktree" } },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: repo.root,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-pipeline-bare-root"),
      });

      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(
        readFileSync(join(repo.root, ".lace", "devcontainer.json"), "utf-8"),
      );
      // bare-root: workspaceFolder = mountTarget (no worktree suffix)
      expect(generated.workspaceFolder).toBe("/workspace");
    });

    it("injects safe.directory into postCreateCommand", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "pipeline-safedir",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: { workspace: { layout: "bare-worktree" } },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-pipeline-safedir"),
      });

      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(
        readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
      );
      expect(generated.postCreateCommand).toContain("safe.directory");
    });

    it("injects scanDepth into VS Code settings", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "pipeline-scandepth",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: { workspace: { layout: "bare-worktree" } },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-pipeline-scandepth"),
      });

      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(
        readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
      );
      const vscodeSettings = (
        generated.customizations as Record<string, Record<string, Record<string, unknown>>>
      )?.vscode?.settings;
      expect(vscodeSettings?.["git.repositoryScanMaxDepth"]).toBe(2);
    });

    it("respects custom mountTarget", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "pipeline-mounttarget",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: {
              workspace: { layout: "bare-worktree", mountTarget: "/src" },
            },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-pipeline-mounttarget"),
      });

      expect(result.exitCode).toBe(0);
      const generated = JSON.parse(
        readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
      );
      expect(generated.workspaceMount).toContain("target=/src,");
      expect(generated.workspaceFolder).toBe("/src/main");
    });
  });

  // ── Section 3: Combined end-to-end scenarios ──

  describe("lace up pipeline — combined workspace + validation", () => {
    it("full happy path: bare-worktree + validation + mounts", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "e2e-happy",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      // Create a file that host validation will check for
      const validatedFile = join(fixtureRoot, "e2e-happy-key.pub");
      writeFileSync(validatedFile, "ssh-ed25519 AAAA test@test\n", "utf-8");

      // Create a directory for bind mount source
      const mountSource = join(fixtureRoot, "e2e-happy-data");
      mkdirSync(mountSource, { recursive: true });

      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          mounts: [
            `source=${mountSource},target=/mnt/data,type=bind`,
          ],
          customizations: {
            lace: {
              workspace: { layout: "bare-worktree" },
              validate: {
                fileExists: [
                  {
                    path: validatedFile,
                    severity: "error",
                    hint: "Create the key file",
                  },
                ],
              },
            },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-e2e-happy"),
      });

      expect(result.exitCode).toBe(0);
      expect(result.phases.workspaceLayout?.exitCode).toBe(0);
      expect(result.phases.hostValidation?.exitCode).toBe(0);
      expect(result.phases.generateConfig).toBeDefined();

      const generated = JSON.parse(
        readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
      );
      expect(generated.workspaceMount).toBeDefined();
      expect(generated.workspaceFolder).toBe("/workspace/main");
    });

    it("validation failure halts pipeline", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "e2e-fail",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: {
              workspace: { layout: "bare-worktree" },
              validate: {
                fileExists: [
                  {
                    path: "/nonexistent/file/that/does/not/exist.key",
                    severity: "error",
                    hint: "This file is missing on purpose",
                  },
                ],
              },
            },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        cacheDir: join(fixtureRoot, ".cache-e2e-fail"),
      });

      expect(result.exitCode).toBe(1);
      // Phase 0a (workspace layout) should have succeeded
      expect(result.phases.workspaceLayout?.exitCode).toBe(0);
      // Phase 0b (host validation) should have failed
      expect(result.phases.hostValidation?.exitCode).toBe(1);
      // Later phases should be absent (pipeline halted)
      expect(result.phases.generateConfig).toBeUndefined();
    });

    it("skip-validation allows pipeline to continue", async () => {
      const repo = createRealBareWorktreeRepo(
        fixtureRoot,
        "e2e-skip",
        ["main"],
      );
      const worktreeDir = repo.worktrees.main;

      const devcontainerDir = join(worktreeDir, ".devcontainer");
      mkdirSync(devcontainerDir, { recursive: true });
      writeFileSync(
        join(devcontainerDir, "devcontainer.json"),
        JSON.stringify({
          image: "node:24-bookworm",
          customizations: {
            lace: {
              workspace: { layout: "bare-worktree" },
              validate: {
                fileExists: [
                  {
                    path: "/nonexistent/file/that/does/not/exist.key",
                    severity: "error",
                    hint: "This file is missing on purpose",
                  },
                ],
              },
            },
          },
        }),
        "utf-8",
      );

      const result = await runUp({
        workspaceFolder: worktreeDir,
        subprocess: createMockSubprocess(),
        skipDevcontainerUp: true,
        skipValidation: true,
        cacheDir: join(fixtureRoot, ".cache-e2e-skip"),
      });

      expect(result.exitCode).toBe(0);
      // Host validation downgraded to warning
      expect(result.phases.hostValidation?.exitCode).toBe(0);
      expect(result.phases.hostValidation?.message).toContain("warning");
      // Workspace layout and config generation both present
      expect(result.phases.workspaceLayout?.exitCode).toBe(0);
      expect(result.phases.generateConfig).toBeDefined();

      const generated = JSON.parse(
        readFileSync(join(worktreeDir, ".lace", "devcontainer.json"), "utf-8"),
      );
      expect(generated.workspaceMount).toBeDefined();
      expect(generated.workspaceFolder).toBe("/workspace/main");
    });
  });
});
