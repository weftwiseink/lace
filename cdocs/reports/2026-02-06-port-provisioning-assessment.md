---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T10:30:00-08:00
task_list: lace/feature-overhaul
type: report
state: live
status: revised
tags: [assessment, ports, devcontainer-spec, architecture, wezterm]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-06T14:30:00-08:00
  round: 1
revisions:
  - at: 2026-02-06T15:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Corrected forwardPorts recommendation: keep appPort, devcontainer CLI does not implement forwardPorts"
      - "Added key finding about devcontainer CLI not implementing forwardPorts (devcontainers/cli#22)"
      - "Added key finding about features not being able to declare ports in metadata"
      - "Added key finding about VS Code auto-port-forwarding being IDE-level only"
      - "Added portsAttributes range syntax clarification (attribute application vs port allocation)"
      - "Added Alternative E (VS Code auto-port-forwarding) to spec alternatives analysis"
      - "Updated generated config output to use appPort with portsAttributes"
      - "Reframed appPort deprecation as cosmetic for devcontainer CLI users"
      - "Added requireLocalPort runtime dependency caveat"
---

# Port Provisioning Assessment

> **NOTE (2026-02-06):** This report's original recommendation to migrate from `appPort` to `forwardPorts` was incorrect -- the devcontainer CLI does not implement `forwardPorts` (devcontainers/cli#22). The R1 review corrected this. Additionally, the `${lace.port(label)}` design has since evolved: the `containerPort` argument was dropped in favor of a **symmetric port model** where the allocated port is used on both host and container sides (e.g., 22430:22430). Features declare their port as an overrideable option, defaulting to the lace-allocated port for symmetry with VS Code auto-forwarding. Lace auto-generates `appPort`, `forwardPorts`, and `portsAttributes` entries for all allocated ports. Users override via standard devcontainer.json fields. The `forwardPorts` concern was also investigated: it accepts only literal integers or `"host:port"` strings -- no ranges. The `portsAttributes` range syntax (e.g., `"40000-55000"`) is for attribute application only, not port allocation. See the revised [Feature Awareness Redesign proposal](../proposals/2026-02-06-lace-feature-awareness-redesign.md) for the current design.

