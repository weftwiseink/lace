// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface PrebuildMetadata {
  /** The original FROM reference (e.g., "node:24-bookworm"). */
  originalFrom: string;
  /** ISO timestamp of the last prebuild. */
  timestamp: string;
  /** The lace.local tag that was generated. */
  prebuildTag: string;
}

const METADATA_FILE = "metadata.json";

/**
 * Write prebuild metadata to the .lace/prebuild/ directory.
 * Creates the directory if it doesn't exist.
 */
export function writeMetadata(dir: string, data: PrebuildMetadata): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, METADATA_FILE),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Read prebuild metadata. Returns null if the directory or file doesn't exist.
 */
export function readMetadata(dir: string): PrebuildMetadata | null {
  const path = join(dir, METADATA_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PrebuildMetadata;
  } catch {
    return null;
  }
}

/**
 * Compare cached context files against newly generated ones.
 * Returns true if the contexts differ (rebuild needed).
 */
export function contextsChanged(
  cachedDir: string,
  newDockerfile: string,
  newDevcontainerJson: string,
): boolean {
  try {
    const cachedDockerfile = readFileSync(
      join(cachedDir, "Dockerfile"),
      "utf-8",
    );
    const cachedDevcontainerJson = readFileSync(
      join(cachedDir, "devcontainer.json"),
      "utf-8",
    );

    // Normalize whitespace for comparison (avoid spurious rebuilds from formatting)
    return (
      normalizeForComparison(cachedDockerfile) !==
        normalizeForComparison(newDockerfile) ||
      normalizeForComparison(cachedDevcontainerJson) !==
        normalizeForComparison(newDevcontainerJson)
    );
  } catch {
    // Cache doesn't exist or is unreadable — treat as changed
    return true;
  }
}

/** Normalize JSON/text for comparison: trim and collapse whitespace in JSON. */
function normalizeForComparison(content: string): string {
  try {
    // For JSON content: parse and re-stringify to normalize formatting
    return JSON.stringify(JSON.parse(content));
  } catch {
    // For non-JSON (Dockerfile): just trim
    return content.trim();
  }
}
