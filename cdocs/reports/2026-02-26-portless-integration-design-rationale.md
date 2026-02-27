---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-26T10:30:00-06:00
task_list: lace/portless
type: report
state: live
status: wip
tags: [analysis, portless, devcontainer-feature, design-rationale, worktrees]
related_to:
  - cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md
  - cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md
  - cdocs/devlogs/2026-02-26-portless-integration-exploration.md
  - cdocs/proposals/2026-02-26-portless-devcontainer-feature.md
---

# Portless Integration Design Rationale

> **BLUF:** The portless-lace integration should be a thin prebuild devcontainer feature that installs upstream portless and declares the proxy port for lace's asymmetric port mapping. Portless runs on its default port 1355 inside the container; lace allocates the host port and maps asymmetrically (e.g., `22435:1355`), following the wezterm-server pattern. This requires zero lace core changes and no build-time port baking. The feature approach (vs. docs-only) is necessary because lace's port auto-injection only works through features. Host-side domain routing is explicitly decoupled as future work.

## Decision 1: Feature vs. Docs-Only

**Decision: Feature.**

The user's initial intuition ("maybe all this requires is an example in the docs") is almost right — the integration surface is tiny. But lace's port auto-injection is feature-gated: `customizations.lace.ports` must appear in a feature's `devcontainer-feature.json`, not in the project's `devcontainer.json`. Without a feature, the user must:

1. Manually choose a port from lace's 22425-22499 range
2. Manually add `appPort`, `forwardPorts`, and `portsAttributes` entries
3. Manually set `PORTLESS_PORT` in `containerEnv`
4. Manually install portless in the container

With a feature, all of this is automatic. The feature declares the port, lace handles allocation and Docker mapping, and the feature's install script handles portless installation and env var configuration.

The feature is thin (~50 lines install.sh, ~30 lines entrypoint.sh) and follows the exact pattern established by wezterm-server. The maintenance burden is proportional to portless's stability — if portless's install mechanism changes, the feature needs updating.

**Alternative considered: project-level port declarations.** Adding `customizations.lace.ports` support at the project level would make the docs-only approach viable. However, this requires lace core changes (modifying the auto-injection pipeline in `template-resolver.ts`), is a general feature not specific to portless, and should be evaluated separately on its own merits.

## Decision 2: Upstream Portless Directly — No Fork Needed

**Decision: Use upstream portless. No fork required.**

The initial assumption was that controlling the app port allocation range (4000-4999) would require the fork's `PORTLESS_MIN_APP_PORT` / `PORTLESS_MAX_APP_PORT` env var overrides. However, since all app traffic routes through the portless proxy and app ports never leave the container, there's no need to control the range — the defaults are fine.

The only configuration portless needs from lace is the proxy port, and upstream already supports this via the `PORTLESS_PORT` env var. No fork, no additional dependencies, no divergence risk.

The fork remains available if future requirements (e.g., direct app port forwarding for non-HTTP protocols) necessitate range control, but that's a separate concern outside the scope of the proxy-based routing feature.

## Decision 3: Port Architecture — Asymmetric Mapping + Container-Internal Apps

**Decision: Lace allocates a host port and maps asymmetrically to portless's default 1355. App ports stay container-internal.**

The portless proxy always runs on port 1355 (its built-in default) inside the container. Lace allocates a host port from 22425-22499 and generates an asymmetric Docker mapping (e.g., `22435:1355`). This follows the wezterm-server pattern, where sshd listens on 2222 inside the container and lace maps asymmetrically (e.g., `22430:2222`).

| Port type | Example | Docker mapping | DNS access |
|-----------|---------|---------------|------------|
| Portless proxy | 1355 (container) | 22435:1355 (asymmetric, lace-managed) | `*.localhost:22435` |
| App ports | 4000-4999 | None (container-internal) | Via portless proxy only |

This eliminates build-time port baking entirely — the container doesn't need to know its host port. Port reassignment only changes the Docker mapping, not the container image. The feature uses lace's existing `prebuildFeatures` path, which produces asymmetric `appPort` entries via `injectForPrebuildBlock()`.

