---
review_of: cdocs/proposals/2026-03-24-sprack-iteration-phasing-plan.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T19:00:00-07:00
task_list: terminal-management/sprack-iteration-plan
type: review
state: live
status: done
tags: [fresh_agent, architecture, phasing, dependency_analysis, sprack]
---

# Review: Sprack Iteration Phasing Plan

## Summary Assessment

This proposal organizes six sprack improvement proposals into a four-phase execution plan with dependency ordering, subagent allocation, and validation checkpoints.
The phasing is well-structured and mostly respects the ordering constraints from the cross-coherence review.
Two issues need attention: the coherence review's recommended ordering for the format string vs IPC migration conflict is adopted but the Mermaid diagram has a dependency edge that contradicts the stated Phase 3 wait condition, and Phase 2B's dependency on Phase 1B is stated but not justified with enough specificity.
The validation approach is appropriately iterative and empirical, with per-phase manual TUI checkpoints.

## Section-by-Section Findings

### BLUF and Principles

The BLUF is clear and well-structured, covering the four phases and their rationale in sequence.
The four principles (iterative validation, incremental landing, test infrastructure first, dependency-based sequencing) are sound and consistent with the user's request for empirical, iterative development.

No issues.

### Phase Overview (Mermaid Diagram)

The Mermaid diagram shows `P1A --> P3` as a direct edge, meaning Phase 3 depends on Phase 1A.
However, the diagram also shows `V2 --> P3`, meaning Phase 3 depends on Phase 2 validation.
The text in the Phase 3 section says "Must happen after Phase 1A" and the subagent summary table says Phase 3 depends on "Phase 1A, Phase 2 validation."
Open question 3 recommends waiting for Phase 2 validation.

**Issue [non-blocking]:** The `P1A --> P3` edge in the Mermaid diagram is redundant given `V2 --> P3`, since V2 already transitively depends on P1A (via P2A).
The redundant edge is not wrong, but it clutters the diagram and could confuse readers about whether Phase 3 has an independent dependency on Phase 1A separate from the Phase 2 validation gate.
Removing `P1A --> P3` would make the diagram cleaner and align with the recommendation in open question 3 that Phase 3 should wait for all Phase 2 work.

### Coherence Review Ordering Constraints

The coherence review identified three integration conflicts and two coordination gaps.
Checking the phasing plan against each:

1. **[BLOCKING] Format string vs IPC migration (Conflict 1):** The coherence review recommended layout org first, then IPC migration.
The phasing plan adopts this ordering (Phase 1A before Phase 3).
This is correct and well-handled.

2. **[NON-BLOCKING] ClaudeSummary schema divergence (Conflict 2):** The phasing plan places inline summaries (2A) and session cache (2B) in the same phase.
This creates the right window for coordinating the ClaudeSummary extensions, but the proposal does not explicitly mention addressing the coherence review's recommendation to add format string placeholders for session cache fields.
This should be noted as a coordination task within Phase 2.

3. **[NON-BLOCKING] Duplicate workspace-path resolution (Conflict 3):** The phasing plan correctly has session cache (2B) depend on Phase 1B (process host awareness), which implies the PaneResolver will be available.
But the proposal does not explicitly state that Phase 2B should use PaneResolver for session discovery rather than reimplementing it.
This should be called out as a subagent briefing requirement.

4. **[NON-BLOCKING] Schema versioning (Gap 1):** Not addressed in the phasing plan.
The layout organization proposal introduces `user_version = 1`, and the coherence review recommended documenting the convention for future increments.
This is a minor gap: the phasing plan could note it in the Phase 1A deliverables.

5. **Verifiability dependencies (Gap 2):** Correctly handled by making Phase 0 the foundation.

### Phase 0: Verifiability Infrastructure

Well-scoped.
Limiting to Phase 1 of the verifiability proposal (mock infrastructure only) is the right call: building the full test suite before features exist to test would be premature.
The "no manual TUI validation needed" note is correct since this phase changes no behavior.

No issues.

### Phase 1: Data Foundation

The parallel structure (1A + 1B) is correct: these workstreams are independent and both depend only on Phase 0.

**Phase 1A:** Scope and deliverables are clear.
Validation checkpoint is appropriate (spatial ordering + metadata density at different widths).

**Phase 1B:** Scoping to Phase 1 of the process host awareness proposal (container detection + bind-mount resolution) and deferring Phases 2-3 is sensible.
The deliverables list is specific and actionable.

No issues.

### Phase 2: Rich Display

**Phase 2A (Inline Summaries):** The deliverable "Detail pane removed at Compact/Standard/Wide tiers" is significant UX work that should be validated carefully.
The scope note "Phase 2 (multi-line TreeItem evaluation) runs as part of this phase but is a prerequisite gate, not a deliverable" is a good framing: it prevents the multi-line investigation from blocking the phase's core value.

**Phase 2B (Session Cache):** The dependency on Phase 1B is stated ("Depends on Phase 1B's PaneResolver for session file discovery") but the session cache proposal's own architecture could function without PaneResolver by using its own workspace-path resolution.
The phasing plan correctly makes 2B depend on 1B to avoid the duplicate resolution logic identified in the coherence review, but this rationale should be stated explicitly so the subagent understands it is a deduplication constraint, not a technical hard dependency.

**Issue [blocking]:** Phase 2B's dependency description says "Depends on Phase 1B's PaneResolver for session file discovery (the cache ingests whatever file the resolver provides)."
This conflates two things: (a) the session cache needs to know which session file to ingest, and (b) the PaneResolver provides that file path.
But the session cache proposal describes its own resolution logic ("Session Discovery Without /proc") that could work independently.
The dependency is an architectural choice to avoid duplication, not a hard technical requirement.
The distinction matters because if Phase 1B is delayed, Phase 2B could proceed with its own resolution logic and refactor to PaneResolver later.
The proposal should clarify this: the dependency is a deduplication constraint, and if Phase 1B is blocked, Phase 2B can proceed with its own discovery logic as a fallback.

