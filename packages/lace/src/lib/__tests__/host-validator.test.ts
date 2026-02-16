// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  extractValidateConfig,
  expandPath,
  normalizeFileExistsChecks,
  runHostValidation,
} from "../host-validator";

let testDir: string;

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `lace-test-host-validator-${suffix}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── extractValidateConfig ──

describe("extractValidateConfig", () => {
  it("returns null when no customizations", () => {
    expect(extractValidateConfig({})).toBeNull();
  });

  it("returns null when no lace customizations", () => {
    expect(extractValidateConfig({ customizations: {} })).toBeNull();
  });

  it("returns null when no validate config", () => {
    expect(extractValidateConfig({ customizations: { lace: {} } })).toBeNull();
  });

  it("returns empty fileExists when validate has no fileExists", () => {
    const result = extractValidateConfig({
      customizations: { lace: { validate: {} } },
    });
    expect(result).toEqual({ fileExists: [] });
  });

  it("parses fileExists array with string entries", () => {
    const result = extractValidateConfig({
      customizations: {
        lace: {
          validate: {
            fileExists: ["~/.ssh/key.pub", "/etc/hosts"],
          },
        },
      },
    });
    expect(result?.fileExists).toHaveLength(2);
    expect(result?.fileExists?.[0]).toBe("~/.ssh/key.pub");
    expect(result?.fileExists?.[1]).toBe("/etc/hosts");
  });

  it("parses fileExists array with object entries", () => {
    const result = extractValidateConfig({
      customizations: {
        lace: {
          validate: {
            fileExists: [
              { path: "~/.ssh/key.pub", severity: "error", hint: "Create it" },
            ],
          },
        },
      },
    });
    expect(result?.fileExists).toHaveLength(1);
    const entry = result?.fileExists?.[0] as { path: string; severity: string; hint: string };
    expect(entry.path).toBe("~/.ssh/key.pub");
    expect(entry.severity).toBe("error");
    expect(entry.hint).toBe("Create it");
  });
});

// ── expandPath ──

describe("expandPath", () => {
  it("expands tilde to home directory", () => {
    const result = expandPath("~/some/file");
    expect(result).toBe(join(homedir(), "some/file"));
  });

  it("expands bare tilde to home directory", () => {
    const result = expandPath("~");
    expect(result).toBe(homedir());
  });

  it("leaves absolute paths unchanged", () => {
    const result = expandPath("/absolute/path");
    expect(result).toBe("/absolute/path");
  });

  it("resolves relative paths", () => {
    const result = expandPath("relative/path");
    expect(result).toBe(join(process.cwd(), "relative/path"));
  });
});

// ── normalizeFileExistsChecks ──

describe("normalizeFileExistsChecks", () => {
  it("normalizes shorthand string to error severity", () => {
    const result = normalizeFileExistsChecks(["~/.ssh/key.pub"]);
    expect(result).toHaveLength(1);
    expect(result[0].originalPath).toBe("~/.ssh/key.pub");
    expect(result[0].path).toBe(join(homedir(), ".ssh/key.pub"));
    expect(result[0].severity).toBe("error");
    expect(result[0].hint).toBeUndefined();
  });

  it("normalizes object with explicit severity", () => {
    const result = normalizeFileExistsChecks([
      { path: "/some/file", severity: "warn", hint: "Create it" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].originalPath).toBe("/some/file");
    expect(result[0].path).toBe("/some/file");
    expect(result[0].severity).toBe("warn");
    expect(result[0].hint).toBe("Create it");
  });

  it("defaults severity to error when not specified in object", () => {
    const result = normalizeFileExistsChecks([{ path: "/some/file" }]);
    expect(result[0].severity).toBe("error");
  });
});

// ── runHostValidation ──

describe("runHostValidation", () => {
  it("fileExists — present file passes", () => {
    const filePath = join(testDir, "exists.txt");
    writeFileSync(filePath, "content", "utf-8");

    const result = runHostValidation({
      customizations: {
        lace: {
          validate: { fileExists: [filePath] },
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].passed).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.warnCount).toBe(0);
  });

  it("fileExists — missing file with severity error fails validation", () => {
    const missingPath = join(testDir, "does-not-exist.txt");

    const result = runHostValidation({
      customizations: {
        lace: {
          validate: {
            fileExists: [
              {
                path: missingPath,
                severity: "error",
                hint: "Run: touch the-file",
              },
            ],
          },
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].severity).toBe("error");
    expect(result.checks[0].message).toContain("Required file not found");
    expect(result.checks[0].hint).toBe("Run: touch the-file");
    expect(result.errorCount).toBe(1);
    expect(result.warnCount).toBe(0);
  });

  it("fileExists — missing file with severity warn emits warning but passes", () => {
    const missingPath = join(testDir, "optional-file.txt");

    const result = runHostValidation({
      customizations: {
        lace: {
          validate: {
            fileExists: [
              {
                path: missingPath,
                severity: "warn",
                hint: "This is optional",
              },
            ],
          },
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].severity).toBe("warn");
    expect(result.warnCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  it("fileExists — symlink to existing target passes", () => {
    const targetPath = join(testDir, "real-file.txt");
    writeFileSync(targetPath, "content", "utf-8");
    const linkPath = join(testDir, "link-to-file");
    symlinkSync(targetPath, linkPath);

    const result = runHostValidation({
      customizations: {
        lace: {
          validate: { fileExists: [linkPath] },
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.checks[0].passed).toBe(true);
  });

  it("fileExists — symlink to missing target fails", () => {
    const linkPath = join(testDir, "broken-link");
    symlinkSync(join(testDir, "nonexistent-target"), linkPath);

    const result = runHostValidation({
      customizations: {
        lace: {
          validate: { fileExists: [linkPath] },
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0].passed).toBe(false);
  });

  it("fileExists — tilde expansion works", () => {
    // We test tilde expansion by using a path that starts with ~/ and verifying
    // the expanded path is reported correctly in the message
    const result = runHostValidation({
      customizations: {
        lace: {
          validate: {
            fileExists: ["~/this-file-definitely-does-not-exist-12345"],
          },
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0].message).toContain(
      join(homedir(), "this-file-definitely-does-not-exist-12345"),
    );
    // Original path preserved in message
    expect(result.checks[0].message).toContain(
      "~/this-file-definitely-does-not-exist-12345",
    );
  });

  it("fileExists — shorthand string treated as error severity", () => {
    const missingPath = join(testDir, "missing.txt");

    const result = runHostValidation({
      customizations: {
        lace: {
          validate: { fileExists: [missingPath] },
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0].severity).toBe("error");
    expect(result.errorCount).toBe(1);
  });

  it("--skip-validation downgrades error to warning", () => {
    const missingPath = join(testDir, "required-but-skipped.txt");

    const result = runHostValidation(
      {
        customizations: {
          lace: {
            validate: {
              fileExists: [
                { path: missingPath, severity: "error", hint: "Create it" },
              ],
            },
          },
        },
      },
      { skipValidation: true },
    );

    // Should pass because error was downgraded to warning
    expect(result.passed).toBe(true);
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].severity).toBe("warn");
    expect(result.errorCount).toBe(0);
    expect(result.warnCount).toBe(1);
  });

  it("no validate config returns passing result with empty checks", () => {
    const result = runHostValidation({});

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warnCount).toBe(0);
  });

  it("empty fileExists array returns passing result with empty checks", () => {
    const result = runHostValidation({
      customizations: {
        lace: {
          validate: { fileExists: [] },
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warnCount).toBe(0);
  });
});
