---
first_authored:
  by: "@claude-fable-5"
  at: 2026-07-18T17:21:18-07:00
task_list: portless/ingress-durability
type: devlog
state: live
status: done
tags: [portless, networking, dependency_pinning, cross_repo, runtime_validated]
---

# Devlog: Reviewing Weftwise's Ingress Asks; Root-Causing the Loopback Regression

> BLUF: Weftwise handed lace a brief asking for a committed interface-to-loopback bridge in the portless feature.
> Investigation for the review found the true defect first: the feature installs `portless@latest`, and upstream portless 0.15.4 (published 2026-07-16, two days ago) is the first version that binds the proxy to loopback only.
> Versions 0.13.0 through 0.15.3 bind all interfaces, which is why the May multi-project validation worked from the host with no relay.
> Deliverables: a cross-repo [review](../reviews/2026-07-18-review-of-weftwise-lace-ingress-handoff.md) (verdict: Revise the brief's fix menu) and a [proposal](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md) to pin the version, add a reachability canary, and retire the runtime patches.

## Objective

Review, from lace's perspective, the lace-facing asks in weftwise's
`cdocs/reports/2026-07-18-lace-portless-ingress-architecture.md` (Section 8 handoff brief) and
`cdocs/proposals/2026-07-18-qa-up-single-command-sync-testing.md` (Proposed Solution part 3), both on the weftwise `mirror-rearch` worktree.
If a round of lace-side improvements is worthwhile, propose it in this repo.
Maintainer steer: prefer simplification; a single fully-working origin beats a partially-working `:1355` plus patches.

## Method

Four parallel research passes over: the Feb 2026 portless origin corpus, the May 2026 parallel-dev arc plus open RFPs, the current lace code surfaces, and the weftwise July devlog record.
Then direct empirical verification of the load-bearing upstream claims (below).

## Key Findings

1. **The bind regression is a version event.** The portless devcontainer feature defaults `version: "latest"` (`devcontainers/features/src/portless/devcontainer-feature.json`) and `install.sh` runs `npm install -g "portless@${VERSION}"`. Upstream 0.15.4 introduced loopback-only binding; everything from 0.13.0 to 0.15.3 binds all interfaces.
2. **The timeline closes.** 0.15.4 published 2026-07-16; the weftwise white-screen, hand relay, and host tunnel all date to 2026-07-17; the weftwise report observes 0.15.4 in the container. The May validation ran 0.13.0 and needed no bridge because none was needed then.
3. **portless is third-party** (vercel-labs/portless, maintainers ctate + vercel-release-bot). Lace pins the host tier at `^0.13.0` (still resolves 0.13.0) while the container tier floats `latest`: the same host currently runs two behavior-divergent versions of the same protocol.
4. **No portless version offers wide-bind with `.localhost`.** In 0.15.4 the only wide-bind path is LAN mode, which force-switches the TLD to `.local` (`buildProxyStartConfig`: `effectiveTlds = options.lanMode ? ["local"] : ...`). The CLI's `--host` flag is injected into child framework commands (vite et al.), not a proxy bind option; verified in both 0.13.0 and 0.15.4.
5. **Design-record tension.** The maintainer's floated ":22427-only" consolidation reverses the deliberate round-8 "single shared URL space" decision and the `:80`/HTTPS roadmap (parallel-dev proposal, decisions D2/D6/D12, truly-portless and https RFPs). The review presents it as an explicit roadmap choice, not part of the fix, and recommends keeping the tier plus making the allocated origin discoverable so weftwise stops hardcoding `:1355`.

## Verification Evidence

Version bisect (npm tarballs, `dist/cli.js` inspected per version):

```
0.13.0: server.listen(proxyPort, () => {          # cli.js:3442, no host arg: all interfaces
0.13.1: server.listen(proxyPort, () => {          # wide-bind
0.14.0: server.listen(proxyPort, () => {          # wide-bind
0.15.0: server.listen(proxyPort, () => {          # wide-bind
0.15.1: wide-bind (bare listen)
0.15.2: wide-bind (bare listen)
0.15.3: wide-bind (bare listen)
0.15.4: getProxyBindTargets present               # loopback unless lanMode
```

0.15.4's mechanism (`dist/cli.js:1559-1563`):

```
function getProxyBindTargets(lanMode) {
  return lanMode ? [{ host: "0.0.0.0" }, { host: "::", ipv6Only: true }]
                 : [{ host: "127.0.0.1" }, { host: "::1", ipv6Only: true }];
}
server.listen({ port, host: target.host, ipv6Only: target.ipv6Only }, listener);
```

Release dates (npm `time`): `0.13.0: 2026-05-08`, `0.15.3: 2026-07-14`, `0.15.4: 2026-07-16`.
Ownership (npm): `repository.url = git+https://github.com/vercel-labs/portless.git`, maintainers `ctate`, `vercel-release-bot`.
Feature install surface: `devcontainer-feature.json` `version` default `"latest"`; `install.sh:4` `VERSION="${VERSION:-latest}"`, `install.sh:19` `npm install -g "portless@${VERSION}"`.
Lace host-tier pin: `packages/lace/package.json:20` `"portless": "^0.13.0"`, installed `node_modules/.pnpm/portless@0.13.0`.

## Deviations and Open Items

- The review could not confirm whether the current host aliases (`weftwise`, `whelm`) were registered by `lace up` or by hand; carried as an implementation-time check in the proposal.
- 0.15.3 has never been validated by lace end-to-end; the proposal's phase 1 requires a smoke test before committing the pin value.
- The proposal's loopback-scoped publish (`127.0.0.1:<port>:<port>` in generated `appPort`) assumes pasta honors a host address in the publish spec; flagged verify-at-implementation.

## Files Changed

- `cdocs/reviews/2026-07-18-review-of-weftwise-lace-ingress-handoff.md` (new): cross-repo review, verdict Revise.
- `cdocs/proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md` (new): the pin + canary + discoverability proposal.
- Weftwise side (mirror-rearch worktree): `last_reviewed` frontmatter update on the ingress report.
