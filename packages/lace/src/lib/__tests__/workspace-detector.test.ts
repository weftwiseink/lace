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
  parseGitConfigExtensions,
  checkGitExtensions,
  clearClassificationCache,
  compareVersions,
  verifyContainerGitVersion,
  getDetectedExtensions,
} from "../workspace-detector";
import type { RunSubprocess } from "../subprocess";
import {
  createBareRepoWorkspace,
  createNormalCloneWorkspace,
} from "../../__tests__/helpers/scenario-utils";

let testDir: string;

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `lace-test-workspace-detector-${suffix}`);
  mkdirSync(testDir, { recursive: true });
  clearClassificationCache();
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

// ── parseGitConfigExtensions ──

describe("parseGitConfigExtensions", () => {
  it("parses standard config with extensions section", () => {
    const config = `[core]
\trepositoryformatversion = 1
\tbare = true
[extensions]
\trelativeWorktrees = true
`;
    const result = parseGitConfigExtensions(config);

    expect(result.formatVersion).toBe(1);
    expect(result.extensions).toEqual({ relativeworktrees: "true" });
  });

  it("returns formatVersion 0 when absent", () => {
    const config = `[core]
\tbare = true
`;
    const result = parseGitConfigExtensions(config);

    expect(result.formatVersion).toBe(0);
    expect(result.extensions).toEqual({});
  });

  it("handles config with no extensions section", () => {
    const config = `[core]
\trepositoryformatversion = 1
\tbare = true
[remote "origin"]
\turl = git@github.com:example/repo.git
`;
    const result = parseGitConfigExtensions(config);

    expect(result.formatVersion).toBe(1);
    expect(result.extensions).toEqual({});
  });

  it("handles multiple extensions", () => {
    const config = `[core]
\trepositoryformatversion = 1
[extensions]
\trelativeWorktrees = true
\tworktreeConfig = true
`;
    const result = parseGitConfigExtensions(config);

    expect(result.formatVersion).toBe(1);
    expect(result.extensions).toEqual({
      relativeworktrees: "true",
      worktreeconfig: "true",
    });
  });

  it("skips comments and blank lines", () => {
    const config = `# This is a comment
[core]
; another comment
\trepositoryformatversion = 1

[extensions]
# extension comment
\trelativeWorktrees = true
`;
    const result = parseGitConfigExtensions(config);

    expect(result.formatVersion).toBe(1);
    expect(result.extensions).toEqual({ relativeworktrees: "true" });
  });

  it("handles section with subsection (quoted)", () => {
    const config = `[core]
\trepositoryformatversion = 0
[branch "main"]
\tremote = origin
[extensions]
\tobjectFormat = sha256
`;
    const result = parseGitConfigExtensions(config);

    expect(result.formatVersion).toBe(0);
    expect(result.extensions).toEqual({ objectformat: "sha256" });
  });

  it("handles empty config", () => {
    const result = parseGitConfigExtensions("");

    expect(result.formatVersion).toBe(0);
    expect(result.extensions).toEqual({});
  });

  it("lowercases extension keys for consistent matching", () => {
    const config = `[core]
\trepositoryformatversion = 1
[extensions]
\tRelativeWorktrees = true
`;
    const result = parseGitConfigExtensions(config);

    expect(result.extensions).toEqual({ relativeworktrees: "true" });
  });
});

// ── checkGitExtensions ──

