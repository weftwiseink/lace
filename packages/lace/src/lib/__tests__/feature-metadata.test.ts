// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunSubprocess, SubprocessResult } from "../subprocess";
import {
  fetchFeatureMetadata,
  fetchAllFeatureMetadata,
  clearMetadataCache,
  validateFeatureOptions,
  validatePortDeclarations,
  extractLaceCustomizations,
  isLocalPath,
  featureIdToCacheKey,
  getTtlMs,
  MetadataFetchError,
  type FeatureMetadata,
  type MetadataFetchKind,
} from "../feature-metadata";

// Helper: create a mock subprocess that returns the given result
function mockSubprocess(result: SubprocessResult): RunSubprocess {
  return vi.fn(() => result);
}

// Helper: create a mock subprocess that returns valid OCI manifest JSON
function mockOciSuccess(metadata: FeatureMetadata): RunSubprocess {
  return mockSubprocess({
    exitCode: 0,
    stdout: JSON.stringify({
      annotations: {
        "dev.containers.metadata": JSON.stringify(metadata),
      },
    }),
    stderr: "",
  });
}

// ── Helper: build a minimal tar buffer for blob fallback tests ──

function tarEntry(
  name: string,
  content: string,
  typeflag: number = 0x30,
): Buffer {
  const contentBuf = Buffer.from(content, "utf-8");
  const header = Buffer.alloc(512);
  header.write(name, 0, Math.min(name.length, 100), "ascii");
  const sizeOctal = contentBuf.length.toString(8).padStart(11, "0");
  header.write(sizeOctal, 124, 12, "ascii");
  header[156] = typeflag;
  const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
  const data = Buffer.alloc(paddedSize);
  contentBuf.copy(data);
  return Buffer.concat([header, data]);
}

function buildTar(...entries: Buffer[]): Buffer {
  const endOfArchive = Buffer.alloc(1024);
  return Buffer.concat([...entries, endOfArchive]);
}

/** Create a mock subprocess that returns a manifest WITHOUT the dev.containers.metadata annotation
 *  but WITH layers (so blob fallback can attempt to work). */
function mockOciNoAnnotation(layerDigest: string = "sha256:abc123"): RunSubprocess {
  return mockSubprocess({
    exitCode: 0,
    stdout: JSON.stringify({
      manifest: {
        schemaVersion: 2,
        layers: [
          {
            digest: layerDigest,
            mediaType: "application/vnd.devcontainers.layer.v1+tar",
            size: 10240,
          },
        ],
        annotations: { "com.github.package.type": "devcontainer_feature" },
      },
    }),
    stderr: "",
  });
}

/** Mock global fetch for blob fallback: handles token + blob download.
 *  Returns the provided tarBuffer for blob requests. */
function mockFetchForBlob(tarBuffer: Buffer): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "test-token" }),
        });
      }
      if (url.includes("/blobs/")) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              tarBuffer.buffer.slice(
                tarBuffer.byteOffset,
                tarBuffer.byteOffset + tarBuffer.byteLength,
              ),
            ),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }),
  );
}

// Standard test metadata
const weztermMetadata: FeatureMetadata = {
  id: "wezterm-server",
  version: "1.0.0",
  options: {
    hostSshPort: { type: "string", default: "2222" },
  },
  customizations: {
    lace: {
      ports: {
        hostSshPort: { label: "wezterm ssh", onAutoForward: "silent" },
      },
    },
  },
};

describe("isLocalPath", () => {
  // Scenario 9: Local-path detection
  it("returns true for relative paths starting with ./", () => {
    expect(isLocalPath("./features/foo")).toBe(true);
  });

  it("returns true for relative paths starting with ../", () => {
    expect(isLocalPath("../features/foo")).toBe(true);
  });

  it("returns true for absolute paths", () => {
    expect(isLocalPath("/absolute/path")).toBe(true);
  });

  it("returns false for registry paths", () => {
    expect(isLocalPath("ghcr.io/org/feature:1")).toBe(false);
    expect(isLocalPath("docker.io/library/feature:latest")).toBe(false);
  });
});

