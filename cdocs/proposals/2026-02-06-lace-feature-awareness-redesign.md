---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T11:00:00-08:00
task_list: lace/feature-overhaul
type: proposal
state: archived
status: evolved
superseded_by: cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
tags: [architecture, features, templating, ports, refactor, devcontainer-spec]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-06T18:45:00-08:00
  round: 3
revisions:
  - at: 2026-02-06T12:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Resolved containerPort dimension: lace.port(label, containerPort) with explicit container port"
      - "Resolved appPort vs forwardPorts: keep appPort for direct TCP access, add portsAttributes for labeling"
      - "Added backwards-compatibility bridge for legacy port assignments"
      - "Acknowledged containerUser as best-effort"
      - "Added Open Questions section"
      - "Noted Phase 3 independence"
  - at: 2026-02-06T15:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Cascade update from revised port provisioning assessment: strengthened appPort justification with devcontainers/cli#22 evidence"
      - "Updated research findings summary with corrected port provisioning assessment conclusions"
      - "Added dual justification for appPort (CLI non-implementation + direct TCP access requirement)"
      - "Updated forwardPorts future-use NOTE with CLI implementation caveat"
      - "Updated Open Question #3 (port access mode) with CLI limitation context"
  - at: 2026-02-06T18:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Major rewrite: symmetric port model -- lace.port(label) is a pure allocation function, no containerPort arg"
      - "Template resolution scope widened from customizations.lace.features only to the entire devcontainer.json"
      - "Lace auto-generates symmetric appPort, forwardPorts, and portsAttributes for every allocated port"
      - "customizations.lace.ports moved to feature-level declaration (in devcontainer-feature.json), not user-level config"
      - "Users override via standard devcontainer.json fields, no lace-specific port mapping config needed"
      - "Removed containerPort argument -- allocated port is used on both host and container sides"
      - "Updated examples, design decisions, edge cases, test plan, and implementation phases for new model"
  - at: 2026-02-06T18:45:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "R3 blocking fix: specified suppression detection mechanism for user-provided appPort/forwardPorts/portsAttributes entries (post-resolution scan by allocated port number)"
      - "R3 non-blocking: added portRange escape hatch caveat to symmetric port safety argument"
      - "R3 non-blocking: explicit label-identity matching between customizations.lace.ports and lace.port() calls"
      - "R3 non-blocking: clarified template resolution and auto-generation as separate sequential steps in pipeline"
      - "R3 non-blocking: specified resolution scope as JSON values only (not object keys)"
      - "R3 non-blocking: added type coercion rules for lace.port() (integer when sole expression, string when embedded)"
      - "R3 non-blocking: noted VS Code cosmetic quirk with duplicate port entries from appPort + forwardPorts"
      - "R3 non-blocking: clarified Phase 1 default attributes vs Phase 2 enrichment from feature metadata"
references:
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
  - cdocs/reports/2026-02-06-port-provisioning-assessment.md
  - cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md
---

# Lace Feature Awareness Redesign

> **BLUF:** Replace lace's hardcoded wezterm port assignment and absent feature awareness with a generic system built on two pillars: (1) a template resolver that replaces `${lace.*}` expressions anywhere in `devcontainer.json` with concrete values, including a `${lace.port(label)}` function that allocates a stable host port and auto-generates symmetric `appPort`, `forwardPorts`, and `portsAttributes` entries; and (2) a `customizations.lace.features` declaration surface where features needing lace template resolution in their options are declared, then promoted into the standard `features` section of the extended config. Ports are symmetric by default -- the allocated port is used on both the host and container sides (e.g., Docker maps `22430:22430`), matching how VS Code's auto-port-forwarding model works and avoiding conflicts with standard services inside containers. Features declare port preferences via `customizations.lace.ports` in their own `devcontainer-feature.json`; users never need lace-specific port configuration and override via standard devcontainer.json fields (`appPort`, `forwardPorts`, `portsAttributes`). See the [manifest fetching report](../reports/2026-02-06-feature-manifest-fetching-options.md) and [port provisioning assessment](../reports/2026-02-06-port-provisioning-assessment.md) for the research backing these decisions.

## Objective

Genericize lace's feature customizations so that any devcontainer feature can declare host-side orchestration needs (dynamic ports, host paths, container user info) through `customizations.lace.features`, rather than lace hardcoding behavior for specific features like wezterm. This also refactors port allocation from a single-purpose wezterm module into a generic, label-based system driven by template variable resolution, with symmetric port mapping as the default.

