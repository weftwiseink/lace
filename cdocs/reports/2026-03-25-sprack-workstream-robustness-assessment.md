---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T20:00:00-07:00
task_list: terminal-management/sprack-robustness-assessment
type: report
state: live
status: review_ready
tags: [sprack, architecture, status, robustness]
---

# Sprack Workstream Robustness Assessment

> BLUF: Four workstreams have been implemented in rapid succession across a single session with solid test coverage (126 tests, all passing).
> The core data pipeline (poll, cache, render) is sound, but user-facing quality is undermined by data display bugs and a hard dependency on lace-into setting `@lace_workspace` correctly.
> Sprack is not trying to do too much: the workstreams are genuinely independent.
> The top priority for stabilization is fixing the three data display bugs (inflated turn count, wrong session names, task UI showing tool counts), which are all sprack bugs, not lace issues.

## Context / Background

This report assesses the four main sprack development workstreams completed on 2026-03-25: Hook Event Bridge, Claude Incremental Cache, tmux IPC Migration, and Container/Host Awareness.
The assessment was requested after user testing surfaced six issues, several of which affect basic usability despite the underlying infrastructure being well-tested.

The relevant source code spans three crates: `sprack-poll` (19 tests), `sprack-claude` (64 tests), and the TUI `sprack` crate (43 tests).
Two RFPs and two prior reports provide additional context for the container awareness workstream.

## Key Findings

- All 126 tests pass across the three crates.
- The four workstreams are architecturally independent: hook bridge feeds `events.rs`, cache lives in `cache.rs`, IPC is in `sprack-poll/tmux.rs`, and container resolution is in `resolver.rs`. No circular dependencies or tight coupling between them.
- Of the six user-reported issues, three are sprack-internal display bugs, two are lace-into configuration issues, and one is a UI default preference.
- The most impactful bug (inflated turn count: 824 instead of actual turns) traces to the cache ingestion logic, which accumulates counts across sprack-claude restarts without reset or dedup.
- Container resolution has a hard fail-open on missing `@lace_workspace`, producing silent `None` returns with no diagnostic logging.

## Per-Workstream Assessment

### 1. Hook Event Bridge

**Completion:** ~80%
**Robustness:** Medium
**Test coverage:** 12 tests (event parsing, incremental reads, file lookup by session_id and cwd)

The hook bridge script is deployed, and `events.rs` correctly parses all event types: `SessionStart`, `PostToolUse` (TaskCreate/TaskUpdate), `TaskCompleted`, `SubagentStart/Stop`, `PostCompact`, `SessionEnd`.
Session dedup via `hook_session_id` and `hook_transcript_path` is wired into `main.rs` (lines 240-301).

**Strengths:**
- Session-ID-based lookup is O(1) vs the O(n) cwd scan fallback.
- Transcript path override correctly resets `file_position` and re-reads from the right file.
- Container-internal paths are correctly ignored (line 265: `tp_path.is_file()` check).

**Gaps:**
- Hook bridge has not been tested with a full interactive container session (validated only via `claude --print`, which does not fire hooks).
- The `find_event_file` cwd-based scan reads entire files to check the last line's `cwd` field. This is O(files * file_size) on every poll cycle for panes without a cached session_id.
- No cleanup of stale event files in `~/.local/share/sprack/claude-events/`.

**Known issues from user testing:** None directly attributed to hooks.

### 2. Claude Incremental Cache

**Completion:** ~85%
**Robustness:** Medium-Low
**Test coverage:** 6 tests (turn counting, tool tracking, context history, compact summary filtering, incremental accumulation, schema idempotency)

The cache schema is well-designed with five normalized tables (`ingestion_state`, `session_metadata`, `tool_usage`, `context_history`, `subagent_tracking`).
WAL mode and `busy_timeout` provide good SQLite concurrency behavior.
Cache enrichment is non-fatal: `open_cache_db` failure falls back gracefully (line 65-70 of `main.rs`).

**Strengths:**
- Compact summary entries are correctly filtered to avoid double-counting (line 122-123 of `cache.rs`).
- Sidechain entries are filtered (line 123).
- Context trend computation uses a 5-point moving window with a 5% threshold for directionality.
- Tool counts are sorted by frequency and limited to top 10.

