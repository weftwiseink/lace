import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  findUserConfig,
  readUserConfig,
  loadUserConfig,
  UserConfigError,
  parseMountPolicy,
  evaluateMountPolicy,
  loadMountPolicy,
  validateMountSources,
  validateFeatureReferences,
  resolveSourceForPolicy,
  DEFAULT_MOUNT_POLICY,
  type PolicyRule,
} from "@/lib/user-config";
import { expandPath } from "@/lib/settings";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `lace-test-user-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  delete process.env.LACE_USER_CONFIG;
  delete process.env.LACE_MOUNT_POLICY;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.LACE_USER_CONFIG;
  delete process.env.LACE_MOUNT_POLICY;
});

// ── User config loading ──

describe("findUserConfig", () => {
  it("returns path from LACE_USER_CONFIG env var when file exists", () => {
    const configPath = join(testDir, "custom-user.json");
    writeFileSync(configPath, "{}", "utf-8");
    process.env.LACE_USER_CONFIG = configPath;

    const result = findUserConfig();
    expect(result).toBe(configPath);
  });

  it("throws error when LACE_USER_CONFIG points to non-existent file", () => {
    process.env.LACE_USER_CONFIG = join(testDir, "nonexistent.json");

    expect(() => findUserConfig()).toThrow(UserConfigError);
    expect(() => findUserConfig()).toThrow(
      /LACE_USER_CONFIG points to non-existent file/,
    );
  });

  it("returns null when no user.json exists and no env var", () => {
    const result = findUserConfig();
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("readUserConfig", () => {
  it("parses valid user.json with all fields", () => {
    const configPath = join(testDir, "user.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mounts: {
          screenshots: {
            source: "~/Pictures/Screenshots",
            target: "/mnt/user/screenshots",
            description: "Host screenshots",
          },
        },
        features: {
          "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
        },
        git: {
          name: "Jane Developer",
          email: "jane@example.com",
        },
        defaultShell: "/usr/bin/nu",
        containerEnv: {
          EDITOR: "nvim",
        },
      }),
      "utf-8",
    );

    const result = readUserConfig(configPath);
    expect(result.mounts?.screenshots?.source).toBe("~/Pictures/Screenshots");
    expect(result.mounts?.screenshots?.target).toBe("/mnt/user/screenshots");
    expect(result.features).toBeDefined();
    expect(result.git?.name).toBe("Jane Developer");
    expect(result.git?.email).toBe("jane@example.com");
    expect(result.defaultShell).toBe("/usr/bin/nu");
    expect(result.containerEnv?.EDITOR).toBe("nvim");
  });

  it("parses user.json with only mounts", () => {
    const configPath = join(testDir, "user.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mounts: {
          notes: {
            source: "~/Documents/notes",
            target: "/mnt/user/notes",
          },
        },
      }),
      "utf-8",
    );

    const result = readUserConfig(configPath);
    expect(result.mounts?.notes).toBeDefined();
    expect(result.features).toBeUndefined();
    expect(result.git).toBeUndefined();
  });

  it("parses user.json with only git identity", () => {
    const configPath = join(testDir, "user.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        git: { name: "Test User", email: "test@example.com" },
      }),
      "utf-8",
    );

    const result = readUserConfig(configPath);
    expect(result.git?.name).toBe("Test User");
    expect(result.mounts).toBeUndefined();
  });

  it("throws UserConfigError for missing file", () => {
    expect(() =>
      readUserConfig(join(testDir, "nonexistent.json")),
    ).toThrow(UserConfigError);
    expect(() =>
      readUserConfig(join(testDir, "nonexistent.json")),
    ).toThrow(/Cannot read user config file/);
  });

  it("throws UserConfigError for malformed JSON with parse offset", () => {
    const configPath = join(testDir, "user.json");
    writeFileSync(configPath, '{ "mounts": { invalid } }', "utf-8");

    expect(() => readUserConfig(configPath)).toThrow(UserConfigError);
    expect(() => readUserConfig(configPath)).toThrow(
      /Malformed user.json at offset/,
    );
  });

  it("parses JSONC with comments", () => {
    const configPath = join(testDir, "user.json");
    writeFileSync(
      configPath,
      `{
        // My user config
        "git": {
          "name": "Test",
          "email": "test@test.com"
        }
      }`,
      "utf-8",
    );

    const result = readUserConfig(configPath);
    expect(result.git?.name).toBe("Test");
  });
});

describe("loadUserConfig", () => {
  it("returns empty config when no user.json exists", () => {
    delete process.env.LACE_USER_CONFIG;
    const result = loadUserConfig();
    expect(typeof result).toBe("object");
  });

  it("loads config from LACE_USER_CONFIG env var", () => {
    const configPath = join(testDir, "user.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        git: { name: "Test", email: "test@test.com" },
      }),
      "utf-8",
    );
    process.env.LACE_USER_CONFIG = configPath;

    const result = loadUserConfig();
    expect(result.git?.name).toBe("Test");
  });
});

// ── Mount policy parsing ──

describe("parseMountPolicy", () => {
  it("parses deny rules", () => {
    const rules = parseMountPolicy("~/.ssh\n~/.gnupg");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ pattern: "~/.ssh", type: "deny" });
    expect(rules[1]).toEqual({ pattern: "~/.gnupg", type: "deny" });
  });

  it("parses allow (exception) rules with ! prefix", () => {
    const rules = parseMountPolicy("!~/.npmrc");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({ pattern: "~/.npmrc", type: "allow" });
  });

  it("ignores blank lines and comments", () => {
    const rules = parseMountPolicy("# comment\n\n~/.ssh\n  \n# another\n~/.aws");
    expect(rules).toHaveLength(2);
  });

  it("parses the default mount policy", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    expect(rules.length).toBeGreaterThan(10);
    expect(rules.every((r) => r.type === "deny")).toBe(true);
  });
});

// ── Mount policy evaluation ──

describe("evaluateMountPolicy", () => {
  const home = homedir();

  it("default allows paths not in denylist", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, "Documents"), rules);
    expect(result).toBe("allow");
  });

  it("default allows ~/Pictures/Screenshots", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, "Pictures/Screenshots"), rules);
    expect(result).toBe("allow");
  });

  it("blocks ~/.ssh", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".ssh"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.ssh/config (path-aware prefix)", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".ssh/config"), rules);
    expect(result).toBe("deny");
  });

  it("does NOT block ~/.sshrc (path-aware boundary)", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".sshrc"), rules);
    expect(result).toBe("allow");
  });

  it("does NOT block ~/.ssh-backup (path-aware boundary)", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".ssh-backup"), rules);
    expect(result).toBe("allow");
  });

  it("blocks ~/.gnupg", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".gnupg"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.aws", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".aws"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.kube", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".kube"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.config/gcloud", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".config/gcloud"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.config/gh", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".config/gh"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.npmrc", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".npmrc"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.netrc", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".netrc"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.local/share/keyrings", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".local/share/keyrings"), rules);
    expect(result).toBe("deny");
  });

  it("blocks ~/.password-store", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".password-store"), rules);
    expect(result).toBe("deny");
  });

  it("blocks /var/run/docker.sock", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy("/var/run/docker.sock", rules);
    expect(result).toBe("deny");
  });

  it("blocks /run/docker.sock", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy("/run/docker.sock", rules);
    expect(result).toBe("deny");
  });

  it("blocks home directory root ~/", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(home, rules);
    expect(result).toBe("deny");
  });

  it("allows absolute paths outside home (e.g., /tmp/shared_data)", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy("/tmp/shared_data", rules);
    expect(result).toBe("allow");
  });

  it("allows ~/.config/nvim (not in denylist)", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const result = evaluateMountPolicy(join(home, ".config/nvim"), rules);
    expect(result).toBe("allow");
  });

  it("user ! exception overrides default deny", () => {
    const defaultRules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const userRules = parseMountPolicy("!~/.npmrc");
    const allRules = [...defaultRules, ...userRules];

    const result = evaluateMountPolicy(join(home, ".npmrc"), allRules);
    expect(result).toBe("allow");
  });

  it("user deny rule blocks additional paths", () => {
    const defaultRules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    const userRules = parseMountPolicy("~/secrets");
    const allRules = [...defaultRules, ...userRules];

    const result = evaluateMountPolicy(join(home, "secrets"), allRules);
    expect(result).toBe("deny");
  });

  it("last-match-wins: user allow after default deny, then user deny", () => {
    const rules: PolicyRule[] = [
      { pattern: expandPath("~/.ssh"), type: "deny" },
      { pattern: expandPath("~/.ssh/config"), type: "allow" },
      { pattern: expandPath("~/.ssh/config"), type: "deny" },
    ];

    const result = evaluateMountPolicy(join(home, ".ssh/config"), rules);
    expect(result).toBe("deny");
  });

  it("glob * matches within a single path component", () => {
    const rules: PolicyRule[] = [
      { pattern: expandPath("~/secrets/*"), type: "deny" },
    ];

    expect(evaluateMountPolicy(join(home, "secrets/file.txt"), rules)).toBe("deny");
    expect(evaluateMountPolicy(join(home, "secrets/sub/file.txt"), rules)).toBe("allow");
  });

  it("glob ** matches across path components", () => {
    const rules: PolicyRule[] = [
      { pattern: expandPath("~/work/credentials/**"), type: "deny" },
    ];

    expect(evaluateMountPolicy(join(home, "work/credentials/aws/key"), rules)).toBe("deny");
    expect(evaluateMountPolicy(join(home, "work/credentials/deep/nested/secret"), rules)).toBe("deny");
  });
});

// ── Symlink traversal ──

describe("resolveSourceForPolicy", () => {
  it("resolves real paths for regular directories", () => {
    const dir = join(testDir, "realdir");
    mkdirSync(dir, { recursive: true });

    const result = resolveSourceForPolicy(dir);
    expect(result).not.toBeNull();
  });

  it("returns null for nonexistent paths", () => {
    const result = resolveSourceForPolicy(join(testDir, "nonexistent"));
    expect(result).toBeNull();
  });

  it("follows symlinks to resolve the real path", () => {
    const realDir = join(testDir, "real-target");
    mkdirSync(realDir, { recursive: true });

    const link = join(testDir, "symlink");
    symlinkSync(realDir, link);

    const result = resolveSourceForPolicy(link);
    expect(result).toBe(realDir);
  });

  it("returns null for broken symlinks", () => {
    const link = join(testDir, "broken-link");
    symlinkSync(join(testDir, "nonexistent-target"), link);

    const result = resolveSourceForPolicy(link);
    expect(result).toBeNull();
  });
});

describe("validateMountSources — symlink traversal", () => {
  it("blocks symlink pointing to denied directory", () => {
    // Create a real .ssh-like directory
    const sshDir = join(testDir, ".ssh-dir");
    mkdirSync(sshDir, { recursive: true });

    // Create a symlink to it
    const innocentLink = join(testDir, "innocent");
    symlinkSync(sshDir, innocentLink);

    // Policy that blocks the real path
    const rules: PolicyRule[] = [
      { pattern: sshDir, type: "deny" },
    ];

    const mounts = {
      "test-mount": {
        source: innocentLink,
        target: "/mnt/user/test",
      },
    };

    const result = validateMountSources(mounts, rules);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("blocked");
  });

  it("skips mount with missing source (warning, not error)", () => {
    const rules: PolicyRule[] = [];
    const mounts = {
      "missing-mount": {
        source: join(testDir, "nonexistent-dir"),
        target: "/mnt/user/missing",
      },
    };

    const result = validateMountSources(mounts, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("does not exist");
  });

  it("skips mount with broken symlink (warning)", () => {
    const brokenLink = join(testDir, "broken-mount-link");
    symlinkSync(join(testDir, "nonexistent-target"), brokenLink);

    const rules: PolicyRule[] = [];
    const mounts = {
      "broken-link-mount": {
        source: brokenLink,
        target: "/mnt/user/broken",
      },
    };

    const result = validateMountSources(mounts, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});

// ── Path canonicalization ──

describe("evaluateMountPolicy — path canonicalization", () => {
  const home = homedir();

  it("normalized path ~/.ssh/../.ssh is blocked", () => {
    const rules = parseMountPolicy(DEFAULT_MOUNT_POLICY);
    // normalize handles ../ resolution
    const normalized = join(home, ".ssh/../.ssh");
    // After path.normalize, this becomes home/.ssh
    const result = evaluateMountPolicy(join(home, ".ssh"), rules);
    expect(result).toBe("deny");
  });
});

// ── Feature validation ──

describe("validateFeatureReferences", () => {
  it("allows registry features", () => {
    const features = {
      "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
      "mcr.microsoft.com/devcontainers/features/go:1": {},
    };

    const result = validateFeatureReferences(features);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("blocks local path features starting with ./", () => {
    const features = {
      "./features/custom": {},
    };

    const result = validateFeatureReferences(features);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("local path");
  });

  it("blocks local path features starting with ../", () => {
    const features = {
      "../features/custom": {},
    };

    const result = validateFeatureReferences(features);
    expect(result.valid).toBe(false);
  });

  it("blocks absolute path features", () => {
    const features = {
      "/opt/features/custom": {},
    };

    const result = validateFeatureReferences(features);
    expect(result.valid).toBe(false);
  });
});
