// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rewriteLocalFeatureRefs } from "@/lib/up";

describe("rewriteLocalFeatureRefs", () => {
  let scratch: string;
  let devcontainerDir: string;
  let laceDir: string;
  let featureSourceDir: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "lace-rewrite-test-"));
    devcontainerDir = join(scratch, ".devcontainer");
    laceDir = join(scratch, ".lace");
    featureSourceDir = join(devcontainerDir, "features", "portless");
    mkdirSync(featureSourceDir, { recursive: true });
    mkdirSync(laceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("rewrites ./features/portless to ../.devcontainer/features/portless", () => {
    const input = {
      "./features/portless": {},
    };
    const result = rewriteLocalFeatureRefs(input, devcontainerDir, laceDir);
    expect(result).not.toBe(input); // a rewrite happened
    const keys = Object.keys(result);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("./../.devcontainer/features/portless");
  });

  it("returns the same object reference when no rewrites are needed (registry refs)", () => {
    const input = {
      "ghcr.io/weftwiseink/devcontainer-features/portless:1": {},
    };
    const result = rewriteLocalFeatureRefs(input, devcontainerDir, laceDir);
    expect(result).toBe(input);
  });

  it("passes through absolute-path feature refs (used by integration tests)", () => {
    const input = {
      "/abs/path/to/feature": {},
    };
    const result = rewriteLocalFeatureRefs(input, devcontainerDir, laceDir);
    expect(result).toBe(input);
  });

  it("leaves nonexistent local refs alone (so the CLI surfaces its own error)", () => {
    const input = {
      "./features/nonexistent": {},
    };
    const result = rewriteLocalFeatureRefs(input, devcontainerDir, laceDir);
    expect(Object.keys(result)).toEqual(["./features/nonexistent"]);
  });

  it("handles a mix of registry and local refs", () => {
    const input = {
      "ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1": { foo: "bar" },
      "./features/portless": { baz: 42 },
    };
    const result = rewriteLocalFeatureRefs(input, devcontainerDir, laceDir);
    expect(result).not.toBe(input);
    expect(
      result["ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1"],
    ).toEqual({ foo: "bar" });
    expect(result["./../.devcontainer/features/portless"]).toEqual({
      baz: 42,
    });
  });

  it("rewrites ../foo too (parent-relative)", () => {
    const input = {
      "../shared-features/x": {},
    };
    // create the source
    mkdirSync(join(scratch, "shared-features", "x"), { recursive: true });
    const result = rewriteLocalFeatureRefs(input, devcontainerDir, laceDir);
    expect(result).not.toBe(input);
    const key = Object.keys(result)[0];
    expect(key.startsWith("./")).toBe(true);
    // The rewritten ref must resolve back to scratch/shared-features/x
    expect(key).toContain("shared-features/x");
  });
});
