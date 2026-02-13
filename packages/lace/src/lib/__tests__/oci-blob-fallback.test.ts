import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseFeatureOciRef,
  extractFromTar,
  acquireAnonymousToken,
  downloadBlob,
  fetchFromBlob,
} from "../oci-blob-fallback";

// ── Helper: build a minimal tar buffer ──

/**
 * Create a tar entry (header + data padded to 512-byte boundary).
 * @param name - filename (up to 100 chars)
 * @param content - file content as string
 * @param typeflag - typeflag byte (0x30 for regular file, 0x78 for pax, 0x67 for global pax)
 */
function tarEntry(
  name: string,
  content: string,
  typeflag: number = 0x30,
): Buffer {
  const contentBuf = Buffer.from(content, "utf-8");
  const header = Buffer.alloc(512);

  // Name at offset 0 (100 bytes)
  header.write(name, 0, Math.min(name.length, 100), "ascii");

  // Size at offset 124 (12 bytes, octal, null-terminated)
  const sizeOctal = contentBuf.length.toString(8).padStart(11, "0");
  header.write(sizeOctal, 124, 12, "ascii");

  // Typeflag at offset 156
  header[156] = typeflag;

  // Pad content to 512-byte boundary
  const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
  const data = Buffer.alloc(paddedSize);
  contentBuf.copy(data);

  return Buffer.concat([header, data]);
}

/** Create a tar archive from entries, terminated by two zero blocks. */
function buildTar(...entries: Buffer[]): Buffer {
  const endOfArchive = Buffer.alloc(1024); // Two 512-byte zero blocks
  return Buffer.concat([...entries, endOfArchive]);
}

// ── parseFeatureOciRef ──

describe("parseFeatureOciRef", () => {
  it("parses standard GHCR ref", () => {
    const result = parseFeatureOciRef(
      "ghcr.io/eitsupi/devcontainer-features/nushell:0",
    );
    expect(result).toEqual({
      registry: "ghcr.io",
      repository: "eitsupi/devcontainer-features/nushell",
      tag: "0",
    });
  });

  it("defaults tag to 'latest' when unspecified", () => {
    const result = parseFeatureOciRef(
      "ghcr.io/org/features/name",
    );
    expect(result).toEqual({
      registry: "ghcr.io",
      repository: "org/features/name",
      tag: "latest",
    });
  });

  it("handles exact semver tag", () => {
    const result = parseFeatureOciRef(
      "ghcr.io/org/features/name:1.2.3",
    );
    expect(result.tag).toBe("1.2.3");
  });

  it("handles Docker Hub ref", () => {
    const result = parseFeatureOciRef(
      "docker.io/library/feature:1",
    );
    expect(result).toEqual({
      registry: "docker.io",
      repository: "library/feature",
      tag: "1",
    });
  });
});

// ── extractFromTar ──

describe("extractFromTar", () => {
  it("extracts file from standard tar", () => {
    const content = '{"id":"test","version":"1.0.0"}';
    const tar = buildTar(tarEntry("devcontainer-feature.json", content));

    const result = extractFromTar(tar, "devcontainer-feature.json");
    expect(result).not.toBeNull();
    expect(result!.toString("utf-8")).toBe(content);
  });

  it("extracts file with ./ prefix in filename", () => {
    const content = '{"id":"test","version":"1.0.0"}';
    const tar = buildTar(tarEntry("./devcontainer-feature.json", content));

    const result = extractFromTar(tar, "devcontainer-feature.json");
    expect(result).not.toBeNull();
    expect(result!.toString("utf-8")).toBe(content);
  });

  it("returns null when target file not found", () => {
    const tar = buildTar(tarEntry("other-file.json", "{}"));

    const result = extractFromTar(tar, "devcontainer-feature.json");
    expect(result).toBeNull();
  });

  it("handles pax per-file extended headers (typeflag 0x78)", () => {
    const paxContent = "30 path=devcontainer-feature.json\n";
    const fileContent = '{"id":"pax-test","version":"2.0.0"}';
    const tar = buildTar(
      tarEntry("PaxHeader/devcontainer-feature.json", paxContent, 0x78),
      tarEntry("placeholder-name", fileContent),
    );

    const result = extractFromTar(tar, "devcontainer-feature.json");
    expect(result).not.toBeNull();
    expect(result!.toString("utf-8")).toBe(fileContent);
  });

  it("handles pax global extended headers (typeflag 0x67) without misidentifying as regular file", () => {
    // Global pax header should be skipped, not treated as a file entry
    const globalPaxContent = "30 comment=test archive comment\n";
    const fileContent = '{"id":"global-pax","version":"1.0.0"}';
    const tar = buildTar(
      tarEntry("pax_global_header", globalPaxContent, 0x67),
      tarEntry("devcontainer-feature.json", fileContent),
    );

    const result = extractFromTar(tar, "devcontainer-feature.json");
    expect(result).not.toBeNull();
    expect(result!.toString("utf-8")).toBe(fileContent);
  });

  it("handles pax data with multiple fields (mtime + path)", () => {
    // Pax data can have multiple fields; regex should match the path correctly
    const paxContent =
      "20 mtime=1700000000\n30 path=devcontainer-feature.json\n";
    const fileContent = '{"id":"multi-pax","version":"1.0.0"}';
    const tar = buildTar(
      tarEntry("PaxHeader/entry", paxContent, 0x78),
      tarEntry("placeholder-name", fileContent),
    );

    const result = extractFromTar(tar, "devcontainer-feature.json");
    expect(result).not.toBeNull();
    expect(result!.toString("utf-8")).toBe(fileContent);
  });

  it("handles empty tar gracefully (returns null)", () => {
    const emptyTar = Buffer.alloc(1024); // Two zero blocks
    const result = extractFromTar(emptyTar, "devcontainer-feature.json");
    expect(result).toBeNull();
  });

  it("throws with clear message on gzip-compressed input", () => {
    const gzipBuffer = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
    expect(() => extractFromTar(gzipBuffer, "devcontainer-feature.json")).toThrow(
      /gzip-compressed/,
    );
  });
});

