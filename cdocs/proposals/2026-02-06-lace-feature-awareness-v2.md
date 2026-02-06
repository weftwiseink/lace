---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T20:00:00-08:00
task_list: lace/feature-overhaul
type: proposal
state: live
status: review_ready
tags: [architecture, features, templating, ports, refactor, devcontainer-spec]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-06T23:50:00-08:00
  round: 4
revisions:
  - at: 2026-02-06T23:30:00-08:00
    by: "@claude-opus-4-6"
    summary: >
      Auto-injection redesign: lace now auto-injects ${lace.port()} templates
      for any feature option declared in customizations.lace.ports metadata,
      so users just declare the feature with no explicit port template. Added
      auto-injection pipeline step between metadata fetch and template resolution.
      Updated all examples to show minimal user config. Clarified override story:
      user-provided static value prevents auto-injection, explicit template is
      same as auto-injection. Updated code drafts, test scenarios, pipeline
      walkthrough, and design decisions references.
  - at: 2026-02-06T22:00:00-08:00
    by: "@claude-opus-4-6"
    summary: >
      Addressed user feedback: removed all lace.* template variables except
      lace.port(); limited portsAttributes to requireLocalPort and label only;
      added explanatory context for self-referential port pattern; dramatically
      expanded implementation plan with code snippets, type definitions,
      concrete test scenarios, pipeline walkthrough, and error case examples;
      referenced design decisions report for rationale.
supersedes:
  - cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md
references:
  - cdocs/reports/2026-02-06-feature-awareness-design-decisions.md
  - cdocs/reports/2026-02-06-port-provisioning-assessment.md
  - cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/proposals/2026-02-06-lace-feature-metadata-management.md
---

# Lace Feature Awareness v2

> **BLUF:** Replace lace's hardcoded wezterm port assignment with a metadata-driven port system. Features declare port options in `customizations.lace.ports` in their `devcontainer-feature.json`; lace reads this metadata and **auto-injects** `${lace.port(featureId/optionName)}` template expressions for those options, so users just declare the feature -- no explicit port template needed. Port allocation uses a symmetric model (same port on host and container), auto-generating `appPort`, `forwardPorts`, and `portsAttributes` (limited to `requireLocalPort` and `label`). Users can override with a static value to skip auto-injection, or write the template explicitly (same effect as auto-injection). `${lace.port()}` is the only template variable; future extensions are out of scope.

## Objective

Genericize lace's feature handling so that any devcontainer feature can consume dynamically allocated host-side ports by declaring port options in its metadata. Lace auto-injects `${lace.port(featureId/optionName)}` template expressions for declared port options, replacing the hardcoded wezterm port logic with a metadata-driven, label-based system. Users declare the feature; lace handles port allocation automatically.

## Background

Lace's `runUp()` unconditionally assigns a wezterm SSH port by scanning 22425-22499 and writing to `appPort`. This is hardcoded: the port range, container port (2222), and the assumption that every container needs an SSH port are all baked in. There is no mechanism for features to declare port needs, no template variable system, and no feature metadata awareness.

Research established three key findings: (1) dynamic port assignment is a genuine spec gap that no devcontainer idiom can fill ([port provisioning assessment](../reports/2026-02-06-port-provisioning-assessment.md)); (2) devcontainer features should be the behavioral extensibility unit, with lace limited to host-side orchestration ([architecture analysis](../reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md)); (3) feature metadata is available via `devcontainer features info manifest` with zero new dependencies ([manifest fetching report](../reports/2026-02-06-feature-manifest-fetching-options.md)).

For verbose rationale behind the design decisions in this proposal, see the companion [design decisions report](../reports/2026-02-06-feature-awareness-design-decisions.md).

## Proposed Solution

### Features declared in the standard `features` field

Lace-aware features go in the standard top-level `features` object, same as any other feature. There is no separate `customizations.lace.features` section and no "feature promotion" pipeline. See [design decision D3](../reports/2026-02-06-feature-awareness-design-decisions.md#d3-no-separate-customizationslacefeatures-section----features-declared-in-standard-features-field) for rationale.

**The user does not need to write any port template expression.** When a feature declares port options in its `customizations.lace.ports` metadata, lace auto-injects `${lace.port(featureId/optionName)}` for those options before template resolution. The user just declares the feature:

```jsonc
{
  "features": {
    // Just declare the feature -- no port options needed.
    // The wezterm-server feature declares "sshPort" in its
    // customizations.lace.ports metadata. Lace reads this metadata,
    // sees that sshPort is a lace-managed port, and auto-injects
    // ${lace.port(wezterm-server/sshPort)} as the option value.
    // Template resolution then replaces that with a concrete port
    // number (e.g., 22430). The feature receives sshPort=22430
    // and listens on that port inside the container.
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  }
}
```

**What happens under the hood:**

1. The wezterm-server feature's `devcontainer-feature.json` declares `options.sshPort` with a static default (e.g., `2222`) and `customizations.lace.ports.sshPort` marking it as a lace-managed port.
2. Lace fetches the feature's metadata, sees `customizations.lace.ports.sshPort`, and the user has not provided an explicit `sshPort` value.
3. Lace auto-injects `"sshPort": "${lace.port(wezterm-server/sshPort)}"` into the feature's options.
4. Template resolution allocates a port (e.g., 22430) and replaces the expression with that concrete number.
5. The feature receives `sshPort=22430` and listens on that port inside the container, instead of its default 2222.

**Users CAN override with a static value to skip auto-injection:**

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      // Explicit static value -- lace skips auto-injection for sshPort.
      // The feature uses 3333 directly, no lace port allocation.
      "sshPort": "3333"
    }
  }
}
```

**Users CAN also write the template explicitly (same effect as auto-injection):**

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      // Explicit template -- same effect as auto-injection.
      // Useful for documentation or when referencing a port label
      // from a different feature.
      "sshPort": "${lace.port(wezterm-server/sshPort)}"
    }
  }
}
```

### Template variable system

`${lace.port(featureId/optionName)}` is the only supported template expression. It is **auto-injected** for feature options declared in `customizations.lace.ports` metadata (users do not need to write it explicitly). It can also appear manually in any string value in devcontainer.json. Resolution applies to values only, not object keys. Spec-native `${localEnv:}` and `${containerEnv:}` pass through unchanged. Unknown `${lace.*}` expressions hard-fail.

| Variable | Resolves to | Source |
|----------|------------|--------|
| `${lace.port(featureId/optionName)}` | Available host port, stable per label | TCP scan + `.lace/port-assignments.json` |

Future template variables (e.g., host paths, container user) may be added as needs arise, but are out of scope for this proposal.

