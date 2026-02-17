// IMPLEMENTATION_VALIDATION
import { classifyWorkspace } from "./workspace-detector";
import type { WorkspaceClassification } from "./workspace-detector";

// ── Types ──

/** Schema for customizations.lace.workspace in devcontainer.json. */
export interface WorkspaceConfig {
  /** Layout type. Currently only "bare-worktree" or false (disabled). */
  layout: "bare-worktree" | false;
  /** Container mount target path (default: "/workspace"). */
  mountTarget?: string;
  /** Post-creation configuration. */
  postCreate?: {
    /** Inject `git config --global --add safe.directory '*'` (default: true). */
    safeDirectory?: boolean;
    /** Set git.repositoryScanMaxDepth in VS Code settings (default: 2). */
    scanDepth?: number;
  };
}

/** Result of applying workspace layout to a config. */
export interface WorkspaceLayoutResult {
  /** Outcome of the layout application. */
  status: "skipped" | "applied" | "error";
  /** Human-readable summary message. */
  message: string;
  /** Warnings emitted during application. */
  warnings: string[];
  /** Workspace classification, if detection was performed. */
  classification?: WorkspaceClassification;
}

// ── Public API ──

/**
 * Extract and validate the workspace config from customizations.lace.workspace.
 * Returns null if no workspace layout is configured or layout is false.
 */
export function extractWorkspaceConfig(
  config: Record<string, unknown>,
): WorkspaceConfig | null {
  const customizations = config.customizations as
    | Record<string, unknown>
    | undefined;
  if (!customizations) return null;
  const lace = customizations.lace as Record<string, unknown> | undefined;
  if (!lace) return null;
  const workspace = lace.workspace;
  if (!workspace || typeof workspace !== "object") return null;
  const ws = workspace as Record<string, unknown>;
  if (!ws.layout || ws.layout === false) return null;
  if (ws.layout !== "bare-worktree") {
    console.warn(
      `Warning: Unrecognized workspace layout "${String(ws.layout)}". ` +
        `Supported values: "bare-worktree", false. Ignoring.`,
    );
    return null;
  }
  const postCreate = ws.postCreate as Record<string, unknown> | undefined;
  return {
    layout: "bare-worktree",
    mountTarget:
      typeof ws.mountTarget === "string" ? ws.mountTarget : "/workspace",
    postCreate: {
      safeDirectory:
        postCreate && typeof postCreate.safeDirectory === "boolean"
          ? postCreate.safeDirectory
          : true,
      scanDepth:
        postCreate && typeof postCreate.scanDepth === "number"
          ? postCreate.scanDepth
          : 2,
    },
  };
}

/**
 * Detect workspace layout and mutate config with workspaceMount/workspaceFolder.
 * This is Phase 0a of the lace up pipeline.
 */