describe("fetchFeatureMetadata -- OCI fetch", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `lace-test-cache-oci-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    clearMetadataCache(cacheDir);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // Scenario 1: Successful metadata parsing from CLI output
  it("parses metadata from CLI output successfully", async () => {
    const subprocess = mockOciSuccess(weztermMetadata);

    const result = await fetchFeatureMetadata(
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
      { subprocess, cacheDir },
    );

    expect(result).toEqual(weztermMetadata);
    expect(subprocess).toHaveBeenCalledWith("devcontainer", [
      "features",
      "info",
      "manifest",
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
      "--output-format",
      "json",
    ]);
  });

  // Scenario 2: CLI exits non-zero (registry auth failure)
  it("throws MetadataFetchError when CLI exits non-zero", async () => {
    const subprocess = mockSubprocess({
      exitCode: 1,
      stdout: "",
      stderr: "unauthorized: authentication required",
    });

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(MetadataFetchError);

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(/Failed to fetch metadata for feature/);

    // Clear cache so the second call actually runs
    clearMetadataCache(cacheDir);

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(/unauthorized: authentication required/);
  });

  // Scenario 3: CLI exits non-zero with --skip-metadata-validation
  it("returns null and warns when skipValidation is true and CLI fails", async () => {
    const subprocess = mockSubprocess({
      exitCode: 1,
      stdout: "",
      stderr: "unauthorized: authentication required",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      skipValidation: true,
      cacheDir,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("--skip-metadata-validation"),
    );

    warnSpy.mockRestore();
  });

  // Scenario 4: CLI returns invalid JSON
  it("throws MetadataFetchError when CLI returns invalid JSON", async () => {
    const subprocess = mockSubprocess({
      exitCode: 0,
      stdout: "not json",
      stderr: "",
    });

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(/CLI returned invalid JSON/);
  });

  // Scenario 4b: CLI returns manifest wrapped under "manifest" key (real CLI format)
  it("parses metadata from nested manifest key (real devcontainer CLI format)", async () => {
    const subprocess = mockSubprocess({
      exitCode: 0,
      stdout: JSON.stringify({
        manifest: {
          schemaVersion: 2,
          annotations: {
            "dev.containers.metadata": JSON.stringify(weztermMetadata),
          },
        },
        canonicalId: "ghcr.io/org/feat@sha256:abc123",
      }),
      stderr: "",
    });

    const result = await fetchFeatureMetadata(
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1.0.0",
      { subprocess, cacheDir },
    );

    expect(result).toEqual(weztermMetadata);
  });

  // Scenario 5a: Missing annotation -- blob fallback succeeds
  it("returns metadata via blob fallback when annotation is missing", async () => {
    const nushellMetadata: FeatureMetadata = {
      id: "nushell",
      version: "0.1.1",
      options: {},
    };
    const featureTar = buildTar(
      tarEntry(
        "devcontainer-feature.json",
        JSON.stringify(nushellMetadata),
      ),
    );
    const subprocess = mockOciNoAnnotation();
    mockFetchForBlob(featureTar);

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    expect(result).toEqual(nushellMetadata);
    vi.unstubAllGlobals();
  });

  // Scenario 5b: Missing annotation -- blob fallback fails
  it("throws MetadataFetchError with blob_fallback_failed when annotation is missing and blob fails", async () => {
    const subprocess = mockSubprocess({
      exitCode: 0,
      stdout: JSON.stringify({ schemaVersion: 2 }),
      stderr: "",
    });

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(/blob fallback failed/);

    try {
      await fetchFeatureMetadata("ghcr.io/org/feat:1", {
        subprocess,
        cacheDir,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(MetadataFetchError);
      expect((e as MetadataFetchError).kind).toBe("blob_fallback_failed");
    }
  });

  // Scenario 6: Malformed metadata annotation JSON
  it("throws MetadataFetchError when annotation is invalid JSON", async () => {
    const subprocess = mockSubprocess({
      exitCode: 0,
      stdout: JSON.stringify({
        annotations: {
          "dev.containers.metadata": "{invalid json",
        },
      }),
      stderr: "",
    });

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe("fetchFeatureMetadata -- local-path fetch", () => {
  let tempDir: string;

  beforeEach(() => {
    clearMetadataCache();
    tempDir = join(
      tmpdir(),
      `lace-test-feature-meta-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Scenario 7: Successful local-path read
  it("reads metadata from local path", async () => {
    const localMetadata: FeatureMetadata = {
      id: "local-feature",
      version: "0.1.0",
      options: {
        port: { type: "string", default: "3000" },
      },
    };

    writeFileSync(
      join(tempDir, "devcontainer-feature.json"),
      JSON.stringify(localMetadata),
      "utf-8",
    );

    const result = await fetchFeatureMetadata(tempDir);

    expect(result).toEqual(localMetadata);
  });

  // Scenario 8: Local-path -- file not found
  it("throws MetadataFetchError when local file not found", async () => {
    const nonexistent = join(tempDir, "nonexistent-feature");

    await expect(fetchFeatureMetadata(nonexistent)).rejects.toThrow(
      MetadataFetchError,
    );

    await expect(fetchFeatureMetadata(nonexistent)).rejects.toThrow(
      /devcontainer-feature.json not found/,
    );
  });

  // Scenario: local path with invalid JSON
  it("throws MetadataFetchError when local file contains invalid JSON", async () => {
    const badDir = join(tempDir, "bad-json");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "devcontainer-feature.json"),
      "{not valid",
      "utf-8",
    );

    await expect(fetchFeatureMetadata(badDir)).rejects.toThrow(
      /contains invalid JSON/,
    );
  });
});

