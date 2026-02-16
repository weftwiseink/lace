// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import {
  deriveProjectName,
  sanitizeContainerName,
  hasRunArgsFlag,
} from "../project-name";
import type { WorkspaceClassification } from "../workspace-detector";

// ── deriveProjectName ──

describe("deriveProjectName", () => {
  it("normal clone uses basename of workspace path", () => {
    const classification: WorkspaceClassification = { type: "normal-clone" };
    expect(deriveProjectName(classification, "/code/lace")).toBe("lace");
  });

  it("worktree (main) uses basename of bare repo root", () => {
    const classification: WorkspaceClassification = {
      type: "worktree",
      bareRepoRoot: "/code/lace",
      worktreeName: "main",
      usesAbsolutePath: false,
    };
    expect(deriveProjectName(classification, "/code/lace/main")).toBe("lace");
  });

  it("worktree (master) uses basename of bare repo root", () => {
    const classification: WorkspaceClassification = {
      type: "worktree",
      bareRepoRoot: "/code/lace",
      worktreeName: "master",
      usesAbsolutePath: false,
    };
    expect(deriveProjectName(classification, "/code/lace/master")).toBe("lace");
  });

  it("worktree (feature branch) uses basename of bare repo root, ignores worktree name", () => {
    const classification: WorkspaceClassification = {
      type: "worktree",
      bareRepoRoot: "/code/lace",
      worktreeName: "feature-x",
      usesAbsolutePath: false,
    };
    expect(deriveProjectName(classification, "/code/lace/feature-x")).toBe(
      "lace",
    );
  });

  it("bare-root uses basename of bare repo root", () => {
    const classification: WorkspaceClassification = {
      type: "bare-root",
      bareRepoRoot: "/code/lace",
    };
    expect(deriveProjectName(classification, "/code/lace")).toBe("lace");
  });

  it("standard-bare uses basename of workspace path", () => {
    const classification: WorkspaceClassification = { type: "standard-bare" };
    expect(deriveProjectName(classification, "/code/bare-repo")).toBe(
      "bare-repo",
    );
  });

  it("not-git uses basename of workspace path", () => {
    const classification: WorkspaceClassification = { type: "not-git" };
    expect(deriveProjectName(classification, "/tmp/scratch")).toBe("scratch");
  });

  it("malformed uses basename of workspace path", () => {
    const classification: WorkspaceClassification = {
      type: "malformed",
      reason: "test",
    };
    expect(deriveProjectName(classification, "/tmp/broken")).toBe("broken");
  });

  it("nested bare repo path extracts only the last component", () => {
    const classification: WorkspaceClassification = {
      type: "worktree",
      bareRepoRoot: "/code/weft/lace",
      worktreeName: "main",
      usesAbsolutePath: false,
    };
    expect(deriveProjectName(classification, "/code/weft/lace/main")).toBe(
      "lace",
    );
  });

  it("worktree with develop branch still uses repo name", () => {
    const classification: WorkspaceClassification = {
      type: "worktree",
      bareRepoRoot: "/code/lace",
      worktreeName: "develop",
      usesAbsolutePath: false,
    };
    expect(deriveProjectName(classification, "/code/lace/develop")).toBe(
      "lace",
    );
  });
});

// ── sanitizeContainerName ──

describe("sanitizeContainerName", () => {
  it("passes through already valid names", () => {
    expect(sanitizeContainerName("lace")).toBe("lace");
  });

  it("replaces spaces with hyphens", () => {
    expect(sanitizeContainerName("my project")).toBe("my-project");
  });

  it("replaces special characters with hyphens, preserves underscores", () => {
    expect(sanitizeContainerName("my_project!")).toBe("my_project");
  });

  it("strips leading non-alphanumeric characters", () => {
    expect(sanitizeContainerName("---lace")).toBe("lace");
  });

  it("strips trailing non-alphanumeric characters", () => {
    expect(sanitizeContainerName("lace---")).toBe("lace");
  });

  it("handles mixed invalid characters", () => {
    expect(sanitizeContainerName("--my project!--")).toBe("my-project");
  });

  it("falls back to lace-project for all-invalid input", () => {
    expect(sanitizeContainerName("---")).toBe("lace-project");
  });

  it("falls back to lace-project for empty string", () => {
    expect(sanitizeContainerName("")).toBe("lace-project");
  });

  it("preserves dots and hyphens in the middle", () => {
    expect(sanitizeContainerName("my.project-name")).toBe("my.project-name");
  });
});

// ── hasRunArgsFlag ──

describe("hasRunArgsFlag", () => {
  it("detects flag in space form", () => {
    expect(hasRunArgsFlag(["--name", "foo"], "--name")).toBe(true);
  });

  it("detects flag in equals form", () => {
    expect(hasRunArgsFlag(["--name=foo"], "--name")).toBe(true);
  });

  it("returns false when flag is absent", () => {
    expect(hasRunArgsFlag(["--label", "x=y"], "--name")).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasRunArgsFlag([], "--name")).toBe(false);
  });

  it("does not match similar prefix in space form", () => {
    expect(hasRunArgsFlag(["--namespace", "x"], "--name")).toBe(false);
  });

  it("does not match similar prefix in equals form", () => {
    expect(hasRunArgsFlag(["--namespace=x"], "--name")).toBe(false);
  });
});
