// IMPLEMENTATION_VALIDATION
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { RunSubprocess, SubprocessResult } from "./subprocess";
import { runSubprocess as defaultRunSubprocess } from "./subprocess";
import { parseRepoId } from "./devcontainer";

export class RepoCloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoCloneError";
  }
}

/**
 * Derive the project identifier from a workspace folder path.
 *
 * Algorithm:
 * 1. Extract the basename (final directory name)
 * 2. Sanitize: lowercase, replace non-alphanumeric characters with `-`, collapse consecutive `-`
 *
 * Examples:
 * - /home/user/code/weft/lace -> lace
 * - /home/user/code/My Project! -> my-project-
 * - /home/user/code/foo/bar -> bar
 */
export function deriveProjectId(workspaceFolder: string): string {
  // Remove trailing slash if present
  const cleanPath = workspaceFolder.replace(/\/+$/, "");
  const name = basename(cleanPath);

  // Sanitize: lowercase, replace non-alphanumeric with -, collapse consecutive -
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Get the path where a repo clone should be stored.
 *
 * Pattern: ~/.config/lace/$project/repos/$nameOrAlias
 */
export function getClonePath(projectId: string, nameOrAlias: string): string {
  return join(homedir(), ".config", "lace", projectId, "repos", nameOrAlias);
}

/**
 * Get the base repos directory for a project.
 */
export function getReposDir(projectId: string): string {
  return join(homedir(), ".config", "lace", projectId, "repos");
}

export interface CloneRepoOptions {
  /** The repo identifier (e.g., github.com/user/repo) */
  repoId: string;
  /** Where to clone the repo */
  targetDir: string;
  /** Subprocess runner (for testing) */
  subprocess?: RunSubprocess;
}

export interface CloneRepoResult {
  success: boolean;
  message: string;
  cloneDir: string;
  /** The subdirectory path within the clone, if applicable */
  subdirectory?: string;
}

/**
 * Shallow clone a repo to the target directory.
 *
 * - Uses `git clone --depth 1` for efficiency
 * - Clones the full repo even if repoId has a subdirectory
 * - HTTPS is always used (no SSH key configuration needed)
 */
export function cloneRepo(options: CloneRepoOptions): CloneRepoResult {
  const { repoId, targetDir, subprocess = defaultRunSubprocess } = options;

  const { cloneUrl, subdirectory } = parseRepoId(repoId);

  // Ensure parent directory exists
  const parentDir = join(targetDir, "..");
  mkdirSync(parentDir, { recursive: true });

  // Clone the repo
  const result = subprocess("git", ["clone", "--depth", "1", cloneUrl, targetDir]);

  if (result.exitCode !== 0) {
    throw new RepoCloneError(
      `Failed to clone repo '${repoId}': ${result.stderr}`,
    );
  }

  // Verify subdirectory exists if specified
  if (subdirectory) {
    const subPath = join(targetDir, subdirectory);
    if (!existsSync(subPath) || !statSync(subPath).isDirectory()) {
      throw new RepoCloneError(
        `Repo '${repoId}' subdirectory does not exist: ${subdirectory}`,
      );
    }
  }

  return {
    success: true,
    message: `Cloned ${repoId} to ${targetDir}`,
    cloneDir: targetDir,
    subdirectory,
  };
}

export interface UpdateRepoOptions {
  /** Path to the existing clone directory */
  cloneDir: string;
  /** The repo identifier (for error messages) */
  repoId: string;
  /** Subprocess runner (for testing) */
  subprocess?: RunSubprocess;
}

export interface UpdateRepoResult {
  success: boolean;
  message: string;
  /** Whether the update was skipped (e.g., network failure with cached version) */
  skipped: boolean;
}

/**
 * Update an existing repo clone to the latest HEAD.
 *
 * On fetch failure (network, auth): warn and continue with cached version.
 * On reset failure: error (indicates corrupted clone).
 */
export function updateRepo(options: UpdateRepoOptions): UpdateRepoResult {
  const { cloneDir, repoId, subprocess = defaultRunSubprocess } = options;

  if (!existsSync(cloneDir)) {
    throw new RepoCloneError(
      `Repo clone directory does not exist: ${cloneDir}`,
    );
  }

  // Fetch the latest
  const fetchResult = subprocess("git", ["fetch", "--depth", "1", "origin"], {
    cwd: cloneDir,
  });

  if (fetchResult.exitCode !== 0) {
    // Network/auth failure - warn and continue with cached version
    return {
      success: true,
      message: `Warning: Failed to update repo '${repoId}'. Using cached version. (${fetchResult.stderr})`,
      skipped: true,
    };
  }

  // Reset to the fetched HEAD
  const resetResult = subprocess("git", ["reset", "--hard", "origin/HEAD"], {
    cwd: cloneDir,
  });

  if (resetResult.exitCode !== 0) {
    // Reset failure indicates corrupted clone
    throw new RepoCloneError(
      `Failed to update repo '${repoId}': reset failed. ` +
        `The clone may be corrupted. Try removing ${cloneDir} and re-running. ` +
        `(${resetResult.stderr})`,
    );
  }

  return {
    success: true,
    message: `Updated ${repoId}`,
    skipped: false,
  };
}

/**
 * Ensure a repo is cloned/updated.
 * If the clone exists, update it. Otherwise, clone it.
 */
export function ensureRepo(options: CloneRepoOptions): CloneRepoResult | UpdateRepoResult {
  const { targetDir } = options;

  // Check if clone already exists
  const gitDir = join(targetDir, ".git");
  if (existsSync(gitDir)) {
    return updateRepo({
      cloneDir: targetDir,
      repoId: options.repoId,
      subprocess: options.subprocess,
    });
  }

  return cloneRepo(options);
}

/**
 * Get the effective source path for a repo.
 * If the repo has a subdirectory, returns the path to that subdirectory.
 * Otherwise, returns the clone directory itself.
 */
export function getRepoSourcePath(cloneDir: string, subdirectory?: string): string {
  return subdirectory ? join(cloneDir, subdirectory) : cloneDir;
}