**Type coercion:** `${lace.port(...)}` resolves to an integer when it is the entire string value, and to a string when embedded. See [design decision D11](../reports/2026-02-06-feature-awareness-design-decisions.md#d11-type-coercion-for-laceport).

### Port labels: `featureId/optionName`

Port labels map 1:1 to feature option input names, namespaced by the feature's short ID. If the wezterm-server feature has an option called `sshPort`, the template is `${lace.port(wezterm-server/sshPort)}`.

The `featureId` portion is the last path segment of the feature reference, stripped of the version tag. For `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`, the featureId is `wezterm-server`. If two features in the same config share a short ID (different registries, same feature name), lace errors at template resolution time with a message naming both features and suggesting the user rename one via a local feature wrapper.

Lace validates that the option name portion (`sshPort`) exists in the feature's option schema. This requires feature metadata (see [dependency on feature metadata management](#dependency-feature-metadata-management)). Auto-injection uses this same label format: when a feature declares `customizations.lace.ports.sshPort`, lace auto-injects `${lace.port(wezterm-server/sshPort)}` for that option. If the featureId in a `${lace.port()}` call does not correspond to any feature in the config's `features` object, lace errors with a message listing the available featureIds.

**Guidance for feature authors:** Port options should be descriptively named (`sshPort`, `httpPort`, `debugPort`), not generically named (`port`). The option name appears in template expressions and port labels, serving as self-documentation.

### Symmetric port model

The allocated port is used on both sides of the Docker mapping. See [design decision D1](../reports/2026-02-06-feature-awareness-design-decisions.md#d1-symmetric-port-model----laceportfeatureidoptionname-allocates-a-single-port-used-on-both-host-and-container-sides) for full rationale.

1. `${lace.port(wezterm-server/sshPort)}` allocates port `22430`
2. The wezterm-server feature receives `"sshPort": 22430` and listens on 22430 inside the container
3. Lace generates `appPort: ["22430:22430"]` -- symmetric mapping
4. The host connects to `localhost:22430`

Default range: 22425-22499. Port availability is verified via TCP scan before assignment.

### Auto-generated port entries

For every allocated port, lace generates entries in three fields:

```jsonc
{
  // Docker-level -p binding (required -- devcontainer CLI doesn't implement forwardPorts)
  "appPort": ["22430:22430"],

  // VS Code / Codespaces forwarding (harmless if CLI ignores it)
  "forwardPorts": [22430],

  // Labeling and local port enforcement only
  "portsAttributes": {
    "22430": {
      "label": "wezterm ssh (lace)",
      "requireLocalPort": true
    }
  }
}
```

`portsAttributes` is limited to `requireLocalPort` and `label`. Other attributes (e.g., `onAutoForward`, `protocol`, `elevateIfNeeded`) are out of scope -- they can be added by the user in their own `portsAttributes` entries if needed. See [design decision D6](../reports/2026-02-06-feature-awareness-design-decisions.md#d6-lace-auto-generates-appport--forwardports--portsattributes) for why all three fields are needed.

**Suppression detection:** After template resolution, lace scans the resolved config for user-provided port entries referencing allocated port numbers. For any matched port, lace skips auto-generating that entry. This is a post-resolution scan on concrete values (e.g., does `appPort` contain `"22430:..."` for allocated port 22430?), not provenance tracking.

**Merge behavior:** Auto-generated entries merge with user-specified entries. User entries take precedence for the same port.

### Feature-level port declarations

Features declare port options in `customizations.lace.ports` within their `devcontainer-feature.json`. The key matches the option name. **This declaration serves two purposes:** (1) it triggers auto-injection of `${lace.port()}` templates for the option, and (2) it provides port attributes (label, requireLocalPort) for `portsAttributes` generation.

```jsonc
// In devcontainer-feature.json for wezterm-server feature
{
  "id": "wezterm-server",
  "options": {
    "sshPort": {
      "type": "string",
      "default": "2222",
      "description": "SSH port for wezterm mux server"
    }
  },
  "customizations": {
    "lace": {
      "ports": {
        // Declaring "sshPort" here tells lace:
        // 1. Auto-inject ${lace.port(wezterm-server/sshPort)} for the sshPort
        //    option unless the user provides an explicit value.
        // 2. Use the label "wezterm ssh" in generated portsAttributes.
        "sshPort": {
          "label": "wezterm ssh"
          // Only "label" and "requireLocalPort" are supported here.
          // Other portsAttributes (onAutoForward, protocol, etc.) are
          // configured by the user in their devcontainer.json if needed.
        }
      }
    }
  }
}
```

Lace reads this via feature metadata. When metadata is available, `customizations.lace.ports.sshPort` triggers auto-injection of the port template and applies the declared label to the generated `portsAttributes`. When metadata is unavailable (and `--skip-metadata-validation` is set), auto-injection does not occur -- the user must explicitly write the template expression or provide a static value.

**This field does NOT appear in the user's devcontainer.json.** Users override port behavior via standard devcontainer.json fields.

### Override story

By default, lace auto-injects `${lace.port()}` templates for any option declared in a feature's `customizations.lace.ports` metadata. Users override this behavior through standard devcontainer.json fields:

| Want to... | How |
|-----------|-----|
| Use a lace-allocated port (default) | Just declare the feature with `{}` -- auto-injection handles it |
| Use a fixed port number instead | Set the feature option to a literal value (prevents auto-injection) |
| Use an asymmetric mapping | Write your own `appPort` entry (can use `${lace.port(...)}` for the host side) |
| Change port attributes | Write your own `portsAttributes` entry for the port |
| Write the template explicitly | Set the option to `${lace.port(...)}` (same effect as auto-injection) |

**Key rule:** If the user provides ANY explicit value for a port option (whether a static number or a `${lace.port()}` template), lace does not auto-inject for that option. Auto-injection only applies to options the user has not set.

**Example -- asymmetric mapping:**

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "2222"
    }
  },
  // User provides custom appPort: lace-allocated host port, fixed container port
  "appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]
}
```

The user provided an explicit `"sshPort": "2222"`, so auto-injection is skipped for `sshPort`. Lace resolves `${lace.port(wezterm-server/sshPort)}` in `appPort` to `22430`, producing `"22430:2222"`. Since the user provided their own `appPort`, lace does not auto-generate a symmetric one. The feature receives `"sshPort": "2222"` (a literal), so the server listens on 2222 inside the container.

> NOTE: In asymmetric mode, the label `wezterm-server/sshPort` refers to the **host-side port allocation** (22430), not the container-side listener port (2222). Any other use of `${lace.port(wezterm-server/sshPort)}` elsewhere (e.g., in external tooling config) will resolve to 22430. This is intentional -- the label identifies the allocated host port. The container port is a feature-internal detail.

### Pipeline: `lace up` workflow

```
[current]  read config -> assign wezterm port -> prebuild -> resolve mounts -> generate config -> devcontainer up
[proposed] read config -> extract prebuild features -> fetch metadata -> auto-inject port templates -> resolve templates (entire config) -> resolve repos -> generate config -> devcontainer up
```

Key ordering details:

1. **Prebuild feature extraction happens BEFORE template resolution.** Prebuild features use their declared defaults (not lace-resolved values). The prebuild image should use a feature's default port (e.g., 2222); the runtime config overrides it with the lace-allocated port. See [design decision D8](../reports/2026-02-06-feature-awareness-design-decisions.md#d8-template-resolution-happens-before-prebuild-feature-extraction).

2. **Metadata fetch happens BEFORE auto-injection.** Feature metadata is required to know which options should receive auto-injected port templates.

3. **Auto-injection inserts `${lace.port()}` templates.** For each feature with `customizations.lace.ports` metadata, lace checks whether the user has provided an explicit value for each declared port option. If not, lace injects `"${lace.port(featureId/optionName)}"` as the option value. If the user has provided any value (static or template), auto-injection is skipped for that option.

4. **Template resolution processes the entire config.** All `${lace.port()}` expressions (both auto-injected and user-written) are replaced with concrete values. Port allocation happens as a side effect when `${lace.port()}` expressions are encountered.

5. **Auto-generation follows resolution.** After all templates are resolved, lace scans for user-provided port entries and generates `appPort`/`forwardPorts`/`portsAttributes` for ports not already covered.

### New modules

**`template-resolver.ts`** -- Two responsibilities: (1) auto-injects `${lace.port()}` templates for feature options declared in `customizations.lace.ports` metadata (unless the user provides an explicit value), and (2) walks the entire devcontainer.json replacing `${lace.port()}` patterns with concrete port numbers. Returns the resolved config + list of allocated ports.

**`port-allocator.ts`** -- Replaces `port-manager.ts`. Label-based, on-demand allocation with persistence in `.lace/port-assignments.json`. Generates symmetric `appPort`, `forwardPorts`, and `portsAttributes` entries.

**`feature-metadata.ts`** -- Fetches `devcontainer-feature.json` via `devcontainer features info manifest`. Two-tier cache. Required for auto-injection (reads `customizations.lace.ports`). Validates option names. (Implementation details in the [feature metadata management proposal](./2026-02-06-lace-feature-metadata-management.md).)

### <a name="dependency-feature-metadata-management"></a>Dependency: Feature Metadata Management

This proposal depends on a parallel [feature metadata management proposal](./2026-02-06-lace-feature-metadata-management.md) for:

- **Auto-injection:** Reading `customizations.lace.ports` from feature metadata to know which options should receive auto-injected `${lace.port()}` templates. This is the primary use case and requires metadata.
- **Option name validation:** Verifying that `sshPort` in `${lace.port(wezterm-server/sshPort)}` exists in the feature's option schema.
- **Port attribute enrichment:** Reading `customizations.lace.ports` from feature metadata for `portsAttributes` generation.
- **Unknown option warnings:** Alerting when a template targets a nonexistent option name.

Without metadata (when `--skip-metadata-validation` is set), auto-injection does not occur -- the user must explicitly write `${lace.port()}` templates or static values. Template resolution and port allocation still work for explicitly-written templates.

## Edge Cases

### No `${lace.port()}` templates in config and no `customizations.lace.ports` metadata
No auto-injection, no template resolution, no port allocation. Existing features pass through unchanged. Behavioral improvement over the current unconditional port scan.

### Feature has `customizations.lace.ports` but user provides explicit option value
Auto-injection is skipped for that option. The user's explicit value (whether a static number or a manually-written `${lace.port()}` template) is used as-is.

### `${lace.port()}` used outside feature options
Valid. `"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]` allocates a port and uses it in an asymmetric mapping. The port is tracked and auto-generates `portsAttributes` unless the user provides their own.

