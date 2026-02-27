---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-26T10:00:00-06:00
task_list: lace/portless
type: devlog
state: live
status: wip
tags: [portless, devcontainer-feature, worktrees, networking, exploration]
related_to:
  - cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md
  - cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md
  - cdocs/reports/2026-02-25-portless-alternatives-survey.md
  - cdocs/reports/2026-02-25-local-domain-dns-configuration-research.md
  - cdocs/reports/2026-02-26-portless-integration-design-rationale.md
  - cdocs/proposals/2026-02-26-portless-devcontainer-feature.md
---

# Portless Integration Exploration: Devlog

## Objective

Explore integration options for portless with lace's single-container multi-worktree
devcontainer model. Produce a focused proposal for a portless devcontainer feature,
with host-side domain routing explicitly decoupled as future work.

## Exploration Notes

### 1. Reviewed Prior Research (4 reports from 2026-02-25)

The previous session produced four comprehensive reports:
- **Portless analysis**: proxy mechanism, route state, PID liveness model
- **Architecture report**: two-tier proxy design, `*.localhost` domain pattern
- **Alternatives survey**: 15 tools, gap analysis — no tool at the intersection
- **DNS research**: `.test` vs `.localhost`, sysctl for port 80

Key constraint clarified mid-session: lace uses a **single container per project**
with multiple worktrees inside. This eliminates the PID namespace mismatch problem —
portless runs alongside dev servers in the same container.

### 2. Fork Analysis → Determined Unnecessary

Reviewed `micimize/portless` PR #1 which adds `PORTLESS_MIN_APP_PORT` and
`PORTLESS_MAX_APP_PORT` env var overrides. Initially assumed these would be needed
to control the app port range, but realized app ports are entirely container-internal —
all traffic routes through the proxy, so app ports never need Docker mapping or
external control. **Conclusion: upstream portless is sufficient. No fork needed.**

The fork remains available if direct app port forwarding is ever needed (e.g., for
non-HTTP protocols), but that's out of scope for proxy-based routing.

### 3. Portless Proxy Port Configuration

Investigated how portless configures its proxy port:
- **CLI flag**: `portless proxy --port <number>` (default 1355)
- **Env var**: `PORTLESS_PORT=<number>` overrides the default
- **Auto-start**: when running `portless <name> <command>`, auto-starts proxy
  silently on non-privileged ports (>= 1024). Polls for readiness before proceeding.
- **Bypass**: `PORTLESS=0` or `PORTLESS=skip` runs commands directly

Since app ports are container-internal and don't need external control, only
`PORTLESS_PORT` matters for the feature. Upstream portless handles everything needed.

### 4. Lace Feature Model Analysis

Studied the wezterm-server feature as the reference model:
- `devcontainer-feature.json` declares options, `customizations.lace.ports`, and mounts
- `install.sh` receives option values as env vars (uppercased option names)
- Feature entrypoint bakes install-time values into runtime scripts
- `customizations.lace.ports` enables lace auto-injection of `${lace.port()}` templates

**Critical finding**: lace's port auto-injection only works through features. There is no
project-level port declaration mechanism. A user cannot write `customizations.lace.ports`
in their devcontainer.json — it must be in a feature's devcontainer-feature.json.

This means: **a feature is needed for lace port allocation**, not just docs. Without a
feature, the user must manually pick a port and add `appPort`/`forwardPorts` entries.

### 5. Symmetric Port Mapping Implications

Lace uses symmetric ports: same number on host and container (e.g., `22435:22435`).
Portless proxy would run on the lace-allocated port (e.g., 22435) inside the container,
not on its default 1355.

This works because portless reads `PORTLESS_PORT` env var. The feature would set this
via `/etc/profile.d/` at install time (baking the lace-allocated port into the container
environment), following the wezterm-server pattern of baking `$_REMOTE_USER`.

App ports (4000-4999) are container-internal only — no Docker port mapping needed.
The portless proxy is the single entry point from the host.

### 6. Feature vs. Docs-Only Decision

| Approach | Port allocation | User effort | Maintainability |
|----------|----------------|-------------|-----------------|
| Docs only | Manual | High (pick port, add appPort/forwardPorts) | None |
| Feature | Automatic (lace range) | Low (add feature, done) | Feature updates |

The feature approach wins on ergonomics and consistency with lace's existing patterns.
The feature is thin: install portless + declare port + set env vars. ~50 lines of install.sh.

### 7. Scope Boundary Decision

**In scope for this proposal:**
- Portless devcontainer feature (install, port declaration, env vars)
- Documentation (usage patterns, naming conventions, examples)
- Fork maintenance plan

**Explicitly out of scope (future work):**
- Host-side lace proxy daemon on port 80 (cross-project routing)
- `lace dev` worktree-aware wrapper command
- `lace setup` for port 80 sysctl
- Any lace core code changes

The user's insight is correct: the baseline integration is thin. The feature is a
packaging/convenience layer over portless + lace's existing port allocation. Host-side
routing is a separate, larger piece of work.

### 8. App Port Range — No External Control Needed

With the single-container model, portless's default 4000-4999 range is entirely
container-internal. All HTTP/WS/HTTP2 traffic routes through the proxy, so app
ports never need Docker mapping. This eliminates the need for the fork's
`PORTLESS_MIN_APP_PORT` / `PORTLESS_MAX_APP_PORT` overrides.

Non-HTTP protocols (gRPC, database, debug) that need direct port access are a
separate concern — users can manually add `appPort` entries for those specific
ports. This is not in scope for the proxy-based routing feature.

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/devlogs/2026-02-26-portless-integration-exploration.md` | This devlog |
| `cdocs/reports/2026-02-26-portless-integration-design-rationale.md` | Design rationale |
| `cdocs/proposals/2026-02-26-portless-devcontainer-feature.md` | Proposal |
