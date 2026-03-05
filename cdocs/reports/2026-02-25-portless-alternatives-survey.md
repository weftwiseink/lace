---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T00:00:00-05:00
task_list: lace/research
type: report
state: live
status: wip
tags: [analysis, research, portless, networking, alternatives]
---

# Portless Alternatives Survey: Local Development Domain Naming and Port Management

> **BLUF:** The landscape of local dev domain naming and port management tools falls into distinct tiers of relevance to lace's problem. **Portree** (fairy-pitta) is the closest existing tool to what lace needs -- it was purpose-built for git worktree port allocation with subdomain routing -- but it is very early-stage (3 stars, written in Go, no container awareness). **Portless** (vercel-labs) has the best proxy implementation for `*.localhost` routing but is host-only with no container or worktree awareness. **Traefik** and **caddy-docker-proxy** are the strongest container-aware options but require running as Docker services and are overkill for the single-developer local case. No existing tool solves the full lace problem: worktree-namespaced naming + dynamic port allocation + host-to-container proxy forwarding + devcontainer lifecycle integration. The recommendation is to implement a lightweight lace-native proxy (borrowing portless's Host-header routing architecture) rather than depending on any external tool, or to pursue the portless integration path documented in the companion report `2026-02-25-portless-devcontainer-integration-analysis.md`.

## Context / Background

Lace manages devcontainer orchestration with symmetric port allocation, worktree-aware workspace detection, and declarative feature metadata. The problem space has four requirements:

1. **Unique port allocation** across all running worktree containers (no conflicts)
2. **Named local domains** so developers don't memorize port numbers
3. **Seamless forwarding** from host browser through to container-internal dev servers
4. **Worktree-namespaced naming** (e.g., `api-feature-auth.localhost` vs `api-main.localhost`)

Lace already solves requirement 1 (symmetric port allocation in the 22425-22499 range). This survey evaluates the tool landscape for requirements 2-4, assessing which tools could be adopted, adapted, or architecturally borrowed from.

## Key Findings

- **No existing tool targets the "multiple worktrees inside a single devcontainer" problem** with named domain routing. In lace's model, one container mounts the bare-repo parent (containing all worktrees), and dev servers in different worktrees conflict on ports within that container. Portree comes closest to domain routing but has no container awareness. DevTree has container awareness but no domain naming.
- **The `*.localhost` DNS trick (RFC 6761) is the foundation** that makes all of this work without `/etc/hosts` modification or dnsmasq. Chrome resolves `*.localhost` to `127.0.0.1` natively; Firefox is trailing but functional since v69 for base localhost.
- **Container-aware reverse proxies (Traefik, caddy-docker-proxy, nginx-proxy) auto-discover containers** via Docker socket watching and label-based routing, but they run as Docker services themselves and target the multi-service production-like topology, not the single-developer multi-worktree case.
- **Port allocation libraries (get-port, detect-port, portfinder) solve a different problem** -- finding a free port at startup -- not managing a persistent, coordinated allocation across multiple long-running environments. Lace's existing port allocator already handles this.
- **The host-to-container proxy boundary is the key architectural constraint.** The proxy must run on the host (browsers connect to localhost), but the dev servers run in containers. PID-based liveness checks fail across this boundary. Docker port publishing (`-p`) bridges the gap, and lace already handles this via `appPort` with symmetric binding.

## Detailed Analysis

### Category 1: Localhost Subdomain Proxies

#### Portless (vercel-labs/portless)

| Attribute | Value |
|-----------|-------|
| Stars | 2,562 |
| Language | TypeScript |
| License | Apache-2.0 |
| Created | 2026-02-15 |
| Last push | 2026-02-25 |
| Maintenance | Active (10 days old, rapid iteration) |

**What it does:** Userspace HTTP reverse proxy that maps `*.localhost` subdomains to local ports. Runs a daemon on port 1355, looks up hostnames in a `routes.json` file, and proxies to the corresponding backend port. Injects `PORT` env var into child processes.

