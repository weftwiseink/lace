---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-25T16:30:00-07:00
task_list: sprack/lace-decoupling
type: proposal
state: live
status: evolved
tags: [architecture, sprack, future_work]
---

# RFP: Decouple Sprack from Lace-Specific Details

> BLUF: sprack-claude and sprack-poll have deep, hardcoded coupling to lace's tmux metadata scheme, bind mount paths, and Claude Code internal file formats.
> This RFP explores approaches for a generic "cross-container integration bridge" that replaces lace-specific assumptions with pluggable discovery.

## Problem

Sprack's container integration is tightly coupled to lace internals at four distinct layers:

1. **tmux session options** (`@lace_port`, `@lace_user`, `@lace_workspace`): sprack-poll reads these per-session options to identify container sessions.
   `find_candidate_panes()` uses `lace_port.is_some()` as the signal that a pane belongs to a container.
   This makes sprack unusable with any container orchestrator that does not set these specific tmux options.

2. **`~/.claude` bind mount path**: `LaceContainerResolver` assumes Claude Code's home directory is bind-mounted from the container into the host at a known path.
   It enumerates `claude_home/projects/` to find session files.
   This couples sprack to lace's specific mount configuration.

3. **Claude Code project directory encoding**: `encode_project_path()` converts `/` to `-` to match Claude Code's internal directory naming under `~/.claude/projects/`.
   If Claude Code changes this encoding, sprack breaks silently.
   The encoding logic is duplicated rather than sourced from Claude Code itself.

4. **`sessions-index.json` and JSONL session file layout**: sprack-claude reads `sessions-index.json` for session metadata and tails `.jsonl` files for live transcript data.
   These are Claude Code internal file formats with no stability guarantee.

Each layer is a separate axis of fragility.
A change in any one (lace's tmux option naming, Claude Code's file layout, the bind mount convention) breaks sprack's container integration with no compile-time or startup-time error.

## Scope of Proposal

Design a generic integration bridge that replaces these hardcoded dependencies with a pluggable or data-driven approach.
The goal is not to eliminate lace support, but to make lace one possible backend behind a stable interface.

## Potential Directions

### 1. Container-Side Agent/Daemon

A lightweight process inside the container writes integration data to a shared volume or Unix socket.
The agent knows its own environment (workspace path, user, Claude session state) and exposes it in a format sprack can consume without reverse-engineering tmux options or bind mount paths.

**Tradeoffs**: Adds a runtime dependency inside the container.
Requires coordination on the shared volume path.
Decouples sprack from tmux entirely for container state, which is a large architectural shift.

### 2. Hook Event Bridge as Primary Data Source

Claude Code's hook system already provides `session_id`, `cwd`, and `transcript_path` on every event.
sprack-claude already has a `hook_transcript_path` and `hook_session_id` field on `SessionFileState`, and there is an existing TODO to remove the bind-mount resolution fallback once the hook bridge is implemented.

If hooks become the authoritative source of session data, the `~/.claude/projects/` enumeration, prefix matching, and `sessions-index.json` parsing can be eliminated entirely.
The hook bridge data comes *from* Claude Code, so it inherently matches whatever encoding or layout Claude Code uses.

**Tradeoffs**: Requires the hook event bridge to be fully implemented first.
The hook system only provides data when Claude Code is actively running; sprack cannot discover sessions that existed before sprack started unless there is a catch-up mechanism.
Does not address the tmux metadata coupling for container *detection* (knowing which panes are container panes).

### 3. Plugin/Adapter Pattern

Define a `ContainerBackend` trait (or similar) with methods like:
- `detect_container_sessions()` -> list of sessions with connection info
- `resolve_session_file(session)` -> path to the active session file
- `validate_connection(session)` -> is the container reachable?

Lace becomes one implementation.
Other container orchestrators (direct Docker, Podman, VS Code devcontainers) could provide their own implementations.

**Tradeoffs**: Requires defining a stable trait boundary.
The trait surface area must be narrow enough to be implementable but rich enough to be useful.
Risks over-engineering if lace remains the only backend for the foreseeable future.

### 4. Environment Variable / Config File Discovery

Replace tmux option introspection with a discovery file written by the container orchestrator.
For example, a JSON file at `~/.local/share/sprack/containers/<session>.json` containing `{ "port": 2222, "user": "node", "workspace": "/workspaces/lace" }`.

`lace-into` (or any orchestrator) writes this file when connecting.
sprack-poll reads the directory instead of querying tmux options.
Staleness detection is simpler: compare the file's content against the running container state.

**Tradeoffs**: Introduces a file-based contract that both sides must respect.
Requires cleanup of stale files when sessions end.
Duplicates state that tmux already tracks (the session *name* is still needed).

### 5. Hybrid Approach

Combine directions 2 and 3: use the hook event bridge for session file discovery (eliminating the bind mount and encoding dependencies) and a `ContainerBackend` trait for container detection (eliminating the tmux option dependency).
The lace backend reads tmux options today and could migrate to the config file approach later.

## Considerations

- **Incremental migration**: Any approach should allow incremental adoption.
  The current lace-specific code works; a rewrite that breaks it without providing immediate value is counterproductive.
- **Testing surface**: The current code has thorough unit tests for `find_container_project_dir`, `LaceContainerResolver`, and `find_candidate_panes`.
  A decoupling refactor must preserve or improve this test coverage.
- **The hook bridge TODO already exists**: `resolver.rs` has two TODO comments flagging the bind-mount resolution as a fallback to be removed once hooks are implemented.
  This RFP should be consistent with that planned migration.
- **`@lace_workspace` flakiness**: The sibling RFP (`2026-03-25-rfp-stale-tmux-lace-metadata.md`) documents a failure mode where `@lace_workspace` is empty while `@lace_port` is set.
  A decoupled architecture should be inherently less susceptible to partial metadata, since the data source (hook bridge, config file, or agent) can validate completeness at write time.
- **Performance**: sprack-poll runs on a 1-second interval.
  Any new discovery mechanism must complete within that budget.
  The current tmux option reads add ~5ms per session; file reads or socket queries should be comparable.
