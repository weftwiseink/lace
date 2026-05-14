// IMPLEMENTATION_VALIDATION
//
// Host portless lifecycle: probe, spawn-if-absent, reuse, register alias, teardown.
//
// The host portless is a long-running daemon that lace owns. Its purpose is
// to route `http://{branch}.{project}.localhost:1355/` requests on the host
// to the container portless proxy that fronts each project's dev servers.
//
// State is recorded in `~/.config/lace/portless-runtime.json` with the PID
// and bind port; reuse is gated on `kill -0 pid` succeeding. The probe is
// three-state: free / lace-owned-alive / foreign-bound.
//
// Bundled portless cli is resolved via the package's `bin.portless` entry,
// not its `exports` field (which permits only the library entry). We resolve
// the package entry first (to anchor on the installed package's directory)
// then load its `package.json` to read the bin path.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPortAvailable } from "./port-allocator";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";
import type { RunSubprocess } from "./subprocess";

/** Default port for the host portless. Unprivileged on every supported host. */
export const HOST_PORTLESS_PORT = 1355;

/** Persisted state for the host portless. */
export interface HostPortlessRuntime {
  pid: number;
  port: number;
  startedAt: string;
  portlessVersion?: string;
}

/** Probe verdicts. */
export type HostPortlessState =
  /** Nothing bound, no record. Spawn. */
  | { kind: "free" }
  /** A live lace-owned process is bound to the port. Reuse. */
  | { kind: "lace-owned-alive"; runtime: HostPortlessRuntime }
  /**
   * The port is bound but lace's runtime file is missing, stale, or contains a
   * PID whose process bound a different port. Warn; do NOT spawn or shellout.
   */
  | { kind: "foreign-bound"; reason: string }
  /** Lace owns the runtime file but the recorded PID is dead. Clean up + spawn. */
  | { kind: "stale-record"; staleRuntime: HostPortlessRuntime };

/** Dependency-injection seam for tests. */
export interface HostPortlessIO {
  /** Returns the path to the persisted runtime file. */
  runtimeFilePath: () => string;
  /** Resolves the bundled portless CLI path. */
  resolvePortlessCli: () => string;
  /** Resolves the bundled portless version (best effort). */
  resolvePortlessVersion: () => string | undefined;
  /** Wraps `process.kill(pid, 0)` for cross-platform liveness probe. */
  isProcessAlive: (pid: number) => boolean;
  /** Wraps `isPortAvailable` for testability. */
  isPortAvailable: (port: number, timeout?: number) => Promise<boolean>;
  /** Returns the current process's node binary path. */
  nodeBinary: () => string;
  /**
   * Spawns the CLI detached. Returns the PID of the spawned child. Tests stub
   * this. The default implementation `spawn`s with `detached: true`, stdio
   * ignored, and `unref()`s the child. Note that the spawned child is
   * portless's launcher process; the long-lived daemon PID is captured
   * separately via `readPortlessPidFile` after the launcher daemonizes.
   */
  spawnDetached: (cmd: string, args: string[]) => number;
  /**
   * Read the daemon PID portless writes to `~/.portless/proxy.pid` after it
   * forks the daemon. Returns null when the file is absent. Tests stub this.
   */
  readPortlessPidFile: () => number | null;
  /**
   * Shells out `portless alias <name> <port>` against the host portless on
   * `HOST_PORTLESS_PORT`. Tests stub this; the default runs the CLI synchronously
   * via the standard subprocess runner.
   */
  runSubprocess: RunSubprocess;
  /** Returns the current timestamp as ISO 8601. Stubbed in tests. */
  now: () => string;
}

/**
 * Default IO bindings. Each callsite can override these by passing partial overrides.
 */
