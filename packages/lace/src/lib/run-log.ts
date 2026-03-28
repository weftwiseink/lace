// IMPLEMENTATION_VALIDATION
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Maximum stderr capture size (100KB). */
const MAX_STDERR_BYTES = 100 * 1024;
/** First portion kept when truncating. */
const TRUNCATE_HEAD_BYTES = 20 * 1024;
/** Last portion kept when truncating. */
const TRUNCATE_TAIL_BYTES = 80 * 1024;
/** Maximum number of recent log files to keep. */
const MAX_RECENT_LOGS = 10;
/** Maximum age in milliseconds for log retention (7 days). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A recorded pipeline phase in the run log. */
export interface PhaseEntry {
  name: string;
  status: "pass" | "fail" | "skip";
  durationMs?: number;
  message?: string;
}

/** A recorded subprocess invocation in the run log. */
export interface SubprocessEntry {
  phase: string;
  command: string;
  exitCode: number;
  stderr?: string;
}

/**
 * Persistent run log for a single `lace up` invocation.
 * Writes a plaintext log file to `.lace/logs/` on finalize().
 * All log writing is wrapped in try/catch: never affects the caller's return value.
 */
export class RunLog {
  private logDir: string;
  private logPath: string;
  private startTime: Date;
  private phases: PhaseEntry[] = [];
  private subprocesses: SubprocessEntry[] = [];
  private cliArgs: string[];
  private workspaceFolder: string;
  private configSummary: string | null = null;

  constructor(workspaceFolder: string, cliArgs: string[] = []) {
    this.workspaceFolder = workspaceFolder;
    this.cliArgs = cliArgs;
    this.startTime = new Date();
    this.logDir = join(workspaceFolder, ".lace", "logs");
    const timestamp = this.startTime.toISOString()
      .replace(/:/g, "-")
      .replace(/\.\d{3}Z$/, "");
    const suffix = randomBytes(3).toString("hex");
    this.logPath = join(this.logDir, `${timestamp}-${suffix}.log`);
  }

  /** Get the absolute path of the log file. */
  getLogPath(): string {
    return this.logPath;
  }

  /** Record a pipeline phase result. */
  logPhase(entry: PhaseEntry): void {
    this.phases.push(entry);
  }

  /** Record a subprocess invocation, truncating stderr if needed. */
  logSubprocess(entry: SubprocessEntry): void {
    const truncated = { ...entry };
    if (truncated.stderr) {
      truncated.stderr = truncateStderr(truncated.stderr);
    }
    this.subprocesses.push(truncated);
  }

  /** Set the resolved config summary (port/mount allocations). */
  setConfigSummary(summary: string): void {
    this.configSummary = summary;
  }

  /**
   * Write the log file and apply retention policy.
   * Wrapped in try/catch: never throws.
   */
  finalize(laceResult?: Record<string, unknown>): void {
    try {
      mkdirSync(this.logDir, { recursive: true });
      const lines: string[] = [];

      lines.push(`lace up log`);
      lines.push(`started: ${this.startTime.toISOString()}`);
      lines.push(`workspace: ${this.workspaceFolder}`);
      if (this.cliArgs.length > 0) {
        lines.push(`args: ${this.cliArgs.join(" ")}`);
      }
      lines.push("");

      // Phases
      lines.push("── phases ──");
      for (const phase of this.phases) {
        const duration = phase.durationMs !== undefined ? ` (${phase.durationMs}ms)` : "";
        const msg = phase.message ? `: ${phase.message}` : "";
        lines.push(`  ${phase.name}: ${phase.status}${duration}${msg}`);
      }
      lines.push("");

      // Subprocess output
      if (this.subprocesses.length > 0) {
        lines.push("── subprocess output ──");
        for (const sub of this.subprocesses) {
          lines.push(`  [${sub.phase}] ${sub.command} (exit ${sub.exitCode})`);
          if (sub.stderr) {
            lines.push("  stderr:");
            for (const line of sub.stderr.split("\n")) {
              lines.push(`    ${line}`);
            }
          }
        }
        lines.push("");
      }

      // Config summary
      if (this.configSummary) {
        lines.push("── config summary ──");
        lines.push(this.configSummary);
        lines.push("");
      }

      // LACE_RESULT
      if (laceResult) {
        lines.push("── LACE_RESULT ──");
        lines.push(JSON.stringify(laceResult, null, 2));
        lines.push("");
      }

      writeFileSync(this.logPath, lines.join("\n"), "utf-8");
      this.applyRetention();
    } catch {
      // Never affect the caller
    }
  }

  /** Apply retention policy: keep 10 most recent AND anything < 7 days. Delete the rest. */
  private applyRetention(): void {
    try {
      const entries = readdirSync(this.logDir)
        .filter(f => f.endsWith(".log"))
        .map(f => {
          const fullPath = join(this.logDir, f);
          const stat = statSync(fullPath);
          return { name: f, path: fullPath, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime); // newest first

      const now = Date.now();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isRecent = i < MAX_RECENT_LOGS;
        const isYoung = (now - entry.mtime) < MAX_AGE_MS;
        if (!isRecent && !isYoung) {
          try { unlinkSync(entry.path); } catch { /* ignore */ }
        }
      }
    } catch {
      // Never affect the caller
    }
  }
}

/**
 * Truncate stderr if it exceeds MAX_STDERR_BYTES.
 * Keeps the first TRUNCATE_HEAD_BYTES and last TRUNCATE_TAIL_BYTES with a marker.
 */
export function truncateStderr(stderr: string): string {
  const bytes = Buffer.byteLength(stderr, "utf-8");
  if (bytes <= MAX_STDERR_BYTES) return stderr;

  const buf = Buffer.from(stderr, "utf-8");
  const head = buf.subarray(0, TRUNCATE_HEAD_BYTES).toString("utf-8");
  const tail = buf.subarray(buf.length - TRUNCATE_TAIL_BYTES).toString("utf-8");
  const truncated = bytes - TRUNCATE_HEAD_BYTES - TRUNCATE_TAIL_BYTES;
  return `${head}\n[... truncated ${truncated} bytes ...]\n${tail}`;
}
