// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as jsonc from "jsonc-parser";
import {
  extractPrebuildFeatures,
  extractPlugins,
  derivePluginName,
  getPluginNameOrAlias,
  parseRepoId,
  resolveBuildSource,
  resolveDockerfilePath,
  generateTempDevcontainerJson,
  DevcontainerConfigError,
  rewriteImageField,
  hasLaceLocalImage,
  getCurrentImage,
} from "@/lib/devcontainer";

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

  it("resolves legacy dockerfile field from fixture", () => {
    const raw = readFixture("legacy-dockerfile-field.jsonc");
    expect(resolveDockerfilePath(raw, configDir)).toBe(
      "/workspace/.devcontainer/Dockerfile",
    );
  });

  it("resolves nested build path from fixture", () => {
    const raw = readFixture("nested-build-path.jsonc");
    expect(resolveDockerfilePath(raw, configDir)).toBe(
      "/workspace/Dockerfile",
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

  it("errors on image-based config from fixture", () => {
    const raw = readFixture("image-based.jsonc");
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
      /Cannot determine build source/,
    );
  });
});

// --- Build source resolution ---

describe("resolveBuildSource", () => {
  const configDir = "/workspace/.devcontainer";

  it("returns dockerfile kind for build.dockerfile", () => {
    const raw = { build: { dockerfile: "Dockerfile" } };
    const result = resolveBuildSource(raw, configDir);
    expect(result).toEqual({
      kind: "dockerfile",
      path: "/workspace/.devcontainer/Dockerfile",
    });
  });

  it("returns dockerfile kind for legacy dockerfile field", () => {
    const raw = { dockerfile: "Dockerfile" };
    const result = resolveBuildSource(raw, configDir);
    expect(result).toEqual({
      kind: "dockerfile",
      path: "/workspace/.devcontainer/Dockerfile",
    });
  });

  it("returns image kind for image field", () => {
    const raw = { image: "node:24" };
    const result = resolveBuildSource(raw, configDir);
    expect(result).toEqual({
      kind: "image",
      image: "node:24",
    });
  });

  it("dockerfile takes precedence over image", () => {
    const raw = { build: { dockerfile: "Dockerfile" }, image: "node:24" };
    const result = resolveBuildSource(raw, configDir);
    expect(result).toEqual({
      kind: "dockerfile",
      path: "/workspace/.devcontainer/Dockerfile",
    });
  });

  it("throws DevcontainerConfigError for empty config", () => {
    const raw = {};
    expect(() => resolveBuildSource(raw, configDir)).toThrow(
      DevcontainerConfigError,
    );
    expect(() => resolveBuildSource(raw, configDir)).toThrow(
      /Cannot determine build source/,
    );
  });

  it("throws DevcontainerConfigError for config with only features", () => {
    const raw = { features: {} };
    expect(() => resolveBuildSource(raw, configDir)).toThrow(
      DevcontainerConfigError,
    );
    expect(() => resolveBuildSource(raw, configDir)).toThrow(
      /Cannot determine build source/,
    );
  });
});

// --- Overlap fixture ---

