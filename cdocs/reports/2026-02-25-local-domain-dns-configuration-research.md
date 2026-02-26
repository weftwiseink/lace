---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T00:00:00-05:00
task_list: lace/research
type: report
state: live
status: wip
tags: [analysis, research, dns, networking, local-domains]
---

# Local Domain and DNS Configuration for Lace Devcontainers: Feasibility Research

> **BLUF:** Clean URLs like `http://my-feat.my-app-name.local` on port 80 are technically feasible on Fedora Linux but require a stack of three components -- a local DNS server (dnsmasq via NetworkManager plugin), a reverse proxy on port 80 (caddy or a lightweight Node.js proxy), and lace-managed configuration glue -- with a one-time root setup and ongoing rootless operation. The `.test` TLD is the safest choice (RFC 6761 reserved, no mDNS conflicts, no HSTS). The `sysctl net.ipv4.ip_unprivileged_port_start=80` approach is the lightest path to port 80 binding without root. Compared to the portless `*.localhost:1355` baseline, clean URLs provide a meaningfully better UX at the cost of significantly more system-level setup, a wider failure surface, and dependency on dnsmasq for DNS resolution. The recommendation is to pursue this as an optional "premium" configuration layer on top of the portless baseline -- not as a replacement.

## Context / Background

Lace is a devcontainer orchestration CLI running on Fedora Linux (systemd-resolved). It manages a single devcontainer per project with multiple git worktrees mounted inside. The current domain naming direction uses portless (a userspace HTTP reverse proxy) with `*.localhost` subdomains on port 1355, yielding URLs like `http://web-main.localhost:1355`.

The user wants to evaluate whether lace can provide a cleaner UX: `http://my-feat.my-app-name.test` -- custom domain names, no port number, automatic setup as part of `lace up`.

The ServerFault answer at `/a/284239` (from the question "In my /etc/hosts file on Linux/OSX, how do I do a wildcard subdomain?") recommends using **dnsmasq** as a lightweight local DNS server with wildcard support (`address=/test/127.0.0.1`), since `/etc/hosts` does not support wildcards. This is the foundational approach evaluated in this report.

### Related Reports

- `2026-02-25-portless-devcontainer-integration-analysis.md` -- Portless architecture and lace integration analysis
- `2026-02-25-portless-alternatives-survey.md` -- Survey of 15 alternative tools for local dev domains
- `2026-02-25-worktree-domain-routing-architecture.md` -- Architecture for portless inside single-container model

## 1. The ServerFault Approach (dnsmasq Wildcard DNS)

### What It Recommends

