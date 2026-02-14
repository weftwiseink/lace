---
review_of: cdocs/proposals/2026-02-14-mount-template-variables.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:55:00-08:00
task_list: lace/template-variables
type: review
state: live
status: done
tags: [rereview_agent, architecture, test_plan, implementation_phases, codebase_accuracy, design_decisions, mount-resolver]
---

# Review R2: Mount Template Variables (Full Proposal)

## Summary Assessment

This proposal elaborates the prior RFP into a concrete implementation plan for `${lace.mount.source()}` and `${lace.mount.target()}` template variables, modeled on the existing port allocation system.
The document is well-structured: it resolves the R1 blocking finding (Section 3 vs Section 9 contradiction) decisively, provides a clear phased implementation with file-level change lists, and grounds design decisions in codebase specifics.
The most significant remaining concern is an inaccuracy in the `resolveTemplates()` signature proposal: it omits the `featureIdMap` parameter and introduces a `MountPathResolver` dependency at a level that may not need it, creating unnecessary coupling.
Verdict: **Accept** with non-blocking suggestions.

## Prior Review Action Item Resolution

### R1 Action Items Status

1. **[blocking] Section 3 vs Section 9 contradiction**: Resolved.
The "Decision: User-Authored Templates Have Implicit Consent" section cleanly separates user-authored templates (implicit consent) from feature-declared mounts (settings-based consent in Phase 2).
The key sentence: "Section 3's 'default source' is an unconditional default for user-authored templates, while Section 9's consent applies to feature-declared mounts only."
This is the correct resolution.

2. **[non-blocking] Structured output proposal status**: Resolved.
The Background section explicitly notes `status: rejected` for the structured output proposal and states "the `DevcontainerMount` type cannot be assumed to exist."
The "Decision: String-Format Output" section reaffirms this.

3. **[non-blocking] MVP scope promotion**: Resolved.
The phased rollout in the BLUF and the six implementation phases make the scope boundary concrete.
Phase 1-3 deliver the MVP (`${lace.mount.source()}` for project-level mounts only), Phases 4-6 are extensions.

4. **[non-blocking] Reclassify namespace guard as prerequisite**: Resolved.
The Regex Patterns section presents `LACE_UNKNOWN_PATTERN` relaxation as a concrete implementation step, not an open question.

5. **[non-blocking] Option C exclusion**: Resolved.
The "Decision: Option B" section states Option C is "non-viable" with a specific citation to the `additionalProperties: false` constraint.

6. **[non-blocking] Consent model UX in `lace up`**: Resolved.
The "Decision: Feature Consent via Settings Configuration, Not Interactive Prompts" section is definitive: no interactive prompts, `settings.json` is the consent mechanism.
The rationale (lace up is non-interactive, breaks automation/CI) is sound.

7. **[non-blocking] RepoMountSettings reference**: Resolved.
The Background section explicitly references the `RepoMountSettings` interface at `settings.ts` line 19 and the NOTE in that section ties it to the mount template variable settings pattern.

8. **[non-blocking] Scenario 4 exclusion**: Resolved.
The "Excluded from scope" subsection in the Concrete Before/After section definitively excludes the WezTerm config mount with clear reasoning: it uses `${localWorkspaceFolder}`, a devcontainer variable for workspace-relative paths.

All eight R1 action items have been addressed. No prior blocking items remain open.

## Section-by-Section Findings

### BLUF

The BLUF is dense but effective.
It names the mechanism, the structural analog (PortAllocator), the resolution strategy (two-tier lookup), the phased rollout, and the motivating problem.
The key source files list grounds the reader in the codebase.

No findings.

### Objective

All four objectives are clearly stated and independently verifiable.
Item 2 (feature mount declarations) is explicitly scoped to Phase 2 of the rollout, addressing the R1 concern about scope creep.

No findings.

### Background: The Port System as a Structural Model

The proposal claims `LACE_PORT_PATTERN` is at "lines 33-35" and `resolveStringValue()` is at "line 294" and `autoInjectPortTemplates()` is at "line 120."
I verified these against the actual codebase: `LACE_PORT_PATTERN` is at line 33, `LACE_UNKNOWN_PATTERN` at line 34, `LACE_PORT_FULL_MATCH` at line 35, `autoInjectPortTemplates()` at line 120, and `resolveStringValue()` at line 294.
All line references are accurate.

The observation that "mounts have no contention problem" (unlike ports) is correct and important: it means the resolver can be purely deterministic with no availability checking.

No findings.

### Background: Existing Mount Infrastructure

The description of the three mount categories (repoMounts, user-authored mounts, lace-resolved mounts) is accurate.
The NOTE referencing `RepoMountSettings` is well-placed.

