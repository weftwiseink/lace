---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-14T10:30:00-07:00
task_list: weftwise/parallel-feature-development
type: review
state: live
status: done
tags: [rereview_agent, architecture, portless, scope_pivot, multi-project]
---

# Review: Weftwise Parallel Feature Development (Round 8, Post-Pivot)

## Summary Assessment

This round folds the host-portless lifecycle and `:1355` URL space into v1 scope, restoring the "single shared URL space" property that round 7 inadvertently broke.
The three documents (parent proposal, narrowed RFP, decisions report) are mutually coherent and the BLUFs line up cleanly; the two-layer portless architecture (host portless on `:1355` -> per-project container portless on `:1355`) is described and rationalised in the proposed-solution diagram.
There is one substantive coherence gap (the round-7 implementation-accepted decisions still get scoped to v1 in the report under D7/D8/D9, but the implementation surface they describe was the per-project-host-portless model; this matters for the "half-superseded prior work" question), one non-trivial implementation specification ambiguity (host-portless probe semantics when the port is held by an unrelated process vs by lace), and a small frontmatter wrinkle.
**Verdict: Accept with minor non-blocking follow-ups.** The design is implementable as written; the follow-ups are best handled at the start of the implementation devlog rather than via another revision cycle.

## Section-by-Section Findings

### Parent proposal: architectural coherence (two portless layers)

The Proposed Solution mermaid diagram (lines 89-110) accurately depicts both layers: browser -> host portless `:1355` -> lace-allocated host port -> container portless `:1355` -> vite.
The rationale for both layers is implicit but reconstructible: the host layer routes by `{project}` so all projects share `:1355`; the container layer routes by `{branch}` so all worktrees in a project share the container.

**Non-blocking:** The diagram and Overview say the host portless on `:1355` "demuxes by the `{project}` segment", but the dev script (Phase 1) actually requests an alias of `{branch}.{project}.localhost` from the container portless, and the host portless uses `--wildcard` (E4) to match `*.{project}.localhost` to a single project-named alias. The asymmetry is correct but lightly underspecified for an implementer: a one-sentence statement that "the host portless registers project-scoped wildcard aliases; the container portless registers full branch-qualified routes" would make the demux mechanism unambiguous. The information is present across E4 + 3e + Phase 1, but not in one place.

### Parent proposal: `--wildcard` empirical verification

`--wildcard` is load-bearing for the "single alias per project" property (E7). The proposal flags it for re-verification in two places (3e NOTE at line 358-360, E4 NOTE at lines 485-486). Both explicitly call out that the falsified-wildcard fallback is "per-route alias registration from the dev script, which is a worse but workable degraded mode."
**This is adequate.** The flag is named, the verification step is owned, and the degraded path is identified. **Non-blocking nit:** Phase 4 step 2 does not include a `portless alias --list`-style check that demonstrates a single wildcard alias is sufficient to route `main.weftwise.localhost`; adding such a check ("verify a single alias for `weftwise` routes both `main.weftwise.localhost` and `feature-x.weftwise.localhost`") would surface a falsified-wildcard regression during e2e validation instead of in production.

### Parent proposal: teardown / `lace doctor --reset` (3g)

The teardown surface is specified concretely enough: SIGTERM the PID in the runtime file, remove the file, no-op on missing/stale state.
**Non-blocking gap:** `--reset` deliberately does not unregister aliases on a still-living host portless before terminating it (the NOTE at lines 398-400 punts that to the stale-alias cleanup RFP). Acceptable. But the teardown semantics for "the container has shut down but the host portless is still alive and still has a stale alias" deserve one sentence in the proposal: as written, the alias persists across container restarts (which is the intent for reuse), and a removed project leaves a phantom alias until `--reset` nukes the whole daemon. That asymmetry is fine but should be documented in the proposal body, not just deferred-to-RFP, because a user is likely to encounter it during normal `lace down`/`lace up` cycling.

### Parent proposal: Phase 4 step 9 (whelm multi-project)

The step lists the success criteria: same PID, both projects' aliases listed, both URLs concurrently reachable, single shared `:1355`.
**Non-blocking:** Step 9 is gated on whelm having adopted portless and a dev-script convention; the parenthetical "Precondition" is noted but the proposal does not specify a fallback if whelm hasn't been migrated yet at implementation time. A two-project synthetic fixture (a second toy container declaring `portlessAlias: true` with a different `deriveProjectName()` result) would let Phase 4 step 9 run without coupling implementation timing to whelm's migration. Worth surfacing as an implementation choice; not a blocker.

