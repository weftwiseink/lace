// IMPLEMENTATION_VALIDATION
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as jsonc from "jsonc-parser";
import {
  readDevcontainerConfig,
  readDevcontainerConfigMinimal,
  extractRepoMounts,
  extractPrebuildFeatures,
  DevcontainerConfigError,
} from "./devcontainer";
import { runResolveMounts } from "./resolve-mounts";
import { runPrebuild } from "./prebuild";
import type { RunSubprocess, SubprocessResult } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";
import { assignPort, type PortAssignmentResult } from "./port-manager";
import {
  fetchAllFeatureMetadata,
  validateFeatureOptions,
  validatePortDeclarations,
  MetadataFetchError,
  type FeatureMetadata,
} from "./feature-metadata";

export interface UpOptions {
  /** Workspace folder path (defaults to cwd) */
  workspaceFolder?: string;
  /** Subprocess runner for testing */
  subprocess?: RunSubprocess;
  /** Additional arguments to pass to devcontainer up */
  devcontainerArgs?: string[];
  /** Skip devcontainer up (for testing) */
  skipDevcontainerUp?: boolean;
  /** Bypass filesystem cache for floating tags */
  noCache?: boolean;
  /** Skip metadata validation entirely (offline/emergency) */
  skipMetadataValidation?: boolean;
  /** Override cache directory (for testing) */
  cacheDir?: string;
}

export interface UpResult {
  exitCode: number;
  message: string;
  phases: {
    portAssignment?: { exitCode: number; message: string; port?: number };
    metadataValidation?: { exitCode: number; message: string };
    prebuild?: { exitCode: number; message: string };
    resolveMounts?: { exitCode: number; message: string };
    generateConfig?: { exitCode: number; message: string };
    devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
  };
}

/**
 * Run the full lace up workflow:
 * 1. Assign port for wezterm SSH server (22425-22499 range)
 * 2. Prebuild (if prebuildFeatures configured)
 * 3. Resolve mounts (if repo mounts configured)
 * 4. Generate extended devcontainer.json (includes port mapping)
 * 5. Invoke devcontainer up
 */
