// IMPLEMENTATION_VALIDATION
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename, isAbsolute, sep } from "node:path";

// ── Types ──

/** Classification of a workspace directory's git layout. */
export type WorkspaceClassification =
  | {
      type: "worktree";
      /** Absolute path to the bare-repo root (parent of .bare/) */
      bareRepoRoot: string;
      /** Name of this worktree (basename of the workspace directory) */
      worktreeName: string;
      /** Whether the .git file used an absolute gitdir path */
      usesAbsolutePath: boolean;
    }
  | {
      type: "bare-root";
      /** Absolute path to the bare-repo root (same as workspace) */
      bareRepoRoot: string;
    }
  | {
      type: "normal-clone";
    }
  | {
      type: "standard-bare";
    }
  | {
      type: "not-git";
    }
  | {
      type: "malformed";
      /** Description of what went wrong */
      reason: string;
    };

/** Warnings emitted during workspace classification. */
export interface ClassificationWarning {
  code:
    | "absolute-gitdir"
    | "standard-bare"
    | "prunable-worktree"
    | "unsupported-extension";
  message: string;
  remediation?: string;
}

/** Full result of workspace classification. */
export interface ClassificationResult {
  classification: WorkspaceClassification;
  warnings: ClassificationWarning[];
}

// ── Classification Cache ──

/**
 * Module-level cache for classification results. Keyed by resolved absolute path.
 * Valid for process lifetime — lace is a short-lived CLI, so no invalidation needed.
 * Eliminates redundant filesystem probes when the same workspace is classified
 * multiple times per pipeline run (e.g., applyWorkspaceLayout, then deriveProjectId
 * inside MountPathResolver, then again inside runResolveMounts).
 */
const classificationCache = new Map<string, ClassificationResult>();

/**
 * Clear the classification cache. Exported for tests that create filesystem
 * fixtures and need a clean slate to avoid cross-test contamination.
 */
export function clearClassificationCache(): void {
  classificationCache.clear();
}

// ── Public API ──

/**
 * Classify a workspace directory's git layout using filesystem-only detection.
 * No git binary required for core detection. Supplemental warnings may use git.
 * Results are cached per resolved absolute path for the process lifetime.
 */
export function classifyWorkspace(workspacePath: string): ClassificationResult {
  const absPath = resolve(workspacePath);

  const cached = classificationCache.get(absPath);
  if (cached) return cached;

  const result = classifyWorkspaceUncached(absPath);
  classificationCache.set(absPath, result);
  return result;
}

/** Core classification logic — called once per unique path, result is cached. */
function classifyWorkspaceUncached(absPath: string): ClassificationResult {
  const dotGitPath = join(absPath, ".git");
  const warnings: ClassificationWarning[] = [];

  // Step 1: Check if .git exists at all
  if (!existsSync(dotGitPath)) {
    // E4: Check for non-nikitabobko standard bare repo
    if (
      existsSync(join(absPath, "HEAD")) &&
      existsSync(join(absPath, "objects"))
    ) {
      warnings.push({
        code: "standard-bare",
        message:
          "Workspace appears to be a standard bare git repo (not the nikitabobko convention). " +
          "The nikitabobko layout (.git file -> .bare/) is recommended for devcontainer compatibility.",
        remediation:
          "See https://morgan.cugerone.com/blog/worktrees-step-by-step/ for migration guidance.",
      });
      return { classification: { type: "standard-bare" }, warnings };
    }
    return { classification: { type: "not-git" }, warnings };
  }

  // Step 2: Determine if .git is a file or directory
  const stat = statSync(dotGitPath);

  if (stat.isDirectory()) {
    return { classification: { type: "normal-clone" }, warnings };
  }

  if (!stat.isFile()) {
    return {
      classification: {
        type: "malformed",
        reason: ".git exists but is neither file nor directory",
      },
      warnings,
    };
  }

  // Step 3: .git is a FILE — parse "gitdir: <target>"
  let pointer;
  try {
    pointer = resolveGitdirPointer(dotGitPath);
  } catch (err) {
    return {
      classification: { type: "malformed", reason: (err as Error).message },
      warnings,
    };
  }

  // Step 4: Determine if this is a worktree or the bare-root
  const resolvedPath = pointer.resolvedPath;

  if (
    resolvedPath.includes(`${sep}worktrees${sep}`) ||
    resolvedPath.includes("/worktrees/")
  ) {
    // This is a WORKTREE
    const bareRoot = findBareRepoRoot(resolvedPath);
    if (!bareRoot) {
      return {
        classification: {
          type: "malformed",
          reason: `gitdir points to worktrees path but could not locate bare-repo root: ${resolvedPath}`,
        },
        warnings,
      };
    }

    if (pointer.isAbsolute) {
      warnings.push({
        code: "absolute-gitdir",
        message:
          `Worktree '${basename(absPath)}' uses an absolute gitdir path (${pointer.rawTarget}) ` +
          "that will not resolve inside the container.",
        remediation:
          "Run `git worktree repair --relative-paths` (requires git 2.48+) or recreate the worktree.",
      });
    }

    // Also check sibling worktrees for absolute paths (excluding current to avoid duplicates)
    warnings.push(...checkAbsolutePaths(bareRoot, basename(absPath)));

    // Check for git extensions that may not be supported by the container's git.
    // The bare git dir (containing the config) is the parent of the worktrees/ dir.
    const bareGitDir = findBareGitDir(resolvedPath);
    if (bareGitDir) {
      warnings.push(...checkGitExtensions(bareGitDir));
    }

    return {
      classification: {
        type: "worktree",
        bareRepoRoot: bareRoot,
        worktreeName: basename(absPath),
        usesAbsolutePath: pointer.isAbsolute,
      },
      warnings,
    };
  }

  // The .git file points to .bare (or similar) — this is the BARE-ROOT
  if (existsSync(join(resolvedPath, "HEAD"))) {
    // Check for git extensions that may not be supported by the container's git.
    warnings.push(...checkGitExtensions(resolvedPath));

    return {
      classification: { type: "bare-root", bareRepoRoot: absPath },
      warnings,
    };
  }

  return {
    classification: {
      type: "malformed",
      reason: `gitdir target ${resolvedPath} does not appear to be a git directory (no HEAD found)`,
    },
    warnings,
  };
}

