// IMPLEMENTATION_VALIDATION
//
// Hermetic exclusion tests for PortAllocator. Every case injects a stubbed
// isPortAvailable probe, so NO real host port is ever bound or probed. This is
// deliberately separate from port-allocator.test.ts (which uses real sockets
// and binds live ports, and is environmentally flaky on a host with live
// containers holding ports in the lace range).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PortAllocator, LACE_PORT_MIN, LACE_PORT_MAX } from "@/lib/port-allocator";

/** A probe that reports every port free, so allocation never touches the network. */
const allFree = async () => true;

describe("PortAllocator exclusions (hermetic, stubbed probe)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `lace-excl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });
  afterEach(() => rmSync(workspaceRoot, { recursive: true, force: true }));

  function writeAssignment(label: string, port: number): void {
    const laceDir = join(workspaceRoot, ".lace");
    mkdirSync(laceDir, { recursive: true });
    writeFileSync(
      join(laceDir, "port-assignments.json"),
      JSON.stringify({
        assignments: {
          [label]: { label, port, assignedAt: "2026-09-01T00:00:00.000Z" },
        },
      }),
      "utf-8",
    );
  }

  it("findAvailablePort never returns an excluded port even though the probe reports it free", async () => {
    // Exclude the whole range except one port; that one must be returned.
    const target = LACE_PORT_MIN + 5;
    const exclusions = new Set<number>();
    for (let p = LACE_PORT_MIN; p <= LACE_PORT_MAX; p++) {
      if (p !== target) exclusions.add(p);
    }
    const allocator = new PortAllocator(workspaceRoot, {
      exclusions,
      isPortAvailable: allFree,
    });
    const alloc = await allocator.allocate("feature/newPort");
    expect(alloc.port).toBe(target);
  });

  // finding #1 regression: ownership flipped away from this project.
  it("does NOT reuse a stored port that is now excluded; falls through to a fresh unexcluded port", async () => {
    const flipped = LACE_PORT_MIN + 3; // this project's old port, now owned by another
    writeAssignment("wezterm-server/hostSshPort", flipped);

    const allocator = new PortAllocator(workspaceRoot, {
      ownedPorts: new Set(), // own container is down
      exclusions: new Set([flipped]), // ledger reconciled ownership to another project
      isPortAvailable: allFree, // probe would (wrongly) say it is free
    });

    const alloc = await allocator.allocate("wezterm-server/hostSshPort");
    expect(alloc.port).not.toBe(flipped); // must not hand back the flipped port
    expect(alloc.port).toBeGreaterThanOrEqual(LACE_PORT_MIN);
    expect(alloc.port).toBeLessThanOrEqual(LACE_PORT_MAX);
    expect(alloc.port).not.toBe(flipped);
  });

  it("still reuses a stored port that is NOT excluded and probes free", async () => {
    const port = LACE_PORT_MIN + 7;
    writeAssignment("wezterm-server/hostSshPort", port);
    const allocator = new PortAllocator(workspaceRoot, {
      exclusions: new Set([LACE_PORT_MIN + 1]), // unrelated exclusion
      isPortAvailable: allFree,
    });
    const alloc = await allocator.allocate("wezterm-server/hostSshPort");
    expect(alloc.port).toBe(port);
    expect(alloc.assignedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reuses an excluded port only if the current project still owns it via ownedPorts is NOT allowed", async () => {
    // Even if ownedPorts claims it, an exclusion (ownership flip) must win.
    const port = LACE_PORT_MIN + 2;
    writeAssignment("svc/port", port);
    const allocator = new PortAllocator(workspaceRoot, {
      ownedPorts: new Set([port]),
      exclusions: new Set([port]),
      isPortAvailable: allFree,
    });
    const alloc = await allocator.allocate("svc/port");
    expect(alloc.port).not.toBe(port); // exclusion gates ahead of ownedPorts
  });

  it("exhaustion error lists cross-project holders from exclusions", async () => {
    // Exclude the entire range so allocation fails, and check the message.
    const exclusions = new Set<number>();
    for (let p = LACE_PORT_MIN; p <= LACE_PORT_MAX; p++) exclusions.add(p);
    const holders = new Map<number, string>([
      [LACE_PORT_MIN, "/work/whelm"],
      [LACE_PORT_MIN + 1, "/work/jif"],
    ]);
    const allocator = new PortAllocator(workspaceRoot, {
      exclusions,
      exclusionHolders: holders,
      isPortAvailable: allFree,
    });
    await expect(allocator.allocate("feature/port")).rejects.toThrow(
      /Cross-project reservations/,
    );
    await expect(allocator.allocate("feature/port")).rejects.toThrow(/\/work\/whelm/);
  });

  it("treats a bare Set second arg as ownedPorts with empty exclusions (backward-compatible)", async () => {
    // Legacy signature: a stored port in ownedPorts is reused via the
    // ownedPorts short-circuit (which precedes any probe), and with no
    // exclusions it is never gated. No real port is bound.
    const port = LACE_PORT_MIN + 4;
    writeAssignment("svc/port", port);
    const allocator = new PortAllocator(workspaceRoot, new Set([port]));
    const alloc = await allocator.allocate("svc/port");
    expect(alloc.port).toBe(port);
  });
});