**Gaps and bugs:**
- **Turn count inflation (user-reported):** The cache accumulates `user_turns` and `assistant_turns` via `UPDATE ... SET user_turns = user_turns + ?2`. If sprack-claude restarts and re-reads the tail of a JSONL file, the same entries are counted again. There is no dedup mechanism (no entry ID tracking, no byte offset correlation with `ingestion_state`). The `ingestion_state` table exists in the schema but is never written to.
- **Dynamic SQL parameter binding** (lines 238-288 of `cache.rs`): The `match param_idx` pattern with hardcoded `"?9"`, `"?10"`, `"?11"` is fragile and hard to extend. A single off-by-one in the parameter index produces silent data corruption.
- `now_utc()` uses a manual calendar algorithm instead of a library. While the Hinnant algorithm is correct, this is unnecessary complexity for a utility function.

**Known issues from user testing:**
- Turn count shows 824 for a session that should have far fewer turns. Root cause: cache accumulation without dedup across daemon restarts.

### 3. tmux IPC Migration

**Completion:** ~95%
**Robustness:** High
**Test coverage:** 14 tests in `tmux.rs`, 5 tests in `diff.rs`

The `||` delimiter was replaced with `\t` (tab) throughout.
Tab is a control character that cannot appear in tmux names/paths, making the delimiter choice correct by construction.
`#[derive(Hash)]` on `TmuxSnapshot`, `TmuxSession`, `TmuxWindow`, and `TmuxPane` enables struct-level change detection via `compute_snapshot_hash()`.

**Strengths:**
- The delimiter choice is provably correct: tmux forbids control characters in user-visible names.
- `parse_single_line` validates field count (`EXPECTED_FIELD_COUNT = 19`) and returns `None` for malformed lines.
- Tests cover special characters, multi-session parsing, empty output, and malformed lines.
- `compute_lace_meta_hash` sorts keys for deterministic hashing regardless of HashMap iteration order.

**Gaps:**
- The `diff.rs` test data at lines 53-75 still uses `||` delimiters in test string literals. These tests exercise `compute_hash` on raw strings, not parsed output, so they pass. But they are misleading documentation.
- `tmux-interface-rs` adoption was deferred. The tab delimiter solves the correctness problem, but error handling for tmux CLI failures (lines 71-90) is minimal: all IO errors become `TmuxError::NotFound`, which is misleading for non-ENOENT failures.

**Known issues from user testing:** None.

### 4. Container/Host Awareness

**Completion:** ~70%
**Robustness:** Low
**Test coverage:** 11 tests in `resolver.rs`

The `LaceContainerResolver` works correctly when all preconditions are met (`lace_workspace` set, matching project dir, recent JSONL).
The CHECKPOINT_4 validation confirmed end-to-end resolution in a live lace deployment.

**Strengths:**
- `CONTAINER_RECENCY_THRESHOLD` (300s) correctly excludes stale session directories.
- Container pane cache invalidation uses `CONTAINER_SESSION_MAX_AGE` (60s) via file mtime, compensating for the inability to check PIDs across namespaces.
- Multiple worktree directories with the same workspace prefix are handled correctly (most recent mtime wins).
- Resolver tests cover prefix matching, stale exclusion, missing dirs, and empty dirs.

**Gaps and bugs:**
- **`@lace_workspace` not set (user-reported, most impactful container issue):** `resolve_container_pane` returns `None` on the very first line (`session.lace_workspace.as_deref()?`). No log, no error integration, no diagnostic. The pane is silently dropped from resolution.
- **`find_candidate_panes` filters on `lace_port.is_some()` only:** A pane with `lace_port` set but `lace_workspace` missing passes the candidate filter but always fails resolution. This produces a write of `"no session file found"` error integration on every poll cycle (every 2 seconds).
- **Session names show as `ssh/lace` (user-reported):** Container-resolved sessions do not get a `session_name` from `sessions-index.json` because the resolver uses `find_via_jsonl_listing` (which skips the index). The `customTitle` is never populated for container panes.
- **Container panes show host-side directory (user-reported):** `pane.current_path` is read from tmux, which reports the local `ssh` process's cwd, not the remote container's cwd. This is a fundamental tmux limitation for SSH panes.
- Four coupling points to lace internals are documented in the decoupling RFP: tmux option names, bind mount path, project directory encoding, JSONL file layout.

## Issue Classification

| Issue | Category | Root Cause | Severity |
|-------|----------|------------|----------|
| Turn count inflated (824) | Sprack bug | Cache accumulation without dedup across restarts | High |
| Session names show `ssh/lace` | Sprack bug | Container resolver skips `sessions-index.json` | Medium |
| Task UI shows tool counts | Sprack bug | Task rendering logic uses wrong data source | Medium |
| Tree starts collapsed | Sprack UI default | TreeState initialization | Low |
| `@lace_workspace` not set | lace-into config | Race/ordering in metadata population | High |
| Container pane shows host dir | tmux limitation | SSH pane reports local cwd, not remote | Low |

