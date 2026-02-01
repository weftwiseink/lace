// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readDevcontainerConfig,
  extractPrebuildFeatures,
  generateTempDevcontainerJson,
} from "@/lib/devcontainer";
import {
  parseDockerfile,
  generateTag,
  parseTag,
  rewriteFrom,
  restoreFrom,
  generatePrebuildDockerfile,
} from "@/lib/dockerfile";
import { validateNoOverlap } from "@/lib/validation";
import {
  writeMetadata,
  readMetadata,
  contextsChanged,
} from "@/lib/metadata";
import { mergeLockFile, extractPrebuiltEntries, writeLockFile } from "@/lib/lockfile";
import { runSubprocess, type RunSubprocess } from "@/lib/subprocess";

export interface PrebuildOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Override workspace root (defaults to cwd). */
  workspaceRoot?: string;
  /** Override devcontainer config path. */
  configPath?: string;
  /** Injectable subprocess runner for testing. */
  subprocess?: RunSubprocess;
}

export interface PrebuildResult {
  exitCode: number;
  /** Human-readable status message. */
  message: string;
}

/**
 * Run the full prebuild pipeline.
 *
 * 1. Read devcontainer.json, extract prebuild features
 * 2. Validate no feature overlap
 * 3. Parse Dockerfile, extract FROM + prelude
 * 4. Generate temp context in .lace/prebuild/
 * 5. Compare against cache (skip if unchanged, unless --force)
 * 6. Shell out to devcontainer build
 * 7. Rewrite Dockerfile FROM
 * 8. Merge lock file
 * 9. Write metadata
 */
