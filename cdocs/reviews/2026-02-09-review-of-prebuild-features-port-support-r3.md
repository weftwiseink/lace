---
review_of: cdocs/proposals/2026-02-09-prebuild-features-port-support.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T20:00:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, rereview_agent, architecture, ports, prebuild, asymmetric_injection, suppression_logic]
---

# Review: Prebuild Features Port Support (R3)

## Summary Assessment

The R2 revision addresses the critical blocking issue from R2: symmetric auto-injection is broken for prebuild features because the devcontainer CLI does not reinstall them at runtime. The proposal now correctly specifies asymmetric injection via `injectForPrebuildBlock()`, which injects `appPort` entries mapping the lace-allocated host port to the feature's default container port. The code sketches, edge cases, design decisions, and test plan are internally consistent with the asymmetric model. Verdict: **Accept** with non-blocking suggestions.

## Prior Action Items Status

1. **[blocking] Symmetric mapping correctness (R2)** -- RESOLVED. The proposal now specifies two injection paths: `injectForBlock()` for symmetric top-level features (unchanged) and `injectForPrebuildBlock()` for asymmetric prebuild features. D5 explains the rationale clearly: prebuild features are installed at image build time with defaults; the devcontainer CLI does not reinstall them. The asymmetric `appPort` entry (`${lace.port(...)}: DEFAULT_PORT`) correctly bridges the lace-allocated host port to the fixed container port. E6 now shows the correct asymmetric behavior (`22430:2222`).

## Section-by-Section Findings (R3)

### BLUF (revised)

Accurately summarizes the asymmetric vs symmetric distinction. The BLUF is dense but complete -- it correctly identifies that the asymmetric model is necessary because "prebuild features are installed at image build time with default option values; the devcontainer CLI does not reinstall them at runtime." **No issue.**

### Step 2: Auto-injection (revised with injectForPrebuildBlock)

The code sketch is correct. Verified against the actual source:

1. `injectForPrebuildBlock` iterates `prebuildFeatures` separately from `features`. No merged-copy write-back issue.
2. It reads `metadata.options?.[optionName]?.default` for the container port. The `FeatureMetadata` type in `feature-metadata.ts` confirms that `options` has `Record<string, FeatureOption>` with `default?: string | boolean`. For port options, the default is a string like `"2222"`.
3. It pushes the template string `"${lace.port(...)}: DEFAULT_PORT"` into `config.appPort`. Since `config` is the in-memory `configForResolution` (a `structuredClone` from line 205 of `up.ts`), this correctly mutates the clone without touching the original.
4. The `continue` guard when `!defaultPort` is correct -- if metadata has no default for the option, asymmetric injection cannot determine the container port. This is a defensive guard; in practice, well-formed features always declare defaults.

**Non-blocking observation:** The `injectForPrebuildBlock` skip condition checks `optionName in featureOptions`. For the dotfiles scenario (E6), the prebuild feature has no explicit `sshPort` value, so `featureOptions` is `{}` and injection proceeds. For E1 (`sshPort: "3333"`), `sshPort in featureOptions` is true and injection is skipped. Both are correct.

However, there is a subtle interaction: if a user sets `sshPort: "2222"` explicitly (matching the default), injection is still skipped because the `in` check does not distinguish between "explicitly set to default" and "not set." This is correct behavior -- the user made an explicit choice -- but it means the diagnostic warning (Step 4 / D4) must fire for this case.

### Step 3: Feature-ID map (unchanged from R1)

Still correct. `buildFeatureIdMap(allFeatures)` includes prebuild features, so `resolvePortLabel` can validate `${lace.port(wezterm-server/sshPort)}` when wezterm-server is only in `prebuildFeatures`.

### Step 4: Diagnostic warning (revised)

The warning condition is now well-specified: fires only for static-port opt-out in `prebuildFeatures` without `appPort`. This correctly covers the gap left by asymmetric auto-injection: when the user provides an explicit value, auto-injection does not fire, and without a manual `appPort`, the service has no host mapping. **No issue.**

### D2: Prebuild auto-injection targets appPort (revised)

Correctly explains why `appPort` (not feature options) is the right target for prebuild features. The reasoning chain is sound: prebuild options are consumed at build time, `appPort` is consumed at runtime, asymmetric mapping bridges the two. **No issue.**

### D5: Asymmetric auto-injection for prebuild features (new)

This is the key new design decision. The explanation is thorough and accurate. The specific failure mode is well-documented: symmetric `22430:22430` maps to an empty port because sshd listens on 2222 in the prebuild image. **No issue.**

### D6: No changes to prebuild pipeline (renumbered from D5)

