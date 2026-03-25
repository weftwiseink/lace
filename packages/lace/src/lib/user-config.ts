// IMPLEMENTATION_VALIDATION
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, normalize } from "node:path";
import { homedir } from "node:os";
import * as jsonc from "jsonc-parser";
import { expandPath, resolveSettingsPath } from "./settings";
import { isLocalPath } from "./feature-metadata";

// ── Types ──

export interface UserMountDeclaration {
  source: string;
  target: string;
  description?: string;
}

export interface UserGitIdentity {
  name: string;
  email: string;
}

export interface UserConfig {
  mounts?: Record<string, UserMountDeclaration>;
  features?: Record<string, Record<string, unknown>>;
  git?: UserGitIdentity;
  defaultShell?: string;
  containerEnv?: Record<string, string>;
}

// ── Error class ──

export class UserConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConfigError";
  }
}

// ── Mount policy types ──

export interface PolicyRule {
  pattern: string;
  type: "allow" | "deny";
}

// ── Default mount policy ──

export const DEFAULT_MOUNT_POLICY = `# Lace default mount policy
# Protects credential stores and sensitive directories.
# Users can override in ~/.config/lace/mount-policy

# Home directory root: would bypass all other rules
~/

# SSH and GPG keys
~/.ssh
~/.gnupg
~/.gpg

# Cloud provider credentials
~/.aws
~/.kube
~/.config/gcloud
~/.azure

# Tool-specific credentials
~/.config/gh
~/.config/op
~/.docker
~/.npmrc
~/.netrc
~/.pypirc

# Secret stores
~/.local/share/keyrings
~/.password-store

# Docker socket
/var/run/docker.sock
/run/docker.sock
`;

// ── File discovery ──

/**
 * Find the user.json file following the discovery order:
 * 1. LACE_USER_CONFIG environment variable (file path)
 * 2. ~/.config/lace/user.json (XDG-compliant primary location)
 *
 * Returns the path if found, null otherwise.
 */
export function findUserConfig(): string | null {
  const envPath = process.env.LACE_USER_CONFIG;
  if (envPath) {
    const resolved = resolveSettingsPath(envPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    throw new UserConfigError(
      `LACE_USER_CONFIG points to non-existent file: ${envPath}`,
    );
  }

  const xdgPath = join(homedir(), ".config", "lace", "user.json");
  if (existsSync(xdgPath)) {
    return xdgPath;
  }

  return null;
}

/**
 * Read and parse a user.json file.
 * Throws UserConfigError for parse errors.
 */
export function readUserConfig(filePath: string): UserConfig {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new UserConfigError(`Cannot read user config file: ${filePath}`);
  }

  const errors: jsonc.ParseError[] = [];
  const raw = jsonc.parse(content, errors) as UserConfig;

  if (errors.length > 0) {
    const first = errors[0];
    throw new UserConfigError(
      `Malformed user.json at offset ${first.offset}: ${jsonc.printParseErrorCode(first.error)}`,
    );
  }

  return raw;
}

/**
 * Load user config from the default locations.
 * Returns an empty config object if no user.json exists.
 * Throws UserConfigError for parse errors or missing LACE_USER_CONFIG file.
 */
export function loadUserConfig(): UserConfig {
  const configPath = findUserConfig();
  if (!configPath) {
    return {};
  }
  return readUserConfig(configPath);
}

// ── Mount policy ──

/**
 * Parse a mount policy string into an array of rules.
 * Blank lines and lines starting with # are ignored.
 */
export function parseMountPolicy(content: string): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("!")) {
      rules.push({ pattern: trimmed.slice(1), type: "allow" });
    } else {
      rules.push({ pattern: trimmed, type: "deny" });
    }
  }
  return rules;
}

/**
 * Load the mount policy: default rules + user rules (if policy file exists).
 * User rules are appended after default rules (last match wins).
 */
export function loadMountPolicy(): PolicyRule[] {
  const defaultRules = parseMountPolicy(DEFAULT_MOUNT_POLICY);

  const envPath = process.env.LACE_MOUNT_POLICY;
  let userPolicyPath: string | null = null;

  if (envPath) {
    const resolved = resolveSettingsPath(envPath);
    if (existsSync(resolved)) {
      userPolicyPath = resolved;
    }
  } else {
    const xdgPath = join(homedir(), ".config", "lace", "mount-policy");
    if (existsSync(xdgPath)) {
      userPolicyPath = xdgPath;
    }
  }

  if (!userPolicyPath) {
    return defaultRules;
  }

  const userContent = readFileSync(userPolicyPath, "utf-8");
  const userRules = parseMountPolicy(userContent);
  return [...defaultRules, ...userRules];
}

