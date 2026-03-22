---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T19:30:00-07:00
task_list: terminal-management/sprack-tui
type: devlog
state: live
status: wip
tags: [sprack, architecture, proposals, restructuring]
---

# sprack Proposal Restructuring

> BLUF: Restructuring the monolithic sprack proposal into a high-level roadmap plus per-component proposals, incorporating user feedback on responsive layout, simplified input, deep Claude Code integration, and daemon auto-start.

## Context

The existing sprack proposal (`2026-03-21-sprack-tmux-sidecar-tui.md`) was reviewed and accepted through two rounds.
The user wants to restructure it before implementation begins, based on several design refinements:

1. **Responsive layout**: sprack is not narrow-only. Claude activity summaries need space. The TUI should adapt from ~28 cols to full-width.
2. **Per-component proposals**: each binary (sprack-db, sprack-poll, sprack TUI, sprack-claude) gets its own detailed proposal.
3. **Simplified input**: just j/k, h/l, space, enter, q. Mouse support is important. Remove extras like /, ?, g/G, r for now.
4. **Deep Claude integration**: loud colored status indicators, read Claude session files, surface subagent count and context usage.
5. **Resolved open questions**:
   - Repo: same repo (lace), published as standalone package
   - Install: cargo, dotfile integration later
   - DB location: `~/.local/share/sprack/state.db`
   - Claude depth: deep, expect involved integrations
   - Launcher: auto-start daemon (sprack auto-starts sprack-poll and summarizers)

## Work Performed

### Proposal Restructuring

Transformed the existing monolithic proposal into a high-level roadmap:
- Trimmed implementation details (moved to component proposals)
- Resolved all five open questions inline
- Updated Decision 5 from "narrow sidebar" to "responsive layout"
- Simplified keybinding table
- Added mouse support requirement
- Changed status to `evolved` since it now points to component proposals

### Supplemental Proposal

Created `2026-03-21-sprack-design-refinements.md` covering:
- Responsive layout system (breakpoint-based adaptive rendering)
- Input model (simplified keyboard + mouse)
- Claude session file integration architecture
- Daemon auto-start behavior
- Links to component proposals

### Component Proposals

Four component proposals written by parallel subagents:

1. **sprack-db** (416 lines): schema, connection management, typed query helpers, shared data types. Covers all five tables, WAL setup, idempotent schema creation, and 11 test cases.
2. **sprack-poll** (487 lines): tmux CLI parsing with `\x1f`-delimited format strings, hash-based diff, SIGUSR1 via signal-hook, daemon lifecycle with PID files. Phased: Phase 1 basic polling, Phase 2 signals + hooks.
3. **sprack TUI** (735 lines): four-tier responsive layout (compact/standard/wide/full), `tui-tree-widget` integration with `click_at()` mouse support, daemon launcher logic, node visual styling. Phased: Phase 1 basic tree, Phase 2 navigation, Phase 3 responsive + mouse + daemon.
4. **sprack-claude** (630 lines): JSONL tail-reading algorithm, `/proc` PID walk for pane-to-session mapping, structured status extraction (activity state, subagent count, context usage %, last tool, model), colored rendering guidance.

### Research

Ratatui responsive layout report completed (7 sections):
- Confirmed ratatui has no built-in breakpoint system; width-mode enum is the standard pattern
- `tui-tree-widget` has built-in mouse support via `click_at()` and `rendered_at()`
- `Constraint::Min` + `Constraint::Fill` is the correct pattern for tree + detail panel
- Manual `truncate_with_ellipsis` needed (no built-in ellipsis API until v0.31+)

### Claude Session File Investigation

Inspected actual Claude Code session files on this machine to inform the sprack-claude proposal:
- Files are JSONL at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`
- `assistant` entries contain `message.model`, `message.usage` (input_tokens, output_tokens, cache info), `message.stop_reason`
- `progress` entries with `data.type == "agent_progress"` track subagent activity (1158 in this session)
- Session files can be large (2000+ entries), confirming the need for tail-reading

### Review Pipeline

All six documents went through the full pipeline: nit-fix -> triage -> review -> revise -> re-review.

**Round 1 verdicts:**
- sprack-db: Revise (1 blocking: WAL verification)
- sprack-poll: Revise (3 blocking: API mismatch, struct divergence, stale lace options)
- sprack TUI: Revise (3 blocking: raw DB connection, ProcessStatus mismatch, click-to-focus UX)
- sprack-claude: Revise (2 blocking: session discovery incomplete, path encoding text)
- Design refinements: Accept (6 non-blocking)
- Ratatui report: Accept (5 non-blocking)

**Cross-cutting fixes applied during revision:**
- sprack-db: added `open_db_readonly()`, expanded ProcessStatus to 6 variants (Thinking, ToolUse, Idle, Error, Waiting, Complete), renamed TreeState to DbSnapshot, added WAL verification, added WalActivationFailed error variant
- sprack-poll: aligned with sprack-db API, documented type mapping, always re-read lace options
- sprack TUI: uses `open_db_readonly()`, aligned ProcessStatus, click selects only (double-click focuses)
- sprack-claude: uses `sessions-index.json` for discovery, fixed path encoding text, expanded skip list
- Design refinements: fixed history-agnostic framing, "pixel" -> "cell", tier consistency, mouse UX alignment

**Round 2 verdicts: all accepted.**

## Issues Encountered and Solved

No blocking issues in the authoring phase.
The review pipeline surfaced 9 blocking issues across 4 proposals, all resolved in one revision cycle.
The most significant cross-cutting finding was ProcessStatus enum mismatch between sprack-db (4 variants) and the TUI (5 states), resolved by expanding sprack-db to 6 variants that all consumers reference.

## Document Inventory

| Document | Type | Status | Lines |
|----------|------|--------|-------|
| `proposals/2026-03-21-sprack-tmux-sidecar-tui.md` | Roadmap (evolved) | evolved | ~150 |
| `proposals/2026-03-21-sprack-design-refinements.md` | Supplemental | wip | 255 |
| `proposals/2026-03-21-sprack-db.md` | Component | wip | 416 |
| `proposals/2026-03-21-sprack-poll.md` | Component | wip | 487 |
| `proposals/2026-03-21-sprack-tui-component.md` | Component | wip | 735 |
| `proposals/2026-03-21-sprack-claude.md` | Component | wip | 630 |
| `reports/2026-03-21-ratatui-responsive-layout-patterns.md` | Report | wip | ~300 |
| `devlogs/2026-03-21-sprack-proposal-restructuring.md` | Devlog | wip | this |