**Proxy mechanism:** Host-header virtual hosting on a single port. HTTP/1.1 `Host` header or HTTP/2 `:authority` pseudo-header. WebSocket upgrade handled via raw TCP socket piping. TLS via self-signed CA with SNI-based per-hostname certs.

**Container-aware:** No. Designed for host-side Node.js processes. PID-based stale route cleanup breaks across the container boundary (container PIDs not visible from host).

**Dynamic port allocation:** Yes. Scans 4000-4999 range for free ports, injects via `PORT` env var.

**Named domains:** Yes. `{name}.localhost:1355` with subdomain support (`api.myapp.localhost`).

**Lace fit:** Architecturally strong -- the proxy mechanism is exactly what lace needs. Integration requires solving the PID liveness mismatch (documented in companion report). The route store is a simple JSON file that lace could populate directly. Could be used as-is with a wrapper, or its architecture could be replicated in a lace-native proxy (~1500 lines, one dependency).

#### Hotel (typicode/hotel)

| Attribute | Value |
|-----------|-------|
| Stars | 10,000 |
| Language | JavaScript |
| License | MIT |
| Created | 2015-05-27 |
| Last push | 2023-10-23 |
| Maintenance | **Unmaintained** (no commits in 2+ years, 123 open issues) |

**What it does:** Process manager + reverse proxy. Registers dev servers via `hotel add 'npm start'`, assigns `.localhost` domains, provides a web dashboard at `localhost:2000` for start/stop control and log viewing.

**Proxy mechanism:** PAC (Proxy Auto-Config) file served to the browser, which routes `.localhost` requests to hotel's proxy port. Alternatively, direct access at `localhost:2000/{appname}`.

**Container-aware:** No. Manages processes directly on the host.

**Dynamic port allocation:** No. Each registered app specifies its own port.

**Named domains:** Yes. `{appname}.localhost` via PAC file or `localhost:2000/{appname}`.

**Lace fit:** Poor. Unmaintained, relies on PAC file configuration (requires browser setup), no container awareness, no dynamic port allocation. The PAC-file approach is more fragile than RFC 6761 `.localhost` resolution. **Not recommended.**

#### Chalet (community fork of Hotel)

Multiple community forks exist (jeansaad/chalet, ToDesktop/chalet, etc.). Updated hotel to use `.localhost` TLD instead of `.dev`, but fundamentally the same architecture. Maintenance is sporadic across forks. Same limitations as hotel for lace's use case.

### Category 2: Container-Aware Reverse Proxies

#### Traefik (traefik/traefik)

| Attribute | Value |
|-----------|-------|
| Stars | 61,917 |
| Language | Go |
| License | MIT |
| Created | 2015-09-13 |
| Last push | 2026-02-25 |
| Maintenance | Very active (commercial backing by Traefik Labs) |

**What it does:** Cloud-native reverse proxy and load balancer. Docker provider watches the Docker socket for container events and auto-configures routing based on container labels.

**Proxy mechanism:** Full L7 reverse proxy with HTTP/HTTPS/TCP/UDP support. Docker containers add labels like `traefik.http.routers.myapp.rule=Host(\`myapp.docker.localhost\`)` and Traefik auto-generates routing config.

**Container-aware:** Yes. First-class Docker provider. Watches `/var/run/docker.sock`, auto-discovers containers, auto-removes routes when containers stop.

**Dynamic port allocation:** No. Containers must expose ports; Traefik routes to them. Does not allocate ports.

**Named domains:** Yes. Configurable via labels. Default rule `Host(\`{{ trimPrefix \`/\` .Name }}.docker.localhost\`)` provides automatic `{container-name}.docker.localhost` routing.

**Lace fit:** Architecturally viable but heavyweight. Running Traefik as a Docker container on the host with socket access would auto-discover devcontainers. However: (a) it's a significant dependency for a single-developer local tool, (b) it requires Docker Compose to define the Traefik service alongside devcontainers, (c) worktree-namespaced naming would need custom label generation in lace, (d) it solves more problems than lace needs (load balancing, middleware chains, metrics). Best suited if lace evolves toward a multi-developer or team-shared infrastructure model.

#### caddy-docker-proxy (lucaslorentz/caddy-docker-proxy)