### Same label used in multiple locations
Same label always resolves to the same port. `${lace.port(wezterm-server/sshPort)}` in a feature option and in an `appPort` entry both resolve to the same number.

### All ports in range exhausted
Error message includes which labels have active assignments, helping identify stale assignments.

### Port previously assigned but now in use
Reassign to a new port, log warning with old and new numbers.

### Unknown template variable
`${lace.nonexistent}` hard-fails. Error message lists valid variable names (currently only `lace.port()`).

### Feature metadata unavailable
If `--skip-metadata-validation` is set, lace proceeds without metadata: auto-injection does not occur (user must write templates explicitly), port attributes default to `"<featureId/optionName> (lace)"` label and `requireLocalPort: true`. Warning logged. Without the flag, metadata fetch failure aborts `lace up`.

### User provides `portsAttributes` for an auto-generated port
User entry takes precedence.

### Local-path features
Features referenced as `./features/my-feature` work -- metadata is read directly from the filesystem, no registry fetch needed.

### Feature in both `features` and `prebuildFeatures`
Valid. The prebuild installs with default options; the runtime config carries resolved values. If the devcontainer CLI re-runs `install.sh` when options differ, the prebuild optimization is negated -- this needs investigation but is out of scope.

### `${lace.port()}` with featureId not in `features`
Error at template resolution time. The featureId must correspond to a feature declared in the config's `features` object. Error message lists available featureIds.

### FeatureId collision between two features
If two features in `features` share the same short ID (last path segment), lace errors at template resolution time before any `${lace.port()}` calls are processed. Error message names both features.

### `${lace.port()}` in `prebuildFeatures` option values
Not resolved. Prebuild extraction works on the original config before template resolution. If a user writes `${lace.port()}` in a `prebuildFeatures` option value, it will be passed through as a literal string to the prebuild system, which will likely fail. Lace should warn if `${lace.port()}` expressions appear in `prebuildFeatures` values.

### Backwards-compatibility bridge
During transition: if `.lace/port-assignments.json` or `.lace/devcontainer.json` with `appPort` entries exist from the legacy system, lace preserves those port mappings. Removed in Phase 3 cleanup.

## Type Definitions

### Core interfaces