export function applyWorkspaceLayout(
  config: Record<string, unknown>,
  workspaceFolder: string,
): WorkspaceLayoutResult {
  const wsConfig = extractWorkspaceConfig(config);
  if (!wsConfig) {
    return {
      status: "skipped",
      message: "No workspace layout config",
      warnings: [],
    };
  }

  const mountTarget = wsConfig.mountTarget ?? "/workspace";
  const warnings: string[] = [];
  const result = classifyWorkspace(workspaceFolder);

  for (const w of result.warnings) {
    warnings.push(
      w.message + (w.remediation ? ` Remediation: ${w.remediation}` : ""),
    );
  }

  const { classification } = result;

  // Absolute gitdir paths will not resolve inside the container — fatal error
  const absoluteGitdirWarnings = result.warnings.filter(
    (w) => w.code === "absolute-gitdir",
  );
  if (absoluteGitdirWarnings.length > 0) {
    const names = absoluteGitdirWarnings.map((w) => w.message).join("\n  ");
    return {
      status: "error",
      message:
        `Worktree(s) use absolute gitdir paths that will not resolve inside the container:\n  ${names}\n` +
        "Run `git worktree repair --relative-paths` (requires git 2.48+) or recreate the worktree(s).",
      warnings,
      classification,
    };
  }

  // Validate layout matches
  if (classification.type === "normal-clone") {
    return {
      status: "error",
      message:
        `Workspace layout "bare-worktree" declared but ${workspaceFolder} is a normal git clone. ` +
        "Remove the workspace.layout setting or convert to the bare-worktree convention.",
      warnings,
      classification,
    };
  }
  if (
    classification.type === "not-git" ||
    classification.type === "standard-bare" ||
    classification.type === "malformed"
  ) {
    const reason =
      classification.type === "malformed"
        ? classification.reason
        : classification.type;
    return {
      status: "error",
      message: `Workspace layout "bare-worktree" declared but detection failed: ${reason}`,
      warnings,
      classification,
    };
  }

  let bareRepoRoot: string;
  let worktreeName: string | null;

  if (classification.type === "worktree") {
    bareRepoRoot = classification.bareRepoRoot;
    worktreeName = classification.worktreeName;
  } else {
    // bare-root
    bareRepoRoot = classification.bareRepoRoot;
    worktreeName = null;
  }

  const userHasWorkspaceMount =
    "workspaceMount" in config && config.workspaceMount != null;
  const userHasWorkspaceFolder =
    "workspaceFolder" in config && config.workspaceFolder != null;

  if (!userHasWorkspaceMount) {
    config.workspaceMount = `source=${bareRepoRoot},target=${mountTarget},type=bind,consistency=delegated`;
  }
  if (!userHasWorkspaceFolder) {
    config.workspaceFolder = worktreeName
      ? `${mountTarget}/${worktreeName}`
      : mountTarget;
  }

  // Merge postCreateCommand
  if (wsConfig.postCreate?.safeDirectory !== false) {
    mergePostCreateCommand(
      config,
      "git config --global --add safe.directory '*'",
    );
  }

  // Merge vscode settings
  if (wsConfig.postCreate?.scanDepth != null) {
    mergeVscodeSettings(config, {
      "git.repositoryScanMaxDepth": wsConfig.postCreate.scanDepth,
    });
  }

  return {
    status: "applied",
    message: worktreeName
      ? `Auto-configured for worktree '${worktreeName}' in ${bareRepoRoot}`
      : `Auto-configured for bare-repo root ${bareRepoRoot}`,
    warnings,
    classification,
  };
}

// ── Helpers (exported for testing) ──

/**
 * Merge a command into postCreateCommand with idempotency.
 * Skips injection if the command already appears in the existing value.
 * Follows the same format handling as generateExtendedConfig() in up.ts.
 */
export function mergePostCreateCommand(
  config: Record<string, unknown>,
  command: string,
): void {
  const existing = config.postCreateCommand;

  // Idempotency: check if command already present
  if (typeof existing === "string" && existing.includes(command)) return;
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    const values = Object.values(existing as Record<string, unknown>);
    if (values.some((v) => typeof v === "string" && v.includes(command)))
      return;
  }

  if (!existing) {
    config.postCreateCommand = command;
  } else if (typeof existing === "string") {
    config.postCreateCommand = `${existing} && ${command}`;
  } else if (Array.isArray(existing)) {
    config.postCreateCommand = {
      "lace:user-setup": existing,
      "lace:workspace": command,
    };
  } else if (typeof existing === "object") {
    const obj = existing as Record<string, unknown>;
    if (!("lace:workspace" in obj)) {
      obj["lace:workspace"] = command;
      config.postCreateCommand = obj;
    }
  }
}

/**
 * Deep-merge settings into customizations.vscode.settings.
 * Creates the nested structure if absent. User-set values are never overridden.
 */
export function mergeVscodeSettings(
  config: Record<string, unknown>,
  settings: Record<string, unknown>,
): void {
  if (!config.customizations || typeof config.customizations !== "object") {
    config.customizations = {};
  }
  const customizations = config.customizations as Record<string, unknown>;
  if (!customizations.vscode || typeof customizations.vscode !== "object") {
    customizations.vscode = {};
  }
  const vscode = customizations.vscode as Record<string, unknown>;
  if (!vscode.settings || typeof vscode.settings !== "object") {
    vscode.settings = {};
  }
  const existingSettings = vscode.settings as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in existingSettings)) {
      existingSettings[key] = value;
    }
  }
}
