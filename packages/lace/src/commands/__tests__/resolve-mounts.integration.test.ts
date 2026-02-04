// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { runResolveMounts } from "@/lib/resolve-mounts";
import type { RunSubprocess } from "@/lib/subprocess";
import type { ResolvedMounts } from "@/lib/mounts";

let workspaceRoot: string;
let devcontainerDir: string;
let laceDir: string;
let mockCalls: Array<{ command: string; args: string[]; cwd?: string }>;

/** Mock subprocess that always succeeds. */
function createMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };
}

/** Mock subprocess that fails on first call (clone). */
function createFailingMock(): RunSubprocess {
  return (command, args, opts) => {
    mockCalls.push({ command, args, cwd: opts?.cwd });
    return {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: repository not found",
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
    `lace-test-resolve-mounts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  devcontainerDir = join(workspaceRoot, ".devcontainer");
  laceDir = join(workspaceRoot, ".lace");
  mockCalls = [];
  mkdirSync(workspaceRoot, { recursive: true });

  // Set LACE_SETTINGS to point to our test settings location
  process.env.LACE_SETTINGS = join(
    workspaceRoot,
    ".config",
    "lace",
    "settings.json",
  );
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  delete process.env.LACE_SETTINGS;
});

const SIMPLE_PLUGINS_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    customizations: {
      lace: {
        plugins: {
          "github.com/user/dotfiles": {},
        },
      },
    },
  },
  null,
  2,
);

const MULTI_PLUGINS_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    customizations: {
      lace: {
        plugins: {
          "github.com/user/dotfiles": {},
          "github.com/user/claude-plugin": { alias: "claude" },
        },
      },
    },
  },
  null,
  2,
);

const CONFLICT_PLUGINS_JSON = JSON.stringify(
  {
    build: { dockerfile: "Dockerfile" },
    customizations: {
      lace: {
        plugins: {
          "github.com/alice/utils": {},
          "github.com/bob/utils": {},
        },
      },
    },
  },
  null,
  2,
);

describe("resolve-mounts: happy path (all overridden)", () => {
  it("writes resolved-mounts.json with correct content", () => {
    setupWorkspace(SIMPLE_PLUGINS_JSON);

    // Create override source directory
    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: overrideSource,
          },
        },
      },
    });

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Resolved 1 plugin(s)");
    expect(result.message).toContain("1 override(s)");

    // Verify file was written
    expect(existsSync(join(laceDir, "resolved-mounts.json"))).toBe(true);

    const resolved = JSON.parse(
      readFileSync(join(laceDir, "resolved-mounts.json"), "utf-8"),
    ) as ResolvedMounts;

    expect(resolved.version).toBe(2);
    expect(resolved.plugins).toHaveLength(1);
    expect(resolved.plugins[0].repoId).toBe("github.com/user/dotfiles");
    expect(resolved.plugins[0].source).toBe(overrideSource);
    expect(resolved.plugins[0].isOverride).toBe(true);
  });
});

describe("resolve-mounts: happy path (shallow clones)", () => {
  it("clones plugins and generates mounts", () => {
    setupWorkspace(SIMPLE_PLUGINS_JSON);
    setupSettings({});

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("1 clone(s)");

    // Verify git clone was called
    expect(mockCalls).toContainEqual(
      expect.objectContaining({
        command: "git",
        args: expect.arrayContaining(["clone"]),
      }),
    );

    // Verify resolved output
    expect(result.resolved?.plugins[0].isOverride).toBe(false);
    expect(result.mountSpecs).toHaveLength(1);
    expect(result.mountSpecs?.[0]).toContain("type=bind");
  });
});

describe("resolve-mounts: no plugins declared", () => {
  it("returns info message without error", () => {
    setupWorkspace(
      JSON.stringify({
        build: { dockerfile: "Dockerfile" },
      }),
    );

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("No plugins configured");
  });
});

describe("resolve-mounts: clone failure", () => {
  it("exits non-zero with error message", () => {
    setupWorkspace(SIMPLE_PLUGINS_JSON);
    setupSettings({});

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createFailingMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Failed to clone plugin");
  });
});

describe("resolve-mounts: override source missing", () => {
  it("exits non-zero with error message", () => {
    setupWorkspace(SIMPLE_PLUGINS_JSON);
    setupSettings({
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: join(workspaceRoot, "nonexistent"),
          },
        },
      },
    });

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("override source does not exist");
  });
});

describe("resolve-mounts: name conflict", () => {
  it("exits non-zero with guidance", () => {
    setupWorkspace(CONFLICT_PLUGINS_JSON);
    setupSettings({});

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Plugin name conflict");
    expect(result.message).toContain("utils");
    expect(result.message).toContain("alias");
  });
});

describe("resolve-mounts: --dry-run", () => {
  it("reports planned actions without side effects", () => {
    setupWorkspace(MULTI_PLUGINS_JSON);

    // Create one override
    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: { source: overrideSource },
        },
      },
    });

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      dryRun: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Dry run");
    expect(result.message).toContain("2 plugin(s)");
    expect(result.message).toContain("[override]");
    expect(result.message).toContain("[clone]");

    // No side effects
    expect(existsSync(join(laceDir, "resolved-mounts.json"))).toBe(false);
    expect(mockCalls).toHaveLength(0);
  });
});

describe("resolve-mounts: symlink generation", () => {
  it("generates symlink command for custom target", () => {
    setupWorkspace(SIMPLE_PLUGINS_JSON);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: {
            source: overrideSource,
            target: "/home/user/dotfiles",
          },
        },
      },
    });

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.symlinkCommand).not.toBeNull();
    expect(result.symlinkCommand).toContain("ln -s");
    expect(result.symlinkCommand).toContain("/mnt/lace/plugins/dotfiles");
    expect(result.symlinkCommand).toContain("/home/user/dotfiles");
  });
});

describe("resolve-mounts: devcontainer.json missing", () => {
  it("exits non-zero with error", () => {
    // Don't set up workspace
    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Cannot read devcontainer.json");
  });
});

describe("resolve-mounts: plugins explicitly null", () => {
  it("exits silently", () => {
    setupWorkspace(
      JSON.stringify({
        build: { dockerfile: "Dockerfile" },
        customizations: {
          lace: {
            plugins: null,
          },
        },
      }),
    );

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toBe("");
  });
});

describe("resolve-mounts: multiple plugins with mixed resolution", () => {
  it("handles override and clone plugins together", () => {
    setupWorkspace(MULTI_PLUGINS_JSON);

    const overrideSource = join(workspaceRoot, "local-dotfiles");
    mkdirSync(overrideSource, { recursive: true });

    setupSettings({
      plugins: {
        "github.com/user/dotfiles": {
          overrideMount: { source: overrideSource },
        },
        // claude-plugin has no override, will be cloned
      },
    });

    const result = runResolveMounts({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("2 plugin(s)");
    expect(result.message).toContain("1 override(s)");
    expect(result.message).toContain("1 clone(s)");

    // Verify both plugins are in the result
    expect(result.resolved?.plugins).toHaveLength(2);
    expect(result.mountSpecs).toHaveLength(2);
  });
});
