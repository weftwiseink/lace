---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T18:00:00-08:00
task_list: lace/dogfooding
type: proposal
state: archived
status: accepted
tags: [architecture, ports, prebuild, features, bug-fix, devcontainer]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T20:00:00-08:00
  round: 3
revisions:
  - at: 2026-02-09T19:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Fixed auto-injection write-back: iterate blocks separately instead of merged copy, using direct references for in-place mutation"
      - "Corrected D5: prebuild reads from disk, not from resolved in-memory config; auto-injected values do not propagate to prebuild"
      - "Corrected E8: port reassignment does NOT invalidate prebuild cache (desirable separation of build-time and runtime concerns)"
      - "Narrowed diagnostic warning (D4/Phase 5): only fires when user opts out of auto-injection with static port AND has no appPort"
      - "Added NOTE about validateNoOverlap guarding the spread merge in Step 1"
      - "Clarified T5 as two-step test (inject then resolve)"
      - "Corrected warnPrebuildPortTemplates entry in What NOT to Change"
  - at: 2026-02-09T19:30:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Introduced asymmetric auto-injection for prebuild features: inject appPort entries with default container port instead of feature option templates"
      - "Added injectForPrebuildBlock() code sketch alongside existing injectForBlock() for symmetric top-level injection"
      - "Added D5 (Asymmetric auto-injection for prebuild features) explaining why symmetric mapping is broken for prebuild features"
      - "Renumbered D5->D6 (No changes to prebuild pipeline) and updated to reference asymmetric appPort entries"
      - "Fixed E6 to show asymmetric behavior: appPort '22430:2222' instead of symmetric '22430:22430'"
      - "Added NOTE to E2 warning that ${lace.port()} in prebuild feature options is a misconfiguration"
      - "Updated D2 to reflect appPort targeting for prebuild features"
      - "Updated test plan T1, T5, T9 for asymmetric injection behavior"
      - "Updated BLUF to describe asymmetric vs symmetric injection distinction"
references:
  - cdocs/reports/2026-02-09-lace-port-allocation-investigation.md
  - cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
---

# Prebuild Features Port Support

> **BLUF:** The `lace up` port allocation pipeline silently ignores features declared in `customizations.lace.prebuildFeatures`, causing containers to start with zero port bindings when port-declaring features (like `wezterm-server`) are placed there instead of the top-level `features` block. This is a pit-of-failure: no error, no warning, and the symptom (invisible container) surfaces only at connection time. The fix extends the metadata pipeline to read from **both** `features` and `prebuildFeatures`, but with different auto-injection behavior for each: top-level features get symmetric injection (same port on host and container) as before, while prebuild features get **asymmetric injection** -- a `${lace.port()}` template is injected into `appPort` mapped to the feature's default container port (e.g., `"${lace.port(wezterm-server/sshPort)}:2222"`). This is necessary because prebuild features are installed at image build time with default option values; the devcontainer CLI does not reinstall them at runtime, so the container port is fixed at the feature's default. The `resolveTemplates` feature-ID validation is extended to accept features from both blocks. `validateNoOverlap` is unchanged. The [port allocation investigation](../reports/2026-02-09-lace-port-allocation-investigation.md) identified this bug; the [feature awareness v2 proposal](../proposals/2026-02-06-lace-feature-awareness-v2.md) established the metadata-driven port pipeline that this proposal extends.

## Objective

Ensure that moving a feature between `features` and `prebuildFeatures` only affects build-time caching behavior (whether the feature is baked into a prebuild image layer vs installed at container creation time), not runtime behavior like port allocation, template resolution, or port entry generation. A feature declaring `customizations.lace.ports` metadata should work identically regardless of which block it appears in.

## Background

Lace's `customizations.lace` section supports two feature blocks:

- **`features`** (top-level, standard devcontainer spec): installed by the devcontainer CLI at container creation time. Lace reads these for metadata fetching, auto-injection, and template resolution.
- **`prebuildFeatures`** (under `customizations.lace`): baked into a prebuild Docker image layer via `lace prebuild` for faster startup. Lace extracts these for the prebuild pipeline but does NOT process them through the port pipeline.

