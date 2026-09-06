// IMPLEMENTATION_VALIDATION -- Documented in CONTRIBUTING.md
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as jsonc from "jsonc-parser";
import {
  readDevcontainerConfigMinimal,
  extractRepoMounts,
  extractRemoteUser,
  DevcontainerConfigError,
} from "./devcontainer";
import { runResolveMounts } from "./resolve-mounts";
import type { RunSubprocess, SubprocessResult } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";
import {
  fetchAllFeatureMetadata,
  validateFeatureOptions,
  validatePortDeclarations,
  MetadataFetchError,
  type FeatureMetadata,
} from "./feature-metadata";
import { PortAllocator, isPortAvailable } from "./port-allocator";
import type { PortAllocation, FeaturePortDeclaration } from "./port-allocator";
import { getAllPublishedHostPorts } from "./podman-ports";
import {
  resolveLedgerPath,
  loadLedger,
  saveLedger,
  reconcileLedger,
  computeExclusions,
  describeExclusions,
  upsertAssignments,
  withLedgerLock,
  type PortLedger,
} from "./port-ledger";
import { checkPortlessAliases } from "./portless-alias-check";
import {
  defaultHostPortlessIO,
  ensureHostPortless,
  registerHostPortlessAlias,
  type HostPortlessRuntime,
} from "./host-portless";
import { extractLaceCustomizations } from "./feature-metadata";
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
import { deriveProjectName, sanitizeContainerName, hasRunArgsFlag, resolveContainerName, canonicalizeWorkspaceFolder } from "./project-name";
import { classifyWorkspace, getDetectedExtensions, verifyContainerGitVersion } from "./workspace-detector";
import {
  checkConfigDrift,
  writeRuntimeFingerprint,
  deleteRuntimeFingerprint,
} from "./config-drift";
import { getPodmanCommand } from "./container-runtime";
import { RunLog } from "./run-log";

/**
 * Wait up to `timeoutMs` for the given port to start accepting TCP connections.
 * Returns true if the port was bound within the timeout, false otherwise.
 *
 * Used to give a freshly-spawned host portless daemon a moment to bind
 * before shelling out alias commands against it.
 */
