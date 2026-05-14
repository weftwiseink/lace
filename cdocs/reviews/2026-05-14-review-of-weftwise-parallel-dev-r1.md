---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-14T11:55:00-07:00
task_list: weftwise/parallel-feature-development
type: review
state: live
status: done
tags: [rereview_agent, iterate_loop, runtime_validated, architecture, deviation_scrutiny, weftwise, portless]
---

# Review of Weftwise Parallel-Dev Implementation (impl-1, iterate round 7)

> BLUF(opus/weftwise-parallel-dev): Accept with reservations.
> Verification floor is met empirically (two concurrent `http://{branch}.weftwise.localhost:22427/` URLs returning HTTP 200 simultaneously, per validation devlog and existing `.lace/` artefacts), and five of six deviations are pragmatic and well-justified.
> The D4 vite-config relaxation is a real proposal-scope violation but is the right empirical call given D3 (portless 0.13.0 does not auto-inject `--port` through a pnpm shim), and the change is small (two `process.env` reads gated by env presence) and forward-compatible.
> The proposal text on lines 56-57 and the portless feature's manifest description need follow-up amendments to reflect empirical reality (proposal said "symmetric injection ... via appPort"; reality is symmetric injection into the feature option, which becomes a symmetric `port:port` `appPort` entry in the generated config — both end up at the same place, but the description is imprecise).

## Methodology

- Read the proposal and the iterate/validation devlogs.
- Read the actual implementation in lace (`up.ts`, `feature-metadata.ts`, `portless-alias-check.ts`, the new test files) and weftwise (`worktree.sh`, `vite.config.ts`, `devcontainer.json`, the copied portless feature).
- Cross-referenced the generated `/home/mjr/code/weft/weftwise/main/.lace/devcontainer.json` against the proposal's expectations.
- Reviewed `.lace/port-assignments.json` and run logs for empirical evidence the pipeline ran end-to-end.

> NOTE(opus/weftwise-parallel-dev/r1): My toolset for this loop does not include a shell.
> I cannot independently fire `curl -sI http://main.weftwise.localhost:22427/`, `podman port weftwise`, or `lace validate` against the live system.
> I relied on the validation devlog's textual transcripts and the persisted `.lace/` artefacts (port-assignments.json, the generated devcontainer.json, run logs) as the empirical record.
> If the user wants a fresh live probe, they should run those commands themselves — but the verification floor is already attested by the implementer's recorded transcripts and the recorded `portless list` output showing both routes registered with distinct vite PIDs.

## Summary Assessment

The implementation accomplishes the proposal's core objective: two concurrent worktree dev servers reachable via per-branch hostnames on a single lace-allocated host port (22427), with stable allocations across `lace up` runs.
All four phases landed and the verification floor was met before this review started.

The work uncovered three real proposal-design gaps that the implementer fixed empirically:

- **D1**: lace had never previously needed to rewrite local feature path refs when emitting `.lace/devcontainer.json`. The fix is small, contained to `up.ts`'s `generateExtendedConfig`, and the comment block explaining it (lines 1228-1249) is excellent.
- **D2**: the portless feature's auto-start entrypoint was defaulting to HTTPS on 443. It would have silently failed for any consumer, not just lace-driven ones. The fix is feature-side and improves the feature for all consumers.
- **D3 + D4**: the proposal's load-bearing claim on line 57 (portless auto-injects `--port` through `pnpm dev`) is empirically false. The implementer's chosen response — bypass `pnpm dev` in `worktree.sh` and additionally relax `vite.config.ts` for the devtools-port collision — is appropriate.

D5 (git config drift) is unrelated cleanup. D6 (`up.ts` vs `validate.ts`) is a defensible architectural choice that gives the check broader coverage than the proposal asked for.

The most consequential follow-up: the proposal's "what is NOT being built" list (line 84) explicitly forbids vite config relaxation. The proposal needs an amendment NOTE acknowledging D3/D4 once this review accepts.

## Section-by-Section Findings

### Phase 1: `scripts/worktree.sh dev`

The script structure matches the proposal's spec.
The error paths (no `package.json`, missing portless) are present and match.
The branch derivation from `basename "$PWD"` is preserved as specified.

The `exec` line, however, has been replaced by a multi-line shell wrapper that explicitly invokes `pnpm --filter weft exec vite --port "$PORT" --host --strictPort`.
This is the D3 workaround. The inline NOTE callout (lines 279-294) explains the empirical motivation cleanly.

