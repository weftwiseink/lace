// IMPLEMENTATION_VALIDATION
import { openSync, closeSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

/**
 * Execute a function while holding an exclusive flock on the given path.
 *
 * Uses the Unix flock(1) command with fd passing: opens the lock file,
 * passes the fd to flock(1) as stdio[3], which acquires LOCK_EX on
 * the shared file description. The lock persists in the parent process
 * until closeSync releases the fd.
 *
 * If another process holds the lock, throws immediately (non-blocking).
 * If flock(1) is unavailable, proceeds without locking (graceful degradation).
 */
export function withFlockSync<T>(lockPath: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const fd = openSync(lockPath, "w");

  try {
    // Acquire exclusive non-blocking flock via child process.
    // fd is passed as stdio[3] in the child — flock(1) locks it.
    // The lock persists on the shared file description after the child exits,
    // because our fd still references the same file description.
    const result = spawnSync("flock", ["-xn", "3"], {
      stdio: ["ignore", "ignore", "pipe", fd],
    });

    if (result.error) {
      // flock(1) not found — degrade gracefully, proceed without lock
      console.warn("Warning: flock not available, proceeding without lock.");
    } else if (result.status !== 0) {
      throw new Error("Another lace operation is already running.");
    }

    return fn();
  } finally {
    closeSync(fd);
  }
}
