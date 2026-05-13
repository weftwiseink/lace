---
review_of: cdocs/reports/2026-05-05-prebuild-cache-system-options.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T10:00:00-07:00
task_list: lace/prebuild-cache-rethink
type: review
state: live
status: wip
tags: [self, fresh_agent, rereview_agent, prebuild, caching, architecture, design_exploration]
---

# Review (Round 2): Prebuild Cache System: Options for a Rethink

## Summary Assessment

The revision honestly absorbs the round-1 review and the author's multi-choice answers.
Five of seven blocking items are clearly resolved; the other two are resolved by author guidance making them non-applicable, with explicit NOTE callouts documenting that boundary.
The committed recommendation (Lens 3 / P5, with P4 fallback) is the correct response to the author's "best design by default" answer, but the report partially over-promises on P5: the load-bearing axis (first-start latency) is named as a measurement task without committing to *who measures, against what budget, and what triggers the P4 fallback*.
The new sections (Failure-mode UX, Forced-Pair Couplings, Bundle visibility summary) are load-bearing rather than filler.

Verdict: **Revise (light)**, narrow scope.
The remaining gaps are tightening of the recommendation's escape clause, not structural rework.
Most of round-2's findings are non-blocking polish; only one (the un-quantified P5 fallback trigger) is blocking, and even that is a 1-3 sentence fix.

## Round-1 Action Item Audit

Each item from the round-1 review, with status and evidence:

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Add Axis F (distribution scope) | **Resolved by guidance** | NOTE callout under "Author Guidance Applied" cites (1)(a) as ruling out team/community scope; axis F documented as collapsed to host-local. |
| 2 | Add B5 (registry sidecar) | **Resolved by guidance** | Same NOTE callout cites (2)(a) (stay inside OCI/devcontainer); explicitly out of scope. |
| 3 | Add C5 (Nix-style content store) | **Resolved by guidance** | Same NOTE callout; (2)(a). |
| 4 | Add bundle P7 (registry-backed) | **Resolved by guidance** | Same NOTE callout; downstream of (1)(a). |
| 5 | Sharpen P1 vs. P6 distinction | **Resolved** | P6 now reads "**No `lace.local/*` namespace.** No `lace prebuild` step." with explicit "structurally distinct from P1" sentence. |
| 6 | Cleanup ownership as a table | **Resolved** | New "Bundle visibility summary" table after the bundles, with `podman images` shows / cleanup obligation columns. |
| 7 | Failure-mode UX subsection | **Resolved** | New subsection under Cross-Cutting Considerations with per-bundle failure modes; useful framing of "cheapest to ship correctly" vs. "most architecturally clean." |
| 8 | C6 (distrobox) NOTE-style mention | **Resolved by guidance** | Out-of-scope NOTE callout; (2)(a). |
| 9 | A6 (image digest references) | **Resolved** | New A6 option, properly differentiated from A5. |
| 10 | D3 alternative slicings | **Resolved** | Bullet list under D3 covering by stability / trust boundary / cost asymmetry / failure mode. |
| 11 | Bundle visibility table | **Resolved** | Folded into action item 6's table. |
| 12 | Forced-pair couplings paragraph | **Resolved** | New "Forced-Pair Couplings Between Axes" section with five concrete couplings. |
| 13 | Drop or own Recommendation Posture | **Resolved** | "Deliberately does not pick" hedging removed; section now commits to P5 primary, P4 fallback, P0 short-term mitigation. |
| 14 | Tighten generic pros/cons | **Partial / not done** | C1 pro is still "simple to think about"; A3 con still "more tags accumulate" (though now annotated with the (3)(a) consequence). Reasserted below. |
| 15 | Soften D3 "matches reality" | **Resolved** | Now reads "matches the project's existing direction with `lace-fundamentals-init`." |
| 16 | Reference smart-cache-busting RFP | **Resolved** | A3 con cites `[`2026-01-31-smart-prebuild-cache-busting RFP`]`. |
| 17 | Open questions on team-vs-solo and prebuild/up phase | **Resolved (partial)** | New Q4 (phase relationship between prebuild and up). Team-vs-solo collapsed to author-guidance answer rather than reopened, which is the right call. |
| 18 | Anchor or remove "100-500 ms" estimate | **Resolved** | E3 con now reads "200-500 ms cold, 50-150 ms warm; the proposer should measure." Acceptable anchoring with explicit measurement-required caveat. |
| 19 | NOTE on contributing upstream to devcontainer CLI | **Resolved** | New NOTE callout under Lens 3 naming this as a fourth path. |
| 20 | Tighten BLUF parenthetical | **Resolved** | BLUF rewritten to own the recommendation up front per round-2 prompt. |