### Phase 3: Cleanup

Placing tmux IPC migration last is correct per the coherence review.
The NOTE callout about the tmux-interface-rs fallback is valuable: it prevents the phase from being blocked by library evaluation results.

The dependency on Phase 2 validation (not just Phase 1A) is the right call for the reasons stated in open question 3.

No issues.

### Phase 2+ (Ongoing): Verifiability Completion

Framing this as ongoing background work is appropriate.
However, the "can run in parallel with any phase" claim needs qualification: Tier 3C tests (PaneResolver dispatch) depend on Phase 1B completing, and TUI snapshot tests are most valuable after Phase 2A changes the TUI layout.

**Issue [non-blocking]:** Add a note that certain verifiability tiers have implicit ordering preferences even though the work is nominally parallel.

### Subagent Summary Table

The table is clear and useful.
Peak parallelism of 2 subagents is realistic.
Total estimate of 26-39 hours is reasonable for the scope described.

**Issue [non-blocking]:** The table shows Phase 2+ (verifiability completion) depending on "Phases 1-2 (for test targets)" but the effort estimate (4-6 hours) seems low for the full remaining scope (Tier 2 integration tests, Tier 3 boundary mocks, TUI snapshots, manual runbook).
The verifiability proposal's Phases 2-3 are substantial.
Consider either raising the estimate or explicitly noting which verifiability tiers are included in this 4-6 hour window.

### Commit Strategy

The suggested commit granularity is helpful and appropriately fine-grained.
No issues.

### Risk: Phase 1B Validation Requires Host Environment

This risk is correctly identified and the mitigation (automated tests provide ~80% confidence) is honest.
The framing avoids glossing over the limitation.

No issues.

### Risk: Subagent Context Loss Across Phases

The four-item mitigation list (proposal, devlog, git diff, verifiability report) is practical.
This is a real risk with subagent-driven development and the mitigations are appropriate.

**Issue [non-blocking]:** Consider adding "the coherence review" to the subagent prompt list.
Subagents implementing Phase 2+ work need to understand the cross-proposal integration constraints, not just the individual proposal.

### Open Questions

All three questions have clear recommendations.
The recommendations are consistent with the analysis in the body of the proposal.

**Issue [non-blocking]:** Open question 1 (shared vs separate devlogs) recommends separate devlogs with a coordinating devlog.
This is reasonable but the coordinating devlog should be mentioned in the Phase 1 section itself, not just in the open questions, since it is the mechanism for bridging context between 1A and 1B for Phase 2 subagents.

## Dependency Cycle Analysis

No circular dependencies exist in the proposal.
The dependency graph is a DAG:
- Phase 0 has no dependencies.
- Phases 1A, 1B depend only on Phase 0.
- Phase 2A depends on 1A and 1B.
- Phase 2B depends on 1B.
- Phase 3 depends on Phase 2 validation (which depends on 2A and 2B).
- Phase 2+ is advisory, not blocking.

This is clean and correct.

## Coherence Review Compliance Matrix

| Coherence Review Item | Status in Phasing Plan |
|---|---|
| Conflict 1: Layout org before IPC migration | Addressed (Phase 1A before Phase 3) |
| Conflict 2: ClaudeSummary schema coordination | Partially addressed (same phase, but no explicit coordination task) |
| Conflict 3: Deduplicate workspace-path resolution | Implicitly addressed (2B depends on 1B), but rationale not stated |
| Gap 1: Schema versioning convention | Not addressed |
| Gap 2: Verifiability dependencies | Addressed (Phase 0 foundation) |
| Recommendation: ClaudeSummary to sprack-db | Not mentioned in phasing plan |

## Verdict

**Revise.**

The proposal is well-structured and demonstrates sound engineering judgment on phasing and dependency ordering.
One blocking issue (Phase 2B dependency characterization) needs clarification.
Several non-blocking items would improve the document's precision and its utility as a subagent briefing reference.

## Action Items

1. [blocking] Clarify Phase 2B's dependency on Phase 1B: state that it is a deduplication constraint (avoiding duplicate workspace-path resolution logic), not a hard technical dependency. Note the fallback: if Phase 1B is delayed, Phase 2B can proceed with its own discovery logic and refactor to PaneResolver later.
2. [non-blocking] Remove the redundant `P1A --> P3` edge from the Mermaid diagram, since Phase 3's dependency on Phase 2 validation already transitively includes Phase 1A.
3. [non-blocking] Add a Phase 2 coordination note: inline summaries (2A) should define format string placeholders for session cache fields (`user_turns`, `context_trend`, `tool_counts`), per the coherence review's Conflict 2 resolution.
4. [non-blocking] Add a note in Phase 2B that the subagent should use PaneResolver for session file discovery rather than reimplementing the workspace-path resolution algorithm, per the coherence review's Conflict 3 resolution.
5. [non-blocking] Note the ClaudeSummary-to-sprack-db migration as a Phase 1 prerequisite or Phase 2 coordination task, per the coherence review's recommendation.
6. [non-blocking] Add the coherence review to the subagent context loss mitigation list (item 5 alongside proposal, devlog, git diff, verifiability report).
7. [non-blocking] Qualify the Phase 2+ verifiability completion estimate (4-6 hours) or specify which tiers are included in that window.
8. [non-blocking] Note that certain verifiability tiers have implicit ordering preferences (Tier 3C after Phase 1B, TUI snapshots after Phase 2A) even though the work is nominally parallel.
