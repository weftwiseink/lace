---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T00:00:00-07:00
task_list: terminal-management/sprack-render-testability
type: proposal
state: live
status: implementation_accepted
tags: [sprack, testing, ratatui, verifiability]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:00:00-07:00
  round: 1
---

# sprack Render Testability

> BLUF(opus/sprack-render-testability): Sprack has 119 tests but zero rendering tests.
> Three bugs that prevented integration data from displaying went undetected because `render_frame`, tree building with integrations, and the detail panel are never tested programmatically.
> This proposal introduces two features: (1) insta snapshot tests using ratatui's `TestBackend` covering `render_frame`, `build_tree`, and `render_detail_panel` at each `LayoutTier`, and (2) a `--dump-rendered-tree` CLI flag that renders a single frame to stdout and exits, enabling agent-driven iteration and CI smoke tests.

## Objective

Add programmatic render testing to sprack so that visual regressions and data-flow bugs (like integrations not reaching the renderer) are caught by `cargo test`.
Provide a `--dump-rendered-tree` CLI mode that produces a text snapshot of the TUI for agent and CI consumption without requiring a terminal.

## Background

The [sprack verifiability strategy](2026-03-24-sprack-verifiability-strategy.md) identified TUI snapshot testing as Tier 4 and outlined the approach at a high level.
During a troubleshooting session, three bugs were discovered that prevented `process_integrations` data from ever being rendered in the tree or detail panel.
All three went undetected because no test exercises the render pipeline with integration data.

The bugs were:

1. `DbSnapshot.integrations` was not populated by the read query.
2. `build_tree` label formatting never received integration data because the snapshot was stale.
3. The detail panel's `find_selected_pane_id` early-returned `None` when no node was selected, hiding the problem.

Each of these is a data-flow issue: the correct types exist, the rendering functions are correct in isolation, but the pipeline connecting DB data to rendered output was broken.
Snapshot tests that construct a complete `App` state with integrations and assert on rendered output would catch all three.

## Proposed Solution

### Feature 1: TestBackend + insta Snapshot Tests

Add a `#[cfg(test)]` module in the sprack crate with tests that:

