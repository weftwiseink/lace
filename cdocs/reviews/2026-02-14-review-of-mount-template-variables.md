---
review_of: cdocs/proposals/2026-02-14-mount-template-variables.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T23:30:00-08:00
task_list: lace/template-variables
type: review
state: live
status: done
tags: [fresh_agent, architecture, rfp, mounts, template-variables, extensibility, design_space, trust_model]
---

# Review: RFP - Mount Template Variables

## Summary Assessment

This RFP proposes a `${lace.mount.source(...)}` / `${lace.mount.target(...)}` template variable system for devcontainer mount paths, directly analogous to the existing `${lace.port()}` system.
The document is exceptionally thorough for an RFP: it maps the design space across nine scope sections, identifies concrete motivating scenarios, catalogs prior art, and surfaces eight open questions.
The most important finding is that the RFP's strength (exhaustive exploration) is also its primary risk: it conflates multiple orthogonal subsystems (template variable resolution, feature consent/trust model, directory lifecycle management, and settings override infrastructure) into a single design surface, which could lead a proposal author to build all four simultaneously rather than layering them.
Verdict: **Accept** with non-blocking suggestions to improve actionability and sharpen scope boundaries.

## Section-by-Section Findings

### BLUF

The BLUF is well-structured and effective.
It names the mechanism, provides the analogy (port system), and states the motivation.
The second paragraph grounds the "why" in a specific pain point (hardcoded `${localEnv:HOME}/...` paths in the devcontainer config).

**Non-blocking.** The BLUF references `settings.json` for user overrides, but the actual settings infrastructure is `~/.config/lace/settings.json` with a `repoMounts` key today.
Naming the settings file path explicitly in the BLUF would reduce ambiguity for a proposal author about where mount overrides live.

### Objective (Section: Objective, items 1-4)

All four objective items are clearly stated and independently verifiable.
Items 1 and 3 (eliminate hardcoded paths, support per-user overrides) are the core value proposition.
Item 2 (feature mount declarations) is a meaningful extension but could be an entire separate proposal.
Item 4 (auto-create host directories) is a concrete operational requirement with clear acceptance criteria.

**Non-blocking.** Item 2 ("enable features to declare mount needs") is substantially more complex than items 1, 3, and 4.
The RFP could benefit from explicitly marking item 2 as a stretch goal or phased extension, so a proposal author does not feel compelled to solve the full feature-declares-mounts problem in the first pass.

### Scope Section 1: Symmetry with the Port System

This section is the strongest part of the RFP.
It enumerates each concept from the port system (allocation, auto-injection, persistence, type coercion, prebuild features, feature validation) and translates each to the mount domain.
The observation that mount allocation is "really just path derivation with a convention" (no contention problem) is a valuable insight that simplifies the design.

The prebuild features analysis is correct: mounts are runtime-only, and prebuild features are baked into the image layer.
This is verifiable from the current codebase: `template-resolver.ts` injects prebuild ports into `appPort`, which has no mount analog.

**Non-blocking.** The auto-injection discussion notes that "mounts are more complex than ports: they have source, target, type, and readonly properties, not just a single number."
A proposal author would benefit from a concrete sketch of what auto-injection looks like for mounts.
Does lace inject a full mount entry into the `mounts` array, or does it inject template variable references that the feature then uses?
The RFP leaves this open, which is appropriate for an RFP, but a sentence framing this as the central design question for auto-injection would help.

### Scope Section 2: Namespace Semantics

The namespace analysis is thorough.
The three options for project-level mounts (reserved `project/` namespace, project name, bare name) are well-enumerated.
The parallel to the port system's `featureId/optionName` pattern is exact.

**Non-blocking.** The question "can multiple features share a namespace?" is asked but not explored.
For mounts, the more interesting question is whether multiple features can share a *target path*.
Two features both wanting to mount something at `/home/node/.claude` would conflict.
This is a distinct failure mode from namespace collision and worth calling out.