export async function runUp(options: UpOptions = {}): Promise<UpResult> {
  const {
    workspaceFolder = process.cwd(),
    subprocess = defaultRunSubprocess,
    devcontainerArgs = [],
    skipDevcontainerUp = false,
    noCache = false,
    skipMetadataValidation = false,
    cacheDir,
  } = options;

  const result: UpResult = {
    exitCode: 0,
    message: "",
    phases: {},
  };

  const devcontainerPath = join(
    workspaceFolder,
    ".devcontainer",
    "devcontainer.json",
  );

  // Read the devcontainer.json to determine what phases are needed
  // First try minimal read (no Dockerfile required)
  let configMinimal;
  try {
    configMinimal = readDevcontainerConfigMinimal(devcontainerPath);
  } catch (err) {
    if (err instanceof DevcontainerConfigError) {
      return {
        exitCode: 1,
        message: err.message,
        phases: {},
      };
    }
    throw err;
  }

  const hasPrebuildFeatures = extractPrebuildFeatures(configMinimal.raw).kind === "features";
  const repoMountsResult = extractRepoMounts(configMinimal.raw);
  const hasRepoMounts = repoMountsResult.kind === "repoMounts";

  // Phase 0: Assign port for wezterm SSH server
  // This runs before other phases to ensure port is available
  console.log("Assigning port for wezterm SSH server...");
  let portResult: PortAssignmentResult;
  try {
    portResult = await assignPort(workspaceFolder);
    const portMessage = portResult.wasReassigned
      ? `Port ${portResult.previousPort} was in use, reassigned to ${portResult.assignment.hostPort}`
      : `Using port ${portResult.assignment.hostPort}`;
    result.phases.portAssignment = {
      exitCode: 0,
      message: portMessage,
      port: portResult.assignment.hostPort,
    };
    console.log(portMessage);
  } catch (err) {
    result.phases.portAssignment = {
      exitCode: 1,
      message: (err as Error).message,
    };
    result.exitCode = 1;
    result.message = `Port assignment failed: ${(err as Error).message}`;
    return result;
  }

  // Phase 0.5: Metadata validation (if features are declared)
  // Extract feature IDs from the devcontainer.json's `features` key
  const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const featureIds = Object.keys(rawFeatures);

  if (featureIds.length > 0) {
    console.log("Validating feature metadata...");
    try {
      const metadataMap = await fetchAllFeatureMetadata(featureIds, {
        noCache,
        skipValidation: skipMetadataValidation,
        subprocess,
        cacheDir,
      });

      // Validate each feature's options and port declarations
      for (const [featureId, metadata] of metadataMap) {
        if (!metadata) continue; // null only when skipValidation=true

        // Validate user-provided options exist in schema
        const optionResult = validateFeatureOptions(
          featureId,
          rawFeatures[featureId] ?? {},
          metadata,
        );
        if (!optionResult.valid) {
          const msg =
            `Feature "${featureId}" has invalid options:\n` +
            optionResult.errors.map((e) => `  - ${e.message}`).join("\n");
          result.phases.metadataValidation = { exitCode: 1, message: msg };
          result.exitCode = 1;
          result.message = msg;
          return result;
        }

        // Validate port declaration keys match option names
        const portResult = validatePortDeclarations(metadata);
        if (!portResult.valid) {
          const msg =
            `Feature "${featureId}" has invalid port declarations:\n` +
            portResult.errors.map((e) => `  - ${e.message}`).join("\n");
          result.phases.metadataValidation = { exitCode: 1, message: msg };
          result.exitCode = 1;
          result.message = msg;
          return result;
        }
      }

      result.phases.metadataValidation = {
        exitCode: 0,
        message: `Validated metadata for ${featureIds.length} feature(s)`,
      };
      console.log(
        `Validated metadata for ${featureIds.length} feature(s)`,
      );
    } catch (err) {
      if (err instanceof MetadataFetchError) {
        result.phases.metadataValidation = {
          exitCode: 1,
          message: err.message,
        };
        result.exitCode = 1;
        result.message = err.message;
        return result;
      }
      throw err;
    }
  }

  // Only read full config (with Dockerfile) if we need prebuild
  let config;
  if (hasPrebuildFeatures) {
    try {
      config = readDevcontainerConfig(devcontainerPath);
    } catch (err) {
      if (err instanceof DevcontainerConfigError) {
        return {
          exitCode: 1,
          message: err.message,
          phases: {},
        };
      }
      throw err;
    }
  }

  // Phase 1: Prebuild (if configured)
  if (hasPrebuildFeatures) {
    console.log("Running prebuild...");
    const prebuildResult = runPrebuild({ workspaceRoot: workspaceFolder, subprocess });
    result.phases.prebuild = {
      exitCode: prebuildResult.exitCode,
      message: prebuildResult.message,
    };

    if (prebuildResult.exitCode !== 0) {
      result.exitCode = prebuildResult.exitCode;
      result.message = `Prebuild failed: ${prebuildResult.message}`;
      return result;
    }

    if (prebuildResult.message) {
      console.log(prebuildResult.message);
    }
  }

  // Phase 2: Resolve mounts (if configured)
  let mountSpecs: string[] = [];
  let symlinkCommand: string | null = null;

  if (hasRepoMounts) {
    console.log("Resolving repo mounts...");
    const mountsResult = runResolveMounts({ workspaceFolder, subprocess });
    result.phases.resolveMounts = {
      exitCode: mountsResult.exitCode,
      message: mountsResult.message,
    };

    if (mountsResult.exitCode !== 0) {
      result.exitCode = mountsResult.exitCode;
      result.message = `Resolve mounts failed: ${mountsResult.message}`;
      return result;
    }

    if (mountsResult.message) {
      console.log(mountsResult.message);
    }

    mountSpecs = mountsResult.mountSpecs ?? [];
    symlinkCommand = mountsResult.symlinkCommand ?? null;
  }

  // Phase 3: Generate extended devcontainer.json
  // Always generate because we always need the port mapping
  const portMapping = `${portResult.assignment.hostPort}:${portResult.assignment.containerPort}`;
  console.log("Generating extended devcontainer.json...");
  try {
    generateExtendedConfig({
      workspaceFolder,
      mountSpecs,
      symlinkCommand,
      portMapping,
    });
    result.phases.generateConfig = {
      exitCode: 0,
      message: "Generated .lace/devcontainer.json",
    };
  } catch (err) {
    result.phases.generateConfig = {
      exitCode: 1,
      message: (err as Error).message,
    };
    result.exitCode = 1;
    result.message = `Config generation failed: ${(err as Error).message}`;
    return result;
  }

  // Phase 4: Invoke devcontainer up
  if (skipDevcontainerUp) {
    result.message = "lace up completed (devcontainer up skipped)";
    return result;
  }

  console.log("Starting devcontainer...");
  const upResult = runDevcontainerUp({
    workspaceFolder,
    subprocess,
    devcontainerArgs,
    useExtendedConfig: true, // Always use extended config now (has port mapping)
  });

  result.phases.devcontainerUp = upResult;

  if (upResult.exitCode !== 0) {
    result.exitCode = upResult.exitCode;
    result.message = `devcontainer up failed: ${upResult.stderr}`;
    console.error(upResult.stderr);
    return result;
  }

  result.message = "lace up completed successfully";
  return result;
}

