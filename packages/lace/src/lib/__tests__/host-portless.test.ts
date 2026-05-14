// IMPLEMENTATION_VALIDATION
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HOST_PORTLESS_PORT,
  probeHostPortless,
  ensureHostPortless,
  registerHostPortlessAlias,
  teardownHostPortless,
  readRuntime,
  writeRuntime,
  type HostPortlessIO,
  type HostPortlessRuntime,
} from "@/lib/host-portless";
import type { SubprocessResult } from "@/lib/subprocess";

function makeIO(overrides: Partial<HostPortlessIO> = {}): {
  io: HostPortlessIO;
  state: {
    runtimeDir: string;
    runtimePath: string;
    aliveSet: Set<number>;
    portFreeMap: Map<number, boolean>;
    spawnCalls: Array<{ cmd: string; args: string[]; pid: number }>;
    subprocessCalls: Array<{ cmd: string; args: string[] }>;
    subprocessResult: SubprocessResult;
  };
} {
  const runtimeDir = mkdtempSync(join(tmpdir(), "lace-host-portless-test-"));
  const runtimePath = join(runtimeDir, "portless-runtime.json");
  const aliveSet = new Set<number>();
  const portFreeMap = new Map<number, boolean>();
  const spawnCalls: Array<{ cmd: string; args: string[]; pid: number }> = [];
  const subprocessCalls: Array<{ cmd: string; args: string[] }> = [];
  let pidCounter = 10000;
  let daemonPidFile: number | null = null;

  const state = {
    runtimeDir,
    runtimePath,
    aliveSet,
    portFreeMap,
    spawnCalls,
    subprocessCalls,
    subprocessResult: { exitCode: 0, stdout: "ok", stderr: "" } as SubprocessResult,
    setDaemonPidFile: (pid: number | null) => {
      daemonPidFile = pid;
    },
  };

  const io: HostPortlessIO = {
    runtimeFilePath: () => runtimePath,
    resolvePortlessCli: () => "/fake/portless/cli.js",
    resolvePortlessVersion: () => "0.13.0",
    isProcessAlive: (pid) => aliveSet.has(pid),
    isPortAvailable: async (port) => portFreeMap.get(port) ?? true,
    nodeBinary: () => "/fake/node",
    spawnDetached: (cmd, args) => {
      const pid = ++pidCounter;
      spawnCalls.push({ cmd, args, pid });
      aliveSet.add(pid);
      // simulate the daemon binding the port and writing its pid file
      portFreeMap.set(HOST_PORTLESS_PORT, false);
      // Simulate the portless launcher forking a child daemon. The launcher
      // (pid) exits; the daemon (pid+1) bound to the port writes the pid file.
      const daemonPid = ++pidCounter;
      aliveSet.add(daemonPid);
      aliveSet.delete(pid); // launcher exited
      daemonPidFile = daemonPid;
      return pid;
    },
    readPortlessPidFile: () => daemonPidFile,
    runSubprocess: (cmd, args) => {
      subprocessCalls.push({ cmd, args });
      return state.subprocessResult;
    },
    now: () => "2026-05-14T12:00:00.000Z",
    ...overrides,
  };

  return { io, state };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeHostPortless", () => {
  it("returns 'free' when port :1355 is available and no runtime file exists", async () => {
    const { io, state } = makeIO();
    state.portFreeMap.set(HOST_PORTLESS_PORT, true);

    const probe = await probeHostPortless(io);
    expect(probe.kind).toBe("free");

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("returns 'foreign-bound' when port is bound but no runtime file is present", async () => {
    const { io, state } = makeIO();
    state.portFreeMap.set(HOST_PORTLESS_PORT, false);

    const probe = await probeHostPortless(io);
    expect(probe.kind).toBe("foreign-bound");
    if (probe.kind === "foreign-bound") {
      expect(probe.reason).toMatch(/no lace runtime/);
    }

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("returns 'lace-owned-alive' when the recorded PID is alive and the port is bound", async () => {
    const { io, state } = makeIO();
    const runtime: HostPortlessRuntime = {
      pid: 42,
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
    };
    writeRuntime(io, runtime);
    state.aliveSet.add(42);
    state.portFreeMap.set(HOST_PORTLESS_PORT, false);

    const probe = await probeHostPortless(io);
    expect(probe.kind).toBe("lace-owned-alive");
    if (probe.kind === "lace-owned-alive") {
      expect(probe.runtime.pid).toBe(42);
    }

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("returns 'stale-record' when the recorded PID is not alive", async () => {
    const { io, state } = makeIO();
    const runtime: HostPortlessRuntime = {
      pid: 42,
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
    };
    writeRuntime(io, runtime);
    // 42 is NOT added to aliveSet
    state.portFreeMap.set(HOST_PORTLESS_PORT, true);

    const probe = await probeHostPortless(io);
    expect(probe.kind).toBe("stale-record");

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("returns 'foreign-bound' when the recorded port differs from HOST_PORTLESS_PORT", async () => {
    const { io, state } = makeIO();
    writeRuntime(io, {
      pid: 42,
      port: 9999,
      startedAt: "2026-05-14T10:00:00.000Z",
    });
    state.aliveSet.add(42);
    state.portFreeMap.set(HOST_PORTLESS_PORT, false);

    const probe = await probeHostPortless(io);
    expect(probe.kind).toBe("foreign-bound");

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });
});

describe("ensureHostPortless", () => {
  it("spawns the daemon when the port is free", async () => {
    const { io, state } = makeIO();
    state.portFreeMap.set(HOST_PORTLESS_PORT, true);

    const result = await ensureHostPortless(io);
    expect(result.ready).toBe(true);
    expect(state.spawnCalls).toHaveLength(1);
    expect(state.spawnCalls[0].args).toEqual(
      expect.arrayContaining([
        "/fake/portless/cli.js",
        "proxy",
        "start",
        "--port",
        "1355",
        "--no-tls",
        "--wildcard",
      ]),
    );
    expect(state.spawnCalls[0].cmd).toBe("/fake/node");

    // Runtime file is written. The recorded PID should be the daemon's
    // (one more than the launcher), not the launcher's.
    expect(existsSync(state.runtimePath)).toBe(true);
    const persisted = JSON.parse(readFileSync(state.runtimePath, "utf-8"));
    expect(persisted.port).toBe(HOST_PORTLESS_PORT);
    expect(persisted.pid).toBe(state.spawnCalls[0].pid + 1);

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("reuses an existing daemon when probe returns lace-owned-alive", async () => {
    const { io, state } = makeIO();
    const runtime: HostPortlessRuntime = {
      pid: 4242,
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
    };
    writeRuntime(io, runtime);
    state.aliveSet.add(4242);
    state.portFreeMap.set(HOST_PORTLESS_PORT, false);

    const result = await ensureHostPortless(io);
    expect(result.ready).toBe(true);
    expect(result.runtime?.pid).toBe(4242);
    expect(state.spawnCalls).toHaveLength(0);
    expect(result.messages.some((m) => m.includes("reusing"))).toBe(true);

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("does NOT spawn or shellout on foreign-bound", async () => {
    const { io, state } = makeIO();
    state.portFreeMap.set(HOST_PORTLESS_PORT, false);

    const result = await ensureHostPortless(io);
    expect(result.ready).toBe(false);
    expect(state.spawnCalls).toHaveLength(0);
    expect(result.messages.some((m) => m.startsWith("warn:"))).toBe(true);

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("replaces a stale record by removing it then spawning", async () => {
    const { io, state } = makeIO();
    writeRuntime(io, {
      pid: 42, // not alive
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
    });
    state.portFreeMap.set(HOST_PORTLESS_PORT, true);

    const result = await ensureHostPortless(io);
    expect(result.ready).toBe(true);
    expect(state.spawnCalls).toHaveLength(1);
    expect(result.messages.some((m) => m.includes("stale"))).toBe(true);

    // New runtime file written with the new daemon pid (launcher pid + 1).
    const persisted = JSON.parse(readFileSync(state.runtimePath, "utf-8"));
    expect(persisted.pid).toBe(state.spawnCalls[0].pid + 1);
    expect(persisted.pid).not.toBe(42);

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });
});

describe("registerHostPortlessAlias", () => {
  it("shells out `portless alias <name> <port> --force` with the node binary", () => {
    const { io, state } = makeIO();
    const result = registerHostPortlessAlias(io, "weftwise", 22435);
    expect(result.ok).toBe(true);
    expect(state.subprocessCalls).toHaveLength(1);
    expect(state.subprocessCalls[0].cmd).toBe("/fake/node");
    expect(state.subprocessCalls[0].args).toEqual([
      "/fake/portless/cli.js",
      "alias",
      "weftwise",
      "22435",
      "--force",
    ]);

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("reports !ok when the alias CLI exits non-zero", () => {
    const { io, state } = makeIO();
    state.subprocessResult = { exitCode: 2, stdout: "", stderr: "boom" };
    const result = registerHostPortlessAlias(io, "weftwise", 22435);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("boom");

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });
});

describe("teardownHostPortless", () => {
  it("no-op when no runtime file exists", () => {
    const { io, state } = makeIO();
    const result = teardownHostPortless(io);
    expect(result.hadRuntime).toBe(false);
    expect(result.killed).toBe(false);
    expect(result.removedFile).toBe(false);
    expect(result.messages[0]).toContain("nothing to reset");

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("removes runtime file and reports it when pid is stale", () => {
    const { io, state } = makeIO();
    writeRuntime(io, {
      pid: 42,
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
    });
    // 42 is not in aliveSet -> isProcessAlive returns false

    const result = teardownHostPortless(io);
    expect(result.hadRuntime).toBe(true);
    expect(result.killed).toBe(false);
    expect(result.removedFile).toBe(true);
    expect(existsSync(state.runtimePath)).toBe(false);

    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("sends SIGTERM to a live pid and removes the runtime file", () => {
    const { io, state } = makeIO();
    writeRuntime(io, {
      pid: 4242,
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
    });
    state.aliveSet.add(4242);

    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      // emulate signal-zero probe (already mocked via isProcessAlive)
      // SIGTERM: just record. Return true to match node typing.
      if (sig === 0) return true as unknown as true;
      return true as unknown as true;
    });

    const result = teardownHostPortless(io);
    expect(result.hadRuntime).toBe(true);
    expect(result.killed).toBe(true);
    expect(result.pid).toBe(4242);
    expect(result.removedFile).toBe(true);
    // The default signal is SIGTERM
    expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");

    killSpy.mockRestore();
    rmSync(state.runtimeDir, { recursive: true, force: true });
  });
});

describe("readRuntime / writeRuntime", () => {
  it("round-trips a runtime record", () => {
    const { io, state } = makeIO();
    const runtime: HostPortlessRuntime = {
      pid: 1234,
      port: HOST_PORTLESS_PORT,
      startedAt: "2026-05-14T10:00:00.000Z",
      portlessVersion: "0.13.0",
    };
    writeRuntime(io, runtime);
    const read = readRuntime(io);
    expect(read).toEqual(runtime);
    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("returns null for invalid JSON", () => {
    const { io, state } = makeIO();
    mkdirSync(state.runtimeDir, { recursive: true });
    writeFileSync(state.runtimePath, "not-json", "utf-8");
    expect(readRuntime(io)).toBeNull();
    rmSync(state.runtimeDir, { recursive: true, force: true });
  });

  it("returns null for missing file", () => {
    const { io, state } = makeIO();
    expect(readRuntime(io)).toBeNull();
    rmSync(state.runtimeDir, { recursive: true, force: true });
  });
});