### Parent proposal: host-portless probe semantics (3e)

Probe responsibilities (lines 353-357) say: "bound by lace-owned PID is 'running'; bound by an unrelated process is a warning surface for validate."
**Non-blocking ambiguity:** The `isPortAvailable` primitive at `port-allocator.ts:19-44` returns a boolean for socket-bind availability; it does NOT report the owning PID. The proposal asserts that the probe "correctly distinguishes" lace-owned vs unrelated via the persisted PID, but the actual primitive must combine `isPortAvailable` with a read of `~/.config/lace/portless-runtime.json` and a `kill -0 <pid>` (or equivalent) liveness check. The implementation logic for the three-state machine ({free, lace-owned-and-alive, foreign-and-bound}) is implicit; making it explicit in 3e would help the implementer avoid the obvious race (PID file references a dead process whose PID has been reassigned to an unrelated process). **Suggested:** add a one-paragraph state-table to 3e.

### Three-doc coherence

- Parent BLUF accurately describes `:1355` shared-port architecture.
- Truly-portless RFP correctly restricts its scope to port-80 binding only; the constraints/invariants section (lines 53-57) explicitly cedes the host-portless lifecycle, alias shellout, and packaging to the parent proposal.
- Decisions report's BLUF assigns D6, D10, D12 to the RFP and D1-D5, D7, D8, D9, D11 to v1.

**Coherence concern (non-blocking):** D8 and D9 in the decisions report describe their decisions as if they were already-decided heuristics for v1, but their content was the round-7-and-prior design for per-project host portless. The text still reads correctly under the new design (lace owns lifecycle, lace bundles via pnpm, no global install), because the per-project-vs-shared-host detail is downstream of D8/D9. However, **D7's last sentence** ("lace already knows the port and already runs on the host; the alias call is a natural extension of the `lace up` pipeline") elides that under the new design, the alias is registered against a **shared** host portless on `:1355` that may have been spawned by another project's `lace up` invocation. The decisions report does not surface this cross-project ownership wrinkle; the parent proposal handles it correctly in 3e (probe-and-reuse), but a reader of the decisions report standalone would miss that the host portless is a shared singleton, not per-project.

### Frontmatter

Parent proposal's frontmatter shows `status: review_ready` with no `last_reviewed` field. Per `.claude/rules/frontmatter-spec.md`, `last_reviewed` is optional and tracks review history; removing it on a re-submit-for-review is unusual but not invalid per the spec (the spec marks the field as optional and does not prescribe deletion semantics).
**Non-blocking:** The conventional approach is to retain the round-7 `last_reviewed` and let the round-8 reviewer overwrite it, so the historical trail isn't lost. Round 7's acceptance happened on a materially different design, so erasing the `last_reviewed` is defensible (it would otherwise be misleading to claim "round 7 accepted" when the accepted shape has been replaced). The review document at hand restores the trail by writing round 8. This is fine, but a NOTE callout on the proposal pointing at the round-7 review and explaining the deletion would close the loop for future readers; the existing "NOTE(opus/weftwise-parallel-dev): earlier round-7-accepted iteration scoped per-project host portless..." block (lines 18-21) already does most of this work. **Action: leave as-is; this reviewer will set `last_reviewed` to round 8 acceptance.**

### Half-superseded prior work

The user's review prompt flagged two specific artefacts:

1. **`packages/lace/src/lib/portless-alias-check.ts:101`** prints `URLs include the host port suffix in v1.` Under the new design, v1 URLs are `http://{branch}.{project}.localhost:1355/`, so the `:1355` IS a port suffix in v1. The info message is technically still true (the suffix is `:1355`) but misleading: the original intent of "host port suffix" referred to a *per-project* allocated port (e.g., `:22427`), which the new design eliminates. **Non-blocking:** The implementer should update the info message during 3c implementation to match the new info-string proposed at lines 309-311 of the proposal (`URLs at http://{branch}.<project>.localhost:1355/`). The proposal as-written already prescribes the corrected info message, so this is purely an implementation note.

