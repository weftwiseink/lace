---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T09:30:00-08:00
last_reviewed:
  status: accepted
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T14:30:00-08:00
  round: 2
task_list: lace/packages-lace-cli
type: proposal
state: live
status: implementation_wip
tags: [devcontainer, prebuild, image, lace]
---

# Prebuild Support for Image-Based Devcontainer Configurations

> BLUF: Extend `lace prebuild` to support `image`-based devcontainer configurations alongside the existing Dockerfile-based workflow. When a devcontainer uses `"image": "mcr.microsoft.com/devcontainers/base:ubuntu"`, the prebuild will generate a minimal Dockerfile (`FROM <image>`), build a prebuilt image tagged `lace.local/mcr.microsoft.com/devcontainers/base:ubuntu`, then update devcontainer.json to use `"image": "lace.local/..."` (idempotent). The existing bidirectional tag format, caching, and metadata systems are reused with minimal additions.
>
> - **Key insight:** The Dockerfile machinery already handles the core build/tag/restore logic. Image-based configs only need: (1) synthetic Dockerfile generation, (2) devcontainer.json `image` field rewriting instead of Dockerfile rewriting, and (3) adjusted restore path.
> - **Source:** [`packages/lace/src/lib/devcontainer.ts:138-143`](../../packages/lace/src/lib/devcontainer.ts) currently throws an error for image-based configs.

## Objective

Currently, `lace prebuild` only works with Dockerfile-based devcontainer configurations. Users with image-based configs (a common pattern for simple setups) must either:

1. Convert to a Dockerfile (adds friction and a file to maintain)
2. Forgo prebuild entirely (longer container startup times)

This proposal enables prebuild for image-based configs, treating them symmetrically with Dockerfile configs while reusing the existing infrastructure.

## Background

### Current Prebuild Architecture

The prebuild pipeline (see [`packages/lace/docs/prebuild.md`](../../packages/lace/docs/prebuild.md)) follows this flow:

1. Read devcontainer.json, extract `prebuildFeatures` from `customizations.lace.prebuildFeatures`
2. Validate no feature overlap between `prebuildFeatures` and `features`
3. **Parse Dockerfile, extract FROM line and ARG prelude**
4. Generate temp context in `.lace/prebuild/` (minimal Dockerfile + devcontainer.json with promoted features)
5. Compare against cache (skip if unchanged, unless `--force`)
6. Run `devcontainer build --workspace-folder .lace/prebuild/ --image-name lace.local/<tag>`
7. **Rewrite Dockerfile FROM line to lace.local tag**
8. Merge lock file entries under `lace.prebuiltFeatures` namespace
9. Write metadata (originalFrom, prebuildTag, timestamp)

Steps 3 and 7 (bolded) are Dockerfile-specific. The rest of the pipeline is image-agnostic.

### Bidirectional Tag Format

The existing `generateTag()` / `parseTag()` functions in [`dockerfile.ts`](../../packages/lace/src/lib/dockerfile.ts) produce reversible lace.local tags:

| Original | Generated |
|----------|-----------|
| `node:24-bookworm` | `lace.local/node:24-bookworm` |
| `mcr.microsoft.com/devcontainers/base:ubuntu` | `lace.local/mcr.microsoft.com/devcontainers/base:ubuntu` |
| `image@sha256:abc123...` | `lace.local/image:from_sha256__abc123...` |

This format already works for any image reference, including registry-prefixed ones.

### Restore Mechanism

[`restore.ts`](../../packages/lace/src/lib/restore.ts) currently:

1. Reads Dockerfile, checks for `lace.local/` in FROM
2. Uses `parseTag()` to derive the original image reference (primary path)
3. Falls back to metadata if tag parsing fails
4. Rewrites Dockerfile FROM back to original

For image-based configs, the same logic applies but targets devcontainer.json's `image` field.

## Proposed Solution

### High-Level Design

The pipeline branches based on config type:

```
                    ┌─────────────────────────┐
                    │ Read devcontainer.json  │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ Extract prebuildFeatures│
                    └───────────┬─────────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
        has Dockerfile?    has image?       neither
               │                │                │
               ▼                ▼                ▼
    ┌──────────────────┐ ┌──────────────────┐  error
    │ Parse Dockerfile │ │ Use image field  │
    │ Extract FROM     │ │ as base image    │
    └────────┬─────────┘ └────────┬─────────┘
             │                    │
             └────────┬───────────┘
                      │
           ┌──────────▼──────────┐
           │ Generate temp ctx   │
           │ (synthetic Dockerfile│
           │  + devcontainer.json)│
           └──────────┬──────────┘
                      │
           ┌──────────▼──────────┐
           │ Cache check / build │
           └──────────┬──────────┘
                      │
               ┌──────┴──────┐
               │             │
          Dockerfile      image
               │             │
               ▼             ▼
    ┌──────────────────┐ ┌──────────────────┐
    │ Rewrite Dockerfile│ │ Rewrite image   │
    │ FROM line         │ │ field in JSON   │
    └──────────────────┘ └──────────────────┘
```

