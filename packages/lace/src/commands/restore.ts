import { defineCommand } from "citty";
import { join } from "node:path";
import { runRestore } from "@/lib/restore";
import { withFlockSync } from "@/lib/flock";

export const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description:
      "Undo the prebuild FROM rewrite, restoring the original Dockerfile",
  },
  run() {
    const lockPath = join(process.cwd(), ".lace", "prebuild.lock");
    const result = withFlockSync(lockPath, () => runRestore());
    process.exitCode = result.exitCode;
  },
});
