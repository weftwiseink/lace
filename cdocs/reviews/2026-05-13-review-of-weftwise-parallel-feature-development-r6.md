---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T22:15:00-07:00
task_list: weftwise/parallel-feature-development/review
type: review
state: live
status: done
tags: [rereview_agent, round-6, scope-reduction, portless, validate, portlessAlias, architecture, multi-rfp-split]
---

# Review of "Streamlined Parallel Feature Development for Weftwise" (Round 6)

> BLUF(opus/weftwise-parallel-dev/review): Round 6 is a clean scope-amputation of the round-5 design.
> The v1 surface is now exactly: weftwise dev script, container portless adoption, `portlessAlias?: boolean` metadata (interface + extractor), and a `validate` sub-check that runs the existing `isPortAvailable` primitive and prints an informational pointer.
> All host-side machinery (host portless lifecycle, sysctl, `lace doctor`, alias shellout, clean URLs) has been correctly excised into `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md`.
> One blocking inconsistency remains: the decisions report still names the metadata field `hostAlias` in D8 and D11 body text and describes a `boolean | string` schema for D11 that contradicts the v1 boolean-only choice.
> Verdict: **Revise** (one cross-doc fix; v1 proposal body itself is accept-ready).

## Summary Assessment

The author has executed the round-5 user asks with high fidelity.
The proposal body is tight, internally consistent, and forward-compatible.
The split into a follow-up RFP is well-scoped: the new RFP at `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md` correctly inherits D6/D8/D9/D10/D12 plus the not-yet-decided string-mode of D11, and references the v1 proposal as its starting predicate.

The single blocker is not in the v1 proposal itself: it is in the decisions report's body content for D8 and D11, which still references the now-defunct `hostAlias` name and the `boolean | string` schema.
This is load-bearing because both v1 and the follow-up RFP reference the decisions report as their supplemental design rationale; a reader cross-checking D11 against the v1 proposal hits a direct contradiction ("D11 says boolean | string; the v1 proposal says boolean only").

If the user is comfortable accepting the v1 proposal independent of the decisions-report cleanup, that cleanup can land as a follow-on triage pass and round 6 can flip to accept.
I'm calling it a blocker because the user explicitly listed decisions-report annotation as verification item #7.

## Verification of Round-5 User Asks

| # | User ask | Status | Evidence |
|---|---|---|---|
| 1 | Augment `validate`, not add `doctor`; auto-driven by `portlessAlias` presence | **Resolved** | Proposal Phase 3c (lines 289-323). "The check is automatic — driven by `portlessAlias` presence in the config, not by a flag the user passes" (line 305). Non-goal explicitly states "No new lace subcommand (`doctor` / `setup` etc.)" (line 82). |
| 2 | Lace must NOT auto-apply sysctl or sudo; print to stdout, user applies | **Resolved** | Lines 307 + 309-310 explicit NOTE: "any required system change is printed to stdout for the user to evaluate and apply, not auto-applied." Phase 4 success criterion line 355: "No system changes by lace (no sudo, no sysctl, no systemd, no /etc/ writes)." |
| 3 | Genericize the port-availability check; sysctl is one remediation example only | **Resolved** | "Generic-not-sysctl-coupled framing" subsection at line 307: "The host-port-availability check is the foundational primitive… The follow-up RFP reuses the same primitive against port 80… sysctl is one example; setcap is another; rootful podman is another." |
| 4 | Drop `hostAlias` string mode; boolean only | **Resolved** in proposal | Interface widening at line 240: `portlessAlias?: boolean`. Extractor branch at line 254 uses `typeof entry.portlessAlias === "boolean"`. Non-goal explicit on line 83. **Not resolved** in decisions report D11 (see Section-by-Section: Cross-document Consistency). |
| 5 | Rename `hostAlias` → `portlessAlias` (coupling acknowledged) | **Resolved** in proposal | Zero occurrences of `hostAlias` in the v1 proposal. Open Question at line 413-414 explicitly justifies the name choice. **Not resolved** in decisions report D8/D11 (still uses `hostAlias`). |
| 6 | Defer port-80 binding entirely; v1 ships at lace-allocated port (22425-22499) | **Resolved** | URL pattern declared on line 31. Non-goal "No port-80 binding (deferred)" on line 78. Phase 4 step 9 multi-project demonstration uses two distinct allocated host ports. |
| 7 | Split sysctl/port-80/clean-URLs into a new RFP | **Resolved** | `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md` exists, has correct frontmatter (`status: request_for_proposal`), correctly references v1 proposal, fresh-eyes report, and decisions report. Open Questions section pre-loads the author with D6/D8/D9/D10/D11/D12 framing. |

