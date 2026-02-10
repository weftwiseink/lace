---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T15:20:00-08:00
task_list: lace/dogfooding
type: devlog
state: archived
status: done
tags: [investigation, ports, dotfiles, bug-analysis]
references:
  - cdocs/reports/2026-02-09-lace-port-allocation-investigation.md
  - cdocs/reviews/2026-02-09-review-of-lace-port-allocation-investigation.md
---

# Port Allocation Investigation: Devlog

## Objective

Investigate why the dotfiles devcontainer has no port mappings despite being started via `lace up`. The container is running but invisible to `lace-discover` and `wez-into`, making wezterm SSH access impossible.

## Plan

1. Read the dotfiles devcontainer.json and its generated `.lace/` artifacts
2. Read the lace devcontainer.json for comparison (known working pattern)
3. Trace the port allocation pipeline through the source code
4. Inspect the running container via `docker inspect`
5. Identify root cause
6. Write report, review, and devlog

## Testing Approach

This was a pure investigation task -- no code changes, no tests to run. Evidence was gathered by reading source code, config files, and live container state.

## Debugging Process

### Phase 1: Evidence Gathering

Gathered evidence from five sources in parallel:

1. **Dotfiles config** (`/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`): Contains `customizations.lace.prebuildFeatures` with git, sshd, and wezterm-server. No top-level `features` block. No `appPort`.

2. **Generated artifacts** (`/home/mjr/code/personal/dotfiles/.lace/`):
   - `devcontainer.json`: No `appPort`, `forwardPorts`, or `portsAttributes` entries. Just the original config plus resolved repo mounts.
   - `port-assignments.json`: Port 22426 allocated on Feb 7 for `wezterm-server/sshPort`. This data exists but was never consumed.
   - `resolved-mounts.json`: Correctly resolved lace repo mount.

3. **Container state** (`docker inspect 04c29339ae9e`):
   - `HostConfig.PortBindings`: `{}`
   - `NetworkSettings.Ports`: `{}`
   - `devcontainer.config_file` label: points to `.lace/devcontainer.json` (confirms `lace up` was used)
   - Mounts include the lace repo mount (confirms resolve-mounts phase worked)

4. **Lace devcontainer** (`/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json`): Uses the correct pattern -- wezterm-server in `features`, explicit `appPort` with `${lace.port()}`, sshd/git in `prebuildFeatures`. Even has a comment explaining why wezterm-server must be in `features`.

5. **Source code** (`packages/lace/src/lib/up.ts`): The pipeline extracts feature IDs from `config.features` only (line 121-126). When `featureIds.length === 0` (line 133), the entire metadata/injection/resolution pipeline is skipped.

### Phase 2: Pattern Analysis

| Aspect | Lace (working) | Dotfiles (broken) |
|--------|----------------|-------------------|
| wezterm-server location | `features` | `prebuildFeatures` |
| Has `appPort` | Yes, with `${lace.port()}` | No |
| Has top-level `features` | Yes | No |
| Port pipeline runs | Yes | No (skipped: 0 feature IDs) |

### Phase 3: Root Cause Confirmed

The root cause is a configuration error. The dotfiles devcontainer places wezterm-server in `prebuildFeatures`, which is invisible to the port allocation pipeline. The pipeline only processes the top-level `features` block. With zero features to process, the entire metadata fetch, auto-injection, template resolution, and port generation pipeline is a no-op.

Additional finding: `validateNoOverlap()` in `validation.ts` prevents a feature from appearing in both `prebuildFeatures` and `features`. This means the fix requires moving wezterm-server OUT of `prebuildFeatures` and INTO `features` -- it cannot be in both. This has a tradeoff: wezterm-server will no longer be prebaked into the Docker image layer.

### Phase 4: Report Written

No code fix was made (the bug is in the dotfiles repo config, not in lace source code). Findings documented in the report with recommendations for both the immediate config fix and a defensive validation improvement in lace.

## Implementation Notes

### Key architectural insight: prebuild vs port allocation mutual exclusivity

The lace pipeline has an inherent tension: `prebuildFeatures` are baked into the Docker image for faster rebuilds, but the port allocation pipeline only processes top-level `features`. The overlap validator prevents dual placement. This means any feature that declares `customizations.lace.ports` in its metadata cannot benefit from prebuild image caching. For wezterm-server specifically, the install is lightweight (downloading a binary), so the tradeoff is acceptable.

### The discovery pipeline is port-dependent by design

`lace-discover` scans `docker ps` for port mappings in the 22425-22499 range pointing to container port 2222. This is the correct design -- port mappings are the only reliable signal that a container was set up for wezterm SSH access. But it means a misconfigured container (running sshd but with no port binding) is completely invisible. A future improvement could add a diagnostic mode to `lace-discover` that also reports containers with the `devcontainer.local_folder` label but no matching port mapping, to help debug this class of issue.

### The silent failure mode is the real problem

The most concerning aspect is not the misconfiguration itself but the silence of the failure. `lace up` completes successfully, logs "No port templates found, skipping port allocation," and proceeds to start the container. This message is technically correct but not diagnostic -- a user would need to know that "no port templates found" means "your wezterm-server feature is in the wrong block" rather than "this container doesn't use ports." A targeted warning when wezterm-server (or any port-declaring feature) is detected in `prebuildFeatures` would turn this from a debugging session into a one-line fix.

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/reports/2026-02-09-lace-port-allocation-investigation.md` | Investigation report with root cause analysis and recommendations |
| `cdocs/reviews/2026-02-09-review-of-lace-port-allocation-investigation.md` | Self-review of the report (R1) |
| `cdocs/devlogs/2026-02-09-port-allocation-investigation.md` | This devlog |

## Verification

No code changes to verify. The investigation was validated against:

- Live container state (`docker inspect` output confirms zero port bindings)
- Source code trace (confirmed `features`-only processing in `up.ts` lines 121-133)
- Comparison with known-working config (lace devcontainer)
- Overlap validation constraint confirmed in `validation.ts`

## Deferred Work

- **Config fix**: The dotfiles `devcontainer.json` needs to be updated (in the dotfiles repo, not in lace). Move wezterm-server from `prebuildFeatures` to `features` and add `appPort`.
- **Defensive validation**: A new check in `lace up` to warn when port-declaring features are in `prebuildFeatures`. This should be a separate proposal given the network overhead considerations.
- **Discovery diagnostics**: A `--debug` or `--verbose` mode for `lace-discover` that reports containers with `devcontainer.local_folder` but no matching port mapping.