export function runPrebuild(options: PrebuildOptions = {}): PrebuildResult {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const configPath =
    options.configPath ??
    join(workspaceRoot, ".devcontainer", "devcontainer.json");
  const run = options.subprocess ?? runSubprocess;
  const prebuildDir = join(workspaceRoot, ".lace", "prebuild");

  // Step 1: Read devcontainer.json
  let config;
  try {
    config = readDevcontainerConfig(configPath);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return { exitCode: 1, message: (err as Error).message };
  }

  // Step 1b: Extract prebuild features
  const prebuildResult = extractPrebuildFeatures(config.raw);

  if (prebuildResult.kind === "null") {
    // Intentional opt-out — silent exit
    return { exitCode: 0, message: "" };
  }

  if (prebuildResult.kind === "absent") {
    const msg =
      "No prebuildFeatures configured in devcontainer.json. Nothing to prebuild.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  if (prebuildResult.kind === "empty") {
    const msg =
      "prebuildFeatures is empty in devcontainer.json. Nothing to prebuild.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  const prebuildFeatures = prebuildResult.features;

  // Step 2: Validate no feature overlap
  const overlaps = validateNoOverlap(prebuildFeatures, config.features);
  if (overlaps.length > 0) {
    const msg = `Feature overlap detected between prebuildFeatures and features: ${overlaps.join(", ")}`;
    console.error(`Error: ${msg}`);
    return { exitCode: 1, message: msg };
  }

  // Step 3: Parse Dockerfile
  let dockerfileContent: string;
  try {
    dockerfileContent = readFileSync(config.dockerfilePath, "utf-8");
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
    const msg = `Cannot read Dockerfile: ${config.dockerfilePath} (${reason})`;
    console.error(`Error: ${msg}`);
    return { exitCode: 1, message: msg };
  }

  // If the Dockerfile already has a lace.local FROM, restore it first
  if (dockerfileContent.includes("lace.local/")) {
    // Primary: derive original FROM from lace.local tag (bidirectional)
    let originalFrom: string | null = null;
    try {
      const laceFrom = parseDockerfile(dockerfileContent);
      originalFrom = parseTag(laceFrom.image);
    } catch {
      // fall through to metadata
    }
    // Fallback: metadata
    if (!originalFrom) {
      const existingMetadata = readMetadata(prebuildDir);
      originalFrom = existingMetadata?.originalFrom ?? null;
    }
    if (originalFrom) {
      dockerfileContent = restoreFrom(dockerfileContent, originalFrom);
    }
  }

  let parsed;
  try {
    parsed = parseDockerfile(dockerfileContent);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return { exitCode: 1, message: (err as Error).message };
  }

  // Step 4: Generate temp context
  const tempDockerfile = generatePrebuildDockerfile(parsed);
  const tempDevcontainerJson = generateTempDevcontainerJson(
    prebuildFeatures,
    "Dockerfile",
  );
  const prebuildTag = generateTag(parsed.imageName, parsed.tag, parsed.digest);

  // Step 5: Compare against cache
  if (
    !options.force &&
    !options.dryRun &&
    !contextsChanged(prebuildDir, tempDockerfile, tempDevcontainerJson)
  ) {
    // Cache is fresh — check if Dockerfile needs reactivation (e.g., after restore)
    const currentContent = readFileSync(config.dockerfilePath, "utf-8");
    if (currentContent.includes("lace.local/")) {
      const msg = `Prebuild is up to date (${prebuildTag}). Use --force to rebuild.`;
      console.log(msg);
      return { exitCode: 0, message: msg };
    }
    // Dockerfile was restored but cache is fresh — rewrite FROM without rebuilding
    const reactivated = rewriteFrom(dockerfileContent, prebuildTag);
    writeFileSync(config.dockerfilePath, reactivated, "utf-8");
    writeMetadata(prebuildDir, {
      originalFrom: parsed.image,
      timestamp: new Date().toISOString(),
      prebuildTag,
    });
    const msg = `Prebuild reactivated from cache. Dockerfile FROM rewritten to: ${prebuildTag}`;
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  // Dry-run: report planned actions and exit
  if (options.dryRun) {
    const featureList = Object.keys(prebuildFeatures).join(", ");
    const msg = [
      "Dry run — planned actions:",
      `  Base image: ${parsed.image}`,
      `  Prebuild tag: ${prebuildTag}`,
      `  Features to prebuild: ${featureList}`,
      `  Dockerfile: ${config.dockerfilePath}`,
      `  Temp context: ${prebuildDir}`,
    ].join("\n");
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  // Step 6: Write temp context and run devcontainer build
  mkdirSync(prebuildDir, { recursive: true });
  writeFileSync(join(prebuildDir, "Dockerfile"), tempDockerfile, "utf-8");
  writeFileSync(
    join(prebuildDir, "devcontainer.json"),
    tempDevcontainerJson,
    "utf-8",
  );

  const lockFilePath = join(config.configDir, "devcontainer-lock.json");

  // Seed temp context with prior lock entries for version pinning
  const priorEntries = extractPrebuiltEntries(lockFilePath);
  if (Object.keys(priorEntries).length > 0) {
    writeLockFile(join(prebuildDir, "devcontainer-lock.json"), {
      features: priorEntries,
    });
  }

  console.log(`Building prebuild image: ${prebuildTag}`);
  console.log(
    `Features: ${Object.keys(prebuildFeatures).join(", ")}`,
  );

  const buildResult = run(
    "devcontainer",
    [
      "build",
      "--workspace-folder",
      prebuildDir,
      "--config",
      join(prebuildDir, "devcontainer.json"),
      "--image-name",
      prebuildTag,
    ],
    { cwd: workspaceRoot },
  );

  if (buildResult.exitCode !== 0) {
    // Atomicity: don't modify the Dockerfile on failure
    console.error("devcontainer build failed:");
    console.error(buildResult.stderr);
    // Clean up temp context on failure
    return {
      exitCode: buildResult.exitCode,
      message: `devcontainer build failed: ${buildResult.stderr}`,
    };
  }

  // Step 7: Rewrite Dockerfile FROM
  const rewrittenDockerfile = rewriteFrom(dockerfileContent, prebuildTag);
  writeFileSync(config.dockerfilePath, rewrittenDockerfile, "utf-8");

  // Step 8: Merge lock file
  try {
    mergeLockFile(lockFilePath, prebuildDir);
  } catch (err) {
    console.warn(`Warning: lock file merge failed: ${(err as Error).message}`);
  }

  // Step 9: Write metadata
  writeMetadata(prebuildDir, {
    originalFrom: parsed.image,
    timestamp: new Date().toISOString(),
    prebuildTag,
  });

  const msg = `Prebuild complete. Dockerfile FROM rewritten to: ${prebuildTag}`;
  console.log(msg);
  return { exitCode: 0, message: msg };
}
