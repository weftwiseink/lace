---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T12:00:00-07:00
task_list: lace/podman-migration
type: report
state: archived
status: done
tags: [architecture, ssh, podman, migration, analysis]
---

# Viability Analysis: SSH to Podman Exec Migration for Container Entry

> BLUF: Switching lace from SSH-based container entry to direct `podman exec` is feasible for the local-only use case and would eliminate the entire SSH infrastructure (sshd feature, key management, port allocation, host key rotation, known_hosts maintenance).
> The migration touches every layer of the connection stack: 6 bin scripts, 2 devcontainer features, the port allocator, template resolver, lace.wezterm plugin, and sprack's container detection.
> The primary gain is removing the dominant source of tmux metadata staleness issues (port changes on rebuild) and simplifying the connection model from "SSH with 7 options" to "podman exec with 2 arguments."
> The primary cost is losing remote container support entirely and requiring WezTerm integration to shift from SSH/ExecDomains to a different mechanism.

## Context / Background

Lace connects to devcontainers via SSH, using a dedicated sshd running inside each container on a port in the 22425-22499 range.
This architecture was inherited from the wezterm-server era, where SSH carried the WezTerm mux protocol.
The mux server was abandoned in favor of "tab mode" (raw SSH subprocesses), but the SSH infrastructure remained because it was the only transport.

The SSH layer is the root cause or contributing factor in multiple persistent issues:
- **Port allocation staleness**: when containers rebuild, ports may change, causing tmux metadata (`@lace_port`) to become stale (see `cdocs/proposals/2026-03-25-rfp-stale-tmux-lace-metadata.md`).
- **Host key management**: every container rebuild requires `ssh-keyscan` to refresh the known_hosts file; failure produces SSH prompts or connection refusal.
- **Key provisioning**: the `lace-fundamentals` feature must bind-mount `~/.config/lace/ssh/id_ed25519.pub` as `authorized_keys` into the container, adding a mount dependency that has caused silent failures.
- **SSH option complexity**: every connection requires 7 SSH options (`IdentityFile`, `IdentitiesOnly`, `UserKnownHostsFile`, `StrictHostKeyChecking`, `ControlMaster`, `ControlPath`, `ControlPersist`), duplicated across `lace-into`, `lace-split`, `lace-paste-image`, and the wezterm plugin.
- **Sprack coupling**: sprack-poll identifies container panes by checking `@lace_port` tmux metadata, which in turn depends on the SSH port being correct and discoverable.

The user's current setup is local-only: podman containers on the same host.
Remote container support is explicitly out of scope.

## Key Findings

### 1. SSH Infrastructure Footprint

The SSH dependency spans the following components:

| Component | SSH Dependency | Lines Affected |
|-----------|---------------|----------------|
| `bin/lace-into` | SSH arg construction, host key refresh, port-based discovery, tmux metadata | ~200 lines |
| `bin/lace-split` | SSH arg construction with 7 options, port/user metadata propagation | ~30 lines |
| `bin/lace-discover` | Port-range scanning (`22425-22499 -> 2222/tcp`) as container detection | ~20 lines |
| `bin/lace-paste-image` | SCP with SSH options for clipboard bridging | ~25 lines |
| `bin/lace-disconnect-pane` | Respawns SSH panes with local shell | ~5 lines |
| `bin/lace-inspect` | Checks `pgrep sshd` in container | ~5 lines |
| `devcontainers/features/src/lace-fundamentals/` | sshd dependency, SSH hardening, SSH directory prep, authorized_keys mount | ~80 lines + feature.json |
| `packages/lace/src/lib/port-allocator.ts` | Entire module (194 lines) exists for SSH port allocation | 194 lines |
| `packages/lace/src/lib/template-resolver.ts` | `${lace.port()}` template system, auto-injection, port entries generation | ~300 lines |
| `packages/lace/src/commands/up.ts` / `up.ts` | Port allocation pipeline, `appPort`/`forwardPorts`/`portsAttributes` generation | ~100 lines |
| lace.wezterm plugin (external repo) | ExecDomain registration per port, SSH arg building, port-based project discovery | ~200 lines |
| sprack-poll (external) | `@lace_port` metadata for container pane detection | ~30 lines |

