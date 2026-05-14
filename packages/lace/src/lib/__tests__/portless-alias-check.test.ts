// IMPLEMENTATION_VALIDATION
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPortlessAliases } from "@/lib/portless-alias-check";
import type { FeatureMetadata } from "@/lib/feature-metadata";
import type { PortAllocation } from "@/lib/port-allocator";
import * as portAllocator from "@/lib/port-allocator";

function makeMetadata(portlessAlias: boolean | undefined): FeatureMetadata {
  return {
    id: "portless",
    version: "0.1.0",
    customizations: {
      lace: {
        ports: {
          proxyPort: {
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

  it("emits info + free-port message when portlessAlias is set and port is free", async () => {
    vi.spyOn(portAllocator, "isPortAvailable").mockResolvedValue(true);

    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["ghcr.io/weftwiseink/devcontainer-features/portless:1", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22435)],
      ownedPorts: new Set(),
      projectName: "weftwise",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      label: "portless/proxyPort",
      port: 22435,
      available: true,
      projectName: "weftwise",
    });
    expect(result.messages.some((m) => m.includes("portless feature detected (alias=weftwise)"))).toBe(true);
    expect(result.messages.some((m) => m.includes("rfp-truly-portless-portless.md"))).toBe(true);
    expect(result.messages.some((m) => m.includes("22435 is free"))).toBe(true);
  });

  it("emits a warn when the host port is held by an unrelated process", async () => {
    vi.spyOn(portAllocator, "isPortAvailable").mockResolvedValue(false);

    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22440)],
      ownedPorts: new Set(),
      projectName: "weftwise",
    });

    expect(result.findings[0]).toMatchObject({
      port: 22440,
      available: false,
    });
    const warn = result.messages.find((m) => m.startsWith("warn:"));
    expect(warn).toBeDefined();
    expect(warn).toContain("22440");
    expect(warn).toContain("unrelated process");
  });

  it("treats the port as available when the project owns it (ownedPorts hit)", async () => {
    const spy = vi
      .spyOn(portAllocator, "isPortAvailable")
      .mockResolvedValue(false);

    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["./devcontainers/features/src/portless", makeMetadata(true)],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22425)],
      ownedPorts: new Set([22425]),
      projectName: "weftwise",
    });

    expect(result.findings[0]?.available).toBe(true);
    // ownedPorts short-circuits the live probe.
    expect(spy).not.toHaveBeenCalled();
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
    });

    expect(result.findings).toHaveLength(0);
    expect(result.messages.some((m) => m.startsWith("warn:"))).toBe(true);
    expect(result.messages[0]).toContain("no host-port allocation");
  });

  it("skips entries when feature metadata is null (e.g., skipMetadataValidation fallback)", async () => {
    const result = await checkPortlessAliases({
      metadataMap: new Map([
        ["unresolvable-feature", null],
      ]),
      allocations: [makeAlloc("portless/proxyPort", 22435)],
      ownedPorts: new Set(),
      projectName: "weftwise",
    });

    expect(result.findings).toHaveLength(0);
    expect(result.messages).toHaveLength(0);
  });
});
