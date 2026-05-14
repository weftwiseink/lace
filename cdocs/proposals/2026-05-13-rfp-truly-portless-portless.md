---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T21:00:00-07:00
task_list: weftwise/parallel-feature-development/port-80
type: proposal
state: live
status: request_for_proposal
tags: [portless, clean-urls, parallel-development, lace-core, multi-project, future_work, port-80]
---

# RFP: Truly Portless Portless (Port-80 Binding)

> BLUF(opus/truly-portless-portless): The parent proposal at `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md` ships parallel-worktree dev with a single shared host portless on `:1355` that routes per-project to each container portless.
> This RFP requests a proposal for the final port-suffix drop: graduate the host portless from `:1355` to `:80` so URLs are `http://{branch}.{project}.localhost/` with no port suffix at all.
> Scope is exclusively the port-80 binding surface: sysctl drop-in, setcap, rootful-podman trade-offs, auto-reversibility, and user-applied remediation messaging.
> The host-portless lifecycle, pnpm-bundled portless dependency, and `portless alias` shellout are NOT this RFP's scope; they live in the parent proposal.

## Problem statement

The parent proposal binds the host portless to `:1355` because that port is unprivileged on every supported host and requires zero sysadmin coupling.
URLs carry the `:1355` suffix as a result: `http://main.weftwise.localhost:1355/` rather than the production-shaped `http://main.weftwise.localhost/`.

Dropping the suffix requires binding the host portless to `:80`, which on Linux means one of:

- Lowering `net.ipv4.ip_unprivileged_port_start` via a sysctl drop-in.
- Granting the portless binary `cap_net_bind_service` via `setcap`.
- Running portless under rootful podman (a non-starter for the rootless-podman baseline).
- Some other binding strategy this RFP's author may surface.

Each option has reversibility, fragility, and security trade-offs. This RFP exists to scope the comparison and pick one.

## Goals

The eventual proposal must address:

- **Port 80 binding.** The host portless listens on `:80` rather than `:1355`. URL pattern becomes `http://{branch}.{project}.localhost/`.
- **User-applied sysadmin changes.** Lace prints the system commands required (sysctl, setcap, etc.) to stdout; the user evaluates and applies. Lace does NOT auto-`sudo`.
- **Auto-reversibility.** Any durable host change is reversible by a documented lace command (typically `lace doctor --uninstall`) or a short manual recipe.
- **Generic host-port-availability check, reused from the parent proposal.** The `isPortAvailable` probe already exists; this RFP extends usage to `:80` with environment-specific remediation hints.
- **Migration story.** Existing deployments are on `:1355`. The RFP must specify how a user opts in (and out) of `:80` without breaking existing bookmarks atomically.

## Non-goals

