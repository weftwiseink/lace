---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-27T15:30:00-07:00
task_list: sprack/session-resolution-fix
type: report
state: live
status: review_ready
tags: [sprack, retrospective, testing, architecture, session_resolution]
---

# Sprack Session Resolution: Implementation Retrospective

> BLUF: An 8-commit arc implementing a test harness and 7 bug fixes brought sprack-claude from "5 of 7 TUI discrepancies broken" to "all 7 resolved."
> The test harness was essential for validating isolated fixes but insufficient for catching emergent bugs: every live verification round revealed new issues invisible to unit tests.
> The codebase has several architectural patterns that compound into flaky behavior: inference from filesystem artifacts, multi-source resolution with priority conflicts, and cache invalidation gaps.
> This report synthesizes the patterns worth scrutinizing during a deeper review.

## Context / Background

The sprack container integration status report (`cdocs/reports/2026-03-27-sprack-container-integration-status.md`) documented 7 discrepancies (D1-D7) between sprack TUI output and reality: ghost container sessions, wrong names, wrong states, duplicates, and missing sessions.
Prior fix sessions (2026-03-25 through 2026-03-27) produced 5 targeted fixes that improved individual symptoms without resolving the underlying pipeline issues.
This session implemented a test harness (proposal 1) then used it to drive fixes (proposal 2), iterating through live verification until all 7 discrepancies were resolved.

## Key Findings

### What the Test Harness Caught

- State detection correctness: idle/thinking/tool_use/waiting mapping from JSONL entries.
- Session naming priority: sessions-index.json > JSONL custom-title > slug.
- Hook event lifecycle: SessionStart transcript_path override, SessionEnd clearing.
- Sidechain filtering: subagent entries excluded from state determination.
- Deduplication: multiple panes resolving to the same file produce one integration.
- Stale container detection: old files with terminal state are cleared.

### What the Test Harness Did NOT Catch

- **Cross-contamination via parent-path walking**: the container resolver finding host-side session files.
  Only discoverable by comparing `--dump-rendered-tree` output against tmux ground truth.
- **Session file resolution conflicts**: `find_session_file` returning an indexed file that doesn't belong to the running process.
  Requires knowing which process is writing to which file, which is runtime state.
- **Cache invalidation gaps**: PID reuse after `/new` command.
  Requires process tree state that `TestFixture` can't simulate without `/proc` mocking.
- **Compact summary interference**: `is_compact_summary` entries polluting `extract_activity_state`.
  Only manifests with real Claude Code JSONL that has undergone context compaction.
- **TUI pane count off-by-one**: sprack's own pane excluded from count.
  Lives in the TUI crate, not the data pipeline.

### Iteration Pattern

Each fix round followed the same pattern:
1. Fix passes all tests.
2. Live `--dump-rendered-tree` reveals a new issue invisible to tests.
3. Root-cause investigation discovers a different code path or data condition.
4. New fix + new test.

This happened 4 times across the session, each time uncovering a category of bug the test harness couldn't have caught without simulating full system state.

## The Fixes, In Execution Order

| Commit | Fix | Bug Class |
|--------|-----|-----------|
| c83eac6 | Test harness infrastructure | Foundation |
| 774b05e | Review findings: two-cycle SessionEnd, sidechain filtering, home_dir refactoring | Test coverage |
| 58651e2 | Stale detection (A2), dedup (A3), session naming via sessionId probe (B1) | D1, D2, D3, D7 |
| e43bbe8 | Stale detection on initial discovery, local-first dedup ordering | D1 oscillation, dedup order |
| ab55c29 | Prefer newer non-indexed files, head_read for early naming entries | D4, session file resolution |
| f0c1611 | Workspace-first container resolution (no parent-path fallback when workspace has files) | D1 cross-contamination |
| 5340086 | PID change detection for session replacement, pane count fix, compact summary filtering | Session /new, D5, D6 |

## Architecture Patterns Worth Scrutiny

### 1. Inference from Filesystem Artifacts (Highest Priority)

sprack-claude infers session state from JSONL files, file mtimes, directory listings, and `/proc` walks.
None of these are authoritative: JSONL files are historical records, mtimes are side effects, directory listings are point-in-time snapshots, and `/proc` walks are racy.

