// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readMetadata } from "@/lib/metadata";
import { parseDockerfile, parseTag, restoreFrom } from "@/lib/dockerfile";
import {
  readDevcontainerConfig,
  getCurrentImage,
  rewriteImageField,
} from "@/lib/devcontainer";

export interface RestoreOptions {
  workspaceRoot?: string;
  configPath?: string;
}

export interface RestoreResult {
  exitCode: number;
  message: string;
}

/**
 * Restore the Dockerfile's FROM line or devcontainer.json image field
 * to the original base image.
 *
 * Primary path: derive the original FROM/image from the lace.local/ tag (bidirectional).
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

  // Read devcontainer config
  let config;
  try {
    config = readDevcontainerConfig(configPath);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return { exitCode: 1, message: (err as Error).message };
  }

  if (config.buildSource.kind === "dockerfile") {
    // Dockerfile-based restore
    return restoreDockerfile(config.buildSource.path, prebuildDir);
  } else {
    // Image-based restore
    return restoreImage(config.raw, config.configPath, prebuildDir);
  }
}

/**
 * Restore a Dockerfile's FROM line to the original base image.
 */
function restoreDockerfile(
  dockerfilePath: string,
  prebuildDir: string,
): RestoreResult {
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

/**
 * Restore a devcontainer.json image field to the original base image.
 */
function restoreImage(
  raw: Record<string, unknown>,
  configPath: string,
  prebuildDir: string,
): RestoreResult {
  // Check if image is actually pointing to lace.local
  const currentImage = getCurrentImage(raw);
  if (!currentImage || !currentImage.startsWith("lace.local/")) {
    const msg =
      "devcontainer.json image does not reference a lace.local image. Nothing to restore.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  // Primary path: derive original image from the lace.local tag
  let originalImage = parseTag(currentImage);

  // Fallback: use metadata if tag parsing didn't produce a result
  if (!originalImage) {
    const metadata = readMetadata(prebuildDir);
    if (!metadata) {
      const msg =
        "Cannot determine original image: tag parsing failed and no metadata available.";
      console.error(`Error: ${msg}`);
      return { exitCode: 1, message: msg };
    }
    originalImage = metadata.originalFrom;
  }

  // Restore the original image
  const content = readFileSync(configPath, "utf-8");
  const restored = rewriteImageField(content, originalImage);
  writeFileSync(configPath, restored, "utf-8");

  const msg = `Restored devcontainer.json image to: ${originalImage}`;
  console.log(msg);
  return { exitCode: 0, message: msg };
}
