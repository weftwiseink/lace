---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T00:00:00-05:00
task_list: lace/research
type: report
state: live
status: wip
tags: [analysis, research, portless, networking, worktrees, devcontainers]
---

# Portless + Lace/Devcontainer Integration Analysis

> BLUF: Portless is a userspace HTTP reverse proxy (Node.js built-in modules only, zero proxy dependencies) that routes `*.localhost` subdomains to backend ports via Host-header matching, relying on RFC 6761 for DNS resolution. Integrating it with lace-managed devcontainers is architecturally viable because the integration surface is a single JSON file (`routes.json`) and lace already manages all the port allocation metadata needed to populate it. The proxy must run on the host — not in the container — which makes lace-native host-side orchestration the strongest integration path, and makes a standalone wrapper package a reasonable alternative that avoids coupling.

## Context / Background

Lace manages devcontainer orchestration with symmetric port allocation, worktree-aware workspace detection, and declarative feature metadata. When developing across multiple worktrees (e.g., `main`, `feature-auth`, `bugfix-api`), each worktree gets its own devcontainer with its own allocated ports.

The problem: developers must remember which port corresponds to which service in which worktree. Portless solves exactly this for non-containerized Node.js development — replacing `localhost:4237` with `api-main.localhost:1355`. The question is whether and how to bridge portless into the containerized worktree workflow that lace manages.