**Where this bites:**
- `find_session_file` picks the "most recent" file by mtime, which may not be the file the running Claude is writing to.
  The `sessions-index.json` can point to a different file than what's newest on disk.
  Fix ab55c29 added a two-source comparison, but the fundamental issue is that "most recent by mtime" is a heuristic, not a fact.
- `extract_activity_state` reads JSONL entries and infers state from the last meaningful entry's `stop_reason`.
  Between Claude tool calls, there can be windows where the last entry is a `user` message (state = Waiting) even though Claude is actively working.
  The periodic `tail_read` refresh mitigates this but leaves a ~10-second window of potential incorrectness.

**Recommendation:** The long-term fix is the SQLite mirror proposal (`cdocs/proposals/2026-03-24-claude-code-sqlite-mirror.md`).
In the interim, consider adding a `/proc/<pid>/fd` check for the open JSONL file descriptor as a resolution signal.
Claude Code keeps a write fd open to the active session file: this would be the authoritative "which file is this process writing to?" signal.

> NOTE(opus/session-resolution-fix): During investigation, `ls -la /proc/<claude_pid>/fd | grep jsonl` returned nothing.
> Claude Code may not keep a persistent fd open.
> This needs verification: if Claude uses `O_APPEND` with `open()/write()/close()` per entry, the fd approach won't work.
> If it keeps the fd open (more likely for performance), it's viable.

### 2. Multi-Source Resolution with Priority Conflicts

Session file resolution has 4 sources, each with different trust levels:

| Source | Trust | Provides | Used By |
|--------|-------|----------|---------|
| Hook event `transcript_path` | Authoritative | Exact file path + session_id | Container panes with hooks |
| `sessions-index.json` | High | File path + customTitle + sessionId | Local panes, container fallback |
| JSONL file listing by mtime | Medium | File path only | Fallback when no index |
| `/proc` PID walk + CWD | High (local only) | Process CWD → project dir | Local panes |

The priority conflicts emerge when these sources disagree:
- `sessions-index.json` points to file A (old, but has customTitle).
- Disk mtime listing finds file B (newer, no customTitle, is the active session).
- The running Claude process's CWD maps to the same project directory.

Fix ab55c29 added logic to prefer the newer non-indexed file, but this is a patch on a design that assumes a single source of truth.

**Recommendation:** Unify resolution into a single priority chain with explicit fallthrough logging.
When a source is used, log WHY (e.g., "index entry matched but newer non-indexed file found, preferring disk listing").
This would make debugging resolution issues trivial.

### 3. Cache Invalidation Model

`SessionFileState` is cached by pane_id with `CacheKey::Pid` (local) or `CacheKey::ContainerSession` (container).
Invalidation checks:

| Key Type | Invalidation Signal | Gap |
|----------|---------------------|-----|
| `Pid(n)` | `/proc/<n>` doesn't exist | PID reuse: if the same numeric PID is assigned to a new process, the check passes incorrectly. Fix 5340086 added `find_claude_pid` comparison to catch the common case (new Claude under same shell). |
| `ContainerSession(path)` | File doesn't exist or mtime > 60s | The 60s constant (`CONTAINER_SESSION_MAX_AGE`) is arbitrary. Long-running tool calls that don't write JSONL for >60s trigger false invalidation. |

**Recommendation:** Consider event-driven invalidation instead of polling-based.
The hook bridge already fires `SessionStart` and `SessionEnd` events.
If sprack-claude watched event directories via `inotify` (or polled them at higher frequency), it could invalidate caches immediately on session transitions rather than waiting for the mtime or PID check to fire.

### 4. Container Candidate Selection

`find_candidate_panes` includes ALL panes in a container session, regardless of whether Claude is running in them.
A `nu` shell pane, a `podman exec` pane, and an `ssh` pane all become candidates if their parent session has `container_name`.

This broad selection is the root of the cross-contamination problem: non-Claude panes in container sessions get matched to session files that don't belong to them.

