// IMPLEMENTATION_VALIDATION
import { defineCommand } from "citty";
import { join } from "node:path";
import { runResolveMounts, type ResolveMountsOptions } from "@/lib/resolve-mounts";

export const resolveMountsCommand = defineCommand({
  meta: {
    name: "resolve-mounts",
    description:
      "Resolve plugin mounts from devcontainer.json and user settings",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Display planned actions without executing",
      default: false,
    },
    "workspace-folder": {
      type: "string",
      description: "Path to the workspace folder (defaults to current directory)",
      required: false,
    },
  },
  run({ args }) {
    const options: ResolveMountsOptions = {
      dryRun: args["dry-run"],
      workspaceFolder: args["workspace-folder"] || process.cwd(),
    };

    const result = runResolveMounts(options);

    if (result.message) {
      console.log(result.message);
    }

    process.exitCode = result.exitCode;
  },
});
