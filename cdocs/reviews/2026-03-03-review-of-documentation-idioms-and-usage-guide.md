---
review_of: cdocs/proposals/2026-03-03-documentation-idioms-and-usage-guide.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T14:00:00-08:00
task_list: lace/documentation
type: review
state: live
status: done
tags: [fresh_agent, documentation, architecture, contributing, staleness_risk, scope_assessment]
---

# Review: Documentation -- Idioms and Usage Guide

## Summary Assessment

This proposal aims to add four new documentation files to `packages/lace/docs/` covering
architecture overview, troubleshooting, migration from standard devcontainer CLI, and
contributing guidelines. The proposal is thorough, well-structured, and grounded in verified
facts about the codebase -- every code pattern cited (custom error classes, discriminated
unions, subprocess injection, `IMPLEMENTATION_VALIDATION` markers, scenario helpers) was
confirmed against actual source files. The most important finding is that the proposal
underestimates the staleness risk for the troubleshooting and contributing guides, which
contain concrete details that will drift as the codebase evolves. A secondary concern is
that the contributing guide's placement in `packages/lace/docs/` rather than as a root
`CONTRIBUTING.md` misses GitHub's built-in contributor guidance features. **Verdict: Revise.**

## Section-by-Section Findings

### BLUF and Objective

Well-written. Correctly identifies the gap: the README is comprehensive as API reference
but lacks the "why" and "how to think about it" layer. The four proposed documents address
genuinely distinct needs (architecture narrative, failure diagnosis, incremental adoption,
contributor onboarding). The claim that the README is "750+ lines" is accurate (757 lines).

**Finding 1 (non-blocking): The BLUF mentions "seven abstraction layers" but the README
lists 14 steps.** The proposal later clarifies that the layers are conceptual groupings
of the steps, but the BLUF does not explain this distinction. A reader encountering "seven
layers" and then seeing 14 steps in the README may be confused about whether these are the
same concept. The architecture doc itself should make this mapping explicit.

### Background -- Existing Documentation Inventory

Accurate. The table correctly identifies all existing documentation locations. The claim
of "80+ design proposals" and "50+ development logs" in `cdocs/` is plausible given the
volume of review files observed (90+ reviews). The distinction between user-facing docs
(`packages/lace/docs/`) and project-internal design documentation (`cdocs/`) is valid.

No blocking findings.

### Documentation Principles

Sound principles. "Cross-reference, do not duplicate" is particularly important given the
README's role as the API reference. "Separate audience concerns" correctly identifies users
and contributors as distinct audiences.

No findings.

### Architecture Overview (Section 1)

The ASCII pipeline diagram (lines 72-98) is a strong visualization. It correctly shows the
dependency flow: metadata feeds into mount management, template resolution, and prebuilds.

