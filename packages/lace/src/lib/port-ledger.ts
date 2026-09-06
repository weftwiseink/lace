// IMPLEMENTATION_VALIDATION
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import type { PublishedPort } from "./podman-ports";

// ── Types ──

/**
 * One cross-project port reservation, recorded independently of container
 * run-state. `project` is the workspace folder (matching a container's
 * `devcontainer.local_folder` label), so ledger entries and podman containers
 * are joinable on it.
 */
export interface LedgerEntry {
  port: number;
  project: string;
  label: string;
  assignedAt: string;
  lastSeen: string;
}

/** The authoritative cross-project reservation record. */
export interface PortLedger {
  entries: LedgerEntry[];
}

// ── Staleness thresholds ──

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An entry with no live container of any run-state is reclaimed once its
 * `lastSeen` is older than this. Conservative by design: a stopped-and-still-
 * defined sibling keeps a live `ps -a` reference, so it is never reclaimed;
 * only a removed container's entry ages out.
 */
export const DEFAULT_STALE_MS = 30 * DAY_MS;

/**
 * Workspace-gone accelerator. When `projectExists(project)` is false AND there
 * is no live container, an entry may reclaim on this shorter age.
 *
 * NOTE(claude-opus-4-8/lace/port-allocation): The proposal names workspace-gone
 * as a reclaim contributor but specifies no distinct threshold, only that it
 * "never reclaims on a single failed stat" and always requires no-live AND age.
 * A 7-day accelerated window honors that (a stronger-than-one-stat signal is
 * still required) while giving `projectExists` a real effect. `existsSync` can
 * transiently false-negative on an unmounted/invisible workspace path, so
 * workspace-gone never reclaims a live or recently-seen reservation.
 */
export const WORKSPACE_GONE_STALE_MS = 7 * DAY_MS;

// ── Paths ──

/** Default global ledger location. Overridable via an explicit path in tests. */
export function defaultLedgerPath(): string {
  return join(homedir(), ".config", "lace", "port-ledger.json");
}

/**
 * Resolve the ledger path, honoring the `LACE_PORT_LEDGER` env override so
 * tests (and unusual deployments) can relocate it without touching `$HOME`.
 */
export function resolveLedgerPath(): string {
  return process.env.LACE_PORT_LEDGER || defaultLedgerPath();
}

/** Lock path derived from a ledger path. */
export function lockPathFor(ledgerPath: string): string {
  return `${ledgerPath}.lock`;
}

// ── Cross-process lock ──

interface LockOwner {
  pid: number;
  host: string;
  at: number;
}

export interface LockOptions {
  /** Poll interval while waiting for a held lock (default 50ms). */
  retryIntervalMs?: number;
  /** Overall acquisition timeout before giving up (default 30s). */
  timeoutMs?: number;
  /**
   * SUBORDINATE stale heuristic used ONLY when the owner is on a different host
   * or its owner record is unreadable, never to preempt a live local pid
   * (default 5 minutes). A live-but-slow holder is never broken on this.
   */
  staleMtimeMs?: number;
  /** Liveness probe for the owner pid; overridable in tests. */
  isPidAlive?: (pid: number) => boolean;
  /** Clock, overridable in tests. */
  now?: () => number;
}

/** Default pid-liveness probe: `kill(pid, 0)` is alive unless ESRCH. */
function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true; // signalled successfully -> alive
  } catch (err) {
    // EPERM: exists but not ours (still alive). ESRCH: no such process (dead).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readOwner(ownerFile: string): LockOwner | null {
  try {
    const raw = JSON.parse(readFileSync(ownerFile, "utf-8")) as LockOwner;
    if (typeof raw?.pid === "number" && typeof raw?.host === "string") return raw;
  } catch {
    // missing or unreadable owner record
  }
  return null;
}

/**
 * Run `fn` while holding a cross-process lock over the ledger at `ledgerPath`.
 *
 * Acquisition is an atomic `mkdir` of `${ledgerPath}.lock`, the OS-level
 * arbiter. Stale detection is pid-liveness PRIMARY: a held lock is broken only
 * when its recorded owner pid (on this host) is dead. mtime is strictly
 * SUBORDINATE, consulted only when the owner is cross-host or its record is
 * unreadable, and NEVER preempts a live local pid. This matters because the
 * critical section is long (it spans `resolveTemplates` and its ~100ms TCP
 * probes), so a live holder legitimately holds the lock for a noticeable
 * interval; a fixed mtime timeout that preempted it would let a waiter steal
 * the lock mid-resolution and both processes would allocate against divergent
 * ledger state.
 *
 * The lock is always released (rmdir) when `fn` returns OR throws.
 */
