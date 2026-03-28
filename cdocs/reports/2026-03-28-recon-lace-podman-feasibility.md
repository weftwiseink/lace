---
first_authored:
  by: "@claude-opus-4-6-20250625"
  at: 2026-03-28T09:47:00-07:00
task_list: sprack/recon-evaluation
type: report
state: live
status: wip
tags: [architecture, sprack, tooling_evaluation]
---

# Recon as Interim Sprack Replacement: Feasibility Analysis

> BLUF: Recon is a lightweight, read-only tmux-based Claude session monitor that overlaps significantly with sprack-claude's monitoring role.
> It could serve as a temporary replacement for single-host local monitoring with minimal setup.
> Cross-container monitoring from a single dashboard is feasible but requires a host-side recon instance reading container-side Claude session files via bind mounts: recon itself has no multi-instance coordination or network awareness.
> The main adoption friction is path encoding: Claude's session files use encoded CWD paths, and container paths differ from host paths.

## Context / Background

Sprack (`packages/sprack`) is the lace project's tree-style tmux session browser with Claude Code integration via three cooperating Rust binaries and a SQLite state database.
It works, but it carries significant complexity: poll daemon, TUI, Claude integration daemon, container-aware session resolution, and a shared database contract.

[gavraz/recon](https://github.com/gavraz/recon) is a third-party Rust TUI that monitors Claude Code sessions running in tmux.
The question: could recon serve as a lighter-weight stand-in for sprack's Claude monitoring while sprack matures?

## Key Findings

### Recon Architecture

- **Pure observer**: no daemon, no database, no hooks. Each invocation polls tmux + Claude's own files and exits on `q`.
- **Data sources**: `~/.claude/sessions/{PID}.json` (PID-to-session mapping), `~/.claude/projects/<encoded-path>/<session-id>.jsonl` (conversation logs), `tmux list-panes -a` (pane discovery), `tmux capture-pane` (status detection from TUI status bar).
- **Single file written**: `~/.local/state/recon/parked.json` (park/unpark feature only).
- **2-second poll interval**, incremental JSONL parsing via file-size tracking.
- **Status detection**: scans pane content bottom-up for spinner characters (Working), "Esc to cancel" (Input), or falls back to Idle/New.
- **No configuration**: no config files, no env vars, no plugin system.

### `recon launch` Is Optional

`recon launch` is a convenience wrapper that creates a tmux session running `claude` in the current directory.
Discovery is tmux-native: recon scans all tmux panes via `tmux list-panes -a` and matches pane PIDs to `~/.claude/sessions/{PID}.json`.
Any claude instance running in any tmux pane is discovered regardless of how it was started.

The `launch` subcommand also supports `--name-only` (print session name without attaching) and `--no-attach`.
Other lifecycle commands: `recon resume` (interactive picker or `--id`), `recon park`/`unpark` (serialize/restore sessions), `recon next` (jump to next Input-state agent).

**Bottom line**: no launcher lock-in. Existing tmux workflows are fully compatible.

### Metadata Store

Recon has no persistent store of its own.
It reads Claude Code's files at runtime:

1. `~/.claude/sessions/{PID}.json`: maps running PID to session ID.
2. `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`: conversation logs with token counts, model info, timestamps.
3. tmux state via CLI commands.

The only recon-owned file is `~/.local/state/recon/parked.json`, written by `recon park` and read by `recon unpark`.
No SQLite, no socket, no IPC.

### Path Encoding Problem

Claude Code encodes the working directory into the project path: `/home/mjr/code/weft/lace` becomes `~/.claude/projects/-home-mjr-code-weft-lace/`.
Inside a container, the CWD is typically `/workspaces/lace` or similar, producing a different encoded path.

Recon resolves sessions by reading `~/.claude/sessions/{PID}.json` on the host where it runs.
For container Claude instances:
- The PID visible to tmux is the host-side PID (or the `podman exec` process PID).
- The `{PID}.json` file is written inside the container's `~/.claude/sessions/`, not the host's.
- The JSONL logs are under the container's `~/.claude/projects/<container-encoded-path>/`.

This is the same class of problem sprack-claude's four-tier resolver addresses (`resolver.rs`).

## Feasibility by Concern

### 1. Launcher requirement

**No concern.**
`recon launch` is optional.
Any Claude in tmux is auto-discovered.

### 2. Metadata store and container paths

**Medium concern.**
Recon reads `~/.claude/` from the filesystem where it runs.
For container monitoring, the container's `~/.claude/` must be visible to the host.

Options:
- **Bind-mount `~/.claude` from container to a host-visible path.**
  This is what lace already does for dotfiles and SSH keys.
  A devcontainer feature or mount config could expose it.
  However, recon hardcodes `dirs::home_dir()` for the `~/.claude` base path: it cannot be pointed at an alternate location without source modification.
- **Run recon inside each container.**
  Each container's recon sees its own Claude instances.
  But this gives per-container dashboards, not a unified view.
- **Symlink or union mount.**
  Merge multiple containers' `~/.claude/sessions/` into a host-visible directory.
  Fragile and prone to PID collisions across containers.

### 3. Cross-container unified dashboard

**High concern: not feasible without recon modifications.**

Recon's discovery is: enumerate tmux panes → match pane PID to `~/.claude/sessions/{PID}.json` → read JSONL.
This pipeline assumes a single `~/.claude/` directory tree on the host.

For cross-container monitoring, recon would need:
- Awareness of multiple `~/.claude/` roots (one per container).
- Container-to-host PID mapping (podman uses a PID namespace: container PID 1234 is host PID 56789).
- Path translation for JSONL discovery.

None of these exist in recon today.
The codebase has no plugin/extension system, no config for alternate paths, and PID resolution is hardcoded to direct `pgrep -P` calls.

## Comparison with Sprack

| Aspect | Recon | Sprack |
|--------|-------|--------|
| Architecture | Single binary, no daemon | 3 binaries + SQLite |
| Persistence | None (reads Claude files) | SQLite WAL database |
| Container support | None | Four-tier resolver, hook bridge |
| Status detection | Pane content scanning | Hook events + JSONL parsing |
| Multi-project | Flat table, git-grouped rooms | Tree view (session/window/pane) |
| Configuration | Zero | Minimal (SQLite path) |
| Extension model | None | SQLite integration contract |
| Cross-container | Not supported | Supported via resolver |
| Launch integration | Optional tmux wrapper | tmux hooks for real-time updates |

## Recommendations

### For immediate local-only monitoring (single host, no containers)

Recon is usable today with zero setup.
Install the binary, run `recon` in any terminal.
It provides token counts, model info, session status, and a clean TUI.
This covers the "quick glance at what my claudes are doing" use case.

### For container monitoring

Recon is not a drop-in replacement for sprack-claude's container awareness.
The path encoding and PID namespace problems are fundamental to recon's design, not configuration gaps.

Two paths forward:
1. **Fork/patch recon** to support configurable `~/.claude` roots and container PID mapping.
   This would be a non-trivial change to the discovery pipeline (`session_store.rs`, `tmux.rs`).
2. **Continue with sprack-claude** for container monitoring and use recon only for local/host sessions.

### For a "good enough" interim

Run recon on the host for host-local Claude sessions only.
For container sessions, accept the gap or use `recon json` inside each container via `podman exec` and aggregate the JSON output with a simple script.
This gives machine-readable status without a unified TUI, but avoids any recon modifications.

> NOTE(opus/sprack/recon-evaluation): The `recon json` command outputs a single JSON blob to stdout and exits.
> A wrapper script that runs `podman exec <container> recon json` across all lace containers and merges the results could provide a crude unified view.
> This avoids modifying recon but sacrifices the TUI experience.
