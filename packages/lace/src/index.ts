#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { prebuildCommand } from "@/commands/prebuild";
import { resolveMountsCommand } from "@/commands/resolve-mounts";
import { restoreCommand } from "@/commands/restore";
import { statusCommand } from "@/commands/status";
import { upCommand } from "@/commands/up";

const main = defineCommand({
  meta: {
    name: "lace",
    version: "0.1.0",
    description: "Devcontainer orchestration CLI",
  },
  subCommands: {
    prebuild: prebuildCommand,
    "resolve-mounts": resolveMountsCommand,
    restore: restoreCommand,
    status: statusCommand,
    up: upCommand,
  },
});

runMain(main);
