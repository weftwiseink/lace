---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T17:00:00-07:00
task_list: weftwise/parallel-feature-development/review
type: review
state: live
status: wip
tags: [rereview_agent, round-3, architecture, redesign, portless, host-setup, clean-urls, multi-project]
---

# Review of "Streamlined Parallel Feature Development for Weftwise" (Round 3)

> BLUF(opus/weftwise-parallel-dev/review): The post-acceptance redesign is a substantial improvement: it shrinks the lace surface area, eliminates the `mergePostCreateCommand`/`installDeps`/pnpm-store-mount machinery that drove most of rounds 1 and 2, and replaces it with a clean four-part composition that genuinely earns the three Objective outcomes.
> The `--wildcard` mechanism is cited with a specific file/line reference and `findRoute` is named explicitly; the new metadata flag, the post-`up` shellout, and the one new test file are a defensibly small Phase 3 footprint; the host setup (sysctl + npm install + systemd override + `service install`) is documented in implementable shell snippets.
> The redesign is internally coherent: I found no orphaned references to `installDeps`, `mergePostCreateCommand`, vite-probe phases, or the pnpm-store mount.
> Three non-blocking issues remain: (1) the `--wildcard` claim hinges on a source citation that this reviewer cannot verify against the portless tarball (no portless source is checked into the lace repo, and the fresh-eyes report describes `--wildcard` as "fallback for unregistered subdomains" rather than as suffix-matching for the `findRoute` `strict` parameter — these descriptions may or may not be equivalent); (2) Phase 3's `hostAlias` opt-in semantics ride on a single boolean while D7 implies lace already knows which feature owns the alias relationship, leaving it slightly ambiguous why the flag must live in the feature manifest rather than being implicit for `portless`; (3) the BLUF and Summary still claim "no host-side daemon to maintain" while the host setup section literally installs `portless` as a systemd user service — that is a host-side daemon, even though it is upstream-maintained rather than lace-maintained.
> Verdict: **Accept** with non-blocking polish notes.
> The proposal is ready to move to `implementation_ready` and gain its first empirical-validation devlog. The `--wildcard` source claim should be empirically verified during Phase 5 setup; if upstream's behaviour differs from the proposal's reading, the fallback is per-branch aliasing (already noted as a fallback in the test plan).

## Summary Assessment

This is a redesign in response to a user-directed pivot after round 2's `Accept` verdict.
The previous design (lace `installDeps` + `mergePostCreateCommand` extension + pnpm-store mount + vite probe) is replaced by:

1. A `dev` subcommand on weftwise's existing `scripts/worktree.sh` that handles install-on-missing and execs `portless` inline.
2. Adoption of the existing portless feature in weftwise's top-level `features`.
3. Adoption of portless on the host with `--wildcard` for suffix-matching.
4. A small lace addition: one new port-metadata flag, one post-`up` shellout, one new test file.

The redesign achieves the three Objective outcomes with materially less lace code:

- **Parallel worktrees work**: Container portless demuxes by Host header; each `worktree.sh dev` registers a route. Story 1 and Story 2 walk through this correctly.
- **Clean URLs**: Host portless on `:80` plus `--wildcard` alias forwards `*.weftwise.localhost` to the container's allocated portless port. URL is `{branch}.weftwise.localhost`, no port suffix.
- **New worktrees just work**: The dev script's install-on-missing path subsumes the previous `installDeps` complexity. This is the most significant ergonomic win over rounds 1 and 2.

The proposal is well-structured, the citations to existing lace primitives all verify, and the Test Plan and Verification Methodology give an implementer a concrete path forward.

## Verification of Source Claims

### Lace source citations

I spot-checked each lace source citation:

| Citation | Verified |
|---|---|
| `packages/lace/src/lib/workspace-layout.ts:82-209` (bare-worktree mount) | Reasonable — `workspace-layout.ts` exists; line range plausible. Not re-verified in detail (unchanged from rounds 1/2). |
| `packages/lace/src/lib/template-resolver.ts:181-223` (`injectForBlock`) | Verified: `injectForBlock` is at lines 191-223 in the current source; line 181 is the call site. The proposal's range correctly covers both. |
| `packages/lace/src/lib/port-allocator.ts:96-193` | Verified: class `PortAllocator` is at lines 96-193 exactly. |
| `packages/lace/src/lib/feature-metadata.ts` (Phase 3 target for `hostAlias`) | Verified: `LacePortDeclaration` interface at lines 47-57 has `label`, `onAutoForward`, `requireLocalPort`, `protocol` — adding `hostAlias?: boolean` is a one-line widening, consistent with the existing field set. |
| `packages/lace/src/lib/up.ts` (Phase 3 target for alias shellout) | Verified: `runDevcontainerUp` is called at line 1031; the "Post-container verification" block at line 1064 onward is the natural insertion point for the alias shellout, with extended config and port mapping already in scope. |
| `deriveProjectName` (Part 4, story 1, story 3) | Verified: `packages/lace/src/lib/project-name.ts:13-28` exports `deriveProjectName`; worktree and bare-root branches both return `basename(classification.bareRepoRoot)`, which is exactly what the alias name needs. |
| Existing portless feature manifest | Verified: `devcontainers/features/src/portless/devcontainer-feature.json` already declares `customizations.lace.ports.proxyPort` with `label`/`onAutoForward`/`requireLocalPort`; the proposed `hostAlias: true` addition slots in cleanly. |

All lace-side citations check out. The Phase 3 surface area as described is genuinely small.

### Portless `--wildcard` and `findRoute` source citation

The proposal cites `packages/portless/src/proxy.ts:87-96` and the `findRoute` function with a `strict` parameter (BLUF line 26, Background line 67, Edge Case E2 line 343).
This source is **not present in the lace repo** (no `packages/portless/` directory; `Glob` for `**/portless/**/*.ts` returns nothing; only `packages/lace/src/__tests__/portless-scenarios.test.ts` exists locally).

The companion fresh-eyes report (`cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md` line 47) describes `--wildcard` as:

> "`--wildcard` enables fallback for unregistered subdomains."

That language ("fallback for unregistered subdomains") and the proposal's language ("flips `strict` from true to false; suffix-matches `host.endsWith(\".\" + r.hostname)`") describe two operationally different behaviours:

- **Fallback for unregistered subdomains** suggests: known aliases match exactly; unknown aliases fall through to a default target.
- **Suffix matching with `strict=false`** suggests: every alias becomes a parent-domain match, so a single `weftwise` alias covers `*.weftwise.localhost`.

If upstream's actual behaviour is the former (fallback), then `portless alias weftwise <port>` would still only match `weftwise.localhost` exactly, and `main.weftwise.localhost` would route via the wildcard *fallback* — which may or may not target the same backend depending on how the fallback is configured.
If upstream's behaviour is the latter (suffix), then the proposal's design works as written.

This is the single load-bearing external claim in the proposal that I cannot verify from the lace tree alone.
The proposal does include a fallback in its test plan ("on failure, documents the per-branch alias fallback" — line 452), which is good defensive design.
The Verification Methodology should be tightened to verify the `--wildcard` semantics empirically as the **first** step after host portless install, not buried in Phase 5.

**This is non-blocking** because: (a) the fallback path (per-branch aliases) is acknowledged and works regardless of upstream's exact semantics; (b) the cost of getting this wrong is a per-`worktree.sh dev` `portless alias` call on the host (which is also achievable from inside the container via the alias being managed lace-side, similar to what Phase 3 does today for the project-level alias); (c) the empirical probe will surface the answer in Phase 5 regardless.

### Objective achievement

Walking through the three Objective outcomes against the four parts:

