---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T16:45:00-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [prebuild, historical, rationale, investigation, rfp_input]
---

# Prebuild: Original Rationale (Historical Investigation)

> BLUF: The cdocs that introduced lace prebuild frame the problem as a generic "cold-start" cost: feature install at `devcontainer up` time "can add minutes" and is therefore worth shifting to a build-time bake.
> The framing was asserted, never measured, and the corpus contains no surviving record of the alternatives the author recalls (postStartCommand, postCreateCommand, custom RUN steps, install-ordering tweaks) being weighed and rejected.
> The "features were cache-busted overly aggressively" recollection is **not** what the cdocs actually claimed; the cdocs claimed that *features always install at creation time, full stop*, and prebuild was framed as cache *creation*, not as a workaround for an aggressive *invalidation* policy.
> On the evidence in the corpus, the original case for prebuild is thin and unfalsifiable, and a reader making a decision today should treat it as design intuition rather than a documented engineering investigation.

## Context

This report exists to feed the RFP at [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](../proposals/2026-05-05-rfp-rethink-prebuild-cache.md) and the options exploration in [`cdocs/reports/2026-05-05-prebuild-cache-system-options.md`](./2026-05-05-prebuild-cache-system-options.md).
The author is questioning whether the prebuild mechanism is over-engineered, possibly built atop a misdiagnosis of devcontainer feature behaviour.
The job here is to surface what the *original* cdocs said about why prebuild was needed, so the author can compare original framing against current reality and the recalled alternatives.

The investigation is corpus-only: no source code, no external devcontainer documentation, no empirical re-test.

## Method

Read in full: the original proposal `2026-01-30-packages-lace-devcontainer-wrapper.md` (the foundational document), its three review rounds, the design-decisions report `2026-01-31-packages-lace-design-decisions.md`, and the narrower follow-up RFP `2026-01-31-smart-prebuild-cache-busting.md`.
Skimmed: implementation devlog `2026-01-31-packages-lace-cli-implementation.md`, later prebuild devlogs and proposals through 2026-03, and the recent triggering documents (`2026-05-05-prebuild-tag-collision-incident.md`, the RFP, the options report).
Grepped the full cdocs corpus for terms like "cold-start", "minutes", "measured", "benchmark", "alternative", "postCreateCommand", "cache-bust", "aggressive".

## Original Problem Statement

The Objective of the foundational proposal `2026-01-30-packages-lace-devcontainer-wrapper.md` is two sentences:

> Provide a CLI tool that reduces devcontainer startup time by pre-building feature layers onto base images.
> Devcontainer features are installed at container creation time by the devcontainer CLI, which can add minutes to every `devcontainer up` invocation.

The Background's "cold-start problem" subsection elaborates:

> The devcontainer spec installs features at container creation time.
> Each feature runs its own install script (apt packages, binary downloads, configuration).
> For the current lace devcontainer, features like `sshd` and `git` add modest overhead, but heavier features (claude-code, wezterm-server, neovim) would add significant time.
> The existing Dockerfile works around this by manually installing these tools inline, which defeats the composability benefits of devcontainer features.

This is the entire framing.
Note what it *is* and what it *is not*:

- It is a generic claim about feature install latency.
- It is a hypothetical: "heavier features ... *would* add significant time."
  None of the listed features (claude-code, wezterm-server, neovim) had at the time been migrated to features and measured; the Dockerfile still installed them inline.
- It is not a claim about cache *invalidation*.
  The phrase "cache-busted aggressively" appears nowhere in the foundational proposal, the design-decisions doc, or any review.
  The implicit cache model in the original framing is "feature install runs every container creation, period" — it does not describe an invalidation policy at all.

The single piece of "Usage Story" quantification appears in the design-decisions report `2026-01-31-packages-lace-design-decisions.md`:

> Developer adds claude-code under `customizations.lace.prebuildFeatures`, runs `lace prebuild`.
> Subsequent `devcontainer up` starts in seconds instead of 90+ with feature installation.

The "90+ seconds" is presented in a usage story without a citation, log excerpt, or measurement methodology.
It is the *only* number in the corpus tied to the original justification.

## Alternatives Considered (or Not)

The original proposal's "Design Requirements" section lists 10 decisions, each with a "why" rationale.
None of those 10 are framed as alternatives to prebuild itself; they are alternatives *within* prebuild (which `FROM` to rewrite, where to put the cache directory, AST parser vs regex, tag format, etc.).
The full list is in the proposal at lines 184-209 and in the design-decisions report.

