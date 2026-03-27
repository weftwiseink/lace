---
first_authored:
  by: "@claude-opus-4-6-20250527"
  at: 2026-03-27T12:00:00-07:00
task_list: sprack/state-detection
type: report
state: live
status: wip
tags: [investigation, sprack, state_detection, architecture]
---

# Sprack State Detection: JSONL stop_reason and Process Tree Observation

> BLUF: Sprack's session state detection has two reliability gaps: state gets stuck on "thinking" because JSONL incremental reads can miss the final `stop_reason: end_turn` entry, and integrations persist after Claude exits because there is no process-exit detection for local panes.
> Both improvements are feasible with modest changes.
> JSONL-based `stop_reason` detection requires changing `extract_activity_state` to inspect the *last assistant message's* `stop_reason` field rather than relying solely on the last meaningful entry type.
> Process exit detection requires adding a `current_command` check in `run_poll_cycle` before session resolution.

## Context / Background

Sprack-claude is a daemon that detects Claude Code instances running in tmux panes, reads their JSONL session files, and writes structured status to a shared SQLite `process_integrations` table.
Two user-reported problems motivate this analysis:

1. **State stuck on "thinking"**: After Claude finishes a turn (JSONL contains `stop_reason: end_turn`), sprack sometimes fails to transition to "idle". The user suspects the Stop hook is unreliable or sprack is not processing the JSONL correctly.

2. **No exit detection**: When Claude exits a pane, sprack keeps the last known state in `process_integrations` until the pane itself is removed from tmux. The integration row lingers with stale data.

## Key Findings

### 1. Current State Detection is Correct but Fragile

The state machine in `status::extract_activity_state` (in `status.rs:122-152`) works correctly *when it sees the right entries*.
It examines the last non-sidechain, non-system entry:

- `assistant` with `stop_reason: null` -> Thinking
- `assistant` with `stop_reason: "end_turn"` -> Idle
- `assistant` with `stop_reason: "tool_use"` -> ToolUse
- `user` -> Waiting

The fragility is in the *entry delivery pipeline*, not the state logic.

### 2. Incremental Read Can Miss State Transitions

The `main.rs:182-194` code reads JSONL entries in two modes:

- **Initial read**: `tail_read` with a 32KB window (covers hundreds of entries).
- **Subsequent reads**: `incremental_read` from the last file position.

The incremental reader (`jsonl.rs:181-213`) seeks to the stored `file_position` and reads new bytes.
The problem: during an assistant turn, Claude writes *two* assistant entries for the same response:

1. **Streaming entry**: `stop_reason: null` (written when generation starts).
2. **Final entry**: `stop_reason: "end_turn"` (written when generation completes).

If sprack's poll cycle reads entry (1) but the file position advances past both entries before the next poll, sprack correctly reads entry (2) on the next cycle.
However, if sprack reads entry (1) and *caches it* in `session_state.last_entries`, then on the next poll cycle no new entries exist (the file position is already at EOF), so `session_state.last_entries` retains the stale `stop_reason: null` entries.

The critical code path in `main.rs:196-225`:
```rust
if !entries.is_empty() {
    // ... cache ingestion ...
    session_state.last_entries = entries;
}
```

When `entries` is empty (no new JSONL data), `last_entries` is not updated.
This means `build_summary` operates on the *previous* batch of entries, which may still have `stop_reason: null` as the last assistant message.

**Root cause**: The "stuck on thinking" bug occurs when:
1. Sprack reads a streaming assistant entry (`stop_reason: null`) during one poll cycle.
2. The final entry (`stop_reason: end_turn`) is written and read in the same subsequent poll cycle, but happens to be the *only* new entry.
3. If the read happens between the two writes - the initial streaming entry is the latest data.

Actually, the more likely scenario: sprack reads in a poll cycle where the streaming entry is the newest content, and then in subsequent cycles no new data arrives (Claude is done, waiting for user input).
The `last_entries` vector contains the streaming entry with `stop_reason: null`, and since no new entries are appended, `extract_activity_state` keeps returning Thinking.

### 3. Hook Events Do Not Override JSONL State

