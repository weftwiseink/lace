---
review_of: cdocs/proposals/2026-02-09-wezterm-mouse-selection-copy-mode.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T14:45:00-08:00
task_list: lace/dotfiles-wezterm
type: review
state: archived
status: done
tags: [self, wezterm, copy-mode, mouse, feasibility, architecture-constraints]
---

# Review: WezTerm Mouse Selection to Copy Mode Transition

## Summary Assessment

This proposal investigates whether mouse text selection can automatically enter wezterm copy mode, and honestly concludes that the ideal behavior is not achievable due to wezterm's architecture (CopyOverlay clears selection on creation, no Lua API for selection coordinates). The research is thorough and well-sourced. The proposed partial workaround (auto-enter copy mode on mouse Up with selection detection) is technically sound but the proposal itself acknowledges serious UX issues that undermine the value proposition. Three blocking findings require attention: a factual error about cursor positioning, a missing `CompleteSelectionOrOpenLinkAtMouseCursor` fallback for the no-selection case losing link-at-cursor detection, and the need for the proposal to take a clearer stance on whether to recommend implementation or recommend the status quo.

**Verdict: Revise** -- the blocking issues are addressable but the proposal needs to commit to a recommendation rather than deferring the decision entirely to the implementation agent.

## Section-by-Section Findings

### BLUF

**Non-blocking.** The BLUF is comprehensive and honest about limitations. It correctly identifies the core constraint (CopyOverlay initializes with `start: None`). The link to the wezterm source is a good touch. One minor issue: the BLUF says the cursor is placed "at the selection endpoint" but the "What This Does NOT Achieve" section later contradicts this, stating the cursor goes to "the terminal's current cursor position... not at the mouse selection endpoint." The BLUF should be consistent with the body.

### Background / Architecture Constraints

**Non-blocking.** This is the strongest section. The three constraints are well-researched and clearly articulated. The source code investigation (CopyOverlay `start: None` initialization) adds credibility beyond what documentation alone could provide. The references to issues #5952 and #1954 are relevant.

One note: constraint #3 states `SetSelectionMode` is "silently ignored" if called before `ActivateCopyMode`. The proposal later relies on calling `SetSelectionMode` immediately *after* `ActivateCopyMode` inside an `action_callback`. The distinction between "before" (silently ignored) and "after inside a callback" (might work) could be more precisely articulated.

### Proposed Solution

**Blocking (B1): Factual inconsistency about cursor position.** The "What This Achieves" section claims "The copy mode cursor starts at the position where the mouse selection ended." The "What This Does NOT Achieve" section directly contradicts this: "The copy mode cursor position depends on where wezterm places it when creating the CopyOverlay, which is at the terminal's current cursor position (typically the bottom of the visible area or the last output position), not at the mouse selection endpoint." The source code research confirms the latter -- `CopyOverlay::with_pane()` uses the pane's cursor position, not any mouse coordinate. The "What This Achieves" bullet must be corrected or removed.

**Blocking (B2): The `CompleteSelectionOrOpenLinkAtMouseCursor` fallback in the no-selection branch needs a subtle but important consideration.** When the user performs a click-drag that selects text, `get_selection_text_for_pane` returns non-empty and the callback enters the selection branch. But what about a very short drag that does not actually highlight any characters? The user's intent may have been a click, not a select. The current code handles this correctly (empty string falls through). However, there is a timing concern: does `get_selection_text_for_pane` on the `Up` event return the selection as it exists *at that moment* (before `CompleteSelection` is called)? If the selection is only "completed" after `CompleteSelection` runs, then the text may already be available for reading during the drag. This is likely fine but should be noted as an assumption requiring empirical validation.

Actually, I will downgrade B2 to non-blocking since it is an empirical question rather than a design flaw.

**Blocking (B3): The proposal does not commit to a recommendation.** The "Alternative Considered: Do Nothing (Status Quo)" section says "this might be the right answer." Open Question #1 asks "Is the partial workaround worth the complexity?" and defers to the implementation agent. The proposal must take a position. A proposal that says "maybe do this, maybe don't, let the implementer decide" is not actionable. Either recommend the workaround with clear criteria for when to revert, or recommend the status quo with the workaround documented as a future option pending upstream changes.

### Design Decisions

**Non-blocking.** Decision 1 (use `action_callback`) is well-reasoned. Decision 2 (complete PrimarySelection first) is sound. Decision 3 (SetSelectionMode timing risk) correctly identifies the key risk. Decision 4 (single click only) is conservative and appropriate. Decision 5 (opt-in) is reasonable but somewhat at odds with the "this is a proposal" framing -- proposals should recommend, not hedge.

### Edge Cases

**Non-blocking.** The "Copy mode already active" edge case is important and correctly identified as needing empirical testing. Consider adding a specific mitigation: check `window:active_key_table()` inside the callback. If it returns `'copy_mode'`, skip the `ActivateCopyMode` call to avoid resetting an active overlay. This is available in the Lua API and would eliminate the re-entry risk entirely.

### Test Plan

**Non-blocking.** The test plan correctly follows the TDD validation workflow from the dotfiles CLAUDE.md. Phase 6 (empirical validation of SetSelectionMode timing) is appropriately flagged as highest-risk. One improvement: Phase 3 should include a test for the edge case where text is selected but the user clicks elsewhere (clearing the selection) before release. Does the `Up` event still see the selection?

The test plan link (`[WezTerm TDD Validation Workflow](https://github.com/dotfiles/CLAUDE.md)`) points to a non-existent URL. It should reference the local file path in the dotfiles repo.

### Implementation Phases

**Non-blocking.** The phases are logical and appropriately scoped. Phase 2 (validate SetSelectionMode timing) is correctly separated from Phase 1, allowing the implementation to proceed even if SetSelectionMode does not work.

### Open Questions

**Non-blocking.** Question #2 (upstream feature request) is the most valuable insight in the proposal. This should be promoted from an open question to an explicit recommendation in the Proposed Solution section -- file the upstream request regardless of whether the workaround is implemented.

## Verdict

**Revise.** The research quality is high and the architectural constraints are well-documented. However, the proposal needs to resolve the blocking issues before it can be accepted as actionable guidance for an implementation agent.

## Action Items

1. [blocking] Fix the factual inconsistency in "What This Achieves" about cursor position. The copy mode cursor does NOT start at the mouse selection endpoint -- it starts at the pane's terminal cursor position. Either correct this bullet or remove it.
2. [blocking] Commit to a clear recommendation. Either: (a) recommend implementing the workaround with explicit criteria for when to revert to status quo (e.g., "if SetSelectionMode does not work AND the cursor lands far from the selection, revert"), or (b) recommend the status quo and document the workaround as a future option pending upstream support. The proposal cannot defer this decision to the implementer.
3. [non-blocking] Add `window:active_key_table()` check to the callback code to handle the "already in copy mode" edge case. This eliminates a real risk with a simple guard.
4. [non-blocking] Promote open question #2 (upstream feature request) to an explicit recommendation. Filing the upstream request is valuable regardless of the workaround decision.
5. [non-blocking] Fix the test plan link to reference the actual dotfiles CLAUDE.md path rather than the non-existent GitHub URL.
6. [non-blocking] Note in the BLUF that the cursor position in copy mode will be at the terminal cursor, not the mouse selection endpoint. The current BLUF wording ("selection endpoint") is misleading.
