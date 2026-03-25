// IMPLEMENTATION_VALIDATION
import type { LaceMountDeclaration } from "./feature-metadata";
import type { UserConfig, UserMountDeclaration } from "./user-config";
import { expandPath, resolveSettingsPath } from "./settings";

// ── Git identity env var names ──
// These are the LACE-specific env vars read by the lace-fundamentals-init script.
// They are NOT recognized by git: the init script writes them to ~/.gitconfig.
// Do NOT use GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL: those override everything
// including project-level GIT_CONFIG_* overrides, breaking the two-layer system.
const LACE_GIT_NAME = "LACE_GIT_NAME";
const LACE_GIT_EMAIL = "LACE_GIT_EMAIL";

// Git env vars that should not be in user containerEnv (they bypass the two-layer identity system)
const GIT_IDENTITY_ENV_VARS = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
];

/**
 * Convert user mount declarations to lace mount declarations with
 * `user/` namespace prefix and forced `readonly: true`.
 *
 * Returns declarations ready for merging into the pipeline's mountDeclarations map.
 */
export function mergeUserMounts(
  userMounts: Record<string, UserMountDeclaration>,
): Record<string, LaceMountDeclaration> {
  const result: Record<string, LaceMountDeclaration> = {};

  for (const [name, mount] of Object.entries(userMounts)) {
    const label = `user/${name}`;
    result[label] = {
      target: mount.target,
      recommendedSource: resolveSettingsPath(mount.source),
      description: mount.description,
      readonly: true,
    };
  }

  return result;
}

/**
 * Merge user features into a feature set. Project options take precedence
 * on conflict (same feature ID with different options).
 *
 * @param userFeatures Features from user.json
 * @param projectFeatures Features from devcontainer.json (features or prebuildFeatures)
 * @returns Merged feature set
 */
export function mergeUserFeatures(
  userFeatures: Record<string, Record<string, unknown>>,
  projectFeatures: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {};

  // Add user features first (lower priority)
  for (const [id, options] of Object.entries(userFeatures)) {
    merged[id] = { ...options };
  }

  // Project features override user features
  for (const [id, options] of Object.entries(projectFeatures)) {
    if (merged[id]) {
      // Same feature: project options override user options
      merged[id] = { ...merged[id], ...options };
    } else {
      merged[id] = { ...options };
    }
  }

  return merged;
}

/**
 * Merge user containerEnv with project containerEnv.
 * User provides defaults, project overrides per-key.
 */
export function mergeUserContainerEnv(
  userEnv: Record<string, string>,
  projectEnv: Record<string, string>,
): { merged: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];

  // Warn if user sets git identity env vars in containerEnv
  for (const varName of GIT_IDENTITY_ENV_VARS) {
    if (userEnv[varName]) {
      warnings.push(
        `user.json containerEnv sets "${varName}". This bypasses the two-layer git identity system. ` +
          `Use the "git" section in user.json instead.`,
      );
    }
  }

  // User env is the base, project overrides per-key
  const merged = { ...userEnv, ...projectEnv };

  return { merged, warnings };
}

/**
 * Merge git identity from user.json into containerEnv.
 * Uses LACE_GIT_NAME / LACE_GIT_EMAIL (NOT GIT_AUTHOR_NAME).
 * These are read by lace-fundamentals-init to write ~/.gitconfig.
 *
 * @param git The git identity from user.json
 * @param existingEnv The existing containerEnv (may already have values)
 * @returns Updated containerEnv with git identity vars added
 */
export function mergeUserGitIdentity(
  git: { name: string; email: string },
  existingEnv: Record<string, string>,
): Record<string, string> {
  const result = { ...existingEnv };

  // Only set if not already present (project overrides user)
  if (!result[LACE_GIT_NAME]) {
    result[LACE_GIT_NAME] = git.name;
  }
  if (!result[LACE_GIT_EMAIL]) {
    result[LACE_GIT_EMAIL] = git.email;
  }

  return result;
}

/**
 * Apply all user config merges to the pipeline state.
 * This is the main entry point called from up.ts Phase 0c.
 *
 * Returns the merged state and any warnings to emit.
 */
export function applyUserConfig(
  userConfig: UserConfig,
  projectFeatures: Record<string, Record<string, unknown>>,
  projectPrebuildFeatures: Record<string, Record<string, unknown>>,
  projectContainerEnv: Record<string, string>,
): {
  mergedFeatures: Record<string, Record<string, unknown>>;
  mergedPrebuildFeatures: Record<string, Record<string, unknown>>;
  mergedContainerEnv: Record<string, string>;
  userMountDeclarations: Record<string, LaceMountDeclaration>;
  defaultShell: string | undefined;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Merge mounts (user mounts validated before this point)
  const userMountDeclarations = userConfig.mounts
    ? mergeUserMounts(userConfig.mounts)
    : {};

  // Merge features: user features go into prebuildFeatures if project has them,
  // otherwise into features
  let mergedFeatures = { ...projectFeatures };
  let mergedPrebuildFeatures = { ...projectPrebuildFeatures };

  if (userConfig.features) {
    if (Object.keys(projectPrebuildFeatures).length > 0) {
      mergedPrebuildFeatures = mergeUserFeatures(
        userConfig.features,
        projectPrebuildFeatures,
      );
    } else {
      mergedFeatures = mergeUserFeatures(
        userConfig.features,
        projectFeatures,
      );
    }
  }

  // Merge containerEnv
  let mergedContainerEnv = { ...projectContainerEnv };
  if (userConfig.containerEnv) {
    const envResult = mergeUserContainerEnv(
      userConfig.containerEnv,
      projectContainerEnv,
    );
    mergedContainerEnv = envResult.merged;
    warnings.push(...envResult.warnings);
  }

  // Merge git identity into containerEnv
  if (userConfig.git) {
    mergedContainerEnv = mergeUserGitIdentity(
      userConfig.git,
      mergedContainerEnv,
    );
  }

  return {
    mergedFeatures,
    mergedPrebuildFeatures,
    mergedContainerEnv,
    userMountDeclarations,
    defaultShell: userConfig.defaultShell,
    warnings,
  };
}
