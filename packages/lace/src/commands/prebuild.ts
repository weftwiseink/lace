import { defineCommand } from "citty";

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
    console.log("prebuild: not yet implemented");
    console.log("args:", args);
  },
});
