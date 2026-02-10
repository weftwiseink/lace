---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T14:30:00-08:00
task_list: lace/dogfooding
type: report
state: archived
status: done
tags: [investigation, ports, dotfiles, devcontainer, wezterm, bug]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-09T15:00:00-08:00
  round: 1
revisions:
  - at: 2026-02-09T15:15:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Corrected 'ALSO appear' to 'INSTEAD OF prebuildFeatures' and added validateNoOverlap() constraint"
      - "Added prebuild image caching tradeoff note for port-declaring features"
      - "Softened 'orphaned' language for port-assignments.json to 'unused in current runs'"
      - "Strengthened Finding 8 framing: silent failure / pit-of-failure characterization"
      - "Added network overhead caveat to defensive improvement recommendation"
---

# Lace Port Allocation Investigation: Dotfiles Container Missing Port Mappings

> **BLUF:** The dotfiles devcontainer is running with zero port mappings because the wezterm-server feature is declared in `customizations.lace.prebuildFeatures` instead of the top-level `features` block. Lace's port allocation pipeline only processes features in the `features` block -- `prebuildFeatures` are explicitly excluded from metadata fetching, auto-injection, and template resolution. This is by design for the lace devcontainer (which correctly places wezterm-server in `features`), but the dotfiles devcontainer was configured before this distinction was established. The lace devcontainer has explicit `appPort` with `${lace.port()}` and wezterm-server in `features`, so it would work correctly. The fix is to move wezterm-server from `prebuildFeatures` to `features` in the dotfiles devcontainer.json and add an `appPort` entry.

## Context / Background

The dotfiles devcontainer (`/home/mjr/code/personal/dotfiles`) is running but invisible to `lace-discover` and `wez-into`. The `docker ps` output shows no port mappings at all for the container. This makes SSH-based wezterm domain multiplexing impossible, which is the entire purpose of the wezterm-server feature in the dotfiles container.

The dotfiles container was confirmed started via `lace up` -- the container's `devcontainer.config_file` label points to `/var/home/mjr/code/personal/dotfiles/.lace/devcontainer.json`, and the `.lace/` directory contains a generated `devcontainer.json`, `port-assignments.json`, and `resolved-mounts.json`. The port allocator even assigned port 22426, but this port never made it into the generated config or the running container.

## Key Findings

### 1. The dotfiles config puts ALL features in prebuildFeatures

The dotfiles `devcontainer.json` at `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`:

```json
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

There is **no top-level `features` block**. All three features are in `prebuildFeatures`.

### 2. The lace port pipeline only processes the top-level `features` block

In `/var/home/mjr/code/weft/lace/packages/lace/src/lib/up.ts` (lines 121-126):

```typescript
// Extract feature IDs from the devcontainer.json's `features` key
const rawFeatures = (configMinimal.raw.features ?? {}) as Record<
  string,
  Record<string, unknown>
>;
const featureIds = Object.keys(rawFeatures);
```

Since the dotfiles config has no `features` key, `featureIds` is an empty array. The entire metadata fetch, validation, auto-injection, and template resolution pipeline is skipped (line 133: `if (featureIds.length > 0)`).

### 3. The port-assignments.json exists but is orphaned

The file at `/home/mjr/code/personal/dotfiles/.lace/port-assignments.json` contains:

```json
{
  "assignments": {
    "wezterm-server/sshPort": {
      "label": "wezterm-server/sshPort",
      "port": 22426,
      "assignedAt": "2026-02-07T01:03:37.040Z"
    }
  }
}
```

Port 22426 was allocated on Feb 7, but this data is unused in current runs. The `PortAllocator` loads the file from disk at construction time (line 111 in `port-allocator.ts`), so the data is present in memory. However, since no `${lace.port()}` templates existed to resolve, the allocator's `allocate()` method was never called during the most recent `lace up`, so the loaded assignment was never consumed. The assignment would be correctly reused if the config were fixed.

### 4. The generated .lace/devcontainer.json has no port entries

The generated config at `/home/mjr/code/personal/dotfiles/.lace/devcontainer.json` has no `appPort`, no `forwardPorts`, and no `portsAttributes`. It only has the original config fields plus resolved repo mounts. The `generateExtendedConfig` function in `up.ts` (lines 406-413) only generates port entries when `allocations.length > 0`, which is zero for this config.

### 5. The docker container confirms zero port bindings

`docker inspect` of container `04c29339ae9e` shows:
- `HostConfig.PortBindings`: `{}`
- `NetworkSettings.Ports`: `{}`
- No exposed ports whatsoever

### 6. The lace devcontainer is configured correctly

The lace devcontainer at `/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json` demonstrates the correct pattern:

```json
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

