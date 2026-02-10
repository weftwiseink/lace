---
review_of: cdocs/proposals/2026-02-09-symmetric-prebuild-port-binding.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T22:30:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, architecture, ports, prebuild, symmetric, feature_promotion, correctness, install_idempotency]
---

# Review: Symmetric Prebuild Port Binding (R1)

## Summary Assessment

This proposal aims to replace asymmetric auto-injection for prebuild features with symmetric injection plus feature promotion. The investigation of the devcontainer feature lifecycle and the wezterm-server `install.sh` is thorough and accurate. However, the proposal contains a critical self-contradiction: E7 reveals that symmetric port mapping (`22430:22430`) is broken for the primary use case (wezterm-server + sshd) because sshd listens on port 2222, not the lace-allocated port. The proposal acknowledges this in E7 but then defers the fix to an "optional, recommended" Phase 5 (`install.sh` modification). Without Phase 5, the symmetric mapping produces a non-functional container -- host port 22430 maps to container port 22430 where nothing is listening. This means Phase 5 is not optional; it is a prerequisite for the core proposal to work. Additionally, the feature promotion mechanism introduces a significant performance regression (re-downloading ~50MB of binaries on every `devcontainer up`) that undermines the purpose of prebuilding. Verdict: **Revise** with two blocking issues and several non-blocking observations.

## Section-by-Section Findings

### BLUF

The BLUF is clear and well-structured. It accurately identifies the two flaws in the asymmetric design. However, it overstates the case for "Flaw 1" -- see the detailed finding below.

### Background: Flaw 1 -- "The devcontainer CLI DOES reinstall features"

**[blocking]** The claim that the devcontainer CLI "does reinstall features" is technically correct but misleading in context. The CLI does not "detect that a feature is already installed and re-run it." Rather, it always runs every feature in the `features` block as a Docker RUN layer, regardless of what is already in the image. This is not "reinstallation" -- it is a fresh install that happens to run on top of a layer where the same binaries already exist.

The critical nuance the proposal misses: **this is the exact behavior that lace's prebuild pipeline was designed to avoid.** The entire point of `prebuildFeatures` is to pre-bake features into the image so they do NOT run again at container creation time. Feature promotion undoes this optimization by moving the feature back into the `features` block, causing `install.sh` to run every time `devcontainer up` is called.

For wezterm-server, `install.sh` downloads a .deb from GitHub releases and extracts binaries on every run:

```sh
curl -fsSL -o /tmp/wezterm.deb \
    "https://github.com/wez/wezterm/releases/download/${VERSION}/${DEB_NAME}"
dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract
install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/
install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/
```

This network fetch occurs on every container build, defeating the prebuild cache for this feature. The proposal's "Cost of feature promotion" section acknowledges this ("downloads a .deb and extracts binaries (~5-10 seconds)") but underestimates the impact: network failures, GitHub rate limiting, and offline development environments all make this fragile. The prebuild exists precisely to avoid this fragility.

**Suggestion:** If feature promotion is pursued, `install.sh` should be made idempotent in a stronger sense: skip the download if the correct version is already installed (`wezterm-mux-server --version` check). This should be Phase 0, not Phase 5.

### Background: Flaw 2 -- sshPort is metadata-only

The analysis here is accurate and well-verified against the source. Confirmed: `install.sh` only reads `VERSION` and `CREATERUNTIMEDIR`. The `sshPort` option is purely lace metadata.

### E7: The sshPort metadata-only concern

**[blocking]** This is the central correctness issue. The proposal identifies four approaches (a-d) and recommends (b) -- modifying `install.sh` to configure sshd. But this recommendation is placed in Phase 5 as "optional, recommended." The proposal's own E1 analysis admits the problem:

> **Note:** The symmetric mapping `22430:22430` requires that something listens on port 22430 inside the container. For wezterm-server, the actual SSH listener is the sshd feature, which defaults to port 2222.

