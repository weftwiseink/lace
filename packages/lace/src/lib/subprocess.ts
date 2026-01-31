// IMPLEMENTATION_VALIDATION
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

export interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Thin wrapper for subprocess invocation, easily mockable in tests.
 * Default implementation shells out using execFileSync.
 */
export type RunSubprocess = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => SubprocessResult;

export const runSubprocess: RunSubprocess = (command, args, options) => {
  try {
    const opts: ExecFileSyncOptions = {
      cwd: options?.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    };
    const stdout = execFileSync(command, args, opts) as unknown as string;
    return { exitCode: 0, stdout: stdout ?? "", stderr: "" };
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: e.status ?? 1,
      stdout: (e.stdout as string) ?? "",
      stderr: (e.stderr as string) ?? e.message ?? "",
    };
  }
};
