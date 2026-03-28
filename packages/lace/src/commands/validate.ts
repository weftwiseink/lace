// IMPLEMENTATION_VALIDATION
import { defineCommand } from "citty";
import { runUp, type UpOptions } from "@/lib/up";
import { formatDebugFooter } from "@/lib/debug-footer";

export const validateCommand = defineCommand({
  meta: {
    name: "validate",
    description:
      "Validate devcontainer config without starting a container",
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
  },
  async run({ args }) {
    const workspaceFolder = args["workspace-folder"] || process.cwd();
    const noCache = args["no-cache"] ?? false;
    const skipMetadataValidation = args["skip-metadata-validation"] ?? false;

    const options: UpOptions = {
      workspaceFolder,
      noCache,
      skipMetadataValidation,
      skipDevcontainerUp: true,
      validateOnly: true,
    };

    const result = await runUp(options);

    if (result.message) {
      console.log(result.message);
    }

    // Emit debug footer on failure
    if (result.exitCode !== 0) {
      const failedPhase = Object.entries(result.phases)
        .find(([, v]) => v && v.exitCode !== 0)?.[0] ?? "unknown";
      console.error("");
      console.error(formatDebugFooter({
        logPath: result.logPath,
        failedPhase,
        workspaceFolder,
      }));
    }

    process.exitCode = result.exitCode;
  },
});