export function defaultHostPortlessIO(): HostPortlessIO {
  return {
    runtimeFilePath: defaultRuntimeFilePath,
    resolvePortlessCli: defaultResolvePortlessCli,
    resolvePortlessVersion: defaultResolvePortlessVersion,
    isProcessAlive,
    isPortAvailable,
    nodeBinary: () => process.execPath,
    spawnDetached: defaultSpawnDetached,
    readPortlessPidFile: defaultReadPortlessPidFile,
    runSubprocess: defaultRunSubprocess,
    now: () => new Date().toISOString(),
  };
}

export function defaultRuntimeFilePath(): string {
  return join(homedir(), ".config", "lace", "portless-runtime.json");
}

/**
 * The portless CLI stores its own runtime metadata (pid + bound port) at
 * `~/.portless/proxy.pid` (and `proxy.port`). Lace reads the pid file so the
 * recorded PID is the actual daemon's PID, not the launcher's (which forks
 * and exits).
 */
export function defaultPortlessPidFilePath(): string {
  return join(homedir(), ".portless", "proxy.pid");
}

export function defaultReadPortlessPidFile(): number | null {
  const path = defaultPortlessPidFilePath();
  if (!existsSync(path)) return null;
  try {
    const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

/**
 * Resolve the bundled portless CLI absolute path.
 *
 * Uses `import.meta.resolve(...)` to honor the consumer's package resolution
 * order (pnpm hoisted vs. workspace-local). The package's `exports` field
 * defines only `.` (for the library), so we anchor on that, then walk to the
 * `package.json` and resolve `bin.portless` relative to the package root.
 */
export function defaultResolvePortlessCli(): string {
  // import.meta.resolve is sync in Node 20.6+ and 22+. Vite-built ESM output
  // preserves import.meta semantics.
  // The first arg must be the package specifier, not a subpath.
  const entryUrl = (import.meta as { resolve(spec: string): string }).resolve(
    "portless",
  );
  const entryPath = fileURLToPath(entryUrl);
  let dir = dirname(entryPath);
  while (dir !== "/" && !existsSync(join(dir, "package.json"))) {
    dir = dirname(dir);
  }
  const pkgJson = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJson, "utf-8")) as {
    bin?: { portless?: string } | string;
  };
  const binEntry =
    typeof pkg.bin === "string"
      ? pkg.bin
      : typeof pkg.bin?.portless === "string"
        ? pkg.bin.portless
        : undefined;
  if (!binEntry) {
    throw new Error(
      `portless package.json at ${pkgJson} has no usable bin entry`,
    );
  }
  return resolve(dir, binEntry);
}

export function defaultResolvePortlessVersion(): string | undefined {
  try {
    const entryUrl = (
      import.meta as { resolve(spec: string): string }
    ).resolve("portless");
    const entryPath = fileURLToPath(entryUrl);
    let dir = dirname(entryPath);
    while (dir !== "/" && !existsSync(join(dir, "package.json"))) {
      dir = dirname(dir);
    }
    const pkg = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultSpawnDetached(cmd: string, args: string[]): number {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORTLESS_WILDCARD: "1" },
  });
  child.unref();
  if (!child.pid) {
    throw new Error(`Failed to spawn host portless: ${cmd} ${args.join(" ")}`);
  }
  return child.pid;
}

/** Read and return the persisted runtime, or null if missing/unreadable. */
export function readRuntime(io: HostPortlessIO): HostPortlessRuntime | null {
  const path = io.runtimeFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HostPortlessRuntime>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.port === "number" &&
      typeof parsed.startedAt === "string"
    ) {
      return parsed as HostPortlessRuntime;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRuntime(
  io: HostPortlessIO,
  runtime: HostPortlessRuntime,
): void {
  const path = io.runtimeFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(runtime, null, 2) + "\n", "utf-8");
}