| Attribute | Value |
|-----------|-------|
| Stars | 4,294 |
| Language | Go |
| License | MIT |
| Created | 2017-06-13 |
| Last push | 2026-02-25 |
| Maintenance | Active |

**What it does:** Caddy plugin that generates Caddyfile configuration from Docker container labels. Like Traefik's Docker provider but using Caddy as the proxy backend.

**Proxy mechanism:** Caddy reverse proxy, configured via labels like `caddy: myapp.localhost` and `caddy.reverse_proxy: "{{upstreams 80}}"`. Caddy handles TLS automatically for `.localhost` with self-signed certs.

**Container-aware:** Yes. Monitors Docker via socket, generates Caddy config dynamically.

**Dynamic port allocation:** No. Routes to container-exposed ports.

**Named domains:** Yes. Via Docker labels.

**Lace fit:** Similar to Traefik but simpler. Caddy's automatic HTTPS for `.localhost` domains is a nice feature. Still requires running as a Docker service. Lighter than Traefik but still adds a service-management dependency.

#### nginx-proxy (nginx-proxy/nginx-proxy)

| Attribute | Value |
|-----------|-------|
| Stars | 19,750 |
| Language | Python |
| License | MIT |
| Created | 2014-05-05 |
| Last push | 2026-02-16 |
| Maintenance | Active |

**What it does:** Docker container running nginx that auto-generates reverse proxy config from `VIRTUAL_HOST` environment variables on other containers. Watches Docker socket for container lifecycle events.

**Proxy mechanism:** nginx reverse proxy. Containers set `VIRTUAL_HOST=myapp.localhost` env var, nginx-proxy auto-generates upstream/server blocks.

**Container-aware:** Yes. Docker socket watching with `VIRTUAL_HOST` env var convention.

**Dynamic port allocation:** No. Routes based on exposed ports.

**Named domains:** Yes. Via `VIRTUAL_HOST` env var.

**Lace fit:** Mature and well-proven but requires `/etc/hosts` entries for non-`.localhost` domains. For `.localhost`, RFC 6761 handles DNS. Could work if lace set `VIRTUAL_HOST` env vars in devcontainer configs. Heavier than needed -- nginx configuration generation is more complex than the simple Host-header proxy lace requires.

#### Nginx Proxy Manager (NginxProxyManager/nginx-proxy-manager)

| Attribute | Value |
|-----------|-------|
| Stars | 31,837 |
| Language | TypeScript |
| License | MIT |
| Created | 2017-12-20 |
| Last push | 2026-02-25 |
| Maintenance | Very active |

**What it does:** nginx-based reverse proxy with a web GUI for managing proxy hosts, SSL certificates, and access lists. Designed for users who want point-and-click proxy management rather than config file editing.

**Proxy mechanism:** nginx, managed via a web admin interface on port 81.

**Container-aware:** Requires containers to be on the same Docker network. Manual configuration via GUI (no auto-discovery).

**Dynamic port allocation:** No.

**Named domains:** Yes, via GUI configuration.

**Lace fit:** Poor. GUI-centric management model is the opposite of lace's CLI-first, declarative approach. No auto-discovery, no programmatic API for route management. Designed for homelab/self-hosting, not developer tooling.

### Category 3: Port Management Libraries

#### get-port (sindresorhus/get-port)

| Attribute | Value |
|-----------|-------|
| Stars | ~920 |
| Language | JavaScript (ESM) |
| License | MIT |
| Weekly downloads | ~11M |
| Maintenance | Stable (mature, infrequent updates) |

**What it does:** Finds an available TCP port. Supports preferred port lists and port ranges. Pure JavaScript, zero dependencies.

**Mechanism:** Binds a TCP server to port 0 (or a specified port), gets the OS-assigned port, closes the server, returns the port number.

**Container-aware:** No.

**Dynamic port allocation:** Yes -- this is its entire purpose.

**Named domains:** No.

