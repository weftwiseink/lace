---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-27T11:00:00-07:00
task_list: sprack/session-resolution-fix
type: proposal
state: live
status: review_ready
tags: [sprack, testing, session_resolution, state_detection, architecture]
---

# Test-Driven Session Resolution Fix for sprack-claude

> BLUF: sprack-claude's session resolution pipeline has compounding failure modes: stale container sessions, wrong names (slugs instead of custom titles), wrong state (thinking when idle), and duplicate entries.
> Five targeted fixes in the recent session improved individual symptoms but the underlying inference model remains fragile.
> This proposal inverts the debugging approach: build an integration test harness that defines correct output first, then fix until tests pass.
> The harness mocks tmux state, session files, and hook events, runs the full resolution pipeline, and asserts on the resulting DB integration rows (session names, states, counts).
> A mandatory verification protocol for future changes requires test-first development and live `--dump-rendered-tree` confirmation.

## Summary

The core insight is that sprack-claude infers session state from filesystem artifacts (JSONL files, /proc, hook events, sessions-index.json) rather than receiving authoritative state from Claude Code.
This inference model has been the source of every bug in the recent stabilization sessions: each fix improves one inference path but does not prevent new failure modes from appearing elsewhere in the pipeline.

Key references:
- `cdocs/devlogs/2026-03-27-sprack-state-detection-fixes.md`: the five targeted fixes and their limitations.
- `cdocs/devlogs/2026-03-26-sprack-container-session-resolution.md`: hook bridge and resolver fallback bugs.
- `cdocs/devlogs/2026-03-25-sprack-troubleshooting-and-widget-restyle.md`: three critical pipeline bugs, architecture assessment.

> NOTE(opus/session-resolution-fix): The architecture assessment from 2026-03-25 concludes that the dual-source design (JSONL + hooks) is sound and bugs are reconciliation issues.
> This proposal does not change the architecture.
> It adds a test harness that makes reconciliation bugs catchable before they reach runtime.

## Objective

Eliminate the class of bugs where sprack-claude displays incorrect session names, states, or counts by:
1. Building a test harness that exercises the full resolution pipeline with synthetic inputs.
2. Encoding each known bug as a failing test case.
3. Fixing the bugs until all tests pass.
4. Establishing a verification protocol that prevents regressions.

## Background

### Current Test Coverage

The codebase has 186 tests across the workspace:
- `sprack-claude`: 105 tests covering JSONL parsing, status extraction, session discovery, resolver dispatch, hook events, and session cache.
- `sprack`: 45 tests including 12 insta snapshot tests for TUI rendering.
- `sprack-db`: 17 tests for schema and read/write operations.
- `sprack-poll`: 19 tests for tmux parsing and polling.

The gap: no test exercises the full pipeline from "tmux snapshot + session files + hook events" through to "what the user sees."
Unit tests pass while the displayed output is wrong because each unit is correct in isolation but the composition produces incorrect results.

### Known Bugs (Still Present After 5 Fixes)

**a. Stale container sessions.**
When no Claude process is running in a container pane, the integration persists.
Container panes have no PID to check across namespace boundaries: staleness relies on session file mtime (60-second timeout).
If the JSONL file was recently written (e.g., Claude just exited), the integration lingers until mtime ages out.

**b. Wrong names (slugs instead of custom titles).**
The devlog verification shows sessions named `cuddly-wobbling-shannon` (auto-slug) rather than user-set names.
The sessions-index.json lookup path (Fix 4) requires hook events to provide a `session_id`, and the JSONL custom-title path (Fix 5) requires a `/rename` command.
Neither path is exercised in the common case of a container session without hooks or renames.

**c. Wrong state (thinking when idle).**
The periodic tail_read refresh (Fix 1, every ~10 seconds) mitigates but does not eliminate this.
Between refresh cycles, `last_entries` may retain stale `stop_reason: null` from an incremental read that captured an intermediate assistant message before the final `end_turn` entry was written.

**d. Duplicate entries.**
Multiple panes in the same tmux session can each resolve to the same session file (the "same-project dedup" limitation noted in the 2026-03-25 devlog).
The hook event bridge provides `session_id` for disambiguation, but this is not wired into the per-pane resolution.

