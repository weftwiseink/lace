// IMPLEMENTATION_VALIDATION
import { existsSync } from "node:fs";
import {
  type PluginsConfig,
  type PluginOptions,
  getPluginNameOrAlias,
  parseRepoId,
} from "./devcontainer";
import { type LaceSettings, type PluginSettings } from "./settings";
import {
  getClonePath,
  ensurePlugin,
  getPluginSourcePath,
  type ClonePluginOptions,
} from "./plugin-clones";
import type { RunSubprocess } from "./subprocess";

export class MountsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MountsError";
  }
}

/** Mount target prefix for plugins */
const PLUGIN_MOUNT_PREFIX = "/mnt/lace/plugins";

/** Resolved plugin mount specification */
export interface ResolvedPlugin {
  /** The original repo identifier */
  repoId: string;
  /** The resolved name (alias or derived) */
  nameOrAlias: string;
  /** Host source path for the mount */
  source: string;
  /** Container target path for the mount */
  target: string;
  /** Whether the mount is readonly */
  readonly: boolean;
  /** Whether this is an override from settings.json */
  isOverride: boolean;
  /** Symlink spec if target differs from default */
  symlink?: {
    /** Source path for symlink (the default location) */
    from: string;
    /** Target path for symlink (the override target) */
    to: string;
  };
}

/** Output of mount resolution */
export interface ResolvedMounts {
  version: 2;
  generatedAt: string;
  plugins: ResolvedPlugin[];
  errors: string[];
}

/**
 * Validate that no two plugins resolve to the same name/alias.
 * Throws MountsError with guidance if conflicts are found.
 */
export function validateNoConflicts(plugins: PluginsConfig): void {
  const names = new Map<string, string[]>();

  for (const [repoId, options] of Object.entries(plugins)) {
    const nameOrAlias = getPluginNameOrAlias(repoId, options);
    if (!names.has(nameOrAlias)) {
      names.set(nameOrAlias, []);
    }
    names.get(nameOrAlias)!.push(repoId);
  }

  const conflicts = Array.from(names.entries()).filter(
    ([, repos]) => repos.length > 1,
  );

  if (conflicts.length > 0) {
    const [name, repos] = conflicts[0];
    const aliasExamples = repos
      .map((r, i) => `  "${r}": { "alias": "${getPluginNameOrAlias(r, {})}-${i + 1}" }`)
      .join(",\n");

    throw new MountsError(
      `Plugin name conflict: ${repos.map((r) => `'${r}'`).join(" and ")} ` +
        `resolve to name '${name}'. Add explicit aliases:\n\n${aliasExamples}`,
    );
  }
}

/**
 * Get the default mount target for a plugin.
 */
export function getDefaultTarget(nameOrAlias: string): string {
  return `${PLUGIN_MOUNT_PREFIX}/${nameOrAlias}`;
}

export interface ResolvePluginMountsOptions {
  /** Plugins declared in devcontainer.json */
  plugins: PluginsConfig;
  /** User settings from settings.json */
  settings: LaceSettings;
  /** Project identifier for clone paths */
  projectId: string;
  /** Subprocess runner (for testing) */
  subprocess?: RunSubprocess;
}

/**
 * Resolve plugin mounts from project declarations and user settings.
 *
 * For each plugin:
 * - If override exists in settings: use override source, validate it exists
 * - If no override: clone/update the repo and use clone path as source
 * - Generate mount spec and symlink spec if needed
 */