**Total estimated SSH-coupled code**: ~1,200 lines across 12+ files in 3+ repos.

### 2. What `podman exec` Provides

`podman exec` connects to a running container by name or ID with no network layer:

```bash
podman exec -it <container-name-or-id> bash -l
```

Key properties:
- **No network transport**: uses the container runtime's native API (Unix socket to `conmon`), not TCP/SSH.
- **No authentication**: the host user who started the container has implicit exec access. No keys, no passwords, no host key verification.
- **No port mapping**: container identity is by name/ID, not by port. No port allocation, no port staleness.
- **TTY support**: `-it` provides a fully interactive terminal with proper signal handling.
- **User specification**: `--user <user>` sets the exec user, replacing SSH's `user@localhost`.
- **Working directory**: `--workdir <path>` sets the initial CWD, replacing SSH's `cd <workspace> && exec $SHELL -l`.
- **Environment injection**: `--env KEY=VAL` injects environment variables into the exec session.

The connection command reduces from:
```bash
ssh -o IdentityFile=~/.config/lace/ssh/id_ed25519 \
    -o IdentitiesOnly=yes \
    -o UserKnownHostsFile=~/.ssh/lace_known_hosts \
    -o StrictHostKeyChecking=no \
    -o ControlMaster=auto \
    -o ControlPath=~/.ssh/lace-ctrl-%C \
    -o ControlPersist=600 \
    -t -p 22425 node@localhost \
    "cd /workspaces/project && exec \$SHELL -l"
```

To:
```bash
podman exec -it --user node --workdir /workspaces/project <container-id> /bin/bash -l
```

### 3. Container Identity: Port vs Name/ID

The current architecture uses the SSH port as the primary container identifier throughout the stack.
`lace-discover` finds containers by scanning for port mappings in the 22425-22499 range.
`@lace_port` is the key tmux metadata field.
The port is the ExecDomain name suffix in wezterm (`lace:22425`).

With `podman exec`, container identity shifts to the container name or ID.
The devcontainer CLI already labels containers with `devcontainer.local_folder` and lace adds `lace.project_name`.
Discovery becomes: find containers by label, extract the name/ID.
No port scanning required.

This eliminates the entire class of "port staleness" bugs: a container's name/ID is stable across restarts (unless the container is fully removed and recreated, in which case the old container is gone anyway).

### 4. Impact on tmux Metadata and Stale State

Current tmux metadata set by `lace-into`:
- `@lace_port` (session + pane level): SSH port for the container
- `@lace_user` (session + pane level): SSH user
- `@lace_workspace` (session + pane level): container workspace path

With podman exec, this becomes:
- `@lace_container` (session + pane level): container name or ID
- `@lace_user` (session + pane level): exec user (unchanged semantics)
- `@lace_workspace` (session + pane level): workspace path (unchanged semantics)

The critical difference: `@lace_container` is stable across container restarts.
A stopped-then-started container retains its name and ID.
Only a full `devcontainer up --remove-existing-container` changes the container ID, and in that case `lace-into --start` would naturally re-discover the new container.

This directly addresses the problem described in `cdocs/proposals/2026-03-25-rfp-stale-tmux-lace-metadata.md`: the metadata becomes stale primarily because the port changes on rebuild.
With container name/ID as the identifier, rebuilds that preserve the container name produce no metadata staleness.

### 5. Impact on tmux/Container Multiplexing Issues

The persistent issues with `lace-into` setting up tmux state stem from several SSH-related failure modes:

**Dead panes on rebuild**: When a container rebuilds, the SSH connection drops. The pane dies. `remain-on-exit failed` preserves the dead pane. Recovery requires `lace-into` to detect the dead pane and `respawn-pane` with fresh SSH args (including the possibly-new port).

With podman exec: the exec session also terminates on container stop, so panes still die on rebuild.
The difference is that `respawn-pane` uses the same container name (no port re-discovery needed), and the command is simpler (no SSH option construction).
The failure mode is the same, but recovery is simpler and more reliable.

**Split pane failures**: `lace-split` constructs SSH commands with 7 options and the port/user from pane-level tmux metadata.
If `@lace_port` is stale, the split fails with "connection refused."
With podman exec, `lace-split` uses `@lace_container` which is stable, so splits succeed as long as the container is running.

