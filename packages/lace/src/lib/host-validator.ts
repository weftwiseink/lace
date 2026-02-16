// IMPLEMENTATION_VALIDATION
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ── Types ──

/** A single file-existence check, fully normalized. */
export interface FileExistsCheck {
  /** Absolute host path (after tilde/env expansion). */
  path: string;
  /** Original path string from config (for error messages). */
  originalPath: string;
  /** "error" aborts lace up; "warn" logs and continues. */
  severity: "error" | "warn";
  /** Remediation hint shown alongside the error/warning. */
  hint?: string;
}

/** Input shape before normalization (from devcontainer.json). */
export interface FileExistsCheckInput {
  path: string;
  severity?: "error" | "warn";
  hint?: string;
}

/** Schema for customizations.lace.validate in devcontainer.json. */
export interface ValidateConfig {
  fileExists?: Array<string | FileExistsCheckInput>;
}

/** Result of a single validation check. */
export interface CheckResult {
  passed: boolean;
  severity: "error" | "warn";
  message: string;
  hint?: string;
}

/** Aggregated result of all host validation checks. */
export interface HostValidationResult {
  /** Whether all error-severity checks passed. */
  passed: boolean;
  /** Individual check results. */
  checks: CheckResult[];
  /** Number of checks that failed with severity "error". */
  errorCount: number;
  /** Number of checks that failed with severity "warn". */
  warnCount: number;
}

// ── Public API ──

/**
 * Extract the validate config from customizations.lace.validate.
 * Returns null if no validate config is present.
 */
export function extractValidateConfig(
  config: Record<string, unknown>,
): ValidateConfig | null {
  const customizations = config.customizations as
    | Record<string, unknown>
    | undefined;
  if (!customizations) return null;
  const lace = customizations.lace as Record<string, unknown> | undefined;
  if (!lace) return null;
  const validate = lace.validate;
  if (!validate || typeof validate !== "object") return null;
  const v = validate as Record<string, unknown>;
  if (!v.fileExists || !Array.isArray(v.fileExists)) {
    return { fileExists: [] };
  }
  return { fileExists: v.fileExists as Array<string | FileExistsCheckInput> };
}

/**
 * Expand `~` at the start of a path to the user's home directory.
 */
export function expandPath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

/**
 * Normalize file-existence check entries from their shorthand and object forms
 * into fully resolved FileExistsCheck objects.
 */
export function normalizeFileExistsChecks(
  items: Array<string | FileExistsCheckInput>,
): FileExistsCheck[] {
  return items.map((item) => {
    if (typeof item === "string") {
      return {
        path: expandPath(item),
        originalPath: item,
        severity: "error" as const,
      };
    }
    return {
      path: expandPath(item.path),
      originalPath: item.path,
      severity: item.severity ?? "error",
      hint: item.hint,
    };
  });
}

/**
 * Run host-side validation checks from customizations.lace.validate.
 * When skipValidation is true, all "error" severities are downgraded to "warn".
 */
export function runHostValidation(
  config: Record<string, unknown>,
  options: { skipValidation?: boolean } = {},
): HostValidationResult {
  const { skipValidation = false } = options;
  const validateConfig = extractValidateConfig(config);

  if (!validateConfig || !validateConfig.fileExists || validateConfig.fileExists.length === 0) {
    return { passed: true, checks: [], errorCount: 0, warnCount: 0 };
  }

  const checks = normalizeFileExistsChecks(validateConfig.fileExists);
  const results: CheckResult[] = [];
  let errorCount = 0;
  let warnCount = 0;

  for (const check of checks) {
    const exists = existsSync(check.path);
    let severity = check.severity;

    // Downgrade errors to warnings when --skip-validation is set
    if (skipValidation && severity === "error") {
      severity = "warn";
    }

    if (exists) {
      results.push({
        passed: true,
        severity,
        message: `File exists: ${check.originalPath}`,
        hint: check.hint,
      });
    } else {
      if (severity === "error") {
        errorCount++;
      } else {
        warnCount++;
      }
      results.push({
        passed: false,
        severity,
        message: `Required file not found: ${check.originalPath} (expanded: ${check.path})`,
        hint: check.hint,
      });
    }
  }

  return {
    passed: errorCount === 0,
    checks: results,
    errorCount,
    warnCount,
  };
}
