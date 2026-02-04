// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { RunSubprocess } from "@/lib/subprocess";
import {
  validateNoConflicts,
  getDefaultTarget,
  resolvePluginMounts,
  generateMountSpec,
  generateSymlinkCommands,
  generateMountSpecs,
  MountsError,
  type ResolvedPlugin,
} from "@/lib/mounts";
import type { PluginsConfig } from "@/lib/devcontainer";
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
    const plugins: PluginsConfig = {
      "github.com/user/dotfiles": {},
      "github.com/user/utils": {},
    };
    expect(() => validateNoConflicts(plugins)).not.toThrow();
  });

  it("passes with aliases that resolve conflicts", () => {
    const plugins: PluginsConfig = {
      "github.com/alice/utils": { alias: "alice-utils" },
      "github.com/bob/utils": { alias: "bob-utils" },
    };
    expect(() => validateNoConflicts(plugins)).not.toThrow();
  });

  it("throws on name conflict without aliases", () => {
    const plugins: PluginsConfig = {
      "github.com/alice/utils": {},
      "github.com/bob/utils": {},
    };
    expect(() => validateNoConflicts(plugins)).toThrow(MountsError);
    expect(() => validateNoConflicts(plugins)).toThrow(/Plugin name conflict/);
    expect(() => validateNoConflicts(plugins)).toThrow(/utils/);
  });

  it("provides alias suggestion in error", () => {
    const plugins: PluginsConfig = {
      "github.com/alice/utils": {},
      "github.com/bob/utils": {},
    };
    try {
      validateNoConflicts(plugins);
    } catch (err) {
      expect((err as Error).message).toContain("alias");
    }
  });
});

// --- Default target ---

describe("getDefaultTarget", () => {
  it("generates correct mount target", () => {
    expect(getDefaultTarget("dotfiles")).toBe("/mnt/lace/plugins/dotfiles");
    expect(getDefaultTarget("my-plugin")).toBe("/mnt/lace/plugins/my-plugin");
  });
});

// --- Mount resolution ---