## Verification Against Reviewer Checklist (the 10 items)

### 1. v1 scope is correct (dev script + container portless + `portlessAlias` metadata + `validate` extension)

**Pass.** Non-goal list at lines 75-86 enumerates eleven things explicitly out of scope.
The "what is being built" Phase list (1-4) matches the user's stated v1 surface exactly.

### 2. Phase 3's `validate` reuses `isPortAvailable` at port-allocator.ts:19-44

**Pass.** Line 295 names the function and the file:line range.
Verified in source: `packages/lace/src/lib/port-allocator.ts:19` declares `export function isPortAvailable(port: number, timeout = 100): Promise<boolean>`; the function body ends at line 44.
The "Generic-not-sysctl-coupled framing" paragraph at line 307 reinforces the decoupling.

### 3. Schema widening (interface 47-57) AND extractor widening (660-673) both present

**Pass.** Phase 3a Step 1 (lines 233-242) and Step 2 (lines 244-256) cover both edits.
Verified in source: interface at line 47, extractor `validatedPorts[key] = { … }` at line 662.
Line 258 explicitly calls out the trap: "Without Step 2, the `portlessAlias: true` from the feature manifest is silently dropped before the `validate` extension sees it."
The round-4 blocking issue is comprehensively addressed.

### 4. `portlessAlias` is boolean only

**Pass.** Interface declaration line 240: `portlessAlias?: boolean`.
Extractor branch line 254: `typeof entry.portlessAlias === "boolean"`.
Non-goal line 83: "No string mode for `portlessAlias` (boolean only; future RFP may extend)."
Open Question Q3 at line 416-417 anticipates the follow-up RFP path without committing.

### 5. URL pattern is `http://{branch}.{project}.localhost:<host-port>/`

**Pass.** Declared on line 31 in the Overview section.
Repeated in BLUF (line 19), Phase 1 (line 170-171), Phase 4 step 3 (line 341), and E7 multi-project edge case (line 406).
Line 32 explicitly states forward compatibility: "dropping the `<host-port>` suffix is purely a host-side routing change."

### 6. Follow-up RFP exists, correctly scoped, references v1 + supplementals

**Pass.** `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md` opens with a three-sentence BLUF and references all three required predecessor documents (v1 proposal, fresh-eyes report, decisions report).
Recommended-starting-point section pre-decides D6/D8/D9/D10/D11/D12.
Open Questions section explicitly preserves the user-applied (not auto-applied) sysctl posture.

### 7. Decisions report annotated for v1 vs follow-up scoping

**Partial pass.**
BLUF at lines 14-17 of the decisions report correctly assigns D1-D5, D7, D11 to v1 and D6, D8, D9, D10, D12 to the follow-up.
**However:** the body content of D8 (line 80) still says "container declares a `hostAlias: true` port" and the body of D11 (lines 115-129) describes `hostAlias: boolean | string` with a `"<custom-name>"` string escape hatch.

This is the round-6 blocker.
D11 in particular is *in scope for v1* per the BLUF, but its body describes a schema the v1 proposal explicitly rejects (string mode dropped).
A v1 implementer cross-checking D11 against the proposal will see a direct contradiction.

The minimal fix is two edits:
- D8 line 80: `hostAlias: true` → `portlessAlias: true`.
- D11 (entire section): rename `hostAlias` → `portlessAlias` throughout; replace the "true / `<custom-name>` / false" enumeration with the boolean-only v1 surface, with a NOTE that the follow-up RFP may extend to a string override.

The D11 D11-title line 115 also reads `## D11: \`hostAlias\` is generic feature-port metadata, not portless-specific` — given the rename `portlessAlias` and the explicit portless-coupling now acknowledged in the v1 proposal's Open Question at line 414, this section heading is also stale.
Rephrase along the lines of "`portlessAlias` is generic-shaped metadata; name explicitly couples to the portless feature."

### 8. Superseded host-proxy proposal points at new RFP

**Pass.** Line 24 NOTE points at `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md`.
The `related_to` frontmatter still lists the v1 proposal at line 19 (which is correct — it remains related, just not the superseding doc).

### 9. No orphan references to deferred mechanisms

**Pass.** Grep across the v1 proposal for `setcap`, `sysctl`, `host portless`, `alias shellout`, `doctor`, `--wildcard`, `PORTLESS_WILDCARD` finds every occurrence either in explicit "deferred / out of scope" framing or in pointer references to the follow-up RFP.
No mechanism is silently retained.

