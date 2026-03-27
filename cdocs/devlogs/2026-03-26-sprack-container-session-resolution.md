---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T21:55:00-07:00
task_list: sprack/container-session-resolution
type: devlog
state: live
status: done
tags: [sprack, container, bug_fix]
---

# Sprack Container Session Resolution Fix

> BLUF: Two bugs caused container Claude sessions to show as `unnamed [error]` in the sprack TUI.
> The hook bridge wrote events to a non-mounted path (invisible to host), and the resolver's project-directory fallback was unreachable due to an early-return on missing event files.

## Root Cause Analysis

The pipeline from container Claude Code to host-side sprack TUI has two components:

1. **Hook bridge event delivery**: Claude Code fires hooks that run `sprack-hook-bridge`, which writes per-session event files.
2. **Session resolver**: `sprack-claude` reads event files and/or `~/.claude/projects/` to find the JSONL session file.

Both components had bugs.

### Bug 1: Hook bridge writes to non-mounted path

The `sprack-hook-bridge` script resolves its event directory as:
```bash
EVENT_DIR="${SPRACK_EVENT_DIR:-$HOME/.local/share/sprack/claude-events}"
```

The devcontainer feature sets `containerEnv.SPRACK_EVENT_DIR=/mnt/sprack/claude-events`, which the container shell inherits.
Claude Code hook subprocesses do NOT inherit the container shell environment.
The bridge falls back to `$HOME/.local/share/sprack/claude-events` (`/home/node/.local/share/sprack/claude-events` inside the container), which is a local directory not visible to the host.

### Bug 2: Resolver fallback is unreachable

In `resolve_container_pane_via_mount()`, the code structure was:
```rust
let event_file = event_file?;  // Returns None if no event files
// ... event file processing ...
// Fallback: find session in ~/.claude/projects/  <-- DEAD CODE
```

The `?` operator on line 159 caused the function to return `None` when no event files existed.
The project-directory fallback (which would have worked, since `~/.claude` is bind-mounted) was unreachable.

## Changes

### `sprack-hook-bridge.sh` (3 copies)

Replaced the single-line `SPRACK_EVENT_DIR` resolution with a three-tier check:
1. Explicit `SPRACK_EVENT_DIR` environment variable (if set).
2. Container bind mount at `/mnt/sprack/claude-events` (if the directory exists).
3. Local fallback at `$HOME/.local/share/sprack/claude-events`.

Files changed:
- `packages/sprack/hooks/sprack-hook-bridge.sh`
- `devcontainers/features/src/sprack/sprack-hook-bridge.sh`
- `.lace/prebuild/.devcontainer/features/sprack/sprack-hook-bridge.sh`

### `resolver.rs`

Restructured `resolve_container_pane_via_mount()` to make the project-directory fallback always reachable.
The event file search is now wrapped in `if let Some(ref ef) = event_file { ... }` instead of using `?`.
When no event files exist, execution falls through to the `~/.claude/projects/` lookup.

Added test `resolve_container_pane_falls_back_to_project_dir_without_events` to prevent regression.

## Verification

Tested end-to-end against the running lace container:

**Before fix**: Container pane `%36` in `process_integrations` showed:
```json
{"state":"error","error_message":"no session file found"}
```

**After fix**: Same pane shows:
```json
{"state":"idle","model":"claude-haiku-4-5-20251001","context_percent":23}
```

Also verified the hook bridge fix by manually invoking the bridge without `SPRACK_EVENT_DIR`:
events correctly flow to `/mnt/sprack/claude-events/` (the bind mount) instead of the local path.

96 tests pass (95 existing + 1 new).
