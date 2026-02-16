// IMPLEMENTATION_VALIDATION
import { defineCommand } from "citty";
import { runUp, type UpOptions } from "@/lib/up";

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
  },
  async run({ args, rawArgs }) {
    // Extract workspace-folder if provided
    const workspaceFolder = args["workspace-folder"] || process.cwd();
    const noCache = args["no-cache"] ?? false;
    const skipMetadataValidation = args["skip-metadata-validation"] ?? false;
    const skipValidation = args["skip-validation"] ?? false;

    // Pass remaining args to devcontainer
    // Filter out our own args
    const devcontainerArgs: string[] = [];
    let skipNext = false;
    for (const arg of rawArgs) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (arg === "--workspace-folder" || arg === "--no-cache" || arg === "--skip-metadata-validation" || arg === "--skip-validation") {
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
    };

    const result = await runUp(options);

    if (result.message) {
      console.log(result.message);
    }

    process.exitCode = result.exitCode;
  },
});