The [port allocation investigation](../reports/2026-02-09-lace-port-allocation-investigation.md) identified that the dotfiles devcontainer places `wezterm-server` in `prebuildFeatures` with no top-level `features` block. This causes the entire port pipeline to be skipped: no metadata fetch, no auto-injection, no template resolution, no port entries. The container starts with zero port bindings and is invisible to `lace-discover` and `wez-into`.

The current pipeline in `up.ts` (lines 121-126) explicitly reads only from `config.features`:

```typescript
const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
  string,
  Record<string, unknown>
>;
const featureIds = Object.keys(rawFeatures);
```

Since `prebuildFeatures` lives under `customizations.lace`, it is never included in `featureIds`. The gate at line 133 (`if (featureIds.length > 0)`) skips the entire metadata/port pipeline when there are no top-level features.

The lace devcontainer demonstrates the current workaround: wezterm-server is in `features` (not `prebuildFeatures`) with a comment explaining the constraint. This works but is a hidden requirement that causes silent failures for anyone who does not know the rule.

### The two devcontainer configs

**Lace devcontainer** (working correctly):
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/devcontainers/features/git:1": {},
      "ghcr.io/devcontainers/features/sshd:1": {}
    }
  }
},
"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"],
"features": {
  "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
    "version": "20240203-110809-5046fc22"
  }
}
```

**Dotfiles devcontainer** (broken -- zero port bindings):
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/devcontainers/features/git:1": {},
      "ghcr.io/devcontainers/features/sshd:1": {},
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        "version": "20240203-110809-5046fc22"
      }
    }
  }
}
```

## Proposed Solution

### Core change: Unified feature collection for the port pipeline

Introduce a helper function `collectAllFeatures()` that merges features from both `config.features` and `customizations.lace.prebuildFeatures` into a single map for the port pipeline. This unified collection is used for:

1. **Metadata fetching** -- fetch metadata for features in both blocks
2. **Auto-injection** -- inject `${lace.port()}` templates for port-declaring features in either block (symmetric for top-level features, asymmetric `appPort` for prebuild features)
3. **Template resolution** -- resolve `${lace.port()}` expressions referencing features from either block
4. **Feature-ID validation** -- accept feature short IDs from either block when validating `${lace.port(featureId/optionName)}` labels

The unified collection is NOT used for:
- **Prebuild extraction** -- unchanged, still reads only `prebuildFeatures`
- **`validateNoOverlap`** -- unchanged, still rejects features in both blocks
- **devcontainer CLI invocation** -- unchanged, the devcontainer CLI sees `features` and `prebuildFeatures` separately

### Pipeline modifications

#### Step 1: Feature ID collection (up.ts)

Replace the current `features`-only extraction:

```typescript
// BEFORE:
const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
  string, Record<string, unknown>
>;
const featureIds = Object.keys(rawFeatures);
```

With a unified collection that includes both blocks:

```typescript
const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
  string, Record<string, unknown>
>;

// Also collect prebuild features for port pipeline processing
const prebuildFeaturesResult = extractPrebuildFeatures(configMinimal.raw);
const rawPrebuildFeatures = prebuildFeaturesResult.kind === "features"
  ? prebuildFeaturesResult.features
  : {} as Record<string, Record<string, unknown>>;

// Unified feature set for the port pipeline (metadata + auto-injection + resolution)
const allRawFeatures = { ...rawFeatures, ...rawPrebuildFeatures };
const allFeatureIds = Object.keys(allRawFeatures);
```

Use `allFeatureIds` for the metadata fetch gate and `allRawFeatures` for metadata validation. Continue using `rawFeatures` for any logic that should only apply to top-level features (currently none in the port pipeline).

> NOTE: The spread `{ ...rawFeatures, ...rawPrebuildFeatures }` silently drops a prebuild entry if the same key exists in both. This is safe because `validateNoOverlap` runs in the prebuild pipeline (`prebuild.ts` line 101) and rejects configs with features in both blocks. Additionally, `buildFeatureIdMap` would detect short-ID collisions across blocks and throw. The merge is therefore guaranteed to be disjoint for valid configs.

#### Step 2: Auto-injection for prebuild features (template-resolver.ts)

Extend `autoInjectPortTemplates()` to also process `prebuildFeatures`, but with **different injection behavior** than top-level features.