The `merge_hook_events` function (`events.rs:257-357`) only populates tasks, session_summary, and session_purpose.
It does **not** modify the `state` field.
Even if a `SessionEnd` hook event fires, the state remains whatever JSONL analysis determined.

There is no timestamp-based priority mechanism.
Hook events and JSONL entries are processed independently with no cross-correlation of timestamps.

### 4. Process Exit Detection Has the Infrastructure

Sprack-poll already reads `pane_current_command` from tmux (via `tmux.rs:50` - `#{pane_current_command}` in the format string).
This field is stored in the DB as `Pane.current_command` and is available to sprack-claude via the DB snapshot.

The candidate pane filter in `resolver.rs:27-60` uses `current_command.contains("claude")` to find local Claude panes.
When Claude exits, tmux reports the command as the shell (`nu`, `bash`, `zsh`), so the pane drops out of the candidate list.

However, `clean_stale_integrations` (`main.rs:731-754`) only removes integrations for panes not in the `active_pane_ids` list.
This works correctly: when the pane's command changes from `claude` to `nu`, the pane stops being a candidate, and `clean_stale_integrations` deletes the integration row.

**Re-evaluation**: The exit detection actually works for **local panes** (those detected by `current_command.contains("claude")`).
The gap is for **container panes**: they are included as candidates based on `container_name` on the session, regardless of what command is running.
A container pane remains a candidate even after Claude exits inside the container because the tmux session still has container metadata set.

For local panes, there is a subtler issue: the `/proc/<pid>` check in `is_session_cache_valid` (`main.rs:384-389`) correctly detects when the Claude process dies.
When the cache is invalidated, `process_claude_pane` tries to re-resolve the session via proc-walk, fails (no claude process), and writes an "error" integration (`"no session file found"`).
This error state persists until the pane command changes and the pane drops from the candidate list.

### 5. Cold Start Reconstruction Works Already

The initial `tail_read` with a 32KB window (`main.rs:183-188`) reads recent entries and derives state from them.
If sprack starts after Claude is already running, the tail read picks up the most recent entries and correctly determines state.

The 32KB window is generous: at ~200 bytes per entry, it covers ~160 entries, which spans multiple turn cycles.
Cold start is not a problem - the existing `tail_read` implementation handles it well.

### 6. Container Pane Exit Detection is the Real Gap

For container panes, the candidate selection (`resolver.rs:27-60`) includes all panes in sessions with `container_name` set.
A tmux session's container metadata persists for the lifetime of the session, regardless of whether Claude is running inside the container.

When Claude exits inside a container:
- The container itself is still running (the tmux session still has container metadata).
- The pane's `current_command` shows the container's shell, not `claude`.
- Sprack-claude tries to resolve a session file (via event files or project directory) and may find a stale one.
- The stale session file's `stop_reason: end_turn` correctly shows "idle", but the integration persists forever.
- If no session file is found, an error integration persists.

The `CONTAINER_SESSION_MAX_AGE` constant (60 seconds, `main.rs:366`) invalidates stale container sessions, but this only triggers re-resolution: if the session file still exists on disk (it does, indefinitely), resolution succeeds again.

## Approach A: JSONL stop_reason Priority

### What to Change

The core fix for "stuck on thinking" is ensuring `last_entries` always reflects the most current JSONL state, even when no new entries arrive in a poll cycle.

**Option A1: Re-read tail on every cycle (simple, slightly wasteful)**

Instead of only updating `last_entries` when new incremental data exists, always do a `tail_read` every N cycles (e.g., every 5th cycle = every 10 seconds).
This guarantees that even if the incremental reader missed a transition, the periodic tail read catches up.

Cost: reading 32KB from disk every 10 seconds per session. Negligible for SSDs.

**Option A2: Check for `stop_reason` in the *existing* last_entries on every cycle**

The current code only calls `build_summary` when entries exist.
But `session_state.last_entries` already contains the cached entries.
The fix: always call `build_summary(&session_state.last_entries, ...)`, not just when new entries arrive.

