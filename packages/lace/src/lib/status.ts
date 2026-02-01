// IMPLEMENTATION_VALIDATION
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readMetadata, contextsChanged } from "@/lib/metadata";
import { readDevcontainerConfig, extractPrebuildFeatures } from "@/lib/devcontainer";
import {
  parseDockerfile,
  parseTag,
  generatePrebuildDockerfile,
  restoreFrom,
} from "@/lib/dockerfile";
import { generateTempDevcontainerJson } from "@/lib/devcontainer";

export interface StatusOptions {
  workspaceRoot?: string;
  configPath?: string;
}

export interface StatusResult {
  exitCode: number;
  message: string;
}

/**
 * Show current prebuild state.
 *
 * Distinguishes three states:
 * - No prebuild: no metadata exists
 * - Prebuild active: metadata exists AND Dockerfile has lace.local reference
 * - Prebuild cached: metadata exists but Dockerfile has been restored
 */
export function runStatus(options: StatusOptions = {}): StatusResult {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const configPath =
    options.configPath ??
    join(workspaceRoot, ".devcontainer", "devcontainer.json");
  const prebuildDir = join(workspaceRoot, ".lace", "prebuild");

  // Check for prebuild metadata
  const metadata = readMetadata(prebuildDir);
  if (!metadata) {
    const msg = "No active prebuild.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  // Determine if Dockerfile currently has the lace.local reference
  let dockerfileHasLace = false;
  try {
    const config = readDevcontainerConfig(configPath);
    const dockerfileContent = readFileSync(config.dockerfilePath, "utf-8");
    dockerfileHasLace = dockerfileContent.includes("lace.local/");
  } catch {
    // Can't read Dockerfile — will report as inactive
  }

  const header = dockerfileHasLace ? "Prebuild active:" : "Prebuild cached:";
  const lines: string[] = [
    header,
    `  Original FROM: ${metadata.originalFrom}`,
    `  Prebuild tag:  ${metadata.prebuildTag}`,
    `  Built at:      ${metadata.timestamp}`,
  ];

  if (!dockerfileHasLace) {
    lines.push(`  Dockerfile:    restored (run \`lace prebuild\` to reactivate)`);
  }

  // Check staleness
  try {
    const config = readDevcontainerConfig(configPath);
    const prebuildResult = extractPrebuildFeatures(config.raw);

    if (prebuildResult.kind === "features") {
      let dockerfileContent = readFileSync(config.dockerfilePath, "utf-8");
      // Restore original FROM before parsing for context comparison
      if (dockerfileContent.includes("lace.local/")) {
        // Use parseTag (bidirectional) with metadata fallback
        let originalFrom: string | null = null;
        try {
          const parsed = parseDockerfile(dockerfileContent);
          originalFrom = parseTag(parsed.image);
        } catch {
          // fall through
        }
        if (!originalFrom) {
          originalFrom = metadata.originalFrom;
        }
        dockerfileContent = restoreFrom(dockerfileContent, originalFrom);
      }
      const parsed = parseDockerfile(dockerfileContent);
      const tempDockerfile = generatePrebuildDockerfile(parsed);
      const tempDevcontainerJson = generateTempDevcontainerJson(
        prebuildResult.features,
        "Dockerfile",
      );

      if (contextsChanged(prebuildDir, tempDockerfile, tempDevcontainerJson)) {
        lines.push(`  Status:        config changed since last prebuild`);
      } else {
        lines.push(`  Status:        up to date`);
      }
    }
  } catch {
    lines.push(`  Status:        unable to determine (config read error)`);
  }

  const msg = lines.join("\n");
  console.log(msg);
  return { exitCode: 0, message: msg };
}