1. Create an `App` with an in-memory SQLite connection (via `sprack_db`'s schema init pattern).
2. Populate the DB with synthetic tmux state including `process_integrations` rows containing `ClaudeSummary` JSON.
3. Build the tree via `App::refresh_from_db()` (or by calling `build_tree` directly with the snapshot).
4. Create a `Terminal<TestBackend>` at a specific width/height.
5. Call `render_frame` and capture the buffer.
6. Assert on the buffer contents using `insta::assert_snapshot!`.

Tests cover each `LayoutTier`:

| Tier | Width | Detail Panel | Key assertions |
|------|-------|-------------|----------------|
| Compact | 25 cols | No | Truncated labels, single-char status icons |
| Standard | 50 cols | No | Status badges, inline summary suffix |
| Wide | 80 cols | No | Dimensions, badges, inline suffix |
| Full | 120 cols | Yes | Detail panel with model, context%, tasks, error_message |

### Feature 2: `--dump-rendered-tree` CLI Flag

A new CLI mode that renders a single frame to stdout and exits:

```
sprack --dump-rendered-tree [--cols 80] [--rows 24] [--db-path /path/to/db]
```

Implementation: skip `setup_terminal` (no raw mode, no alternate screen, no mouse capture), create `Terminal<TestBackend>` at the specified dimensions, run `refresh_from_db`, call `render_frame`, convert the buffer to a string, print to stdout, and exit.

This enables:
- Agent-driven troubleshooting: an agent can run `sprack --dump-rendered-tree` and inspect the output without needing a real terminal.
- CI smoke tests: `sprack --dump-rendered-tree --db-path test-fixtures/state.db | grep "thinking"`.
- Width regression testing: render at each tier width and diff against known-good output.

## Important Design Decisions

### In-memory SQLite over `App::new_for_test`

Two approaches were considered for constructing test `App` state:

**(a) `App::new_for_test(snapshot: DbSnapshot)`**: bypass the DB entirely, populate `App` fields directly.
This is simpler but skips the DB-to-App pipeline, which is exactly where the bugs were.

**(b) In-memory SQLite via `open_test_db` pattern**: create a real `Connection`, write synthetic data with `sprack_db::write::*`, then call `refresh_from_db`.
This exercises the full read pipeline: `read_full_state` -> `build_tree` -> `render_frame`.

Option (b) is preferred because it tests the pipeline that was broken.
The existing `open_test_db()` helper in `sprack-db/src/lib.rs` provides the pattern: `Connection::open_in_memory()` + `schema::init_schema()`.

`App::refresh_from_db()` is currently private.
Tests that exercise the full DB-to-render pipeline need it to be `pub(crate)` at minimum.
This is a minor visibility change with no API impact outside the crate.

> NOTE(opus/sprack-render-testability): `open_test_db` is currently `#[cfg(test)]` and private to `sprack-db`.
> The sprack crate needs its own equivalent, or `open_test_db` should be exposed as a public test utility.
> Exposing it is cleaner: add `pub fn open_test_db() -> Connection` behind `#[cfg(test)]` or behind a `test-support` feature flag.
> A feature flag is preferred because `#[cfg(test)]` items are only visible within the same crate.

### `refresh_from_db` hardcodes `LayoutTier::Standard` for label construction

`App::refresh_from_db()` calls `build_tree(&snapshot, own_pane_id, LayoutTier::Standard)`, meaning tree labels are always built at Standard tier regardless of terminal width.
The actual tier is computed at render time for layout geometry (panel splits, area sizing), but label content is fixed.

For snapshot tests, this means:
- Tests that vary `TestBackend` width verify layout geometry changes (detail panel presence, area allocation) but not tier-specific label formatting.
- To test tier-specific labels, call `build_tree` directly with an explicit tier argument and assert on the tree items.
- Both approaches are valuable and should be included.

### Buffer-to-string conversion

ratatui's `Buffer` does not implement `Display`.
A helper function converts the buffer to a plain-text string for snapshot comparison:

```rust
fn buffer_to_string(buffer: &Buffer) -> String {
    let area = buffer.area;
    let mut output = String::new();
    for y in area.y..area.y + area.height {
        for x in area.x..area.x + area.width {
            let cell = &buffer[(x, y)];
            output.push_str(cell.symbol());
        }
        output.push('\n');
    }
    output
}
```

> NOTE(opus/sprack-render-testability): This strips ANSI styling.
> Style assertions (correct catppuccin colors for status badges) would require a style-aware comparison.
> Plain-text snapshots are sufficient for detecting data-flow bugs (the primary goal).
> Style testing can be added later if visual regressions become a problem.

### `--dump-rendered-tree` does not start the event loop

The CLI flag creates an `App`, calls `refresh_from_db`, renders one frame, and exits.
It does not call `App::run()` (which enters the event loop and requires crossterm).
This means:
- No raw mode, no alternate screen, no mouse capture.
- No heartbeat checking (the poller status may show as stale).
- The rendered output is a single point-in-time snapshot of DB state.

### Integration test fixture data

Test fixtures include `ClaudeSummary` JSON in the integration `summary` field to verify:
- Inline labels show model, context%, subagent count.
- Detail panel renders structured Claude data (model, status, context, tasks, errors).
- The `parse_claude_summary` -> rendering pipeline works end-to-end.

A minimal fixture:

```rust
let claude_summary = serde_json::json!({
    "state": "thinking",
    "model": "claude-opus-4-6",
    "subagent_count": 2,
    "context_percent": 45,
    "last_tool": "Read",
    "tasks": [
        {"subject": "Fix rendering", "status": "InProgress"},
        {"subject": "Add tests", "status": "Completed"}
    ],
    "session_purpose": "sprack TUI development"
});
```

## Test Plan

### Snapshot Tests (Feature 1)

#### Empty state
- Render at 80x24 with no DB data.
- Assert: status bar present, tree area empty, "Select a pane to view details" in detail area (at Full tier).

#### Single session with integration data
- Write one session, one window, one pane, one `claude_code` integration with `ClaudeSummary` JSON.
- Render at each tier width (25, 50, 80, 120 cols).
- Assert: pane label includes status badge and inline summary at Standard/Wide/Full.
- Assert at Full tier: detail panel renders model, context%, subagent count, tasks.

#### Multi-session tree structure
- Write two sessions (one local, one with `lace_port`), multiple windows and panes.
- Assert: host groups render, sessions are grouped correctly, tree hierarchy is correct.

#### Selected node highlighting
- Set `tree_state` to select a specific pane.
- Assert: the selected pane has highlight styling applied.
- Assert at Full tier: detail panel shows that pane's integration data.

#### Stale poller indicator
- Set `poller_healthy = false` on the App.
- Assert: status bar shows "[poller: not started]" or "[poller: stale ...]".

#### `build_tree` with explicit tier arguments
- Call `build_tree` directly at each `LayoutTier` with the same `DbSnapshot`.
- Render the resulting tree items.
- Assert: label content differs between tiers (truncation lengths, presence of dimensions, PID, path).

#### Integration error state
- Write an integration with `ProcessStatus::Error` and an `error_message` in `ClaudeSummary`.
- Assert at Full tier: detail panel renders the error message with unhealthy styling.

### `--dump-rendered-tree` Tests (Feature 2)

- Unit test: verify the render-once path produces non-empty output.
- Integration test: run the binary with `--dump-rendered-tree --db-path <test-db>` and assert stdout contains expected session names.

## Verification Methodology

1. All snapshot tests pass with `cargo test -p sprack`.
2. `cargo insta review` shows clean diffs when snapshots change intentionally.
3. `sprack --dump-rendered-tree --cols 120 --rows 30` produces readable output matching the interactive TUI's visual structure.
4. Re-introduce one of the original three bugs (e.g., remove integration data from the snapshot) and verify at least one snapshot test fails.

## Implementation Phases

### Phase 1: Snapshot Tests

**Scope**: Add `insta` dev-dependency to the sprack crate, expose `open_test_db` from `sprack-db`, implement `buffer_to_string` helper, write snapshot tests.

**Tasks**:

1. Add `insta = { workspace = true }` to `crates/sprack/Cargo.toml` under `[dev-dependencies]`.
2. Add a `test-support` feature to `crates/sprack-db/Cargo.toml` that exposes `open_test_db()` as a public function.
   Alternatively, duplicate the 4-line helper in the sprack crate's test module.
3. Create `crates/sprack/src/test_render.rs` as a `#[cfg(test)]` module with:
   - `buffer_to_string(buffer: &Buffer) -> String` helper.
   - `test_app_with_data()` factory that creates an `App` with synthetic DB data including integrations.
   - Snapshot tests for empty state, single session, multi-session, each tier, selected node, stale poller, error state.
4. Create `crates/sprack/src/snapshots/` directory for insta snapshot files.
5. Run `cargo test -p sprack` and `cargo insta review` to approve initial snapshots.

**Success criteria**:
- 8-12 new snapshot tests pass.
- Removing integration data from the test fixture causes at least one test to fail.
- `cargo insta review` correctly shows diffs for intentional changes.
- Existing 119 tests continue passing.

### Phase 2: `--dump-rendered-tree` CLI Flag

**Scope**: Add the `--dump-rendered-tree` CLI mode with `--cols` and `--rows` arguments.

**Tasks**:

1. Extract `parse_db_path_arg` into a general arg parser (or add manual `--dump-rendered-tree`, `--cols`, `--rows` parsing alongside the existing `--db-path`).
2. Add a `render_once_to_stdout(db: Connection, cols: u16, rows: u16)` function that:
   - Creates `App::new(db, None)`.
   - Calls `refresh_from_db()`.
   - Creates `Terminal<TestBackend>::new(cols, rows)`.
   - Calls `terminal.draw(|f| render_frame(f, &mut app))`.
   - Converts buffer to string via `buffer_to_string`.
   - Prints to stdout.
3. Wire the flag into `main()`: if `--dump-rendered-tree` is present, call `render_once_to_stdout` instead of `setup_terminal` + `App::run`.
4. Default `--cols` to 80, `--rows` to 24.

**Success criteria**:
- `cargo run -p sprack -- --dump-rendered-tree --db-path <path>` prints a text frame and exits with code 0.
- No raw mode or alternate screen artifacts in the output.
- `--cols 120` produces output with a detail panel; `--cols 50` does not.
- Output is pipe-friendly: `sprack --dump-rendered-tree | head -5` works without hanging.