**Key difference: prebuild features use asymmetric injection.** Because prebuild features are installed at image build time with their default option values (the devcontainer CLI does not reinstall them at runtime), the container port is fixed at the feature's default. Auto-injection for prebuild features must therefore:
1. NOT inject `${lace.port()}` into the feature's option value (the option is not consumed at runtime)
2. Instead, inject an asymmetric `appPort` entry: `${lace.port(featureId/optionName)}:DEFAULT_PORT`

The metadata provides the default value via `metadata.options[optionName].default`.

The implementation iterates over each block separately:

```typescript
export function autoInjectPortTemplates(
  config: Record<string, unknown>,
  metadataMap: Map<string, FeatureMetadata | null>,
): string[] {
  const features = (config.features ?? {}) as Record<
    string, Record<string, unknown>
  >;
  const prebuildFeatures = extractPrebuildFeaturesRaw(config);

  if (Object.keys(features).length === 0 &&
      Object.keys(prebuildFeatures).length === 0) return [];

  const injected: string[] = [];

  // Process top-level features: symmetric injection into feature options (existing behavior)
  injectForBlock(features, metadataMap, injected);

  // Process prebuild features: asymmetric injection into appPort
  injectForPrebuildBlock(config, prebuildFeatures, metadataMap, injected);

  return injected;
}

/** Symmetric injection for top-level features. Mutates the block in-place. */
function injectForBlock(
  block: Record<string, Record<string, unknown>>,
  metadataMap: Map<string, FeatureMetadata | null>,
  injected: string[],
): void {
  for (const [fullRef, featureOptions] of Object.entries(block)) {
    const shortId = extractFeatureShortId(fullRef);
    const metadata = metadataMap.get(fullRef);
    if (!metadata) continue;

    const laceCustom = extractLaceCustomizations(metadata);
    if (!laceCustom?.ports) continue;

    for (const optionName of Object.keys(laceCustom.ports)) {
      if (featureOptions && typeof featureOptions === "object"
          && optionName in featureOptions) continue;

      if (!block[fullRef] || typeof block[fullRef] !== "object") {
        block[fullRef] = {};
      }
      block[fullRef][optionName] =
        `\${lace.port(${shortId}/${optionName})}`;
      injected.push(`${shortId}/${optionName}`);
    }
  }
}

/** Asymmetric injection for prebuild features. Injects appPort entries, not feature options. */
function injectForPrebuildBlock(
  config: Record<string, unknown>,
  block: Record<string, Record<string, unknown>>,
  metadataMap: Map<string, FeatureMetadata | null>,
  injected: string[],
): void {
  for (const [fullRef, featureOptions] of Object.entries(block)) {
    const shortId = extractFeatureShortId(fullRef);
    const metadata = metadataMap.get(fullRef);
    if (!metadata) continue;

    const laceCustom = extractLaceCustomizations(metadata);
    if (!laceCustom?.ports) continue;

    for (const optionName of Object.keys(laceCustom.ports)) {
      // Skip if user has already provided an explicit value or template
      if (featureOptions && typeof featureOptions === "object"
          && optionName in featureOptions) continue;

      // Get the feature's default port value from metadata
      const defaultPort = metadata.options?.[optionName]?.default;
      if (!defaultPort) continue; // Cannot generate asymmetric mapping without default

      // Inject asymmetric appPort entry: ${lace.port(...)}:DEFAULT_PORT
      const appPort = (config.appPort ?? []) as (string | number)[];
      const template = `\${lace.port(${shortId}/${optionName})}:${defaultPort}`;
      appPort.push(template);
      config.appPort = appPort;

      injected.push(`${shortId}/${optionName}`);
    }
  }
}
```

For top-level features, behavior is unchanged: `${lace.port()}` is injected into the feature option, producing symmetric mapping. For prebuild features, the feature option is left untouched (it uses its default), and an asymmetric `appPort` entry is injected instead.

A small helper `extractPrebuildFeaturesRaw()` returns a direct reference to the `prebuildFeatures` object inside the config (not a copy), or an empty object if absent.

#### Step 3: Feature-ID map for resolution (template-resolver.ts)

Extend `resolveTemplates()` to build the feature-ID map from both blocks:

```typescript
export async function resolveTemplates(
  config: Record<string, unknown>,
  portAllocator: PortAllocator,
): Promise<TemplateResolutionResult> {
  const features = (config.features ?? {}) as Record<string, unknown>;
  const prebuildFeatures = extractPrebuildFeaturesRaw(config);
  const allFeatures = { ...features, ...prebuildFeatures };
  const featureIdMap = buildFeatureIdMap(allFeatures);
  // ... rest unchanged
}
```

This ensures that `resolvePortLabel()` can validate feature IDs that come from either block. Without this, a `${lace.port(wezterm-server/sshPort)}` template in `appPort` would fail validation if wezterm-server is only in `prebuildFeatures`.

#### Step 4: Diagnostic warning for prebuild port features with opted-out auto-injection

Add a new validation function `warnPrebuildPortFeaturesStaticPort()` that fires when:
1. A feature in `prebuildFeatures` declares `customizations.lace.ports` metadata
2. The user has set an explicit static value for the port option (opting out of auto-injection)
3. No `appPort` entry in the config references that feature's port label via `${lace.port()}`

This catches the specific case where a user places a port-declaring feature in `prebuildFeatures` with a static port value but no `appPort`, resulting in an internally-listening service with no host port mapping. The warning does NOT fire when auto-injection is active (no explicit value set) because auto-injection handles port allocation and entry generation automatically. The warning runs after auto-injection (Step 2) so it can check whether injection occurred.

Example trigger: `prebuildFeatures` has `wezterm-server` with `sshPort: "2222"` but no `appPort`. The warning says: `Feature "wezterm-server" in prebuildFeatures declares port "sshPort" but has a static value ("2222") and no appPort entry. The container will have no host port mapping for this port. Either remove the static value to enable auto-injection, or add an appPort entry.`

### Interaction with existing features

#### Prebuild features use asymmetric auto-injection

