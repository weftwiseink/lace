// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { RunSubprocess } from "@/lib/subprocess";
import {
  validateNoConflicts,
  getDefaultTarget,
  resolveRepoMounts,
  generateMountSpec,
  generateSymlinkCommands,
  generateMountSpecs,
  MountsError,
  type ResolvedRepoMount,
} from "@/lib/mounts";
import type { RepoMountsConfig } from "@/lib/devcontainer";
import type { LaceSettings } from "@/lib/settings";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `lace-test-mounts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// --- Conflict validation ---

describe("validateNoConflicts", () => {
  it("passes with unique names", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/user/dotfiles": {},
      "github.com/user/utils": {},
    };
    expect(() => validateNoConflicts(repoMounts)).not.toThrow();
  });

  it("passes with aliases that resolve conflicts", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/alice/utils": { alias: "alice-utils" },
      "github.com/bob/utils": { alias: "bob-utils" },
    };
    expect(() => validateNoConflicts(repoMounts)).not.toThrow();
  });

  it("throws on name conflict without aliases", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/alice/utils": {},
      "github.com/bob/utils": {},
    };
    expect(() => validateNoConflicts(repoMounts)).toThrow(MountsError);
    expect(() => validateNoConflicts(repoMounts)).toThrow(/Repo mount name conflict/);
    expect(() => validateNoConflicts(repoMounts)).toThrow(/utils/);
  });

  it("provides alias suggestion in error", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/alice/utils": {},
      "github.com/bob/utils": {},
    };
    try {
      validateNoConflicts(repoMounts);
    } catch (err) {
      expect((err as Error).message).toContain("alias");
    }
  });
});

// --- Default target ---

describe("getDefaultTarget", () => {
  it("generates correct mount target", () => {
    expect(getDefaultTarget("dotfiles")).toBe("/mnt/lace/repos/dotfiles");
    expect(getDefaultTarget("my-repo")).toBe("/mnt/lace/repos/my-repo");
  });
});

// --- Mount resolution ---

describe("resolveRepoMounts", () => {
  it("resolves single repo mount with override", () => {
    const overrideSource = join(testDir, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    const repoMounts: RepoMountsConfig = {
      "github.com/user/dotfiles": {},
    };
    const settings: LaceSettings = {
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: overrideSource,
          },
        },
      },
    };

    const result = resolveRepoMounts({
      repoMounts,
      settings,
      projectId: "test-project",
    });

    expect(result.repoMounts).toHaveLength(1);
    expect(result.repoMounts[0].repoId).toBe("github.com/user/dotfiles");
    expect(result.repoMounts[0].nameOrAlias).toBe("dotfiles");
    expect(result.repoMounts[0].source).toBe(overrideSource);
    expect(result.repoMounts[0].target).toBe("/mnt/lace/repos/dotfiles");
    expect(result.repoMounts[0].readonly).toBe(true);
    expect(result.repoMounts[0].isOverride).toBe(true);
    expect(result.repoMounts[0].symlink).toBeUndefined();
  });

  it("resolves repo mount with custom target and generates symlink", () => {
    const overrideSource = join(testDir, "local-repo");
    mkdirSync(overrideSource, { recursive: true });

    const repoMounts: RepoMountsConfig = {
      "github.com/user/claude-repo": {},
    };
    const settings: LaceSettings = {
      repoMounts: {
        "github.com/user/claude-repo": {
          overrideMount: {
            source: overrideSource,
            target: "/home/user/code/claude-repo",
            readonly: false,
          },
        },
      },
    };

    const result = resolveRepoMounts({
      repoMounts,
      settings,
      projectId: "test-project",
    });

    expect(result.repoMounts[0].target).toBe("/home/user/code/claude-repo");
    expect(result.repoMounts[0].readonly).toBe(false);
    expect(result.repoMounts[0].symlink).toEqual({
      from: "/mnt/lace/repos/claude-repo",
      to: "/home/user/code/claude-repo",
    });
  });

  it("throws on override source not existing", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/user/dotfiles": {},
    };
    const settings: LaceSettings = {
      repoMounts: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: join(testDir, "nonexistent"),
          },
        },
      },
    };

    expect(() =>
      resolveRepoMounts({
        repoMounts,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(MountsError);
    expect(() =>
      resolveRepoMounts({
        repoMounts,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(/override source does not exist/);
  });

  it("resolves repo mount via clone when no override", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/user/dotfiles": {},
    };
    const settings: LaceSettings = {};

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = resolveRepoMounts({
      repoMounts,
      settings,
      projectId: "test-project",
      subprocess: mockSubprocess,
    });

    expect(result.repoMounts).toHaveLength(1);
    expect(result.repoMounts[0].isOverride).toBe(false);
    expect(result.repoMounts[0].readonly).toBe(true);
    expect(result.repoMounts[0].source).toBe(
      join(homedir(), ".config/lace/test-project/repos/dotfiles"),
    );

    // Verify clone was attempted
    expect(mockSubprocess).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone"]),
    );
  });

  it("throws on name conflict", () => {
    const repoMounts: RepoMountsConfig = {
      "github.com/alice/utils": {},
      "github.com/bob/utils": {},
    };
    const settings: LaceSettings = {};

    expect(() =>
      resolveRepoMounts({
        repoMounts,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(MountsError);
    expect(() =>
      resolveRepoMounts({
        repoMounts,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(/Repo mount name conflict/);
  });

  it("handles repo mounts with aliases", () => {
    const aliceSource = join(testDir, "alice-utils");
    const bobSource = join(testDir, "bob-utils");
    mkdirSync(aliceSource, { recursive: true });
    mkdirSync(bobSource, { recursive: true });

    const repoMounts: RepoMountsConfig = {
      "github.com/alice/utils": { alias: "alice-utils" },
      "github.com/bob/utils": { alias: "bob-utils" },
    };
    const settings: LaceSettings = {
      repoMounts: {
        "github.com/alice/utils": {
          overrideMount: { source: aliceSource },
        },
        "github.com/bob/utils": {
          overrideMount: { source: bobSource },
        },
      },
    };

    const result = resolveRepoMounts({
      repoMounts,
      settings,
      projectId: "test-project",
    });

    expect(result.repoMounts).toHaveLength(2);
    expect(result.repoMounts.find((p) => p.nameOrAlias === "alice-utils")).toBeDefined();
    expect(result.repoMounts.find((p) => p.nameOrAlias === "bob-utils")).toBeDefined();
  });
});

// --- Mount spec generation ---

describe("generateMountSpec", () => {
  it("generates readonly mount spec", () => {
    const repoMount: ResolvedRepoMount = {
      repoId: "github.com/user/dotfiles",
      nameOrAlias: "dotfiles",
      source: "/home/user/dotfiles",
      target: "/mnt/lace/repos/dotfiles",
      readonly: true,
      isOverride: true,
    };

    expect(generateMountSpec(repoMount)).toBe(
      "type=bind,source=/home/user/dotfiles,target=/mnt/lace/repos/dotfiles,readonly",
    );
  });

  it("generates writable mount spec", () => {
    const repoMount: ResolvedRepoMount = {
      repoId: "github.com/user/repo",
      nameOrAlias: "repo",
      source: "/home/user/repo",
      target: "/mnt/lace/repos/repo",
      readonly: false,
      isOverride: true,
    };

    expect(generateMountSpec(repoMount)).toBe(
      "type=bind,source=/home/user/repo,target=/mnt/lace/repos/repo",
    );
  });
});

// --- Symlink command generation ---

describe("generateSymlinkCommands", () => {
  it("returns null when no symlinks needed", () => {
    const repoMounts: ResolvedRepoMount[] = [
      {
        repoId: "github.com/user/dotfiles",
        nameOrAlias: "dotfiles",
        source: "/home/user/dotfiles",
        target: "/mnt/lace/repos/dotfiles",
        readonly: true,
        isOverride: true,
      },
    ];

    expect(generateSymlinkCommands(repoMounts)).toBeNull();
  });

  it("generates single symlink command", () => {
    const repoMounts: ResolvedRepoMount[] = [
      {
        repoId: "github.com/user/repo",
        nameOrAlias: "repo",
        source: "/home/user/code/repo",
        target: "/home/user/code/repo",
        readonly: false,
        isOverride: true,
        symlink: {
          from: "/mnt/lace/repos/repo",
          to: "/home/user/code/repo",
        },
      },
    ];

    const result = generateSymlinkCommands(repoMounts);
    expect(result).toContain("mkdir -p");
    expect(result).toContain("rm -f '/mnt/lace/repos/repo'");
    expect(result).toContain("ln -s '/home/user/code/repo' '/mnt/lace/repos/repo'");
  });

  it("generates multiple symlink commands joined with &&", () => {
    const repoMounts: ResolvedRepoMount[] = [
      {
        repoId: "github.com/user/repo1",
        nameOrAlias: "repo1",
        source: "/source1",
        target: "/target1",
        readonly: false,
        isOverride: true,
        symlink: { from: "/mnt/lace/repos/repo1", to: "/target1" },
      },
      {
        repoId: "github.com/user/repo2",
        nameOrAlias: "repo2",
        source: "/source2",
        target: "/target2",
        readonly: false,
        isOverride: true,
        symlink: { from: "/mnt/lace/repos/repo2", to: "/target2" },
      },
    ];

    const result = generateSymlinkCommands(repoMounts);
    expect(result).toContain("&&");
    expect(result).toContain("repo1");
    expect(result).toContain("repo2");
  });

  it("handles paths with special characters", () => {
    const repoMounts: ResolvedRepoMount[] = [
      {
        repoId: "github.com/user/repo",
        nameOrAlias: "my-repo",
        source: "/home/user/my repo",
        target: "/home/user/my repo",
        readonly: false,
        isOverride: true,
        symlink: {
          from: "/mnt/lace/repos/my-repo",
          to: "/home/user/my repo",
        },
      },
    ];

    const result = generateSymlinkCommands(repoMounts);
    // Single quotes handle spaces
    expect(result).toContain("'/home/user/my repo'");
  });
});

// --- Generate all mount specs ---

describe("generateMountSpecs", () => {
  it("generates specs for all repo mounts", () => {
    const repoMounts: ResolvedRepoMount[] = [
      {
        repoId: "github.com/user/dotfiles",
        nameOrAlias: "dotfiles",
        source: "/home/user/dotfiles",
        target: "/mnt/lace/repos/dotfiles",
        readonly: true,
        isOverride: true,
      },
      {
        repoId: "github.com/user/utils",
        nameOrAlias: "utils",
        source: "/home/user/utils",
        target: "/mnt/lace/repos/utils",
        readonly: false,
        isOverride: true,
      },
    ];

    const result = generateMountSpecs(repoMounts);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("dotfiles");
    expect(result[0]).toContain("readonly");
    expect(result[1]).toContain("utils");
    expect(result[1]).not.toContain("readonly");
  });
});