Without Phase 5, the pipeline produces `appPort: ["22430:22430"]`, which maps to a port where nothing is listening. The container is non-functional -- the exact same failure mode the original prebuild-features-port-support proposal was designed to fix.

Phase 5 cannot be "optional" -- it is the prerequisite for symmetric mapping to work at all for wezterm-server. The proposal needs to either:

1. Make Phase 5 mandatory (Phase 1, actually) and gate the symmetric refactor on the `install.sh` change, or
2. Adopt approach (d): symmetric injection for port allocation + metadata, but do NOT auto-generate symmetric `appPort` entries for prebuild features. Let the user provide `appPort` with the correct container port. This is a hybrid: the injection is symmetric, the `appPort` generation acknowledges the metadata-only nature of the port label.
3. Introduce a metadata field in `customizations.lace.ports` that distinguishes "real port options" (consumed by install.sh) from "routing labels" (metadata-only). Auto-generation of `appPort` only applies to real port options.

Option 2 is the most honest: it achieves symmetric injection (the user's request) without pretending that the container port equals the host port when it does not. The user still writes one explicit `appPort` entry, but the rest of the port pipeline (allocation, forwardPorts, portsAttributes) is fully symmetric and automatic.

### E9: Feature promotion with non-port options

The analysis correctly identifies that promotion copies ALL options including non-port ones like `version`. However, this has a subtle interaction with the prebuild pipeline that is not analyzed.

**[non-blocking]** When the prebuild installs wezterm-server with `version: "20240203-110809-5046fc22"` and the promotion also specifies this version, the re-run downloads the exact same .deb. But what if the user changes the version in `prebuildFeatures`? The prebuild cache invalidates and rebuilds with the new version. But the promoted feature in the extended config also has the new version, so `install.sh` runs again during `devcontainer up`. Both the prebuild and the promotion install the same version -- the promotion is redundant. This is correct but wasteful. Consider noting that promotion is always redundant for options that `install.sh` actually consumes (binaries are already installed by prebuild), and only non-redundant for options that `install.sh` does NOT consume (like `sshPort` in a hypothetical updated `install.sh`).

### D3: Unconditional promotion for port-declaring features

**[non-blocking]** The rationale is weak. The decision says "all port-declaring features need symmetric appPort entries to function." But E2 shows a case where a port-declaring feature has a static user-provided value and no auto-generated appPort. In that case, promotion still runs, causing the feature's `install.sh` to re-run. The promotion is pointless for this case: the user has opted out of port management, and no symmetric appPort entry is generated. Consider making promotion conditional on whether auto-injection was active (i.e., whether the `injected` list contains the feature's port label). This would avoid unnecessary `install.sh` re-runs when the user has opted out of auto-injection.

### D4: Idempotent install.sh as a precondition

The claim that "the devcontainer spec expects features to be idempotent" appears to be an extrapolation. The web search results mention that "Feature scripts are designed to be idempotent" but this seems to be a community expectation rather than a formal spec requirement. The devcontainer features spec at containers.dev does not explicitly require idempotency.

**[non-blocking]** The practical concern is real: wezterm-server's `install.sh` is technically idempotent (it overwrites binaries if they exist), but it is not efficient-idempotent (it re-downloads and re-extracts every time). For features with destructive or slow install scripts, promotion could cause unexpected behavior. Document this risk more explicitly.

### Step 2: promotePortDeclaringPrebuildFeatures code sketch

**[non-blocking]** The code sketch promotes features into `config.features` but does NOT remove them from `config.customizations.lace.prebuildFeatures`. The extended config will contain the same feature in both blocks. While `validateNoOverlap` does not run against the extended config, the devcontainer CLI might behave unexpectedly with duplicate entries. Consider either removing promoted features from `prebuildFeatures` in the extended config, or documenting that the devcontainer CLI ignores the `customizations.lace.prebuildFeatures` block entirely (since it is a lace-specific key, not a devcontainer spec key).