describe("resolvePluginMounts", () => {
  it("resolves single plugin with override", () => {
    const overrideSource = join(testDir, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    const plugins: PluginsConfig = {
      "github.com/user/dotfiles": {},
    };
    const settings: LaceSettings = {
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: overrideSource,
          },
        },
      },
    };

    const result = resolvePluginMounts({
      plugins,
      settings,
      projectId: "test-project",
    });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].repoId).toBe("github.com/user/dotfiles");
    expect(result.plugins[0].nameOrAlias).toBe("dotfiles");
    expect(result.plugins[0].source).toBe(overrideSource);
    expect(result.plugins[0].target).toBe("/mnt/lace/plugins/dotfiles");
    expect(result.plugins[0].readonly).toBe(true);
    expect(result.plugins[0].isOverride).toBe(true);
    expect(result.plugins[0].symlink).toBeUndefined();
  });

  it("resolves plugin with custom target and generates symlink", () => {
    const overrideSource = join(testDir, "local-plugin");
    mkdirSync(overrideSource, { recursive: true });

    const plugins: PluginsConfig = {
      "github.com/user/claude-plugin": {},
    };
    const settings: LaceSettings = {
      plugins: {
        "github.com/user/claude-plugin": {
          overrideMount: {
            source: overrideSource,
            target: "/home/user/code/claude-plugin",
            readonly: false,
          },
        },
      },
    };

    const result = resolvePluginMounts({
      plugins,
      settings,
      projectId: "test-project",
    });

    expect(result.plugins[0].target).toBe("/home/user/code/claude-plugin");
    expect(result.plugins[0].readonly).toBe(false);
    expect(result.plugins[0].symlink).toEqual({
      from: "/mnt/lace/plugins/claude-plugin",
      to: "/home/user/code/claude-plugin",
    });
  });

  it("throws on override source not existing", () => {
    const plugins: PluginsConfig = {
      "github.com/user/dotfiles": {},
    };
    const settings: LaceSettings = {
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: join(testDir, "nonexistent"),
          },
        },
      },
    };

    expect(() =>
      resolvePluginMounts({
        plugins,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(MountsError);
    expect(() =>
      resolvePluginMounts({
        plugins,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(/override source does not exist/);
  });

  it("resolves plugin via clone when no override", () => {
    const plugins: PluginsConfig = {
      "github.com/user/dotfiles": {},
    };
    const settings: LaceSettings = {};

    const mockSubprocess: RunSubprocess = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));

    const result = resolvePluginMounts({
      plugins,
      settings,
      projectId: "test-project",
      subprocess: mockSubprocess,
    });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].isOverride).toBe(false);
    expect(result.plugins[0].readonly).toBe(true);
    expect(result.plugins[0].source).toBe(
      join(homedir(), ".config/lace/test-project/plugins/dotfiles"),
    );

    // Verify clone was attempted
    expect(mockSubprocess).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone"]),
    );
  });

  it("throws on name conflict", () => {
    const plugins: PluginsConfig = {
      "github.com/alice/utils": {},
      "github.com/bob/utils": {},
    };
    const settings: LaceSettings = {};

    expect(() =>
      resolvePluginMounts({
        plugins,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(MountsError);
    expect(() =>
      resolvePluginMounts({
        plugins,
        settings,
        projectId: "test-project",
      }),
    ).toThrow(/Plugin name conflict/);
  });

  it("handles plugins with aliases", () => {
    const aliceSource = join(testDir, "alice-utils");
    const bobSource = join(testDir, "bob-utils");
    mkdirSync(aliceSource, { recursive: true });
    mkdirSync(bobSource, { recursive: true });

    const plugins: PluginsConfig = {
      "github.com/alice/utils": { alias: "alice-utils" },
      "github.com/bob/utils": { alias: "bob-utils" },
    };
    const settings: LaceSettings = {
      plugins: {
        "github.com/alice/utils": {
          overrideMount: { source: aliceSource },
        },
        "github.com/bob/utils": {
          overrideMount: { source: bobSource },
        },
      },
    };

    const result = resolvePluginMounts({
      plugins,
      settings,
      projectId: "test-project",
    });

    expect(result.plugins).toHaveLength(2);
    expect(result.plugins.find((p) => p.nameOrAlias === "alice-utils")).toBeDefined();
    expect(result.plugins.find((p) => p.nameOrAlias === "bob-utils")).toBeDefined();
  });
});

// --- Mount spec generation ---

describe("generateMountSpec", () => {
  it("generates readonly mount spec", () => {
    const plugin: ResolvedPlugin = {
      repoId: "github.com/user/dotfiles",
      nameOrAlias: "dotfiles",
      source: "/home/user/dotfiles",
      target: "/mnt/lace/plugins/dotfiles",
      readonly: true,
      isOverride: true,
    };

    expect(generateMountSpec(plugin)).toBe(
      "type=bind,source=/home/user/dotfiles,target=/mnt/lace/plugins/dotfiles,readonly",
    );
  });

  it("generates writable mount spec", () => {
    const plugin: ResolvedPlugin = {
      repoId: "github.com/user/plugin",
      nameOrAlias: "plugin",
      source: "/home/user/plugin",
      target: "/mnt/lace/plugins/plugin",
      readonly: false,
      isOverride: true,
    };

    expect(generateMountSpec(plugin)).toBe(
      "type=bind,source=/home/user/plugin,target=/mnt/lace/plugins/plugin",
    );
  });
});

// --- Symlink command generation ---

describe("generateSymlinkCommands", () => {
  it("returns null when no symlinks needed", () => {
    const plugins: ResolvedPlugin[] = [
      {
        repoId: "github.com/user/dotfiles",
        nameOrAlias: "dotfiles",
        source: "/home/user/dotfiles",
        target: "/mnt/lace/plugins/dotfiles",
        readonly: true,
        isOverride: true,
      },
    ];

    expect(generateSymlinkCommands(plugins)).toBeNull();
  });

  it("generates single symlink command", () => {
    const plugins: ResolvedPlugin[] = [
      {
        repoId: "github.com/user/plugin",
        nameOrAlias: "plugin",
        source: "/home/user/code/plugin",
        target: "/home/user/code/plugin",
        readonly: false,
        isOverride: true,
        symlink: {
          from: "/mnt/lace/plugins/plugin",
          to: "/home/user/code/plugin",
        },
      },
    ];

    const result = generateSymlinkCommands(plugins);
    expect(result).toContain("mkdir -p");
    expect(result).toContain("rm -f '/mnt/lace/plugins/plugin'");
    expect(result).toContain("ln -s '/home/user/code/plugin' '/mnt/lace/plugins/plugin'");
  });

  it("generates multiple symlink commands joined with &&", () => {
    const plugins: ResolvedPlugin[] = [
      {
        repoId: "github.com/user/plugin1",
        nameOrAlias: "plugin1",
        source: "/source1",
        target: "/target1",
        readonly: false,
        isOverride: true,
        symlink: { from: "/mnt/lace/plugins/plugin1", to: "/target1" },
      },
      {
        repoId: "github.com/user/plugin2",
        nameOrAlias: "plugin2",
        source: "/source2",
        target: "/target2",
        readonly: false,
        isOverride: true,
        symlink: { from: "/mnt/lace/plugins/plugin2", to: "/target2" },
      },
    ];

    const result = generateSymlinkCommands(plugins);
    expect(result).toContain("&&");
    expect(result).toContain("plugin1");
    expect(result).toContain("plugin2");
  });

  it("handles paths with special characters", () => {
    const plugins: ResolvedPlugin[] = [
      {
        repoId: "github.com/user/plugin",
        nameOrAlias: "my-plugin",
        source: "/home/user/my plugin",
        target: "/home/user/my plugin",
        readonly: false,
        isOverride: true,
        symlink: {
          from: "/mnt/lace/plugins/my-plugin",
          to: "/home/user/my plugin",
        },
      },
    ];

    const result = generateSymlinkCommands(plugins);
    // Single quotes handle spaces
    expect(result).toContain("'/home/user/my plugin'");
  });
});

// --- Generate all mount specs ---

describe("generateMountSpecs", () => {
  it("generates specs for all plugins", () => {
    const plugins: ResolvedPlugin[] = [
      {
        repoId: "github.com/user/dotfiles",
        nameOrAlias: "dotfiles",
        source: "/home/user/dotfiles",
        target: "/mnt/lace/plugins/dotfiles",
        readonly: true,
        isOverride: true,
      },
      {
        repoId: "github.com/user/utils",
        nameOrAlias: "utils",
        source: "/home/user/utils",
        target: "/mnt/lace/plugins/utils",
        readonly: false,
        isOverride: true,
      },
    ];

    const result = generateMountSpecs(plugins);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("dotfiles");
    expect(result[0]).toContain("readonly");
    expect(result[1]).toContain("utils");
    expect(result[1]).not.toContain("readonly");
  });
});
