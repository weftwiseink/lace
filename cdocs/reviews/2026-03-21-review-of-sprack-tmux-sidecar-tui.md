---
review_of: cdocs/proposals/2026-03-21-sprack-tmux-sidecar-tui.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T16:30:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [fresh_agent, architecture, process_integration, tmux, rust, phasing]
---

# Review: sprack tmux Sidecar TUI for Session and Process Management

## Summary Assessment

This proposal designs a Rust + ratatui TUI that runs as a tmux sidecar pane, providing tree-style navigation of the tmux session hierarchy with container grouping via lace-into metadata.
The architecture is sound and represents a major simplification over the wezterm sidecar proposal it evolves: eliminating the Lua plugin layer, the JSON IPC file, and OSC 1337 communication in favor of direct tmux CLI queries.
The most significant concern is the process integration architecture (Phase 4): it is well-structured as a trait system but relies on fragile data sources (pane content scraping) that the proposal itself acknowledges, and the `resolve` method's performance characteristics are underspecified for the polling context.
The phasing plan is realistic for a new Rust project, with one caveat around Phase 1 scope that should be tightened.

Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF and Summary

The BLUF is thorough and well-constructed.
It correctly foregrounds the key architectural decisions (tmux CLI as sole IPC layer, process integration deferred to Phase 4) and positions sprack relative to both the wezterm sidecar and the tmux migration proposals.

**Non-blocking:** The BLUF is five sentences, which is at the upper end for a BLUF.
The fourth and fifth sentences (evolution from wezterm, tmux migration context) could be collapsed into one sentence, since both serve the same function of positioning sprack in the document lineage.

### Background

The background section is strong.
The "tmux CLI as the IPC Layer" table is particularly effective: it provides a concrete reference for every tmux command sprack depends on, which serves as both documentation and a scope boundary.

The NOTE about `tmux -C` control mode is well-placed.
It correctly identifies the future optimization path without letting it creep into the current design.

**Non-blocking:** The tmux migration context section references `status: implementation_ready` for the tmux return proposal, but that document's frontmatter shows `status: implementation_wip`.
This is a minor factual discrepancy.

### Architecture Overview

The architecture is the proposal's strongest section.
The "TUI process polls tmux CLI, renders tree, executes tmux commands" model is simple and correct.
The Mermaid diagram clearly shows the data flow.

The self-filtering approach (comparing `$TMUX_PANE` against the pane list) is the right design.
The fallback for running outside tmux (skip self-filtering) is appropriate.

**No issues.**

### Tree Data Model

The Rust struct definitions are well-factored.
The four-level hierarchy (`HostGroup` > `TmuxSession` > `TmuxWindow` > `TmuxPane`) correctly models the tmux object hierarchy with the host-grouping layer on top.

The `ProcessIntegration` struct embedded in `TmuxPane` is a clean design for Phase 4 extensibility: the tree model accommodates integrations from the start.

**Non-blocking:** The `HostGroup.name` field description says "Display name (project name from session, or 'local')."
When multiple sessions share the same `@lace_port`, the host group should derive its display name from something other than a single session name.
The proposal's container grouping section (line 234) says "the host group display name is the session name," but with multiple sessions under one host, which session name wins?
This should be clarified: perhaps the first session's name, or a separate `@lace_project` option, or a derivation from the container metadata.

### Tree Rendering

The ASCII mockup is clear and demonstrates the narrow-column constraint well.
The node type table covers all visual states.

**Non-blocking:** The "unseen-activity indicators" mentioned in the Summary section and the "Active pane highlighting" mentioned in Phase 3 steps are not shown in the tree rendering mockup.
Adding a `!` or similar indicator to the mockup for a pane with unseen output would make the design more concrete.

### Container Grouping

The grouping logic is straightforward: query `@lace_port` per session, group by value, fall back to "local."
This correctly depends on the session options that `lace-into` already sets.

**No issues.**

### Navigation and Keybindings

The keybinding table is well-designed with vim-standard conventions.
The `Enter` handler's tmux command construction (`switch-client \; select-window \; select-pane`) is correct for cross-session navigation.

