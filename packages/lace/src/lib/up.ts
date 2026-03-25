// IMPLEMENTATION_VALIDATION -- Documented in CONTRIBUTING.md
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as jsonc from "jsonc-parser";
import {
  readDevcontainerConfig,
  readDevcontainerConfigMinimal,
  extractRepoMounts,
  extractPrebuildFeatures,
  extractRemoteUser,
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
  autoInjectMountTemplates,
  deduplicateStaticMounts,
  extractProjectMountDeclarations,
  extractFeatureShortId,
  validateMountNamespaces,
  validateMountTargetConflicts,
  emitMountGuidance,
  resolveTemplates,
  generatePortEntries,
  mergePortEntries,
  buildFeaturePortMetadata,
  warnPrebuildPortTemplates,
  warnPrebuildPortFeaturesStaticPort,
  extractPrebuildFeaturesRaw,
  type TemplateResolutionResult,
} from "./template-resolver";
import { MountPathResolver, type ContainerVariables } from "./mount-resolver";
import { loadSettings, SettingsConfigError, type LaceSettings, expandPath } from "./settings";
import {
  loadUserConfig,
  UserConfigError,
  loadMountPolicy,
  validateMountSources,
  validateFeatureReferences,
} from "./user-config";
import { applyUserConfig } from "./user-config-merge";
import { applyWorkspaceLayout } from "./workspace-layout";
import { runHostValidation } from "./host-validator";
import { deriveProjectName, sanitizeContainerName, hasRunArgsFlag, resolveContainerName } from "./project-name";
import { classifyWorkspace, getDetectedExtensions, verifyContainerGitVersion } from "./workspace-detector";
import {
  checkConfigDrift,
  writeRuntimeFingerprint,
  deleteRuntimeFingerprint,
} from "./config-drift";

/**
 * Query Docker for host ports held by this workspace's running container.
 * Returns a Set of host port numbers, or an empty set if no container is
 * running or Docker is unavailable.
 */
export function getContainerHostPorts(
  workspaceFolder: string,
  subprocess: RunSubprocess,
): Set<number> {
  // Find running container by devcontainer label
  const psResult = subprocess("docker", [
    "ps", "-q",
    "--filter", `label=devcontainer.local_folder=${workspaceFolder}`,
  ]);
  const containerId = psResult.stdout.trim().split("\n")[0]?.trim();
  if (!containerId || psResult.exitCode !== 0) return new Set();

  // Get port bindings
  const portResult = subprocess("docker", ["port", containerId]);
  if (portResult.exitCode !== 0) return new Set();

  // Parse lines like "2222/tcp -> 0.0.0.0:22425"
  const ports = new Set<number>();
  for (const line of portResult.stdout.split("\n")) {
    const match = line.match(/:(\d+)\s*$/);
    if (match) {
      ports.add(Number(match[1]));
    }
  }
  return ports;
}

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
  /** Skip host-side validation (downgrade errors to warnings) */
  skipValidation?: boolean;
  /** Force rebuild of prebuild image (bypass cache) */
  rebuild?: boolean;
}