Key differences from dotfiles:
1. `wezterm-server` is in the top-level `features` block (not `prebuildFeatures`)
2. There is an explicit `appPort` with `${lace.port(wezterm-server/sshPort)}:2222`
3. Only non-port-declaring features (git, sshd) are in `prebuildFeatures`

The lace devcontainer even has a comment explaining this design (lines 96-97):
```
// wezterm-server MUST be here (not in prebuildFeatures) because
// lace up auto-injection reads port metadata only from the features block.
```

### 7. The discovery pipeline requires port mappings in the 22425-22499 range

`lace-discover` at `/var/home/mjr/code/weft/lace/bin/lace-discover` scans `docker ps` output for port mappings matching `[0-9]+->2222/tcp` in the 22425-22499 range. Without any port bindings on the container, the dotfiles container is filtered out entirely.

### 8. Silent failure: no validation catches this misconfiguration

The `warnPrebuildPortTemplates()` function in `template-resolver.ts` only warns when `${lace.port()}` expressions exist inside `prebuildFeatures` option values. It does NOT warn about port-declaring features being placed in `prebuildFeatures` instead of `features`. This is a pit-of-failure: the misconfiguration causes no error, no warning, and no visible output difference during `lace up`. The container starts successfully and appears healthy. The only symptom is that `lace-discover` and `wez-into` cannot find the container -- a problem that surfaces at connection time, not at build time, making it difficult to diagnose.

## Root Cause Analysis

The root cause is a **configuration error**: the dotfiles devcontainer places `wezterm-server` in `prebuildFeatures` instead of `features`. This causes three cascading failures:

1. **No metadata fetch**: The pipeline only fetches metadata for features in the `features` block. Since wezterm-server is in `prebuildFeatures`, its `customizations.lace.ports` declaration is never read.

2. **No auto-injection**: Without metadata, `autoInjectPortTemplates()` has nothing to inject. The config has no `${lace.port()}` templates and no `appPort` entries.

3. **No port generation**: With zero allocations, `generatePortEntries()` produces empty results and `mergePortEntries()` adds nothing to the output config.

The `prebuildFeatures` concept exists for a valid reason: features in `prebuildFeatures` are baked into the Docker image layer (via `lace prebuild`), avoiding re-installation on every container rebuild. However, port-declaring features must appear in the `features` block INSTEAD OF `prebuildFeatures` so the port pipeline can process them. Dual placement is not possible: `validateNoOverlap()` in `validation.ts` rejects configurations where the same feature appears in both blocks. This means port-declaring features like wezterm-server cannot benefit from prebuild image caching -- they will be installed at container creation time by the devcontainer CLI. For minimal containers like dotfiles this is an acceptable tradeoff; for heavier feature sets it introduces a build time penalty.

The lace devcontainer demonstrates the correct pattern: sshd goes in `prebuildFeatures` (it installs the SSH daemon but does not declare ports to lace), while wezterm-server goes in `features` (it declares `sshPort` via `customizations.lace.ports`). This is an inherent architectural tension in lace's design: the prebuild optimization and the port allocation pipeline are mutually exclusive for a given feature.