The NOTE about `switch-client` requiring a tmux client is appropriate and the fallback to `attach-session` for out-of-tmux testing is reasonable.

**Non-blocking:** There is no keybinding for creating or destroying sessions/windows/panes from within sprack.
This is presumably intentional (sprack is read-and-navigate, not manage), but it is worth stating explicitly as a non-goal, since the wezterm sidecar proposal included pane management actions (`x` to close, `m` to move, `r` to rename).

### State Polling

The polling design is pragmatic.
The batched query optimization (single `tmux list-panes -a -F` call) is correctly identified as the target.
The NOTE acknowledging this as a Phase 2 optimization is appropriate.

The 1-second default interval is reasonable.
The proposal correctly notes that tmux CLI calls complete in <10ms, so per-poll overhead is negligible even with per-session `show-options` calls.

**Non-blocking:** The proposal does not address what happens if a `tmux` CLI call hangs or returns an error mid-poll.
While unlikely in normal operation, a robust implementation should have timeouts on subprocess calls.
A brief mention of error handling strategy (timeout + retry, or skip-and-log) would strengthen this section.

### Sidecar Pane Lifecycle

The toggle keybinding (`Alt-t`) shell script is well-constructed: it handles the create/focus/unfocus cases correctly.
The approach of detecting sprack by `pane_current_command` is sound.

**Non-blocking:** The toggle binding uses `grep ":sprack$"` to find the sprack pane.
If the user renames the binary or runs it via a wrapper (e.g., `cargo run`), this detection breaks.
A more robust approach would be to set a tmux user option on the sprack pane (e.g., `@sprack_pane true`) at startup and query that instead.
This is a minor implementation detail, not a design issue.

### Process Integration Architecture (Phase 4)

This is the section the reviewer was asked to focus on.
The trait-based design (`ProcessIntegrationProvider` with `matches`, `resolve`, `name`) is clean and extensible.
The registration pattern with `default_integrations()` returning a `Vec<Box<dyn ProcessIntegrationProvider>>` is idiomatic Rust.

**Concern 1 (non-blocking, but important):** The `resolve` method signature returns `Option<ProcessIntegration>`, but the proposal does not address the performance implications of calling `resolve` on every matched pane during every poll cycle.
For the Claude Code integration specifically, `resolve` may invoke `tmux capture-pane -t $pane_id -p`, which shells out to tmux.
If there are N Claude Code panes, each poll cycle adds N subprocess calls on top of the base polling cost.
The proposal should specify whether `resolve` is called on every poll or only on change detection (e.g., when `pane_current_command` changes), and whether it should be async or rate-limited.

**Concern 2 (non-blocking):** The WARN callout correctly identifies pane content scraping as fragile.
The proposal's fallback to "claude (running)" is appropriate.
However, the priority list of data sources for the Claude Code integration (status file, pane content scraping, pane title) omits a fourth option that the tmux ecosystem supports well: tmux user options on the pane itself.
If Claude Code (or a wrapper script) set a tmux user option like `@claude_status "thinking"` on its own pane, sprack could read it via `tmux show-options -t $pane -qv @claude_status` without any scraping.
This is more robust than all three listed options and aligns with how sprack already reads `@lace_port` from sessions.
It requires Claude Code cooperation, but so does option 1 (status file).

**Concern 3 (non-blocking):** The "Other Integrations" table lists nvim with "Buffer count, modified indicator" as its summary.
Extracting buffer count from nvim requires either parsing pane content or communicating with nvim's RPC socket.
The proposal does not address how nvim buffer info would actually be obtained.
If the answer is "pane title" (since nvim can be configured to set the terminal title), this should be stated.

### Important Design Decisions

All six design decisions are well-reasoned and clearly explained.
The trade-off articulation is strong throughout: each decision explains what was gained and what was given up.

Decision 3 (Polling Over Control Mode) is the most consequential and is correctly justified.
The argument that polling is simpler, sufficient for 1-second granularity, and upgradeable to control mode later is sound.

Decision 6 (Process Integration as Designed-Not-Implemented) is the right call.
Designing the architecture in the data model now while deferring implementation avoids both premature optimization and late-stage refactoring.

