---
review_of: cdocs/proposals/2026-02-14-mount-template-variables.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:59:00-08:00
task_list: lace/template-variables
type: review
state: live
status: done
tags: [rereview_agent, action_item_verification, codebase_accuracy, mount-resolver, template-variables, internal_consistency]
---

# Review R3: Mount Template Variables (Action Item Verification)

## Summary Assessment

This is a verification review confirming that all 8 non-blocking action items from R2 have been addressed in the revised proposal.
The proposal is comprehensive, well-structured, and accurately grounded in the codebase.
The most notable finding is a minor internal contradiction between two sections regarding `LACE_MOUNT_SOURCE_FULL_MATCH`: one section says it is not defined, while another section lists it as a Phase 2 deliverable.
Verdict: **Accept**.

## Prior Review Action Item Resolution

### R2 Action Items Status (All 8 Verified)

1. **[non-blocking] MountPathResolver parameter on resolveTemplates() should be optional.**
Resolved.
Line 341 declares `mountResolver?: MountPathResolver` with the `?` suffix.
Line 348 reinforces: "The parameter is optional so that existing callers and Phase 2 tests work without `up.ts` changes."
Line 349 specifies the behavior when undefined: "any `${lace.mount.source()}` expression that passes the unknown-pattern guard is left as a literal string (no resolution, no error)."

2. **[non-blocking] walkAndResolve() and resolveStringValue() signature propagation noted.**
Resolved.
Line 350: "The resolver propagates through the internal call chain: `walkAndResolve()` and `resolveStringValue()` both gain the optional `mountResolver` parameter."
This is a single sentence that makes the propagation requirement explicit without over-specifying the implementation.

3. **[non-blocking] Test case for unresolved `${lace.mount.target()}` expressions in Phase 1-3.**
Resolved.
Template resolution test case 9 (lines 582-583): "Unresolved target expression: `${lace.mount.target(foo/bar)}` with no mount resolver (or no target resolver in Phases 2-4) passes through the unknown-pattern guard but is left as a literal string in the output.
This verifies the guard relaxation does not accidentally swallow target expressions before the target resolver exists."
The test description is precise and covers the correct semantics.

4. **[non-blocking] Doubled "lace" in default paths acknowledged.**
Resolved.
Lines 297-299 add a NOTE callout: "The doubled 'lace' in `~/.config/lace/lace/mounts/...` is a cosmetic quirk of the lace project having `lace` as both the config directory name and the `deriveProjectId()` output."
The NOTE also explains why it should not be "fixed" (consistency with repo clone paths) and gives a counter-example (`dotfiles` producing `~/.config/lace/dotfiles/mounts/...`).

5. **[non-blocking] Missing override path changed from warning to hard error.**
Resolved.
Lines 521-524 in the "Override Path Does Not Exist" edge case now specify a hard error: "lace throws a hard error, consistent with the repoMounts system where `resolveOverrideRepoMount()` in `mounts.ts` throws `MountsError` for missing override sources."
I verified this against the codebase: `resolveOverrideRepoMount()` at `mounts.ts` line 212 does `if (!existsSync(override.source)) { throw new MountsError(...) }`.
The proposal's rationale (line 523-524) is sound: "a missing path is almost certainly a misconfiguration. Silently proceeding would cause Docker to create a root-owned directory."

6. **[non-blocking] Story 3 typo fixed.**
Resolved.
Line 474 now reads `source=<resolved>,target=/home/node/.claude,type=bind` with a comma separator, not a forward slash.

7. **[non-blocking] Pattern introduction phasing clarified.**
Resolved.
The Regex Patterns section (lines 206-221) is split into "Phase 2 (mount source resolution)" and "Phase 5 (mount target resolution)" subsections.
Lines 219-220 explicitly state that `LACE_UNKNOWN_PATTERN` is relaxed in Phase 2 to include *both* `mount\.source\(` and `mount\.target\(` lookaheads, "even though target resolution is not implemented until Phase 5."
This cleanly separates the guard relaxation (Phase 2) from the resolution implementation (Phase 5).

8. **[non-blocking] Settings loading hoist noted in Phase 3 constraints.**
Resolved.
Phase 3 constraints (lines 720-723) now state: "Settings are loaded once and shared between mount resolution and repo mount resolution.
Currently `runResolveMounts()` loads settings internally via its own call to `loadSettings()`.
Phase 3 should hoist the `loadSettings()` call to `runUp()` level so the result can be passed to both `MountPathResolver` and `runResolveMounts()`.
This requires adding a `settings` parameter to `runResolveMounts()` (or its options interface) to avoid double-loading."
I verified this against the codebase: `runResolveMounts()` at `resolve-mounts.ts` line 108 does call `loadSettings()` internally. The proposed hoist is accurate.

All eight R2 action items are fully addressed.

## New Findings from Revisions

