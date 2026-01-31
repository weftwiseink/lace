// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readLockFile,
  writeLockFile,
  mergeLockFile,
  extractPrebuiltEntries,
} from "../lockfile.js";

const FIXTURES = join(import.meta.dirname, "../../__fixtures__/lockfiles");

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `lace-test-lockfile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const PREBUILD_LOCK = {
  features: {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {
      version: "1.0.5",
      resolved:
        "ghcr.io/anthropics/devcontainer-features/claude-code@sha256:new",
      integrity: "sha256:new",
    },
  },
};

describe("readLockFile", () => {
  it("reads existing lock file", () => {
    const result = readLockFile(join(FIXTURES, "with-features.json"));
    expect(result.features).toBeDefined();
    expect(
      Object.keys(result.features as Record<string, unknown>),
    ).toHaveLength(2);
  });

  it("returns empty object for missing file", () => {
    const result = readLockFile(join(tempDir, "nonexistent.json"));
    expect(result).toEqual({});
  });
});

describe("writeLockFile", () => {
  it("writes lock file with 2-space indent", () => {
    const path = join(tempDir, "devcontainer-lock.json");
    writeLockFile(path, { features: { "foo:1": { version: "1.0" } } });
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("  ");
    expect(content).toMatch(/^\{/);
    expect(content.endsWith("\n")).toBe(true);
  });
});

describe("mergeLockFile: namespaced write", () => {
  it("creates new lock file with namespaced entries when none exists", () => {
    const projectLockPath = join(tempDir, "devcontainer-lock.json");
    const prebuildDir = join(tempDir, "prebuild");
    mkdirSync(prebuildDir, { recursive: true });
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(PREBUILD_LOCK, null, 2),
      "utf-8",
    );

    mergeLockFile(projectLockPath, prebuildDir);

    const result = readLockFile(projectLockPath);
    expect(result["lace.prebuiltFeatures"]).toEqual(
      PREBUILD_LOCK.features,
    );
  });

  it("preserves top-level entries when adding namespaced", () => {
    const projectLockPath = join(tempDir, "devcontainer-lock.json");
    copyFileSync(join(FIXTURES, "with-features.json"), projectLockPath);

    const prebuildDir = join(tempDir, "prebuild");
    mkdirSync(prebuildDir, { recursive: true });
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(PREBUILD_LOCK, null, 2),
      "utf-8",
    );

    mergeLockFile(projectLockPath, prebuildDir);

    const result = readLockFile(projectLockPath);
    // Top-level features preserved
    expect(
      Object.keys(result.features as Record<string, unknown>),
    ).toHaveLength(2);
    // Namespaced entries added
    expect(result["lace.prebuiltFeatures"]).toEqual(
      PREBUILD_LOCK.features,
    );
  });

  it("replaces stale namespaced entries", () => {
    const projectLockPath = join(tempDir, "devcontainer-lock.json");
    copyFileSync(join(FIXTURES, "with-namespaced.json"), projectLockPath);

    const prebuildDir = join(tempDir, "prebuild");
    mkdirSync(prebuildDir, { recursive: true });
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(PREBUILD_LOCK, null, 2),
      "utf-8",
    );

    mergeLockFile(projectLockPath, prebuildDir);

    const result = readLockFile(projectLockPath);
    const ns = result["lace.prebuiltFeatures"] as Record<string, unknown>;
    const entry = ns[
      "ghcr.io/anthropics/devcontainer-features/claude-code:1"
    ] as Record<string, unknown>;
    expect(entry.integrity).toBe("sha256:new"); // Updated, not "sha256:old"
  });

  it("preserves both top-level and replaces namespaced", () => {
    const projectLockPath = join(tempDir, "devcontainer-lock.json");
    copyFileSync(join(FIXTURES, "with-both.json"), projectLockPath);

    const prebuildDir = join(tempDir, "prebuild");
    mkdirSync(prebuildDir, { recursive: true });
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(PREBUILD_LOCK, null, 2),
      "utf-8",
    );

    mergeLockFile(projectLockPath, prebuildDir);

    const result = readLockFile(projectLockPath);
    expect(
      Object.keys(result.features as Record<string, unknown>),
    ).toHaveLength(1);
    expect(result["lace.prebuiltFeatures"]).toEqual(
      PREBUILD_LOCK.features,
    );
  });
});

describe("extractPrebuiltEntries", () => {
  it("extracts namespaced entries as top-level", () => {
    const result = extractPrebuiltEntries(
      join(FIXTURES, "with-namespaced.json"),
    );
    expect(result).toHaveProperty(
      "ghcr.io/anthropics/devcontainer-features/claude-code:1",
    );
  });

  it("returns empty for lock file without namespace", () => {
    const result = extractPrebuiltEntries(
      join(FIXTURES, "with-features.json"),
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns empty for missing lock file", () => {
    const result = extractPrebuiltEntries(
      join(tempDir, "nonexistent.json"),
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("does not include top-level entries", () => {
    const result = extractPrebuiltEntries(join(FIXTURES, "with-both.json"));
    expect(result).not.toHaveProperty(
      "ghcr.io/devcontainers/features/git:1",
    );
    expect(result).toHaveProperty(
      "ghcr.io/anthropics/devcontainer-features/claude-code:1",
    );
  });
});

describe("round-trip", () => {
  it("write then read returns matching entries", () => {
    const projectLockPath = join(tempDir, "devcontainer-lock.json");
    const prebuildDir = join(tempDir, "prebuild");
    mkdirSync(prebuildDir, { recursive: true });
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(PREBUILD_LOCK, null, 2),
      "utf-8",
    );

    mergeLockFile(projectLockPath, prebuildDir);
    const extracted = extractPrebuiltEntries(projectLockPath);
    expect(extracted).toEqual(PREBUILD_LOCK.features);
  });

  it("second prebuild replaces first's entries entirely", () => {
    const projectLockPath = join(tempDir, "devcontainer-lock.json");
    const prebuildDir = join(tempDir, "prebuild");
    mkdirSync(prebuildDir, { recursive: true });

    // First prebuild
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(PREBUILD_LOCK, null, 2),
      "utf-8",
    );
    mergeLockFile(projectLockPath, prebuildDir);

    // Second prebuild with different features
    const secondLock = {
      features: {
        "ghcr.io/weft/devcontainer-features/wezterm-server:1": {
          version: "1.0.0",
          resolved: "ghcr.io/weft/devcontainer-features/wezterm-server@sha256:xyz",
          integrity: "sha256:xyz",
        },
      },
    };
    writeFileSync(
      join(prebuildDir, "devcontainer-lock.json"),
      JSON.stringify(secondLock, null, 2),
      "utf-8",
    );
    mergeLockFile(projectLockPath, prebuildDir);

    const extracted = extractPrebuiltEntries(projectLockPath);
    expect(extracted).toEqual(secondLock.features);
    // First entries are gone
    expect(extracted).not.toHaveProperty(
      "ghcr.io/anthropics/devcontainer-features/claude-code:1",
    );
  });
});
