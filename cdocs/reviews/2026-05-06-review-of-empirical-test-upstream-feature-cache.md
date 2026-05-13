---
review_of: cdocs/proposals/2026-05-06-empirical-test-upstream-feature-cache.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T18:30:00-07:00
task_list: lace/prebuild-cache-rethink
type: review
state: live
status: done
tags: [fresh_agent, test_plan, empirical, prebuild, executability, runtime_validated]
---

# Review: Empirical Test - Upstream Feature Cache vs. Lace Prebuild

## Summary Assessment

The proposal defines a four-scenario empirical test against weftwise's actual `~/code/weft/weftwise/main` workload to determine whether devcontainer-CLI 0.83.0's `BUILDKIT_INLINE_CACHE` + `build.cacheFrom` can replace `lace prebuild`.
Overall the plan is well-structured: it has a falsifiable H1, a hidden-gating-risk H2, a Dockerfile-coverage table that demonstrates real engagement with weftwise's peculiarities, four well-differentiated scenarios, and an explicit infeasibility verdict that does not collapse into "fail."
The most important findings are (a) a contradicting cache-image path on line 142 that breaks Scenario D as written, (b) Scenario D's collision construction is invalid because the treatment uses different cache images per project so cannot reproduce a tag-collision, only confirm its absence, (c) F1 mitigation is not actionable (test cannot patch upstream feature install scripts) and should add docker-rootful as the recommended fallback, and (d) Phase 4 VS Code confirmation should be promoted from optional to mandatory because VS Code is the originally-observed environment and the only proof the result generalizes.
**Verdict: Revise.** Three blocking corrections plus one promotion are required before the test runner can execute end-to-end without redesign.

## Section-by-Section Findings

### BLUF and Hypothesis (lines 14-46)

**Non-blocking, observation:** H1 is well-stated and falsifiable.
H2 is correctly identified as the hidden gating risk.
The "infeasible vs. fail" distinction is good practice and rare in test plans.

**Non-blocking, suggestion:** H1's 1.5x bound is asymmetric: warm runs (Scenario B) at 1.5x is a 30s -> 45s window, while cold runs (Scenario A) at 1.5x is 7min -> 10.5min - a 3.5-minute gap.
Consider whether absolute deltas matter for a developer's lived experience: 45s is still warm-fast, but 10.5min cold is materially worse than 7min cold.
This does not change pass/fail, but the report's verdict paragraph should call out the absolute delta on cold for the RFP reader.

### Test Setup / Environment (lines 50-64)

**Non-blocking, observation:** Environment table is complete, including the unusual but accurate note that "BuildKit semantics in this test means `DOCKER_BUILDKIT=1` plus `BUILDKIT_INLINE_CACHE=1` build args, executed via `podman build`."
This is the correct framing: there is no separate buildkit daemon on Fedora 43 with rootless podman 5.7.1; podman's BuildKit-style frontend is what gets exercised.

**Non-blocking, suggestion:** The proposal does not test whether `devcontainer up --buildkit auto` (the default when not overridden) actually engages the BuildKit-style frontend on this host.
The first treatment run should explicitly run with `--progress=plain` and visually confirm BuildKit-style step markers (`#5 [internal]`, `CACHED`) before any timing data is collected, otherwise the test could record times under legacy buildah build semantics and never notice.
V1 covers this for the manual `podman build` invocation but not for `devcontainer up`; consider promoting V1 to also include "run a treatment-style `devcontainer up` and confirm BuildKit-style output appears in stdout."

### Test Project / Targeting weftwise (lines 66-77)

**Non-blocking, observation:** The shift from whelm to weftwise is well-justified: heavier Dockerfile means cache-engagement signals are visible at human time scales, and weftwise was the originally-observed environment.

### Dockerfile-Specific Considerations Table (lines 78-100)

