---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T11:30:00-08:00
task_list: lace/wezterm-plugin
type: report
state: live
status: review_ready
tags: [devcontainer, metadata, docker, labels, registry, ports, wez-into, discovery]
related_to:
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
  - cdocs/proposals/2026-02-10-wez-into-workstream-closeout.md
  - cdocs/reports/2026-02-08-wez-into-cli-command-status.md
  - cdocs/reports/2026-02-09-lace-port-allocation-investigation.md
---

# Devcontainer Metadata and Lace Registry Research

> **BLUF:** Docker labels on devcontainers contain rich metadata that is fully queryable on stopped containers -- `devcontainer.local_folder`, `devcontainer.config_file`, and `devcontainer.metadata` (a JSON array with feature IDs, `remoteUser`, port attributes, and lace-specific customizations). Lace has no global registry; all state is per-project (`.lace/port-assignments.json`) or per-user (`~/.config/lace/settings.json`, `~/.config/lace/cache/`). The port allocator is strictly per-project with no cross-project collision detection -- it relies on runtime TCP probing to avoid conflicts. For the `--start` flag, Docker labels on stopped containers are the strongest signal: they provide the `local_folder` (workspace path) needed by `devcontainer up` and the port bindings that confirm the container is lace-managed. A `projects.conf` file adds value only for never-started projects. A global lace registry is unnecessary -- Docker itself is the registry.

## Docker Label Inventory

Five stopped devcontainers were inspected. Labels fall into three categories: devcontainer CLI labels, base image labels, and OCI standard labels.

### Devcontainer CLI Labels (present on all devcontainers)

| Label | Description | Example Value |
|-------|-------------|---------------|
| `devcontainer.local_folder` | Absolute path to the workspace folder on the host | `/var/home/mjr/code/weft/lace` |
| `devcontainer.config_file` | Absolute path to the devcontainer.json used to create the container | `/var/home/mjr/code/weft/lace/.lace/devcontainer.json` |
| `devcontainer.metadata` | JSON array of merged metadata from features and the devcontainer config | (see Metadata Analysis below) |

These three labels are set by the devcontainer CLI on every container it creates. They are the primary mechanism by which the CLI rediscovers containers on subsequent `devcontainer up` runs.

### Base Image Labels (present on image-based containers)

The dotfiles container (built from `devcontainers/base:ubuntu`) has additional labels from the base image:

| Label | Description | Example Value |
|-------|-------------|---------------|
| `dev.containers.features` | Features baked into the base image | `common` |
| `dev.containers.id` | Base image identifier | `base-ubuntu` |
| `dev.containers.release` | Base image release version | `v0.4.24` |
| `dev.containers.source` | Source repository URL | `https://github.com/devcontainers/images` |
| `dev.containers.timestamp` | Build timestamp | `Fri, 30 Jan 2026 16:52:34 GMT` |
| `dev.containers.variant` | Ubuntu variant | `noble` |

### OCI Standard Labels (present on some images)

| Label | Description | Example Value |
|-------|-------------|---------------|
| `org.opencontainers.image.ref.name` | Image reference name | `ubuntu` |
| `org.opencontainers.image.version` | Image version | `24.04` |
| `version` | Generic version label | `2.1.6` |

### Lace-Specific Labels

There are **no lace-specific Docker labels**. Lace does not add its own labels to containers. All lace-specific information is embedded within the `devcontainer.metadata` JSON array (inside the last entry, under `customizations.lace`). This is significant for `--start` design: there is no label-based way to filter for "lace-managed containers" versus "plain devcontainers." However, the presence of `portsAttributes` with ports in the 22425-22499 range within the metadata is a reliable heuristic.

## Metadata Analysis

The `devcontainer.metadata` label is a JSON array. Each entry comes from a different source: installed features contribute entries with an `id` field, and the devcontainer.json config contributes the final entry with lifecycle commands, customizations, mounts, and port configuration.

### Lace Container (7 entries)

