// IMPLEMENTATION_VALIDATION
//
// Hermetic tests for the best-effort cross-project coordinator. The cross-
// project ledger is an ENHANCEMENT: any failure in podman enumeration, lock
// acquisition, ledger read/reconcile, or persistence must degrade to today's
// behavior (empty exclusions, no ledger write) and NEVER fail allocation or
// change the exit code. Only runResolve (the real allocation) may fail.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { coordinatePortAllocation } from "@/lib/up";
import { saveLedger } from "@/lib/port-ledger";
import type { RunSubprocess } from "@/lib/subprocess";
import type { TemplateResolutionResult } from "@/lib/template-resolver";

const SENTINEL: TemplateResolutionResult = {
  resolvedConfig: { ok: true },
  allocations: [],
  warnings: [],
  mountAssignments: [],
};

/** A subprocess that always throws, simulating podman missing/erroring. */
const throwingSubprocess: RunSubprocess = () => {
  throw new Error("podman: command not found");
};

/** A subprocess whose `ps -a` returns no containers. */
const emptySubprocess: RunSubprocess = () => ({ exitCode: 0, stdout: "[]", stderr: "" });

describe("coordinatePortAllocation (best-effort)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `lace-coord-be-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a throwing podman seam AND a throwing ledger path still resolve, with empty exclusions", async () => {
    // Make the ledger path unusable: its parent is a FILE, so the lock mkdir
    // (and every fs op) throws. Combined with a throwing podman seam, both arms
    // of coordination fail.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a dir", "utf-8");
    const ledgerPath = join(blocker, "port-ledger.json");

    let seenExclusions: Set<number> | null = null;
    const result = await coordinatePortAllocation({
      workspaceFolder: "/work/mine",
      subprocess: throwingSubprocess,
      ownedPorts: new Set(),
      ledgerPath,
      runResolve: async (_allocator, exclusions) => {
        seenExclusions = exclusions;
        return SENTINEL;
      },
    });

    expect(result).toBe(SENTINEL); // resolution proceeded, no throw
    expect(seenExclusions).not.toBeNull();
    expect(seenExclusions!.size).toBe(0); // degraded to empty exclusions
  });

  it("a throwing podman seam with a writable ledger degrades to empty exclusions and still persists nothing harmful", async () => {
    const ledgerPath = join(dir, "port-ledger.json");
    let seenExclusions: Set<number> | null = null;
    const result = await coordinatePortAllocation({
      workspaceFolder: "/work/mine",
      subprocess: throwingSubprocess, // enumeration throws -> caught -> empty
      ownedPorts: new Set(),
      ledgerPath,
      runResolve: async (_allocator, exclusions) => {
        seenExclusions = exclusions;
        return SENTINEL;
      },
    });
    expect(result).toBe(SENTINEL);
    expect(seenExclusions!.size).toBe(0);
  });

  it("passes a non-empty exclusion set when the ledger is readable and holds other projects", async () => {
    const ledgerPath = join(dir, "port-ledger.json");
    saveLedger(ledgerPath, {
      entries: [
        {
          port: 22440,
          project: "/work/other",
          label: "svc/port",
          assignedAt: "2026-09-01T00:00:00.000Z",
          lastSeen: "2026-09-06T11:00:00.000Z",
        },
      ],
    });
    let seenExclusions: Set<number> | null = null;
    await coordinatePortAllocation({
      workspaceFolder: "/work/mine",
      subprocess: emptySubprocess,
      ownedPorts: new Set(),
      ledgerPath,
      runResolve: async (_allocator, exclusions) => {
        seenExclusions = exclusions;
        return SENTINEL;
      },
    });
    expect(seenExclusions!.has(22440)).toBe(true); // ledger arm feeds exclusions when available
  });

  it("propagates a genuine runResolve failure (real allocation error still fails the pipeline)", async () => {
    const ledgerPath = join(dir, "port-ledger.json");
    await expect(
      coordinatePortAllocation({
        workspaceFolder: "/work/mine",
        subprocess: emptySubprocess,
        ownedPorts: new Set(),
        ledgerPath,
        runResolve: async () => {
          throw new Error("port range exhausted");
        },
      }),
    ).rejects.toThrow("port range exhausted");
  });
});