Counts: 16 of 20 items fully resolved; 4 of 20 resolved by author guidance (correctly out of scope); 1 of 20 partial (item 14, generic pros/cons pass).
No item is unaddressed in a way that should block acceptance.

## Section-by-Section Findings (Round 2 Focus)

### BLUF and Author Guidance Applied

**Strength.** The BLUF now owns the recommendation: "the recommendation, given..., is **Lens 3 / Bundle P5**." That is exactly the change the round-1 reviewer asked for in item 20.
The "Author Guidance Applied" subsection is a good belt-and-suspenders move: it lets a future reader trace which decisions were author-input vs. report-derived.

**Non-blocking finding.** The BLUF covers P5/P4/P0 but omits P6, which is then introduced later as "everything else turned out wrong." That asymmetry is small but the reader gets one mental model from the BLUF and a slightly different one from the Recommendation Posture. Either drop P6 from the lenses or add a half-sentence in the BLUF.

### Recommendation Posture (the load-bearing change)

**Strength.** The "deliberately does not pick" hedging is gone. The section now commits in the order P5 primary, P4 fallback, P0 mitigation.
This is honest given (4)(c) and addresses round-1 item 13 cleanly.

**Blocking finding.** The P4 fallback trigger is under-specified.
The current language is:
> P4 (layer-decomposed sharing via per-feature OCI layers) is the credible fallback if first-start latency under P5 turns out to exceed user tolerance.

This is missing three things the proposer needs to act on:
1. **What latency budget counts as "exceeds user tolerance"?** 5 seconds? 30 seconds? 2 minutes? Without a number, the fallback is unfalsifiable and P4 becomes a permanent escape hatch the proposer can invoke at will.
2. **Who measures and on what?** The report notes the proposer should measure but doesn't say *what stage* the measurement happens at. Is it during P5 design (fail fast)? During P5 implementation (sunk cost when P4 takes over)? Or after a P5 prototype is shipped behind a flag?
3. **What's the cost of switching?** P4 requires a custom layer composer or upstream devcontainer-CLI work; that investment is unrecoverable if it's started after P5 fails. The relationship between "measure first-start latency" and "begin P4 work" needs to be specified, because doing them sequentially means a slow project, while doing them in parallel hedges the bet but doubles the design-stage cost.

A 2-3 sentence addition under the Recommendation Posture along the lines of:
> The proposer should measure first-start latency on representative hardware before committing build effort to either bundle. A budget of N seconds is the working threshold; above this, P4 becomes primary. P5 design and a P4 feasibility sketch should happen concurrently to avoid sequential lock-in.

would close this. The number `N` can be left to the proposer; what matters is that *some* number is required to trigger the fallback.

**Non-blocking finding.** The "P4 (layer-decomposed sharing) is the credible fallback" framing under-states P4's cost. P4 requires a custom layer composer (axis C2) which is described elsewhere in the report as "the largest investment" and "requires lace to drive layer composition (buildah, custom builder, or unusual `devcontainer build` invocations)." The round-2 prompt specifically asks whether P4's "credible fallback" framing is realistic given that cost.

The honest framing is: **P4 is credible-as-a-target, not credible-as-a-quick-pivot.** If P5 fails on latency after a flagged prototype ships, switching to P4 is a months-of-work redirect, not a "we already did the work" pivot.
The report should say so explicitly. Something like:
> P4 is a credible *target*, not a cheap fallback: choosing it means committing to a custom layer pipeline. The "fallback" framing is accurate only in the sense that P4 does not depend on first-start latency.

This is non-blocking because the cost is documented elsewhere in the report (Axis C2, Open Questions Q3, Devcontainer CLI Coupling). A reader who reads the report linearly will encounter the cost. But the Recommendation Posture is the section a busy reader will jump to, and the cost is missing there.

### Lens Framing

**Strength.** The lens labels now read "**not recommended**" / "**recommended**" with rationale. This addresses round-1 item 13 well.
Lens 3's three-tier internal structure (P5 primary, P4 fallback, P6 minimal) is the right shape.

**Non-blocking finding.** Lens 1 is dismissed in one sentence: "the user's stated cadence preference rules this out as the primary direction." That's correct *as a recommendation* but loses information that the proposer might want.

