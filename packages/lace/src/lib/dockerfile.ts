// IMPLEMENTATION_VALIDATION
import { DockerfileParser, type Instruction } from "dockerfile-ast";
import type { From } from "dockerfile-ast/lib/instructions/from.js";

/** Structured representation of the first FROM instruction and its prelude. */
export interface ParsedDockerfile {
  /** ARG instructions before the first FROM (may include variable substitutions used in FROM). */
  argPrelude: string[];
  /** The full image reference from the first FROM (e.g., "node:24-bookworm"). */
  image: string;
  /** The image name without tag/digest (e.g., "node", "ghcr.io/owner/image"). */
  imageName: string;
  /** The image tag if present (e.g., "24-bookworm"), null for untagged or digest-only. */
  tag: string | null;
  /** The digest if present (e.g., "sha256:abc123"), null for tag-based references. */
  digest: string | null;
  /** The AS alias if present (e.g., "builder"). */
  alias: string | null;
  /** The --platform flag value if present (e.g., "linux/amd64"). */
  platform: string | null;
  /** Zero-based line number of the first FROM instruction. */
  fromLine: number;
  /** The original text of the first FROM line (for exact replacement). */
  fromLineText: string;
}

export class DockerfileParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(line !== undefined ? `${message} (line ${line + 1})` : message);
    this.name = "DockerfileParseError";
  }
}

/**
 * Parse a Dockerfile string and extract the first FROM instruction with its ARG prelude.
 * This is a pure function operating on strings — no file I/O.
 */
export function parseDockerfile(content: string): ParsedDockerfile {
  const dockerfile = DockerfileParser.parse(content);
  const instructions = dockerfile.getInstructions();
  const froms = dockerfile.getFROMs();

  if (froms.length === 0) {
    throw new DockerfileParseError("No FROM instruction found in Dockerfile");
  }

  const firstFrom = froms[0] as From;
  const firstFromLine = firstFrom.getRange().start.line;

  // Check for non-ARG, non-comment instructions before the first FROM
  const argPrelude: string[] = [];
  for (const inst of instructions) {
    const instLine = inst.getRange().start.line;
    if (instLine >= firstFromLine) break;

    const keyword = inst.getKeyword();
    if (keyword === "ARG") {
      argPrelude.push(getInstructionText(content, inst));
    } else if (keyword !== "FROM") {
      // Instructions other than ARG before FROM are invalid
      throw new DockerfileParseError(
        `Unsupported instruction "${keyword}" before FROM`,
        instLine,
      );
    }
  }

  const rawImageName = firstFrom.getImageName();
  if (!rawImageName) {
    throw new DockerfileParseError("Malformed FROM instruction: no image specified", firstFromLine);
  }

  // dockerfile-ast separates registry from image name; recombine them
  const registry = firstFrom.getRegistry() ?? null;
  const imageName = registry ? `${registry}/${rawImageName}` : rawImageName;

  const tag = firstFrom.getImageTag() ?? null;
  const digest = firstFrom.getImageDigest() ?? null;
  const alias = firstFrom.getBuildStage() ?? null;
  const platform = firstFrom.getPlatformFlag()?.getValue() ?? null;

  // Build the full image reference as it appears in the FROM line
  let image = imageName;
  if (tag) {
    image += `:${tag}`;
  } else if (digest) {
    image += `@${digest}`;
  }

  const fromLineText = getInstructionText(content, firstFrom);

  return {
    argPrelude,
    image,
    imageName,
    tag,
    digest,
    alias,
    platform,
    fromLine: firstFromLine,
    fromLineText,
  };
}

/**
 * Generate a lace.local tag for a pre-baked image.
 *
 * Tag-based: lace.local/<image>:<tag>
 * Digest-based: lace.local/<image>:from_sha256__<hash>
 * No tag: lace.local/<image>:latest
 */
export function generateTag(
  imageName: string,
  tag: string | null,
  digest: string | null,
): string {
  if (digest) {
    // digest is "sha256:abc123..." — convert to tag-safe format
    const safeDigest = `from_${digest.replace(":", "__")}`;
    const fullTag = `lace.local/${imageName}:${safeDigest}`;
    // Docker tags max 128 chars — truncate digest portion if needed
    if (fullTag.length > 128) {
      const prefix = `lace.local/${imageName}:from_sha256__`;
      const maxHashLen = 128 - prefix.length;
      const hash = digest.split(":")[1];
      return `${prefix}${hash.substring(0, maxHashLen)}`;
    }
    return fullTag;
  }

  if (tag) {
    return `lace.local/${imageName}:${tag}`;
  }

  return `lace.local/${imageName}:latest`;
}

