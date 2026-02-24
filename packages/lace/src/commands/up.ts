// IMPLEMENTATION_VALIDATION
import { defineCommand } from "citty";
import { runUp, type UpOptions } from "@/lib/up";
import { runSubprocess as defaultRunSubprocess } from "@/lib/subprocess";

/**
 * Quick check: is a Docker container running for this workspace folder?
 * Used to annotate failure results for callers (e.g., wez-into) that need
 * to decide whether to retry discovery.
 */
function isContainerRunning(workspaceFolder: string): boolean {
  try {
    const result = defaultRunSubprocess("docker", [
      "ps",
      "--filter", `label=devcontainer.local_folder=${workspaceFolder}`,
      "--format", "{{.ID}}",
    ]);
    return result.exitCode === 0 && result.stdout.trim() !== "";
  } catch {
    return false;
  }
}

export const upCommand = defineCommand({
  meta: {
    name: "up",
    description:
      "Start a devcontainer with prebuild features and repo mounts",
  },
  args: {
    "workspace-folder": {
      type: "string",
      description: "Path to the workspace folder (defaults to current directory)",
      required: false,
    },
    "no-cache": {
      type: "boolean",
      description: "Bypass filesystem cache for floating feature tags",
      required: false,
    },
    "skip-metadata-validation": {
      type: "boolean",
      description: "Skip feature metadata validation (offline/emergency use)",
      required: false,
    },
    "skip-validation": {
      type: "boolean",
      description: "Skip host-side validation (downgrade errors to warnings)",
      required: false,
    },
    "skip-devcontainer-up": {
      type: "boolean",
      description: "Generate config only; skip the actual devcontainer up invocation",
      required: false,
    },
  },
  async run({ args, rawArgs }) {
    // Extract workspace-folder if provided
    const workspaceFolder = args["workspace-folder"] || process.cwd();
    const noCache = args["no-cache"] ?? false;
    const skipMetadataValidation = args["skip-metadata-validation"] ?? false;
    const skipValidation = args["skip-validation"] ?? false;
    const skipDevcontainerUp = args["skip-devcontainer-up"] ?? false;

    // Pass remaining args to devcontainer
    // Filter out our own args
    const devcontainerArgs: string[] = [];
    let skipNext = false;
    for (const arg of rawArgs) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (arg === "--workspace-folder" || arg === "--no-cache" || arg === "--skip-metadata-validation" || arg === "--skip-validation" || arg === "--skip-devcontainer-up") {
        if (arg === "--workspace-folder") {
          skipNext = true;
        }
        continue;
      }
      if (arg.startsWith("--workspace-folder=")) {
        continue;
      }
      devcontainerArgs.push(arg);
    }

    const options: UpOptions = {
      workspaceFolder,
      devcontainerArgs,
      noCache,
      skipMetadataValidation,
      skipValidation,
      skipDevcontainerUp,
    };

    const result = await runUp(options);

    if (result.message) {
      console.log(result.message);
    }

    // Emit machine-readable result line for callers (e.g., wez-into).
    // Goes to stderr so it doesn't interfere with stdout-based parsing.
    const failedPhase = result.exitCode !== 0
      ? Object.entries(result.phases).find(([, v]) => v && v.exitCode !== 0)?.[0] ?? "unknown"
      : null;
    const containerMayBeRunning = result.exitCode !== 0
      && isContainerRunning(workspaceFolder);
    const laceResult = {
      exitCode: result.exitCode,
      failedPhase,
      containerMayBeRunning,
    };
    console.error(`LACE_RESULT: ${JSON.stringify(laceResult)}`);

    process.exitCode = result.exitCode;
  },
});