### 10. BLUF concise (3 sentences); writing conventions hold

**Pass.** BLUF is three sentences (lines 19, 20, 21), each on its own line.
Sentence-per-line formatting holds throughout.
No em-dashes used as primary separator (the document uses ` — ` em-dashes in one location at line 110 and 305; the writing convention discourages but does not forbid them, and the usage here is for parenthetical insertion which falls within the "sparingly" allowance — non-blocking).
History-agnostic framing holds: the one historical reference (line 309 NOTE about auto-apply sysctl explored in earlier drafts) is correctly placed in a NOTE callout.
No emojis.

## v1 User Flow Conceptual Check

Walking through the user's specified end-to-end flow against the proposal:

1. **Dev script runs `portless main.weftwise.localhost pnpm dev` inside the container.**
   Phase 1 `cmd_dev` at line 169-172: `local route="${branch}.weftwise.localhost"`, then `exec portless "${route}" pnpm dev`. Pass.

2. **Container portless on :1355 registers route `main.weftwise.localhost` → vite ephemeral port.**
   Background fact at line 54: container portless is on :1355.
   Background fact at line 57: portless auto-injects CLI flags for vite/astro/angular, so vite's `:3000` hard-code is overridden to an ephemeral port at runtime.
   The Mermaid diagram (lines 89-102) shows `C_P[portless on :1355]` routing to `V_M[vite :4000 main]` and `V_F[vite :4001 feature-x]`.
   Pass.

3. **Lace-allocated host port (e.g., 22435) maps to container :1355.**
   Background fact at line 56: symmetric port injection via `injectForBlock` (`template-resolver.ts:181-223`) maps the container port to the allocated host port via `appPort`.
   Phase 2 acceptance criterion (line 222): `podman port weftwise` shows `<22425-22499>:1355`.
   Pass.

4. **Browser visits `http://main.weftwise.localhost:22435/`; container portless demuxes by Host header.**
   E1 edge case (lines 380-382) and E4 (lines 392-394) acknowledge intra-container hostname demuxing.
   Phase 4 step 3 (line 341) is the assertion.
   Pass.

5. **Multi-project: each project's container gets a different lace-allocated host port; URLs distinguishable by port.**
   E7 (lines 404-406): explicit case with two example URLs at distinct ports.
   Phase 4 step 9 (line 347): "Second project gets its own lace-allocated host port; `http://main.whelm.localhost:<other-host-port>/` reachable; weftwise URLs unaffected."
   Pass.

The flow is sound. The architecture is honest about its v1 limitation (port-suffix URLs) and the follow-up RFP completes the elegance.

## Section-by-Section Findings

### BLUF and Frontmatter

- **Non-blocking:** BLUF is 3 sentences, scannable, and accurately previews the entire v1 surface. The third sentence cleanly redirects scope ambiguity to the follow-up RFP.
- **Non-blocking:** Frontmatter's `last_reviewed.round: 5` reflects pre-r6 state. This review bumps it to 6.

### Overview / Objective

- **Non-blocking:** Three-piece breakdown at lines 27-29 maps cleanly to Phases 1, 2, 3. Phase 4 (e2e validation) is appropriately framed as orthogonal.
- **Non-blocking:** Objective bullet 4 ("Zero durable host state") is the right framing for the user's "no auto-sudo" requirement.

### Background

- **Non-blocking:** The companion-documents list at lines 47-50 is the right shape: it pre-loads the reader with the v1 / follow-up scope split.
- **Non-blocking:** Load-bearing facts (lines 52-59) are five tight statements; each is a specific source-file or behavior claim.
- **Non-blocking:** "Existing primitives this proposal reuses" table at lines 65-72 includes the eight reused primitives. Source links cite specific line ranges. The two `feature-metadata.ts` rows correctly disambiguate the interface widening (47-57) from the extractor widening (641-689) — directly addresses the round-4 blocker.
- **Non-blocking:** "What is explicitly NOT being built in v1" list (lines 74-85) is thorough. Includes the post-round-5 additions (no `doctor` subcommand, no string mode for `portlessAlias`).

### Proposed Solution

- **Non-blocking:** Mermaid diagram (lines 89-102) is correctly scoped to the v1 architecture: host browser → container portless → in-container vite. No host-side host-portless box, no alias shellout. The simplification from r5 is significant and welcome.
- **Non-blocking:** Three-piece narrative (lines 104-110) restates the implementation phases without redundancy.
- **Non-blocking:** `portlessAlias` v1 semantics subsection (lines 112-123) clearly states the flag is a marker with NO `lace up` runtime effect in v1.