export function removeRuntime(io: HostPortlessIO): boolean {
  const path = io.runtimeFilePath();
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/**
 * Probe the current host-portless state. Returns one of four verdicts. This
 * function is pure observation; it does not spawn, kill, or write files.
 */
export async function probeHostPortless(
  io: HostPortlessIO = defaultHostPortlessIO(),
): Promise<HostPortlessState> {
  const runtime = readRuntime(io);
  const portFree = await io.isPortAvailable(HOST_PORTLESS_PORT);

  if (!runtime) {
    if (portFree) return { kind: "free" };
    return {
      kind: "foreign-bound",
      reason: `port ${HOST_PORTLESS_PORT} is bound but no lace runtime file is present`,
    };
  }

  // Have a runtime record. Is the PID alive?
  const alive = io.isProcessAlive(runtime.pid);
  if (!alive) {
    return { kind: "stale-record", staleRuntime: runtime };
  }

  // PID is alive. Is the port still bound (presumably by that PID)?
  if (portFree) {
    return {
      kind: "foreign-bound",
      reason: `recorded PID ${runtime.pid} is alive but port ${HOST_PORTLESS_PORT} is no longer bound; assuming the daemon died`,
    };
  }

  // The recorded port must match HOST_PORTLESS_PORT for the daemon to be
  // useful. If a future runtime is recorded on a different port, treat that
  // as foreign-bound (we cannot route through it).
  if (runtime.port !== HOST_PORTLESS_PORT) {
    return {
      kind: "foreign-bound",
      reason: `recorded PID ${runtime.pid} bound port ${runtime.port}, but lace expects ${HOST_PORTLESS_PORT}`,
    };
  }

  return { kind: "lace-owned-alive", runtime };
}

export interface EnsureResult {
  /** What state was the probe in before action? */
  state: HostPortlessState;
  /** Did we end up with a usable host portless? */
  ready: boolean;
  /** The runtime record after the call, if `ready` is true. */
  runtime?: HostPortlessRuntime;
  /** Human-readable lines for the caller to surface. */
  messages: string[];
}

/**
 * Ensure the host portless is running. Spawns when free or stale-record;
 * reuses on lace-owned-alive; warns and bails on foreign-bound.
 *
 * Returns a record describing what happened. Callers decide whether to
 * proceed with alias registration based on `ready`.
 */
export async function ensureHostPortless(
  io: HostPortlessIO = defaultHostPortlessIO(),
): Promise<EnsureResult> {
  const state = await probeHostPortless(io);
  const messages: string[] = [];

  switch (state.kind) {
    case "lace-owned-alive":
      messages.push(
        `info: reusing host portless on :${HOST_PORTLESS_PORT} (pid ${state.runtime.pid}).`,
      );
      return { state, ready: true, runtime: state.runtime, messages };

    case "foreign-bound":
      messages.push(
        `warn: host portless not started: ${state.reason}.`,
      );
      messages.push(
        `warn: free port ${HOST_PORTLESS_PORT} (lsof -iTCP:${HOST_PORTLESS_PORT}) then re-run lace up, or run 'lace doctor --reset' if you believe lace is the offender.`,
      );
      return { state, ready: false, messages };

    case "stale-record":
      messages.push(
        `info: removing stale host portless runtime record (pid ${state.staleRuntime.pid} not running).`,
      );
      removeRuntime(io);
    // fallthrough to free-like spawn semantics
    // eslint-disable-next-line no-fallthrough
    case "free": {
      const cli = io.resolvePortlessCli();
      const args = [
        cli,
        "proxy",
        "start",
        "--port",
        String(HOST_PORTLESS_PORT),
        "--no-tls",
        "--wildcard",
      ];
      const launcherPid = io.spawnDetached(io.nodeBinary(), args);

      // portless's `proxy start` launcher forks the actual daemon and exits,
      // so the launcherPid will not be alive on subsequent runs. Read
      // portless's own pid file to capture the long-lived daemon PID. The
      // launcher writes proxy.pid late in startup, after the port is bound,
      // so we poll briefly.
      const daemonPid = await waitForPortlessPidFile(io, 5000);
      const recordedPid = daemonPid ?? launcherPid;

      const runtime: HostPortlessRuntime = {
        pid: recordedPid,
        port: HOST_PORTLESS_PORT,
        startedAt: io.now(),
        portlessVersion: io.resolvePortlessVersion(),
      };
      writeRuntime(io, runtime);

      if (daemonPid === null) {
        messages.push(
          `warn: spawned host portless (launcher pid ${launcherPid}), but the daemon pid file did not appear within 5s. Recording launcher pid as a fallback; subsequent probes may misclassify the daemon.`,
        );
      } else {
        messages.push(
          `info: spawned host portless on :${HOST_PORTLESS_PORT} (pid ${daemonPid}, portless ${runtime.portlessVersion ?? "?"}).`,
        );
      }
      return { state, ready: true, runtime, messages };
    }
  }
}

async function waitForPortlessPidFile(
  io: HostPortlessIO,
  timeoutMs: number,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = io.readPortlessPidFile();
    if (pid !== null && io.isProcessAlive(pid)) return pid;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export interface AliasResult {
  ok: boolean;
  /** Combined stdout/stderr from the CLI. */
  output: string;
  /** Captured exit code. */
  exitCode: number;
  /** The fully-formed command for log/debug. */
  command: string;
}

/**
 * Register a static alias on the host portless via `portless alias <name> <port>`.
 *
 * The CLI is idempotent on existing aliases when invoked with `--force`; we
 * pass `--force` so re-running `lace up` updates the target port without
 * surfacing a benign error.
 */
export function registerHostPortlessAlias(
  io: HostPortlessIO,
  projectName: string,
  hostPort: number,
): AliasResult {
  const cli = io.resolvePortlessCli();
  const args = [
    cli,
    "alias",
    projectName,
    String(hostPort),
    "--force",
  ];
  const result = io.runSubprocess(io.nodeBinary(), args);
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout}\n${result.stderr}`.trim(),
    exitCode: result.exitCode,
    command: `${io.nodeBinary()} ${args.join(" ")}`,
  };
}

export interface TeardownResult {
  /** Was a runtime record present at call time? */
  hadRuntime: boolean;
  /** Was the PID sent SIGTERM? false if record was stale. */
  killed: boolean;
  /** PID that was targeted (or recorded). */
  pid?: number;
  /** Was the runtime file removed? (true unless it was never there) */
  removedFile: boolean;
  /** Human-readable lines for the caller. */
  messages: string[];
}

/**
 * Tear down the host portless: SIGTERM the recorded PID (if alive) and
 * remove the runtime file. No-op when nothing is recorded.
 *
 * Best-effort: a missing file, dead PID, or kill EPERM is reported but not
 * thrown.
 */
export function teardownHostPortless(
  io: HostPortlessIO = defaultHostPortlessIO(),
  signal: NodeJS.Signals = "SIGTERM",
): TeardownResult {
  const runtime = readRuntime(io);
  const messages: string[] = [];

  if (!runtime) {
    messages.push("info: no host portless runtime recorded; nothing to reset.");
    return {
      hadRuntime: false,
      killed: false,
      removedFile: false,
      messages,
    };
  }

  let killed = false;
  if (io.isProcessAlive(runtime.pid)) {
    try {
      process.kill(runtime.pid, signal);
      killed = true;
      messages.push(
        `info: sent ${signal} to host portless pid ${runtime.pid}.`,
      );
    } catch (err) {
      messages.push(
        `warn: failed to signal pid ${runtime.pid}: ${(err as Error).message}.`,
      );
    }
  } else {
    messages.push(
      `info: recorded pid ${runtime.pid} not running; removing stale record.`,
    );
  }

  const removedFile = removeRuntime(io);
  if (removedFile) {
    messages.push(
      `info: removed runtime state file ${io.runtimeFilePath()}.`,
    );
  }

  return {
    hadRuntime: true,
    killed,
    pid: runtime.pid,
    removedFile,
    messages,
  };
}
