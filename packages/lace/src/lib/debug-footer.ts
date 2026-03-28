// IMPLEMENTATION_VALIDATION
import { join } from "node:path";

export interface DebugFooterOptions {
  /** Absolute path to the run log file. */
  logPath?: string;
  /** The phase that failed. */
  failedPhase: string;
  /** The project name. */
  projectName?: string;
  /** Absolute path to the workspace folder. */
  workspaceFolder: string;
}

/**
 * Format a structured debugging footer for agent consumption.
 * All paths are absolute for unambiguous resolution.
 * Emitted when lace up or lace validate exits with a non-zero code.
 */
export function formatDebugFooter(options: DebugFooterOptions): string {
  const { logPath, failedPhase, projectName, workspaceFolder } = options;
  const laceDir = join(workspaceFolder, ".lace");
  const lines: string[] = [];

  lines.push("─── lace debugging context ───");
  if (logPath) {
    lines.push(`  log: ${logPath}`);
  }
  lines.push(`  config: ${join(laceDir, "devcontainer.json")}`);
  lines.push(`  mounts: ${join(laceDir, "mount-assignments.json")}`);
  lines.push(`  ports: ${join(laceDir, "port-assignments.json")}`);
  lines.push(`  failed phase: ${failedPhase}`);
  if (projectName) {
    lines.push(`  project: ${projectName}`);
  }
  lines.push(`  workspace: ${workspaceFolder}`);
  lines.push("");
  lines.push(`To debug, run: lace validate --workspace-folder ${workspaceFolder}`);

  return lines.join("\n");
}