> **BLUF:** Dynamic host-port assignment is a genuine gap in the devcontainer spec. The spec's `forwardPorts`, `portsAttributes`, and container labels cannot replace lace's custom port management because they are all static -- none can express "find me an available port." Additionally, `forwardPorts` is not implemented by the devcontainer CLI (devcontainers/cli#22), making it unusable for lace's runtime. Lace should keep port management and keep `appPort` for Docker-level port binding, genericizing it via a `${lace.port(label)}` template function with `portsAttributes` added for labeling. Port assignments should be persisted in a dedicated file for cross-run stability.

## Context / Background

Lace currently auto-assigns SSH ports in the 22425-22499 range for wezterm mux servers. The implementation in `port-manager.ts` scans for available ports via TCP connect, persists the assignment in `.lace/devcontainer.json` via `appPort`, and reuses stable assignments across restarts. The `runUp` workflow in `up.ts` hardcodes this as "Phase 0" before all other phases.

The devcontainer spec recommends `forwardPorts` over `appPort` and provides `portsAttributes` for labeling and behavior control. However, `forwardPorts` operates at the tooling level (VS Code creates tunnels), while `appPort` operates at the Docker level (direct `-p` port binding). The devcontainer CLI does not implement `forwardPorts` (devcontainers/cli#22). This report assesses whether spec idioms can replace lace's custom port logic entirely, or whether the dynamic assignment gap requires a redesigned lace-native solution.

## Key Findings

- **`forwardPorts` is static-only and not implemented by the devcontainer CLI.** It accepts literal port numbers or `"host:port"` strings. There is no expression syntax, range notation, or "find available" semantic. More critically, the devcontainer CLI does not implement `forwardPorts` at all (devcontainers/cli#22, still open). `forwardPorts` is a VS Code / Codespaces-level feature that creates tunnels through the tooling's internal communication channel. It does not create Docker-level port bindings. Third-party projects (devcontainer-cli-forward-ports, devcontainer-cli-port-forwarder) exist solely to work around this gap using `socat`. Since lace invokes `devcontainer up` via the CLI, `forwardPorts` entries in generated config are silently ignored.
- **`portsAttributes` range syntax is for attribute application, not port allocation.** The `portsAttributes` property key accepts range patterns (e.g., `"40000-55000"`) and regex patterns via `patternProperties` matching `(^\d+(-\d+)?$)|(.+)`. However, this applies display and behavior attributes (labeling, `onAutoForward`, protocol hints, `requireLocalPort`) to ports that are already forwarded or auto-detected. It does not allocate, discover, or forward ports. The range syntax in `portsAttributes` keys is unrelated to the `forwardPorts` value format.
- **Features cannot declare port needs in their metadata.** The `devcontainer-feature.json` schema supports `containerEnv`, `mounts`, `capAdd`, `privileged`, `init`, lifecycle hooks, and `customizations` -- but NOT `forwardPorts`, `portsAttributes`, or any port-related fields. The official `sshd` feature (devcontainers/features) tells users to manually add `forwardPorts: [2222]` to their `devcontainer.json`. There is no automatic port discovery mechanism in the feature spec.
- **`requireLocalPort: true` detects conflicts but does not resolve them.** It causes the tooling to error if the exact port is unavailable, rather than silently remapping. This is conflict detection, not conflict resolution. Note: this property's enforcement depends on the implementing runtime and may not be honored by the devcontainer CLI.
- **`appPort` is spec-deprecated but functionally necessary.** The spec recommends `forwardPorts` instead, but since the devcontainer CLI does not implement `forwardPorts`, `appPort` remains the only mechanism that creates Docker-level `-p hostPort:containerPort` port bindings. `appPort` requires applications to bind `0.0.0.0`, which is a security consideration for SSH, but this is inherent to Docker port publishing regardless of the configuration property used.
- **VS Code auto-port-forwarding is IDE-level, not spec-level.** VS Code detects processes listening on ports inside the container at runtime (controlled by `remote.autoForwardPortsSource` with `process` and `hybrid` modes). This is runtime detection by the IDE, not a spec-level allocation mechanism. It requires the container to already be running and does not apply to lace's CLI-based workflow.
- **Docker ephemeral ports lose stability.** Using `appPort: ["0:2222"]` lets Docker pick a host port, but it changes on every restart, breaking wezterm domain configs and SSH aliases.
- **Post-start discovery defeats single-command workflow.** Inspecting `docker port <container>` after start works for ephemeral ports, but lace.wezterm needs the port *before* container start to register SSH domains.

## Spec Alternatives Analysis

### Alternative A: Static `forwardPorts` per project

Each project hardcodes its SSH port: `"forwardPorts": [22425]` for project A, `"forwardPorts": [22426]` for project B.

| Criterion | Assessment |
|-----------|-----------|
| Spec compliance | Native |
| Multi-project conflicts | Manual coordination required |
| Zero-config promise | Broken -- users must track ports |
| Scalability | Fails as project count grows |

**Verdict:** Unacceptable. Manual port coordination is the exact problem lace solves.

### Alternative B: `requireLocalPort` conflict detection

Declare port 2222 with `"portsAttributes": {"2222": {"requireLocalPort": true}}`.

| Criterion | Assessment |
|-----------|-----------|
| Conflict detection | Yes |
| Conflict resolution | No -- just fails |
| User experience | Error message, manual intervention |

**Verdict:** Useful as a secondary safety net, not a replacement for auto-assignment.

### Alternative C: Docker ephemeral ports

Use `appPort: ["0:2222"]` and let Docker pick.

| Criterion | Assessment |
|-----------|-----------|
| Automatic | Yes |
| Stable across restarts | No -- port changes each time |
| Pre-start knowledge | No -- port unknown until after start |
| Wezterm compatibility | Broken -- domain configs need stable port |

**Verdict:** Fundamentally incompatible with stable SSH domain registration.

### Alternative D: Post-start container label inspection

After `devcontainer up`, query `docker port <container>` or inspect labels.

| Criterion | Assessment |
|-----------|-----------|
| Works with ephemeral | Yes |
| Pre-start availability | No |
| Single-command workflow | Broken -- requires two-phase setup |
| Implementation complexity | Moderate (Docker API queries) |

**Verdict:** Could supplement but not replace pre-start assignment. The lace.wezterm plugin needs the port at domain registration time, which happens during or before `lace up`, not after.

### Alternative E: VS Code auto-port-forwarding

Rely on VS Code's runtime port detection (`remote.autoForwardPortsSource`) to discover ports opened by container processes.

| Criterion | Assessment |
|-----------|-----------|
| Automatic | Yes (within VS Code) |
| Pre-start knowledge | No -- requires running process |
| Works with devcontainer CLI | No -- VS Code feature only |
| Works with wezterm | No -- wezterm is not VS Code |

**Verdict:** Not applicable to lace. VS Code auto-port-forwarding is an IDE-level feature that detects processes listening inside the container. It does not create Docker-level port bindings, does not work with the devcontainer CLI, and cannot provide pre-start port knowledge. This is the mechanism that may create confusion about "runtime port resolution" in the spec, but it operates entirely outside the spec's `forwardPorts` / `appPort` / `portsAttributes` system.

## Current Implementation Critique

The existing `port-manager.ts` works correctly but has design limitations:

1. **Wezterm-specific.** The port range (22425-22499), container port (2222), and console messages all reference wezterm SSH. A feature needing a second dynamic port (e.g., a debug server) cannot use this system.
2. **Uses `appPort`, which is spec-deprecated but functionally correct.** The spec recommends `forwardPorts`, but the devcontainer CLI does not implement `forwardPorts`. `appPort` is the only mechanism that creates Docker-level port bindings. The deprecation is cosmetic for lace's use case -- the spec recommends `forwardPorts` because VS Code is the primary consumer, but the devcontainer CLI has not implemented the alternative. Adding `portsAttributes` for labeling is a worthwhile improvement.
3. **No label/name abstraction.** The port is a raw number with no semantic identity. Other config cannot reference "the SSH port" by name.
4. **Persistence coupled to config.** Port assignments are stored in `.lace/devcontainer.json` alongside other config, making them hard to manage independently.
5. **Sequential scanning.** The `findAvailablePort()` function checks ports one-by-one. With 75 ports this is fast, but the design does not parallelize.

## `lace.port(label)` Design Sketch

The recommended replacement is a template function that inverts control: features declare port needs, lace fulfills them.

### Usage in `customizations.lace.features`

```jsonc
{
  "customizations": {
    "lace": {
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          "port": "${lace.port(ssh)}"
        }
      }
    }
  }
}
```

### Semantics

- `${lace.port(ssh)}` resolves to an available host port (e.g., `22430`)
- The label `ssh` is a stable identifier: same label in the same project always resolves to the same port (if still available)
- Multiple labels produce distinct ports: `${lace.port(ssh)}` and `${lace.port(debug)}` never collide
- Labels are scoped to the project (workspace folder)

### Persistence

Assignments stored in `.lace/port-assignments.json`:

```json
{
  "ssh": { "hostPort": 22430, "assignedAt": "2026-02-06T10:00:00Z" },
  "debug": { "hostPort": 22431, "assignedAt": "2026-02-06T10:00:00Z" }
}
```

Separate from `.lace/devcontainer.json` so port state is managed independently of config generation.

### Port range configuration

Default range: 22425-22499 (current behavior). Configurable via `customizations.lace.portRange`:

```jsonc
{
  "customizations": {
    "lace": {
      "portRange": { "min": 22425, "max": 22499 }
    }
  }
}
```

### Generated config output

Continue using `appPort` for Docker-level port binding (required by the devcontainer CLI), and add `portsAttributes` for labeling:

```jsonc
{
  "appPort": ["22430:2222", "22431:8080"],
  "portsAttributes": {
    "22430": { "label": "ssh (lace)", "onAutoForward": "silent", "requireLocalPort": true },
    "22431": { "label": "debug (lace)", "onAutoForward": "silent", "requireLocalPort": true }
  }
}
```

The `appPort` entries create Docker-level `-p hostPort:containerPort` bindings, which is the only mechanism the devcontainer CLI supports for exposing container ports on the host. `forwardPorts` is NOT used because the devcontainer CLI does not implement it (devcontainers/cli#22). The `portsAttributes` entries are harmless in the CLI context and will be picked up if VS Code ever attaches to the same container. The `onAutoForward: "silent"` prevents notification popups for lace-managed ports, and `requireLocalPort: true` acts as a safety net (behavior depends on the implementing runtime).

## Recommendations

1. **Keep custom port management.** The dynamic assignment gap is real and no spec idiom can fill it.

2. **Genericize via `${lace.port(label)}` templating.** Replace the hardcoded wezterm logic with a label-based system any feature can use.

3. **Keep `appPort` for Docker-level port binding, add `portsAttributes` for labeling.** The devcontainer CLI does not implement `forwardPorts` (devcontainers/cli#22), so `appPort` remains the only mechanism for exposing container ports on the host. `portsAttributes` adds labeling, `onAutoForward` control, and `requireLocalPort` conflict detection. These attributes are harmless if the runtime does not honor them and beneficial when VS Code attaches to the container.

4. **Persist assignments in `.lace/port-assignments.json`.** Decouple port state from config generation for cleaner lifecycle management.

5. **Keep the 22425-22499 default range** but make it configurable. The range is well-chosen (avoids common service ports, memorable mnemonic).

6. **Add `requireLocalPort: true` as a safety net** in the generated `portsAttributes` for lace-assigned ports. If something else grabs the port between assignment and container start, the tooling will fail fast rather than silently remap. Note: enforcement of this property depends on the implementing runtime -- the devcontainer CLI may not honor it, but VS Code will if attached.
