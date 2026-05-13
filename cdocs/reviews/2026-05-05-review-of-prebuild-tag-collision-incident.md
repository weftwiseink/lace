---
review_of: cdocs/reports/2026-05-05-prebuild-tag-collision-incident.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-05T18:05:00-07:00
task_list: lace/prebuild-cache-collision
type: review
state: live
status: done
tags: [self, fresh_agent, prebuild, cache-collision, root-cause, evidence]
---

# Review: Prebuild Tag Collision Strands whelm's lace-fundamentals Feature

## Summary Assessment

The report is a strong incident analysis.
Root-cause attribution is sound and verified against the source: `generateTag()` at `packages/lace/src/lib/dockerfile.ts:116-140` derives the tag from `imageName`, `tag`, `digest` only, with no feature input, and the cache-hit branch at `packages/lace/src/lib/prebuild.ts:207-254` confirms tag existence without inspecting `devcontainer.metadata`.
The Cause A / Cause B separation is honest and the recommendations are correctly scoped to the incident, with structural redesign properly deferred to the companion RFP.
Verdict: **Accept** with a few non-blocking refinements (a couple of evidence pointers to tighten and one small mechanism nuance worth naming so future readers don't re-derive it).

## Section-by-Section Findings

### BLUF and Key Findings

The BLUF lands the right summary in three sentences.
Findings list is concrete and matches the code:
- `generateTag()` signature and behaviour confirmed at `dockerfile.ts:116-140`. [non-blocking: the inline reference in the body says "lines 116-140"; the actual function body ends at line 140, so the citation is accurate.]
- The `contextsChanged()` -> `podman image inspect` -> "is up to date" path is the exact branch in `prebuild.ts:207-227`. The report's description of what the check does and does not do is correct.
- The `up.ts` injection claim is verified at `up.ts:797-868`: `allFeatureRefs` is built from `resolvedConfig.features` keys plus `extractPrebuildFeaturesRaw(resolvedConfig)` keys (the *requested* set), and the postCreateCommand injection at lines 856-868 has no coupling to the resolved image's actual baked features.

### Cause A: workspace image and container were both gone (non-blocking)

Cause A is correctly framed as a "container-store reality check" issue rather than a lace bug.
One small clarification worth adding: the `vsc-whelm-...` image is the *workspace* image (the layer on top of the prebuild base, built by `devcontainer up`), distinct from the `lace.local/node:24-bookworm` *prebuild base*. The report uses both names but does not explicitly call out the layering. A reader who has only ever looked at `lace.local/*` images may briefly conflate them.

### Cause B: prebuild tag collision (root cause) (non-blocking)

The mechanism description is accurate and well-evidenced:
- `generateTag()` cited correctly.
- The "is up to date" check is enumerated step-by-step and matches `prebuild.ts:207-227`.
- The two-project metadata table makes the collision concrete (whelm timestamp `2026-03-27`, weftwise `2026-05-01`, identical `prebuildTag`).

Two small mechanism nuances that would tighten the report without changing its conclusions:

1. The retagging mechanism is implicit. `prebuild.ts:328-339` invokes `devcontainer build ... --image-name <prebuildTag>`, which tells the runtime to apply that tag to the resulting image. Because that tag is derived from `FROM` only, the second project's build atomically replaces the first project's tag association in the image store. Naming this once ("the `--image-name` flag plus tag-derived-from-FROM is what causes the silent replace") would make the failure mechanism legible in one sentence rather than three.

2. The cache-reactivation branch (lines 244-249) calls `writeMetadata()` even when the source file just needed a FROM rewrite. That refreshes the per-project `metadata.json.timestamp` on reactivation, not just on rebuild. The report's claim that "comparing the image's actual creation timestamp against the per-project metadata timestamp would have flagged the 4-day discrepancy here" is still correct in this incident's specifics (whelm's metadata.json was at 2026-03-27, image was built 2026-05-01 by weftwise), but a reader who follows the code may wonder why the metadata wasn't rewritten. A one-line note that `writeMetadata` is only called in the reactivation/full-build paths, not on the pure cache-hit return at line 226, would close that loop.

### Cause C: runtime injection assumes build-time presence (non-blocking)

The mechanism is correct and the exit-127 framing is the right insight. Worth keeping as written.

### Why this will keep flip-flopping (non-blocking)

The flip-flop framing is correct: every `lace up --rebuild` for one project re-overwrites the shared tag, leaving the other project's cache-hit branch in the same broken state. Good motivation for not stopping at the immediate fix.

### Evidence Trail (non-blocking)

Evidence pointers are concrete and reproducible:
- Run log path with timestamp.
- Drift fingerprint quoted as the same hex value for stored and computed.
- Both per-project context paths.
- Exact `podman inspect` invocation for the metadata label.
- Two in-container probes.

One small gap: the report does not record the actual image creation timestamp from `podman image inspect lace.local/node:24-bookworm --format '{{.Created}}'`. That is the single piece of evidence that proves the substitution chronologically (image is from 2026-05-01, whelm's metadata is from 2026-03-27). Including it would make the chronological argument self-contained.

### Recommendations (non-blocking)

The Immediate / Short-term / Structural split is honest.
- Immediate: `lace up --rebuild` correctly named with the inverse-failure caveat.
- Short-term: both items (label verification on cache hit; pre-start invariant probe) are within the current API and are real fixes for Cause B and Cause C respectively. The label-verification recommendation is the minimal closure on Cause B without a tag-scheme change.
- Structural: correctly deferred to the RFP. The two named directions (per-project namespace, content-hashed) match `cdocs/reports/2026-05-05-prebuild-cache-system-options.md` axis A2 and A3 respectively. The report explicitly does not pick, which is the right call given the companion RFP exists.
- Adjacent (Cause A fast path): correctly flagged as independent and out of scope for the prebuild fix.

### Out of Scope (non-blocking)

The three items are real and correctly bracketed:
- The Cause A trigger (host prune) is genuinely outside lace's purview.
- The unnamed local feature in weftwise's metadata label is a curiosity that does not change the analysis.
- `sprack` status is correctly flagged as unprobed; that is a known unknown, not a defect in the report.

## Causes Considered and Correctly Excluded

The user asked whether any of the following are contributing factors that should have been named:

- **`--buildkit never`** (`prebuild.ts:338`, `up.ts:1311`). Verified: this is a podman/BuildKit RUN-mount compatibility workaround for `/tmp` permission corruption, not a contributor to the tag collision. Correctly omitted.
- **`dev_container_feature_content_temp` cleanup** (`up.ts:1312-1316`). Verified: this guards against scratch-based content image layer caching when BuildKit is off. Unrelated to base image tagging. Correctly omitted.
- **Prebuild metadata staleness check**. Verified: there is no staleness check today. The report correctly identifies this as a *missed* validation, not a contributing cause; it is named as part of the short-term recommendation ("compare the image's actual creation timestamp against the per-project metadata timestamp").

I did not find any additional unnamed cause that materially contributes to this specific incident.

## Verdict

**Accept.**

The root-cause analysis is sound, evidence is concrete and reproducible, and the Cause A / Cause B / Cause C separation is clear (they bleed together only in the symptom, exit 127, which is exactly the report's point). Recommendations are correctly scoped against the companion RFP. Nits below are non-blocking.

## Action Items

1. [non-blocking] Add one sentence to Cause B that names `--image-name <prebuildTag>` as the retagging mechanism, so the silent-replace step is explicit rather than implicit.
2. [non-blocking] Add a short clarifying note that `writeMetadata` is only invoked on reactivation and full-build paths, not on the pure cache-hit return at `prebuild.ts:226`. This pre-empts a reader question about why the per-project timestamp does not refresh on every `lace up`.
3. [non-blocking] Capture the `podman image inspect lace.local/node:24-bookworm --format '{{.Created}}'` output in the Evidence Trail to make the 2026-05-01 image-creation date a citable artefact.
4. [non-blocking] In Cause A, briefly distinguish the *workspace* image (`vsc-whelm-...`) from the *prebuild base* (`lace.local/node:24-bookworm`) so a reader who has only seen the latter does not conflate them.

## Clarifying Questions for the Author

These are non-blocking but would sharpen the report or its successors:

A. **Should the report include a small reproducer recipe?**
   1. Yes - add a "Reproduction" section: clone two projects with same `FROM` and disjoint prebuild features, run `lace up` in each in sequence, observe the inverse failure on the second.
   2. No - the evidence trail is sufficient for the engineering work; a reproducer belongs in the RFP's test plan.

B. **How visible should the `sprack` unknown be?**
   1. Promote to a TODO callout in the body so it is not lost in "Out of Scope".
   2. Keep as-is in "Out of Scope"; it is a follow-up probe, not a defect.

C. **Should the report explicitly cross-reference the auto-injection logic in `up.ts:797-868` for Cause C?**
   1. Yes - add the `:797-868` range alongside the existing `:842-868` reference so a reader can see the `allFeatureRefs` derivation in one click.
   2. No - the existing snippet is sufficient; the wider range is for the implementer, not the reader.