| Entry | Source | Key Fields |
|-------|--------|------------|
| 0 | `ghcr.io/devcontainers/features/git:1` | `id`, `customizations.vscode` |
| 1 | `ghcr.io/devcontainers/features/sshd:1` | `id`, `entrypoint`, `customizations.vscode` |
| 2 | `ghcr.io/anthropics/devcontainer-features/claude-code:1` | `id`, `customizations.vscode` |
| 3 | `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` | `id` only |
| 4 | `ghcr.io/eitsupi/devcontainer-features/nushell:0` | `id` only |
| 5 | `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` | `id` only |
| 6 | devcontainer.json config | `postCreateCommand`, `postStartCommand`, `customizations.lace`, `mounts`, `containerEnv`, `portsAttributes`, `forwardPorts` |

The final entry (6) contains the lace-relevant data:
- `portsAttributes`: `{"22426": {"label": "wezterm-server/hostSshPort (lace)", "requireLocalPort": true}}`
- `forwardPorts`: `[22426]`
- `customizations.lace.prebuildFeatures`: Lists features that were prebuilt

### Dotfiles Container (7 entries)

| Entry | Source | Key Fields |
|-------|--------|------------|
| 0 | `ghcr.io/devcontainers/features/common-utils:2` | `id` only (from base image) |
| 1 | `ghcr.io/devcontainers/features/git:1` | `id`, `customizations.vscode` |
| 2 | Base image config | `remoteUser: "vscode"` (no `id`) |
| 3 | `ghcr.io/devcontainers/features/git:1` | `id`, `customizations.vscode` (duplicate) |
| 4 | `ghcr.io/devcontainers/features/sshd:1` | `id`, `entrypoint`, `customizations.vscode` |
| 5 | `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` | `id` only |
| 6 | devcontainer.json config | `postStartCommand`, `customizations.lace`, `mounts`, `portsAttributes`, `forwardPorts` |

Notable differences from the lace container:
- Entry 2 has `remoteUser: "vscode"` with no `id` -- this comes from the base image's metadata, not a feature
- Features can appear duplicated (git:1 appears twice) when installed both via the base image and via the config
- `customizations.lace.repoMounts` appears in the config entry, reflecting lace's repo mount configuration

### Non-Lace Containers (weft, docutype, main)

These containers have `devcontainer.metadata` with feature entries and a config entry, but:
- No `portsAttributes` or `forwardPorts` in the config entry
- No `customizations.lace` section
- The `main` container has `PortBindings: {"2222/tcp":[{"HostIp":"","HostPort":"2222"}]}` -- a legacy hardcoded port outside the lace range
- The `weft` and `docutype` containers have empty `PortBindings: {}`

### Key Metadata Findings

1. **`remoteUser` is in the metadata** (when set by the base image or config). This is how `lace-discover` can determine the SSH username.
2. **Port assignments are in the metadata** via `portsAttributes` and `forwardPorts`. The allocated port number (e.g., 22426) is baked into the label at container creation time.
3. **Lace customizations are in the metadata** (`customizations.lace`), including `prebuildFeatures` and `repoMounts`. This means a stopped container's metadata reveals whether it was lace-managed.
4. **Feature IDs are in the metadata**, allowing identification of which features (including wezterm-server) are installed.
5. **The metadata is immutable** -- it is set at container creation time and does not change when the container is stopped/started. Port assignments baked into the metadata remain valid across stop/start cycles.

## Lace Registry State

### Global State: Minimal

Lace has no global registry in the traditional sense. The global footprint is:

| Path | Contents | Purpose |
|------|----------|---------|
| `~/.config/lace/settings.json` | JSONC with `repoMounts` overrides | User-level settings (e.g., override mount sources for local development) |
| `~/.config/lace/cache/features/` | Cached feature metadata JSON files | Avoid repeated OCI registry fetches (24h TTL for floating tags, permanent for pinned versions) |
| `~/.config/lace/lace-test-*` | Temporary directories from test runs | Test artifacts (should be cleaned up) |

The settings file contains only repo mount overrides -- no project list, no port registry, no container tracking.

### Per-Project State

Each lace-managed project has a `.lace/` directory:

| File | Contents | Purpose |
|------|----------|---------|
| `.lace/devcontainer.json` | Generated extended config | The config passed to `devcontainer up` (includes resolved ports, mounts) |
| `.lace/port-assignments.json` | `{assignments: {label: {port, assignedAt}}}` | Persisted port allocations for stability across rebuilds |
| `.lace/resolved-mounts.json` | Resolved mount specifications | (present when repo mounts are configured) |
| `.lace/prebuild/` | Prebuild artifacts | Dockerfile and context for prebuilt features |

