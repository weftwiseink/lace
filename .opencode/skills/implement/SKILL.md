---
name: implement
description: Implement an accepted proposal with structured execution, devlog tracking, and frequent commits
argument-hint: "[proposal_path]"
---

# CDocs Implement

Implement a ready proposal.

**Usage:** User-invoked when a proposal has been reviewed and accepted (`status: implementation_ready`).
Claude may also suggest implementation when it encounters an `implementation_ready` proposal.

## Invocation

### With a proposal path
```
/cdocs:implement cdocs/proposals/2026-01-29-topic.md
```
Directly begin implementing the specified proposal.

### Without arguments
```
/cdocs:implement
```
Scan `cdocs/proposals/` for documents with `status: implementation_ready`.
Present the list to the user and ask which proposal to implement.
If no proposals are `implementation_ready`, report that and suggest checking `/cdocs:status --type=proposal`.

## Behavior

1. **Select proposal**: resolve from `$ARGUMENTS` or scan and present `implementation_ready` proposals.
2. **Read the proposal fully**: understand the objective, design decisions, implementation phases, and test plan.
3. **Create a devlog**: invoke `/cdocs:devlog` for the implementation session.
   - Set `task_list` to match the proposal's `task_list`.
   - Reference the proposal path in the devlog's Objective section.
4. **Create a task list**: break the proposal's implementation phases into trackable tasks.
5. **Execute implementation phases** following the proposal's plan:
   - Work through phases sequentially (or in parallel per `rules/workflow-patterns.md` when applicable).
   - Commit frequently using conventional commit format.
   - Update the devlog as work proceeds (decisions, complications, deviations from the plan).
   - Follow verification and troubleshooting methodology to ensure results are as expected.
  - Request `/cdocs:review` from a subagent after each phase to catch issues early.
  - Request `/cdocs:report` for research topics not covered by the proposal to find answers without losing your focus.
6. **On completion**: update the devlog with verification results, mark it `status: review_ready`.
7. **After completion**:
  - Have a final subagent `/cdocs:review` the entire body of work and integrate the feedback.
  - IMPORTANT: Take a step back and seriously consider how "verified" our implementation truly is.
    This retrospection is critical to our long-term implementation velocity:
    If we aren't equipping implementers with the right tools to verify their work,
    That is a project-level concern we need to think about.
    IE: A webdev needs something like playwright, otherwise they'll be forced to guess & shoot from the hip.
   

## Implementation Conventions

The implementor should follow these conventions throughout:

### Commit frequently
- Use conventional commit format (`feat:`, `fix:`, `refactor:`, `docs:`, etc.).
- Commit after each logical unit of work, not just at the end.
- Commits should be small and focused: one concern per commit.

### Maintain the devlog
- The devlog is important for future understanding for the implementation session.
- Update it as you go, not just retroactively.
- Document: what was done, why decisions were made, what deviated from the plan, what didn't work.

### Use cdocs skills as appropriate
- `/cdocs:review` when implementation is complete and ready for evaluation.
- `/cdocs:report` if the implementation reveals findings worth documenting separately.

### Note deviations from the proposal
- If the implementation diverges from the proposal's design, document why in the devlog.
- Use `> NOTE(author/workstream):` callouts in the devlog for deviations (ie `> NOTE(opus/cdocs/haiku_subagent)`).
- DO NOT silently change the approach: surface deviations front and center.

## Status Transitions

Implemetation should:
- Update proposal status to `implementation_ready -> implementation_wip` for duration.
- Maintain status of work and review in devlog's frontmatter.
- Go through subagent `/cdocs:review` loops until accepted or escalation needed
  > NOTE: Reviewer here should focus on code and verification records in the devlog
- Only update the proposal's status to `implementation_accepted` if and when the _human user_ accepts the implementation.