**Finding 2 (non-blocking): The diagram shows seven layers but the README lists 14 steps.**
The architecture doc should include an explicit mapping table (e.g., "Steps 3-4 in the
README correspond to the Feature Metadata layer") so readers can cross-reference. Without
this, the architecture doc and the README will feel like they describe different pipelines.

**Finding 3 (non-blocking): The "Settings and state files" sub-section mentions three data
locations but the proposal does not enumerate what lives in each.** The architecture doc
should specify which files live in `.lace/` (port-assignments.json, generated config,
lockfile), which in `~/.config/lace/` (settings.json, feature cache), and what Docker daemon
state is relevant (prebuild images in `lace.local/` namespace). Without this, the section
is a placeholder rather than documentation.

**Finding 4 (non-blocking): The worked example (lines 102-108) traces a port template but
not a mount template.** Since mount resolution is arguably more complex (involving namespace
validation, `sourceMustBe`, auto-injection, and settings lookup), a mount-focused example
would demonstrate more of the pipeline. Consider including both a port and a mount example.

### Troubleshooting Guide (Section 2)

The nine entries cover real failure modes. The symptom-first organization is the right choice.

**Finding 5 (blocking): Several troubleshooting entries cite specific error messages that
should be verified against the actual codebase but are not cited to source.** For example,
"no ports available in range" (line 125), "Unknown mount namespace 'foo'" (line 163), and
"unknown lace template expression" (line 143) should reference the exact source file and
error string. The implementation phase (Phase 2) states "Error messages match what lace
actually produces (verify against source code)" as a success criterion, but the proposal
itself does not perform this verification. If the error messages in the proposal do not
match the actual strings, they will mislead users who grep their terminal output. This is
a blocking issue for the troubleshooting guide itself (Phase 2), not for the proposal's
acceptance -- but the proposal should acknowledge this validation step more prominently.

**Finding 6 (non-blocking): The "stale metadata cache" entry (lines 128-130) mentions a
"24h TTL" for floating tag cache.** This specific TTL value should be verified against the
metadata caching implementation. If the TTL is different or configurable, the troubleshooting
entry will be misleading.

**Finding 7 (non-blocking): Missing troubleshooting entry for lock file contention.** The
codebase includes `flock.ts` and `lockfile.ts`, suggesting that concurrent `lace up`
invocations can contend on lock files. This is a plausible failure mode that is not covered.

### Migration Guide (Section 3)

The incremental six-step migration path is well-designed. Each step is independently valuable,
which is the key insight for adoption docs.

**Finding 8 (non-blocking): Step 1 ("Minimal lace wrapper") claims "No config changes.
Lace generates .lace/devcontainer.json and passes it through. Everything works as before."
This should be verified.** If a standard `devcontainer.json` with no `customizations.lace`
block is passed to `lace up`, does it truly pass through unchanged? Or does lace inject
any default behavior (e.g., `.lace/` directory creation, lock files)? If there are side
effects, step 1 should document them so users are not surprised.

**Finding 9 (non-blocking): The "What NOT to migrate" section mentions Docker Compose but
does not mention multi-root workspaces or devcontainer Features that have lace-specific
`customizations.lace` blocks.** Clarifying that lace only processes features that declare
lace mount or port annotations would help users understand which features need migration
and which are pass-through.

### Contributing Guidelines (Section 4)

This is the strongest section of the proposal. Every code pattern cited was verified against
the actual codebase:

- Seven custom error classes confirmed (DevcontainerConfigError, MetadataFetchError,
  AnnotationMissingError, RepoCloneError, DockerfileParseError, MountsError,
  SettingsConfigError).
- `PrebuildFeaturesResult`, `ConfigBuildSource`, and `RepoMountsResult` discriminated unions
  confirmed in `devcontainer.ts`.
- `UpResult` interface with `phases` record confirmed in `up.ts`.
- `RunSubprocess` type confirmed in `subprocess.ts`, injected in `up.ts`,
  `feature-metadata.ts`, `prebuild.ts`.
- `IMPLEMENTATION_VALIDATION` marker confirmed in all 50 source/test files.
- `createScenarioWorkspace` confirmed in `__tests__/helpers/scenario-utils.ts`.
- `isDockerAvailable` confirmed in scenario utils.
- `LaceMountDeclaration` confirmed in `feature-metadata.ts` (not a shared types file).
- Test file location pattern (`__tests__/*.test.ts`) confirmed.

**Finding 10 (blocking): The contributing guide belongs at the repo root as
`CONTRIBUTING.md`, not in `packages/lace/docs/`.** The proposal acknowledges this in Open
Question 3 but defers the decision. GitHub surfaces `CONTRIBUTING.md` in the repository's
"Contributing" tab and shows it when users open new issues or PRs. Placing it in
`packages/lace/docs/contributing.md` means GitHub will not find it. Since this is a monorepo
with only one package that has contributor-facing code (`packages/lace/`), a root
`CONTRIBUTING.md` that focuses on lace is appropriate. If additional packages gain their
own contributing guides later, the root file can link to them. This is blocking because the
file's discoverability is a core requirement for a contributing guide.

**Finding 11 (non-blocking): The contributing guide does not mention the `oci-blob-fallback.ts`
module.** This module exists in the source tree but is not referenced anywhere in the
proposal. If it represents a significant pattern or fallback mechanism, it should be
mentioned. If it is an internal implementation detail, no action needed.

**Finding 12 (non-blocking): The contributing guide's code snippet for `UpResult` (lines
234-240) shows a simplified version missing some fields.** The actual interface includes
`portAssignment` (with an extra `port?` field), `metadataValidation`, `templateResolution`,
`prebuild`, and `resolveMounts`. The snippet should note it is abbreviated or show the full
interface.

### Design Decisions

All four design decisions are well-reasoned. "Pipeline flow, not module structure" is
particularly insightful -- users need to understand the data transformation sequence, not
the import graph.