// ── acquireAnonymousToken (mocked fetch) ──

describe("acquireAnonymousToken", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns token from GHCR token endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: "ghcr-token-123" }),
    });

    const token = await acquireAnonymousToken(
      "ghcr.io",
      "eitsupi/devcontainer-features/nushell",
    );
    expect(token).toBe("ghcr-token-123");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("ghcr.io/token"),
      expect.any(Object),
    );
  });

  it("returns null on GHCR non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    const token = await acquireAnonymousToken("ghcr.io", "some/repo");
    expect(token).toBeNull();
  });

  it("parses WWW-Authenticate challenge for generic registry", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        // GET /v2/ -> 401
        ok: false,
        status: 401,
        headers: new Headers({
          "www-authenticate":
            'Bearer realm="https://auth.example.com/token",service="example.com"',
        }),
      })
      .mockResolvedValueOnce({
        // Token endpoint
        ok: true,
        json: () => Promise.resolve({ token: "generic-token" }),
      });

    const token = await acquireAnonymousToken("example.com", "org/repo");
    expect(token).toBe("generic-token");
  });

  it("returns null when no WWW-Authenticate header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({}),
    });

    const token = await acquireAnonymousToken("example.com", "org/repo");
    expect(token).toBeNull();
  });

  it("returns null when realm not found in challenge", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({
        "www-authenticate": "Basic",
      }),
    });

    const token = await acquireAnonymousToken("example.com", "org/repo");
    expect(token).toBeNull();
  });

  it("returns null on fetch timeout", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

    const token = await acquireAnonymousToken("ghcr.io", "some/repo");
    expect(token).toBeNull();
  });
});

// ── downloadBlob (mocked fetch) ──

describe("downloadBlob", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns buffer on 2xx response", async () => {
    const content = Buffer.from("tar content");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)),
    });

    const result = await downloadBlob("ghcr.io", "org/repo", "sha256:abc", "token");
    expect(result).not.toBeNull();
    expect(Buffer.compare(result!, content)).toBe(0);
  });

  it("returns null on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await downloadBlob("ghcr.io", "org/repo", "sha256:abc", "token");
    expect(result).toBeNull();
  });

  it("passes Authorization header when token provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    await downloadBlob("ghcr.io", "org/repo", "sha256:abc", "my-token");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Authorization: "Bearer my-token" },
      }),
    );
  });

  it("omits Authorization header when token is null", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    await downloadBlob("ghcr.io", "org/repo", "sha256:abc", null);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {},
      }),
    );
  });

  it("returns null on timeout", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await downloadBlob("ghcr.io", "org/repo", "sha256:abc", "token");
    expect(result).toBeNull();
  });
});

// ── fetchFromBlob (mocked fetch) ──

describe("fetchFromBlob", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const featureJson = JSON.stringify({
    id: "nushell",
    version: "0.1.1",
    options: {},
  });
  const featureTar = buildTar(
    tarEntry("devcontainer-feature.json", featureJson),
  );

  function mockFetchForBlob(blobContent: Buffer = featureTar): void {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
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
              blobContent.buffer.slice(
                blobContent.byteOffset,
                blobContent.byteOffset + blobContent.byteLength,
              ),
            ),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
  }

  it("succeeds with valid blob containing devcontainer-feature.json", async () => {
    mockFetchForBlob();

    const result = await fetchFromBlob(
      "ghcr.io/eitsupi/devcontainer-features/nushell:0",
      {
        manifest: {
          layers: [
            { digest: "sha256:abc123", mediaType: "application/vnd.devcontainers.layer.v1+tar" },
          ],
        },
      },
    );

    expect(result.id).toBe("nushell");
    expect(result.version).toBe("0.1.1");
  });

  it("throws when no layers in manifest", async () => {
    mockFetchForBlob();

    await expect(
      fetchFromBlob("ghcr.io/org/feat:1", { manifest: {} }),
    ).rejects.toThrow(/No layers found/);
  });

  it("throws when layer digest is missing", async () => {
    mockFetchForBlob();

    await expect(
      fetchFromBlob("ghcr.io/org/feat:1", {
        manifest: { layers: [{ mediaType: "test" }] },
      }),
    ).rejects.toThrow(/no valid digest/);
  });

  it("throws when layer digest has no sha256 prefix", async () => {
    mockFetchForBlob();

    await expect(
      fetchFromBlob("ghcr.io/org/feat:1", {
        manifest: { layers: [{ digest: "md5:abc" }] },
      }),
    ).rejects.toThrow(/no valid digest/);
  });

  it("throws when devcontainer-feature.json not found in tar", async () => {
    const noFeatureTar = buildTar(tarEntry("other-file.txt", "hello"));
    mockFetchForBlob(noFeatureTar);

    await expect(
      fetchFromBlob("ghcr.io/org/feat:1", {
        manifest: {
          layers: [{ digest: "sha256:abc123" }],
        },
      }),
    ).rejects.toThrow(/not found in feature tarball/);
  });

  it("throws with descriptive message when extracted JSON is malformed", async () => {
    const badJsonTar = buildTar(
      tarEntry("devcontainer-feature.json", "{invalid json}"),
    );
    mockFetchForBlob(badJsonTar);

    await expect(
      fetchFromBlob("ghcr.io/org/feat:1", {
        manifest: {
          layers: [{ digest: "sha256:abc123" }],
        },
      }),
    ).rejects.toThrow(/contains invalid JSON/);
  });
});