**Non-blocking, observation:** Cross-checked against `~/code/weft/weftwise/main/.devcontainer/Dockerfile`:
- Line 2 `FROM lace.local/node:24-bookworm` - confirmed.
- Line 13 `"context": ".."` - confirmed.
- Lines 25-55 apt-get layer - confirmed (xvfb + GTK + libnotify4 + libxss1 + libxtst6 are listed; the table summary "~30 packages" is accurate).
- Lines 111-112 Electron install - confirmed verbatim, `node node_modules/electron/install.js` matches.
- Lines 114-115 Playwright + Chromium install - confirmed verbatim.
- Lines 118-119 COPY package files + frozen-lockfile - confirmed.
- Line 125 `COPY --chown=${USERNAME}:${USERNAME} . .` - confirmed.
- Lines 129-130 non-fatal `pnpm build:electron` - confirmed.

**Non-blocking, observation:** `customizations.lace.workspace.layout = bare-worktree` and `mountTarget = /workspaces/weftwise` (lines 56-59) - confirmed.
The treatment's synthesized `workspaceMount` and `workspaceFolder` use `target: /workspaces/weftwise/main`.
This is the correct bare-worktree layout but the table description on line 93 says only `/workspaces/weftwise`; the synthesized JSON on line 222-223 correctly uses `/workspaces/weftwise/main`.
The table description should match the JSON to avoid confusion for the test runner; either is correct as long as both agree.

**Blocking, B1:** Two structural elements present in weftwise's actual Dockerfile are NOT enumerated in the considerations table:
1. **Line 70-71: `RUN mkdir -p /workspaces /build && chown -R ${USERNAME}:${USERNAME} /workspaces /build`** and **line 73: `WORKDIR /build`**.
   These are layered before all the heavy installs and they create a `/build` directory the test treatment does not anticipate.
   The table should record that this layer must be preserved verbatim and confirm it is cache-cooperative.
2. **Lines 65-66: `RUN mkdir -p /usr/local/share/npm-global && chown -R node:node /usr/local/share`** and lines 102-103 `ENV NPM_CONFIG_PREFIX` + `ENV PATH=$PATH:/usr/local/share/npm-global/bin`.
   Cache-cooperative but the table should explicitly say "preserve, no special handling."
3. **Line 99: `USER ${USERNAME}`**.
   The user-switch boundary matters because feature install scripts may expect to run as root and lace's prebuild path may handle this differently from upstream.
   This is *not* about layer preservation; it is about whether features installed via `devcontainer up`'s feature pipeline run before or after this `USER` directive.
   Per the devcontainer spec, features run after the Dockerfile; the existing treatment is correct, but the table should call out the boundary so the test runner can confirm it from `--progress=plain` output.

These omissions do not invalidate the design; they create gaps that a test runner could trip over without further investigation.

**Blocking, B2:** Line 88 says `Heavy enough that a cache miss here produces a clearly distinguishable wall-time signal.`
This is correct, but the table does not cross-link to V3 (CACHED count).
The Electron + Playwright layers should be named in V3 as the first layers to inspect when the count is 0 or low - a partial-engagement scenario where Electron caches but Playwright does not (or vice versa) is a real and likely outcome that the table currently does not give the test runner a way to record.

### Feature Set (lines 102-122)

**Non-blocking, observation:** The six features match weftwise's `prebuildFeatures` verbatim. The note about wezterm-server being the entanglement flagged in the source-analysis report is correct; the static-`appPort` workaround is a sensible test-time mitigation.

### Registry Choice (lines 124-137)

**Non-blocking, observation:** Localhost registry is the right call for "did the mechanism work" decoupling.

**Non-blocking, suggestion:** F5 (insecure registry) is in the failure-modes section but the registry config is not pre-emptive; it surfaces only on failure.
Phase 1 step 3 says "Configure insecure registry in `~/.config/containers/registries.conf`" but does not show the exact stanza.
For executability, include the literal config block:

```toml
[[registry]]
location = "localhost:5000"
insecure = true
```

This is mechanical but the proposal claims executability without further design work; this is one of the gaps a test runner would have to fill.

### Cache Image Path (lines 140-142)

**Blocking, B3:** Line 142 reads:
> "On the multi-project Scenario D the second project (whelm, used as collision counterpart) uses `localhost:5000/lace-empirical-test/weftwise-cache:latest`."

