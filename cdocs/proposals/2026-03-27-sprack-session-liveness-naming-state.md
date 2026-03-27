---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-27T11:56:00-07:00
task_list: sprack/session-resolution-fix
type: proposal
state: live
status: review_ready
tags: [sprack, session_resolution, state_detection, liveness, architecture]
---

# Unified Session Resolution Fix: Process Liveness, Session Naming, and State Detection

> BLUF: Three classes of sprack-claude bugs share a root cause: the resolver treats filesystem artifacts (JSONL files, mtime, directory listings) as proof of live sessions when they are actually historical records.
> This proposal unifies fixes for stale container sessions, wrong session names, and stuck "thinking" state into a single implementation arc with four phased deliverables.
> Phase 1 (test harness) is delegated to the companion proposal.
> Phases 2-4 implement process liveness gating, sessions-index.json naming, and periodic tail_read state correction, each with mandatory TestFixture test cases and `--dump-rendered-tree` verification.
> The fix set addresses all 7 discrepancies documented in the container integration status report: eliminates D1-D3 and D5-D7 directly, and D4 (wrong local session names) when hook events provide per-session transcript paths.
> D4 without hooks remains a limitation of the mtime-based session file selection heuristic.

## Dependency

This proposal depends on the test harness built in Phase 1 of [`2026-03-27-sprack-session-resolution-test-harness.md`](2026-03-27-sprack-session-resolution-test-harness.md).
All fixes described here require corresponding `TestFixture` test cases from that harness.
Phase 1 must complete before implementation of Phases 2-4 begins.

## Problem Statement

The container integration status report (`cdocs/reports/2026-03-27-sprack-container-integration-status.md`) documents 7 discrepancies between sprack TUI output and reality.
These reduce to three failure classes:

**A. Stale sessions (D1, D2, D7).**
Container panes show integrations for Claude sessions that are not running.
The resolver finds JSONL files on disk and treats their existence as evidence of an active session.
There is no liveness check: once a JSONL file is written, it produces an integration until its mtime ages past `CONTAINER_SESSION_MAX_AGE` (60s), at which point the cache invalidates and re-resolves to the same file.
Local panes have a weaker version of this problem: the `current_command` guard works but multiple panes resolving to the same session file produce duplicates (D5, D7).

**B. Wrong names (D3, D4).**
Sessions display auto-generated slugs (`cuddly-wobbling-shannon`, `jaunty-seeking-crescent`) instead of user-set names (`podman-mig`, `adopt-lace`, `copy-mtg`).
The `sessions-index.json` lookup works for local panes when the index has a `customTitle`, but container panes resolve via `find_best_project_session` which returns a bare `PathBuf` with no name.
The JSONL `custom-title` parsing requires a `/rename` command entry within the 32KB tail window, and container JSONL files have zero such entries.

**C. Wrong state (D6).**
Sessions show "thinking" or "waiting" when the actual state is different.
The `last_entries` cache retains entries from the previous incremental read batch.
When no new data arrives (Claude is idle, waiting for input), `last_entries` is not updated, and if the cached batch ends with `stop_reason: null`, the state stays "thinking."
The periodic tail_read refresh (every 5 cycles / ~10 seconds) mitigates this but leaves a 10-second window of incorrect state.

## Design

### A. Process Liveness as Primary Gate

The core principle: no filesystem artifact should produce a TUI integration unless a Claude process is confirmed running.

#### A1. Local panes: `current_command` is already the gate

The `find_candidate_panes` function includes local panes only when `current_command.contains("claude")`.
When Claude exits, tmux reports the shell (`nu`, `bash`), and the pane drops from candidates.
`clean_stale_integrations` deletes the orphaned integration row.
This path works correctly.

The remaining local pane issues are deduplication (D5, D7) and per-pane session disambiguation (D4).
Multiple panes in the same window can resolve to the same session file because `find_session_file` picks the most recent by mtime, regardless of which Claude process wrote it.
Deduplication (A3 below) prevents duplicate integrations.
Per-pane disambiguation requires matching the specific Claude process to its session file.
The hook bridge provides this via `transcript_path` in `SessionStart` events, and the existing code in `process_claude_pane` switches to the hook-provided path when available.
Without hooks, `find_session_file` picks the most recent session, which may be wrong for one of the panes.