### Scope Section 2 NOTE (target vars as feature-defined reference points)

This NOTE is one of the more insightful parts of the document.
It articulates why `${lace.mount.target(...)}` is not redundant with a hardcoded container path: it provides indirection so that other features and configs can reference a container path by label rather than by path string.
This is a genuine extensibility win.

**Non-blocking.** The NOTE could be strengthened by providing a concrete example of cross-feature reference.
For instance: "A `claude-tools` feature declares `target: /home/${_REMOTE_USER}/.claude`.
A `dotfiles` feature references `${lace.mount.target(claude-code/config)}` to know where to symlink its Claude configuration, rather than hardcoding `/home/node/.claude`."

### Scope Section 3: Default Host Paths

This section correctly identifies the five candidates for `<project>` derivation and the worktree handling problem.
The distinction between "lace-managed storage" and "reference to existing directory" (paragraph 4) is critical and well-articulated.

**Blocking.** The RFP does not address what happens when a mount source is `~/.claude/` (an existing directory) and the user has never explicitly configured it.
Should lace assume `~/.claude/` as the default source without consent, or does every non-lace-managed mount require explicit configuration?
This is directly relevant to the Known Requirements (item 2: Claude config mounting) and the consent model (Section 9), but the two sections give different implicit answers.
Section 3 says "the default source should be `~/.claude` (the standard location)," while Section 9 says features must get consent before mounting host directories outside lace-managed storage.
These are contradictory unless the proposal clarifies that Known Requirement 2's "default" is the *feature's recommendation* that still goes through the consent flow.
A proposal author needs this resolved to avoid building the wrong default behavior.

### Scope Section 4: Mount Properties

The feature-declared defaults and user overrides are sketched with concrete JSON examples, which is helpful.
The override precedence question (should users override `type`?) is reasonable.

**Non-blocking.** The interaction with the structured output proposal is noted but that proposal is now `status: rejected`.
The RFP should acknowledge this: the `DevcontainerMount` type was proposed in a rejected proposal, so the mount template variable system cannot depend on it existing.
The mount template variable system may need to introduce its own internal mount representation, or the relevant parts of the rejected proposal (the type itself) could be extracted independently.

### Scope Section 5: Interaction with Existing Mount Systems

This section correctly identifies the three mount categories (repoMounts, user-authored mounts, and the proposed template var mounts).
The question of whether mount template variables should subsume repoMounts is well-framed.

**Non-blocking.** The NOTE about sharing infrastructure with repoMounts overrides is valuable but somewhat buried.
The `settings.ts` file currently defines `RepoMountSettings` with `overrideMount: { source, readonly, target }`.
A proposal author should know that this interface already exists and covers most of the override surface area needed for mount template variables.
Explicitly referencing `RepoMountSettings` from `packages/lace/src/lib/settings.ts` would ground this observation.

### Scope Section 6: Feature Mount Declarations

The three options (A: template vars in feature options, B: lace generates mounts outside feature spec, C: template vars in feature mount source fields) are well-enumerated.
The closing question ("which approach best preserves feature self-sufficiency while enabling lace orchestration?") is the right question.

**Non-blocking.** Option C is likely non-viable: the devcontainer feature spec's `mounts` schema uses `additionalProperties: false` (as documented in the research report), and template variables in mount source fields would fail schema validation even if the devcontainer CLI parses them.
The RFP could be more decisive here: stating that Option C is probably excluded by the spec constraints would narrow the design space for a proposal author.

### Scope Section 7: The Generated Output

This section references the structured output proposal's findings about string vs. object format.
The analysis is sound.

**Non-blocking.** The first bullet states "mounts with `readonly` must be strings (the Mount JSON schema has `additionalProperties: false`)."
This is correct per the research report.
However, the phrasing "mount template variables that resolve to readonly mounts must produce strings" conflates two concerns: the template variable resolution (which produces a path string) and the mount entry serialization (which produces a mount string or object).
Template variables resolve to paths; the mount entry that uses those paths is serialized separately.
Clarifying this distinction would prevent a proposal author from building readonly-awareness into the template variable resolver itself.

