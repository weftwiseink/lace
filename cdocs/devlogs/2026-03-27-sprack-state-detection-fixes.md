---
first_authored:
  by: "@claude-opus-4-6-20250527"
  at: 2026-03-27T13:00:00-07:00
task_list: sprack/state-detection-fixes
type: devlog
state: live
status: review_ready
tags: [sprack, state_detection, session_naming, bug_fix]
---

# Sprack State Detection and Naming Fixes: Devlog

## Objective

Implement 5 targeted fixes for sprack's session state detection and naming, based on analysis in two reports:
- `cdocs/reports/2026-03-27-sprack-state-detection-improvements.md`
- `cdocs/reports/2026-03-27-jsonl-session-naming.md`

The fixes address: stale "thinking" state from incremental read caching, missing SessionEnd handling, lingering local pane integrations, container session naming via sessions-index.json, and JSONL custom-title parsing.

## Plan

1. **Fix 1**: Periodic tail_read fallback in main.rs.
2. **Fix 2**: Act on SessionEnd hook events in main.rs.
3. **Fix 3**: current_command guard for local panes in main.rs.
4. **Fix 4**: sessions-index.json lookup for container naming in session.rs/resolver.rs/main.rs.
5. **Fix 5**: custom-title JSONL parsing in jsonl.rs/status.rs.

Each fix: implement, test, commit.

## Testing Approach

- `cargo test --workspace` after each fix (baseline: 178 tests).
- Final verification: `cargo build --workspace && cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40`.

## Implementation Notes

### Fix 1: Periodic tail_read fallback

Added `poll_cycle_count` field to `SessionFileState` and `TAIL_READ_REFRESH_INTERVAL` constant (5 cycles = ~10 seconds).
Every 5th cycle, forces a full `tail_read` instead of `incremental_read`.
This catches the case where `last_entries` retains stale `stop_reason: null` because no new data arrives after the final `end_turn` entry is written.

### Fix 2: SessionEnd hook event handling

Added `has_session_end()` helper and `delete_integration()` helper.
After merging hook events, if any `SessionEnd` event exists in the accumulated events, the integration is deleted and the cache entry evicted.
This is the primary exit detection path for container panes where `current_command` shows `podman` or `ssh` regardless of whether Claude is running inside.

### Fix 3: current_command guard

Changed `is_session_cache_valid` to accept `pane` (removed the `_` prefix) and added a `!pane.current_command.contains("claude")` check for `CacheKey::Pid` entries.
This invalidates the cache immediately when Claude exits, rather than waiting for `/proc/<pid>` to disappear.
Also defends against the unlikely case of PID reuse by a non-Claude process.

### Fix 4: sessions-index.json container naming

Added `lookup_session_name_by_id()` to `session.rs`: searches all `sessions-index.json` files under `~/.claude/projects/` for an entry matching a given `sessionId`, returning its `customTitle`.
Called from two locations:
1. `resolve_container_pane_via_mount()` in `resolver.rs` when hook events provide a session_id at resolution time.
2. `process_claude_pane()` in `main.rs` lazily when a `SessionStart` hook event is received and `session_name` is still None.

> NOTE(opus/state-detection-fixes): The container naming path requires hook events to provide the session_id.
> Without the sprack-hook-bridge configured in the container, this path is not activated and naming falls back to JSONL slug.
> The current lace container does not have hook event files, so the slug fallback is exercised.

### Fix 5: custom-title JSONL parsing

Added `custom_title` and `agent_name` fields to `JsonlEntry` (with `serde(rename)` for camelCase JSON keys).
Added `extract_jsonl_custom_title()` to `status.rs`: scans entries in reverse for the last `custom-title` entry, falling back to `agent-name`.
Updated `resolve_session_name()` to accept a third parameter `jsonl_title` with priority: sessions-index title > JSONL title > slug.
During `incremental_read`, new naming entries update `session_name` if no higher-priority source has set it.

## Changes Made

| File | Description |
|------|-------------|
| `packages/sprack/crates/sprack-claude/src/main.rs` | Periodic tail_read (Fix 1), SessionEnd handling (Fix 2), current_command guard (Fix 3), lazy session name lookup (Fix 4), JSONL naming during incremental read (Fix 5) |
| `packages/sprack/crates/sprack-claude/src/session.rs` | `poll_cycle_count` field on SessionFileState, `lookup_session_name_by_id()` function, 2 new tests |
| `packages/sprack/crates/sprack-claude/src/resolver.rs` | Session name lookup during container resolution via hook events |
| `packages/sprack/crates/sprack-claude/src/jsonl.rs` | `custom_title` and `agent_name` fields on JsonlEntry |
| `packages/sprack/crates/sprack-claude/src/status.rs` | `extract_jsonl_custom_title()`, updated `resolve_session_name()` with 3-tier priority, 6 new tests |
| `packages/sprack/crates/sprack-claude/src/cache.rs` | Updated test helpers for new JsonlEntry fields |

## Verification

### Build and Tests

```
cargo test --workspace: 186 passed (8 new tests added across 5 fixes)
cargo build --workspace: succeeded
```

### Runtime Verification

Daemons restarted, `--dump-rendered-tree` output:

```
$ cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40

LACE
  lace (1w) [lace] attached
    nu (2 panes) *
        claude/cuddly-wobbling-shannon [idle]
          opus-4-6 | 344K/1M | 0 subagents | 53 turns
          Bash:25 Agent:7 Write:2
          on main@05844c8
        claude/cuddly-wobbling-shannon [idle]
          opus-4-6 | 344K/1M | 0 subagents | 53 turns
          Bash:25 Agent:7 Write:2
          on main@05844c8
LOCAL
  lace-local (3w) attached
    claude (1 panes)
          ~/code/weft/lace/main/pa... (sprack) pid:1239123
    nu (1 panes)
        * ~/code/weft/lace/main/pa... (nu) pid:3325081
    claude (2 panes) *
        claude/jaunty-seeking-crescent [thinking]
          opus-4-6 | 34K/1M | 0 subagents | 3 turns
          on main@3cb40bf
        claude/jaunty-seeking-crescent [thinking]
          opus-4-6 | 34K/1M | 0 subagents | 3 turns
          on main@3cb40bf
  main (1w)
    nu (1 panes) *
        * ~/code/weft/lace/main/pa... (nu) pid:2431869
```

**Observations:**
- Container session (LACE): shows `[idle]` state correctly (not stuck on "thinking").
  Named via JSONL slug (`cuddly-wobbling-shannon`), which is correct because no `customTitle` is set for this session.
- Local session (LOCAL): shows `[thinking]` state correctly (this is the active agent session).
  Named via JSONL slug (`jaunty-seeking-crescent`).
- Both sessions display model, token counts, turn counts, tool usage, and git state.

> NOTE(opus/state-detection-fixes): Container naming via sessions-index.json (Fix 4) is not exercised in this run because no hook event files exist for the lace container.
> The JSONL custom-title path (Fix 5) is not exercised because neither session has been `/rename`d.
> Both paths are tested via unit tests and will activate when the conditions are met.