### Phase 1: Weftwise dev script

- **Non-blocking:** Concrete `cmd_dev()` shell function at lines 147-174 is implementation-ready. Four error paths covered (no `package.json`, missing `node_modules`, no `portless` on PATH, plus implicit fall-through).
- **Non-blocking:** Tests list at lines 189-194 covers all four error paths.
- **Non-blocking:** Acceptance criterion (line 196) is testable.

### Phase 2: Adopt portless in weftwise container

- **Non-blocking:** Two-line `devcontainer.json` diff at lines 204-211 is minimal and correct (the `-3000` line removal correctly drops the no-longer-needed `appPort`).
- **Non-blocking:** Path-reference fallback for local development at line 213 is a useful pre-publish note.
- **Non-blocking:** Tests list (lines 217-220) includes the cross-phase reference to Phase 3's validate output, demonstrating coherence across phases.

### Phase 3a: Schema widening

- **Non-blocking:** Step 1 / Step 2 narrative structure preserved from r5. Line 258 explicitly calls out the trap.
- **Non-blocking:** Test list (lines 262-263) names both the interface widening test and the extractor round-trip test.

### Phase 3b: Portless feature manifest

- **Non-blocking:** One-line diff at lines 272-285 is the minimal feature-manifest change.
- **Non-blocking:** Line 287 acknowledges the field is "forward-looking" with v1 consumers limited to the `validate` extension — sets clear expectations for downstream readers.

### Phase 3c: validate command extension

- **Non-blocking:** The two-step behaviour (generic port-availability check + informational message) at lines 293-303 is well-factored.
- **Non-blocking:** "Generic-not-sysctl-coupled framing" paragraph at line 307 directly answers user ask #3.
- **Non-blocking:** Inline NOTE callout at lines 309-310 makes the "lace prints, user applies" stance explicit. Re-reinforces that earlier-draft auto-sysctl is OUT.
- **Non-blocking:** Tests list (lines 314-317) covers four cases (with the flag, without, with port collision, integration).
- **Non-blocking:** Acceptance criteria (lines 319-323) include the negative case ("`lace validate` for a project without portless is unaffected") which is the right shape for an opt-in feature.

### Phase 4: End-to-end validation

- **Non-blocking:** Setup section (lines 329-332) prescribes a clean-state run (`rm -rf .lace/`), removing variance from previous allocations.
- **Non-blocking:** Nine-step matrix at lines 337-347 covers all five user-flow steps plus install timing, fresh worktree, and multi-project concurrency.
- **Non-blocking:** Step 6 retained from r5: pnpm/corepack split-brain verification tied to verification devlog Finding 4.
- **Non-blocking:** Success criteria (lines 351-355) are testable, and bullet 5 explicitly forbids any system change by lace — the proposal's audit hook.

### Test Plan (consolidated)

- **Non-blocking:** Four test surfaces (unit, integration, e2e, weftwise smoke) cover the full surface. Names match Phase 3's described tests.

### Edge Cases

- **Non-blocking:** Seven edge cases (E1-E7). E2 (rebuild required for `appPort` changes) is a real footgun worth surfacing. E5 (pnpm split-brain) tied to verification devlog. E7 (multi-project) is the load-bearing demo for v1's distinguishability via port suffix.

### Open Questions

- **Non-blocking:** Q1-Q4 each name the question, the answer/posture, and the rationale. Q3 ("What happens after the follow-up RFP lands?") provides the forward-compatibility story.
- **Non-blocking:** No open question is left unanswered; they are all reflection prompts rather than blockers.

### Summary / References

- **Non-blocking:** Summary at lines 422-443 is concise and the "Zero durable host state, zero sudo prompts, zero new lace subcommands" line is the right closing audit hook.
- **Non-blocking:** References organize by source type (supporting documents, follow-up RFPs, lace source, feature source, weftwise host artefacts, superseded).

### Cross-Document Consistency

- **Blocking:** Decisions report at `cdocs/reports/2026-05-13-weftwise-parallel-dev-decisions.md` uses `hostAlias` in D8 line 80 and throughout D11 (lines 115-129). D11 is in v1 scope per the report's BLUF, but its body schema (`boolean | string` with `"<custom-name>"` escape hatch) contradicts the v1 proposal's boolean-only design (proposal line 240, line 83).

- **Non-blocking:** D11 section heading at decisions-report line 115 reads "`hostAlias` is generic feature-port metadata, not portless-specific" — the heading framing now conflicts with the v1 proposal's Open Question Q2 (line 414) which explicitly accepts the portless coupling. The heading should be rephrased to match the v1 stance.