**Finding 13 (non-blocking): The "no generated API docs" decision is correct for now but
the reasoning could be stronger.** "Internal tooling, not a library" understates the case.
The deeper reason is that the codebase idioms (subprocess injection, discriminated unions)
are more important to document than individual function signatures, and TypeDoc does not
capture idioms.

### Edge Cases

The staleness mitigation strategies are reasonable but optimistic.

**Finding 14 (blocking): The staleness mitigation for the contributing guide ("snippets
show the pattern, not the full implementation") is insufficient without a maintenance
strategy.** The contributing guide will contain seven code patterns with specific class
names, type names, and field names. When any of these change, the guide becomes misleading.
The proposal should specify who is responsible for updating the guide and when (e.g., "when
adding a new error class, add it to the contributing guide's list"). A simple mechanism:
add a comment in the source code near each pattern saying `// Documented in docs/contributing.md`
so that anyone changing the pattern sees the cross-reference. Alternatively, a CI check that
greps for the cited names could catch drift.

**Finding 15 (non-blocking): The "docs directory naming confusion" edge case correctly
identifies the `docs/` vs `cdocs/` distinction, but users navigating the GitHub repo will
see both directories at different levels.** Consider adding a one-line note in
`packages/lace/docs/` (e.g., a brief header in each new doc) clarifying that these are
user-facing docs, while `cdocs/` at the repo root contains project design history.

### Implementation Phases

The five-phase structure is logical. Phase 5 (cross-linking) correctly defers README
modifications until the new docs exist.

**Finding 16 (non-blocking): The phases lack time estimates or ordering constraints.** Are
all phases meant to be done in sequence? Can Phase 4 (contributing) be done independently
of Phases 1-3? Clarifying this helps if different agents or contributors implement different
phases.

### Open Questions

**Finding 17 (non-blocking): Open Question 1 (Mermaid vs ASCII) should be resolved in the
proposal, not deferred to Phase 1.** The answer depends on the audience: if docs will be
read primarily on GitHub (where Mermaid renders), use Mermaid. If docs may be read in
terminals, editors, or local markdown renderers (which is common for CLIs), ASCII is more
portable. Given that lace is a terminal-native CLI tool, ASCII is the safer default. The
proposal already includes a well-crafted ASCII diagram; recommending ASCII and noting
Mermaid as a future option would resolve this.

## Verdict

**Revise.** The proposal is well-researched and the four proposed documents address real
gaps. Two blocking issues must be addressed:

1. The contributing guide should be placed at `CONTRIBUTING.md` (repo root), not
   `packages/lace/docs/contributing.md`, to leverage GitHub's built-in contributor
   guidance features.

2. The proposal needs a concrete staleness mitigation strategy beyond "patterns are stable."
   At minimum, specify source-code cross-reference comments or a CI check for cited names.

The troubleshooting guide's error message verification (Finding 5) is technically blocking
for the implementation phase, not the proposal itself -- but the proposal should call it out
as a required step in Phase 2's success criteria more prominently.

## Action Items

1. [blocking] Move contributing guide from `packages/lace/docs/contributing.md` to
   `CONTRIBUTING.md` at the repo root. Update Phase 4 and Phase 5 accordingly. If other
   packages gain contributing guides later, the root file can link to them.

2. [blocking] Add a staleness mitigation mechanism for the contributing guide. Options:
   (a) source-code comments near each documented pattern pointing to the guide, (b) a CI
   grep check that verifies cited type/class names still exist, or (c) a cdocs maintenance
   note. Choose at least one and describe it in the Edge Cases section.

3. [non-blocking] Resolve Open Question 1 (Mermaid vs ASCII) in favor of ASCII, with a
   note that Mermaid can be added later. The proposal already has a good ASCII diagram.

4. [non-blocking] Add a mapping table in the architecture doc outline that maps the seven
   conceptual layers to the README's 14 steps.

5. [non-blocking] Add a lock file contention entry to the troubleshooting guide outline.

6. [non-blocking] Verify Step 1 of the migration guide: confirm that `lace up` with no
   `customizations.lace` block truly passes through without side effects, or document the
   side effects.

7. [non-blocking] Strengthen Phase 2 success criteria to explicitly require grep-verification
   of all cited error messages against the source code before the troubleshooting doc is
   considered complete.

8. [non-blocking] Resolve Open Question 3 (contributing guide location) -- this is no
   longer open given action item 1.