**Lace fit:** Lace already has its own port allocation logic (`port-manager.ts`) that scans the 22425-22499 range. get-port could replace the low-level "is this port free?" check, but it solves a narrower problem than lace's allocator (no persistence, no cross-restart stability, no range management). The TOCTOU race (port freed between check and bind) exists in both get-port and lace's allocator, but lace's symmetric binding model (`-p 22430:22430`) mitigates this.

#### detect-port (node-modules/detect-port)

| Attribute | Value |
|-----------|-------|
| Stars | ~384 |
| Language | JavaScript |
| License | MIT |
| Weekly downloads | ~5-6M |
| Maintenance | Active (last release < 1 year ago) |

**What it does:** Checks if a port is available. If the requested port is in use, suggests the next available port.

**Mechanism:** TCP connect probe. Returns the original port if available, or the next free port.

**Container-aware:** No.

**Dynamic port allocation:** Partial -- finds a free port but doesn't manage allocation state.

**Named domains:** No.

**Lace fit:** Same assessment as get-port. Used internally by Create React App and other tools for the "port 3000 is in use, want to use 3001?" pattern. Not a substitute for lace's coordinated port manager.

#### portfinder (http-party/node-portfinder)

| Attribute | Value |
|-----------|-------|
| Stars | ~620 |
| Language | JavaScript |
| License | MIT |
| Weekly downloads | ~3-4M |
| Maintenance | Stable |

**What it does:** Scans from a base port upward to find an available port. Supports both callback and Promise APIs.

**Mechanism:** Sequential TCP bind attempts starting from port 8000 (configurable).

**Container-aware:** No.

**Dynamic port allocation:** Yes.

**Named domains:** No.

**Lace fit:** Same category as get-port and detect-port. Lace's allocator already does this.

### Category 4: Worktree-Aware Tools

#### Portree (fairy-pitta/portree)

| Attribute | Value |
|-----------|-------|
| Stars | 3 |
| Language | Go |
| License | MIT |
| Created | 2026-01-30 |
| Last push | 2026-02-23 |
| Maintenance | Active but very early stage |

**What it does:** Git Worktree Server Manager. Manages multiple dev servers per git worktree with automatic port allocation and subdomain routing. Built specifically for the "parallel worktree development" problem.

**Proxy mechanism:** Optional reverse proxy that routes based on Host header subdomain. Access via `http://{branch-slug}.localhost:{proxy_port}`.

**Container-aware:** No. Manages host-side processes per worktree.

**Dynamic port allocation:** Yes. Configurable port range in `.portree.toml`. Linear probing for conflict resolution. Persists assignments in `.portree/state.json` with file-level locking.

**Named domains:** Yes. `{branch-slug}.localhost:{proxy_port}` with worktree-derived naming.

**Additional features:**
- TUI dashboard for interactive monitoring
- HTTPS proxy with auto-generated or custom certificates
- Environment variable injection (`$PORT`, `$PT_BRANCH`, `$PT_BACKEND_URL`)
- Per-branch configuration overrides in `.portree.toml`
- Service logs written to `.portree/logs/{branch-slug}.{service}.log`

**Lace fit:** **Closest conceptual match** to what lace needs. The architecture -- worktree-derived naming, configurable port ranges, subdomain proxy, state persistence -- maps almost 1:1 to lace's requirements. However: (a) it's a Go binary with no container awareness, (b) it manages host-side processes not devcontainer lifecycle, (c) 3 stars suggests very early adoption with unclear longevity, (d) the proxy runs on the host but expects backends to also be on the host. The architectural patterns are worth studying even if the tool itself isn't directly usable.

#### DevTree (pwrmind/DevTree)

| Attribute | Value |
|-----------|-------|
| Stars | 0 |
| Language | C# |
| License | MIT |
| Created | 2025-06-10 |
| Last push | 2025-06-10 |
| Maintenance | Abandoned (single commit, 8 months ago) |

**What it does:** Combines git worktrees with dedicated Dev Containers per branch. Includes port range configuration (e.g., 3000-4000) with automatic port allocation.

**Proxy mechanism:** None documented.

**Container-aware:** Yes, in concept. Manages devcontainers per worktree.

**Dynamic port allocation:** Yes. `PortManager` with `AcquirePort()` and `ReleasePort()` methods.

