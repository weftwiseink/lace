---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T16:30:00-07:00
task_list: terminal-management/sprack-ui-and-ipc-cont
type: devlog
state: live
status: review_ready
tags: [sprack, hooks, session_cache, tmux_ipc, container_validation]
---

# Sprack UI and IPC Continuation

> BLUF: Continuation session implementing the remaining sprack roadmap from the prior troubleshooting handoff.
> Four checkpoints: hook bridge deployment + session dedup (CHECKPOINT_1), session cache wiring (CHECKPOINT_2), tmux IPC migration (CHECKPOINT_3), and container validation (CHECKPOINT_4).

## Starting State

- All 121 tests pass across sprack-poll (19), sprack TUI (43), sprack-claude (59).
- Hook bridge script existed in repo but was not deployed to `~/.local/share/sprack/hooks/`.
- `events.rs` reader and `cache.rs` schema exist but cache is not wired into poll loop.
- Both sprack daemons running (PIDs in `~/.local/share/sprack/`).
- tmux has a `main` session with one nushell pane.
- This Claude session runs outside tmux per user instruction.

## Implementation Plan

### CHECKPOINT_1: Hook Bridge + Session Dedup

Deploy hook bridge, wire `session_id`/`transcript_path` from SessionStart hook events into session resolution.
Solves the "all panes show same data" dedup problem for multi-instance same-project sessions.

### CHECKPOINT_2: Session Cache Wiring

Wire `cache.rs` `ingest_new_entries` into `run_poll_cycle`.
Open `session-cache.db` on startup.
Populate extended ClaudeSummary fields: `user_turns`, `assistant_turns`, `tool_counts`, `context_trend`.

### CHECKPOINT_3: tmux IPC Migration

Replace raw `Command::new("tmux")` with `tmux-interface-rs` in sprack-poll and sprack TUI.
Derive Hash on snapshot types for change detection.

### CHECKPOINT_4: Container Validation

Validate `LaceContainerResolver` against live lace deployment.

## Work Log

### Hook Bridge Deployed

Copied `hooks/sprack-hook-bridge.sh` to `~/.local/share/sprack/hooks/sprack-hook-bridge`.
Verified `jq` available (1.8.1), script executable.
Hook configuration already in `~/.claude/settings.local.json`.

### CHECKPOINT_1: Hook Event Bridge Session Dedup (2c06d10)

Subagent implementation: 4 files, 194 lines added, 64 tests (5 new).
Added `hook_transcript_path` and `hook_session_id` fields to `SessionFileState`.
Event file lookup prefers `session_id`-based lookup (O(1)) over cwd-based scan.
When `SessionStart` provides `transcript_path`, it overrides the mtime heuristic.
Container-internal paths that don't exist on the host are ignored.

### CHECKPOINT_2: Session Cache Wiring (f1e62e4)

Subagent implementation: 5 files, 157 lines added, 140 tests total.
`session-cache.db` opens at startup (failure is non-fatal).
`ingest_new_entries` called after each JSONL read.
`read_session_summary` enriches ClaudeSummary with turn counts, tool usage, context trend.
`now_utc()` fixed: was producing invalid `1970-01-01T00:00:00Z+Ns`, now proper ISO 8601.
TUI renders: `{N}t` turn count in inline suffix, tool usage line in rich widget, context trend arrows.

### CHECKPOINT_3: tmux IPC Delimiter Fix (5fb69ab)

Subagent implementation: 3 files, 58 lines added, 42 removed.
Replaced `||` (double-pipe) delimiter with `\t` (tab) in tmux format string parsing.
Tab is a control character that cannot appear in tmux names/paths, eliminating collision by construction.

> NOTE(opus/sprack-ui-and-ipc-cont): The proposal called for `tmux-interface-rs` library adoption.
> The tab delimiter approach was chosen as the pragmatic minimum: it solves the correctness problem without adding a dependency.
> `tmux-interface-rs` can be evaluated separately if more structure is needed.

Added `#[derive(Hash)]` to snapshot types and `compute_snapshot_hash()` for struct-level change detection.
Fixed stale module doc comment ("unit-separator-delimited" corrected to tab-delimited).
Fixed `compute_hash()` dead_code warning by marking it `#[cfg(test)]`.

### CHECKPOINT_4: Container Process Host Awareness Validation

Validated the `LaceContainerResolver` against a live lace deployment.

**Test setup:**
- Started lace container (`lace up`) with SSH on port 22426
- Fixed stale SSH host key (container was recreated)
- Created tmux session `lace-test` with `@lace_port=22426`, `@lace_user=node`, `@lace_workspace=/workspaces/lace`

**Validation results:**
1. sprack-poll correctly reads lace metadata from tmux session options (confirmed via DB query)
2. Container pane (`ssh` command) is detected as a candidate by `find_candidate_panes`
3. `CONTAINER_RECENCY_THRESHOLD` (300s) correctly filters stale session files (all pre-existing files were 8+ hours old)
4. After running `claude --print` from `/workspaces/lace/main` inside the container, a fresh JSONL file was created via the bind mount
5. `LaceContainerResolver` resolved: prefix match on `-workspaces-lace-main`, selected newest JSONL by mtime
6. Integration written: state=`idle`, model=`claude-opus-4-6`, user_turns=1
7. TUI headless render confirmed correct display: `LACE-TEST` host group, `[idle] 23K/1M 1t`

**Known limitations confirmed:**
- `claude --print` does not fire hooks (non-interactive mode), so hook event dedup cannot be tested without a full interactive session
- Container nushell prompts don't show in `tmux capture-pane` (rendering issue, not functional)
- `sessions-index.json` `fullPath` entries contain container-internal paths (`/home/node/.claude/...`) that don't resolve on the host: this is why `LaceContainerResolver` uses `find_via_jsonl_listing` instead

## Commits

| Checkpoint | Commit | Files | Tests |
|-----------|--------|-------|-------|
| CHECKPOINT_1 | `2c06d10` | 4 files, +194 | 64 |
| CHECKPOINT_2 | `f1e62e4` | 5 files, +157 | 140 |
| CHECKPOINT_3 | `5fb69ab` | 3 files, +58/-42 | 140 |
| CHECKPOINT_4 | (validation only) | 0 | 140 |

## Deviations from Plan

- **CHECKPOINT_3**: Used tab delimiter instead of `tmux-interface-rs`. The library adds dependency complexity for marginal benefit over the tab approach. The core problem (delimiter collision) is solved.
- **CHECKPOINT_4**: Validated via `claude --print` (non-interactive) rather than a full interactive session. Hook event dedup in container context requires an interactive session to generate SessionStart events. The bind-mount resolution path is fully validated.