## Proposed Solution

### Architecture: Integration Test Harness

A new test module in `sprack-claude` that:
1. Constructs a synthetic `DbSnapshot` (sessions, windows, panes, integrations).
2. Creates a temporary `~/.claude/` directory tree with mock session files (JSONL), `sessions-index.json`, and hook event files.
3. Runs the core resolution functions (`find_candidate_panes`, `resolve_container_pane`, `process_claude_pane` logic).
4. Asserts on the resulting integration writes: session names, states, presence/absence.

This is distinct from the existing TUI snapshot tests (`test_render.rs`), which test rendering from already-populated DB data.
The new harness tests the data production pipeline that populates the DB.

### Test Harness Design

```rust
/// Integration test fixture for sprack-claude's session resolution pipeline.
struct TestFixture {
    /// Temporary directory containing mock ~/.claude/ tree.
    claude_home: tempfile::TempDir,
    /// In-memory SQLite DB with sprack schema.
    db: rusqlite::Connection,
}

impl TestFixture {
    fn new() -> Self { ... }

    /// Adds a mock JSONL session file with the given entries.
    fn add_session_file(
        &self,
        project_path: &str,
        session_id: &str,
        entries: &[MockJsonlEntry],
    ) -> PathBuf { ... }

    /// Adds a sessions-index.json with entries pointing to existing session files.
    fn add_sessions_index(
        &self,
        project_path: &str,
        entries: &[MockIndexEntry],
    ) { ... }

    /// Adds a hook event file for a session.
    fn add_hook_events(
        &self,
        session_id: &str,
        events: &[MockHookEvent],
    ) { ... }

    /// Writes tmux state to the DB (sessions, windows, panes).
    fn set_tmux_state(
        &self,
        sessions: &[Session],
        windows: &[Window],
        panes: &[Pane],
    ) { ... }

    /// Runs one poll cycle and returns all integration rows.
    fn run_poll_cycle(&self) -> Vec<Integration> { ... }
}
```

> NOTE(opus/session-resolution-fix): The `run_poll_cycle` method cannot call `process_claude_pane` directly because that function uses real `/proc` walks for local panes.
> For container panes (the primary failure mode), `/proc` is not involved: resolution uses session file discovery and hook events, both of which are file-based and mockable.
> Local pane tests can use the existing `PaneResolver` trait with a mock implementation.

### Specific Test Cases

#### a. Stale Container Sessions

```rust
#[test]
fn container_pane_cleared_when_no_claude_running() {
    let fix = TestFixture::new();

    // Container session with workspace metadata.
    fix.set_tmux_state(
        &[session_with_container("lace", "lace-container", "/workspaces/lace")],
        &[window("lace", 0, "shell")],
        &[pane("%0", "lace", 0, "nu")],  // current_command is "nu", not "claude"
    );

    // Session file exists but is old (>60s).
    let session_path = fix.add_session_file(
        "/workspaces/lace",
        "session-abc",
        &[assistant_entry("end_turn", "claude-opus-4-6")],
    );
    set_mtime(&session_path, SystemTime::now() - Duration::from_secs(120));

    let integrations = fix.run_poll_cycle();
    assert!(
        integrations.is_empty(),
        "no integration when session file is stale and no claude process"
    );
}
```

The test encodes the expected behavior: when a container pane's `current_command` is not "claude" and the session file mtime exceeds the staleness threshold, no integration should be written.

#### b. Custom Title Resolution

```rust
#[test]
fn container_session_uses_custom_title_from_index() {
    let fix = TestFixture::new();

    fix.set_tmux_state(
        &[session_with_container("lace", "lace-container", "/workspaces/lace")],
        &[window("lace", 0, "shell")],
        &[pane("%0", "lace", 0, "podman")],
    );

    let session_path = fix.add_session_file(
        "/workspaces/lace",
        "session-abc",
        &[assistant_entry_with_slug("end_turn", "claude-opus-4-6", "cuddly-wobbling-shannon")],
    );

    fix.add_sessions_index("/workspaces/lace", &[
        index_entry("session-abc", &session_path, "my-custom-name"),
    ]);

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    let summary: ClaudeSummary = serde_json::from_str(&integrations[0].summary).unwrap();
    assert_eq!(
        summary.session_name.as_deref(),
        Some("my-custom-name"),
        "should use customTitle from sessions-index.json, not slug"
    );
}
```

