// IMPLEMENTATION_VALIDATION
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as jsonc from "jsonc-parser";

/** Discriminated result for prebuild feature extraction. */
export type PrebuildFeaturesResult =
  | { kind: "features"; features: Record<string, Record<string, unknown>> }
  | { kind: "absent" }
  | { kind: "null" }
  | { kind: "empty" };

/** Build source for a devcontainer config - either Dockerfile-based or image-based. */
export type ConfigBuildSource =
  | { kind: "dockerfile"; path: string }
  | { kind: "image"; image: string };

/** Plugin options as declared in devcontainer.json */
export interface PluginOptions {
  /**
   * Explicit name for this plugin, used in mount path.
   * Use when multiple plugins would have the same derived name.
   */
  alias?: string;
}

/** Plugin configuration from devcontainer.json */
export interface PluginsConfig {
  [repoId: string]: PluginOptions;
}

/** Discriminated result for plugins extraction. */
export type PluginsResult =
  | { kind: "plugins"; plugins: PluginsConfig }
  | { kind: "absent" }
  | { kind: "null" }
  | { kind: "empty" };

export class DevcontainerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevcontainerConfigError";
  }
}

/** Parsed devcontainer.json with the fields we care about. */
export interface DevcontainerConfig {
  /** The raw parsed JSONC object. */
  raw: Record<string, unknown>;
  /** The build source (Dockerfile or image). */
  buildSource: ConfigBuildSource;
  /**
   * The resolved Dockerfile path.
   * @deprecated Use buildSource instead. This will throw for image-based configs.
   */
  dockerfilePath: string;
  /** Regular features from the `features` key. */
  features: Record<string, Record<string, unknown>>;
  /** The config file's directory (for resolving relative paths). */
  configDir: string;
  /** The path to the devcontainer.json file. */
  configPath: string;
}

/** Minimal parsed devcontainer.json for plugins/mounts (no Dockerfile required). */
export interface DevcontainerConfigMinimal {
  /** The raw parsed JSONC object. */
  raw: Record<string, unknown>;
  /** The config file's directory (for resolving relative paths). */
  configDir: string;
}

/**
 * Read and parse a devcontainer.json (JSONC) file.
 * This version resolves the build source and is used by prebuild.
 */
export function readDevcontainerConfig(filePath: string): DevcontainerConfig {
  const minimal = readDevcontainerConfigMinimal(filePath);
  const buildSource = resolveBuildSource(minimal.raw, minimal.configDir);
  const features = (minimal.raw.features ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  // For backwards compatibility, compute dockerfilePath from buildSource
  // This will be undefined for image-based configs
  const dockerfilePath =
    buildSource.kind === "dockerfile" ? buildSource.path : undefined;

  return {
    raw: minimal.raw,
    buildSource,
    dockerfilePath: dockerfilePath as string, // Type assertion for backwards compat
    features,
    configDir: minimal.configDir,
    configPath: filePath,
  };
}

/**
 * Read and parse a devcontainer.json (JSONC) file without requiring a Dockerfile.
 * Used by resolve-mounts and other commands that don't need Dockerfile access.
 */
export function readDevcontainerConfigMinimal(
  filePath: string,
): DevcontainerConfigMinimal {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new DevcontainerConfigError(
      `Cannot read devcontainer.json: ${filePath}`,
    );
  }

  const errors: jsonc.ParseError[] = [];
  const raw = jsonc.parse(content, errors) as Record<string, unknown>;

  if (errors.length > 0) {
    const first = errors[0];
    throw new DevcontainerConfigError(
      `Malformed devcontainer.json at offset ${first.offset}: ${jsonc.printParseErrorCode(first.error)}`,
    );
  }

  const configDir = resolve(filePath, "..");
  return { raw, configDir };
}

/**
 * Extract prebuildFeatures from a parsed devcontainer config.
 */
export function extractPrebuildFeatures(
  raw: Record<string, unknown>,
): PrebuildFeaturesResult {
  const customizations = raw.customizations as
    | Record<string, unknown>
    | undefined;
  if (!customizations) return { kind: "absent" };

  const lace = customizations.lace as Record<string, unknown> | undefined;
  if (!lace) return { kind: "absent" };

  if (!("prebuildFeatures" in lace)) return { kind: "absent" };

  const prebuildFeatures = lace.prebuildFeatures;
  if (prebuildFeatures === null) return { kind: "null" };
  if (
    typeof prebuildFeatures === "object" &&
    Object.keys(prebuildFeatures as object).length === 0
  ) {
    return { kind: "empty" };
  }

  return {
    kind: "features",
    features: prebuildFeatures as Record<string, Record<string, unknown>>,
  };
}

/**
 * Resolve the build source from a devcontainer config.
 * Supports `build.dockerfile`, legacy `dockerfile` field, or `image`.
 * Dockerfile takes precedence over image if both are present.
 */