This is contradicted by lines 388-390 (Scenario D itself), the Undo block at line 288, the verdict-failure-mode references, and the Output Artefact template.
All other references say whelm uses `whelm-cache:latest`, not `weftwise-cache:latest`.
This is almost certainly a copy-paste error.
**If executed as written on line 142**, both treatment projects would push to and pull from the same cache image, recreating the collision the test is supposed to *eliminate* in the treatment branch.
The test runner could follow the wrong line and invalidate Scenario D entirely.
Fix: line 142 should read `whelm-cache:latest`.

### Working-Tree Cleanliness Precondition (lines 144-154)

**Non-blocking, observation:** Correct and necessary given `COPY . .` at line 125.
The `git stash --include-untracked` advice is appropriate.
The note that test files (`Dockerfile.test`, `devcontainer.test.json`) should be created and committed before the run is good practice.

**Non-blocking, suggestion:** The proposal says "should be created in `.devcontainer/` and the test should run from that committed state."
Committing test scaffolding to the user's own project repo is intrusive.
Consider: stash the test files into a separate branch, or use `git add -N` (intent-to-add) so they exist for the build context but produce minimal commit churn.
At minimum, document that the test runner must restore the working-tree state with `git checkout -- .devcontainer/` after Phase 6 cleanup.

### Control / Treatment Sections (lines 156-307)

**Non-blocking, observation:** Commands are mostly complete. The `devcontainer up` invocation in the treatment (lines 262-268) uses both `--cache-to` and `cacheFrom` (via the json), but the NOTE at line 275 already flags that the CLI may not forward `--cache-to`.
Good.

**Non-blocking, suggestion:** The "push the workspace image to seed the cache image" step at lines 270-273 uses `<built-image-sha>` as a placeholder.
For executability, show how to extract the sha:

```sh
BUILT_IMAGE=$(podman images --format '{{.ID}}' --filter "label=devcontainer.metadata" | head -1)
podman tag "$BUILT_IMAGE" localhost:5000/lace-empirical-test/weftwise-cache:latest
podman push --tls-verify=false localhost:5000/lace-empirical-test/weftwise-cache:latest
```

The `devcontainer.metadata` label is what the devcontainer CLI applies to the final built image; it is the most reliable way to filter for the right image without parsing the build log.

**Non-blocking, observation:** Treatment expected results (lines 298-307) are theory-grounded and mark themselves as such. Good.

### Scenarios A/B/C (lines 309-376)

**Non-blocking, observation:** Scenarios A, B, C are well-constructed. Scenario B is correctly named as the load-bearing scenario for the "delete prebuild" decision.
The choice of nushell:0 for Scenario C (small footprint, focuses test on cache-reuse rather than feature install cost) is a good experimental design choice.

### Scenario D (lines 378-405)

**Blocking, B4:** Scenario D as constructed cannot demonstrate the property the proposal claims.
The proposal frames D as "tests whether treatment eliminates the collision class" (line 379) and the diagnostic on line 405 is `step 6 wall - step 4 wall` should be near zero because "weftwise-cache is untouched by step 5."

But this is true *by construction*: the treatment uses two separate cache-image refs (`weftwise-cache:latest` and `whelm-cache:latest`).
With separate cache images, there is no shared mutable state between the two project treatments, so step 5 cannot affect step 6's cache regardless of whether `BUILDKIT_INLINE_CACHE` works correctly.
The treatment branch of Scenario D therefore measures "do separate cache images stay separate," which is trivially true and is not the test's job.

The control branch (steps 1-3) does measure something real: the `lace.local/node:24-bookworm` tag-overwrite collision.
But the comparison `step 3 wall - step 1 wall vs. step 6 wall - step 4 wall` is between unlike things: control measures tag collision, treatment measures cache-isolation, not the same mechanism with a different cache scheme.

The valid Scenario D for the treatment would be one of:
1. **Both projects share a cache-image ref** (`shared-cache:latest`), and observe whether `BUILDKIT_INLINE_CACHE` is robust to multi-project pushes. If treatment step 6 is fast despite step 5 having pushed a different layer chain into the same cache image, that proves something. If treatment step 6 is slow, it shows BuildKit cache is also collision-prone.
2. **Treatment uses per-project caches** (current design) but the comparison is *not* tagged "cross-project collision"; it is tagged "cross-project isolation," and the proposal acknowledges D is asking a different question for treatment than for control.