describe("extractPrebuildFeatures: overlap fixture", () => {
  it("extracts prebuild features even when they overlap with regular features", () => {
    const raw = readFixture("overlap.jsonc");
    const result = extractPrebuildFeatures(raw);
    expect(result.kind).toBe("features");
    if (result.kind === "features") {
      expect(result.features).toHaveProperty(
        "ghcr.io/devcontainers/features/git:1",
      );
      expect(result.features).toHaveProperty(
        "ghcr.io/anthropics/devcontainer-features/claude-code:1",
      );
    }
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

// --- Plugins extraction ---

describe("extractPlugins", () => {
  it("returns plugins from standard config", () => {
    const raw = readFixture("plugins-standard.jsonc");
    const result = extractPlugins(raw);
    expect(result.kind).toBe("plugins");
    if (result.kind === "plugins") {
      expect(Object.keys(result.plugins)).toHaveLength(2);
      expect(result.plugins).toHaveProperty("github.com/user/dotfiles");
      expect(result.plugins).toHaveProperty(
        "github.com/user/claude-plugins/plugins/my-plugin",
      );
    }
  });

  it("returns plugins with aliases", () => {
    const raw = readFixture("plugins-with-alias.jsonc");
    const result = extractPlugins(raw);
    expect(result.kind).toBe("plugins");
    if (result.kind === "plugins") {
      expect(result.plugins["github.com/alice/utils"].alias).toBe("alice-utils");
      expect(result.plugins["github.com/bob/utils"].alias).toBe("bob-utils");
    }
  });

  it("returns absent when plugins is missing", () => {
    const raw = readFixture("absent-prebuild.jsonc");
    const result = extractPlugins(raw);
    expect(result.kind).toBe("absent");
  });

  it("returns null sentinel when plugins is null", () => {
    const raw = readFixture("plugins-null.jsonc");
    const result = extractPlugins(raw);
    expect(result.kind).toBe("null");
  });

  it("returns empty when plugins is {}", () => {
    const raw = readFixture("plugins-empty.jsonc");
    const result = extractPlugins(raw);
    expect(result.kind).toBe("empty");
  });

  it("returns absent when customizations key is missing", () => {
    const raw = { build: { dockerfile: "Dockerfile" } };
    const result = extractPlugins(raw);
    expect(result.kind).toBe("absent");
  });

  it("returns absent when customizations.lace is missing", () => {
    const raw = { customizations: { vscode: {} } };
    const result = extractPlugins(raw);
    expect(result.kind).toBe("absent");
  });
});

// --- Name derivation ---

describe("derivePluginName", () => {
  it("derives name from simple repo", () => {
    expect(derivePluginName("github.com/user/repo")).toBe("repo");
  });

  it("derives name from repo with subdirectory", () => {
    expect(derivePluginName("github.com/user/repo/subdir")).toBe("subdir");
  });

  it("derives name from repo with deep path", () => {
    expect(derivePluginName("github.com/user/repo/deep/path")).toBe("path");
  });

  it("handles trailing slash", () => {
    // The filter removes empty segments
    expect(derivePluginName("github.com/user/repo/")).toBe("repo");
  });
});

describe("getPluginNameOrAlias", () => {
  it("uses alias when provided", () => {
    expect(
      getPluginNameOrAlias("github.com/user/utils", { alias: "user-utils" }),
    ).toBe("user-utils");
  });

  it("derives name when no alias", () => {
    expect(getPluginNameOrAlias("github.com/user/repo", {})).toBe("repo");
  });

  it("derives name from subdirectory when no alias", () => {
    expect(
      getPluginNameOrAlias("github.com/user/repo/plugins/foo", {}),
    ).toBe("foo");
  });
});

// --- Repo ID parsing ---

describe("parseRepoId", () => {
  it("parses simple github repo", () => {
    const result = parseRepoId("github.com/user/repo");
    expect(result.cloneUrl).toBe("https://github.com/user/repo.git");
    expect(result.subdirectory).toBeUndefined();
  });

  it("parses repo with subdirectory", () => {
    const result = parseRepoId("github.com/user/repo/subdir");
    expect(result.cloneUrl).toBe("https://github.com/user/repo.git");
    expect(result.subdirectory).toBe("subdir");
  });

  it("parses repo with deep subdirectory path", () => {
    const result = parseRepoId("github.com/user/repo/plugins/my-plugin");
    expect(result.cloneUrl).toBe("https://github.com/user/repo.git");
    expect(result.subdirectory).toBe("plugins/my-plugin");
  });

  it("parses gitlab repo", () => {
    const result = parseRepoId("gitlab.com/org/project");
    expect(result.cloneUrl).toBe("https://gitlab.com/org/project.git");
    expect(result.subdirectory).toBeUndefined();
  });

  it("throws on invalid repo id (too few segments)", () => {
    expect(() => parseRepoId("github.com/user")).toThrow(DevcontainerConfigError);
    expect(() => parseRepoId("github.com/user")).toThrow(/Invalid repo identifier/);
  });

  it("throws on single segment", () => {
    expect(() => parseRepoId("github.com")).toThrow(DevcontainerConfigError);
  });
});

// --- Image field rewriting ---

describe("rewriteImageField", () => {
  it("rewrites image field in simple JSON", () => {
    const input = '{"image": "node:24"}';
    const result = rewriteImageField(input, "lace.local/node:24");
    expect(JSON.parse(result).image).toBe("lace.local/node:24");
  });

  it("preserves comments in JSONC", () => {
    const input = `{
  // This is a comment
  "image": "node:24",
  "features": {}
}`;
    const result = rewriteImageField(input, "lace.local/node:24");
    expect(result).toContain("// This is a comment");
    expect(result).toContain('"lace.local/node:24"');
  });

  it("preserves other fields", () => {
    const input = '{"image": "node:24", "features": {"foo": {}}}';
    const result = rewriteImageField(input, "lace.local/node:24");
    const parsed = JSON.parse(result);
    expect(parsed.image).toBe("lace.local/node:24");
    expect(parsed.features).toEqual({ foo: {} });
  });
});

// --- Lace local image detection ---

describe("hasLaceLocalImage", () => {
  it("returns true for lace.local image", () => {
    expect(hasLaceLocalImage({ image: "lace.local/node:24" })).toBe(true);
  });

  it("returns false for non-lace.local image", () => {
    expect(hasLaceLocalImage({ image: "node:24" })).toBe(false);
  });

  it("returns false when image is not a string", () => {
    expect(hasLaceLocalImage({ image: 123 })).toBe(false);
    expect(hasLaceLocalImage({})).toBe(false);
  });
});

// --- Get current image ---

describe("getCurrentImage", () => {
  it("returns image when present", () => {
    expect(getCurrentImage({ image: "node:24" })).toBe("node:24");
  });

  it("returns null when image is not a string", () => {
    expect(getCurrentImage({ image: 123 })).toBe(null);
    expect(getCurrentImage({})).toBe(null);
  });
});