- Forking portless. Use upstream.
- A bespoke host-proxy Node daemon (the older proposal at `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md` is superseded by the parent proposal's host-portless surface).
- HTTPS in initial scope (tracked separately at `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md`; pairs with this RFP per D12).
- Host-portless lifecycle, alias shellout, or `portless` packaging changes: all owned by the parent proposal.
- A new `doctor` subcommand; if preflight checks are needed, extend `validate` and `doctor` as in the parent proposal.

## Constraints and invariants

- Rootless podman; the user may run `sudo` once for system changes but lace does not invoke sudo.
- Single-developer, single-machine context (no shared host).
- The parent proposal's `portlessAlias: true` metadata, the bundled portless dependency, and the host-portless lifecycle module are already in place. This RFP changes only the bind port.
- Must work outside VS Code.
- Browser-agnostic; no PAC files, no per-browser extension config.

## Recommended starting point

The fresh-eyes report's Option B is the working assumption for the parent proposal, and remains so: the host portless is a real, lace-owned process. The only open variable is its bind port.

The proposal author should treat the following as already-decided unless they find a reason to revisit:

- **D6:** HTTP-only in initial scope; HTTPS is its own RFP.
- **D10:** Sysctl drop-in at `/etc/sysctl.d/99-lace-unprivileged-ports.conf` containing `net.ipv4.ip_unprivileged_port_start=80`, applied via `sudo cp` + `sudo sysctl --system`, reversed by `sudo rm` + `sudo sysctl --system`. The user applies; lace prints. `lace doctor --uninstall` handles reversal.
- **D12:** Prioritize the HTTPS RFP as the immediate follow-up after this one lands.

The author should specifically evaluate (and pick from):

- **Sysctl path (D10).** Lowest friction once applied; affects every binary on the host. Auto-reversible.
- **Setcap path.** Narrower (applies only to the portless binary); fragile across portless upgrades because the cap is lost on file replacement.
- **Rootful-podman path.** Out of scope per the rootless-podman baseline, but worth a one-paragraph dismissal so the rationale is on record.

## Open questions for the proposal author

- **Sysctl prompt UX.** The parent proposal prints commands to stdout; the user runs them. Should this RFP keep that posture exactly, or add a `lace validate --apply` mode that runs sudo with explicit consent? Per the parent author's direction, lace stays out of sysadmin; default to "print only."
- **Migration from `:1355` to `:80`.** Existing users have bookmarks on `:1355`. Options: (a) flag-gated opt-in to `:80` (`lace doctor --bind-80`?), (b) auto-detect sysctl readiness and prefer `:80`, (c) parallel listen on both ports during a migration window. Pick one with rationale.
- **Lifecycle observability.** The parent proposal's lifecycle module knows whether host portless is alive; this RFP must specify how it surfaces the bind port (`:80` vs `:1355`) and how a sysctl-not-applied state is reported. The parent proposal already records a `port` field in `~/.config/lace/portless-runtime.json` (3e bullet 3); that field is the natural extension point for surfacing the active bind port.
- **Stale aliases.** Already an RFP at `cdocs/proposals/2026-05-13-rfp-lace-stale-portless-alias-cleanup.md`. This RFP should declare whether stale cleanup is in scope or remains separate.
- **Port 80 vs 443.** This RFP explicitly defers HTTPS; the bind target is `:80` only. The HTTPS RFP extends.
- **Generic port-availability primitive.** The parent proposal reuses `isPortAvailable` for `:1355`. This RFP extends the same primitive to `:80` with environment-specific remediation hints (sysctl is one; setcap is another). Keep the probe generic and the remediation hints data-driven.

## Success criteria for the eventual proposal

The proposal is review-ready when it:

- Picks one of the binding strategies (sysctl, setcap, etc.) and justifies it against the others.
- Specifies the user-facing remediation messaging printed to stdout (no auto-sudo).
- Specifies the migration path from `:1355` to `:80` for existing users.
- Specifies the `lace doctor --uninstall` semantics for reversing any durable host change.
- Provides a concrete validation plan that demonstrates clean URLs for N>=2 projects simultaneously on `:80`, using the empirical-validation shape from the parent proposal's Phase 4.
- Names the security implications of binding port 80 on `*.localhost` (local-impostor risk, cookie/origin leakage per D12) and pairs the RFP with the HTTPS RFP scheduling.
- Surfaces deviations and complications front and center.

## References

- Parent proposal (host portless on `:1355`): `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md`.
- Design-space survey: `cdocs/reports/2026-05-13-worktree-portless-parallel-dev-prior-work.md`.
- Fresh-eyes clean-URL report: `cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md`.
- Design decisions (D6, D10, D12 are this RFP's): `cdocs/reports/2026-05-13-weftwise-parallel-dev-decisions.md`.
- HTTPS RFP: `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md`.
- Stale-alias cleanup RFP: `cdocs/proposals/2026-05-13-rfp-lace-stale-portless-alias-cleanup.md`.
- Superseded host-proxy Node daemon proposal: `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md` (the parent proposal completes the supersession).