No findings.

### Background: Prior Art and Constraints

The structured output proposal status, the claude-tools RFP relationship, and the `additionalProperties: false` constraint are all correctly stated.
The conclusion that "Option C is eliminated" is properly derived from the research report.

No findings.

### Proposed Solution: Architecture Overview

The ASCII diagram is clear.
The flow from `devcontainer.json` and `settings.json` through `template-resolver.ts` to `MountPathResolver` to `.lace/devcontainer.json` is accurate.

> NOTE(opus/review): The writing conventions prefer Mermaid over ASCII for diagrams, but this ASCII diagram is compact enough that reformatting would not improve clarity.

**Non-blocking.** The diagram shows `template-resolver.ts` containing `MountPathResolver`, but the proposed implementation places `MountPathResolver` in a separate file (`mount-resolver.ts`).
The diagram should reflect the actual file boundary to avoid confusion during implementation.

### Proposed Solution: MountPathResolver Class

The class design is sound.
The two-tier lookup (settings override, then default path derivation) mirrors the `PortAllocator` pattern without the contention/availability complexity.
The persistence to `.lace/mount-assignments.json` is reasonable for debugging.

**Non-blocking.** The constructor takes `LaceSettings` directly, but the `PortAllocator` constructor takes only `workspaceFolder` and loads its own state.
This asymmetry is intentional (the resolver needs settings for overrides, the allocator does not), but the proposal should note this divergence from the structural model to prevent an implementer from reflexively making MountPathResolver constructor match PortAllocator's.

**Non-blocking.** The `resolve()` method is synchronous (returns `string`), while `PortAllocator.allocate()` is async (returns `Promise<number>`) due to port availability checking.
This is correct (path derivation is synchronous), but the difference has an implication for `walkAndResolve()` in `template-resolver.ts`: mount resolution can be synchronous even though port resolution must be async.
The proposal does not call this out, and an implementer might unnecessarily make mount resolution async by cargo-culting the port resolution pattern.

### Proposed Solution: Regex Patterns

The patterns are correctly defined.
The `LACE_UNKNOWN_PATTERN` relaxation uses negative lookahead correctly: `(?!port\(|mount\.source\(|mount\.target\()`.

**Non-blocking.** The proposal defines `LACE_MOUNT_TARGET_PATTERN` in the Regex Patterns section but states that `${lace.mount.target()}` is Phase 3 (Phase 5 in implementation phases).
Adding patterns for unimplemented features invites confusion.
The Phase 2 implementation should define only `LACE_MOUNT_SOURCE_PATTERN` and `LACE_MOUNT_SOURCE_FULL_MATCH`.
The `LACE_UNKNOWN_PATTERN` relaxation should include the `mount\.target\(` lookahead from the start (so target expressions pass through without error), but the target resolution pattern itself should be deferred.
The proposal's current phrasing groups all three patterns together as if they are all Phase 2; clarifying the phasing of pattern introduction would help.

### Proposed Solution: Resolution in `resolveStringValue()`

The resolution order is correct.
The observation that mounts always resolve to strings (no type coercion) is accurate and simplifies the implementation.

**Non-blocking.** The proposal says `LACE_MOUNT_SOURCE_FULL_MATCH` is "defined for consistency" but never used in Phase 1-3.
Defining unused patterns adds dead code.
Consider deferring `FULL_MATCH` until a concrete use case emerges, or noting that it exists for validation (detecting a mount source expression used where a non-string is expected).

### Proposed Solution: Settings Schema Extension

The `MountOverrideSettings` interface is minimal and appropriate.
The example `settings.json` is concrete and realistic.
The rationale for keeping the override shape minimal (`source` only) is sound: `readonly` and `target` are properties of the mount declaration, not the override.

I verified the current `LaceSettings` interface in `settings.ts` (line 10): it has only `repoMounts?`.
Adding `mounts?` is a clean extension.

No findings.

### Proposed Solution: Concrete Before/After

The before/after examples are accurate.
The resolved default path `~/.config/lace/lace/mounts/project/bash-history` correctly doubles "lace" (project ID from workspace folder basename is "lace", and the path prefix is `~/.config/lace/`).
This looks slightly odd but is correct per `deriveProjectId()` semantics and consistent with how repo clones work (`~/.config/lace/lace/repos/...`).

**Non-blocking.** The doubled "lace" in `~/.config/lace/lace/mounts/...` may surprise users.
Consider mentioning this in the proposal as a known cosmetic quirk inherited from the existing project ID derivation, to prevent an implementer from "fixing" it and breaking consistency with repo clone paths.

### Proposed Solution: Pipeline Integration