Specifically: Lens 1 is the right answer in two scenarios the report doesn't surface:
- The bug recurs in the wild while P5 design is in progress. Then P0 *is* the primary direction for the live patch.
- P5 turns out to be infeasible *and* P4's cost is unjustifiable. Then Lens 1 is the honest fallback.

The first is already implicit in the Recommendation Posture's last paragraph ("P0 stays useful as a short-term mitigation"). The second is missing.
A half-sentence adding the second contingency would make the lens framing more defensible.

**Non-blocking finding.** The new NOTE callout on contributing per-feature-layer support upstream to the devcontainer CLI is good. It correctly addresses round-1 item 19. One small improvement: the callout could note the *cost trade* explicitly. Upstream contribution moves on devcontainer-CLI's release cadence, not lace's; that's fine for a long-tail option but the proposer should know it's not a 2-week move.

### Forced-Pair Couplings

**Strength.** The new section is load-bearing, not filler. The five couplings are concrete and each is something a proposer would benefit from internalising:
- C2 -> B2 or registry-like B (correct).
- D2 + C4 ~= no prebuild at all (correct, and useful framing).
- E4 requires A2 or A3 (correct).
- A6 ~= A5 with different ergonomics (correct and was missing before).
- B4 most useful with D2/D3 (correct).

**Non-blocking finding.** One coupling not listed but worth considering: **A3 (content-hashed) + E1 (current validation) is sufficient** — the content hash *is* the validation, since two different feature sets produce different tags. This is implicitly assumed in Bundle P2's E2 choice (which is conservative), but it could be a deliberate design decision rather than an inherited one.

### Bundle Visibility Summary

**Strength.** This is the single most useful addition. The `podman images` column is exactly what the round-1 reviewer asked for in item 11. The "new cleanup obligation" column makes the (3)(a) author-guidance consequence visible per-bundle.

**Non-blocking finding.** The table omits the `~/.cache/lace/` artefact for P0/P1/P2. Those bundles still write `.lace/prebuild/` directories per project (the build context cache). The cleanup column reads "None beyond current `podman image prune`" but the user actually does have a per-project `.lace/prebuild/` accumulation to clean. Minor but the table claims completeness.

**Non-blocking finding.** P3's row says "lace materialises on demand from `~/.cache/lace/oci/`." The runtime image store would still hold a materialised image after first use; that's user-visible in `podman images`. The row implies P3 is invisible in `podman images` which isn't quite right — it's invisible *until lace materialises*, then it's a normal runtime image. A small clarification.

### Failure-mode UX

**Strength.** This addresses round-1 item 7 and the framing is honest:
> The bundle that is *cheapest to ship correctly* is often the one whose failure modes are the most familiar.
> The bundle that is *most architecturally clean* may carry the steepest failure-UX investment.

That trade-off statement is the kind of operationally useful honesty that the rest of the report should aspire to.

**Non-blocking finding.** The P5 row mentions:
> Requires investing in the existing exit-127 surfacing problem regardless.

This is the right call (the postCreateCommand error UX is broken today and P5 makes it worse by routing more failures through it).
But the section doesn't follow through with what that investment looks like. A pointer to either an existing exit-127 issue/devlog or a brief description of what good would look like would close the loop.
At minimum, a NOTE callout: "The exit-127 / postCreateCommand error surface is a prerequisite for P5 viability, not an optional polish."

### A6 (Image digest references)

**Strength.** The new A6 option correctly distinguishes itself from A5 ("digest visible in source control" vs. "identity hidden entirely").
The cons are concrete (digests must rotate, opaque in `podman images`).

**Non-blocking finding.** A6's interaction with the prebuild rebuild cycle deserves a sentence. If the user's `Dockerfile` has `FROM node@sha256:abc...` and the prebuild rebuilds, the `Dockerfile` must be rewritten with the new digest. That is the same write-back loop A1 has today, just with a different tag space. Calling that out would prevent the proposer from misreading A6 as "no rewrite."

### D3 Alternative Slicings

**Strength.** The four alternative slicings (stability / trust / cost / failure mode) are exactly what round-1 item 10 asked for. The "by failure mode" entry is particularly sharp:
> features that fail loudly at build time (good) vs. silently at runtime (bad). The current bug puts a build-time invariant violation in the second bucket.

That's a reframing that earns its keep.

