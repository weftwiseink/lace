---
review_of: cdocs/reports/2026-03-21-zellij-migration-feasibility.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T11:30:00-07:00
task_list: terminal-management/zellij-migration
type: review
state: live
status: done
tags: [rereview_agent, architecture, terminal_management, migration, risk_analysis]
---

# Review (Round 2): Zellij Migration Feasibility Analysis

## Summary Assessment

This is a round 2 re-review following revisions that addressed all 8 action items from round 1 (2 blocking, 6 non-blocking).
The report evaluates zellij as a replacement for wezterm's multiplexing layer, covering migration path, copy mode analysis, and integration architecture.
All blocking issues have been resolved: the host terminal emulator question is now explicitly addressed with a dedicated subsection and BLUF mention, and all three architecture options carry effort estimates with a comprehensive cost comparison table.
The document is well-structured, critically honest about risks (especially the copy mode gap), and actionable for migration planning.

Verdict: **Accept.**

## Round 1 Action Item Resolution

### 1. [blocking] Host terminal emulator question

**Resolved.**
A new "Host Terminal Emulator" subsection (Part 3) evaluates four options: wezterm-as-emulator-only, ghostty, kitty, and alacritty.
The analysis correctly notes the choice is orthogonal to the zellij migration and recommends evaluating ghostty or kitty during Phase 0.
The BLUF now explicitly mentions "with a separate terminal emulator (ghostty, kitty, or wezterm-as-emulator-only) on the host."
A NOTE callout in the Context section cross-references the analysis.

### 2. [blocking] Cost/effort estimates

**Resolved.**
Each architecture option now includes inline effort estimates (Option A: Small, Option B: Medium, Option C: Medium-high 2-4 weeks).
The Recommendations section contains a component-level effort comparison table with T-shirt sizes and time ranges.
The total estimate (4-6 weeks with plugin, 1-2 weeks without) is realistic and useful for planning.
The Rust/WASM toolchain barrier is explicitly acknowledged as "a meaningful barrier for a project that has been Lua/TypeScript-centric."

### 3. [non-blocking] Vague migration motivation

**Resolved.**
The Context section now lists four specific pain points: font rendering inconsistencies across GPU backends, flickering during rapid output, tab bar customization constraints, and mux server crashes.
This is concrete enough to justify the investigation.

### 4. [non-blocking] Community plugin maturity

**Resolved.**
A NOTE callout under the Sidebar Tabs section now assesses maintenance status per plugin: zellij-autolock and zjstatus actively maintained with recent releases, zellij-vertical-tabs has fewer contributors but targets a stable API surface, zellij-sessionizer actively maintained.
Includes an appropriate caveat about verifying maturity before committing.

### 5. [non-blocking] Session resurrection with SSH panes

**Resolved.**
The Session and Multiplexing Model section now explains that resurrection serializes the SSH command and arguments, re-establishes on ENTER press, and notes the `--force-run-commands` flag for auto-reconnect.
The tradeoffs (manual reconnection step vs. auto-reconnect risk) are clearly stated.

### 6. [non-blocking] /data deletion impact

**Resolved.**
A WARN callout under Plugin Filesystem explains the impact on Docker discovery caching and provides two workarounds: FullHdAccess filesystem path or re-query Docker on each load.
The workarounds are practical and adequately assessed.

### 7. [non-blocking] SSH connection multiplexing

**Resolved.**
Option C now includes a bullet point on ControlMaster/ControlPath/ControlPersist for sharing TCP connections across panes.
The investigation areas section also lists this for testing.

### 8. [non-blocking] ASCII diagrams to Mermaid

**Resolved.**
All three architecture option diagrams are now Mermaid `graph TD` diagrams.
They render cleanly and communicate the architecture clearly.

## New Observations (Round 2)

### BLUF Quality

**Non-blocking.** The BLUF is now excellent: four lines covering viability, largest cost, largest risk, and recommended architecture including the host emulator question.
It satisfies the "no surprises" criterion well.

### Writing Conventions Compliance

**Non-blocking.** Sentence-per-line formatting is well followed throughout.
Callout syntax is correct with proper attribution.
No emojis, no em-dashes.
Mermaid diagrams replace all previous ASCII art.
One minor observation: the KDL code block (lines 422-446) is a useful concrete example but the SSH args use a simplified form (`-t container-name "cd /workspace && nvim"`).
In practice this would need a hostname or SSH config alias, but this is fine for an illustrative example in a feasibility report.

### Document Structure

**Non-blocking.** The three-part structure (migration path, copy mode, architecture) is logical and thorough.
The progression from analysis to recommendations to phased plan creates a natural decision-making flow.
The effort comparison table in the Recommendations section is a strong addition that makes the report actionable.

### Critical Honesty

The report maintains its strongest quality from round 1: unflinching honesty about limitations.
The copy mode section does not oversell plugin workarounds.
The effort estimates acknowledge the Rust toolchain barrier.
The /data WARN callout does not hide the limitation.
This is exactly the right tone for a feasibility report.

## Verdict

**Accept.**

All round 1 blocking issues are resolved.
All non-blocking suggestions have been addressed with substantive additions rather than superficial patches.
The report is thorough, well-structured, critically honest, and actionable for migration planning.
No new blocking issues identified.

## Action Items

No blocking items remain.

1. [non-blocking] The KDL layout example SSH args are simplified for illustration. When building real layouts, ensure SSH config aliases or full hostnames are used. This is not a document issue, just an implementation note.
2. [non-blocking] Consider adding a brief note on zellij's update/release cadence to help assess long-term maintenance risk. This is minor and does not block acceptance.
