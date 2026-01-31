// IMPLEMENTATION_VALIDATION
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readMetadata, contextsChanged } from "./metadata.js";
import { readDevcontainerConfig, extractPrebuildFeatures } from "./devcontainer.js";
import { parseDockerfile, generatePrebuildDockerfile, restoreFrom } from "./dockerfile.js";
import { generateTempDevcontainerJson } from "./devcontainer.js";

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
 */
export function runStatus(options: StatusOptions = {}): StatusResult {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const configPath =
    options.configPath ??
    join(workspaceRoot, ".devcontainer", "devcontainer.json");
  const prebuildDir = join(workspaceRoot, ".lace", "prebuild");

  // Check for active prebuild
  const metadata = readMetadata(prebuildDir);
  if (!metadata) {
    const msg = "No active prebuild.";
    console.log(msg);
    return { exitCode: 0, message: msg };
  }

  const lines: string[] = [
    `Prebuild active:`,
    `  Original FROM: ${metadata.originalFrom}`,
    `  Prebuild tag:  ${metadata.prebuildTag}`,
    `  Built at:      ${metadata.timestamp}`,
  ];

  // Check staleness
  try {
    const config = readDevcontainerConfig(configPath);
    const prebuildResult = extractPrebuildFeatures(config.raw);

    if (prebuildResult.kind === "features") {
      let dockerfileContent = readFileSync(config.dockerfilePath, "utf-8");
      // Restore original FROM before parsing (use AST-based restoreFrom, not regex)
      if (dockerfileContent.includes("lace.local/")) {
        dockerfileContent = restoreFrom(dockerfileContent, metadata.originalFrom);
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
