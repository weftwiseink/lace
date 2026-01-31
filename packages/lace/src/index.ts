#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { prebuildCommand } from "./commands/prebuild.js";
import { restoreCommand } from "./commands/restore.js";
import { statusCommand } from "./commands/status.js";

const main = defineCommand({
  meta: {
    name: "lace",
    version: "0.1.0",
    description: "Devcontainer orchestration CLI",
  },
  subCommands: {
    prebuild: prebuildCommand,
    restore: restoreCommand,
    status: statusCommand,
  },
});

runMain(main);
