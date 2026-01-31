import { defineCommand } from "citty";
import { runRestore } from "../lib/restore.js";

export const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description:
      "Undo the prebuild FROM rewrite, restoring the original Dockerfile",
  },
  run() {
    const result = runRestore();
    process.exitCode = result.exitCode;
  },
});