**Recommendation:** Consider a tighter candidate filter for container panes.
Options:
- Only include container panes whose `current_command` is `podman`, `ssh`, or `claude` (not `nu`, `vim`, `bash`).
- Only include container panes when hook events exist for the workspace (evidence of an active Claude session).
- Only include the pane with the most recent hook event, not all panes in the session.

### 5. JSONL Entry Type Sprawl

`extract_activity_state` skips 8 entry types as non-meaningful, filters sidechains and compact summaries, and maps the remainder to states.
The skip list was discovered incrementally: `result` entries were not in `SKIPPED_ENTRY_TYPES` until fix 5340086 added them.

Every new Claude Code entry type risks breaking state detection if it's not in the skip list.
This is a maintenance hazard.

**Recommendation:** Invert the logic: instead of skipping known non-meaningful types, only consider known meaningful types (`user`, `assistant`).
All other types would be ignored by default.
This is more robust against Claude Code adding new entry types.

### 6. The `event_dirs()` / `$HOME` Dependency Pattern

Before this session, `event_dirs()` read `$HOME` from the environment.
Several other functions also read `$HOME` directly (`resolve_container_git_via_metadata` before the refactor).
The `home_dir` parameter threading fixed this for testability, but the pattern persists:
- `resolve_container_git_via_exec` calls `podman exec` (subprocess, can't inject deps).
- `check_already_running` / `pid_file_path` read `$HOME`.
- `cache::open_cache_db` has a default path using `$HOME`.

**Recommendation:** Consider a `Config` or `Context` struct that holds `home_dir`, `claude_home`, `cache_path`, and pass it through the call chain instead of individual parameters.
This would consolidate the dependency injection surface and make the code easier to test.

## How the Test Scaffold Was Useful

### Direct Value

1. **Regression protection**: the 15 integration tests encode every fixed behavior. Future refactors can't silently reintroduce D1-D7.
2. **Acceptance criteria**: updating test assertions to reflect desired behavior (from "assert bug exists" to "assert correct behavior") gave implementation agents unambiguous pass/fail criteria.
3. **Fast feedback**: `cargo test -p sprack-claude` runs in <0.2s. Live verification cycles take 15-30s (daemon restart + poll cycles + dump).

### Indirect Value

4. **Refactoring confidence**: the `home_dir` parameter threading touched 4 files. Tests confirmed no regressions.
5. **Bug discovery**: the `find_session_file_skips_sidechains` test caught that the newer-file-on-disk logic would promote sidechain files. This edge case would have been invisible without the existing test.

### Limitations

6. **Cannot simulate multi-process interference**: the `TestFixture` creates files and calls `run_poll_cycle`, but can't simulate two independent processes writing to the same project directory concurrently.
7. **No `/proc` simulation for local panes**: all 15 integration tests use container sessions. Local pane resolution via `/proc` is only tested at the unit level (`proc_walk` tests with `MockProcFs`).
8. **No TUI rendering coverage**: the harness tests the data pipeline (resolution → DB write). The TUI tree rendering (DB read → display) is tested separately via `test_render.rs` snapshot tests but is not connected to the integration harness.

## Remaining Known Issues

1. **Waiting/thinking oscillation**: state can briefly show `waiting` between tool calls when the JSONL entries haven't caught up. The `TAIL_READ_REFRESH_INTERVAL` of 5 cycles (~10s) means state can lag. Reducing to 3 cycles (~6s) would help, but the fundamental issue is polling-based state detection.

2. **`pane_pid` staleness in sprack-poll**: when Claude restarts in a pane, `sprack-poll` updates `pane_pid` on its next tmux query. If sprack-claude polls between the process change and sprack-poll's update, it sees the old PID. The `find_claude_pid` fix catches this for the common case but doesn't eliminate the race window.

3. **`sessions-index.json` update lag**: Claude Code updates this file asynchronously. New sessions may not appear in the index for several seconds after creation. The `find_session_file` fix (prefer newer non-indexed files) handles this, but it means the first few poll cycles for a new session won't have a `customTitle` from the index.

4. **`container_workspace` detection for whelm**: the whelm session has `container_name: "whelm"` but no `container_workspace`. This is a sprack-poll issue: the container workspace detection logic doesn't find the workspace for whelm's container. This causes whelm panes to be treated as non-container candidates, falling through to local resolution.