Accurately describes the disk-read separation. The NOTE about prebuild cache stability is correct and desirable. **No issue.**

### E2: ${lace.port()} template in prebuild feature option (revised)

The added NOTE correctly identifies this as a misconfiguration and references `warnPrebuildPortTemplates()`. One subtlety: after this proposal, the template WILL resolve successfully (because the feature-ID map includes prebuild features), but the resolved value is dead data in the extended config. The `warnPrebuildPortTemplates()` warning runs BEFORE resolution and correctly alerts the user. **No issue.**

### E6: Primary fix target (revised)

Now correctly shows asymmetric behavior: `appPort` is `"22430:2222"`, not `"22430:22430"`. The suppression logic in `generatePortEntries` is verified against the source: `String(entry).startsWith("22430:")` returns true for `"22430:2222"`, so the symmetric auto-generated entry is suppressed. **No issue.**

### E3: Explicit appPort with prebuild feature

The interaction with the skip condition is correct. When the user writes `sshPort: "2222"` AND provides an explicit `appPort` template, auto-injection skips (user provided `sshPort`), but template resolution still resolves the `appPort` template because the feature-ID map includes prebuild features. **No issue.**

### Test Plan (revised)

T1, T5, and T9 correctly specify asymmetric expectations. T1 verifies that feature options are NOT modified and `appPort` receives the asymmetric entry. T5 verifies the two-step inject-then-resolve sequence. T9 verifies the full pipeline produces asymmetric `appPort` in the generated config.

**Non-blocking:** Consider adding a test case for the `!defaultPort` guard: a prebuild feature whose metadata has a port declaration but whose corresponding option has no `default` value. The current code `continue`s silently. This is an unusual edge case (well-formed features always have defaults) but a test documenting the behavior would be valuable.

### Phase 3: Acceptance criteria (potential inconsistency)

Phase 3 acceptance criteria state: "Template values written to correct block (not moved between blocks)." For prebuild features, auto-injection writes to `appPort` (a top-level key), not to the prebuild feature block. This phrasing could be misleading -- it sounds like it is about writing to `features` vs `prebuildFeatures`, but for prebuild features the target is actually `appPort`. **Non-blocking:** Consider rewording to: "Top-level features: templates written to feature options. Prebuild features: asymmetric appPort entries written to top-level appPort array."

### Interaction section: "Explicit appPort templates referencing prebuild features"

The sentence "auto-injection detects the user's explicit sshPort value (or the pre-existing appPort template) and skips injection" has a subtle point. The skip logic in `injectForPrebuildBlock` only checks `optionName in featureOptions` -- it does NOT check for pre-existing `appPort` entries. If the user provides an explicit `appPort` template but leaves the feature option unset, both auto-injection AND the user template would produce `appPort` entries, potentially resulting in duplicate mappings.

However, checking the actual flow: if the user has `appPort: ["${lace.port(wezterm-server/sshPort)}:2222"]` but no `sshPort` in the feature options, `injectForPrebuildBlock` would inject ANOTHER `appPort` entry `"${lace.port(wezterm-server/sshPort)}:2222"`. After resolution, `appPort` would contain two entries: `["22430:2222", "22430:2222"]`. After `mergePortEntries`, the symmetric auto-generated entry is suppressed (because `hasUserAppPort` sees `22430:`), but there would be duplicate user entries.

**Non-blocking:** This is a cosmetic issue (duplicate identical entries have no runtime effect), but the "skips injection" claim is inaccurate for this specific case. Consider either: (a) adding a check in `injectForPrebuildBlock` that skips injection when `appPort` already contains a template referencing this label, or (b) noting that duplicate entries are harmless and cleaned up naturally.

## Verdict

**Accept.** The R2 blocking issue (symmetric mapping broken for prebuild features) is fully resolved. The asymmetric injection model is correct: `injectForPrebuildBlock` injects `appPort` entries with the feature's default container port, `generatePortEntries` correctly suppresses symmetric entries when asymmetric entries exist, and the test plan covers the critical paths. The design decisions are well-reasoned and the edge cases are thorough.

## Action Items

1. **[non-blocking]** Consider adding a test for the `!defaultPort` guard in `injectForPrebuildBlock` (prebuild feature with port declaration but no default value in metadata).
2. **[non-blocking]** Reword Phase 3 acceptance criteria to distinguish between "feature option injection" (top-level) and "appPort injection" (prebuild).
3. **[non-blocking]** Address the potential duplicate `appPort` entry when user provides both an explicit `appPort` template and leaves the feature option unset. Either add a skip check or document that duplicates are harmless.