> NOTE(opus/sprack-robustness): The "Task UI showing tool counts" issue requires further investigation.
> It may be that the TUI's task rendering path is triggered by `tool_counts` presence rather than `tasks` presence, causing the tool usage line to appear in the task section.
> The `has_hook_data` flag in `tree.rs` checks `tasks.is_some() || session_summary.is_some()`, but the rich widget always renders tool counts when available regardless of task presence.

## Risk Assessment

**Architecture risk: Low.**
The four workstreams are cleanly separated.
No workstream creates coupling to another.
The crate boundaries (`sprack-poll`, `sprack-claude`, `sprack` TUI) enforce separation at the module level.

**Data correctness risk: High.**
The turn count inflation bug means the most prominent metric shown to users is wrong.
This undermines trust in all displayed data.
The fix is straightforward (use `ingestion_state` to track byte offsets and skip already-ingested ranges), but until it ships, the cache provides unreliable numbers.

**Dependency risk: Medium.**
Container awareness has a hard dependency on lace-into populating `@lace_workspace`.
The RFP for stale tmux metadata acknowledges this but no fix has been implemented.
The decoupling RFP identifies four fragile coupling points to Claude Code internals (project directory encoding, JSONL format, bind mount paths, `sessions-index.json` schema).
Any Claude Code update that changes these breaks sprack silently.

**Test coverage risk: Low.**
126 tests pass and cover the critical paths.
The gap is integration testing: no test exercises the full poll-cache-render pipeline end-to-end, and container resolution has only been validated manually.

## Recommendations

### Priority 1: Fix Data Display Bugs (Sprack-Internal)

These are the highest-impact, lowest-effort fixes.
They are all sprack bugs with no external dependencies.

1. **Fix turn count inflation.** Write `ingestion_state` rows with byte offsets during `ingest_new_entries`. On restart, skip entries before the last-known offset. Alternatively, use entry-level dedup via `session_id + timestamp` or `session_id + entry_index`.
2. **Fix session names for container panes.** After resolving a container pane via `find_via_jsonl_listing`, read the JSONL entries to extract the `slug` field as a fallback session name. The `customTitle` from `sessions-index.json` is unavailable for container paths, but `slug` is embedded in the JSONL entries themselves.
3. **Fix task UI rendering.** Audit the rich widget rendering path in `tree.rs` to ensure tool counts render on the tool line (not the task line) and that the task line only renders when `tasks` is `Some` with non-empty entries.

### Priority 2: Improve Container Awareness Diagnostics

1. **Log a warning when `lace_port` is set but `lace_workspace` is empty.** Add this check to `find_candidate_panes` or `process_claude_pane` so the failure mode is visible in sprack-claude's stderr.
2. **Require both `lace_port` and `lace_workspace` for candidate inclusion.** Change `find_candidate_panes` to filter on both fields, preventing the silent resolution failure and repeated error integration writes.

### Priority 3: Stabilize Cache Accumulation

1. **Wire `ingestion_state` into the ingest loop.** The table exists but is never populated. Store `(file_path, byte_offset, file_size, session_id)` and use it to avoid re-processing on restart.
2. **Add a cache reset mechanism.** A CLI flag or signal that clears `session_metadata` counters for a specific session, useful during development when data gets corrupted.

### Priority 4: Address Coupling (Deferred)

The lace decoupling RFP and stale metadata RFP document the right long-term directions.
The hook event bridge (Direction 2 in the decoupling RFP) is the most promising path: it eliminates the bind-mount resolution, project directory encoding, and `sessions-index.json` dependencies.
Two TODO comments in `resolver.rs` already flag the bind-mount resolution as a fallback to be removed once hooks are implemented.
This work should wait until the Priority 1-3 items are stable.

## Is Sprack Trying to Do Too Much?

No.
The four workstreams address genuinely independent concerns: data ingestion (hooks), data persistence (cache), transport correctness (IPC delimiter), and cross-namespace resolution (containers).
They share the `ClaudeSummary` struct as a common data model but do not create circular dependencies.
The crate structure (`sprack-poll` for tmux, `sprack-claude` for Claude integration, `sprack` for TUI) enforces clean boundaries.

The risk is not architectural overreach but premature feature layering: the cache enrichment (CHECKPOINT_2) was wired in before the base data pipeline was fully validated against real-world data.
The inflated turn count is a direct consequence: the feature works in unit tests but fails under real restart conditions.
Stabilizing the base before adding enrichment layers is the recommended approach going forward.
