/**
 * Test utilities for wezterm-server scenario tests.
 *
 * Provides helpers for creating test workspaces, symlinking local features,
 * reading generated configs, checking Docker availability, and port connectivity.
 */

import {
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  cpSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import * as net from "node:net";

// ── Path resolution ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Repo root: from packages/lace/src/__tests__/helpers/ go up 5 levels.
 */
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");

/**
 * Absolute path to devcontainer features source directory.
 */
export const FEATURES_SRC_DIR = join(
  REPO_ROOT,
  "devcontainers",
  "features",
  "src",
);

// ── Workspace management ──

export interface ScenarioWorkspace {
  /** Root directory of the temporary workspace. */
  workspaceRoot: string;
  /** Path to .devcontainer/ directory. */
  devcontainerDir: string;
  /** Path to .lace/ directory (created by lace up). */
  laceDir: string;
  /** Path to a temporary metadata cache directory (isolated per test). */
  metadataCacheDir: string;
  /** Clean up the workspace (remove temp directory). */
  cleanup: () => void;
}

/**
 * Create a temporary workspace directory for a scenario test.
 * Includes .devcontainer/ subdirectory and an isolated metadata cache.
 */
export function createScenarioWorkspace(name: string): ScenarioWorkspace {
  const workspaceRoot = join(
    tmpdir(),
    `lace-scenario-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const devcontainerDir = join(workspaceRoot, ".devcontainer");
  const laceDir = join(workspaceRoot, ".lace");
  const metadataCacheDir = join(workspaceRoot, ".metadata-cache");

  mkdirSync(devcontainerDir, { recursive: true });

  return {
    workspaceRoot,
    devcontainerDir,
    laceDir,
    metadataCacheDir,
    cleanup: () => {
      rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Write a settings.json file into the workspace and set LACE_SETTINGS env var.
 * Useful for providing mount overrides in scenario tests.
 */
export function setupScenarioSettings(
  ctx: ScenarioWorkspace,
  settings: Record<string, unknown>,
): void {
  const settingsDir = join(ctx.workspaceRoot, ".config", "lace");
  mkdirSync(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  process.env.LACE_SETTINGS = settingsPath;
}

/**
 * Create a temporary SSH key file in the workspace for validated mount tests.
 * Returns the absolute path to the created file.
 */
export function createTempSshKey(ctx: ScenarioWorkspace): string {
  const keyPath = join(ctx.workspaceRoot, "test-ssh-key.pub");
  writeFileSync(keyPath, "ssh-ed25519 AAAA test-scenario@test\n", "utf-8");
  return keyPath;
}

/**
 * Write a devcontainer.json file into the workspace's .devcontainer/ directory.
 */
export function writeDevcontainerJson(
  ctx: ScenarioWorkspace,
  config: Record<string, unknown>,
): void {
  writeFileSync(
    join(ctx.devcontainerDir, "devcontainer.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

/**
 * Create a symlink from the test workspace to the real feature source directory.
 *
 * Since lace's fetchFromLocalPath() resolves feature paths relative to CWD
 * (not the workspace), we create the feature directory inside the workspace
 * and use absolute paths in the devcontainer.json feature reference.
 *
 * The caller should use the return value as the feature key in devcontainer.json.
 *
 * @param ctx The scenario workspace context
 * @param featureName The feature name (e.g., "wezterm-server")
 * @returns The absolute path to use as the feature reference in devcontainer.json
 */
export function symlinkLocalFeature(
  ctx: ScenarioWorkspace,
  featureName: string,
): string {
  const featureSourceDir = join(FEATURES_SRC_DIR, featureName);
  if (!existsSync(featureSourceDir)) {
    throw new Error(
      `Feature source not found at ${featureSourceDir}. ` +
        `Repo root resolved to: ${REPO_ROOT}`,
    );
  }

  const featuresDir = join(ctx.devcontainerDir, "features");
  mkdirSync(featuresDir, { recursive: true });

  const symlinkTarget = join(featuresDir, featureName);
  symlinkSync(featureSourceDir, symlinkTarget);

  // Return the absolute path for use in devcontainer.json features key.
  // fetchFromLocalPath() joins this with "devcontainer-feature.json" and
  // resolves via existsSync, which works with absolute paths.
  return symlinkTarget;
}

/**
 * Copy local feature files into the test workspace for Docker integration tests.
 *
 * Unlike symlinkLocalFeature(), this creates actual file copies that the
 * devcontainer CLI's Docker build context can access. Symlinks are not
 * followed by the CLI when copying features into the build context.
 *
 * The feature files are copied to .devcontainer/features/<featureName>/
 * and the absolute path is returned for use in devcontainer.json feature keys
 * (for lace metadata resolution). For Docker tests, call
 * prepareGeneratedConfigForDocker() after lace up to rewrite the absolute
 * paths to relative paths that the devcontainer CLI understands.
 *
 * @param ctx The scenario workspace context
 * @param featureName The feature name (e.g., "wezterm-server")
 * @returns The absolute path to use as the feature reference in devcontainer.json
 */
export function copyLocalFeature(
  ctx: ScenarioWorkspace,
  featureName: string,
): string {
  const featureSourceDir = join(FEATURES_SRC_DIR, featureName);
  if (!existsSync(featureSourceDir)) {
    throw new Error(
      `Feature source not found at ${featureSourceDir}. ` +
        `Repo root resolved to: ${REPO_ROOT}`,
    );
  }

  const featuresDir = join(ctx.devcontainerDir, "features");
  mkdirSync(featuresDir, { recursive: true });

  const copyTarget = join(featuresDir, featureName);
  cpSync(featureSourceDir, copyTarget, { recursive: true });

  // Return the absolute path for use in devcontainer.json features key.
  return copyTarget;
}

/**
 * Read and parse the generated .lace/devcontainer.json.
 */
export function readGeneratedConfig(
  ctx: ScenarioWorkspace,
): Record<string, unknown> {
  const configPath = join(ctx.laceDir, "devcontainer.json");
  return JSON.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

/**
 * Read and parse the .lace/port-assignments.json.
 */
export function readPortAssignments(
  ctx: ScenarioWorkspace,
): Record<string, { port: number; label: string; assignedAt: string }> {
  const assignmentsPath = join(ctx.laceDir, "port-assignments.json");
  const data = JSON.parse(readFileSync(assignmentsPath, "utf-8")) as {
    assignments: Record<
      string,
      { port: number; label: string; assignedAt: string }
    >;
  };
  return data.assignments;
}

// ── Docker utilities ──

/**
 * Check if Docker daemon is available and running.
 * Used to gate Docker-dependent tests with describe.skipIf(!isDockerAvailable()).
 */
export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a TCP port to become reachable on localhost.
 * Uses Node's net.Socket for consistency with the codebase's port-allocator.ts.
 *
 * @param port Port number to wait for
 * @param maxRetries Maximum number of retry attempts
 * @param intervalMs Milliseconds between retries
 * @returns true if port became reachable, false if timed out
 */
export async function waitForPort(
  port: number,
  maxRetries = 15,
  intervalMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const reachable = await isPortReachable(port);
    if (reachable) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Check if a TCP port is accepting connections on localhost.
 * Returns true if connection succeeds, false otherwise.
 */
function isPortReachable(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "localhost");
  });
}

/**
 * Read the SSH banner from a port.
 * SSH servers send a version string like "SSH-2.0-OpenSSH_9.7" on connect.
 *
 * @param port Port to connect to
 * @param timeoutMs Connection and read timeout
 * @returns The SSH banner string, or empty string if not available
 */
export function getSshBanner(port: number, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    let data = "";

    socket.once("data", (chunk) => {
      data += chunk.toString();
      socket.destroy();
      resolve(data.trim());
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(data.trim());
    });

    socket.once("error", () => {
      socket.destroy();
      resolve("");
    });

    socket.connect(port, "localhost");
  });
}

/**
 * Stop and remove a Docker container by ID.
 */
export function stopContainer(containerId: string): void {
  try {
    execSync(`docker rm -f "${containerId}"`, { stdio: "pipe" });
  } catch {
    // Ignore errors -- container may already be stopped
  }
}

/**
 * Clean up any Docker containers associated with a workspace folder.
 * Uses the devcontainer.local_folder label set by the devcontainer CLI.
 */
export function cleanupWorkspaceContainers(workspaceFolder: string): void {
  try {
    const result = execSync(
      `docker ps -aq --filter "label=devcontainer.local_folder=${workspaceFolder}"`,
      { stdio: "pipe" },
    )
      .toString()
      .trim();
    if (result) {
      for (const id of result.split("\n").filter(Boolean)) {
        stopContainer(id);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Prepare the generated config for `devcontainer up` by copying it to
 * .devcontainer/devcontainer.json and rewriting absolute feature paths
 * to relative `./features/<name>` paths.
 *
 * The devcontainer CLI (v0.83.0) does not support:
 * - Absolute paths for local features
 * - Local feature paths when using --config with a non-.devcontainer/ location
 *
 * So we copy the generated config back to .devcontainer/devcontainer.json
 * (the default location the CLI searches) and rewrite the feature keys to
 * relative paths. The symlinks at .devcontainer/features/<name> (created by
 * symlinkLocalFeature) are already in the right place.
 *
 * After calling this, run `devcontainer up --workspace-folder <workspace>`
 * without --config.
 *
 * @param ctx The scenario workspace context
 * @param absolutePathMap Map from absolute feature path to feature name
 */
export function prepareGeneratedConfigForDocker(
  ctx: ScenarioWorkspace,
  absolutePathMap: Map<string, string>,
): void {
  const generatedConfigPath = join(ctx.laceDir, "devcontainer.json");
  let configStr = readFileSync(generatedConfigPath, "utf-8");

  for (const [absPath, featureName] of absolutePathMap) {
    const relPath = `./features/${featureName}`;

    // Replace the JSON-escaped absolute path with the relative path
    configStr = configStr.split(JSON.stringify(absPath)).join(JSON.stringify(relPath));
    // Also handle any unquoted occurrences
    configStr = configStr.split(absPath).join(relPath);
  }

  // Write the rewritten config to .devcontainer/devcontainer.json
  // so the devcontainer CLI can find it at the default location.
  writeFileSync(
    join(ctx.devcontainerDir, "devcontainer.json"),
    configStr,
    "utf-8",
  );
}

// ── Bare-repo workspace helpers ──

export interface BareRepoWorkspace {
  root: string;
  worktrees: Record<string, string>;
  bareDir: string;
}

/**
 * Create a fake bare-repo workspace following the nikitabobko convention.
 *
 * Layout:
 *   <parentDir>/<projectName>/
 *     .git          (file, gitdir: ./.bare)
 *     .bare/        (dir with HEAD, objects/, refs/)
 *       worktrees/
 *         <name>/   (commondir + gitdir back-pointers)
 *     <name>/       (worktree directories with .git file pointers)
 */
export function createBareRepoWorkspace(
  parentDir: string,
  projectName: string,
  worktreeNames: string[] = ["main"],
  options: { useAbsolutePaths?: boolean } = {},
): BareRepoWorkspace {
  const root = join(parentDir, projectName);
  const bareDir = join(root, ".bare");

  mkdirSync(join(bareDir, "objects"), { recursive: true });
  mkdirSync(join(bareDir, "refs"), { recursive: true });
  writeFileSync(join(bareDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");
  writeFileSync(join(root, ".git"), "gitdir: ./.bare\n", "utf-8");

  const worktrees: Record<string, string> = {};
  for (const name of worktreeNames) {
    const worktreeDir = join(root, name);
    const worktreeGitStateDir = join(bareDir, "worktrees", name);

    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(worktreeGitStateDir, { recursive: true });

    const gitdirTarget = options.useAbsolutePaths
      ? join(bareDir, "worktrees", name)
      : `../.bare/worktrees/${name}`;
    writeFileSync(
      join(worktreeDir, ".git"),
      `gitdir: ${gitdirTarget}\n`,
      "utf-8",
    );
    writeFileSync(
      join(worktreeGitStateDir, "commondir"),
      "../..\n",
      "utf-8",
    );
    writeFileSync(
      join(worktreeGitStateDir, "gitdir"),
      join(root, name, ".git") + "\n",
      "utf-8",
    );

    worktrees[name] = worktreeDir;
  }

  return { root, worktrees, bareDir };
}

/**
 * Create a fake normal git clone workspace.
 * Creates a .git directory (not file) with HEAD, objects/, refs/.
 */
export function createNormalCloneWorkspace(
  parentDir: string,
  projectName: string,
): string {
  const root = join(parentDir, projectName);
  const gitDir = join(root, ".git");
  mkdirSync(join(gitDir, "objects"), { recursive: true });
  mkdirSync(join(gitDir, "refs"), { recursive: true });
  writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf-8");
  return root;
}