## Background

### Current state

Lace's `runUp()` in `up.ts` unconditionally assigns a wezterm SSH port as Phase 0, scanning 22425-22499 and writing to `appPort` via `port-manager.ts`. This is hardcoded: the port range, container port (2222), and the assumption that every container needs an SSH port are all baked in. There is no mechanism for features to declare port needs, no template variable system, and no feature metadata awareness.

The [plugin architecture analysis](../reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md) established that devcontainer features should be the behavioral extensibility unit, with lace's role limited to host-side orchestration: repo cloning, dynamic port assignment, template variable resolution, and config assembly.

### Research findings

**Manifest fetching** ([report](../reports/2026-02-06-feature-manifest-fetching-options.md)): `devcontainer features info manifest <id> --output-format json` returns the complete `devcontainer-feature.json` via OCI manifest annotations. Zero new dependencies, handles auth, <1s per feature. A two-tier cache (in-memory + filesystem) eliminates redundant lookups. Metadata fetching is best-effort -- lace's core workflow does not require it. Additionally, lace uses feature metadata to read `customizations.lace.ports` declarations from features, enabling automatic port attribute generation.

**Port provisioning** ([report](../reports/2026-02-06-port-provisioning-assessment.md)): Dynamic host-port assignment is a genuine gap in the devcontainer spec. `forwardPorts` accepts only literal port numbers (no ranges, no "find available" semantic), `portsAttributes` range syntax is for attribute application only (not port allocation), and features cannot declare port needs in their metadata. More critically, the devcontainer CLI does not implement `forwardPorts` at all (devcontainers/cli#22) -- it is a VS Code/Codespaces-level tunnel, not a Docker-level port binding. Lace must use `appPort` (the only mechanism that creates Docker-level `-p` bindings) and should genericize port management via a `${lace.port(label)}` template function. The symmetric port model -- using the same port number on both host and container sides -- eliminates the complexity of tracking separate host and container ports, and lace's default range (22425-22499) is chosen to avoid collisions with standard services inside containers.

## Proposed Solution

### Schema: `customizations.lace` in user's `devcontainer.json`

```jsonc
{
  "customizations": {
    "lace": {
      // Existing (unchanged)
      "prebuildFeatures": { /* ... */ },

      // Renamed from "plugins" (Phase 3)
      "repos": {
        "github.com/user/dotfiles": {},
        "github.com/user/tools": { "alias": "my-tools" }
      },

      // NEW: feature declarations with lace template variables
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          "port": "${lace.port(ssh)}"
        },
        "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
          "hostClaudeDir": "${lace.home}/.claude"
        }
      },

      // NEW: optional port range override
      "portRange": { "min": 22425, "max": 22499 }
    }
  }
}
```

Features declared in `customizations.lace.features` undergo template variable resolution, then are promoted into the top-level `features` object of `.lace/devcontainer.json`. Features in the standard `features` section pass through untouched.

### Feature-level port declarations: `customizations.lace.ports`

Features declare their port needs in their own `devcontainer-feature.json` via `customizations.lace.ports`. This is how a feature tells lace "I need a port labeled X with these attributes." Lace reads this via feature metadata fetching (best-effort).

```jsonc
// In devcontainer-feature.json for wezterm-server feature
{
  "id": "wezterm-server",
  "version": "1.0.0",
  "options": {
    "port": {
      "type": "string",
      "default": "2222",
      "description": "Port for wezterm mux server (use ${lace.port(ssh)} with lace)"
    }
  },
  "customizations": {
    "lace": {
      "ports": {
        "ssh": {
          "label": "wezterm ssh",
          "onAutoForward": "silent"
        }
      }
    }
  }
}
```

Lace matches `customizations.lace.ports` entries to `${lace.port()}` calls by label identity: when `${lace.port(ssh)}` is allocated and the feature's metadata declares a `customizations.lace.ports.ssh` entry (same label `ssh`), lace uses those attributes when generating `portsAttributes`. If metadata is not available (offline, private registry, etc.), lace generates bare symmetric mappings with the label defaulting to `"<label> (lace)"`.

**This field does NOT appear in the user's `devcontainer.json`.** Users override port behavior via standard devcontainer.json fields.

### Template variable system

| Variable | Resolves to | Source |
|----------|------------|--------|
| `${lace.port(label)}` | Available host port, stable per label | TCP scan + `.lace/port-assignments.json` |
| `${lace.home}` | Host home directory | `os.homedir()` |
| `${lace.workspaceFolder}` | Host workspace path | CLI arg or `process.cwd()` |
| `${lace.containerUser}` | Container remote user (best-effort) | `remoteUser` from config, or `root` |
| `${lace.containerHome}` | Container user home (best-effort) | `/home/${containerUser}` or `/root` |
| `${lace.containerWorkspaceFolder}` | Container workspace path | `workspaceFolder` from config |
| `${lace.projectId}` | Derived project identifier | Existing `deriveProjectId()` logic |

`${lace.port(label)}` is a pure allocation function. It takes a single argument: the label for stable identification (e.g., `ssh`). It returns an available host port from the configured range (default 22425-22499). The allocated port is used symmetrically on both sides of the Docker port mapping. The feature's service listens on that port inside the container, Docker maps `port:port`, and the host connects to `localhost:port`.

> NOTE: `${lace.containerUser}` and `${lace.containerHome}` are best-effort approximations. The devcontainer CLI has a complex user resolution order (`remoteUser` > feature-declared `remoteUser` > `containerUser` > image default) that lace does not fully replicate. Inside features at build time, `_REMOTE_USER` and `_REMOTE_USER_HOME` are available and authoritative. Lace's container user variables are only needed for host-side decisions (e.g., SSH connection URIs) where the feature's build-time variables are not accessible.

**Resolution scope:** `${lace.*}` templates can appear in any **string value** in the `devcontainer.json` -- in `customizations.lace.features` option values, in `appPort`, in `forwardPorts`, in `portsAttributes`, in `customizations.lace` config, etc. Resolution applies to JSON values only, not object keys. Lace processes the entire config file before writing the extended `.lace/devcontainer.json`. This is consistent with how `${localEnv:}` works across the whole config. Spec-native `${localEnv:...}` and `${containerEnv:...}` pass through unchanged.

**Type coercion:** `${lace.port(label)}` resolves to a number when the entire string is the template expression (e.g., `"${lace.port(ssh)}"` becomes `22430` as an integer), and to a string when embedded in a larger string (e.g., `"${lace.port(ssh)}:2222"` becomes `"22430:2222"`). This means `"forwardPorts": ["${lace.port(ssh)}"]` correctly resolves to `[22430]` (integer), matching the `forwardPorts` schema expectation.

### Symmetric port model

The key insight is that lace's port range (22425-22499) will never conflict with standard services inside containers. No standard container service defaults to ports in this range. (For custom or enterprise images that do bind to this range, the `portRange` config provides an escape hatch, and the allocator's TCP scan checks port availability before each assignment.) This makes symmetric mapping safe and simple:

