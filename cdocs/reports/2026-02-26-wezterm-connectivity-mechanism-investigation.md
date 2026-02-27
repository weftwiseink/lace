---
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-02-26T17:00:00-06:00
task_list: lace/investigation
type: report
state: live
status: wip
tags: [investigation, wezterm-server, unix-socket, ssh, port-mapping, connectivity, architecture]
related_to:
  - cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md
  - cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md
  - cdocs/devlogs/2026-02-09-port-allocation-investigation.md
  - devcontainers/features/src/wezterm-server/devcontainer-feature.json
  - devcontainers/features/src/wezterm-server/install.sh
---

# Wezterm Server Connectivity Mechanism: Exhaustive Investigation

> **BLUF:** The wezterm feature uses **both** Unix sockets **and** lace port mapping --
> they are complementary layers, not alternatives. The wezterm mux daemon
> (`wezterm-mux-server`) listens exclusively on a **Unix domain socket** inside the
> container (at `$XDG_RUNTIME_DIR/wezterm/`). All network-accessible connections to it
> route through **SSH** (port 2222 inside the container, mapped to a lace-allocated host
> port in the 22425-22499 range via `appPort: ["22426:2222"]`). Lace's port mapping is
> how SSH reaches the container from the host; the Unix socket is how wezterm's mux
> protocol operates once inside. The claim that wezterm uses "unix sockets instead of
> lace port mapping" is therefore a false dichotomy -- both are in use simultaneously,
> at different layers.

## Context / Background

A dispute arose about whether the wezterm server feature uses Unix sockets OR lace port
mapping for connectivity. Another agent claimed it uses Unix sockets "instead of" lace
port mapping. This report investigates the full connectivity chain exhaustively, reading
all relevant source code, CDocs proposals/reviews/devlogs/reports, and git history.

The investigation covers:
- The wezterm-server devcontainer feature source code
- The lace port allocation pipeline
- The actual running devcontainer configuration
- All CDocs documents touching wezterm connectivity
- The relevant git history showing when each piece was built

## Key Findings

- **F1: `wezterm-mux-server` is a Unix-socket-only daemon.** It has no independent TCP
  port. The socket path is determined by `$XDG_RUNTIME_DIR` (typically
  `/run/user/<uid>/wezterm/`). Source: CDocs report
  `2026-02-09-wezterm-sshd-port-mechanics.md`, finding F1; wezterm upstream docs.

- **F2: All remote wezterm connections route through SSH.** When `wezterm connect
  lace:<port>` is invoked, wezterm opens an SSH connection to the lace-allocated host
  port, which Docker maps to sshd inside the container (port 2222 by default). Wezterm
  then spawns/connects to the mux daemon's Unix socket over the SSH tunnel via `wezterm
  cli proxy`. Source: CDocs report `2026-02-09-wezterm-sshd-port-mechanics.md`, finding
  F3; lace.wezterm plugin at `plugin/init.lua` lines 59-71.

- **F3: Three wezterm domain types exist; lace uses the SSH type.** The SSH domain type
  uses `ssh_port` (the sshd port) as its only network configuration. The TLS domain
  type is the only one with a direct configurable TCP port for the mux protocol. Lace
  uses SSH domains exclusively. Source: CDocs report
  `2026-02-09-wezterm-sshd-port-mechanics.md`, finding F2.

- **F4: Lace port mapping IS in use.** The generated `.lace/devcontainer.json` contains
  `"appPort": ["22426:2222"]`, `"forwardPorts": [22426]`, and `portsAttributes`
  labeling the port as "wezterm ssh (lace)". The `port-assignments.json` shows host
  port 22426 allocated for `wezterm-server/hostSshPort` on 2026-02-24. This is how SSH
  reaches the container from the host.

- **F5: The `hostSshPort` option in `devcontainer-feature.json` is pure lace metadata.**
  It is never read by `install.sh`. Its sole function is to declare a port label to
  lace's port allocator so lace can auto-inject `appPort: ["22426:2222"]` into the
  generated config. Source: CDocs report `2026-02-09-wezterm-sshd-port-mechanics.md`,
  finding F4; commit `2deab8d` which renamed it from `sshPort` to `hostSshPort` to make
  this explicit.

- **F6: The feature's `install.sh` sets up the Unix socket infrastructure.** It creates
  `/run/user/<uid>` (the `XDG_RUNTIME_DIR` for the mux socket), installs
  `wezterm-mux-server`, writes a static `wezterm.lua` that reads
  `CONTAINER_WORKSPACE_FOLDER`, and generates `entrypoint.sh` which auto-starts the mux
  daemon. The mux daemon then listens on its Unix socket.

- **F7: There was NO design pivot from port mapping to Unix sockets.** The architecture
  has always been: lace port mapping for SSH transport + Unix socket for mux protocol.
  These were never alternatives. The earliest proposal (2026-01-30) already described
  this layered design.

- **F8: The portless feature (today's date, 2026-02-26) is a separate workstream.** The
  `portless` tool is for routing worktree dev servers (Next.js, etc.) through a
  subdomain proxy. It is unrelated to wezterm connectivity. The portless feature follows
  the wezterm-server pattern as a reference, but the two features serve entirely different
  purposes.

## Complete Connectivity Chain

The full data path for a wezterm connection to a lace devcontainer:

```
wezterm connect lace:22426
        |
        v
