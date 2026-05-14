---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T21:00:00-07:00
task_list: weftwise/parallel-feature-development/clean-urls
type: proposal
state: live
status: request_for_proposal
tags: [portless, clean-urls, parallel-development, lace-core, multi-project, future_work]
---

# RFP: Truly Portless Portless (Clean URLs via Host-Side Portless)

> BLUF(opus/truly-portless-portless): The v1 proposal at `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md` ships parallel-worktree dev with URLs that include the lace-allocated host port (e.g., `http://main.weftwise.localhost:22435/`).
> This RFP requests a proposal for the clean-URL completion: drop the port suffix so URLs are `http://main.weftwise.localhost/`, multi-project safe (`http://main.whelm.localhost/` works concurrently).
> The design space is already substantially surveyed in `cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md` (Option B: host portless + `portless alias`) and `cdocs/reports/2026-05-13-weftwise-parallel-dev-decisions.md` (D6, D8, D9, D10, D12, all relevant here).
> The proposal author should pick up from those documents rather than re-survey the field.

## Problem statement

v1 URLs include a host-port suffix because each project's container portless is mapped asymmetrically to a different host port in 22425-22499.
This is multi-project safe but ugly: browser bookmarks carry the port, copy-paste between developers requires explaining the port, and the URL pattern diverges from production-shaped hosts.

The goal is to land the clean URL pattern: `http://{branch}.{project}.localhost/` reachable on the standard HTTP port, with multiple projects routed by the `{project}` segment.

## Goals

The eventual proposal must address:

- **Clean URLs.** `http://{branch}.{project}.localhost/` reaches the right worktree's dev server, no port suffix.
- **Multi-project concurrency.** Two projects up simultaneously do not collide.
- **Lace-owned lifecycle for any host-side daemon.** If a host portless instance is involved, lace spawns, tracks, and tears it down without depending on systemd unit files the user must manage manually.
- **Auto-reversible host state.** Any durable host change (sysctl drop-in, `/etc/hosts` entry, etc.) is reversible by a documented lace command or a short manual recipe.
- **User-applied sysadmin changes.** Lace prints the system commands needed (sysctl, setcap, etc.) to stdout; the user evaluates and applies. Lace does NOT auto-`sudo`.
- **Generic host-port-availability check, reused from v1.** The probe that checks whether the chosen host port can bind is already in v1 (via `isPortAvailable`); the RFP extends usage to port 80 (or whichever the proposal chooses) without re-coupling lace to sysctl-specific logic.

## Non-goals

- Forking portless. Use upstream.
- A bespoke host-proxy Node daemon (the older proposal at `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md` is superseded by this RFP).
- HTTPS in initial scope (tracked separately at `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md`).
- A new `doctor` subcommand; if preflight checks are needed, extend `validate` as in v1.

## Constraints and invariants

- Rootless podman; the user may run `sudo` once for system changes but lace does not invoke sudo.
- Single-developer, single-machine context (no shared host).
- Must coexist cleanly with v1 (`portlessAlias: true` metadata already in place; the RFP adds the consumer).
- Must work outside VS Code.
- Browser-agnostic; no PAC files, no per-browser extension config.

## Recommended starting point

The fresh-eyes report's Option B is the working assumption: install portless on the host (recommended as a bundled lace dependency, per D9), run it with `--wildcard` so suffix matching is active (per D11/upstream `findRoute` semantics), and have lace shell out to `portless alias <project> <host-port>` after `lace up`.

The proposal author should treat the following as already-decided unless they find a reason to revisit:

- **D6:** HTTP-only in initial scope; HTTPS is its own RFP.
- **D8:** Lace owns host portless lifecycle. No user-managed systemd unit.
- **D9:** Lace bundles portless via its `package.json`. No global `npm install -g`.
- **D10:** Sysctl drop-in is auto-reversible by file deletion. Lace prints the commands; the user applies.
- **D11:** `portlessAlias` is a generic feature-port metadata field with boolean semantics in v1; consider whether to extend to a string override.
- **D12:** Prioritize the HTTPS RFP as the immediate follow-up after this one lands.

## Open questions for the proposal author

- **Sysctl prompt UX.** v1 prints commands to stdout; the user runs them. Should this RFP keep that posture exactly, or add a `lace validate --apply` mode that runs sudo with explicit consent? Per the v1 author's direction, lace stays out of sysadmin; default to "print only."
- **Wildcard alias matching.** Confirm `--wildcard` / `PORTLESS_WILDCARD=1` semantics empirically (the v1 proposal's earlier rounds did this via source-reading; re-verify against the version of portless lace bundles).
- **Lifecycle observability.** v1 has none; this RFP needs at least "is host portless alive" surface (probably via `lace validate`).
- **Stale aliases.** Already an RFP at `cdocs/proposals/2026-05-13-rfp-lace-stale-portless-alias-cleanup.md`. This RFP should declare whether stale cleanup is in scope or remains separate.
- **Port 80 vs 443.** v1 explicitly defers HTTPS; should the host portless bind 80, 443, or both? The default-to-80 path is simplest in initial scope; HTTPS RFP can extend.
- **Generic port-availability primitive.** v1 reuses `isPortAvailable` in the validate sub-check. This RFP extends the same primitive to port 80 with environment-specific remediation hints (sysctl is one; setcap is another; rootful podman is another). Keep the probe generic and the remediation hints data-driven.

## Success criteria for the eventual proposal

The proposal is review-ready when it:

- Specifies the lace code paths to change (host-portless lifecycle module, alias shellout, validate extension to consume the same `portlessAlias` metadata).
- Specifies the user-facing remediation messaging for sysctl / port-80 binding, printed to stdout (no auto-sudo).
- Provides a concrete validation plan that demonstrates clean URLs for N>=2 projects simultaneously, using the empirical-validation shape from v1's Phase 4 / the legacy-builder experiment.
- Names the security implications of binding port 80 on `*.localhost` (local-impostor risk, cookie/origin leakage per D12) and pairs the RFP with the HTTPS RFP scheduling.
- Surfaces deviations and complications front and center.

## References

- v1 proposal: `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md`.
- Design-space survey: `cdocs/reports/2026-05-13-worktree-portless-parallel-dev-prior-work.md`.
- Fresh-eyes clean-URL report: `cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md`.
- Design decisions (D6, D8, D9, D10, D11, D12 are this RFP's): `cdocs/reports/2026-05-13-weftwise-parallel-dev-decisions.md`.
- HTTPS RFP: `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md`.
- Stale-alias cleanup RFP: `cdocs/proposals/2026-05-13-rfp-lace-stale-portless-alias-cleanup.md`.
- Superseded host-proxy Node daemon proposal: `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md` (this RFP completes the supersession).