Current port assignments observed:
- Lace: `wezterm-server/hostSshPort` = 22426
- Dotfiles: `wezterm-server/hostSshPort` = 22425

## Port Allocator Architecture

### Strictly Per-Project

The `PortAllocator` class (at `/var/home/mjr/code/weft/lace/packages/lace/src/lib/port-allocator.ts`) is instantiated per `lace up` invocation with a single workspace folder. It:

1. **Loads** from `.lace/port-assignments.json` in the workspace folder
2. **Allocates** ports in the 22425-22499 range (75 ports total)
3. **Persists** back to `.lace/port-assignments.json`

### No Cross-Project Coordination

There is no global port ledger. The allocator avoids collisions via two mechanisms:

1. **Reuse existing assignment**: If the project already has a persisted assignment and the port is available, reuse it (stable across rebuilds).
2. **TCP probing**: If the existing port is in use (or no assignment exists), scan the range for the first port that is not bound on localhost (`isPortAvailable()` does a TCP connect with 100ms timeout).

This means:
- Two simultaneous `lace up` runs could race and allocate the same port (unlikely in practice but architecturally possible).
- A stopped container's port is "available" by TCP probe, so another project starting while the first is stopped could claim the same port. When the first project restarts, it would detect the conflict and reassign.
- The 75-port range is generous for the current scale (2 projects) but could become tight with many simultaneous devcontainers.

### Port Collision Scenario

If lace (port 22426) is stopped and a new project runs `lace up`, the new project's TCP probe would find 22425 in use (dotfiles) and 22426 available (lace is stopped), so it would allocate 22426. When lace restarts, its persisted assignment (22426) would be detected as in-use, and it would reassign to the next available port. The port-assignments.json would be updated. The `portsAttributes` label on the old lace container would still say 22426, but the new container would have the new port.

## Stopped Container Discovery

### Labels are fully queryable on stopped containers

All Docker labels (`devcontainer.local_folder`, `devcontainer.config_file`, `devcontainer.metadata`) are preserved on stopped containers and queryable via `docker inspect` or `docker ps -a --filter`. This was confirmed across 5 stopped containers.

### Port bindings are queryable on stopped containers

`HostConfig.PortBindings` is preserved:
- Lace (stopped): `{"2222/tcp":[{"HostIp":"","HostPort":"22426"}]}`
- Dotfiles (stopped): `{"2222/tcp":[{"HostIp":"","HostPort":"22425"}]}`

This means a `--start` implementation can:
1. Query Docker for stopped containers with `devcontainer.local_folder` label
2. Check `PortBindings` for ports in the lace range (22425-22499)
3. Extract the workspace folder from `devcontainer.local_folder`
4. Run `docker start <container_id>` (fast) or `devcontainer up --workspace-folder <path>` (full lifecycle)

### How `devcontainer up` rediscovers containers

The devcontainer CLI uses the `--id-label` mechanism. From the help output:

> `--id-label`: Id label(s) of the format name=value. These will be set on the container and used to query for an existing container. If no --id-label is given, one will be inferred from the --workspace-folder path.

When `devcontainer up --workspace-folder /path/to/project` is run:
1. The CLI infers an id-label from the workspace folder path
2. It queries Docker for containers matching that label
3. If a matching container exists (running or stopped), it reuses it
4. If no matching container exists, it creates a new one

This means `devcontainer up` already handles the stopped-container case natively -- it will find the stopped container and start it. There is no need for `wez-into --start` to implement its own stopped-container lookup if it delegates to `devcontainer up`.

### Container removal vs stop

Stopped containers retain all labels and configuration. Removed containers (`docker rm`) lose everything. The devcontainer CLI does not remove containers on stop -- it leaves them in the `Exited` state. Only explicit `docker rm`, `devcontainer down`, or `--remove-existing-container` flag removes them.

## Recommendations for `--start` Flag Design

### Recommendation 1: Use `devcontainer up` as the primary start mechanism

