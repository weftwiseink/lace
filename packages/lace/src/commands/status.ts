import { defineCommand } from "citty";
import { runStatus } from "@/lib/status";

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description:
      "Show current prebuild state (original image, prebuild image, staleness)",
  },
  run() {
    const result = runStatus();
    process.exitCode = result.exitCode;
  },
});
