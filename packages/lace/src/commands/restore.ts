import { defineCommand } from "citty";

export const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description:
      "Undo the prebuild FROM rewrite, restoring the original Dockerfile",
  },
  run() {
    console.log("restore: not yet implemented");
  },
});