### Key Changes

#### 1. Config Type Detection (`devcontainer.ts`)

Add a new function and extend `DevcontainerConfig`:

```typescript
export type ConfigBuildSource =
  | { kind: "dockerfile"; path: string }
  | { kind: "image"; image: string };

export interface DevcontainerConfig {
  raw: Record<string, unknown>;
  buildSource: ConfigBuildSource;  // replaces dockerfilePath
  features: Record<string, Record<string, unknown>>;
  configDir: string;
  configPath: string;  // NEW: the filePath argument passed to readDevcontainerConfig()
}

// In readDevcontainerConfig(), store the original filePath:
export function readDevcontainerConfig(filePath: string): DevcontainerConfig {
  // ... existing parsing logic ...
  return {
    raw,
    buildSource: resolveBuildSource(raw, configDir),
    features,
    configDir,
    configPath: filePath,  // Store for later use in rewriting
  };
}
```

The existing `resolveDockerfilePath()` becomes `resolveBuildSource()`:

```typescript
export function resolveBuildSource(
  raw: Record<string, unknown>,
  configDir: string,
): ConfigBuildSource {
  // Check build.dockerfile first (modern format)
  const build = raw.build as Record<string, unknown> | undefined;
  if (build?.dockerfile) {
    return { kind: "dockerfile", path: resolve(configDir, build.dockerfile as string) };
  }

  // Check legacy dockerfile field
  if (raw.dockerfile) {
    return { kind: "dockerfile", path: resolve(configDir, raw.dockerfile as string) };
  }

  // Check for image-based config
  if (raw.image && typeof raw.image === "string") {
    return { kind: "image", image: raw.image };
  }

  throw new DevcontainerConfigError(
    "Cannot determine build source from devcontainer.json. " +
      "Expected `build.dockerfile`, `dockerfile`, or `image` field.",
  );
}
```

#### 2. Image Parsing (`dockerfile.ts`)

Add functions to parse/manipulate image references without a Dockerfile:

```typescript
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
```

> NOTE: `parseImageRef()` mirrors the logic already in `parseDockerfile()` for extracting image components. We extract it as a standalone function to avoid requiring a Dockerfile.

#### 3. Temp Devcontainer.json for Image Configs (`devcontainer.ts`)

No changes needed to `generateTempDevcontainerJson()`. The existing signature `(prebuildFeatures, dockerfileName)` works for both config types because both paths produce a temp Dockerfile (real or synthetic) and reference it with `"Dockerfile"`. The temp context always uses a Dockerfile-based build, regardless of the original config type.

> NOTE: The difference between Dockerfile and image configs is in how the temp Dockerfile is sourced (extracted from real Dockerfile vs. generated from image reference), not in the temp devcontainer.json structure.

#### 4. Devcontainer.json Rewriting (`devcontainer.ts`)

Add functions to rewrite the `image` field:

```typescript
/**
 * Rewrite the `image` field in a devcontainer.json file.
 * Preserves all other content (comments, formatting where possible).
 * Returns the modified JSON string.
 */
export function rewriteImageField(
  content: string,
  newImage: string,
): string {
  // Use JSONC modification to preserve comments
  const edits = jsonc.modify(content, ["image"], newImage, {});
  return jsonc.applyEdits(content, edits);
}

/**
 * Check if devcontainer.json has a lace.local image.
 */
export function hasLaceLocalImage(raw: Record<string, unknown>): boolean {
  const image = raw.image;
  return typeof image === "string" && image.startsWith("lace.local/");
}

/**
 * Get the current image from a devcontainer.json.
 */
export function getCurrentImage(raw: Record<string, unknown>): string | null {
  const image = raw.image;
  return typeof image === "string" ? image : null;
}
```

#### 5. Metadata Extension (`metadata.ts`)

Extend metadata to track config type:

```typescript
export interface PrebuildMetadata {
  /** The original image reference (FROM line or image field value). */
  originalFrom: string;
  /** ISO timestamp of the last prebuild. */
  timestamp: string;
  /** The lace.local tag that was generated. */
  prebuildTag: string;
  /** Config type: "dockerfile" or "image". New field, defaults to "dockerfile" for backwards compat. */
  configType?: "dockerfile" | "image";
}
```

#### 6. Prebuild Pipeline Changes (`prebuild.ts`)

The main `runPrebuild()` function branches based on config type:

```typescript
export function runPrebuild(options: PrebuildOptions = {}): PrebuildResult {
  // ... existing setup ...

  // Step 1: Read devcontainer.json
  let config;
  try {
    config = readDevcontainerConfig(configPath);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return { exitCode: 1, message: (err as Error).message };
  }

  // Step 1b: Extract prebuild features (unchanged)
  const prebuildResult = extractPrebuildFeatures(config.raw);
  // ... handle null/absent/empty ...

  // Step 2: Validate no feature overlap (unchanged)
  const overlaps = validateNoOverlap(prebuildFeatures, config.features);
  // ... handle overlaps ...

  // Step 3: Parse build source
  let parsed: { imageName: string; tag: string | null; digest: string | null; image: string };
  let dockerfileContent: string | null = null;  // null for image-based

  if (config.buildSource.kind === "dockerfile") {
    // Existing Dockerfile path
    try {
      dockerfileContent = readFileSync(config.buildSource.path, "utf-8");
    } catch (err) {
      // ... error handling ...
    }

    // Restore if already has lace.local (existing logic)
    if (dockerfileContent.includes("lace.local/")) {
      // ... existing restore logic ...
    }

    const dockerfileParsed = parseDockerfile(dockerfileContent);
    parsed = {
      imageName: dockerfileParsed.imageName,
      tag: dockerfileParsed.tag,
      digest: dockerfileParsed.digest,
      image: dockerfileParsed.image,
    };
  } else {
    // Image-based config
    let currentImage = config.buildSource.image;

    // Restore if already has lace.local
    if (currentImage.startsWith("lace.local/")) {
      const originalImage = parseTag(currentImage);
      if (originalImage) {
        currentImage = originalImage;
      } else {
        // Fallback to metadata
        const existingMetadata = readMetadata(prebuildDir);
        if (existingMetadata?.originalFrom) {
          currentImage = existingMetadata.originalFrom;
        }
      }
    }

    const imageParsed = parseImageRef(currentImage);
    parsed = {
      imageName: imageParsed.imageName,
      tag: imageParsed.tag,
      digest: imageParsed.digest,
      image: currentImage,
    };
  }

  // Step 4: Generate temp context
  const tempDockerfile = config.buildSource.kind === "dockerfile"
    ? generatePrebuildDockerfile(/* existing logic */)
    : generateImageDockerfile(parsed.image);

  // Note: generateTempDevcontainerJson signature unchanged - both paths use "Dockerfile"
  const tempDevcontainerJson = generateTempDevcontainerJson(
    prebuildFeatures,
    "Dockerfile",
  );
  const prebuildTag = generateTag(parsed.imageName, parsed.tag, parsed.digest);

  // Step 5: Compare against cache (unchanged)
  // ... existing cache logic ...

  // Step 6: Write temp context and build (unchanged)
  // ... existing build logic ...

  // Step 7: Rewrite source
  if (config.buildSource.kind === "dockerfile") {
    // Existing: rewrite Dockerfile FROM
    const rewrittenDockerfile = rewriteFrom(dockerfileContent!, prebuildTag);
    writeFileSync(config.buildSource.path, rewrittenDockerfile, "utf-8");
  } else {
    // New: rewrite devcontainer.json image field
    const configContent = readFileSync(config.configPath, "utf-8");
    const rewrittenConfig = rewriteImageField(configContent, prebuildTag);
    writeFileSync(config.configPath, rewrittenConfig, "utf-8");
  }

  // Step 8: Merge lock file (unchanged)
  // Step 9: Write metadata
  writeMetadata(prebuildDir, {
    originalFrom: parsed.image,
    timestamp: new Date().toISOString(),
    prebuildTag,
    configType: config.buildSource.kind,
  });

  // ... return success ...
}
```

#### 7. Restore Changes (`restore.ts`)

Extend restore to handle both config types:

```typescript
export function runRestore(options: RestoreOptions = {}): RestoreResult {
  // ... existing setup ...

  const config = readDevcontainerConfig(configPath);

  if (config.buildSource.kind === "dockerfile") {
    // Existing Dockerfile restore logic
    // ... unchanged ...
  } else {
    // Image-based restore
    const currentImage = getCurrentImage(config.raw);
    if (!currentImage || !currentImage.startsWith("lace.local/")) {
      const msg = "devcontainer.json image does not reference a lace.local image. Nothing to restore.";
      console.log(msg);
      return { exitCode: 0, message: msg };
    }

    // Primary: derive original from lace.local tag
    let originalImage = parseTag(currentImage);

    // Fallback: metadata
    if (!originalImage) {
      const metadata = readMetadata(prebuildDir);
      if (!metadata) {
        const msg = "Cannot determine original image: tag parsing failed and no metadata available.";
        console.error(`Error: ${msg}`);
        return { exitCode: 1, message: msg };
      }
      originalImage = metadata.originalFrom;
    }

    // Rewrite devcontainer.json
    const configContent = readFileSync(config.configPath, "utf-8");
    const restored = rewriteImageField(configContent, originalImage);
    writeFileSync(config.configPath, restored, "utf-8");

    const msg = `Restored devcontainer.json image to: ${originalImage}`;
    console.log(msg);
    return { exitCode: 0, message: msg };
  }
}
```

