// IMPLEMENTATION_VALIDATION
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPortlessAliases } from "@/lib/portless-alias-check";
import type { FeatureMetadata } from "@/lib/feature-metadata";
import type { PortAllocation } from "@/lib/port-allocator";
import type { HostPortlessState } from "@/lib/host-portless";

// Helper: build a constant-state probe for injection.
function probe(state: HostPortlessState): () => Promise<HostPortlessState> {
  return async () => state;
}
const FREE: HostPortlessState = { kind: "free" };
const FOREIGN: HostPortlessState = {
  kind: "foreign-bound",
  reason: "port 1355 is bound but no lace runtime file is present",
};

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
      probeHostPortless: probe(FREE),
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      label: "portless/proxyPort",
      port: 22435,
      hostPortFree: true,
      hostPortlessState: "free",
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

  it("warns when the host portless port (:1355) is held by an unrelated process (no runtime file)", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22440)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      probeHostPortless: probe(FOREIGN),
    });

    expect(result.findings[0]).toMatchObject({
      port: 22440,
      hostPortFree: false,
      hostPortlessState: "foreign-bound",
    });
    const warn = result.messages.find((m) => m.startsWith("warn:"));
    expect(warn).toBeDefined();
    expect(warn).toContain("host port 1355");
    expect(warn).toContain("non-lace process");
    expect(warn).toContain("lace doctor --reset");
  });

  it("emits info (not warn) when lace's own host portless is alive on :1355", async () => {
    const aliveState: HostPortlessState = {
      kind: "lace-owned-alive",
      runtime: {
        pid: 1950137,
        port: 1355,
        startedAt: "2026-05-14T10:00:00.000Z",
        portlessVersion: "0.13.0",
      },
    };
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22440)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      probeHostPortless: probe(aliveState),
    });

    expect(result.findings[0]).toMatchObject({
      port: 22440,
      hostPortFree: true,
      hostPortlessState: "lace-owned-alive",
    });
    expect(result.messages.some((m) => m.startsWith("warn:"))).toBe(false);
    const info = result.messages.find((m) =>
      m.includes("lace's host portless is alive on :1355"),
    );
    expect(info).toBeDefined();
    expect(info).toContain("pid 1950137");
    expect(info).toContain("reuse");
  });

  it("warns when the runtime record is stale (recorded PID is dead)", async () => {
    const staleState: HostPortlessState = {
      kind: "stale-record",
      staleRuntime: {
        pid: 999999,
        port: 1355,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22440)],
      ownedPorts: new Set(),
      projectName: "weftwise",
      probeHostPortless: probe(staleState),
    });

    expect(result.findings[0]).toMatchObject({
      hostPortFree: false,
      hostPortlessState: "stale-record",
    });
    const warn = result.messages.find((m) => m.startsWith("warn:"));
    expect(warn).toBeDefined();
    expect(warn).toContain("stale lace runtime record");
    expect(warn).toContain("pid 999999");
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
      probeHostPortless: probe(FREE),
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
      probeHostPortless: probe(FREE),
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
      probeHostPortless: probe(FREE),
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
      probeHostPortless: probe(FREE),
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
      probeHostPortless: probe(FREE),
    });
    expect(
      result.messages.some((m) =>
        m.includes("URLs at http://{branch}.weftwise.localhost:9999/"),
      ),
    ).toBe(true);
  });
});
