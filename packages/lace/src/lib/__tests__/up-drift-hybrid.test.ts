// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  probeContainerRunning,
  teardownStaleContainer,
} from "@/lib/up";
import type { RunSubprocess, SubprocessResult } from "@/lib/subprocess";
import { getPodmanCommand, resetPodmanCommandCache } from "@/lib/container-runtime";

let settingsDir: string;

beforeEach(() => {
  settingsDir = join(
    tmpdir(),
    `lace-test-hybrid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, "settings.json"), "{}", "utf-8");
  process.env.LACE_SETTINGS = join(settingsDir, "settings.json");
  resetPodmanCommandCache();
});

afterEach(() => {
  resetPodmanCommandCache();
  rmSync(settingsDir, { recursive: true, force: true });
  delete process.env.LACE_SETTINGS;
});

/** Build a subprocess stub that records calls and returns a scripted result. */
function stub(
  handler: (command: string, args: string[]) => SubprocessResult,
): { fn: RunSubprocess; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const fn: RunSubprocess = (command, args) => {
    calls.push({ command, args });
    return handler(command, args);
  };
  return { fn, calls };
}

const ok = (stdout: string): SubprocessResult => ({ exitCode: 0, stdout, stderr: "" });
const err = (): SubprocessResult => ({ exitCode: 1, stdout: "", stderr: "boom" });

describe("probeContainerRunning", () => {
  it("returns 'running' when the name-scoped, status-scoped ps returns an id", () => {
    const { fn, calls } = stub(() => ok("abc123\n"));
    expect(probeContainerRunning("whelm", fn)).toBe("running");
    // Probe is both name-scoped and status-scoped so it cannot false-positive.
    const args = calls[0].args;
    expect(args).toContain("ps");
    expect(args).toContain("name=^whelm$");
    expect(args).toContain("status=running");
  });

  it("returns 'not-running' when ps exits 0 with empty output", () => {
    const { fn } = stub(() => ok("  \n"));
    expect(probeContainerRunning("whelm", fn)).toBe("not-running");
  });

  it("returns 'unknown' when podman exits non-zero (fail safe)", () => {
    const { fn } = stub(() => err());
    expect(probeContainerRunning("whelm", fn)).toBe("unknown");
  });

  it("returns 'unknown' when the subprocess throws", () => {
    const fn: RunSubprocess = () => {
      throw new Error("podman missing");
    };
    expect(probeContainerRunning("whelm", fn)).toBe("unknown");
  });
});

describe("teardownStaleContainer (label-guarded)", () => {
  it("removes a container that matches the name AND the lace.project_name label", () => {
    const { fn, calls } = stub((command, args) => {
      if (args[0] === "ps") return ok("deadbeef\n");
      return ok(""); // rm
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      teardownStaleContainer("whelm", "whelm", fn);
    } finally {
      warnSpy.mockRestore();
    }

    // The ps probe carries BOTH the exact-name filter and the label guard.
    const ps = calls.find((c) => c.args[0] === "ps");
    expect(ps).toBeDefined();
    expect(ps!.args).toContain("name=^whelm$");
    expect(ps!.args).toContain("label=lace.project_name=whelm");

    // A matching container is force-removed.
    const rm = calls.find((c) => c.args[0] === "rm");
    expect(rm).toBeDefined();
    expect(rm!.args).toEqual(["rm", "-f", "deadbeef"]);
  });

  it("does NOT remove a same-named container that lacks the lace.project_name label", () => {
    // Emulate podman: the name+label filter returns nothing because the
    // same-named container was not created by lace (no matching label).
    const { fn, calls } = stub((command, args) => {
      if (args[0] === "ps") return ok(""); // no lace-labeled match
      return ok("");
    });
    teardownStaleContainer("whelm", "whelm", fn);

    // Crucially, no rm was issued: an unrelated same-named container survives.
    expect(calls.some((c) => c.args[0] === "rm")).toBe(false);
  });

  it("tolerates a ps probe failure without attempting rm", () => {
    const { fn, calls } = stub((command, args) => {
      if (args[0] === "ps") return err();
      return ok("");
    });
    expect(() => teardownStaleContainer("whelm", "whelm", fn)).not.toThrow();
    expect(calls.some((c) => c.args[0] === "rm")).toBe(false);
  });

  it("warns only when a teardown actually removes something", () => {
    // No match: no warning.
    const noMatch = stub((command, args) => ok(args[0] === "ps" ? "" : ""));
    const warnNoMatch = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      teardownStaleContainer("whelm", "whelm", noMatch.fn);
      expect(warnNoMatch).not.toHaveBeenCalled();
    } finally {
      warnNoMatch.mockRestore();
    }

    // Match: warns.
    const match = stub((command, args) => ok(args[0] === "ps" ? "deadbeef\n" : ""));
    const warnMatch = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      teardownStaleContainer("whelm", "whelm", match.fn);
      expect(warnMatch).toHaveBeenCalledTimes(1);
    } finally {
      warnMatch.mockRestore();
    }
  });

  it("uses the resolved runtime command for both ps and rm", () => {
    const podman = getPodmanCommand();
    const { fn, calls } = stub((command, args) => ok(args[0] === "ps" ? "id1\n" : ""));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      teardownStaleContainer("proj", "proj", fn);
    } finally {
      warnSpy.mockRestore();
    }
    for (const call of calls) {
      expect(call.command).toBe(podman);
    }
  });
});