export async function withLedgerLock<T>(
  ledgerPath: string,
  fn: () => Promise<T> | T,
  options: LockOptions = {},
): Promise<T> {
  const retryIntervalMs = options.retryIntervalMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const staleMtimeMs = options.staleMtimeMs ?? 5 * 60 * 1000;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const now = options.now ?? Date.now;

  const lockDir = lockPathFor(ledgerPath);
  const ownerFile = join(lockDir, "owner.json");
  const thisHost = hostname();
  const deadline = now() + timeoutMs;

  // Acquire.
  for (;;) {
    try {
      mkdirSync(lockDir); // atomic; throws EEXIST if already held
      writeFileSync(
        ownerFile,
        JSON.stringify({ pid: process.pid, host: thisHost, at: now() }),
        "utf-8",
      );
      break; // acquired
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (tryBreakStale(lockDir, ownerFile, thisHost, staleMtimeMs, isPidAlive, now)) {
        continue; // broke a stale lock; retry acquisition immediately
      }
      if (now() >= deadline) {
        throw new Error(
          `Timed out acquiring port-ledger lock at ${lockDir} (held by a live owner).`,
        );
      }
      await sleep(retryIntervalMs);
    }
  }

  // Critical section.
  try {
    return await fn();
  } finally {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // best-effort release
    }
  }
}

/**
 * Decide whether a currently-held lock is stale and, if so, remove it.
 * Returns true if it broke the lock (caller should retry acquisition).
 * Pid-liveness is primary; mtime is a subordinate fallback only when the owner
 * pid cannot be evaluated on this host.
 */
function tryBreakStale(
  lockDir: string,
  ownerFile: string,
  thisHost: string,
  staleMtimeMs: number,
  isPidAlive: (pid: number) => boolean,
  now: () => number,
): boolean {
  const owner = readOwner(ownerFile);

  if (owner && owner.host === thisHost) {
    // Primary: same host, so pid-liveness is authoritative.
    if (isPidAlive(owner.pid)) return false; // live holder: never preempt
    breakLock(lockDir);
    return true;
  }

  // Subordinate: owner record missing (possibly just-acquired) or cross-host.
  // Only mtime can speak here, and only past a generous threshold.
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockDir).mtimeMs;
  } catch {
    return false; // lock vanished; let the retry mkdir race decide
  }
  if (now() - mtimeMs > staleMtimeMs) {
    breakLock(lockDir);
    return true;
  }
  return false;
}

function breakLock(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Another waiter may have broken/re-acquired it; the atomic mkdir on retry
    // is the real arbiter, so a failed rm here is harmless.
  }
}

// ── Load / Save (atomic, corrupt-tolerant) ──

/**
 * Load the ledger from `path`. A missing file loads as empty silently; a
 * corrupt or structurally-invalid file loads as empty with a warning and is
 * overwritten on the next save.
 */
export function loadLedger(path: string): PortLedger {
  if (!existsSync(path)) return { entries: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    const entries = (raw as PortLedger)?.entries;
    if (!Array.isArray(entries)) {
      console.warn(
        `Port ledger at ${path} is malformed (no entries array); treating as empty.`,
      );
      return { entries: [] };
    }
    return { entries: entries.filter(isValidEntry) };
  } catch {
    console.warn(
      `Port ledger at ${path} is corrupt; treating as empty (will be overwritten).`,
    );
    return { entries: [] };
  }
}

function isValidEntry(e: unknown): e is LedgerEntry {
  const x = e as LedgerEntry;
  return (
    !!x &&
    typeof x.port === "number" &&
    typeof x.project === "string" &&
    typeof x.label === "string"
  );
}

/**
 * Persist the ledger atomically: write a sibling temp file then rename over the
 * target, so a crash mid-write never leaves a partially-written ledger.
 */
