---
first_authored:
  by: "@claude-fable-5"
  at: 2026-07-18T17:55:39-07:00
task_list: portless/ingress-durability
type: report
state: live
status: review_ready
tags: [portless, upstream, networking, investigation, lan-mode]
---

# Upstream Portless Evolution and LAN Mode Assessment

> BLUF: Upstream's loopback-only bind in portless 0.15.4 is deliberate, proactive default-hardening with no disclosed vulnerability behind it: [PR #361](https://github.com/vercel-labs/portless/pull/361) ("Bind proxy to loopback by default", merged 2026-07-16) links no issue and no advisory, and the changelog states the whole rationale in one sentence: routes "cannot be reached through LAN, VPN, or other network interfaces."
> LAN/`.local` mode cannot replace lace's ingress: it is a hard non-starter for the container tier (mDNS publishing shells out to `avahi-publish-address`, which does not exist in the container, and rootless podman/pasta cannot do multicast at all), and for the host tier it fails the maintainer's no-host-config condition because a live spike on this Fedora host shows multi-label names (`branch.project.local`) publish fine but are refused by the glibc resolver (`getent` NOTFOUND) due to nss-mdns's two-label limit, fixable only by root-level nsswitch surgery.
> The project itself is healthy and fast-moving (10.2k stars, near-daily commits, 9 releases Apr-Jul 2026) but its direction is single-developer-workstation-first; containers are a known gap upstream is only starting to think about ([#314](https://github.com/vercel-labs/portless/issues/314)).
> Recommended posture: keep the accepted pin ([pin proposal](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md)) and file the upstream bind-flag request now; treat LAN mode as not-viable-today with a named re-evaluation trigger (upstream decoupling TLD from LAN mode, [#346](https://github.com/vercel-labs/portless/issues/346)).

## Context

Lace runs portless twice: a host-side singleton on `:1355` (`--no-tls --wildcard`, portless 0.13.0 via `^0.13.0` in `packages/lace/package.json`) and a per-container proxy on a lace-allocated port in 22425-22499 (`--no-tls`, installed by the portless devcontainer feature, which defaulted to `latest`).
Portless 0.15.4 (published 2026-07-16) switched the proxy from an all-interfaces bind to loopback-only, which broke host-to-container ingress on rootless podman/pasta hosts because pasta delivers published ports to the container's interface address, not loopback.
The accepted [pin proposal](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md) fixes the outage by pinning the feature to 0.15.3; its adjudication record is the [cross-repo ingress review](../reviews/2026-07-18-review-of-weftwise-lace-ingress-handoff.md) and the [round-1](../reviews/2026-07-18-review-of-portless-feature-version-pin-and-ingress-durability.md) / [round-2](../reviews/2026-07-18-review-of-portless-feature-version-pin-and-ingress-durability-r2.md) reviews.

This report answers the step-back questions that the pin deliberately deferred: why upstream went loopback-only, what else changed between 0.13.0 and 0.15.4, whether LAN/`.local` mode could replace the `.localhost` two-tier setup, and what posture lace should take toward upstream.
The maintainer's stated condition for a `.local` move: no sudo, no annoying host system configuration.

Evidence base: extracted npm tarballs for every version 0.13.0 through 0.15.4 (dist-level code inspection), the upstream [CHANGELOG](https://github.com/vercel-labs/portless/blob/main/CHANGELOG.md), [releases](https://github.com/vercel-labs/portless/releases), issue/PR pages fetched individually, and a live mDNS resolution spike on this Fedora host.
Every issue and PR number cited below was fetched and read; none is inferred.

## Key Findings

1. The 0.15.4 loopback bind is proactive hardening, not a response to a disclosed vulnerability: no CVE, no GHSA (the repo's advisories page is empty), no linked issue on [PR #361](https://github.com/vercel-labs/portless/pull/361).
2. LAN mode is the only wide-bind path in 0.15.4, and the wide bind is gated on mDNS actually working: if `isMdnsSupported()` fails, LAN mode is disabled and the proxy binds loopback anyway. There is no way to get `0.0.0.0` without a working mDNS publisher.
3. mDNS publishing is delegated to external commands: `dns-sd -P` on macOS, `avahi-publish-address -R <fqdn> <ip>` on Linux (requires avahi-utils and a running avahi daemon), unsupported on Windows. Portless bundles no mDNS responder of its own (the package has zero runtime dependencies).
4. Live spike on this Fedora host: single-label `.local` names resolve out of the box (no sudo, no config), but multi-label names like `branch.project.local` publish successfully yet fail glibc resolution, because `mdns4_minimal` rejects any name with more than two labels and ignores `/etc/mdns.allow` entirely. Lace's `branch.project` hostname shape is therefore incompatible with stock Linux `.local` resolution.
5. In-container LAN mode is doubly impossible: the container image has no avahi (so `isMdnsSupported()` fails and the wide bind never engages, per finding 2), and rootless containers cannot use IP multicast at all (the kernel blocks `IP_ADD_MEMBERSHIP` inside user namespaces; pasta has separate multicast-forwarding breakage, [podman #24871](https://github.com/containers/podman/issues/24871)).
6. Upstream is active and responsive-adjacent (near-daily commits, 9 minor releases in 4 months, three regular contributors) but the roadmap is workstation-first: sharing integrations (Tailscale, ngrok), diagnostics (`portless doctor`), and trust-store work dominate; container ingress has no owner. Users are already pushing back on LAN mode's TLD coupling ([#346](https://github.com/vercel-labs/portless/issues/346), with in-progress PRs [#348](https://github.com/vercel-labs/portless/pull/348) and [#365](https://github.com/vercel-labs/portless/pull/365)).
7. Staying pinned has a real cost ledger: 0.15.x fixes lace would forgo on the 0.13.0 host tier include the IPv6-only upstream dial fix ([#320](https://github.com/vercel-labs/portless/issues/320), 502s for Vite on Node 17+ defaults) and worktree hostname collision handling.

## 1. Why Loopback-Only in 0.15.4

The change lands in [PR #361, "Bind proxy to loopback by default"](https://github.com/vercel-labs/portless/pull/361), authored by ctate, merged 2026-07-16, released the same day in v0.15.4 via [PR #362](https://github.com/vercel-labs/portless/pull/362).
The PR description is three bullets, quoted in full:

> - Limit proxy and redirect listeners to loopback outside LAN mode
> - Preserve explicit LAN exposure and document listener behavior
> - Add socket-level regression coverage

The [CHANGELOG entry for 0.15.4](https://github.com/vercel-labs/portless/blob/main/CHANGELOG.md) is the fullest statement of rationale that exists:

> Outside LAN mode, the proxy and HTTP redirect listeners now bind only to `127.0.0.1` and `::1`, so Portless routes cannot be reached through LAN, VPN, or other network interfaces.

That is the entire primary-source record.
Specifically not found: any linked issue, any CVE or GHSA (the repository's security advisories page states "There aren't any published security advisories"), any blog post or disclosure, any reviewer discussion of motivation on the PR.
The change is classified in the changelog as a bug fix, ships with regression tests, and preserves LAN mode as the explicit opt-in exposure path.

Interpretation (inference, flagged as such): this is the standard dev-tool hardening move against the drive-by class of attacks on development servers (a hostile page or LAN peer reaching a dev proxy that was never meant to be network-visible), applied proactively.
A proxy that fronts every dev server on a machine and previously bound all interfaces is exactly the kind of aggregation point that class of attack rewards.
Upstream did not cite a specific incident, and this report found none.

Consequence for lace: because the motivation is a considered security default rather than an accident, upstream is unlikely to revert it.
The realistic unpin path is the one the pin proposal already names: an opt-in bind flag (or bind address option) decoupled from LAN mode.
The PR's own "preserve explicit LAN exposure" bullet shows upstream accepts explicit opt-in exposure in principle, which is the right framing for the feature request.

## 2. Release-by-Release Delta 0.13.0 to 0.15.4

All bind-behavior claims verified directly against the extracted npm tarballs: 0.13.0 through 0.15.3 call bare `server.listen(port)` (all interfaces); 0.15.4 introduces `getProxyBindTargets(lanMode)` returning `127.0.0.1`/`::1` unless LAN mode is active, in which case `0.0.0.0`/`::`.
Changelog summaries below are from the upstream [CHANGELOG](https://github.com/vercel-labs/portless/blob/main/CHANGELOG.md) and [releases page](https://github.com/vercel-labs/portless/releases).

| Version | Date | Change | Lace relevance |
| --- | --- | --- | --- |
| 0.13.0 | 2026-05-08 | OS startup service (launchd, systemd, Task Scheduler) for the proxy. | The version both lace tiers validated against. |
| 0.13.1 | 2026-05-27 | Requires Node >= 24 (`engines` in tarball confirms). `portless service install` persists proxy options (`--port`, `--no-tls`, `--lan`, `--ip`, `--tld`). | Any unpin beyond 0.13.0 requires Node 24+ in the container image. |
| 0.14.0 | 2026-06-04 | `--ngrok` public sharing while keeping local `.localhost` URLs. | Not used. |
| 0.15.0 | 2026-06-24 | `portless doctor`: read-only diagnostics (Node, state dir, proxy liveness, routes, hostname resolution, CA trust, LAN prerequisites). HTTP/2 `:authority` forwarded as `Host` to HTTP/1.1 backends. | `doctor` overlaps with the pin proposal's `lace doctor` canary; worth composing with rather than duplicating if lace ever unpins. |
| 0.15.1 | 2026-06-30 | `--tld` repeatable; `PORTLESS_TLD` accepts comma-separated values; one proxy serves the same names across multiple TLDs. | Would let the host tier serve `.localhost` plus an alternate TLD simultaneously. |
| 0.15.2 | 2026-07-14 | Proxy dials upstreams over both loopback families (fixes 502s when a dev server binds `::1` only, [#320](https://github.com/vercel-labs/portless/issues/320)). Tailscale funnel/serve hostname routing. Monorepo worktree hostname collision prevention. | The IPv6 dial fix and worktree collision fix are the concrete costs of staying on 0.13.0 for the host tier. |
| 0.15.3 | 2026-07-14 | Under sudo, state resolves from the original user's home so elevated proxy and unprivileged apps share routes (the `PORTLESS_INTERNAL_SERVICE_ELEVATED` mechanism; legacy system state dir was `/tmp/portless`). WSL CA trust in both Linux and Windows stores. | The pin target: newest wide-binding release. The elevated-service and state-dir churn in this line is why the pin proposal insists on smoke-testing 0.15.3 before trusting it. |
| 0.15.4 | 2026-07-16 | Loopback-only bind outside LAN mode ([PR #361](https://github.com/vercel-labs/portless/pull/361)). | The outage. |

Two structural observations from the tarballs: the package has zero runtime dependencies at every version (everything is bundled or shelled out), and the CLI grew a substantial environment surface by 0.15.4 (`PORTLESS_TLD`, `PORTLESS_HTTPS`, `PORTLESS_WILDCARD`, `PORTLESS_LAN`, `PORTLESS_STATE_DIR`, `PORTLESS_PORT`).
The env surface matters for lace: a future bind control is at least as likely to arrive as an env var as a flag, and the feature's `install.sh`/spawn path can pass either.

## 3. LAN/.local Mode Deep-Dive

### Mechanism

Portless does not implement an mDNS responder.
`src/mdns.ts` (read from the 0.15.4 dist) selects a platform publisher and spawns it per hostname:

- macOS: `dns-sd -P <name> _http._tcp local <port> <fqdn> <ip>`.
- Linux: `avahi-publish-address -R <fqdn> <ip>`, with the missing-command message "Install avahi-utils: sudo apt install avahi-utils".
- Windows and everything else: `getMdnsPublisher()` returns null, and LAN mode errors with "LAN mode requires mDNS publishing, which is not supported on this platform."

The LAN IP comes from `src/lan-ip.ts`: a UDP socket "connected" to `1.1.1.1:53` to discover the default-route interface, filtered against internal/virtual interfaces, re-polled every 5 seconds to follow Wi-Fi changes.
Two implications: LAN mode needs a real routable LAN IP (an offline laptop has none, so routes degrade), and the publisher child processes run unprivileged (no sudo for publishing itself; only `portless service install` requires elevation, which lace does not use).

### The bind is gated on mDNS, not just on the flag

From the 0.15.4 proxy startup code (dist, verbatim structure):

```js
let activeLanIp = lanIp && mdnsSupport.supported ? lanIp : null;
const lanModeActive = activeLanIp !== null;
const bindTargets = getProxyBindTargets(lanModeActive);
```

If the mDNS publisher is missing or the LAN IP cannot be determined, LAN mode silently degrades (proxy path) or exits 1 (`proxy start` path) and the bind is loopback.
This kills the idea of using `--lan` merely as a wide-bind switch inside a container: the wide bind is unreachable without working avahi.
LAN mode also force-switches the TLD list to `.local` only (`effectiveTlds = options.lanMode ? ["local"] : requestedTlds`, quoted in [#346](https://github.com/vercel-labs/portless/issues/346)), so `.localhost` routes stop being served the moment LAN mode engages.

### Linux resolution reality: live spike on this Fedora host

This host is representative of the lace deployment target (Fedora, avahi-daemon active, `hosts: files myhostname mdns4_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] dns` in `/etc/nsswitch.conf`, `avahi-publish-address` present, no `/etc/mdns.allow`).
Spike, run 2026-07-18:

```
$ avahi-publish-address -R portless-spike.local 127.0.0.2 &
$ getent hosts portless-spike.local
127.0.0.2       portless-spike.local          # resolves: exit 0

$ avahi-publish-address -R branch.project-spike.local 127.0.0.3 &
$ getent hosts branch.project-spike.local
exit=2                                        # NOTFOUND
$ avahi-resolve -n branch.project-spike.local
branch.project-spike.local  127.0.0.3         # avahi itself is fine
```

The mechanism is documented in the [nss-mdns README](https://github.com/avahi/nss-mdns): by default a request "with more than two labels ... is rejected. Example: `foo.bar.local` is rejected", and critically, "the 'minimal' version of `nss-mdns` does not read `/etc/mdns.allow` under any circumstances."
Fedora ships the minimal variant.
Making `branch.project.local` resolve would require editing `/etc/nsswitch.conf` to swap `mdns4_minimal` for `mdns4` and creating `/etc/mdns.allow`: root-owned system config on every consuming host, exactly the "annoying host config" the maintainer excluded.
Browsers sit on top of this same path (Chromium and Firefox both hand `.local` to the OS resolver; Firefox additionally excludes `.local` from DoH), so there is no browser-side escape hatch.

Secondary host findings from the same probe: mDNS resolution and publishing needed no sudo and no firewall change for same-host use, but `firewall-cmd --list-services` does not include `mdns` in the active zone here, so other LAN devices would not resolve this host's published names without a firewall edit (another config touch if cross-device access is the goal, which for lace it is not).

TLS compounds the multi-label problem: the 0.15.4-generated server certificate SANs are exactly `DNS:localhost, DNS:*.localhost, DNS:*.local` (read from the dist), and a `*.local` wildcard matches one label only, so `branch.project.local` would fail certificate validation even where it resolved.
Lace's tiers run `--no-tls` today, so this is a latent rather than active blocker.

### Container tier verdict

LAN mode inside the rootless podman/pasta container fails on three independent grounds:

1. No publisher: the container image has no avahi-utils and no avahi daemon; `isMdnsSupported()` fails, so per the gating above the proxy binds loopback anyway. The bind problem this investigation started from would remain unsolved.
2. No multicast: rootless containers cannot join multicast groups (`IP_ADD_MEMBERSHIP` is blocked in user namespaces even with `CAP_NET_ADMIN`), and pasta has known multicast-forwarding breakage besides ([podman #24871](https://github.com/containers/podman/issues/24871), closed without a forwarding fix; the only workaround was downgrading pasta).
3. No meaningful LAN IP: the 1.1.1.1 probe inside the container yields a pasta-assigned address that is not what host or LAN peers should dial.

This is a hard blocker, not a configuration gap.
No amount of host-side setup makes in-container LAN mode work.

### Host tier verdict

Could the host singleton move from `.localhost:1355` to `.local`?
Only under all of the following, so: no, not as currently shaped.

- Hostname flattening: `branch.project` would have to become a single label (`branch-project.local`) to survive `mdns4_minimal`. That is a lace-side URL scheme change rippling into every consumer that embeds origins.
- TLD exclusivity: LAN mode drops `.localhost` entirely, so this is a migration, not an addition, until upstream lands TLD decoupling ([#346](https://github.com/vercel-labs/portless/issues/346), PRs [#348](https://github.com/vercel-labs/portless/pull/348)/[#365](https://github.com/vercel-labs/portless/pull/365) in progress).
- Exposure inversion: LAN mode's whole point is `0.0.0.0` plus LAN advertisement of every dev route, the opposite of the loopback-scoped posture the pin proposal just adopted for the container publish, and of upstream's own 0.15.4 reasoning.
- Availability: routes come and go with the default route (offline laptop, VPN interface churn), where `.localhost` is unconditional.

What LAN mode is actually for is phone-on-the-same-Wi-Fi testing.
It satisfies "no sudo" on a stock Fedora workstation (avahi is already running; publishing is unprivileged) and satisfies "no host config" only for single-label names on the same host.
As a replacement for either lace tier it fails the fitness test regardless of the maintainer's conditions.

## 4. Upstream Engagement Landscape

Activity: 10.2k stars, 329 forks, roughly 60 open issues and 53 open PRs, near-daily commits through mid-July 2026, and 9 minor releases between late April (0.11.x) and July (0.15.4).
Contributors visible in the July window: ctate (primary; authored both #361 and the release PR), Railly, gerardbalaoro, plus outside PRs being shepherded (#348 from a community contributor).
The project has a docs site (portless.sh) and in-repo MDX docs.
This is a healthy, fast-moving experiment, not an abandoned one.

Bind-flag prior art: no existing issue requests an opt-in bind address or decoupling bind from mDNS (searched "bind", "loopback", "0.15.4", "LAN"; the closest matches are unrelated: [#330](https://github.com/vercel-labs/portless/issues/330) on sudo for low ports, [#288](https://github.com/vercel-labs/portless/issues/288) on free-port probing, [#334](https://github.com/vercel-labs/portless/issues/334) on sinkholed domains).
The request the pin proposal contemplates would be the first of its kind, which is favorable: no prior rejection to argue against, and PR #361's "preserve explicit LAN exposure" bullet plus the existing `PORTLESS_*` env-var pattern give it a natural shape (`PORTLESS_BIND` or `--bind <addr>`, explicitly opt-in, documented as unsafe-unless-you-know).

Container interest exists but is unshipped: [#314](https://github.com/vercel-labs/portless/issues/314) (open) asks for `portless run-docker` with docker/podman, [#110](https://github.com/vercel-labs/portless/issues/110) asks for Docker Compose support, and older closed issues ([#61](https://github.com/vercel-labs/portless/issues/61), [#30](https://github.com/vercel-labs/portless/issues/30)) show static container routes were an early theme.
A bind-flag request framed as "container runtimes deliver published ports on non-loopback interfaces" plugs into that existing thread rather than opening a new front.

Abandonment risk: real but moderate.
vercel-labs is Vercel's experimental namespace; projects there can be archived or absorbed without notice, and portless has no published stability commitment.
Mitigants: traction (stars, outside contributors, coverage in community round-ups), Apache-2.0 license, zero runtime dependencies (a vendored fork would be self-contained), and lace's exposure being narrow (spawn CLI, read routes file, one bind behavior).
No graduation or productization signal was found either way.
The pre-1.0 version number is an accurate self-description: 0.15.4 demonstrated that minor releases change load-bearing network behavior without a deprecation path.

## 5. Step-Back Assessment

Upstream's direction is coherent and worth stating plainly: portless is becoming a polished single-workstation dev proxy with strong secure defaults (HTTPS by default, trust-store automation, loopback-only bind) and explicit, blessed exposure paths (LAN mode, Tailscale, ngrok).
Every one of those defaults is right for the median user and wrong for lace's container tier, where the proxy's whole job is to accept traffic arriving on a non-loopback interface from a trusted host.
Lace is not fighting upstream's security model; it needs one opt-in escape hatch that model already conceptually allows.

### Postures

These are reference postures with trade-offs, not a decision.

**Posture A: pin-and-track deliberately (status quo, per the accepted pin proposal).**
Keep the feature at 0.15.3, keep the host tier at 0.13.0, review upstream releases on a cadence (the changelog is well-kept; scanning it is cheap).
Satisfies both maintainer conditions trivially (no sudo, no host config).
Costs: forgoes 0.15.x fixes (IPv6 upstream dial, worktree collision handling, `doctor`), and the pin decays as upstream moves; a Node-24 floor already gates any future unpin.
Risk: low, known, bounded by the `lace doctor` canary.

**Posture B: upstream-engage for an opt-in bind control (recommended companion to A, not an alternative).**
File the feature request now: an explicit `--bind <addr>` / `PORTLESS_BIND` decoupled from LAN mode and mDNS, framed against the container-runtime use case and #314's existing container thread.
Satisfies both conditions once landed (a flag in the feature's spawn args is not host config).
Costs: maintainer attention; no control over timeline; possible rejection (though #361's own framing makes a narrow opt-in plausible).
This is the only posture that ever unpins cleanly.

**Posture C: adopt LAN/`.local` mode.**
Not viable today; recorded here mainly so the blockers are named.
Container tier: hard-blocked three ways (no avahi in image, multicast impossible in rootless user namespaces, meaningless LAN IP); no host-side effort changes this.
Host tier: fails "no annoying host config" for lace's multi-label names (nsswitch surgery plus `/etc/mdns.allow` on every consuming host), forces abandoning `.localhost` while TLD coupling stands, inverts the loopback-scoped exposure posture, and ties route availability to the default route.
Re-evaluation trigger, if ever: upstream ships TLD decoupling (#346/#348/#365) and lace independently decides it wants phone-on-LAN testing; even then it would be an additive third tier, not a replacement.

**Posture D: reduce dependence (vendor or replace the container-side proxy).**
The container-side role is small (SNI/Host-based routing from one published port to N local dev ports), and portless's zero-dependency Apache-2.0 code makes a vendored fork mechanically easy.
Contradicts the standing upstream-no-fork decision ([integration design rationale](2026-02-26-portless-integration-design-rationale.md), Decision 2) and adds a permanent maintenance surface for what is, today, a one-flag disagreement.
Justified only if Posture B is rejected or ignored and a future upstream release breaks the pin's assumptions again (for example, removing the wide bind from old versions' install path or a forced state-dir migration).

### Recommendation

A plus B: hold the pin, file the bind-flag request while the 0.15.4 context is fresh and citable, and put upstream-release review on a cadence with the Node-24 floor and 0.15.2's fixes as the standing unpin incentive.
Record C's blockers as settled findings so `.local` does not get re-litigated from scratch, with #346's resolution as the only trigger worth watching.

## Cross-References

- [Pin proposal: portless feature version pin and ingress durability](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md)
- [Cross-repo ingress handoff review](../reviews/2026-07-18-review-of-weftwise-lace-ingress-handoff.md)
- [Pin proposal review, round 1](../reviews/2026-07-18-review-of-portless-feature-version-pin-and-ingress-durability.md) and [round 2](../reviews/2026-07-18-review-of-portless-feature-version-pin-and-ingress-durability-r2.md)
- [Portless integration design rationale](2026-02-26-portless-integration-design-rationale.md) (upstream-no-fork decision)
- [Local domain DNS configuration research](2026-02-25-local-domain-dns-configuration-research.md) (prior `.local`/DNS groundwork)
