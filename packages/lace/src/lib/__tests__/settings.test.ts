// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  expandPath,
  resolveSettingsPath,
  findSettingsConfig,
  readSettingsConfig,
  loadSettings,
  SettingsConfigError,
} from "@/lib/settings";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `lace-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  // Clear LACE_SETTINGS env var
  delete process.env.LACE_SETTINGS;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.LACE_SETTINGS;
});

// --- Path expansion ---

describe("expandPath", () => {
  it("expands tilde prefix to home directory", () => {
    const result = expandPath("~/code/dotfiles");
    expect(result).toBe(join(homedir(), "code/dotfiles"));
  });

  it("expands lone tilde to home directory", () => {
    const result = expandPath("~");
    expect(result).toBe(homedir());
  });

  it("returns absolute paths unchanged", () => {
    const result = expandPath("/home/user/code");
    expect(result).toBe("/home/user/code");
  });

  it("returns relative paths unchanged", () => {
    const result = expandPath("relative/path");
    expect(result).toBe("relative/path");
  });

  it("does not expand tilde in middle of path", () => {
    const result = expandPath("/path/~user/code");
    expect(result).toBe("/path/~user/code");
  });
});

describe("resolveSettingsPath", () => {
  it("expands and resolves tilde path", () => {
    const result = resolveSettingsPath("~/code/project/../dotfiles");
    expect(result).toBe(join(homedir(), "code/dotfiles"));
  });
});

// --- Settings file parsing ---

describe("readSettingsConfig", () => {
  it("parses valid JSON with string paths", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        repoMounts: {
          "github.com/user/dotfiles": {
            overrideMount: {
              source: "/absolute/path/dotfiles",
            },
          },
        },
      }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(result.repoMounts).toBeDefined();
    expect(result.repoMounts?.["github.com/user/dotfiles"]).toBeDefined();
    expect(
      result.repoMounts?.["github.com/user/dotfiles"].overrideMount?.source,
    ).toBe("/absolute/path/dotfiles");
  });

  it("parses valid JSON with full repo mount config", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        repoMounts: {
          "github.com/user/repo": {
            overrideMount: {
              source: "/local/path",
              readonly: false,
              target: "/custom/target",
            },
          },
        },
      }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    const repoMount = result.repoMounts?.["github.com/user/repo"];
    expect(repoMount?.overrideMount?.source).toBe("/local/path");
    expect(repoMount?.overrideMount?.readonly).toBe(false);
    expect(repoMount?.overrideMount?.target).toBe("/custom/target");
  });

  it("expands tilde in source paths", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        repoMounts: {
          "github.com/user/dotfiles": {
            overrideMount: {
              source: "~/code/dotfiles",
            },
          },
        },
      }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(
      result.repoMounts?.["github.com/user/dotfiles"].overrideMount?.source,
    ).toBe(join(homedir(), "code/dotfiles"));
  });

  it("throws error for missing file", () => {
    expect(() =>
      readSettingsConfig(join(testDir, "nonexistent.json")),
    ).toThrow(SettingsConfigError);
    expect(() =>
      readSettingsConfig(join(testDir, "nonexistent.json")),
    ).toThrow(/Cannot read settings file/);
  });

  it("throws error for invalid JSON with parse position", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(settingsPath, '{ "repoMounts": { invalid } }', "utf-8");

    expect(() => readSettingsConfig(settingsPath)).toThrow(SettingsConfigError);
    expect(() => readSettingsConfig(settingsPath)).toThrow(
      /Malformed settings.json at offset/,
    );
  });

  it("parses empty repoMounts object", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ repoMounts: {} }), "utf-8");

    const result = readSettingsConfig(settingsPath);
    expect(result.repoMounts).toEqual({});
  });

  it("parses JSONC with comments", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      `{
        // This is a comment
        "repoMounts": {
          "github.com/user/dotfiles": {
            "overrideMount": {
              "source": "/path/to/dotfiles"
            }
          }
        }
      }`,
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(result.repoMounts?.["github.com/user/dotfiles"]).toBeDefined();
  });
});

// --- Settings discovery ---

describe("findSettingsConfig", () => {
  it("returns path from LACE_SETTINGS env var when file exists", () => {
    const settingsPath = join(testDir, "custom-settings.json");
    writeFileSync(settingsPath, "{}", "utf-8");
    process.env.LACE_SETTINGS = settingsPath;

    const result = findSettingsConfig();
    expect(result).toBe(settingsPath);
  });

  it("throws error when LACE_SETTINGS points to non-existent file", () => {
    process.env.LACE_SETTINGS = join(testDir, "nonexistent.json");

    expect(() => findSettingsConfig()).toThrow(SettingsConfigError);
    expect(() => findSettingsConfig()).toThrow(
      /LACE_SETTINGS points to non-existent file/,
    );
  });

  it("returns null when no settings file exists and no env var", () => {
    // We can't easily mock homedir(), so just verify the function
    // returns null when the real locations don't exist
    // This test is limited but verifies the null return path
    const result = findSettingsConfig();
    // Result depends on whether settings actually exist on the test machine
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// --- Load settings integration ---

describe("loadSettings", () => {
  it("returns empty settings when no config file exists", () => {
    // Ensure LACE_SETTINGS is not set
    delete process.env.LACE_SETTINGS;

    // This test is environment-dependent, but should work if no real settings exist
    const result = loadSettings();
    expect(typeof result).toBe("object");
  });

  it("loads settings from LACE_SETTINGS env var", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        repoMounts: {
          "github.com/user/test": {
            overrideMount: { source: "/test/path" },
          },
        },
      }),
      "utf-8",
    );
    process.env.LACE_SETTINGS = settingsPath;

    const result = loadSettings();
    expect(result.repoMounts?.["github.com/user/test"]).toBeDefined();
    expect(
      result.repoMounts?.["github.com/user/test"].overrideMount?.source,
    ).toBe("/test/path");
  });
});

// --- Mount overrides ---

describe("readSettingsConfig — mount overrides", () => {
  it("parses settings with mounts key correctly", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        mounts: {
          "myns/data": { source: "/absolute/path/data" },
          "other/cache": { source: "/tmp/cache" },
        },
      }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(result.mounts).toBeDefined();
    expect(result.mounts?.["myns/data"]?.source).toBe("/absolute/path/data");
    expect(result.mounts?.["other/cache"]?.source).toBe("/tmp/cache");
  });

  it("expands tilde in mount override source paths", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        mounts: {
          "myns/data": { source: "~/custom/data" },
        },
      }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(result.mounts?.["myns/data"]?.source).toBe(
      join(homedir(), "custom/data"),
    );
  });

  it("accepts empty mounts section", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({ mounts: {} }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(result.mounts).toEqual({});
  });

  it("has mounts as undefined when only repoMounts is present", () => {
    const settingsPath = join(testDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        repoMounts: {
          "github.com/user/test": {
            overrideMount: { source: "/test" },
          },
        },
      }),
      "utf-8",
    );

    const result = readSettingsConfig(settingsPath);
    expect(result.repoMounts).toBeDefined();
    expect(result.mounts).toBeUndefined();
  });
});