/**
 * Path-aware prefix matching.
 * `~/.ssh` matches `~/.ssh`, `~/.ssh/config`, `~/.ssh/keys/id_ed25519`
 * but NOT `~/.sshrc` or `~/.ssh-backup`.
 * Requires exact match or a `/` separator immediately after the prefix.
 *
 * Special case: the home directory root (~/  expanding to just homedir())
 * only matches exactly. This prevents `~/` from blocking all paths under home.
 * The intent of `~/` in policy is "don't mount your entire home directory",
 * not "don't mount anything from home".
 */
function matchesPathPrefix(source: string, pattern: string): boolean {
  if (source === pattern) return true;
  // Home directory root: exact match only
  if (pattern === homedir()) return false;
  if (source.startsWith(pattern) && source[pattern.length] === "/") return true;
  return false;
}

/**
 * Match a source path against a policy rule pattern.
 * Supports:
 * - Exact paths and path-aware prefix matching (no glob chars)
 * - `*` matches within a single path component
 * - `**` matches across path components
 */
function matchesGlob(source: string, pattern: string): boolean {
  // Expand tilde in pattern for comparison
  const expandedPattern = expandPath(pattern);
  const expandedSource = source;

  // If pattern has no glob characters, use path-aware prefix matching
  if (!expandedPattern.includes("*")) {
    return matchesPathPrefix(expandedSource, expandedPattern);
  }

  // Handle ** (recursive glob) and * (single-component glob)
  const regexStr = expandedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0GLOBSTAR\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0GLOBSTAR\0/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(expandedSource);
}

/**
 * Evaluate a source path against merged policy rules (last match wins).
 * Returns "allow" or "deny".
 */
export function evaluateMountPolicy(
  source: string,
  rules: PolicyRule[],
): "allow" | "deny" {
  let result: "allow" | "deny" = "allow";

  for (const rule of rules) {
    if (matchesGlob(source, rule.pattern)) {
      result = rule.type;
    }
  }

  return result;
}

/**
 * Resolve a mount source path for policy evaluation.
 * Expands tilde, normalizes, and resolves symlinks via realpath().
 * Returns null if realpath fails (broken symlink or nonexistent path).
 */
export function resolveSourceForPolicy(source: string): string | null {
  const expanded = expandPath(source);
  const normalized = normalize(expanded);

  try {
    return realpathSync(normalized);
  } catch {
    return null;
  }
}

/**
 * Validate all user mount sources against the mount policy.
 * Returns an object with valid mounts and any errors/warnings.
 */
export function validateMountSources(
  mounts: Record<string, UserMountDeclaration>,
  rules: PolicyRule[],
): {
  valid: Record<string, UserMountDeclaration>;
  errors: string[];
  warnings: string[];
} {
  const valid: Record<string, UserMountDeclaration> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [name, mount] of Object.entries(mounts)) {
    const label = `user/${name}`;

    // Resolve symlinks before policy evaluation
    const resolved = resolveSourceForPolicy(mount.source);
    if (resolved === null) {
      // Broken symlink or nonexistent path: skip with warning
      if (!existsSync(expandPath(mount.source))) {
        warnings.push(
          `User mount "${label}" skipped: source "${mount.source}" does not exist on this host.`,
        );
      } else {
        warnings.push(
          `User mount "${label}" skipped: source "${mount.source}" could not be resolved (broken symlink?).`,
        );
      }
      continue;
    }

    // Evaluate against mount policy
    const verdict = evaluateMountPolicy(resolved, rules);
    if (verdict === "deny") {
      // Find the matching rule for the error message
      let matchingRule = "";
      for (const rule of rules) {
        if (rule.type === "deny" && matchesGlob(resolved, rule.pattern)) {
          matchingRule = rule.pattern;
        }
      }
      errors.push(
        `User mount "${label}" blocked: source "${mount.source}" matches ` +
          `mount policy rule "${matchingRule}". User mounts cannot access credential directories.\n` +
          `To allow this path, add "!${mount.source}" to ~/.config/lace/mount-policy.`,
      );
      continue;
    }

    valid[name] = mount;
  }

  return { valid, errors, warnings };
}

/**
 * Validate that user-declared features are not local paths.
 * Only registry features (ghcr.io, mcr.microsoft.com, etc.) are allowed.
 */
export function validateFeatureReferences(
  features: Record<string, Record<string, unknown>>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const featureId of Object.keys(features)) {
    if (isLocalPath(featureId)) {
      errors.push(
        `User feature "${featureId}" is a local path. User config only allows registry features ` +
          `(e.g., ghcr.io/...). Local features must be declared in the project's devcontainer.json.`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
