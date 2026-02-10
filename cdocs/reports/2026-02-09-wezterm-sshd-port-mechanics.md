---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T00:30:00-08:00
task_list: lace/dogfooding
type: report
state: archived
status: done
tags: [investigation, wezterm, sshd, ports, devcontainer, features, prebuild, architecture]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-10T01:00:00-08:00
  round: 1
references:
  - cdocs/proposals/2026-02-09-symmetric-prebuild-port-binding.md
  - cdocs/reports/2026-02-09-lace-port-allocation-investigation.md
---

# Wezterm Mux Server and SSHD Port Mechanics

> **BLUF:** `wezterm-mux-server` has NO independent TCP port -- it listens exclusively on a Unix domain socket inside the container. All remote access flows through SSH (port 2222 by default from the sshd feature), which tunnels the wezterm mux protocol over the SSH connection. The upstream sshd feature bakes its port into `/etc/ssh/sshd_config` at install time via `sed`, but the port CAN be overridden at runtime via `sshd -p <port>` in a `postStartCommand` or by editing `sshd_config` before the entrypoint fires. However, the entrypoint (`ssh-init.sh`) runs BEFORE lifecycle hooks, making pre-entrypoint config modification impossible without a custom entrypoint wrapper. The practical conclusion: for prebaked sshd, the container-side port is effectively fixed at 2222, and the correct approach is asymmetric port mapping (`host:2222`) as the symmetric-prebuild-port-binding proposal already establishes.

## Context / Background

Two questions arose during the design of lace's prebuild port binding mechanism:

1. **Does `wezterm-mux-server` have its own port configuration?** If wezterm had its own TCP listener, the port architecture could bypass SSH entirely, simplifying the port mapping story.

2. **Can the sshd feature's port be altered at runtime for a prebaked feature?** If the prebaked sshd port could be changed at container start time, symmetric port mapping (same port on host and container) would work for prebuild features, eliminating the need for the `containerPort` metadata field.

Both questions have implications for the [symmetric-prebuild-port-binding proposal](../proposals/2026-02-09-symmetric-prebuild-port-binding.md) and the overall lace port architecture.

## Question 1: Wezterm Mux Server Port Configuration

### Key Findings

#### F1: wezterm-mux-server listens on a Unix domain socket, not TCP

The wezterm multiplexer daemon (`wezterm-mux-server`) listens on a **Unix domain socket** by default. It does NOT open any TCP port independently. The socket path is determined by `$XDG_RUNTIME_DIR` (typically `/run/user/<uid>/wezterm/`) and is not directly configurable via a command-line flag -- it is controlled through the wezterm Lua config's `unix_domains[].socket_path` or by setting `$XDG_RUNTIME_DIR` at startup.