**`@lace_workspace` flakiness**: The RFP documents cases where `@lace_port` is set but `@lace_workspace` is empty.
This is likely a timing issue in `lace-into` where the workspace is resolved from `lace-discover` output.
With podman exec, the workspace is resolved from `docker inspect` (same as today) or from the `CONTAINER_WORKSPACE_FOLDER` env var.
The fundamental race condition persists, but the reduced complexity of the connection flow reduces the surface area for partial-metadata failures.

**Assessment**: podman exec does not eliminate all tmux state management issues, but it removes the dominant failure mode (port staleness) and simplifies the recovery path for others.

### 6. WezTerm Integration Without SSH

The current wezterm integration uses two mechanisms:
1. **ExecDomains** (`lace:<port>`): wrap `ssh` commands with a fixup function. Panes inherit the domain on split, so splits automatically SSH into the container. This is the primary connection mode.
2. **SSH Domains** (`lace-mux:<port>`): for backward compatibility and cold-start fallback. Unused in normal operation.

Without SSH, ExecDomains can still work: the fixup function wraps `podman exec` instead of `ssh`.
The domain name changes from port-based (`lace:22425`) to container-based (`lace:project-name` or `lace:<container-id>`).

```lua
local function make_exec_fixup(container_id, default_user)
  return function(cmd)
    local user = ... -- resolve user
    local workspace = ... -- resolve workspace
    cmd.args = {
      "podman", "exec", "-it",
      "--user", user,
      "--workdir", workspace,
      container_id, "/bin/bash", "-l",
    }
    return cmd
  end
end
```

The ExecDomain mechanism is transport-agnostic: it wraps any command.
The migration is primarily renaming and simplifying the fixup function.

The `wez-into` script was already deleted in favor of `lace-into` + tmux, so there is no wezterm-specific CLI to migrate.

**Limitation**: ExecDomains are registered at config load time for the full port range (75 domains).
With container-based identity, domains must be registered per-discovered-container.
This changes the registration from static (port range) to dynamic (discovered containers), requiring a config reload when containers change.
This is the same pattern as the current Docker-query-at-config-load approach.

### 7. What Would Be Removed

The following components become unnecessary with podman exec:

1. **`devcontainers/features/sshd:1` dependency** in `lace-fundamentals`: the sshd feature can be dropped entirely.
2. **SSH hardening step** (`steps/ssh-hardening.sh`): no sshd means no hardening needed.
3. **SSH directory step** (`steps/ssh-directory.sh`): no SSH keys in the container.
4. **`authorized-keys` mount declaration** in `lace-fundamentals/devcontainer-feature.json`: no SSH = no authorized_keys.
5. **`~/.config/lace/ssh/` key pair**: no SSH = no keys to manage.
6. **`~/.ssh/lace_known_hosts`**: no SSH = no host key management.
7. **Port allocator** (`port-allocator.ts`, 194 lines): ports are no longer needed for SSH.
8. **Port allocation pipeline** in `up.ts`: no port allocation step.
9. **`${lace.port()}` template expressions** for SSH: the sshd port template is the primary consumer. Other features that use port templates (like `portless`) may still need ports for their own services.
10. **`appPort` generation** for SSH ports: no SSH port to map.
11. **`refresh_host_key()`** in `lace-into`: no host keys.
12. **SSH arg construction** in `lace-into`, `lace-split`, `lace-paste-image`: replaced with `podman exec` args.
13. **SSH ControlMaster/ControlPath/ControlPersist**: connection multiplexing is unnecessary since `podman exec` has no TCP overhead.

> NOTE(opus/lace/podman-migration): The port allocator is still needed for non-SSH features that declare ports (e.g., `portless`).
> The migration removes the SSH port allocation but does not necessarily eliminate the port system entirely.
> The `${lace.port()}` template system would still serve features like portless that need host-to-container port mapping for non-SSH services.

### 8. What Would Not Change

1. **`lace up` pipeline**: the core config generation (workspace layout, feature metadata, mount resolution, prebuilds, repo mounts) is SSH-agnostic. Only the port injection step changes.
2. **Mount system**: bind mounts for dotfiles, screenshots, repo mounts are transport-independent.
3. **`lace-discover` core logic**: still queries Docker labels. The output format changes from port-based to container-name-based.
4. **tmux session architecture**: still session-per-project. Only the pane command changes from SSH to podman exec.
5. **Container lifecycle**: `devcontainer up` still creates the container. Podman exec just changes how we enter it.

