---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T10:30:00-07:00
task_list: terminal-management/sprack-tui
type: devlog
state: live
status: review_ready
tags: [sprack, implementation, handoff]
---

# Sprack Implementation Handoff Devlog

> BLUF: All four sprack crates are implemented with 76 tests, verified via TUI screenshot, and have a clear forward path defined through 7 RFPs.
> The most critical architectural discovery is that sprack-claude's /proc-based design assumes same-PID-namespace, but the real deployment has tmux on host and Claude Code in containers.
> Next iteration should prioritize process host awareness (cross-container summarization) and inline summary display.

## What Was Done

### Implementation (4 crates, 76 tests)

| Crate | Role | Tests | Key Files |
|-------|------|-------|-----------|
| sprack-db | SQLite library | 14 | schema.rs, types.rs, read.rs, write.rs, error.rs |
| sprack-poll | tmux poller daemon | 19 | main.rs, tmux.rs, diff.rs |
| sprack | TUI binary | 23 | app.rs, tree.rs, render.rs, input.rs, layout.rs, colors.rs, daemon.rs, tmux.rs |
| sprack-claude | Claude summarizer | 20 | main.rs, proc_walk.rs, session.rs, jsonl.rs, status.rs |

All pass `cargo test`, `cargo clippy`, `cargo fmt --check`.

### Post-Implementation

- Refactored: centralized theme module, flattened tree building, deduplicated timestamp utility
- READMEs: main project + 4 crate READMEs + repo root mention
- Daemon auto-start fix: PID file race and sibling binary resolution

## Key Deviations from Original Specs

1. **tmux delimiter**: `\x1f` to `||` (tmux 3.3a converts non-printable chars to underscores)
2. **ratatui version**: 0.29 to 0.28 (tui-tree-widget v0.22 compatibility)
3. **catppuccin version**: v3 to v2 (v3 doesn't exist on crates.io)
4. **Timestamp format**: makeshift epoch-offset, not proper ISO 8601

## Issues Discovered During User Testing

Three issues identified from the first real screenshot of sprack running against the user's tmux environment:

### 1. Process Host Awareness (critical)

The real deployment model is tmux on host, Claude Code in containers via lace-into SSH.
sprack-poll sees `ssh` as the current_command, not `claude`.
sprack-claude's /proc walking cannot cross PID namespaces.

The `~/.claude` directory is bind-mounted into containers, so session files ARE accessible from the host.
Lace metadata (`@lace_port`, `@lace_workspace`) in the DB can identify which panes connect to containers.
The resolution: use lace metadata to derive the container's project path, then resolve session files via the shared `~/.claude` mount.

> Report: `cdocs/reports/2026-03-24-sprack-process-host-awareness.md`
> RFP: `cdocs/proposals/2026-03-24-sprack-process-host-awareness.md`

### 2. Inline Summaries

The separate detail pane is wrong.
Summaries should be aligned inline with their tree nodes, not in a separate column.
This requires either multi-line tree items, extended inline suffixes, or a custom renderer.

> Report: `cdocs/reports/2026-03-24-sprack-inline-summary-design.md`
> RFP: `cdocs/proposals/2026-03-24-sprack-inline-summaries.md`

### 3. Layout Organization

The tree shows the tmux b-tree structure, which doesn't match how users think about pane layout.
Should organize by rows then columns (spatial ordering using `pane_top`/`pane_left` coordinates).
Should show exhaustive metadata like tmux choose-tree.

> Report: `cdocs/reports/2026-03-24-sprack-layout-organization.md`
> RFP: `cdocs/proposals/2026-03-24-sprack-layout-organization.md`

## Context for Next Session

### Quick Start

```bash
cd packages/sprack
cargo build --release
# In a tmux pane:
./target/release/sprack
```

### All RFPs Pending Elaboration

| RFP | Priority | Scope |
|-----|----------|-------|
| [Process host awareness](../proposals/2026-03-24-sprack-process-host-awareness.md) | High | Cross-container Claude summarization |
| [Inline summaries](../proposals/2026-03-24-sprack-inline-summaries.md) | High | Detail pane redesign |
| [Layout organization](../proposals/2026-03-24-sprack-layout-organization.md) | Medium | Spatial ordering, exhaustive metadata |
| [tmux IPC migration](../proposals/2026-03-24-sprack-tmux-ipc-migration.md) | Medium | tmux-interface-rs or control mode |
| [Claude Code SQLite mirror](../proposals/2026-03-24-claude-code-sqlite-mirror.md) | Medium | Full session data mirroring |
| [Lace git credential support](../proposals/2026-03-23-lace-git-credential-support.md) | Medium | Commit-only, no push |
| [Lace screenshot sharing](../proposals/2026-03-24-lace-screenshot-sharing.md) | Low | Host screenshot access in containers |

### Recommended Next Iteration

1. Elaborate the process host awareness RFP into a full proposal, then implement.
   This unblocks Claude status display for the primary use case.
2. Elaborate inline summaries, redesign the detail pane.
3. Add spatial ordering and expanded format string fields.

### Known Bugs / Technical Debt

- `/proc/<pid>/children` may need to be `/proc/<pid>/task/<tid>/children` on some kernels (found in container boundary analysis)
- `now_iso8601()` produces non-standard timestamps
- tui-tree-widget v0.22 pins ratatui to 0.28

## Related Documents

| Document | Type |
|----------|------|
| [Implementation executive summary](../reports/2026-03-23-sprack-implementation-executive-summary.md) | Report |
| [Container boundary analysis](../reports/2026-03-24-sprack-claude-container-boundary-analysis.md) | Report |
| [Git identity gaps](../reports/2026-03-23-devcontainer-git-identity-gaps.md) | Report |
| [Claude commit authorship](../reports/2026-03-23-claude-commit-authorship-practices.md) | Report |
| [Sprack design overview](../reports/2026-03-21-sprack-design-overview.md) | Report |
| [Rust style guide](../reports/2026-03-21-sprack-rust-style-guide.md) | Report |