Source: [wezterm multiplexing docs](https://wezterm.org/multiplexing.html), [GitHub discussion #5361](https://github.com/wezterm/wezterm/discussions/5361)

#### F2: Three domain types exist, but only TLS uses TCP directly

Wezterm supports three multiplexing domain types:

| Domain Type | Transport | Port Config | Use Case |
|-------------|-----------|-------------|----------|
| **Unix** | Unix socket | `socket_path` (no TCP port) | Local mux, WSL |
| **SSH** | SSH tunnel to Unix socket | SSH port only | Remote mux (what lace uses) |
| **TLS** | TCP with TLS | `bind_address` (e.g., `host:8080`) | Direct remote mux |

Only **TLS domains** have a direct TCP port configuration via `tls_servers[].bind_address`. SSH domains use the SSH connection as a transport layer -- there is no separate TCP port for the mux protocol.

#### F3: SSH domain connection flow (what lace uses)

When `wezterm connect lace:<port>` is invoked:

1. The wezterm client initiates an SSH connection to `localhost:<port>` (using the pre-registered SSH domain config from the lace.wezterm plugin).
2. Over the SSH channel, wezterm spawns `wezterm-mux-server --daemonize` on the remote host (if not already running). The path to the binary is specified by `remote_wezterm_path` in the SSH domain config (lace sets this to `/usr/local/bin/wezterm`).
3. The client then connects to the mux server's **Unix domain socket** inside the container via `wezterm cli proxy` over the SSH session.
4. All subsequent mux protocol traffic flows through the SSH tunnel to the Unix socket.

The critical insight: **SSH is the transport layer, and the Unix socket is the endpoint.** There is no independent TCP port for the mux protocol.

Source: lace.wezterm plugin at `/home/mjr/code/weft/lace.wezterm/plugin/init.lua` (lines 59-71), wezterm docs on SSH domains.

#### F4: The wezterm-server feature installs binaries only -- no port config

The lace wezterm-server feature's `install.sh` (at `/var/home/mjr/code/weft/lace/devcontainers/features/src/wezterm-server/install.sh`) does two things:

1. Downloads and extracts `wezterm-mux-server` and `wezterm` CLI binaries from the wezterm GitHub release (lines 51-63).
2. Optionally creates `/run/user/<uid>` runtime directory for the mux server's socket (lines 78-83).

The `sshPort` option declared in `devcontainer-feature.json` (line 12-15) is **never referenced** in `install.sh`. It exists purely as metadata for lace's port allocation pipeline. The `VERSION` and `CREATERUNTIMEDIR` options are the only functional environment variables (lines 4-5).

#### F5: The container-side wezterm config sets only default_cwd

The wezterm Lua config bind-mounted into the container (at `/var/home/mjr/code/weft/lace/.devcontainer/wezterm.lua`) sets only `config.default_cwd = "/workspace/main"`. It does not configure any TLS servers, Unix domain socket paths, or port bindings.

#### F6: TLS domains could theoretically replace SSH but are not used

Wezterm's TLS domain feature (`tls_servers[].bind_address`) allows the mux server to listen directly on a TCP port with TLS encryption. This would eliminate the SSH dependency entirely. However:

- TLS domains require certificate management (bootstrap via SSH or manual cert distribution).
- The existing SSH-based approach leverages the sshd feature already present for VS Code Remote.
- TLS would require a new feature or significant changes to the wezterm-server feature.
- The wezterm-mux-server `--daemonize` invocation in `postStartCommand` does not configure any TLS listeners.

This is not something lace currently uses or should pursue -- SSH domains are the established pattern.

### Summary: wezterm-mux-server has no port of its own

The mux server is a Unix-socket-only daemon. All network-accessible connections to it must go through either SSH (current approach) or TLS (not used). The only TCP port in the architecture is sshd's port (2222 by default). This means:

- Lace's port allocation must control the **sshd port** (or more precisely, the host-side mapping to it).
- The `sshPort` option on wezterm-server is correctly named -- it refers to the SSH port used to reach the mux server.
- There is no "wezterm port" to manage separately.

## Question 2: Can the SSHD Feature's Port Be Altered at Runtime?

### Key Findings

#### F7: The sshd feature bakes the port into sshd_config at install time

The upstream sshd feature (`ghcr.io/devcontainers/features/sshd:1`) configures the SSH port during `install.sh` execution. The key line:

```bash
SSHD_PORT="${SSHD_PORT:-"2222"}"
# ...
sed -i -E "s/#*\s*Port\s+.+/Port ${SSHD_PORT}/g" /etc/ssh/sshd_config
```

This `sed` command writes the port directly into `/etc/ssh/sshd_config`. At install time, `SSHD_PORT` comes from the feature option (default: `"2222"`). For a prebaked feature, `install.sh` runs at image build time with default options, so the config file permanently contains `Port 2222`.

The feature's `devcontainer-feature.json` notably does NOT declare `sshd_port` as an option at all. The only options are `version` (unused, default `"latest"`) and `gatewayPorts`. The `SSHD_PORT` variable is hard-coded to `"2222"` in the script, not sourced from a feature option.

Source: [upstream sshd install.sh](https://github.com/devcontainers/features/blob/main/src/sshd/install.sh)

#### F8: The sshd entrypoint runs BEFORE lifecycle hooks

The sshd feature declares an entrypoint in its `devcontainer-feature.json`:

```json
"entrypoint": "/usr/local/share/ssh-init.sh"
```

The `ssh-init.sh` script starts sshd via `/etc/init.d/ssh start`. According to the devcontainer specification, feature entrypoints run at container start as part of the container's ENTRYPOINT, which executes **before** any lifecycle hooks (`onCreateCommand`, `postCreateCommand`, `postStartCommand`, etc.).

The execution order is:
1. Container ENTRYPOINT fires (includes feature entrypoints like `ssh-init.sh`)
2. `onCreateCommand` (first container creation only)
3. `updateContentCommand`
4. `postCreateCommand`
5. `postStartCommand` (every start)
6. `postAttachCommand` (every attach)

This means sshd is already running by the time `postStartCommand` executes. A `postStartCommand` that tries to modify `sshd_config` before sshd starts would be too late.

#### F9: Runtime override IS theoretically possible, but impractical

Several approaches could override the prebaked sshd port at runtime:

**Approach A: `sshd -p <port>` via postStartCommand**

Stop the running sshd (started by entrypoint) and restart on a different port:

```json
"postStartCommand": "sudo service ssh stop && sudo /usr/sbin/sshd -p 22430 -D &"
```

Problems:
- There is a race condition: sshd is already running from the entrypoint. Stopping and restarting creates a window where SSH is unavailable.
- The `-D` flag (foreground) conflicts with backgrounding via `&`. Using `-D` without `&` blocks the lifecycle.
- Must use `sudo` since sshd needs root to bind to ports and read keys.
- The `wezterm-mux-server --daemonize` also runs in `postStartCommand` and depends on sshd being available.

**Approach B: Modify sshd_config in a custom entrypoint**

Create a wrapper entrypoint that modifies `/etc/ssh/sshd_config` before `ssh-init.sh` runs:

```dockerfile
COPY custom-entrypoint.sh /usr/local/share/custom-entrypoint.sh
ENTRYPOINT ["/usr/local/share/custom-entrypoint.sh"]
```

Problems:
- The devcontainer CLI typically overrides the ENTRYPOINT. Feature entrypoints are managed by the CLI, not by the Dockerfile.
- Multiple feature entrypoints are chained by the CLI implementation. Inserting a custom step into this chain is not supported by the devcontainer spec.
- This approach requires a custom Dockerfile step, defeating the purpose of using a prebaked feature.

**Approach C: Modify sshd_config in onCreateCommand**

The `onCreateCommand` runs after the entrypoint but only on first creation:

```json
"onCreateCommand": "sudo sed -i 's/Port 2222/Port 22430/' /etc/ssh/sshd_config && sudo service ssh restart"
```

Problems:
- Still a race with the entrypoint-started sshd.
- Only runs on first creation, not subsequent starts.
- The port value would need to be dynamic (from lace's port allocator), but lifecycle commands are static strings in the config.

**Approach D: containerEnv / remoteEnv**

Some search results suggest `"remoteEnv": { "SSHD_PORT": "22430" }`. However, the `ssh-init.sh` entrypoint script does NOT read `SSHD_PORT` at runtime -- it simply runs `/etc/init.d/ssh start`, which uses whatever is baked into `sshd_config`. The `SSHD_PORT` variable is only used during `install.sh` to write the config file.

#### F10: The devcontainer CLI does NOT re-run install.sh for prebaked features

When a feature is included in a prebuild image (via `prebuildFeatures` in lace, or via a pre-built Docker image), the devcontainer CLI does NOT re-execute `install.sh` at container creation time. The feature's installation is considered complete because it is already in the image layers.

This means:
- Feature options specified in the `features` block only affect `install.sh` if the feature is actually installed (not prebaked).
- There is no mechanism in the devcontainer spec to "re-configure" a prebaked feature with different options at runtime.
- The `validateNoOverlap()` function in lace (at `/var/home/mjr/code/weft/lace/packages/lace/src/lib/validation.ts`, lines 23-39) prevents specifying the same feature in both `prebuildFeatures` and `features`, which would be the only way to trigger a re-run.

Even if `validateNoOverlap()` were removed, the devcontainer CLI behavior is unclear. The spec does not explicitly define what happens when a feature already exists in the image and is also specified in the `features` block. In practice, the CLI likely skips re-installation based on image metadata/labels.

#### F11: Feature entrypoint chaining is implementation-defined

The devcontainer spec states that features can declare an `entrypoint` property, but the spec does NOT define how multiple feature entrypoints are chained. This is left to the implementing tool (VS Code, devcontainer CLI, Codespaces, etc.).

In practice, the devcontainer CLI appears to:
1. Collect all feature entrypoints in installation order.
2. Set the container's ENTRYPOINT to execute them sequentially (exact mechanism unclear from public docs).
3. Feature entrypoints run as the container's init process (or as part of it if `init: true` is set).

For prebaked features, the entrypoint is baked into the image metadata. The devcontainer CLI reads this metadata and includes the prebaked feature's entrypoint in the chain even though `install.sh` does not re-run.

This is confirmed by the sshd feature working in the lace devcontainer even when sshd is in `prebuildFeatures`: the entrypoint (`ssh-init.sh`) fires on every container start regardless of whether `install.sh` ran during this container build.

### Summary: SSHD port is effectively fixed for prebaked features

The sshd port is written to `sshd_config` at install time and read by the init script at container start. There is no clean runtime override mechanism. All approaches involve race conditions, complexity, or unsupported spec extensions.

The correct approach -- already established by the [symmetric-prebuild-port-binding proposal](../proposals/2026-02-09-symmetric-prebuild-port-binding.md) -- is to accept that the container-side port is fixed at 2222 and use asymmetric `appPort` mapping (`host_port:2222`) with the `containerPort` metadata field.

## Architectural Implications

### The port mapping is always asymmetric for prebaked sshd

The complete data flow for a wezterm connection to a lace devcontainer:

```
wezterm connect lace:22430
    |
    v
SSH to localhost:22430  (host port, allocated by lace)
    |
    v
Docker port mapping: 22430 -> 2222  (appPort: "22430:2222")
    |
    v
sshd inside container, listening on 2222  (baked at prebuild time)
    |
    v
wezterm spawns/connects to mux-server via Unix socket
    |
    v
/run/user/1000/wezterm/sock  (Unix domain socket, no TCP)
```

Every layer except the first (host port) is fixed:
- Container sshd port: 2222 (baked in `sshd_config`)
- Mux server socket: `/run/user/<uid>/wezterm/` (from `XDG_RUNTIME_DIR`)

Only the host port varies per container, managed by lace's port allocator.

### The `sshPort` option name is misleading but correct

The wezterm-server feature's `sshPort` option does not configure SSH. It does not configure wezterm. It is a pure routing label for lace's port allocator that says "allocate a host port for SSH access to this container's wezterm mux server." The name is accurate in describing what the port is *for*, even though the feature itself does not use the value.

### TLS domains are the only path to eliminating the SSH dependency

If a future architecture wanted to remove the SSH middleman, wezterm's TLS domain feature is the only option. This would require:
1. Configuring `tls_servers` in the container-side wezterm config.
2. Managing TLS certificates (bootstrap or pre-shared).
3. A direct TCP port for the TLS connection (separate from sshd).
4. Changes to the lace.wezterm plugin to use TLS domains instead of SSH domains.

This is a significant architectural change with unclear benefits over the current SSH approach, which leverages existing infrastructure (sshd feature, SSH keys).

## Recommendations

1. **Keep the asymmetric mapping approach.** The `containerPort: 2222` metadata field in the symmetric-prebuild-port-binding proposal is the correct solution. Do not attempt runtime sshd port overrides.

2. **Do not pursue TLS domains.** The SSH-based approach works, uses existing infrastructure, and avoids certificate management complexity.

3. **Document the sshPort option's metadata-only nature.** The wezterm-server feature's `devcontainer-feature.json` description for `sshPort` should clarify that this option is not used by `install.sh` -- it exists solely for lace port allocation. Consider a `"description"` update like: `"Host-side SSH port for lace port allocation. Not used by install.sh -- the actual SSH listener port is determined by the sshd feature (default 2222)."`.

4. **Consider renaming `sshPort` to something clearer.** Options like `hostPort` or `lacePort` would better communicate that this is a host-side routing label, not a container-side service configuration. However, this would be a breaking change for existing configs. A documentation update (recommendation 3) may be sufficient.

5. **The entrypoint timing is important for future features.** Any future lace feature that needs to configure a service before it starts will face the same entrypoint-before-lifecycle-hooks constraint. Features that need dynamic runtime configuration should use lifecycle hooks with service restart, not rely on modifying prebaked configs before the entrypoint fires.