### 9. `lace-paste-image` and File Transfer

`lace-paste-image` currently uses SCP over the SSH connection to transfer clipboard images from the host into the container.
With podman exec, SCP is unavailable.

Alternatives:
- **`podman cp`**: `podman cp /tmp/image.png <container>:/tmp/image.png` copies files into a running container. This is the direct replacement.
- **Bind mount**: if a shared temp directory is bind-mounted, the host can write directly and the container sees it immediately. No copy needed.
- **stdin pipe**: `podman exec -i <container> tee /tmp/image.png < /tmp/image.png` writes via stdin.

The `podman cp` approach is the most straightforward 1:1 replacement.

### 10. Sprack Integration Impact

Sprack-poll currently uses `@lace_port` as the signal that a pane belongs to a container.
`LaceContainerResolver` reads `@lace_workspace` and `@lace_port` to resolve session files.

With podman exec:
- `@lace_port` becomes `@lace_container` (container name/ID).
- The detection signal changes from "has a port" to "has a container name."
- `LaceContainerResolver` would use the container name to look up the bind mount paths (via `docker inspect`), replacing the port-based lookup.

The RFP at `cdocs/proposals/2026-03-25-rfp-sprack-lace-decoupling.md` already identifies the tight coupling between sprack and lace's tmux metadata scheme.
A podman exec migration would be an appropriate time to implement the decoupling: instead of changing from `@lace_port` to `@lace_container`, adopt one of the RFP's proposed approaches (config file discovery, hook event bridge, or the environment variable pattern).

## Cost/Benefit Summary

### Benefits

1. **Eliminate port staleness bugs**: the dominant failure mode in tmux metadata management disappears.
2. **Remove SSH infrastructure**: ~1,200 lines of SSH-specific code across the stack.
3. **Remove sshd from containers**: faster container startup, smaller image, no sshd process to manage.
4. **Remove key management**: no SSH key pair generation, no authorized_keys mount, no known_hosts file.
5. **Simplify connection model**: 2-argument command vs 7-option SSH command.
6. **Reduce `lace-split` failure modes**: container name is stable; port is not.
7. **Simplify `lace-into` recovery logic**: dead pane respawn uses the same container name, no port re-discovery.

### Costs

1. **Remote container support eliminated**: podman exec is local-only. If remote containers are needed later, SSH (or a tunneling solution) must be reintroduced.
2. **WezTerm ExecDomain rework**: domain registration changes from static port range to dynamic container list. Moderate complexity.
3. **Migration scope**: 12+ files across 3 repos, 445+ test suite adjustments.
4. **`lace-paste-image` rework**: SCP to `podman cp` migration.
5. **Sprack metadata update**: `@lace_port` to `@lace_container` across sprack-poll and sprack-claude.
6. **Feature port system partially retained**: non-SSH features (portless, etc.) still need ports, so the port allocator cannot be fully removed.

### Net Assessment

For the local-only use case, the benefits substantially outweigh the costs.
The SSH layer is the single largest source of operational friction in the lace connection stack.
Removing it eliminates an entire category of bugs (port staleness, host key rotation, key provisioning failures) while simplifying every component in the chain.

The remote container trade-off is acceptable given the explicit scope constraint.
If remote support is needed later, it can be added as a parallel code path rather than the default.

## Migration Path

### Phase 0: Preparation (low risk, no behavior change)

1. **Audit port allocator consumers**: identify every consumer of `${lace.port()}` templates. Separate SSH-port consumers from non-SSH consumers (portless, etc.). The non-SSH consumers must continue to work.
2. **Create `lace-exec` abstraction**: introduce a helper function in `lace-into` that wraps the container entry command. Initially calls SSH. This creates the seam for the migration.
3. **Add container name/ID to `lace-discover` output**: augment the output format to include the container name alongside the port. This is already partially present (the `container_id` field in JSON mode).

### Phase 1: `lace-into` + `lace-split` migration (core path)