### LACE_MOUNT_SOURCE_FULL_MATCH: Internal Contradiction

Line 242 states: "No `LACE_MOUNT_SOURCE_FULL_MATCH` pattern is defined; one can be added later if standalone-expression validation becomes necessary."

Line 675 (Phase 2 file changes) states: "Add `LACE_MOUNT_SOURCE_PATTERN`, `LACE_MOUNT_SOURCE_FULL_MATCH` constants."

These two statements directly contradict each other.
The first says the pattern is intentionally deferred; the second lists it as a Phase 2 deliverable.

**Non-blocking.**
Given that mount expressions always resolve to strings (no type coercion), the `FULL_MATCH` pattern has no functional use in Phase 2.
The resolution order section (lines 240-242) is correct: no `FULL_MATCH` is needed.
The Phase 2 bullet at line 675 should be updated to remove the `LACE_MOUNT_SOURCE_FULL_MATCH` reference.
An implementer following Phase 2 literally would define a pattern that is never used.

### Phase Numbering Ambiguity: Rollout vs. Implementation

The BLUF (line 25) uses a three-phase "rollout" numbering: "Phase 1 delivers `${lace.mount.source()}`, Phase 2 adds feature mount declarations, Phase 3 adds `${lace.mount.target()}`."

The resolveStringValue() section (line 239) says mount target resolution is "Phase 3."

The Implementation Phases section (line 752) calls mount target resolution "Phase 5."

These are two different numbering systems: the BLUF uses a rollout phase numbering (1-3) while the implementation section uses a six-phase delivery numbering (1-6).
The resolveStringValue() section at line 239 uses the rollout numbering ("Phase 3") where it should reference the implementation phase ("Phase 5") for internal consistency with the rest of the document body.

**Non-blocking.**
The Pipeline Integration section (line 331) and Phase 4/5 headings (lines 725, 752) correctly annotate the relationship: "Phase 4: Feature Mount Declarations (Phase 2 of Rollout)" and "Phase 5: `${lace.mount.target()}` Resolution (Phase 3 of Rollout)."
The ambiguity at line 239 is a minor labeling inconsistency rather than a structural problem.

### Error Message Update Not Noted

The current `resolveStringValue()` at `template-resolver.ts` line 303-305 throws an error with the message: "The only supported template is `${lace.port(featureId/optionName)}`."

After mount template support is added, this message becomes factually incorrect.
The proposal does not mention updating this error message.

**Non-blocking.**
An implementer would naturally update the error message when modifying `resolveStringValue()`, but noting it in Phase 2's file changes would prevent oversight.

### Codebase Accuracy Spot Check

I verified the following proposal claims against the current codebase:

- `LACE_PORT_PATTERN` at line 33 of `template-resolver.ts`: confirmed.
- `LACE_UNKNOWN_PATTERN` at line 34: confirmed.
- `resolveStringValue()` at line 294: confirmed.
- `autoInjectPortTemplates()` at line 120: confirmed.
- `resolveTemplates()` signature at lines 230-233 taking `(config, portAllocator)`: confirmed.
- `LaceSettings` interface at `settings.ts` line 10 with only `repoMounts?`: confirmed.
- `RepoMountSettings` interface at `settings.ts` line 19: confirmed.
- `resolveOverrideRepoMount()` throws `MountsError` for missing override source at `mounts.ts` line 212-214: confirmed.
- `runResolveMounts()` loads settings internally at `resolve-mounts.ts` line 108: confirmed.
- `deriveProjectId()` at `repo-clones.ts` line 28: confirmed.
- Mount strings in `.devcontainer/devcontainer.json` at lines 75-84: confirmed (the proposal's line reference says "lines 75-84" which matches the actual file).
- `walkAndResolve()` and `resolveStringValue()` parameter lists at `template-resolver.ts` lines 255-260 and 294-298: confirmed. Both currently take `(value, featureIdMap, portAllocator, allocations)` without a mount resolver parameter.

All codebase references are accurate.

## Verdict

**Accept.**

All 8 R2 action items are resolved.
The three new findings are non-blocking: an internal contradiction in one bullet point (FULL_MATCH), a minor phase numbering ambiguity, and an omitted error message update.
None of these affect the soundness of the design or would block an implementer.
The proposal is ready for implementation.

## Action Items

1. [non-blocking] Remove `LACE_MOUNT_SOURCE_FULL_MATCH` from Phase 2's "Files to modify" bullet at line 675, or reconcile with line 242 which says it is intentionally not defined.
2. [non-blocking] Update line 239 from "Phase 3" to "Phase 5" for mount target resolution, to align with the implementation phase numbering used throughout the rest of the document body.
3. [non-blocking] Note in Phase 2's file changes that the error message in `resolveStringValue()` ("The only supported template is `${lace.port(featureId/optionName)}`.") should be updated to include mount templates.
