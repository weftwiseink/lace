// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LOCK_FILE_NAME = "devcontainer-lock.json";
const NAMESPACE = "lace.prebuiltFeatures";

export interface LockFileData {
  features?: Record<string, unknown>;
  [NAMESPACE]?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Read a devcontainer-lock.json file. Returns empty structure if absent.
 */
export function readLockFile(filePath: string): LockFileData {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as LockFileData;
  } catch {
    return {};
  }
}

/**
 * Write a devcontainer-lock.json with consistent formatting.
 */
export function writeLockFile(filePath: string, data: LockFileData): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Merge prebuild lock entries into the project lock file under lace.prebuiltFeatures.
 * Reads the prebuild-generated lock file from the prebuild directory,
 * then writes namespaced entries into the project lock file.
 */
export function mergeLockFile(
  projectLockPath: string,
  prebuildDir: string,
): void {
  const prebuildLockPath = join(prebuildDir, LOCK_FILE_NAME);
  if (!existsSync(prebuildLockPath)) return;

  const prebuildLock = readLockFile(prebuildLockPath);
  const projectLock = readLockFile(projectLockPath);

  // Place prebuild feature entries under the namespace
  if (prebuildLock.features) {
    projectLock[NAMESPACE] = prebuildLock.features;
  }

  writeLockFile(projectLockPath, projectLock);
}

/**
 * Extract lace.prebuiltFeatures entries from a project lock file.
 * Returns them as top-level feature entries (for use in temp context).
 */
export function extractPrebuiltEntries(
  projectLockPath: string,
): Record<string, unknown> {
  const lock = readLockFile(projectLockPath);
  return (lock[NAMESPACE] ?? {}) as Record<string, unknown>;
}