describe("extractLaceCustomizations", () => {
  // Scenario 10: Extract ports from well-formed metadata
  it("extracts ports from well-formed metadata", () => {
    const result = extractLaceCustomizations(weztermMetadata);

    expect(result).toEqual({
      ports: {
        hostSshPort: {
          label: "wezterm ssh",
          onAutoForward: "silent",
          requireLocalPort: undefined,
          protocol: undefined,
        },
      },
    });
  });

  // Scenario 11: No customizations key
  it("returns null when no customizations key", () => {
    const metadata: FeatureMetadata = { id: "foo", version: "1.0.0" };
    expect(extractLaceCustomizations(metadata)).toBeNull();
  });

  // Scenario 12: No customizations.lace key
  it("returns null when no customizations.lace key", () => {
    const metadata: FeatureMetadata = {
      id: "foo",
      version: "1.0.0",
      customizations: { vscode: {} },
    };
    expect(extractLaceCustomizations(metadata)).toBeNull();
  });

  // Scenario 12a: customizations.lace exists but no ports key
  it("returns { ports: undefined } when lace exists but no ports", () => {
    const metadata: FeatureMetadata = {
      id: "foo",
      version: "1.0.0",
      customizations: { lace: { someOtherField: true } },
    };
    const result = extractLaceCustomizations(metadata);
    expect(result).not.toBeNull();
    expect(result).toEqual({ ports: undefined });
  });

  // Scenario 13: Invalid onAutoForward value filtered out
  it("filters out invalid onAutoForward value", () => {
    const metadata: FeatureMetadata = {
      id: "foo",
      version: "1.0.0",
      options: { port: { type: "string" } },
      customizations: {
        lace: {
          ports: {
            port: {
              label: "test",
              onAutoForward: "bogus",
            },
          },
        },
      },
    };

    const result = extractLaceCustomizations(metadata);
    expect(result?.ports?.port?.onAutoForward).toBeUndefined();
    expect(result?.ports?.port?.label).toBe("test");
  });

  // Additional: validate all valid onAutoForward values
  it("accepts all valid onAutoForward values", () => {
    for (const value of [
      "silent",
      "notify",
      "openBrowser",
      "openPreview",
      "ignore",
    ]) {
      const metadata: FeatureMetadata = {
        id: "foo",
        version: "1.0.0",
        customizations: {
          lace: { ports: { p: { onAutoForward: value } } },
        },
      };
      const result = extractLaceCustomizations(metadata);
      expect(result?.ports?.p?.onAutoForward).toBe(value);
    }
  });

  // Additional: validate protocol values
  it("accepts valid protocol values and rejects invalid", () => {
    const makeMetadata = (protocol: unknown): FeatureMetadata => ({
      id: "foo",
      version: "1.0.0",
      customizations: {
        lace: { ports: { p: { protocol } } },
      },
    });

    expect(
      extractLaceCustomizations(makeMetadata("http"))?.ports?.p?.protocol,
    ).toBe("http");
    expect(
      extractLaceCustomizations(makeMetadata("https"))?.ports?.p?.protocol,
    ).toBe("https");
    expect(
      extractLaceCustomizations(makeMetadata("ftp"))?.ports?.p?.protocol,
    ).toBeUndefined();
  });

  // Scenario: Feature with mounts declaration returns parsed mounts
  it("extracts mounts from well-formed metadata", () => {
    const metadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      customizations: {
        lace: {
          mounts: {
            config: {
              target: "/home/user/.config/wezterm",
              description: "WezTerm config directory",
              readonly: true,
            },
          },
        },
      },
    };

    const result = extractLaceCustomizations(metadata);

    expect(result).not.toBeNull();
    expect(result?.mounts).toBeDefined();
    expect(result?.mounts?.config).toEqual({
      target: "/home/user/.config/wezterm",
      description: "WezTerm config directory",
      readonly: true,
    });
  });

  // Scenario: Mount declaration missing target is skipped
  it("skips mount declarations missing required target field", () => {
    const metadata: FeatureMetadata = {
      id: "foo",
      version: "1.0.0",
      customizations: {
        lace: {
          mounts: {
            noTarget: { description: "missing target" },
            hasTarget: { target: "/data" },
          },
        },
      },
    };

    const result = extractLaceCustomizations(metadata);

    expect(result?.mounts).toBeDefined();
    expect(result?.mounts?.noTarget).toBeUndefined();
    expect(result?.mounts?.hasTarget).toEqual({
      target: "/data",
      description: undefined,
      readonly: undefined,
    });
  });

  // Scenario: Mount declaration with all fields parses correctly
  it("parses all fields of a mount declaration", () => {
    const metadata: FeatureMetadata = {
      id: "data-feature",
      version: "1.0.0",
      customizations: {
        lace: {
          mounts: {
            data: {
              target: "/mnt/data",
              description: "Persistent data store",
              readonly: false,
            },
          },
        },
      },
    };

    const result = extractLaceCustomizations(metadata);

    expect(result?.mounts?.data).toEqual({
      target: "/mnt/data",
      description: "Persistent data store",
      readonly: false,
    });
  });

  // Scenario: Feature with both ports and mounts returns both
  it("returns both ports and mounts when both are declared", () => {
    const metadata: FeatureMetadata = {
      id: "full-feature",
      version: "1.0.0",
      customizations: {
        lace: {
          ports: {
            httpPort: { label: "HTTP" },
          },
          mounts: {
            data: { target: "/data" },
          },
        },
      },
    };

    const result = extractLaceCustomizations(metadata);

    expect(result?.ports).toBeDefined();
    expect(result?.ports?.httpPort?.label).toBe("HTTP");
    expect(result?.mounts).toBeDefined();
    expect(result?.mounts?.data?.target).toBe("/data");
  });

  // Scenario: Non-boolean readonly is filtered out
  it("filters out non-boolean readonly values in mount declarations", () => {
    const metadata: FeatureMetadata = {
      id: "foo",
      version: "1.0.0",
      customizations: {
        lace: {
          mounts: {
            data: { target: "/data", readonly: "yes" as unknown as boolean },
          },
        },
      },
    };

    const result = extractLaceCustomizations(metadata);

    expect(result?.mounts?.data?.readonly).toBeUndefined();
  });

  // Additional: requireLocalPort boolean
  it("accepts boolean requireLocalPort and rejects non-boolean", () => {
    const makeMetadata = (requireLocalPort: unknown): FeatureMetadata => ({
      id: "foo",
      version: "1.0.0",
      customizations: {
        lace: { ports: { p: { requireLocalPort } } },
      },
    });

    expect(
      extractLaceCustomizations(makeMetadata(true))?.ports?.p
        ?.requireLocalPort,
    ).toBe(true);
    expect(
      extractLaceCustomizations(makeMetadata(false))?.ports?.p
        ?.requireLocalPort,
    ).toBe(false);
    expect(
      extractLaceCustomizations(makeMetadata("yes"))?.ports?.p
        ?.requireLocalPort,
    ).toBeUndefined();
  });
});