```typescript
/** A single port allocation tracked by lace. */
interface PortAllocation {
  /** The label that identifies this allocation (e.g., "wezterm-server/sshPort"). */
  label: string;
  /** The allocated port number, used symmetrically on host and container. */
  port: number;
  /** ISO 8601 timestamp of when this allocation was first created. */
  assignedAt: string;
}

/** Persisted state in .lace/port-assignments.json. */
interface PortAssignmentsFile {
  /** Map from label to allocation details. */
  assignments: Record<string, PortAllocation>;
}

/** Result of resolving all templates in a devcontainer.json. */
interface TemplateResolutionResult {
  /** The config with all ${lace.port()} expressions replaced by concrete values. */
  resolvedConfig: Record<string, unknown>;
  /** All port allocations made during resolution (new and reused). */
  allocations: PortAllocation[];
  /** Warnings generated during resolution (e.g., metadata unavailable). */
  warnings: string[];
}
// Note: auto-injected labels are returned separately by autoInjectPortTemplates(),
// which runs before resolveTemplates(). They are not part of TemplateResolutionResult.

/** Auto-generated port entries to merge into the final config. */
interface AutoGeneratedPortEntries {
  /** Docker -p bindings: ["22430:22430", ...] */
  appPort: string[];
  /** VS Code forwarding: [22430, ...] */
  forwardPorts: number[];
  /** Port labels and behavior: { "22430": { label, requireLocalPort } } */
  portsAttributes: Record<string, PortAttributes>;
}

/** Attributes for a single port in portsAttributes. */
interface PortAttributes {
  /** Human-readable label for the port (e.g., "wezterm ssh (lace)"). */
  label: string;
  /** Whether to require the exact local port number (fail if unavailable). */
  requireLocalPort: boolean;
}

/** Port metadata declared by a feature in its devcontainer-feature.json. */
interface FeaturePortDeclaration {
  /** Display label for the port. Lace appends " (lace)" suffix. */
  label?: string;
  /** Whether to require the exact local port. Default: true. */
  requireLocalPort?: boolean;
}

/** Parsed result of extracting a featureId from a feature reference. */
interface ParsedFeatureRef {
  /** The full feature reference (e.g., "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"). */
  fullRef: string;
  /** The short ID extracted from the last path segment, version stripped (e.g., "wezterm-server"). */
  shortId: string;
}
```

## Implementation Plan

### Phase 1: Template resolver + port allocator

**New files:**
- `packages/lace/src/lib/template-resolver.ts`
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`
- `packages/lace/src/lib/port-allocator.ts`
- `packages/lace/src/lib/__tests__/port-allocator.test.ts`

**Modified files:**
- `packages/lace/src/lib/up.ts` -- replace Phase 0 (hardcoded port) with template resolution; update `generateExtendedConfig()` to handle auto-generated port entries; add backwards-compatibility bridge
- `packages/lace/src/lib/devcontainer.ts` -- if any extraction changes needed for the new model

**Do NOT modify:** `prebuild.ts`, `restore.ts`, `status.ts`, `resolve-mounts.ts`, `mounts.ts`, `plugin-clones.ts`, `settings.ts`

#### Template resolver implementation draft

```typescript
// template-resolver.ts

const LACE_PORT_PATTERN = /\$\{lace\.port\(([^)]+)\)\}/g;
const LACE_UNKNOWN_PATTERN = /\$\{lace\.(?!port\()([^}]+)\}/;

/**
 * Extract the short feature ID from a full feature reference.
 * "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1" -> "wezterm-server"
 * "./features/my-feature" -> "my-feature"
 */
export function extractFeatureShortId(featureRef: string): string {
  // Strip version tag (":1", ":latest", etc.)
  const withoutVersion = featureRef.replace(/:[\w.-]+$/, "");
  // Take last path segment
  const segments = withoutVersion.split("/");
  return segments[segments.length - 1];
}

/**
 * Build a map from short feature ID to full feature reference.
 * Errors if two features share the same short ID.
 */
export function buildFeatureIdMap(
  features: Record<string, unknown>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const fullRef of Object.keys(features)) {
    const shortId = extractFeatureShortId(fullRef);
    if (map.has(shortId)) {
      throw new Error(
        `Feature ID collision: "${shortId}" matches both ` +
        `"${map.get(shortId)}" and "${fullRef}". ` +
        `Rename one using a local feature wrapper to disambiguate.`
      );
    }
    map.set(shortId, fullRef);
  }
  return map;
}

/**
 * Auto-inject ${lace.port()} templates for feature options declared in
 * customizations.lace.ports metadata. Only injects for options the user
 * has NOT explicitly set.
 *
 * This modifies the config in-place before template resolution.
 *
 * Note: FeatureMetadata and extractLaceCustomizations are imported from
 * feature-metadata.ts (see the feature metadata management proposal).
 */
export function autoInjectPortTemplates(
  config: Record<string, unknown>,
  metadataMap: Map<string, FeatureMetadata | null>
): string[] {
  const features = (config.features ?? {}) as Record<string, Record<string, unknown>>;
  const featureIdMap = buildFeatureIdMap(features);
  const injected: string[] = [];

  for (const [fullRef, featureOptions] of Object.entries(features)) {
    const shortId = extractFeatureShortId(fullRef);
    const metadata = metadataMap.get(fullRef);
    if (!metadata) continue;

    const laceCustom = extractLaceCustomizations(metadata);
    if (!laceCustom?.ports) continue;

    for (const optionName of Object.keys(laceCustom.ports)) {
      // Skip if user has provided an explicit value for this option
      if (featureOptions && optionName in featureOptions) continue;

      // Auto-inject the template expression
      if (!featureOptions || typeof featureOptions !== "object") {
        // Feature was declared as {} or with other options -- ensure options object exists
        features[fullRef] = { ...featureOptions };
      }
      (features[fullRef] as Record<string, unknown>)[optionName] =
        `\${lace.port(${shortId}/${optionName})}`;
      injected.push(`${shortId}/${optionName}`);
    }
  }

  return injected;
}

/**
 * Resolve all ${lace.port()} expressions in the config.
 * Walks the entire config tree, replacing template expressions in string values.
 * Call autoInjectPortTemplates() BEFORE this function.
 */
export async function resolveTemplates(
  config: Record<string, unknown>,
  portAllocator: PortAllocator
): Promise<TemplateResolutionResult> {
  const features = (config.features ?? {}) as Record<string, unknown>;
  const featureIdMap = buildFeatureIdMap(features);
  const allocations: PortAllocation[] = [];
  const warnings: string[] = [];

  const resolvedConfig = await walkAndResolve(
    structuredClone(config),
    featureIdMap,
    portAllocator,
    allocations,
    warnings
  );

  return { resolvedConfig, allocations, warnings };
}

/**
 * Recursively walk a value, resolving template expressions in strings.
 */
async function walkAndResolve(
  value: unknown,
  featureIdMap: Map<string, string>,
  portAllocator: PortAllocator,
  allocations: PortAllocation[],
  warnings: string[]
): Promise<unknown> {
  if (typeof value === "string") {
    return resolveStringValue(value, featureIdMap, portAllocator, allocations);
  }
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) =>
        walkAndResolve(item, featureIdMap, portAllocator, allocations, warnings)
      )
    );
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = await walkAndResolve(
        obj[key], featureIdMap, portAllocator, allocations, warnings
      );
    }
    return obj;
  }
  // Non-string primitives (number, boolean, null) pass through unchanged
  return value;
}

/**
 * Resolve template expressions in a single string value.
 * Returns number if the entire string is a single ${lace.port()} expression (type coercion).
 * Returns string if the expression is embedded in a larger string.
 */
