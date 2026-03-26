// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getPodmanCommand, resetPodmanCommandCache } from "@/lib/container-runtime";

let settingsDir: string;
let settingsFile: string;

beforeEach(() => {
  resetPodmanCommandCache();
  settingsDir = join(
    tmpdir(),
    `lace-test-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ".config",
    "lace",
  );
  settingsFile = join(settingsDir, "settings.json");
  mkdirSync(settingsDir, { recursive: true });
  process.env.LACE_SETTINGS = settingsFile;
});

afterEach(() => {
  resetPodmanCommandCache();
  delete process.env.LACE_SETTINGS;
  try {
    rmSync(join(settingsDir, "..", ".."), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("getPodmanCommand", () => {
  it("returns 'podman' with no settings file", () => {
    delete process.env.LACE_SETTINGS;
    expect(getPodmanCommand()).toBe("podman");
  });

  it("returns 'podman' when settings file has no override", () => {
    writeFileSync(settingsFile, JSON.stringify({}), "utf-8");
    expect(getPodmanCommand()).toBe("podman");
  });

  it("returns override value when overridePodmanCommand is set", () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "/usr/bin/podman" }),
      "utf-8",
    );
    expect(getPodmanCommand()).toBe("/usr/bin/podman");
  });

  it("prints warning when override does not contain 'podman'", () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "docker" }),
      "utf-8",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = getPodmanCommand();
    expect(result).toBe("docker");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("does not contain");
    warnSpy.mockRestore();
  });

  it("does not warn when override contains 'podman'", () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "/opt/podman" }),
      "utf-8",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getPodmanCommand();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("caches the result after first call", () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "/first/podman" }),
      "utf-8",
    );
    expect(getPodmanCommand()).toBe("/first/podman");

    // Change the settings file; cached value should persist
    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "/second/podman" }),
      "utf-8",
    );
    expect(getPodmanCommand()).toBe("/first/podman");
  });

  it("resetPodmanCommandCache clears the cache", () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "/first/podman" }),
      "utf-8",
    );
    expect(getPodmanCommand()).toBe("/first/podman");

    resetPodmanCommandCache();

    writeFileSync(
      settingsFile,
      JSON.stringify({ overridePodmanCommand: "/second/podman" }),
      "utf-8",
    );
    expect(getPodmanCommand()).toBe("/second/podman");
  });
});
