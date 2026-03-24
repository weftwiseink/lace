---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T10:45:00-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: done
tags: [sprack, project_status, executive_summary]
---

# Sprack Project Status

> BLUF: Sprack has a working prototype (4 crates, 76 tests, verified TUI rendering) but user testing revealed that the core use case (monitoring Claude Code in containers from a host-side tmux) requires architectural evolution.
> Seven RFPs define the forward path, with process host awareness as the highest priority.

## Current State

### What Works

- sprack-poll queries live tmux state, writes to SQLite with hash-based diffing
- sprack TUI renders a responsive tree, navigates with keyboard/mouse, auto-starts the poller
- sprack-claude parses JSONL session files and extracts Claude Code status (unit-tested, not yet validated against live Claude)
- The full pipeline works end-to-end in-container: `sprack` launches, tree populates, navigation works

### What Doesn't Work Yet

- **Cross-container summarization**: sprack-claude assumes same PID namespace as Claude Code. Real deployment has tmux on host, Claude in containers. Panes show `ssh` not `claude`.
- **Detail pane design**: separate right panel is wrong for the use case. Summaries need to be inline with tree nodes.
- **Layout organization**: tmux's b-tree pane structure doesn't match user mental model. Needs spatial ordering.
- **Timestamps**: non-standard format (epoch offset rather than ISO 8601)
- **tui-tree-widget constraint**: v0.22 pins ratatui to 0.28

### Codebase Metrics

| Metric | Value |
|--------|-------|
| Crates | 4 (sprack-db, sprack-poll, sprack, sprack-claude) |
| Tests | 76 (14 + 19 + 23 + 20) |
| Clippy warnings | 0 |
| Commits this session | 12 |
| Reports written | 7 |
| RFPs filed | 7 |

## RFP Inventory

### Sprack-Specific

| # | RFP | Priority | Status |
|---|-----|----------|--------|
| 1 | [Process host awareness](../proposals/2026-03-24-sprack-process-host-awareness.md) | High | request_for_proposal |
| 2 | [Inline summaries](../proposals/2026-03-24-sprack-inline-summaries.md) | High | request_for_proposal |
| 3 | [Layout organization](../proposals/2026-03-24-sprack-layout-organization.md) | Medium | request_for_proposal |
| 4 | [tmux IPC migration](../proposals/2026-03-24-sprack-tmux-ipc-migration.md) | Medium | request_for_proposal |
| 5 | [Claude Code SQLite mirror](../proposals/2026-03-24-claude-code-sqlite-mirror.md) | Medium | request_for_proposal |

### Lace Infrastructure

| # | RFP | Priority | Status |
|---|-----|----------|--------|
| 6 | [Git credential support](../proposals/2026-03-23-lace-git-credential-support.md) | Medium | request_for_proposal |
| 7 | [Screenshot sharing](../proposals/2026-03-24-lace-screenshot-sharing.md) | Low | request_for_proposal |

## Architecture Assessment

The three-process SQLite-mediated architecture is sound.
The `PRAGMA data_version` polling mechanism works efficiently.
WAL mode handles concurrent access without contention.

The critical gap is the container boundary: the design assumed all components share a PID namespace, but the real deployment splits across host (tmux, sprack-poll, sprack TUI) and containers (Claude Code).
The lace metadata in the DB (`@lace_port`, `@lace_workspace`) and the `~/.claude` bind mount provide the raw materials to bridge this gap without /proc walking.

This gap is addressable without rearchitecting: sprack-claude needs a second resolution path that uses lace metadata instead of /proc.
The existing /proc path remains valid for same-namespace deployments.

## Recommended Sequencing

1. **Process host awareness** (unblocks the primary value proposition)
2. **Inline summaries** (fixes the display model)
3. **Layout organization** (improves readability)
4. **Claude Code SQLite mirror** (enables analytics and richer status)
5. **tmux IPC migration** (robustness improvement, not blocking)
6. **Lace git credentials** (developer experience, orthogonal)
7. **Screenshot sharing** (convenience, low priority)
