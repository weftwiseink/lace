---
first_authored:
  by: "@claude-fable-5"
  at: 2026-07-19T08:30:11-07:00
task_list: portless/tailnet-ingress
type: proposal
state: live
status: request_for_proposal
tags: [portless, tailscale, networking, future_work, dev-infra]
---

# RFP: Automagical Tailnet Integration for Dev Ingress

> BLUF(fable/portless/tailnet-ingress): Make worktree dev servers reachable across the tailnet with zero per-session wiring, e.g. a golink prefix like `go/dev/weftwise/<branch>`, layered on portless's Host-header demux via tailscale split DNS.
> **Motivated By:** [cdocs/reports/2026-07-18-upstream-portless-evolution-and-lan-mode-assessment.md](../reports/2026-07-18-upstream-portless-evolution-and-lan-mode-assessment.md), [cdocs/proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md](2026-07-18-portless-feature-version-pin-and-ingress-durability.md)

## Objective

Dev ingress today is single-device: worktree routes resolve only on the machine running the host portless tier (`*.weftwise.localhost:1355`).
Weftwise is already tailnet-native (dogfood deploys via tailscale), but there is no path for a second device or second person on the intranet to reach a branch's dev server without manual tunneling.
The goal is automatic tailnet-wide reachability for every registered worktree route, ideally addressable through a memorable golink prefix (`go/dev/weftwise/<branch>`), wired up as a side effect of normal dev workflow rather than per-branch ceremony.

## Scope

The full proposal should explore, grounded in the upstream assessment report rather than re-deriving:

- **Split DNS as the routing substrate.** Upstream portless 0.15.4's tailscale integration shells out to `tailscale serve`/`funnel`, mounting at the node's ts.net name on ports 443/8443/10000: node-scoped, no wildcard vhosts, so `branch.project` Host-header demux cannot ride MagicDNS directly. The workable shape identified: tailscale split DNS pointing a custom domain (e.g. `*.dev.internal`) at a nameserver on the tailnet that resolves to the dev machine, with the host portless accepting that TLD via `PORTLESS_TLD` (multi-TLD support exists in 0.15.x). One-time tailnet admin config, no per-host sudo.
- **Golink as the human-facing layer.** Golink is a redirector only: targets must already be tailnet-reachable, so it sits on top of the split-DNS substrate, not in place of it.
- **Transport.** Plain HTTP is acceptable initially since the tailnet is WireGuard-encrypted; evaluate whether that holds long-term.
- **Auto-wiring.** How `lace up` (or the worktree route registration path) publishes routes to the tailnet tier without manual steps.
- **Relationship to existing tiers.** The container tier and the `:1355` host tier remain; the proposal should position the tailnet tier relative to them.

Explicitly out of scope: the severable ingress-durability outage fix in [2026-07-18-portless-feature-version-pin-and-ingress-durability.md](2026-07-18-portless-feature-version-pin-and-ingress-durability.md).
This RFP must not couple to it.

## Open Questions

1. Is there concrete second-device or second-person demand today, or is this speculative future work?
2. Golink deployment and ownership: where does the golink service run, and how is it wired?
3. Nameserver choice and lifecycle for split DNS: CoreDNS on the dev machine, something on the tailnet, or another option?
4. HTTPS and cert story on the custom domain: portless trust CA installed per device, versus staying on plain HTTP over WireGuard.
5. Interplay with the container tier and the `:1355` host tier: does the tailnet tier complement them, or eventually absorb the cross-device role?
6. Will upstream portless's tailscale direction (serve/funnel, node-scoped) grow toward vhost routing, making a lighter integration possible?
7. Auto-wiring surface: what does `lace up` registering routes with the tailnet tier automagically actually look like?