The ServerFault answer (question #118378, answer #284239) addresses the fact that `/etc/hosts` does **not** support wildcard entries. The recommended solution is dnsmasq -- a lightweight DNS forwarder/server that supports wildcard domain resolution with minimal configuration.

The core configuration is a single line:

```
address=/test/127.0.0.1
```

This tells dnsmasq: "resolve any query ending in `.test` (including `foo.test`, `bar.baz.test`, `anything.here.test`) to `127.0.0.1`."

### How It Works on Modern Linux (systemd-resolved)

On modern Fedora (33+), systemd-resolved runs as the system DNS stub resolver on `127.0.0.53:53`. This creates a port conflict with dnsmasq, which also wants port 53. There are three approaches to resolve this:

**Approach A: NetworkManager dnsmasq plugin (recommended for Fedora)**

NetworkManager can run dnsmasq as a subprocess, handling the port conflict internally:

```ini
# /etc/NetworkManager/conf.d/00-use-dnsmasq.conf
[main]
dns=dnsmasq
```

```ini
# /etc/NetworkManager/dnsmasq.d/lace-dev-domains.conf
address=/test/127.0.0.1
```

```sh
sudo systemctl restart NetworkManager
```

This is the cleanest integration on Fedora. NetworkManager spawns dnsmasq, which handles all DNS with wildcard support. `/etc/resolv.conf` points to `127.0.0.1`. No conflict with systemd-resolved because NetworkManager manages both.

**Approach B: Standalone dnsmasq on alternate IP**

Bind dnsmasq to `127.0.0.2` to avoid the port 53 conflict:

```ini
# /etc/dnsmasq.conf
listen-address=127.0.0.2
bind-interfaces
address=/test/127.0.0.1
```

```ini
# /etc/systemd/resolved.conf.d/lace.conf
[Resolve]
DNS=127.0.0.2
Domains=~test
```

The `~test` routing domain tells systemd-resolved: "forward all `.test` queries to the DNS server at `127.0.0.2`." The `~` prefix makes it a routing-only domain (not a search domain).

**Approach C: systemd-resolved split DNS only (no dnsmasq)**

systemd-resolved supports per-interface DNS routing via the `Domains=~domain` syntax, but it cannot act as an authoritative DNS server itself. It needs something to forward to. Without dnsmasq, there is no DNS server to resolve `*.test` to `127.0.0.1`. This approach alone is insufficient.

### Is It Still Applicable?

Yes, but the integration path is different from the original ServerFault answer (which predates systemd-resolved). The NetworkManager dnsmasq plugin (Approach A) is the modern Fedora-native way to achieve the same result.

## 2. DNS Resolution Mechanisms on Linux

### `/etc/hosts`

- **Wildcard support:** None. `/etc/hosts` is a static, line-by-line hostname-to-IP mapping. There is no glob, regex, or wildcard syntax. A [systemd RFE (#6081)](https://github.com/systemd/systemd/issues/6081) requesting wildcard support was filed in 2017 and remains open with no implementation.
- **Limitations:** Every hostname must be listed explicitly. For lace, this would mean adding a new line for every worktree+service combination whenever a new worktree is created or a dev server started.
- **Permissions:** Requires root to edit. No drop-in directory (`/etc/hosts.d/` does not exist on any standard Linux distribution).
- **Verdict:** Unworkable for dynamic, wildcard-based development domains.

### `systemd-resolved`

- **Custom TLD resolution:** Supports routing domains via the `Domains=~tld` syntax in resolved.conf drop-in files or via `resolvectl domain`. This directs queries for `*.tld` to a specific DNS server, but systemd-resolved cannot serve authoritative DNS responses itself -- it is a stub resolver only.
- **Split DNS:** Full support via per-interface DNS routing. NetworkManager pushes per-connection DNS configuration to systemd-resolved over D-Bus.
- **Configuration:** Drop-in files in `/etc/systemd/resolved.conf.d/` for global settings. Per-interface via NetworkManager or `resolvectl`.
- **Verdict:** Necessary infrastructure for routing queries to a local DNS server, but cannot replace one.

### `dnsmasq`

- **Wildcard support:** Full. `address=/test/127.0.0.1` resolves all `*.test` to `127.0.0.1`.
- **Integration with systemd-resolved:** Two approaches -- (1) NetworkManager dnsmasq plugin (replaces resolved's DNS handling), or (2) standalone dnsmasq on alternate IP with resolved routing domains.
- **Fedora availability:** `dnf install dnsmasq` -- widely available, well-maintained, lightweight (~500KB binary).
- **Configuration complexity:** Minimal. One config file with one line for wildcard resolution.
- **Verdict:** The standard tool for this problem. Well-proven, lightweight, widely documented.

### `nss-myhostname`

- **What it handles:** Resolves the system hostname, `localhost`, `*.localhost`, `*.localhost.localdomain`, and `_gateway` to appropriate addresses. Part of systemd.
- **Wildcard scope:** Only `*.localhost` and `*.localhost.localdomain`. Cannot be extended to custom TLDs.
- **Configuration:** None -- it is a compile-time NSS module.
- **Verdict:** This is why `*.localhost` works without any configuration on modern Linux. Cannot help with custom TLDs like `.test`.

### NetworkManager DNS Plugins

NetworkManager supports three DNS modes:

| Mode | Behavior |
|------|----------|
| `dns=default` | Writes upstream DNS to `/etc/resolv.conf` directly |
| `dns=systemd-resolved` | Pushes DNS config to systemd-resolved via D-Bus (Fedora default) |
| `dns=dnsmasq` | Spawns dnsmasq as a child process, handles all DNS locally |

The `dns=dnsmasq` mode is the recommended integration point for Fedora. It:
- Runs dnsmasq automatically when NetworkManager starts
- Reads drop-in configs from `/etc/NetworkManager/dnsmasq.d/`
- Handles the systemd-resolved port conflict by replacing resolved's DNS handling
- Supports wildcard DNS, split DNS, and custom upstream servers
- Requires root only for the initial config file creation

### One-Time Setup vs Ongoing Operations

| Operation | Root Required? |
|-----------|---------------|
| Install dnsmasq package | Yes (once) |
| Create NetworkManager config files | Yes (once) |
| Restart NetworkManager | Yes (once) |
| Add new domains/services | No (if using existing wildcard) |
| Start/stop dev servers | No |
| Lace up / lace down | No |

The wildcard `address=/test/127.0.0.1` means all subdomains are resolved without any per-project configuration. Once the one-time setup is done, lace never needs root again for DNS.

## 3. TLD Choice Analysis

### `.local`

- **Standard:** RFC 6762 (mDNS/Bonjour/Avahi)
- **Used by:** Network device discovery (printers, NAS, IoT), macOS Bonjour
- **Conflict risk:** **High.** On Fedora, Avahi (mDNS) is installed by default. `.local` queries go through mDNS resolution (`mdns4_minimal` in `/etc/nsswitch.conf`), not standard DNS. Using `.local` for development domains creates resolution conflicts -- mDNS and dnsmasq will fight over the same namespace.
- **Performance:** mDNS resolution adds latency (multicast timeout before fallback to DNS).
- **Verdict:** **Avoid.** The mDNS conflict makes `.local` unreliable and slow for development use.

### `.localhost`

- **Standard:** RFC 6761 (Special-Use Domain Names)
- **Browser behavior:** Treated as a secure context (HTTPS features available over HTTP). Chrome, Firefox, and Safari resolve `*.localhost` to `127.0.0.1` independently of the OS resolver.
- **OS behavior:** `nss-myhostname` resolves `*.localhost` to `127.0.0.1` natively on systemd-based Linux.
- **Pros:** Zero configuration for DNS. Already proven with portless.
- **Cons:** Cannot use port 80 easily -- the browser needs a port number unless a proxy listens on port 80 for `*.localhost`. There is no way to have `*.localhost` resolve to a *different* port; DNS only controls IP resolution, not port routing.
- **Verdict:** Best for the portless-style approach (fixed proxy port). Not ideal for "no port in the URL" because something still needs to listen on port 80.

### `.test`

- **Standard:** RFC 2606 / RFC 6761 (Reserved for Testing)
- **Browser behavior:** No special handling. No HSTS preload. Treated as a normal domain.
- **OS behavior:** Caching DNS servers should return NXDOMAIN without querying upstream. In practice, local resolvers pass the query through normally, and dnsmasq can serve authoritative responses.
- **mDNS conflict:** None. Avahi does not claim `.test`.
- **HSTS:** Not preloaded. HTTP works without issues.
- **Real-world adoption:** Used by puma-dev, Laravel Valet, and many other local dev tools as the default TLD.
- **Verdict:** **Best choice.** Reserved by RFC, no mDNS conflict, no HSTS, widely adopted for local development, works with dnsmasq out of the box.

### `.dev`

- **Status:** Real ICANN gTLD owned by Google.
- **HSTS:** Preloaded in all major browsers. Browsers force HTTPS for all `.dev` domains.
- **Verdict:** **Do not use.** HSTS preloading means HTTP will not work, and HTTPS requires valid certificates for every hostname. This was a common TLD for local development before Google acquired it, causing widespread breakage (puma-dev, pow, and others had to migrate to `.test`).

### `.internal`

- **Status:** Reserved by IANA (July 2024) for private-use applications. Will never be delegated in the root zone.
- **Browser support:** No special handling yet. Not standardized by IETF (Internet-Draft submitted but not ratified). No HSTS preload.
- **DNS behavior:** IANA reservation means it will never collide with a real TLD, but DNS servers do not yet have built-in handling for it (unlike `.localhost` or `.test`).
- **Adoption:** Very new. Limited tooling support. Used by some homelab setups (e.g., `*.atlas.internal`).
- **Verdict:** Promising for the future but too new for reliable tooling. No established conventions yet.

### `.home.arpa`

- **Status:** RFC 8375. Designated for home network use.
- **Verdict:** Verbose for development URLs. `my-feat.my-app.home.arpa` is unwieldy. Better suited for home networking equipment than developer tooling.

### Recommendation

**Use `.test`** as the primary TLD. It is:
- RFC-reserved (will never collide with a real domain)
- Free of mDNS/Avahi conflicts (unlike `.local`)
- Free of HSTS preloading (unlike `.dev`)
- Widely adopted by local development tools (puma-dev, Valet, DDEV)
- Well-documented with dnsmasq configurations
- Clean and short in URLs: `http://my-feat.my-app.test`

## 4. Port 80 Binding

### The Problem

On Linux, ports below 1024 are "privileged" -- only root (or processes with `CAP_NET_BIND_SERVICE`) can bind to them. Lace's proxy needs to listen on port 80 to eliminate port numbers from URLs.

### Option 1: `sysctl net.ipv4.ip_unprivileged_port_start` (Recommended)

Available since Linux kernel 4.11. Lowers the privileged port threshold system-wide:

```sh
# One-time setup (requires root)
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/90-lace-unprivileged-ports.conf
sudo sysctl --system
```

After this, **any** user process can bind to ports 80-1023. This is the lightest-weight approach and requires no per-binary capabilities.

**Pros:**
- Simplest. One sysctl, done forever.
- No per-binary capability management (setcap breaks on binary updates).
- Used by rootless Podman, rootless Docker, and other modern tools.
- The proxy process needs no special privileges.

**Cons:**
- System-wide effect -- any user process can bind to ports >= 80. On a single-user development machine, this is acceptable. On a shared server, it might be a concern.

### Option 2: `setcap CAP_NET_BIND_SERVICE`

Grant the capability to a specific binary:

```sh
sudo setcap 'CAP_NET_BIND_SERVICE=+eip' /path/to/node
```

**Pros:** Scoped to one binary.
**Cons:** Must be re-applied after every Node.js update. Breaks security models that depend on unsigned binaries not having capabilities. Fragile for development tooling.

### Option 3: `authbind`

Wrapper that grants port-binding permissions per-port and per-user:

```sh
sudo touch /etc/authbind/byport/80
sudo chmod 500 /etc/authbind/byport/80
sudo chown $(whoami) /etc/authbind/byport/80
authbind --deep node proxy.js
```

**Pros:** Fine-grained per-port, per-user control.
**Cons:** Requires wrapping every command invocation. Adds a dependency. Not widely used on modern systems.

### Option 4: systemd Socket Activation

systemd can create a socket on port 80 under its privileged context and pass it to a non-root service:

```ini
# /etc/systemd/system/lace-proxy.socket
[Socket]
ListenStream=80
Accept=no

[Install]
WantedBy=sockets.target
```

```ini
# /etc/systemd/system/lace-proxy.service
[Service]
User=mjr
ExecStart=/usr/bin/node /path/to/proxy.js
```

Alternatively, `systemd-socket-proxyd` can forward port 80 to a higher port where the proxy already listens:

```ini
# Forward port 80 to port 1355
ExecStart=/usr/lib/systemd/systemd-socket-proxyd 127.0.0.1:1355
```

**Pros:** No sysctl changes. systemd manages the privileged port. Clean separation of concerns.
**Cons:** Requires systemd unit files (root to install, once). More moving parts. The proxy must support socket activation (accepting a pre-opened fd) or use `systemd-socket-proxyd` as an intermediary.

### Option 5: Reverse Proxy (Caddy/Nginx)

Run a lightweight reverse proxy on port 80 that forwards to the userspace proxy:

```
# Caddyfile
*.test {
    reverse_proxy localhost:1355
}
```

**Pros:** Battle-tested proxy software. Caddy provides automatic HTTPS for `.localhost` domains.
**Cons:** Another running service. Caddy/Nginx itself needs port 80 (same problem, just moved). On Fedora, `httpd` may already claim port 80.

### Recommendation

**Use `sysctl net.ipv4.ip_unprivileged_port_start=80`** for the simplest path. It is a one-time root operation, widely used in modern container tooling, and lets the lace proxy bind to port 80 directly without wrappers, capabilities, or intermediary services.

If system-wide port lowering is unacceptable, use **systemd socket activation with `systemd-socket-proxyd`** to forward port 80 to the portless proxy port. This keeps the privileged port under systemd's control with no sysctl change.

## 5. Existing Tools That Accomplish This

### puma-dev (Ruby ecosystem)

**Architecture:**
- DNS: `/etc/resolver/test` on macOS (points to localhost). On Linux, requires the separate `dev-tld-resolver` tool or manual dnsmasq setup.
- Port 80: On macOS, launchd runs puma-dev on ports 80/443. On Linux, requires `setcap CAP_NET_BIND_SERVICE` or `authbind`.
- Routing: Symlink-based. `~/.puma-dev/myapp` symlinks to the app directory. `myapp.test` resolves to puma-dev, which finds the symlink and starts/manages the Rack process.
- **Key insight:** Automatic process management -- apps start on first request, stop after idle timeout.

**Lace relevance:** The symlink-based routing model is elegant but doesn't translate to devcontainers. The DNS and port 80 setup is instructive -- puma-dev proves the dnsmasq + port 80 pattern works in production for thousands of Ruby developers.

### pow (37signals/Basecamp)

**Architecture:**
- DNS: Custom DNS server on port 20560 for `.test` resolution. macOS resolver integration via `/etc/resolver/test`.
- Port 80: macOS PF firewall rule forwards port 80 traffic to pow's actual port (20559). `sudo pfctl -e -f /etc/pf.conf` enables the rule.
- Routing: Same symlink convention as puma-dev (~/.pow/).
- **Key insight:** The PF firewall redirect avoids running the process as root. Port 80 traffic hits the kernel, gets redirected to a high port. The process itself runs unprivileged.

**Lace relevance:** pow is macOS-only and deprecated (archived repo), but the PF firewall redirect concept maps to Linux's iptables REDIRECT. However, the sysctl approach is simpler than iptables rules.

### Laravel Valet

**Architecture:**
- DNS: dnsmasq configured via `~/.config/valet/dnsmasq.d/`. macOS resolver via `/etc/resolver/test`. On Linux (Valet Linux fork), dnsmasq is configured system-wide.
- Port 80: Nginx runs on port 80, configured by Valet. Nginx is the reverse proxy that routes requests to PHP-FPM backends.
- Routing: Directory-based. `valet park` registers the current directory. Subdirectories become sites: `~/Sites/myapp` becomes `myapp.test`.
- **Key insight:** Nginx as the port 80 proxy is heavier but battle-tested. Valet manages the Nginx config automatically.

**Lace relevance:** Valet's architecture (dnsmasq + Nginx on port 80 + directory-based routing) is the most directly applicable pattern. The difference is that lace routes to container ports rather than local PHP processes.

### DDEV (Docker-based PHP/CMS development)

**Architecture:**
- DNS: DDEV maintains wildcard DNS records for `ddev.site` that point to `127.0.0.1`. This is an externally-hosted wildcard DNS record -- `*.ddev.site` resolves to `127.0.0.1` via public DNS. Requires internet connectivity.
- Fallback: When offline, DDEV edits `/etc/hosts` directly (requires `sudo` via the `ddev-hostname` binary).
- Port 80: DDEV uses a `ddev-router` container (Traefik-based) that binds to ports 80 and 443 on the host.
- Routing: Docker label-based. The router container auto-discovers project containers via Docker socket.
- **Key insight:** The `ddev.site` wildcard DNS trick is clever -- no local DNS server needed when online. The `/etc/hosts` fallback for offline use shows the tradeoff.

**Lace relevance:** The `ddev.site` pattern is interesting but requires DDEV (or lace) to maintain a public DNS record. Not suitable for custom TLDs. The Traefik router container is heavy for single-developer use.

### devdns (Docker DNS auto-discovery)

**Architecture:**
- A Docker container running dnsmasq that watches the Docker socket for container start/stop events.
- Automatically creates DNS records: `{container-name}.test` resolves to the container's IP.
- Runs on port 53, exposed via `-p 53:53/udp`.
- **Key insight:** Docker socket watching for auto-discovery is the same pattern Traefik uses.

**Lace relevance:** devdns solves a different problem (container-to-container DNS within Docker networks) but its architecture -- dnsmasq + Docker socket events -- is a useful reference for auto-configuration.

### Node.js Equivalents

No widely-adopted Node.js tool provides the full dnsmasq + port 80 + domain routing stack. Portless comes closest for the proxy layer but does not handle DNS or port 80. The Node.js ecosystem tends to rely on higher ports and `*.localhost` rather than custom TLDs on port 80.

## 6. Lace-Managed DNS Configuration

### Could lace maintain its own hosts-style config?

Not effectively. `/etc/hosts` does not support wildcards, and there is no `/etc/hosts.d/` drop-in directory on any standard Linux distribution (including Fedora). Each new worktree+service combination would require adding a line to `/etc/hosts`, which requires root and is fragile.

### How would dnsmasq integration work?

Lace would not need per-project dnsmasq configuration if using a wildcard TLD. The one-time setup:

```ini
# /etc/NetworkManager/dnsmasq.d/lace-dev-domains.conf
address=/test/127.0.0.1
```

This resolves **all** `*.test` to `127.0.0.1`. Lace never needs to touch DNS configuration again -- the wildcard covers every possible subdomain.

If per-project TLDs were desired (e.g., `*.myapp.test`, `*.otherapp.test`), no additional DNS configuration is needed -- `address=/test/127.0.0.1` already covers all subdomains of `.test`.

### Could lace write to `/etc/hosts` directly?

Technically yes, but:
- Requires root (or a setuid helper like DDEV's `ddev-hostname`)
- No wildcard support
- Must add/remove entries on every `lace up`/`lace down`
- Race conditions with other tools editing `/etc/hosts`
- Must handle cleanup on crashes/unexpected exits

DDEV took this approach and had to invest significant engineering in the `ddev-hostname` binary for security. It is a solved problem but adds complexity.

### Could a lace-managed dnsmasq instance work?

Yes, and this is architecturally clean:

```
                One-time setup (root)              Ongoing operation (rootless)
                ─────────────────────              ────────────────────────────
                1. dnf install dnsmasq             lace up:
                2. Create NM dnsmasq config          - Start proxy on port 80
                3. Set sysctl for port 80            - Route *.test to container ports
                4. Restart NetworkManager          lace down:
                                                     - Stop proxy
```

After the one-time setup, lace operates entirely in userspace. The dnsmasq wildcard handles DNS permanently. The sysctl allows port 80 binding permanently. Lace only manages the reverse proxy routing table.

### Permission Model

| Component | When | Who | Root? |
|-----------|------|-----|-------|
| Install dnsmasq | Once | User/admin | Yes |
| Configure NetworkManager dnsmasq plugin | Once | User/admin | Yes |
| Set sysctl for port 80 | Once | User/admin | Yes |
| Restart NetworkManager | Once | User/admin | Yes |
| Run lace proxy on port 80 | Every `lace up` | Lace (userspace) | No |
| Manage routing table | Every `lace up`/`lace down` | Lace (userspace) | No |
| DNS resolution of *.test | Always | dnsmasq (auto) | No |

A `lace setup` command could automate the one-time root operations, similar to `puma-dev -setup` or `valet install`.

## 7. Complete Architecture Sketch

### Full Stack: DNS Resolution to Container Port

```
Browser: http://web-my-feat.my-app.test
         │
         ▼
┌─────────────────────────────────────────────────┐
│ DNS Resolution                                  │
│                                                 │
│   Browser asks: "web-my-feat.my-app.test → ?"   │
│                                                 │
│   glibc → nsswitch.conf → nss-resolve           │
│   → systemd-resolved (stub at 127.0.0.53)       │
│   → NetworkManager dnsmasq plugin               │
│   → dnsmasq: address=/test/127.0.0.1            │
│   → Answer: 127.0.0.1                           │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Port 80 Proxy (lace-managed, userspace)         │
│                                                 │
│   Listens on 127.0.0.1:80                       │
│   (allowed by sysctl unprivileged port start)   │
│                                                 │
│   Receives request:                             │
│     Host: web-my-feat.my-app.test               │
│                                                 │
│   Parses hostname:                              │
│     service = "web"                             │
│     worktree = "my-feat"                        │
│     project = "my-app"                          │
│                                                 │
│   Looks up routing table:                       │
│     my-app/my-feat/web → localhost:22435         │
│                                                 │
│   Proxies to: http://127.0.0.1:22435            │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Docker Port Mapping                             │
│                                                 │
│   Host port 22435 → Container port 22435        │
│   (symmetric binding via lace appPort)          │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Devcontainer (lace-managed)                     │
│                                                 │
│   Portless proxy (port 1355, internal)          │
│   → or direct dev server on port 22435          │
│                                                 │
│   Next.js/Vite/etc dev server                   │
│   serving worktree "my-feat" content            │
└─────────────────────────────────────────────────┘
```

### What Requires Root and When

```
ONE-TIME SETUP (root, via `lace setup`):
  ├── dnf install dnsmasq
  ├── Create /etc/NetworkManager/conf.d/00-use-dnsmasq.conf
  │   └── [main]
  │       dns=dnsmasq
  ├── Create /etc/NetworkManager/dnsmasq.d/lace-dev-domains.conf
  │   └── address=/test/127.0.0.1
  ├── Create /etc/sysctl.d/90-lace-unprivileged-ports.conf
  │   └── net.ipv4.ip_unprivileged_port_start=80
  ├── sysctl --system
  └── systemctl restart NetworkManager

ONGOING OPERATION (rootless, via `lace up` / `lace down`):
  ├── Start/stop proxy on port 80
  ├── Register/deregister routes in proxy routing table
  ├── Start/stop devcontainers (Docker, already rootless-capable)
  └── Allocate/deallocate ports
```

### What Can Be Automated vs Manual

| Step | Automatable? | How |
|------|-------------|-----|
| Package installation | Yes | `lace setup` runs `sudo dnf install -y dnsmasq` |
| Config file creation | Yes | `lace setup` writes files with `sudo tee` |
| sysctl configuration | Yes | `lace setup` writes sysctl drop-in and reloads |
| NetworkManager restart | Yes | `lace setup` runs `sudo systemctl restart NetworkManager` |
| Proxy start on `lace up` | Yes | Lace spawns proxy process |
| Route management | Yes | Lace updates proxy routing table from port allocations |
| Route cleanup on `lace down` | Yes | Lace removes routes, stops proxy |

Everything is automatable. `lace setup` would be a one-time interactive command that explains what it will do, asks for sudo, and configures the system.

## Comparison: Clean URLs vs Portless Baseline

| Dimension | Portless Baseline (`*.localhost:1355`) | Clean URLs (`*.test:80`) |
|-----------|---------------------------------------|--------------------------|
| **URL appearance** | `http://web-main.localhost:1355` | `http://web-main.my-app.test` |
| **DNS setup** | None (RFC 6761, nss-myhostname) | dnsmasq via NetworkManager (one-time root) |
| **Port 80** | Not needed (port 1355) | sysctl change (one-time root) |
| **Root operations** | Zero | One-time setup only |
| **System packages** | None | dnsmasq |
| **System config files** | None | 3 files (NM conf, dnsmasq conf, sysctl) |
| **Failure modes** | Proxy down = no routing | Proxy down OR dnsmasq down OR NM misconfigured = no routing |
| **Offline works?** | Yes (localhost always resolves) | Yes (dnsmasq is local, no internet needed) |
| **VPN interference** | Possible (issue #23, some VPNs hijack localhost) | Less likely (dnsmasq runs locally, VPNs don't usually claim .test) |
| **Multi-project** | Different proxy ports per project | Single port 80 proxy, project name in hostname |
| **Browser secure context** | Yes (.localhost is secure context) | No (.test is not a secure context) |
| **HTTPS** | Portless supports TLS | Would need cert generation for .test domains |
| **Cross-platform** | Works on macOS/Linux without config | Linux-specific (NM dnsmasq plugin, sysctl) |
| **Maintenance burden** | Low (userspace only) | Medium (system packages, config files to maintain across OS updates) |

### UX Improvement Assessment

The UX improvement of clean URLs is real but modest:

- Removing the port number saves ~5 characters and eliminates the cognitive burden of remembering port 1355.
- Custom domain names (`.test` vs `.localhost`) are slightly more readable but functionally equivalent.
- Project name in the hostname (`my-app.test`) provides clearer project identification than the portless approach where all projects share `*.localhost`.
- Multi-project routing through a single port 80 is genuinely better than per-project proxy ports.

The setup cost is significant but one-time. The maintenance cost is low (system packages survive OS updates, sysctl and NM configs are stable across Fedora versions). The failure surface is wider (three system components vs one userspace process).

## Recommendations

1. **Keep portless `*.localhost:1355` as the baseline.** It works with zero system configuration, zero root, and zero package dependencies. It is the right default for most users and for CI environments.

2. **Offer clean URLs as an optional "premium" layer** via `lace setup`. Users who want `http://web-main.my-app.test` run a one-time setup command that configures dnsmasq, sysctl, and the port 80 proxy. Users who do not care about clean URLs continue using portless with no additional setup.

3. **Use `.test` as the TLD.** It is RFC-reserved, mDNS-conflict-free, HSTS-free, and widely adopted by local development tools. The naming convention would be `{service}-{worktree}.{project}.test`.

4. **Use the NetworkManager dnsmasq plugin** for DNS resolution on Fedora. It is the cleanest integration path, avoids port 53 conflicts with systemd-resolved, and supports wildcard DNS natively.

5. **Use `sysctl net.ipv4.ip_unprivileged_port_start=80`** for port 80 binding. It is the simplest approach, requires no per-binary capability management, and is widely used by modern container tooling.

6. **Build the port 80 proxy as a lace-native component** (not as a dependency on Caddy, Nginx, or another reverse proxy). The proxy logic is straightforward -- Host-header routing to a port lookup table. Portless proves this is ~200-400 lines of Node.js. A lace-native proxy avoids external service dependencies and can use lace's port allocation metadata directly.

7. **Implement `lace setup`** as an interactive, idempotent setup command that:
   - Checks for existing configuration
   - Explains what it will do
   - Asks for sudo confirmation
   - Installs dnsmasq, writes config files, sets sysctl
   - Verifies the setup works (`dig anything.test @127.0.0.1`)
   - Reports success/failure clearly

8. **Defer HTTPS for `.test` domains.** HTTP is sufficient for local development. `.test` is not a secure context (unlike `.localhost`), but this rarely matters for dev servers. If HTTPS is needed later, a local CA (mkcert) can be integrated.

## Sources

- [ServerFault: Wildcard subdomain in /etc/hosts](https://serverfault.com/questions/118378/in-my-etc-hosts-file-on-linux-osx-how-do-i-do-a-wildcard-subdomain) -- Original question with dnsmasq recommendation
- [Sixfeetup: Local Development with Wildcard DNS on Linux](https://www.sixfeetup.com/blog/local-development-with-wildcard-dns-on-linux) -- dnsmasq + systemd-resolved integration guide
- [Fedora Magazine: Using the NetworkManager's DNSMasq Plugin](https://fedoramagazine.org/using-the-networkmanagers-dnsmasq-plugin/) -- NM dnsmasq plugin configuration
- [Fedora Magazine: systemd-resolved introduction to split DNS](https://fedoramagazine.org/systemd-resolved-introduction-to-split-dns/) -- Split DNS with routing domains
- [Fedora Discussion: Setting up a local domain](https://discussion.fedoraproject.org/t/systemd-resolved-setting-up-a-local-domain/126738) -- Community discussion on Fedora DNS configuration
- [ArchWiki: systemd-resolved](https://wiki.archlinux.org/title/Systemd-resolved) -- Comprehensive resolved configuration reference
- [systemd/systemd#6081](https://github.com/systemd/systemd/issues/6081) -- RFE for wildcard /etc/hosts support (open since 2017)
- [Baeldung: Bind Non-root Process to Privileged Port](https://www.baeldung.com/linux/bind-process-privileged-port) -- CAP_NET_BIND_SERVICE, sysctl, authbind comparison
- [puma/puma-dev](https://github.com/puma/puma-dev) -- Ruby development server with .test DNS and port 80
- [Laravel Valet Documentation](https://laravel.com/docs/12.x/valet) -- dnsmasq + Nginx architecture for local dev
- [Pow Manual](https://github.com/basecamp/pow/blob/master/MANUAL.md) -- PF firewall redirect for port 80
- [DDEV: Hostnames and Wildcards](https://ddev.com/blog/ddev-name-resolution-wildcards/) -- ddev.site wildcard DNS and /etc/hosts fallback
- [ruudud/devdns](https://github.com/ruudud/devdns) -- Docker DNS auto-discovery with dnsmasq
- [nss-myhostname(8)](https://www.freedesktop.org/software/systemd/man/latest/nss-myhostname.html) -- systemd localhost resolution module
- [RFC 6761: Special-Use Domain Names](https://datatracker.ietf.org/doc/html/rfc6761) -- .localhost and .test reservation
- [RFC 2606: Reserved Top Level DNS Names](https://datatracker.ietf.org/doc/html/rfc2606) -- .test TLD reservation
- [IANA: Proposed .internal TLD](https://www.iana.org/news/2024/proposed-private-use-tld) -- .internal reservation (2024)
- [Wikipedia: .internal](https://en.wikipedia.org/wiki/.internal) -- .internal TLD status
- [systemd-socket-proxyd(8)](https://www.freedesktop.org/software/systemd/man/latest/systemd-socket-proxyd.html) -- Socket-activated port forwarding proxy
- [liquidat: Run programs on privileged ports via systemd](https://liquidat.wordpress.com/2018/01/04/howto-run-programs-as-non-root-user-on-privileged-ports-via-systemd/) -- systemd socket activation for port 80
- [Michael Catanzaro: Understanding systemd-resolved and Split DNS](https://blogs.gnome.org/mcatanzaro/2020/12/17/understanding-systemd-resolved-split-dns-and-vpn-configuration/) -- Deep dive on split DNS with resolved
- [Sparktree: Local Development with Wildcard DNS](https://blog.thesparktree.com/local-development-with-wildcard-dns) -- dnsmasq wildcard setup guide
- [tty4.dev: Use dnsmasq for local DNS with wildcard support](https://tty4.dev/development/local-dnsmasq-wildcard/) -- dnsmasq with .internal TLD
- `cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md` -- Portless integration analysis
- `cdocs/reports/2026-02-25-portless-alternatives-survey.md` -- Alternatives survey
- `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md` -- Container-side portless architecture