export function resolvePluginMounts(
  options: ResolvePluginMountsOptions,
): ResolvedMounts {
  const { plugins, settings, projectId, subprocess } = options;

  // First, validate no name conflicts
  validateNoConflicts(plugins);

  const resolved: ResolvedPlugin[] = [];
  const errors: string[] = [];

  for (const [repoId, pluginOptions] of Object.entries(plugins)) {
    try {
      const plugin = resolvePlugin({
        repoId,
        options: pluginOptions,
        settings,
        projectId,
        subprocess,
      });
      resolved.push(plugin);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  // If there are errors, we should fail
  if (errors.length > 0) {
    throw new MountsError(
      `Failed to resolve plugins:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    plugins: resolved,
    errors: [],
  };
}

interface ResolvePluginOptions {
  repoId: string;
  options: PluginOptions;
  settings: LaceSettings;
  projectId: string;
  subprocess?: RunSubprocess;
}

/**
 * Resolve a single plugin.
 */
function resolvePlugin(opts: ResolvePluginOptions): ResolvedPlugin {
  const { repoId, options, settings, projectId, subprocess } = opts;
  const nameOrAlias = getPluginNameOrAlias(repoId, options);
  const defaultTarget = getDefaultTarget(nameOrAlias);

  // Check for override in settings
  const pluginSettings = settings.plugins?.[repoId];
  const override = pluginSettings?.overrideMount;

  if (override) {
    return resolveOverridePlugin({
      repoId,
      nameOrAlias,
      defaultTarget,
      override,
    });
  }

  return resolveClonePlugin({
    repoId,
    nameOrAlias,
    defaultTarget,
    projectId,
    subprocess,
  });
}

interface ResolveOverridePluginOptions {
  repoId: string;
  nameOrAlias: string;
  defaultTarget: string;
  override: NonNullable<PluginSettings["overrideMount"]>;
}

/**
 * Resolve a plugin with a user override.
 */
function resolveOverridePlugin(
  opts: ResolveOverridePluginOptions,
): ResolvedPlugin {
  const { repoId, nameOrAlias, defaultTarget, override } = opts;

  // Validate source path exists
  if (!existsSync(override.source)) {
    throw new MountsError(
      `Plugin '${repoId}' override source does not exist: ${override.source}`,
    );
  }

  const target = override.target ?? defaultTarget;
  const readonly = override.readonly ?? true;

  const plugin: ResolvedPlugin = {
    repoId,
    nameOrAlias,
    source: override.source,
    target,
    readonly,
    isOverride: true,
  };

  // Generate symlink spec if target differs from default
  if (override.target && override.target !== defaultTarget) {
    plugin.symlink = {
      from: defaultTarget,
      to: override.target,
    };
  }

  return plugin;
}

interface ResolveClonePluginOptions {
  repoId: string;
  nameOrAlias: string;
  defaultTarget: string;
  projectId: string;
  subprocess?: RunSubprocess;
}

/**
 * Resolve a plugin via shallow clone.
 */
function resolveClonePlugin(opts: ResolveClonePluginOptions): ResolvedPlugin {
  const { repoId, nameOrAlias, defaultTarget, projectId, subprocess } = opts;

  const clonePath = getClonePath(projectId, nameOrAlias);
  const { subdirectory } = parseRepoId(repoId);

  // Clone or update the plugin
  const cloneOptions: ClonePluginOptions = {
    repoId,
    targetDir: clonePath,
    subprocess,
  };

  ensurePlugin(cloneOptions);

  // Get the effective source path (accounting for subdirectory)
  const source = getPluginSourcePath(clonePath, subdirectory);

  return {
    repoId,
    nameOrAlias,
    source,
    target: defaultTarget,
    readonly: true,
    isOverride: false,
  };
}

/**
 * Generate a devcontainer mount string for a resolved plugin.
 *
 * Format: "type=bind,source=/host/path,target=/container/path[,readonly]"
 */
export function generateMountSpec(plugin: ResolvedPlugin): string {
  const parts = [
    "type=bind",
    `source=${plugin.source}`,
    `target=${plugin.target}`,
  ];

  if (plugin.readonly) {
    parts.push("readonly");
  }

  return parts.join(",");
}

/**
 * Generate shell commands to create symlinks for plugins with custom targets.
 *
 * Returns null if no symlinks are needed.
 */
export function generateSymlinkCommands(plugins: ResolvedPlugin[]): string | null {
  const commands: string[] = [];

  for (const plugin of plugins) {
    if (plugin.symlink) {
      // Create parent directory, remove existing symlink, create new symlink
      commands.push(
        `mkdir -p "$(dirname '${plugin.symlink.from}')"`,
        `rm -f '${plugin.symlink.from}'`,
        `ln -s '${plugin.symlink.to}' '${plugin.symlink.from}'`,
      );
    }
  }

  if (commands.length === 0) {
    return null;
  }

  return commands.join(" && ");
}

/**
 * Generate all mount specs for resolved plugins.
 */
export function generateMountSpecs(plugins: ResolvedPlugin[]): string[] {
  return plugins.map(generateMountSpec);
}