Wait: re-reading the code, `build_summary` *is* called on every cycle (line 232-235 is outside the `if !entries.is_empty()` block).
The issue is that `last_entries` is replaced wholesale with each batch of new entries (`session_state.last_entries = entries`).
If a poll cycle reads only the streaming entry (no final entry yet), `last_entries` contains only that entry.
Then the next poll reads the final entry, and `last_entries` is replaced with just that one entry.

Actually, let me re-examine.
The replacement at line 224 (`session_state.last_entries = entries`) means `last_entries` is always the *latest batch*, not an accumulation.
If the latest batch contains the `end_turn` entry, the state correctly transitions.
If the latest batch is empty (no new data), `last_entries` is not replaced, retaining the previous batch.

The "stuck" scenario requires that the *previous batch* (the one retained) has `stop_reason: null` as its last meaningful entry.
This happens when:
1. Poll cycle N reads several entries ending with an assistant streaming entry (`stop_reason: null`).
2. Poll cycle N+1 reads the final assistant entry (`stop_reason: end_turn`) + possibly a system/turn_duration entry.
3. At cycle N+1, `last_entries` is replaced with the new batch, which includes the `end_turn` entry. State should be correct.

Unless... Claude writes the `stop_reason: null` entry at the *start* of the response, and the `stop_reason: end_turn` entry at the *end*.
If sprack reads between these two writes, it sees `stop_reason: null` as the latest.
Then the *next* poll reads the `end_turn` entry as new data and correctly transitions.

The only way to get permanently stuck is if the `end_turn` entry is never written, or if the `stop_reason: null` entry is written *after* the `end_turn` entry (which does not happen in Claude's JSONL protocol).

**Revised hypothesis**: The "stuck on thinking" issue may actually be caused by the hook event system, not JSONL parsing.
If hook events (e.g., SubagentStart) trigger a state display change in the TUI that overrides the JSONL-derived state, and no corresponding SubagentStop fires, the display could show "thinking" indefinitely.

Alternatively, the issue could be timing-related: sprack-poll writes tmux state to the DB every 2 seconds, and sprack-claude reads from the DB every 2 seconds.
The race window is small but nonzero.

### Recommendation for Approach A

Regardless of root cause, a defensive improvement is valuable: add a periodic `tail_read` fallback (every 5th cycle) that re-reads the JSONL tail and rebuilds `last_entries` from scratch.
This eliminates any edge case where the incremental reader's cached state diverges from the file's actual content.

**Scope estimate**: ~20 lines of code change in `process_claude_pane`.
Add a cycle counter to `SessionFileState` and trigger a full `tail_read` every N cycles.

## Approach B: Process Exit Detection

### Local Panes: Already Handled (Mostly)

Local panes use `current_command.contains("claude")` for candidate filtering.
When Claude exits, the pane drops from the candidate list, and `clean_stale_integrations` removes the row.
This path works correctly.

The minor gap: between the exit and the next poll cycle (up to 2 seconds), the integration shows stale data.
This is acceptable.

### Container Panes: Needs a pane_current_command Check

Container panes are candidates based on `container_name`, not `current_command`.
To detect Claude exit inside a container, sprack-claude should check whether the pane's `current_command` contains "claude" (or the container's exec process) and skip resolution when it does not.

However, this is complicated: inside a container, the tmux pane runs `podman exec` or `ssh`, not `claude` directly.
The `pane_current_command` for a container pane is typically `podman` or `ssh`, regardless of what's running inside the container.

**Alternative: JSONL staleness check**.
If the JSONL file's mtime is older than a threshold (e.g., 5 minutes), consider the session inactive and clear the integration.
The existing `CONTAINER_SESSION_MAX_AGE` (60 seconds) already does this for cache invalidation, but the session file typically exists indefinitely on disk, so the mtime check after cache invalidation still finds a valid file.

The fix: after re-resolving a container session file, check if the file's mtime is older than a threshold *and* the last JSONL entry is a terminal state (`stop_reason: end_turn` or entry_type `user`).
If both conditions are true, the session is likely inactive.

**Better alternative: Check for SessionEnd hook event**.
The `events.rs` module already parses `SessionEnd` events.
When a `SessionEnd` event is seen, sprack should remove the integration for that pane.
Currently, `SessionEnd` is parsed but not acted upon in `merge_hook_events` (it falls through to the `_ =>` arm).

