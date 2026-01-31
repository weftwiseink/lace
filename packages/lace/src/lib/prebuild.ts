// IMPLEMENTATION_VALIDATION
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readDevcontainerConfig,
  extractPrebuildFeatures,
  generateTempDevcontainerJson,
} from "./devcontainer.js";
import {
  parseDockerfile,
  generateTag,
  rewriteFrom,
  restoreFrom,
  generatePrebuildDockerfile,
} from "./dockerfile.js";
import { validateNoOverlap } from "./validation.js";
import {
  writeMetadata,
  readMetadata,
  contextsChanged,
} from "./metadata.js";
import { mergeLockFile } from "./lockfile.js";
import { runSubprocess, type RunSubprocess } from "./subprocess.js";

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
  } catch {
    const msg = `Cannot read Dockerfile: ${config.dockerfilePath}`;
    console.error(`Error: ${msg}`);
    return { exitCode: 1, message: msg };
  }

  // If the Dockerfile already has a lace.local FROM, restore it first
  const existingMetadata = readMetadata(prebuildDir);
  if (existingMetadata && dockerfileContent.includes("lace.local/")) {
    dockerfileContent = restoreFrom(
      dockerfileContent,
      existingMetadata.originalFrom,
    );
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
    const msg = `Prebuild is up to date (${prebuildTag}). Use --force to rebuild.`;
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

  // Restore lock file entries from previous prebuild into temp context
  const lockFilePath = join(config.configDir, "devcontainer-lock.json");
  // (Lock file merge handled in Phase 5 — for now, proceed without)

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

  // Step 8: Merge lock file (wired in Phase 5)
  try {
    mergeLockFile(lockFilePath, prebuildDir);
  } catch {
    // Non-fatal: lock file merge is optional
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
