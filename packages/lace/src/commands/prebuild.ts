import { defineCommand } from "citty";
import { join } from "node:path";
import { runPrebuild, type PrebuildOptions } from "@/lib/prebuild";
import { withFlockSync } from "@/lib/flock";

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
    const lockPath = join(process.cwd(), ".lace", "prebuild.lock");
    const result = withFlockSync(lockPath, () => runPrebuild(options));
    process.exitCode = result.exitCode;
  },
});