1. `${lace.port(ssh)}` allocates port `22430`
2. The wezterm-server feature receives `"port": "22430"` and configures its mux server to listen on port `22430` inside the container
3. Lace generates `appPort: ["22430:22430"]` -- symmetric mapping
4. The host connects to `localhost:22430`

This is the same model VS Code uses with auto-port-forwarding: the forwarded port matches the container port. It eliminates the complexity of tracking two separate port numbers and makes the system easier to reason about.

**Why this works for wezterm:** The current wezterm-server feature hardcodes port 2222 because that is a common SSH convention. With lace, the feature accepts a `port` option. When lace is present, the feature receives a dynamically allocated port (e.g., 22430) and listens on that. When lace is not present, the feature falls back to its default (2222). The feature does not need to know whether lace is involved -- it just uses whatever port it is configured with.

### Pipeline: `lace up` workflow

```
[current]  read config -> assign wezterm port -> prebuild -> resolve mounts -> generate config -> devcontainer up
[proposed] read config -> resolve templates (entire config) -> extract lace features -> prebuild -> resolve repos -> generate config -> devcontainer up
```

Template resolution and port auto-generation are separate sequential steps. First, template resolution operates on the entire devcontainer.json, replacing all `${lace.*}` expressions with concrete values. Port allocation happens as a side effect when `${lace.port(label)}` expressions are encountered during this pass. Second, after resolution completes, the resolved config is scanned for user-provided port entries (see "Suppression detection" below), and auto-generated `appPort`/`forwardPorts`/`portsAttributes` entries are produced only for ports not already covered. Third, lace features are extracted from the resolved config and promoted into the extended config, with auto-generated port entries merged in.

