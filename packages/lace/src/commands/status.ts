import { defineCommand } from "citty";

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description:
      "Show current prebuild state (original image, prebuild image, staleness)",
  },
  run() {
    console.log("status: not yet implemented");
  },
});