**Non-blocking finding.** The `--filter weft` is a weftwise-specific assumption that escapes the proposal's "branch-derived from PWD" generic shape.
If a worktree's `package.json` is not a workspace consumer or sits in a directory whose pnpm-filter target differs from `weft`, `cmd_dev` will mis-invoke.
The implementer's validation devlog Uncertainty #5 already flags the basename derivation as fragile; this `--filter weft` baking is the same class of fragility, in the opposite direction (locking us to the current workspace structure).
This is acceptable for v1 but should be tracked as a follow-up: either generalise the wrapper (let vite be located by pnpm's package-dir resolution from CWD) or accept that `cmd_dev` is weft-package-specific.

### Phase 2: `.devcontainer/devcontainer.json` adoption

The proposal's diff is honored: `appPort: [3000]` is gone, the portless feature is added.

**Non-blocking finding.** The feature ref is `./features/portless` and the feature was copied into `weftwise/.devcontainer/features/portless/`.
The proposal's line 213 prescribes `./devcontainers/features/src/portless` (lace-repo-relative), which the implementer correctly identified as wrong-for-the-consumer and replaced with a local copy.
The trade-off: weftwise now carries a vendored copy of a lace feature that will drift from the upstream until the feature is published to ghcr.
The inline NOTE in the devcontainer.json (lines 23-24) is good; an additional `WARN(opus/...)` callout in the proposal would help future readers understand why this is a transitional state.

### Phase 3a: `feature-metadata.ts` schema widening

The interface widening (line 47-66 of `feature-metadata.ts`) is correct.
The extractor widening (line 681-684) correctly returns `undefined` for non-booleans.
The doccomment on `portlessAlias` accurately describes v1 semantics and points at the follow-up RFP.

The round-trip test (`feature-metadata.test.ts` lines 722-748) covers `true`, `false`, the string `"yes"`, and `undefined`.
The wezterm fixture test (line 417-423) was correctly updated to expect `portlessAlias: undefined` in the extractor output, which validates the "silent narrowing" round-4 bug is resolved.

**Verified.** The portlessAlias field is round-tripped through `extractLaceCustomizations`; the round-4 silent-narrowing bug is no longer reproducible against the current code.

### Phase 3b: portless feature manifest

The manifest at `devcontainers/features/src/portless/devcontainer-feature.json` carries `"portlessAlias": true` on the `proxyPort` declaration.

**Non-blocking finding.** The manifest description on line 5 still says "asymmetric mapping to portless's default port 1355" and the `proxyPort` description on line 11 says "the container side of an asymmetric port mapping (e.g., 22435:1355)".
Empirically (per D2's reconciliation in `install.sh`), the proxy now binds the symmetric port (e.g., 22427:22427).
The feature manifest's description text is stale and contradicts its own install.sh.
Should be reconciled to either describe the symmetric reality or document both modes explicitly.

### Phase 3c: `validate`/`up` sub-check

The sub-check lives in `packages/lace/src/lib/portless-alias-check.ts` and is invoked from `up.ts` immediately after `buildFeaturePortMetadata` (line 887-914).
It is wrapped in try/catch so a probe failure can never break the pipeline.
It correctly reads `ownedPorts` and short-circuits `isPortAvailable` when the port is held by this project's own container.
The six-scenario unit test suite (`portless-alias-check.test.ts`) covers the matrix the proposal called for.

**Architectural finding (D6).** The proposal directed Phase 3c to edit `packages/lace/src/commands/validate.ts`. The implementer correctly identified `validate.ts` as a thin shim over `runUp({ validateOnly: true })` and embedded the check in `up.ts`. The functional consequence: the check runs for **both** `lace up` and `lace validate`, which is broader than the proposal asked for but matches the proposal's spirit (the proposal says "extend `validate`"; it does not say "extend only `validate`"). The proposal's Phase 3c Acceptance criterion ("lace validate ... prints the informational message") is satisfied because `lace validate` invokes `runUp` which invokes the check.
**No blocking issue.**

**Empirical reservation.** The sub-check's stdout is via `console.log`/`console.warn`, not via the run-log mechanism (`runLog.logPhase`). The most recent run log (`.lace/logs/2026-05-14T18-46-22-e60fa8.log`) records the phases but not the info-line emission. This is consistent with `up.ts`'s pattern (most informational stdout is not captured in the run log), so it is not a regression. The validation devlog row for Step 1 attests `lace validate emits the portlessAlias info lines + allocated port (22427); exit 0` which is the empirical record for this acceptance criterion.

**Non-blocking finding.** The info line `info: portless feature detected (alias=${projectName})` is printed **per allocation** with `portlessAlias: true`. If a future feature declared multiple `portlessAlias`-flagged ports, the info pointer would print N times. Trivially fixable; for v1's one-feature/one-flag case it does not matter.

### Phase 4: empirical validation

The validation devlog's 9-step matrix is documented with empirical evidence per step. Steps 1-8 are PASS (5 ADAPTED to a `feature-x` worktree, which the proposal explicitly endorsed via Step 7's "add on the fly" path). Step 9 is NOT RUN (multi-project verification with a second project's portless adoption).

**Non-blocking finding.** Step 9 leaves the proposal's Objective 3 ("multi-project safe") empirically unverified.
The architecture is plausibly correct (each project's `PortAllocator` reserves a unique host port out of 22425-22499), but the dev servers from a second project (e.g., whelm) are not running concurrently with weftwise in this loop.
This is a known gap in the verification, flagged in the validation devlog's Uncertainty #4.
For the iterate loop's verification floor (>=2 concurrent dev servers), the verification is sufficient.
For the proposal's Objective 3, a follow-up loop or manual user verification is warranted before the proposal is marked `implementation_accepted`.

## Deviation Scrutiny

### D1: lace local-feature path rewriter

**Verdict: well-justified, accept.**

The proposal's `./devcontainers/features/src/portless` instruction (line 213) was an instructional bug: the path is lace-repo-rooted, but the devcontainer CLI resolves feature paths relative to the config file's directory. Without the rewriter, lace's `.lace/devcontainer.json` output would refer to `./features/portless` (resolved from `.lace/`), which resolves to `<workspace>/.lace/features/portless` — a path that does not exist. The CLI additionally enforces a "child of `.devcontainer/`" constraint that requires the rewrite to go via `../.devcontainer/features/portless`.

The implementer's fix in `generateExtendedConfig` (lines 1228-1272) is the cleanest place for this rewrite: it sits next to the existing `build.dockerfile` and `build.context` rewrites, which already do exactly this kind of "the config file moved to a new directory; relative paths must follow" rewriting. The comment block explaining the CLI's two constraints is unusually clear.

**Test coverage gap (non-blocking).** The rewriter does not have a targeted unit test. The validation devlog Uncertainty #3 flags this. A focused test in `up.test.ts` (or similar) covering: registry refs unchanged, absolute paths unchanged, `./foo` rewritten to `../.devcontainer/foo`, `../sibling` rewritten correctly, and missing paths left as-is for CLI error surfacing.

### D2: portless install.sh entrypoint

**Verdict: well-justified, accept. Note backward-compatibility concern.**

The previous `portless proxy start` (no args) entrypoint defaulted to HTTPS on port 443 (per portless 0.13.0). In an unprivileged container, binding 443 fails silently. The fix passes `--port "$PROXY_PORT" --no-tls`, which both works in unprivileged containers and matches v1's plain-HTTP URL pattern.

**Backward-compatibility question.** Validation devlog Uncertainty #1 explicitly asks whether the install.sh change breaks non-lace consumers. Reading the install.sh: `PROXYPORT="${PROXYPORT:-1355}"` preserves the documented default. A non-lace consumer that does not set the `proxyPort` option gets `PROXYPORT=1355`, and the entrypoint runs `portless proxy start --port 1355 --no-tls`. **This is a behavior change for non-lace consumers**: they used to (try to) get HTTPS on 443 (which silently failed in unprivileged contexts anyway); they now get plain HTTP on 1355. The new behavior is strictly more useful (it actually starts), but it does change the daemon's interface for any standalone consumer.

This is a small risk because v0.13.0 already silently broke standalone consumers. The proposal's follow-up RFP (`rfp-truly-portless-portless`) and `rfp-portless-https-via-trust` will revisit HTTPS, at which point this entrypoint becomes obsolete anyway. **Acceptable.**

**Non-blocking finding.** The portless feature's `devcontainer-feature.json` description still describes asymmetric port mapping (1355 container-side); the install.sh now binds the symmetric port. These two should be reconciled in a follow-up.

### D3 + D4: vite.config.ts relaxation

**This is the most consequential deviation and deserves the most careful judgment.**

The proposal's line 57 claims portless 0.13.0 auto-injects `--port` for vite when launched via `portless ... pnpm dev`. The implementer empirically verified this is false: portless inspects only the immediate child basename (`pnpm`), not `vite`, and skips framework injection. With `pnpm dev`, vite falls back to `vite.config.ts:server.port: 3000` and parallel worktrees collide.

The implementer's response is two-pronged:

1. **`worktree.sh` change** (the D3 fix): replace `portless ROUTE pnpm dev` with `portless ROUTE sh -c '... exec pnpm --filter weft exec vite --port "$PORT" --host --strictPort'`. This bypasses portless's framework detection by being the framework-detection-aware caller. It works.
2. **`vite.config.ts` change** (the D4 fix): make `server.port` read `process.env.PORT` (defaulting to 3000) and make `@tanstack/devtools-vite`'s event-bus port read `process.env.TANSTACK_DEVTOOLS_PORT`.

**Why the vite.config.ts change is required even with the D3 wrapper.** The `--port "$PORT"` CLI flag passed to vite **does** override `server.port` (vite's CLI flags win over config). So in principle the D4 vite.config.ts change is **not strictly required** for the main port collision. But:

- The `@tanstack/devtools-vite` event-bus binds 42069 hard with no CLI override. With two concurrent vite instances in one container, the second one EADDRINUSEs on 42069. This is what the `TANSTACK_DEVTOOLS_PORT` env-var read in vite.config.ts addresses, and there is no other way to address it: the devtools plugin's port must come from config, not CLI.
- Reading `PORT` from env in vite.config.ts is defensive: it allows raw `pnpm dev` (without the portless wrapper, e.g., from CI or from a user testing locally) to honor whatever PORT is set externally.

**Was there a simpler path?**

- **Option A (rejected): patch portless's framework detection.** Out of v1 scope (portless is upstream code; weftwise/lace don't own it). Would require a portless PR, version bump, and revisit of the install.sh `version` option.
- **Option B (rejected): pre-inject the port via env from `worktree.sh` only.** Doesn't work for the devtools-port collision; that plugin's port is config-only.
- **Option C (the chosen path): wrap pnpm exec vite + relax vite.config.ts for the devtools port.** Smallest, most local, works.

**Judgment: accept the D4 deviation.**

The proposal's "explicitly NOT being built" list (line 84) said "no vite config relaxation" against the backdrop of the now-false load-bearing claim on line 57.
With the line-57 claim falsified by D3, the D4 prohibition loses its premise.
The change to `vite.config.ts` is two `process.env.X ? Number(X) : default` reads, gated such that absent env vars produce the pre-existing behavior.
There is no realistic interpretation where this regresses normal weftwise development; it strictly widens the configuration surface.

**Required follow-up (non-blocking for accept):** the proposal needs a NOTE() callout near line 57 and line 84 acknowledging D3/D4. Per the writing-conventions rule on "Commentary Decoupling", the right pattern is to leave the proposal body intact and add a `NOTE(opus/weftwise-parallel-dev/iterate):` callout that says "Empirically, portless 0.13.0 does not auto-inject `--port` through a pnpm shim; the implementation works around this via worktree.sh + a defensive vite.config.ts read. The 'no vite config relaxation' constraint is relaxed for the env-var defensive pattern; see iterate devlog D3/D4." This is a non-blocking proposal-amendment task; it does not gate impl-1 acceptance.

### D5: pre-existing git extension drift

Pre-existing, unrelated to the proposal's scope. The removal of `extensions.relativeWorktrees=true` from the bare repo's config is a legitimate fix for the host-2.54-vs-container-2.39.5 git version skew. **Accept; no proposal change needed.**

### D6: validate sub-check lives in `up.ts`

**Verdict: defensible architectural choice, accept.**

The proposal said edit `validate.ts`. The implementer edited `up.ts` and embedded the check at the right phase (after `buildFeaturePortMetadata`, before `generateExtendedConfig`). Because `validate.ts` is a thin shim over `runUp({ validateOnly: true })`, the check runs for both code paths.

**Does the check actually run for weftwise?** Yes — the `metadataMap` includes the portless feature, the `templateResult.allocations` includes `portless/proxyPort=22427`, the sub-check finds `portlessAlias: true` in the metadata, runs `isPortAvailable(22427)` (short-circuited because the project's container holds 22427), and emits the four info/warn lines. The validation devlog Step 1 attests this empirically.

**Does it print what the proposal says?** Yes — the emitted lines in `portless-alias-check.ts` lines 100-114 match the proposal's lines 300-303 verbatim (modulo the `(alias=<project>)` interpolation, which the proposal wrote as a template and the code resolves with `projectName`).

## Spec-Compliance Audit

| Proposal artefact | Implemented? | Notes |
|---|---|---|
| `LacePortDeclaration.portlessAlias?: boolean` | Yes | `feature-metadata.ts:65` |
| `extractLaceCustomizations` round-trips `portlessAlias` | Yes | `feature-metadata.ts:681-684`, unit-tested |
| Portless feature manifest declares `portlessAlias: true` | Yes | `devcontainer-feature.json:29` |
| `validate` runs port-availability check on portlessAlias ports | Yes | via `up.ts` runUp path; emits info + warn appropriately |
| `validate` prints info message pointing at follow-up RFP | Yes | `portless-alias-check.ts:101-104` |
| `worktree.sh dev` subcommand | Yes | deviation: pnpm-exec-vite wrapper instead of bare `pnpm dev` |
| `appPort: [3000]` removed | Yes | confirmed in `.devcontainer/devcontainer.json` |
| Portless feature in `features` | Yes | local path ref `./features/portless` (transitional) |
| Verification floor: >=2 concurrent dev servers | Yes | per validation devlog + portless list transcript |
| Multi-project verification (proposal Step 9) | NO | not run; Objective 3 empirically unverified |
| No system changes by lace (no sudo, no sysctl) | Yes | sub-check only probes; install.sh runs inside container |

## Verdict

**Accept** (with non-blocking follow-ups).

The implementation meets the proposal's stated scope, the verification floor is empirically met (validation devlog + persisted `.lace/` artefacts + portless-list transcript), and the deviations are well-justified and surfaced honestly. The D4 vite-config relaxation looks like a proposal-violation on its face but is the correct empirical response to D3 (the proposal's load-bearing portless-auto-inject claim being false); the change is small, defensive, and forward-compatible.

The proposal should be updated to `last_reviewed: status: accepted, by: @claude-opus-4-7, at: 2026-05-14T11:55:00-07:00, round: 7`.

## Action Items

1. **[non-blocking, proposal author]** Add a NOTE() callout near the proposal's line 57 (the falsified "portless auto-injects" claim) and line 84 (the "no vite config relaxation" prohibition) acknowledging D3/D4 empirically. Per writing-conventions/Commentary Decoupling, keep the proposal body intact and use a callout.
2. **[non-blocking, follow-up loop]** Run the proposal's Step 9 (second project with portless) to empirically verify Objective 3 (multi-project safe). This can be deferred to a separate dev session.
3. **[non-blocking, lace]** Add a unit test for the local-feature path rewriter in `generateExtendedConfig` (D1's edge cases: nested `..`, missing paths, absolute paths, registry refs). The current change is covered indirectly by integration scenarios; a targeted test would prevent regressions.
4. **[non-blocking, portless feature]** Reconcile the portless feature manifest's description text (still says "asymmetric mapping to 1355") with its install.sh's symmetric-binding behavior. The two are contradictory.
5. **[non-blocking, weftwise]** Consider replacing `basename "$PWD"` branch derivation in `cmd_dev` with `git branch --show-current` for robustness when run from a sub-package directory. The current `--filter weft` is also a weftwise-package-structure assumption that should be tracked.
6. **[non-blocking, lace]** The portless-alias-check sub-check's info pointer prints once per allocation; for a future feature with N portlessAlias-flagged ports this would N-print. Trivial to dedupe; not v1-blocking.

## Reviewer Questions

For the overseer / next-round triage:

1. **Proposal amendment timing.** Should the proposal be updated *now* with the D3/D4 NOTE callouts as part of accepting impl-1, or should that be queued as a separate authoring task? I lean toward "now" because the proposal-as-written falsely claims portless auto-injects, and any future reader would be misled. But the iterate-loop instructions only authorize editing the proposal's `last_reviewed` frontmatter.

2. **Step 9 multi-project verification.** Two paths:
   - (a) Defer: mark `implementation_accepted` after this loop and run Step 9 manually when another project (e.g., whelm) adopts portless naturally.
   - (b) Block: do not mark `implementation_accepted` until Step 9 is run.
   I lean toward (a) because the architecture is plausibly correct and the work-cost of standing up a second project's portless adoption just for verification is large. But if Objective 3 is genuinely load-bearing, (b) is justified.

3. **Backward-compat risk on D2.** Should the portless feature's install.sh expose a `tls` option (default false) so that the (currently dormant) HTTPS path can be re-enabled by future consumers without changing the install.sh again? Or is the assumption that the follow-up `rfp-portless-https-via-trust` RFP will redo this layer anyway, so no `tls` option is needed in v1?

4. **Vendored portless feature in weftwise.** The transitional local copy in `weftwise/.devcontainer/features/portless/` is a real maintenance burden until the feature is published to ghcr. Should a follow-up task be tracked to (a) publish the portless feature to ghcr.io/weftwiseink/devcontainer-features/portless:1, then (b) remove the weftwise local copy and switch back to the registry ref? Or is the local copy expected to live forever?
