---
first_authored:
  by: "@claude-opus-4-6-20250527"
  at: 2026-03-27T13:00:00-07:00
task_list: sprack/state-detection-fixes
type: devlog
state: live
status: wip
tags: [sprack, state_detection, session_naming, bug_fix]
---

# Sprack State Detection and Naming Fixes: Devlog

## Objective

Implement 5 targeted fixes for sprack's session state detection and naming, based on analysis in two reports:
- `cdocs/reports/2026-03-27-sprack-state-detection-improvements.md`
- `cdocs/reports/2026-03-27-jsonl-session-naming.md`

The fixes address: stale "thinking" state from incremental read caching, missing SessionEnd handling, lingering local pane integrations, container session naming via sessions-index.json, and JSONL custom-title parsing.

## Plan

1. **Fix 1**: Periodic tail_read fallback in main.rs (~20 lines).
   Add a poll cycle counter to SessionFileState; every 5th cycle, use tail_read instead of incremental_read to refresh stale cached entries.

2. **Fix 2**: Act on SessionEnd hook events in main.rs (~30-40 lines).
   When SessionEnd is seen in cached hook events, delete the integration instead of writing it.

3. **Fix 3**: current_command guard for local panes in main.rs (~10 lines).
   In is_session_cache_valid, check pane.current_command still contains "claude" for Pid-based cache keys.

4. **Fix 4**: sessions-index.json lookup for container naming in resolver.rs (~50 lines).
   When resolving container sessions, look up the host project directory's sessions-index.json using the hook_session_id as a matching key.

5. **Fix 5**: custom-title JSONL parsing in jsonl.rs (~30 lines).
   Add customTitle and agentName fields to JsonlEntry; extract and use them as session name sources.

Each fix: implement, test, commit.

## Testing Approach

- `cargo test --workspace` after each fix (must maintain 173+ tests passing).
- Final verification: `cargo build --workspace && cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40`.

## Implementation Notes

### Fix 1: Periodic tail_read fallback

### Fix 2: SessionEnd hook event handling

### Fix 3: current_command guard

### Fix 4: sessions-index.json container naming

### Fix 5: custom-title JSONL parsing

## Changes Made

| File | Description |
|------|-------------|

## Verification