**No issues.**

### Edge Cases

The edge cases section is thorough.
The container port reuse scenario, tmux server not running, multiple clients, and narrow pane width are all realistic and well-addressed.

The TODO about stale session detection via `pane_dead` is a good call.

**Non-blocking:** The "Pane Current Command is Shell" edge case (line 519) is important and well-identified, but the proposed solution (use pane title as primary label, command as secondary) could conflict with the tree rendering section, which shows `pane_current_command` as the primary display value in the mockup (e.g., `nvim [*]`).
The tree rendering section should be reconciled with this edge case: what does a pane display when `pane_current_command` is `nu` and `pane_title` is `shell`?

### Test Plan

The test plan covers all four phases with concrete, checkable criteria.
The Phase 2 items correctly test bidirectional interaction (sprack reads tmux state and writes tmux commands).

**Non-blocking:** The test plan has no items for error conditions: what does sprack do when tmux returns an error?
When a `switch-client` command fails because the session was destroyed between render and user action?
Adding 1-2 error-path test items would improve coverage.

### Implementation Phases

The four-phase plan is well-scoped and realistic for a new Rust project.

**Phase 1** is appropriately minimal: scaffold, parse, render, basic navigation.
The "No tmux navigation commands yet" constraint is correct.

**Phase 2** adds the bidirectional interaction.
This is the critical phase: it is where sprack becomes useful rather than just a viewer.

**Phase 3** adds the lace-specific features (container grouping, search, toggle).
Separating this from Phase 2 is a good decision: it keeps the tmux-generic functionality testable independently of lace-specific metadata.

**Phase 4** is appropriately scoped as "architecture + stubs."
The proposal correctly prioritizes the trait design over specific integration quality.

**Non-blocking:** Phase 1 lists `serde` and `serde_json` as dependencies (line 575), but the proposal describes no JSON parsing.
tmux CLI output is tab-delimited text parsed from format strings, not JSON.
If serde is intended for a future config file (Phase 4 mentions `config.toml`), it should not be listed in Phase 1 dependencies.

### Open Questions

The five open questions are well-chosen and honest.
Question 5 (tmux hooks vs polling) is particularly valuable: it identifies a potential optimization path that could eliminate polling entirely for structural changes (session/window/pane creation and destruction).

**Non-blocking:** Question 1 (repository location) should probably be resolved before Phase 1 begins, since `cargo init` requires a target directory.
Consider promoting this to a decision with a recommended default (monorepo, with justification), leaving standalone as the alternative.

## Verdict

**Accept.**

This is a well-designed proposal that makes a strong architectural decision (standalone binary + tmux CLI, no plugin layer) and justifies it thoroughly.
The phasing is realistic, the edge cases are well-considered, and the process integration architecture is extensible without being over-engineered.
All findings are non-blocking.

## Action Items

1. [non-blocking] Clarify how `HostGroup.name` is derived when multiple sessions share the same `@lace_port`. Which session's name is used, or is there a separate mechanism?
2. [non-blocking] Address `resolve` performance in the polling context: should process integrations be called every poll, rate-limited, or triggered only on change?
3. [non-blocking] Add tmux pane-level user options (`@claude_status`, etc.) as a fourth data source option for process integrations. This aligns with the existing `@lace_port` pattern and is more robust than pane content scraping.
4. [non-blocking] Reconcile the tree rendering mockup with the "Pane Current Command is Shell" edge case. Clarify what the primary display label is when `pane_current_command` is the shell name.
5. [non-blocking] Remove `serde`/`serde_json` from Phase 1 dependencies, or explain what JSON they parse.
6. [non-blocking] Add 1-2 error-path test items (e.g., tmux command failure, race between render and navigation).
7. [non-blocking] Explicitly state that pane management (close, move, rename) is a non-goal for sprack, or add it to the open questions if it might be Phase 5 work.
8. [non-blocking] Consider promoting Open Question 1 (repository location) to a decision with a default recommendation before Phase 1.
9. [non-blocking] Fix the tmux return proposal status reference: document says `implementation_ready`, frontmatter says `implementation_wip`.
