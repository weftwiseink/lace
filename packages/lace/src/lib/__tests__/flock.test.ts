// IMPLEMENTATION_VALIDATION
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withFlockSync } from "@/lib/flock";

let testDir: string;

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("withFlockSync", () => {
  it("executes the function and returns its result", () => {
    testDir = join(tmpdir(), `lace-flock-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const lockPath = join(testDir, "test.lock");

    const result = withFlockSync(lockPath, () => 42);
    expect(result).toBe(42);
  });

  it("creates the lock file", () => {
    testDir = join(tmpdir(), `lace-flock-test-${Date.now()}`);
    const lockPath = join(testDir, "nested", "test.lock");

    withFlockSync(lockPath, () => {});
    expect(existsSync(lockPath)).toBe(true);
  });

  it("propagates errors from the wrapped function", () => {
    testDir = join(tmpdir(), `lace-flock-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const lockPath = join(testDir, "test.lock");

    expect(() =>
      withFlockSync(lockPath, () => {
        throw new Error("test error");
      }),
    ).toThrow("test error");
  });

  it("releases the lock after completion (can reacquire)", () => {
    testDir = join(tmpdir(), `lace-flock-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const lockPath = join(testDir, "test.lock");

    // First acquisition
    withFlockSync(lockPath, () => {});

    // Second acquisition should succeed (lock was released)
    const result = withFlockSync(lockPath, () => "ok");
    expect(result).toBe("ok");
  });
});
