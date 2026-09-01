// DOCKER_SMOKE_TEST — requires Docker daemon
import { describe, it } from "vitest";

// ---------------------------------------------------------------------------
// Acceptance gate: these tests pull images from a registry and require a
// running container runtime. Skipped by default; opt in with:
//   LACE_RUN_ACCEPTANCE_TESTS=1 pnpm test
// ---------------------------------------------------------------------------

const runAcceptance = process.env.LACE_RUN_ACCEPTANCE_TESTS === "1";

describe.skipIf(!runAcceptance)("docker smoke tests", { timeout: 240_000 }, () => {
  // TODO(opus/prebuild-removal): warm-vs-cold cache-timing scenario.
  // Proposal Phase 5 substep 3 calls for a back-to-back `lace up` on a
  // multi-feature project asserting the warm wall time is < 30% of the cold.
  // This needs a real container build (two `lace up` runs on the legacy
  // builder), which the reboot constraint of this workstream defers to the
  // eventual Phase 7 live dogfood. The behaviour is already empirically
  // validated (weftwise: 234s cold / 16s warm in the validating experiment,
  // cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md).
  it.todo(
    "back-to-back lace up: warm build wall time is < 30% of cold build",
  );
});
