// IMPLEMENTATION_VALIDATION
import { basename } from "node:path";
import type { WorkspaceClassification } from "./workspace-detector";

/**
 * Derive a project name from a workspace classification and path.
 *
 * For worktree and bare-root layouts, uses basename of the bare repo root
 * (the repo name). For all other types, uses basename of the workspace path.
 * The worktree name is deliberately excluded — in the worktrunk model, one
 * container holds all worktrees as siblings.
 */
export function deriveProjectName(
  classification: WorkspaceClassification,
  workspacePath: string,
): string {
  switch (classification.type) {
    case "worktree":
      return basename(classification.bareRepoRoot);
    case "bare-root":
      return basename(classification.bareRepoRoot);
    case "normal-clone":
    case "standard-bare":
    case "not-git":
    case "malformed":
      return basename(workspacePath);
  }
}

/**
 * Sanitize a project name for use as a Docker container name.
 *
 * Docker container names must match [a-zA-Z0-9][a-zA-Z0-9_.-].
 * Replaces invalid characters with hyphens, strips leading/trailing
 * non-alphanumeric characters. Falls back to "lace-project" if the
 * result is empty.
 */
export function sanitizeContainerName(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, "-");
  sanitized = sanitized.replace(/^[^a-zA-Z0-9]+/, "");
  sanitized = sanitized.replace(/[^a-zA-Z0-9]+$/, "");
  return sanitized || "lace-project";
}

/**
 * Check if a Docker runArgs array contains a specific flag.
 * Handles both "--flag value" and "--flag=value" forms.
 */
export function hasRunArgsFlag(runArgs: string[], flag: string): boolean {
  return runArgs.some(
    (arg) => arg === flag || arg.startsWith(`${flag}=`),
  );
}
