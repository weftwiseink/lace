// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadLedger,
  saveLedger,
  reconcileLedger,
  computeExclusions,
  upsertAssignments,
  DEFAULT_STALE_MS,
  WORKSPACE_GONE_STALE_MS,
  type PortLedger,
  type LedgerEntry,
} from "@/lib/port-ledger";
import type { PublishedPort } from "@/lib/podman-ports";

const NOW = new Date("2026-09-06T12:00:00.000Z");

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    port: 22428,
    project: "/work/jif",
    label: "wezterm-server/hostSshPort",
    assignedAt: "2026-09-01T00:00:00.000Z",
    lastSeen: "2026-09-06T11:00:00.000Z",
    ...over,
  };
}

function pub(over: Partial<PublishedPort>): PublishedPort {
  return { port: 22428, containerId: "c1", localFolder: "/work/jif", ...over };
}

const allExist = () => true;
const noneExist = () => false;

describe("reconcileLedger", () => {
  it("keeps a stopped-but-defined entry and refreshes lastSeen (reclaim on removal, NOT on stop)", () => {
    // Stopped sibling still appears in `ps -a`, so live includes its port.
    const ledger: PortLedger = { entries: [entry({ lastSeen: "2026-01-01T00:00:00.000Z" })] };
    const live = [pub({})]; // stopped container still reports the port
    const out = reconcileLedger(ledger, live, allExist, NOW);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].port).toBe(22428);
    expect(out.entries[0].lastSeen).toBe(NOW.toISOString()); // refreshed, not aged out
  });

  it("reclaims an entry whose container is REMOVED (no live reference) and aged past threshold", () => {
    const old = new Date(NOW.getTime() - DEFAULT_STALE_MS - 1000).toISOString();
    const ledger: PortLedger = { entries: [entry({ lastSeen: old })] };
    const out = reconcileLedger(ledger, [], allExist, NOW); // no live container at all
    expect(out.entries).toHaveLength(0);
  });

  it("keeps a removed-but-recent entry (no live reference, but within threshold)", () => {
    const recent = new Date(NOW.getTime() - DAY(1)).toISOString();
    const ledger: PortLedger = { entries: [entry({ lastSeen: recent })] };
    const out = reconcileLedger(ledger, [], allExist, NOW);
    expect(out.entries).toHaveLength(1);
  });

  it("rewrites ownership to the live project when a different project publishes the port", () => {
    const ledger: PortLedger = { entries: [entry({ project: "/work/jif", port: 22428 })] };
    const live = [pub({ port: 22428, localFolder: "/work/whelm", containerId: "whelm-c" })];
    const out = reconcileLedger(ledger, live, allExist, NOW);
    expect(out.entries[0].project).toBe("/work/whelm");
    expect(out.entries[0].lastSeen).toBe(NOW.toISOString());
  });

  it("uses the shorter workspace-gone threshold only with no live container", () => {
    // Aged past workspace-gone threshold but NOT the default threshold, workspace gone, no live.
    const age = WORKSPACE_GONE_STALE_MS + DAY(1);
    const ts = new Date(NOW.getTime() - age).toISOString();
    const ledger: PortLedger = { entries: [entry({ lastSeen: ts })] };
    expect(reconcileLedger(ledger, [], noneExist, NOW).entries).toHaveLength(0); // reclaimed (gone)
    expect(reconcileLedger(ledger, [], allExist, NOW).entries).toHaveLength(1); // kept (exists, < default)
  });

  it("never reclaims a workspace-gone entry that still has a live container", () => {
    const ancient = new Date(NOW.getTime() - DEFAULT_STALE_MS * 10).toISOString();
    const ledger: PortLedger = { entries: [entry({ lastSeen: ancient })] };
    const out = reconcileLedger(ledger, [pub({})], noneExist, NOW);
    expect(out.entries).toHaveLength(1); // live reference wins over workspace-gone + age
  });
});