### Scope Section 8: Directory Lifecycle

The creation, permissions, cleanup, portability, and gitignore concerns are all relevant.
The observation that Docker creates root-owned directories for missing bind mount sources is a genuine operational hazard that lace should prevent.

**Non-blocking.** The cleanup options (lace clean, GC, never auto-delete) are listed but the RFP does not express a preference.
Given that the port system never reclaims freed ports and this is working well, the RFP could recommend "never auto-delete" as the default with `lace clean` as a follow-up, which would simplify the initial proposal.

### Scope Section 9: Feature Consent and Trust Model

This is the most novel section of the RFP and addresses a real security concern: features should not be able to silently mount arbitrary host directories.
The consent flow (recommend, check acceptance, prompt, fallback to lace-managed) is well-designed.
The two properties it preserves (feature self-sufficiency, user control) are the right invariants.

**Non-blocking.** The consent model introduces significant UX complexity.
`lace up` is currently non-interactive (it generates config and runs `devcontainer up`).
A consent prompt would make `lace up` interactive on first run for any feature with a recommended source.
The RFP should note this and suggest whether consent should be gathered during `lace up`, via a separate `lace trust` command, or via pre-configuration in `settings.json`.
The `lace trust` subcommand is mentioned at the end but not connected to the `lace up` flow.

**Non-blocking.** The consent model does not address the current mounts in `.devcontainer/devcontainer.json`.
The four existing mounts are user-authored in the project config (not feature-declared), so they bypass the consent flow entirely.
If mount template variables replace these hardcoded mounts, do the replacements also bypass consent (because the user authored the devcontainer.json and implicitly consents)?
Or does the template variable system apply consent uniformly?
This distinction matters for the Known Requirements scenarios.

### Known Requirements

All six scenarios are concrete and grounded in the actual `.devcontainer/devcontainer.json` content.
I verified scenarios 1-4 against the current file: the mount strings, paths, and readonly flags all match.

**Non-blocking.** Scenario 3 (SSH authorized keys) and scenario 4 (WezTerm container config) are identified as potentially not belonging in the mount template variable system.
The RFP should be more definitive here.
Scenario 4 uses `${localWorkspaceFolder}`, which is a devcontainer variable, not a user-specific path.
It is a workspace-relative file in the project tree.
Mount template variables solve the problem of user-specific host paths; workspace-relative paths are already handled by devcontainer variables.
Stating this clearly would help a proposal author exclude scenario 4 from scope.

### Prior Art

The six prior art references are correct and sufficient.
The port template variables, repoMounts, structured output proposal, claude tools RFP, devcontainer spec mount schema, and Docker `--mount` flag are all relevant.

**Non-blocking.** The structured output proposal is listed as prior art but has `status: rejected`.
The prior art section should note this status so a proposal author knows not to depend on its implementation phases, while still leveraging its research findings (which were archived separately in the report).

### Open Questions

The eight open questions are well-framed and cover the right concerns.

**Non-blocking.** Question 1 (template variable namespace) already has a clear answer embedded in the question itself: the `LACE_UNKNOWN_PATTERN` regex at `template-resolver.ts:34` (`/\$\{lace\.(?!port\()([^}]+)\}/`) rejects all non-port `${lace.*}` expressions.
This is not really an open question; it is a known prerequisite.
The proposal should list it as a known prerequisite ("relax the LACE_UNKNOWN_PATTERN guard") rather than an open question.

**Non-blocking.** Question 2 (source vs. target template variables) includes its own partial answer and could be shortened.
The answer is "yes, both are needed" per the NOTE in Scope Section 2.
This partial resolution makes the question less "open" and more "already decided."

