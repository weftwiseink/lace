// IMPLEMENTATION_VALIDATION
import { defineCommand } from "citty";
import { runUp, type UpOptions } from "@/lib/up";

export const upCommand = defineCommand({
  meta: {
    name: "up",
    description:
      "Start a devcontainer with prebuild features and plugin mounts",
  },
  args: {
    "workspace-folder": {
      type: "string",
      description: "Path to the workspace folder (defaults to current directory)",
      required: false,
    },
  },
  async run({ args, rawArgs }) {
    // Extract workspace-folder if provided
    const workspaceFolder = args["workspace-folder"] || process.cwd();

    // Pass remaining args to devcontainer
    // Filter out our own args
    const devcontainerArgs: string[] = [];
    let skipNext = false;
    for (const arg of rawArgs) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (arg === "--workspace-folder") {
        skipNext = true;
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
    };

    const result = await runUp(options);

    if (result.message) {
      console.log(result.message);
    }

    process.exitCode = result.exitCode;
  },
});