The recalled alternatives — `postStartCommand`, `postCreateCommand`, custom Dockerfile `RUN` steps, devcontainer feature install ordering — are **not present** in the original proposal as rejected options.
Specifically:

- The substring "postCreateCommand" appears in the proposal exactly once, as an *example of a non-impactful field* whose changes should not trigger rebuild (line 147).
  It is not discussed as an alternative substrate for the install work.
- "postStartCommand" and "postAttachCommand" do not appear in the foundational proposal at all.
- "RUN" appears only as a Dockerfile parsing concern (rejecting `RUN` instructions that appear before `FROM`).
- "feature install ordering" appears in the smart-cache RFP (line 49) only as an open question about how to handle key reordering in a diff, not as a way to avoid prebuild.

The closest the original proposal comes to acknowledging an alternative is the framing "the existing Dockerfile works around this by manually installing these tools inline, which defeats the composability benefits of devcontainer features."
This is treated as the status quo, not as a viable alternative; the rejection is implicit and is on *composability* grounds, not performance grounds.
There is no comparison along the axis "manual `RUN` vs. prebuild" beyond that single sentence.

The reviews of the original proposal (rounds 1, 2, 3) do not surface any alternative-rejection discussion either.
The R1 review accepts the cold-start framing and offers a non-blocking nudge to strengthen the "would add significant time" claim by referencing the actual Dockerfile lines.
The R3 review's only verdict on the framing is approval: "the three subsections (cold-start problem, features as composable units, devcontainer CLI build command) build a logical case for the solution."

## Empirical Grounding

There is none in the original cdocs.

The proposal's quantification is hypothetical ("would add significant time"), the design-decisions story's "90+ seconds" is uncited, and the implementation devlog `2026-01-31-packages-lace-cli-implementation.md` contains zero timing data.
A grep across the entire cdocs corpus for "measured", "benchmark", "timing" produces no January-February 2026 record of a before/after measurement of feature install time.

The first concrete prebuild-related timing data in the corpus is in the *failure* incident report `2026-05-05-prebuild-tag-collision-incident.md`, four months later:

> Wall time was ~2m 17s. The lace-side phases ran in ~5s; `devcontainer up` consumed the rest, ending in exit 1 with a `postCreateCommand` failure.

That number is for a cache-miss workspace-image rebuild on an image that *had* prebuild applied, not a baseline measurement of feature install with vs. without prebuild.
It cannot be retrofitted into the original justification.

The R1 review of the options report (`2026-05-05-review-of-prebuild-cache-system-options.md`) raises this gap explicitly when assessing alternative bundles:

> **D2 con ("first start is much slower"):** concrete but unquantified.
> **Tighten** with a rough estimate (current full prebuild is 60-120s; lazy install would push that to first-container-start instead).

Even at that point, the "60-120s" appears as a reviewer's order-of-magnitude estimate, not as a measurement.

## What Has Changed Since

The original framing has been weakened, not strengthened, by the documents that follow.

`2026-02-09-port-allocation-investigation.md` notes that prebuild and certain features are mutually exclusive:

> The lace pipeline has an inherent tension: `prebuildFeatures` are baked into the Docker image for faster rebuilds, but the port allocation pipeline only processes top-level `features`.
> The overlap validator prevents dual placement.
> This means any feature that declares `customizations.lace.ports` in its metadata cannot benefit from prebuild image caching.
> For wezterm-server specifically, the install is lightweight (downloading a binary), so the tradeoff is acceptable.

The reviewer of `2026-02-09-review-of-lace-port-allocation-investigation.md` reinforces the architectural cost:

> wezterm-server will no longer be prebaked into the Docker image layer.
> It will be installed at container creation time (by the devcontainer CLI), making the first `lace up` slightly slower.
> ... it represents an architectural tension in lace's design: features that need port allocation cannot benefit from prebuild image caching.

`2026-03-24-user-config-and-fundamentals-feature.md` describes `lace-fundamentals-init` running at runtime via `postCreateCommand` for *some* setup work — i.e., the project has already adopted the runtime-init pattern for things prebuild was not the right substrate for.

The 2026-05-05 incident report and the RFP it triggered are the most consequential update.
The RFP's BLUF describes the original tagging design as creating "a real failure" and observes:

> The current design treats cross-project image sharing as a desirable property.
> Is it actually load-bearing for any user workflow, or is it an emergent side-effect of using a single namespace?

The options report's recommendation goes further (in `2026-05-05-prebuild-cache-system-options.md`):

> "The prebuild was a workaround for slow feature install.
> Stop treating it as a build-time bake."
> The project already has working runtime initialisation in `lace-fundamentals-init`; extending that pattern is the natural next step.

That sentence is, effectively, the options report telling the reader that the original framing has stopped being load-bearing.

## Honest Assessment

On the evidence in the corpus:

The original prebuild rationale is **thin and unfalsifiable**.
A single hypothetical sentence in the Objective ("can add minutes"), a single uncited "90+ seconds" in a usage story, and an implicit "manual RUN defeats composability" framing constitute the entire case.
There is no measurement, no acceptance criterion, no decay-detecting metric, and no documented comparison against the recalled alternatives.

The recollection that "features were cache-busted overly aggressively by default" is **not what the cdocs argued**.
The cdocs argued that features install on every container creation — i.e., they were never cached *at all* in the original framing.
"Aggressive cache-busting" implies a cache existed that was being invalidated too eagerly; the original framing assumes the opposite, that the only cache available was the runtime's automatic Docker layer cache and that it didn't help for `devcontainer build`'s feature install path.
Whether *that* claim is true is a separate question this report explicitly is not answering, but it is not the claim the recollection describes.

Whether the alternatives the author recalls (postStartCommand, postCreateCommand, custom RUN steps, install ordering) would have worked is **not addressable from the cdocs alone** — they were never compared.
Their absence from the design-decisions document is itself the finding: prebuild was selected without a documented bake-off against the runtime-init approach the project has since organically adopted via `lace-fundamentals-init`.

If the author's recollection of available workarounds was correct at the time, the original proposal jumped past them.
If the recollection is wrong and those workarounds did not actually exist or did not actually work, the original proposal also failed to demonstrate that — it asserted the cold-start cost and named the solution in the same breath.

The most honest summary for a decision-maker today: prebuild was introduced on an unmeasured intuition, was approved on the strength of clear *internal* design (the parts that were rigorous were all *implementation* concerns: tag format, cache path, lock file namespacing, AST parsing), and the load-bearing *premise* — that runtime feature install was unacceptable — was never tested against alternatives in the corpus.
The existing options report has already taken this position implicitly (Lens 3 / P5 recommendation).
This report supports that conclusion from the historical-rationale angle: there is little in the original case to defend against a rethink.

## Citations

- `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md` — foundational proposal; "Objective", "Background / cold-start problem", "Design Requirements".
- `cdocs/reviews/2026-01-30-review-of-packages-lace-devcontainer-wrapper.md` — R1 review.
- `cdocs/reviews/2026-01-30-review-of-packages-lace-devcontainer-wrapper-r2.md` — R2 review.
- `cdocs/reviews/2026-01-31-review-r3-of-packages-lace-devcontainer-wrapper.md` — R3 review (acceptance).
- `cdocs/reports/2026-01-31-packages-lace-design-decisions.md` — "Usage Stories" (the "90+ seconds" claim) and the 10-13 design decisions.
- `cdocs/proposals/2026-01-31-smart-prebuild-cache-busting.md` — narrower follow-up RFP (still in `request_for_proposal` status).
- `cdocs/devlogs/2026-01-31-packages-lace-cli-implementation.md` — implementation devlog (no timing data).
- `cdocs/devlogs/2026-02-09-port-allocation-investigation.md` — first surfacing of the prebuild-vs-feature tension.
- `cdocs/reviews/2026-02-09-review-of-lace-port-allocation-investigation.md` — review reinforcing the tension.
- `cdocs/devlogs/2026-03-24-user-config-and-fundamentals-feature.md` — adoption of runtime-init via `lace-fundamentals`.
- `cdocs/reports/2026-05-05-prebuild-tag-collision-incident.md` — the failure incident.
- `cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md` — current RFP.
- `cdocs/reports/2026-05-05-prebuild-cache-system-options.md` — options report (recommends Lens 3 / P5).
- `cdocs/reviews/2026-05-05-review-of-prebuild-cache-system-options.md` — R1 review of the options report (raises the unquantified-D2 gap).
