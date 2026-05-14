---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T12:00:00-07:00
task_list: weftwise/parallel-feature-development/clean-urls
type: report
state: live
status: review_ready
tags: [portless, clean-urls, parallel-development, weftwise, planning]
---

# Clean Portless URLs: Fresh-Eyes Survey

> BLUF: The cleanest single-project path to `http://web.main.localhost/` is to drop the asymmetric port mapping and have lace publish container port 1355 to host port 80 directly, with the one-time sysctl `net.ipv4.ip_unprivileged_port_start=80` to make that bind unprivileged.
> No host daemon, no fork of portless, no per-browser config.
> The existing host-proxy daemon proposal only earns its weight when you actually need many projects sharing port 80 at the same time on one host.
> If multi-project concurrency is required, a one-line `caddy`/`nginx` `user` service is materially lighter than a custom Node.js daemon, and gives you a free HTTPS path via Caddy's local CA.

## Problem Definition

Lace runs an in-container portless reverse proxy listening on container port 1355.
Lace's port allocator maps that asymmetrically to a host port in 22425-22499 (e.g. 22435:1355).
Browser must today visit `http://web.main.localhost:22435/`.
The user wants the port suffix gone: `http://web.main.localhost/` reaches the dev server.

Hard constraints:

- Rootless podman; one-time `sudo` acceptable, persistent host-side root daemon is not.
- Single developer, single machine.
- Portless feature stays as-is (no fork).
- Browser-agnostic; no PAC files, no extension config.
- Must work outside VS Code.

## Upstream Capability Findings (portless 0.13.0)

Source: README in the `portless@0.13.0` tarball published by vercel-labs.

Portless natively binds port 80 (HTTP) or 443 (HTTPS) without an external helper:

- `portless proxy start --no-tls` listens on port 80 (plain HTTP).
- `portless proxy start` listens on port 443 with a generated local CA (HTTPS, HTTP/2).
- `portless proxy start -p <N>` listens on a custom port.
- `portless trust` installs the local CA into the system trust store (per-user where possible, falls back to sudo).
- `portless service install` registers an OS startup unit so the proxy comes up on boot.
- `portless hosts sync` writes `.localhost` entries into `/etc/hosts` (only needed for Safari; Chromium/Firefox resolve `*.localhost` natively via RFC 6761).
- `portless alias <name> <port>` registers static routes - this is how lace would point at host-side targets if we ran portless on the host instead of in-container.
- `--wildcard` enables fallback for unregistered subdomains.
- Auto-elevation: on Linux, binding 80/443 prompts for `sudo` once.

> NOTE(opus/clean-urls): The README explicitly markets portless as a clean-URL tool for both humans and agents.
> Treating it purely as a 1355-listening sidecar inside the container leaves most of its host-side ergonomics unused.

Implication: portless itself already solves clean URLs - if it can run on the publicly bound port.
The lace integration spends that capability by hiding portless inside the container behind an asymmetric port map.

## Candidate Approaches

Each row covers mechanism, cost, fragility, and HTTPS-readiness.

### A. Symmetric port-80 publish + unprivileged-port sysctl

Mechanism: change lace's port allocator for portless from `random:1355` to `80:1355`.
One-time host setup: `sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80` plus a `/etc/sysctl.d/` drop-in to persist.
Browser visits `http://web.main.localhost/`; podman forwards to container 1355; portless demuxes by Host header.

Cost: trivial - a lace setup step plus a port-mapping change in the portless feature's lace metadata.
Fragility: low for a single project. Breaks immediately when a second project also wants port 80 on the same host.
Root: one-time sysctl only.
Multi-project: no, unless only one project is `up` at a time.
HTTPS: no path to HTTPS without per-cert work; portless's TLS is bypassed because TLS terminates inside the container behind a plaintext hop and the CA never reaches the host.

### B. Move portless to the host, use `alias` for container backends

Mechanism: install `portless` on the host. `portless service install` registers a user-level startup unit binding 80 (after sysctl) or 443 (with `portless trust`).
For each project, lace allocates a normal random host port for the dev server / in-container portless, then calls `portless alias web.main <host-port>` on the host.

Cost: moderate - lace needs to manage `portless alias` lifecycle (add on `lace up`, remove on `lace down`).
Fragility: low. Portless's own state machine handles route registry.
Root: `sudo sysctl` once for 80, or `portless trust` for 443 (one-time CA install).
Multi-project: yes, natively - portless is designed for many `<name>.localhost` aliases.
HTTPS: yes, free, via portless's local CA.

> NOTE(opus/clean-urls): This is the design portless was built for.
> The current lace integration runs portless in the wrong layer for clean URLs - it works as service-multiplexing inside a single project but cannot resolve the host-port question.

### C. socat / nft redirect 80 -> 22435