describe("computeExclusions", () => {
  it("unions ledger-other-projects and live-non-current ports; excludes nothing current owns", () => {
    const ledger: PortLedger = {
      entries: [
        entry({ project: "/work/jif", port: 22428 }),
        entry({ project: "/work/whelm", port: 22429, label: "a" }),
        entry({ project: "/work/mine", port: 22430, label: "b" }),
      ],
    };
    const live = [
      pub({ port: 22440, localFolder: "/work/whelm" }), // other project, live
      pub({ port: 22441, localFolder: null, containerId: "manual" }), // non-lace manual run
      pub({ port: 22430, localFolder: "/work/mine" }), // current's own live port
    ];
    const ex = computeExclusions(ledger, live, "/work/mine");
    expect(ex).toEqual(new Set([22428, 22429, 22440, 22441]));
    expect(ex.has(22430)).toBe(false); // current project owns it in both arms
  });

  it("excludes a stopped sibling's port surfaced only via the live (ps -a) arm", () => {
    // Empty ledger (degraded/lost); stopped sibling seen via ps -a enumeration.
    const live = [pub({ port: 22428, localFolder: "/work/jif" })];
    const ex = computeExclusions({ entries: [] }, live, "/work/mine");
    expect(ex.has(22428)).toBe(true);
  });

  it("excludes a reserved-but-unbound sibling seen only via the ledger arm", () => {
    // Sibling reserved 22428 but has no live container yet (resolve-before-run window).
    const ledger: PortLedger = { entries: [entry({ project: "/work/jif", port: 22428 })] };
    const ex = computeExclusions(ledger, [], "/work/mine");
    expect(ex.has(22428)).toBe(true);
  });
});

describe("loadLedger / saveLedger", () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `lace-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads a missing file as empty", () => {
    expect(loadLedger(join(dir, "nope.json"))).toEqual({ entries: [] });
  });

  it("loads a corrupt file as empty", () => {
    const p = join(dir, "port-ledger.json");
    writeFileSync(p, "{ not json", "utf-8");
    expect(loadLedger(p)).toEqual({ entries: [] });
  });

  it("loads a structurally-invalid file (no entries array) as empty", () => {
    const p = join(dir, "port-ledger.json");
    writeFileSync(p, JSON.stringify({ foo: 1 }), "utf-8");
    expect(loadLedger(p)).toEqual({ entries: [] });
  });

  it("round-trips via atomic save (temp + rename), creating parent dirs", () => {
    const p = join(dir, "nested", "port-ledger.json");
    const ledger: PortLedger = { entries: [entry({})] };
    saveLedger(p, ledger);
    expect(existsSync(p)).toBe(true);
    expect(loadLedger(p)).toEqual(ledger);
    // No leftover temp files.
    expect(readFileSync(p, "utf-8").endsWith("\n")).toBe(true);
  });
});

describe("upsertAssignments", () => {
  it("upserts by (project,label), preserves assignedAt, refreshes lastSeen", () => {
    const ledger: PortLedger = {
      entries: [entry({ project: "/work/mine", label: "x", port: 22430, assignedAt: "2026-01-01T00:00:00.000Z" })],
    };
    const out = upsertAssignments(
      ledger,
      "/work/mine",
      [
        { label: "x", port: 22430, assignedAt: "2026-09-06T00:00:00.000Z" },
        { label: "y", port: 22431, assignedAt: "2026-09-06T00:00:00.000Z" },
      ],
      NOW,
    );
    const x = out.entries.find((e) => e.label === "x")!;
    const y = out.entries.find((e) => e.label === "y")!;
    expect(x.assignedAt).toBe("2026-01-01T00:00:00.000Z"); // preserved
    expect(x.lastSeen).toBe(NOW.toISOString());
    expect(y.port).toBe(22431);
    expect(out.entries).toHaveLength(2);
  });
});

function DAY(n: number): number {
  return n * 24 * 60 * 60 * 1000;
}
