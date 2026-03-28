// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunLog, truncateStderr } from "../run-log";

let testDir: string;
let workspaceFolder: string;

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `lace-test-run-log-${suffix}`);
  workspaceFolder = join(testDir, "workspace");
  mkdirSync(workspaceFolder, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("RunLog — file creation and structure", () => {
  it("finalize() writes a log file with expected name pattern", () => {
    const log = new RunLog(workspaceFolder);
    log.finalize();

    const logDir = join(workspaceFolder, ".lace", "logs");
    expect(existsSync(logDir)).toBe(true);

    const logPath = log.getLogPath();
    expect(existsSync(logPath)).toBe(true);
    // Filename pattern: YYYY-MM-DDTHH-MM-SS-<6hex>.log
    const filename = logPath.split("/").pop()!;
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{2}:\d{2})?-[a-f0-9]{6}\.log$/);
  });

  it("log file contains invocation metadata", () => {
    const log = new RunLog(workspaceFolder, ["--skip-devcontainer-up"]);
    log.finalize();

    const content = readFileSync(log.getLogPath(), "utf-8");
    expect(content).toContain("lace up log");
    expect(content).toContain(`workspace: ${workspaceFolder}`);
    expect(content).toContain("--skip-devcontainer-up");
  });

  it("log file contains phase entries", () => {
    const log = new RunLog(workspaceFolder);
    log.logPhase({ name: "templateResolution", status: "pass", durationMs: 42, message: "3 ports" });
    log.logPhase({ name: "mountValidation", status: "fail", message: "missing source" });
    log.finalize();

    const content = readFileSync(log.getLogPath(), "utf-8");
    expect(content).toContain("templateResolution: pass (42ms): 3 ports");
    expect(content).toContain("mountValidation: fail: missing source");
  });

  it("log file contains subprocess entries with stderr", () => {
    const log = new RunLog(workspaceFolder);
    log.logSubprocess({
      phase: "devcontainerUp",
      command: "devcontainer up --workspace-folder /tmp/test",
      exitCode: 1,
      stderr: "Error: build failed\ndetail line",
    });
    log.finalize();

    const content = readFileSync(log.getLogPath(), "utf-8");
    expect(content).toContain("[devcontainerUp]");
    expect(content).toContain("exit 1");
    expect(content).toContain("Error: build failed");
    expect(content).toContain("detail line");
  });

  it("log file contains LACE_RESULT when provided", () => {
    const log = new RunLog(workspaceFolder);
    const laceResult = { exitCode: 1, failedPhase: "mountValidation" };
    log.finalize(laceResult);

    const content = readFileSync(log.getLogPath(), "utf-8");
    expect(content).toContain("LACE_RESULT");
    expect(content).toContain('"exitCode": 1');
    expect(content).toContain('"failedPhase": "mountValidation"');
  });

  it("log file contains config summary when set", () => {
    const log = new RunLog(workspaceFolder);
    log.setConfigSummary("ports: 22427\nmounts: sprack/data -> /mnt/sprack");
    log.finalize();

    const content = readFileSync(log.getLogPath(), "utf-8");
    expect(content).toContain("config summary");
    expect(content).toContain("ports: 22427");
  });
});

describe("RunLog — retention policy", () => {
  it("keeps 10 most recent log files and deletes older ones beyond 10", () => {
    const logDir = join(workspaceFolder, ".lace", "logs");
    mkdirSync(logDir, { recursive: true });

    // Create 12 old log files (older than 7 days)
    const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    for (let i = 0; i < 12; i++) {
      const filename = `2026-03-${String(10 + i).padStart(2, "0")}T10-00-00-aabb${String(i).padStart(2, "0")}.log`;
      const filePath = join(logDir, filename);
      writeFileSync(filePath, `old log ${i}`, "utf-8");
      // Set mtime to be old but ordered by index (higher index = newer)
      const fs = require("node:fs");
      const mtime = new Date(oldTime + i * 1000);
      fs.utimesSync(filePath, mtime, mtime);
    }

    // Finalize a new log (13th total)
    const log = new RunLog(workspaceFolder);
    log.finalize();

    // Count remaining log files
    const remaining = require("node:fs").readdirSync(logDir).filter((f: string) => f.endsWith(".log"));

    // Should keep: 10 most recent (the new one + 9 newest old ones) plus anything < 7 days
    // The new log is < 7 days old, so it's kept by both rules.
    // Old logs are all > 7 days old, so only the 9 most recent of those survive (the new log takes one of the 10 slots).
    // Total: 10 (the cap) because the new log plus 9 old ones are within the 10 most recent,
    // and the remaining 3 old ones are both > 7 days and beyond the 10 most recent.
    expect(remaining.length).toBe(10);
  });

  it("keeps files younger than 7 days even beyond the 10 most recent", () => {
    const logDir = join(workspaceFolder, ".lace", "logs");
    mkdirSync(logDir, { recursive: true });

    // Create 12 recent log files (all within 7 days)
    for (let i = 0; i < 12; i++) {
      const filename = `2026-03-${String(20 + i).padStart(2, "0")}T10-00-${String(i).padStart(2, "0")}-aabb${String(i).padStart(2, "0")}.log`;
      const filePath = join(logDir, filename);
      writeFileSync(filePath, `recent log ${i}`, "utf-8");
      // These are all recently modified (within 7 days by default since we just created them)
    }

    // Finalize a new log (13th total)
    const log = new RunLog(workspaceFolder);
    log.finalize();

    const remaining = require("node:fs").readdirSync(logDir).filter((f: string) => f.endsWith(".log"));

    // All files are < 7 days old, so all 13 are kept
    expect(remaining.length).toBe(13);
  });
});

describe("truncateStderr", () => {
  it("returns short stderr unchanged", () => {
    const short = "Error: something broke";
    expect(truncateStderr(short)).toBe(short);
  });

  it("truncates stderr exceeding 100KB", () => {
    // Create a string > 100KB
    const large = "x".repeat(150 * 1024);
    const result = truncateStderr(large);

    expect(result.length).toBeLessThan(large.length);
    expect(result).toContain("[... truncated");
    expect(result).toContain("bytes ...]");
  });

  it("preserves head and tail of truncated stderr", () => {
    const head = "HEAD_MARKER_" + "a".repeat(20 * 1024 - 20);
    const middle = "m".repeat(60 * 1024);
    const tail = "b".repeat(80 * 1024 - 20) + "_TAIL_MARKER";
    const large = head + middle + tail;

    const result = truncateStderr(large);
    expect(result).toContain("HEAD_MARKER_");
    expect(result).toContain("_TAIL_MARKER");
  });
});

describe("RunLog — error resilience", () => {
  it("finalize() does not throw when log directory cannot be created", () => {
    // Use a path that can't be created (file in place of directory)
    const badWorkspace = join(testDir, "bad-workspace");
    mkdirSync(badWorkspace, { recursive: true });
    const laceDir = join(badWorkspace, ".lace");
    mkdirSync(laceDir, { recursive: true });
    // Create "logs" as a file, blocking directory creation
    writeFileSync(join(laceDir, "logs"), "not a directory", "utf-8");

    const log = new RunLog(badWorkspace);
    // Should not throw
    expect(() => log.finalize()).not.toThrow();
  });
});