When wezterm-server is in `prebuildFeatures` with no explicit `sshPort` value, auto-injection inserts an asymmetric `appPort` entry: `"${lace.port(wezterm-server/sshPort)}:2222"` (where `2222` is the feature's default `sshPort` value from metadata). Template resolution replaces the template with a concrete host port (e.g., `"22430:2222"`).

This is asymmetric: host port 22430 maps to container port 2222. The container listens on 2222 because the prebuild image installed wezterm-server with the default `sshPort` value. The `generatePortEntries` function detects the user-provided (auto-injected) `appPort` entry and suppresses the symmetric auto-generated entry.

This differs from top-level features, which use symmetric injection (same port on host and container). The difference exists because top-level features are installed at runtime with the resolved port value, while prebuild features are installed at image build time with default values.

#### Explicit appPort templates referencing prebuild features

Users can write `"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]` even when wezterm-server is in `prebuildFeatures`. With the extended feature-ID map, template resolution will find wezterm-server in the prebuild block and resolve the template correctly. In this case, auto-injection detects the user's explicit `sshPort` value (or the pre-existing `appPort` template) and skips injection.

## Important Design Decisions

### D1: Unified collection rather than pipeline duplication

**Decision:** Merge features from both blocks into a single collection at the start of the port pipeline, rather than running two separate pipeline passes.

**Why:** The port pipeline (metadata fetch -> validation -> auto-injection -> template resolution -> port entry generation) is designed as a single pass over all features. Running it twice would risk duplicate port allocations, conflicting template resolutions, and double-generated port entries. A single unified collection preserves the pipeline's single-pass invariant while extending its input scope.

### D2: Prebuild auto-injection targets appPort, not feature options

**Decision:** For prebuild features, auto-injection writes an asymmetric `appPort` entry to the top-level `appPort` array rather than writing `${lace.port()}` into the feature's option value.

**Why:** Prebuild feature options are consumed at image build time (with defaults) and are not re-applied at runtime. Writing a `${lace.port()}` template into the feature option would resolve to a concrete port in the extended config, but the devcontainer CLI ignores prebuild feature options at runtime. The `appPort` array IS consumed at runtime and controls host-to-container port mapping. Injecting into `appPort` with asymmetric mapping (`host:default_container_port`) correctly bridges the lace-allocated host port to the feature's fixed default container port.

### D3: validateNoOverlap stays unchanged

**Decision:** Do not modify `validateNoOverlap()`. It continues to reject features that appear in both `features` and `prebuildFeatures`.

**Why:** The overlap validation prevents ambiguous build behavior: if a feature is in both blocks, it would be installed twice (once in the prebuild image, once at container creation). This is always a configuration error. The port pipeline unification is orthogonal -- it reads from both blocks but does not require features to appear in both.

### D4: Targeted diagnostic warning for static-port opt-out in prebuildFeatures

**Decision:** Emit a warning only when a port-declaring feature in `prebuildFeatures` has an explicit static port value AND no `appPort` template references it. Do not warn when auto-injection is active (the common case).

**Why:** When auto-injection is active, lace handles everything automatically -- there is nothing to warn about. The dangerous case is when the user opts out of auto-injection by providing a static port value (e.g., `sshPort: "2222"`) in `prebuildFeatures` but forgets to add an `appPort` entry. In that scenario, the feature installs with port 2222 internally but has no host binding, and the container is invisible. A warning at this specific point catches the misconfiguration without producing noise in the common auto-injection case.

### D5: Asymmetric auto-injection for prebuild features

**Decision:** Auto-injection for prebuild features produces asymmetric `appPort` entries (`host:container`) using the feature's default port value as the container port, rather than injecting `${lace.port()}` into the feature option.

**Why:** Prebuild features are installed at image build time with their default option values. The devcontainer CLI does not reinstall features that are already in the prebuild image. If we injected `${lace.port()}` into the feature option (as we do for top-level features), the resolved port (e.g., 22430) would appear in the extended config's `prebuildFeatures` block, but the devcontainer CLI would ignore it -- the feature is already installed with `sshPort: "2222"` in the image. A symmetric `appPort: ["22430:22430"]` would map to port 22430 inside the container where nothing is listening. Asymmetric injection correctly maps the lace-allocated host port to the feature's default container port.

### D6: No changes to the prebuild pipeline itself

**Decision:** The prebuild pipeline (`prebuild.ts`) continues to process `prebuildFeatures` exactly as before. It is not modified by this proposal.

**Why:** The prebuild pipeline reads the devcontainer.json from disk independently (via `readDevcontainerConfig(configPath)` in `prebuild.ts` line 70). It does NOT receive the in-memory `configForResolution` object from `up.ts`. Auto-injected values (the `appPort` entries) exist only in the in-memory clone used for template resolution -- they are never written back to disk. The prebuild therefore sees the user's original on-disk values and installs features with their default option values.

This is correct and intentional. The prebuild's job is to install features into a Docker image layer. Port-declaring features are installed with defaults (e.g., `sshPort: "2222"`). The runtime port mapping (which host port maps to the feature's default container port) is controlled by the extended config at `.lace/devcontainer.json`, which is generated from the resolved in-memory config and includes the auto-injected asymmetric `appPort` entries.

> NOTE: Since the prebuild pipeline reads from disk, port reassignment does NOT invalidate the prebuild cache. The prebuild context only changes when the user edits the on-disk config. This is desirable: port reassignment (a runtime concern) should not trigger a full image rebuild (a build-time operation).

## Edge Cases / Challenging Scenarios

### E1: Feature in prebuildFeatures with explicit static port value

**Config:**
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        "sshPort": "3333"
      }
    }
  }
}
```

**Behavior:** Auto-injection skips `sshPort` because the user provided an explicit value. No `${lace.port()}` template exists, so no port allocation occurs. No `appPort` is generated. The container listens on port 3333 internally but has no host port mapping. This is the same behavior as for top-level `features` with a static value -- the user has opted out of lace port management.

### E2: Feature in prebuildFeatures with explicit ${lace.port()} template in option

**Config:**
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        "sshPort": "${lace.port(wezterm-server/sshPort)}"
      }
    }
  }
}
```

**Behavior:** Auto-injection skips (user provided a value). Template resolution finds the template in the prebuild feature options and resolves it to a concrete port (e.g., 22430). Port entry generation creates symmetric `appPort: ["22430:22430"]`.