| Outcome | Achieved by | Risk |
|---|---|---|
| Parallel worktrees work | Part 1 (`worktree.sh dev` execs `portless {branch}.weftwise.localhost pnpm dev`) + Part 2 (container portless demuxes by Host header) | Low. Existing portless feature already does this for non-clean-URL cases today. |
| Clean URLs | Part 3 (host portless on :80) + Part 4 (lace `portless alias <project>`) + `--wildcard` | Medium. Depends on `--wildcard` semantics being suffix-matching (see above). Per-branch fallback exists. |
| New worktrees just work | Part 1's install-on-missing path | Low. The dev script is one file, well-scoped, and the previously-proposed `installDeps` machinery is gone — no longer requires container recreation for new worktrees. |

All three outcomes are achieved by the design as written, modulo the `--wildcard` semantics caveat.

## Section-by-Section Findings

### Frontmatter and BLUF

- **Non-blocking:** Frontmatter validates against `frontmatter-spec.md`. `status: review_ready` is correct. The author's pre-set `last_reviewed: revision_requested by @mjr round 3` is the user's request that motivated this redesign; this review replaces that with the agent verdict.
- **Non-blocking:** The BLUF is dense but accurate. It lists all four parts, names the URL pattern explicitly, and surfaces the dropped pieces (no `installDeps`, no `mergePostCreateCommand`, no pnpm-store mount) so a round-2 reader knows what changed.
- **Non-blocking:** "No host-side daemon to maintain" (BLUF, line 24) is technically misleading. The host setup section installs portless as a `systemctl --user` unit, which is a host-side daemon — just one we did not write. Recommend: "No host-side daemon for lace to maintain (host portless is an upstream-maintained service)" or similar.
  This is a tone correction, not a correctness issue.

### Objective and desired user flow

- **Non-blocking:** The three Objective outcomes are accurate and directly traceable to the four parts. This is a clear improvement over rounds 1 and 2, which had to caveat outcome 3 with the E2 post-create-worktree seam.
- **Non-blocking:** The user-flow shell snippet uses backgrounded `&` invocations as in round 1. The round-1 review noted this was a minor UX detail (interactive pane-per-worktree is the actual expected pattern); recommend a brief note that "interactive panes per worktree work identically" so a reader does not over-index on the `&`.

### Background and reused primitives

- **Non-blocking:** The four "load-bearing facts" are concise and well-cited. Fact 2 is the `--wildcard` claim (see Verification of Source Claims above).
- **Non-blocking:** The "Existing primitives" table is accurate. The reference to `template-resolver.ts:181-223` covers `injectForBlock` correctly per the source.
- **Non-blocking:** The "What is explicitly NOT being built" list is excellent — it surfaces every dropped piece from rounds 1/2 plus the deferred work (HTTPS, sshPort bug). This is the right way to document a redesign per the writing conventions' Critical and Detached Analysis section.

### Part 1: `scripts/worktree.sh dev`

- **Non-blocking:** The sketch is implementable and matches the dispatch shape of the existing `add`/`list`/`remove`/`status` subcommands.
- **Non-blocking:** The dev script reuses `basename "$PWD"` for branch derivation. This works for the canonical "user `cd`s into the worktree" case but breaks if a user runs `cd /workspaces/weftwise/main/packages/some-package && pnpm dev` (though that would call `pnpm dev` directly, not `worktree.sh dev`, so the breakage is benign — the user explicitly bypassed the script).
- **Non-blocking:** No guard for `pnpm` not being on `PATH`. The round-1 action item 5a (`command -v pnpm >/dev/null 2>&1 || exit 0`) is no longer load-bearing here because the dev script is weftwise-internal (not lace-internal), but a defensive check still seems wise — fail loudly if pnpm is missing rather than crashing inside `pnpm install`.

### Part 2: Portless in container (top-level features)

- **Non-blocking:** The one-line `devcontainer.json` change is correctly scoped. Removing `appPort: [3000]` in the same commit is called out, which resolves the round-1 E7 contradiction at its root (it is now a non-issue since `appPort: [3000]` is simply gone).
- **Non-blocking:** The previous review's "legacy-builder sequencing" rule (round 2 action item 8) is not referenced here. With the legacy-builder migration in flight (status `wip` per repo state), the sequencing question still applies: does the portless feature go into `features` or `prebuildFeatures`? The proposal pins it to `features` unconditionally. This is the right answer if legacy-builder lands first, but the proposal does not state that as a precondition. Recommend a one-line NOTE: "Assumes the legacy-builder migration for weftwise has landed (or lands in the same PR); otherwise portless adopts the same `prebuildFeatures` -> `features` migration alongside weftwise's other features."

