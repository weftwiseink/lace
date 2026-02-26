---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-26T11:00:00-06:00
task_list: lace/portless
type: proposal
state: live
status: implementation_wip
tags: [portless, devcontainer-feature, worktrees, networking, port-allocation]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-26T21:00:00-06:00
  round: 4
related_to:
  - cdocs/reports/2026-02-26-portless-integration-design-rationale.md
  - cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md
  - cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md
  - cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md
  - cdocs/reports/2026-02-25-portless-alternatives-survey.md
  - cdocs/devlogs/2026-02-26-portless-integration-exploration.md
---

# Portless Devcontainer Feature for Worktree-Namespaced Local Domains

> **BLUF:** Create a prebuild devcontainer feature that installs portless and declares a lace-managed proxy port with asymmetric Docker mapping.
> Portless runs on its default port 1355 inside the container; lace allocates a host port (e.g., 22435) and maps asymmetrically (`22435:1355`), following the wezterm-server pattern.
> This gives developers `{name}.localhost:{port}` URLs for each service across worktrees, with zero lace core changes and no build-time port baking.
> Host-side cross-project domain routing is explicitly out of scope.

## Objective

Enable worktree-namespaced local domain access for dev servers running inside lace-managed devcontainers by packaging portless as a prebuild devcontainer feature with lace port integration.

After adding the feature, a developer working in a bare-worktree container with two worktrees (`main` and `add-websockets`) can do:

```sh
# In worktree: /workspace/main
portless web.main next dev
# → Next.js starts on port 4023 (allocated by portless)
# → Accessible at http://web.main.localhost:22435

# In worktree: /workspace/add-websockets
portless web.add-websockets next dev
# → Next.js starts on port 4024
# → Accessible at http://web.add-websockets.localhost:22435
```

Where `22435` is the lace-allocated host port, mapped asymmetrically to portless's default port 1355 inside the container.

## Background

Lace's single-container multi-worktree model creates a port conflict problem: multiple worktrees may each want port 3000 for their dev server.
Portless solves this by allocating unique ports per service and routing requests through a single proxy endpoint via Host-header matching on `*.localhost` subdomains.
Each service is accessible via `{name}.localhost` with Host-header matching.

Detailed rationale for all design decisions is in `cdocs/reports/2026-02-26-portless-integration-design-rationale.md`.

### Key prerequisites

- **Portless**: Runs its proxy on port 1355 by default.
  Supports dots in service names (e.g., `web.main` → `web.main.localhost`).
  App port allocation (4000-4999) is container-internal and needs no external control.
- **Lace prebuild features**: `customizations.lace.prebuildFeatures` in devcontainer.json enables asymmetric port mapping where lace allocates the host port and the feature's option default specifies the container-internal port.
  This is the same mechanism used by the wezterm-server feature.

## Proposed Solution

### Architecture

```
Host browser: http://web.main.localhost:22435
                         │
    *.localhost → 127.0.0.1  (nss-myhostname / RFC 6761)
                         │
    Docker: 22435:1355  (asymmetric, lace-allocated host port)
                         │
                         ▼
┌────────────────────────────────────────────┐
│  Devcontainer                              │
│                                            │
│  Portless proxy (port 1355, default)       │
│  ├── web.main → 127.0.0.1:4023            │
│  ├── api.main → 127.0.0.1:4024            │
│  └── web.add-websockets → 127.0.0.1:4025  │
│                                            │
│  /workspace/main/                          │
│  ├── next dev on :4023                     │
│  └── express on :4024                      │
│                                            │
│  /workspace/add-websockets/                │
│  └── next dev on :4025                     │
└────────────────────────────────────────────┘
```

The container always uses port 1355 (portless default).
Lace allocates the host-side port and Docker maps asymmetrically, with no port baking or env var propagation needed.

### Feature Specification

**`devcontainer-feature.json`**:

```jsonc
{
  "name": "Portless",
  "id": "portless",
  "version": "0.1.0",
  "description": "Installs portless for localhost subdomain routing. Declares a lace-managed proxy port with asymmetric mapping to portless's default port 1355.",
  "entrypoint": "/usr/local/share/portless-feature/entrypoint.sh",
  "options": {
    "proxyPort": {
      "type": "string",
      "default": "1355",
      "description": "Container-internal portless proxy port. With lace, this default is used as the container side of an asymmetric port mapping (e.g., 22435:1355). Not used by install.sh."
    },
    "version": {
      "type": "string",
      "default": "latest",
      "description": "Portless version to install (npm version specifier)."
    }
  },
  "customizations": {
    "lace": {
      "ports": {
        "proxyPort": {
          "label": "portless proxy",
          "onAutoForward": "silent",
          "requireLocalPort": true
        }
      }
    }
  },
  "installsAfter": [
    "ghcr.io/devcontainers/features/common-utils"
  ]
}
```

> **NOTE (lace/portless):** The `proxyPort` option's `default: "1355"` serves double duty.
> Without lace, it documents the standard portless proxy port.
> With lace (in `prebuildFeatures`), `injectForPrebuildBlock()` uses this default as the container-internal port in the asymmetric `appPort` entry.
> install.sh does not read `PROXYPORT` — the port is always 1355 inside the container.

**`install.sh`**:

```sh
#!/bin/sh
set -eu

VERSION="${VERSION:-latest}"

# ── Install portless ──

echo "Installing portless@${VERSION}..."

command -v npm >/dev/null 2>&1 || {
    echo "Error: npm is required. Add a Node.js feature first."
    exit 1
}

npm install -g "portless@${VERSION}"

command -v portless >/dev/null 2>&1 || {
    echo "Error: portless not found after install."
    exit 1
}
portless --version || true

# ── Entrypoint: auto-start portless proxy ──

FEATURE_DIR="/usr/local/share/portless-feature"
mkdir -p "$FEATURE_DIR"

_REMOTE_USER="${_REMOTE_USER:-root}"
cat > "$FEATURE_DIR/entrypoint.sh" << ENTRYPOINT
#!/bin/sh
# Auto-start portless proxy daemon on default port 1355.
# Lace maps this asymmetrically (e.g., 22435:1355) via appPort.
if command -v portless >/dev/null 2>&1; then
    if [ "\$(id -u)" = "0" ] && [ "${_REMOTE_USER}" != "root" ]; then
        su -c "portless proxy 2>/dev/null || true" ${_REMOTE_USER} &
    else
        portless proxy 2>/dev/null || true &
    fi
fi
ENTRYPOINT
chmod +x "$FEATURE_DIR/entrypoint.sh"

echo "Portless feature installed. Proxy will listen on port 1355 (default)."
```

No `/etc/profile.d/`, no `/etc/environment`, no `PORTLESS_PORT` env var — portless uses its built-in default (1355).
The entrypoint just starts the proxy daemon.

### How Lace Wires It Up

Zero lace core changes.
The existing prebuild features pipeline handles everything:

1. **Config read**: `lace up` reads `customizations.lace.prebuildFeatures` from devcontainer.json
2. **Metadata fetch**: fetches `devcontainer-feature.json` from OCI registry
3. **Asymmetric port injection**: `injectForPrebuildBlock()` sees `customizations.lace.ports.proxyPort`, reads option default `"1355"`, generates `appPort: ["${lace.port(portless/proxyPort)}:1355"]`
4. **Template resolution**: `${lace.port(portless/proxyPort)}` resolves to e.g. `22435`
5. **Docker mapping**: final `appPort: ["22435:1355"]` (asymmetric), `forwardPorts: [22435]`, `portsAttributes: { "22435": { label: "portless proxy (lace)", onAutoForward: "silent" } }`
6. **Container build**: devcontainer CLI installs portless; `PROXYPORT` is not passed (install.sh doesn't use it)
7. **Runtime**: entrypoint starts proxy on 1355; Docker maps host 22435 → container 1355

Port reassignment only changes the Docker mapping — no container rebuild needed.

### User's devcontainer.json

Minimal addition to an existing lace-managed devcontainer:

```jsonc
{
  "image": "node:24-bookworm",
  // Suppress VS Code auto-forward notifications for portless's internal app ports.
  "portsAttributes": {
    "4000-4999": { "onAutoForward": "silent" }
  },
  "customizations": {
    "lace": {
      "workspace": { "layout": "bare-worktree" },
      "prebuildFeatures": {
        "ghcr.io/weft/devcontainer-features/portless:0": {}
      }
    }
  }
}
```

Lace handles host port allocation and asymmetric Docker mapping.
The `portsAttributes` block silences VS Code notifications for portless's internal app port range.

### URL Access Patterns

| Setup level | URL pattern | Requirements |
|-------------|-------------|-------------|
| Feature + lace | `http://web.main.localhost:22435` | Add the feature to prebuildFeatures |
| Feature, no lace | `http://web.main.localhost:1355` | Manual port forwarding for 1355 |
| No feature | `http://localhost:3000` | Raw dev server (port conflicts across worktrees) |

### Naming Convention

Recommended pattern: **`{service}.{worktree}`** using dot-separated hierarchy.
Portless supports dots in names natively — each dotted name is an independent route with exact Host header matching.
Not enforced: any name works.
A future `lace dev` wrapper would enforce this automatically.

For single-service worktrees, the service prefix can be omitted: just `{worktree}`.

| Worktree | Service | Name | URL |
|----------|---------|------|-----|
| main | web | `web.main` | `http://web.main.localhost:22435` |
| main | api | `api.main` | `http://api.main.localhost:22435` |
| main | (default) | `main` | `http://main.localhost:22435` |
| add-websockets | web | `web.add-websockets` | `http://web.add-websockets.localhost:22435` |

## Design Decision Reference

See `cdocs/reports/2026-02-26-portless-integration-design-rationale.md` for detailed rationale on:

- Feature over docs-only approach
- Using upstream portless directly (no fork)
- Prebuild feature with asymmetric port mapping (wezterm-server pattern)
- Host-side routing as future work
- Dot-hierarchy naming `{service}.{worktree}`

## Known Limitations

1. **Entrypoint auto-start race.**
   The entrypoint starts the proxy in the background.
   Portless has built-in readiness polling: `portless <name> <command>` detects whether the proxy is running and waits or auto-starts as needed.

2. **npm required.**
   The feature installs portless via npm.
   Non-Node.js base images need a Node.js feature first (e.g., `ghcr.io/devcontainers/features/node:1`).
   `install.sh` checks for `npm` and fails with a clear message.

3. **Host port changes break bookmarks.**
   If lace reassigns the host port (rare — `.lace/port-assignments.json` ensures stable reuse), existing bookmarks and documentation referencing the old port number break.
   The container itself is unaffected (portless always uses 1355 internally).

### Troubleshooting

If the portless proxy is running but no traffic arrives:
- Verify Docker port mapping: `docker port <container>`
- Verify host DNS: `curl -v http://test.localhost:22435`
- Verify portless routes: `cat ~/.portless/routes.json`

## Test Plan

### Unit Tests (Feature Install)

1. **Install verification**:
   Run `install.sh` in a `node:24-bookworm` container.
   Verify `portless --version` succeeds.
2. **No env var baking**:
   After install, verify no `/etc/profile.d/portless-lace.sh` exists and no `PORTLESS_PORT` in `/etc/environment`.
   Portless should use its default port 1355.
3. **Version pinning**:
   Run with `VERSION=0.1.0` (or a known tag).
   Verify the pinned version installs.
4. **No npm**:
   Run in a `debian:bookworm` container (no Node.js).
   Verify failure message mentions npm requirement.

### Entrypoint Lifecycle Tests

5. **Proxy auto-start (non-root user)**:
   Configure `remoteUser` to a non-root user.
   Start container.
   Verify proxy is running as that user on port 1355.
6. **Proxy auto-start (root)**:
   Start container with root as the remote user.
   Verify proxy starts without `su` errors.
7. **Idempotent restart**:
   Stop and restart the container.
   Verify the proxy starts cleanly (no "port already bound" errors from a stale process).
8. **Port already bound**:
   Manually bind port 1355 before container start.
   Verify entrypoint handles the failure gracefully (`|| true` suppresses the error).

### Integration Tests (With Lace)

9. **Asymmetric port injection**:
   Run `lace up` with portless in `prebuildFeatures`.
   Verify `.lace/devcontainer.json` contains:
    - `appPort` entry with asymmetric mapping (e.g., `"22435:1355"`)
    - `forwardPorts` entry for the host port (e.g., `[22435]`)
    - `portsAttributes` with label "portless proxy (lace)"

10. **Port persistence**:
    Run `lace up` twice.
    Verify the same host port is allocated both times (from `.lace/port-assignments.json`).

11. **Multi-feature coexistence**:
    Run `lace up` with both portless and wezterm-server in prebuildFeatures.
    Verify distinct host ports allocated for each.

12. **Port reassignment without rebuild**:
    Allocate a port, build container, verify proxy works on host port N.
    Simulate conflict: manually bind port N on the host.
    Run `lace up` again — lace should allocate a new host port M.
    Verify `.lace/devcontainer.json` has `appPort: ["M:1355"]` (new mapping).
    Verify the existing container still works after restart (portless still on 1355 internally; Docker remaps to M).
    Use `docker port <container>` to confirm the new mapping.

### Smoke Tests (End-to-End)

13. **Proxy responds**:
    Start the container.
    Verify portless proxy is listening on 1355 inside the container:
    ```sh
    devcontainer exec -- curl -sf http://localhost:1355/ || echo "proxy running (404 expected)"
    ```

14. **Route registration and access**:
    Inside the container, start a service via portless (portless injects `PORT` env var into the child process):
    ```sh
    portless test.svc -- python3 -c "
    import http.server, os
    http.server.HTTPServer(('', int(os.environ['PORT'])), http.server.SimpleHTTPRequestHandler).serve_forever()
    " &
    curl -H "Host: test.svc.localhost" http://localhost:1355/
    ```

15. **Host access**:
    From the host, access via the lace-allocated port:
    ```sh
    curl -H "Host: test.svc.localhost" http://localhost:22435/
    ```

16. **Multiple services**:
    Register two services with dotted names, verify both are accessible via distinct subdomains.

### Manual Verification

17. **Browser access**:
    Open `http://web.main.localhost:22435` in a browser after running `portless web.main next dev`.
    Verify the app loads.

18. **Route listing**:
    Access `http://unknown.localhost:22435`.
    Verify portless serves its built-in route listing page.

## Implementation Plan

### Phase 1: Feature Scaffold

Create `devcontainers/features/src/portless/`:

**Files to create:**
- `devcontainer-feature.json` — copy structure from wezterm-server, adapt options and port declaration
- `install.sh` — npm install + entrypoint generation

**Step-by-step:**

1. Copy `devcontainers/features/src/wezterm-server/devcontainer-feature.json` as a starting template.
   Adapt: name, id, description, options (`proxyPort` default "1355", `version` default "latest"), port declaration, remove mount declarations.
2. Write `install.sh`:
   - npm check → `npm install -g portless@${VERSION}` → verify install
   - Generate entrypoint with root/non-root guard (copy pattern from wezterm-server lines 108-118)
   - The entrypoint runs `portless proxy` with no arguments (uses default 1355)
3. Verify standalone (without lace): `devcontainer build` + `devcontainer up` with the feature in top-level `features`.
   Portless should start on 1355.
   Access `http://test.localhost:1355` from inside the container.

**Pitfall: npm not available.**
The feature needs Node.js in the container.
If the base image doesn't have it, install.sh fails with a clear message.
Test with both `node:24-bookworm` (has npm) and `debian:bookworm` (no npm).

**Pitfall: entrypoint timing.**
The entrypoint runs before user shells.
`portless proxy` must be backgrounded (`&`) or daemonized — otherwise it blocks the entrypoint and the container hangs.
Verify the entrypoint returns promptly.

**Verification gate:** Tests 1-8 (unit + entrypoint lifecycle).

### Phase 2: Lace Integration

**Step-by-step:**

1. Add the portless feature to a test devcontainer.json in `customizations.lace.prebuildFeatures`:
   ```jsonc
   "customizations": {
     "lace": {
       "prebuildFeatures": {
         "./devcontainers/features/src/portless": {}
       }
     }
   }
   ```
   Use a local path reference for development iteration (no GHCR publish needed yet).

2. Run `lace up` and inspect `.lace/devcontainer.json`:
   - Verify `appPort` contains an asymmetric entry like `"22435:1355"`
   - Verify `forwardPorts` contains the host port
   - Verify `portsAttributes` has the correct label
   - Verify the portless feature option was NOT modified (prebuild path doesn't inject into options)

3. Build and start the container.
   From inside: `curl -sf http://localhost:1355/` should reach the portless proxy.
   From host: `curl -sf http://localhost:22435/` should reach the same proxy via Docker mapping.

4. Register a test service and verify the full user-facing workflow:
   ```sh
   # Inside the container:
   portless web.main -- python3 -m http.server ${PORT:-8000} &
   # From host:
   curl -H "Host: web.main.localhost" http://localhost:22435/
   # From host browser: http://web.main.localhost:22435
   ```

**Pitfall: `injectForPrebuildBlock()` skips if user provides explicit option value.**
If the user writes `"portless:0": { "proxyPort": "9999" }` in prebuildFeatures, the asymmetric injection is skipped (line 241-247 in template-resolver.ts), so the user would need to manually add `appPort` entries.
Test both: default (auto-injection) and explicit override.

**Pitfall: `generatePortEntries()` duplicate suppression.**
When an asymmetric `appPort` entry already exists for the allocated port, `generatePortEntries()` should NOT add a duplicate symmetric entry — verify no `"22435:22435"` appears alongside `"22435:1355"`.

**Pitfall: host DNS resolution.**
`*.localhost` must resolve to 127.0.0.1 on the host — this works natively on Linux (nss-myhostname / systemd-resolved) and macOS.
Test with `getent hosts web.main.localhost` or `curl -v http://web.main.localhost:22435/`.
If DNS fails, the feature still works via explicit Host header: `curl -H "Host: web.main.localhost" http://localhost:22435/`.

**Pitfall: portless service name with dots.**
Verify that `portless web.main <command>` registers the route as `web.main.localhost` (not `web.main` without the `.localhost` suffix).
Check `~/.portless/routes.json` after registration.

**Verification gate:** Tests 9-16 (integration + smoke).

### Phase 3: User-Facing Workflow Verification

Before documenting, verify the complete developer experience end-to-end:

1. **Fresh project setup:** Starting from a new devcontainer.json with just the portless feature, run `lace up`, open a terminal, and verify `portless --version` works.

2. **Multi-worktree scenario:** With two worktrees (`main` and `feature-x`):
   ```sh
   # Terminal 1 (in /workspace/main):
   portless web.main next dev
   # Terminal 2 (in /workspace/feature-x):
   portless web.feature-x next dev
   ```
   Verify both are accessible at their respective URLs from the host browser.
   Verify no port conflicts between the two services.

3. **Service lifecycle:** Start a service, stop it (Ctrl-C), restart it.
   Verify portless de-registers and re-registers the route.
   Verify `http://unknown.localhost:22435` shows the route listing page (useful for discoverability).

4. **Without lace:** Test the feature with plain `devcontainer up` (no lace).
   Portless should work on its default port 1355.
   The user manually forwards port 1355 if needed.

### Phase 4: Documentation

Add a portless usage section to `packages/lace/README.md` covering:
- How to add the feature (`prebuildFeatures` placement with example JSON)
- Naming convention with examples (dot hierarchy, default service shorthand)
- URL access patterns table (with and without lace)
- Relationship to the port allocation system (asymmetric mapping explanation)
- Troubleshooting checklist (DNS, Docker mapping, route registration)
- VS Code `portsAttributes` recommendation for the 4000-4999 range

### Phase 5: Publish Feature to GHCR

Prerequisite: identify a stable portless version to pin — since portless is new (created 2026-02-15), verify the target version passes all smoke tests before publishing.

1. Pin a known-good portless version in `devcontainer-feature.json` option default
2. Run the full test plan (tests 1-18) against the pinned version
3. Publish to `ghcr.io/weft/devcontainer-features/portless` following the wezterm-server publish process (see `cdocs/devlogs/2026-02-10-publish-wezterm-server-feature-to-ghcr.md`)
4. Update the devcontainer.json example to use the GHCR reference instead of local path

### Future Scope (Not This Proposal)

- **Host-side lace proxy on port 80**: Cross-project routing, `*.localhost` without port numbers.
  See `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md`.
- **`lace dev` wrapper**: Worktree-aware naming (`lace dev web next dev` → `portless web.main next dev`).
  Requires lace core change (new command).
- **`lace setup`**: One-time sysctl for port 80 binding.
  Required for host-side proxy.
- **Project-level port declarations**: Enable `customizations.lace.ports` in devcontainer.json (not just features).
  Would make docs-only portless integration viable.
