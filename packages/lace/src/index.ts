#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { prebuildCommand } from "@/commands/prebuild";
import { restoreCommand } from "@/commands/restore";
import { resolveMountsCommand } from "@/commands/resolve-mounts";
import { statusCommand } from "@/commands/status";

const main = defineCommand({
  meta: {
    name: "lace",
    version: "0.1.0",
    description: "Devcontainer orchestration CLI",
  },
  subCommands: {
    prebuild: prebuildCommand,
    restore: restoreCommand,
    "resolve-mounts": resolveMountsCommand,
    status: statusCommand,
  },
});

runMain(main);