SSH to localhost:22426  (host port, allocated by lace from 22425-22499 range)
        |
        v
Docker appPort mapping: 22426 -> 2222  (in .lace/devcontainer.json)
        |
        v
sshd inside container, listening on port 2222
(from ghcr.io/devcontainers/features/sshd:1, baked into prebuild image)
        |
        v
wezterm spawns/connects to wezterm-mux-server via SSH channel
(wezterm CLI: `wezterm cli proxy`)
        |
        v
/run/user/1000/wezterm/sock  (Unix domain socket, no TCP port)
        |
        v
wezterm-mux-server daemon
(started by feature entrypoint: /usr/local/share/wezterm-server/entrypoint.sh)
```

Every layer except the host port is fixed for prebuild containers:
- Container sshd port: always 2222 (baked at prebuild time by the sshd feature)
- Mux server socket: `/run/user/<uid>/wezterm/` (from `$XDG_RUNTIME_DIR`)
- Only the host port varies per project, managed by lace's port allocator

## Evidence: Source Code

### Feature definition (`devcontainer-feature.json` v1.3.0)

Located at: `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/wezterm-server/devcontainer-feature.json`

Key fields:
```json
{
  "entrypoint": "/usr/local/share/wezterm-server/entrypoint.sh",
  "options": {
    "hostSshPort": {
      "type": "string",
      "default": "2222",
      "description": "Host-side SSH port for lace port allocation. Not used by install.sh..."
    }
  },
  "customizations": {
    "lace": {
      "ports": {
        "hostSshPort": {
          "label": "wezterm ssh",
          "onAutoForward": "silent",
          "requireLocalPort": true
        }
      },
      "mounts": {
        "authorized-keys": {
          "target": "/home/node/.ssh/authorized_keys",
          ...
        }
      }
    }
  },
  "installsAfter": [
    "ghcr.io/devcontainers/features/common-utils",
    "ghcr.io/devcontainers/features/sshd"
  ]
}
```

The `installsAfter: [sshd]` dependency confirms SSH is the transport layer. The
`hostSshPort` option's description explicitly says "Not used by install.sh."

### Feature install script (`install.sh`)

Located at: `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/wezterm-server/install.sh`

The script:
1. Downloads and extracts `wezterm-mux-server` and `wezterm` binaries from `.deb`
2. Creates `/run/user/<uid>` (the `XDG_RUNTIME_DIR` for the mux socket)
3. Writes `/usr/local/share/wezterm-server/wezterm.lua` (static config reading
   `CONTAINER_WORKSPACE_FOLDER` env var via `os.getenv()`)
4. Generates `/usr/local/share/wezterm-server/entrypoint.sh` which runs:
   ```sh
   wezterm-mux-server --daemonize --config-file $WEZTERM_SERVER_DIR/wezterm.lua
   ```

No TCP port configuration appears anywhere in `install.sh`. The mux daemon has no
port -- it listens on the Unix socket only.

### Generated devcontainer config (`.lace/devcontainer.json`)

Located at: `/var/home/mjr/code/weft/lace/main/.lace/devcontainer.json`

```json
{
  "appPort": ["22426:2222"],
  "forwardPorts": [22426],
  "portsAttributes": {
    "22426": {
      "label": "wezterm ssh (lace)",
      "requireLocalPort": true,
      "onAutoForward": "silent"
    }
  }
}
```

This is the lace port mapping. It maps host port 22426 to container port 2222 (sshd).

### Port assignments file (`.lace/port-assignments.json`)

Located at: `/var/home/mjr/code/weft/lace/main/.lace/port-assignments.json`

```json
{
  "assignments": {
    "wezterm-server/hostSshPort": {
      "label": "wezterm-server/hostSshPort",
      "port": 22426,
      "assignedAt": "2026-02-24T21:16:58.499Z"
    }
  }
}
```

Lace allocated port 22426 for wezterm SSH access on 2026-02-24.

## Evidence: CDocs History

### Original proposal (2026-01-30)

`cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`

The very first proposal already described SSH-domain multiplexing as the connectivity
mechanism. The BLUF states: "Extract the wezterm-mux-server installation logic from the
lace Dockerfile into a standalone devcontainer feature... The host runs wezterm with an
SSH domain configured to connect to the container's sshd on port 2222."

The design decisions report from 2026-01-31 states: "The wezterm-server feature enables
headless terminal multiplexing in devcontainers. The host runs wezterm with an SSH
domain configured to connect to the container's sshd on port 2222. Inside the container,
`wezterm-mux-server --daemonize` listens for mux protocol connections. This gives the
host wezterm full multiplexing capabilities (tabs, panes, splits) over the SSH
transport, without GUI dependencies inside the container."

No Unix socket vs. port mapping ambiguity existed at the start; both were always present.

### Port mechanics investigation (2026-02-10)

`cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md`

This report definitively answered: "wezterm-mux-server has NO independent TCP port --
it listens exclusively on a Unix domain socket inside the container. All remote access
flows through SSH (port 2222 by default from the sshd feature), which tunnels the
wezterm mux protocol over the SSH connection."

This is not a design pivot; it is a documentation of the existing architecture.

### Port allocation investigation (2026-02-09)

`cdocs/devlogs/2026-02-09-port-allocation-investigation.md`

Investigated why the dotfiles devcontainer had no port mappings. Root cause: wezterm-
server was in `prebuildFeatures` instead of `features`, and the port allocation pipeline
only read the `features` block. Fix: extend the pipeline to also process `prebuildFeatures`.
This was implemented in commit `32464e7` ("feat(lace): add prebuild features port support
with asymmetric injection").

The asymmetric injection for prebuild features writes `appPort: ["22426:2222"]` because
the container-side port is fixed at 2222 (baked by sshd at prebuild time).

### Workspace awareness (2026-02-25)

`cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md`
`cdocs/devlogs/2026-02-25-wezterm-server-workspace-awareness-implementation.md`

Recent work (implemented 2026-02-25) eliminated the per-project `.devcontainer/wezterm.lua`
file and `postStartCommand` by:
1. Having `install.sh` write a static `wezterm.lua` reading `CONTAINER_WORKSPACE_FOLDER`
2. Adding a feature entrypoint (`entrypoint.sh`) to auto-start the mux daemon
3. Having lace inject `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` into `containerEnv`

This eliminated user-visible configuration but did not change the connectivity mechanism
(still SSH transport + Unix socket mux).

## Evidence: Git History

The key commits in chronological order:

| Date | Commit | Description |
|------|--------|-------------|
| 2026-01-31 | `9005764` | Initial wezterm-server feature scaffold (Debian-only). SSH + port 2222 architecture from day 1. |
| 2026-02-07 | `e9adaf0` | Added `sshPort` option and `customizations.lace.ports` metadata. Port allocation pipeline wired. |
| 2026-02-10 | `2deab8d` | Renamed `sshPort` → `hostSshPort` to clarify it is a host-side label, not a container-side config. |
| 2026-02-10 | `32464e7` | Added prebuild features port support (asymmetric injection: `22426:2222`). |
| 2026-02-25 | `b6f5a3d` | Added workspace-aware config + entrypoint to feature. Mux server now auto-starts. |
| 2026-02-25 | `c9119a6` | Removed per-project `wezterm.lua`, its bind mount, Dockerfile mkdir, and `postStartCommand`. |

No commit ever changed the connectivity mechanism. SSH transport and Unix socket mux
have been the architecture throughout.

## The "Unix Sockets vs. Port Mapping" False Dichotomy

The claim that wezterm uses "unix sockets instead of lace port mapping" rests on a
confusion between two different layers:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Host → container network | SSH over lace-allocated port (22426) → Docker maps to sshd (2222) | Carry traffic from host machine into container |
| Container-internal IPC | Unix domain socket at `/run/user/<uid>/wezterm/` | Wezterm mux protocol between SSH session and mux daemon |

Both layers are always present simultaneously. The Unix socket is the mux daemon's
internal IPC mechanism -- it is not an alternative to port mapping, it is what the
mux daemon uses *once the SSH tunnel is established inside the container*.

If anything, the statement would be more accurate stated as: "wezterm-mux-server itself
uses a Unix socket (not TCP) for its daemon IPC, but the transport layer getting SSH
into the container still uses lace port mapping."

## SSH Scaffolding Status

The SSH scaffolding built as part of the wezterm feature:

- **sshd feature** (`ghcr.io/devcontainers/features/sshd:1`): Installed in the
  container, listens on port 2222. Declared as `installsAfter` dependency in
  wezterm-server feature. Active and essential.

- **lace port allocator**: Allocates a host port (22426) from the 22425-22499 range and
  generates `appPort: ["22426:2222"]`. Active and essential.

- **SSH key mount**: The wezterm-server feature declares a mount for
  `authorized_keys` (SSH public key) in its `customizations.lace.mounts`. Auto-injected
  by lace. Active and essential.

- **`wez-into` script**: A shell script that wraps `lace up` + `wezterm connect` to
  open a wezterm session into a running container in one command. Active utility.

- **Per-project `wezterm.lua` bind mount**: Previously used to set `default_cwd`. Now
  **removed** (commit `c9119a6`, 2026-02-25). Replaced by a static config baked into
  the feature and `CONTAINER_WORKSPACE_FOLDER` env var injection.

- **`postStartCommand`**: Previously used to start the mux daemon. Now **removed**
  (same commit). Replaced by the feature's entrypoint mechanism.

The core SSH scaffolding (sshd, port mapping, authorized_keys) is all still in use.
Only the per-project wezterm config file and postStartCommand were removed.

## Portless Feature: Not Related to Wezterm Connectivity

The portless workstream (active as of 2026-02-26, currently WIP) is a separate feature
for routing worktree dev servers through a subdomain proxy (e.g.,
`http://web-main.localhost:22435`). It follows the wezterm-server feature as a reference
implementation pattern but is architecturally independent from wezterm connectivity.

The portless feature also uses lace port mapping (one symmetric proxy port allocated from
22425-22499). This is not the same port as wezterm's SSH port -- they are distinct
allocations.

## Recommendations

1. **Settle the dichotomy question.** When discussing wezterm connectivity, always
   specify which layer: "Unix socket for the mux daemon IPC" vs. "lace port mapping for
   SSH transport into the container." Both are in use simultaneously and are not
   alternatives.

2. **The architecture is correct and documented.** The 2026-02-09 port mechanics
   investigation report (`cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md`) is
   the authoritative reference for this architecture. It should be the first read for
   any agent investigating wezterm connectivity.

3. **TLS domains remain an unexplored alternative.** Wezterm's TLS domain type would
   allow a direct TCP port to the mux daemon, bypassing SSH entirely. This would require
   certificate management and changes to the lace.wezterm plugin. It is not currently
   used or recommended, but it is the only way to eliminate the SSH transport layer.
