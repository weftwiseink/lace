// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeMetadata,
  readMetadata,
  contextsChanged,
} from "@/lib/metadata";

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `lace-test-metadata-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("writeMetadata / readMetadata", () => {
  it("writes and reads metadata", () => {
    const data = {
      originalFrom: "node:24-bookworm",
      timestamp: "2026-01-31T12:00:00Z",
      prebuildTag: "lace.local/node:24-bookworm",
    };
    writeMetadata(tempDir, data);
    const result = readMetadata(tempDir);
    expect(result).toEqual(data);
  });

  it("creates directory if absent", () => {
    const nestedDir = join(tempDir, "nested", "deep");
    const data = {
      originalFrom: "node:24",
      timestamp: "2026-01-31T12:00:00Z",
      prebuildTag: "lace.local/node:24",
    };
    writeMetadata(nestedDir, data);
    expect(existsSync(nestedDir)).toBe(true);
    expect(readMetadata(nestedDir)).toEqual(data);
  });

  it("overwrites existing metadata", () => {
    const data1 = {
      originalFrom: "node:24",
      timestamp: "2026-01-31T12:00:00Z",
      prebuildTag: "lace.local/node:24",
    };
    const data2 = {
      originalFrom: "ubuntu:22.04",
      timestamp: "2026-01-31T13:00:00Z",
      prebuildTag: "lace.local/ubuntu:22.04",
    };
    writeMetadata(tempDir, data1);
    writeMetadata(tempDir, data2);
    expect(readMetadata(tempDir)).toEqual(data2);
  });

  it("returns null for nonexistent directory", () => {
    expect(readMetadata(join(tempDir, "nonexistent"))).toBeNull();
  });

  it("returns null for missing metadata file", () => {
    // tempDir exists but has no metadata.json
    expect(readMetadata(tempDir)).toBeNull();
  });
});

describe("contextsChanged", () => {
  it("reports no change when contexts match", () => {
    const dockerfile = "FROM node:24\n";
    const devcontainerJson = JSON.stringify({ build: { dockerfile: "Dockerfile" } }, null, 2);
    writeFileSync(join(tempDir, "Dockerfile"), dockerfile, "utf-8");
    writeFileSync(join(tempDir, "devcontainer.json"), devcontainerJson, "utf-8");
    expect(contextsChanged(tempDir, dockerfile, devcontainerJson)).toBe(false);
  });

  it("reports change when Dockerfile differs", () => {
    writeFileSync(join(tempDir, "Dockerfile"), "FROM node:24\n", "utf-8");
    writeFileSync(join(tempDir, "devcontainer.json"), "{}", "utf-8");
    expect(contextsChanged(tempDir, "FROM ubuntu:22.04\n", "{}")).toBe(true);
  });

  it("reports change when devcontainer.json differs", () => {
    const dockerfile = "FROM node:24\n";
    writeFileSync(join(tempDir, "Dockerfile"), dockerfile, "utf-8");
    writeFileSync(join(tempDir, "devcontainer.json"), '{"features":{}}', "utf-8");
    expect(
      contextsChanged(tempDir, dockerfile, '{"features":{"ghcr.io/foo/bar:1":{}}}'),
    ).toBe(true);
  });

  it("reports change when cache directory is missing", () => {
    expect(
      contextsChanged(join(tempDir, "nonexistent"), "FROM node:24\n", "{}"),
    ).toBe(true);
  });

  it("ignores insignificant whitespace differences in JSON", () => {
    const dockerfile = "FROM node:24\n";
    const compact = '{"build":{"dockerfile":"Dockerfile"}}';
    const pretty = JSON.stringify(JSON.parse(compact), null, 2);
    writeFileSync(join(tempDir, "Dockerfile"), dockerfile, "utf-8");
    writeFileSync(join(tempDir, "devcontainer.json"), compact, "utf-8");
    expect(contextsChanged(tempDir, dockerfile, pretty)).toBe(false);
  });
});