2. **`cdocs/devlogs/2026-05-13-verify-weftwise-migration.md`** is a step-by-step verification devlog of the round-7 design (per-port-published renderer; observed `appPort: [3000]` problem). Under the new design, weftwise gains the portless feature in Phase 2 and the dev path looks materially different. The proposal does not call for the devlog to be re-framed as a "round-7 snapshot"; it cites the devlog only for empirical findings (bind-mount install ~2.5s, pnpm split-brain) which remain valid. **Non-blocking:** The devlog's framing should remain as-is (it accurately documents the round-7 state) but the proposal's References section (line 549) could add a one-clause clarifier - "(round-7 baseline; findings on install perf and pnpm split-brain remain valid)". Optional; not a blocker.

### Narrowed RFP (truly-portless-portless)

Standalone read: the RFP holds up. Goals are crisp (port-80 binding only), non-goals explicitly cede ground to the parent proposal, constraints reaffirm the rootless-podman + no-sudo-from-lace baseline. The "recommended starting point" section correctly carries forward D6/D10/D12 as already-decided unless the eventual author finds reason to revisit.
**Non-blocking:** The RFP's "Lifecycle observability" open question (line 79) asks how the bind port is surfaced. The parent proposal already records `port: 1355` in the runtime file (3e bullet 3). The RFP could either reference this explicitly or note that observability extends an already-present field. Minor.

## Verdict

**Accept.**

The proposal is implementable. The pivot is the right call: round-7 broke the single-shared-URL-space property, and folding the host-portless lifecycle into v1 (with `:1355` instead of `:80`) restores that property without taking on the sysctl/setcap surface. The two-layer portless architecture composes correctly. `--wildcard` is properly flagged for empirical re-verification with a documented fallback. The narrowed RFP is well-scoped.

All findings above are non-blocking implementation-time refinements. The proposal can transition to `implementation_ready` and proceed.

## Action Items

1. **[non-blocking, implementation note]** During 3c implementation, update `packages/lace/src/lib/portless-alias-check.ts:101` to the corrected info-string from proposal lines 309-311 (`URLs at http://{branch}.<project>.localhost:1355/`), replacing the round-7 "host port suffix" wording.
2. **[non-blocking, implementation note]** During 3e implementation, add explicit three-state probe logic (free / lace-owned-alive / foreign-bound) combining `isPortAvailable` with the runtime-file PID + a liveness check. Consider a state-table comment in `host-portless.ts`.
3. **[non-blocking, implementation note]** During Phase 4 step 2 execution, add a `portless alias` enumeration check that demonstrates a single project-scoped wildcard alias routes multiple branches. Catches `--wildcard` regression empirically.
4. **[non-blocking, doc nit]** Consider adding one sentence in the parent proposal's Overview clarifying the asymmetry: host portless registers wildcard project aliases; container portless registers branch-qualified routes.
5. **[non-blocking, doc nit]** Consider adding a sentence in the parent proposal's 3g / E7 area on the "phantom alias after `lace down`" semantics: aliases persist across container restarts (intended for reuse); `lace doctor --reset` is the only built-in way to clear them in v1; stale-alias-cleanup RFP handles the more surgical case.
6. **[non-blocking, doc nit]** Consider a one-clause clarifier on the References entry for `verify-weftwise-migration.md` in the parent proposal indicating it documents the round-7 baseline (findings remain valid).
7. **[non-blocking, RFP polish]** In the truly-portless-portless RFP's "Lifecycle observability" open question, reference the parent proposal's existing `port` field in the runtime-state file as the natural extension point.
8. **[non-blocking, decisions report]** Consider clarifying D7 in the decisions report to surface that the host portless is a cross-project singleton (the v1 invariant), not a per-project process; the standalone-read of D7 could mislead a future reader who hasn't read the parent proposal.

## Clarification Questions

The proposal does not need clarification to proceed, but two judgement-calls during implementation are worth surfacing to the user:

- **Phase 4 step 9 fallback.** If whelm has not adopted portless when v1 implementation reaches Phase 4, should the implementer (a) wait for whelm migration, (b) build a synthetic second-project fixture for the multi-project test, or (c) skip step 9 with a deferred-verification NOTE in the validation devlog?
- **`lace doctor --reset` vs `lace doctor --uninstall` naming.** The proposal uses `--reset` for runtime-state teardown; the follow-up RFP reserves `--uninstall` for durable-host-state reversal (sysctl). Confirm these are the intended distinct surfaces, vs. unifying under one flag with mode flags.