describe("validateFeatureOptions", () => {
  // Scenario 14: All options valid
  it("returns valid when all options exist in schema", () => {
    const metadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      options: { hostSshPort: { type: "string" } },
    };

    const result = validateFeatureOptions(
      "wezterm-server",
      { hostSshPort: "22430" },
      metadata,
    );

    expect(result).toEqual({ valid: true, errors: [] });
  });

  // Scenario 15: Unknown option detected
  it("detects unknown option names", () => {
    const metadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      options: { hostSshPort: { type: "string" } },
    };

    const result = validateFeatureOptions(
      "wezterm-server",
      { hostSshPort: "22430", bogusOpt: "true" },
      metadata,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("unknown_option");
    expect(result.errors[0].optionName).toBe("bogusOpt");
    expect(result.errors[0].featureId).toBe("wezterm-server");
    expect(result.errors[0].message).toContain("bogusOpt");
    expect(result.errors[0].message).toContain("hostSshPort");
  });

  // Scenario 16: Empty provided options
  it("returns valid for empty provided options", () => {
    const metadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      options: { hostSshPort: { type: "string" } },
    };

    const result = validateFeatureOptions("wezterm-server", {}, metadata);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  // Scenario 17: Feature has no options schema
  it("reports unknown options when feature has no schema", () => {
    const metadata: FeatureMetadata = {
      id: "simple-feature",
      version: "1.0.0",
    };

    const result = validateFeatureOptions(
      "simple-feature",
      { anything: "value" },
      metadata,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("unknown_option");
    expect(result.errors[0].optionName).toBe("anything");
    expect(result.errors[0].message).toContain("(none)");
  });
});

describe("validatePortDeclarations", () => {
  // Scenario 18: Port key matches option name
  it("returns valid when port key matches option name", () => {
    const metadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      options: { hostSshPort: { type: "string" } },
      customizations: {
        lace: { ports: { hostSshPort: { label: "wezterm ssh" } } },
      },
    };

    const result = validatePortDeclarations(metadata);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  // Scenario 19: Port key does NOT match any option (v2 violation)
  it("detects port key that does not match any option", () => {
    const metadata: FeatureMetadata = {
      id: "wezterm-server",
      version: "1.0.0",
      options: { hostSshPort: { type: "string" } },
      customizations: {
        lace: { ports: { ssh: { label: "wezterm ssh" } } },
      },
    };

    const result = validatePortDeclarations(metadata);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("port_key_mismatch");
    expect(result.errors[0].optionName).toBe("ssh");
    expect(result.errors[0].featureId).toBe("wezterm-server");
    expect(result.errors[0].message).toContain("ssh");
    expect(result.errors[0].message).toContain(
      "does not match any option",
    );
    expect(result.errors[0].message).toContain("hostSshPort");
  });

  // Scenario 20: No port declarations
  it("returns valid when no port declarations", () => {
    const metadata: FeatureMetadata = {
      id: "foo",
      version: "1.0.0",
      options: { port: { type: "string" } },
    };

    const result = validatePortDeclarations(metadata);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  // Scenario 21: Multiple port keys, one mismatched
  it("detects one mismatched key among multiple", () => {
    const metadata: FeatureMetadata = {
      id: "multi-port-feature",
      version: "1.0.0",
      options: {
        httpPort: { type: "string" },
        debugPort: { type: "string" },
      },
      customizations: {
        lace: {
          ports: {
            httpPort: { label: "HTTP" },
            debug: { label: "Debug" }, // WRONG: should be "debugPort"
          },
        },
      },
    };

    const result = validatePortDeclarations(metadata);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].optionName).toBe("debug");
    expect(result.errors[0].kind).toBe("port_key_mismatch");
  });
});

describe("in-memory cache", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `lace-test-cache-mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    clearMetadataCache(cacheDir);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // Scenario 22: Deduplication within a run
  it("deduplicates subprocess calls within a run", async () => {
    const subprocess = mockOciSuccess(weztermMetadata);

    const result1 = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });
    const result2 = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    expect(result1).toEqual(weztermMetadata);
    expect(result2).toEqual(weztermMetadata);
    expect(subprocess).toHaveBeenCalledTimes(1);
  });

  // Scenario 23: clearMetadataCache resets in-memory cache
  it("resets cache on clearMetadataCache", async () => {
    const subprocess = mockOciSuccess(weztermMetadata);

    await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });
    clearMetadataCache(cacheDir);
    await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    expect(subprocess).toHaveBeenCalledTimes(2);
  });

  // Scenario 24: fetchAllFeatureMetadata deduplicates input
  it("deduplicates feature IDs in fetchAllFeatureMetadata", async () => {
    const otherMetadata: FeatureMetadata = {
      id: "other",
      version: "2.0.0",
    };

    const subprocess: RunSubprocess = vi.fn((_cmd, args) => {
      const featureId = args[3]; // 4th arg is the feature ID
      const metadata =
        featureId === "ghcr.io/org/other:2" ? otherMetadata : weztermMetadata;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          annotations: {
            "dev.containers.metadata": JSON.stringify(metadata),
          },
        }),
        stderr: "",
      };
    });

    const result = await fetchAllFeatureMetadata(
      ["ghcr.io/org/feat:1", "ghcr.io/org/feat:1", "ghcr.io/org/other:2"],
      { subprocess, cacheDir },
    );

    expect(result.size).toBe(2);
    expect(result.get("ghcr.io/org/feat:1")).toEqual(weztermMetadata);
    expect(result.get("ghcr.io/org/other:2")).toEqual(otherMetadata);
    expect(subprocess).toHaveBeenCalledTimes(2);
  });
});

describe("MetadataFetchError kind discrimination", () => {
  it("fetch_failed includes 'build environment' in message", () => {
    const err = new MetadataFetchError("feat:1", "CLI exited 1", "fetch_failed");
    expect(err.message).toContain("build environment");
    expect(err.kind).toBe("fetch_failed");
  });

  it("invalid_response includes 'unexpected output' in message", () => {
    const err = new MetadataFetchError("feat:1", "bad json", "invalid_response");
    expect(err.message).toContain("unexpected output");
    expect(err.kind).toBe("invalid_response");
  });

  it("annotation_invalid includes 'malformed' in message", () => {
    const err = new MetadataFetchError("feat:1", "bad annotation", "annotation_invalid");
    expect(err.message).toContain("malformed");
    expect(err.kind).toBe("annotation_invalid");
  });

  it("blob_fallback_failed includes 'tarball fallback' in message", () => {
    const err = new MetadataFetchError("feat:1", "download failed", "blob_fallback_failed");
    expect(err.message).toContain("tarball fallback");
    expect(err.kind).toBe("blob_fallback_failed");
  });

  it("all kinds include --skip-metadata-validation hint", () => {
    const kinds: MetadataFetchKind[] = [
      "fetch_failed",
      "invalid_response",
      "annotation_invalid",
      "blob_fallback_failed",
    ];
    for (const kind of kinds) {
      const err = new MetadataFetchError("feat:1", "reason", kind);
      expect(err.message).toContain("--skip-metadata-validation");
    }
  });
});

describe("fetchFeatureMetadata -- blob fallback integration", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `lace-test-cache-blob-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    clearMetadataCache(cacheDir);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("annotation missing + blob fallback succeeds → returns metadata and caches it", async () => {
    const nushellMetadata: FeatureMetadata = {
      id: "nushell",
      version: "0.1.1",
      options: {},
    };
    const featureTar = buildTar(
      tarEntry("devcontainer-feature.json", JSON.stringify(nushellMetadata)),
    );
    const subprocess = mockOciNoAnnotation();
    mockFetchForBlob(featureTar);

    const result = await fetchFeatureMetadata("ghcr.io/org/nushell:0", {
      subprocess,
      cacheDir,
    });

    expect(result).toEqual(nushellMetadata);

    // Verify it's in memory cache (second call should not invoke subprocess)
    const result2 = await fetchFeatureMetadata("ghcr.io/org/nushell:0", {
      subprocess,
      cacheDir,
    });
    expect(result2).toEqual(nushellMetadata);
    expect(subprocess).toHaveBeenCalledTimes(1); // Only called once (memory cache hit)
  });

  it("annotation missing + blob fallback fails + skipValidation:false → throws blob_fallback_failed", async () => {
    const subprocess = mockOciNoAnnotation();
    // Don't mock fetch -- blob download will fail
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    await expect(
      fetchFeatureMetadata("ghcr.io/org/feat:1", { subprocess, cacheDir }),
    ).rejects.toThrow(MetadataFetchError);

    try {
      clearMetadataCache(cacheDir);
      await fetchFeatureMetadata("ghcr.io/org/feat:1", {
        subprocess,
        cacheDir,
      });
    } catch (e) {
      expect((e as MetadataFetchError).kind).toBe("blob_fallback_failed");
    }
  });

  it("annotation missing + blob fallback fails + skipValidation:true → returns null and warns", async () => {
    const subprocess = mockOciNoAnnotation();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
      skipValidation: true,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("--skip-metadata-validation"),
    );
    warnSpy.mockRestore();
  });

  it("CLI failure → throws fetch_failed (blob fallback not attempted)", async () => {
    const subprocess = mockSubprocess({
      exitCode: 1,
      stdout: "",
      stderr: "auth error",
    });

    try {
      await fetchFeatureMetadata("ghcr.io/org/feat:1", {
        subprocess,
        cacheDir,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(MetadataFetchError);
      expect((e as MetadataFetchError).kind).toBe("fetch_failed");
    }
  });
});

describe("fetchAllFeatureMetadata -- mixed batch with blob fallback", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `lace-test-cache-mixed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    clearMetadataCache(cacheDir);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("Feature A has annotation, Feature B lacks annotation but blob fallback succeeds → both return metadata", async () => {
    const nushellMetadata: FeatureMetadata = {
      id: "nushell",
      version: "0.1.1",
      options: {},
    };
    const featureTar = buildTar(
      tarEntry("devcontainer-feature.json", JSON.stringify(nushellMetadata)),
    );
    mockFetchForBlob(featureTar);

    const subprocess: RunSubprocess = vi.fn((_cmd, args) => {
      const featureId = args[3];
      if (featureId === "ghcr.io/org/wezterm:1") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            annotations: {
              "dev.containers.metadata": JSON.stringify(weztermMetadata),
            },
          }),
          stderr: "",
        };
      }
      // nushell: no annotation, has layers
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          manifest: {
            schemaVersion: 2,
            layers: [
              { digest: "sha256:abc123", mediaType: "application/vnd.devcontainers.layer.v1+tar" },
            ],
            annotations: {},
          },
        }),
        stderr: "",
      };
    });

    const result = await fetchAllFeatureMetadata(
      ["ghcr.io/org/wezterm:1", "ghcr.io/org/nushell:0"],
      { subprocess, cacheDir },
    );

    expect(result.size).toBe(2);
    expect(result.get("ghcr.io/org/wezterm:1")).toEqual(weztermMetadata);
    expect(result.get("ghcr.io/org/nushell:0")).toEqual(nushellMetadata);
  });
});

describe("featureIdToCacheKey", () => {
  // Scenario 34: Cache key escaping round-trip
  it("percent-encodes slashes, colons, and percent signs", () => {
    expect(featureIdToCacheKey("ghcr.io/org/feat:1.2.3")).toBe(
      "ghcr.io%2Forg%2Ffeat%3A1.2.3",
    );
  });

  it("encodes percent signs before other characters to avoid double-encoding", () => {
    expect(featureIdToCacheKey("ghcr.io/org/feat%special:1.2.3")).toBe(
      "ghcr.io%2Forg%2Ffeat%25special%3A1.2.3",
    );
  });

  it("preserves hyphens and dots", () => {
    expect(featureIdToCacheKey("ghcr.io/org/my-feature:1")).toBe(
      "ghcr.io%2Forg%2Fmy-feature%3A1",
    );
  });
});

describe("getTtlMs", () => {
  it("returns null (permanent) for exact semver", () => {
    expect(getTtlMs("ghcr.io/org/feat:1.2.3")).toBeNull();
  });

  it("returns null (permanent) for digest references", () => {
    expect(
      getTtlMs(
        "ghcr.io/org/feat@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      ),
    ).toBeNull();
  });

  it("returns 24h TTL for major float", () => {
    expect(getTtlMs("ghcr.io/org/feat:1")).toBe(86400000);
  });

  it("returns 24h TTL for minor float", () => {
    expect(getTtlMs("ghcr.io/org/feat:1.2")).toBe(86400000);
  });

  it("returns 24h TTL for :latest", () => {
    expect(getTtlMs("ghcr.io/org/feat:latest")).toBe(86400000);
  });

  it("returns 24h TTL for unversioned (no tag)", () => {
    expect(getTtlMs("ghcr.io/org/feat")).toBe(86400000);
  });
});

describe("filesystem cache", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `lace-test-fscache-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    clearMetadataCache(cacheDir);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // Helper: write a cache entry file directly
  function writeCacheFile(
    featureId: string,
    metadata: FeatureMetadata,
    opts?: { fetchedAt?: string; ttlMs?: number | null },
  ): void {
    mkdirSync(cacheDir, { recursive: true });
    const cacheKey = featureIdToCacheKey(featureId);
    const entry = {
      metadata,
      _cache: {
        featureId,
        fetchedAt: opts?.fetchedAt ?? new Date().toISOString(),
        ttlMs: opts?.ttlMs !== undefined ? opts.ttlMs : getTtlMs(featureId),
      },
    };
    writeFileSync(
      join(cacheDir, `${cacheKey}.json`),
      JSON.stringify(entry, null, 2),
      "utf-8",
    );
  }

  function readCacheFile(featureId: string): Record<string, unknown> | null {
    const cacheKey = featureIdToCacheKey(featureId);
    const filePath = join(cacheDir, `${cacheKey}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
  }

  // Scenario 25: Pinned version writes permanent cache entry
  it("writes permanent cache entry for pinned version", async () => {
    const subprocess = mockOciSuccess(weztermMetadata);

    await fetchFeatureMetadata("ghcr.io/org/feat:1.2.3", {
      subprocess,
      cacheDir,
    });

    const cached = readCacheFile("ghcr.io/org/feat:1.2.3");
    expect(cached).not.toBeNull();
    expect((cached as any)._cache.ttlMs).toBeNull();
    expect((cached as any).metadata).toEqual(weztermMetadata);
  });

  // Scenario 26: Floating tag writes 24h TTL cache entry
  it("writes 24h TTL cache entry for floating tag", async () => {
    const subprocess = mockOciSuccess(weztermMetadata);

    await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    const cached = readCacheFile("ghcr.io/org/feat:1");
    expect(cached).not.toBeNull();
    expect((cached as any)._cache.ttlMs).toBe(86400000);
  });

  // Scenario 27: Cache hit for pinned version
  it("uses filesystem cache for pinned version without spawning subprocess", async () => {
    writeCacheFile("ghcr.io/org/feat:1.2.3", weztermMetadata, {
      ttlMs: null,
    });

    const subprocess = vi.fn() as unknown as RunSubprocess;

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1.2.3", {
      subprocess,
      cacheDir,
    });

    expect(result).toEqual(weztermMetadata);
    expect(subprocess).not.toHaveBeenCalled();
  });

  // Scenario 28: Cache hit within TTL for floating tag
  it("uses filesystem cache within TTL for floating tag", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeCacheFile("ghcr.io/org/feat:1", weztermMetadata, {
      fetchedAt: oneHourAgo,
      ttlMs: 86400000,
    });

    const subprocess = vi.fn() as unknown as RunSubprocess;

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    expect(result).toEqual(weztermMetadata);
    expect(subprocess).not.toHaveBeenCalled();
  });

  // Scenario 29: Cache miss -- expired TTL for floating tag
  it("treats expired floating tag cache as miss", async () => {
    const twentyFiveHoursAgo = new Date(
      Date.now() - 25 * 60 * 60 * 1000,
    ).toISOString();
    writeCacheFile("ghcr.io/org/feat:1", weztermMetadata, {
      fetchedAt: twentyFiveHoursAgo,
      ttlMs: 86400000,
    });

    const subprocess = mockOciSuccess(weztermMetadata);

    await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    expect(subprocess).toHaveBeenCalledTimes(1);

    // Verify cache was overwritten with fresh entry
    const cached = readCacheFile("ghcr.io/org/feat:1");
    const fetchedAt = new Date((cached as any)._cache.fetchedAt).getTime();
    expect(Date.now() - fetchedAt).toBeLessThan(5000); // within 5 seconds
  });

  // Scenario 30: --no-cache bypasses filesystem cache for floating tags
  it("bypasses filesystem cache for floating tags when noCache is true", async () => {
    writeCacheFile("ghcr.io/org/feat:1", weztermMetadata, {
      ttlMs: 86400000,
    });

    const subprocess = mockOciSuccess(weztermMetadata);

    await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
      noCache: true,
    });

    expect(subprocess).toHaveBeenCalledTimes(1);
  });

  // Scenario 31: --no-cache does NOT bypass permanent cache
  it("preserves permanent cache when noCache is true", async () => {
    writeCacheFile("ghcr.io/org/feat:1.2.3", weztermMetadata, {
      ttlMs: null,
    });

    const subprocess = vi.fn() as unknown as RunSubprocess;

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1.2.3", {
      subprocess,
      cacheDir,
      noCache: true,
    });

    expect(result).toEqual(weztermMetadata);
    expect(subprocess).not.toHaveBeenCalled();
  });

  // Scenario 32: Cache directory auto-created
  it("auto-creates cache directory on first write", async () => {
    const freshCacheDir = join(cacheDir, "nested", "cache", "dir");
    expect(existsSync(freshCacheDir)).toBe(false);

    const subprocess = mockOciSuccess(weztermMetadata);

    await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir: freshCacheDir,
    });

    expect(existsSync(freshCacheDir)).toBe(true);
  });

  // Scenario 33: Corrupted cache file treated as miss
  it("treats corrupted cache file as miss", async () => {
    mkdirSync(cacheDir, { recursive: true });
    const cacheKey = featureIdToCacheKey("ghcr.io/org/feat:1");
    writeFileSync(
      join(cacheDir, `${cacheKey}.json`),
      "{ invalid json content",
      "utf-8",
    );

    const subprocess = mockOciSuccess(weztermMetadata);

    const result = await fetchFeatureMetadata("ghcr.io/org/feat:1", {
      subprocess,
      cacheDir,
    });

    expect(result).toEqual(weztermMetadata);
    expect(subprocess).toHaveBeenCalledTimes(1);

    // Verify cache was overwritten with valid content
    const cached = readCacheFile("ghcr.io/org/feat:1");
    expect(cached).not.toBeNull();
    expect((cached as any).metadata).toEqual(weztermMetadata);
  });
});
