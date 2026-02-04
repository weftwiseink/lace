// IMPLEMENTATION_VALIDATION
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  readDevcontainerConfig,
  extractPlugins,
  DevcontainerConfigError,
} from "./devcontainer";
import { loadSettings, SettingsConfigError } from "./settings";
import {
  resolvePluginMounts,
  generateMountSpecs,
  generateSymlinkCommands,
  MountsError,
  type ResolvedMounts,
} from "./mounts";
import { deriveProjectId } from "./plugin-clones";
import type { RunSubprocess } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";

export interface ResolveMountsOptions {
  /** Workspace folder path (defaults to cwd) */
  workspaceFolder?: string;
  /** Subprocess runner for testing */
  subprocess?: RunSubprocess;
  /** Dry run - don't write files or clone repos */
  dryRun?: boolean;
}

export interface ResolveMountsResult {
  exitCode: number;
  message: string;
  /** Resolved mounts (if successful) */
  resolved?: ResolvedMounts;
  /** Mount specs for devcontainer.json */
  mountSpecs?: string[];
  /** Symlink commands for postCreateCommand */
  symlinkCommand?: string | null;
}

/**
 * Run the resolve-mounts workflow:
 * 1. Read devcontainer.json and extract plugins
 * 2. Read user's settings.json
 * 3. Resolve mounts (clone or use overrides)
 * 4. Write .lace/resolved-mounts.json
 */
export function runResolveMounts(
  options: ResolveMountsOptions = {},
): ResolveMountsResult {
  const {
    workspaceFolder = process.cwd(),
    subprocess = defaultRunSubprocess,
    dryRun = false,
  } = options;

  const devcontainerPath = join(
    workspaceFolder,
    ".devcontainer",
    "devcontainer.json",
  );

  // 1. Read and parse devcontainer.json
  let config;
  try {
    config = readDevcontainerConfig(devcontainerPath);
  } catch (err) {
    if (err instanceof DevcontainerConfigError) {
      return {
        exitCode: 1,
        message: err.message,
      };
    }
    throw err;
  }

  // 2. Extract plugins configuration
  const pluginsResult = extractPlugins(config.raw);

  switch (pluginsResult.kind) {
    case "absent":
      return {
        exitCode: 0,
        message: "No plugins configured in devcontainer.json",
      };

    case "null":
      // Explicitly null = disabled
      return {
        exitCode: 0,
        message: "",
      };

    case "empty":
      return {
        exitCode: 0,
        message: "No plugins configured (empty object)",
      };
  }

  const plugins = pluginsResult.plugins;
  const pluginCount = Object.keys(plugins).length;

  // 3. Load user settings
  let settings;
  try {
    settings = loadSettings();
  } catch (err) {
    if (err instanceof SettingsConfigError) {
      return {
        exitCode: 1,
        message: err.message,
      };
    }
    throw err;
  }

  // 4. Derive project ID
  const projectId = deriveProjectId(workspaceFolder);

  // Dry run mode
  if (dryRun) {
    const pluginNames = Object.entries(plugins)
      .map(([repoId, opts]) => {
        const alias = opts.alias ? ` (alias: ${opts.alias})` : "";
        const hasOverride = settings.plugins?.[repoId]?.overrideMount
          ? " [override]"
          : " [clone]";
        return `  - ${repoId}${alias}${hasOverride}`;
      })
      .join("\n");

    return {
      exitCode: 0,
      message:
        `Dry run: Would resolve ${pluginCount} plugin(s) for project '${projectId}':\n` +
        pluginNames,
    };
  }

  // 5. Resolve mounts
  let resolved: ResolvedMounts;
  try {
    resolved = resolvePluginMounts({
      plugins,
      settings,
      projectId,
      subprocess,
    });
  } catch (err) {
    if (err instanceof MountsError) {
      return {
        exitCode: 1,
        message: err.message,
      };
    }
    throw err;
  }

  // 6. Generate mount specs and symlink commands
  const mountSpecs = generateMountSpecs(resolved.plugins);
  const symlinkCommand = generateSymlinkCommands(resolved.plugins);

  // 7. Write resolved-mounts.json
  const laceDir = join(workspaceFolder, ".lace");
  mkdirSync(laceDir, { recursive: true });

  const outputPath = join(laceDir, "resolved-mounts.json");
  writeFileSync(outputPath, JSON.stringify(resolved, null, 2) + "\n", "utf-8");

  // 8. Generate summary
  const overrideCount = resolved.plugins.filter((p) => p.isOverride).length;
  const cloneCount = resolved.plugins.filter((p) => !p.isOverride).length;

  let summary = `Resolved ${pluginCount} plugin(s):`;
  if (overrideCount > 0) {
    summary += ` ${overrideCount} override(s)`;
  }
  if (cloneCount > 0) {
    summary += ` ${cloneCount} clone(s)`;
  }

  if (symlinkCommand) {
    const symlinkCount = resolved.plugins.filter((p) => p.symlink).length;
    summary += `, ${symlinkCount} symlink(s)`;
  }

  return {
    exitCode: 0,
    message: summary,
    resolved,
    mountSpecs,
    symlinkCommand,
  };
}