> NOTE: This is a user-authored misconfiguration for prebuild features. The resolved value (22430) appears in the extended config's `prebuildFeatures` block, but the devcontainer CLI does not apply it -- the feature was already installed in the prebuild image with the default port (2222). The container has sshd on port 2222 but the `appPort` maps `22430:22430`, which goes to an empty port. Users writing `${lace.port()}` in prebuild feature options should use the asymmetric `appPort` pattern (E3) instead. The existing `warnPrebuildPortTemplates()` warns about this case.

### E3: Feature in prebuildFeatures + explicit appPort referencing it

**Config:**
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        "sshPort": "2222"
      }
    }
  }
},
"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]
```

**Behavior:** Auto-injection skips `sshPort` (user set it to "2222"). Template resolution resolves `${lace.port(wezterm-server/sshPort)}` in `appPort` to a concrete port (e.g., 22430). Port entry generation sees the user's `appPort` entry (`22430:2222`) and suppresses the auto-generated symmetric entry. `forwardPorts` and `portsAttributes` are still generated. This is the asymmetric mapping pattern, identical to the current lace devcontainer behavior.

### E4: Feature short-ID collision across blocks

**Config:**
```jsonc
"features": {
  "ghcr.io/org-a/devcontainer-features/wezterm-server:1": {}
},
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/org-b/devcontainer-features/wezterm-server:2": {}
    }
  }
}
```

**Behavior:** `validateNoOverlap` does NOT catch this because the full feature identifiers differ (`org-a` vs `org-b`). However, `buildFeatureIdMap()` throws a feature-ID collision error because both features have the short ID `wezterm-server`. This is existing behavior for same-block collisions; the unified collection extends it across blocks. The error message directs the user to use a local feature wrapper to disambiguate.

### E5: No features in either block

**Behavior:** `allFeatureIds` is empty. The metadata pipeline is skipped entirely (existing behavior). No port allocation, no port entries. No change from current behavior.

### E6: Port-declaring feature only in prebuildFeatures, no appPort, no explicit sshPort

**Config:**
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
    }
  }
}
```

**Behavior (after this proposal):** Auto-injection detects that wezterm-server is in `prebuildFeatures` and uses asymmetric injection. It reads the default `sshPort` value (`"2222"`) from the feature metadata and injects `"${lace.port(wezterm-server/sshPort)}:2222"` into `appPort`. Template resolution replaces the template with a concrete port (e.g., `"22430:2222"`). Port entry generation sees the user-provided (auto-injected) asymmetric `appPort` and suppresses the symmetric entry. The container gets a port binding mapping host 22430 to container 2222. This is the primary fix this proposal targets -- the dotfiles devcontainer scenario.

### E7: prebuildFeatures with non-port-declaring features only

**Config:**
```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/devcontainers/features/git:1": {},
      "ghcr.io/devcontainers/features/sshd:1": {}
    }
  }
}
```

**Behavior:** Metadata is fetched for both features. Neither declares `customizations.lace.ports`, so no auto-injection, no template resolution, no port entries. Identical to current behavior (these features are processed through metadata validation but produce no port output).

### E8: Port reassignment does NOT invalidate prebuild cache

When a port-declaring feature is in `prebuildFeatures` and auto-injection is active, the auto-injected template value exists only in the in-memory `configForResolution` clone. The prebuild pipeline reads from the on-disk config, which has the user's original values (or no value, using defaults). Port reassignment (e.g., 22430 in use, reassigned to 22431) changes the in-memory resolved config and the generated `.lace/devcontainer.json`, but does NOT change the on-disk `devcontainer.json` or the prebuild context. The prebuild cache remains valid.

This is desirable: the prebuild image contains the installed feature software, which does not depend on the specific port number. The port is a runtime configuration applied by the devcontainer CLI when it starts the container with the extended config. Separating build-time caching from runtime port allocation is the core principle of this proposal.

## What NOT to Change