The pipeline diagram shows mount template resolution occurring in Phase 4 (resolveTemplates), which is correct: mount expressions in config strings are resolved during the same walk-and-resolve pass as port expressions.

**Non-blocking.** The proposal shows `resolveTemplates()` gaining a `MountPathResolver` parameter:

```typescript
export async function resolveTemplates(
  config: Record<string, unknown>,
  portAllocator: PortAllocator,
  mountResolver: MountPathResolver,
): Promise<TemplateResolutionResult>;
```

However, the current `resolveTemplates()` signature (verified at line 230-233) takes only `config` and `portAllocator`.
The function internally builds `featureIdMap` from config's features and passes it through `walkAndResolve()`.
Adding `mountResolver` here is fine, but the proposal omits the downstream change: `walkAndResolve()` and `resolveStringValue()` both need the resolver passed through their parameter lists.
The `resolveStringValue()` function currently takes `(value, featureIdMap, portAllocator, allocations)`: it would need `mountResolver` added.
This is an implementation detail, but since the proposal specifies the `resolveTemplates()` signature change, it should either also specify the `resolveStringValue()` signature change or note that the resolver propagates through the internal call chain.

### Design Decisions

All seven design decisions have clear "Decision" and "Why" framing.
The decisions are internally consistent and well-grounded in codebase patterns.

The "Never Auto-Delete" decision is sound and correctly parallels the port system's behavior.
The "String-Format Output" decision correctly references the rejected structured output proposal.
The "`project/` Reserved Namespace" decision has clear reasoning for why bare labels and project-name labels are inferior.
The "Project ID from `deriveProjectId()`" decision correctly cites the function's location and behavior.

No findings.

### Stories

All four stories are concrete and illustrate distinct scenarios.
Story 1 (new contributor) and Story 2 (existing user migration) together cover the primary use cases for Phase 1.
Story 3 (feature mount declaration) and Story 4 (cross-feature reference) cover Phases 2 and 3 respectively.

**Non-blocking.** Story 3's mount entry example uses `source=<resolved>/target=/home/node/.claude` with a slash between source and target, which appears to be a typo for a comma: `source=<resolved>,target=/home/node/.claude`.

### Edge Cases

The five edge cases are well-chosen and cover the most likely failure modes.
The label validation regex (`/^[a-z0-9_-]+\/[a-z0-9_-]+$/`) is appropriate.
The worktree path derivation analysis is correct: `deriveProjectId()` operates on the host-side workspace folder, not the container-side path.
The `${localEnv:HOME}` interaction analysis is correct: lace resolves first, devcontainer CLI resolves second, no interference.

**Non-blocking.** The "Override Path Does Not Exist" edge case says lace emits a warning but does not fail.
However, the existing `resolveOverrideRepoMount()` in `mounts.ts` (line 212) throws a `MountsError` when the override source does not exist.
The proposal's choice to make missing override paths a warning rather than an error is defensible (Docker will still start), but it is inconsistent with the repoMounts system's behavior.
The proposal should acknowledge this inconsistency and provide rationale for the divergence, or adopt the harder error approach for consistency.

### Test Plan

The test plan is comprehensive.
The unit tests for `MountPathResolver` cover the expected cases (default path, override, auto-create, no auto-create for overrides, label validation, persistence, warning for missing override path).
The template resolution tests cover pattern matching, string resolution, mixed port+mount, nested config, mounts array, and error cases.
The settings extension tests are minimal but sufficient.
The integration tests cover end-to-end resolution, settings override, mixed config, and error propagation.
The test fixtures are concrete and realistic.

**Non-blocking.** The test plan for `MountPathResolver` includes "Auto-create default directory: resolver creates the directory on the filesystem (verify with `existsSync`)."
Testing filesystem side effects with `existsSync` is correct, but the test should use a temp directory (consistent with the `template-resolver.test.ts` pattern of creating a temp `workspaceRoot` in `beforeEach`).
The proposal does not specify the test setup/teardown pattern; implementers should follow the existing pattern.

**Non-blocking.** The test plan does not include a negative test for `LACE_MOUNT_TARGET_PATTERN` resolution in Phase 1-3.
If the `LACE_UNKNOWN_PATTERN` is relaxed to allow `mount.target()` but no resolver exists yet, a `${lace.mount.target()}` expression would silently pass through the unknown pattern guard and then not be resolved (returned as a literal string).
The test plan should include a test verifying this behavior (or verifying that unresolved target expressions produce an error), depending on the desired semantics.

### Implementation Phases

The six phases are well-sequenced.
Phase 1 (resolver + settings) is independent of template resolution.
Phase 2 (template resolution integration) depends on Phase 1.
Phase 3 (pipeline wiring) depends on Phase 2.
Phases 4-6 are extensions that can be deferred.