## Impact Assessment

### Dotfiles container
- Fully broken for wezterm SSH access
- Container runs but is invisible to `lace-discover` and `wez-into`
- sshd is running inside the container but unreachable from the host
- The prebuild image layer correctly includes wezterm-server binaries (prebuild works fine for installing the software)

### Lace devcontainer
- Would work correctly with `lace up` -- wezterm-server is in `features` and `appPort` has a `${lace.port()}` template
- Note: the lace devcontainer uses asymmetric mapping (`${lace.port(wezterm-server/sshPort)}:2222`) rather than auto-injection's symmetric approach. Both patterns are valid.

### Other devcontainers
- Any devcontainer that places port-declaring features exclusively in `prebuildFeatures` would have the same issue

## Recommendations

### Immediate fix: Move wezterm-server to features in dotfiles config

The dotfiles `devcontainer.json` should be updated to:

```json
{
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/devcontainers/features/sshd:1": {}
      }
    }
  },
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
      "version": "20240203-110809-5046fc22"
    }
  },
  "appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]
}
```

This mirrors the lace devcontainer pattern: wezterm-server in `features` with explicit asymmetric `appPort`.

Alternatively, wezterm-server can be in `features` without `appPort`, letting auto-injection create a symmetric mapping. The choice between asymmetric (explicit `appPort`) and symmetric (auto-injected) depends on whether sshd should listen on port 2222 inside the container (asymmetric) or on the lace-allocated port (symmetric).

### Defensive improvement: Warn when port-declaring features are in prebuildFeatures

A new validation check could be added to `lace up` that:
1. Fetches metadata for `prebuildFeatures` entries (not just `features`)
2. Checks if any `prebuildFeatures` entry declares `customizations.lace.ports`
3. Emits a warning like: `Feature "wezterm-server" declares ports but is in prebuildFeatures. Move it to features for port allocation to work.`

This would catch the misconfiguration at `lace up` time rather than leaving users to debug missing port mappings. Note: fetching metadata for prebuild features adds OCI registry network calls to every `lace up` invocation. This should be designed carefully -- for example, only checking prebuild features when the pipeline discovers zero port allocations (a "why no ports?" diagnostic), or using the existing filesystem cache to avoid redundant network requests.

### Documentation: Add a "common pitfalls" section

The prebuild-vs-features distinction for port-declaring features is a subtle but critical architectural constraint. A note in the lace documentation (or a comment pattern in devcontainer.json templates) would help prevent this issue for new devcontainer configurations.

## Appendix: Port Allocation Pipeline Walkthrough

For reference, the full `lace up` port allocation pipeline:

1. **Read config** (`readDevcontainerConfigMinimal`): Parse `.devcontainer/devcontainer.json`
2. **Extract feature IDs**: Read keys from `config.features` (top-level only)
3. **Fetch metadata** (`fetchAllFeatureMetadata`): For each feature, fetch `devcontainer-feature.json` via OCI registry
4. **Validate**: Check user options exist in schema, port declaration keys match options
5. **Warn prebuild templates** (`warnPrebuildPortTemplates`): Check for `${lace.port()}` in prebuildFeatures
6. **Auto-inject** (`autoInjectPortTemplates`): For features with `customizations.lace.ports`, inject `${lace.port(featureId/optionName)}` into feature options where user has not set a value
7. **Resolve templates** (`resolveTemplates`): Walk entire config tree, replace `${lace.port()}` with allocated port numbers
8. **Generate port entries** (`generatePortEntries`): Create `appPort`, `forwardPorts`, `portsAttributes` for allocated ports (suppressing entries user already provided)
9. **Merge** (`mergePortEntries`): Combine auto-generated entries with user-provided entries
10. **Write** (`generateExtendedConfig`): Output `.lace/devcontainer.json` with all resolved values

The dotfiles container fails at step 2 -- with no `features` block, the rest of the pipeline is a no-op.