## Important Design Decisions

### Decision: Synthetic Dockerfile vs. Direct Image Build

**Decision:** Generate a synthetic Dockerfile (`FROM <image>`) for image-based configs rather than attempting to use `devcontainer build` directly with an image.

**Why:**
- The existing pipeline already handles Dockerfile-based builds robustly.
- The `devcontainer build` command works identically with a minimal `FROM` Dockerfile as with an image field.
- Keeps the core build logic unified—only the input preparation and output rewriting differ.
- Avoids introducing a parallel code path for image-based builds that could diverge over time.

### Decision: Modify devcontainer.json, Not Add a Dockerfile

**Decision:** For image-based configs, rewrite the `image` field in devcontainer.json to `lace.local/...` rather than converting to a Dockerfile-based config.

**Why:**
- Preserves user's config style choice (some users prefer image-based for simplicity).
- The `image` field is already the canonical location for the base image in these configs.
- Adding a Dockerfile would create new files the user didn't ask for and must now maintain.
- JSONC modification preserves comments, unlike generating a new Dockerfile.

### Decision: Reuse Existing Tag Format

**Decision:** Use the same `lace.local/<image>:<tag>` format for image-based configs as for Dockerfile-based configs.

**Why:**
- The tag format already handles all image reference variants (tagged, untagged, digest, registry-prefixed).
- Bidirectional parsing (`generateTag`/`parseTag`) works unchanged.
- Consistent user experience—prebuild images are always recognizable by the `lace.local/` prefix.
- No need for format variations or version flags in tags.

### Decision: Store configType in Metadata

**Decision:** Add `configType: "dockerfile" | "image"` to `metadata.json`.

**Why:**
- Enables restore to know which file to modify without re-parsing the config.
- Provides debugging context when inspecting `.lace/prebuild/` state.
- Backwards compatible: existing metadata without `configType` defaults to `"dockerfile"`.

### Decision: Use JSONC for devcontainer.json Modification

**Decision:** Use `jsonc-parser`'s `modify()` and `applyEdits()` for devcontainer.json rewriting rather than parse/stringify.

**Why:**
- devcontainer.json files commonly contain comments (JSONC format).
- Parse/stringify would strip comments, frustrating users.
- `jsonc-parser` is already a dependency (used in `readDevcontainerConfig`).
- Minimal edits preserve formatting and reduce diff noise.

## Edge Cases / Challenging Scenarios

### Image with Registry Port

**Scenario:** `image: "registry.internal:5000/team/base:v2"`

**Handling:** `parseImageRef()` finds the tag separator by searching after the last `/`, so the `:5000` port is not mistaken for a tag. Tag extraction works correctly.

**Test case:** Verify `parseImageRef("registry.internal:5000/team/base:v2")` returns `{ imageName: "registry.internal:5000/team/base", tag: "v2", digest: null }`.

### Digest-Based Image Reference

**Scenario:** `image: "mcr.microsoft.com/devcontainers/base@sha256:abc123..."`

**Handling:** The digest is detected by `@` before any `:` search. Tag generation produces `lace.local/mcr.microsoft.com/devcontainers/base:from_sha256__abc123...`.

**Test case:** Verify round-trip: `parseTag(generateTag(...parseImageRef(image)))` returns the original.

### Mixed Config (Both Dockerfile and Image)

**Scenario:** devcontainer.json has both `build.dockerfile` and `image` fields.

**Handling:** Dockerfile takes precedence (this is standard devcontainer behavior). The image field is ignored.

**Test case:** Config with both fields uses Dockerfile path, image field is not modified.

### Nested Build Object

**Scenario:** `{ "build": { "dockerfile": "Dockerfile", "context": ".." } }` vs. `{ "build": { "dockerfile": "Dockerfile" } }` vs. `{ "dockerfile": "Dockerfile" }` (legacy).

**Handling:** All are handled by the existing `resolveBuildSource()` logic. The context field doesn't affect prebuild.

**Test case:** Verify all three forms resolve to Dockerfile config type.

### Image Field Absent After Restore

**Scenario:** User manually removes the `image` field from devcontainer.json after prebuild.

**Handling:** `readDevcontainerConfig()` will throw "Cannot determine build source" error. Prebuild and restore will fail with a clear message.

**Acceptable:** User made an invalid change; the error message guides them.

### Concurrent Prebuild and Restore

**Scenario:** Two processes run `lace prebuild` and `lace restore` simultaneously on the same workspace.

**Handling:** The existing `withFlockSync()` wrapper (if available) serializes operations. If flock is unavailable, a warning is logged and operations proceed—potential for race conditions, but this is documented and rare.

**No change needed:** Existing concurrency handling applies to image-based configs.