> NOTE(opus/session-resolution-fix): Full per-pane session disambiguation without hooks would require checking which JSONL file has an open file descriptor from the Claude PID (via `/proc/<pid>/fd`).
> This is technically feasible but invasive.
> The hook bridge path is the correct long-term solution for this.

#### A2. Container panes: SessionEnd hook as primary exit signal, mtime as fallback

Container panes cannot use `current_command` because the host sees `podman` regardless of what runs inside the container.
Two signals detect Claude exit:

1. **SessionEnd hook event** (primary): the hook bridge writes a `SessionEnd` event when Claude exits.
   The current code already handles this in `process_claude_pane`: `has_session_end()` triggers `delete_integration`.
   This is the correct primary path and requires no changes.

2. **Mtime + terminal-state check** (fallback): when no SessionEnd event fires (hooks not configured, bridge failure, container crash), the fallback uses JSONL file mtime.
   The current `CONTAINER_SESSION_MAX_AGE` (60s) cache invalidation re-resolves to the same stale file indefinitely because the file still exists.

   **Fix**: after re-resolving a container session file (cache invalidation triggered), check two conditions:
   - The file's mtime is older than `CONTAINER_SESSION_MAX_AGE`.
   - The last meaningful JSONL entry has a terminal `stop_reason` (`end_turn`) or is a `user` entry (waiting for input that will never come).

   When both conditions are true, the session is inactive.
   Write no integration for this pane (skip, not error).

   **Implementation**: in `process_claude_pane`, after re-resolution but before the JSONL read, check the resolved file's mtime.
   If stale, do a quick `tail_read`, check the last entry's state, and if terminal, return early without writing an integration.

```rust
// In process_claude_pane, after session resolution succeeds:
if let session::CacheKey::ContainerSession(_) = &session_state.cache_key {
    if let Ok(metadata) = std::fs::metadata(&session_state.session_file) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.elapsed() {
                if elapsed > CONTAINER_SESSION_MAX_AGE {
                    // File is stale. Check if session is in a terminal state.
                    let probe_entries = jsonl::tail_read(
                        &session_state.session_file,
                        jsonl::default_tail_bytes(),
                    );
                    let probe_state = status::extract_activity_state(&probe_entries);
                    if matches!(
                        probe_state,
                        ProcessStatus::Idle | ProcessStatus::Waiting | ProcessStatus::Error
                    ) {
                        // Session is inactive. Do not write an integration.
                        session_cache.remove(&pane.pane_id);
                        return;
                    }
                }
            }
        }
    }
}
```

> NOTE(opus/session-resolution-fix): This does not use `podman exec pgrep claude` because that approach adds ~50ms latency per pane per poll cycle and requires the container to be running.
> The mtime + terminal-state check is a pure filesystem operation with negligible cost.

#### A3. Deduplication: one integration per session file

Multiple panes in the same window can resolve to the same session file (the "same-project dedup" limitation from D2, D5, D7).
The hook event bridge provides `session_id` for disambiguation, but this is not wired into per-pane deduplication.

**Fix**: after all candidate panes are processed in `run_poll_cycle`, deduplicate integrations by session file path.
If multiple panes resolve to the same `session_file`, keep only the first pane's integration and delete the rest.

**Implementation**: track resolved session files during the pane processing loop.

```rust
// In run_poll_cycle, replace the existing loop:
let mut seen_session_files: HashMap<PathBuf, String> = HashMap::new(); // session_file -> pane_id

for pane in &candidate_panes {
    // ... existing process_claude_pane call ...

    // After processing, check for duplicate session files.
    if let Some(state) = session_cache.get(&pane.pane_id) {
        let file = &state.session_file;
        if let Some(existing_pane_id) = seen_session_files.get(file) {
            // Duplicate: delete this pane's integration, keep the first.
            delete_integration(db_connection, &pane.pane_id);
            continue;
        }
        seen_session_files.insert(file.clone(), pane.pane_id.clone());
    }

    active_pane_ids.push(pane.pane_id.clone());
}
```

> WARN(opus/session-resolution-fix): This deduplication is a heuristic.
> When two Claude instances run in the same project (different panes, same directory), they write to separate session files.
> The dedup only fires when they resolve to the *same* file, which happens when the resolver's mtime-based selection picks the same winner for both panes.
> The correct long-term fix is per-pane session_id tracking via hook events, which the hook bridge already supports.

### B. Session Naming via sessions-index.json + JSONL custom-title