**Non-blocking.** Question 5 (MVP scope) is the most important open question and should be promoted to the top of the list or into its own section.
The answer to this question determines what a proposal author builds first.
A one-sentence editorial recommendation ("start with `${lace.mount.source()}` for project-level mounts only, no feature integration, no consent model") would make the RFP significantly more actionable.

### Frontmatter

The frontmatter is well-formed.
`type: proposal`, `status: request_for_proposal`, `state: live` are all correct.
Tags are descriptive and cover the key topics.
The `related_to` references are valid and exist in the repository.

**Non-blocking.** The `task_list` is `lace/template-variables`, which is a reasonable workstream name.
The claude-tools RFP uses `lace/claude-tools-feature` as its task list.
Since mount template variables are a prerequisite for the claude-tools feature (which needs `~/.claude` mount resolution), the relationship between these two workstreams could be noted in the frontmatter via `related_to` including the claude-tools RFP.
The claude-tools RFP *is* listed in `related_to`, so this is satisfied.

### Writing Conventions Compliance

The document follows BLUF convention, uses sentence-per-line formatting in most places, avoids emojis, and uses NOTE callouts with attribution where appropriate.
Code examples are well-formatted.

**Non-blocking.** There are several instances of em-dashes (`--`) that the writing conventions discourage: "analogous to the existing `${lace.port()}` system -- that lets features," "knowledge from individual devcontainer configs -- and enables features."
Per conventions, these should be colons or sentence breaks.
This is a minor stylistic point.

## Verdict

**Accept.**

This is a high-quality RFP that comprehensively maps the design space.
The one blocking finding (contradiction between Section 3 defaults and Section 9 consent for non-managed mount sources like `~/.claude/`) is addressable by the proposal author: the RFP just needs to clarify that "default source" in Known Requirements means "feature recommendation subject to consent," not "assumed without consent."
Given that this is an RFP (not a proposal), leaving some ambiguity for the proposal author to resolve is acceptable, and the contradiction is clearly surfaced in both sections.

A proposal author has everything needed to write a full proposal from this RFP: concrete motivating scenarios, a mapped design space, prior art references with code locations, and well-framed open questions.

## Action Items

1. [blocking] Resolve the contradiction between Section 3 ("default source should be `~/.claude`") and Section 9 (consent required for non-managed sources). Clarify that Known Requirement 2's default is a feature recommendation subject to the consent flow, not an assumed default.
2. [non-blocking] Note that the structured output proposal (`2026-02-14-structured-devcontainer-output.md`) has `status: rejected` wherever it is referenced as prior art or as a dependency. The `DevcontainerMount` type from that proposal cannot be assumed to exist; mount template variables may need their own internal representation.
3. [non-blocking] Promote Open Question 5 (MVP scope) to a more prominent position or add an editorial recommendation for where a proposal author should start. Suggest: "start with `${lace.mount.source()}` for project-level mounts, no feature auto-injection, no consent model."
4. [non-blocking] Reclassify Open Question 1 (namespace guard) as a known prerequisite rather than an open question: the `LACE_UNKNOWN_PATTERN` regex at `template-resolver.ts:34` must be relaxed.
5. [non-blocking] In Scope Section 6, state that Option C (template vars in feature mount source fields) is likely excluded by the devcontainer feature spec's `additionalProperties: false` constraint.
6. [non-blocking] Address the UX implications of the consent model on the `lace up` flow (currently non-interactive). Suggest whether consent is gathered during `lace up`, via `lace trust`, or via pre-configuration in `settings.json`.
7. [non-blocking] Explicitly reference the existing `RepoMountSettings` interface in `packages/lace/src/lib/settings.ts` in Scope Section 5, to ground the shared infrastructure observation.
8. [non-blocking] Definitively exclude Known Requirement scenario 4 (WezTerm container config) from mount template variable scope, since it uses `${localWorkspaceFolder}` and is workspace-relative rather than user-specific.
