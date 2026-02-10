---
review_of: cdocs/reports/2026-02-09-lace-port-allocation-investigation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T15:00:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, investigation, ports, architecture, validation-gap]
---

# Review: Lace Port Allocation Investigation

## Summary Assessment

This report investigates why the dotfiles devcontainer has no port mappings despite being started via `lace up`. The investigation is thorough, correctly identifying the root cause (wezterm-server placed exclusively in `prebuildFeatures` instead of `features`) and tracing the failure through the entire pipeline with code references and evidence from `docker inspect`. The recommendations are actionable. Two findings warrant revision: the report understates the severity of the validation gap, and the recommended fix does not account for the overlap validation constraint that prevents a feature from appearing in both `prebuildFeatures` and `features`.

**Verdict: Revise** -- one blocking issue with the recommended fix and one non-blocking clarification.

## Section-by-Section Findings

### BLUF

The BLUF is clear and accurate. It correctly identifies the root cause and the fix. Minor observation: the BLUF says "the dotfiles devcontainer was configured before this distinction was established" -- this is a plausible inference but unverified. The feature awareness v2 pipeline (which introduced the `features`-only processing) landed around Feb 6-7 based on the devlog dates, and the port-assignments.json was created on Feb 7. This timeline suggests the dotfiles config may have been created during the transition. **Non-blocking** -- the inference is reasonable even if not proven.

### Finding 3: Port-assignments.json is "orphaned"

The report correctly identifies that port 22426 was allocated but never consumed. However, it describes the file as "orphaned" which is slightly misleading. The file is not orphaned in the traditional sense (unreferenced). It is read by the `PortAllocator` on every `lace up` invocation -- the allocator loads from it at construction time (line 111 in port-allocator.ts). The issue is that the allocator is never asked to `allocate()` during the run, so the loaded data is unused. The port assignment would be consumed correctly if the config were fixed. **Non-blocking** -- the finding is substantively correct, just imprecise terminology.

### Finding 8: Validation gap

The report identifies that `warnPrebuildPortTemplates()` only catches `${lace.port()}` expressions in prebuildFeatures, not port-declaring features being placed there. This is accurate and is the most significant systemic finding. However, the report frames this as a warning-level gap. Given that this misconfiguration causes a completely silent failure (no error, no warning, container starts fine but is unreachable), this should be framed more strongly. A silent failure mode in the happy path is worse than a crash. **Non-blocking** -- framing suggestion, the technical content is correct.

### Recommended fix: Move wezterm-server to features

**Blocking.** The recommended fix correctly moves wezterm-server to the top-level `features` block. However, the report does not address a critical constraint: `validateNoOverlap()` in `validation.ts` (called from `prebuild.ts` line 101) rejects configurations where the same feature appears in both `prebuildFeatures` and `features`. This means the fix requires REMOVING wezterm-server from `prebuildFeatures`, not just adding it to `features`.

The report's recommended JSON does remove it from `prebuildFeatures`, so the example is correct. But the prose says "port-declaring features must ALSO appear in the `features` block" (Root Cause Analysis section, final paragraph). The word "ALSO" implies dual placement, which the overlap validator would reject. This should be corrected to say port-declaring features must appear in the `features` block INSTEAD OF `prebuildFeatures`.

This has a real consequence: wezterm-server will no longer be prebaked into the Docker image layer. It will be installed at container creation time (by the devcontainer CLI), making the first `lace up` slightly slower. The report should note this tradeoff. For the dotfiles container (minimal config, infrequent rebuilds), this is acceptable. But it represents an architectural tension in lace's design: features that need port allocation cannot benefit from prebuild image caching.

### Recommended defensive improvement: Warn on prebuild port-declaring features

The recommendation to fetch metadata for `prebuildFeatures` entries and check for `customizations.lace.ports` is sound but has a practical complication worth noting: fetching metadata for prebuild features would add network calls (OCI registry queries) to every `lace up` invocation, even when the user's config is correct and those features are properly in `prebuildFeatures` because they do NOT declare ports. This could be mitigated by making it a lightweight check (only fetch metadata for prebuild features that are also known port-declaring features from a registry cache), but the report should acknowledge the cost.

**Non-blocking** -- the recommendation is directionally correct. Implementation details can be worked out in a follow-up proposal.

### Appendix: Pipeline walkthrough

Clear and accurate. This is a useful reference for anyone debugging port allocation issues in the future. No issues found.

## Verdict

**Revise.** The report is high quality with a correct root cause diagnosis and solid evidence trail. One blocking issue must be addressed before acceptance.

## Action Items

1. **[blocking]** Correct the Root Cause Analysis paragraph that says "port-declaring features must ALSO appear in the `features` block" -- change "ALSO" to "INSTEAD OF `prebuildFeatures`" and note that `validateNoOverlap()` prevents dual placement. Add a brief note about the prebuild image caching tradeoff this creates (wezterm-server will be installed at container creation time rather than baked into the image layer).

2. **[non-blocking]** Soften "orphaned" language for port-assignments.json in Finding 3. The file is loaded but its data is unused in the current run. Suggest: "exists but its data is unused" rather than "orphaned."

3. **[non-blocking]** Strengthen the framing of Finding 8 (validation gap). The silent failure mode where the container starts successfully but is unreachable is arguably a more severe UX issue than a hard error. Consider noting that this is a pit-of-failure (easy to misconfigure, hard to debug) rather than just a "gap."

4. **[non-blocking]** In the defensive improvement recommendation, note that fetching metadata for prebuild features adds network overhead and should be designed carefully (e.g., lightweight check or local-only when possible).