The naming priority chain:

1. `customTitle` from `sessions-index.json` (most authoritative, user-set via `/rename`)
2. `customTitle` from JSONL `custom-title` entry (same data, different source)
3. `agentName` from JSONL `agent-name` entry (usually mirrors customTitle)
4. `slug` from JSONL entries (auto-generated three-word identifier)
5. `None` (TUI displays "unnamed")

#### B1. Container naming: lookup in sessions-index.json using hook_session_id

The primary naming path for container sessions uses `lookup_session_name_by_id`, which scans all host `sessions-index.json` files for a matching `sessionId`.
This already works when a `SessionStart` hook event provides the `session_id`.

**Gap**: the fallback path via `find_best_project_session` (no hook events) returns a bare `PathBuf` with `session_name: None`.
The session file on disk contains a `sessionId` field on most entries.

**Fix**: after `find_best_project_session` resolves a session file, extract the `sessionId` from the file's entries and look it up in `sessions-index.json`.

**Implementation**: in `resolve_container_pane_via_mount`, after the `find_best_project_session` fallback path:

```rust
// Current code returns SessionFileState with session_name: None.
// Fix: extract sessionId from the file and look up in sessions-index.json.
let best = find_best_project_session(workspace, host_cwd, claude_home)?;

// Probe the session file for a sessionId to look up in sessions-index.json.
let probe_entries = crate::jsonl::tail_read(&best, crate::jsonl::default_tail_bytes());
let session_id = probe_entries
    .iter()
    .find_map(|e| e.session_id.as_deref())
    .map(|s| s.to_string());

let session_name = session_id
    .as_deref()
    .and_then(|sid| session::lookup_session_name_by_id(claude_home, sid));

Some(SessionFileState {
    session_name,
    hook_session_id: session_id,
    // ... rest of fields unchanged ...
})
```

This adds one `tail_read` (32KB, <1ms on SSD) during initial container session resolution.
Subsequent cycles use the cached name.

#### B2. JSONL custom-title as secondary source

The existing `extract_jsonl_custom_title` function scans entries for `custom-title` and `agent-name` types.
It is called during incremental reads in `process_claude_pane` and updates `session_name` when no name exists from `sessions-index.json`.

This path already works for local sessions where the JSONL contains naming entries.
For container sessions, JSONL files have zero naming entries (confirmed in the session naming report): this path provides no value for containers but remains useful as defense-in-depth for local sessions.

No code changes needed for B2.

#### B3. Slug as last resort

The `build_summary` function already extracts `slug` from JSONL entries and uses it as the final fallback in `resolve_session_name`.
No changes needed.

### C. State Detection via Periodic tail_read + stop_reason

#### C1. Periodic tail_read refresh (already implemented)

The `TAIL_READ_REFRESH_INTERVAL` constant (5 cycles = ~10 seconds) forces a full `tail_read` every 5th poll cycle.
This catches state transitions that the incremental reader missed: when `last_entries` contains a stale `stop_reason: null` and no new data arrives, the periodic tail_read re-reads the file tail and gets the correct `end_turn` entry.

This is functional and requires no changes.

#### C2. Cold-start reconstruction (already implemented)

On first resolution (`file_position == 0`), `process_claude_pane` performs a `tail_read` instead of an `incremental_read`.
The 32KB window covers hundreds of entries, providing correct state from the first poll cycle.

No changes needed.

#### C3. Narrower refresh window

The 10-second window between tail_read refreshes is acceptable for most use cases.
If tighter state accuracy is needed, reduce `TAIL_READ_REFRESH_INTERVAL` from 5 to 3 (6 seconds).
The cost is negligible: reading 32KB from an SSD takes <1ms.

**Recommendation**: reduce to 3 cycles after the test harness confirms correctness.
Do not change before the harness is in place, to avoid masking bugs with faster polling.

## Verification Methodology

Every fix must satisfy three verification levels:

### Level 1: TestFixture Unit Test

Each fix has a corresponding test case in the `TestFixture` harness (from the companion proposal).
The test constructs synthetic state, runs the resolution pipeline, and asserts on integration output.

Specific test cases per fix:

| Fix | Test Case | Assertion |
|-----|-----------|-----------|
| A2 | `container_pane_cleared_when_stale_and_terminal` | No integration row when mtime > 60s and last entry is `end_turn` |
| A2 | `container_pane_kept_when_stale_but_thinking` | Integration persists when mtime > 60s but last entry has `stop_reason: null` |
| A3 | `duplicate_panes_same_file_produce_one_integration` | Only one integration row despite two panes resolving to same file |
| B1 | `container_session_name_from_sessions_index_via_jsonl_probe` | Session name is `customTitle` from index, not slug |
| B1 | `container_session_name_none_when_no_index_entry` | Session name falls through to slug or None |
| C1 | `periodic_tail_read_corrects_stale_thinking_state` | State transitions to `idle` after forced tail_read |

### Level 2: `--dump-rendered-tree` Integration Check

After all TestFixture tests pass, verify against the live system:

```sh
cargo build --workspace
# Restart daemons
pkill sprack-claude; sleep 1
cargo run --bin sprack-claude &

# Wait for 2 poll cycles
sleep 5

# Capture rendered tree
cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40
```

Expected output structure for the current environment (3 local Claude sessions, 0 container sessions):

```
LOCAL
  lace-local (3w) attached
    claude (2 panes) *
        claude/podman-mig [thinking]
          opus-4-6 | ...
        * ...
    nu (1 panes)
        ...
    claude (2 panes)
        claude/adopt-lace [idle]
          opus-4-6 | ...
        claude/copy-mtg [idle]
          opus-4-6 | ...
  main (1w)
    nu (1 panes) *
        ...
```

Key assertions on the rendered tree:

1. **No LACE section** when no Claude is running in the container (fix A2 eliminates D1).
2. **No duplicate entries** under any window (fix A3 eliminates D2, D7).
3. **Session names are custom titles** (`podman-mig`, `adopt-lace`, `copy-mtg`), not slugs (fix B1 eliminates D3; D4 requires hook events for per-pane disambiguation).
4. **States reflect reality**: active session shows `[thinking]`, idle sessions show `[idle]` (fix C1 eliminates D6).
5. **All 3 Claude sessions appear** with distinct names (fix A3 + B1 eliminates D5).

### Level 3: Scenario Walkthrough

After deploying fixes, manually execute these scenarios and verify:

1. **Container Claude start**: launch `claude` inside the lace container.
   Verify the LACE section appears within one poll cycle (~2s) with the correct session name.
2. **Container Claude exit**: exit the Claude session inside the container.
   Verify the LACE section disappears within one poll cycle if SessionEnd hook fires, or within 60s + one poll cycle if mtime fallback is used.
3. **Session rename**: execute `/rename my-new-name` in a Claude session.
   Verify the TUI updates the name within one poll cycle.
4. **Multiple sessions same project**: start two Claude instances in the same project directory.
   Verify both appear as distinct entries with their own names and states.

## Implementation Phases

### Phase 1: Test Harness Infrastructure (companion proposal)

See [`2026-03-27-sprack-session-resolution-test-harness.md`](2026-03-27-sprack-session-resolution-test-harness.md).

Deliverables:
- `TestFixture` struct with filesystem mocking and in-memory DB.
- Helper constructors for mock JSONL entries, sessions-index.json, hook events, tmux state.
- Trivial "empty state produces no integrations" test passes.

### Phase 2: Process Liveness (fixes A2, A3)

**Files to modify:**
- `packages/sprack/crates/sprack-claude/src/main.rs`: container mtime + terminal-state check in `process_claude_pane`, session file deduplication in `run_poll_cycle`.

**Test cases to add** (in `test_resolution.rs` from Phase 1):
- `container_pane_cleared_when_stale_and_terminal`
- `container_pane_kept_when_stale_but_thinking`
- `container_pane_cleared_by_session_end_hook`
- `duplicate_panes_same_file_produce_one_integration`
- `two_sessions_same_project_both_shown`

**Success criteria:**
- All new tests pass.
- `--dump-rendered-tree` shows no stale container sessions and no duplicates.

### Phase 3: Session Naming (fix B1)

**Files to modify:**
- `packages/sprack/crates/sprack-claude/src/resolver.rs`: add `sessionId` probe and `lookup_session_name_by_id` call in the `find_best_project_session` fallback path of `resolve_container_pane_via_mount`.

**Test cases to add:**
- `container_session_name_from_sessions_index_via_jsonl_probe`
- `container_session_name_none_when_no_index_entry`
- `container_session_name_prefers_index_over_slug`
- `local_session_name_from_sessions_index`

