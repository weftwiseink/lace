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
  code: "absolute-gitdir" | "standard-bare" | "prunable-worktree";
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
