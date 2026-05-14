// IMPLEMENTATION_VALIDATION
//
// `lace doctor` is the diagnostic / teardown surface. v1 implements only
// `--reset`, which terminates the lace-owned host portless and removes its
// runtime state. Future flags (`--uninstall`) live in the truly-portless
// follow-up RFP for durable host state (sysctl, setcap).
import { defineCommand } from "citty";
import { teardownHostPortless } from "@/lib/host-portless";

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Diagnose and reset lace-owned host state",
  },
  args: {
    reset: {
      type: "boolean",
      description:
        "Terminate the lace-owned host portless and remove ~/.config/lace/portless-runtime.json",
      required: false,
    },
  },
  run({ args }) {
    if (!args.reset) {
      console.log(
        "lace doctor: no action specified.\n" +
          "Available flags:\n" +
          "  --reset    Terminate the lace-owned host portless and remove its runtime state.",
      );
      return;
    }

    const result = teardownHostPortless();
    for (const msg of result.messages) {
      if (msg.startsWith("warn:")) console.warn(msg);
      else console.log(msg);
    }
  },
});
