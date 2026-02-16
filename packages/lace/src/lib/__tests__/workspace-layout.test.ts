// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyWorkspaceLayout,
  extractWorkspaceConfig,
  mergePostCreateCommand,
  mergeVscodeSettings,
} from "../workspace-layout";
import type { WorkspaceConfig } from "../workspace-layout";
import {
  createBareRepoWorkspace,
  createNormalCloneWorkspace,
} from "../../__tests__/helpers/scenario-utils";

let testDir: string;

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `lace-test-workspace-layout-${suffix}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── extractWorkspaceConfig ──

describe("extractWorkspaceConfig", () => {
  it("returns null when no customizations", () => {
    expect(extractWorkspaceConfig({})).toBeNull();
  });

  it("returns null when no lace customizations", () => {
    expect(extractWorkspaceConfig({ customizations: {} })).toBeNull();
  });

  it("returns null when no workspace config", () => {
    expect(
      extractWorkspaceConfig({ customizations: { lace: {} } }),
    ).toBeNull();
  });

  it("returns null when layout is false", () => {
    expect(
      extractWorkspaceConfig({
        customizations: { lace: { workspace: { layout: false } } },
      }),
    ).toBeNull();
  });

  it("parses bare-worktree layout with defaults", () => {
    const result = extractWorkspaceConfig({
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    });
    expect(result).toEqual({
      layout: "bare-worktree",
      mountTarget: "/workspace",
      postCreate: {
        safeDirectory: true,
        scanDepth: 2,
      },
    });
  });

  it("parses custom mountTarget", () => {
    const result = extractWorkspaceConfig({
      customizations: {
        lace: {
          workspace: { layout: "bare-worktree", mountTarget: "/src" },
        },
      },
    });
    expect(result?.mountTarget).toBe("/src");
  });

  it("parses custom postCreate settings", () => {
    const result = extractWorkspaceConfig({
      customizations: {
        lace: {
          workspace: {
            layout: "bare-worktree",
            postCreate: { safeDirectory: false, scanDepth: 3 },
          },
        },
      },
    });
    expect(result?.postCreate?.safeDirectory).toBe(false);
    expect(result?.postCreate?.scanDepth).toBe(3);
  });

  it("warns and returns null for unrecognized layout value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = extractWorkspaceConfig({
      customizations: {
        lace: { workspace: { layout: "unknown-layout" } },
      },
    });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unrecognized workspace layout"),
    );
    warnSpy.mockRestore();
  });
});

// ── applyWorkspaceLayout ──

describe("applyWorkspaceLayout", () => {
  it("auto-generates both workspaceMount and workspaceFolder for worktree", () => {
    const { root, worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    const result = applyWorkspaceLayout(config, worktrees.main);

    expect(result.status).toBe("applied");
    expect(config.workspaceMount).toBe(
      `source=${root},target=/workspace,type=bind,consistency=delegated`,
    );
    expect(config.workspaceFolder).toBe("/workspace/main");
  });

  it("respects user-set workspaceMount", () => {
    const { root, worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      workspaceMount: "source=/custom/path,target=/custom,type=bind",
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    const result = applyWorkspaceLayout(config, worktrees.main);

    expect(result.status).toBe("applied");
    expect(config.workspaceMount).toBe(
      "source=/custom/path,target=/custom,type=bind",
    );
    // workspaceFolder should still be auto-generated
    expect(config.workspaceFolder).toBe("/workspace/main");
  });

  it("respects user-set workspaceFolder", () => {
    const { root, worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      workspaceFolder: "/custom/folder",
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    const result = applyWorkspaceLayout(config, worktrees.main);

    expect(result.status).toBe("applied");
    expect(config.workspaceFolder).toBe("/custom/folder");
    // workspaceMount should still be auto-generated
    expect(config.workspaceMount).toBe(
      `source=${root},target=/workspace,type=bind,consistency=delegated`,
    );
  });

  it("does not override either field when both are user-set", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      workspaceMount: "source=/user/mount,target=/user,type=bind",
      workspaceFolder: "/user/folder",
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    const result = applyWorkspaceLayout(config, worktrees.main);

    expect(result.status).toBe("applied");
    expect(config.workspaceMount).toBe(
      "source=/user/mount,target=/user,type=bind",
    );
    expect(config.workspaceFolder).toBe("/user/folder");
  });

  it("returns error when layout is bare-worktree but workspace is a normal clone", () => {
    const root = createNormalCloneWorkspace(testDir, "normal-clone");
    const config: Record<string, unknown> = {
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    const result = applyWorkspaceLayout(config, root);

    expect(result.status).toBe("error");
    expect(result.message).toContain("normal git clone");
    expect(result.message).toContain("Remove the workspace.layout setting");
  });

  it("injects safe.directory into postCreateCommand", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    applyWorkspaceLayout(config, worktrees.main);

    expect(config.postCreateCommand).toBe(
      "git config --global --add safe.directory '*'",
    );
  });

  it("injects scanDepth into vscode settings", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    applyWorkspaceLayout(config, worktrees.main);

    const customizations = config.customizations as Record<string, unknown>;
    const vscode = customizations.vscode as Record<string, unknown>;
    const settings = vscode.settings as Record<string, unknown>;
    expect(settings["git.repositoryScanMaxDepth"]).toBe(2);
  });

  it("sets workspaceFolder to mountTarget root when opened from bare-root", () => {
    const { root } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };

    const result = applyWorkspaceLayout(config, root);

    expect(result.status).toBe("applied");
    expect(config.workspaceFolder).toBe("/workspace");
    expect(result.message).toContain("bare-repo root");
  });

  it("skips when no workspace config is present", () => {
    const root = createNormalCloneWorkspace(testDir, "no-config");
    const config: Record<string, unknown> = {};

    const result = applyWorkspaceLayout(config, root);

    expect(result.status).toBe("skipped");
    expect(config.workspaceMount).toBeUndefined();
    expect(config.workspaceFolder).toBeUndefined();
  });

  it("uses custom mountTarget", () => {
    const { root, worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          workspace: {
            layout: "bare-worktree",
            mountTarget: "/src",
          },
        },
      },
    };

    applyWorkspaceLayout(config, worktrees.main);

    expect(config.workspaceMount).toBe(
      `source=${root},target=/src,type=bind,consistency=delegated`,
    );
    expect(config.workspaceFolder).toBe("/src/main");
  });

  it("does not inject safe.directory when safeDirectory is false", () => {
    const { worktrees } = createBareRepoWorkspace(
      testDir,
      "my-project",
      ["main"],
    );
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          workspace: {
            layout: "bare-worktree",
            postCreate: { safeDirectory: false },
          },
        },
      },
    };

    applyWorkspaceLayout(config, worktrees.main);

    expect(config.postCreateCommand).toBeUndefined();
  });
});

// ── mergePostCreateCommand ──

describe("mergePostCreateCommand", () => {
  const CMD = "git config --global --add safe.directory '*'";

  it("sets command when postCreateCommand is absent", () => {
    const config: Record<string, unknown> = {};
    mergePostCreateCommand(config, CMD);
    expect(config.postCreateCommand).toBe(CMD);
  });

  it("chains with && when postCreateCommand is a string", () => {
    const config: Record<string, unknown> = {
      postCreateCommand: "echo hello",
    };
    mergePostCreateCommand(config, CMD);
    expect(config.postCreateCommand).toBe(`echo hello && ${CMD}`);
  });

  it("converts array format to object format", () => {
    const config: Record<string, unknown> = {
      postCreateCommand: ["npm", "install"],
    };
    mergePostCreateCommand(config, CMD);
    expect(config.postCreateCommand).toEqual({
      "lace:user-setup": ["npm", "install"],
      "lace:workspace": CMD,
    });
  });

  it("adds to existing object format", () => {
    const config: Record<string, unknown> = {
      postCreateCommand: {
        "user:setup": "echo setup",
      },
    };
    mergePostCreateCommand(config, CMD);
    const obj = config.postCreateCommand as Record<string, unknown>;
    expect(obj["lace:workspace"]).toBe(CMD);
    expect(obj["user:setup"]).toBe("echo setup");
  });

  it("is idempotent for string format", () => {
    const config: Record<string, unknown> = {
      postCreateCommand: `echo hello && ${CMD}`,
    };
    mergePostCreateCommand(config, CMD);
    // Should not double-add
    expect(config.postCreateCommand).toBe(`echo hello && ${CMD}`);
  });

  it("is idempotent for object format", () => {
    const config: Record<string, unknown> = {
      postCreateCommand: {
        "lace:workspace": CMD,
        "user:setup": "echo setup",
      },
    };
    mergePostCreateCommand(config, CMD);
    const obj = config.postCreateCommand as Record<string, unknown>;
    // Should not add another entry
    expect(Object.keys(obj)).toHaveLength(2);
    expect(obj["lace:workspace"]).toBe(CMD);
  });
});

// ── mergeVscodeSettings ──

describe("mergeVscodeSettings", () => {
  it("creates full nested structure when absent", () => {
    const config: Record<string, unknown> = {};
    mergeVscodeSettings(config, { "git.repositoryScanMaxDepth": 2 });

    const customizations = config.customizations as Record<string, unknown>;
    const vscode = customizations.vscode as Record<string, unknown>;
    const settings = vscode.settings as Record<string, unknown>;
    expect(settings["git.repositoryScanMaxDepth"]).toBe(2);
  });

  it("does not override existing user settings", () => {
    const config: Record<string, unknown> = {
      customizations: {
        vscode: {
          settings: {
            "git.repositoryScanMaxDepth": 5,
          },
        },
      },
    };
    mergeVscodeSettings(config, { "git.repositoryScanMaxDepth": 2 });

    const customizations = config.customizations as Record<string, unknown>;
    const vscode = customizations.vscode as Record<string, unknown>;
    const settings = vscode.settings as Record<string, unknown>;
    expect(settings["git.repositoryScanMaxDepth"]).toBe(5);
  });

  it("adds new settings without touching existing ones", () => {
    const config: Record<string, unknown> = {
      customizations: {
        vscode: {
          settings: {
            "editor.fontSize": 14,
          },
        },
      },
    };
    mergeVscodeSettings(config, { "git.repositoryScanMaxDepth": 2 });

    const customizations = config.customizations as Record<string, unknown>;
    const vscode = customizations.vscode as Record<string, unknown>;
    const settings = vscode.settings as Record<string, unknown>;
    expect(settings["editor.fontSize"]).toBe(14);
    expect(settings["git.repositoryScanMaxDepth"]).toBe(2);
  });

  it("preserves existing lace customizations", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: { workspace: { layout: "bare-worktree" } },
      },
    };
    mergeVscodeSettings(config, { "git.repositoryScanMaxDepth": 2 });

    const customizations = config.customizations as Record<string, unknown>;
    expect(customizations.lace).toBeDefined();
    expect(customizations.vscode).toBeDefined();
  });
});
