---
review_of: cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T18:00:00-05:00
task_list: lace/wezterm-sidecar
type: review
state: archived
status: done
tags: [fresh_agent, architecture, communication_protocol, feasibility, widget_system, edge_cases]
---

# Review: WezTerm Sidecar Tree-Style Workspace and Activity Manager

## Summary Assessment

This proposal describes a hybrid Lua plugin + standalone TUI process that provides a persistent, tree-structured workspace manager for WezTerm, inspired by browser sidebar extensions like Sideberry and TreeStyle Tab.
The proposal is thorough in its analysis of WezTerm's API constraints and makes a well-reasoned case for the hybrid architecture as the only viable path to a rich interactive sidebar.
However, several critical feasibility gaps threaten the design: the Lua-to-TUI communication channel relies on Unix socket access from WezTerm's Lua runtime without evidence that this is possible, the `top_level = true` split for full-height sidecar panes is asserted without API confirmation, and the sidecar-per-tab versus sidecar-per-window tradeoff is insufficiently explored.
The proposal would also benefit from a concrete prototype spike (Phase 0) to validate the most uncertain technical assumptions before committing to a multi-phase build.
Verdict: **Revise**.

## Section-by-Section Findings

### BLUF

The BLUF is comprehensive and well-structured.
It correctly identifies the hybrid architecture as the "critical design decision" and names both components.
One concern: the BLUF says "a language like Rust or Go" which is hedging language that weakens the specificity.
Decision 4 recommends Rust with ratatui; the BLUF should match.

**Non-blocking.** Tighten the BLUF to name Rust/ratatui as the recommended stack rather than hedging.

### Objective

Clear and well-scoped.
The four capabilities (surveying, inspection, navigation, monitoring) are distinct and well-defined.
No issues.

### Background: The Problem Space

Good framing of the core problem: fragmented mental model across workspaces.
The Sideberry/TST analogy is apt and the mapping of browser patterns to terminal multiplexer patterns is convincing.

**Non-blocking.** The problem statement would be stronger with a concrete example from the lace project's own usage pattern (e.g., "a developer working in 3 worktrees with Claude Code sessions, nvim, and builds in each").

### Background: WezTerm API Constraints

This is the most critical section of the proposal and is mostly well-researched.
Five constraints are identified.
However, several claims need verification or deeper analysis.

**Constraint 1 (no custom rendering surface)**: Correct.
WezTerm panes are terminal emulators; there is no canvas API.

**Constraint 2 (no custom overlay types)**: Correct.
The overlay system is Rust-internal.

**Constraint 3 (process introspection is local-only)**: Correct and well-identified.
This is the main limitation for the devcontainer/SSH domain use case that this project relies on heavily.

**Constraint 4 (no pane lifecycle events)**: This claim needs qualification.
WezTerm does have `mux-is-process-stateful` which fires when a pane's process exits, and `window-config-reloaded` fires on config changes.
More importantly, the `update-status` event fires on focus changes, but the proposal does not clarify how often this fires in practice or whether it fires when a pane in a different workspace changes state.
If `update-status` only fires for the active window/tab, the sidecar will miss state changes in background workspaces entirely.

**Blocking.** Clarify the exact firing conditions of `update-status` and whether it can detect state changes in non-focused workspaces/tabs.
If it cannot, the "live state synchronization" in Phase 3 needs an alternative mechanism (e.g., a timer-based poll from the TUI process using `wezterm cli list --format json`).

**Constraint 5 (single-threaded Lua)**: Correct.
This is why the heavy rendering is offloaded to the TUI.

### Background: Prior Art

Good coverage.
The Zellij WASM plugin comparison is particularly relevant.
The resurrect.wezterm and smart_workspace_switcher.wezterm references are useful for establishing that the WezTerm plugin ecosystem exists and has precedent for this kind of functionality.

**Non-blocking.** Consider mentioning `wezterm.plugin` API limitations: plugins loaded via `wezterm.plugin.require` run in the same Lua context as the config and cannot spawn background threads or long-running coroutines.
This reinforces the need for the TUI sidecar but is currently only implicit.

### Proposed Solution: Architecture

The architecture diagram is clear and the component responsibilities are well-delineated.
However, there are several unaddressed concerns.