// Documented in CONTRIBUTING.md -- update if changing this pattern
export interface UpResult {
  exitCode: number;
  message: string;
  phases: {
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
    portAssignment?: { exitCode: number; message: string; port?: number };
    metadataValidation?: { exitCode: number; message: string };
    templateResolution?: { exitCode: number; message: string };
    prebuild?: { exitCode: number; message: string };
    resolveMounts?: { exitCode: number; message: string };
    generateConfig?: { exitCode: number; message: string };
    devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
    containerVerification?: { exitCode: number; message: string };
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
    skipValidation = false,
    rebuild = false,
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

  // ── Phase 0a: Workspace layout detection + auto-configuration ──
  // NOTE: This must run before the structuredClone so that
  // workspaceMount/workspaceFolder/postCreateCommand mutations propagate
  // into configForResolution and through the rest of the pipeline.
  let projectName: string;
  {
    const layoutResult = applyWorkspaceLayout(configMinimal.raw, workspaceFolder);

    if (layoutResult.status === "applied") {
      result.phases.workspaceLayout = { exitCode: 0, message: layoutResult.message };
      console.log(layoutResult.message);
    } else if (layoutResult.status === "error" && !skipValidation) {
      result.phases.workspaceLayout = { exitCode: 1, message: layoutResult.message };
      result.exitCode = 1;
      result.message = `Workspace layout failed: ${layoutResult.message}`;
      return result;
    } else if (layoutResult.status === "error" && skipValidation) {
      console.warn(`Warning: ${layoutResult.message} (continuing due to --skip-validation)`);
      result.phases.workspaceLayout = { exitCode: 0, message: `${layoutResult.message} (downgraded)` };
    }
    // status === "skipped": no workspace config present, nothing to do

    for (const warning of layoutResult.warnings) {
      console.warn(`Warning: ${warning}`);
    }

    if (layoutResult.classification) {
      projectName = deriveProjectName(layoutResult.classification, workspaceFolder);
    } else {
      // Fallback: classify even without layout config. The cache ensures
      // this is free if classifyWorkspace was already called upstream.
      const { classification } = classifyWorkspace(workspaceFolder);
      projectName = deriveProjectName(classification, workspaceFolder);
    }
  }

  // ── Phase 0b: Host-side validation ──
  {
    const validationResult = runHostValidation(configMinimal.raw, { skipValidation });

    if (validationResult.checks.length > 0) {
      for (const check of validationResult.checks) {
        if (!check.passed) {
          const prefix = check.severity === "error" ? "ERROR" : "Warning";
          console.warn(`${prefix}: ${check.message}`);
          if (check.hint) console.warn(`  Hint: ${check.hint}`);
        }
      }

      if (!validationResult.passed) {
        const msg = `Host validation failed: ${validationResult.errorCount} error(s). ` +
          "Use --skip-validation to downgrade to warnings.";
        result.phases.hostValidation = { exitCode: 1, message: msg };
        result.exitCode = 1;
        result.message = msg;
        return result;
      }

      result.phases.hostValidation = {
        exitCode: 0,
        message: validationResult.warnCount > 0
          ? `Passed with ${validationResult.warnCount} warning(s)`
          : `All ${validationResult.checks.length} check(s) passed`,
      };
    }
  }

  // ── Phase 0c: User config loading ──
  let userMountDeclarations: Record<string, import("./feature-metadata").LaceMountDeclaration> = {};
  let userConfigDefaultShell: string | undefined;
  {
    try {
      const userConfig = loadUserConfig();
      const hasUserConfig = Object.keys(userConfig).length > 0;

      if (hasUserConfig) {
        console.log("Loading user config...");

        // Validate mount sources against mount policy
        if (userConfig.mounts && Object.keys(userConfig.mounts).length > 0) {
          const policyRules = loadMountPolicy();
          const mountValidation = validateMountSources(userConfig.mounts, policyRules);

          // Emit warnings for skipped mounts
          for (const warning of mountValidation.warnings) {
            console.warn(`Warning: ${warning}`);
          }

          // Hard error for blocked mounts
          if (mountValidation.errors.length > 0) {
            const msg = mountValidation.errors.join("\n\n");
            result.exitCode = 1;
            result.message = msg;
            return result;
          }

          // Replace user mounts with validated subset
          userConfig.mounts = mountValidation.valid;
        }

        // Validate feature references (no local paths)
        if (userConfig.features && Object.keys(userConfig.features).length > 0) {
          const featureValidation = validateFeatureReferences(userConfig.features);
          if (!featureValidation.valid) {
            const msg = featureValidation.errors.join("\n");
            result.exitCode = 1;
            result.message = msg;
            return result;
          }
        }

        // Extract project features and prebuild features for merging
        const projectFeatures = (configMinimal.raw.features ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const projectPrebuild = extractPrebuildFeaturesRaw(configMinimal.raw);
        const projectContainerEnv = (configMinimal.raw.containerEnv ?? {}) as Record<string, string>;

        // Apply all merges
        const mergeResult = applyUserConfig(
          userConfig,
          projectFeatures,
          projectPrebuild,
          projectContainerEnv,
        );

        // Apply merged features back to config
        configMinimal.raw.features = mergeResult.mergedFeatures;
        if (Object.keys(mergeResult.mergedPrebuildFeatures).length > 0) {
          const customizations = (configMinimal.raw.customizations ?? {}) as Record<string, unknown>;
          const lace = (customizations.lace ?? {}) as Record<string, unknown>;
          lace.prebuildFeatures = mergeResult.mergedPrebuildFeatures;
          customizations.lace = lace;
          configMinimal.raw.customizations = customizations;
        }

        // Apply merged containerEnv
        configMinimal.raw.containerEnv = mergeResult.mergedContainerEnv;

        // Store user mount declarations for later merge with pipeline declarations
        userMountDeclarations = mergeResult.userMountDeclarations;

        // Store default shell for fundamentals feature integration
        userConfigDefaultShell = mergeResult.defaultShell;

        // Emit merge warnings
        for (const warning of mergeResult.warnings) {
          console.warn(`Warning: ${warning}`);
        }

        const parts: string[] = [];
        if (Object.keys(userMountDeclarations).length > 0) {
          parts.push(`${Object.keys(userMountDeclarations).length} mount(s)`);
        }
        if (userConfig.features && Object.keys(userConfig.features).length > 0) {
          parts.push(`${Object.keys(userConfig.features).length} feature(s)`);
        }
        if (userConfig.git) {
          parts.push("git identity");
        }
        if (parts.length > 0) {
          console.log(`User config applied: ${parts.join(", ")}`);
        }
      }
    } catch (err) {
      if (err instanceof UserConfigError) {
        result.exitCode = 1;
        result.message = err.message;
        return result;
      }
      throw err;
    }
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

  // Also collect prebuild features for port pipeline processing
  const rawPrebuildFeatures = extractPrebuildFeaturesRaw(configMinimal.raw);

  // Unified feature set for the port pipeline (metadata + auto-injection + resolution)
  const allRawFeatures = { ...rawFeatures, ...rawPrebuildFeatures };
  const allFeatureIds = Object.keys(allRawFeatures);

  // ── Phase: Metadata fetch + validation + auto-injection + template resolution ──
  // This replaces the old hardcoded port assignment phase.
  let metadataMap: Map<string, FeatureMetadata | null> = new Map();
  let templateResult: TemplateResolutionResult | null = null;
  let featurePortMetadata: Map<string, FeaturePortDeclaration> | null = null;

  if (allFeatureIds.length > 0) {
    // Step 1: Fetch feature metadata
    console.log("Fetching feature metadata...");
    try {
      metadataMap = await fetchAllFeatureMetadata(allFeatureIds, {
        noCache,
        skipValidation: skipMetadataValidation,
        subprocess,
        cacheDir,
        configDir: configMinimal.configDir,
      });

      // Validate each feature's options and port declarations
      for (const [featureId, metadata] of metadataMap) {
        if (!metadata) continue; // null when skipValidation=true and both annotation + blob fallback fail

        // Validate user-provided options exist in schema
        const optionResult = validateFeatureOptions(
          featureId,
          allRawFeatures[featureId] ?? {},
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
        message: `Validated metadata for ${allFeatureIds.length} feature(s)`,
      };
      console.log(
        `Validated metadata for ${allFeatureIds.length} feature(s)`,
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

  // Step 4: Auto-inject mount templates from project + feature declarations
  const projectMountDeclarations = extractProjectMountDeclarations(configForResolution);
  const { injected: mountInjected, declarations: mountDeclarations } =
    autoInjectMountTemplates(configForResolution, projectMountDeclarations, metadataMap);
  if (mountInjected.length > 0) {
    console.log(`Auto-injected mount templates for: ${mountInjected.join(", ")}`);
  }

  // Step 4.1: Merge user mount declarations into the pipeline
  // User mounts need both: (a) declaration entries and (b) template injection
  if (Object.keys(userMountDeclarations).length > 0) {
    Object.assign(mountDeclarations, userMountDeclarations);

    // Auto-inject ${lace.mount(user/...)} templates for each user mount
    const mounts = (configForResolution.mounts ?? []) as string[];
    for (const label of Object.keys(userMountDeclarations)) {
      const alreadyReferenced = mounts.some((m: string) => m.includes(label));
      if (!alreadyReferenced) {
        mounts.push(`\${lace.mount(${label})}`);
      }
    }
    configForResolution.mounts = mounts;
  }

  // Step 4.5: Deduplicate static mounts that conflict with auto-injected declarations
  const deduplicatedTargets = deduplicateStaticMounts(configForResolution, mountDeclarations);
  if (deduplicatedTargets.length > 0) {
    console.log(
      `Deduplicated static mount(s) superseded by declarations: ${deduplicatedTargets.join(", ")}`,
    );
  }

  // Step 5: Determine container remote user for variable resolution in mount targets.
  // This resolves ${_REMOTE_USER} and ${containerWorkspaceFolder} in declaration
  // targets so that mount specs contain concrete paths (not template strings).
  // Done before conflict validation so that targets like /home/${_REMOTE_USER}/.claude
  // and /home/node/.claude are correctly detected as conflicts when remoteUser=node.
  const remoteUser = extractRemoteUser(configMinimal.raw, configMinimal.configDir);
  const containerVars: ContainerVariables = {
    remoteUser,
    containerWorkspaceFolder:
      typeof configMinimal.raw.workspaceFolder === "string"
        ? configMinimal.raw.workspaceFolder
        : undefined,
  };

  // Step 5.5: Validate mount declarations
  if (Object.keys(mountDeclarations).length > 0) {
    // Build set of known feature short IDs for namespace validation
    const features = (configForResolution.features ?? {}) as Record<string, unknown>;
    const prebuildFeatures = extractPrebuildFeaturesRaw(configForResolution);
    const featureShortIds = new Set<string>();
    for (const ref of [...Object.keys(features), ...Object.keys(prebuildFeatures)]) {
      featureShortIds.add(extractFeatureShortId(ref));
    }
    try {
      validateMountNamespaces(mountDeclarations, featureShortIds);
      // Validate conflicts on resolved targets so that template variables
      // like ${_REMOTE_USER} are compared as concrete paths.
      const resolvedDeclarations = Object.fromEntries(
        Object.entries(mountDeclarations).map(([label, decl]) => {
          let target = decl.target;
          target = target.replace(/\$\{_REMOTE_USER\}/g, containerVars.remoteUser);
          if (containerVars.containerWorkspaceFolder) {
            target = target.replace(/\$\{containerWorkspaceFolder\}/g, containerVars.containerWorkspaceFolder);
          }
          return [label, { ...decl, target }];
        }),
      );
      validateMountTargetConflicts(resolvedDeclarations);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.exitCode = 1;
      result.message = `Mount validation failed: ${message}`;
      result.phases.templateResolution = {
        exitCode: 1,
        message: `Mount validation failed: ${message}`,
      };
      return result;
    }
  }

  // Step 6: Warn about prebuild features with static port values and no appPort
  const staticPortWarnings = warnPrebuildPortFeaturesStaticPort(
    configForResolution,
    metadataMap,
    injected,
  );
  for (const warning of staticPortWarnings) {
    console.warn(`Warning: ${warning}`);
  }

  // Step 7: Create mount path resolver for ${lace.mount()} resolution
  let settings: LaceSettings = {};
  try {
    settings = loadSettings();
  } catch (err) {
    if (err instanceof SettingsConfigError) {
      console.warn(`Warning: ${err.message}. Mount overrides will not apply.`);
    } else {
      throw err;
    }
  }

  const mountResolver = new MountPathResolver(workspaceFolder, settings, mountDeclarations, containerVars);

  // Step 7.5: Validate sourceMustBe declarations before template resolution
  if (Object.keys(mountDeclarations).length > 0) {
    const validatedMounts = Object.entries(mountDeclarations)
      .filter(([, decl]) => decl.sourceMustBe);

    if (validatedMounts.length > 0) {
      const validationErrors: string[] = [];
      for (const [label] of validatedMounts) {
        try {
          mountResolver.resolveSource(label);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (skipValidation) {
            console.warn(
              `Warning: ${message}\n` +
                `  Docker will create a directory at this path, which will silently break the mount.`,
            );
          } else {
            validationErrors.push(message);
          }
        }
      }

      if (validationErrors.length > 0) {
        const msg = validationErrors.join("\n\n");
        result.exitCode = 1;
        result.message = msg;
        result.phases.templateResolution = {
          exitCode: 1,
          message: `Validated mount check failed`,
        };
        return result;
      }
    }
  }

  // Step 8: Resolve all templates (auto-injected + user-written)
  const ownedPorts = getContainerHostPorts(workspaceFolder, subprocess);
  const portAllocator = new PortAllocator(workspaceFolder, ownedPorts);
  try {
    templateResult = await resolveTemplates(configForResolution, portAllocator, mountResolver);
    portAllocator.save(); // Persist assignments after successful resolution
    mountResolver.save(); // Persist mount assignments after successful resolution

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

    if (templateResult.allocations.length > 0 || templateResult.mountAssignments.length > 0) {
      const parts: string[] = [];
      if (templateResult.allocations.length > 0) {
        parts.push(`${templateResult.allocations.length} port template(s)`);
      }
      if (templateResult.mountAssignments.length > 0) {
        parts.push(`${templateResult.mountAssignments.length} mount template(s)`);
      }
      result.phases.templateResolution = {
        exitCode: 0,
        message: `Resolved ${parts.join(" and ")}`,
      };
    }

    if (templateResult.mountAssignments.length > 0) {
      const mountSummary = templateResult.mountAssignments
        .map((a) => `  ${a.label}: ${a.resolvedSource}${a.isOverride ? ' (override)' : ''}`)
        .join("\n");
      console.log(`Resolved mount sources:\n${mountSummary}`);

      // Emit guided config for default-path mounts
      emitMountGuidance(mountDeclarations, templateResult.mountAssignments);
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


  // ── Phase 3+: Inferred mount validation ──
  // After template resolution, scan resolved mounts for missing bind-mount sources.
  // These are warnings only — Docker auto-creates missing directory sources.
  {
    const resolvedConfig = templateResult?.resolvedConfig ?? configForResolution;
    const resolvedMounts = (resolvedConfig.mounts ?? []) as string[];
    for (const mount of resolvedMounts) {
      if (!mount.includes('type=bind')) continue;
      const sourceMatch = mount.match(/source=([^,]+)/);
      const targetMatch = mount.match(/target=([^,]+)/);
      if (!sourceMatch) continue;
      const source = sourceMatch[1];
      if (source.includes('${')) continue; // Skip devcontainer variables
      if (!existsSync(source)) {
        const target = targetMatch?.[1] ?? 'unknown';
        console.warn(
          `Warning: Bind mount source does not exist: ${source} (target: ${target})\n` +
          `  → Docker will auto-create this as a root-owned directory, which may cause permission issues.`,
        );
      }
    }
    // Also check workspaceMount if it's a concrete bind mount
    const wsMount = resolvedConfig.workspaceMount;
    if (typeof wsMount === 'string' && wsMount.includes('type=bind')) {
      const sourceMatch = wsMount.match(/source=([^,]+)/);
      const targetMatch = wsMount.match(/target=([^,]+)/);
      if (sourceMatch) {
        const source = sourceMatch[1];
        if (!source.includes('${') && !existsSync(source)) {
          const target = targetMatch?.[1] ?? 'unknown';
          console.warn(
            `Warning: Bind mount source does not exist: ${source} (target: ${target})\n` +
            `  → This is the workspace mount. The container may not function properly without it.`,
          );
        }
      }
    }
  }

  // ── Phase: Fundamentals feature integration ──
  // Detect lace-fundamentals and apply user config to its options.
  {
    const resolvedConfig = templateResult?.resolvedConfig ?? configForResolution;
    const allFeatureRefs = [
      ...Object.keys((resolvedConfig.features ?? {}) as Record<string, unknown>),
      ...Object.keys(extractPrebuildFeaturesRaw(resolvedConfig)),
    ];

    const fundamentalsRef = allFeatureRefs.find((ref) =>
      extractFeatureShortId(ref) === "lace-fundamentals",
    );

    if (fundamentalsRef) {
      // Inject defaultShell option from user config
      if (userConfigDefaultShell) {
        const features = (resolvedConfig.features ?? {}) as Record<string, Record<string, unknown>>;
        const prebuildFeatures = extractPrebuildFeaturesRaw(resolvedConfig);

        if (features[fundamentalsRef]) {
          if (!features[fundamentalsRef].defaultShell) {
            features[fundamentalsRef].defaultShell = userConfigDefaultShell;
          }
        } else if (prebuildFeatures[fundamentalsRef]) {
          if (!prebuildFeatures[fundamentalsRef].defaultShell) {
            prebuildFeatures[fundamentalsRef].defaultShell = userConfigDefaultShell;
            // Write back to resolvedConfig
            const customizations = (resolvedConfig.customizations ?? {}) as Record<string, unknown>;
            const lace = (customizations.lace ?? {}) as Record<string, unknown>;
            lace.prebuildFeatures = prebuildFeatures;
            customizations.lace = lace;
            resolvedConfig.customizations = customizations;
            // Also propagate to configMinimal.raw so prebuild picks it up.
            // NOTE: This relies on shared object references through the extraction chain.
            // If configMinimal.raw is ever deep-cloned before this point, this mutation
            // would silently stop working. A refactor to pass options explicitly would be safer.
            const minCustomizations = (configMinimal.raw.customizations ?? {}) as Record<string, unknown>;
            const minLace = (minCustomizations.lace ?? {}) as Record<string, unknown>;
            const minPrebuild = (minLace.prebuildFeatures ?? {}) as Record<string, Record<string, unknown>>;
            if (minPrebuild[fundamentalsRef]) {
              minPrebuild[fundamentalsRef].defaultShell = userConfigDefaultShell;
            }
          }
        }
        console.log(`Injected defaultShell="${userConfigDefaultShell}" into lace-fundamentals`);
      }

      // Auto-inject lace-fundamentals-init into postCreateCommand
      const postCreate = resolvedConfig.postCreateCommand;
      const initCmd = "lace-fundamentals-init";

      const alreadyHasInit = (() => {
        if (typeof postCreate === "string") return postCreate.includes(initCmd);
        if (typeof postCreate === "object" && postCreate !== null) {
          return Object.values(postCreate as Record<string, unknown>).some((v) => {
            if (typeof v === "string") return v.includes(initCmd);
            if (Array.isArray(v)) return v.some((s) => String(s).includes(initCmd));
            return false;
          });
        }
        return false;
      })();

      if (!alreadyHasInit) {
        if (!postCreate) {
          resolvedConfig.postCreateCommand = initCmd;
        } else if (typeof postCreate === "string") {
          resolvedConfig.postCreateCommand = `${initCmd} && ${postCreate}`;
        } else if (typeof postCreate === "object" && postCreate !== null) {
          resolvedConfig.postCreateCommand = {
            "lace-fundamentals": initCmd,
            ...(postCreate as Record<string, unknown>),
          };
        }
        console.log("Auto-injected lace-fundamentals-init into postCreateCommand");
      }

      // Inject LACE_DOTFILES_PATH from resolved dotfiles mount target
      const dotfilesMountDecl = mountDeclarations["lace-fundamentals/dotfiles"];
      if (dotfilesMountDecl?.target) {
        const env = ((resolvedConfig.containerEnv ?? {}) as Record<string, string>);
        if (!env.LACE_DOTFILES_PATH) {
          env.LACE_DOTFILES_PATH = dotfilesMountDecl.target;
          resolvedConfig.containerEnv = env;
          console.log(`Injected LACE_DOTFILES_PATH="${dotfilesMountDecl.target}" into containerEnv`);
        }
      }
    }
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
    // Pass merged prebuild features (includes user features) to avoid re-reading source file
    const mergedPrebuild = extractPrebuildFeatures(configMinimal.raw);
    const prebuildResult = runPrebuild({
      workspaceRoot: workspaceFolder,
      subprocess,
      force: rebuild,
      prebuildFeatures: mergedPrebuild.kind === "features" ? mergedPrebuild.features : undefined,
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
      projectName,
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

  // Phase: Config drift detection
  // Read the generated extended config and compare its runtime fingerprint
  // against the previous run. When drift is detected, auto-recreate the
  // container so runtime config changes (mounts, env, workspace paths) take
  // effect without requiring the heavier --rebuild (which also forces a
  // prebuild image rebuild with --no-cache).
  let currentFingerprint: string | undefined;
  let recreateContainer = false;
  {
    const extendedConfigPath = join(workspaceFolder, ".lace", "devcontainer.json");
    try {
      const extendedConfig = JSON.parse(
        readFileSync(extendedConfigPath, "utf-8"),
      ) as Record<string, unknown>;

      if (rebuild) {
        deleteRuntimeFingerprint(workspaceFolder);
      }

      const drift = checkConfigDrift(extendedConfig, workspaceFolder);
      currentFingerprint = drift.currentFingerprint;

      if (drift.drifted) {
        recreateContainer = true;
        if (rebuild) {
          console.log(
            "Runtime config changed; container will be recreated (--rebuild).",
          );
        } else {
          console.log(
            "Runtime config changed; container will be recreated.",
          );
        }
      }
    } catch {
      // If the config can't be read (shouldn't happen since we just wrote it),
      // skip drift detection silently. Consequence: currentFingerprint remains
      // undefined, so no fingerprint is written after devcontainer up, and the
      // next run will not detect drift from this session.
    }
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
    removeExistingContainer: rebuild || recreateContainer,
  });

  result.phases.devcontainerUp = upResult;

  if (upResult.exitCode !== 0) {
    result.exitCode = upResult.exitCode;
    result.message = `devcontainer up failed: ${upResult.stderr}`;
    console.error(upResult.stderr);
    return result;
  }

  // Write the runtime fingerprint after successful container creation.
  // This ensures the fingerprint reflects actual container state.
  if (currentFingerprint) {
    writeRuntimeFingerprint(workspaceFolder, currentFingerprint);
  }

  // ── Phase: Post-container verification ──
  // Runs after devcontainer up on the running container.
  // Covers all configs (prebuild and non-prebuild) uniformly.
  {
    const classResult = classifyWorkspace(workspaceFolder);
    const extensions = getDetectedExtensions(classResult, workspaceFolder);

    if (extensions) {
      // Read the generated extended config to resolve the container name
      const extendedConfigPath = join(workspaceFolder, ".lace", "devcontainer.json");
      let configExtended: Record<string, unknown> = {};
      try {
        configExtended = JSON.parse(readFileSync(extendedConfigPath, "utf-8")) as Record<string, unknown>;
      } catch {
        // Fall back to empty config -- resolveContainerName will use sanitized projectName
      }

      const containerName = resolveContainerName(projectName, configExtended);

      const verification = verifyContainerGitVersion(
        containerName,
        extensions,
        subprocess,
      );

      const verificationMsg = verification.passed
        ? `Container git ${verification.gitVersion} supports all ` +
          `detected extensions`
        : verification.checks
            .filter((c) => !c.supported)
            .map((c) => c.message)
            .join("\n");

      if (!verification.passed && !skipValidation) {
        result.phases.containerVerification = {
          exitCode: 1,
          message: verificationMsg,
        };
        result.exitCode = 1;
        result.message =
          `Container verification failed: ${verificationMsg}`;
        return result;
      }

      if (!verification.passed && skipValidation) {
        result.phases.containerVerification = {
          exitCode: 0,
          message: `${verificationMsg} (downgraded)`,
        };
        console.warn(
          `Warning: ${verificationMsg} ` +
            "(continuing due to --skip-validation)",
        );
      }

      if (verification.passed) {
        result.phases.containerVerification = {
          exitCode: 0,
          message: verificationMsg,
        };
        console.log(verificationMsg);
      }
    }
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
  projectName?: string;
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

  // Rewrite build.dockerfile path to be relative to the .lace/ output directory
  // instead of the original .devcontainer/ directory. The devcontainer CLI resolves
  // the dockerfile path relative to the config file's location.
  const devcontainerDir = join(workspaceFolder, ".devcontainer");
  const laceDir = join(workspaceFolder, ".lace");
  const build = extended.build as
    | Record<string, unknown>
    | undefined;
  if (build?.dockerfile && typeof build.dockerfile === "string") {
    const originalDockerfilePath = resolve(devcontainerDir, build.dockerfile);
    build.dockerfile = relative(laceDir, originalDockerfilePath);
    extended.build = build;
  } else if (
    extended.dockerfile &&
    typeof extended.dockerfile === "string"
  ) {
    // Legacy `dockerfile` field (not nested in `build`)
    const originalDockerfilePath = resolve(
      devcontainerDir,
      extended.dockerfile as string,
    );
    extended.dockerfile = relative(laceDir, originalDockerfilePath);
  }

  // Also rewrite build.context if it is relative (resolve from .devcontainer/, rewrite for .lace/)
  if (build?.context && typeof build.context === "string" && !build.context.startsWith("/")) {
    const originalContextPath = resolve(devcontainerDir, build.context);
    build.context = relative(laceDir, originalContextPath);
    extended.build = build;
  }

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
      // Array format: ["command", "arg1", "arg2"] means direct-exec (no shell).
      // Joining with spaces and chaining via && would change semantics to shell
      // execution. Instead, use the object format to preserve the array as-is.
      extended.postCreateCommand = {
        "lace:user-setup": existing,
        "lace:symlinks": symlinkCommand,
      };
    } else if (typeof existing === "object") {
      // Object format: { "name": ["command", "args"] }
      // Add our symlink command as a new entry
      extended.postCreateCommand = {
        ...(existing as Record<string, unknown>),
        "lace-symlinks": ["sh", "-c", symlinkCommand],
      };
    }
  }

  // Inject project name as Docker label and container name
  if (options.projectName) {
    const runArgs = (extended.runArgs ?? []) as string[];
    runArgs.push("--label", `lace.project_name=${options.projectName}`);
    const sanitized = sanitizeContainerName(options.projectName);
    if (!hasRunArgsFlag(runArgs, "--name")) {
      runArgs.push("--name", sanitized);
    }
    extended.runArgs = runArgs;
  }

  // Auto-inject standard container env vars for feature workspace awareness.
  // These are universally useful and have no downside. User-defined values
  // take precedence (no overwrite).
  const containerEnv = (extended.containerEnv ?? {}) as Record<string, string>;
  if (
    typeof extended.workspaceFolder === "string" &&
    !containerEnv.CONTAINER_WORKSPACE_FOLDER
  ) {
    containerEnv.CONTAINER_WORKSPACE_FOLDER = extended.workspaceFolder;
  }
  if (options.projectName && !containerEnv.LACE_PROJECT_NAME) {
    containerEnv.LACE_PROJECT_NAME = options.projectName;
  }
  extended.containerEnv = containerEnv;

  // Write extended config
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
  removeExistingContainer?: boolean;
}

/**
 * Invoke devcontainer up with the appropriate configuration.
 */
function runDevcontainerUp(
  options: RunDevcontainerUpOptions,
): SubprocessResult {
  const { workspaceFolder, subprocess, devcontainerArgs, useExtendedConfig,
          removeExistingContainer } = options;

  const args = ["up"];

  if (removeExistingContainer) {
    args.push("--remove-existing-container");
  }

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