Each phase has clear "Files to create," "Files to modify," "Success criteria," and "Constraints" sections.
The constraints are particularly valuable: they prevent scope creep within each phase.

**Non-blocking.** Phase 2's "Files to modify" section for `template-resolver.ts` lists six changes.
The fourth item is "Extend `resolveTemplates()` signature to accept `MountPathResolver`."
However, Phase 2's constraints say "Do not modify `up.ts` in this phase."
This means `resolveTemplates()` would have a new parameter that `up.ts` does not pass yet.
For Phase 2's tests to work, either: (a) the tests create their own `MountPathResolver` and pass it directly, or (b) the parameter is optional.
The proposal should specify which approach to use.
Making the parameter optional (with a no-op default) would be the cleanest path since it preserves backward compatibility through Phase 2 without requiring `up.ts` changes.

**Non-blocking.** Phase 3's "Files to modify" for `up.ts` lists "Import `MountPathResolver` and `loadSettings`."
The `loadSettings` function is already imported by `resolve-mounts.ts` (via `runResolveMounts`), but `up.ts` does not currently import it directly.
The proposal's note that "Settings are loaded once and shared between mount resolution and repo mount resolution" implies refactoring the current settings loading: `runResolveMounts` currently loads settings internally (via `resolveRepoMounts` which takes settings as a parameter, passed by `runResolveMounts`).
This refactoring is not called out in the Phase 3 file changes.
The proposal should either note that `up.ts` already has access to settings through `runResolveMounts` plumbing and just needs to hoist the load, or acknowledge the refactor.

### Open Questions

The four open questions are well-framed and appropriately scoped as future concerns.
They do not block implementation of Phases 1-3.

No findings.

### Writing Conventions Compliance

The document follows BLUF convention, uses sentence-per-line formatting consistently, avoids emojis, and uses NOTE callouts with attribution where appropriate.
The R1 finding about em-dashes has been partially addressed: several instances remain ("In `up.ts`, mount source template resolution fits into the existing pipeline after port template resolution (Phase 4)").
However, this is a minor stylistic point.
Code examples are well-formatted with appropriate jsonc syntax highlighting.

No findings.

### Frontmatter

The frontmatter is well-formed.
`type: proposal`, `status: review_ready`, `state: live` are correct.
Tags are descriptive: `[mounts, template-variables, features, devcontainer, lace-cli, host-paths, extensibility, settings, mount-resolver]`.
The `related_to` references are valid.
`last_reviewed` shows `round: 1` with `status: accepted` from R1.

**Non-blocking.** The tag list has nine entries, which is on the higher end.
Per the frontmatter spec: "Keep the set focused."
Consider trimming to the most distinctive tags: `mount-resolver`, `template-variables`, `settings`, `extensibility` would capture the core topics without redundancy.
`lace-cli` and `devcontainer` are implied by the repository context, and `features` is a subset of `extensibility`.

## Verdict

**Accept.**

The proposal comprehensively addresses all R1 findings, provides a realistic phased implementation plan with accurate file-level change lists, and makes well-reasoned design decisions grounded in codebase patterns.
The non-blocking findings are implementation guidance (parameter propagation, optional parameters for phased rollout, test setup patterns) rather than design flaws.
The document is ready for implementation.

## Action Items

1. [non-blocking] Clarify in Phase 2 whether the `MountPathResolver` parameter on `resolveTemplates()` should be optional (for backward compatibility during phased rollout) or whether Phase 2 tests create their own resolver instance.
2. [non-blocking] Note that `walkAndResolve()` and `resolveStringValue()` signatures also need the resolver parameter propagated, not just `resolveTemplates()`.
3. [non-blocking] Add a test case for unresolved `${lace.mount.target()}` expressions in Phase 1-3 to verify they either pass through as literals or produce an error, depending on desired semantics.
4. [non-blocking] Acknowledge the doubled "lace" in default paths (`~/.config/lace/lace/mounts/...`) as a known cosmetic quirk inherited from `deriveProjectId()`.
5. [non-blocking] Reconcile the "warning for missing override path" behavior with the repoMounts system's hard error (`MountsError`) for missing override sources, or document the rationale for divergence.
6. [non-blocking] Fix the likely typo in Story 3: `source=<resolved>/target=` should be `source=<resolved>,target=`.
7. [non-blocking] Clarify the phasing of pattern introduction: define `LACE_MOUNT_TARGET_PATTERN` in Phase 5 (not Phase 2), but include the `mount\.target\(` lookahead in `LACE_UNKNOWN_PATTERN` from Phase 2.
8. [non-blocking] Note in Phase 3 that settings loading may need to be hoisted in `up.ts` since `runResolveMounts` currently loads settings internally.
