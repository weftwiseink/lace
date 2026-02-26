---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T23:30:00-05:00
task_list: lace/research
type: report
state: live
status: wip
tags: [analysis, research, portless, networking, worktrees, devcontainers, architecture, dns]
---

# Worktree Domain Routing: Architecture for Named Local Domains in Lace Devcontainers

> **BLUF:** Lace's single-container multi-worktree model means port conflicts between worktree dev servers happen *inside* the container, making portless (a userspace HTTP reverse proxy) a natural fit running container-side. A two-tier proxy architecture — container-side portless for service/worktree routing plus a lightweight host-side lace proxy on port 80 for cross-project multiplexing — yields clean, port-free URLs like `http://web-main.weft-app.localhost` with near-zero system setup. The `*.localhost` domain pattern eliminates all DNS configuration (RFC 6761 + `nss-myhostname` handle resolution natively on all platforms), reducing `lace setup` to a single sysctl for port 80 binding. No existing tool occupies the full intersection of worktree awareness + container awareness + named domain routing; lace + portless would be the first.

## Context / Background

Lace manages devcontainer orchestration with symmetric port allocation, worktree-aware workspace detection (nikitabobko bare-repo convention), and declarative feature metadata. The core architectural constraint: **lace runs a single devcontainer per project, with multiple git worktrees mounted inside that container.**

A developer working on worktrees `main` and `feature-auth` has both mounted inside one container. When they run `next dev` in `main`, it takes port 3000. When they run `next dev` in `feature-auth`, port 3000 is already taken. This is the classic `EADDRINUSE` problem, but happening container-internally rather than at the host port-forwarding layer.

Beyond port conflicts, developers must remember which arbitrary port corresponds to which service in which worktree in which project — a cognitive burden that scales poorly. The goal is URLs like `http://web-main.weft-app.localhost` with no port numbers and no manual DNS setup.

This report consolidates findings from four research threads:

1. Deep analysis of portless's proxy mechanism and architecture
2. Survey of 15 alternative tools across 6 categories
3. Architectural discussion about fitting these tools to lace's single-container model
4. Feasibility research on local DNS/domain configuration for clean URLs

### Related Reports

