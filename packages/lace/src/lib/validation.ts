// IMPLEMENTATION_VALIDATION

/**
 * Extract the feature identifier from a versioned feature reference.
 * Strips the version tag (everything after the last colon).
 *
 * "ghcr.io/devcontainers/features/git:1" → "ghcr.io/devcontainers/features/git"
 * "ghcr.io/devcontainers/features/git:2" → "ghcr.io/devcontainers/features/git"
 */
export function featureIdentifier(ref: string): string {
  const lastColon = ref.lastIndexOf(":");
  if (lastColon === -1) return ref;
  return ref.substring(0, lastColon);
}

/**
 * Validate that prebuildFeatures and features have no overlapping identifiers.
 * Comparison is version-insensitive (ignores the version tag after the last colon).
 *
 * Returns an array of overlapping identifier strings. Empty = valid.
 * Pure function — no I/O.
 */
export function validateNoOverlap(
  prebuildFeatures: Record<string, unknown>,
  features: Record<string, unknown>,
): string[] {
  const prebuildIds = new Set(
    Object.keys(prebuildFeatures).map(featureIdentifier),
  );
  const featureIds = Object.keys(features).map(featureIdentifier);

  const overlaps: string[] = [];
  for (const id of featureIds) {
    if (prebuildIds.has(id)) {
      overlaps.push(id);
    }
  }
  return overlaps;
}