async function resolveStringValue(
  value: string,
  featureIdMap: Map<string, string>,
  portAllocator: PortAllocator,
  allocations: PortAllocation[]
): Promise<string | number> {
  // Check for unknown ${lace.*} expressions (anything that isn't lace.port(...))
  const unknownMatch = value.match(LACE_UNKNOWN_PATTERN);
  if (unknownMatch) {
    throw new Error(
      `Unknown template variable: \${lace.${unknownMatch[1]}}. ` +
      `The only supported template is \${lace.port(featureId/optionName)}.`
    );
  }

  // Skip strings with no lace templates
  if (!LACE_PORT_PATTERN.test(value)) {
    return value;
  }
  LACE_PORT_PATTERN.lastIndex = 0; // Reset regex state

  // Type coercion: if the entire string is one ${lace.port()} expression, return integer
  const fullMatch = value.match(/^\$\{lace\.port\(([^)]+)\)\}$/);
  if (fullMatch) {
    const label = fullMatch[1];
    const port = await resolvePortLabel(label, featureIdMap, portAllocator, allocations);
    return port; // integer
  }

  // Embedded: replace all ${lace.port()} expressions, return string
  let result = value;
  LACE_PORT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LACE_PORT_PATTERN.exec(value)) !== null) {
    const label = match[1];
    const port = await resolvePortLabel(label, featureIdMap, portAllocator, allocations);
    result = result.replace(match[0], String(port));
  }
  return result;
}

/**
 * Resolve a port label to a concrete port number.
 * Validates the featureId exists in the config.
 */