- **`validateNoOverlap()`** -- continues to reject features appearing in both blocks. The semantics of this validation are unchanged.
- **`runPrebuild()`** -- the prebuild pipeline continues to extract and build `prebuildFeatures` exactly as before. It reads from the on-disk config (not the in-memory resolved config), so it sees the user's original values and feature defaults.
- **`warnPrebuildPortTemplates()`** -- continues to warn about `${lace.port()}` expressions manually written in `prebuildFeatures` option values. After this proposal, such templates will actually resolve successfully (because the feature-ID map now includes prebuild features), but the warning remains useful: it alerts users that the template value applies at runtime via the extended config, not at prebuild time.
- **Port range (22425-22499)** -- unchanged.
- **`PortAllocator`** -- unchanged. It is label-based and block-agnostic.
- **Discovery tools (`lace-discover`, `wez-into`)** -- unchanged. They scan `docker ps` for port mappings; the fix is upstream (port entries now get generated correctly).
- **`generateExtendedConfig()`** -- unchanged. It receives allocations and generates port entries the same way regardless of which block the feature came from.

## Test Plan

### Unit tests: `template-resolver.test.ts`

#### T1: autoInjectPortTemplates with prebuild feature (new, asymmetric)

Config has wezterm-server in `prebuildFeatures` only, with metadata declaring `sshPort` (default: `"2222"`). Verify:
- Feature option is NOT modified (no `sshPort` injected into prebuild feature options)
- An asymmetric `appPort` entry is injected: `"${lace.port(wezterm-server/sshPort)}:2222"`
- Return value includes `"wezterm-server/sshPort"`

#### T2: autoInjectPortTemplates with prebuild feature, user-provided value (new)

Config has wezterm-server in `prebuildFeatures` with `sshPort: "3333"`. Verify:
- No injection occurs (user value takes precedence)
- Return value is empty

#### T3: autoInjectPortTemplates with features in both blocks (new)

Config has wezterm-server in `features` and git/sshd in `prebuildFeatures`. Only wezterm-server has port metadata. Verify:
- Injection only occurs for wezterm-server in `features`
- `prebuildFeatures` entries are scanned but produce no injection (no port metadata)

#### T4: resolveTemplates with prebuild feature in featureIdMap (new)

Config has `appPort: ["${lace.port(wezterm-server/sshPort)}:2222"]` and wezterm-server is only in `prebuildFeatures`. Verify:
- Template resolves successfully (feature found in unified map)
- Resolved port is in 22425-22499 range
- Allocation has label `wezterm-server/sshPort`

#### T5: resolveTemplates with prebuild feature auto-injected appPort (new, two-step)

Two-step test: first call `autoInjectPortTemplates` to inject the asymmetric `appPort` entry, then call `resolveTemplates` to resolve it. Config starts with wezterm-server in `prebuildFeatures` with no explicit `sshPort`. Verify:
- After auto-injection: `appPort` contains `"${lace.port(wezterm-server/sshPort)}:2222"`
- After resolution: `appPort` contains `"22430:2222"` (or similar resolved port)
- Allocation is produced (verify via `result.allocations`)

#### T6: buildFeatureIdMap collision across blocks (new)

Features map has wezterm-server from org-a, prebuild features has wezterm-server from org-b. Combined into one map. Verify:
- `buildFeatureIdMap` throws feature-ID collision error

#### T7: Existing autoInjectPortTemplates tests still pass (regression)

All existing tests for auto-injection with top-level `features` continue to pass without modification.

#### T8: Existing resolveTemplates tests still pass (regression)

All existing tests for template resolution with top-level `features` continue to pass.

### Integration tests: `up.integration.test.ts`

#### T9: Prebuild feature with ports -- full pipeline (new, asymmetric)

Config: wezterm-server in `prebuildFeatures` only, no top-level `features`, no explicit `appPort`. Mock metadata returns wezterm-server metadata with `sshPort` port declaration (default: `"2222"`). Verify:
- `result.exitCode === 0`
- `result.phases.portAssignment.port` is in lace range
- Generated `.lace/devcontainer.json` has `appPort` with **asymmetric** mapping (e.g., `"22430:2222"`)
- Generated config has `forwardPorts` and `portsAttributes`
- `port-assignments.json` is persisted
- Prebuild feature option `sshPort` is NOT present in the generated config (not injected)

#### T10: Prebuild feature with ports + explicit asymmetric appPort (new)

Config: wezterm-server in `prebuildFeatures` with `sshPort: "2222"`, `appPort: ["${lace.port(wezterm-server/sshPort)}:2222"]`. Verify:
- Template in `appPort` resolves correctly
- Generated config has asymmetric mapping (e.g., `22430:2222`)
- No duplicate symmetric entry
- `forwardPorts` and `portsAttributes` generated