### Part 3: Host-side portless on port 80

- **Non-blocking:** The setup script (sysctl, `npm install -g portless`, systemd override, `portless service install`) is implementable end-to-end. The `PORTLESS_WILDCARD=1` environment override via systemd drop-in is the right level of mechanism (it survives `portless service install` regenerating the unit, per the proposal's own E2 reasoning).
- **Non-blocking:** The `portless trust` line is commented out and linked to the HTTPS RFP — clean handoff.
- **Non-blocking:** The sysctl drop-in writes `net.ipv4.ip_unprivileged_port_start=80`. This lowers the unprivileged-port boundary system-wide; a reader unfamiliar with the implications might benefit from a one-line note that this is a one-way setting (no rollback shown) and applies to all user services on the host, not just portless.

### Part 4: Lace `portless alias` integration

- **Non-blocking:** The `hostAlias: true` flag is well-placed in the existing `LacePortDeclaration` schema; the feature-metadata.ts widening is one optional boolean field. Validation rejects non-boolean values per the test plan.
- **Non-blocking:** The post-`up` shellout location ("after `runDevcontainerUp` succeeds") aligns with the existing "Post-container verification" block at `up.ts:1064+`. An implementer can land this without restructuring `up.ts`.
- **Non-blocking:** The alias state persistence to `.lace/portless-aliases.json` is documented as "out of initial scope" for cleanup. The stale-alias cleanup RFP (`2026-05-13-rfp-lace-stale-portless-alias-cleanup.md`) inherits this.
  However, the proposal still says to **persist** the alias state (line 201) — that means lace writes the file but does not consume it in initial scope. Recommend clarifying: either drop the persistence in v1 (simplest) and pick it up in the cleanup RFP, or commit to writing it now so the cleanup RFP has data to read.
- **Non-blocking:** D7's argument for lace owning the alias lifecycle is sound. The implicit follow-on is that there are now two layers of state to keep coherent (lace's port allocation in `.lace/port-assignments.json` and lace's alias state in `.lace/portless-aliases.json`). This is fine for the initial scope; recommend a `WARN(opus/parallel-dev): Two state files; cleanup RFP must reconcile both` callout to flag the consistency burden.

### Design Decisions D1-D7

- **Non-blocking:** D1 (multi-project as load-bearing) is well-argued. The list of projects (weftwise, whelm, dotfiles, clauthier, lace itself) is specific and concrete; multi-project really is the default for this user.
- **Non-blocking:** D2 (run portless twice) is the right architectural call. The "free HTTPS path" argument is honest about future value.
- **Non-blocking:** D3 (URL pattern change) is the most user-visible decision. Dropping `web.` is the right move given multi-service is deferred; the proposal correctly notes that `<service>.<branch>.weftwise.localhost` slots in when needed.
- **Non-blocking:** D4 (install-on-demand lives in weftwise, not lace) is the central redesign decision and the proposal makes the cost statement explicit: "users who run `pnpm dev` directly hit the original install-missing footgun." This is acceptable as a self-imposed limitation provided the dev script is canonical.
  Worth a stronger framing: the prior `installDeps` mechanism handled the bypass case (because it ran at container-creation time, before any user `pnpm dev`). The dev-script approach requires user discipline. For a single-developer single-machine setup, that is fine; for a future where weftwise is shared, the bypass risk re-emerges. Recommend a NOTE acknowledging this is a single-developer tradeoff.
- **Non-blocking:** D5 (no pnpm-store mount) is sound given the verification devlog's 2.5s measurement. The "cold install" caveat is honestly stated.
- **Non-blocking:** D6 (HTTP-only initially) is correct. The HTTPS RFP exists.
- **Non-blocking:** D7 (lace owns alias lifecycle) is correctly argued. See Part 4 finding on the implicit state-coherence cost.

### Stories

- **Non-blocking:** Story 1 (first-time setup) is concrete. The "Total commands beyond the one-time setup: `lace up`, then `worktree.sh dev`" framing is the right BLUF-level metric.
- **Non-blocking:** Story 2 (add worktree mid-session) — this is the round-1 E2 seam, now genuinely resolved by the dev script. The "No `lace up`, no manual install step" callout is the right closing line.
- **Non-blocking:** Story 3 (second concurrent project) — the "whelm has the same dev-script convention" assumption is reasonable but should be tightened. If whelm does NOT have a `worktree.sh dev` equivalent, the user falls back to `portless main.whelm.localhost pnpm dev` directly, which still works (and is documented in D4's footgun statement). A one-line note here would close the loop.

### Edge Cases

- **Non-blocking:** E1 (existing host-proxy proposal superseded) is correctly handled. The `2026-02-26-host-proxy-project-domain-routing.md` file already has `state: archived, status: evolved` and a NOTE pointing at this proposal. Verified.
- **Non-blocking:** E2 (`--wildcard` flag mechanism) is the key external dependency. See Verification of Source Claims above for the source-citation issue. The proposal's defensive language ("verify upstream behaves as expected" — line 404) is the right hedge.
- **Non-blocking:** E3 (new worktrees) — correctly inverted from a previous caveat to a positive outcome.
- **Non-blocking:** E4 (container hostname) — correctly characterised as cosmetic.
- **Non-blocking:** E5 (portless config persistence) — `~/.portless/routes.json` and `~/.config/portless/` are claimed; the proposal explicitly hedges "verify exact path with upstream." Fine.
- **Non-blocking:** E6 (`--rebuild` required for `appPort` changes) — accurate per the verification devlog.
- **Non-blocking:** E7 (pnpm split-brain) — carried forward from rounds 1/2; the claim that the dev script's `pnpm install` routes through corepack/`packageManager` correctly is reasonable but should be empirically confirmed in Phase 5. The test plan does not explicitly call this out; recommend adding "verify `pnpm install` invoked by the dev script picks up `packageManager: pnpm@10.26.2`, not the login-shell `pnpm` at 11.1.1."
- **Non-blocking:** E8 (HTTPS upgrade path) — clean handoff to the RFP.
- **Non-blocking:** E9 (multiple services per worktree) — correctly deferred. Wildcard alias support is the load-bearing dependency, which is the same dependency as E2.

### Test Plan

- **Non-blocking:** Unit tests are appropriately scoped. The `hostAlias: true` recognition and validation tests are exactly the right granularity for the Phase 3 surface area.
- **Non-blocking:** Integration test (mock the shellout, assert the args) is the right level. Recommend asserting both: (a) the shellout is invoked exactly once per `lace up` with the right project name and port; (b) `hostAlias: false` (or absent) produces zero shellouts.
- **Non-blocking:** The empirical measurement matrix is concrete. The first row ("Confirm `--wildcard` is active on host portless") is the right probe; recommend running this row **first**, before any of the other measurements, so the per-branch fallback (if needed) can be wired in before measuring concurrent worktrees.
- **Non-blocking:** Success criteria are concrete except for "First-`lace up` wall time under 90s" — that is a reasonable budget but is sensitive to container layer caching state. A NOTE acknowledging "warm-image vs cold-image variance" would help an implementer interpret a failure.

### Verification Methodology

- **Non-blocking:** The phase-by-phase structure is appropriate.
- **Non-blocking:** Phase 4's verification ("Browser reaches `http://main.weftwise.localhost/`") is the right end-to-end signal. Recommend adding an explicit prerequisite that Phases 1-3 are landed first; the current Mermaid diagram has Phases 1-4 fanning into Phase 5 but does not show the host-setup-before-end-to-end dependency.
- **Non-blocking:** A devlog at `cdocs/devlogs/<date>-weftwise-parallel-dev-validation.md` is the right artefact.

### Implementation Phases

- **Non-blocking:** Five phases, four of them parallelisable into Phase 5. This is genuinely a small footprint. The phases are well-scoped per file.
- **Non-blocking:** Phase 3's "Files to modify" list is precise: three files plus one new test file. Verified each file path exists and the change site is reasonable.
- **Non-blocking:** Phase 4 (host setup docs) — recommend specifying the documentation location more concretely. The proposal offers "weftwise's README (or a dedicated `docs/host-setup.md` in lace itself)" — pick one. My recommendation: `docs/host-setup.md` in **lace** because the setup is lace-cross-project (it covers any project using the portless feature, not just weftwise).

### Open Questions

- **Non-blocking:** All four questions are well-framed. Q1 (port reassignment across projects) is correctly answered. Q3 and Q4 dispatch to the two follow-up RFPs.

### Summary section

- **Non-blocking:** The summary correctly enumerates the four small surface areas and the three outstanding deviations (HTTPS, stale aliases, archived predecessor proposal). Each deviation has a destination.

### References

- **Non-blocking:** All references resolve to files that exist. The `Superseded` section correctly lists the archived proposal.

## Verification of Supporting RFPs

Both follow-up RFPs exist and have proper frontmatter:

| RFP | `status` | `state` | Tags include `future_work` | BLUF present |
|---|---|---|---|---|
| `2026-05-13-rfp-lace-stale-portless-alias-cleanup.md` | `request_for_proposal` | `live` | Yes (`future_work`) | Yes, attribution correct |
| `2026-05-13-rfp-portless-https-via-trust.md` | `request_for_proposal` | `live` | Yes (`future_work`) | Yes, attribution correct |

Both RFPs correctly cite this proposal as their source, identify their narrow scope (alias cleanup; HTTPS adoption), list open questions for a future author, and explicitly state non-goals. Neither is load-bearing for this proposal — both are honest follow-ups, not hidden dependencies dressed up as RFPs.

The archived predecessor (`2026-02-26-host-proxy-project-domain-routing.md`) has `state: archived, status: evolved` and a NOTE callout pointing at this proposal. Verified.

## Verification of Round 2 Action Items

The round-2 review issued seven non-blocking action items and two open questions. With the redesign, most are now non-applicable:

| Round 2 action | Status under redesign |
|---|---|
| 1. Update Implementation Phases preamble for Phase 3 substep A | N/A — substeps eliminated; the new phase structure has no probe-then-conditional ordering. |
| 2. Reword the Phase 1 composition test for empty-postCreateCommand input | N/A — `mergePostCreateCommand` extension is dropped entirely. |
| 3. Align Story 3 with E7's canonical removal stance for `appPort: [3000]` | N/A — `appPort: [3000]` is now removed in Phase 2, not in Phase 3, and not "optional" anywhere. |
| 4. Align E7 timing language | N/A — E7 is now a different scenario (existing host-proxy proposal coexistence). |
| 5. Clarify `WorkspaceConfig.postCreate.installDeps: boolean | string` | N/A — `installDeps` flag is dropped. |
| 6. Verification Methodology step 2 conditional on probe outcome | N/A — no probe. |
| 7. Line citation for `injectForBlock` | Partially addressed — the proposal now cites `template-resolver.ts:181-223` (verified). |

So all of round 2's polish items either no longer apply (due to redesign) or are addressed. Good evidence that the author re-read the previous review before redesigning rather than just rewriting from scratch.

## New Issues Specific to the Redesign

### N1: BLUF claim "no host-side daemon to maintain"

The BLUF says "no host-side daemon to maintain (portless is already installed for the container; it gains a second instance on the host)."
The "second instance on the host" **is** a host-side daemon (`systemctl --user` unit, persistent across reboots, listens on `:80`).

The intent — that lace does not own the daemon code — is correct, but the framing oversells. Suggested rewording: "no bespoke host-side daemon to write or maintain; host portless is an upstream-managed `systemctl --user` unit."

This is a one-line clarity fix.

### N2: `hostAlias: true` as a metadata flag vs implicit-by-feature

D7 argues lace owns the alias lifecycle. The `hostAlias: true` flag is documented as opt-in so projects without clean-URL needs do not get an alias.

But the only feature for which `hostAlias: true` makes sense is `portless` itself (the alias points at portless's host port). A non-portless feature would not have anything to alias.
This raises a design question: is `hostAlias: true` general-purpose (will future non-portless features want it) or portless-specific (in which case why is it a generic metadata flag rather than portless-specific logic)?

Two stances:

- (a) General-purpose: the flag stays as a generic port-metadata field; any feature that declares a port-with-host-routing can opt in. This is the proposal's current stance. Cost: slightly more abstract surface for a single concrete user. Benefit: extensibility.
- (b) Portless-specific: lace's `up.ts` hard-codes the "if portless feature is present, add a host alias" rule; no new metadata field. Cost: portless becomes a special case. Benefit: zero new metadata surface.

The proposal's choice (a) is defensible but should be argued explicitly in D7 (or a new D8). As written, it reads as "the flag is generic" without saying why generic-over-specific is the right call.

This is non-blocking; an implementer could go either way at implementation time. Worth a sentence in D7.

### N3: Single-source-of-truth claim for dev script

D4 says the dev script becomes "single source of truth for 'make this worktree runnable + reachable.'"
True for weftwise, but the parallel-dev integration is supposed to be lace-level (Phase 3 lives in lace, Phase 4 docs in lace, multi-project routing in lace).
Each project's dev script being its own source of truth means there is no lace-level "make any worktree runnable" surface — only convention.

This is fine for the user's actual situation (small number of projects, each manually adopting the convention) but contradicts the "multi-project as load-bearing case" framing in D1.
The contradiction is mild: each project has a separate routability surface (host alias), but each project owns its own runnability surface (its dev script).
A reader might expect lace to provide a `lace dev` subcommand that wraps the per-project convention.

Recommend a one-line acknowledgement in D4 or in Open Questions: "Per-project dev scripts as convention; a lace-level `lace dev` wrapper is a possible future consolidation."

This is non-blocking.

### N4: Test plan does not explicitly probe wildcard semantics first

As noted in Verification of Source Claims, the `--wildcard` semantics is the highest-uncertainty external claim. The test plan's first row probes `systemctl show portless` for the env var, but does not actually exercise the routing semantics until the third row (single-worktree curl).

A stronger ordering: probe the routing semantics with a synthetic test before relying on it for the real worktree URLs. E.g., `portless alias testproject 8080 && python -m http.server 8080 & curl http://foo.testproject.localhost/` — if this returns the python server's directory listing, suffix matching is real; if it 404s, it is not.

This would catch the semantic difference between "fallback for unregistered subdomains" and "suffix matching" early.

Non-blocking, but materially derisks Phase 5.

### N5: Phase 4 (host setup docs) placement

Phase 4 is "host portless setup documentation." The documentation location is undecided ("weftwise's README or a dedicated `docs/host-setup.md` in lace").

For multi-project usage, the docs belong in **lace** (it is cross-cutting host infrastructure used by every lace project that opts in via `hostAlias: true`). Weftwise's README should link to the lace docs, not duplicate them.

Recommend: pin the docs to `docs/host-setup.md` in lace. Phase 4 becomes "Add `docs/host-setup.md` to lace; add a link from each adopting project's README."

Non-blocking; a reasonable implementer would arrive at this answer.

## Verdict

**Accept.**

The redesign is genuinely lighter, internally coherent, and traceable through every cited primitive. No orphaned references to `installDeps`, `mergePostCreateCommand`, the pnpm-store mount, the vite probe, or the four-phase test plan from rounds 1-2 remain in the document — verified by reading start-to-end. The three Objective outcomes are achieved by the four parts as designed, modulo the `--wildcard` semantics that should be verified empirically in Phase 5 (the per-branch fallback is the documented backup).

The Phase 3 lace surface (one new boolean field + one post-`up` shellout + one new test file) is small enough to land cleanly. The host setup is documented in implementable detail. The two follow-up RFPs are correctly scoped as non-load-bearing follow-ups. The previously-superseded host-proxy proposal is archived with proper status.

No blocking issues. All findings are non-blocking polish.

## Action Items

1. **[non-blocking]** Rephrase BLUF "no host-side daemon to maintain" to "no bespoke host-side daemon to write or maintain (host portless is an upstream `systemctl --user` unit)." (N1)

2. **[non-blocking]** Empirically probe `--wildcard` routing semantics as the **first** Phase 5 test (before any worktree-level measurements). Document the probe shell snippet in the test plan first row, replacing or augmenting the current `systemctl show` check with an actual `portless alias` + curl round-trip against a synthetic backend. (N4)

3. **[non-blocking]** Pin Phase 4 documentation location to `docs/host-setup.md` in lace (not weftwise). Update Phase 4's description to specify the file path. (N5)

4. **[non-blocking]** Add a sentence to D4 or D7 acknowledging that per-project dev scripts as runnability convention is a deliberate per-project choice; flag `lace dev` wrapper as possible future consolidation. (N3)

5. **[non-blocking]** Add a sentence to D7 arguing the choice of generic `hostAlias` metadata flag over portless-specific hard-coded logic in `up.ts`. (N2)

6. **[non-blocking]** Add a NOTE under "Existing primitives this proposal reuses" or in a new sequencing section: portless lands in top-level `features` only after weftwise's legacy-builder migration (if not landed in the same PR). The proposal assumes top-level `features`; the migration state is the precondition.

7. **[non-blocking]** Clarify the alias state persistence: either drop `.lace/portless-aliases.json` from Phase 3 (defer to cleanup RFP) or commit to writing it now so the cleanup RFP has data to consume. Currently the proposal mentions persistence but does not specify whether v1 actually writes the file.

8. **[non-blocking]** Add to E5 or D7 a `WARN` callout: two state files (port-assignments + portless-aliases) now exist; the cleanup RFP must reconcile them.

9. **[non-blocking]** Add to Phase 5 test plan: explicit verification that `pnpm install` invoked by the dev script picks up `packageManager: pnpm@10.26.2` (via corepack) rather than the login-shell pnpm. Carries forward E7's claim to an empirical confirmation.

10. **[non-blocking]** Add a one-line "interactive panes per worktree work identically" note to the desired user flow, so a reader does not over-index on the backgrounded `&` invocations.

## Questions for the Author (multi-choice, non-blocking)

**Q1: `--wildcard` semantics empirical probe.**
Round 1's Q2 used an empirical probe to settle the vite/portless interaction. A similar probe should settle the wildcard-vs-fallback question.
- (a) Add the probe to Phase 5's measurement matrix as a `[ ]` row run first, before any worktree measurements.
- (b) Make the probe a Phase 4 (host setup docs) verification step, blocking Phase 5 entirely on its outcome.
- (c) Skip the probe; rely on the per-branch alias fallback if curl-via-host fails in Phase 5.

**Q2: Phase 3 alias-state persistence in v1.**
- (a) Phase 3 writes `.lace/portless-aliases.json` in initial scope (gives the cleanup RFP something to read).
- (b) Phase 3 does not write the file in initial scope; defer entirely to the cleanup RFP, which will introduce the file when it lands.
- (c) Phase 3 writes the file but does not consume it; cleanup RFP consumes it later.

**Q3: `hostAlias` flag scope.**
- (a) Keep as generic port-metadata flag (current stance). Argue the extensibility benefit in D7.
- (b) Move to portless-specific logic in `up.ts`; drop the metadata flag entirely.
- (c) Keep the flag but rename it to `portlessHostAlias: true` to scope it explicitly even if it lives in generic port metadata.

**Q4: Phase 4 host-setup docs location.**
- (a) `docs/host-setup.md` in lace (recommended; cross-cutting infrastructure).
- (b) Add to weftwise's README and document the same steps separately in each adopting project.
- (c) Both: canonical copy in lace; brief link/excerpt in each project's README.