#### c. State Detection

```rust
#[test]
fn session_with_end_turn_shows_idle() {
    let fix = TestFixture::new();

    fix.set_tmux_state(
        &[session_local("dev")],
        &[window("dev", 0, "editor")],
        &[pane_with_mock_claude("%0", "dev", 0)],
    );

    fix.add_session_file(
        "/home/user/project",
        "session-abc",
        &[
            user_entry(),
            assistant_entry("end_turn", "claude-opus-4-6"),
        ],
    );

    let integrations = fix.run_poll_cycle();
    assert_eq!(integrations.len(), 1);

    let summary: ClaudeSummary = serde_json::from_str(&integrations[0].summary).unwrap();
    assert_eq!(summary.state, "idle", "end_turn should produce idle, not thinking");
}
```

#### d. Duplicate Entry Prevention

```rust
#[test]
fn multiple_panes_same_session_produce_unique_integrations() {
    let fix = TestFixture::new();

    fix.set_tmux_state(
        &[session_with_container("lace", "lace-container", "/workspaces/lace")],
        &[window("lace", 0, "editor")],
        &[
            pane("%0", "lace", 0, "podman"),
            pane("%1", "lace", 0, "podman"),
        ],
    );

    // Both panes resolve to the same project, but hook events distinguish them.
    fix.add_session_file("/workspaces/lace", "session-a", &[
        assistant_entry("end_turn", "claude-opus-4-6"),
    ]);
    fix.add_session_file("/workspaces/lace", "session-b", &[
        assistant_entry("tool_use", "claude-opus-4-6"),
    ]);

    fix.add_hook_events("session-a", &[
        session_start_event("session-a", "/workspaces/lace"),
    ]);
    fix.add_hook_events("session-b", &[
        session_start_event("session-b", "/workspaces/lace"),
    ]);

    let integrations = fix.run_poll_cycle();

    let pane_ids: Vec<&str> = integrations.iter().map(|i| i.pane_id.as_str()).collect();
    let unique_pane_ids: std::collections::HashSet<&str> = pane_ids.iter().copied().collect();
    assert_eq!(
        pane_ids.len(),
        unique_pane_ids.len(),
        "each pane should have at most one integration"
    );
}
```

### Additional Test Cases to Cover

Beyond the four primary bugs, the harness should cover:

| Scenario | Expected Result |
|----------|----------------|
| SessionEnd hook event received | Integration deleted within one poll cycle |
| Session file rotated (new file, higher mtime) | Integration switches to new file's state |
| Hook bridge provides transcript_path | Session file overridden to hook-provided path |
| Container without workspace metadata | No integration (not an error spam) |
| JSONL with `custom-title` entry | Session name uses custom title |
| JSONL with only `agent-name` entry | Session name falls back to agent name |
| Sidechain entries in JSONL | Filtered from state determination |
| Multiple project encodings (bind-mount leakage) | Most recent session file wins |

## Important Design Decisions

**Test at the resolution layer, not the TUI layer.**
The existing `test_render.rs` tests verify TUI rendering from pre-populated DB data.
The new tests verify that the resolution pipeline produces correct DB data from filesystem artifacts.
These are complementary: resolution tests catch data production bugs, render tests catch display bugs.

**Use `tempfile::TempDir` for filesystem mocking, not trait-based I/O abstraction.**
The resolution code reads real files (JSONL, sessions-index.json, hook events).
Creating real temporary files is more faithful than abstracting all I/O behind traits, and avoids a large refactoring effort.
The `/proc` walk is the only path that needs trait-based mocking, and `PaneResolver` already exists for this.

**Separate the poll cycle logic from the daemon loop.**
`run_poll_cycle` in `main.rs` is already a free function that accepts a `Connection` and `HashMap`.
The test harness calls this function directly (or a testable subset of it), bypassing signal handling and sleep.
This requires minor refactoring to make `run_poll_cycle` return integration results rather than writing them directly, or to read them back from the DB after writing.

