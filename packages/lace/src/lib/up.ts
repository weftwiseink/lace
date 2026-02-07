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
import {
  fetchAllFeatureMetadata,
  validateFeatureOptions,
  validatePortDeclarations,
  MetadataFetchError,
  type FeatureMetadata,
} from "./feature-metadata";
import { PortAllocator } from "./port-allocator";
import type { PortAllocation, FeaturePortDeclaration } from "./port-allocator";
import {
  autoInjectPortTemplates,
  resolveTemplates,
  generatePortEntries,
  mergePortEntries,
  buildFeaturePortMetadata,
  warnPrebuildPortTemplates,
  type TemplateResolutionResult,
} from "./template-resolver";

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
    templateResolution?: { exitCode: number; message: string };
    prebuild?: { exitCode: number; message: string };
    resolveMounts?: { exitCode: number; message: string };
    generateConfig?: { exitCode: number; message: string };
    devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
  };
}

/**
 * Run the full lace up workflow:
 * 1. Read config and extract prebuild features (before template resolution)
 * 2. Fetch feature metadata (required for auto-injection)
 * 3. Auto-inject ${lace.port()} templates + resolve all templates
 * 4. Prebuild (if prebuildFeatures configured)
 * 5. Resolve mounts (if repo mounts configured)
 * 6. Generate extended devcontainer.json (includes resolved ports + mounts)
 * 7. Invoke devcontainer up
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

  const hasPrebuildFeatures =
    extractPrebuildFeatures(configMinimal.raw).kind === "features";
  const repoMountsResult = extractRepoMounts(configMinimal.raw);
  const hasRepoMounts = repoMountsResult.kind === "repoMounts";

  // Extract feature IDs from the devcontainer.json's `features` key
  const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const featureIds = Object.keys(rawFeatures);

  // ── Phase: Metadata fetch + validation + auto-injection + template resolution ──
  // This replaces the old hardcoded port assignment phase.
  let metadataMap: Map<string, FeatureMetadata | null> = new Map();
  let templateResult: TemplateResolutionResult | null = null;
  let featurePortMetadata: Map<string, FeaturePortDeclaration> | null = null;

  if (featureIds.length > 0) {
    // Step 1: Fetch feature metadata
    console.log("Fetching feature metadata...");
    try {
      metadataMap = await fetchAllFeatureMetadata(featureIds, {
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
        const portDeclResult = validatePortDeclarations(metadata);
        if (!portDeclResult.valid) {
          const msg =
            `Feature "${featureId}" has invalid port declarations:\n` +
            portDeclResult.errors.map((e) => `  - ${e.message}`).join("\n");
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

  // Step 2: Warn about ${lace.port()} in prebuildFeatures
  const prebuildWarnings = warnPrebuildPortTemplates(configMinimal.raw);
  for (const warning of prebuildWarnings) {
    console.warn(`Warning: ${warning}`);
  }

  // Step 3: Auto-inject ${lace.port()} templates for declared port options
  const configForResolution = structuredClone(configMinimal.raw);
  const injected = autoInjectPortTemplates(configForResolution, metadataMap);
  if (injected.length > 0) {
    console.log(`Auto-injected port templates for: ${injected.join(", ")}`);
  }

  // Step 4: Resolve all templates (auto-injected + user-written)
  const portAllocator = new PortAllocator(workspaceFolder);
  try {
    templateResult = await resolveTemplates(configForResolution, portAllocator);
    portAllocator.save(); // Persist assignments after successful resolution

    if (templateResult.allocations.length > 0) {
      const portSummary = templateResult.allocations
        .map((a) => `  ${a.label}: ${a.port}`)
        .join("\n");
      console.log(`Allocated ports:\n${portSummary}`);
      result.phases.portAssignment = {
        exitCode: 0,
        message: `Allocated ${templateResult.allocations.length} port(s)`,
        port: templateResult.allocations[0]?.port,
      };
    } else {
      console.log("No port templates found, skipping port allocation.");
      result.phases.portAssignment = {
        exitCode: 0,
        message: "No port templates found",
      };
    }

    if (templateResult.allocations.length > 0) {
      result.phases.templateResolution = {
        exitCode: 0,
        message: `Resolved ${templateResult.allocations.length} port template(s)`,
      };
    }

    for (const warning of templateResult.warnings) {
      console.warn(`Warning: ${warning}`);
    }
  } catch (err) {
    result.phases.templateResolution = {
      exitCode: 1,
      message: (err as Error).message,
    };
    result.exitCode = 1;
    result.message = `Template resolution failed: ${(err as Error).message}`;
    return result;
  }

  // Build feature port metadata for enriching portsAttributes labels
  featurePortMetadata = buildFeaturePortMetadata(metadataMap);

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

  // Phase: Prebuild (if configured)
  if (hasPrebuildFeatures) {
    console.log("Running prebuild...");
    const prebuildResult = runPrebuild({
      workspaceRoot: workspaceFolder,
      subprocess,
    });
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

  // Phase: Resolve mounts (if configured)
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

  // Phase: Generate extended devcontainer.json
  console.log("Generating extended devcontainer.json...");
  try {
    generateExtendedConfig({
      workspaceFolder,
      mountSpecs,
      symlinkCommand,
      resolvedConfig: templateResult?.resolvedConfig ?? configMinimal.raw,
      allocations: templateResult?.allocations ?? [],
      featurePortMetadata,
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

  // Phase: Invoke devcontainer up
  if (skipDevcontainerUp) {
    result.message = "lace up completed (devcontainer up skipped)";
    return result;
  }

  console.log("Starting devcontainer...");
  const upResult = runDevcontainerUp({
    workspaceFolder,
    subprocess,
    devcontainerArgs,
    useExtendedConfig: true, // Always use extended config now
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
  resolvedConfig: Record<string, unknown>;
  allocations: PortAllocation[];
  featurePortMetadata: Map<string, FeaturePortDeclaration> | null;
}

/**
 * Generate an extended devcontainer.json that includes:
 * - Template-resolved configuration (with concrete port numbers)
 * - Auto-generated appPort/forwardPorts/portsAttributes
 * - Repo mounts
 * - Symlink creation commands in postCreateCommand
 */
function generateExtendedConfig(options: GenerateExtendedConfigOptions): void {
  const {
    workspaceFolder,
    mountSpecs,
    symlinkCommand,
    resolvedConfig,
    allocations,
    featurePortMetadata,
  } = options;

  // Start with the template-resolved config
  let extended: Record<string, unknown> = { ...resolvedConfig };

  // Auto-generate port entries and merge them
  if (allocations.length > 0) {
    const generated = generatePortEntries(
      extended,
      allocations,
      featurePortMetadata,
    );
    extended = mergePortEntries(extended, generated);
  }

  // Add mounts
  if (mountSpecs.length > 0) {
    const existingMounts = (extended.mounts ?? []) as string[];
    extended.mounts = [...existingMounts, ...mountSpecs];
  }

  // Add symlink command to postCreateCommand
  if (symlinkCommand) {
    const existing = extended.postCreateCommand;
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
  writeFileSync(
    outputPath,
    JSON.stringify(extended, null, 2) + "\n",
    "utf-8",
  );
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