1. **Replace SSH with podman exec in `lace-into`**: change `do_connect()` and `do_connect_pane()` to use `podman exec -it --user <user> --workdir <workspace> <container> <shell>`.
2. **Update tmux metadata**: `@lace_port` becomes `@lace_container`. `@lace_user` and `@lace_workspace` remain.
3. **Update `lace-split`**: read `@lace_container` instead of `@lace_port`. Construct `podman exec` instead of SSH.
4. **Update `lace-disconnect-pane`**: clear `@lace_container` instead of `@lace_port`.
5. **Remove `refresh_host_key()`** from `lace-into`.
6. **Update `lace-discover`**: change detection from port-range scanning to container label scanning. Remove port from output format (or make it optional for backward compatibility during migration).
7. **Update test harness** (`test-lace-into.sh`): mock `podman exec` instead of `ssh`.

### Phase 2: Feature and pipeline cleanup

1. **Remove sshd dependency** from `lace-fundamentals/devcontainer-feature.json`.
2. **Remove SSH hardening and SSH directory steps** from `lace-fundamentals`.
3. **Remove `authorized-keys` mount declaration** from `lace-fundamentals`.
4. **Update `up.ts` pipeline**: skip SSH port allocation for lace-fundamentals. Retain port allocation for features that still need it (portless, etc.).
5. **Update template resolver**: `sshPort` is no longer auto-injected for lace-fundamentals.
6. **Run full test suite** (445+ tests) and fix breakage.

### Phase 3: WezTerm and external tool migration

1. **Update lace.wezterm plugin**: change ExecDomain registration from port-based to container-based. Update `make_exec_fixup` to use `podman exec`. Update picker to use container names.
2. **Update `lace-paste-image`**: replace SCP with `podman cp`.
3. **Update sprack**: change `@lace_port` detection to `@lace_container` in sprack-poll. Update `LaceContainerResolver` if still using port-based lookup.

### Phase 4: Cleanup

1. **Remove `~/.config/lace/ssh/` key pair** documentation and provisioning.
2. **Remove `~/.ssh/lace_known_hosts`** management.
3. **Archive wezterm-server feature** if it is still referenced anywhere.
4. **Update `lace-inspect`** to remove sshd check.
5. **Update documentation**: architecture.md, troubleshooting.md, migration.md.

## Open Questions

1. **Container name stability**: when `devcontainer up` recreates a container (e.g., after Dockerfile change), does the new container get the same name? The devcontainer CLI generates container names from the workspace folder; they should be deterministic. This needs verification.

2. **Signal handling**: does `podman exec -it` handle SIGWINCH (terminal resize) correctly? SSH propagates SIGWINCH natively. Initial testing suggests podman exec handles this correctly, but edge cases with nested tmux or neovim should be verified.

3. **Environment variable forwarding**: SSH forwards certain env vars via `SendEnv`/`AcceptEnv`. `podman exec --env` is explicit. Audit which env vars are currently forwarded implicitly via SSH and ensure they are explicitly passed.

4. **`podman exec` vs `docker exec`**: lace currently uses `docker` CLI commands (which may be podman aliased). The migration should use whichever runtime is in use. A `$LACE_CONTAINER_RUNTIME` variable or auto-detection may be needed.

5. **Port template system**: should the `${lace.port()}` system be preserved for non-SSH features only, or should it be generalized to a `${lace.service()}` system? This is a design question for a follow-up proposal.

## References

- `cdocs/proposals/2026-03-25-rfp-stale-tmux-lace-metadata.md`: documents the port staleness problem this migration would solve.
- `cdocs/proposals/2026-03-25-rfp-sprack-lace-decoupling.md`: documents sprack's coupling to lace's SSH-based metadata.
- `cdocs/proposals/2026-03-20-container-aware-split-panes.md`: documents the ExecDomain architecture that would need updating.
- `cdocs/proposals/2026-03-24-sprack-ssh-integration.md`: documents SSH-based process enrichment that would need rethinking.
- `cdocs/reports/2026-03-21-zellij-migration-feasibility.md`: documents the broader terminal management architecture, including the "session-per-project with SSH panes" model.
- `cdocs/devlogs/2026-03-21-session-management-fixes.md`: documents the dead pane and stale reattach issues that are partially caused by SSH.
