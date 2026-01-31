import { defineCommand } from "citty";
import { runPrebuild, type PrebuildOptions } from "../lib/prebuild.js";

export const prebuildCommand = defineCommand({
  meta: {
    name: "prebuild",
    description:
      "Pre-bake devcontainer features onto the base image for faster startup",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Display planned actions without executing",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Bypass cache check and force a rebuild",
      default: false,
    },
  },
  run({ args }) {
    const options: PrebuildOptions = {
      dryRun: args["dry-run"],
      force: args.force,
    };
    const result = runPrebuild(options);
    process.exitCode = result.exitCode;
  },
});