async function resolvePortLabel(
  label: string,
  featureIdMap: Map<string, string>,
  portAllocator: PortAllocator,
  allocations: PortAllocation[]
): Promise<number> {
  const parts = label.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid port label "${label}". Expected format: featureId/optionName`
    );
  }
  const [featureId, optionName] = parts;

  // Validate featureId exists in the config
  if (!featureIdMap.has(featureId)) {
    const available = Array.from(featureIdMap.keys()).join(", ");
    throw new Error(
      `Feature "${featureId}" not found in config. ` +
      `Available features: ${available}`
    );
  }

  // Allocate or reuse port for this label
  const allocation = await portAllocator.allocate(label);
  // Track allocation if not already tracked
  if (!allocations.find((a) => a.label === label)) {
    allocations.push(allocation);
  }
  return allocation.port;
}
```

#### Port allocator implementation draft

```typescript
// port-allocator.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPortAvailable, LACE_PORT_MIN, LACE_PORT_MAX } from "./port-manager";

export class PortAllocator {
  private assignments: Map<string, PortAllocation> = new Map();
  private persistPath: string;

  constructor(private workspaceFolder: string) {
    this.persistPath = join(workspaceFolder, ".lace", "port-assignments.json");
    this.load();
  }

  /** Load persisted assignments from disk. */
  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, "utf-8"));
      const file = raw as PortAssignmentsFile;
      for (const [label, alloc] of Object.entries(file.assignments ?? {})) {
        this.assignments.set(label, alloc);
      }
    } catch {
      // Corrupt file -- start fresh, will be overwritten on save
    }
  }

  /** Persist current assignments to disk. */
  save(): void {
    const dir = join(this.workspaceFolder, ".lace");
    mkdirSync(dir, { recursive: true });
    const file: PortAssignmentsFile = {
      assignments: Object.fromEntries(this.assignments),
    };
    writeFileSync(this.persistPath, JSON.stringify(file, null, 2) + "\n", "utf-8");
  }

  /** Allocate a port for a label. Reuses existing assignment if port is available. */
  async allocate(label: string): Promise<PortAllocation> {
    const existing = this.assignments.get(label);
    if (existing && (await isPortAvailable(existing.port))) {
      return existing;
    }

    if (existing) {
      console.warn(
        `Port ${existing.port} for "${label}" is in use, reassigning...`
      );
    }

    const port = await this.findAvailablePort();
    if (port === null) {
      const labels = Array.from(this.assignments.entries())
        .map(([l, a]) => `  ${l}: ${a.port}`)
        .join("\n");
      throw new Error(
        `All ports in range ${LACE_PORT_MIN}-${LACE_PORT_MAX} are in use.\n` +
        `Active assignments:\n${labels}`
      );
    }

    const allocation: PortAllocation = {
      label,
      port,
      assignedAt: new Date().toISOString(),
    };
    this.assignments.set(label, allocation);
    return allocation;
  }

  /** Find first available port in range, skipping already-assigned ports. */
  private async findAvailablePort(): Promise<number | null> {
    const usedPorts = new Set(
      Array.from(this.assignments.values()).map((a) => a.port)
    );
    for (let port = LACE_PORT_MIN; port <= LACE_PORT_MAX; port++) {
      if (usedPorts.has(port)) continue;
      if (await isPortAvailable(port)) return port;
    }
    return null;
  }

  /** Get all current allocations. */
  getAllocations(): PortAllocation[] {
    return Array.from(this.assignments.values());
  }
}
```

#### Suppression detection and auto-generation draft

```typescript
// In template-resolver.ts or a separate auto-generate.ts

/**
 * Detect which allocated ports the user has already provided entries for,
 * and generate entries for the remaining ports.
 */
export function generatePortEntries(
  resolvedConfig: Record<string, unknown>,
  allocations: PortAllocation[],
  featureMetadata: Map<string, FeaturePortDeclaration> | null
): AutoGeneratedPortEntries {
  const result: AutoGeneratedPortEntries = {
    appPort: [],
    forwardPorts: [],
    portsAttributes: {},
  };

  const userAppPort = (resolvedConfig.appPort ?? []) as (string | number)[];
  const userForwardPorts = (resolvedConfig.forwardPorts ?? []) as number[];
  const userPortsAttributes = (resolvedConfig.portsAttributes ?? {}) as Record<
    string,
    unknown
  >;

  for (const alloc of allocations) {
    const portStr = String(alloc.port);

    // Suppression: check if user already has an appPort entry for this port
    const hasUserAppPort = userAppPort.some((entry) =>
      String(entry).startsWith(`${alloc.port}:`)
    );
    if (!hasUserAppPort) {
      result.appPort.push(`${alloc.port}:${alloc.port}`);
    }

    // Suppression: check if user already has a forwardPorts entry
    const hasUserForwardPort = userForwardPorts.includes(alloc.port);
    if (!hasUserForwardPort) {
      result.forwardPorts.push(alloc.port);
    }

    // Suppression: check if user already has portsAttributes for this port
    if (!(portStr in userPortsAttributes)) {
      const featureMeta = featureMetadata?.get(alloc.label);
      result.portsAttributes[portStr] = {
        label: featureMeta?.label
          ? `${featureMeta.label} (lace)`
          : `${alloc.label} (lace)`,
        requireLocalPort: featureMeta?.requireLocalPort ?? true,
      };
    }
  }

  return result;
}

/**
 * Merge auto-generated port entries into the resolved config.
 */
export function mergePortEntries(
  config: Record<string, unknown>,
  generated: AutoGeneratedPortEntries
): Record<string, unknown> {
  const merged = { ...config };

  // Merge appPort
  if (generated.appPort.length > 0) {
    const existing = (merged.appPort ?? []) as string[];
    merged.appPort = [...existing, ...generated.appPort];
  }

  // Merge forwardPorts
  if (generated.forwardPorts.length > 0) {
    const existing = (merged.forwardPorts ?? []) as number[];
    merged.forwardPorts = [...existing, ...generated.forwardPorts];
  }

  // Merge portsAttributes
  if (Object.keys(generated.portsAttributes).length > 0) {
    const existing = (merged.portsAttributes ?? {}) as Record<string, unknown>;
    merged.portsAttributes = { ...existing, ...generated.portsAttributes };
  }

  return merged;
}
```

#### Integration into `up.ts` draft

```typescript
// Changes to up.ts -- Phase 0 replacement

// BEFORE (current): unconditional port assignment
// console.log("Assigning port for wezterm SSH server...");
// portResult = await assignPort(workspaceFolder);

// AFTER (proposed): metadata-driven auto-injection + template resolution
import {
  autoInjectPortTemplates,
  resolveTemplates,
  generatePortEntries,
  mergePortEntries,
} from "./template-resolver";
import { PortAllocator } from "./port-allocator";
import { fetchAllFeatureMetadata } from "./feature-metadata";

// In runUp(), replace Phase 0 with:

// Step 1: Fetch feature metadata (required for auto-injection)
console.log("Fetching feature metadata...");
const featureIds = Object.keys(configMinimal.raw.features ?? {});
const metadataMap = await fetchAllFeatureMetadata(featureIds, {
  noCache: cliFlags.noCache,
  skipValidation: cliFlags.skipMetadataValidation,
});

// Step 2: Auto-inject ${lace.port()} templates for declared port options
const configWithInjections = structuredClone(configMinimal.raw);
const injected = autoInjectPortTemplates(configWithInjections, metadataMap);
if (injected.length > 0) {
  console.log(`Auto-injected port templates for: ${injected.join(", ")}`);
}

// Step 3: Resolve all templates (auto-injected + user-written)
console.log("Resolving templates...");
const portAllocator = new PortAllocator(workspaceFolder);
let templateResult: TemplateResolutionResult;
try {
  templateResult = await resolveTemplates(configWithInjections, portAllocator);
  portAllocator.save(); // Persist assignments after successful resolution

  if (templateResult.allocations.length > 0) {
    const portSummary = templateResult.allocations
      .map((a) => `  ${a.label}: ${a.port}`)
      .join("\n");
    console.log(`Allocated ports:\n${portSummary}`);
  } else {
    console.log("No port templates found, skipping port allocation.");
  }

  for (const warning of templateResult.warnings) {
    console.warn(`Warning: ${warning}`);
  }
} catch (err) {
  result.exitCode = 1;
  result.message = `Template resolution failed: ${(err as Error).message}`;
  return result;
}

// In generateExtendedConfig(), replace portMapping parameter with:
// - templateResult.resolvedConfig (already has templates resolved)
// - generatePortEntries() output (auto-generated appPort/forwardPorts/portsAttributes)
// - mergePortEntries() to combine them
```

**Success criteria:**
- Auto-injection inserts `${lace.port()}` templates for feature options declared in `customizations.lace.ports` metadata
- Auto-injection skips options where the user provides an explicit value
- Template resolver processes entire devcontainer.json (both auto-injected and user-written templates)
- `${lace.port(featureId/optionName)}` allocates ports, auto-generates symmetric entries
- Port allocator manages labels via `.lace/port-assignments.json`
- User-specified port entries take precedence (suppression detection)
- Backwards-compatibility bridge preserves legacy port assignments
- All existing tests pass

### Phase 2: Feature metadata + validation

**Depends on:** [Feature Metadata Management proposal](./2026-02-06-lace-feature-metadata-management.md)

**New files:**
- `packages/lace/src/lib/feature-metadata.ts`
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

**Modified files:**
- `packages/lace/src/lib/up.ts` -- add required metadata fetch before auto-injection; validate option names; enrich `portsAttributes` with feature-declared attributes
- `packages/lace/src/commands/up.ts` -- add `--skip-metadata-validation` and `--no-cache` CLI flags

**Success criteria:**
- Metadata fetched in parallel for all features in config (required for auto-injection)
- Metadata fetch failure aborts `lace up` with clear error naming the feature and root cause
- `--skip-metadata-validation` flag bypasses metadata requirement (auto-injection skipped, defaults used)
- Option names validated against feature schema (error on mismatch)
- `customizations.lace.ports` attributes applied to `portsAttributes`
- Port declaration keys validated against option names (v2 convention enforced)

### Phase 3: Migration + cleanup

**Removed files:**
- `packages/lace/src/lib/port-manager.ts`
- `packages/lace/src/lib/__tests__/port-manager.test.ts`

**Modified files:**
- `packages/lace/src/lib/up.ts` -- remove `port-manager` imports, hardcoded wezterm references, backwards-compatibility bridge
- `packages/lace/src/commands/up.ts` -- update CLI output
- `packages/lace/README.md` -- document template variables and port system

**Dependencies:**
- Phase 1 complete
- The wezterm-server devcontainer feature updated to accept `sshPort` option with default `2222` and declare `customizations.lace.ports` in its `devcontainer-feature.json`

## Test Plan

### `template-resolver.test.ts`

#### Scenario 1: Auto-injection from feature metadata (minimal user config)

**Input config (user writes this):**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  }
}
```

**Feature metadata declares:**
```jsonc
{
  "id": "wezterm-server",
  "options": { "sshPort": { "type": "string", "default": "2222" } },
  "customizations": { "lace": { "ports": { "sshPort": { "label": "wezterm ssh" } } } }
}
```

**After auto-injection (before template resolution):**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "${lace.port(wezterm-server/sshPort)}"
    }
  }
}
```

**Expected resolved config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": 22425
    }
  }
}
```
Note: `sshPort` is an integer (type coercion -- entire string is a single template).

**Expected allocations:** `[{ label: "wezterm-server/sshPort", port: 22425 }]`

#### Scenario 1a: User-provided static value prevents auto-injection

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "3333"
    }
  }
}
```

**Feature metadata:** Same as Scenario 1 (declares `customizations.lace.ports.sshPort`).

**Expected:** Auto-injection skipped for `sshPort`. Config passes through unchanged. No port allocation. No `appPort` auto-generation.