Mechanism: `systemd --user` unit running `socat TCP-LISTEN:80,reuseaddr,fork TCP:127.0.0.1:22435` (plus sysctl), or a persistent `nft` rule redirecting 80 to 22435.
Cost: trivial for one project.
Fragility: socat is robust; nft rules persist across reboots only with a service.
Root: sysctl for socat user-binding; nft requires `CAP_NET_ADMIN` (effectively root) to install rules.
Multi-project: no - one redirect target, one port. You would need a Host-header-aware proxy to demux, which is exactly what portless already is.
HTTPS: no.

### D. Per-project loopback IPs (127.0.0.2:80, 127.0.0.3:80, ...)

Mechanism: lace allocates a `127.0.0.x` per project; binds each project's portless on `127.0.0.x:80` via podman `--publish 127.0.0.x:80:1355`.
Browser uses `web.main.localhost`, which resolves to 127.0.0.1 not 127.0.0.x.
To make this actually work, every project hostname needs a distinct DNS entry pointing at its loopback IP - `/etc/hosts` lines, since `*.localhost` is locked to 127.0.0.1.

Cost: high. Defeats the point of `.localhost` zero-config DNS.
Fragility: moderate. `/etc/hosts` churn on every `lace up`/`down`.
Root: sysctl once; `/etc/hosts` edits need sudo or setuid helper.
Multi-project: yes, but at the cost of DNS discipline.
HTTPS: no improvement.

### E. User-service Caddy / nginx in front of the per-project container ports

Mechanism: `systemd --user` Caddy unit listens on 80/443 (sysctl for 80 or `setcap cap_net_bind_service+ep $(which caddy)`).
A small Caddyfile maps `*.{project}.localhost` to `127.0.0.1:<host-port-for-project>` and is regenerated by `lace up`.

Cost: moderate. Lace owns the Caddyfile templating and reload (`caddy reload`).
Fragility: low. Caddy is a mature daemon.
Root: one-time `setcap`, or sysctl.
Multi-project: yes - one Caddy fronts arbitrarily many projects.
HTTPS: yes, free, via Caddy's local CA (`tls internal`) and `caddy trust`.

### F. The existing host-proxy daemon proposal (Node.js, ~300 LOC)

Mechanism: custom Node daemon binding 80, reading `~/.config/lace/proxy-state.json`, forwarding by `{project}` segment.
Cost: highest - new code path, new failure surface, no HTTPS story without bolt-on.
Fragility: highest - bespoke daemon, our problem to maintain.
Root: sysctl once.
Multi-project: yes.
HTTPS: no, unless we add it.

## Comparison

| Option | Setup cost | Multi-project | HTTPS-ready | New code lace owns | Root posture |
|---|---|---|---|---|---|
| A. sysctl + symmetric 80:1355 | trivial | no | no | port-map config | one sysctl |
| B. host portless + `alias` | moderate | yes | yes (CA) | alias lifecycle | sysctl or `trust` |
| C. socat/nft | trivial | no | no | none | sysctl or root |
| D. per-project loopback IPs | high | yes | no | IP + hosts management | sysctl + hosts edits |
| E. user Caddy/nginx | moderate | yes | yes (CA) | template + reload | setcap or sysctl |
| F. host-proxy daemon (existing) | high | yes | no | full daemon | sysctl |

## Recommendation

Choose by user requirements, not by what is already specced.

If the working assumption is "one project up at a time" (single-developer common case): take **Option A**.
It is a port-allocator tweak and a documented sysctl. No daemon, no extra moving parts, no HTTPS story but also no HTTPS need at the prototype stage.
Land it behind a `lace setup` step that writes the sysctl drop-in idempotently.

If multiple projects must be simultaneously reachable on `:80`: take **Option B** over the existing host-proxy proposal.
Reasons:

- Portless already implements Host-header routing and a state directory; the alias is the entire integration surface.
- Portless also gives HTTPS via `portless trust` for free, which the Node daemon proposal does not.
- The lace code becomes "shell out to `portless alias` on up/down" instead of "maintain a reverse-proxy daemon."
- The portless feature stays unmodified inside the container; the host portless is an additional, optional install.

> NOTE(opus/clean-urls): Option B reframes the integration: portless on the host is the cross-project router; portless in the container is the per-project service multiplexer.
> Two instances of one tool, no second tool to maintain.

Option E (Caddy) is a reasonable fallback if reliance on portless as a host-level daemon proves fragile across OS updates - Caddy is a more conservative dependency.

The existing host-proxy daemon proposal (Option F) is the strict worst-of-both: as much setup as B or E, none of the HTTPS path, and a bespoke codebase to maintain.
It should not be the first choice unless Options B and E are both ruled out by some constraint not yet on the table.

## Open Questions

- Does lace's port allocator currently support a fixed-host-side port (Option A) without an allocator carve-out?
  If not, that mechanism work is the long pole.
- For Option B, what is the cleanest hook in `lace up`/`lace down` to invoke `portless alias` add/remove?
  The container's lifecycle is the source of truth; portless aliases should be slaved to it.
- Is `portless trust` acceptable as a setup step, or does the "no per-browser config" constraint extend to "no system CA install"?
  This is the binary that decides whether the recommendation ships HTTP-only (Option A) or HTTPS-capable (Option B / E).