**Non-blocking finding.** "By cost asymmetry" lists the right examples but understates the magnitude. Some features download multi-hundred-MB artefacts (CUDA toolchains, full Node.js distributions). For those, the cost asymmetry is so large that "this feature gets pre-fetched, others don't" is a per-feature opt-in, not a global axis choice.
Worth a sentence noting that cost-asymmetry slicing may be the right *complement* to D3 rather than an alternative.

### Open Questions

**Strength.** The strikethrough-and-replace pattern for resolved questions is good housekeeping and was done correctly.
New Q4 (phase relationship between prebuild and up) and Q5 (migration shape) are load-bearing for the proposer.

**Non-blocking finding.** Q2 (first-start latency budget) is the most important open question and should probably be Q1, given that the entire P5 recommendation depends on the answer. Reordering to put it first signals the report's own reading of which question is load-bearing.

### Cross-Cutting: Sharing as Goal vs. Coincidence

**Strength.** The rewrite under (1)(a) is sharper than round-1's version. The collapse logic (A1 loses rationale, A2 no worse than A1, A3 over-engineered, C2 survives on its own merits) is genuinely useful framing for a proposer.

**Non-blocking finding.** The closing claim is strong:
> The "best design by default" framing under (4)(c) does not mean "the most sharing-aware design." It means the design with the cleanest invariants. C2 stands on its own merits; A3/A5/registry-style options largely do not in this context.

But the recommended bundle is **P5** which uses **A2** (per-project tag), not C2. The recommendation and this paragraph endorse different bundles.
P5's structure (A2 + B4 + D2/D3) doesn't include C2. That's defensible — runtime install (D2/D3) makes layer reuse moot — but the report should say so explicitly. Otherwise the reader is left with "C2 stands on its own merits" alongside a recommendation that drops C2.
A clarifying sentence: "Under P5/D2 the layer-reuse axis is moot because there is no project-specific bake to decompose; C2's intra-project reuse benefit re-emerges only in P4." would close this.

### Honesty Assessment (Round 2)

**Strength.** The tilted-but-fair starting point that round-1 flagged is now an explicitly-tilted starting point: the recommendation is named and owned, the author-guidance is documented, and the ruled-out options have NOTE callouts pointing to which guidance question excluded them.
This is the right shape for a report that is about to be consumed by a proposer.

**Blocking finding (re-asserted from round-2 prompt).** The recommendation is honest about *that* it depends on first-start latency but not about *how much*.
"Exceeds user tolerance" without a number is a soft endorsement that lets the proposer pick whichever bundle they prefer post-hoc.
Tied to the blocking finding under Recommendation Posture; same fix closes both.

### Tradeoff Clarity (Round 2)

Round-1 item 14 (generic pros/cons pass) is the one item that didn't land. Spot check:

- **C1 pro: "simple to think about."** Still generic. Round-1 suggestion was "one image per project, one tag, one path through the build pipeline" or similar. Not done.
- **A3 con: "more tags accumulate over time."** Now annotated with (3)(a) consequence ("becomes user-visible cruft in `podman images`"). That's a partial improvement but not a tighten — still no number on how many tags accumulate per active project.
- **D2 con: "first start is much slower."** Still unquantified. Round-1 asked for a rough budget. Not done.

These are all non-blocking. Carrying forward the round-1 recommendation: a single pass over the generic pros/cons, with numbers where possible and concrete operational claims where not, would strengthen the report.

## Specific Round-2 Prompt Questions

The round-2 prompt asked four specific questions. Direct answers:

### Did the revision do what it claimed for each blocking item?

Yes for items 5, 6, 7. Yes-by-author-guidance for items 1, 2, 3, 4 (with appropriate NOTE callouts). The "Author Guidance Applied" section explicitly traces each guidance answer to the consequence in the report, which is exactly the right discipline.

### Is the new committed recommendation honest about its risks?

Mostly yes, with one gap.
- The first-start-latency framing of P5 is **honest about the existence of the risk** but **unfalsifiable about the trigger** to fall back. A number is needed; otherwise "user tolerance" is whatever the implementer says it is at decision time.
- P4's "credible fallback" framing under-states the cost. The cost is documented elsewhere in the report but not at the point a reader would care about it (the Recommendation Posture).

Both are non-fatal. Both are 1-3 sentence fixes. Together they are the only blocking finding for round 2.

### Does the report still let the eventual proposer make a real decision?