#### Scenario 1b: Explicit template (same effect as auto-injection)

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "${lace.port(wezterm-server/sshPort)}"
    }
  }
}
```

**Feature metadata:** Same as Scenario 1.

**Expected:** Auto-injection skipped (user already provided a value). Template resolved normally. Same result as Scenario 1.

#### Scenario 2: Port template embedded in appPort string (asymmetric override)

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "2222"  // explicit value prevents auto-injection
    }
  },
  "appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]
}
```

**Expected:** Auto-injection skipped for `sshPort` (user provided explicit value). Template in `appPort` resolved.

**Expected resolved config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "2222"
    }
  },
  "appPort": ["22425:2222"]
}
```
Note: `sshPort` stays literal `"2222"`. The appPort entry is a string (embedded template).

**Expected allocations:** `[{ label: "wezterm-server/sshPort", port: 22425 }]`

#### Scenario 3: Same label in two locations resolves to same port

**Input config:**
```jsonc
{
  "features": {
    // sshPort auto-injected from metadata
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  },
  // User explicitly writes the template in appPort for asymmetric mapping
  "appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]
}
```

**Feature metadata:** wezterm-server declares `customizations.lace.ports.sshPort`.

**Expected:** Auto-injection adds `sshPort` template. Both the auto-injected feature option template and the user-written `appPort` template resolve to the same port number (e.g., 22425). Only one allocation entry.

#### Scenario 4: Multiple features, multiple ports (auto-injected)

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/debug-proxy:1": {}
  }
}
```

**Feature metadata:** wezterm-server declares `customizations.lace.ports.sshPort`; debug-proxy declares `customizations.lace.ports.debugPort`.

**Expected:** Auto-injection adds templates for both. Two different ports allocated (e.g., 22425 and 22426). Two allocation entries.

#### Scenario 5: Spec-native variables pass through unchanged

**Input config:**
```jsonc
{
  "remoteEnv": {
    "HOST_HOME": "${localEnv:HOME}"
  },
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  }
}
```

**Feature metadata:** wezterm-server declares `customizations.lace.ports.sshPort`.

**Expected:** `${localEnv:HOME}` is untouched. Auto-injected `${lace.port()}` is resolved.

#### Scenario 6: Unknown lace template variable hard-fails

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
      "hostClaudeDir": "${lace.home}/.claude"
    }
  }
}
```

**Expected error:**
```
Unknown template variable: ${lace.home}. The only supported template is ${lace.port(featureId/optionName)}.
```

#### Scenario 7: FeatureId not in config

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  },
  "appPort": ["${lace.port(nonexistent-feature/port)}:8080"]
}
```

**Expected error:**
```
Feature "nonexistent-feature" not found in config. Available features: wezterm-server
```

#### Scenario 8: FeatureId collision

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    "ghcr.io/other-org/devcontainer-features/wezterm-server:2": {}
  }
}
```

**Expected error:**
```
Feature ID collision: "wezterm-server" matches both "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1" and "ghcr.io/other-org/devcontainer-features/wezterm-server:2". Rename one using a local feature wrapper to disambiguate.
```

#### Scenario 9: No lace templates and no lace port metadata -- config passes through unchanged

**Input config:**
```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/git:1": {}
  }
}
```

**Feature metadata:** git feature has no `customizations.lace.ports`.

**Expected:** No auto-injection. Config returned unchanged. No allocations. No warnings.

#### Scenario 10: Non-string values and non-port options skipped

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "enableTls": true,
      "maxConnections": 10
    }
  }
}
```

**Feature metadata:** wezterm-server declares `customizations.lace.ports.sshPort` (only sshPort is a port option, not enableTls or maxConnections).

**Expected:** Auto-injection adds `sshPort` template. `sshPort` resolved to integer. `enableTls` (boolean) and `maxConnections` (number) pass through unchanged.

#### Scenario 11: Nested objects and arrays are walked (explicit template + auto-injection)

**Input config:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  },
  "customizations": {
    "vscode": {
      "settings": {
        // User can manually write ${lace.port()} in non-feature locations
        "myExtension.port": "${lace.port(wezterm-server/sshPort)}"
      }
    }
  }
}
```

**Feature metadata:** wezterm-server declares `customizations.lace.ports.sshPort`.

**Expected:** Auto-injection adds `sshPort` template to the feature options. Both the auto-injected `sshPort` and the user-written `myExtension.port` resolve to the same port number.

### `port-allocator.test.ts`

#### Scenario 1: Fresh allocation

No `.lace/port-assignments.json` exists. `allocate("wezterm-server/sshPort")` returns port 22425 (first available).

#### Scenario 2: Stable reuse

`.lace/port-assignments.json` contains `{ "assignments": { "wezterm-server/sshPort": { "label": "wezterm-server/sshPort", "port": 22430, "assignedAt": "..." } } }`. Port 22430 is available. `allocate("wezterm-server/sshPort")` returns 22430 (reused).

#### Scenario 3: Reassignment when port is in use

`.lace/port-assignments.json` has port 22430 for label. Port 22430 is NOT available (TCP connect succeeds). `allocate("wezterm-server/sshPort")` returns a different port (e.g., 22425) and logs a warning.

#### Scenario 4: Multiple labels get distinct ports

`allocate("wezterm-server/sshPort")` returns 22425. `allocate("debug-proxy/debugPort")` returns 22426. Ports are distinct.

#### Scenario 5: Port range exhaustion

All ports 22425-22499 are in use. `allocate(...)` throws with:
```
All ports in range 22425-22499 are in use.
Active assignments:
  wezterm-server/sshPort: 22430
  debug-proxy/debugPort: 22431
