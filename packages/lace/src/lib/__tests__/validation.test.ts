// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { validateNoOverlap, featureIdentifier } from "../validation.js";

describe("featureIdentifier", () => {
  it("strips version tag", () => {
    expect(featureIdentifier("ghcr.io/devcontainers/features/git:1")).toBe(
      "ghcr.io/devcontainers/features/git",
    );
  });

  it("strips version tag regardless of version number", () => {
    expect(featureIdentifier("ghcr.io/devcontainers/features/git:2")).toBe(
      "ghcr.io/devcontainers/features/git",
    );
  });

  it("returns reference as-is when no colon present", () => {
    expect(
      featureIdentifier("ghcr.io/devcontainers/features/git"),
    ).toBe("ghcr.io/devcontainers/features/git");
  });
});

describe("validateNoOverlap", () => {
  it("passes when no overlap", () => {
    const result = validateNoOverlap(
      { "ghcr.io/foo/bar:1": {} },
      { "ghcr.io/baz/qux:1": {} },
    );
    expect(result).toEqual([]);
  });

  it("fails on exact version match", () => {
    const result = validateNoOverlap(
      { "ghcr.io/foo/bar:1": {} },
      { "ghcr.io/foo/bar:1": {} },
    );
    expect(result).toEqual(["ghcr.io/foo/bar"]);
  });

  it("fails on version-insensitive match", () => {
    const result = validateNoOverlap(
      { "ghcr.io/foo/bar:1": {} },
      { "ghcr.io/foo/bar:2": {} },
    );
    expect(result).toEqual(["ghcr.io/foo/bar"]);
  });

  it("reports all overlaps", () => {
    const result = validateNoOverlap(
      {
        "ghcr.io/foo/bar:1": {},
        "ghcr.io/a/b:1": {},
      },
      {
        "ghcr.io/foo/bar:2": {},
        "ghcr.io/a/b:3": {},
      },
    );
    expect(result).toHaveLength(2);
    expect(result).toContain("ghcr.io/foo/bar");
    expect(result).toContain("ghcr.io/a/b");
  });

  it("passes with empty prebuildFeatures", () => {
    expect(
      validateNoOverlap({}, { "ghcr.io/foo/bar:1": {} }),
    ).toEqual([]);
  });

  it("passes with empty features", () => {
    expect(
      validateNoOverlap({ "ghcr.io/foo/bar:1": {} }, {}),
    ).toEqual([]);
  });

  it("passes with both empty", () => {
    expect(validateNoOverlap({}, {})).toEqual([]);
  });
});
