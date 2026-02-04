// IMPLEMENTATION_VALIDATION
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as jsonc from "jsonc-parser";
import {
  readDevcontainerConfig,
  extractPlugins,
  extractPrebuildFeatures,
  DevcontainerConfigError,
} from "./devcontainer";
import { runResolveMounts } from "./resolve-mounts";
import { runPrebuild } from "./prebuild";
import type { RunSubprocess, SubprocessResult } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";

export interface UpOptions {
  /** Workspace folder path (defaults to cwd) */
  workspaceFolder?: string;
  /** Subprocess runner for testing */
  subprocess?: RunSubprocess;
  /** Additional arguments to pass to devcontainer up */
  devcontainerArgs?: string[];
  /** Skip devcontainer up (for testing) */
  skipDevcontainerUp?: boolean;
}

export interface UpResult {
  exitCode: number;
  message: string;
  phases: {
    prebuild?: { exitCode: number; message: string };
    resolveMounts?: { exitCode: number; message: string };
    generateConfig?: { exitCode: number; message: string };
    devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
  };
}

/**
 * Run the full lace up workflow:
 * 1. Prebuild (if prebuildFeatures configured)
 * 2. Resolve mounts (if plugins configured)
 * 3. Generate extended devcontainer.json
 * 4. Invoke devcontainer up
 */
export function runUp(options: UpOptions = {}): UpResult {
  const {
    workspaceFolder = process.cwd(),
    subprocess = defaultRunSubprocess,
    devcontainerArgs = [],
    skipDevcontainerUp = false,
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
  let config;
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

  const hasPrebuildFeatures = extractPrebuildFeatures(config.raw).kind === "features";
  const pluginsResult = extractPlugins(config.raw);
  const hasPlugins = pluginsResult.kind === "plugins";

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

  if (hasPlugins) {
    console.log("Resolving plugin mounts...");
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
  if (hasPlugins || hasPrebuildFeatures) {
    console.log("Generating extended devcontainer.json...");
    try {
      generateExtendedConfig({
        workspaceFolder,
        mountSpecs,
        symlinkCommand,
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
    useExtendedConfig: hasPlugins || hasPrebuildFeatures,
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
}

/**
 * Generate an extended devcontainer.json that includes:
 * - All original configuration
 * - Plugin mounts
 * - Symlink creation commands in postCreateCommand
 */
function generateExtendedConfig(options: GenerateExtendedConfigOptions): void {
  const { workspaceFolder, mountSpecs, symlinkCommand } = options;

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