```

#### Scenario 6: Save and reload

After allocating, call `save()`. Create a new `PortAllocator` instance for the same workspace. Verify it loads the saved assignments.

### Auto-generation tests

#### Scenario 1: Full auto-generation (no user entries, auto-injected port)

**Allocations:** `[{ label: "wezterm-server/sshPort", port: 22430 }]`
**User config:** `{ "features": { "ghcr.io/.../wezterm-server:1": {} } }` (no appPort, forwardPorts, portsAttributes; port was auto-injected from metadata)

**Expected generated entries:**
```json
{
  "appPort": ["22430:22430"],
  "forwardPorts": [22430],
  "portsAttributes": {
    "22430": {
      "label": "wezterm-server/sshPort (lace)",
      "requireLocalPort": true
    }
  }
}
```

#### Scenario 2: User appPort suppresses auto-generation

**Allocations:** `[{ label: "wezterm-server/sshPort", port: 22430 }]`
**User config:** `{ "appPort": ["22430:2222"] }`

**Expected:** `appPort` in generated is empty (user already has `22430:...`). `forwardPorts` and `portsAttributes` still generated.

#### Scenario 3: User portsAttributes takes precedence

**Allocations:** `[{ label: "wezterm-server/sshPort", port: 22430 }]`
**User config:** `{ "portsAttributes": { "22430": { "label": "My SSH" } } }`

**Expected:** No auto-generated `portsAttributes` for `22430` (user entry exists).

#### Scenario 4: Feature metadata enriches label

**Allocations:** `[{ label: "wezterm-server/sshPort", port: 22430 }]`
**Feature metadata for `wezterm-server/sshPort`:** `{ "label": "wezterm ssh" }`

**Expected portsAttributes:**
```json
{
  "22430": {
    "label": "wezterm ssh (lace)",
    "requireLocalPort": true
  }
}
```

### Pipeline walkthrough

This walkthrough shows a complete devcontainer.json going in and the resolved `.lace/devcontainer.json` coming out.

**Step 0: User's `.devcontainer/devcontainer.json`**

```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    // User just declares the feature -- no port option needed.
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "customizations": {
    "lace": {
      "repoMounts": {
        "github.com/weftwiseink/other-repo": {}
      }
    }
  },
  "remoteEnv": {
    "HOST_HOME": "${localEnv:HOME}"
  }
}
```

**Step 1: Read config**

Parse JSONC. Extract prebuild features (none in this example). Extract repo mounts (one mount).

**Step 2: Fetch feature metadata**

Fetch metadata for wezterm-server and git features. wezterm-server's metadata declares `customizations.lace.ports.sshPort` with label `"wezterm ssh"`. The git feature has no lace port metadata.

**Step 3: Auto-inject port templates**

The auto-injector sees that wezterm-server declares `customizations.lace.ports.sshPort` and the user has not provided an explicit `sshPort` value. It injects `"sshPort": "${lace.port(wezterm-server/sshPort)}"` into the feature's options.

**Config after Step 3:**
```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "${lace.port(wezterm-server/sshPort)}"  // auto-injected
    },
    "ghcr.io/devcontainers/features/git:1": {}
  },
  // ... rest unchanged
}
```

**Step 4: Template resolution**

The resolver walks the entire config:
- `"sshPort": "${lace.port(wezterm-server/sshPort)}"` -- allocates port 22430, replaces with integer `22430`
- `"${localEnv:HOME}"` -- not a `${lace.*}` expression, passes through unchanged
- All other values (strings, booleans, objects) -- no templates found, pass through

**Resolved config after Step 4:**
```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": 22430
    },
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "customizations": {
    "lace": {
      "repoMounts": {
        "github.com/weftwiseink/other-repo": {}
      }
    }
  },
  "remoteEnv": {
    "HOST_HOME": "${localEnv:HOME}"
  }
}
```

Allocations: `[{ label: "wezterm-server/sshPort", port: 22430 }]`

**Step 5: Auto-generation**

No user-provided `appPort`, `forwardPorts`, or `portsAttributes`. Generate all three. The label comes from the feature's metadata (fetched in Step 2):
```jsonc
{
  "appPort": ["22430:22430"],
  "forwardPorts": [22430],
  "portsAttributes": {
    "22430": {
      "label": "wezterm ssh (lace)",
      "requireLocalPort": true
    }
  }
}
```

**Step 6: Resolve repo mounts**

`runResolveMounts()` produces mount specs for `other-repo`. (Unchanged from current behavior.)

**Step 7: Generate extended config**

Merge resolved config + auto-generated port entries + mount specs.

**Final `.lace/devcontainer.json`:**
```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": 22430
    },
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "customizations": {
    "lace": {
      "repoMounts": {
        "github.com/weftwiseink/other-repo": {}
      }
    }
  },
  "remoteEnv": {
    "HOST_HOME": "${localEnv:HOME}"
  },
  "appPort": ["22430:22430"],
  "forwardPorts": [22430],
  "portsAttributes": {
    "22430": {
      "label": "wezterm ssh (lace)",
      "requireLocalPort": true
    }
  },
  "mounts": [
    "type=bind,source=/home/mjr/.local/share/lace/repos/other-repo,target=/workspaces/other-repo,consistency=cached"
  ]
}
```

**Step 8: Persist port assignments**

`.lace/port-assignments.json`:
```json
{
  "assignments": {
    "wezterm-server/sshPort": {
      "label": "wezterm-server/sshPort",
      "port": 22430,
      "assignedAt": "2026-02-06T22:00:00.000Z"
    }
  }
}
```

**Step 9: Invoke `devcontainer up`**

```
devcontainer up --config /path/to/.lace/devcontainer.json --workspace-folder /path/to/workspace
```

### Error case examples

#### Error 1: Unknown template variable

**User writes:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
      "hostClaudeDir": "${lace.home}/.claude"
    }
  }
}
```

**User sees:**
```
Error: Template resolution failed: Unknown template variable: ${lace.home}. The only supported template is ${lace.port(featureId/optionName)}.
```

#### Error 2: Feature not found

**User writes:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}
  },
  "appPort": ["${lace.port(my-server/httpPort)}:8080"]
}
```

**User sees:**
```
Error: Template resolution failed: Feature "my-server" not found in config. Available features: wezterm-server
```

#### Error 3: Feature ID collision

**User writes:**
```jsonc
{
  "features": {
    "ghcr.io/org-a/features/server:1": {
      "port": "${lace.port(server/port)}"
    },
    "ghcr.io/org-b/features/server:2": {}
  }
}
```

**User sees:**
```
Error: Template resolution failed: Feature ID collision: "server" matches both "ghcr.io/org-a/features/server:1" and "ghcr.io/org-b/features/server:2". Rename one using a local feature wrapper to disambiguate.
```

#### Error 4: Port range exhausted

75 containers already running with lace-allocated ports.

**User sees:**
```
Error: Template resolution failed: All ports in range 22425-22499 are in use.
Active assignments:
  wezterm-server/sshPort: 22425
  debug-proxy/debugPort: 22426
  ...
```

#### Error 5: Invalid port label format

**User writes:**
```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "sshPort": "${lace.port(sshPort)}"
    }
  }
}
```

**User sees:**
```
Error: Template resolution failed: Invalid port label "sshPort". Expected format: featureId/optionName
```

### Integration (`up.integration.test.ts`)

- `lace up` auto-injects `${lace.port()}` for features with `customizations.lace.ports` metadata and generates symmetric port entries
- User-provided static value prevents auto-injection; no port allocation for that option
- User-provided explicit `${lace.port()}` template works same as auto-injection
- `${lace.port()}` in user `appPort` suppresses auto-generated symmetric entry
- No port assignment when no `${lace.port()}` in config and no `customizations.lace.ports` metadata
- Backwards-compatibility bridge preserves legacy entries
- Feature metadata attributes applied to generated `portsAttributes`
- Fallback: when metadata fetch fails with `--skip-metadata-validation`, no auto-injection occurs; user must write templates explicitly
- Prebuild features extracted before template resolution (use declared defaults)
- `${lace.port()}` in `prebuildFeatures` values triggers warning (not resolved)
