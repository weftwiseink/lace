---
review_of: cdocs/reports/2026-03-21-zellij-migration-feasibility.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T10:15:00-07:00
task_list: terminal-management/zellij-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, terminal_management, migration, risk_analysis]
---

# Review: Zellij Migration Feasibility Analysis

## Summary Assessment

This report evaluates zellij as a replacement for wezterm's multiplexing layer, covering migration path, copy mode analysis, and integration architecture.
The analysis is thorough, well-structured, and demonstrates deep familiarity with both tools' capabilities.
The copy mode gap analysis (Part 2) is particularly strong: it gives an honest, unflinching assessment of zellij's most significant limitation rather than glossing over it.
The most important deficiency is that the report's architectural recommendations lack cost/effort estimates and risk quantification, which would be critical for an actual migration decision.

Verdict: **Revise** - two blocking issues around missing cost analysis and an unresolved architectural question.

## Section-by-Section Findings

### Frontmatter

**Non-blocking.** Frontmatter is well-formed and compliant with the spec.
All required fields are present with valid values.

### BLUF

**Non-blocking.** The BLUF is effective: it communicates the viability conclusion, the largest cost (WASM rewrite), the largest risk (copy mode), and the recommended architecture.
One minor improvement: the BLUF does not mention that a separate terminal emulator is still required (zellij is multiplexer-only), which is a significant architectural consideration for the current wezterm-as-everything stack.

### Context / Background

**Non-blocking.** The three-layer description of the current stack is clear and grounded in the actual codebase (the lace.wezterm plugin, wezterm-mux-server devcontainer feature, host Lua config).
The claim of "705 lines of Lua" for the discovery plugin could not be verified since no `.lua` files exist in the current repo tree (the plugin likely lives in the dotfiles repo or has been removed), but this is a minor factual detail.

The phrase "Wezterm has shown rendering issues and limitations" is vague.
A sentence or two on what specific rendering issues motivate the migration would strengthen the rationale.

### Part 1: Migration Path and Feature Parity

**Non-blocking.** This section is comprehensive and well-organized.
The keybinding migration table is useful.
The feature gap analysis at the end is the strongest subsection: gains and losses are clearly separated with no hedging.

One observation: the sidebar tabs section references `zellij-vertical-tabs` as a community plugin, but the report does not assess the maturity or maintenance status of any community plugins it recommends.
For a migration decision, knowing whether these plugins are actively maintained matters.

The session resurrection comparison is valuable but omits one detail: does zellij's resurrection handle SSH-command panes correctly?
If a layout uses `command "ssh" ...` panes, does resurrection re-establish those connections?
This is directly relevant to the recommended Option C architecture.

### Part 2: Copy Mode and Vim-Like Scroll Support

**Non-blocking.** This is the strongest section of the report.
The detailed motion comparison table is excellent: it gives a precise, quantified comparison (40 vs 20 vs 8 motions) rather than hand-waving.
The WARN callout is appropriate for the severity.

The maintainer position analysis (issue #947, conscious design choice) is exactly the kind of strategic context that a feasibility report should surface.
It correctly identifies that this limitation is unlikely to change.

The plugin extensibility subsection is honest about the architectural awkwardness of building a custom copy mode, noting "no cursor overlay capability" and "scrollback-to-screen-position mapping is non-trivial."
This avoids the trap of overpromising on plugin-based workarounds.

### Part 3: API Surface and Lace Integration Architecture

**Blocking.** The three architecture options (A, B, C) are well-described, but the analysis lacks comparative cost/effort estimates.
Option C is labeled "Recommended" but the report does not quantify the effort to build the lace.zellij WASM plugin.
The current lace.wezterm plugin is described as 705 lines of Lua: what is the estimated effort to rewrite this in Rust targeting wasm32-wasi?
The Rust/WASM toolchain barrier is nontrivial for a project that has been Lua/TypeScript-centric.

The WARN callout about `/data` deletion on plugin unload is valuable.
However, the report does not assess the impact of this limitation on the recommended architecture.
If the lace.zellij plugin caches Docker discovery results in `/data`, those results are lost on every unload.
Is there a workaround (filesystem-based caching outside `/data`, pipe-based state)?

**Blocking.** The report recommends Option C but does not address a key question: what terminal emulator runs on the host?
Zellij is a multiplexer, not a terminal emulator.
The current stack uses wezterm as both terminal emulator and multiplexer.
If zellij replaces the multiplexer role, the host still needs a terminal emulator.
Does the plan assume continuing to use wezterm as a "dumb" terminal (just the emulator, no mux), switching to a different terminal (kitty, alacritty, ghostty), or running inside the existing terminal?
This is a foundational architectural question that the report should address explicitly.

### Recommendations

**Non-blocking.** The phased migration plan is reasonable and follows good practice (install alongside, port incrementally, deprecate last).
Recommendation #1 (prototype copy mode workaround first) is the right call: it correctly identifies the gating risk.

The "Investigate Areas" section is useful but could be stronger.
The SSH-pane latency question is important: if each tab/pane opens a fresh SSH connection, there is a measurable connection establishment cost.
Is SSH connection multiplexing (ControlMaster/ControlPath) compatible with zellij's `command "ssh"` panes?

### Writing Conventions Compliance

**Non-blocking.** The document generally follows writing conventions well.
Sentence-per-line formatting is mostly followed.
Callout attribution syntax is correct (NOTE and WARN with `opus/zellij-migration`).
No emojis.
No em-dashes.

One minor violation: the ASCII-art diagrams in the architecture options use plain text trees rather than Mermaid.
Per writing conventions, Mermaid is preferred for diagrams.

## Verdict

**Revise.**

The report is strong on technical depth and honest risk assessment.
Two blocking issues need resolution before acceptance:

1. The recommended architecture (Option C) does not address the host terminal emulator question.
2. The architecture comparison lacks cost/effort estimates, making it difficult to use this report for an actual migration decision.

## Action Items

1. [blocking] Address the host terminal emulator question: what runs on the host if zellij replaces wezterm's multiplexer role? State the assumption explicitly and discuss implications.
2. [blocking] Add effort estimates (even rough T-shirt sizes) for the three architecture options, particularly the Rust/WASM plugin rewrite. Acknowledge the toolchain barrier for a project that has been Lua/TypeScript-centric.
3. [non-blocking] Clarify what specific wezterm rendering issues and limitations motivate this migration. "Has shown rendering issues" is vague.
4. [non-blocking] Assess the maintenance status of recommended community plugins (zellij-vertical-tabs, zellij-autolock, zellij-sessionizer). Note last commit dates or release activity.
5. [non-blocking] Address whether zellij session resurrection correctly handles SSH-command panes (critical for Option C).
6. [non-blocking] Discuss `/data` deletion impact on the recommended plugin architecture and note workarounds.
7. [non-blocking] Investigate SSH connection multiplexing (ControlMaster) compatibility with zellij `command "ssh"` panes, or note this in the investigation areas.
8. [non-blocking] Convert ASCII-art architecture diagrams to Mermaid per writing conventions.
