// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readMetadata } from "./metadata.js";
import { restoreFrom } from "./dockerfile.js";
import {
  readDevcontainerConfig,
  extractPrebuildFeatures,
} from "./devcontainer.js";

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
 * Reads the original reference from .lace/prebuild/metadata.json.
 */
export function runRestore(options: RestoreOptions = {}): RestoreResult {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const configPath =
    options.configPath ??
    join(workspaceRoot, ".devcontainer", "devcontainer.json");
  const prebuildDir = join(workspaceRoot, ".lace", "prebuild");

  // Check for active prebuild
  const metadata = readMetadata(prebuildDir);
  if (!metadata) {
    const msg = "No active prebuild. Nothing to restore.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

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

  // Restore the original FROM
  const restored = restoreFrom(content, metadata.originalFrom);
  writeFileSync(dockerfilePath, restored, "utf-8");

  // Clean up prebuild directory
  if (existsSync(prebuildDir)) {
    rmSync(prebuildDir, { recursive: true, force: true });
  }

  const msg = `Restored Dockerfile FROM to: ${metadata.originalFrom}`;
  console.log(msg);
  return { exitCode: 0, message: msg };
}
