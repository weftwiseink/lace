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
  /** The resolved Dockerfile path relative to the config directory. */
  dockerfilePath: string;
  /** Regular features from the `features` key. */
  features: Record<string, Record<string, unknown>>;
  /** The config file's directory (for resolving relative paths). */
  configDir: string;
}

/**
 * Read and parse a devcontainer.json (JSONC) file.
 */
export function readDevcontainerConfig(filePath: string): DevcontainerConfig {
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
  const dockerfilePath = resolveDockerfilePath(raw, configDir);
  const features = (raw.features ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  return { raw, dockerfilePath, features, configDir };
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
 * Resolve the Dockerfile path from a devcontainer config.
 * Supports `build.dockerfile`, legacy `dockerfile` field.
 * Errors on `image`-based configs without a Dockerfile.
 */
export function resolveDockerfilePath(
  raw: Record<string, unknown>,
  configDir: string,
): string {
  // Check build.dockerfile first (modern format)
  const build = raw.build as Record<string, unknown> | undefined;
  if (build?.dockerfile) {
    return resolve(configDir, build.dockerfile as string);
  }

  // Check legacy dockerfile field
  if (raw.dockerfile) {
    return resolve(configDir, raw.dockerfile as string);
  }

  // Check for image-based config
  if (raw.image) {
    throw new DevcontainerConfigError(
      "Prebuild requires a Dockerfile-based devcontainer configuration. " +
        "`image`-based configs are not yet supported.",
    );
  }

  throw new DevcontainerConfigError(
    "Cannot determine Dockerfile path from devcontainer.json. " +
      "Expected `build.dockerfile` or `dockerfile` field.",
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