/**
 * Parse a lace.local tag back to the original image reference.
 * Inverse of generateTag. Returns null if the tag doesn't have the lace.local/ prefix.
 *
 * Reversals:
 *   lace.local/node:24-bookworm        → node:24-bookworm
 *   lace.local/ghcr.io/owner/image:v2  → ghcr.io/owner/image:v2
 *   lace.local/node:from_sha256__abc   → node@sha256:abc
 *   lace.local/node:latest             → node:latest  (original may have been untagged)
 */
export function parseTag(laceTag: string): string | null {
  const PREFIX = "lace.local/";
  if (!laceTag.startsWith(PREFIX)) return null;

  const rest = laceTag.slice(PREFIX.length);

  // Find the tag separator: first colon after the last slash
  const lastSlash = rest.lastIndexOf("/");
  const searchFrom = lastSlash >= 0 ? lastSlash + 1 : 0;
  const tagColon = rest.indexOf(":", searchFrom);

  if (tagColon >= 0) {
    const tag = rest.slice(tagColon + 1);
    if (tag.startsWith("from_")) {
      // Digest encoding: from_sha256__abc → @sha256:abc
      const imageName = rest.slice(0, tagColon);
      const digest = tag.slice("from_".length).replace("__", ":");
      return `${imageName}@${digest}`;
    }
  }

  // Non-digest cases: rest is already the original reference
  return rest;
}

/**
 * Rewrite the first FROM line in a Dockerfile to use a new image reference.
 * Preserves everything else byte-identical (comments, whitespace, other instructions).
 * Preserves alias (AS ...) and --platform flag.
 */
export function rewriteFrom(content: string, newImageRef: string): string {
  const parsed = parseDockerfile(content);
  const lines = content.split("\n");
  const fromLine = lines[parsed.fromLine];

  // Build the new FROM line preserving platform and alias
  let newFrom = "FROM";
  if (parsed.platform) {
    newFrom += ` --platform=${parsed.platform}`;
  }
  newFrom += ` ${newImageRef}`;
  if (parsed.alias) {
    newFrom += ` AS ${parsed.alias}`;
  }

  lines[parsed.fromLine] = newFrom;
  return lines.join("\n");
}

/**
 * Restore the first FROM line to the original image reference.
 * Inverse of rewriteFrom. Preserves alias and platform flag.
 */
export function restoreFrom(
  content: string,
  originalImageRef: string,
): string {
  return rewriteFrom(content, originalImageRef);
}

/**
 * Generate the minimal Dockerfile for the prebuild temp context.
 * Contains only the ARG prelude and the first FROM line.
 */
export function generatePrebuildDockerfile(parsed: ParsedDockerfile): string {
  const lines: string[] = [];
  for (const arg of parsed.argPrelude) {
    lines.push(arg);
  }
  lines.push(parsed.fromLineText);
  return lines.join("\n") + "\n";
}

/**
 * Parse an image reference string into its components.
 * Works for: "node:24", "node@sha256:abc", "ghcr.io/owner/image:v2"
 */
export function parseImageRef(image: string): {
  imageName: string;
  tag: string | null;
  digest: string | null;
} {
  // Check for digest (@sha256:...)
  const digestIndex = image.indexOf("@");
  if (digestIndex >= 0) {
    return {
      imageName: image.slice(0, digestIndex),
      tag: null,
      digest: image.slice(digestIndex + 1),
    };
  }

  // Find tag separator: first colon after the last slash (to handle registry:port)
  const lastSlash = image.lastIndexOf("/");
  const searchFrom = lastSlash >= 0 ? lastSlash + 1 : 0;
  const tagColon = image.indexOf(":", searchFrom);

  if (tagColon >= 0) {
    return {
      imageName: image.slice(0, tagColon),
      tag: image.slice(tagColon + 1),
      digest: null,
    };
  }

  // No tag or digest
  return { imageName: image, tag: null, digest: null };
}

/**
 * Generate a minimal Dockerfile for an image-based config.
 * Used for the temp prebuild context.
 */
export function generateImageDockerfile(image: string): string {
  return `FROM ${image}\n`;
}

/** Extract the original text of an instruction from the Dockerfile source. */
function getInstructionText(content: string, inst: Instruction): string {
  const range = inst.getRange();
  const lines = content.split("\n");
  if (range.start.line === range.end.line) {
    return lines[range.start.line];
  }
  // Multi-line instruction (line continuations)
  return lines.slice(range.start.line, range.end.line + 1).join("\n");
}
