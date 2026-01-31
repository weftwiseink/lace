// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as jsonc from "jsonc-parser";
import {
  extractPrebuildFeatures,
  resolveDockerfilePath,
  generateTempDevcontainerJson,
  DevcontainerConfigError,
} from "../devcontainer.js";

const FIXTURES = join(import.meta.dirname, "../../__fixtures__/devcontainers");

function readFixture(name: string): Record<string, unknown> {
  const content = readFileSync(join(FIXTURES, name), "utf-8");
  return jsonc.parse(content) as Record<string, unknown>;
}

// --- Config extraction ---

describe("extractPrebuildFeatures", () => {
  it("returns features from standard config", () => {
    const raw = readFixture("standard.jsonc");
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("features");
    if (result.kind === "features") {
      expect(Object.keys(result.features)).toHaveLength(2);
      expect(result.features).toHaveProperty(
        "ghcr.io/anthropics/devcontainer-features/claude-code:1",
      );
      expect(result.features).toHaveProperty(
        "ghcr.io/weft/devcontainer-features/wezterm-server:1",
      );
    }
  });

  it("returns absent when prebuildFeatures is missing", () => {
    const raw = readFixture("absent-prebuild.jsonc");
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("absent");
  });

  it("returns null sentinel when prebuildFeatures is null", () => {
    const raw = readFixture("null-prebuild.jsonc");
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("null");
  });

  it("returns empty when prebuildFeatures is {}", () => {
    const raw = readFixture("empty-prebuild.jsonc");
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("empty");
  });

  it("returns absent when customizations key is missing", () => {
    const raw = { build: { dockerfile: "Dockerfile" } };
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("absent");
  });

  it("returns absent when customizations.lace is missing", () => {
    const raw = { customizations: { vscode: {} } };
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("absent");
  });

  it("parses JSONC with comments and trailing commas", () => {
    const raw = readFixture("comments-and-trailing-commas.jsonc");
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("features");
    if (result.kind === "features") {
      expect(result.features).toHaveProperty(
        "ghcr.io/anthropics/devcontainer-features/claude-code:1",
      );
    }
  });

  it("preserves feature options", () => {
    const raw = readFixture("standard.jsonc");
    const result = extractPrebuildFeatures(raw);
    if (result.kind === "features") {
      const weztermOpts =
        result.features[
          "ghcr.io/weft/devcontainer-features/wezterm-server:1"
        ];
      expect(weztermOpts).toEqual({
        version: "20240203-110809-5046fc22",
      });
    }
  });
});

// --- Build config detection ---

describe("resolveDockerfilePath", () => {
  const configDir = "/workspace/.devcontainer";

  it("resolves build.dockerfile", () => {
    const raw = { build: { dockerfile: "Dockerfile" } };
    expect(resolveDockerfilePath(raw, configDir)).toBe(
      "/workspace/.devcontainer/Dockerfile",
    );
  });

  it("resolves relative build.dockerfile path", () => {
    const raw = { build: { dockerfile: "../Dockerfile" } };
    expect(resolveDockerfilePath(raw, configDir)).toBe(
      "/workspace/Dockerfile",
    );
  });

  it("resolves legacy dockerfile field", () => {
    const raw = { dockerfile: "Dockerfile" };
    expect(resolveDockerfilePath(raw, configDir)).toBe(
      "/workspace/.devcontainer/Dockerfile",
    );
  });

  it("errors on image-based config", () => {
    const raw = { image: "node:24" };
    expect(() => resolveDockerfilePath(raw, configDir)).toThrow(
      DevcontainerConfigError,
    );
    expect(() => resolveDockerfilePath(raw, configDir)).toThrow(
      /Prebuild requires a Dockerfile-based devcontainer configuration/,
    );
  });

  it("prefers build.dockerfile over image", () => {
    const raw = { build: { dockerfile: "Dockerfile" }, image: "node:24" };
    expect(resolveDockerfilePath(raw, configDir)).toBe(
      "/workspace/.devcontainer/Dockerfile",
    );
  });

  it("errors when neither image nor build specified", () => {
    const raw = {};
    expect(() => resolveDockerfilePath(raw, configDir)).toThrow(
      /Cannot determine Dockerfile path/,
    );
  });
});

// --- Temp context generation ---

describe("generateTempDevcontainerJson", () => {
  it("generates minimal config with promoted features", () => {
    const features = {
      "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
      "ghcr.io/weft/devcontainer-features/wezterm-server:1": {
        version: "20240203-110809-5046fc22",
      },
    };
    const result = JSON.parse(
      generateTempDevcontainerJson(features, "Dockerfile"),
    );
    expect(result.build.dockerfile).toBe("Dockerfile");
    expect(result.features).toEqual(features);
    expect(Object.keys(result)).toEqual(["build", "features"]);
  });

  it("does not include original features or other fields", () => {
    const features = {
      "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
    };
    const result = JSON.parse(
      generateTempDevcontainerJson(features, "Dockerfile"),
    );
    expect(result).not.toHaveProperty("customizations");
    expect(result).not.toHaveProperty("forwardPorts");
    expect(result).not.toHaveProperty("remoteUser");
  });

  it("preserves feature options in generated config", () => {
    const features = {
      "ghcr.io/foo/bar:1": { option1: "value1", option2: true },
    };
    const result = JSON.parse(
      generateTempDevcontainerJson(features, "Dockerfile"),
    );
    expect(result.features["ghcr.io/foo/bar:1"]).toEqual({
      option1: "value1",
      option2: true,
    });
  });
});