Recommended fix: add a fifth scenario D2 with shared cache image, or rewrite D's framing to explicitly say "treatment does not face the same problem because per-project caches are isolated by construction; the test confirms this rather than measures it." The current framing implies an apples-to-apples comparison that is not present.

**Blocking, B5 (separate from B4):** The proposal says "the whelm test config can omit lace-fundamentals and sprack ... and use the user-config feature trio."
Cross-checked:
- whelm `.devcontainer/devcontainer.json` `prebuildFeatures` = `lace-fundamentals` + `./features/sprack`.
- whelm `.lace/prebuild/.devcontainer/devcontainer.json` `features` (the user-config-merged result) = `neovim, nushell, claude-code, lace-fundamentals, sprack`.
- weftwise `prebuildFeatures` = `git, sshd, wezterm-server, claude-code, neovim, nushell`.

The "user-config trio" of `neovim, nushell, claude-code` is a *subset* of weftwise's features.
If the whelm test omits lace-fundamentals and sprack and only uses the trio, **the treatment's whelm cache would be a strict subset of weftwise's cache**, so even with shared cache image (B4 fix #1) the cache content would never collide on equivalent layers - whelm's three features would simply hit the corresponding cached layers from weftwise's six.

For a meaningful collision test, whelm's treatment feature set should *differ* from weftwise's, ideally including at least one feature weftwise does not have.
The simplest fix: keep `lace-fundamentals` and `sprack` in whelm's treatment config (the proposal excluded them as "intentionally out of scope," but their inclusion is what makes whelm's feature chain genuinely different from weftwise's, which is the property D needs).

If lace-fundamentals is excluded for the cleaner reason that it depends on lace's wrapper-feature mechanism, document that explicitly and substitute another feature whelm uses but weftwise does not, e.g., `ghcr.io/devcontainers/features/node:1` (since whelm's stripped-down test config inherits node from base image just like weftwise, this might not work either).

Without this fix, Scenario D becomes a stricter version of Scenario B: warm-cache reuse on whelm via the same images that weftwise's cache would have, not a collision test.

### Cache-Engagement Verification V1-V4 (lines 407-455)

**Non-blocking, observation:** V1-V4 are well-designed.
V3 (CACHED count) is the load-bearing falsifier and is correctly named in the pass/fail criteria.

**Non-blocking, suggestion:** V3's expected count "25-30 CACHED lines for weftwise's Dockerfile" - confirm against actual step count. The Dockerfile has roughly:
- 1 FROM
- 1 ARG block
- 1 ENV (TZ + DEVCONTAINER)
- 1 RUN apt-get
- 2 RUN corepack
- 1 RUN mkdir/chown for npm-global
- 1 RUN mkdir for /workspaces /build
- 1 WORKDIR
- 1 RUN git-delta install
- 1 RUN sudoers
- 1 USER
- 2 ENV (npm prefix + PATH)
- 1 RUN electron install
- 1 RUN playwright install
- 1 COPY package files
- 1 RUN frozen-lockfile install
- 1 COPY . .
- 1 RUN build:electron
- 1 WORKDIR /workspaces

That is ~21 RUN/COPY/WORKDIR steps before features. With 6 features at ~3-5 steps each, total is ~40-50 steps. "25-30 CACHED" is reasonable as a "most layers cached" threshold, but document the upper bound so a count of 35 is not flagged as "more cached than expected, suspicious."

### Failure Modes F1-F6 (lines 457-490)

**Blocking, B6:** F1 mitigation is not actionable.

> "**Mitigation to try first:** disable any `RUN --mount=type=bind` in feature install scripts (likely none in the chosen feature set; verify with `podman build --progress=plain` output)."

The test cannot modify upstream feature install scripts (the six features are owned by `devcontainers/features`, `weftwiseink/devcontainer-features`, `eitsupi/devcontainer-features`).
Editing them would invalidate the test (it would no longer be measuring upstream behavior).
The test runner's only real options if F1 reproduces are:
1. Stop and declare infeasible (current proposal).
2. Run on docker-rootful instead of rootless podman, where the `/tmp` corruption does not occur.
3. Run on a different host (e.g., a VM with a different kernel/storage driver).

