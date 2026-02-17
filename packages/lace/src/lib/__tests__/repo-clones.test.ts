// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { RunSubprocess } from "@/lib/subprocess";
import {
  deriveProjectId,
  sanitizeProjectId,
  getClonePath,
  getReposDir,
  cloneRepo,
  updateRepo,
  ensureRepo,
  getRepoSourcePath,
  RepoCloneError,
} from "@/lib/repo-clones";
import { classifyWorkspace, clearClassificationCache } from "@/lib/workspace-detector";
import {
  createBareRepoWorkspace,
  createNormalCloneWorkspace,
} from "../../__tests__/helpers/scenario-utils";

let testDir: string;

beforeEach(() => {
  clearClassificationCache();
  testDir = join(
    tmpdir(),
    `lace-test-clones-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// --- Project ID derivation ---

describe("deriveProjectId", () => {
  it("extracts basename from simple path", () => {
    expect(deriveProjectId("/home/user/code/weft/lace")).toBe("lace");
  });

  it("sanitizes special characters", () => {
    expect(deriveProjectId("/home/user/code/My Project!")).toBe("my-project");
  });

  it("uses last segment of nested path", () => {
    expect(deriveProjectId("/a/b/c/d")).toBe("d");
  });

  it("handles trailing slash", () => {
    expect(deriveProjectId("/home/user/code/lace/")).toBe("lace");
  });

  it("collapses consecutive dashes", () => {
    expect(deriveProjectId("/home/user/code/my--project")).toBe("my-project");
  });

  it("converts to lowercase", () => {
    expect(deriveProjectId("/home/user/code/MyProject")).toBe("myproject");
  });

  it("handles numbers", () => {
    expect(deriveProjectId("/home/user/code/project123")).toBe("project123");
  });
});

// --- sanitizeProjectId (pure function) ---

describe("sanitizeProjectId", () => {
  it("lowercases input", () => {
    expect(sanitizeProjectId("MyProject")).toBe("myproject");
  });

  it("replaces non-alphanumeric with hyphens and strips trailing dash", () => {
    expect(sanitizeProjectId("my project!")).toBe("my-project");
  });

  it("strips trailing hyphens", () => {
    expect(sanitizeProjectId("project!")).toBe("project");
    expect(sanitizeProjectId("project---")).toBe("project");
  });

  it("strips leading hyphens", () => {
    expect(sanitizeProjectId("!project")).toBe("project");
    expect(sanitizeProjectId("---project")).toBe("project");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeProjectId("my--project")).toBe("my-project");
  });

  it("handles already-clean input", () => {
    expect(sanitizeProjectId("lace")).toBe("lace");
  });

  it("handles numbers", () => {
    expect(sanitizeProjectId("project123")).toBe("project123");
  });

  it("is idempotent", () => {
    const once = sanitizeProjectId("My Project!");
    expect(sanitizeProjectId(once)).toBe(once);
  });
});

// --- deriveProjectId with worktree awareness ---

describe("deriveProjectId worktree awareness", () => {
  it("returns bare-repo basename for worktree workspace", () => {
    const { worktrees } = createBareRepoWorkspace(testDir, "lace", ["main", "feature-x"]);
    expect(deriveProjectId(worktrees.main)).toBe("lace");
    expect(deriveProjectId(worktrees["feature-x"])).toBe("lace");
  });

  it("returns basename for normal clone", () => {
    const root = createNormalCloneWorkspace(testDir, "my-project");
    expect(deriveProjectId(root)).toBe("my-project");
  });

  it("returns basename for non-git directory", () => {
    const dir = join(testDir, "some-folder");
    mkdirSync(dir, { recursive: true });
    expect(deriveProjectId(dir)).toBe("some-folder");
  });

  it("handles trailing slash on worktree path", () => {
    const { worktrees } = createBareRepoWorkspace(testDir, "lace", ["main"]);
    expect(deriveProjectId(worktrees.main + "/")).toBe("lace");
  });
});

// --- Classification cache ---

describe("classification cache", () => {
  it("returns identical object reference on repeated calls", () => {
    const dir = join(testDir, "cached-test");
    mkdirSync(dir, { recursive: true });
    const first = classifyWorkspace(dir);
    const second = classifyWorkspace(dir);
    expect(first).toBe(second); // same reference
  });

  it("normalizes trailing slashes for cache key", () => {
    const dir = join(testDir, "slash-test");
    mkdirSync(dir, { recursive: true });
    const withoutSlash = classifyWorkspace(dir);
    const withSlash = classifyWorkspace(dir + "/");
    expect(withoutSlash).toBe(withSlash);
  });

  it("clears with clearClassificationCache", () => {
    const dir = join(testDir, "clear-test");
    mkdirSync(dir, { recursive: true });
    const first = classifyWorkspace(dir);
    clearClassificationCache();
    const second = classifyWorkspace(dir);
    expect(first).not.toBe(second); // different reference
    expect(first).toEqual(second); // same content
  });
});

// --- Path generation ---

describe("getClonePath", () => {
  it("generates correct path", () => {
    const result = getClonePath("lace", "dotfiles");
    expect(result).toBe(join(homedir(), ".config/lace/lace/repos/dotfiles"));
  });
});

describe("getReposDir", () => {
  it("generates correct path", () => {
    const result = getReposDir("lace");
    expect(result).toBe(join(homedir(), ".config/lace/lace/repos"));
  });
});

// --- Clone repo ---

describe("cloneRepo", () => {
  it("clones a repo successfully", () => {
    const targetDir = join(testDir, "clones", "dotfiles");

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = cloneRepo({
      repoId: "github.com/user/dotfiles",
      targetDir,
      subprocess: mockSubprocess,
    });

    expect(result.success).toBe(true);
    expect(result.cloneDir).toBe(targetDir);
    expect(result.subdirectory).toBeUndefined();

    // Verify git was called correctly
    expect(mockSubprocess).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "https://github.com/user/dotfiles.git", targetDir],
    );
  });

  it("throws on clone failure", () => {
    const targetDir = join(testDir, "clones", "private-repo");

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Authentication failed",
    }));

    expect(() =>
      cloneRepo({
        repoId: "github.com/user/private-repo",
        targetDir,
        subprocess: mockSubprocess,
      }),
    ).toThrow(RepoCloneError);
    expect(() =>
      cloneRepo({
        repoId: "github.com/user/private-repo",
        targetDir,
        subprocess: mockSubprocess,
      }),
    ).toThrow(/Failed to clone repo/);
  });

  it("verifies subdirectory exists after clone", () => {
    const targetDir = join(testDir, "clones", "monorepo");

    // Create the target dir with subdirectory to simulate successful clone
    mkdirSync(join(targetDir, "plugins", "my-plugin"), { recursive: true });

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = cloneRepo({
      repoId: "github.com/user/monorepo/plugins/my-plugin",
      targetDir,
      subprocess: mockSubprocess,
    });

    expect(result.success).toBe(true);
    expect(result.subdirectory).toBe("plugins/my-plugin");
  });

  it("throws if subdirectory does not exist", () => {
    const targetDir = join(testDir, "clones", "monorepo");

    // Create the target dir WITHOUT the subdirectory
    mkdirSync(targetDir, { recursive: true });

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    expect(() =>
      cloneRepo({
        repoId: "github.com/user/monorepo/nonexistent/path",
        targetDir,
        subprocess: mockSubprocess,
      }),
    ).toThrow(RepoCloneError);
    expect(() =>
      cloneRepo({
        repoId: "github.com/user/monorepo/nonexistent/path",
        targetDir,
        subprocess: mockSubprocess,
      }),
    ).toThrow(/subdirectory does not exist/);
  });
});

// --- Update repo ---

describe("updateRepo", () => {
  it("updates an existing clone successfully", () => {
    const cloneDir = join(testDir, "existing-clone");
    mkdirSync(cloneDir, { recursive: true });

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = updateRepo({
      cloneDir,
      repoId: "github.com/user/repo",
      subprocess: mockSubprocess,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);

    // Verify both commands were called
    expect(mockSubprocess).toHaveBeenCalledTimes(2);
    expect(mockSubprocess).toHaveBeenNthCalledWith(
      1,
      "git",
      ["fetch", "--depth", "1", "origin"],
      { cwd: cloneDir },
    );
    expect(mockSubprocess).toHaveBeenNthCalledWith(
      2,
      "git",
      ["reset", "--hard", "origin/HEAD"],
      { cwd: cloneDir },
    );
  });

  it("warns and continues on fetch failure", () => {
    const cloneDir = join(testDir, "existing-clone");
    mkdirSync(cloneDir, { recursive: true });

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 1,
      stdout: "",
      stderr: "Network error",
    }));

    const result = updateRepo({
      cloneDir,
      repoId: "github.com/user/repo",
      subprocess: mockSubprocess,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("Warning");
    expect(result.message).toContain("Using cached version");

    // Only fetch was called, not reset
    expect(mockSubprocess).toHaveBeenCalledTimes(1);
  });

  it("throws on reset failure", () => {
    const cloneDir = join(testDir, "corrupted-clone");
    mkdirSync(cloneDir, { recursive: true });

    let callCount = 0;
    const mockSubprocess: RunSubprocess = vi.fn(() => {
      callCount++;
      if (callCount % 2 === 1) {
        // Odd calls (fetch) succeed
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      // Even calls (reset) fail
      return { exitCode: 1, stdout: "", stderr: "error: cannot reset" };
    });

    expect(() =>
      updateRepo({
        cloneDir,
        repoId: "github.com/user/repo",
        subprocess: mockSubprocess,
      }),
    ).toThrow(RepoCloneError);

    // Reset for second check
    callCount = 0;
    expect(() =>
      updateRepo({
        cloneDir,
        repoId: "github.com/user/repo",
        subprocess: mockSubprocess,
      }),
    ).toThrow(/reset failed/);
  });

  it("throws if clone directory does not exist", () => {
    const cloneDir = join(testDir, "nonexistent");

    expect(() =>
      updateRepo({
        cloneDir,
        repoId: "github.com/user/repo",
        subprocess: vi.fn(),
      }),
    ).toThrow(RepoCloneError);
    expect(() =>
      updateRepo({
        cloneDir,
        repoId: "github.com/user/repo",
        subprocess: vi.fn(),
      }),
    ).toThrow(/does not exist/);
  });
});

// --- Ensure repo ---

describe("ensureRepo", () => {
  it("clones new repo when no existing clone", () => {
    const targetDir = join(testDir, "clones", "new-repo");

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = ensureRepo({
      repoId: "github.com/user/new-repo",
      targetDir,
      subprocess: mockSubprocess,
    });

    expect(result.success).toBe(true);
    expect(mockSubprocess).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone"]),
    );
  });

  it("updates existing clone when .git exists", () => {
    const targetDir = join(testDir, "clones", "existing-repo");
    mkdirSync(join(targetDir, ".git"), { recursive: true });

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = ensureRepo({
      repoId: "github.com/user/existing-repo",
      targetDir,
      subprocess: mockSubprocess,
    });

    expect(result.success).toBe(true);
    expect(mockSubprocess).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["fetch"]),
      expect.anything(),
    );
  });
});

// --- Repo source path ---

describe("getRepoSourcePath", () => {
  it("returns clone dir when no subdirectory", () => {
    expect(getRepoSourcePath("/path/to/clone")).toBe("/path/to/clone");
  });

  it("returns subdirectory path when specified", () => {
    expect(getRepoSourcePath("/path/to/clone", "plugins/foo")).toBe(
      "/path/to/clone/plugins/foo",
    );
  });
});
