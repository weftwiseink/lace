// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDockerfile,
  generateTag,
  parseTag,
  rewriteFrom,
  restoreFrom,
  generatePrebuildDockerfile,
  DockerfileParseError,
} from "@/lib/dockerfile";

const FIXTURES = join(import.meta.dirname, "../../__fixtures__/dockerfiles");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

// --- FROM instruction extraction ---

describe("parseDockerfile: FROM extraction", () => {
  it("extracts untagged FROM (implicit latest)", () => {
    const result = parseDockerfile(readFixture("simple.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBeNull();
    expect(result.digest).toBeNull();
    expect(result.alias).toBeNull();
    expect(result.image).toBe("node");
  });

  it("extracts tagged FROM", () => {
    const result = parseDockerfile(readFixture("tagged.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24-bookworm");
    expect(result.digest).toBeNull();
    expect(result.alias).toBeNull();
    expect(result.image).toBe("node:24-bookworm");
  });

  it("extracts FROM with alias (AS)", () => {
    const result = parseDockerfile(readFixture("alias.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24");
    expect(result.alias).toBe("builder");
    expect(result.image).toBe("node:24");
  });

  it("extracts FROM with digest", () => {
    const result = parseDockerfile(readFixture("digest.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBeNull();
    expect(result.digest).toBe("sha256:abc123def456");
    expect(result.image).toBe("node@sha256:abc123def456");
  });

  it("extracts FROM with --platform flag", () => {
    const result = parseDockerfile(readFixture("platform.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24");
    expect(result.platform).toBe("linux/amd64");
  });

  it("extracts FROM with registry and port", () => {
    const result = parseDockerfile(readFixture("registry-port.Dockerfile"));
    expect(result.imageName).toBe("registry:5000/node");
    expect(result.tag).toBe("24");
  });

  it("extracts only the first FROM in multi-stage builds", () => {
    const result = parseDockerfile(readFixture("multi-stage.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24");
    expect(result.alias).toBe("build");
  });

  it("extracts FROM with commented-out FROM before it", () => {
    const result = parseDockerfile(readFixture("commented-from.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24");
  });

  it("extracts FROM with parser directive", () => {
    const result = parseDockerfile(readFixture("parser-directive.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24");
  });
});

// --- ARG prelude extraction ---

describe("parseDockerfile: ARG prelude", () => {
  it("extracts single ARG before FROM", () => {
    const result = parseDockerfile(readFixture("arg-prelude.Dockerfile"));
    expect(result.argPrelude).toHaveLength(1);
    expect(result.argPrelude[0]).toBe("ARG VERSION=24");
  });

  it("extracts multiple ARGs before FROM in order", () => {
    const result = parseDockerfile(
      readFixture("arg-substitution.Dockerfile"),
    );
    expect(result.argPrelude).toHaveLength(2);
    expect(result.argPrelude[0]).toBe("ARG BASE=node");
    expect(result.argPrelude[1]).toBe("ARG TAG=24-bookworm");
  });

  it("preserves ARG substitution in FROM without resolving", () => {
    const result = parseDockerfile(readFixture("arg-prelude.Dockerfile"));
    // The FROM references ${VERSION} — we don't resolve it (Docker's job)
    expect(result.fromLineText).toContain("${VERSION}");
  });

  it("returns empty prelude for Dockerfiles without ARGs before FROM", () => {
    const result = parseDockerfile(readFixture("simple.Dockerfile"));
    expect(result.argPrelude).toHaveLength(0);
  });

  it("errors on non-ARG instruction before FROM", () => {
    expect(() =>
      parseDockerfile(readFixture("run-before-from.Dockerfile")),
    ).toThrow(DockerfileParseError);
    expect(() =>
      parseDockerfile(readFixture("run-before-from.Dockerfile")),
    ).toThrow(/unsupported instruction "RUN" before FROM/i);
  });
});

// --- Heredoc handling ---

describe("parseDockerfile: heredoc", () => {
  it("parses Dockerfile with heredoc syntax correctly", () => {
    const result = parseDockerfile(readFixture("heredoc.Dockerfile"));
    expect(result.imageName).toBe("node");
    expect(result.tag).toBe("24");
  });
});

// --- Error cases ---

describe("parseDockerfile: errors", () => {
  it("errors on empty file", () => {
    expect(() => parseDockerfile("")).toThrow(DockerfileParseError);
    expect(() => parseDockerfile("")).toThrow(/no FROM instruction/i);
  });

  it("errors on file with no FROM", () => {
    expect(() =>
      parseDockerfile(readFixture("no-from.Dockerfile")),
    ).toThrow(/no FROM instruction/i);
  });
});

// --- Tag generation ---

describe("generateTag", () => {
  it("generates tag for untagged image (implicit latest)", () => {
    expect(generateTag("node", null, null)).toBe("lace.local/node:latest");
  });

  it("generates tag for tagged image", () => {
    expect(generateTag("node", "24-bookworm", null)).toBe(
      "lace.local/node:24-bookworm",
    );
  });

  it("generates tag for simple tagged image", () => {
    expect(generateTag("node", "24", null)).toBe("lace.local/node:24");
  });

  it("generates tag for ubuntu with version tag", () => {
    expect(generateTag("ubuntu", "22.04", null)).toBe(
      "lace.local/ubuntu:22.04",
    );
  });

  it("generates tag for digest-based reference", () => {
    expect(generateTag("node", null, "sha256:abc123def456")).toBe(
      "lace.local/node:from_sha256__abc123def456",
    );
  });

  it("generates tag for registry image with tag", () => {
    expect(generateTag("ghcr.io/owner/image", "v2", null)).toBe(
      "lace.local/ghcr.io/owner/image:v2",
    );
  });

  it("generates tag for registry image with digest", () => {
    expect(generateTag("ghcr.io/owner/image", null, "sha256:abc")).toBe(
      "lace.local/ghcr.io/owner/image:from_sha256__abc",
    );
  });

  it("generates tag for registry:port image", () => {
    expect(generateTag("registry:5000/myimage", "latest", null)).toBe(
      "lace.local/registry:5000/myimage:latest",
    );
  });

  it("truncates digest tags exceeding 128 chars", () => {
    const longHash = "a".repeat(200);
    const tag = generateTag("node", null, `sha256:${longHash}`);
    expect(tag.length).toBeLessThanOrEqual(128);
    expect(tag).toMatch(/^lace\.local\/node:from_sha256__a+$/);
  });
});

// --- parseTag (inverse of generateTag) ---

describe("parseTag", () => {
  it("returns null for non-lace tags", () => {
    expect(parseTag("node:24-bookworm")).toBeNull();
    expect(parseTag("ghcr.io/owner/image:v2")).toBeNull();
  });

  it("reverses tagged image", () => {
    expect(parseTag("lace.local/node:24-bookworm")).toBe("node:24-bookworm");
  });

  it("reverses untagged image (latest)", () => {
    expect(parseTag("lace.local/node:latest")).toBe("node:latest");
  });

  it("reverses digest-based reference", () => {
    expect(parseTag("lace.local/node:from_sha256__abc123def456")).toBe(
      "node@sha256:abc123def456",
    );
  });

  it("reverses registry image with tag", () => {
    expect(parseTag("lace.local/ghcr.io/owner/image:v2")).toBe(
      "ghcr.io/owner/image:v2",
    );
  });

  it("reverses registry image with digest", () => {
    expect(parseTag("lace.local/ghcr.io/owner/image:from_sha256__abc")).toBe(
      "ghcr.io/owner/image@sha256:abc",
    );
  });

  it("reverses registry:port image", () => {
    expect(parseTag("lace.local/registry:5000/myimage:latest")).toBe(
      "registry:5000/myimage:latest",
    );
  });

  it("handles truncated digest tags", () => {
    const truncatedHash = "a".repeat(50);
    const result = parseTag(`lace.local/node:from_sha256__${truncatedHash}`);
    expect(result).toBe(`node@sha256:${truncatedHash}`);
  });
});

// --- generateTag → parseTag round-trip ---

describe("generateTag → parseTag round-trip", () => {
  it("round-trips tagged image", () => {
    const tag = generateTag("node", "24-bookworm", null);
    expect(parseTag(tag)).toBe("node:24-bookworm");
  });

  it("round-trips digest-based image", () => {
    const tag = generateTag("node", null, "sha256:abc123def456");
    expect(parseTag(tag)).toBe("node@sha256:abc123def456");
  });

  it("round-trips untagged image to latest (acceptable ambiguity)", () => {
    const tag = generateTag("node", null, null);
    expect(parseTag(tag)).toBe("node:latest");
  });

  it("round-trips registry image with tag", () => {
    const tag = generateTag("ghcr.io/owner/image", "v2", null);
    expect(parseTag(tag)).toBe("ghcr.io/owner/image:v2");
  });

  it("round-trips registry:port image", () => {
    const tag = generateTag("registry:5000/myimage", "latest", null);
    expect(parseTag(tag)).toBe("registry:5000/myimage:latest");
  });

  it("round-trips ubuntu with version tag", () => {
    const tag = generateTag("ubuntu", "22.04", null);
    expect(parseTag(tag)).toBe("ubuntu:22.04");
  });
});

// --- Dockerfile rewriting ---

describe("rewriteFrom", () => {
  it("rewrites simple FROM", () => {
    const content = readFixture("simple.Dockerfile");
    const result = rewriteFrom(content, "lace.local/node:latest");
    expect(result).toContain("FROM lace.local/node:latest");
    expect(result).toContain('RUN echo "hello"');
  });

  it("rewrites tagged FROM", () => {
    const content = readFixture("tagged.Dockerfile");
    const result = rewriteFrom(content, "lace.local/node:24-bookworm");
    expect(result).toContain("FROM lace.local/node:24-bookworm");
    expect(result).toContain("RUN apt-get update");
  });

  it("preserves alias on rewrite", () => {
    const content = readFixture("alias.Dockerfile");
    const result = rewriteFrom(content, "lace.local/node:24");
    expect(result).toContain("FROM lace.local/node:24 AS builder");
  });

  it("preserves --platform flag on rewrite", () => {
    const content = readFixture("platform.Dockerfile");
    const result = rewriteFrom(content, "lace.local/node:24");
    expect(result).toContain(
      "FROM --platform=linux/amd64 lace.local/node:24",
    );
  });

  it("only rewrites first FROM in multi-stage", () => {
    const content = readFixture("multi-stage.Dockerfile");
    const result = rewriteFrom(content, "lace.local/node:24");
    const fromLines = result
      .split("\n")
      .filter((l) => l.startsWith("FROM "));
    expect(fromLines[0]).toBe("FROM lace.local/node:24 AS build");
    expect(fromLines[1]).toBe("FROM debian:bookworm");
  });

  it("preserves all non-FROM content byte-identical", () => {
    const content = readFixture("tagged.Dockerfile");
    const result = rewriteFrom(content, "lace.local/node:24-bookworm");
    const origLines = content.split("\n");
    const resultLines = result.split("\n");
    // Every line except the FROM line should be identical
    for (let i = 0; i < origLines.length; i++) {
      if (!origLines[i].startsWith("FROM")) {
        expect(resultLines[i]).toBe(origLines[i]);
      }
    }
  });
});

// --- Round-trip (rewrite then restore) ---

describe("round-trip: rewrite then restore", () => {
  const validFixtures = [
    "simple.Dockerfile",
    "tagged.Dockerfile",
    "alias.Dockerfile",
    "platform.Dockerfile",
    "commented-from.Dockerfile",
    "parser-directive.Dockerfile",
    "registry-port.Dockerfile",
    "arg-prelude.Dockerfile",
    "arg-substitution.Dockerfile",
  ];

  for (const fixture of validFixtures) {
    it(`round-trips ${fixture}`, () => {
      const original = readFixture(fixture);
      const parsed = parseDockerfile(original);
      const tag = generateTag(parsed.imageName, parsed.tag, parsed.digest);
      const rewritten = rewriteFrom(original, tag);
      const restored = restoreFrom(rewritten, parsed.image);
      expect(restored).toBe(original);
    });
  }

  it("round-trips digest-based FROM", () => {
    const original = readFixture("digest.Dockerfile");
    const parsed = parseDockerfile(original);
    const tag = generateTag(parsed.imageName, parsed.tag, parsed.digest);
    const rewritten = rewriteFrom(original, tag);
    const restored = restoreFrom(rewritten, parsed.image);
    expect(restored).toBe(original);
  });

  it("round-trips multi-stage Dockerfile (only first FROM)", () => {
    const original = readFixture("multi-stage.Dockerfile");
    const parsed = parseDockerfile(original);
    const tag = generateTag(parsed.imageName, parsed.tag, parsed.digest);
    const rewritten = rewriteFrom(original, tag);
    const restored = restoreFrom(rewritten, parsed.image);
    expect(restored).toBe(original);
  });
});

// --- Prebuild Dockerfile generation ---

describe("generatePrebuildDockerfile", () => {
  it("generates minimal Dockerfile with only FROM", () => {
    const parsed = parseDockerfile(readFixture("simple.Dockerfile"));
    const result = generatePrebuildDockerfile(parsed);
    expect(result).toBe("FROM node\n");
  });

  it("includes ARG prelude before FROM", () => {
    const parsed = parseDockerfile(readFixture("arg-prelude.Dockerfile"));
    const result = generatePrebuildDockerfile(parsed);
    expect(result).toBe("ARG VERSION=24\nFROM node:${VERSION}-bookworm\n");
  });

  it("includes multiple ARGs in order", () => {
    const parsed = parseDockerfile(
      readFixture("arg-substitution.Dockerfile"),
    );
    const result = generatePrebuildDockerfile(parsed);
    const lines = result.trimEnd().split("\n");
    expect(lines).toEqual([
      "ARG BASE=node",
      "ARG TAG=24-bookworm",
      "FROM ${BASE}:${TAG}",
    ]);
  });

  it("excludes all instructions after FROM", () => {
    const parsed = parseDockerfile(readFixture("tagged.Dockerfile"));
    const result = generatePrebuildDockerfile(parsed);
    expect(result).not.toContain("RUN");
    expect(result).toBe("FROM node:24-bookworm\n");
  });
});