export function saveLedger(path: string, ledger: PortLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf-8");
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

// ── Pure reconciliation ──

/**
 * Reconcile the ledger against a machine-wide live-podman view. Pure: no I/O.
 *
 * Applies, per entry:
 * - Ownership rewrite (live podman wins): if a DIFFERENT project's live
 *   container publishes the entry's port, the entry is rewritten to that live
 *   owner. Occupancy and ownership are separate questions; live containers are
 *   authoritative for ownership.
 * - lastSeen refresh: any entry whose port has a live container of any
 *   run-state (running OR stopped, since `ps -a` reports stopped host ports) is
 *   refreshed to `now`, so a stopped-but-defined sibling never ages out.
 * - GC / reclaim: an entry is dropped when it has NO live container of any
 *   run-state referencing its port AND its `lastSeen` is older than the
 *   staleness threshold (shortened when its workspace folder is gone).
 *
 * A merely stopped container is NEVER reclaimed: it retains its `-p` binding and
 * appears in `ps -a`, so its port stays reserved for a stable restart.
 */
export function reconcileLedger(
  ledger: PortLedger,
  live: PublishedPort[],
  projectExists: (project: string) => boolean,
  now: Date,
): PortLedger {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  // port -> owning project of a live container (any run-state) that names it.
  const liveOwnerByPort = new Map<number, string>();
  const livePorts = new Set<number>();
  for (const p of live) {
    livePorts.add(p.port);
    if (p.localFolder && !liveOwnerByPort.has(p.port)) {
      liveOwnerByPort.set(p.port, p.localFolder);
    }
  }

  const out: LedgerEntry[] = [];
  for (const entry of ledger.entries) {
    const liveOwner = liveOwnerByPort.get(entry.port);
    const hasLive = livePorts.has(entry.port);

    // Ownership rewrite: a different live project publishing this port wins.
    let project = entry.project;
    if (liveOwner && liveOwner !== entry.project) {
      project = liveOwner;
    }

    if (hasLive) {
      // Stopped-or-running container references this port: keep and refresh.
      out.push({ ...entry, project, lastSeen: nowIso });
      continue;
    }

    // No live container references the port: reclaim only if aged out.
    const ageMs = nowMs - Date.parse(entry.lastSeen);
    const threshold = projectExists(project)
      ? DEFAULT_STALE_MS
      : WORKSPACE_GONE_STALE_MS;
    if (Number.isFinite(ageMs) && ageMs > threshold) {
      continue; // reclaimed
    }

    out.push({ ...entry, project });
  }

  return { entries: out };
}

/**
 * Every host port the current project must avoid, as a union of:
 * - ledger entries owned by ANOTHER project (reserved-but-maybe-unbound), and
 * - live podman ports published by any NON-current container (including
 *   non-lace containers, whose `localFolder` is null).
 *
 * Pure: no I/O. Excludes nothing the current project itself owns. Callers must
 * run {@link reconcileLedger} first so a stale current-project entry is
 * rewritten to its live owner before exclusions are computed.
 */
export function computeExclusions(
  ledger: PortLedger,
  live: PublishedPort[],
  currentProject: string,
): Set<number> {
  const exclusions = new Set<number>();
  for (const entry of ledger.entries) {
    if (entry.project !== currentProject) exclusions.add(entry.port);
  }
  for (const p of live) {
    if (p.localFolder !== currentProject) exclusions.add(p.port);
  }
  return exclusions;
}

/**
 * Human-readable holder/reason for each excluded port, for an actionable
 * exhaustion error. Live podman containers win the attribution (an actual
 * publisher) over a ledger reservation. Pure: no I/O.
 */
export function describeExclusions(
  ledger: PortLedger,
  live: PublishedPort[],
  currentProject: string,
): Map<number, string> {
  const holders = new Map<number, string>();
  for (const entry of ledger.entries) {
    if (entry.project !== currentProject) {
      holders.set(entry.port, `reserved by ${entry.project} (ledger)`);
    }
  }
  for (const p of live) {
    if (p.localFolder !== currentProject) {
      holders.set(
        p.port,
        p.localFolder
          ? `published by ${p.localFolder} (live container)`
          : `published by a non-lace container ${p.containerId.slice(0, 12)} (live)`,
      );
    }
  }
  return holders;
}

/**
 * Upsert the current project's freshly-resolved allocations into the ledger,
 * keyed by (project, label), refreshing `lastSeen`. Pure: returns a new ledger.
 */
export function upsertAssignments(
  ledger: PortLedger,
  project: string,
  allocations: Array<{ label: string; port: number; assignedAt: string }>,
  now: Date,
): PortLedger {
  const nowIso = now.toISOString();
  const byKey = new Map<string, LedgerEntry>();
  for (const e of ledger.entries) {
    byKey.set(`${e.project} ${e.label}`, { ...e });
  }
  for (const a of allocations) {
    const key = `${project} ${a.label}`;
    const prior = byKey.get(key);
    byKey.set(key, {
      port: a.port,
      project,
      label: a.label,
      assignedAt: prior?.assignedAt ?? a.assignedAt,
      lastSeen: nowIso,
    });
  }
  return { entries: Array.from(byKey.values()) };
}