describe("checkGitExtensions", () => {
  it("returns warnings for unsupported extensions with formatversion 1", () => {
    const bareDir = join(testDir, "bare-git");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 1
\tbare = true
[extensions]
\trelativeWorktrees = true
`,
      "utf-8",
    );

    const warnings = checkGitExtensions(bareDir);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("unsupported-extension");
    expect(warnings[0].message).toContain("relativeworktrees");
    expect(warnings[0].message).toContain("requires git 2.48");
    expect(warnings[0].remediation).toContain("version");
  });

  it("returns no warnings for formatversion 0", () => {
    const bareDir = join(testDir, "bare-git-v0");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 0
\tbare = true
`,
      "utf-8",
    );

    const warnings = checkGitExtensions(bareDir);

    expect(warnings).toHaveLength(0);
  });

  it("returns no warnings when config file is missing", () => {
    const bareDir = join(testDir, "no-config");
    mkdirSync(bareDir, { recursive: true });

    const warnings = checkGitExtensions(bareDir);

    expect(warnings).toHaveLength(0);
  });

  it("returns warnings for multiple extensions", () => {
    const bareDir = join(testDir, "multi-ext");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 1
[extensions]
\trelativeWorktrees = true
\tobjectFormat = sha256
`,
      "utf-8",
    );

    const warnings = checkGitExtensions(bareDir);

    expect(warnings).toHaveLength(2);
    const codes = warnings.map((w) => w.code);
    expect(codes).toEqual(["unsupported-extension", "unsupported-extension"]);
    const messages = warnings.map((w) => w.message);
    expect(messages.some((m) => m.includes("relativeworktrees"))).toBe(true);
    expect(messages.some((m) => m.includes("objectformat"))).toBe(true);
  });

  it("includes version hint for known extensions", () => {
    const bareDir = join(testDir, "known-ext");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 1
[extensions]
\trelativeWorktrees = true
`,
      "utf-8",
    );

    const warnings = checkGitExtensions(bareDir);

    expect(warnings[0].message).toContain("requires git 2.48.0+");
  });

  it("flags unknown extensions without version hint", () => {
    const bareDir = join(testDir, "unknown-ext");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 1
[extensions]
\tfutureExtension = true
`,
      "utf-8",
    );

    const warnings = checkGitExtensions(bareDir);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("unsupported-extension");
    expect(warnings[0].message).toContain("futureextension");
    expect(warnings[0].message).not.toContain("requires git");
  });
});

// ── classifyWorkspace with extensions ──

describe("classifyWorkspace extension detection", () => {
  it("emits unsupported-extension warning for worktree with extensions", () => {
    const { bareDir, worktrees } = createBareRepoWorkspace(
      testDir,
      "ext-project",
      ["main"],
    );
    // Write a config with extensions into the bare git dir
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 1
\tbare = true
[extensions]
\trelativeWorktrees = true
`,
      "utf-8",
    );

    const result = classifyWorkspace(worktrees.main);

    expect(result.classification.type).toBe("worktree");
    const extWarnings = result.warnings.filter(
      (w) => w.code === "unsupported-extension",
    );
    expect(extWarnings).toHaveLength(1);
    expect(extWarnings[0].message).toContain("relativeworktrees");
  });

  it("emits unsupported-extension warning for bare-root with extensions", () => {
    const { root, bareDir } = createBareRepoWorkspace(
      testDir,
      "bare-ext-project",
      ["main"],
    );
    // Write a config with extensions into the bare git dir
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 1
\tbare = true
[extensions]
\trelativeWorktrees = true
`,
      "utf-8",
    );

    const result = classifyWorkspace(root);

    expect(result.classification.type).toBe("bare-root");
    const extWarnings = result.warnings.filter(
      (w) => w.code === "unsupported-extension",
    );
    expect(extWarnings).toHaveLength(1);
    expect(extWarnings[0].message).toContain("relativeworktrees");
  });

  it("does not emit extension warnings when formatversion is 0", () => {
    const { bareDir, worktrees } = createBareRepoWorkspace(
      testDir,
      "v0-project",
      ["main"],
    );
    // Write a config with formatversion 0 (no extension checking)
    writeFileSync(
      join(bareDir, "config"),
      `[core]
\trepositoryformatversion = 0
\tbare = true
`,
      "utf-8",
    );

    const result = classifyWorkspace(worktrees.main);

    expect(result.classification.type).toBe("worktree");
    const extWarnings = result.warnings.filter(
      (w) => w.code === "unsupported-extension",
    );
    expect(extWarnings).toHaveLength(0);
  });

  it("does not emit extension warnings when no config file exists", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "no-config-project",
      ["main"],
    );
    // No config file written -- createBareRepoWorkspace doesn't create one

    const result = classifyWorkspace(worktrees.main);

    expect(result.classification.type).toBe("worktree");
    const extWarnings = result.warnings.filter(
      (w) => w.code === "unsupported-extension",
    );
    expect(extWarnings).toHaveLength(0);
  });
});

// ── compareVersions ── (T1)

describe("compareVersions", () => {
  it("returns positive when a > b", () => {
    expect(compareVersions("2.53.0", "2.48.0")).toBeGreaterThan(0);
  });

  it("returns zero when a == b", () => {
    expect(compareVersions("2.48.0", "2.48.0")).toBe(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("2.39.5", "2.48.0")).toBeLessThan(0);
  });

  it("handles major version difference", () => {
    expect(compareVersions("3.0.0", "2.48.0")).toBeGreaterThan(0);
  });

  it("treats missing patch as 0", () => {
    expect(compareVersions("2.48", "2.48.0")).toBe(0);
  });
});

// ── verifyContainerGitVersion ── (T1b, T2, T3, T4, T5, T6)

describe("verifyContainerGitVersion", () => {
  function mockSubprocess(stdout: string, exitCode = 0): RunSubprocess {
    return () => ({ exitCode, stdout, stderr: "" });
  }

  it("T1b: parses version with suffixes (Apple Git)", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true" },
      mockSubprocess("git version 2.48.0 (Apple Git-140)"),
    );

    expect(result.passed).toBe(true);
    expect(result.gitVersion).toBe("2.48.0");
  });

  it("T2: passes with adequate git version", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true" },
      mockSubprocess("git version 2.53.0"),
    );

    expect(result.passed).toBe(true);
    expect(result.gitVersion).toBe("2.53.0");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].supported).toBe(true);
  });

  it("T3: fails with inadequate git version", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true" },
      mockSubprocess("git version 2.39.5"),
    );

    expect(result.passed).toBe(false);
    expect(result.gitVersion).toBe("2.39.5");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].supported).toBe(false);
    expect(result.checks[0].message).toContain("Set version");
  });

  it("T4: handles git not installed (non-zero exit)", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true" },
      mockSubprocess("", 1),
    );

    expect(result.passed).toBe(false);
    expect(result.gitVersion).toBeNull();
    expect(result.checks[0].message).toContain("git may not be installed");
  });

  it("T5: unknown extension passes (no minimum version known)", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true", somefutureext: "true" },
      mockSubprocess("git version 2.53.0"),
    );

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(2);
    const unknownCheck = result.checks.find((c) => c.extension === "somefutureext");
    expect(unknownCheck).toBeDefined();
    expect(unknownCheck!.supported).toBe(true);
    expect(unknownCheck!.message).toContain("no known minimum");
  });

  it("T6: mixed extensions -- one fails, one passes", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true", worktreeconfig: "true" },
      mockSubprocess("git version 2.30.0"),
    );

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(2);

    const rtCheck = result.checks.find((c) => c.extension === "relativeworktrees");
    expect(rtCheck!.supported).toBe(false);

    const wtcCheck = result.checks.find((c) => c.extension === "worktreeconfig");
    expect(wtcCheck!.supported).toBe(true);
  });

  it("handles unexpected git version output", () => {
    const result = verifyContainerGitVersion(
      "test-container",
      { relativeworktrees: "true" },
      mockSubprocess("some garbage output"),
    );

    expect(result.passed).toBe(false);
    expect(result.gitVersion).toBeNull();
    expect(result.checks[0].message).toContain("Unexpected git version output");
  });
});

// ── getDetectedExtensions ── (T7, T7b)

describe("getDetectedExtensions", () => {
  it("T7: returns extensions for worktree with extensions", () => {
    const { bareDir, worktrees } = createBareRepoWorkspace(
      testDir,
      "ext-project",
      ["main"],
    );
    writeFileSync(
      join(bareDir, "config"),
      `[core]\n\trepositoryformatversion = 1\n\tbare = true\n[extensions]\n\trelativeWorktrees = true\n`,
      "utf-8",
    );

    const result = classifyWorkspace(worktrees.main);
    const extensions = getDetectedExtensions(result, worktrees.main);

    expect(extensions).not.toBeNull();
    expect(extensions).toEqual({ relativeworktrees: "true" });
  });

  it("T7: returns extensions for bare-root with extensions", () => {
    const { root, bareDir } = createBareRepoWorkspace(
      testDir,
      "bare-ext-project",
      ["main"],
    );
    writeFileSync(
      join(bareDir, "config"),
      `[core]\n\trepositoryformatversion = 1\n\tbare = true\n[extensions]\n\trelativeWorktrees = true\n`,
      "utf-8",
    );

    const result = classifyWorkspace(root);
    const extensions = getDetectedExtensions(result, root);

    expect(extensions).not.toBeNull();
    expect(extensions).toEqual({ relativeworktrees: "true" });
  });

  it("T7b: returns null for normal clone", () => {
    const root = createNormalCloneWorkspace(testDir, "normal-clone");

    const result = classifyWorkspace(root);
    const extensions = getDetectedExtensions(result, root);

    expect(extensions).toBeNull();
  });

  it("returns null when no extensions in config", () => {
    const { bareDir, worktrees } = createBareRepoWorkspace(
      testDir,
      "no-ext-project",
      ["main"],
    );
    writeFileSync(
      join(bareDir, "config"),
      `[core]\n\trepositoryformatversion = 0\n\tbare = true\n`,
      "utf-8",
    );

    const result = classifyWorkspace(worktrees.main);
    const extensions = getDetectedExtensions(result, worktrees.main);

    expect(extensions).toBeNull();
  });

  it("returns null when .git file is missing", () => {
    const root = join(testDir, "no-git");
    mkdirSync(root, { recursive: true });

    const result = classifyWorkspace(root);
    const extensions = getDetectedExtensions(result, root);

    expect(extensions).toBeNull();
  });
});
