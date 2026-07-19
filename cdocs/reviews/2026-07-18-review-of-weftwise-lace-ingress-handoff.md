---
review_of: "weftwise:cdocs/reports/2026-07-18-lace-portless-ingress-architecture.md"
first_authored:
  by: "@claude-fable-5"
  at: 2026-07-18T17:21:18-07:00
task_list: portless/ingress-durability
type: review
state: live
status: done
tags: [fresh_agent, cross_repo, architecture, portless, networking, runtime_validated, dependency_pinning]
---

# Review: Weftwise's Lace-Facing Ingress Asks (from Lace's Perspective)

> NOTE(fable/portless/ingress-durability): The subject documents live in the weftwise repo, on the `mirror-rearch` worktree:
> the report [`cdocs/reports/2026-07-18-lace-portless-ingress-architecture.md`](https://github.com/weftwiseink/weftwise/blob/mirror-rearch/cdocs/reports/2026-07-18-lace-portless-ingress-architecture.md) (its Section 8 is the handoff brief addressed to this repo)
> and the proposal [`cdocs/proposals/2026-07-18-qa-up-single-command-sync-testing.md`](https://github.com/weftwiseink/weftwise/blob/mirror-rearch/cdocs/proposals/2026-07-18-qa-up-single-command-sync-testing.md) (its "Proposed Solution part 3" declares the dependency on lace).
> This review evaluates those asks against lace's own design record and adds new measured evidence.

> BLUF: The weftwise report's measurements are sound and its responsibility assignment is correct: the break is real, it is at the lace-owned layer, and weftwise should not work around it.
> But the handoff brief misidentifies the *kind* of defect, and that changes the right fix.
> New evidence produced during this review: the container portless feature installs `portless@latest` (`devcontainer-feature.json` option default), portless is a third-party Vercel Labs package, and version 0.15.4, published 2026-07-16, is the **first and only** version that binds the proxy to loopback only.
> Every version from 0.13.0 through 0.15.3 binds all interfaces (bare `server.listen(port)`), which is why the May 2026 multi-project validation worked from the host with no relay and why host access broke this week: a container rebuild ingested a two-day-old upstream behavior change.
> The gap is therefore an unpinned-dependency regression, not a missing bridge in lace's committed model.
> Verdict: **Revise** the handoff's fix menu.
> Pin the feature's portless version (one committed line) instead of adding a socat bridge, add a reachability canary so the next silent upstream change is caught by a check instead of a white screen, and treat the upstream bind-flag request as follow-up, not a blocker.
> On the weftwise maintainer's stated preference for a single fully-working origin over ":1355 plus patches": the pin restores *both* origins to fully working, which dissolves the stated dichotomy; retiring the `:1355` host tier is a separate roadmap decision that would revert the deliberate round-8 "single shared URL space" choice, and is presented as an explicit option below rather than smuggled into the fix.

## 1. Scope and Method

This review evaluates the lace-facing asks in the two weftwise documents from lace's perspective:

1. Is the handoff brief's diagnosis correct as a statement about lace's committed model?
2. Is its proposed fix menu (committed socat bridge, upstream bind flag, pasta loopback forwarding) the right menu for lace?
3. Is a broader round of lace portless changes worthwhile to simplify weftwise's usage, including the maintainer's floated option of consolidating on the per-project published port and dropping the `:1355` host tier?

Method: the full portless design record in this repo was re-read (the 2026-02-25/26 architecture and rationale corpus, the 2026-05-13/14 parallel-dev proposal, decisions report, validation devlogs, and the three open portless RFPs), the current code surfaces were mapped (`host-portless.ts`, `up.ts`, `port-allocator.ts`, `template-resolver.ts`, the portless devcontainer feature), and the load-bearing upstream claim was tested empirically by downloading portless 0.13.0, 0.13.1, 0.14.0, 0.15.0 through 0.15.4 from npm and inspecting the proxy bind call in each.

## 2. New Evidence: the Regression Is a Version Event, Not a Design Hole

The weftwise report leaves one thread open (its Sections 7.3 and 8): why did the [2026-05-14 multi-project validation](../devlogs/2026-05-14-weftwise-parallel-dev-multi-project-validation.md) serve host `200`s with no relay, when today the same topology returns `502` without one?
This review closes that thread with a version bisect.

| portless version | proxy bind call | bind scope |
| --- | --- | --- |
| 0.13.0, 0.13.1, 0.14.0, 0.15.0, 0.15.1, 0.15.2, 0.15.3 | `server.listen(proxyPort, cb)` (no host argument) | all interfaces (Node default) |
| 0.15.4 | `server.listen({port, host: target.host, ...})` via `getProxyBindTargets(lanMode)` | `127.0.0.1` + `::1` unless LAN mode |

Supporting facts, each independently checked:

- The container feature installs an unpinned version: `devcontainers/features/src/portless/devcontainer-feature.json` declares `version` with `"default": "latest"`, and `install.sh` runs `npm install -g "portless@${VERSION}"`.
- portless is third-party: npm metadata lists `repository: github.com/vercel-labs/portless`, maintainers `ctate` and `vercel-release-bot`. Lace's own design record already commits to "use upstream portless, no fork required" ([integration design rationale](../reports/2026-02-26-portless-integration-design-rationale.md), Decision 2).
- Release timing: 0.15.3 published 2026-07-14, 0.15.4 published 2026-07-16 (npm `time` field). The weftwise white-screen incident, the hand-started relay, and the interim host tunnel all date to 2026-07-17, and the weftwise report observes 0.15.4 running in the container.
- The May validation ran portless 0.13.0 host-side (`~/.config/lace/portless-runtime.json` capture in the validation devlog) and its `ss` output shows pasta holding `*:22427`/`*:22428` with genuine host-side curls returning distinct app bodies. The validation was real; no undocumented bridge existed; the container proxy simply bound wide in that era.
- No version of portless offers wide-bind while keeping `.localhost`: in 0.15.4, `buildProxyStartConfig` forces the TLD list to `["local"]` whenever `lanMode` is set, and `lanMode` is the only path to the wide bind targets. The `--host` flag that appears in the CLI is unrelated: it is injected into child framework commands (vite et al.), not a proxy bind option.

Two consequences follow.

**The timeline is fully explained.**
Rebuilds before 2026-07-16 got a wide-binding portless, so pasta's interface-address delivery landed on a listening socket and everything worked.
The first rebuild after 0.15.4's release got a loopback-only proxy, pasta's delivery landed on a dead interface address, and every host route broke at once.
The hand relay is a runtime patch for exactly that delta.

**The defect class changes.**
The weftwise brief frames the gap as "lace's committed model never bridged interface to loopback."
The record shows lace's committed model was *complete and validated* under the dependency behavior it was built against, and what is missing is version control of that dependency: the feature ingests `latest` from a third-party repo that is two days ahead of lace's own tested surface, while `packages/lace/package.json` pins the host-side portless at `^0.13.0`.
The same host currently runs 0.13.0 on the host tier and 0.15.4 in the container tier of the same protocol.
That split, not the bridge, is the durable thing to fix.

## 3. Findings on the Handoff Brief (Report Section 8)

### F1 (blocking): the preferred fix is a version pin, not a socat bridge

The brief's option 1 (a supervised socat interface-to-loopback forwarder in the feature entrypoint) is the option this review rejects.
It commits lace to running a second network process forever to compensate for an upstream behavior change lace never chose to ingest, it reproduces in committed form the exact shape of the hand relay the report itself calls drift, and it would silently mask the next upstream change instead of surfacing it.
Lace's own prior art already rejected socat forwarding at the host tier for adjacent reasons ([clean-portless-urls fresh-eyes](../reports/2026-05-13-clean-portless-urls-fresh-eyes.md), option C).

The minimal committed fix is to change the feature's `version` default from `"latest"` to a tested exact version (0.15.3 is the newest wide-binding release; 0.13.0 is the last version lace validated end-to-end).
One line in `devcontainer-feature.json`, no new processes, restores the exact topology the May validation proved, and turns future upstream changes into a deliberate bump instead of a rebuild-time surprise.
An exact pin (not a range) is deliberate: the host tier's `^0.13.0` range is what allowed this class of surprise on the container tier, and 0.15.4 demonstrates that upstream ships behavior changes in patch releases.

### F2 (blocking): the brief's "upstream portless" option mischaracterizes the cost, and the bind change is probably deliberate

The brief's option 2 (add a bind flag to portless that decouples bind address from LAN/mDNS mode) is a sound end state but is a feature request against `vercel-labs/portless`, a Vercel Labs repository outside this org's control, with an external timeline.
The brief reads as if "upstream portless" were an adjacent internal layer; the review's ownership check shows it is not, and lace's design record explicitly forecloses forking.

Additionally, 0.15.4's loopback bind is best read as deliberate upstream security hardening (a dev proxy that binds all interfaces is LAN-exposed by default), not a bug.
The request to upstream should therefore be framed as "an opt-in flag for containerized use behind a published port" (e.g. `--bind <addr>` or `PORTLESS_BIND`), filed as an issue with the pasta/devcontainer use case, and treated as the eventual unpin path rather than a blocker.
Until it lands, the pin holds.

### F3 (non-blocking): the pasta option stays unverified and third

The brief's option 3 (configure pasta to deliver published ports to container loopback via `containers.conf` `pasta_options`) remains unverified on this podman version and would couple lace to host-level podman configuration, which the design record deliberately avoids (lace prints host changes, the user applies them).
Keep it as a fallback investigation only if the pin proves insufficient.

### F4 (non-blocking): report accuracy notes for the weftwise side

These do not change the report's conclusions but should be corrected when it is next revised:

- The report cites `getProxyBindTargets` (a 0.15.4 symbol) as if it described "portless" generally; the symbol does not exist in 0.13.x through 0.15.3, and the report nowhere states that the host tier and container tier are currently running different major behaviors of the same tool (0.13.0 vs 0.15.4). The version split is load-bearing and belongs in the report body, not just the open thread.
- The open thread ("determine whether behavior changed between 0.13.0 and 0.15.4, or whether May had an undocumented bridge") is now resolved: behavior changed, in 0.15.4 exactly, published 2026-07-16. The May validation needs no asterisk.
- The weftwise devlog narrative that fed the report ("`:1355` is owned by another project's proxy (lace)") mischaracterizes the design: the `:1355` singleton spawned from lace's checkout *is* the committed cross-project host tier (decisions D7/D8/D9: lace owns the lifecycle, bundles portless via pnpm, and serves every project's aliases from one process). The failure weftwise experienced was the container tier's bind regression, not foreign ownership of the host tier. One genuine open item survives: confirm the current `weftwise`/`whelm` aliases were registered by `lace up` rather than by hand, and if by hand, re-run `lace up` so the committed path owns them.

### F5 (blocking): acceptance criteria should include a regression canary

The brief's acceptance criteria (fresh rebuild with no relay serves host `200`; relay and host tunnel deleted; a second project reachable on the same basis) are correct and are adopted.
Add one: a committed reachability check (natural home: `lace doctor`, which already probes host-portless liveness) that requests each registered route from the host and reports per-hop failure, so the next upstream behavior change presents as a named diagnostic instead of an unexplained white screen.
The weftwise report's "the failure is a connection reset or a white screen with no pointer to which link died" is the strongest DX complaint in the record, and it is cheap to retire.

### F6 (non-blocking): LAN exposure should be scoped deliberately when the wide bind returns

Restoring a wide-binding container proxy re-opens the May-era posture: pasta publishes the proxy port on all host interfaces (`*:22427` in both the May and July socket captures), so the dev proxy is LAN-reachable unless the host firewall intervenes.
The May-era record noted this only in passing.
When implementing the pin, also scope the publish to loopback by emitting `127.0.0.1:<port>:<port>` in the generated `appPort` (template-resolver currently emits symmetric `<port>:<port>` with no host address), verifying that pasta honors the host-address form.
This makes the pinned configuration strictly safer than the May baseline while keeping every host-side path (host portless dials `127.0.0.1:<port>`; a host browser can hit `localhost:<port>` directly) intact.

## 4. The Consolidation Question: Is the `:1355` Host Tier Worth Keeping?

The weftwise maintainer's stated preference: if the choice is "a partially-working `:1355` plus something else" versus "one fully-working origin like `:22427`", prefer the latter, even at some UX cost.

The review's finding is that this dichotomy is an artifact of the regression, and the pin dissolves it.
With the container proxy bound wide again, both origins are fully working end-to-end, served by the same chain, with no relay:

- `http://<branch>.weftwise.localhost:1355/` (host tier, host-only)
- `http://<branch>.weftwise.localhost:22427/` (published container proxy, valid from the host *and* inside the container)

The genuine asymmetry that remains is that the `:22427` form is the only origin valid in both contexts, which weftwise's request-derived `wsUrl` fix handles per-request without either side having to care.

Against the design record, retiring the host tier would be a real reversal, not a cleanup:

- Round 8 of the [parallel-dev proposal](../proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md) explicitly reversed a round-7 per-project-port design because it "broke the single shared URL space utility of portless"; consolidation on `:22427` reinstates exactly that rejected shape (per-project port suffixes in bookmarks, one port to remember per project).
- The tier is the foundation of the recorded roadmap: graduation to `:80` ([truly-portless RFP](../proposals/2026-05-13-rfp-truly-portless-portless.md)) and HTTPS via trust ([https RFP](../proposals/2026-05-13-rfp-portless-https-via-trust.md), decision D12 marks it high-priority) both operate on the host tier. Retiring it abandons the no-port-suffix end state.
- Its marginal cost, once the container tier is pinned, is low: the host tier never broke this week (it runs the pinned `^0.13.0` from lace's own `node_modules`), and its known debts (stale aliases, no boot persistence) are small, already-RFP'd items.

What *is* worth doing for weftwise's simplification goal, without a reversal:

- Make the published-port origin first-class and discoverable: lace already persists the allocation in `.lace/port-assignments.json`; expose it (e.g. `lace route <project>` or a documented read of the assignments file) so weftwise's `worktree.sh` prints real reachable origins instead of hardcoding `:1355`, which the weftwise record shows was wrong-by-default on fresh setups.
- Document the two-origin contract in the portless feature README: `:1355` is the human convenience origin on the host; `:<allocated>` is the canonical programmatic origin valid everywhere; tools should derive, not assume.

If the maintainer, with the pin in hand, still prefers to retire the host tier, that is a coherent roadmap decision (it trades the `:80`/HTTPS end state for one less moving part), but it should be made as an explicit supersession of round-8 D2/D6/D12, not as part of an ingress fix.

## 5. Verdict

**Revise.**
The report's evidence and its lace-owns-this conclusion are accepted; the May validation is vindicated rather than contradicted.
The handoff brief's fix menu must change before implementation: the socat bridge (its option 1, "lowest-risk") is rejected in favor of a version pin the brief does not list, the upstream flag (option 2) is re-scoped as a follow-up filed against Vercel Labs, and the pasta option (option 3) is parked.
A companion proposal in this repo, [`2026-07-18-portless-feature-version-pin-and-ingress-durability.md`](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md), carries the accepted shape.

## 6. Action Items

1. [blocking] Pin the portless feature `version` default to a tested exact version (recommend 0.15.3 after a smoke test; fall back to 0.13.0, the last fully validated version) and stop tracking `latest`. (Owner: lace)
2. [blocking] After a rebuilt, relay-free container serves host `200`, delete the hand relay, the `~/.cache/weft-portless-bridge.mjs` host tunnel, and re-register aliases via `lace up` if any were added manually. (Owner: lace, with weftwise confirming)
3. [blocking] Add a per-route host-reachability check to `lace doctor` naming the failing hop. (Owner: lace)
4. [non-blocking] Scope the generated `appPort` publish to `127.0.0.1:<port>:<port>`, verifying pasta honors the host-address form. (Owner: lace)
5. [non-blocking] File the upstream issue against vercel-labs/portless requesting an opt-in bind-address flag decoupled from LAN/mDNS mode; revisit the pin when it lands. (Owner: lace)
6. [non-blocking] Expose the per-project allocated origin programmatically and update the feature README's two-origin contract; weftwise then derives origins instead of hardcoding `:1355`. (Owner: lace, weftwise consumes)
7. [non-blocking] Weftwise report corrections per F4 (version split in the body, resolved open thread, corrected `:1355` ownership narrative). (Owner: weftwise)

## 7. Open Questions for the Maintainer

Surfaced per review convention as choices; the companion proposal assumes the recommended option for each and marks the divergence points.

**Q1: Pin target.**
- (a) **0.15.3 (recommended):** newest wide-binding release, smallest delta from current `latest`, needs one smoke test since lace never validated 0.15.x.
- (b) 0.13.0: matches both the May validation and the host tier's installed version exactly; oldest, forgoes two months of upstream fixes.

**Q2: Fate of the `:1355` host tier.**
- (a) **Keep, with the discoverability improvements of Section 4 (recommended):** preserves the round-8 URL space and the `:80`/HTTPS roadmap; weftwise stops depending on it blindly.
- (b) Retire for a single per-project origin: simpler mental model, but explicitly supersedes round-8 D2/D6/D12 and abandons the no-port-suffix end state; if chosen, this needs its own proposal.

**Q3: LAN exposure of the published proxy port.**
- (a) **Loopback-scope the publish (recommended):** strictly safer than the May baseline; verify pasta support.
- (b) Keep the wide publish and rely on the host firewall: zero work, preserves any future LAN-testing use, leaves dev servers LAN-visible.
