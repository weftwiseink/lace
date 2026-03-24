---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T14:45:00-07:00
task_list: terminal-management/sprack-process-host-awareness
type: proposal
state: live
status: request_for_proposal
tags: [sprack, container, architecture, lace, cross_container, future_work]
---

# sprack Process Host Awareness

> BLUF(opus/sprack-process-host-awareness): sprack-claude's `/proc` walking fails for the primary use case: Claude Code running inside lace containers while tmux observes from the host.
> This RFP requests a design for "process host aware" summarization that detects container panes via lace metadata (`@lace_port`, `@lace_user`, `@lace_workspace`) and resolves session files through the shared `~/.claude` bind mount without crossing PID namespace boundaries.
> See the [process host awareness report](../reports/2026-03-24-sprack-process-host-awareness.md) for full problem analysis.

## Objective

Design and implement a resolution strategy for sprack-claude that works when:
1. tmux runs on the host.
2. Claude Code runs inside one or more lace devcontainers.
3. Panes show `current_command: ssh` instead of `current_command: claude`.
4. The `~/.claude` directory is bind-mounted between host and containers.
5. Lace metadata (`@lace_port`, `@lace_user`, `@lace_workspace`) is available per session/pane.

The solution must find Claude Code session files for container panes and produce the same structured summaries as the local `/proc`-based approach.

## Scope

### In Scope

- Detection of "container panes" vs "local panes" based on lace metadata and/or `current_command`.
- Session file discovery for container panes using the bind mount and lace workspace path.
- Handling of multiple containers (multiple `@lace_port` values) with independent Claude instances.
- Handling of multiple worktrees or subdirectories within a single container's workspace.
- Fallback behavior when bind mount is not present or metadata is incomplete.
- Integration with the existing `process_integrations` table and summary format.

### Out of Scope

- macOS support (deferred per existing sprack-claude proposal).
- Containers without the `~/.claude` bind mount (non-lace containers).
- Generic remote host summarization (SSH to arbitrary servers).
- Changes to the lace-into script or devcontainer configuration.

## Open Questions

1. **Subdirectory resolution:** `@lace_workspace` gives the workspace root (e.g., `/workspaces/lace`), but Claude Code's cwd is a subdirectory (e.g., `/workspaces/lace/main`).
   Should the resolution enumerate `~/.claude/projects/` for matching prefixes, or should sprack-poll capture additional metadata (e.g., `pane_current_path` as seen from the container)?

2. **Pane-level vs session-level metadata:** sprack-poll reads lace options at the session level.
   If a session mixes local and container panes (possible with `lace-into --pane`), session-level metadata is incorrect for local panes.
   Should sprack-poll also read pane-level `@lace_port`?

3. **SSH probe as supplement:** Should the design include an optional SSH probe (`ssh -p $port $user@localhost "readlink /proc/$(pgrep -n claude)/cwd"`) for cases where bind-mount-based discovery fails?
   What are the security and performance implications?

4. **Multiple Claude instances per container:** A container could run multiple Claude Code instances (e.g., in different worktrees).
   How should the resolution disambiguate between them when the only differentiator is the session file path?

5. **Generalization boundary:** How far should the design generalize beyond lace?
   Should there be a `RemoteResolver` trait or is lace-specific logic acceptable for now?