**Success criteria:**
- All new tests pass.
- `--dump-rendered-tree` shows custom titles for sessions that have them.

### Phase 4: State Detection Tuning (fix C3)

**Files to modify:**
- `packages/sprack/crates/sprack-claude/src/main.rs`: reduce `TAIL_READ_REFRESH_INTERVAL` from 5 to 3.

**Test cases to add:**
- `periodic_tail_read_corrects_stale_thinking_state`
- `cold_start_tail_read_determines_correct_state`

**Success criteria:**
- All tests pass.
- Maximum stale-state window reduced from ~10s to ~6s.

## Related RFPs

### Liveness and Error Surfacing (`cdocs/proposals/2026-03-26-rfp-sprack-liveness-error-surfacing.md`)

The process liveness checks in this proposal (fix A2) are a prerequisite for the error surfacing work in that RFP.
Once sprack-claude correctly identifies stale vs. active sessions, the TUI can surface freshness indicators (`[stale Ns]`) and error categories ("no session file", "hooks not configured").
This proposal solves the correctness problem; the error surfacing RFP solves the observability problem.

### SQLite Mirror (`cdocs/proposals/2026-03-24-claude-code-sqlite-mirror.md`)

The long-term alternative to JSONL inference is a normalized SQLite mirror of all Claude Code session data.
With the mirror in place, sprack-claude would query the mirror for session state instead of tail-reading JSONL files.
This eliminates the entire class of incremental-read caching bugs (fix C) and provides richer status extraction.
This proposal's fixes are interim: they make the JSONL inference pipeline correct within its current architecture.
The SQLite mirror would replace this pipeline entirely.

### Daemon Lifecycle (`cdocs/proposals/2026-03-25-sprack-daemon-lifecycle.md`)

Daemon coordination (crash recovery, stale file handles, restart ordering) is orthogonal to session resolution correctness.
This proposal assumes the daemons are running and producing data; the lifecycle RFP addresses what happens when they crash or restart.

## Edge Cases

### Hook bridge not installed

When the sprack devcontainer feature is not installed, no hook events exist.
Container session resolution falls through to `find_best_project_session`.
The B1 fix still works: it probes the resolved JSONL file for `sessionId` and looks up `sessions-index.json`.
The A2 fallback (mtime + terminal-state) provides exit detection without hooks.

### Multiple Claude instances in the same container

If two Claude sessions run simultaneously in the same container, they write to separate JSONL files in the same project directory.
The resolver picks the one with the most recent mtime, which alternates as both sessions write.
This is an existing limitation not addressed by this proposal.
The correct fix requires per-pane `session_id` tracking via hook events, which the hook bridge supports but the resolver does not yet wire through to per-pane disambiguation.

> TODO(opus/session-resolution-fix): Per-pane session_id disambiguation is a natural Phase 5 after the hook bridge is reliably deployed.

### JSONL file without sessionId

Some JSONL files (very old sessions, corrupted files) may lack `sessionId` on all entries.
The B1 probe gracefully returns `None`, and naming falls through to slug or "unnamed."
No error is produced.

### Container crash without SessionEnd

If the container crashes (or is force-stopped), no `SessionEnd` event fires.
The A2 mtime + terminal-state fallback detects this: the JSONL file stops being written, its mtime ages past 60s, and the terminal state check identifies the session as inactive.
The integration disappears within ~62 seconds (60s mtime + one 2s poll cycle).

## Open Questions

1. **Should `CONTAINER_SESSION_MAX_AGE` be configurable?**
   The 60-second constant works for typical Claude sessions (which write JSONL entries at least every few seconds during active use).
   Long-running tool calls that produce no JSONL output for >60s would trigger a false stale detection.
   A longer timeout (e.g., 120s) provides more headroom but delays stale session cleanup.

2. **Should the deduplication in A3 prefer the pane with hook events?**
   When two panes resolve to the same session file, the current proposal keeps the first pane encountered.
   A smarter heuristic would prefer the pane whose `hook_session_id` matches the file's `sessionId`.
   This adds complexity but produces more accurate results.

3. **Is the 32KB tail_read probe in B1 too expensive for initial container resolution?**
   The probe runs once per container pane per resolution (not per poll cycle).
   At ~1ms per probe, the cost is negligible for typical environments (<10 container panes).
   For environments with many container panes, the cost scales linearly.
