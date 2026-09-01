#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { doctorCommand } from "@/commands/doctor";
import { resolveMountsCommand } from "@/commands/resolve-mounts";
import { upCommand } from "@/commands/up";
import { validateCommand } from "@/commands/validate";

const main = defineCommand({
  meta: {
    name: "lace",
    version: "0.1.0",
    description: "Devcontainer orchestration CLI",
  },
  subCommands: {
    doctor: doctorCommand,
    "resolve-mounts": resolveMountsCommand,
    up: upCommand,
    validate: validateCommand,
  },
});

runMain(main);