Option 2 should be added explicitly: docker-rootful is the primary supported mode for `BUILDKIT_INLINE_CACHE` (it is the mode the upstream CLI tested PR #382 against).
If F1 reproduces on rootless podman, running the same test on docker-rootful would distinguish "upstream feature is broken in podman" from "upstream feature is broken everywhere."
This matters for the RFP: a result that says "upstream cache works on docker but not podman" is materially different from "upstream cache does not work."

Suggested rewording for F1:

> **Mitigation to try, in order:**
> 1. Identify which feature script issues `RUN --mount=type=bind` (use `podman build --progress=plain` and grep for `--mount`).
> 2. If a feature can be excluded without changing the cache-engagement question (e.g., by substituting a comparable feature), do so and note the substitution in the artefact.
> 3. **Re-run the test on docker-rootful** as a fallback. Install with `dnf install moby-engine` or use the official Docker repo. This isolates "upstream cache works on the standard supported runtime" from "upstream cache works on rootless podman." The RFP cares about both, but if docker-rootful succeeds and podman fails, the conclusion shifts from "delete prebuild" to "delete prebuild for docker users, keep for podman users."
> 4. If docker-rootful also fails with the same `/tmp` signal, declare H2 falsified and stop.

**Non-blocking, observation:** F2-F6 are well-constructed and have clear signals + actions.

### Success/Fail/Infeasible Criteria (lines 491-519)

**Non-blocking, observation:** Falsifiability is well-defined.
The 1.5x bound on B is a 30s -> 45s window; on a 30-second baseline the absolute resolution of `/usr/bin/time -v` is more than enough. Good.

**Non-blocking, suggestion:** The control budget for Scenario A is "7 min."
This is at the upper end of the proposal's own expected range (5-7 min, line 189).
If the test is run cold on a day where `apt-get` is fast, control might come in at 5 min, and the 1.5x bound becomes 7.5 min - which would mean treatment fails Scenario A even if it took only one extra minute.
Consider a percentage rather than absolute floor, or use the *measured* control time as the budget rather than a pre-set 7 min.
This is consistent with the table's "Treatment must be ≤ ... 1.5x" framing for warm and single-feature-change.
The current "7 min" framing on cold is the only place where an absolute number leaks in; align it.

**Non-blocking, observation:** Pass criteria correctly omit Scenario A from the falsifiers (line 511-515 lists B, C, D, V3 only).
This is consistent with the proposal's own framing that A is worst-case and not load-bearing for the decision.
If the proposal author wants A to be a falsifier, add it; otherwise the omission is intentional and should be flagged in the report template.

### Output Artefact (lines 521-571)

**Non-blocking, observation:** Template is mostly complete.
The "Verdict" line (`<H1 confirmed | H1 falsified | infeasible>`) feeds directly into the RFP decision.

**Non-blocking, suggestion:** The artefact template does not include a row for Scenario A (cold) outcomes despite the timing table including it.
Either remove A from the timings table (consistent with not including it in pass/fail) or include a row for A and document that A is recorded as context, not a pass/fail factor.

**Non-blocking, suggestion:** The artefact does not capture *which* features rebuilt vs. cached in Scenario C (line 374's secondary datum).
Add a "Feature reuse breakdown" section to the artefact:

```markdown
## Feature Reuse (Scenario C)
| Feature | Control rebuilt? | Treatment rebuilt? |
|---|---|---|
| git | | |
| sshd | | |
| wezterm-server | | |
| claude-code | | |
| neovim | | |
| nushell (target) | yes | yes |
```

This is the data the RFP needs to answer "is treatment using cache better than control's monolithic prebuild?"

### Out of Scope (lines 573-581)

**Non-blocking, observation:** Out-of-scope list is clear and reasonable. Long-term cache hygiene, multi-machine sharing, feature install correctness, lace-fundamentals, network-cold, and postCreate are all appropriate exclusions for a 90-minute empirical test.

### Implementation Phases (lines 583-650)

**Blocking, B7:** Phase 4 (VS Code confirmation) is described as "optional" and as "a sanity check, not a measurement."

The proposal's own background context (lines 19-21, BLUF NOTE) acknowledges:
> "The author originally observed the problematic cache-busting via *VS Code's* Dev Containers extension, not the CLI directly."

If the CLI cache works but VS Code's wrapper does something extra (forced `--build-no-cache`, or a different config-extension chain), the conclusion changes from "delete prebuild" to "delete prebuild only for CLI users."
The author's actual question is not "does the CLI cache work" but "does the cache the author observed busting still bust in the environment they actually use" - which is VS Code.

**Recommendation:** Promote Phase 4 from optional to mandatory.
Reframe its purpose from "sanity check" to "the conclusive validation that the test result transfers to the originally-observed environment."
If VS Code cannot reopen-in-container with a `.devcontainer/devcontainer.test.json` config (the proposal already flags this on line 625 as "manual override may be needed"), document the workaround in advance:
- Option A: temporarily rename `devcontainer.json` -> `devcontainer.json.bak` and `devcontainer.test.json` -> `devcontainer.json` for the VS Code test only.
- Option B: use VS Code's `dev.containers.defaultConfigFile` setting (if it exists in the current Dev Containers extension version).
- Option C: use the Command Palette > "Dev Containers: Reopen in Container with Configuration" path the proposal mentions.

The "if the CLI works but VS Code doesn't, the conclusion changes" scenario is too important to leave optional.

**Non-blocking, observation:** Phase 1-3, 5-6 are well-sequenced and time-budgeted.

### Estimated Total Wall Time (lines 642-650)

**Non-blocking, observation:** 95-115 min is a credible estimate. The "roughly half is supervised attention" claim is fair given that build wall-clock dominates phases 2 and 3.

## Verdict

**Revise.**

The test plan is structurally sound and demonstrates real engagement with weftwise's Dockerfile peculiarities.
Three blocking issues prevent a competent operator from running it end-to-end without further design decisions: a contradictory cache-image path (B3), Scenario D's collision construction does not measure what it claims to measure (B4 + B5), and F1's mitigation is not actionable for a test that cannot patch upstream features (B6).
One blocking promotion is required (B7: VS Code confirmation must be mandatory because that is the originally-observed environment).
Two smaller blocking gaps (B1: missing Dockerfile-element coverage; B2: Electron/Playwright cross-link to V3) are mechanical to fix.
Once those are resolved, the proposal is implementation-ready.

## Action Items

1. **[blocking, B3]** Fix line 142: whelm uses `localhost:5000/lace-empirical-test/whelm-cache:latest`, not `weftwise-cache:latest`. This contradicts every other reference in the document and would invalidate Scenario D if executed verbatim.

2. **[blocking, B4]** Rewrite Scenario D's framing or design. As constructed, the treatment branch (per-project cache images) does not face the same collision the control branch does (shared `lace.local` tag), so the comparison `step 6 - step 4 vs. step 3 - step 1` is between unlike mechanisms. Either: (a) add a Scenario D2 with shared cache image to test treatment robustness to push-collisions, or (b) reframe D as "treatment eliminates the collision class by construction; the test confirms separation rather than measures contention" and remove the apples-to-apples claim.

3. **[blocking, B5]** Reconsider whelm's treatment feature set in Scenario D. The proposed user-config trio (`neovim, nushell, claude-code`) is a strict subset of weftwise's features, so collision/contention with weftwise's cache would only ever produce subset-cache-reuse, not divergent layer chains. Either keep `lace-fundamentals` and `sprack` (and accept that lace-specific features are exercised in this scenario), or substitute features that diverge from weftwise's set.

4. **[blocking, B6]** Rewrite F1 mitigation. The current "disable `RUN --mount=type=bind` in feature install scripts" is not actionable for a test that cannot modify upstream feature code. Add docker-rootful as the primary fallback path, with explicit setup steps and the explanation that this distinguishes "upstream cache broken in podman" from "upstream cache broken everywhere."

5. **[blocking, B7]** Promote Phase 4 (VS Code confirmation) from optional to mandatory and reframe its purpose. VS Code is the originally-observed environment; if the CLI cache works but VS Code's wrapper does not, the RFP conclusion changes. Document upfront the workarounds for VS Code's "Reopen in Container with Configuration" path, since the proposal already admits manual override may be needed.

6. **[blocking, B1]** Add to the Dockerfile-Specific Considerations table: line 70-71 (`mkdir /workspaces /build`), line 73 (`WORKDIR /build`), lines 65-66 (`mkdir npm-global` + chown), lines 102-103 (npm env vars), and line 99 (`USER ${USERNAME}`). At minimum, label the npm and `/build` mkdir layers as "preserve, cache-cooperative" and call out the USER-switch boundary as the demarcation between root-installed system layers and node-installed user layers.

7. **[blocking, B2]** Cross-link the Electron/Playwright table rows (lines 88-89) to V3 (CACHED count). Specifically: if V3's count is between 1 and 5 (partial engagement), the report should record whether Electron + Playwright layers were among the cached set or among the busted set, since that distinguishes "cache works on cheap layers but not heavy ones" from "cache works on heavy layers but not features."

8. **[non-blocking]** Include the literal `registries.conf` insecure-registry stanza in Phase 1 step 3.

9. **[non-blocking]** Show how to extract `<built-image-sha>` for the cache-seeding step (line 271): use `podman images --format '{{.ID}}' --filter "label=devcontainer.metadata"`.

10. **[non-blocking]** Reconcile workspace path: line 93 says `/workspaces/weftwise`, line 222-223 says `/workspaces/weftwise/main`. Pick one and use consistently. (The bare-worktree convention in lace uses `/workspaces/weftwise/main` for an actual worktree subdirectory, so the JSON is correct; update the table.)

11. **[non-blocking]** Replace the absolute "7 min" Scenario A control budget (line 498) with "1.5x of measured control" to match the framing used for B/C/D, or document explicitly that A's budget is intentionally absolute because A is not a pass/fail factor.

12. **[non-blocking]** Add a "Feature Reuse (Scenario C)" table to the artefact template so the per-feature rebuild/cached datum is captured.

13. **[non-blocking]** Decide whether Scenario A is recorded in the artefact's timings table. The current proposal includes a row for A but A is excluded from pass/fail criteria. Either remove the row or add a column noting "context only, not pass/fail."

## Open Questions for the Author (multi-choice)

The reviewer surfaces these as multi-choice to unblock revision rather than block on clarification.

**Q1. Scenario D framing (relates to action items 2, 3):**
- (a) Add D2 with shared cache image (extends test by ~15-20 min but provides real treatment-side collision data).
- (b) Reframe D as "isolation by construction; the report confirms but does not measure contention" and remove the apples-to-apples comparison.
- (c) Drop Scenario D entirely; the cross-project collision is already known from the 2026-05-06 incident and the cache-isolation property is structurally obvious.

**Q2. F1 fallback strategy (relates to action item 4):**
- (a) Add docker-rootful as a primary fallback with explicit setup. Test runner installs Docker if F1 reproduces.
- (b) Add docker-rootful as a *deferred* fallback; if F1 reproduces, declare infeasible-on-podman, escalate to a follow-up test.
- (c) Keep the proposal as-is (F1 -> infeasible -> stop), and accept that the test cannot distinguish podman-specific from upstream-specific failures.

**Q3. Phase 4 promotion (relates to action item 5):**
- (a) Mandatory, with documented VS Code workarounds upfront.
- (b) Mandatory only if CLI test passes (the "did it transfer to VS Code" question only matters if we have a positive CLI result to transfer).
- (c) Keep optional; VS Code uses the same `@devcontainers/cli` library underneath and the BLUF NOTE captures this risk adequately.

**Q4. whelm treatment feature set (relates to action item 3):**
- (a) Keep `lace-fundamentals` + `sprack` in whelm's treatment config; accept that lace-specific features are exercised but document that this is intentional.
- (b) Substitute a non-lace feature that whelm uses but weftwise does not (none obvious from the current configs).
- (c) Drop Scenario D's whelm side and use a synthetic minimal "different" project; this loses ecological validity but ensures divergent layer chains.
