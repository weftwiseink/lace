// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readMetadata } from "@/lib/metadata";
import { parseDockerfile, parseTag, restoreFrom } from "@/lib/dockerfile";
import { readDevcontainerConfig } from "@/lib/devcontainer";

export interface RestoreOptions {
  workspaceRoot?: string;
  configPath?: string;
}

export interface RestoreResult {
  exitCode: number;
  message: string;
}

/**
 * Restore the Dockerfile's FROM line to the original base image.
 *
 * Primary path: derive the original FROM from the lace.local/ tag (bidirectional).
 * Fallback: read from .lace/prebuild/metadata.json if tag parsing fails.
 *
 * Does NOT delete .lace/prebuild/ — the cached context is preserved for
 * re-prebuild (cache reactivation) and debugging.
 */
export function runRestore(options: RestoreOptions = {}): RestoreResult {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const configPath =
    options.configPath ??
    join(workspaceRoot, ".devcontainer", "devcontainer.json");
  const prebuildDir = join(workspaceRoot, ".lace", "prebuild");

  // Read devcontainer config to find the Dockerfile path
  let dockerfilePath: string;
  try {
    const config = readDevcontainerConfig(configPath);
    dockerfilePath = config.dockerfilePath;
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return { exitCode: 1, message: (err as Error).message };
  }

  // Read current Dockerfile
  let content: string;
  try {
    content = readFileSync(dockerfilePath, "utf-8");
  } catch {
    const msg = `Cannot read Dockerfile: ${dockerfilePath}`;
    console.error(`Error: ${msg}`);
    return { exitCode: 1, message: msg };
  }

  // Check if FROM is actually pointing to lace.local
  if (!content.includes("lace.local/")) {
    const msg =
      "Dockerfile FROM does not reference a lace.local image. Nothing to restore.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  // Primary path: derive original FROM from the lace.local tag
  let originalFrom: string | null = null;
  try {
    const parsed = parseDockerfile(content);
    originalFrom = parseTag(parsed.image);
  } catch {
    // parseDockerfile failed — fall through to metadata fallback
  }

  // Fallback: use metadata if tag parsing didn't produce a result
  if (!originalFrom) {
    const metadata = readMetadata(prebuildDir);
    if (!metadata) {
      const msg =
        "Cannot determine original FROM reference: tag parsing failed and no metadata available.";
      console.error(`Error: ${msg}`);
      return { exitCode: 1, message: msg };
    }
    originalFrom = metadata.originalFrom;
  }

  // Restore the original FROM
  const restored = restoreFrom(content, originalFrom);
  writeFileSync(dockerfilePath, restored, "utf-8");

  const msg = `Restored Dockerfile FROM to: ${originalFrom}`;
  console.log(msg);
  return { exitCode: 0, message: msg };
}
