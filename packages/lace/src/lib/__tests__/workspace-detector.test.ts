// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyWorkspace,
  resolveGitdirPointer,
  findBareRepoRoot,
  checkAbsolutePaths,
} from "../workspace-detector";
import {
  createBareRepoWorkspace,
  createNormalCloneWorkspace,
} from "../../__tests__/helpers/scenario-utils";

let testDir: string;

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `lace-test-workspace-detector-${suffix}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── classifyWorkspace ──

describe("classifyWorkspace", () => {
  it("detects a normal clone when .git is a directory", () => {
    const root = createNormalCloneWorkspace(testDir, "my-project");

    const result = classifyWorkspace(root);

    expect(result.classification.type).toBe("normal-clone");
    expect(result.warnings).toHaveLength(0);
  });

  it("detects bare-root when .git file points to .bare", () => {
    const { root } = createBareRepoWorkspace(testDir, "my-project", ["main"]);

    const result = classifyWorkspace(root);

    expect(result.classification.type).toBe("bare-root");
    if (result.classification.type === "bare-root") {
      expect(result.classification.bareRepoRoot).toBe(root);
    }
    expect(result.warnings).toHaveLength(0);
  });

  it("detects worktree when .git file points to .bare/worktrees/<name>", () => {
    const { root, worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main", "feature-x"],
    );

    const result = classifyWorkspace(worktrees.main);

    expect(result.classification.type).toBe("worktree");
    if (result.classification.type === "worktree") {
      expect(result.classification.bareRepoRoot).toBe(root);
      expect(result.classification.worktreeName).toBe("main");
      expect(result.classification.usesAbsolutePath).toBe(false);
    }
    expect(result.warnings).toHaveLength(0);
  });

  it("returns not-git when .git is missing", () => {
    const root = join(testDir, "no-git");
    mkdirSync(root, { recursive: true });

    const result = classifyWorkspace(root);

    expect(result.classification.type).toBe("not-git");
    expect(result.warnings).toHaveLength(0);
  });

  it("emits warning for absolute gitdir path in current worktree", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "abs-project",
      ["main"],
      { useAbsolutePaths: true },
    );

    const result = classifyWorkspace(worktrees.main);

    expect(result.classification.type).toBe("worktree");
    if (result.classification.type === "worktree") {
      expect(result.classification.usesAbsolutePath).toBe(true);
    }
    // Should have a warning for the current worktree's absolute path
    const absWarnings = result.warnings.filter(
      (w) => w.code === "absolute-gitdir",
    );
    expect(absWarnings.length).toBeGreaterThanOrEqual(1);
    expect(absWarnings[0].message).toContain("main");
    expect(absWarnings[0].remediation).toContain("git worktree repair");
  });

  it("does not emit warning for relative gitdir path", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "rel-project",
      ["main"],
      { useAbsolutePaths: false },
    );

    const result = classifyWorkspace(worktrees.main);

    expect(result.classification.type).toBe("worktree");
    if (result.classification.type === "worktree") {
      expect(result.classification.usesAbsolutePath).toBe(false);
    }
    const absWarnings = result.warnings.filter(
      (w) => w.code === "absolute-gitdir",
    );
    expect(absWarnings).toHaveLength(0);
  });

  it("returns malformed for .git file without gitdir: prefix", () => {
    const root = join(testDir, "malformed");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, ".git"), "not a gitdir pointer\n", "utf-8");

    const result = classifyWorkspace(root);

    expect(result.classification.type).toBe("malformed");
    if (result.classification.type === "malformed") {
      expect(result.classification.reason).toContain("Unexpected .git file format");
    }
  });

  it("detects non-nikitabobko standard bare repo", () => {
    const root = join(testDir, "standard-bare");
    mkdirSync(join(root, "objects"), { recursive: true });
    mkdirSync(join(root, "refs"), { recursive: true });
    writeFileSync(join(root, "HEAD"), "ref: refs/heads/main\n", "utf-8");
    // No .git file or directory

    const result = classifyWorkspace(root);

    expect(result.classification.type).toBe("standard-bare");
    const stdBareWarnings = result.warnings.filter(
      (w) => w.code === "standard-bare",
    );
    expect(stdBareWarnings).toHaveLength(1);
    expect(stdBareWarnings[0].message).toContain("nikitabobko");
    expect(stdBareWarnings[0].remediation).toBeDefined();
  });
});

// ── resolveGitdirPointer ──

describe("resolveGitdirPointer", () => {
  it("parses relative gitdir path", () => {
    const dotGitPath = join(testDir, ".git");
    writeFileSync(dotGitPath, "gitdir: ./.bare\n", "utf-8");

    const result = resolveGitdirPointer(dotGitPath);

    expect(result.isAbsolute).toBe(false);
    expect(result.rawTarget).toBe("./.bare");
    expect(result.resolvedPath).toBe(join(testDir, ".bare"));
  });

  it("parses absolute gitdir path", () => {
    const dotGitPath = join(testDir, ".git");
    const absTarget = "/absolute/path/to/.bare/worktrees/main";
    writeFileSync(dotGitPath, `gitdir: ${absTarget}\n`, "utf-8");

    const result = resolveGitdirPointer(dotGitPath);

    expect(result.isAbsolute).toBe(true);
    expect(result.rawTarget).toBe(absTarget);
    expect(result.resolvedPath).toBe(absTarget);
  });

  it("throws for file without gitdir: prefix", () => {
    const dotGitPath = join(testDir, ".git");
    writeFileSync(dotGitPath, "something else\n", "utf-8");

    expect(() => resolveGitdirPointer(dotGitPath)).toThrow(
      /Unexpected .git file format/,
    );
  });
});

// ── findBareRepoRoot ──

describe("findBareRepoRoot", () => {
  it("finds bare repo root from worktrees path", () => {
    const { root, worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const worktreeGitStatePath = join(root, ".bare", "worktrees", "main");

    const bareRoot = findBareRepoRoot(worktreeGitStatePath);

    expect(bareRoot).toBe(root);
  });

  it("returns null when no worktrees directory found", () => {
    const bareRoot = findBareRepoRoot("/some/random/path");

    expect(bareRoot).toBeNull();
  });
});

// ── checkAbsolutePaths ──

describe("checkAbsolutePaths", () => {
  it("returns warnings for sibling worktrees with absolute paths", () => {
    const { root } = createBareRepoWorkspace(
      testDir,
      "abs-siblings",
      ["main", "feature-x"],
      { useAbsolutePaths: true },
    );

    // Check from perspective of "main", excluding "main"
    const warnings = checkAbsolutePaths(root, "main");

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("absolute-gitdir");
    expect(warnings[0].message).toContain("feature-x");
  });

  it("returns no warnings when all siblings use relative paths", () => {
    const { root } = createBareRepoWorkspace(
      testDir,
      "rel-siblings",
      ["main", "feature-x"],
      { useAbsolutePaths: false },
    );

    const warnings = checkAbsolutePaths(root, "main");

    expect(warnings).toHaveLength(0);
  });

  it("excludes the specified worktree from checks", () => {
    const { root } = createBareRepoWorkspace(
      testDir,
      "exclude-test",
      ["main", "feature-x"],
      { useAbsolutePaths: true },
    );

    // Exclude "feature-x" — should only warn about "main"
    const warnings = checkAbsolutePaths(root, "feature-x");

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("main");
    expect(warnings[0].message).not.toContain("feature-x");
  });
});