- **Non-blocking:** The truly-portless RFP correctly uses `portlessAlias` throughout (lines 48, 62, 78). It references D11 with the post-r6 framing ("`portlessAlias` is a generic feature-port metadata field with boolean semantics in v1; consider whether to extend to a string override"). Cross-doc consistent.

### Writing Conventions

- Sentence-per-line: holds throughout.
- BLUF: three lines, three sentences.
- Brevity: each subsection is focused.
- History-agnostic: only one historical reference (line 309 NOTE), correctly placed in a callout.
- Em-dashes: a few uses (lines 47, 48, 110, 246, 305, 307). The convention discourages but allows sparingly; current usage is non-blocking.
- Emojis: none.
- Callouts: NOTE callout at line 309 uses correct `NOTE(author/workstream)` syntax.

## Verdict

**Revise.**

The v1 proposal body is implementation-ready and reflects the user's round-5 asks accurately and tightly.
The single blocking issue is in a *referenced* supplementary document (the decisions report), not in the proposal itself: D8 and D11 still use the pre-rename `hostAlias` name, and D11's body schema contradicts the v1 proposal's boolean-only design.

If the user is comfortable accepting the v1 proposal and treating the decisions-report cleanup as a fast follow-on triage (rather than a re-review cycle), this verdict can flip to Accept and the proposal `status` can advance to `implementation_ready` in the same pass.

## Action Items

1. **[blocking]** Update `cdocs/reports/2026-05-13-weftwise-parallel-dev-decisions.md` D8 line 80: rename `hostAlias: true` → `portlessAlias: true`.

2. **[blocking]** Update D11 (decisions report lines 115-129): rename all `hostAlias` references to `portlessAlias`; revise the schema description to match the v1 boolean-only design (drop the `"<custom-name>"` string escape hatch from the v1 description, with a NOTE that the follow-up RFP may extend to a string override). Rephrase the section heading to reflect the post-rename portless coupling acknowledged in the v1 proposal's Open Question Q2.

3. **[non-blocking]** Consider whether the v1 proposal's References "Superseded" subsection at line 478 should clarify what the superseded doc points at *now*. Current text says `state: archived, status: evolved, now pointing at the follow-up RFP (not this v1)`, which is correct but could read more cleanly as a single sentence.

4. **[non-blocking]** The v1 proposal's Phase 3c acceptance criterion (line 319) says "`lace validate` for a project with portless in `features` prints the informational message and the port-availability result." Consider whether the port-availability result should be deduplicated when it's silent (the pass case), or whether the proposal should be explicit that the silent-pass case prints nothing about port availability. Minor UX clarity.

5. **[non-blocking]** Two em-dashes ` — ` are used as parenthetical separators (lines 110, 305) where the writing convention prefers colons. Non-blocking, easily fixed at nit-fix time.

## Questions for the Author (multi-choice, non-blocking)

**Q1: Decisions-report fix cadence.**

The single blocker is in the decisions report, not the proposal itself. Pick one:

- (a) Land the decisions-report fix immediately (D8 line 80 + D11 rename); flip this review to Accept post-fix.
- (b) Accept the v1 proposal as-is and track the decisions-report cleanup as a separate triage task (status: `implementation_ready` advances now; cleanup lands in parallel).
- (c) Wait for r7 after a combined fix.

Recommendation: (a). The decisions report is small and the rename is mechanical.

**Q2: Phase 3c silent-pass behaviour.**

The validate sub-check prints two things: a port-availability result and an informational pointer. In the silent-pass case (port free, container is the only consumer), is the expected output:

- (a) Print only the informational pointer; suppress the port-availability line entirely.
- (b) Print both lines, with the port-availability line showing a brief "OK" status.
- (c) Defer to implementation taste.

Recommendation: (a). The pointer is the load-bearing info; the port-availability check is a guardrail and should be silent unless something is wrong.

**Q3: D11 schema in the decisions report.**

When updating D11 to match the v1 boolean-only design:

- (a) Drop the string-mode discussion entirely and add a one-sentence NOTE pointing at the follow-up RFP as the place where string-mode extension is considered.
- (b) Keep a brief "future extension" paragraph in D11 describing the string-mode option, framed as "considered for v1 but deferred to the follow-up."
- (c) Move the string-mode discussion to the follow-up RFP itself (delete from D11; the follow-up RFP's Open Questions already references it via D11).

Recommendation: (a) or (c). Either keeps D11's v1 scope clean.