export function resolveBuildSource(
  raw: Record<string, unknown>,
  configDir: string,
): ConfigBuildSource {
  // Check build.dockerfile first (modern format)
  const build = raw.build as Record<string, unknown> | undefined;
  if (build?.dockerfile) {
    return {
      kind: "dockerfile",
      path: resolve(configDir, build.dockerfile as string),
    };
  }

  // Check legacy dockerfile field
  if (raw.dockerfile) {
    return {
      kind: "dockerfile",
      path: resolve(configDir, raw.dockerfile as string),
    };
  }

  // Check for image-based config
  if (raw.image) {
    return { kind: "image", image: raw.image as string };
  }

  throw new DevcontainerConfigError(
    "Cannot determine build source from devcontainer.json. " +
      "Expected `build.dockerfile`, `dockerfile`, or `image` field.",
  );
}

/**
 * Resolve the Dockerfile path from a devcontainer config.
 * Supports `build.dockerfile`, legacy `dockerfile` field.
 * Errors on `image`-based configs without a Dockerfile.
 * @deprecated Use resolveBuildSource() instead.
 */
export function resolveDockerfilePath(
  raw: Record<string, unknown>,
  configDir: string,
): string {
  const source = resolveBuildSource(raw, configDir);
  if (source.kind === "dockerfile") {
    return source.path;
  }
  throw new DevcontainerConfigError(
    "This function only supports Dockerfile-based configs. " +
      "Use resolveBuildSource() for image-based config support.",
  );
}

/**
 * Generate a minimal devcontainer.json for the prebuild temp context.
 * Promotes prebuildFeatures to the `features` key. Excludes original features.
 */
export function generateTempDevcontainerJson(
  prebuildFeatures: Record<string, Record<string, unknown>>,
  dockerfileName: string,
): string {
  const config = {
    build: { dockerfile: dockerfileName },
    features: prebuildFeatures,
  };
  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Extract plugins configuration from a parsed devcontainer config.
 */
export function extractPlugins(raw: Record<string, unknown>): PluginsResult {
  const customizations = raw.customizations as
    | Record<string, unknown>
    | undefined;
  if (!customizations) return { kind: "absent" };

  const lace = customizations.lace as Record<string, unknown> | undefined;
  if (!lace) return { kind: "absent" };

  if (!("plugins" in lace)) return { kind: "absent" };

  const plugins = lace.plugins;
  if (plugins === null) return { kind: "null" };
  if (typeof plugins === "object" && Object.keys(plugins as object).length === 0) {
    return { kind: "empty" };
  }

  return {
    kind: "plugins",
    plugins: plugins as PluginsConfig,
  };
}

/**
 * Derive the plugin name from a repo identifier.
 * Returns the last path segment of the repoId.
 *
 * Examples:
 * - "github.com/user/repo" -> "repo"
 * - "github.com/user/repo/subdir" -> "subdir"
 * - "github.com/user/repo/deep/path" -> "path"
 */
export function derivePluginName(repoId: string): string {
  const segments = repoId.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] || repoId;
}

/**
 * Get the name or alias for a plugin.
 * Uses the alias if specified, otherwise derives from repoId.
 */
export function getPluginNameOrAlias(
  repoId: string,
  options: PluginOptions,
): string {
  return options.alias ?? derivePluginName(repoId);
}

/**
 * Parse clone URL and subdirectory from a repo identifier.
 * Format: github.com/user/repo[/subdir/path]
 *
 * Returns:
 * - cloneUrl: https://github.com/user/repo.git
 * - subdirectory: subdir/path (or undefined if no subdirectory)
 */
export function parseRepoId(repoId: string): {
  cloneUrl: string;
  subdirectory: string | undefined;
} {
  const segments = repoId.split("/");

  // Minimum: host/user/repo (3 segments)
  if (segments.length < 3) {
    throw new DevcontainerConfigError(
      `Invalid repo identifier: ${repoId}. Expected format: github.com/user/repo[/subdir]`,
    );
  }

  const [host, user, repo, ...subParts] = segments;

  // Construct clone URL
  const cloneUrl = `https://${host}/${user}/${repo}.git`;

  // Extract subdirectory if present
  const subdirectory =
    subParts.length > 0 ? subParts.join("/") : undefined;

  return { cloneUrl, subdirectory };
}

/**
 * Rewrite the `image` field in a devcontainer.json file.
 * Preserves all other content (comments, formatting where possible).
 * Returns the modified JSON string.
 */
export function rewriteImageField(content: string, newImage: string): string {
  const edits = jsonc.modify(content, ["image"], newImage, {});
  return jsonc.applyEdits(content, edits);
}

/**
 * Check if devcontainer.json has a lace.local image.
 */
export function hasLaceLocalImage(raw: Record<string, unknown>): boolean {
  const image = raw.image;
  return typeof image === "string" && image.startsWith("lace.local/");
}

/**
 * Get the current image from a devcontainer.json.
 */
export function getCurrentImage(raw: Record<string, unknown>): string | null {
  const image = raw.image;
  return typeof image === "string" ? image : null;
}