Yes. The five-axis decomposition is preserved (per the round-2 prompt, intentionally), and the bundles are still distinct enough that the proposer can deviate from the recommended P5 to P4, P3, P2, or P0 with a clear rationale.
The committed recommendation is a strong default, not a foreclosure. The Open Questions section explicitly invites the proposer to override based on first-start-latency measurement.

The one place the design space *is* foreclosed is on Axis F (distribution scope), which is correct given (1)(a) and explicitly time-bounded ("if the project later acquires team or community users, axis F should be reopened").

### Are the new sections load-bearing or filler?

All three new sections are load-bearing:
- **Failure-mode UX** — the bundle-by-bundle failure surface is a real differentiator that the round-1 report missed.
- **Forced-Pair Couplings** — the five couplings each save the proposer a round of deduction.
- **Bundle visibility summary** — the cleanest answer to "what does this look like operationally" the report has.

None read as filler.

### Are any round-1 non-blocking items worth re-asserting?

Yes, but lightly:

- **Item 14 (generic pros/cons pass)**: partially folded but not done. Carrying forward as non-blocking.
- **Item 17 (open questions)**: the team-vs-solo question was correctly resolved by guidance and not re-opened, which is right. The phase-relationship question (Q4) was added. Both round-1 sub-items are addressed.

The remaining items (8, 9, 11, 12, 13, 15, 16, 18, 19, 20 per the round-2 prompt's list) are all folded and don't need re-assertion.

## Verdict

**Revise (light)**, narrow-scope.

The revision is a good-faith and largely successful absorption of the round-1 review and the author's multi-choice answers.
The committed recommendation is correct given the author's stated cadence preference, and the report does not prematurely foreclose the design space.
The new sections (Failure-mode UX, Forced-Pair Couplings, Bundle visibility summary) are load-bearing additions, not filler.

The remaining gap is the recommendation's escape clause: P5's fallback to P4 is presented as conditional on "first-start latency exceeding user tolerance" without a target latency budget or a clear stage at which the measurement triggers a switch. This makes the recommendation un-falsifiable and the fallback a permanent escape hatch.

A 2-3 sentence addition to the Recommendation Posture would close this. The report could ship without it; the proposer would simply pick the latency budget themselves. But because the report is being consumed by a proposer who is leaning on the report's recommendation to commit design effort, the report owes the proposer a number (or an explicit "you pick the number first thing").

## Action Items

1. **[blocking]** Add a target first-start latency budget (or an explicit "proposer picks before design starts") to the Recommendation Posture's P4 fallback clause. Without a number, the fallback is unfalsifiable. 2-3 sentences.

2. **[non-blocking]** Reframe P4 as "credible *target*, not cheap *pivot*" in the Recommendation Posture. The cost is documented elsewhere; surface it at the recommendation point.

3. **[non-blocking]** Resolve the C2-vs-P5 tension in "Sharing as goal vs. coincidence." A clarifying sentence that C2's benefit re-emerges only in P4, not in the recommended P5, would close this.

4. **[non-blocking]** Carry forward round-1 item 14: pass over the generic pros/cons (C1 pro, A3 con, D2 con) and replace with concrete operational claims or numbers.

5. **[non-blocking]** Add `~/.cache/lace/` and `.lace/prebuild/` artefacts to the bundle visibility summary table where applicable. P0/P1/P2 do accumulate `.lace/prebuild/` per-project; the table currently reads as if they don't.

6. **[non-blocking]** Add a NOTE callout to the Failure-mode UX P5 row pointing to the exit-127 / postCreateCommand UX as a P5 prerequisite, not optional polish.

7. **[non-blocking]** Reorder Open Questions to put first-start-latency budget (current Q2) first; it is the load-bearing question for the recommendation.

8. **[non-blocking]** Either include P6 in the BLUF or drop it from the Lens 3 internal structure. Current asymmetry confuses the BLUF-vs-Recommendation-Posture mental models.

9. **[non-blocking]** A6 con: add a sentence clarifying that A6 still has a Dockerfile rewrite loop on prebuild rebuild, not just on initial reference.

## Questions for the User

No new multi-choice questions for round 2. The author-guidance answers from round 1 cleanly resolved the ambiguity that was driving most of the design space.

One soft question for the author's awareness rather than a blocking input:

- **First-start latency budget for P5.** Do you have a target in mind, or is "the proposer measures and picks" the answer? The action item above defaults to the latter; if you have a number (5s? 30s? 2 minutes?), surfacing it now anchors the rest of the recommendation.