**Alternative considered: symmetric mapping (build-time baking).** The initial proposal used symmetric mapping (`22435:22435`) with `PORTLESS_PORT` baked into `/etc/profile.d/` and `/etc/environment`. This was rejected because it couples port allocation to the container image — port reassignment requires a full rebuild. The asymmetric approach decouples them completely.

See `cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md` for the detailed investigation into lace's port allocation design.

## Decision 4: No Env Var Propagation Needed (Asymmetric Mapping)

**Decision: No `PORTLESS_PORT` env var. Portless uses its built-in default (1355).**

With asymmetric port mapping (Decision 3), the container always uses port 1355. There is no need to propagate a lace-allocated port into the container environment. The entrypoint simply starts `portless proxy` with no arguments — portless defaults to 1355.

**Previously considered (superseded):** The earlier symmetric design required baking the lace-allocated port into `/etc/profile.d/` and `/etc/environment` so portless would listen on the correct port. This was necessary because the container needed to know its own host-mapped port. The asymmetric design eliminates this entirely.

## Decision 5: Scope Boundary — Decoupling Host-Side Routing

**Decision: The proposal covers only the container-side feature. Host-side routing is future work.**

The architecture report (2026-02-25) described a two-tier proxy design:
1. Container-side portless for service/worktree routing (this proposal)
2. Host-side lace proxy on port 80 for cross-project multiplexing (future)

These are architecturally independent:
- The container-side feature is useful standalone (URLs like `web.main.localhost:22435`)
- The host-side proxy adds polish (URLs like `web.main.weft-app.localhost` on port 80)
- The host proxy depends on the container feature existing, but not vice versa

Decoupling keeps the proposal small (zero lace core changes), enables iterating on the container-side experience first, and lets the host proxy be evaluated independently — it may not even use portless (the architecture report notes it needs Host-header rewriting that portless doesn't support).

## Decision 6: Naming Convention — Dot Hierarchy, Convention Over Enforcement

**Decision: Document `{service}.{worktree}` as the recommended naming convention. No enforcement.**

Portless natively supports dots in service names — `web.main` registers as `web.main.localhost` with exact Host header matching. The dot-separated hierarchy reads naturally as DNS subdomains and enables a default service shorthand: single-service worktrees can omit the prefix (just `main.localhost`).

**Alternative considered: dash-separated flat names.** The earlier convention `{service}-{worktree}` (e.g., `web-main`) works but loses the hierarchical signal and has no natural default shorthand.

This is purely conventional — portless doesn't enforce it, and neither does the feature. The `lace dev` wrapper (future scope) would enforce it by auto-deriving the worktree name from the filesystem.

## Decision 7: Feature Options Schema

**Decision: Two options — proxyPort and version.**

| Option | Default | Purpose |
|--------|---------|---------|
| `proxyPort` | `"1355"` | Container-internal portless proxy port. With lace (prebuildFeatures), the default is used as the container side of an asymmetric mapping. Not read by install.sh. |
| `version` | `"latest"` | Portless npm version specifier. Pin to a known-good version for stability. |

`proxyPort` participates in lace's port pipeline (declared in `customizations.lace.ports`). In the prebuild features path, `injectForPrebuildBlock()` uses the option's `default` value ("1355") as the container-internal port and allocates a separate host port. install.sh does not read `PROXYPORT` — the port is always 1355 inside the container.

`version` flows to install.sh for `npm install -g portless@${VERSION}`.

## Open Questions

### 1. VS Code Port Forwarding Noise — Resolved

Portless allocates app ports dynamically (4000-4999). VS Code auto-detects listening ports and offers to forward them. **Resolution:** Document a `portsAttributes` block for 4000-4999 with `"onAutoForward": "silent"` in the user's `devcontainer.json`. Features cannot inject top-level `portsAttributes`, so this is user-side configuration shown in the proposal's example.

### 2. Portless Stability

Portless was created 2026-02-15 (11 days ago). It's Vercel Labs, has 2.5k stars, and is actively developed, but the API surface could change. The feature should pin a known-good version.

### 3. TLS Inside the Container

Portless supports `--https` with auto-generated certs. Inside a container, this is mostly unnecessary (`.localhost` is a browser secure context), but some APIs require HTTPS even in development. This is a future concern, not a blocker.
