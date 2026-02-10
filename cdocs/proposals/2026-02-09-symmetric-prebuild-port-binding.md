---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T22:00:00-08:00
task_list: lace/dogfooding
type: proposal
state: archived
status: rejected
tags: [architecture, ports, prebuild, features, refactor, devcontainer, symmetric]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T23:15:00-08:00
  round: 2
revisions:
  - at: 2026-02-09T23:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Dropped feature promotion mechanism entirely -- it defeats the prebuild cache by re-running install.sh on every devcontainer up"
      - "Replaced promotion with containerPort metadata field in customizations.lace.ports: declares the actual container-side port for appPort generation"
      - "Symmetric injection now means: same ${lace.port()} template injection into feature options for BOTH blocks. appPort generation uses containerPort metadata to produce correct host:container mappings"
      - "Removed E7 multi-option analysis and conditional recommendation; replaced with single clear design using containerPort"
      - "Added D2 (containerPort metadata) and D3 (no feature promotion) design decisions"
      - "Updated E1 primary fix target to show containerPort-driven appPort generation"
      - "Updated test plan: replaced promotion tests (T6-T8) with containerPort metadata tests"
      - "Updated implementation phases: Phase 2 is now containerPort-aware appPort generation, not feature promotion"
references:
  - cdocs/proposals/2026-02-09-prebuild-features-port-support.md
  - cdocs/reviews/2026-02-09-review-of-prebuild-features-port-support-r2.md
  - cdocs/reviews/2026-02-09-review-of-prebuild-features-port-support-r3.md
  - cdocs/reviews/2026-02-09-review-of-symmetric-prebuild-port-binding.md
---

# Symmetric Prebuild Port Binding

> **NOTE (rejected):** This approach was rejected in favor of the asymmetric binding design implemented in the [prebuild-features-port-support proposal](2026-02-09-prebuild-features-port-support.md). Research confirmed that sshd ports are baked at install time and cannot be overridden at runtime for prebaked features. See the [wezterm-sshd-port-mechanics report](../reports/2026-02-09-wezterm-sshd-port-mechanics.md) for the full investigation.

> **BLUF:** The current prebuild features port support (implemented per the [prebuild-features-port-support proposal](../proposals/2026-02-09-prebuild-features-port-support.md)) uses asymmetric auto-injection: prebuild features get `appPort` entries like `"${lace.port(wezterm-server/sshPort)}:2222"` where the host port is a lace template but the container port is hardcoded to the feature's default. This creates divergent behavior between `features` and `prebuildFeatures` that the user must understand and debug. This proposal replaces asymmetric injection with **symmetric injection** -- the same `${lace.port()}` template injection into feature option values for both blocks. The container-side port for `appPort` generation comes from a new `containerPort` field in the feature's `customizations.lace.ports` metadata, removing the hardcoded default port assumption. No feature promotion is used; `install.sh` does not re-run; the prebuild cache is preserved. The symmetry is in the injection pattern (identical for both blocks), while the `appPort` generation uses metadata to produce correct `host:container` mappings that reflect the actual runtime port layout.

## Objective

Make prebuild features behave identically to top-level features from the **injection** perspective -- the same `${lace.port()}` template is written into the feature's option value regardless of which block the feature appears in. The `appPort` generation step uses feature metadata (specifically, a `containerPort` field) to produce correct port mappings for both blocks, without special-case asymmetric injection logic.

## Background

### The asymmetric design and why it was introduced

The [prebuild-features-port-support proposal](../proposals/2026-02-09-prebuild-features-port-support.md) introduced asymmetric injection after the [R2 review](../reviews/2026-02-09-review-of-prebuild-features-port-support-r2.md) identified that symmetric mapping is broken for prebuild features. The reasoning was:

1. Prebuild features are installed at image build time with default option values
2. The devcontainer CLI does not reinstall features that are already in the prebuild image
3. Therefore the container port is "fixed" at the default (e.g., 2222 for sshd)
4. A symmetric mapping `22430:22430` would map to container port 22430 where nothing is listening
5. An asymmetric mapping `22430:2222` correctly bridges to the fixed default

Points 1-4 are correct for features whose `install.sh` configures a service to listen on a specific port. Point 5 is the right fix for the `appPort` generation. However, the asymmetric design implemented this at the **injection** level (different code paths for `features` vs `prebuildFeatures`), when it should have been implemented at the **appPort generation** level (metadata-driven container port).