/**
 * Parse a .git file's "gitdir: <target>" content and resolve the target path.
 * Returns the resolved absolute path of the gitdir target.
 * Throws if the file doesn't start with "gitdir: ".
 */
export function resolveGitdirPointer(
  dotGitFilePath: string,
): { resolvedPath: string; isAbsolute: boolean; rawTarget: string } {
  const content = readFileSync(dotGitFilePath, "utf-8").trim();

  if (!content.startsWith("gitdir: ")) {
    throw new Error(
      `Unexpected .git file format at ${dotGitFilePath}: ` +
        `expected "gitdir: <path>" but got "${content.slice(0, 50)}"`,
    );
  }

  const rawTarget = content.slice("gitdir: ".length).trim();
  const usesAbsolute = isAbsolute(rawTarget);
  const resolvedPath = usesAbsolute
    ? rawTarget
    : resolve(dirname(dotGitFilePath), rawTarget);

  return { resolvedPath, isAbsolute: usesAbsolute, rawTarget };
}

/**
 * Walk up from a resolved worktrees path to find the bare-repo root.
 * Given a path like /foo/project/.bare/worktrees/main, returns /foo/project.
 * The bare-repo root is the parent of the directory containing "worktrees/".
 */
export function findBareRepoRoot(
  resolvedWorktreePath: string,
): string | null {
  let current = resolvedWorktreePath;

  while (current !== dirname(current)) {
    if (basename(current) === "worktrees") {
      const bareInternals = dirname(current);
      if (existsSync(join(bareInternals, "HEAD"))) {
        return dirname(bareInternals);
      }
    }
    current = dirname(current);
  }

  return null;
}

/**
 * Check sibling worktrees in the bare-repo tree for absolute gitdir paths.
 * Returns warnings for worktrees using absolute paths.
 * Only scans immediate children of bareRepoRoot (nikitabobko convention).
 * Worktrees outside the bare-repo root directory are not scanned.
 *
 * @param excludeWorktree Name of worktree to skip (avoids duplicate warnings
 *   when the current worktree was already checked by classifyWorkspace).
 */
export function checkAbsolutePaths(
  bareRepoRoot: string,
  excludeWorktree?: string,
): ClassificationWarning[] {
  const warnings: ClassificationWarning[] = [];

  try {
    const entries = readdirSync(bareRepoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      // Skip the current worktree (already checked by classifyWorkspace)
      if (excludeWorktree && entry.name === excludeWorktree) continue;

      const worktreeGitPath = join(bareRepoRoot, entry.name, ".git");
      if (!existsSync(worktreeGitPath)) continue;

      const stat = statSync(worktreeGitPath);
      if (!stat.isFile()) continue;

      try {
        const pointer = resolveGitdirPointer(worktreeGitPath);
        if (pointer.isAbsolute) {
          warnings.push({
            code: "absolute-gitdir",
            message:
              `Worktree '${entry.name}' uses an absolute gitdir path (${pointer.rawTarget}) ` +
              "that will not resolve inside the container.",
            remediation:
              "Run `git worktree repair --relative-paths` (requires git 2.48+).",
          });
        }
      } catch {
        /* skip malformed .git files in sibling worktrees */
      }
    }
  } catch {
    /* if we can't read the directory, skip the supplemental check */
  }

  return warnings;
}

