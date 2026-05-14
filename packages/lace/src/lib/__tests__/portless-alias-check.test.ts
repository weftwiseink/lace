// IMPLEMENTATION_VALIDATION
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPortlessAliases } from "@/lib/portless-alias-check";
import type { FeatureMetadata } from "@/lib/feature-metadata";
import type { PortAllocation } from "@/lib/port-allocator";

function makeMetadata(
  portlessAlias: boolean | undefined,
  optionName = "proxyPort",
): FeatureMetadata {
  return {
    id: "portless",
    version: "0.1.0",
    customizations: {
      lace: {
        ports: {
          [optionName]: {
            label: "portless proxy",
            onAutoForward: "silent",
            requireLocalPort: true,
            ...(portlessAlias !== undefined ? { portlessAlias } : {}),
          },
        },
      },
    },
  };
}

function makeAlloc(label: string, port: number): PortAllocation {
  return { label, port, assignedAt: "2026-05-14T00:00:00Z" };
}

describe("checkPortlessAliases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the new :1355 URL hint plus a free-host-port message when portlessAlias is set", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        [
          "ghcr.io/weftwiseink/devcontainer-features/portless:1",
          makeMetadata(true),
        ],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22435)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      isPortAvailable: async () => true,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      label: "portless/proxyPort",
      port: 22435,
      hostPortFree: true,
      projectName: "weftwise",
    });
    expect(
      result.messages.some((m) =>
        m.includes(
          "URLs at http://{branch}.weftwise.localhost:1355/",
        ),
      ),
    ).toBe(true);
    expect(
      result.messages.some((m) => m.includes("rfp-truly-portless-portless.md")),
    ).toBe(true);
    expect(
      result.messages.some((m) => m.includes("host port 1355 is free")),
    ).toBe(true);
    // Round-7 wording must NOT appear:
    expect(
      result.messages.some((m) =>
        m.includes("URLs include the host port suffix in v1"),
      ),
    ).toBe(false);
  });

  it("warns when the host portless port (:1355) is held by an unrelated process", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22440)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      isPortAvailable: async () => false,
    });

    expect(result.findings[0]).toMatchObject({
      port: 22440,
      hostPortFree: false,
    });
    const warn = result.messages.find((m) => m.startsWith("warn:"));
    expect(warn).toBeDefined();
    expect(warn).toContain("host port 1355");
    expect(warn).toContain("lace doctor --reset");
  });

  it("dedupes the info lines across multiple portlessAlias declarations", async () => {
    const metadata: FeatureMetadata = {
      id: "portless",
      version: "0.1.0",
      customizations: {
        lace: {
          ports: {
            proxyPort: {
              label: "portless proxy",
              portlessAlias: true,
            },
            secondaryPort: {
              label: "portless secondary",
              portlessAlias: true,
            },
          },
        },
      },
    };
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", metadata],
      ]),
      allocations: [
        makeAlloc("portless/proxyPort", 22435),
        makeAlloc("portless/secondaryPort", 22436),
      ],
      ownedPorts: new Set(),
      projectName: "weftwise",
      isPortAvailable: async () => true,
    });

    expect(result.findings).toHaveLength(2);
    // Each block of info lines should appear exactly once.
    const urlLines = result.messages.filter((m) =>
      m.includes("URLs at http://"),
    );
    const rfpLines = result.messages.filter((m) =>
      m.includes("rfp-truly-portless-portless.md"),
    );
    expect(urlLines).toHaveLength(1);
    expect(rfpLines).toHaveLength(1);
  });

  it("is a no-op when no feature declares portlessAlias", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["foo", makeMetadata(undefined)],
        ["bar", makeMetadata(false)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22435)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      isPortAvailable: async () => true,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.messages).toHaveLength(0);
  });

  it("warns softly when portlessAlias is declared but no allocation exists", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [],
      ownedPorts: new Set(),
      projectName: "weftwise",
      isPortAvailable: async () => true,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.messages.some((m) => m.startsWith("warn:"))).toBe(true);
    expect(result.messages[0]).toContain("no host-port allocation");
  });

  it("skips entries when feature metadata is null", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([["unresolvable-feature", null]]),
      allocations: [makeAlloc("portless/proxyPort", 22435)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      isPortAvailable: async () => true,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.messages).toHaveLength(0);
  });

  it("uses the hostPortlessPort override (for tests that don't want to touch :1355)", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22440)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      hostPortlessPort: 9999,
      isPortAvailable: async (port) => port === 9999,
    });
    expect(
      result.messages.some((m) =>
        m.includes("URLs at http://{branch}.weftwise.localhost:9999/"),
      ),
    ).toBe(true);
  });
});