`devcontainer up --workspace-folder <path>` already handles both "container exists but stopped" and "no container exists" cases. The `--start` flag should delegate to `devcontainer up` rather than implementing Docker start logic directly. This gets lifecycle management (post-start commands, mounts, etc.) for free.

**Tradeoff:** `devcontainer up` is slower than `docker start` for the "stopped container, just restart it" case. It re-evaluates the config and may rebuild. For a faster path, `docker start <container_id>` followed by `docker exec <container_id> <postStartCommand>` would be faster but would bypass the devcontainer CLI's lifecycle hooks. The simpler approach (always use `devcontainer up`) is recommended for Phase 3, with optimization possible later.

### Recommendation 2: Use Docker labels for stopped-container lookup, not a global registry

The workspace folder path needed by `devcontainer up` can be obtained from stopped containers via:
```bash
docker ps -a --filter "label=devcontainer.local_folder" --filter "status=exited" \
  --format '{{.Label "devcontainer.local_folder"}}'
```

This eliminates the need for a global registry or `projects.conf` for the common case (container was previously started). Docker itself serves as the registry.

### Recommendation 3: Use `projects.conf` only as a fallback for never-started projects

A `~/.config/lace/projects.conf` file (as proposed in the wez-into proposal) adds value only when:
- The container has never been started on this machine
- The container was explicitly removed (`docker rm`)

For these edge cases, a simple `project=path` mapping file is sufficient. It should not be required -- discovery from Docker labels should be the primary path.

### Recommendation 4: Do not build a global lace registry

The research shows that:
- Docker labels are a reliable, persistent, queryable source of container metadata
- Per-project `.lace/` state is sufficient for port allocation
- The devcontainer CLI already handles container rediscovery via labels
- A global registry would duplicate information already available from Docker and add synchronization complexity (what happens when a container is removed outside of lace?)

The `--start` resolution order should be:
1. **Running containers** (via `lace-discover`): Already running, just connect
2. **Stopped containers** (via Docker label query): Get workspace path from `devcontainer.local_folder`, run `devcontainer up`
3. **`projects.conf`** (optional file): For never-started or removed containers
4. **Error with helpful message**: Tell the user to provide the workspace path

### Recommendation 5: Consider a `--start` that stays lace-agnostic

The `--start` flag could work without any lace-specific infrastructure:
```bash
# Step 1: Check running containers (lace-discover, requires lace port range)
# Step 2: Check stopped devcontainers (Docker labels, works for any devcontainer)
# Step 3: Run devcontainer up (devcontainer CLI, works for any devcontainer)
```

Steps 2 and 3 work for any devcontainer, not just lace-managed ones. The only lace-specific part is Step 1 (the port range filter). This means `--start` could potentially start non-lace devcontainers too, but the connection step (WezTerm SSH domain) would only work for containers with SSH port mappings in the lace range. The implementation should verify the started container has a lace-range port before attempting connection, or fall back to `devcontainer up` output parsing.

### Recommendation 6: Port stability across stop/start cycles

The current port allocator design means ports can shift if containers are started in a different order. For `--start` to work reliably, it should:
1. Read the target project's `.lace/port-assignments.json` to know the expected port
2. After `devcontainer up`, verify the port mapping matches expectations
3. If it shifted, re-run `lace-discover` to get the new port

Alternatively, since `devcontainer up` reuses the `.lace/devcontainer.json` (which has the resolved port baked in), the port should remain stable as long as the `.lace/` state is intact.

## Appendix: Raw Label Data

### Labels Unique to Lace-Managed Containers (in metadata)

These fields appear in the `devcontainer.metadata` config entry only for lace-managed containers:

- `customizations.lace.prebuildFeatures` -- features prebuilt into the image
- `customizations.lace.repoMounts` -- cross-project repo mount configuration
- `portsAttributes` with ports in 22425-22499 range
- `forwardPorts` with ports in 22425-22499 range
- Port labels containing "(lace)" suffix (e.g., `"wezterm-server/hostSshPort (lace)"`)

### Labels Common to All Devcontainers

- `devcontainer.local_folder` -- always present, set by devcontainer CLI
- `devcontainer.config_file` -- always present, set by devcontainer CLI
- `devcontainer.metadata` -- always present, contains merged feature + config metadata
