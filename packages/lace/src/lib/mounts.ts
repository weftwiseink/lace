// IMPLEMENTATION_VALIDATION
import { existsSync } from "node:fs";
import {
  type RepoMountsConfig,
  type RepoMountOptions,
  getRepoNameOrAlias,
  parseRepoId,
} from "./devcontainer";
import { type LaceSettings, type RepoMountSettings } from "./settings";
import {
  getClonePath,
  ensureRepo,
  getRepoSourcePath,
  type CloneRepoOptions,
} from "./repo-clones";
import type { RunSubprocess } from "./subprocess";

export class MountsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MountsError";
  }
}

/** Mount target prefix for repo mounts */
const REPO_MOUNT_PREFIX = "/mnt/lace/repos";

/** Resolved repo mount specification */
export interface ResolvedRepoMount {
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
  repoMounts: ResolvedRepoMount[];
  errors: string[];
}

/**
 * Validate that no two repo mounts resolve to the same name/alias.
 * Throws MountsError with guidance if conflicts are found.
 */
export function validateNoConflicts(repoMounts: RepoMountsConfig): void {
  const names = new Map<string, string[]>();

  for (const [repoId, options] of Object.entries(repoMounts)) {
    const nameOrAlias = getRepoNameOrAlias(repoId, options);
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
      .map((r, i) => `  "${r}": { "alias": "${getRepoNameOrAlias(r, {})}-${i + 1}" }`)
      .join(",\n");

    throw new MountsError(
      `Repo mount name conflict: ${repos.map((r) => `'${r}'`).join(" and ")} ` +
        `resolve to name '${name}'. Add explicit aliases:\n\n${aliasExamples}`,
    );
  }
}

/**
 * Get the default mount target for a repo mount.
 */
export function getDefaultTarget(nameOrAlias: string): string {
  return `${REPO_MOUNT_PREFIX}/${nameOrAlias}`;
}

export interface ResolveRepoMountsOptions {
  /** Repo mounts declared in devcontainer.json */
  repoMounts: RepoMountsConfig;
  /** User settings from settings.json */
  settings: LaceSettings;
  /** Project identifier for clone paths */
  projectId: string;
  /** Subprocess runner (for testing) */
  subprocess?: RunSubprocess;
}

/**
 * Resolve repo mounts from project declarations and user settings.
 *
 * For each repo mount:
 * - If override exists in settings: use override source, validate it exists
 * - If no override: clone/update the repo and use clone path as source
 * - Generate mount spec and symlink spec if needed
 */
export function resolveRepoMounts(
  options: ResolveRepoMountsOptions,
): ResolvedMounts {
  const { repoMounts, settings, projectId, subprocess } = options;

  // First, validate no name conflicts
  validateNoConflicts(repoMounts);

  const resolved: ResolvedRepoMount[] = [];
  const errors: string[] = [];

  for (const [repoId, mountOptions] of Object.entries(repoMounts)) {
    try {
      const repoMount = resolveRepoMount({
        repoId,
        options: mountOptions,
        settings,
        projectId,
        subprocess,
      });
      resolved.push(repoMount);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  // If there are errors, we should fail
  if (errors.length > 0) {
    throw new MountsError(
      `Failed to resolve repo mounts:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    repoMounts: resolved,
    errors: [],
  };
}

interface ResolveRepoMountOptions {
  repoId: string;
  options: RepoMountOptions;
  settings: LaceSettings;
  projectId: string;
  subprocess?: RunSubprocess;
}

/**
 * Resolve a single repo mount.
 */
function resolveRepoMount(opts: ResolveRepoMountOptions): ResolvedRepoMount {
  const { repoId, options, settings, projectId, subprocess } = opts;
  const nameOrAlias = getRepoNameOrAlias(repoId, options);
  const defaultTarget = getDefaultTarget(nameOrAlias);

  // Check for override in settings
  const repoSettings = settings.repoMounts?.[repoId];
  const override = repoSettings?.overrideMount;

  if (override) {
    return resolveOverrideRepoMount({
      repoId,
      nameOrAlias,
      defaultTarget,
      override,
    });
  }

  return resolveCloneRepoMount({
    repoId,
    nameOrAlias,
    defaultTarget,
    projectId,
    subprocess,
  });
}

interface ResolveOverrideRepoMountOptions {
  repoId: string;
  nameOrAlias: string;
  defaultTarget: string;
  override: NonNullable<RepoMountSettings["overrideMount"]>;
}

/**
 * Resolve a repo mount with a user override.
 */
function resolveOverrideRepoMount(
  opts: ResolveOverrideRepoMountOptions,
): ResolvedRepoMount {
  const { repoId, nameOrAlias, defaultTarget, override } = opts;

  // Validate source path exists
  if (!existsSync(override.source)) {
    throw new MountsError(
      `Repo '${repoId}' override source does not exist: ${override.source}`,
    );
  }

  const target = override.target ?? defaultTarget;
  const readonly = override.readonly ?? true;

  const repoMount: ResolvedRepoMount = {
    repoId,
    nameOrAlias,
    source: override.source,
    target,
    readonly,
    isOverride: true,
  };

  // Generate symlink spec if target differs from default
  if (override.target && override.target !== defaultTarget) {
    repoMount.symlink = {
      from: defaultTarget,
      to: override.target,
    };
  }

  return repoMount;
}

interface ResolveCloneRepoMountOptions {
  repoId: string;
  nameOrAlias: string;
  defaultTarget: string;
  projectId: string;
  subprocess?: RunSubprocess;
}

/**
 * Resolve a repo mount via shallow clone.
 */
function resolveCloneRepoMount(opts: ResolveCloneRepoMountOptions): ResolvedRepoMount {
  const { repoId, nameOrAlias, defaultTarget, projectId, subprocess } = opts;

  const clonePath = getClonePath(projectId, nameOrAlias);
  const { subdirectory } = parseRepoId(repoId);

  // Clone or update the repo
  const cloneOptions: CloneRepoOptions = {
    repoId,
    targetDir: clonePath,
    subprocess,
  };

  ensureRepo(cloneOptions);

  // Get the effective source path (accounting for subdirectory)
  const source = getRepoSourcePath(clonePath, subdirectory);

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
 * Generate a devcontainer mount string for a resolved repo mount.
 *
 * Format: "type=bind,source=/host/path,target=/container/path[,readonly]"
 */
export function generateMountSpec(repoMount: ResolvedRepoMount): string {
  const parts = [
    "type=bind",
    `source=${repoMount.source}`,
    `target=${repoMount.target}`,
  ];

  if (repoMount.readonly) {
    parts.push("readonly");
  }

  return parts.join(",");
}

/**
 * Generate shell commands to create symlinks for repo mounts with custom targets.
 *
 * Returns null if no symlinks are needed.
 */
export function generateSymlinkCommands(repoMounts: ResolvedRepoMount[]): string | null {
  const commands: string[] = [];

  for (const repoMount of repoMounts) {
    if (repoMount.symlink) {
      // Create parent directory, remove existing symlink, create new symlink
      commands.push(
        `mkdir -p "$(dirname '${repoMount.symlink.from}')"`,
        `rm -f '${repoMount.symlink.from}'`,
        `ln -s '${repoMount.symlink.to}' '${repoMount.symlink.from}'`,
      );
    }
  }

  if (commands.length === 0) {
    return null;
  }

  return commands.join(" && ");
}

/**
 * Generate all mount specs for resolved repo mounts.
 */
export function generateMountSpecs(repoMounts: ResolvedRepoMount[]): string[] {
  return repoMounts.map(generateMountSpec);
}