> NOTE(opus/session-resolution-fix): The simplest approach is "write to in-memory DB, read back."
> `run_poll_cycle` already takes a `&Connection`: pass an in-memory DB, run the cycle, query `process_integrations`.
> No API changes needed.

**Container pane tests do not require `/proc` mocking.**
Container resolution uses file-based strategies (hook events, project directory matching).
The `find_candidate_panes` function selects container panes based on session metadata (container_name + container_workspace), not on `current_command`.
This means the entire container resolution path is testable without `/proc`.

## Edge Cases / Challenging Scenarios

**Race between session file write and poll cycle.**
Claude may be in the middle of writing a JSONL entry when sprack-claude reads the file.
The tail_read approach handles this: partial lines at the read boundary are discarded.
The test harness does not need to simulate this because the mock files are complete.

**Hook event files accumulating indefinitely.**
The `cached_hook_events` vector grows unbounded across the session lifetime.
A `SessionEnd` event clears the cache, but long-running sessions without hooks accumulate.
This is an existing limitation, not a regression: flag in the test harness with a TODO.

**Session cache DB interaction.**
`run_poll_cycle` enriches summaries from the session cache DB (turn counts, tool usage).
The test harness should pass `None` for `cache_connection` to isolate resolution testing from cache behavior, or pass an in-memory cache DB for enrichment tests.

**Concurrent daemon access to DB.**
The test harness uses an in-memory DB: no concurrency issues.
Real-world locking contention between sprack-poll and sprack-claude is a separate concern handled by WAL mode and retry logic.

## Test Plan

### Unit-Level (per-function)

Existing tests cover individual functions.
The proposal does not change these.

### Integration-Level (test harness)

The new test module adds ~12-15 integration tests covering the scenarios listed above.
Each test:
1. Creates a `TestFixture`.
2. Populates mock filesystem and DB state.
3. Calls the resolution pipeline.
4. Asserts on integration row contents (state, session_name, count, absence).

Run via `cargo test --workspace`.

### System-Level (manual verification)

After all integration tests pass, verify against the live system:
1. `cargo build --workspace`
2. Restart sprack-claude daemon.
3. `cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40`
4. Verify: correct session names, correct states, no duplicates, no stale entries.

## Verification Methodology

The proposal establishes a mandatory verification protocol for all future sprack-claude changes:

1. **Write a test case** that captures expected behavior for the change.
   Use the `TestFixture` harness for resolution changes, `test_render.rs` snapshots for display changes.
2. **Implement the fix.**
3. **`cargo test --workspace` passes**, including the new test.
4. **`--dump-rendered-tree` matches expected output** on the real system.
   Compare against a known-good baseline if available.
5. **Only then report "verified."**

This protocol was not in place during the 2026-03-25 and 2026-03-27 fix sessions.
Both sessions reported fixes as "verified" based on a single `--dump-rendered-tree` run that showed improved but not fully correct output.
The verification output in the 2026-03-27 devlog shows duplicate entries (same session appearing twice under one window) and slug-based names: both are bugs that a test harness would have caught.

> WARN(opus/session-resolution-fix): The verification protocol adds overhead to each change.
> This is intentional: the cost of debugging compounding inference bugs exceeds the cost of writing test cases up front.

## Implementation Phases

### Phase 1: Test Harness Infrastructure

Build the `TestFixture` struct and helper functions.

**Files to create/modify:**
- `packages/sprack/crates/sprack-claude/src/test_resolution.rs` (new): test fixture, builder helpers, mock data constructors.

**Scope:**
- `TestFixture::new()`: creates tempdir, opens in-memory DB via `sprack_db::open_test_db()`.
- `add_session_file()`: writes mock JSONL to `claude_home/projects/<encoded_path>/<session_id>.jsonl`.
- `add_sessions_index()`: writes mock `sessions-index.json`.
- `add_hook_events()`: writes mock event files to the event directory.
- `set_tmux_state()`: calls `sprack_db::write::write_tmux_state()`.
- `run_poll_cycle()`: calls `run_poll_cycle()` (requires minor refactoring to accept `claude_home` as a parameter; currently reads from `$HOME`), reads back integrations from DB.
- Mock data constructors: `assistant_entry()`, `user_entry()`, `session_start_event()`, `index_entry()`, etc.