### The wezterm-server sshPort is metadata-only

Investigation of the wezterm-server feature's `install.sh` reveals:

```sh
VERSION="${VERSION:-20240203-110809-5046fc22}"
CREATERUNTIMEDIR="${CREATERUNTIMEDIR:-true}"
```

The `sshPort` option is **not referenced** in `install.sh`. It exists purely as metadata for lace's port pipeline -- a routing label for port allocation. The actual SSH listener port comes from the separate `ghcr.io/devcontainers/features/sshd:1` feature, which defaults to port 2222. The `sshPort` option tells lace "allocate a host port for wezterm SSH access" without configuring anything inside the container.

This means the container port (2222) is not derivable from the feature's option default alone. The feature metadata needs to explicitly declare what container port the service actually listens on.

### The upstream sshd feature

The upstream `ghcr.io/devcontainers/features/sshd:1` feature configures sshd to listen on port 2222 (its default) during `install.sh`. The port is baked into `/etc/ssh/sshd_config` via `sed` commands. The startup script starts the already-configured daemon. For prebuild features, this port is fixed at the default because `install.sh` runs at prebuild time, not at container start.

### How feature options become environment variables

Per the [devcontainer features specification](https://containers.dev/implementors/features/), feature options are converted to environment variables: `sshPort` becomes `SSHPORT`. These are sourced before `install.sh` runs. For wezterm-server, `SSHPORT` is set but never read by `install.sh`.

### R1 review findings

The [R1 review](../reviews/2026-02-09-review-of-symmetric-prebuild-port-binding.md) of the original version of this proposal identified two blocking issues:

1. **E7 / metadata-only port correctness**: Symmetric mapping `22430:22430` is non-functional because sshd listens on 2222, not 22430. The original proposal's fix (modifying `install.sh`) was classified as "optional" when it was actually a prerequisite.

2. **Feature promotion performance regression**: The original proposal promoted prebuild features to the `features` block, causing `install.sh` to re-run on every `devcontainer up`. For wezterm-server, this means re-downloading ~50MB of binaries from GitHub on every container build, defeating the purpose of prebuilding.

This revision addresses both issues by replacing feature promotion with metadata-driven `appPort` generation.

## Proposed Solution

### Core change: Symmetric injection + containerPort metadata

Two changes work together:

1. **Symmetric injection**: Replace `injectForPrebuildBlock()` with the same `injectForBlock()` used for top-level features. The `${lace.port()}` template is injected into the feature's option value for both blocks. This is the user's request: prebuild features should behave like normal features at the injection level.

2. **containerPort metadata**: Add a `containerPort` field to the `customizations.lace.ports` declaration in the feature's `devcontainer-feature.json`. This field declares the actual port that the service listens on inside the container. When generating `appPort` entries, the pipeline uses `containerPort` instead of assuming symmetric `port:port` mapping.

The `containerPort` field is optional. When absent, `appPort` generation defaults to symmetric mapping (same port on host and container), which is correct for top-level features where `install.sh` runs at container creation time and configures the service with the resolved port value. When present, `appPort` generation produces `host:containerPort` mapping, which is correct for prebuild features where the service port is fixed at the prebuild-time default.

### The containerPort metadata field

The wezterm-server feature's `devcontainer-feature.json` adds `containerPort` to the existing `customizations.lace.ports` declaration:

```json
{
  "options": {
    "sshPort": {
      "type": "string",
      "default": "2222",
      "description": "SSH port for wezterm-mux-server access."
    }
  },
  "customizations": {
    "lace": {
      "ports": {
        "sshPort": {
          "label": "wezterm ssh",
          "onAutoForward": "silent",
          "requireLocalPort": true,
          "containerPort": 2222
        }
      }
    }
  }
}
```

The `containerPort` field means: "regardless of what host port lace allocates, the service inside the container listens on port 2222." This allows the pipeline to generate `appPort: ["22430:2222"]` without hardcoding the default in lace's injection logic.

### Why containerPort solves both blocking issues

1. **Correctness**: The `appPort` mapping is `host:containerPort`, which correctly routes to where the service actually listens. No need for feature promotion or `install.sh` re-runs.

2. **Performance**: No feature promotion means `install.sh` does not re-run. The prebuild cache is preserved. The only runtime cost is reading the metadata (already cached).

3. **Simplicity**: The injection code path is identical for both blocks. The divergence is only in `appPort` generation, which reads metadata rather than using special-case injection logic.

### Pipeline modifications

#### Step 1: Replace injectForPrebuildBlock with injectForBlock (template-resolver.ts)

Delete `injectForPrebuildBlock()` entirely. Modify `autoInjectPortTemplates()` to call `injectForBlock()` for both blocks:

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

  // Symmetric injection for both blocks
  injectForBlock(features, metadataMap, injected);
  injectForBlock(prebuildFeatures, metadataMap, injected);

  return injected;
}
```

The `${lace.port(wezterm-server/sshPort)}` template is now injected into the prebuild feature's `sshPort` option, just as it would be for a top-level feature. Template resolution replaces it with a concrete port (e.g., 22430). The resolved value appears in the extended config's `prebuildFeatures` block. The devcontainer CLI ignores it (the feature was already installed at prebuild time with default options), but that is fine -- the resolved value's purpose is port allocation and `appPort` generation, not feature configuration.

#### Step 2: containerPort-aware appPort generation (template-resolver.ts)

Modify `generatePortEntries()` to check for `containerPort` in the feature's port metadata when generating `appPort` entries:

```typescript
export function generatePortEntries(
  resolvedConfig: Record<string, unknown>,
  allocations: PortAllocation[],
  featurePortMetadata: Map<string, FeaturePortDeclaration> | null,
): AutoGeneratedPortEntries {
  const result: AutoGeneratedPortEntries = {
    appPort: [],
    forwardPorts: [],
    portsAttributes: {},
  };

  const userAppPort = (resolvedConfig.appPort ?? []) as (string | number)[];
  const userForwardPorts = (resolvedConfig.forwardPorts ?? []) as number[];
  const userPortsAttributes = (resolvedConfig.portsAttributes ?? {}) as Record<
    string, unknown
  >;

  for (const alloc of allocations) {
    const portStr = String(alloc.port);

    // Determine the container port: use containerPort from metadata if available,
    // otherwise default to the allocated port (symmetric mapping)
    const featureMeta = featurePortMetadata?.get(alloc.label);
    const containerPort = featureMeta?.containerPort ?? alloc.port;

    // Suppression: check if user already has an appPort entry for this port
    const hasUserAppPort = userAppPort.some((entry) =>
      String(entry).startsWith(`${alloc.port}:`),
    );
    if (!hasUserAppPort) {
      result.appPort.push(`${alloc.port}:${containerPort}`);
    }

    // forwardPorts and portsAttributes use the host port (unchanged)
    const hasUserForwardPort = userForwardPorts.includes(alloc.port);
    if (!hasUserForwardPort) {
      result.forwardPorts.push(alloc.port);
    }

    if (!(portStr in userPortsAttributes)) {
      const attrs: PortAttributes = {
        label: featureMeta?.label
          ? `${featureMeta.label} (lace)`
          : `${alloc.label} (lace)`,
        requireLocalPort: featureMeta?.requireLocalPort ?? true,
      };
      if (featureMeta?.onAutoForward) {
        attrs.onAutoForward = featureMeta.onAutoForward;
      }
      result.portsAttributes[portStr] = attrs;
    }
  }

  return result;
}
```

The key change is one line: `const containerPort = featureMeta?.containerPort ?? alloc.port`. When `containerPort` is declared in the feature metadata, the `appPort` entry uses it as the container-side port. When absent, it defaults to the allocated port (symmetric mapping, same as before).

#### Step 3: Add containerPort to type definitions (port-allocator.ts / feature-metadata.ts)

Add `containerPort` to the `LacePortDeclaration` type:

```typescript
export interface LacePortDeclaration {
  label?: string;
  onAutoForward?: "silent" | "notify" | "openBrowser" | "openPreview" | "ignore";
  requireLocalPort?: boolean;
  protocol?: "http" | "https";
  containerPort?: number;  // NEW: actual port the service listens on inside the container
}
```

Add `containerPort` to the `FeaturePortDeclaration` type:

```typescript
export interface FeaturePortDeclaration {
  label?: string;
  requireLocalPort?: boolean;
  onAutoForward?: string;
  containerPort?: number;  // NEW
}
```

Update `extractLaceCustomizations()` in `feature-metadata.ts` to parse the new field:

```typescript
validatedPorts[key] = {
  label: typeof entry.label === "string" ? entry.label : undefined,
  onAutoForward: isValidAutoForward(entry.onAutoForward)
    ? entry.onAutoForward
    : undefined,
  requireLocalPort:
    typeof entry.requireLocalPort === "boolean"
      ? entry.requireLocalPort
      : undefined,
  protocol: isValidProtocol(entry.protocol) ? entry.protocol : undefined,
  containerPort:
    typeof entry.containerPort === "number"
      ? entry.containerPort
      : undefined,
};
```

Update `buildFeaturePortMetadata()` in `template-resolver.ts` to propagate `containerPort`:

```typescript
const entry: FeaturePortDeclaration = {
  label: decl.label,
  requireLocalPort: decl.requireLocalPort,
  containerPort: decl.containerPort,  // NEW
};
```

#### Step 4: Remove warnPrebuildPortFeaturesStaticPort (template-resolver.ts)

Remove the asymmetric-specific diagnostic warning. With symmetric injection, prebuild features behave identically to top-level features from the injection perspective. The warning about static port values in prebuild features is no longer a special case -- it is the same as for top-level features.

#### Step 5: Update warnPrebuildPortTemplates (template-resolver.ts)

With symmetric injection, auto-injected `${lace.port()}` templates in `prebuildFeatures` ARE resolved to concrete values. The resolved value is used for port allocation and `appPort` generation but is NOT consumed by the devcontainer CLI (the feature was already installed at prebuild time). Change the warning to an informational note:

```
Feature "${shortId}" in prebuildFeatures has port option "${optionName}" with a resolved value.
The resolved value is used for port allocation and appPort generation. The feature was installed
at prebuild time with its default value; the devcontainer CLI does not re-apply this option.
```

This warning only fires for user-authored `${lace.port()}` templates in prebuild features (not for auto-injected ones, which are expected).

#### Step 6: Remove injectForPrebuildBlock from up.ts imports

Update `up.ts` to remove the import of `warnPrebuildPortFeaturesStaticPort` and the associated call in `runUp()`.

### Interaction with validateNoOverlap

Unchanged. `validateNoOverlap()` continues to reject features in both blocks. No feature promotion means no overlap in the extended config.

### Interaction with prebuild cache

The prebuild cache is fully preserved. No features are promoted to the `features` block. No `install.sh` re-runs occur. The only change is that the resolved `prebuildFeatures` option values in the extended config contain concrete port numbers instead of templates, but the devcontainer CLI ignores these (it only processes top-level `features`).

### How this works end-to-end

Given this config:

```jsonc
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/devcontainers/features/sshd:1": {},
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
    }
  }
}
```

And wezterm-server metadata with `containerPort: 2222`:

1. **Auto-injection**: `sshPort: "${lace.port(wezterm-server/sshPort)}"` injected into the prebuild feature's options (symmetric, same as for top-level features)
2. **Template resolution**: Resolved to `sshPort: 22430`
3. **Port entry generation**: `containerPort: 2222` from metadata produces `appPort: ["22430:2222"]` (NOT `22430:22430`)
4. **Extended config**: Written to `.lace/devcontainer.json` with the resolved config + generated port entries
5. **devcontainer up**: Uses extended config. sshd (prebaked with default port 2222) listens on 2222. `appPort` maps host 22430 to container 2222. Connection works.

The injection is symmetric (same `${lace.port()}` pattern in both blocks). The `appPort` generation is metadata-driven (uses `containerPort` from the feature's declaration). No divergent code paths. No feature promotion. No `install.sh` re-runs.

## Important Design Decisions

### D1: Symmetric injection over asymmetric injection

**Decision:** Replace the asymmetric `injectForPrebuildBlock()` with the standard symmetric `injectForBlock()` for both feature blocks.

**Why:** The user's feedback is clear: "prebuild features should behave like normal features." Asymmetric injection requires maintaining two code paths (`injectForBlock` and `injectForPrebuildBlock`) with different semantics. Symmetric injection uses one code path for both, with the container port divergence handled entirely in `appPort` generation via metadata. This is simpler, more testable, and matches the user's mental model.

### D2: containerPort metadata field instead of feature promotion

**Decision:** Add a `containerPort` field to `customizations.lace.ports` metadata. Use it in `generatePortEntries()` to determine the container-side port for `appPort` entries. Do NOT promote prebuild features to the `features` block.

**Why:** Feature promotion (the R1 approach) defeats the prebuild cache by re-running `install.sh` on every `devcontainer up`. For wezterm-server, this means a network fetch of ~50MB on every container build. The `containerPort` metadata field achieves the same result (correct `appPort` mapping) without any runtime cost. The feature author declares "my service listens on port X inside the container" once, and lace uses that declaration to generate correct port mappings.

The `containerPort` field is also more general: it works for any feature where the container port differs from the host port, not just prebuild features. A top-level feature could also declare `containerPort` if its service listens on a fixed port regardless of the option value.

### D3: containerPort is optional, defaults to symmetric

**Decision:** When `containerPort` is not declared in the feature's metadata, `appPort` generation defaults to symmetric mapping (`host:host`).

**Why:** This preserves backward compatibility. Existing features without `containerPort` get the same behavior as before (symmetric mapping). Features that declare `containerPort` get the correct asymmetric mapping. The default (symmetric) is correct for top-level features where `install.sh` configures the service with the resolved port value.

### D4: Resolved prebuild option values are non-functional by design

**Decision:** The resolved port value in `prebuildFeatures` (e.g., `sshPort: 22430`) is deliberately non-functional -- the devcontainer CLI does not re-apply it. This is documented and expected.

**Why:** The resolved value serves two purposes: (1) port allocation (the `PortAllocator` assigns a port for the label `wezterm-server/sshPort`) and (2) `appPort` generation (the allocated port appears in `appPort` entries). It does NOT configure the service inside the container. The service was configured at prebuild time with the default port. This separation of concerns is intentional: the prebuild fixes the container-side service configuration, and lace manages the host-side port mapping.

### D5: No changes to validateNoOverlap or the prebuild pipeline

**Decision:** `validateNoOverlap()` and `runPrebuild()` are unchanged.

**Why:** No features are moved between blocks. The extended config does not contain promoted features. The prebuild pipeline reads from disk and produces the same output as before.

### D6: warnPrebuildPortTemplates becomes informational

**Decision:** The warning about `${lace.port()}` in prebuild feature options changes from "will not be resolved" to an informational note explaining that the resolved value is used for port allocation, not service configuration.

**Why:** With symmetric injection, the templates ARE resolved. The warning's purpose shifts from "this is broken" to "this is by design -- here is what the resolved value does."

## Edge Cases / Challenging Scenarios

### E1: Feature in prebuildFeatures only, no explicit options (primary fix target)

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

**Behavior:** Auto-injection injects `sshPort: "${lace.port(wezterm-server/sshPort)}"` into the prebuild feature's options (symmetric, identical to top-level features). Template resolution resolves to `sshPort: 22430`. `generatePortEntries` reads `containerPort: 2222` from the feature metadata and creates `appPort: ["22430:2222"]`. The extended config has the resolved prebuild feature options (ignored by devcontainer CLI) and the generated port entries (consumed by devcontainer CLI). sshd (prebaked at port 2222) is reachable at host port 22430. No `install.sh` re-run. No feature promotion.

### E2: Feature in prebuildFeatures with explicit static port value

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

**Behavior:** Auto-injection skips `sshPort` (user provided a value). No `${lace.port()}` template, no port allocation. No auto-generated `appPort`. The user has opted out of lace port management. This is identical to the behavior for static values in top-level `features`.

### E3: Feature in prebuildFeatures with explicit ${lace.port()} in option

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

**Behavior:** Auto-injection skips (user provided a value). Template resolution resolves the template to a concrete port (e.g., 22430). Port entry generation produces `appPort: ["22430:2222"]` using `containerPort` from metadata. The informational warning notes that the resolved value is used for port allocation, not service configuration.

### E4: Feature in prebuildFeatures + explicit appPort

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

**Behavior:** Auto-injection skips (user set sshPort). Template resolution resolves `appPort` template to `22430:2222`. `generatePortEntries` sees the user's resolved `appPort` entry (`22430:2222` starts with `22430:`) and suppresses auto-generation. The user's explicit mapping takes precedence. This is the current lace devcontainer pattern and continues to work.

### E5: Feature short-ID collision across blocks

**Behavior:** Unchanged. `buildFeatureIdMap()` throws a collision error. `validateNoOverlap()` catches same-feature-in-both-blocks.

### E6: Top-level feature without containerPort

**Config:**
```jsonc
"features": {
  "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
}
```

**Behavior:** Auto-injection injects `sshPort: "${lace.port(wezterm-server/sshPort)}"`. Resolution produces `sshPort: 22430`. Since the feature is in top-level `features`, `install.sh` runs at container creation with `SSHPORT=22430` (though wezterm-server's script ignores it). `generatePortEntries` checks `containerPort` from metadata: if present (2222), generates `appPort: ["22430:2222"]`. If absent, generates symmetric `appPort: ["22430:22430"]`.

This means `containerPort` is relevant for top-level features too, not just prebuild features. For wezterm-server specifically, `containerPort: 2222` is always correct because the sshd feature (which configures the actual listener) defaults to 2222 regardless of where wezterm-server is placed.

### E7: Feature without containerPort in metadata (backward compatibility)

**Behavior:** `containerPort` defaults to `undefined`. `generatePortEntries` uses `alloc.port` as the container port (symmetric mapping). This is identical to the current behavior for all existing features. No breaking change.

### E8: Port reassignment does not invalidate prebuild cache

Unchanged from the asymmetric design. The prebuild reads from disk, sees default options, and caches based on that. Port reassignment only affects the extended config.

### E9: containerPort vs option default

**Concern:** Should `containerPort` always match the feature option's `default` value?

**Analysis:** Not necessarily. `containerPort` declares what the service actually listens on inside the container. The option's `default` declares the default value for the option. For wezterm-server, these happen to be the same (both 2222), but they are semantically different:

- `default`: "If the user does not provide a value, this is what the option is set to"
- `containerPort`: "This is the port the service listens on inside the container"

For a hypothetical feature that uses a fixed internal port regardless of the option value (e.g., an internal proxy that always listens on 8080 and forwards to the user-specified port), `containerPort` would be 8080 while `default` might be something else entirely.

## What NOT to Change

- **`validateNoOverlap()`** -- continues to reject features in both blocks of the user's config.
- **`runPrebuild()`** -- the prebuild pipeline is unchanged.
- **Port range (22425-22499)** -- unchanged.
- **`PortAllocator`** -- unchanged. Label-based and block-agnostic.
- **Discovery tools** -- unchanged.
- **`resolveTemplates()`** -- unchanged. Already builds the feature-ID map from both blocks.
- **`buildFeatureIdMap()`** -- unchanged.
- **`mergePortEntries()`** -- unchanged.

## Test Plan

### Unit tests: `template-resolver.test.ts`

#### T1: autoInjectPortTemplates with prebuild feature -- symmetric injection (modified)

Config has wezterm-server in `prebuildFeatures` only, with metadata declaring `sshPort` (default: `"2222"`). Verify:
- Feature option IS modified: `sshPort` is set to `"${lace.port(wezterm-server/sshPort)}"`
- No `appPort` entry is injected (unlike asymmetric design)
- Return value includes `"wezterm-server/sshPort"`

#### T2: autoInjectPortTemplates with prebuild feature, user-provided value (unchanged)

Config has wezterm-server in `prebuildFeatures` with `sshPort: "3333"`. Verify:
- No injection occurs (user value takes precedence)
- Return value is empty

#### T3: autoInjectPortTemplates with features in both blocks (unchanged)

Config has wezterm-server in `features` and git/sshd in `prebuildFeatures`. Only wezterm-server has port metadata. Verify:
- Injection occurs for wezterm-server in `features` (symmetric)
- `prebuildFeatures` entries are scanned but produce no injection (no port metadata)

#### T4: resolveTemplates with prebuild feature -- symmetric resolution (modified)

Config has wezterm-server in `prebuildFeatures` with auto-injected `sshPort: "${lace.port(wezterm-server/sshPort)}"`. Verify:
- Template resolves successfully (feature found in unified map)
- Resolved port is in 22425-22499 range
- Feature option is updated to the resolved port number
- Allocation has label `wezterm-server/sshPort`

#### T5: resolveTemplates + autoInject two-step -- symmetric end-to-end (modified)

Two-step test: first call `autoInjectPortTemplates` to inject the symmetric template, then call `resolveTemplates` to resolve it. Config starts with wezterm-server in `prebuildFeatures` with no explicit `sshPort`. Verify:
- After auto-injection: prebuild feature option `sshPort` is `"${lace.port(wezterm-server/sshPort)}"`
- After resolution: prebuild feature option `sshPort` is a concrete port (e.g., 22430)
- No `appPort` entries were injected by auto-injection

#### T6: generatePortEntries with containerPort metadata (new)

Allocations include `wezterm-server/sshPort: 22430`. Feature port metadata has `containerPort: 2222`. No user `appPort`. Verify:
- Generated `appPort` is `["22430:2222"]` (NOT `["22430:22430"]`)
- Generated `forwardPorts` is `[22430]`
- Generated `portsAttributes` has entry for `"22430"`

#### T7: generatePortEntries without containerPort metadata -- symmetric default (new)

Allocations include `debug-proxy/debugPort: 22431`. Feature port metadata has no `containerPort`. No user `appPort`. Verify:
- Generated `appPort` is `["22431:22431"]` (symmetric, backward compatible)
- Generated `forwardPorts` is `[22431]`

#### T8: generatePortEntries with containerPort and user appPort -- suppression (new)

Allocations include `wezterm-server/sshPort: 22430`. Feature port metadata has `containerPort: 2222`. User has `appPort: ["22430:2222"]`. Verify:
- No auto-generated `appPort` entry (user's entry takes precedence)
- `forwardPorts` and `portsAttributes` still generated

#### T9: buildFeatureIdMap collision across blocks (unchanged)

Features map has wezterm-server from org-a, prebuild features has wezterm-server from org-b. Verify:
- `buildFeatureIdMap` throws feature-ID collision error

#### T10: extractLaceCustomizations parses containerPort (new)

Feature metadata has `customizations.lace.ports.sshPort.containerPort: 2222`. Verify:
- `extractLaceCustomizations` returns `{ ports: { sshPort: { ..., containerPort: 2222 } } }`

#### T11: extractLaceCustomizations ignores invalid containerPort (new)

Feature metadata has `customizations.lace.ports.sshPort.containerPort: "not-a-number"`. Verify:
- `containerPort` is `undefined` in the result (falls back to symmetric default)

#### T12: buildFeaturePortMetadata propagates containerPort (new)

Metadata map has wezterm-server with `containerPort: 2222`. Verify:
- `buildFeaturePortMetadata` returns a map with `wezterm-server/sshPort` having `containerPort: 2222`

#### T13: Existing autoInjectPortTemplates tests -- regression (modified expectations)

All existing tests for auto-injection with top-level `features` continue to pass. Tests that verified asymmetric `appPort` injection for prebuild features are updated to verify symmetric option injection instead.

#### T14: Existing resolveTemplates tests -- regression

All existing tests for template resolution continue to pass.

#### T15: Existing generatePortEntries tests -- regression

All existing tests for port entry generation continue to pass (symmetric default when no `containerPort`).

### Integration tests: `up.integration.test.ts`

#### T16: Prebuild feature with ports + containerPort -- full pipeline (new)

Config: wezterm-server in `prebuildFeatures` only, no top-level `features`, no explicit `appPort`. Mock metadata returns wezterm-server metadata with `sshPort` port declaration and `containerPort: 2222`. Verify:
- `result.exitCode === 0`
- `result.phases.portAssignment.port` is in lace range
- Generated `.lace/devcontainer.json` has `appPort` with mapping `"22430:2222"`
- Generated config has `forwardPorts` and `portsAttributes`
- wezterm-server does NOT appear in the `features` block (no promotion)
- Prebuild feature's resolved `sshPort` in `prebuildFeatures` block is the allocated port

#### T17: Prebuild feature with explicit asymmetric appPort -- user override (unchanged)

Config: wezterm-server in `prebuildFeatures` with `sshPort: "2222"`, `appPort: ["${lace.port(wezterm-server/sshPort)}:2222"]`. Verify:
- Template in `appPort` resolves correctly
- Generated config has asymmetric mapping (e.g., `22430:2222`)
- No duplicate entry from auto-generation

#### T18: Prebuild feature without ports -- no allocation (unchanged)

Config: git and sshd in `prebuildFeatures` only. Neither has port metadata. Verify:
- No port allocation
- No `appPort` in generated config

#### T19: Mixed blocks -- ports from both with containerPort (new)

Config: wezterm-server in `features`, debug-proxy in `prebuildFeatures` (with port metadata and `containerPort: 9229`). Verify:
- Both features get port allocations
- wezterm-server `appPort` uses `containerPort` from metadata (if declared) or symmetric
- debug-proxy `appPort` is `"22431:9229"` (uses containerPort from metadata)
- Distinct ports allocated
- debug-proxy is NOT promoted to `features`

#### T20: Existing integration tests -- regression

All existing `up.integration.test.ts` tests continue to pass.

### Validation tests

#### T21: validateNoOverlap unchanged -- regression

All existing `validateNoOverlap` tests pass.

## Implementation Phases

### Phase 1: Add containerPort to type definitions and parsing

Add `containerPort` to `LacePortDeclaration`, `FeaturePortDeclaration`, `extractLaceCustomizations()`, and `buildFeaturePortMetadata()`.

**Acceptance criteria:**
- Tests T10, T11, T12 pass
- Type definitions compile
- `containerPort` is correctly parsed from metadata and propagated through the pipeline

### Phase 2: containerPort-aware appPort generation

Modify `generatePortEntries()` to use `containerPort` from feature port metadata when generating `appPort` entries.

**Acceptance criteria:**
- Tests T6, T7, T8 pass
- Tests T15 (regression) pass
- Features with `containerPort` get asymmetric `appPort` entries
- Features without `containerPort` get symmetric `appPort` entries (backward compatible)

### Phase 3: Symmetric injection for prebuild features

Replace `injectForPrebuildBlock()` with `injectForBlock()` for prebuild features. Remove `injectForPrebuildBlock()`. Remove `warnPrebuildPortFeaturesStaticPort()`.

**Acceptance criteria:**
- Tests T1, T2, T3, T5 pass
- Tests T13 (regression) pass with updated expectations
- `${lace.port()}` template is injected into prebuild feature option values
- No `appPort` entries are injected by auto-injection

### Phase 4: Update warnPrebuildPortTemplates

Modify the warning message to reflect that `${lace.port()}` in prebuild features IS now resolved, with an informational note about how the resolved value is used.

**Acceptance criteria:**
- Warning message updated
- Warning still fires for manually-authored `${lace.port()}` in prebuild feature options
- Warning text explains that the resolved value is used for port allocation and appPort generation, not service configuration

### Phase 5: Update wezterm-server feature metadata

Add `containerPort: 2222` to the wezterm-server feature's `devcontainer-feature.json`:

```json
"customizations": {
  "lace": {
    "ports": {
      "sshPort": {
        "label": "wezterm ssh",
        "onAutoForward": "silent",
        "requireLocalPort": true,
        "containerPort": 2222
      }
    }
  }
}
```

**Acceptance criteria:**
- Feature metadata includes `containerPort`
- Existing tests using wezterm-server metadata are updated to include `containerPort`
- `lace up` with the updated feature produces correct `appPort` entries

### Phase 6: Integration tests

Add integration tests T16-T20.

**Acceptance criteria:**
- All new tests pass
- All existing tests (T20, T21) pass
- End-to-end: config with wezterm-server in `prebuildFeatures` produces generated config with correct `appPort` mapping via `containerPort` metadata

### Phase 7: Update lace devcontainer.json (optional, downstream)

Once Phase 5 is complete, the lace devcontainer's `devcontainer.json` can optionally move wezterm-server to `prebuildFeatures`. Auto-injection + symmetric resolution + `containerPort`-driven `appPort` generation handles everything automatically.

**Before:**
```jsonc
"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"],
"features": {
  "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
    "version": "20240203-110809-5046fc22"
  }
}
```

**After:**
```jsonc
// appPort removed -- auto-generated by lace using containerPort metadata
"customizations": {
  "lace": {
    "prebuildFeatures": {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
        "version": "20240203-110809-5046fc22"
      }
    }
  }
}
```

**Acceptance criteria:**
- `lace up` produces a container with correct port bindings (22430:2222)
- `lace-discover` finds the container
- `wez-into` can connect to the container