**Backwards-compatibility bridge:** During the transition period (Phases 1-3, before Phase 4 cleanup), if no `customizations.lace.features` section exists but `.lace/port-assignments.json` or `.lace/devcontainer.json` with `appPort` entries exist from the legacy system, lace preserves those port mappings in the generated config. This prevents breaking existing users who have not yet migrated to the new schema. The bridge is removed in Phase 4, at which point all port declarations must come through `customizations.lace.features`.

### Feature promotion

Resolved features from `customizations.lace.features` merge into `.lace/devcontainer.json`'s top-level `features`. Overlap detection: error if a feature ID appears in both `customizations.lace.features` and top-level `features` (same pattern as `prebuildFeatures` vs `features`).

### Auto-generated port output in extended config

For every port allocated via `${lace.port(label)}`, lace auto-generates entries in three devcontainer port fields:

**Example:** `${lace.port(ssh)}` resolves to `22430`, `${lace.port(debug)}` resolves to `22431`.

```jsonc
{
  // Docker-level -p binding (required -- devcontainer CLI doesn't implement forwardPorts)
  "appPort": ["22430:22430", "22431:22431"],

  // VS Code / Codespaces forwarding (harmless if ignored by CLI, useful if VS Code attaches)
  "forwardPorts": [22430, 22431],

  // Labeling and behavior control
  "portsAttributes": {
    "22430": {
      "label": "wezterm ssh (lace)",
      "onAutoForward": "silent",
      "requireLocalPort": true
    },
    "22431": {
      "label": "debug (lace)",
      "onAutoForward": "silent",
      "requireLocalPort": true
    }
  }
}
```

The three fields serve different purposes:

1. **`appPort`** creates Docker-level `-p hostPort:containerPort` bindings. This is the only mechanism the devcontainer CLI supports for exposing container ports on the host. Required because the devcontainer CLI does not implement `forwardPorts` (devcontainers/cli#22).

2. **`forwardPorts`** is included for VS Code and Codespaces. If VS Code attaches to the container, these entries ensure it recognizes the ports as intentionally forwarded. The devcontainer CLI silently ignores this field. Note: VS Code may show a port in its forwarding UI from both `appPort` detection and `forwardPorts` declaration; this is a cosmetic quirk, not a functional issue.

3. **`portsAttributes`** provides labeling, `onAutoForward` behavior, and `requireLocalPort` as a safety net. The label comes from feature metadata (`customizations.lace.ports`) if available, otherwise defaults to `"<label> (lace)"`. The `requireLocalPort: true` causes tooling to fail fast if the port is grabbed between allocation and container start. The `onAutoForward: "silent"` prevents notification popups in VS Code.

Auto-generated port entries merge with any user-specified entries. User entries take precedence for the same port (allowing overrides).

**Suppression detection:** After template resolution (which resolves all `${lace.*}` expressions, including `${lace.port()}` calls in user-provided `appPort` entries), lace scans the resolved config's `appPort` array for entries whose host-side port (the portion before `:`) matches an allocated port number. For any matched port, lace skips auto-generating a symmetric `appPort` entry for that label. The same logic applies to `forwardPorts` (scan for the allocated port number in the array) and `portsAttributes` (scan for the allocated port number as a key). This is a post-resolution scan on the concrete config values, not provenance tracking of which template expressions appeared where. The steps are: (1) resolve all `${lace.*}` templates in the entire config, collecting allocated port labels and numbers; (2) scan the resolved config for user-provided port entries referencing allocated ports; (3) auto-generate `appPort`, `forwardPorts`, and `portsAttributes` entries only for allocated ports not already covered by user entries.

### Override story

Users override port behavior entirely through standard devcontainer.json fields. No lace-specific port configuration is needed.

| Want to... | How |
|-----------|-----|
| Use a different port number | Override the feature's `port` option with a literal value |
| Use an asymmetric mapping | Write your own `appPort` entry (can use `${lace.port(label)}` for the host side) |
| Change port attributes | Write your own `portsAttributes` entry for the port |
| Avoid lace managing a port | Use a literal number instead of `${lace.port()}` |

Example -- asymmetric mapping with custom container port:

```jsonc
{
  "customizations": {
    "lace": {
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          "port": "2222"
        }
      }
    }
  },
  // User writes their own appPort with lace-allocated host port but fixed container port
  "appPort": ["${lace.port(ssh)}:2222"]
}
```

In this case, the user explicitly opts into an asymmetric mapping. Lace resolves `${lace.port(ssh)}` in the `appPort` string to a concrete port number (e.g., `22430`), producing `"22430:2222"`. Since the user provided their own `appPort` for this port, lace does not auto-generate a symmetric one. The feature receives `"port": "2222"` (a literal, no template), so the wezterm server listens on 2222 inside the container.

### New modules

**`template-resolver.ts`** -- walks the entire devcontainer.json config, replaces `${lace.*}` patterns, delegates port allocation to the port allocator. Returns the resolved config + list of allocated ports.

**`port-allocator.ts`** -- replaces `port-manager.ts`. Label-based, on-demand port allocation with persistence in `.lace/port-assignments.json`. Configurable range via `customizations.lace.portRange`. Generates symmetric `appPort`, `forwardPorts`, and `portsAttributes` entries for each allocated port.

**`feature-metadata.ts`** -- fetches `devcontainer-feature.json` via `devcontainer features info manifest`. Two-tier cache. Best-effort, non-blocking. Used for reading `customizations.lace.ports` declarations and option schema validation.

**`extractLaceFeatures()`** in `devcontainer.ts` -- new extractor following the same discriminated result pattern as `extractPrebuildFeatures()` and `extractPlugins()`.

## Important Design Decisions

### Decision: `${lace.port(label)}` as a pure allocation function with no containerPort argument

**Why:** The symmetric port model eliminates the need for a separate container port. The allocated port is used on both sides of the Docker mapping. This is safe because lace's port range (22425-22499) does not collide with any standard service port inside containers. The simplicity gain is significant: features receive a single port number and use it directly, lace generates a simple `port:port` mapping, and there is no second dimension to track or specify. For the rare case where asymmetric mapping is needed, users write their own `appPort` entry.

### Decision: Template resolution across the entire devcontainer.json, not just `customizations.lace.features`

**Why:** Restricting resolution to feature option values was the original design, but it prevented useful patterns like `"appPort": ["${lace.port(ssh)}:2222"]` for asymmetric overrides. The wider scope is consistent with how `${localEnv:}` works in the devcontainer spec -- it can appear anywhere in the config. Lace processes the entire config before writing the extended `.lace/devcontainer.json`, so there is no ambiguity about resolution timing. Unknown `${lace.*}` expressions still error, preventing silent misconfiguration.

### Decision: Features declare port preferences via `customizations.lace.ports` in their `devcontainer-feature.json`

**Why:** Features know their own port semantics (labels, auto-forward behavior, protocol). The `customizations` field in `devcontainer-feature.json` is the spec-sanctioned extensibility point for tool-specific metadata. Placing port declarations here keeps feature-specific knowledge in the feature, not in the user's config. This is best-effort: if feature metadata is unavailable, lace generates bare symmetric mappings with default attributes.

### Decision: Lace auto-generates `appPort` + `forwardPorts` + `portsAttributes` for allocated ports

**Why:** Writing three fields for every port is boilerplate that lace can eliminate. `appPort` is required (devcontainer CLI does not implement `forwardPorts`). `forwardPorts` is harmless and useful if VS Code attaches. `portsAttributes` provides labeling and safety. Auto-generating all three is the zero-config default; users override individual fields when they need non-default behavior.

### Decision: No `customizations.lace.ports` in the user's devcontainer.json

**Why:** Port declarations in the user's config would duplicate the feature's own knowledge. Instead, users override port behavior through standard devcontainer.json fields (`appPort`, `forwardPorts`, `portsAttributes`), which they already know from the devcontainer spec. This keeps lace's user-facing surface minimal.

### Decision: Flat namespace `${lace.X}` instead of `${lace.local.X}` / `${lace.container.X}`

**Why:** The earlier analysis report proposed a two-tier namespace (`lace.local.*` for host values, `lace.container.*` for container values). However, this adds verbosity for minimal disambiguation value. Container-side variables are already distinguished by their `container` prefix (`containerUser`, `containerHome`, `containerWorkspaceFolder`). The flat namespace is shorter to type and still unambiguous.

### Decision: Port assignments in `.lace/port-assignments.json`, not `.lace/devcontainer.json`

**Why:** The current implementation stores port assignments inside the generated config via `appPort`. This couples port state to config generation -- clearing or regenerating the config loses the port assignment. A dedicated file makes port stability independent of config lifecycle.

### Decision: Metadata fetching is best-effort

**Why:** `lace up` must work offline, with private registries that may not respond, and with local-path features that have no registry. Making metadata fetching a hard requirement would break these workflows. Template resolution and feature promotion work without metadata. The only degradation is: lace cannot read feature-declared `customizations.lace.ports` attributes, so it falls back to default labels.

### Decision: Feature in both `customizations.lace.features` and `prebuildFeatures` is valid

**Why:** A feature can be pre-baked into the image (via `prebuildFeatures`) for performance AND have lace-templated options resolved at `lace up` time. The prebuild uses the feature's declared defaults; the promoted feature in `.lace/devcontainer.json` carries the resolved values.

> NOTE: This edge case needs careful testing. If the devcontainer CLI re-runs the feature's `install.sh` when option values differ from the prebuild, the prebuild optimization is negated. The implementation should verify that promoted features with non-default options do not trigger redundant installs.

## Edge Cases / Challenging Scenarios

### No lace features declared

No template resolution of `customizations.lace.features`, no feature promotion. However, `${lace.*}` templates in other parts of the config (e.g., `appPort`) are still resolved. If no `${lace.port()}` calls exist anywhere, no port allocation occurs. This is a behavioral improvement over the current unconditional port scan.

### `${lace.port(label)}` used outside `customizations.lace.features`

Valid. For example, `"appPort": ["${lace.port(ssh)}:2222"]` allocates a host port and uses it in an asymmetric mapping. The port is still tracked in `.lace/port-assignments.json` and auto-generates `portsAttributes` (unless the user provides their own).

### Feature ID collision between `customizations.lace.features` and `features`

Error at config parse time with a message naming the duplicate feature ID. Same enforcement pattern as the existing `prebuildFeatures` vs `features` overlap detection.

### All ports in range exhausted

Same error as today, but the message includes which labels have active assignments, helping the user identify stale assignments to clean up.

### Port previously assigned but now in use

Reassign to a new port, log a warning with old and new port numbers. Same behavior as current `port-manager.ts`, now per-label.

### Unknown template variable

`${lace.nonexistent}` is an error at template resolution time. Hard fail prevents silent misconfiguration. The error message lists valid variable names.

### Template variable in string concatenation

Values like `"${lace.home}/.claude"` resolve correctly -- the resolver replaces the `${lace.*}` portion within the string. Multiple variables in one string (e.g., `"${lace.home}/${lace.projectId}"`) are also supported.

### `${lace.port(label)}` in `appPort` with asymmetric mapping

When a user writes `"appPort": ["${lace.port(ssh)}:2222"]`, lace detects that the user has provided their own `appPort` entry for this port and does not auto-generate a symmetric one. The user's asymmetric mapping takes precedence.

### Local-path features in `customizations.lace.features`

Features referenced as `./features/my-feature` work the same way -- template variables in their options are resolved, and the feature is promoted into the extended config with a local path reference. Feature metadata (including `customizations.lace.ports`) is read directly from the filesystem.

### Feature metadata unavailable

If metadata cannot be fetched (offline, private registry, CLI error), lace proceeds without it. Port attributes default to `"<label> (lace)"` for the label and `"silent"` for `onAutoForward`. A warning is logged.

### Same label used in multiple `${lace.port()}` calls

Same label always resolves to the same port. `${lace.port(ssh)}` in a feature option and `${lace.port(ssh)}` in an `appPort` entry both resolve to the same allocated port number. This is by design -- the label is the stable identifier.

### User provides `portsAttributes` for an auto-generated port

User-specified `portsAttributes` entries take precedence over lace-generated ones. If the user writes `"portsAttributes": { "22430": { "label": "my custom label" } }`, lace does not overwrite it.

## Open Questions / Future Extensions

1. **`${lace.env(VAR)}` for host environment variable access.** The existing `${localEnv:VAR}` passes through to the devcontainer CLI for later resolution. If lace needs a host env var resolved at template time (to use in computed values), a `${lace.env(VAR)}` function would fill that gap. Not needed for the initial implementation.

2. **Prebuild + lace features dual declaration.** When a feature appears in both `prebuildFeatures` and `customizations.lace.features`, the prebuild installs it with default options, and the promoted config specifies non-default options. If the devcontainer CLI re-runs `install.sh` when options differ, the prebuild optimization is negated. This needs investigation but is out of scope for Phase 1.

3. **Port access mode.** All lace-managed ports currently use `appPort` for Docker-level binding because the devcontainer CLI does not implement `forwardPorts` (devcontainers/cli#22). If the CLI eventually adds `forwardPorts` support, a future `accessMode` parameter on `${lace.port()}` could let features choose between `appPort` (direct Docker-level binding) and `forwardPorts` (CLI-tunneled) based on their access pattern.

4. **Feature-declared port options discovery.** If lace could infer which feature option corresponds to a port label (e.g., option `port` maps to label `ssh`), it could auto-populate feature options without the user writing `"port": "${lace.port(ssh)}"`. This would require a convention or additional metadata in `customizations.lace.ports`. Deferred for simplicity.

## Test Plan

### `template-resolver.test.ts`
- Resolves `${lace.home}` to `os.homedir()` in feature option values
- Resolves `${lace.home}` in top-level config fields (e.g., mount paths)
- Resolves `${lace.port(ssh)}` to a port number, records allocation
- Same `${lace.port(ssh)}` in two different locations resolves to the same port
- Different labels (`ssh`, `debug`) resolve to different ports
- Resolves `${lace.port(ssh)}` inside `appPort` string: `"${lace.port(ssh)}:2222"` becomes `"22430:2222"`
- Passes through `${localEnv:HOME}` unchanged
- Errors on `${lace.unknown}` with helpful message listing valid variables
- Resolves multiple variables in one string: `"${lace.home}/.claude"`
- Skips non-string values (booleans, numbers) without error
- Walks nested objects and arrays throughout the entire config

### `port-allocator.test.ts`
- Reads existing assignments from `.lace/port-assignments.json`
- Reuses stable port for known label when port is available
- Assigns new port when label is new
- Reassigns when existing port is in use, logs warning
- Errors when all ports in range are exhausted (message includes active labels)
- Respects custom port range from `portRange` config
- Multiple labels get distinct ports
- Generates symmetric `appPort` entry (`"22430:22430"`) for each allocated port
- Generates `forwardPorts` entry for each allocated port
- Generates default `portsAttributes` with label, `onAutoForward`, `requireLocalPort`
- Merges feature-declared `customizations.lace.ports` attributes into `portsAttributes` when metadata is available
- Uses default attributes when metadata is unavailable
- User-specified `appPort`, `forwardPorts`, `portsAttributes` entries take precedence over generated ones
- Reads legacy `appPort` entries from `.lace/devcontainer.json` and imports them (backwards-compatibility bridge)

### `feature-metadata.test.ts`
- Parses `dev.containers.metadata` annotation from CLI JSON output
- Extracts `customizations.lace.ports` from feature metadata
- Returns null on CLI failure (non-zero exit)
- Caches results in memory across calls within a run
- Handles local-path features via filesystem read
- Parallel fetch via `fetchAllFeatureMetadata()`

### Integration (`up.integration.test.ts` updates)
- `lace up` with `customizations.lace.features` promotes features into extended config
- Template variables resolved in promoted features
- `${lace.port(ssh)}` in feature option triggers symmetric `appPort`, `forwardPorts`, `portsAttributes` generation
- `${lace.port(ssh)}` in user `appPort` with asymmetric mapping suppresses auto-generated `appPort` for that port
- No port assignment when no `${lace.port()}` anywhere in the config
- Feature overlap between `customizations.lace.features` and `features` produces error
- Backwards-compatibility bridge: legacy `appPort` entries preserved when no `customizations.lace.features` exists
- Feature metadata `customizations.lace.ports` attributes applied to generated `portsAttributes`
- Fallback to default attributes when metadata fetch fails

## Implementation Phases

### Phase 1: Template resolver + port allocator

**New files:**
- `packages/lace/src/lib/template-resolver.ts`
- `packages/lace/src/lib/__tests__/template-resolver.test.ts`
- `packages/lace/src/lib/port-allocator.ts`
- `packages/lace/src/lib/__tests__/port-allocator.test.ts`

**Modified files:**
- `packages/lace/src/lib/devcontainer.ts` -- add `extractLaceFeatures()`, add `LaceFeaturesResult` type
- `packages/lace/src/lib/up.ts` -- replace Phase 0 (hardcoded port assignment) with template resolution phase that processes the entire config; update `generateExtendedConfig()` to accept promoted features and auto-generated port entries (`appPort`, `forwardPorts`, `portsAttributes`); add backwards-compatibility bridge for legacy port assignments
- `packages/lace/src/lib/__tests__/devcontainer.test.ts` -- tests for `extractLaceFeatures()`

**Do NOT modify:**
- `prebuild.ts`, `restore.ts`, `status.ts` -- prebuild system is unaffected
- `resolve-mounts.ts`, `mounts.ts`, `plugin-clones.ts` -- repo mount system is unaffected in this phase
- `settings.ts` -- user settings schema unchanged in this phase

**Success criteria:**
- Template resolver processes the entire devcontainer.json, resolving all `${lace.*}` expressions
- `${lace.port(label)}` allocates ports and auto-generates symmetric `appPort`, `forwardPorts`, `portsAttributes`
- `extractLaceFeatures()` correctly parses `customizations.lace.features` with same discriminated result pattern
- Port allocator reads/writes `.lace/port-assignments.json`, manages labels independently
- `generateExtendedConfig()` merges promoted features into `features`, merges auto-generated port entries
- User-specified port entries take precedence over auto-generated ones
- Overlap detection between `customizations.lace.features` and `features` errors correctly
- Backwards-compatibility bridge preserves legacy `appPort` entries
- All existing tests still pass (no behavioral regression for projects without `customizations.lace.features`)

### Phase 2: Feature metadata + port attribute enrichment

Phase 1 auto-generates `portsAttributes` with default values (`"<label> (lace)"` for label, `"silent"` for `onAutoForward`, `true` for `requireLocalPort`). Phase 2 enriches these defaults with feature-declared attributes from `customizations.lace.ports` in feature metadata.

**New files:**
- `packages/lace/src/lib/feature-metadata.ts`
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

**Modified files:**
- `packages/lace/src/lib/up.ts` -- add optional metadata fetch after template resolution; read `customizations.lace.ports` from feature metadata; enrich `portsAttributes` with feature-declared attributes; warn on option name mismatches
- `packages/lace/src/lib/port-allocator.ts` -- accept feature-declared port attributes for `portsAttributes` enrichment

**Success criteria:**
- Metadata fetched in parallel for all `customizations.lace.features` entries
- Cache prevents redundant fetches within a run
- `customizations.lace.ports` declarations from feature metadata applied to generated `portsAttributes`
- Validation warns (not errors) when a template variable targets a nonexistent feature option
- Metadata fetch failure logs warning, does not block `lace up`, falls back to default attributes
- Local-path features read metadata from filesystem

### Phase 3: Rename plugins to repos

> NOTE: This phase has no dependency on Phases 1 or 2 and can be executed independently or in parallel.

**Modified files:**
- `packages/lace/src/lib/devcontainer.ts` -- add `extractRepos()`, deprecate `extractPlugins()`
- `packages/lace/src/lib/up.ts` -- use `extractRepos()`, add deprecation warning for `plugins`
- `packages/lace/src/lib/resolve-mounts.ts` -- update terminology in messages
- `packages/lace/README.md` -- update documentation

**Success criteria:**
- `customizations.lace.repos` works identically to current `customizations.lace.plugins`
- `customizations.lace.plugins` still works with deprecation warning in console
- `extractPlugins()` still exported as deprecated alias

### Phase 4: Migration + cleanup

**Removed files:**
- `packages/lace/src/lib/port-manager.ts` (replaced by `port-allocator.ts`)
- `packages/lace/src/lib/__tests__/port-manager.test.ts`

**Modified files:**
- `packages/lace/src/lib/up.ts` -- remove all `port-manager` imports, remove hardcoded wezterm references, remove backwards-compatibility bridge
- `packages/lace/src/commands/up.ts` -- update any CLI output referencing wezterm ports
- `packages/lace/src/index.ts` -- update exports
- `packages/lace/README.md` -- document `customizations.lace.features` and template variables

**Dependencies:**
- Requires Phase 1 complete (port-allocator in place)
- The lace.wezterm plugin (separate repo) must be updated to: (a) accept a `port` option with a default of `2222`, (b) declare `customizations.lace.ports` in its `devcontainer-feature.json`, and (c) use the received port for its mux server listener

**Success criteria:**
- `port-manager.ts` fully removed, no references remain
- Backwards-compatibility bridge removed (all port declarations must come through `customizations.lace.features`)
- Existing projects with `.lace/devcontainer.json` containing `appPort` entries have been migrated to new schema
- `lace status` shows port assignments by label
- README documents the new `customizations.lace.features` schema and template variables
