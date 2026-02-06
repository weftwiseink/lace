// IMPLEMENTATION_VALIDATION
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import * as jsonc from "jsonc-parser";

/**
 * User-level lace settings configuration.
 */
export interface LaceSettings {
  repoMounts?: {
    [repoId: string]: RepoMountSettings;
  };
}

/**
 * Per-repo mount settings in the user's configuration.
 */
export interface RepoMountSettings {
  overrideMount?: {
    /** Local path to mount (required for override) */
    source: string;
    /** Mount as read-only (default: true) */
    readonly?: boolean;
    /** Custom container mount target */
    target?: string;
  };
}

export class SettingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsConfigError";
  }
}

/**
 * Expand tilde (~) to the user's home directory.
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

/**
 * Expand tilde and resolve to absolute path.
 */
export function resolveSettingsPath(path: string): string {
  return resolve(expandPath(path));
}

/**
 * Find the settings.json file following the discovery order:
 * 1. LACE_SETTINGS environment variable (file path)
 * 2. ~/.config/lace/settings.json (XDG-compliant primary location)
 * 3. ~/.lace/settings.json (legacy/simple location)
 *
 * Returns the path if found, null otherwise.
 */
export function findSettingsConfig(): string | null {
  // 1. Environment variable
  const envPath = process.env.LACE_SETTINGS;
  if (envPath) {
    const resolved = resolveSettingsPath(envPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    // If LACE_SETTINGS is set but file doesn't exist, that's an error
    throw new SettingsConfigError(
      `LACE_SETTINGS points to non-existent file: ${envPath}`,
    );
  }

  // 2. XDG-compliant location
  const xdgPath = join(homedir(), ".config", "lace", "settings.json");
  if (existsSync(xdgPath)) {
    return xdgPath;
  }

  // 3. Legacy location
  const legacyPath = join(homedir(), ".lace", "settings.json");
  if (existsSync(legacyPath)) {
    return legacyPath;
  }

  return null;
}

/**
 * Read and parse a settings.json file.
 * Returns null if the file doesn't exist.
 * Throws SettingsConfigError for parse errors.
 */
export function readSettingsConfig(filePath: string): LaceSettings {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new SettingsConfigError(`Cannot read settings file: ${filePath}`);
  }

  const errors: jsonc.ParseError[] = [];
  const raw = jsonc.parse(content, errors) as LaceSettings;

  if (errors.length > 0) {
    const first = errors[0];
    throw new SettingsConfigError(
      `Malformed settings.json at offset ${first.offset}: ${jsonc.printParseErrorCode(first.error)}`,
    );
  }

  // Expand paths in repo mount overrides
  if (raw.repoMounts) {
    for (const [repoId, settings] of Object.entries(raw.repoMounts)) {
      if (settings.overrideMount?.source) {
        settings.overrideMount.source = resolveSettingsPath(
          settings.overrideMount.source,
        );
      }
    }
  }

  return raw;
}

/**
 * Load settings from the default locations.
 * Returns an empty settings object if no settings file exists.
 * Throws SettingsConfigError for parse errors or missing LACE_SETTINGS file.
 */
export function loadSettings(): LaceSettings {
  const configPath = findSettingsConfig();
  if (!configPath) {
    return {};
  }
  return readSettingsConfig(configPath);
}
