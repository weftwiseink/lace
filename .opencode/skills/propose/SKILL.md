---
name: propose
description: Author a design proposal with structured sections and implementation phases
argument-hint: "[topic]"
---

# CDocs Propose

Author a design proposal document.

**Usage:** Typically user-invoked when a design needs to be specified. Claude may also suggest creating a proposal when scoping complex work.
Proposals specify designs and solutions, outlining implementation phases.
They should retain a "timeless" quality: design changes are noted in NOTE callouts or by reference to another document, not by rewriting.

## Invocation

### New proposal (default)

1. If `$ARGUMENTS` provides a topic string, use it. Otherwise, prompt the user.
2. Determine today's date.
3. Create `cdocs/proposals/YYYY-MM-DD-topic.md` using the template below.
4. If `cdocs/proposals/` doesn't exist, suggest running `/cdocs:init` first.

### Elaborate an existing RFP stub

When `$ARGUMENTS` is a path to an existing file:

1. Read the file and check its frontmatter `status`.
2. If `status: request_for_proposal`: elaborate in-place (see **Elaboration** below).
3. If any other status: warn that the document is already a full proposal and suggest `/cdocs:review` or manual revision.
4. If the file does not exist or is not a proposal (`type` is not `proposal`): report an error with guidance.

`$ARGUMENTS` is treated as a file path when it ends in `.md` or contains a `/`.
Otherwise it is treated as a topic string.

## Template

Use the template in `template.md` alongside this skill file.
Fill in:
- `first_authored.by` with the current model name or `@username`.
- `first_authored.at` with the current timestamp including timezone.
- `task_list` with the relevant workstream path.
- `type: proposal`, `state: live`, `status: wip`.
- Tags relevant to the proposal.

## Elaboration

When elaborating an RFP stub (`status: request_for_proposal`) in-place:

1. Preserve `first_authored` unchanged (the original author retains attribution).
2. Preserve the existing BLUF, Objective, and Scope content as starting points.
3. Insert the full proposal sections after Scope: Background, Proposed Solution, Important Design Decisions, Edge Cases, Test Plan, Implementation Phases.
4. Preserve Open Questions at the end of the document. Resolve them inline during elaboration or leave them for reviewers.
5. Expand the BLUF to cover the full proposal scope (the original BLUF captured the idea; the elaborated BLUF summarizes the design).
6. Transition `status` from `request_for_proposal` to `wip`.
7. Update `tags` as appropriate for the expanded scope.

The core authoring workflow is the same as creating a proposal from scratch: BLUF-first drafting, section filling, author checklist review.
The only difference is that existing content provides a starting point rather than a blank template.

Assume the user knowingly passed an RFP stub path and intends to elaborate it.
No confirmation is needed unless context clues suggest otherwise (e.g., the user says "create a new proposal about X" while passing a stub path).

## Sections

All proposals should always include a BLUF, and almost always an objective and background section.
Most should include many of the other sections as well, but use your judgement (ie a high-level architecture proposal does not need unit test plans).
However, a fully fledged implementation proposal should have exhuastive test, verification, and implementation phase sections.
You may also include novel sections not specified - again, use your judgement and think critically to the best of your ability when crafting the proposal.

Some of these sections can get fairly verbose and may not be necessary for the implementer to have directly on-hand.
In such cases, consider breaking the exhaustive details of the section into a supplemental `/cdocs:report` and referencing it with a summary of key take-aways and notes.
> NOTE: Only maintain one supplemental per-proposal, and consider leveraging subagents for their authorship or factoring-out.

- **> BLUF:** Concise Bottom Line UpFront summary at top of proposal.
  Should succinctly state the most important info and conclusions, and should be kept up-to-date if they change.
- **Summary:** Add at the end of the authoring process to provide more details, notes, and references to make the proposal more digestible.
  Shouldn't be too long but is a good opportunity to flag context or add other `> NOTE`s that would bloat the BLUF.
- **Objective:** Problem or improvement goal.
- **Background:** Important docs, links, prior art.
  Context needed to understand the proposal.
  Often prior or referenced dedicated reports are useful here.
- **Proposed Solution:** Architecture or approach, the core of the proposal.
- **Important Design Decisions,** briefly qualified.
  If lots of lateral consideration or exposition is worthwhile, consider using the supplemental pattern.
- **Stories:** User or logical scenarios to consider.
  If the proposal is complex with many stories in need of consideration, use the supplemental pattern.
- **Edge Cases:** What could go wrong, how to handle it. Consider supplementing
- **Test Plan:** What do we need to test? Examples?
  Critical for a fully fledged implementation proposal.
- **Verification Methodology:** What iterative, direct method should the implementer utilize to truly verify the results are as expected?
  Critical for a fully fledged implementation proposal.
  If the project doesn't have some established convention/tooling for making this straightforward, consider flagging and suggesting a `/cdocs:rfp`.
- **Implementation Phases:** Detailed unless otherwise requested, should never include time estimates.
  Should usually include expansions of or references to testing plans.
  Critical for a fully fledged implementation proposal.
  More guidance below.

## Implementation Phase Guidance

- Break into logical, verifiable phases.
- Providing examples and snippets outlining key abstractions is useful, but avoid drafting the entire implementation inline (unless you realize it is extremely straightforward).
- Trust developer judgment on details where practical.
- Document constraints and "what NOT to change."

In the case of larger problems, consider recommending subagent/multi-implementer methodology.
Some heuristics and things to aim for if aiming for this framing:
- Does the proposal have 5+ largely independent phases with clear success criteria?
- Is there clear success criteria per phase?
- Ensure dependencies between phases are noted explicitly.
- Ensure constraints are specified (what files/systems NOT to modify).

## Drafting Approach

1. Start with the BLUF. Write it first, even if rough.
2. Fill in Objective and Background for context.
3. Explore and consider possible approaches if applicable.
   Consider starting a supplemental `/cdocs:report` here.
4. For decision proposals, stay at a medium level of depth, analyze options, and recommend a decision/approach.
5. For implementation proposals:
   - Break the solution into phases.
   - Write test plan and acceptance criteria for each phase.
   - Consider edge cases and refine the above based on them.
6. Reviewing the author checklist
7. Revisit and refine the BLUF and frontmatter based on completed draft.

## Author Checklist

Before marking status as `review_ready`:
- [ ] BLUF clearly states the approach without surprises, and lines up with the final settled approach.
- [ ] All relevant documentation and sources listed, most important emphasized in the BLUF.
- [ ] Technical decisions explain "why" not just "what."
- [ ] Follow writing conventions: critical/detached analysis, brevity, commentary decoupled from technical content.
- [ ] NOTE/TODO/WARN callouts added where future readers need context.
- [ ] Review the following and improve as relevant:
  - [ ] whether someone unfamiliar with the context could follow the proposal.
  - [ ] whether there is anything inconsitent or missing from the initial draft.
- [] Request a substantive `/cdocs:review` from a subagent and integrate it's feedback.
     This review should be immediately archived - it is a sanity check / way to cover our bases early.


## Revisions

When revising a proposal:
- Per our writing convention, proposals should retain History-Agnostic Framing, with past states only mentioned in `> NOTE` callouts if at all.
- Proposals with `status: evolved` have been superseded by a follow-up proposal.
  This approach should be preferred when a proposal is already being worked on.
- An ammended proposal MUST be returned to `status: review_ready`.
