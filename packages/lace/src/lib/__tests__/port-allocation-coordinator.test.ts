// IMPLEMENTATION_VALIDATION
//
// Coordinator composition tests: exercise the real building blocks in the exact
// sequence up.ts runs them inside withLedgerLock (enumerate podman -> reconcile
// ledger -> computeExclusions -> allocate with stubbed probe -> upsert + save),
// hermetically. This proves the whelm/jif regression end-to-end at the module
// level without driving the container-dependent outer `up()` shell (that full
// E2E is the deferred Phase 6, since it needs real container builds).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PortAllocator } from "@/lib/port-allocator";
import { getAllPublishedHostPorts } from "@/lib/podman-ports";
import {
  loadLedger,
  saveLedger,
  reconcileLedger,
  computeExclusions,
  describeExclusions,
  upsertAssignments,
  type PortLedger,
} from "@/lib/port-ledger";
import type { RunSubprocess } from "@/lib/subprocess";

/** A podman stub whose `ps -a` reports the given entries; inspect returns null. */
function podmanStub(psEntries: unknown[]): RunSubprocess {
  return (_command, args) => {
    if (args[0] === "ps" && args.includes("-a")) {
      return { exitCode: 0, stdout: JSON.stringify(psEntries), stderr: "" };
    }
    return { exitCode: 0, stdout: "null", stderr: "" };
  };
}

/** Run the exact coordinator body up.ts wraps in withLedgerLock. */
async function coordinate(opts: {
  ledgerPath: string;
  subprocess: RunSubprocess;
  workspaceFolder: string;
  ownedPorts?: Set<number>;
  now?: Date;
}): Promise<{ port: number; ledger: PortLedger }> {
  const now = opts.now ?? new Date("2026-09-06T12:00:00.000Z");
  const live = getAllPublishedHostPorts(opts.subprocess);
  const reconciled = reconcileLedger(loadLedger(opts.ledgerPath), live, existsSync, now);
  const exclusions = computeExclusions(reconciled, live, opts.workspaceFolder);
  const exclusionHolders = describeExclusions(reconciled, live, opts.workspaceFolder);
  const allocator = new PortAllocator(opts.workspaceFolder, {
    ownedPorts: opts.ownedPorts,
    exclusions,
    exclusionHolders,
    isPortAvailable: async () => true, // stubbed: every port probes free
  });
  const alloc = await allocator.allocate("wezterm-server/hostSshPort");
  const merged = upsertAssignments(reconciled, opts.workspaceFolder, allocator.getAllocations(), now);
  saveLedger(opts.ledgerPath, merged);
  return { port: alloc.port, ledger: merged };
}

describe("cross-project coordinator (hermetic composition)", () => {
  let dir: string;
  let ledgerPath: string;
  const MINE = "/work/mine";
  const JIF = "/work/jif";

  beforeEach(() => {
    dir = join(tmpdir(), `lace-coord-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    ledgerPath = join(dir, "port-ledger.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("whelm/jif: a stopped sibling's port (in ledger + ps -a) is not handed to another project", async () => {
    // jif reserved 22428 in the ledger, and its container is stopped but still
    // reported by `ps -a` with that host port. The TCP probe reports it free.
    saveLedger(ledgerPath, {
      entries: [
        {
          port: 22428,
          project: JIF,
          label: "wezterm-server/hostSshPort",
          assignedAt: "2026-09-01T00:00:00.000Z",
          lastSeen: "2026-09-06T11:00:00.000Z",
        },
      ],
    });
    const subprocess = podmanStub([
      {
        Id: "jif-stopped",
        State: "exited",
        Labels: { "devcontainer.local_folder": JIF },
        Ports: [{ host_port: 22428, container_port: 2222, protocol: "tcp" }],
      },
    ]);

    const { port, ledger } = await coordinate({ ledgerPath, subprocess, workspaceFolder: MINE });
    expect(port).not.toBe(22428);
    // jif's reservation survives (kept + lastSeen refreshed) and mine is recorded.
    const jif = ledger.entries.find((e) => e.project === JIF);
    const mine = ledger.entries.find((e) => e.project === MINE);
    expect(jif?.port).toBe(22428);
    expect(mine?.port).toBe(port);
  });

  it("degrades to the ps -a arm alone when the ledger is lost/corrupt (still excludes the stopped sibling)", async () => {
    writeFileSync(ledgerPath, "{ corrupt", "utf-8"); // lost ledger
    const subprocess = podmanStub([
      {
        Id: "jif-stopped",
        State: "exited",
        Labels: { "devcontainer.local_folder": JIF },
        Ports: [{ host_port: 22428, container_port: 2222, protocol: "tcp" }],
      },
    ]);
    const { port } = await coordinate({ ledgerPath, subprocess, workspaceFolder: MINE });
    expect(port).not.toBe(22428); // live enumeration still covers the stopped sibling
  });

  it("ownership-flip: a project does NOT reuse its stored port after another project took it", async () => {
    // mine's own .lace file still names 22428, but the reconciled ledger now
    // shows whelm's live container publishing 22428 -> excluded for mine.
    const mineWorkspace = join(dir, "mine-ws");
    mkdirSync(join(mineWorkspace, ".lace"), { recursive: true });
    writeFileSync(
      join(mineWorkspace, ".lace", "port-assignments.json"),
      JSON.stringify({
        assignments: {
          "wezterm-server/hostSshPort": {
            label: "wezterm-server/hostSshPort",
            port: 22428,
            assignedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      }),
      "utf-8",
    );
    // Ledger still (stale) records mine as owner; live podman shows whelm owns it.
    saveLedger(ledgerPath, {
      entries: [
        {
          port: 22428,
          project: mineWorkspace,
          label: "wezterm-server/hostSshPort",
          assignedAt: "2026-09-01T00:00:00.000Z",
          lastSeen: "2026-09-06T11:00:00.000Z",
        },
      ],
    });
    const subprocess = podmanStub([
      {
        Id: "whelm-live",
        State: "running",
        Labels: { "devcontainer.local_folder": "/work/whelm" },
        Ports: [{ host_port: 22428, container_port: 2222, protocol: "tcp" }],
      },
    ]);

    const { port } = await coordinate({
      ledgerPath,
      subprocess,
      workspaceFolder: mineWorkspace,
      ownedPorts: new Set(), // mine's container is down
    });
    // Reconcile rewrote 22428 to whelm; mine must fall through to a fresh port.
    expect(port).not.toBe(22428);
  });

  it("two sequential coordinators for different projects receive distinct ports", async () => {
    const subprocess = podmanStub([]); // no live containers yet
    const first = await coordinate({ ledgerPath, subprocess, workspaceFolder: "/work/a" });
    // Second project reads the first's committed reservation and allocates around it.
    const second = await coordinate({ ledgerPath, subprocess, workspaceFolder: "/work/b" });
    expect(first.port).not.toBe(second.port);
    expect(second.ledger.entries).toHaveLength(2);
  });
});