### Pre-existing lace.local Image in Unmanaged Config

**Scenario:** User manually sets `image: "lace.local/something:tag"` without running prebuild.

**Handling:**
- Prebuild: detects `lace.local/` prefix, attempts restore via `parseTag()`, succeeds if tag is in standard format, then proceeds with prebuild.
- If tag is non-standard (user's custom `lace.local/` image), `parseTag()` returns the reference unchanged (minus prefix), which may not be what the user intended.

**Mitigation:** Document that `lace.local/` is a reserved prefix for lace-managed images. Add a warning if `parseTag()` produces a suspicious result (e.g., still starts with `lace.local/`).

### Very Long Image References

**Scenario:** `image: "my-very-long-registry.example.com/very/deeply/nested/organization/project/image:with-a-very-long-tag-name-v2.1.0-beta.3"`

**Handling:** `generateTag()` already handles Docker's 128-char tag limit by truncating digest hashes. For non-digest tags that exceed limits, the tag is used as-is—Docker will error if it's truly invalid. Extremely long image names are rare in practice.

**Test case:** Verify a 200-char image reference either works or produces a clear Docker error (not a lace crash).

### Prebuild with No prebuildFeatures (Image Config)

**Scenario:** Image-based config with no `prebuildFeatures` configured.

**Handling:** Same as Dockerfile: exit 0 with "No prebuildFeatures configured" message. No changes made.

**Test case:** Image config without prebuildFeatures returns early with message.

## Test Plan

### Unit Tests

#### `parseImageRef()` (`lib/__tests__/dockerfile.test.ts`)

| Input | Expected Output |
|-------|-----------------|
| `"node:24-bookworm"` | `{ imageName: "node", tag: "24-bookworm", digest: null }` |
| `"node"` | `{ imageName: "node", tag: null, digest: null }` |
| `"node@sha256:abc123"` | `{ imageName: "node", tag: null, digest: "sha256:abc123" }` |
| `"ghcr.io/owner/image:v2"` | `{ imageName: "ghcr.io/owner/image", tag: "v2", digest: null }` |
| `"registry:5000/image:tag"` | `{ imageName: "registry:5000/image", tag: "tag", digest: null }` |
| `"mcr.microsoft.com/devcontainers/base:ubuntu"` | `{ imageName: "mcr.microsoft.com/devcontainers/base", tag: "ubuntu", digest: null }` |

#### `generateImageDockerfile()` (`lib/__tests__/dockerfile.test.ts`)

| Input | Expected Output |
|-------|-----------------|
| `"node:24-bookworm"` | `"FROM node:24-bookworm\n"` |
| `"mcr.microsoft.com/devcontainers/base:ubuntu"` | `"FROM mcr.microsoft.com/devcontainers/base:ubuntu\n"` |

#### Round-trip: `generateTag(parseImageRef(image))` → `parseTag()` → original

Test that for any image reference, the generated tag can be parsed back to the original:

```typescript
const images = [
  "node:24-bookworm",
  "node",
  "node@sha256:abc123",
  "ghcr.io/owner/image:v2",
  "registry:5000/image:tag",
  "mcr.microsoft.com/devcontainers/base:ubuntu",
];

for (const image of images) {
  const { imageName, tag, digest } = parseImageRef(image);
  const laceTag = generateTag(imageName, tag, digest);
  const restored = parseTag(laceTag);
  expect(restored).toBe(image);  // or normalized equivalent for untagged
}
```

#### `rewriteImageField()` (`lib/__tests__/devcontainer.test.ts`)

| Original JSON | New Image | Expected |
|---------------|-----------|----------|
| `{"image": "node:24"}` | `"lace.local/node:24"` | `{"image": "lace.local/node:24"}` |
| `{"image": "foo", /* comment */ "features": {}}` | `"lace.local/foo:latest"` | Comments preserved, image updated |

#### `resolveBuildSource()` (`lib/__tests__/devcontainer.test.ts`)

| Config | Expected |
|--------|----------|
| `{ "build": { "dockerfile": "Dockerfile" } }` | `{ kind: "dockerfile", path: ".../Dockerfile" }` |
| `{ "dockerfile": "Dockerfile" }` | `{ kind: "dockerfile", path: ".../Dockerfile" }` |
| `{ "image": "node:24" }` | `{ kind: "image", image: "node:24" }` |
| `{ "build": { "dockerfile": "Dockerfile" }, "image": "ignored" }` | `{ kind: "dockerfile", ... }` |
| `{}` | throws DevcontainerConfigError |
| `{ "features": {} }` | throws DevcontainerConfigError ("Cannot determine build source...") |

### Integration Tests (`commands/__tests__/prebuild.integration.test.ts`)

#### Happy Path: Image-Based Prebuild

```typescript
it("runs full pipeline for image-based config and rewrites devcontainer.json", () => {
  const json = JSON.stringify({
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
        },
      },
    },
    features: {
      "ghcr.io/devcontainers/features/git:1": {},
    },
  }, null, 2);

  setupImageWorkspace(json);  // helper that doesn't create Dockerfile
  const mock = createMock();

  const result = runPrebuild({ workspaceRoot, subprocess: mock });

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Prebuild complete");

  // Verify devcontainer.json was rewritten
  const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
  expect(config).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");

  // Verify temp context
  expect(existsSync(join(prebuildDir, "Dockerfile"))).toBe(true);
  const tempDockerfile = readFileSync(join(prebuildDir, "Dockerfile"), "utf-8");
  expect(tempDockerfile).toBe("FROM mcr.microsoft.com/devcontainers/base:ubuntu\n");

  // Verify metadata includes configType
  const metadata = JSON.parse(readFileSync(join(prebuildDir, "metadata.json"), "utf-8"));
  expect(metadata.configType).toBe("image");
});
```

#### Idempotency: Image-Based

```typescript
it("skips rebuild when image config is unchanged", () => {
  setupImageWorkspace(IMAGE_JSON);
  const mock = createMock();

  runPrebuild({ workspaceRoot, subprocess: mock });
  expect(mockCalls).toHaveLength(1);

  const result = runPrebuild({ workspaceRoot, subprocess: mock });
  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("up to date");
  expect(mockCalls).toHaveLength(1);  // Not called again
});
```

#### Restore: Image-Based

```typescript
it("restores devcontainer.json image field", () => {
  setupImageWorkspace(IMAGE_JSON);
  const mock = createMock();

  // Prebuild
  runPrebuild({ workspaceRoot, subprocess: mock });

  let config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
  expect(config).toContain("lace.local/");

  // Restore
  const result = runRestore({ workspaceRoot });
  expect(result.exitCode).toBe(0);

  config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
  expect(config).toContain('"image": "mcr.microsoft.com/devcontainers/base:ubuntu"');
  expect(config).not.toContain("lace.local/");
});
```

#### Re-Prebuild After Restore (Image-Based)

```typescript
it("re-prebuilds correctly after restore for image config", () => {
  setupImageWorkspace(IMAGE_JSON);
  const mock = createMock();

  // First prebuild
  runPrebuild({ workspaceRoot, subprocess: mock });
  expect(mockCalls).toHaveLength(1);

  // Restore
  runRestore({ workspaceRoot });

  // Change prebuildFeatures
  const newJson = JSON.stringify({
    image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/weft/devcontainer-features/wezterm-server:1": {},
        },
      },
    },
  }, null, 2);
  writeFileSync(join(devcontainerDir, "devcontainer.json"), newJson, "utf-8");

  // Second prebuild
  const result = runPrebuild({ workspaceRoot, subprocess: mock });
  expect(result.exitCode).toBe(0);
  expect(mockCalls).toHaveLength(2);
});
```

#### Re-Prebuild After Base Image Change (Image-Based)

```typescript
it("rebuilds when base image changes after restore", () => {
  setupImageWorkspace(IMAGE_JSON);
  const mock = createMock();

  // First prebuild
  runPrebuild({ workspaceRoot, subprocess: mock });
  expect(mockCalls).toHaveLength(1);

  // Restore
  runRestore({ workspaceRoot });

  // Change base image (but keep same prebuildFeatures)
  const newJson = JSON.stringify({
    image: "mcr.microsoft.com/devcontainers/base:jammy",  // Changed from :ubuntu
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
        },
      },
    },
    features: {
      "ghcr.io/devcontainers/features/git:1": {},
    },
  }, null, 2);
  writeFileSync(join(devcontainerDir, "devcontainer.json"), newJson, "utf-8");

  // Second prebuild - should rebuild due to different base image
  const result = runPrebuild({ workspaceRoot, subprocess: mock });
  expect(result.exitCode).toBe(0);
  expect(mockCalls).toHaveLength(2);  // Called again due to base image change

  // Verify the new tag uses the new base image
  const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
  expect(config).toContain("lace.local/mcr.microsoft.com/devcontainers/base:jammy");
});
```

#### Dry-Run: Image-Based

```typescript
it("reports planned actions for image config without side effects", () => {
  setupImageWorkspace(IMAGE_JSON);
  const mock = createMock();

  const result = runPrebuild({ workspaceRoot, subprocess: mock, dryRun: true });

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Dry run");
  expect(result.message).toContain("lace.local/mcr.microsoft.com/devcontainers/base:ubuntu");

  // No side effects
  expect(existsSync(prebuildDir)).toBe(false);
  const config = readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8");
  expect(config).not.toContain("lace.local/");
});
```

#### Error: No prebuildFeatures (Image Config)

```typescript
it("exits 0 with message when image config has no prebuildFeatures", () => {
  const json = JSON.stringify({
    image: "node:24",
    features: {},
  }, null, 2);
  setupImageWorkspace(json);

  const result = runPrebuild({ workspaceRoot, subprocess: createMock() });
  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("No prebuildFeatures configured");
});
```

#### Mixed Config: Dockerfile Takes Precedence

```typescript
it("uses Dockerfile when both Dockerfile and image are present", () => {
  const json = JSON.stringify({
    build: { dockerfile: "Dockerfile" },
    image: "ignored:tag",  // Should be ignored
    customizations: {
      lace: {
        prebuildFeatures: {
          "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
        },
      },
    },
  }, null, 2);
  setupWorkspace(json, "FROM node:24-bookworm\n");
  const mock = createMock();

  runPrebuild({ workspaceRoot, subprocess: mock });

  // Verify Dockerfile was rewritten, not devcontainer.json image field
  const dockerfile = readFileSync(join(devcontainerDir, "Dockerfile"), "utf-8");
  expect(dockerfile).toContain("FROM lace.local/node:24-bookworm");

  const config = JSON.parse(readFileSync(join(devcontainerDir, "devcontainer.json"), "utf-8"));
  expect(config.image).toBe("ignored:tag");  // Unchanged
});
```

### Manual / Smoke Tests

1. **Real MCR image**: Run `lace prebuild` on a project with `image: "mcr.microsoft.com/devcontainers/base:ubuntu"` and verify the container builds and starts correctly.

2. **Restore and rebuild cycle**: Prebuild → restore → modify prebuildFeatures → prebuild again. Verify the second build uses the original base image.

3. **JSONC comment preservation**: Add comments to devcontainer.json, run prebuild, verify comments are preserved in the rewritten file.

4. **Digest-based image**: Test with `image: "node@sha256:..."` to verify the digest encoding/decoding works end-to-end.

## Implementation Phases

### Phase 1: Config Type Detection

**Scope:** Modify `devcontainer.ts` to detect and return config type (Dockerfile vs. image).

**Files:**
- `packages/lace/src/lib/devcontainer.ts`
- `packages/lace/src/lib/__tests__/devcontainer.test.ts`

**Changes:**
1. Add `ConfigBuildSource` type and `buildSource` field to `DevcontainerConfig`.
2. Rename/refactor `resolveDockerfilePath()` to `resolveBuildSource()`.
3. Update `readDevcontainerConfig()` to use `resolveBuildSource()`.
4. Add `configPath` to `DevcontainerConfig` for later rewriting.
5. Add/update unit tests for all config variations.

**Success criteria:**
- `readDevcontainerConfig()` correctly identifies Dockerfile vs. image configs.
- All existing tests pass (Dockerfile configs still work).
- New tests cover image-based config detection.

**Constraints:**
- Do NOT modify `prebuild.ts` or `restore.ts` yet—they should still work with the refactored interface.
- Backwards compatibility: existing callers of `config.dockerfilePath` need updating to use `config.buildSource`.

**Migration path for `config.dockerfilePath` callers:**
- `prebuild.ts` line 108: `config.dockerfilePath` → `config.buildSource.kind === "dockerfile" ? config.buildSource.path : null` (or throw for image configs until Phase 5)
- `restore.ts` line 38: same pattern
- During Phase 1, the Dockerfile path can be accessed via `config.buildSource.path` when `config.buildSource.kind === "dockerfile"`. Image-based configs will throw an error until Phase 5 integrates them.

### Phase 2: Image Reference Parsing

**Scope:** Add `parseImageRef()` and `generateImageDockerfile()` functions.

**Files:**
- `packages/lace/src/lib/dockerfile.ts`
- `packages/lace/src/lib/__tests__/dockerfile.test.ts`

**Changes:**
1. Implement `parseImageRef()` to extract imageName/tag/digest from image strings.
2. Implement `generateImageDockerfile()` to create minimal `FROM <image>` Dockerfile.
3. Add comprehensive unit tests including edge cases (registry ports, digests, untagged).
4. Add round-trip tests: `generateTag(parseImageRef(x))` → `parseTag()` → `x`.

**Success criteria:**
- `parseImageRef()` handles all documented image reference formats.
- Round-trip tests pass for all standard image formats.
- Existing `parseDockerfile()` tests unchanged.

**Constraints:**
- These are pure functions with no file I/O.
- Do NOT modify any existing functions—only add new ones.

### Phase 3: Devcontainer.json Modification

**Scope:** Add functions to read/write the `image` field in devcontainer.json.

**Files:**
- `packages/lace/src/lib/devcontainer.ts`
- `packages/lace/src/lib/__tests__/devcontainer.test.ts`

**Changes:**
1. Implement `rewriteImageField()` using `jsonc-parser`'s modify/applyEdits.
2. Implement `hasLaceLocalImage()` helper.
3. Implement `getCurrentImage()` helper.
4. Add unit tests including JSONC comment preservation.

**Success criteria:**
- `rewriteImageField()` updates image field without stripping comments.
- `hasLaceLocalImage()` correctly detects lace.local prefix.
- Tests verify comment preservation in JSONC files.

**Constraints:**
- Use `jsonc-parser` (already a dependency) for all JSON modification.
- Do NOT parse/stringify—that would lose comments.

### Phase 4: Metadata Extension

**Scope:** Add `configType` field to prebuild metadata.

**Files:**
- `packages/lace/src/lib/metadata.ts`
- `packages/lace/src/lib/__tests__/metadata.test.ts`

**Changes:**
1. Add optional `configType` field to `PrebuildMetadata` interface.
2. Update `writeMetadata()` to accept configType.
3. Ensure `readMetadata()` handles missing configType (defaults to "dockerfile").
4. Add tests for backwards compatibility with old metadata files.

**Success criteria:**
- New metadata files include configType.
- Old metadata files (without configType) still parse correctly.
- Tests verify backwards compatibility.

**Constraints:**
- Field must be optional for backwards compatibility.
- Do NOT change existing metadata file format beyond the new field.

### Phase 5: Prebuild Pipeline Integration

**Scope:** Update `runPrebuild()` to handle image-based configs.

**Files:**
- `packages/lace/src/lib/prebuild.ts`
- `packages/lace/src/commands/__tests__/prebuild.integration.test.ts`

**Changes:**
1. Update Step 3 (parse build source) to branch on config type.
2. For image configs: use `parseImageRef()` instead of `parseDockerfile()`.
3. For image configs: restore via `parseTag()` if image has lace.local prefix.
4. Update Step 4 (generate temp context) to use `generateImageDockerfile()` for image configs.
5. Update Step 7 (rewrite source) to use `rewriteImageField()` for image configs.
6. Update Step 9 (write metadata) to include configType.
7. Add integration tests for image-based prebuild.

**Success criteria:**
- `lace prebuild` works for image-based configs end-to-end.
- Dockerfile-based prebuild still works (regression tests pass).
- Integration tests cover happy path, idempotency, dry-run, and error cases.

**Constraints:**
- Maintain atomicity: don't modify devcontainer.json if build fails.
- Reuse existing cache comparison logic—only the input preparation differs.

### Phase 6: Restore Pipeline Integration

**Scope:** Update `runRestore()` to handle image-based configs.

**Files:**
- `packages/lace/src/lib/restore.ts`
- `packages/lace/src/commands/__tests__/restore.integration.test.ts` (create if needed)

**Changes:**
1. Branch on config type after reading config.
2. For image configs: check devcontainer.json image field for lace.local prefix.
3. For image configs: derive original via `parseTag()`, fallback to metadata.
4. For image configs: use `rewriteImageField()` to restore.
5. Add integration tests for image-based restore.

**Success criteria:**
- `lace restore` works for image-based configs.
- Dockerfile-based restore still works.
- Tests cover restore from tag parsing and from metadata fallback.

**Constraints:**
- Do NOT delete `.lace/prebuild/`—preserve cache for re-prebuild.
- Handle edge case where image field was manually changed after prebuild.

### Phase 7: Documentation and Polish

**Scope:** Update user documentation and add any finishing touches.

**Files:**
- `packages/lace/docs/prebuild.md`
- `packages/lace/README.md` (if applicable)

**Changes:**
1. Document image-based config support in prebuild docs.
2. Add examples showing both Dockerfile and image-based usage.
3. Document the `lace.local/` prefix as reserved for lace-managed images.
4. Review and address any TODO comments from earlier phases.

**Success criteria:**
- Documentation covers image-based prebuild workflow.
- Examples are clear and copy-pasteable.
- No TODO comments remain from implementation.

**Constraints:**
- Keep documentation concise—link to existing sections where applicable.
- Match existing documentation style.

## Open Questions

1. ~~**Cache key for image configs:**~~ **Resolved.** The synthetic Dockerfile is cached in `.lace/prebuild/Dockerfile`, which implicitly includes the image reference (e.g., `FROM mcr.microsoft.com/devcontainers/base:ubuntu\n`). The existing `contextsChanged()` function compares the cached Dockerfile against the newly generated one, so changing the base image will trigger a rebuild. No additional cache key mechanism is needed.

2. **Validation for lace.local prefix:** Should we warn if a user has a non-lace-managed `lace.local/` image? Current design: proceed silently, as the user may have intentionally used the prefix. **Implementation note:** In Phase 5/6, consider adding a warning if `parseTag()` returns a result that still starts with `lace.local/` (indicating a non-standard format that may not restore correctly).

3. **Future: build.args support:** Image-based configs don't support build args, but Dockerfile-based configs do. Should we document this limitation explicitly? Current design: not addressed, as build args require a Dockerfile context.
