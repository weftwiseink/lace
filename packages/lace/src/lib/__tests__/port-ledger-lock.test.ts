// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import {
  withLedgerLock,
  lockPathFor,
  loadLedger,
  saveLedger,
  type PortLedger,
} from "@/lib/port-ledger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withLedgerLock", () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `lace-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    ledgerPath = join(dir, "port-ledger.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("serializes two concurrent coordinators so both writes survive", async () => {
    const order: string[] = [];
    const coordinator = (label: string) =>
      withLedgerLock(
        ledgerPath,
        async () => {
          order.push(`enter-${label}`);
          const led = loadLedger(ledgerPath);
          // A racing read-modify-write: without the lock one overwrites the other.
          await sleep(30);
          led.entries.push({
            port: 22425 + led.entries.length,
            project: `/work/${label}`,
            label,
            assignedAt: "2026-09-06T00:00:00.000Z",
            lastSeen: "2026-09-06T00:00:00.000Z",
          });
          saveLedger(ledgerPath, led);
          order.push(`exit-${label}`);
        },
        { retryIntervalMs: 5 },
      );

    await Promise.all([coordinator("a"), coordinator("b")]);

    const final = loadLedger(ledgerPath);
    expect(final.entries).toHaveLength(2); // no lost update
    // Critical sections did not interleave.
    expect(order).toEqual(
      order[0] === "enter-a"
        ? ["enter-a", "exit-a", "enter-b", "exit-b"]
        : ["enter-b", "exit-b", "enter-a", "exit-a"],
    );
  });

  it("breaks a lock whose recorded owner pid is dead, then acquires", async () => {
    // Pre-create a held lock owned by (a claimed) dead pid on this host.
    const lockDir = lockPathFor(ledgerPath);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: 424242, host: hostname(), at: Date.now() }),
      "utf-8",
    );

    let ran = false;
    await withLedgerLock(
      ledgerPath,
      () => {
        ran = true;
      },
      { isPidAlive: () => false, timeoutMs: 1000 },
    );
    expect(ran).toBe(true);
  });

  it("does NOT preempt a lock held by a live pid, even with a tiny mtime threshold", async () => {
    // Held by this (live) process on this host. mtime heuristic must not apply.
    const lockDir = lockPathFor(ledgerPath);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }),
      "utf-8",
    );

    let ran = false;
    await expect(
      withLedgerLock(
        ledgerPath,
        () => {
          ran = true;
        },
        { isPidAlive: () => true, staleMtimeMs: 1, timeoutMs: 250, retryIntervalMs: 20 },
      ),
    ).rejects.toThrow(/Timed out acquiring port-ledger lock/);
    expect(ran).toBe(false); // never preempted the live holder
  });

  it("a waiter blocks until the live holder actually releases, then proceeds", async () => {
    const events: string[] = [];
    const holder = withLedgerLock(
      ledgerPath,
      async () => {
        events.push("holder-enter");
        await sleep(150);
        events.push("holder-exit");
      },
      { retryIntervalMs: 5 },
    );
    await sleep(20); // ensure holder acquired first
    const waiter = withLedgerLock(
      ledgerPath,
      () => {
        events.push("waiter-enter");
      },
      { retryIntervalMs: 5, staleMtimeMs: 1, timeoutMs: 2000 },
    );
    await Promise.all([holder, waiter]);
    expect(events).toEqual(["holder-enter", "holder-exit", "waiter-enter"]);
  });

  it("releases the lock when fn throws", async () => {
    const lockDir = lockPathFor(ledgerPath);
    await expect(
      withLedgerLock(ledgerPath, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockDir)).toBe(false); // released despite throw
  });

  it("returns fn's value", async () => {
    const led: PortLedger = { entries: [] };
    const result = await withLedgerLock(ledgerPath, () => {
      saveLedger(ledgerPath, led);
      return 42;
    });
    expect(result).toBe(42);
  });
});
