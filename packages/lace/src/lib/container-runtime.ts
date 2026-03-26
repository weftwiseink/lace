// IMPLEMENTATION_VALIDATION
import { loadSettings } from "./settings";

let cachedCommand: string | null = null;
let warnedNonPodman = false;

/**
 * Return the container runtime command string. Cached after first call.
 * Reads overridePodmanCommand from ~/.config/lace/settings.json.
 * Defaults to "podman".
 */
export function getPodmanCommand(): string {
  if (cachedCommand !== null) return cachedCommand;

  const settings = loadSettings();
  const override = settings.overridePodmanCommand;

  if (override) {
    if (!override.includes("podman") && !warnedNonPodman) {
      console.warn(
        `overridePodmanCommand is set to "${override}", which does not contain "podman". ` +
        `Non-podman runtimes may cause issues with sprack and other tooling.`,
      );
      warnedNonPodman = true;
    }
    cachedCommand = override;
  } else {
    cachedCommand = "podman";
  }

  return cachedCommand;
}

/** Reset the cache. For testing only. */
export function resetPodmanCommandCache(): void {
  cachedCommand = null;
  warnedNonPodman = false;
}