This report was prompted by interest in [vercel-labs/portless](https://github.com/vercel-labs/portless) and specifically the proxy mechanism question raised in [issue #23](https://github.com/vercel-labs/portless/issues/23).

## Key Findings

- **Proxy mechanism is a plain Node.js HTTP reverse proxy.** Host-header-based virtual hosting on a single port (default 1355). No `/etc/hosts` manipulation, no DNS modification, no kernel-level interception, no HTTP module patching. Uses only `node:http`, `node:http2`, and `node:net`.
- **DNS resolution relies entirely on RFC 6761.** The `.localhost` TLD is reserved; modern OS/browser stacks resolve `*.localhost` to `127.0.0.1` natively. Issue #23 documents edge cases where custom DNS configs (VPN, Pi-hole) intercept the query.
- **Sole runtime dependency is `chalk`.** The proxy, route management, certificate generation, and CLI are all built on Node.js built-ins.
- **Route state is a JSON file.** `routes.json` contains `[{hostname, port, pid}]` entries. File-watched with 100ms debounce. Stale routes cleaned via PID liveness checks.
- **PID liveness checks won't work across the container boundary.** `process.kill(pid, 0)` checks if a process is alive — container PIDs are not visible from the host. This is the critical constraint that shapes the integration architecture.
- **Lace already manages the exact metadata portless needs.** Port allocations, worktree names, feature labels, and service descriptions are all available in lace's resolution pipeline.

## Portless Architecture

```
Browser: http://myapp.localhost:1355/api/hello
              |
              v
   *.localhost → 127.0.0.1  (RFC 6761, OS/browser native)
              |
              v
  +-------------------------------+
  | Portless Proxy (port 1355)    |
  | Host: myapp.localhost         |
  |   → lookup routes.json        |
  |   → myapp → port 22430       |
  |   → http.request(127.0.0.1:  |
  |     22430)                    |
  |   → pipe response back       |
  +-------------------------------+
              |
              v
  +-------------------------------+
  | Devcontainer (lace-managed)   |
  | Port 22430 (symmetric bind)  |
  | Next.js dev server            |
  +-------------------------------+
```

### Route Storage

```
~/.portless/              (or PORTLESS_STATE_DIR)
├── routes.json           # [{hostname, port, pid}, ...]
├── proxy.pid             # Daemon PID
├── proxy.port            # Listening port
├── tls                   # TLS enabled marker
├── lock/                 # Filesystem mutex (mkdir-based)
├── ca.key / ca.crt       # Self-signed CA (not mkcert)
└── server.key / server.crt
```

### Key Implementation Details

| Aspect | Mechanism |
|--------|-----------|
| Routing | `Host` header (HTTP/1.1) or `:authority` pseudo-header (HTTP/2) |
| WebSocket | Raw TCP socket piping via `net.connect()` on upgrade |
| TLS | Custom CA with SNI-based per-hostname certs, first-byte peek for TLS vs plaintext |
| Loop detection | `x-portless-hops` header, max 5 hops → 508 |
| Forwarded headers | `X-Forwarded-For`, `-Proto`, `-Host`, `-Port` |
| Port allocation | Random-then-sequential scan in 4000–4999 range |
| Stale cleanup | `process.kill(pid, 0)` on route load |
| Locking | `mkdir` as atomic mutex, 10s stale timeout, 20 retries |
| Framework integration | `PORT` env var + CLI flag injection for Vite/Astro/Angular |

## Worktree Namespacing Model

With lace's worktree detection, each worktree gets a natural namespace:

| Worktree | Service | Portless Hostname | Lace Port |
|----------|---------|-------------------|-----------|
| `main` | api | `api-main.localhost` | 22430 |
| `main` | web | `web-main.localhost` | 22431 |
| `feature-auth` | api | `api-feature-auth.localhost` | 22435 |
| `feature-auth` | web | `web-feature-auth.localhost` | 22436 |

Lace already derives the worktree name from the filesystem layout (nikitabobko bare-worktree convention) and allocates unique ports per container. The hostname would be derived as `{service}-{worktree}.localhost`.

## Integration Options

### Option A: Standalone Wrapper Package

A thin package (e.g., `@weft/portless-lace`) that:
1. Reads `.lace/port-assignments.json` after `lace up` completes
2. Reads feature metadata for service labels
3. Derives worktree name from workspace detector
4. Writes entries to portless's `routes.json`
5. Ensures the portless proxy daemon is running

```sh
# Usage after lace up
lace up
portless-lace sync   # reads lace state, writes portless routes
```

**Pros:**
- No lace code changes required
- Loose coupling — works even if portless's internals change
- Can be developed and iterated independently
- Users opt in explicitly

**Cons:**
- Two-step workflow (must run after `lace up`)
- No declarative config — service names must be inferred or configured separately
- PID field in routes.json is meaningless (container PIDs not visible from host)
- Route cleanup requires custom logic (can't rely on portless's PID-based stale detection)

### Option B: Devcontainer Feature (Container-Side Portless)

A devcontainer feature that installs portless inside the container, with the host's portless state directory bind-mounted in.

```jsonc
{
  "features": {
    "ghcr.io/weft/devcontainer-features/portless:1": {}
  },
  "customizations": {
    "lace": {
      "mounts": {
        "portless-state": {
          "target": "/home/node/.portless",
          "recommendedSource": "~/.portless",
          "description": "Portless route state (shared with host)"
        }
      }
    }
  }
}
```

**Pros:**
- Standard devcontainer mechanism
- Feature metadata declares its own mounts/ports
- Container processes can use `portless <name> <command>` natively

**Cons:**
- **PID liveness checks break across the container boundary** — portless's stale route cleanup will see container PIDs as dead from the host, and vice versa. This is a fundamental impedance mismatch.
- The proxy still must run on the host (browser can't reach container-only ports unless forwarded)
- Race conditions on `routes.json` if both host and container portless instances write to it
- Lock directory (`mkdir`-based) semantics may differ across bind-mount filesystems

### Option C: Lace-Native Host-Side Orchestration

Lace manages portless route registration as part of its `lace up` pipeline, running entirely on the host.

```jsonc
{
  "customizations": {
    "lace": {
      "ports": {
        "apiPort": {
          "label": "API Server",
          "domainPrefix": "api"        // NEW field
        },
        "webPort": {
          "label": "Web Frontend",
          "domainPrefix": "web"        // NEW field
        }
      },
      "portless": {                    // NEW section
        "enabled": true,
        "proxyPort": 1355
      }
    }
  }
}
```

After port allocation, lace would:
1. Derive hostname: `{domainPrefix}-{worktreeName}.localhost`
2. Write route entries to portless's `routes.json`
3. Ensure the portless proxy daemon is running (start if needed)
4. On `lace down` or container stop, remove stale routes

**Pros:**
- Fully declarative — domain names configured alongside ports
- Single command (`lace up`) handles everything
- Lace controls the lifecycle — can clean up routes on container stop
- No PID mismatch — lace writes a sentinel PID (its own) or uses a custom cleanup mechanism
- Leverages existing template resolution, worktree detection, and port allocation

**Cons:**
- Adds portless as a lace dependency (or optional peer dependency)
- Tighter coupling — lace must understand portless's state format
- Changes to portless's `routes.json` schema would require lace updates

## The PID Problem (Cross-Boundary Constraint)

Portless's stale route cleanup is based on `process.kill(pid, 0)`:

```typescript
// From portless routes.ts
const isAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};
```

When the dev server runs inside a container:
- The container PID (e.g., PID 47) is **not visible** from the host's PID namespace
- `process.kill(47, 0)` on the host either fails (process doesn't exist) or checks the wrong process
- Portless will treat all container-originated routes as stale and remove them

**Mitigations:**
1. **Use lace's own PID as the route PID.** Lace runs on the host, so its PID is valid. Routes persist as long as the lace process (or a sentinel) is alive.
2. **Use a custom sentinel process.** A lightweight host-side process that stays alive while the container is running.
3. **Skip PID checks entirely.** Write routes without PIDs and rely on lace's lifecycle management for cleanup. This requires patching or wrapping portless's route store.
4. **Use container health checks.** Replace PID liveness with `docker inspect` or `devcontainer exec` health probes.

Option 1 (lace's own PID) is simplest and works with unmodified portless, as long as lace (or a background process it spawns) stays alive for the container's lifetime.

## RFC 6761 / DNS Considerations

Portless relies on `.localhost` resolving to `127.0.0.1` per RFC 6761. This works on:

| Platform | Status |
|----------|--------|
| Linux (systemd-resolved) | Works natively |
| macOS (stock) | Works on 15.x+ |
| macOS (custom DNS/VPN) | May fail (issue #23) |
| Chrome/Firefox/Safari | Resolve independently of OS |

For lace's Fedora Linux target (systemd-resolved), this is reliable. The devcontainer itself doesn't need `.localhost` resolution — only the host browser does.

## Recommendations

1. **Start with Option A (standalone wrapper)** as a proof-of-concept. It validates the concept with zero lace code changes, and the integration surface is small (read `.lace/port-assignments.json`, write `routes.json`).

2. **Graduate to Option C (lace-native)** if the pattern proves valuable. The declarative `domainPrefix` metadata is a natural extension of lace's existing port declaration model, and host-side lifecycle management solves the PID problem cleanly.

3. **Avoid Option B (container-side feature)** — the PID namespace mismatch and split-brain state issues make it the least viable path.

4. **For the PID problem**, use lace's own PID (or a spawned sentinel) as the route owner. This works with unmodified portless and aligns with lace's role as the lifecycle manager.

5. **Consider whether portless itself is the right dependency**, or whether the concept (Host-header routing to worktree-namespaced ports) could be implemented as a lightweight lace-native proxy. Portless is ~1500 lines of code with one dependency; the proxy logic is straightforward. A lace-native proxy would avoid the PID mismatch entirely and could use lace's port assignments directly without an intermediate JSON file.