**Refactoring required:**
- Extract `claude_home` as a parameter to `run_poll_cycle` (or make it injectable) so tests can point to a tempdir instead of the real `~/.claude`.
- Extract `event_dirs()` to accept a base path parameter (currently reads `$HOME`).

**Success criteria:** `TestFixture` compiles and a trivial "empty state produces no integrations" test passes.

### Phase 2: Failing Tests for Known Bugs

Write test cases for each known bug (a-d) and the additional scenarios.
All tests should fail against the current codebase, confirming they detect the bugs.

**Files to modify:**
- `packages/sprack/crates/sprack-claude/src/test_resolution.rs`: add ~12 test functions.

**Success criteria:** Tests compile but fail with descriptive assertion messages.

> NOTE(opus/session-resolution-fix): Some tests may pass immediately if the recent fixes already address the scenario.
> This is acceptable: the test still provides regression protection.

### Phase 3: Bug Fixes

Fix each bug until all tests pass.
Expected fixes by bug:

**a. Stale container sessions.**
Tighten the staleness check: when a container pane's `current_command` does not contain "claude" or "podman" (indicating the container session has been repurposed), clear the integration immediately rather than waiting for mtime timeout.
Consider using `SessionEnd` hook events as the primary exit signal, with mtime as a fallback.

**b. Custom title resolution.**
The sessions-index.json lookup in `find_via_sessions_index` resolves `customTitle` for local panes.
For container panes, the fallback path (`find_via_jsonl_listing`) does not have access to the index.
Fix: after `find_best_project_session` resolves a session file, look up its `sessionId` in the corresponding sessions-index.json and extract the `customTitle`.

**c. State detection.**
The periodic tail_read (Fix 1) is a mitigation, not a fix.
The root cause: `incremental_read` returns only new entries, but `last_entries` is replaced wholesale with those new entries.
If the incremental read captures an intermediate `assistant` with `stop_reason: null` but misses the subsequent `end_turn` entry (written between incremental reads), `last_entries` shows "thinking."
Fix: when `incremental_read` returns entries, merge them with the tail of `last_entries` rather than replacing, ensuring the last meaningful entry is always present.
Alternatively, always use `tail_read` (the 32KB window is fast enough at 2-second intervals).

**d. Duplicate entries.**
The core issue: `find_candidate_panes` includes all panes in a container session, and each pane independently resolves to the same session file (the most recent by mtime).
Fix: after resolving all candidate panes, deduplicate by session file path.
If multiple panes resolve to the same file, keep only the first (or use hook event `session_id` to disambiguate when available).

**Success criteria:** `cargo test --workspace` passes with 0 failures, including all new tests.

### Phase 4: Integration Verification

Verify fixes against the live system.

1. `cargo build --workspace`
2. Kill and restart sprack-claude and sprack-poll.
3. Run `cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40`.
4. Verify:
   - Container sessions show custom titles (if set) or slug names (if not).
   - All sessions show correct state (idle for inactive, thinking for active).
   - No duplicate entries for the same session.
   - Stale sessions are cleared within one poll cycle after Claude exits.
5. Capture the `--dump-rendered-tree` output as a baseline for future comparisons.

**Success criteria:** `--dump-rendered-tree` output matches expected layout with correct names, states, and no duplicates.

## Open Questions

1. **Should the test harness also cover `--dump-rendered-tree` output?**
   The harness could populate a DB via the resolution pipeline, then run `render_dump_frame` and snapshot-compare the output.
   This would close the gap between "correct DB data" and "correct display," but adds complexity.
   Recommendation: defer to Phase 5 (future work) unless Phase 4 reveals rendering-specific bugs.

2. **Should `tail_read` replace `incremental_read` entirely?**
   The 32KB tail read takes <1ms on local NVMe.
   The incremental read optimization saves that 1ms but introduces the stale-entry class of bugs.
   The tradeoff may not be worth it.

3. **How should the test harness handle the `event_dirs()` dependency on `$HOME`?**
   Options: (a) override `$HOME` in the test process, (b) make `event_dirs()` accept a base path parameter, (c) use a global test override.
   Recommendation: (b) is cleanest and already partially done via `claude_home` injection.
