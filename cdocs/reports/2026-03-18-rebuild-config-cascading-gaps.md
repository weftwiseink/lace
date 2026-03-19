---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-18T00:00:00-07:00
task_list: lace/devcontainer-lifecycle
type: report
state: live
status: wip
tags: [investigation, bug, devcontainer, rebuild, config-drift]
---

# `lace up --rebuild` Does Not Cascade Runtime Config Changes

> BLUF: `lace up --rebuild` only rebuilds the prebuild Docker image; it does not
> pass `--rebuild` to the underlying `devcontainer up` CLI, so the existing
> container is silently reused with stale environment variables, mount paths, and
> labels. This is the root cause of the clauthier `mountTarget` bug and
> represents a broader class of config-cascading gaps where lace correctly
> regenerates desired state but fails to propagate it to the running container.

## Context / Background

The clauthier project's devcontainer.json originally used `mountTarget: "/workspace/lace"` (copied from lace's own config). After changing it to `"/workspaces/clauthier"` and running `lace up --rebuild` (including wiping the Docker build cache), wezterm SSH into the container still landed at `/workspace/lace/main` -- the stale path from the original configuration.

This investigation traced the full code path from devcontainer.json parsing through config generation to container lifecycle to identify the root cause and any related gaps.

## Key Findings

### The Primary Bug

1. **`--rebuild` is consumed by lace and never forwarded to `devcontainer up`.**
   - `commands/up.ts:80` explicitly filters `--rebuild` out of `devcontainerArgs`
   - `lib/up.ts:564` passes `rebuild` only to `runPrebuild({ force: rebuild })` to trigger an image rebuild with `--no-cache`
   - `lib/up.ts:892` spreads `devcontainerArgs` (which no longer contains `--rebuild`) into the `devcontainer up` invocation
   - Result: the prebuild image is rebuilt, but `devcontainer up` sees an existing container matching the workspace and reuses it

2. **Docker container env vars are immutable after creation.** `CONTAINER_WORKSPACE_FOLDER` is set at `docker create` time (`lib/up.ts:843-847`) and cannot change without recreating the container. The `wez-into` script (`bin/wez-into:440-442`) reads this value via `docker inspect`, getting the stale path.

3. **Config generation is correct.** `workspace-layout.ts:157-164` correctly computes `workspaceMount` and `workspaceFolder` from the current `mountTarget`. The `.lace/devcontainer.json` written at `lib/up.ts:858` reflects the desired state. The problem is purely that the running container is not recreated.

### The Broader Gap: No Config Drift Detection

Lace regenerates `.lace/devcontainer.json` on every `lace up` invocation but never compares it against the previous run or the running container's actual state. There is no mechanism to:
- Detect that runtime-affecting config has changed
- Warn the user that a rebuild is needed
- Automatically trigger container recreation when warranted

### Full Inventory of Cascading Gaps

| # | Gap | Location | Severity |
|---|-----|----------|----------|
| 1 | `--rebuild` not forwarded to `devcontainer up` | `commands/up.ts:80`, `lib/up.ts:892` | **Critical** |
| 2 | No config drift detection between runs | `lib/up.ts` (absent) | **High** |
| 3 | `wez-into --start` does not pass `--rebuild` | `bin/wez-into:182` | Medium |
| 4 | Docker labels/name immutable after creation | `lib/up.ts:829-837` | Medium |
| 5 | No user-facing command to check config staleness | Missing feature | Medium |
| 6 | Stale port allocations never garbage-collected | `port-allocator.ts:138-169` | Low |
| 7 | Mount assignments not cleaned for removed declarations | `mount-resolver.ts:141-167` | Low |

Gaps 3-5 are consequences of gaps 1-2. If `--rebuild` cascaded properly and drift was detected, the downstream issues would not manifest.

## Analysis

### Why the Current Design Exists

The separation of `--rebuild` (prebuild-only) likely reflects an early design where:
- Prebuild was the primary caching layer users needed to control
- Container recreation was assumed to be handled by `devcontainer up` itself (which does recreate on image changes, but not on runtime config changes)
- The `devcontainer` CLI's own `--rebuild` flag was perhaps seen as destructive (it removes the container and recreates from scratch)

### The Semantic Mismatch

Users interpret `lace up --rebuild` as "tear everything down and rebuild from scratch." The actual behavior is "rebuild only the prebuild image layer." This semantic gap is the core UX problem.

### Properties Requiring Container Recreation vs Image Rebuild

| Requires Container Recreation | Requires Image Rebuild |
|-------------------------------|----------------------|
| `containerEnv` | `features` / `prebuildFeatures` |
| `mounts` / mount targets | Dockerfile changes |
| `workspaceMount` / `workspaceFolder` | `build.args` |
| `runArgs` (labels, name, etc.) | Base image changes |
| `forwardPorts` / `appPort` | |
| `remoteUser` | |
| `postCreateCommand` | |

The prebuild system handles image-level changes correctly. The gap is entirely in runtime config changes that require container recreation.

### The `wez-into` Fallback Chain

`bin/wez-into:435-456` resolves the workspace folder via:
1. `CONTAINER_WORKSPACE_FOLDER` from `docker inspect` env (stale if container not recreated)
2. `WorkingDir` from the Docker image (hardcoded in Dockerfile as `/workspace`)

Neither source reflects the current devcontainer.json. The fallback chain has no path to the desired state short of container recreation.

## Recommendations

1. **Immediate fix:** When `lace up --rebuild` is passed, also pass `--rebuild` (or `--remove-existing-container`) to the `devcontainer up` invocation. This is a minimal change at `lib/up.ts:892`.

2. **Config drift detection:** Save a hash or copy of the generated `.lace/devcontainer.json` and compare on subsequent runs. When runtime-affecting properties differ, either auto-pass `--rebuild` or warn the user. See the companion proposal for detailed design.

3. **Garbage collection:** Implement periodic cleanup of orphaned port allocations and mount assignments. Low priority but prevents long-term state accumulation.
