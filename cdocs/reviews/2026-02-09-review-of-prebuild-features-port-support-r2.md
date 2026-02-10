---
review_of: cdocs/proposals/2026-02-09-prebuild-features-port-support.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T19:15:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, rereview_agent, architecture, ports, prebuild, pipeline_correctness]
---

# Review: Prebuild Features Port Support (R2)

## Summary Assessment

The R1 revision addresses all three blocking issues. The auto-injection write-back now correctly uses separate block iteration with direct references (not a merged copy). D5 and E8 have been corrected to accurately describe the prebuild-reads-from-disk data flow. The diagnostic warning has been narrowed to fire only on the static-port-without-appPort case. All non-blocking suggestions from R1 were also applied. Verdict: **Accept**.

## Prior Action Items Status

1. **[blocking] Auto-injection write-back** -- RESOLVED. Step 2 now iterates `features` and `prebuildFeatures` separately via `injectForBlock()`, writing directly to each block's reference. The code sketch is correct: `block[fullRef]` mutates the original config object because `features` and `prebuildFeatures` are references, not copies.

2. **[blocking] Diagnostic warning** -- RESOLVED. D4 and Step 4 now clearly specify the condition: fires only when the user has set a static port value (opting out of auto-injection) AND has no `appPort` entry. The example warning message is actionable. Pipeline timing is specified (after auto-injection).

3. **[blocking] D5 and E8 correction** -- RESOLVED. D5 now correctly states that the prebuild reads from disk and does not see auto-injected values. E8 is retitled and correctly states that port reassignment does NOT invalidate prebuild cache. The NOTE in D5 reinforces this.

4. **[non-blocking] validateNoOverlap NOTE** -- APPLIED. Added in Step 1.

5. **[non-blocking] T5 two-step clarification** -- APPLIED. T5 now explicitly describes the inject-then-resolve sequence.

6. **[non-blocking] warnPrebuildPortTemplates clarification** -- APPLIED. The entry now correctly states that the new behavior is resolution succeeding rather than failing validation.

## Section-by-Section Findings (R2)

### Step 2: Auto-injection (revised)

The `injectForBlock()` helper is clean and the separation-of-concerns is clear. One subtlety worth noting: `extractPrebuildFeaturesRaw()` must return a **direct reference** to the nested object in the config (not a fresh empty object that has no connection to the config). The proposal states this requirement explicitly ("returns a direct reference ... not a copy, or an empty object if absent"). The "empty object if absent" case is safe because writing to an empty object that is not in the config has no effect -- there are no features to iterate over. **No issue.**

### D5: Prebuild pipeline data flow (revised)

The revised explanation is accurate. One subtle point is well-handled: the claim that "the devcontainer CLI receives this extended config via `devcontainer up --config .lace/devcontainer.json`, and it overrides the feature's default with the resolved port value at container start time." This is correct because the extended config includes the feature with the resolved port in the `features` block (since `configForResolution` is what feeds `generateExtendedConfig`).

> NOTE: Actually, there is a nuance here worth examining. The extended config is generated from `templateResult.resolvedConfig`, which was cloned from `configMinimal.raw`. The resolved config contains both `features` (top-level) and `customizations.lace.prebuildFeatures` with any auto-injected-then-resolved values. When `devcontainer up` runs with the extended config, it processes the top-level `features` key. If a feature is ONLY in `prebuildFeatures` (not in top-level `features`), the devcontainer CLI does not install it at runtime -- it was already baked into the prebuild image. The resolved port value in the prebuild feature options within the extended config is essentially dead data that the devcontainer CLI ignores.

**Non-blocking:** This means the port value resolves in the extended config's `prebuildFeatures` block but is never consumed by the devcontainer CLI (which only reads top-level `features`). The actual port configuration that matters is in `appPort`, `forwardPorts`, and `portsAttributes` -- which ARE in the top-level config and ARE consumed. The feature inside the container uses its default port (from the prebuild image), and the `appPort` entry maps the host port to it. For symmetric auto-injection (host port = container port), this works because the feature receives the resolved port as its option value... but wait -- for prebuild features, the feature was installed with the DEFAULT value (e.g., 2222), not the resolved value. The symmetric mapping `22430:22430` would map host 22430 to container 22430, but sshd inside the container is listening on 2222 (the default from the prebuild image).

This is a **potential correctness issue** with the symmetric auto-injection case for prebuild features. Let me check more carefully.

For top-level `features`, the devcontainer CLI installs the feature at runtime and passes the resolved option value (e.g., `sshPort: 22430`). The feature's install script configures sshd to listen on 22430. The symmetric mapping `22430:22430` works.

For `prebuildFeatures`, the feature was installed at prebuild time with the default value (`sshPort: "2222"`). The prebuild image has sshd configured for port 2222. At runtime, `devcontainer up` with the extended config does NOT reinstall the feature (it is already in the image). The resolved value `sshPort: 22430` in the extended config's `prebuildFeatures` block is not consumed. The container has sshd on port 2222, but the symmetric `appPort` maps `22430:22430`. Host port 22430 maps to container port 22430, where nothing is listening. **The symmetric mapping is broken for prebuild features.**

**Blocking:** The proposal's E6 scenario (the primary fix target) claims symmetric `appPort: ["22430:22430"]` works for a prebuild feature. This is incorrect. The feature was installed at prebuild time with default port 2222. The symmetric mapping maps to the wrong container port. The fix must either:

(a) Generate an asymmetric mapping for prebuild features (`22430:2222`, using the feature's default port as the container port), or
(b) Document that prebuild features with ports require explicit `appPort` with asymmetric mapping (auto-injection alone is insufficient), or
(c) Ensure the resolved port value somehow propagates to the feature at runtime (e.g., by promoting prebuild features with resolved ports to the top-level `features` key in the extended config, causing reinstallation with the correct port).

Option (b) is the simplest and most honest: acknowledge that auto-injection produces symmetric mappings, which only works for features installed at runtime (top-level `features`). For `prebuildFeatures`, users must provide explicit `appPort` with the correct container port. The diagnostic warning (Phase 5) already targets this case, but the proposal currently claims auto-injection alone fixes E6.

Option (a) would require the port pipeline to know the feature's default port value, which is available in the metadata. This adds complexity but would make prebuild features fully transparent.

## Verdict

**Revise.** One blocking issue discovered during R2:

The symmetric auto-injection mapping (`port:port`) is incorrect for prebuild features because the feature was installed at prebuild time with its default port value, not the lace-allocated port. The `appPort` must map to the feature's actual container port (the default), not to the lace-allocated port.

## Action Items

1. **[blocking]** Address the symmetric mapping correctness issue for prebuild features. Either (a) generate asymmetric mappings using the feature's default port for prebuild features, (b) document that prebuild features require explicit `appPort`, or (c) promote port-declaring prebuild features to top-level `features` in the extended config. Update E6's expected behavior accordingly. This is the core correctness question of the proposal.