interface GenerateExtendedConfigOptions {
  workspaceFolder: string;
  mountSpecs: string[];
  symlinkCommand: string | null;
  portMapping: string | null; // Format: "hostPort:containerPort"
}

/**
 * Generate an extended devcontainer.json that includes:
 * - All original configuration
 * - Repo mounts
 * - Symlink creation commands in postCreateCommand
 * - Port mapping for wezterm SSH server
 */
function generateExtendedConfig(options: GenerateExtendedConfigOptions): void {
  const { workspaceFolder, mountSpecs, symlinkCommand, portMapping } = options;

  const devcontainerPath = join(
    workspaceFolder,
    ".devcontainer",
    "devcontainer.json",
  );

  // Read original config
  const content = readFileSync(devcontainerPath, "utf-8");
  const errors: jsonc.ParseError[] = [];
  const original = jsonc.parse(content, errors) as Record<string, unknown>;

  if (errors.length > 0) {
    throw new Error(`Failed to parse devcontainer.json: ${errors[0].error}`);
  }

  // Start with original config
  const extended = { ...original };

  // Add mounts
  if (mountSpecs.length > 0) {
    const existingMounts = (original.mounts ?? []) as string[];
    extended.mounts = [...existingMounts, ...mountSpecs];
  }

  // Add symlink command to postCreateCommand
  if (symlinkCommand) {
    const existing = original.postCreateCommand;
    if (!existing) {
      extended.postCreateCommand = symlinkCommand;
    } else if (typeof existing === "string") {
      extended.postCreateCommand = `${existing} && ${symlinkCommand}`;
    } else if (Array.isArray(existing)) {
      // Array format: ["command", "arg1", "arg2"]
      // We need to convert to a compound command
      const existingCmd = existing.join(" ");
      extended.postCreateCommand = `${existingCmd} && ${symlinkCommand}`;
    } else if (typeof existing === "object") {
      // Object format: { "name": ["command", "args"] }
      // Add our symlink command as a new entry
      extended.postCreateCommand = {
        ...(existing as Record<string, unknown>),
        "lace-symlinks": ["sh", "-c", symlinkCommand],
      };
    }
  }

  // Add port mapping for wezterm SSH server
  if (portMapping) {
    const existingAppPort = (original.appPort ?? []) as string[];
    // Filter out any existing lace port mappings (in 22425-22499 range)
    const filteredPorts = existingAppPort.filter((p) => {
      const match = String(p).match(/^(\d+):/);
      if (!match) return true;
      const port = parseInt(match[1], 10);
      return port < 22425 || port > 22499;
    });
    extended.appPort = [...filteredPorts, portMapping];
  }

  // Write extended config
  const laceDir = join(workspaceFolder, ".lace");
  mkdirSync(laceDir, { recursive: true });

  const outputPath = join(laceDir, "devcontainer.json");
  writeFileSync(outputPath, JSON.stringify(extended, null, 2) + "\n", "utf-8");
}

interface RunDevcontainerUpOptions {
  workspaceFolder: string;
  subprocess: RunSubprocess;
  devcontainerArgs: string[];
  useExtendedConfig: boolean;
}

/**
 * Invoke devcontainer up with the appropriate configuration.
 */
function runDevcontainerUp(
  options: RunDevcontainerUpOptions,
): SubprocessResult {
  const { workspaceFolder, subprocess, devcontainerArgs, useExtendedConfig } =
    options;

  const args = ["up"];

  // Use extended config if we generated one
  if (useExtendedConfig) {
    const extendedPath = join(workspaceFolder, ".lace", "devcontainer.json");
    if (existsSync(extendedPath)) {
      args.push("--config", extendedPath);
    }
  }

  args.push("--workspace-folder", workspaceFolder);
  args.push(...devcontainerArgs);

  return subprocess("devcontainer", args);
}