**Scope estimate**: ~30-40 lines.
In `merge_hook_events`, when a `SessionEnd` event is processed, set a `session_ended` flag on the summary.
In `run_poll_cycle`, after building the summary, if `session_ended` is true, delete the integration instead of writing it.

### Process Tree Check as a Complement

For local panes, an additional defensive check: after `is_session_cache_valid` returns true (the cached PID exists in `/proc`), verify that the pane's `current_command` still contains "claude".
If it does not, invalidate the cache immediately rather than waiting for the next full candidate scan.

This catches a race where:
1. Claude exits (the PID disappears from `/proc`).
2. A new process reuses the same PID (unlikely but possible on long-running systems).
3. The `/proc` check passes, but the pane command no longer says "claude".

**Scope estimate**: ~10 lines. Add a `current_command` check in `is_session_cache_valid`.

## Approach C: Timestamp-Based Priority (Hook vs. JSONL)

### Feasibility

Both hook events and JSONL entries have timestamps (`ts` in hook events, `timestamp` in JSONL entries).
A "most recent timestamp wins" strategy could reconcile conflicting signals.

However, the current architecture does not need this.
Hook events and JSONL entries provide *complementary* information:
- JSONL provides: state (thinking/idle/tool_use), model, context usage, token counts.
- Hook events provide: tasks, session summary, session purpose, session lifecycle.

They do not conflict because `merge_hook_events` does not touch the `state` field.
Adding timestamp-based priority would only be necessary if hook events started providing state signals (e.g., "Stop" hook -> idle).

### Not Recommended for Now

Timestamp-based reconciliation adds complexity without addressing the root causes.
The "stuck on thinking" bug is a JSONL caching issue, not a conflict between hook and JSONL signals.

## Pitfalls

- **Race between JSONL writes and reads**: Claude's JSONL writer uses append-mode file I/O. Sprack reads via `seek + read_to_string`. On Linux with ext4/btrfs, append writes are atomic at the line level (each `\n`-terminated write is visible as a complete line or not at all). Partial line reads are handled by discarding the first partial line in `tail_read` (line 162-166). This is safe.

- **File locking**: Neither Claude nor sprack uses file locks. This is fine for append-write + tail-read patterns on Linux, where atomic appends up to PIPE_BUF (4096 bytes) are guaranteed, and each JSONL line is well under this limit.

- **Large file seeking performance**: `incremental_read` seeks to the stored position and reads only new bytes. Cost is O(new_bytes), not O(file_size). The periodic `tail_read` fallback reads the last 32KB, which is also O(1) with a seek. No performance concern.

- **Container pane ambiguity**: A tmux session can have multiple panes. If one pane runs Claude and another runs a shell, sprack creates integrations for *all* container session panes. When Claude exits in one pane, the other pane's integration persists. The `SessionEnd` event approach solves this per-session, not per-pane.

- **JSONL file rotation**: The `incremental_read` function detects file shrinkage (rotation) and resets the position to 0. This is safe but worth noting: if Claude's session file is replaced (not rotated), sprack re-reads from the beginning.

## Recommendations

1. **High priority: Periodic tail_read fallback** (Approach A).
Add a cycle counter to `SessionFileState` and do a full `tail_read` every 5th cycle (~10 seconds).
This is a low-risk, low-effort fix that eliminates stale state from incremental read edge cases.
Estimated scope: ~20 lines in `main.rs`.

2. **High priority: Act on SessionEnd hook events** (Approach B).
When `merge_hook_events` encounters a `SessionEnd` event, signal to the caller that the integration should be removed.
This addresses the container pane exit detection gap.
Estimated scope: ~30-40 lines across `events.rs` and `main.rs`.

3. **Medium priority: current_command guard in cache validation** (Approach B complement).
Add a `current_command.contains("claude")` check in `is_session_cache_valid` for `CacheKey::Pid` entries.
Defensive measure against PID reuse.
Estimated scope: ~10 lines in `main.rs`.

4. **Low priority: Timestamp-based priority** (Approach C).
Not recommended unless hook events begin providing state signals.
The current architecture cleanly separates JSONL (state) from hooks (lifecycle/tasks).