/**
 * Find the bare git directory (containing HEAD, config, worktrees/) from a
 * resolved worktree path. Given /project/.bare/worktrees/main, returns
 * /project/.bare. This is the directory where the git config file lives.
 */
function findBareGitDir(resolvedWorktreePath: string): string | null {
  let current = resolvedWorktreePath;

  while (current !== dirname(current)) {
    if (basename(current) === "worktrees") {
      const bareGitDir = dirname(current);
      if (existsSync(join(bareGitDir, "HEAD"))) {
        return bareGitDir;
      }
    }
    current = dirname(current);
  }

  return null;
}

// ── Git Config Extension Detection ──

/**
 * Minimum git versions required for known repository extensions.
 * Extensions not in this map are still flagged — the message just cannot
 * specify the minimum version. The map enhances error messages, not detection.
 *
 * Does not handle: multiline values (trailing backslash continuation),
 * quoted strings, or include directives ([include] / [includeIf]).
 * These features are not used by repositoryformatversion or extensions.* keys.
 */
export const GIT_EXTENSION_MIN_VERSIONS: Record<string, string> = {
  objectformat: "2.36.0",
  worktreeconfig: "2.20.0",
  relativeworktrees: "2.48.0",
};

/** Result of parsing a git config file for extension information. */
export interface GitConfigExtensions {
  /** Value of core.repositoryformatversion (0 if absent). */
  formatVersion: number;
  /** Map of extension name (lowercased) to its value. */
  extensions: Record<string, string>;
}

/**
 * Parse a git config file to extract repositoryformatversion and extensions.
 * Uses a simple line-by-line parser that tracks the current section.
 * Only extracts the specific keys needed for extension compatibility checking.
 *
 * Git config keys are case-insensitive; this parser lowercases them for
 * consistent matching. Section names are also lowercased.
 *
 * @param configContent The raw content of the git config file.
 * @returns Parsed format version and extensions map.
 */
export function parseGitConfigExtensions(configContent: string): GitConfigExtensions {
  let currentSection = "";
  let formatVersion = 0;
  const extensions: Record<string, string> = {};

  for (const rawLine of configContent.split("\n")) {
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    // Section header: [section] or [section "subsection"]
    const sectionMatch = line.match(/^\[([^\s\]]+)(?:\s+"[^"]*")?\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase();
      continue;
    }

    // Key-value pair: key = value
    const kvMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim().toLowerCase();
    const value = kvMatch[2].trim();

    if (currentSection === "core" && key === "repositoryformatversion") {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        formatVersion = parsed;
      }
    } else if (currentSection === "extensions") {
      extensions[key] = value;
    }
  }

  return { formatVersion, extensions };
}

/**
 * Check a bare repo's git config for extensions that may not be supported
 * by the container's git version. Emits `unsupported-extension` warnings
 * for each unrecognized extension.
 *
 * Only checks repos with repositoryformatversion >= 1 (version 0 repos
 * do not use the extensions namespace).
 *
 * @param bareGitDir Path to the bare git directory (e.g., /path/to/project/.bare)
 * @returns Array of warnings for unsupported extensions.
 */
export function checkGitExtensions(
  bareGitDir: string,
): ClassificationWarning[] {
  const warnings: ClassificationWarning[] = [];

  const configPath = join(bareGitDir, "config");
  if (!existsSync(configPath)) return warnings;

  let configContent: string;
  try {
    configContent = readFileSync(configPath, "utf-8");
  } catch {
    return warnings;
  }

  const { formatVersion, extensions } = parseGitConfigExtensions(configContent);

  // Version 0 repos do not use extensions — nothing to check
  if (formatVersion < 1) return warnings;

  for (const [extName, _value] of Object.entries(extensions)) {
    const minVersion = GIT_EXTENSION_MIN_VERSIONS[extName];
    const versionHint = minVersion ? ` (requires git ${minVersion}+)` : "";

    warnings.push({
      code: "unsupported-extension",
      message:
        `Repository uses git extension "${extName}"${versionHint} ` +
        "but the container's git may not support it.",
      remediation:
        'Set version to "latest" in the git prebuild feature: ' +
        '"ghcr.io/devcontainers/features/git:1": { "version": "latest" }',
    });
  }

  return warnings;
}