**Lua plugin state serialization**: The plugin is described as writing "a JSON snapshot to a Unix socket or watched file."
WezTerm's Lua environment provides `wezterm.json_encode()` for JSON serialization, but does it provide socket APIs?
The standard Lua runtime does not include socket libraries.
WezTerm's Lua environment exposes `wezterm.run_child_process()` (synchronous, blocks GUI) and `wezterm.background_child_process()` (async, fire-and-forget, no I/O back to Lua).
Neither of these is a socket API.

The proposal mentions this gap in Open Question 1 ("Should the Lua plugin or the TUI process own the socket?") and suggests `wezterm.run_child_process` invoking `socat`.
But `run_child_process` is synchronous and blocks the GUI thread (Constraint 5).
Calling `socat` or any external process to write to a socket on every state update would introduce noticeable GUI freezes, especially with the 2/second debounce target.

**Blocking.** The Lua-to-TUI communication channel is the central technical risk.
The proposal must demonstrate a feasible mechanism.
Consider these alternatives:
- (a) The TUI process polls `wezterm cli list --format json` itself, eliminating the need for the Lua plugin to push state.
  The Lua plugin's role reduces to key bindings, InputSelector, and status bar.
- (b) The Lua plugin writes state to a temp file via `io.open()` / `file:write()` (Lua standard library, no external process needed).
  The TUI watches the file with inotify.
  This avoids sockets entirely.
- (c) The Lua plugin uses `pane:inject_output()` on the sidecar pane to push JSON state as a special escape sequence that the TUI parses.
  The proposal already notes `inject_output` only works for local panes, but the sidecar pane *is* local.

Option (b) is likely the most practical.
Option (c) is elegant but couples the TUI to WezTerm-specific escape handling.
Option (a) is simplest but loses access to `LocalProcessInfo` and user vars.

**Sidecar pane positioning**: The proposal says "`top_level = true` split ensures the sidecar spans the full window height regardless of tab layout."
The `pane:split()` API does not document a `top_level` parameter.
WezTerm splits panes within a tab, not across the window.
If the user creates horizontal splits in their working area, the sidecar pane would be within the same tab layout, not a dedicated column.

**Blocking.** Verify that `pane:split()` supports a top-level split that spans the full window height.
If it does not, the sidecar pane will be constrained to a portion of the tab layout.
This is a fundamental UX requirement: the tree must be full-height to be useful.
An alternative is to use a dedicated tab with a fixed-width pane, but that conflicts with the "visible alongside work content" goal.
Another option is to investigate whether `wezterm cli split-pane --top-level` (CLI flag) exposes a capability not available in Lua.

### Communication Protocol

The protocol diagram is clear.
The three-channel design (state push, command push via OSC 1337, alternative `wezterm cli`) is reasonable in concept.

**OSC 1337 for TUI-to-Lua commands**: This is the strongest part of the protocol.
User variables via OSC 1337 are well-documented and the `user-var-changed` event is reliable.
The TUI printing `\x1b]1337;SetUserVar=SIDECAR_CMD=<base64-encoded-value>\x07` into its own pane is a clean IPC mechanism.

**State push frequency and freshness**: The proposal says state is pushed via `update-status`, but as noted above, this event's firing frequency for background workspaces is unclear.
If the TUI is displaying stale data for non-focused workspaces, users will lose trust in the tool.

**Non-blocking.** Define a staleness indicator: if the TUI has not received a state update for N seconds, it should display a "stale" indicator and optionally trigger a manual refresh via `wezterm cli list`.

**Missing: protocol versioning**: If the Lua plugin and TUI binary can be updated independently (the plugin via `wezterm.plugin.require` auto-update, the TUI via manual install), their protocol versions may drift.

**Non-blocking.** Add a `protocol_version` field to the JSON state payload so the TUI can detect incompatible updates and display a clear error.

### Tree Data Model

The JSON schema is clear and well-structured.
The `collapsed` field on workspaces with `summary` aggregates is a good optimization.

**Missing: pane split direction**: The data model shows `children = {}` on panes but does not indicate split direction (horizontal/vertical) or relative size.
If the sidecar ever needs to display or reconstruct the spatial layout (not just the tree hierarchy), this data is needed.

**Non-blocking.** Consider adding `split_direction` and `split_size` to pane nodes, or document that the tree is purely hierarchical with no spatial layout information.

**Missing: workspace ordering**: WezTerm does not guarantee workspace ordering.
The data model does not specify how workspaces are ordered in the tree (alphabetical, creation order, MRU).

**Non-blocking.** Specify the default workspace ordering strategy and whether it is configurable.

### Rendering: The Tree View