#### T11: Prebuild feature without ports -- no allocation (new)

Config: git and sshd in `prebuildFeatures` only. Neither has port metadata. Verify:
- `result.phases.portAssignment.message` contains "No port templates found"
- No `appPort` in generated config

#### T12: Mixed blocks -- ports from both (new)

Config: wezterm-server in `features`, debug-proxy in `prebuildFeatures` (hypothetical feature with port metadata). Verify:
- Both features get port allocations
- Both get `appPort` entries
- Distinct ports allocated

#### T13: Existing integration tests still pass (regression)

All existing `up.integration.test.ts` tests continue to pass without modification.

### Validation tests: `validation.test.ts`

#### T14: validateNoOverlap unchanged (regression)

All existing `validateNoOverlap` tests pass. No new tests needed since the function is not modified.

## Implementation Phases

### Phase 1: Extract helper for prebuild features raw access

Add `extractPrebuildFeaturesRaw()` to `devcontainer.ts` (or `template-resolver.ts`) that returns the raw prebuild features object from a config, suitable for both reading and mutation. This is a small utility used by subsequent phases.

**Acceptance criteria:**
- Function returns `Record<string, Record<string, unknown>>` (empty object if no prebuild features)
- Handles all `PrebuildFeaturesResult` kinds correctly
- Unit test covers all kinds

### Phase 2: Unify feature collection in up.ts

Modify `runUp()` to collect features from both `features` and `prebuildFeatures` for the port pipeline. Pass the unified collection to metadata fetching and validation.

**Acceptance criteria:**
- `allFeatureIds` includes IDs from both blocks
- Metadata is fetched for features in both blocks
- Option validation runs for features in both blocks
- Port declaration validation runs for features in both blocks
- Existing tests (T13) still pass

### Phase 3: Extend autoInjectPortTemplates for prebuild features

Modify `autoInjectPortTemplates()` to scan both `features` and `prebuildFeatures` for port-declaring features. Auto-injected templates are written back to the originating block.

**Acceptance criteria:**
- Tests T1, T2, T3 pass
- Test T7 (regression) passes
- Template values written to correct block (not moved between blocks)

### Phase 4: Extend resolveTemplates feature-ID map

Modify `resolveTemplates()` to build `featureIdMap` from both blocks. This allows `resolvePortLabel()` to validate feature IDs from either block.

**Acceptance criteria:**
- Tests T4, T5, T6 pass
- Test T8 (regression) passes
- `resolvePortLabel` error message lists features from both blocks in "Available features"

### Phase 5: Add diagnostic warning for static-port prebuild features

Add `warnPrebuildPortFeaturesStaticPort()` that checks whether port-declaring features in `prebuildFeatures` have an explicit static port value but no `appPort` template referencing them. Integrate into `runUp()` after auto-injection (Step 2) so it can check which features had auto-injection applied.

**Acceptance criteria:**
- Warning emitted when: feature in `prebuildFeatures` declares ports, user set a static value (opting out of auto-injection), and no `appPort` entry references the feature
- No warning when auto-injection is active (no explicit value, template was injected)
- No warning when user provides both a static value and an explicit `appPort` with `${lace.port()}`
- Warning message tells user how to fix (either remove static value or add `appPort`)

### Phase 6: Integration tests

Add integration tests T9-T12 to `up.integration.test.ts`.

**Acceptance criteria:**
- All new tests pass
- All existing tests (T13, T14) pass
- End-to-end: config with wezterm-server in `prebuildFeatures` produces a generated config with port entries

### Phase 7: Fix dotfiles devcontainer.json (optional, downstream)

Update `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json` to either:
- Keep wezterm-server in `prebuildFeatures` (now works with this fix), or
- Move wezterm-server to `features` with explicit `appPort` (the current lace devcontainer pattern)

> NOTE: This is a downstream change in a different repository. It validates the fix but is not part of the lace codebase change.

**Acceptance criteria:**
- `lace up` in the dotfiles repo produces a container with port bindings
- `lace-discover` finds the dotfiles container
- `wez-into` can connect to the dotfiles container
