// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sortedStringify,
  computeRuntimeFingerprint,
  readRuntimeFingerprint,
  writeRuntimeFingerprint,
  deleteRuntimeFingerprint,
  checkConfigDrift,
} from "@/lib/config-drift";

let tempDir: string;

beforeEach(() => {
  tempDir = join(
    tmpdir(),
    `lace-test-config-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(tempDir, ".lace"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("sortedStringify", () => {
  it("sorts keys at every depth", () => {
    const obj = { z: 1, a: { y: 2, b: 3 } };
    const result = sortedStringify(obj);
    expect(result).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("produces identical output for different insertion orders", () => {
    const obj1 = { a: 1, b: 2, c: 3 };
    const obj2 = { c: 3, a: 1, b: 2 };
    expect(sortedStringify(obj1)).toBe(sortedStringify(obj2));
  });

  it("preserves array ordering", () => {
    const obj = { arr: [3, 1, 2] };
    expect(sortedStringify(obj)).toBe('{"arr":[3,1,2]}');
  });

  it("handles nested objects with different key orders", () => {
    const obj1 = {
      containerEnv: { Z_VAR: "z", A_VAR: "a" },
      workspaceFolder: "/workspace",
    };
    const obj2 = {
      workspaceFolder: "/workspace",
      containerEnv: { A_VAR: "a", Z_VAR: "z" },
    };
    expect(sortedStringify(obj1)).toBe(sortedStringify(obj2));
  });
});

describe("computeRuntimeFingerprint", () => {
  it("produces a 16-character hex string", () => {
    const fp = computeRuntimeFingerprint({ workspaceFolder: "/workspace" });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different hashes for different containerEnv", () => {
    const fp1 = computeRuntimeFingerprint({
      containerEnv: { FOO: "bar" },
    });
    const fp2 = computeRuntimeFingerprint({
      containerEnv: { FOO: "baz" },
    });
    expect(fp1).not.toBe(fp2);
  });

  it("produces different hashes for different workspaceFolder", () => {
    const fp1 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace/a",
    });
    const fp2 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace/b",
    });
    expect(fp1).not.toBe(fp2);
  });

  it("produces different hashes for different mounts", () => {
    const fp1 = computeRuntimeFingerprint({
      mounts: ["type=bind,source=/a,target=/b"],
    });
    const fp2 = computeRuntimeFingerprint({
      mounts: ["type=bind,source=/c,target=/d"],
    });
    expect(fp1).not.toBe(fp2);
  });

  it("produces same hash for configs differing only in non-runtime properties", () => {
    const fp1 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      features: { "ghcr.io/foo/bar:1": {} },
    });
    const fp2 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      features: { "ghcr.io/foo/bar:2": {} },
    });
    expect(fp1).toBe(fp2);
  });

  it("produces same hash for configs with build-only differences", () => {
    const fp1 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      build: { dockerfile: "Dockerfile" },
    });
    const fp2 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      build: { dockerfile: "Dockerfile.dev" },
    });
    expect(fp1).toBe(fp2);
  });

  it("produces same hash regardless of key insertion order (deterministic serialization)", () => {
    const config1: Record<string, unknown> = {};
    config1.workspaceFolder = "/workspace";
    config1.containerEnv = { FOO: "bar" };
    config1.mounts = [];

    const config2: Record<string, unknown> = {};
    config2.mounts = [];
    config2.containerEnv = { FOO: "bar" };
    config2.workspaceFolder = "/workspace";

    expect(computeRuntimeFingerprint(config1)).toBe(
      computeRuntimeFingerprint(config2),
    );
  });

  it("produces same hash for empty config and config with only non-runtime keys", () => {
    const fp1 = computeRuntimeFingerprint({});
    const fp2 = computeRuntimeFingerprint({
      features: { "ghcr.io/foo/bar:1": {} },
      build: { dockerfile: "Dockerfile" },
    });
    expect(fp1).toBe(fp2);
  });

  it("ignores forwardPorts and appPort (managed by port allocator)", () => {
    const fp1 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      forwardPorts: [22425],
    });
    const fp2 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      forwardPorts: [22427],
    });
    expect(fp1).toBe(fp2);

    const fp3 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      appPort: [8080],
    });
    const fp4 = computeRuntimeFingerprint({
      workspaceFolder: "/workspace",
      appPort: [9090],
    });
    expect(fp3).toBe(fp4);
  });

  it("detects changes to each RUNTIME_KEYS property", () => {
    const base = computeRuntimeFingerprint({});
    const runtimeKeys = [
      "containerEnv",
      "mounts",
      "workspaceMount",
      "workspaceFolder",
      "runArgs",
      "remoteUser",
      "postCreateCommand",
    ];
    for (const key of runtimeKeys) {
      const config: Record<string, unknown> = { [key]: "test-value" };
      const fp = computeRuntimeFingerprint(config);
      expect(fp).not.toBe(base);
    }
  });
});

describe("readRuntimeFingerprint / writeRuntimeFingerprint", () => {
  it("returns null when no fingerprint file exists", () => {
    expect(readRuntimeFingerprint(tempDir)).toBeNull();
  });

  it("writes and reads back a fingerprint", () => {
    writeRuntimeFingerprint(tempDir, "abc123def456abcd");
    expect(readRuntimeFingerprint(tempDir)).toBe("abc123def456abcd");
  });

  it("overwrites existing fingerprint", () => {
    writeRuntimeFingerprint(tempDir, "first");
    writeRuntimeFingerprint(tempDir, "second");
    expect(readRuntimeFingerprint(tempDir)).toBe("second");
  });
});

describe("deleteRuntimeFingerprint", () => {
  it("deletes existing fingerprint file", () => {
    writeRuntimeFingerprint(tempDir, "abc123");
    deleteRuntimeFingerprint(tempDir);
    expect(readRuntimeFingerprint(tempDir)).toBeNull();
  });

  it("is a no-op when no fingerprint file exists", () => {
    expect(() => deleteRuntimeFingerprint(tempDir)).not.toThrow();
  });
});

describe("checkConfigDrift", () => {
  it("reports no drift on first run (no previous fingerprint)", () => {
    const config = { workspaceFolder: "/workspace" };
    const drift = checkConfigDrift(config, tempDir);
    expect(drift.drifted).toBe(false);
    expect(drift.previousFingerprint).toBeNull();
    expect(drift.currentFingerprint).toBeTruthy();
  });

  it("reports no drift when config is unchanged", () => {
    const config = { workspaceFolder: "/workspace", containerEnv: { A: "1" } };
    const fp = computeRuntimeFingerprint(config);
    writeRuntimeFingerprint(tempDir, fp);

    const drift = checkConfigDrift(config, tempDir);
    expect(drift.drifted).toBe(false);
    expect(drift.previousFingerprint).toBe(fp);
    expect(drift.currentFingerprint).toBe(fp);
  });

  it("reports drift when containerEnv changes", () => {
    const oldConfig = { containerEnv: { FOO: "old" } };
    const newConfig = { containerEnv: { FOO: "new" } };
    writeRuntimeFingerprint(tempDir, computeRuntimeFingerprint(oldConfig));

    const drift = checkConfigDrift(newConfig, tempDir);
    expect(drift.drifted).toBe(true);
  });

  it("reports drift when workspaceFolder changes", () => {
    const oldConfig = { workspaceFolder: "/workspace/old" };
    const newConfig = { workspaceFolder: "/workspace/new" };
    writeRuntimeFingerprint(tempDir, computeRuntimeFingerprint(oldConfig));

    const drift = checkConfigDrift(newConfig, tempDir);
    expect(drift.drifted).toBe(true);
  });

  it("does not report drift for non-runtime property changes", () => {
    const config = { workspaceFolder: "/workspace" };
    writeRuntimeFingerprint(tempDir, computeRuntimeFingerprint(config));

    // Adding features should not trigger drift
    const drift = checkConfigDrift(
      { workspaceFolder: "/workspace", features: { "ghcr.io/foo:1": {} } },
      tempDir,
    );
    expect(drift.drifted).toBe(false);
  });
});