The ASCII mockup is clear and effectively communicates the visual design.
The node types, indicators, and visual states are well-defined and map cleanly from the Sideberry/TST patterns.

**Em-dash usage**: The writing conventions prefer colons over em-dashes.
Several entries in the indicator lists use ` -- ` (e.g., line 37 constraint 1 description uses it).

**Non-blocking.** Replace em-dashes with colons per writing conventions throughout.

### Navigation and Interaction

The two-tier binding system (always-available WezTerm keys + sidecar-focused key table) is well-designed.
The separation is clean: global bindings use WezTerm's native key system, sidecar bindings are handled by the TUI process.

**Key table activation**: The proposal says bindings are in a "key table activated when sidecar pane is focused."
WezTerm key tables are activated explicitly via `ActivateKeyTable` and are session-modal, not pane-focused.
The sidecar TUI process would handle its own key input natively (it is a terminal application reading stdin); there is no need for a WezTerm key table.
The key table concept is only needed if WezTerm intercepts keys before they reach the TUI pane, which it does not for normal terminal input.

**Non-blocking.** Clarify that sidecar-focused bindings are handled by the TUI process itself (reading terminal input), not via a WezTerm key table.
WezTerm key tables are a separate concept for modal keybinding groups in the WezTerm layer.
If the intent is to intercept keys at the WezTerm level (e.g., to prevent `Enter` from being sent to the TUI's shell), explain why.

**Missing: focus management**: When the user presses `Enter` to navigate to a pane, the sidecar TUI sends a focus command, and WezTerm focuses the target pane.
But the sidecar pane just lost focus.
How does the user return to the sidecar?
`Leader + t` toggles it, but the proposal says toggle means show/hide (spawn/close), not focus/unfocus.
The `q` binding says "return focus to previous pane," but how does the TUI know which pane was previously focused?

**Non-blocking.** Define the focus lifecycle more precisely: what happens to the sidecar pane when the user navigates away from it (does it stay visible? does it need to track "previous pane" state?), and how the user returns to it.

### Summary Widgets

The widget system design is conceptually clean: Lua-side matching and summary generation, TUI-side rendering of pre-computed strings.
This is the right separation of concerns.

**Widget evaluation performance**: Each widget's `match` and `summary` functions run in the Lua event handler (GUI thread).
If there are 20 panes and 5 widget types, that is 100 match evaluations per state update.
The `summary` functions call `pane:get_lines_as_text()`, which reads the viewport buffer.
This could be expensive.

**Non-blocking.** Add a note about widget evaluation budgeting: widgets should have a maximum evaluation time, and expensive operations (like reading pane text) should be cached or rate-limited per pane.

**Widget matching fragility**: The `npm_test` widget example matches on `table.concat(pane_info.process.argv, " "):match("npm test")`.
This depends on `process.argv`, which is only available via `LocalProcessInfo` (local panes only).
For the SSH domain panes that this project predominantly uses, this widget would never match.

**Blocking.** The widget examples rely on `LocalProcessInfo` which is unavailable for SSH/mux panes (Constraint 3 in the proposal itself).
The widget system must have a clear story for mux panes.
Options: (a) widgets that work with mux panes should match on `pane:get_title()` and `pane:get_user_vars()` only; (b) document that process-based widgets only work for local panes; (c) propose a mechanism for the container-side process to publish widget data via user vars.

### Status Bar Integration

Clean and useful.
The summary counters are well-chosen.
The mention of "Clicking (when supported)" is honest about current limitations.

**Non-blocking.** The sentence "Clicking (when supported) or pressing `Leader + t` opens the sidecar for detail" implies future click support.
Remove the click reference or move it to a future-work note, since WezTerm status bar clicks are not currently supported.

### Design Decisions

The six decisions are well-structured with clear rationale.
A few specific concerns.

**Decision 2 (sidecar pane not a separate window)**: The proposal says the pane mirrors "the Sideberry/TST pattern of a sidebar panel within the main window."
But Sideberry's panel is a browser-native sidebar that exists outside the tab layout.
A WezTerm pane is inside the tab layout: it consumes space from the tab's split tree, and it exists per-tab (not per-window).
If the user switches tabs, the sidecar pane disappears because it belongs to one tab's layout.

**Blocking.** The proposal does not address whether the sidecar pane must be recreated in each tab, or whether it exists only in a dedicated tab, or whether WezTerm has a mechanism for cross-tab persistent panes.
This is a fundamental architectural question.
If the sidecar is per-tab, the user must re-create it in every tab.
If the sidecar is in a dedicated "management" tab, the user loses the "visible alongside work content" property.
Investigate whether there is a way to keep the sidecar visible across tab switches.

**Decision 3 (Unix socket)**: As discussed above, the feasibility of the Lua plugin writing to a Unix socket is unverified.

**Decision 4 (Rust + ratatui)**: Reasonable choice.
The alignment with WezTerm's own Rust implementation is a minor benefit (shared ecosystem knowledge) but not a strong argument.
The real argument is performance and binary size.

**Non-blocking.** The proposal does not address how the TUI binary is distributed and installed.
WezTerm plugins (`wezterm.plugin.require`) load Lua from Git repos; they cannot bundle native binaries.
The TUI binary must be installed separately (e.g., via `cargo install`, a package manager, or a release binary download).
This installation story should be specified.

### Stories

The three stories are well-constructed and demonstrate distinct use cases.
They effectively illustrate the value proposition.

**Non-blocking.** The stories assume all workspaces are visible in the sidecar regardless of which workspace is active.
This depends on `wezterm.mux.all_windows()` returning data for non-active workspaces, which needs verification (see the `update-status` firing concern above).

### Edge Cases / Challenging Scenarios

Good coverage of several important edge cases.
A few gaps.

**Multiplexer pane limitations**: The degradation strategy (title, user vars, "unknown") is reasonable.
However, the proposal does not address what percentage of use cases in this project involve mux panes.
Given that the lace project is devcontainer-based with an SSH domain, *most* panes will be mux panes.
This means the "degraded" mode is actually the primary mode.

**Blocking.** Reframe the mux pane limitation section: for the lace project, mux panes are not an edge case but the dominant case.
The proposal should acknowledge this and design the primary UX around mux-pane-level information (title, user vars), treating `LocalProcessInfo` enrichment as a bonus for local panes rather than the default.

**Missing edge case: WezTerm plugin API stability**: WezTerm's plugin API is relatively new and not yet stable.
Breaking changes in the Lua API could affect the plugin.

**Non-blocking.** Note the dependency on WezTerm's Lua API stability and consider pinning to a minimum WezTerm version.

**Missing edge case: sidecar pane steals focus on workspace switch**: When switching workspaces, if the sidecar pane was the last-focused pane in that workspace, it will regain focus on return.
This could be annoying if the user expects to return to their work pane.

**Non-blocking.** Consider tracking the "last non-sidecar focused pane" per workspace and restoring focus to it on workspace switch.

**Missing edge case: terminal resize**: When the WezTerm window is resized, the sidecar pane's width changes proportionally.
This could render the tree unreadable if the window is narrow.

**Non-blocking.** Specify a minimum sidecar width and behavior when the window is too narrow (auto-hide the sidecar below a threshold).

### Implementation Phases

The five phases are logically sequenced.
Phase 1 builds the Lua foundation, Phase 2 the TUI, Phase 3 connects them, Phase 4 adds widgets, Phase 5 polishes.

**Missing Phase 0: feasibility spike**: The most critical technical risks (Lua socket/file I/O for state transfer, top-level pane split, cross-tab sidecar persistence, `update-status` firing behavior for background workspaces) are unvalidated.
A spike phase that builds a minimal prototype to test these assumptions would significantly de-risk the project.

**Blocking.** Add a Phase 0 that validates:
(a) the Lua-to-TUI communication mechanism (can the Lua plugin write a file or connect to a socket without blocking the GUI?),
(b) sidecar pane positioning (can a pane span the full window height across tab splits?),
(c) cross-tab sidecar visibility (does the sidecar survive tab switches?),
(d) `update-status` or alternative polling for background workspace state.
This spike should produce a "go/no-go" decision with documented findings before Phase 1 proceeds.

**Phase 1 verification**: "The fuzzy finder correctly lists all panes across workspaces" is a good criterion.
However, "the sidecar pane spawns and toggles" is vague.
What does "toggle" mean at this stage (before the TUI exists)?

**Non-blocking.** Clarify Phase 1 sidecar toggle behavior: spawning a placeholder pane and closing it on re-toggle.

**Phase 2 and Phase 3 coupling**: Phase 2 builds the TUI reading "state JSON from stdin or a Unix socket," but the communication mechanism is not validated until Phase 3.
If the socket approach proves infeasible in Phase 3, Phase 2's socket code is wasted.

**Non-blocking.** Consider having Phase 2 read exclusively from stdin (piped from a test JSON file) to decouple it from the communication mechanism.
Phase 3 then wires up the actual transport.

### Open Questions

The four open questions are all genuine and important.
They also reveal that the proposal has significant unresolved technical uncertainty.

**Question 1 (socket management)**: As discussed, this is a blocking concern, not just an open question.

**Question 4 (devcontainer integration)**: This is the most consequential open question.
If the TUI runs on the host, it cannot access container-local process info.
If it runs inside the container, it cannot access WezTerm's Lua API or the mux state directly.
The proposal does not explore this tradeoff.

**Non-blocking.** Expand Question 4 into a design decision or at minimum a deeper analysis of the tradeoffs.
A split approach (Lua plugin on host, TUI on host, container-side agent publishing process info via user vars) seems like the likely answer but should be stated explicitly.

### Writing Conventions Compliance

Several em-dashes appear throughout (lines 28, 31, 37, 43, etc.) where colons or spaced hyphens would be preferred.
The proposal uses ASCII art diagrams where Mermaid could be used (the architecture diagram and communication protocol diagram are good candidates).

**Non-blocking.** Replace em-dashes with colons and convert ASCII diagrams to Mermaid where feasible (particularly the communication protocol sequence).

### Frontmatter

The frontmatter is well-formed.
`first_authored.by` uses "claude-opus-4-5" without the `@` prefix and without the full model ID suffix.
Per the frontmatter spec, `by` should be `"@claude-opus-4-5-20251101"`.

**Non-blocking.** Fix `first_authored.by` to use the full model name with `@` prefix.

## Verdict

**Revise.**

The proposal presents a compelling vision and demonstrates strong research into WezTerm's capabilities and constraints.
The hybrid architecture is well-justified as the only viable approach for a rich interactive sidebar.
However, five blocking issues must be addressed before the proposal can be accepted:

1. The Lua-to-TUI communication mechanism (the central technical risk) lacks a verified feasible implementation path.
2. The sidecar pane's ability to span full window height and persist across tab switches is asserted without API confirmation.
3. The `update-status` event firing behavior for background workspaces is unverified, threatening the "live" aspect of the tree.
4. The widget system examples contradict the proposal's own Constraint 3 (mux pane limitations).
5. The mux pane limitation is treated as an edge case when it is the dominant case for this project.

These issues are addressable.
A feasibility spike (proposed Phase 0) would resolve items 1-3.
Items 4-5 require reframing sections of the proposal.

## Action Items

1. [blocking] Add a Phase 0 feasibility spike that validates: (a) Lua-to-TUI communication (file I/O via `io.open` or socket via external tool), (b) full-height sidecar pane positioning via `pane:split()` or alternative, (c) sidecar persistence across tab switches, (d) `update-status` firing behavior for background workspaces.
2. [blocking] Resolve the Lua-to-TUI communication mechanism: replace the Unix socket assumption with a concrete, verified approach.
   The temp-file-with-inotify approach (Lua `io.open` + TUI file watch) is the most likely feasible option.
3. [blocking] Verify and document `pane:split()` capabilities for top-level splits.
   If full-height splits are not possible, propose an alternative UX (e.g., dedicated sidecar tab with auto-switching).
4. [blocking] Reframe the "Multiplexer Pane Limitations" section to acknowledge that mux panes are the primary use case for this project, and design the core UX around mux-pane-level information.
5. [blocking] Fix the widget examples to work with mux panes (matching on title/user vars rather than `LocalProcessInfo.argv`), or explicitly document which widgets require local panes.
6. [non-blocking] Add a TUI binary distribution/installation story (WezTerm plugins cannot bundle native binaries).
7. [non-blocking] Add protocol versioning to the JSON state payload.
8. [non-blocking] Clarify sidecar-focused key handling: the TUI process handles its own input natively, not via WezTerm key tables.
9. [non-blocking] Address the sidecar focus lifecycle: how focus is managed when navigating to/from the sidecar pane.
10. [non-blocking] Address cross-tab sidecar behavior explicitly in a design decision.
11. [non-blocking] Fix `first_authored.by` to `"@claude-opus-4-5-20251101"` per frontmatter spec.
12. [non-blocking] Replace em-dashes with colons throughout; consider converting ASCII diagrams to Mermaid.
13. [non-blocking] Expand Open Question 4 (devcontainer integration) into a deeper analysis or design decision.
