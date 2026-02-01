---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: "2026-02-01T18:30:00-05:00"
task_list: lace/wezterm-sidecar
type: report
subtype: executive_summary
state: live
status: done
tags: [wezterm, sidecar, executive-summary, plugin, workspace-management]
---

# WezTerm Sidecar: Executive Summary

## BLUF

The WezTerm Sidecar is a proposed hybrid Lua plugin + Rust TUI that provides a persistent, tree-structured workspace and process manager (inspired by Firefox's Sideberry) rendered in a dedicated WezTerm pane. The architecture is sound and the hybrid approach is the only viable path to a rich interactive sidebar given WezTerm's API constraints, but several foundational technical assumptions remain unvalidated: Lua file I/O availability, full-height pane splitting, and cross-tab sidecar persistence. A Phase 0 feasibility spike must resolve these before any implementation begins.

## Key Design Decisions

- **Hybrid architecture (Lua plugin + TUI sidecar process)**: WezTerm's Lua API cannot render custom interactive UI; the Lua plugin handles event-driven state collection and WezTerm integration while a Rust/ratatui TUI process handles rendering. This is the only approach that delivers a persistent tree view. ([Proposal: Decision 1](cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md#decision-1-hybrid-architecture-lua-plugin--tui-sidecar-process))
- **Temp file IPC (Lua to TUI) + OSC 1337 user vars (TUI to Lua)**: The Lua plugin writes JSON state to a temp file watched by inotify; the TUI sends commands back via terminal escape sequences. This avoids sockets (unavailable in WezTerm's Lua) and blocking `run_child_process` calls. ([Proposal: Decision 3](cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md#decision-3-state-push-via-temp-file-with-ioopen))
- **InputSelector for cross-workspace fuzzy search**: The global `Leader + f` finder delegates to WezTerm's native fuzzy overlay rather than reimplementing search in the TUI, providing consistent UX and full-pane rendering. ([Proposal: Decision 5](cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md#decision-5-fuzzy-finder-uses-native-inputselector))
- **Widget evaluation in Lua, not the TUI**: Summary widgets (Claude Code status, build results) run in the Lua layer where they have access to WezTerm pane APIs. The TUI receives pre-computed strings. This keeps the TUI simple and lets users add widgets in their config without recompiling. ([Proposal: Decision 6](cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md#decision-6-widget-system-is-lua-side-not-tui-side))

## Critical Risks and Mitigations

The R1 review identified five blocking issues. The revised proposal addresses all of them, primarily through the addition of a Phase 0 feasibility spike.

- **Lua-to-TUI communication was unverified**: The original proposal assumed Unix socket access from Lua. The revision replaced this with `io.open()` temp file writes + inotify, which avoids sockets entirely. However, `io.open()` availability in WezTerm's sandboxed Lua runtime is still unconfirmed. Phase 0 spike item 1 validates this. ([Review: Communication blocking finding](cdocs/reviews/2026-02-01-review-of-wezterm-sidecar-workspace-manager.md#proposed-solution-architecture), [Proposal: Phase 0](cdocs/proposals/2026-02-01-wezterm-sidecar-workspace-manager.md#phase-0-feasibility-spike))
- **Full-height sidecar pane positioning is unconfirmed**: `pane:split()` may not support `top_level` splits in Lua. The fallback is invoking `wezterm cli split-pane --top-level` from Lua or accepting per-tab splits. Phase 0 spike item 2. ([Review: Pane positioning blocking finding](cdocs/reviews/2026-02-01-review-of-wezterm-sidecar-workspace-manager.md#proposed-solution-architecture))
- **Cross-tab sidecar persistence is unknown**: WezTerm panes belong to tabs; switching tabs may hide the sidecar. Phase 0 spike item 3. ([Review: Cross-tab blocking finding](cdocs/reviews/2026-02-01-review-of-wezterm-sidecar-workspace-manager.md#design-decisions))
- **`update-status` may not fire for background workspaces**: If it only fires on focus changes, the sidecar will show stale data for non-active workspaces. Phase 0 spike item 4. ([Review: Event firing concern](cdocs/reviews/2026-02-01-review-of-wezterm-sidecar-workspace-manager.md#background-wezterm-api-constraints))
- **Mux panes are the primary case, not an edge case**: For the lace project (devcontainer/SSH domain), most panes lack `LocalProcessInfo`. The revised proposal reframed the core UX around title + user vars, with `LocalProcessInfo` as a local-pane bonus. Widget examples were updated to match on title/user vars. ([Review: Mux pane blocking finding](cdocs/reviews/2026-02-01-review-of-wezterm-sidecar-workspace-manager.md#edge-cases--challenging-scenarios))

## WezTerm Overlay System: What Matters

The [overlay deep-dive](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md) establishes what the sidecar can and cannot leverage from WezTerm's built-in UI.

**What overlays CAN do:**
- InputSelector provides high-quality fuzzy search with dynamically built choice lists, styled labels, and selection callbacks. It is the primary extension point for the entire WezTerm plugin ecosystem. ([Deep-dive: InputSelector](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#5-inputselector))
- PromptInputLine and Confirmation handle rename and destructive-action workflows. ([Deep-dive: PromptInputLine](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#6-promptinputline), [Confirmation](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#7-confirmation))
- Overlays can be chained: an InputSelector callback can trigger a PromptInputLine or Confirmation. ([Deep-dive: Composing overlays](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#14-composing-overlays-with-key-tables))

**What overlays CANNOT do:**
- No custom overlay types: all overlays are Rust-internal. Lua plugins cannot create new overlay kinds. ([Deep-dive: Architecture](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#1-overlay-architecture))
- Overlays are ephemeral and modal: they cannot provide a persistent, always-visible sidebar. This is the fundamental gap the TUI sidecar fills.
- Overlay key bindings are hardcoded; `augment-command-palette` has a last-handler-wins limitation. ([Deep-dive: Limitations](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#limitations-4))

**Implication for the sidecar**: The sidecar correctly uses InputSelector for its fuzzy finder (`Leader + f`) and PromptInputLine for rename operations, but delegates persistent tree rendering to the TUI process. This is the right split.

## Plugin Ecosystem Context

Three existing plugins occupy adjacent space: [resurrect.wezterm](https://github.com/MLFlexer/resurrect.wezterm) (session save/restore via InputSelector), [smart_workspace_switcher.wezterm](https://github.com/MLFlexer/smart_workspace_switcher.wezterm) (fuzzy workspace switching with zoxide), and [sessionizer.wezterm](https://github.com/mikkasendke/sessionizer.wezterm) (schema-based project launching). All three are InputSelector wrappers for point interactions. The sidecar would be categorically different: a persistent, always-visible workspace overview with live status, not a modal picker. It could integrate with resurrect for snapshot/restore and complement smart_workspace_switcher's navigation. ([Deep-dive: Community patterns](cdocs/reports/2026-02-01-wezterm-overlay-system-deep-dive.md#16-community-patterns-and-plugins))

## Next Steps

Phase 0 feasibility spike, in order of risk:

1. **Lua `io.open()` validation**: Write a JSON file from an `update-status` handler; measure GUI-thread latency. If sandboxed, test `wezterm.run_child_process` fallback.
2. **Full-height sidecar pane**: Test `pane:split()` with `top_level` parameter; test `wezterm cli split-pane --top-level` as fallback; document what actually works.
3. **Cross-tab sidecar persistence**: Verify whether a split pane survives tab switches. If not, evaluate auto-recreate and dedicated-tab alternatives.
4. **`update-status` firing scope**: Determine whether it fires for background workspace changes. If not, validate TUI-side polling via `wezterm cli list --format json` as supplement.
5. **OSC 1337 round-trip**: Verify TUI-to-Lua user variable IPC latency and reliability.

**Go/no-go gate**: Items 1-3 are hard blockers. If `io.open()` is unavailable AND `run_child_process` is too slow, the communication architecture needs redesign. If full-height persistent panes are impossible, the sidecar UX degrades significantly and the project may not be worth pursuing.