async function waitForPortBound(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await isPortAvailable(port, 50);
    if (!free) return true; // port is bound
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Query the container runtime for host ports held by this workspace's running container.
 * Returns a Set of host port numbers, or an empty set if no container is
 * running or the runtime is unavailable.
 */
export function getContainerHostPorts(
  workspaceFolder: string,
  subprocess: RunSubprocess,
): Set<number> {
  // Find running container by devcontainer label
  const psResult = subprocess(getPodmanCommand(), [
    "ps", "-q",
    "--filter", `label=devcontainer.local_folder=${workspaceFolder}`,
  ]);
  const containerId = psResult.stdout.trim().split("\n")[0]?.trim();
  if (!containerId || psResult.exitCode !== 0) return new Set();

  // Get port bindings
  const portResult = subprocess(getPodmanCommand(), ["port", containerId]);
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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Allocate this project's ports with best-effort cross-project coordination.
 *
 * The global port ledger is an ENHANCEMENT, not a hard dependency. Every part
 * of the coordination path is fail-safe: if podman enumeration, lock
 * acquisition, ledger read/reconcile, or ledger persistence fails for ANY
 * reason (podman missing or erroring, an unstubbed `podman ps -a`, a lock the
 * process cannot create, a corrupt or unwritable ledger), the allocation
 * degrades to today's behavior: an empty exclusion set, no ledger write, and
 * the pipeline proceeds. Only `runResolve` (the actual template/port
 * resolution) may fail the caller; a ledger problem never does and never
 * changes the exit code.
 *
 * When the lock and ledger are available, the lock spans `runResolve` so a
 * concurrent `lace up` waits and allocates around the committed reservation.
 * `runResolve` receives the computed exclusion set as its second argument so
 * callers (and tests) can observe what was excluded.
 */
export async function coordinatePortAllocation(params: {
  workspaceFolder: string;
  subprocess: RunSubprocess;
  ownedPorts: Set<number>;
  ledgerPath: string;
  runResolve: (
    allocator: PortAllocator,
    exclusions: Set<number>,
  ) => Promise<TemplateResolutionResult>;
}): Promise<TemplateResolutionResult> {
  const { workspaceFolder, subprocess, ownedPorts, ledgerPath, runResolve } = params;

  let allocationStarted = false;
  const allocate = async (
    exclusions: Set<number>,
    exclusionHolders: Map<number, string>,
  ): Promise<{ tr: TemplateResolutionResult; allocations: PortAllocation[] }> => {
    const allocator = new PortAllocator(workspaceFolder, {
      ownedPorts,
      exclusions,
      exclusionHolders,
    });
    allocationStarted = true;
    const tr = await runResolve(allocator, exclusions);
    return { tr, allocations: allocator.getAllocations() };
  };

  try {
    return await withLedgerLock(ledgerPath, async () => {
      // Best-effort read + reconcile. Any failure degrades to empty exclusions.
      let exclusions = new Set<number>();
      let exclusionHolders = new Map<number, string>();
      let reconciled: PortLedger | null = null;
      try {
        const live = getAllPublishedHostPorts(subprocess);
        reconciled = reconcileLedger(loadLedger(ledgerPath), live, existsSync, new Date());
        exclusions = computeExclusions(reconciled, live, workspaceFolder);
        exclusionHolders = describeExclusions(reconciled, live, workspaceFolder);
      } catch (err) {
        console.warn(
          `Warning: cross-project port ledger unavailable; continuing without cross-project exclusions: ${errMessage(err)}`,
        );
        reconciled = null;
      }

      const { tr, allocations } = await allocate(exclusions, exclusionHolders);

      // Best-effort persist. A write failure never fails the pipeline.
      if (reconciled) {
        try {
          saveLedger(
            ledgerPath,
            upsertAssignments(reconciled, workspaceFolder, allocations, new Date()),
          );
        } catch (err) {
          console.warn(
            `Warning: could not persist cross-project port ledger; continuing: ${errMessage(err)}`,
          );
        }
      }
      return tr;
    });
  } catch (err) {
    // A failure AT OR AFTER allocation is a genuine resolution error: propagate.
    if (allocationStarted) throw err;
    // Otherwise the lock itself was unavailable (contention timeout, unwritable
    // config dir, etc). Degrade to an unlocked, exclusion-free allocation so
    // `lace up` still succeeds exactly as it did before the ledger existed.
    console.warn(
      `Warning: cross-project port ledger lock unavailable; continuing without cross-project coordination: ${errMessage(err)}`,
    );
    return (await allocate(new Set(), new Map())).tr;
  }
}

/** Whether the project's container is clearly running, clearly not, or unknown. */
export type ContainerRunState = "running" | "not-running" | "unknown";

/**
 * Probe whether the container with the resolved name is currently running.
 *
 * Name-scoped (`name=^<name>$`) and status-scoped (`status=running`) so the
 * probe cannot false-positive on an unrelated container. Any podman error, or a
 * thrown subprocess, yields "unknown" so the caller can fail safe: on an
 * ambiguous signal, never auto-rebuild a container that might be live.
 */
export function probeContainerRunning(
  containerName: string,
  subprocess: RunSubprocess,
): ContainerRunState {
  try {
    const result = subprocess(getPodmanCommand(), [
      "ps",
      "--filter", `name=^${containerName}$`,
      "--filter", "status=running",
      "--format", "{{.ID}}",
    ]);
    if (result.exitCode !== 0) return "unknown";
    return result.stdout.trim() !== "" ? "running" : "not-running";
  } catch {
    return "unknown";
  }
}

/**
 * Label-guarded teardown of a stale container before `devcontainer up` recreates.
 *
 * Removes a container holding the resolved `containerName` ONLY when it also
 * carries lace's own `lace.project_name=<projectName>` label (stamped on every
 * container lace creates). The label guard means a container that merely shares
 * the sanitized name but was NOT created by lace for this project is never
 * destroyed. Closes the stale-`/home`-label survivor case that our-side
 * canonicalization structurally cannot match, plus the name-collision that the
 * CLI's own removal misses.
 *
 * Tolerates "no such container": the name-and-label filter simply returns
 * nothing. A probe failure is swallowed. WARNs on stderr only when a teardown
 * actually removes something, for traceability.
 */
export function teardownStaleContainer(
  containerName: string,
  projectName: string,
  subprocess: RunSubprocess,
): void {
  let ids: string[] = [];
  try {
    const ps = subprocess(getPodmanCommand(), [
      "ps", "-aq",
      "--filter", `name=^${containerName}$`,
      "--filter", `label=lace.project_name=${projectName}`,
    ]);
    if (ps.exitCode !== 0) return; // tolerate probe failure: leave the CLI to handle it
    ids = ps.stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return;
  }
  if (ids.length === 0) return; // nothing lace-owned under this name: nothing to tear down

  try {
    subprocess(getPodmanCommand(), ["rm", "-f", ...ids]);
  } catch {
    return; // best-effort: the CLI's --remove-existing-container is the fallback
  }
  // WARN(claude-opus-4-8/lace/up-path-fixes): a teardown actually fired.
  console.warn(
    `Warning: removed stale lace container(s) [${ids.join(", ")}] named ` +
      `"${containerName}" (label lace.project_name=${projectName}) before recreate.`,
  );
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
  /** Force container recreation and bypass config-drift caching. */
  rebuild?: boolean;
  /** Validate only: skip the devcontainer up phase (for `lace validate`). */
  validateOnly?: boolean;
}

// Documented in CONTRIBUTING.md -- update if changing this pattern
export interface UpResult {
  exitCode: number;
  message: string;
  /** Absolute path to the run log file, if log persistence succeeded. */
  logPath?: string;
  /** Derived project name (e.g., "whelm"). Available after workspace classification. */
  projectName?: string;
  phases: {
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
    portAssignment?: { exitCode: number; message: string; port?: number };
    metadataValidation?: { exitCode: number; message: string };
    templateResolution?: { exitCode: number; message: string };
    mountValidation?: { exitCode: number; message: string };
    resolveMounts?: { exitCode: number; message: string };
    generateConfig?: { exitCode: number; message: string };
    devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
    containerVerification?: { exitCode: number; message: string };
  };
}

/**
 * Run the full lace up workflow:
 * 1. Read config (before template resolution)
 * 2. Fetch feature metadata (required for auto-injection)
 * 3. Auto-inject ${lace.port()} templates + resolve all templates
 * 4. Resolve mounts (if repo mounts configured)
 * 5. Generate extended devcontainer.json (includes resolved ports + mounts)
 * 6. Invoke devcontainer up
 */
export async function runUp(options: UpOptions = {}): Promise<UpResult> {
  const {
    workspaceFolder: rawWorkspaceFolder = process.cwd(),
    subprocess = defaultRunSubprocess,
    devcontainerArgs = [],
    skipDevcontainerUp = false,
    noCache = false,
    skipMetadataValidation = false,
    cacheDir,
    skipValidation = false,
    rebuild = false,
    validateOnly = false,
  } = options;

  // ── Canonicalize the workspace path ONCE, before any identity is derived. ──
  // Every downstream consumer of container identity (the devcontainer.local_folder
  // label filter, the `--workspace-folder` argument, and deriveProjectName) reads
  // this single canonical value, so they cannot disagree on a symlinked or
  // otherwise-aliased path. See canonicalizeWorkspaceFolder for the rationale.
  const workspaceFolder = canonicalizeWorkspaceFolder(rawWorkspaceFolder);

  const runLog = new RunLog(workspaceFolder, devcontainerArgs);

  const result: UpResult = {
    exitCode: 0,
    message: "",
    logPath: runLog.getLogPath(),
    phases: {},
  };

  /** Finalize the run log before returning. Wraps in try/catch: never affects result. */
  function finalizeLog(): void {
    try {
      // Log all recorded phases from result
      for (const [name, phase] of Object.entries(result.phases)) {
        if (!phase) continue;
        runLog.logPhase({
          name,
          status: phase.exitCode === 0 ? "pass" : "fail",
          message: "message" in phase ? (phase as { message: string }).message : undefined,
        });
      }
      runLog.finalize({ exitCode: result.exitCode, message: result.message });
    } catch {
      // Never affect the caller
    }
  }

  try {

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
      result.exitCode = 1;
      result.message = err.message;
      return result;
    }
    throw err;
  }

  // ── Fail loud on the removed `prebuildFeatures` key ──
  // `lace prebuild` and `customizations.lace.prebuildFeatures` were removed in favour of
  // the legacy builder's local layer cache. A config still carrying the key would silently
  // drop those features, so surface an actionable migration error instead.
  {
    const customizations = configMinimal.raw.customizations as
      | Record<string, unknown>
      | undefined;
    const lace = customizations?.lace as Record<string, unknown> | undefined;
    if (lace && "prebuildFeatures" in lace) {
      result.exitCode = 1;
      result.message =
        "customizations.lace.prebuildFeatures is no longer supported. " +
        "Move these entries into the top-level `features` map in .devcontainer/devcontainer.json. " +
        "See cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md for the migration.";
      return result;
    }
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
    result.projectName = projectName;
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

        // Extract project features for merging
        const projectFeatures = (configMinimal.raw.features ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const projectContainerEnv = (configMinimal.raw.containerEnv ?? {}) as Record<string, string>;

        // Apply all merges
        const mergeResult = applyUserConfig(
          userConfig,
          projectFeatures,
          projectContainerEnv,
        );

        // Apply merged features back to config
        configMinimal.raw.features = mergeResult.mergedFeatures;

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

  const repoMountsResult = extractRepoMounts(configMinimal.raw);
  const hasRepoMounts = repoMountsResult.kind === "repoMounts";

  // Extract feature IDs from the devcontainer.json's `features` key
  const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const allFeatureIds = Object.keys(rawFeatures);

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
    const featureShortIds = new Set<string>();
    for (const ref of Object.keys(features)) {
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

  const mountResolver = new MountPathResolver(workspaceFolder, settings, mountDeclarations, containerVars, projectName);

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
                `  The container runtime will create a directory at this path, which will silently break the mount.`,
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
  //
  // Coordinated cross-project allocation: within a single cross-process ledger
  // lock, enumerate every podman-published host port machine-wide, reconcile
  // the global ledger (GC + live-podman-wins ownership), compute the exclusion
  // set for this project (ledger-other-projects union live-non-current), seed
  // the per-project allocator with it, resolve, then persist the reconciled +
  // upserted ledger atomically. The lock spans resolveTemplates (and its TCP
  // probes), so a concurrent `lace up` waits and allocates around our committed
  // reservation instead of racing it.
  const ownedPorts = getContainerHostPorts(workspaceFolder, subprocess);
  const ledgerPath = resolveLedgerPath();
  try {
    templateResult = await coordinatePortAllocation({
      workspaceFolder,
      subprocess,
      ownedPorts,
      ledgerPath,
      runResolve: async (portAllocator) => {
        const tr = await resolveTemplates(
          configForResolution,
          portAllocator,
          mountResolver,
        );
        portAllocator.save(); // Persist the per-project record.
        mountResolver.save(); // Persist mount assignments after successful resolution
        return tr;
      },
    });

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

  // Record config summary in the run log
  if (templateResult) {
    const summaryParts: string[] = [];
    if (templateResult.allocations.length > 0) {
      summaryParts.push(`ports: ${templateResult.allocations.map(a => `${a.label}=${a.port}`).join(", ")}`);
    }
    if (templateResult.mountAssignments.length > 0) {
      summaryParts.push(`mounts: ${templateResult.mountAssignments.map(a => `${a.label}=${a.resolvedSource}`).join(", ")}`);
    }
    if (summaryParts.length > 0) {
      runLog.setConfigSummary(summaryParts.join("\n"));
    }
  }

  // ── Phase 3+: Inferred mount validation ──
  // After template resolution, scan resolved mounts for missing bind-mount sources.
  // Hard error: podman with --userns=keep-id fails on missing sources (statfs ENOENT),
  // and even when the runtime auto-creates them, the result is a root-owned directory
  // that causes permission issues. Fail early with actionable guidance.
  {
    const resolvedConfig = templateResult?.resolvedConfig ?? configForResolution;
    const resolvedMounts = (resolvedConfig.mounts ?? []) as string[];
    const mountAssignments = templateResult?.mountAssignments ?? [];

    interface MissingMount {
      source: string;
      target: string;
      label?: string;
      declaration?: import("./feature-metadata").LaceMountDeclaration;
    }

    const missingMounts: MissingMount[] = [];
    for (const mount of resolvedMounts) {
      if (!mount.includes('type=bind')) continue;
      const sourceMatch = mount.match(/source=([^,]+)/);
      const targetMatch = mount.match(/target=([^,]+)/);
      if (!sourceMatch) continue;
      const source = sourceMatch[1];
      if (source.includes('${')) continue; // Skip devcontainer variables
      if (!existsSync(source)) {
        const target = targetMatch?.[1] ?? 'unknown';
        // Cross-reference against mount assignments and declarations for attribution
        const assignment = mountAssignments.find(a => a.resolvedSource === source);
        const label = assignment?.label;
        const declaration = label ? mountDeclarations[label] : undefined;
        missingMounts.push({ source, target, label, declaration });
      }
    }
    if (missingMounts.length > 0) {
      const details = missingMounts.map(({ source, target, label, declaration }) => {
        if (label && declaration) {
          const featureName = label.split('/')[0];
          const typeNote = declaration.sourceMustBe
            ? `(sourceMustBe: ${declaration.sourceMustBe})`
            : '(auto-created directory)';
          const lines = [
            `  ${label}: ${source}`,
            `    target: ${target}`,
            `    declared by: ${featureName} feature ${typeNote}`,
            `    fix: mkdir -p ${source}`,
            `         or override in ~/.config/lace/settings.json:`,
            `           { "mounts": { "${label}": { "source": "/path/to/dir" } } }`,
          ];
          return lines.join('\n');
        }
        // Static mount (no matching label): fallback format
        return `  ${source} (static mount entry)\n    target: ${target}\n    fix: mkdir -p ${source}`;
      }).join('\n\n');
      const msg = `Bind mount source(s) do not exist on host:\n\n${details}`;
      result.phases.mountValidation = { exitCode: 1, message: msg };
      result.exitCode = 1;
      result.message = msg;
      return result;
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
    const allFeatureRefs = Object.keys(
      (resolvedConfig.features ?? {}) as Record<string, unknown>,
    );

    const fundamentalsRef = allFeatureRefs.find((ref) =>
      extractFeatureShortId(ref) === "lace-fundamentals",
    );

    if (fundamentalsRef) {
      // Inject defaultShell option from user config
      if (userConfigDefaultShell) {
        const features = (resolvedConfig.features ?? {}) as Record<string, Record<string, unknown>>;

        if (features[fundamentalsRef]) {
          if (!features[fundamentalsRef].defaultShell) {
            features[fundamentalsRef].defaultShell = userConfigDefaultShell;
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

  // ── Sub-check: portlessAlias diagnostic ──
  // Driven entirely by the `portlessAlias: true` flag in feature port metadata.
  // Pure diagnostic: probes host-port availability and emits a forward-looking
  // pointer to the clean-URL follow-up RFP. No system changes; no effect on
  // `lace up` runtime in v1.
  if (templateResult && templateResult.allocations.length > 0) {
    try {
      const ownedPortsForCheck = getContainerHostPorts(workspaceFolder, subprocess);
      const aliasResult = await checkPortlessAliases({
        metadataMap,
        allocations: templateResult.allocations,
        ownedPorts: ownedPortsForCheck,
        projectName,
      });
      for (const message of aliasResult.messages) {
        if (message.startsWith("warn:")) {
          console.warn(message);
        } else {
          console.log(message);
        }
      }
    } catch (err) {
      // The diagnostic must never break the pipeline.
      console.warn(
        `Warning: portlessAlias sub-check failed (continuing): ${(err as Error).message}`,
      );
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
  // Read the generated extended config and compare its recreation fingerprint
  // against the previous run. The fingerprint now covers `features` and `build`
  // in addition to the runtime keys (see config-drift.ts), so a features- or
  // Dockerfile-`FROM`-only change is no longer a silent no-op.
  //
  // When drift is detected, respond hybrid:
  //   - container NOT running (fresh, stopped, absent): auto-recreate so the
  //     change is applied, via the existing --remove-existing-container path.
  //   - container running (or its status is unknown/ambiguous): do NOT recreate;
  //     WARN and reuse it, so an in-flight session is never rebuilt out from
  //     under the user. The fingerprint is deliberately NOT advanced in this
  //     case, so a later idle `lace up` still recreates. `lace up --rebuild`
  //     is the explicit override that recreates regardless of running state.
  let currentFingerprint: string | undefined;
  let recreateContainer = false;
  // When drift is deferred because the container is running, skip advancing the
  // fingerprint so the pending change keeps being detected on the next run.
  let deferDriftFingerprint = false;
  // The resolved container name (honors a user `--name`) targeted by the probe
  // and the label-guarded teardown below.
  let resolvedContainerName: string | undefined;
  {
    const extendedConfigPath = join(workspaceFolder, ".lace", "devcontainer.json");
    try {
      const extendedConfig = JSON.parse(
        readFileSync(extendedConfigPath, "utf-8"),
      ) as Record<string, unknown>;

      resolvedContainerName = resolveContainerName(projectName, extendedConfig);

      if (rebuild) {
        deleteRuntimeFingerprint(workspaceFolder);
      }

      const drift = checkConfigDrift(extendedConfig, workspaceFolder);
      currentFingerprint = drift.currentFingerprint;

      if (drift.drifted) {
        // `--rebuild` deletes the fingerprint above, so drift.drifted is false
        // under --rebuild; the running check therefore only governs the
        // implicit-drift path. --rebuild still forces recreate via
        // `removeExistingContainer: rebuild || recreateContainer` below.
        const runState = probeContainerRunning(resolvedContainerName, subprocess);
        if (runState === "not-running") {
          recreateContainer = true;
          console.log(
            "Config changed (features, build, or runtime); container will be recreated.",
          );
        } else {
          // "running" or "unknown": fail safe to reuse. Never rebuild a
          // container that might be live, and never auto-rebuild on an
          // ambiguous probe.
          deferDriftFingerprint = true;
          console.warn(
            "Warning: config changed (features, build, or runtime) but the " +
              "container is running (or its status is unknown); reusing it " +
              "without recreating. Run `lace up --rebuild` to apply the change.",
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
  if (skipDevcontainerUp || validateOnly) {
    result.message = validateOnly
      ? "Validation passed."
      : "lace up completed (devcontainer up skipped)";
    return result;
  }

  // ── Label-guarded name teardown before recreate (Bug 1 belt-and-suspenders) ──
  // When we intend to recreate (--rebuild or detected drift on an idle
  // container), remove any surviving container that holds the resolved name AND
  // carries lace's own project label. This covers a stale container labeled with
  // a non-canonical `devcontainer.local_folder` (e.g. `/home` vs `/var/home`)
  // that our-side canonicalization cannot match, before the CLI's own
  // --remove-existing-container runs.
  if (rebuild || recreateContainer) {
    const teardownName =
      resolvedContainerName ?? sanitizeContainerName(projectName);
    teardownStaleContainer(teardownName, projectName, subprocess);
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

  // Capture devcontainerUp stderr for the run log
  if (upResult.stderr) {
    runLog.logSubprocess({
      phase: "devcontainerUp",
      command: "devcontainer up",
      exitCode: upResult.exitCode,
      stderr: upResult.stderr,
    });
  }

  if (upResult.exitCode !== 0) {
    result.exitCode = upResult.exitCode;
    result.message = `devcontainer up failed: ${upResult.stderr}`;
    console.error(upResult.stderr);
    return result;
  }

  // Write the recreation fingerprint after successful container creation.
  // This ensures the fingerprint reflects actual container state.
  // Skip the write when drift was deferred because the container was running:
  // the pending features/build/runtime change was NOT applied, so advancing the
  // fingerprint would hide it from the next (idle) run.
  if (currentFingerprint && !deferDriftFingerprint) {
    writeRuntimeFingerprint(workspaceFolder, currentFingerprint);
  }

  // ── Phase: Post-container verification ──
  // Runs after devcontainer up on the running container.
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

  // ── Phase: Host portless lifecycle + alias shellout ──
  // For each port whose feature declaration sets `portlessAlias: true`,
  // ensure the host portless on :1355 is running, then register
  // `portless alias <project> <hostAllocatedPort>` against it. The host
  // portless aliases route to the project's container portless host-side
  // mapping, which routes by Host header to per-worktree dev servers.
  //
  // Best-effort: any failure here is surfaced as a warning, not a hard
  // failure, since the container itself is healthy and the user can
  // still reach the dev servers at `localhost:<allocated-port>` if they
  // need to bypass portless routing.
  if (templateResult && templateResult.allocations.length > 0) {
    const aliasingAllocations: PortAllocation[] = [];
    for (const allocation of templateResult.allocations) {
      const [shortId, optionName] = allocation.label.split("/");
      if (!shortId || !optionName) continue;
      for (const [fullRef, metadata] of metadataMap) {
        if (!metadata) continue;
        if (extractFeatureShortId(fullRef) !== shortId) continue;
        const lace = extractLaceCustomizations(metadata);
        const portDecl = lace?.ports?.[optionName];
        if (portDecl?.portlessAlias === true) {
          aliasingAllocations.push(allocation);
        }
      }
    }
    if (aliasingAllocations.length > 0) {
      try {
        const io = defaultHostPortlessIO();
        const ensured = await ensureHostPortless(io);
        for (const msg of ensured.messages) {
          if (msg.startsWith("warn:")) console.warn(msg);
          else console.log(msg);
        }
        if (ensured.ready) {
          let runtime: HostPortlessRuntime | undefined = ensured.runtime;
          // If we spawned, give the daemon a moment to bind before
          // shelling out the alias command. This is a coarse-grained
          // wait; the alias CLI itself contacts the daemon's local
          // socket, which is created at startup.
          if (ensured.state.kind !== "lace-owned-alive") {
            await waitForPortBound(runtime?.port ?? 1355, 3000);
          }
          for (const allocation of aliasingAllocations) {
            const result = registerHostPortlessAlias(
              io,
              projectName,
              allocation.port,
            );
            if (result.ok) {
              console.log(
                `info: registered portless alias ${projectName} -> :${allocation.port}.`,
              );
            } else {
              console.warn(
                `Warning: portless alias registration failed for ${projectName} -> :${allocation.port} (exit ${result.exitCode}):\n${result.output}`,
              );
            }
          }
        } else {
          console.warn(
            `Warning: skipping portless alias registration; host portless is not ready.`,
          );
        }
      } catch (err) {
        console.warn(
          `Warning: host portless lifecycle failed (continuing): ${(err as Error).message}`,
        );
      }
    }
  }

  result.message = "lace up completed successfully";
  return result;

  } finally {
    finalizeLog();
  }
}

/**
 * Rewrite relative local feature references so they remain valid when resolved
 * from `.lace/devcontainer.json` rather than the original
 * `.devcontainer/devcontainer.json`.
 *
 * The devcontainer CLI:
 *   1. Resolves a feature ref `./foo` relative to the *config file's*
 *      directory: `dirname(.lace/devcontainer.json) + ./foo = .lace/foo`.
 *   2. Requires the resolved absolute path to be a child of
 *      `<workspaceFolder>/.devcontainer/` (no `..` in the relative
 *      distance).
 *
 * For a ref originally written as `./features/portless` (relative to
 * `.devcontainer/devcontainer.json`), the equivalent from the
 * `.lace/devcontainer.json` viewpoint is `../.devcontainer/features/portless`,
 * which resolves back into the real `.devcontainer/` tree and satisfies the
 * CLI's child-of-.devcontainer constraint.
 *
 * Absolute-path features (used by integration tests) and registry refs
 * (ghcr.io/...) pass through unchanged.
 *
 * Returns the same object reference when no rewrites are needed (caller can
 * use referential equality to detect that no replacement is necessary).
 */
export function rewriteLocalFeatureRefs(
  features: Record<string, unknown>,
  devcontainerDir: string,
  laceDir: string,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = {};
  let didRewrite = false;
  for (const [featureRef, opts] of Object.entries(features)) {
    if (!featureRef.startsWith("./") && !featureRef.startsWith("../")) {
      rewritten[featureRef] = opts;
      continue;
    }
    const sourcePath = resolve(devcontainerDir, featureRef);
    if (!existsSync(sourcePath)) {
      // Leave invalid refs alone so the CLI surfaces its own error.
      rewritten[featureRef] = opts;
      continue;
    }
    const newRef = "./" + relative(laceDir, sourcePath);
    rewritten[newRef] = opts;
    didRewrite = true;
  }
  return didRewrite ? rewritten : features;
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

  // Rewrite *relative* local feature references so they remain valid when
  // resolved from `.lace/devcontainer.json` rather than the original
  // `.devcontainer/devcontainer.json`.
  //
  // The devcontainer CLI:
  //   1. Resolves a feature ref `./foo` relative to the *config file's*
  //      directory: `dirname(.lace/devcontainer.json) + ./foo = .lace/foo`.
  //   2. Requires the resolved absolute path to be a child of
  //      `<workspaceFolder>/.devcontainer/` (no `..` in the relative
  //      distance). See cli/dist/spec-node/devContainersSpecCLI.js:
  //      "Local file path parse error. Resolved path must be a child of
  //      the .devcontainer/ folder."
  //
  // For a ref originally written as `./features/portless` (relative to
  // `.devcontainer/devcontainer.json`), the equivalent from the
  // `.lace/devcontainer.json` viewpoint is `../.devcontainer/features/portless`,
  // which resolves back into the real `.devcontainer/` tree and satisfies
  // the CLI's child-of-.devcontainer constraint.
  //
  // Absolute-path features (used by integration tests) need no rewriting:
  // they bypass the relative-resolution step entirely. Registry refs
  // (ghcr.io/...) are not local paths.
  {
    const features = (extended.features ?? {}) as Record<string, unknown>;
    const rewritten = rewriteLocalFeatureRefs(features, devcontainerDir, laceDir);
    if (rewritten !== features) {
      extended.features = rewritten;
    }
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

  // Inject project name as container label and container name
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

  args.push("--docker-path", getPodmanCommand());
  // Workaround for containers/buildah#6503: rootless podman + `--layers` (default)
  // overlay graph driver invents /tmp at mode 755 (not the parent's 1777) when a
  // layer blob lacks a tar entry for /tmp but includes entries underneath it.
  // Devcontainer CLI feature install triggers this via `RUN --mount=type=bind,target=/tmp/build-features-src/...`,
  // breaking apt-get GPG verification on subsequent feature install steps with
  // `Couldn't create temporary file /tmp/apt.conf.XXXXX`. The defensive
  // `RUN chmod 1777 /tmp` in the project Dockerfile may be sufficient on its own,
  // making this flag potentially redundant; see
  // cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md for the
  // empirical verification and cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md
  // for the upstream tracking.
  args.push("--buildkit", "never");
  // Remove stale dev_container_feature_content_temp image and containers.
  // Without BuildKit, podman caches FROM scratch + COPY layers even when the
  // build context changes, causing COPY --from to reference stale feature content.
  subprocess(getPodmanCommand(), ["rm", "-f", "-a", "--filter", "ancestor=dev_container_feature_content_temp"]);
  subprocess(getPodmanCommand(), ["rmi", "-f", "dev_container_feature_content_temp"]);
  args.push("--workspace-folder", workspaceFolder);
  args.push(...devcontainerArgs);

  return subprocess("devcontainer", args);
}