### Step 3: Removing warnPrebuildPortFeaturesStaticPort

**[non-blocking]** The justification for removal is "behavior is identical to features." But E2 shows that promotion still happens for static-port features, which means `install.sh` re-runs even though the user opted out of port management. The old warning was valuable precisely because it told users "you have a port-declaring feature with a static value and no appPort." That information is still relevant in the symmetric design. Consider keeping a simplified version of this warning rather than removing it entirely.

### Test Plan

The test plan is comprehensive and well-structured. The T1-T5 tests correctly verify the symmetric injection behavior. The T6-T8 tests cover the new promotion function. One gap:

**[non-blocking]** No test verifies the interaction between promotion and the extended config's JSON output. T12 checks that the generated config has wezterm-server in `features`, but does not verify that the `prebuildFeatures` block is also present (or absent) in the generated config. The behavior of the devcontainer CLI with a feature in both blocks of the extended config should be tested or documented.

### Implementation Phases

The phasing is logical but Phase 5 being "optional" is the core problem (see E7 finding above). The phases also omit a critical step: updating wezterm-server's `install.sh` to be efficiently idempotent (skip download if version matches). Without this, every `devcontainer up` incurs a network roundtrip to GitHub releases.

### Cost of feature promotion

The costs are acknowledged but the mitigations are insufficient:

1. "~5-10 seconds" assumes fast network. On slow networks or behind corporate proxies, the .deb download could take 30+ seconds or fail entirely.
2. "~30MB of binaries" -- this adds 30MB to every container, doubling the wezterm footprint. For resource-constrained environments, this matters.
3. The proposal does not address the case where GitHub releases are unavailable (rate limiting, outages, offline development). The prebuild makes the container self-contained; promotion undoes this.

## Verdict

**Revise.** Two blocking issues require resolution:

1. **E7 / Phase 5 dependency**: Symmetric mapping (`22430:22430`) is non-functional for the primary use case without Phase 5's `install.sh` modification. Phase 5 must be mandatory, or the proposal must adopt approach (d) from E7 -- symmetric injection for allocation but no symmetric `appPort` auto-generation for metadata-only port labels.

2. **Feature promotion performance regression**: Promoting a prebuild feature to the `features` block causes `install.sh` to re-run on every `devcontainer up`, defeating the prebuild cache for that feature. The proposal must either (a) make `install.sh` efficiently idempotent (skip download if version matches) as a prerequisite, or (b) reconsider whether feature promotion is the right mechanism, or (c) quantify and explicitly accept the regression with user-facing documentation.

## Action Items

1. **[blocking]** Resolve the E7 metadata-only port correctness issue. Either make Phase 5 mandatory (and sequence it before the symmetric refactor), or adopt approach (d) from E7 where symmetric injection handles allocation but `appPort` auto-generation for prebuild features uses the feature's default container port. The current proposal produces non-functional containers for the primary use case.

2. **[blocking]** Address the feature promotion performance regression. At minimum, modify wezterm-server's `install.sh` to skip the download when the correct version is already installed (`wezterm-mux-server --version` check before `curl`). Better: analyze whether promotion is the right mechanism at all, given that it undermines the core value proposition of prebuilding.

3. **[non-blocking]** Consider making promotion conditional on auto-injection being active (skip promotion when user has opted out with a static port value and no `${lace.port()}` template).

4. **[non-blocking]** Address whether promoted features should be removed from `prebuildFeatures` in the extended config to avoid the devcontainer CLI seeing them in both blocks.

5. **[non-blocking]** Add a test case verifying the full JSON structure of the extended config after promotion (feature present in `features`, status in `prebuildFeatures`).

6. **[non-blocking]** Consider introducing a `containerPort` field in `customizations.lace.ports` metadata to distinguish the container-side port from the allocation label. This would allow symmetric injection for allocation while generating correct asymmetric `appPort` entries from metadata alone, without requiring `install.sh` modification.