**Named domains:** No.

**Lace fit:** Conceptually interesting but practically useless -- single commit, zero stars, C# implementation. The architecture (WorktreeManager + DevContainerManager + PortManager + StateManager) validates lace's design direction. Not a real alternative.

#### opencode-devcontainers (athal7/opencode-devcontainers)

| Attribute | Value |
|-----------|-------|
| Stars | 94 |
| Language | JavaScript |
| License | MIT |
| Created | 2025-12-31 |
| Last push | 2026-02-23 |
| Maintenance | Active |

**What it does:** OpenCode plugin for isolated branch workspaces using devcontainers or git worktrees. Runs multiple devcontainer instances with auto-assigned ports.

**Proxy mechanism:** None. Uses `devcontainer up` with dynamically assigned ports.

**Container-aware:** Yes. Uses the devcontainer CLI to manage containers.

**Dynamic port allocation:** Yes. Derives PORT and database settings from worktree/branch name.

**Named domains:** No.

**Lace fit:** Validates the problem space -- other people are building worktree-aware devcontainer tooling. The approach of deriving ports from branch names is a simplistic version of lace's port allocator. No proxy/domain naming layer, so it doesn't help with requirements 2-4.

### Category 5: Framework and Monorepo Tools

#### Turborepo Microfrontends Proxy

Turborepo v2+ includes a built-in proxy server for microfrontend development. Reads `microfrontends.json` to map app names to ports, generates deterministic ports from app names if not specified (range 3000-8000), and serves a unified proxy entry point.

**Lace fit:** The deterministic port generation from names is an interesting pattern. However, Turborepo's proxy is tightly coupled to its monorepo task runner and is not usable standalone.

#### Vite Proxy Configuration

Vite's `server.proxy` config maps path prefixes to backend targets. Supports regex matching, WebSocket proxying, and `changeOrigin`. The `server.strictPort` option exits if the port is in use rather than scanning for alternatives.

**Lace fit:** Vite's proxy is for forwarding API requests from a frontend dev server to a backend, not for host-to-container domain routing. Not relevant to lace's problem.

#### Devcontainer Port Forwarding (VS Code / CLI)

