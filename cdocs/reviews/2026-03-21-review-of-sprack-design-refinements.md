---
review_of: cdocs/proposals/2026-03-21-sprack-design-refinements.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T21:00:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [fresh_agent, architecture, responsive_layout, input_model, claude_integration, daemon]
---

# Review: sprack Design Refinements

## Summary Assessment

This supplemental proposal refines four aspects of the sprack architecture: responsive layout with breakpoint tiers, simplified keyboard/mouse input, deep Claude Code integration via session file reading, and auto-start daemon behavior.
The document is well-structured, covers its scope thoroughly, and provides concrete implementation details (breakpoint constants, CLI commands, polling strategies, config file format).
The most significant concern is that this document is largely redundant with the per-component proposals it feeds into: the sprack-tui component proposal and sprack-claude proposal contain identical or more detailed versions of every section here.
Verdict: Accept with non-blocking suggestions.

## Section-by-Section Findings

### Frontmatter

The frontmatter is well-formed and compliant with the spec.
Tags are descriptive and relevant.
No issues.

### BLUF

Clear and effective.
Establishes the document as supplemental and links to the parent roadmap.
The BLUF correctly sets expectations that this is a refinement document, not a standalone design.

### Section 1: Responsive Layout

**Finding (non-blocking): Redundancy with sprack-tui component proposal.**
The sprack-tui component proposal contains a more detailed version of everything in this section: the same four breakpoint tiers (with identical width ranges), the same constraint system, the same truncation priority order, and more (mockups, Rust code snippets, edge case handling).
This section adds no information beyond what the component proposal provides.
The only unique element is the ASCII layout diagram, which the component proposal replaces with four tier-specific mockups.

**Finding (non-blocking): Minor inconsistency in Standard tier upper bound.**
This document defines Standard as "30-60 cols" (line 34).
The sprack-tui component proposal defines it as "30-59 cols" (line 98) with Wide starting at 60.
The difference is cosmetic in table display but the ranges should be consistent: 30-59 for Standard and 60-99 for Wide is the precise interpretation that matches the Rust `match` code in the component proposal.

**Finding (non-blocking): Layout diagram uses ASCII instead of Mermaid.**
The writing conventions prefer Mermaid over ASCII for diagrams.
The ASCII layout box on lines 45-55 could be a table or omitted entirely given the component proposal's mockups.

### Section 2: Input Model

**Finding (non-blocking): History-agnostic framing violation.**
Line 80: "Simplified from the original proposal."
Line 92: "Removed from original."
These reference prior document versions, which violates the history-agnostic framing convention.
The content should stand on its own: just present the current key bindings without referencing what was removed.

**Finding (non-blocking): Redundancy with sprack-tui component proposal.**
The sprack-tui component proposal includes the same keybinding table (with the addition of arrow key aliases) and the same mouse support table.
The focus behavior and tmux command construction are also covered more thoroughly in the component proposal's tmux navigation section.

**Finding (non-blocking): "pixel positions" phrasing in mouse support.**
Line 107: "The TUI maps pixel positions to tree node indices."
This is a terminal TUI, not a GUI: the mapping is from cell coordinates, not pixel positions.
The sprack-tui component proposal correctly notes that `tui-tree-widget`'s `click_at()` handles hit testing internally.

### Section 3: Deep Claude Code Integration

This is the most substantial section and provides useful architectural overview of the Claude session file format, the PID-walk resolution chain, status extraction logic, and rendering strategy.

**Finding (non-blocking): Redundancy with sprack-claude component proposal.**
The sprack-claude proposal contains everything in this section with significantly more detail: the full Rust struct definitions for JSONL entry types, the backward-read algorithm, caching strategy, error handling for each failure mode, and test plans.
This section serves as a high-level overview, which has value for readers who want the gist without reading the full component proposal.
That said, the overlap is extensive enough that maintaining both documents risks drift.

**Finding (non-blocking): Entry type table may be incomplete.**
The table on lines 137-141 lists `assistant`, `progress (agent_progress)`, `user`, and `system` entry types.
The sprack-claude proposal mentions additional types that are skipped: `last-prompt`, `agent-name`.
This is acceptable for an overview, but a reader relying solely on this document would miss the filtering logic.

**Finding (non-blocking): Subagent count extraction is vague.**
Line 163: "Count distinct `toolUseID` values in recent `agent_progress` entries that lack a corresponding completion."
The sprack-claude proposal acknowledges this is imprecise and includes a TODO about validating against real session files.
This section omits that caveat, presenting the heuristic as settled design.
A NOTE callout acknowledging the approximation would be appropriate.

### Section 4: Daemon Auto-Start

**Finding (non-blocking): Redundancy with sprack-tui component proposal.**
The daemon launcher logic, PID file management, and shutdown behavior are all covered in the sprack-tui component proposal's "Daemon Launcher" section with more implementation detail (Rust code snippets, Mermaid flowcharts, PID validation checks).

**Finding (non-blocking): PID file validation is underspecified here.**
Line 218: "sprack validates PID files: if the PID exists but the process is dead, remove the stale PID file and restart."
The sprack-tui component proposal adds a critical fourth check: verifying the process is the correct binary (read `/proc/<pid>/cmdline`), not just that a process with that PID exists.
This distinction matters because PID reuse could make sprack think a random process is sprack-poll.

### Relationship to Component Proposals (Table)

The cross-reference table is useful and complete.
It correctly maps each refinement to its component proposal destination.

## Overall Document Role Assessment

The core question with this document is whether it serves a purpose distinct from the component proposals.
The parent roadmap (`sprack-tmux-sidecar-tui.md`) already provides high-level summaries of responsive layout, input model, and daemon behavior, and links to both this document and the component proposals.
This creates a three-layer documentation hierarchy (roadmap -> refinements -> component proposals) where the middle layer largely restates what the other two provide.

The document appears to have been written as an intermediate step: design decisions were refined here before being incorporated into the per-component proposals.
Now that the component proposals exist and are more detailed, this document's primary value is as a consolidated cross-cutting reference for readers who want all four refinements in one place without reading three separate proposals.
That is a valid role, but it should be acknowledged in the BLUF or a NOTE callout.

## Verdict

**Accept.**

The document is well-written, technically sound, and internally consistent (aside from the minor Standard-tier width range discrepancy).
All four design refinements are clearly articulated with sufficient detail for their intended audience.
The non-blocking issues are primarily about redundancy with the downstream component proposals and minor convention violations.
None of these require revision before the document can serve its purpose.

## Action Items

1. [non-blocking] Align the Standard tier width range to "30-59 cols" for consistency with the sprack-tui component proposal's precise breakpoint definitions.
2. [non-blocking] Remove history-referencing language in Section 2 ("Simplified from the original proposal", "Removed from original") per history-agnostic framing convention.
3. [non-blocking] Fix "pixel positions" to "cell coordinates" in the mouse support description (line 107).
4. [non-blocking] Add a NOTE callout to the subagent count metric (Section 3) acknowledging that the extraction is a heuristic, mirroring the TODO in the sprack-claude component proposal.
5. [non-blocking] Consider adding a NOTE callout to the BLUF or introduction clarifying this document's role as a consolidated cross-cutting overview, given that the component proposals now contain all of this content in greater detail.
6. [non-blocking] Add the fourth PID validation check (verify correct binary, not just PID existence) to Section 4, or reference the sprack-tui proposal for the full validation logic.