- `2026-02-25-portless-devcontainer-integration-analysis.md` — Initial portless analysis (written before the single-container constraint was clarified; some conclusions superseded)
- `2026-02-25-portless-alternatives-survey.md` — Full alternatives survey with detailed per-tool analysis
- `2026-02-25-local-domain-dns-configuration-research.md` — DNS configuration feasibility research (`.test` + dnsmasq analysis; the `.localhost` approach described here supersedes most of that report's recommendations)

## Key Findings

- **Portless is a userspace HTTP reverse proxy** built on Node.js built-ins (`node:http`, `node:http2`, `node:net`) with `chalk` as its sole runtime dependency. It routes `*.localhost` subdomain requests to backend ports via Host-header matching on a single proxy port (default 1355).
- **The single-container model eliminates cross-boundary complexity.** PID namespace mismatch, state synchronization, and host-side proxy requirements — all identified as critical constraints in early analysis — disappear when portless runs inside the container alongside the dev servers.
- **`*.localhost` eliminates all DNS configuration.** `nss-myhostname` resolves `*.localhost` to `127.0.0.1` natively on every systemd Linux. Browsers resolve it independently per RFC 6761 on all platforms. No dnsmasq, no `/etc/hosts`, no platform-specific DNS plumbing.
- **A host-side proxy on port 80 enables port-free, project-namespaced URLs** with only one system-level change: `sysctl net.ipv4.ip_unprivileged_port_start=80`. This is Linux-wide (not distro-specific) and a one-time operation.
- **The `.localhost` path is dramatically simpler than `.test` + dnsmasq.** The `.test` approach requires installing dnsmasq, configuring the NetworkManager DNS plugin (Fedora-specific), creating config files, and restarting services. The `.localhost` approach requires a single sysctl. Both achieve port-free URLs, but `.localhost` also provides browser secure context and cross-platform DNS resolution for free.
- **No existing tool occupies the intersection of worktree awareness + container awareness + named domain routing.** Portree (fairy-pitta) comes closest with worktree-aware subdomain routing, but has no container awareness. Traefik and caddy-docker-proxy are container-aware but target multi-container topologies.

## Architecture

### Two-Tier Proxy Design

The architecture uses two proxies with clean separation of concerns:

| Layer | Location | Port | Responsibility | Knows About |
|-------|----------|------|---------------|-------------|
| **Host lace proxy** | Host | 80 | Cross-project routing | Project names → container portless ports |
| **Container portless** | Container | 1355 | Service/worktree routing | Service names → dev server ports |

```
Browser: http://web-main.weft-app.localhost

  *.localhost → 127.0.0.1 (nss-myhostname / RFC 6761, zero config)
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  Host: Lace proxy daemon (port 80)                       │
│                                                          │
│  Host header: web-main.weft-app.localhost                 │
│  Parse hostname:                                         │
│    project  = "weft-app"     (second segment)            │
│    rest     = "web-main"     (first segment)             │
│                                                          │
│  Lookup: weft-app → container portless at host port 22435│
│  Forward to: 127.0.0.1:22435                             │
│  Rewrite Host header → web-main.localhost                │
└──────────────────────────────────────────────────────────┘
         │
         │  Docker -p 22435:1355 (lace-allocated)
         ▼
┌──────────────────────────────────────────────────────────┐
│  Container: weft-app                                     │
│                                                          │
│  Portless proxy (port 1355)                              │
│  Host header: web-main.localhost                         │
│  Lookup routes.json → web-main → port 4023              │
│  Forward to: 127.0.0.1:4023                             │
│                                                          │
│  /workspace/main/     → next dev on :4023               │
│  /workspace/feat-auth/ → next dev on :4024              │
└──────────────────────────────────────────────────────────┘
```

### Why Two Proxies?

**The host proxy solves a problem portless can't:** cross-project routing on a single port. Without it, each project container has its own portless proxy on a different lace-allocated port (22435, 22436, etc.), and the developer must know which port belongs to which project. The host proxy eliminates this by routing based on the project name embedded in the hostname.

**Portless solves a problem the host proxy can't:** dynamic service registration inside the container. When a developer runs `portless web-main next dev`, portless allocates a port, starts the server, registers the route, and cleans up when it exits. The host proxy doesn't have visibility into container-internal processes — it just forwards to the container's portless port and lets portless handle the rest.

### Naming Convention

```
{service}-{worktree}.{project}.localhost
```

| URL | Project | Worktree | Service |
|-----|---------|----------|---------|
| `web-main.weft-app.localhost` | weft-app | main | web |
| `api-main.weft-app.localhost` | weft-app | main | api |
| `web-add-websockets.weft-app.localhost` | weft-app | add-websockets | web |
| `dashboard-main.lace-app.localhost` | lace-app | main | dashboard |

The host proxy parses the hostname into project (used for routing to the right container) and forwards the rest to portless (used for routing to the right dev server).

## DNS: Why `*.localhost` Over `.test`

We evaluated two TLD options for clean URLs:

### `.test` + dnsmasq

Requires:
- Install dnsmasq (`sudo dnf install dnsmasq`)
- Configure NetworkManager DNS plugin (`/etc/NetworkManager/conf.d/00-use-dnsmasq.conf`) — Fedora-specific
- Add wildcard config (`/etc/NetworkManager/dnsmasq.d/lace-dev-domains.conf`)
- Restart NetworkManager
- sysctl for port 80

Platform-specific: NetworkManager dnsmasq plugin is GNOME/Fedora. macOS uses `/etc/resolver/`. Arch may not have NetworkManager. Ubuntu may use `resolvconf`. Each platform needs its own `lace setup` codepath.

### `*.localhost` (recommended)

Requires:
- sysctl for port 80

That's it. DNS resolution is handled by:
- **Linux:** `nss-myhostname` (part of systemd) resolves `*.localhost` → `127.0.0.1`
- **macOS:** OS resolves `*.localhost` → `127.0.0.1` natively
- **Browsers:** Chrome, Firefox, Safari resolve `*.localhost` → `127.0.0.1` independently per RFC 6761

| Dimension | `.test` + dnsmasq | `*.localhost` |
|-----------|------------------|---------------|
| DNS setup | dnsmasq + NM plugin (platform-specific) | None (built-in) |
| System packages | dnsmasq | None |
| Config files | 2-3 platform-specific files | 1 sysctl (Linux-wide) |
| Cross-platform | Each platform needs different DNS config | DNS works everywhere |
| Browser secure context | No | Yes |
| HSTS risk | None | None |
| mDNS conflict | None (.test is safe) | None (.localhost is safe) |
| URL aesthetics | `web-main.weft-app.test` | `web-main.weft-app.localhost` |

`*.localhost` wins on every axis except URL length (`.localhost` is 4 characters longer than `.test`). The elimination of all DNS configuration — and the resulting cross-platform portability — is decisive.

## Port 80 Binding

The only system-level change required: allowing unprivileged processes to bind port 80.

### Recommended: `sysctl` (Linux-wide, one-time)

```sh
# One-time setup (requires root)
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/90-lace-unprivileged-ports.conf
sudo sysctl --system
```

Available since kernel 4.11. Used by rootless Podman and rootless Docker. System-wide effect (any user process can bind ports >= 80), which is acceptable on a single-user development machine.

### Alternative: systemd socket activation

For environments where the sysctl is unacceptable, `systemd-socket-proxyd` can forward port 80 to a higher port:

```ini
# /etc/systemd/system/lace-proxy.socket
[Socket]
ListenStream=80

# /etc/systemd/system/lace-proxy.service
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd 127.0.0.1:1355
```

More moving parts but keeps the privileged port under systemd's control.

### `lace setup`

A single interactive command:

```sh
$ lace setup
lace: Setting up host-side proxy for clean URLs.
lace: This allows URLs like http://web-main.my-app.localhost
lace:
lace: Required: Allow unprivileged port 80 binding (sysctl).
lace: This is a one-time system-wide change. Continue? [Y/n]
lace:
lace: Running: sudo tee /etc/sysctl.d/90-lace-unprivileged-ports.conf
lace: Running: sudo sysctl --system
lace:
lace: Done. The lace proxy will start automatically on next `lace up`.
```

One command, one sysctl, done forever. No dnsmasq, no platform detection, no config files to maintain across OS updates.

## Portless Architecture (Container-Side)

### How It Works

Portless consists of two runtime components:

1. **Proxy daemon** — a Node.js HTTP server on port 1355 that receives browser requests (forwarded by the host proxy). Extracts the hostname from the `Host` header, looks up the target port in `routes.json`, and proxies to `127.0.0.1:<target_port>`. WebSocket upgrades are handled via raw TCP socket piping (`net.connect()`). TLS is supported via a custom self-signed CA with SNI-based per-hostname certificates.

2. **CLI launcher** — `portless <name> <command>` allocates a free port (random-then-sequential scan in 4000-4999), registers the route in `routes.json`, injects `PORT=<allocated>` and `HOST=127.0.0.1` into the child process environment, and spawns the command. Framework-specific CLI flags are injected for Vite, Astro, and Angular which ignore the `PORT` env var.

### Route State

```
~/.portless/                    (or PORTLESS_STATE_DIR)
├── routes.json                 # [{hostname, port, pid}, ...]
├── proxy.pid                   # Daemon PID
├── proxy.port                  # Listening port
├── lock/                       # Filesystem mutex (mkdir-based)
└── tls/certs                   # Optional TLS certificates
```

### Safety Mechanisms

| Mechanism | How |
|-----------|-----|
| Loop detection | `x-portless-hops` header, max 5 → HTTP 508 |
| Stale cleanup | `process.kill(pid, 0)` on route load |
| Route conflicts | `RouteConflictError` if hostname belongs to a living process (unless `--force`) |
| Locking | `mkdir` as atomic mutex, 10s stale timeout, 20 retries at 50ms |
| File watching | `fs.watch()` on routes.json with 100ms debounce, 3s polling fallback |
| Forwarded headers | `X-Forwarded-For`, `-Proto`, `-Host`, `-Port` |

### Why the Single-Container Model Makes This Work

| Problem | Why It Existed (Multi-Container) | Why It's Gone (Single-Container) |
|---------|--------------------------------|----------------------------------|
| PID namespace mismatch | Container PIDs invisible from host | Portless and dev servers share PID namespace |
| Cross-boundary state sync | Route state on one side, proxy on the other | Everything is container-internal |
| Service registry | Host needed to learn what's running inside | Portless IS the registry, alongside the servers |
| Lifecycle management | Host must detect container stop for cleanup | Portless cleans up its own stale routes via PID checks |

## Host-Side Lace Proxy

### What It Does

A lightweight Node.js HTTP server (~200-300 lines) on port 80 that:

1. Parses the `Host` header to extract the project name
2. Looks up the project's container portless port from lace's global state
3. Forwards the request (rewriting the Host header to strip the project segment)
4. Pipes the response back

### Routing Logic

```
Incoming:  Host: web-main.weft-app.localhost
                    │          │
                    │          └── project = "weft-app"
                    └── forwarded as Host: web-main.localhost

Lookup: ~/.config/lace/proxy-state.json
  {
    "weft-app": { "portlessPort": 22435 },
    "lace-app": { "portlessPort": 22436 }
  }

Forward to: 127.0.0.1:22435
```

### State Management

The host proxy reads lace's existing port allocation state. When `lace up` runs for a project, it:

1. Allocates a port from the 22425-22499 range for the container's portless proxy
2. Registers the project-name → port mapping in `~/.config/lace/proxy-state.json`
3. Starts the host proxy daemon if not already running

When `lace down` runs, it deregisters the project. The host proxy is a long-lived daemon that persists across `lace up`/`lace down` cycles.

### 404 Landing Page

When a request arrives for an unknown project, the host proxy serves a landing page listing all active projects and their routes. Visiting `http://anything-unknown.localhost` shows what's available — a lightweight service discovery dashboard.

Portless also serves its own 404 page listing routes within a container. Combined, a developer can discover both which projects are running and which services are active within each.

## Port Range Design

### The Need for Pre-Mapping

Docker port mappings are set at container creation time. The range of ports portless might allocate inside the container must be mapped through to the host before any dev server starts.

Portless allocates from 4000-4999 by default. The container-side ports don't need to be host-accessible when the host proxy is in use — the host proxy forwards to the container's portless port (1355), and portless handles internal routing. **This means the application port range does NOT need Docker pre-mapping when using the two-tier proxy architecture.**

The only port that needs mapping is the portless proxy port (1355) — one port per project, allocated from lace's existing range.

### Without Host Proxy (Fallback)

If the host proxy is not running (no `lace setup`), the developer accesses container portless directly at its lace-allocated port:

```
http://web-main.localhost:22435
```

In this mode, the application port range DOES need pre-mapping for direct dev server access (bypassing portless). Lace would generate:

```jsonc
{
  "appPort": ["22435:1355", "4000-4031:4000-4031"]
}
```

### iptables Cost (Fallback Mode Only)

| Scenario | Ports | Rules | Impact |
|----------|-------|-------|--------|
| With host proxy | 1 per project | 1-5 | Negligible |
| Without host proxy, 32-port range | 33 per project | 33-165 | Negligible |
| Without host proxy, 100-port range | 101 per project | 101-505 | Fine |

With the host proxy, the iptables cost is effectively zero — one mapped port per project.

## Developer Experience

### Inside the Container

**With lace wrapper (recommended):**

```sh
cd /workspace/main
lace dev web next dev
# → expands to: portless web-main next dev
# → allocates port 4023, starts Next.js
# → accessible at: http://web-main.weft-app.localhost

cd /workspace/add-websockets
lace dev web next dev
# → expands to: portless web-add-websockets next dev
# → allocates port 4024, starts Next.js
# → accessible at: http://web-add-websockets.weft-app.localhost
```

The `lace dev` wrapper:
1. Detects the current worktree name from the filesystem (`workspace-detector.ts`)
2. Constructs the portless hostname: `{service}-{worktree}`
3. Delegates to `portless {hostname} {command...}`

**Without lace wrapper (manual):**

```sh
cd /workspace/main
portless web-main next dev
# → accessible at: http://web-main.weft-app.localhost
```

### Across Projects (Host Browser)

With two projects running:

| URL | Project | Worktree | Service |
|-----|---------|----------|---------|
| `http://web-main.weft-app.localhost` | weft-app | main | web |
| `http://api-main.weft-app.localhost` | weft-app | main | api |
| `http://web-add-websockets.weft-app.localhost` | weft-app | add-websockets | web |
| `http://dashboard-main.lace-app.localhost` | lace-app | main | dashboard |
| `http://web-env-dashboard.lace-app.localhost` | lace-app | env-dashboard | web |

All on port 80. No port numbers anywhere. Project name in the URL provides clear context.

### Graceful Degradation

| Setup Level | URL Pattern | Requirements |
|-------------|-------------|-------------|
| Full (`lace setup` done) | `http://web-main.weft-app.localhost` | sysctl for port 80 |
| Partial (no setup) | `http://web-main.localhost:22435` | Nothing (portless only) |
| Minimal (no portless) | `http://localhost:3000` | Nothing (raw dev server) |

Each tier works independently. The host proxy is an optional enhancement, not a requirement.

## Alternatives Survey Summary

Fifteen tools were evaluated across six categories. Full analysis in `2026-02-25-portless-alternatives-survey.md`.

### Tools Worth Knowing About

**Portree** (fairy-pitta/portree) — The closest conceptual match. Go CLI for git worktree server management with automatic port allocation, subdomain routing (`{branch-slug}.localhost`), TUI dashboard. State in `.portree/state.json` with file-level locking. Configurable port ranges via `.portree.toml`. Only 3 stars, no container awareness, but validates the design direction.

**Turborepo microfrontends proxy** — Generates deterministic ports from application names (range 3000-8000). The deterministic-port-from-name pattern avoids explicit allocation. Tightly coupled to Turborepo, not standalone.

**puma-dev** (Ruby) — Production-proven architecture: dnsmasq + `setcap` for port 80 + symlink-based routing. Thousands of Ruby developers use it daily. Validates the dnsmasq approach (though we've chosen `*.localhost` to avoid it).

**Laravel Valet** — dnsmasq + Nginx on port 80 + directory-based routing. Most directly applicable pattern from another ecosystem. Lace's architecture is analogous but routes to container ports instead of local PHP processes.

### Tools That Don't Fit

**Traefik, caddy-docker-proxy, nginx-proxy** — Container-aware reverse proxies for multi-container topologies. In lace's single-container model, internal routing must happen inside the container. These can't help with that.

**Hotel/Chalet** — Unmaintained. PAC-file approach is fragile. Not recommended.

**Port allocation libraries** (get-port, detect-port, portfinder) — Lace and portless already handle this. Narrower problem.

### Why Portless Over Alternatives

| Criterion | Portless | Portree | Traefik | Hotel |
|-----------|---------|---------|---------|-------|
| Runs inside container | Yes (Node.js) | Yes (Go binary) | No (Docker service) | Yes (Node.js) |
| Named domains | Yes (*.localhost) | Yes (*.localhost) | Yes (configurable) | Yes (PAC file) |
| Dynamic port allocation | Yes (4000-4999) | Yes (configurable) | No | No |
| PID-based cleanup | Yes | Yes | N/A | Yes |
| Dependencies | 1 (chalk) | 0 (Go) | N/A | Many |
| WebSocket support | Yes | Unknown | Yes | Yes |
| Language match | Yes (Node.js) | No (Go) | No (Go) | Yes |
| Maturity | New, 2.5k stars | New, 3 stars | 10 years, 62k stars | Unmaintained |

Portless wins on language alignment, minimal dependencies, proxy architecture quality, and ecosystem fit. Portree is conceptually closer (worktree-aware) but early-stage with high maintenance risk.

### The Gap Lace Fills

```
                     Worktree-Aware
                     No                 Yes
                +-----------------+-----------------+
   Named        | Portless        | Portree         |
   Domain       | Hotel/Chalet    |                 |
   Routing +    | Traefik         | ** LACE **      |
   Container    | caddy-docker-   | (portless       |
   Aware        |   proxy         |  + host proxy)  |
                +-----------------+-----------------+
   No Named     | get-port        | DevTree         |
   Domain       | detect-port     | opencode-dc     |
   Routing      | devcontainer CLI| Lace (current)  |
                +-----------------+-----------------+
```

## What Lace Needs to Build

### 1. Host-side proxy daemon (~200-300 lines Node.js)

Host-header routing. Parses `{rest}.{project}.localhost`, looks up project → portless port, forwards with rewritten Host header. Long-lived daemon, auto-started by `lace up`.

### 2. `lace dev` wrapper (~50 lines)

Detects current worktree from filesystem, constructs `{service}-{worktree}`, delegates to `portless` inside the container. Thin shim — most of the logic already exists in `workspace-detector.ts`.

### 3. `lace setup` (~30 lines)

Interactive command that sets the port 80 sysctl. One-time, idempotent, Linux-wide.

### 4. Portless devcontainer feature

Installs portless in the container. Declares its proxy port (1355) via `customizations.lace.ports` so lace allocates a host-side port from the 22425-22499 range and maps it.

### 5. Proxy state file (`~/.config/lace/proxy-state.json`)

Maps project names to their container portless host ports. Updated by `lace up` / `lace down`. Read by the host proxy daemon.

## Open Questions

### Portless Stability Risk

Portless is very new (created 2026-02-15). Vercel Labs backing and 2.5k stars are positive signals, but:
- API and route state format may change rapidly
- Could be abandoned if Vercel shifts priorities

Mitigation: lace's integration surface is small (install it, map one port). If portless disappears, the fallback is a lace-native container-side proxy (~300 lines) or portree (if it matures).

### Host Proxy as Lace-Native vs Portless

The host proxy could theoretically be another portless instance rather than a lace-native component. But portless doesn't support Host-header rewriting or project-name parsing — it does flat hostname → port lookup. The host proxy needs to understand lace's project model, so it should be lace-native.

### TLS

Portless supports HTTPS via `--https` with auto-generated certs. Inside a container, `portless trust` modifies the container's trust store, not the host's. For most development, HTTP on `.localhost` is sufficient — browsers treat `.localhost` as a secure context regardless of protocol, so APIs like `navigator.clipboard`, `crypto.subtle`, and Service Workers all work over plain HTTP.

### Port 80 on macOS

The sysctl `net.ipv4.ip_unprivileged_port_start` is Linux-only. macOS would need PF firewall redirects (the approach pow used) or launchd. This is a future concern — lace currently targets Fedora Linux. The host proxy can fall back to a high port (e.g., 1355) on platforms without the sysctl, degrading to `*.localhost:1355` URLs.

### VS Code Port Forwarding Noise

VS Code auto-detects listening ports in devcontainers and offers to forward them. With portless allocating ports dynamically, this produces notifications. Setting `"onAutoForward": "silent"` for the portless range in `portsAttributes` suppresses the noise.

### Naming Ergonomics

The `lace dev <service> <command>` syntax is clean but requires the developer to type the service name. Further ergonomic options:
- **package.json convention:** detect `scripts.dev` and auto-derive the service name from the directory name
- **`.lace/services.json`:** static mapping of directory → service name
- **Implicit naming:** if only one dev server runs per worktree, use the worktree name alone (`main.weft-app.localhost`)

### Hostname Segment Ordering

Two valid orderings:

| Pattern | Example | Pro | Con |
|---------|---------|-----|-----|
| `{service}-{worktree}.{project}` | `web-main.weft-app.localhost` | Reads left-to-right: what, where, which project | Service and worktree are joined by hyphen (ambiguous if either contains hyphens) |
| `{worktree}.{project}.localhost` | `main.weft-app.localhost` | Clean subdomain hierarchy, no ambiguity | No room for service name without deeper nesting |
| `{service}.{worktree}.{project}` | `web.main.weft-app.localhost` | Fully unambiguous, proper subdomain hierarchy | Deeper nesting, longer URLs |

The `{service}.{worktree}.{project}.localhost` pattern is the most correct (each level is a proper subdomain) but produces long URLs. The `{service}-{worktree}.{project}.localhost` pattern is a pragmatic compromise — shorter, and the hyphen ambiguity is manageable if service names are kept to single words (`web`, `api`, `admin`, `docs`).

## Recommendations

1. **Implement the two-tier proxy architecture.** Container-side portless for dynamic service registration; host-side lace proxy on port 80 for cross-project routing. Each proxy is small, single-purpose, and independently useful.

2. **Use `*.localhost` as the domain pattern.** It eliminates all DNS configuration, works cross-platform, and provides browser secure context. The `.test` + dnsmasq path exists as a documented alternative for environments where `.localhost` is problematic (some VPN configurations, per portless issue #23).

3. **Implement `lace setup` as a one-command sysctl change.** No dnsmasq, no platform-specific DNS config. One sysctl, done forever.

4. **Build the `lace dev` wrapper** for worktree-aware naming. `lace dev web next dev` in `/workspace/main` → `portless web-main next dev` → accessible at `http://web-main.weft-app.localhost`. Low effort, high DX value.

5. **Install portless as a devcontainer feature.** Declares its proxy port via `customizations.lace.ports`, getting a lace-allocated host port automatically.

6. **Design for graceful degradation.** Full setup → `*.localhost` on port 80. No setup → `*.localhost:22435`. No portless → raw `localhost:3000`. Each tier works independently.

7. **Defer TLS.** HTTP on `.localhost` is a secure context. If HTTPS is needed later, portless already supports it with auto-generated certs.

8. **Monitor portless stability.** Pin a known-good version. If it's abandoned, a lace-native container-side proxy (~300 lines) is straightforward to build — portless proves the architecture.

## Sources

- [vercel-labs/portless](https://github.com/vercel-labs/portless) — Userspace localhost subdomain proxy
- [vercel-labs/portless#23](https://github.com/vercel-labs/portless/issues/23) — DNS resolution edge case discussion
- [fairy-pitta/portree](https://github.com/fairy-pitta/portree) — Git worktree server manager with subdomain routing
- [pwrmind/DevTree](https://github.com/pwrmind/DevTree) — Worktree + devcontainer isolation (abandoned)
- [athal7/opencode-devcontainers](https://github.com/athal7/opencode-devcontainers) — Multi-devcontainer instances for OpenCode
- [traefik/traefik](https://github.com/traefik/traefik) — Cloud-native reverse proxy with Docker provider
- [puma/puma-dev](https://github.com/puma/puma-dev) — Ruby dev server with .test DNS and port 80
- [Laravel Valet](https://laravel.com/docs/12.x/valet) — dnsmasq + Nginx for local dev
- [RFC 6761: Special-Use Domain Names](https://datatracker.ietf.org/doc/html/rfc6761) — `.localhost` and `.test` reservation
- [nss-myhostname(8)](https://www.freedesktop.org/software/systemd/man/latest/nss-myhostname.html) — systemd `*.localhost` resolution
- [ServerFault: Wildcard subdomain in /etc/hosts](https://serverfault.com/questions/118378/) — dnsmasq recommendation
- `cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md` — Initial portless analysis (partially superseded)
- `cdocs/reports/2026-02-25-portless-alternatives-survey.md` — Full 15-tool alternatives survey
- `cdocs/reports/2026-02-25-local-domain-dns-configuration-research.md` — DNS configuration feasibility (`.test` analysis; `.localhost` approach supersedes)
