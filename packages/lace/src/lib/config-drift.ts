// IMPLEMENTATION_VALIDATION
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Runtime-affecting config properties that require container recreation
 * when changed. Excluded properties:
 * - postStartCommand, postAttachCommand: run on every container start,
 *   no recreation needed.
 * - forwardPorts, appPort: managed by the port allocator, which has its
 *   own persistence. Including them causes false-positive drift warnings
 *   because the allocator reassigns ports when the container's own port
 *   is "in use" during config regeneration.
 */
const RUNTIME_KEYS = [
  "containerEnv",
  "mounts",
  "workspaceMount",
  "workspaceFolder",
  "runArgs",
  "remoteUser",
  "postCreateCommand",
] as const;

const FINGERPRINT_FILE = "runtime-fingerprint";

/** Deterministic JSON serialization with sorted keys at every depth. */
export function sortedStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

/**
 * Compute a SHA-256 fingerprint of the runtime-affecting properties in a
 * devcontainer config. Only properties that require container recreation
 * are included; changes to other properties (features, build, etc.) do
 * not trigger drift warnings.
 */
export function computeRuntimeFingerprint(
  config: Record<string, unknown>,
): string {
  const subset: Record<string, unknown> = {};
  for (const key of RUNTIME_KEYS) {
    if (key in config) {
      subset[key] = config[key];
    }
  }
  return createHash("sha256")
    .update(sortedStringify(subset))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Read the previously stored runtime fingerprint from .lace/runtime-fingerprint.
 * Returns null if the file does not exist or is unreadable.
 */
export function readRuntimeFingerprint(workspaceFolder: string): string | null {
  const path = join(workspaceFolder, ".lace", FINGERPRINT_FILE);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }
}

/**
 * Write the runtime fingerprint to .lace/runtime-fingerprint.
 * The .lace/ directory must already exist (created by generateExtendedConfig).
 */
export function writeRuntimeFingerprint(
  workspaceFolder: string,
  fingerprint: string,
): void {
  const path = join(workspaceFolder, ".lace", FINGERPRINT_FILE);
  writeFileSync(path, fingerprint + "\n", "utf-8");
}

/**
 * Delete the runtime fingerprint file. Called when --rebuild is passed
 * to ensure a clean state.
 */
export function deleteRuntimeFingerprint(workspaceFolder: string): void {
  const path = join(workspaceFolder, ".lace", FINGERPRINT_FILE);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export interface DriftCheckResult {
  /** Whether the config has drifted from the last container creation. */
  drifted: boolean;
  /** The current fingerprint of the config. */
  currentFingerprint: string;
  /** The previous fingerprint (null on first run). */
  previousFingerprint: string | null;
}

/**
 * Check whether runtime config has drifted since the last container creation.
 * Compares the current config's fingerprint against the stored fingerprint.
 */
export function checkConfigDrift(
  config: Record<string, unknown>,
  workspaceFolder: string,
): DriftCheckResult {
  const currentFingerprint = computeRuntimeFingerprint(config);
  const previousFingerprint = readRuntimeFingerprint(workspaceFolder);

  return {
    drifted: previousFingerprint !== null && previousFingerprint !== currentFingerprint,
    currentFingerprint,
    previousFingerprint,
  };
}