The devcontainer spec provides `forwardPorts`, `appPort`, and `portsAttributes` properties. `forwardPorts` is not implemented by the devcontainer CLI (devcontainers/cli#22) -- it's a VS Code-only feature. `appPort` maps to Docker's `-p` flag. `portsAttributes` provides labeling and behavior control but not allocation.

VS Code auto-port-forwarding detects listening processes inside containers and creates IDE-level tunnels, controlled by `remote.autoForwardPortsSource`.

**Lace fit:** Already analyzed in detail in the `2026-02-06-port-provisioning-assessment.md` report. The spec has no dynamic allocation mechanism. Lace already uses `appPort` for Docker-level symmetric binding, which is the only mechanism that works with the devcontainer CLI.

### Category 6: DNS and TLS Infrastructure

#### dnsmasq (wildcard DNS)

Dnsmasq can resolve `*.test` or `*.localhost` to 127.0.0.1 with wildcard DNS support. Configuration example: `address=/test/127.0.0.1`. On Linux, requires coordination with systemd-resolved to avoid port 53 conflicts.

**Lace fit:** Unnecessary for `*.localhost` -- RFC 6761 handles this natively on modern systems. Would be needed only if lace wanted to use a custom TLD like `.test` or `.dev.local`. Adds a system-level dependency that conflicts with lace's userspace-only philosophy.

#### local-ssl-proxy (cameronhunter/local-ssl-proxy)

| Attribute | Value |
|-----------|-------|
| Stars | 741 |
| Language | TypeScript |
| License | MIT |
| Last push | 2023-10-02 |
| Maintenance | Stable but low activity |

**What it does:** Simple SSL HTTP proxy. Maps one HTTPS port to one HTTP port using self-signed certificates. No domain routing.

**Lace fit:** Too narrow. Only adds TLS to a single port mapping. Portless already includes TLS support with auto-generated certs. Not a substitute for a routing proxy.

#### mkcert

Local CA for generating trusted development certificates. Used by Portless (optionally) and Traefik local setups. If lace builds a native proxy with HTTPS support, mkcert is the standard approach for avoiding browser certificate warnings.

## The Worktree+Container Gap

After surveying the landscape, the following gap is clear:

```
                     Has Container Awareness
                     No                 Yes
                ┌──────────────────┬──────────────────┐
   Has Named    │ Portless         │ Traefik          │
   Domain       │ Hotel/Chalet     │ caddy-docker-    │
   Routing      │ Portree          │   proxy          │
                │                  │ nginx-proxy      │
                ├──────────────────┼──────────────────┤
   No Named     │ get-port         │ Lace (current)   │
   Domain       │ detect-port      │ DevTree          │
   Routing      │ portfinder       │ opencode-dc      │
                │                  │ devcontainer CLI  │
                └──────────────────┴──────────────────┘

                     Has Worktree Awareness
                     No                 Yes
                ┌──────────────────┬──────────────────┐
   Has Named    │ Portless         │ Portree          │
   Domain       │ Hotel/Chalet     │                  │
   Routing      │ Traefik          │ (nothing with    │
                │ caddy-docker-    │  container       │
                │   proxy          │  awareness)      │
                ├──────────────────┼──────────────────┤
   No Named     │ get-port         │ DevTree          │
   Domain       │ detect-port      │ opencode-dc      │
   Routing      │ devcontainer CLI │ Lace (current)   │
                └──────────────────┴──────────────────┘
```

**No tool occupies the intersection of all three: worktree awareness + container awareness + named domain routing.** This is the space lace would fill.

## Comparison Matrix

| Tool | Domain Routing | Container-Aware | Worktree-Aware | Dynamic Ports | Auto-Discovery | HTTPS | Active | Complexity | Lace Fit |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Portless** | Yes | No | No | Yes | No | Yes | Yes | Low | High (proxy arch) |
| **Hotel/Chalet** | Yes (PAC) | No | No | No | No | Partial | No | Low | Poor |
| **Traefik** | Yes | Yes | No | No | Yes (Docker) | Yes | Yes | High | Possible (heavy) |
| **caddy-docker-proxy** | Yes | Yes | No | No | Yes (Docker) | Yes | Yes | Medium | Possible (heavy) |
| **nginx-proxy** | Yes | Yes | No | No | Yes (Docker) | Yes | Yes | Medium | Possible |
| **Nginx Proxy Manager** | Yes | Partial | No | No | No (GUI) | Yes | Yes | Medium | Poor |
| **Portree** | Yes | No | Yes | Yes | No | Yes | Yes (early) | Low | High (concept) |
| **DevTree** | No | Yes | Yes | Yes | No | No | No | Medium | Dead |
| **opencode-dc** | No | Yes | Yes | Yes | No | No | Yes | Low | Partial |
| **get-port** | No | No | No | Yes | No | No | Yes | Minimal | Already covered |
| **detect-port** | No | No | No | Yes | No | No | Yes | Minimal | Already covered |
| **portfinder** | No | No | No | Yes | No | No | Yes | Minimal | Already covered |
| **Devcontainer CLI** | No | Yes | No | No | No | No | Yes | N/A | Already used |
| **local-ssl-proxy** | No | No | No | No | No | Yes | Low | Minimal | Narrow |
| **dnsmasq** | Wildcard | No | No | No | No | No | Yes | Medium | Unnecessary |

## Architectural Options for Lace

Given the gap analysis, lace has three paths forward:

### Path 1: Portless Integration (Short-term)

Use portless as the proxy, with lace populating `routes.json` after port allocation. Documented in `2026-02-25-portless-devcontainer-integration-analysis.md`.

**Pros:** Fastest to ship, leverages proven proxy code, portless is actively maintained.
**Cons:** PID liveness mismatch, dependency on a 10-day-old Vercel Labs project, portless has no container awareness (lace must bridge the gap).

### Path 2: Container-Aware Proxy Service (Medium-term)

Run Traefik or caddy-docker-proxy as a host-side Docker service, with lace generating labels on devcontainers for auto-discovery.

**Pros:** Auto-discovery, battle-tested proxy code, TLS, container lifecycle aware.
**Cons:** Adds a running Docker service as a prerequisite, heavier operational model, worktree naming requires custom label conventions, lace becomes partially a Docker Compose orchestrator.

### Path 3: Lace-Native Proxy (Long-term)

Build a lightweight reverse proxy into lace itself. Borrow the Host-header routing pattern from portless, the worktree-derived naming from portree, and the container lifecycle from lace's existing orchestration.

**Pros:** No external dependencies, full control over the proxy lifecycle, worktree+container naming is first-class, PID problem doesn't exist (lace IS the lifecycle manager), simplest operational model for users.
**Cons:** More code to maintain, must handle TLS/WebSocket/HTTP2, reinvents proven proxy logic.

## Recommendations

1. **Short-term:** Pursue Path 1 (portless integration) as documented in the companion report. It validates the UX with minimal code.

2. **Medium-term:** Evaluate Path 3 (lace-native proxy) once the naming/routing UX is validated. The proxy logic is ~200-400 lines of Node.js (portless proves this). Lace already has the port assignments, worktree names, and container lifecycle hooks needed.

3. **Do not pursue Path 2** (Traefik/Caddy Docker service) unless lace evolves toward team-shared infrastructure. It's the right architecture for multi-developer or CI environments but adds operational weight for the single-developer local case.

4. **Study portree's naming conventions** -- its `{branch-slug}.localhost` pattern and `.portree.toml` configuration model are directly applicable to lace's design, even though the tool itself is too early and not container-aware.

5. **Do not depend on devcontainer spec port features** for dynamic allocation or domain routing. The spec has no mechanism for either. Lace must own this entirely.

## Sources

- [vercel-labs/portless](https://github.com/vercel-labs/portless) -- Userspace localhost subdomain proxy
- [typicode/hotel](https://github.com/typicode/hotel) -- Process manager with local domains (unmaintained)
- [fairy-pitta/portree](https://github.com/fairy-pitta/portree) -- Git worktree server manager
- [pwrmind/DevTree](https://github.com/pwrmind/DevTree) -- Worktree + devcontainer isolation (abandoned)
- [athal7/opencode-devcontainers](https://github.com/athal7/opencode-devcontainers) -- Multi-devcontainer instances for OpenCode
- [traefik/traefik](https://github.com/traefik/traefik) -- Cloud-native reverse proxy with Docker provider
- [lucaslorentz/caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) -- Caddy reverse proxy with Docker label discovery
- [nginx-proxy/nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) -- Docker auto-configuring nginx reverse proxy
- [NginxProxyManager/nginx-proxy-manager](https://github.com/NginxProxyManager/nginx-proxy-manager) -- GUI-managed nginx reverse proxy
- [cameronhunter/local-ssl-proxy](https://github.com/cameronhunter/local-ssl-proxy) -- Simple SSL proxy for local dev
- [sindresorhus/get-port](https://github.com/sindresorhus/get-port) -- Find available TCP port
- [node-modules/detect-port](https://github.com/node-modules/detect-port) -- Port availability detection
- [http-party/node-portfinder](https://github.com/http-party/node-portfinder) -- Port finding utility
- [Portless: Eliminate Localhost Port Chaos](https://betterstack.com/community/guides/web-servers/portless/) -- Better Stack guide
- [Traefik Docker Documentation](https://doc.traefik.io/traefik/providers/docker/) -- Official Docker provider docs
- [RFC 6761: Special-Use Domain Names](https://datatracker.ietf.org/doc/html/rfc6761) -- `.localhost` reservation spec
- [Caddy Reverse Proxy Quick Start](https://caddyserver.com/docs/quick-starts/reverse-proxy) -- Caddy docs
- [Turborepo Microfrontends](https://turborepo.dev/docs/guides/microfrontends) -- Turborepo proxy docs
- [Dev Container metadata reference](https://containers.dev/implementors/json_reference/) -- Devcontainer spec
- [devcontainers/cli#796](https://github.com/devcontainers/cli/issues/796) -- Git worktree support issue
