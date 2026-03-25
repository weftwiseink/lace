---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T16:30:00-07:00
task_list: terminal-management/sprack-verifiability
type: proposal
state: live
status: wip
tags: [sprack, testing, container, verification, architecture]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:00:00-07:00
  round: 1
---

# sprack Verifiability Strategy

> BLUF(opus/sprack-verifiability): Sprack's 76 tests are all unit-level.
> No tests exercise tmux interaction, `/proc` walking, session file discovery, TUI rendering, or the poll-DB-TUI pipeline.
> Container-boundary features (process host awareness, bind mount resolution) are untestable from inside the development container by definition.
> This proposal introduces four testing tiers: unit (existing), integration (mock tmux + synthetic filesystems), container-boundary (trait-abstracted mocks + fixture-based path translation), and TUI snapshot (ratatui TestBackend).
> Cross-container end-to-end scenarios remain manual-only; the strategy invests in mock fidelity to minimize the manual gap.

## Objective

Close the testing gaps identified in the [verifiability analysis report](../reports/2026-03-24-sprack-verifiability-analysis.md) with a pragmatic, tiered approach that:

1. Automates everything testable inside the development container.
2. Uses trait abstractions and synthetic fixtures to simulate container-boundary scenarios.
3. Establishes TUI snapshot testing for visual regression detection.
4. Accepts that true cross-container end-to-end testing is manual-only and defines a runbook for it.

## Testing Tiers

### Tier 1: Unit Tests (Existing)

76 tests covering data structures, parsing, DB round-trips, layout math, tree building.
No changes needed.
These remain the foundation and run in `cargo test` with no external dependencies.

### Tier 2: Integration Tests (New)

Tests that exercise real external dependencies available inside the container.

#### 2A: Mock tmux Server

Start a real tmux server on an isolated socket for testing.

```rust
fn with_test_tmux<F: FnOnce(&str)>(f: F) {
    let socket = format!("sprack-test-{}", std::process::id());
    // start tmux: tmux -L $socket new-session -d -s test
    // create windows/panes as needed
    f(&socket);
    // kill server: tmux -L $socket kill-server
}
```

Requirements:
- Four function signatures change to accept `socket: Option<&str>`, threading `-L socket` to the tmux CLI:
  `tmux_command()` (private helper), `query_tmux_state()`, `query_lace_options()`, and `read_lace_option()`.
- Tests create sessions with known names, panes with known commands, and verify the parse pipeline produces correct `TmuxSnapshot` output.
- Lace metadata tests: `tmux -L $socket set-option -t test @lace_port 22427` then verify `query_lace_options()` reads it.
- Use a `Drop`-based RAII guard for tmux server cleanup to prevent leaked servers on test panics:

```rust
struct TestTmuxServer { socket: String }
impl Drop for TestTmuxServer {
    fn drop(&mut self) {
        let _ = Command::new("tmux").args(["-L", &self.socket, "kill-server"]).output();
    }
}
```

Test count estimate: 8-12 tests covering session/window/pane lifecycle, lace metadata, edge cases (special characters in names, dead panes, zoomed panes).

#### 2B: Synthetic `~/.claude` Directory

Create temp directory trees matching Claude Code's project directory structure.

```
$TMPDIR/claude-test/
  projects/
    -workspaces-lace-main/
      sessions-index.json
      session-abc.jsonl
      session-def.jsonl
    -workspaces-lace-feature/
      session-ghi.jsonl
```

The `session.rs` functions (`find_session_file`, `find_via_sessions_index`, `find_via_jsonl_listing`) already accept `project_dir: &Path` and do not need parameterization.
The real refactoring target is `resolve_session_for_pane()` in `sprack-claude/src/main.rs`, which constructs the project directory path by reading `$HOME` directly and joining `.claude/projects/{encoded_path}`.
This function needs a `claude_home: &Path` parameter (or an injected configuration struct) so tests can point it at a temp directory.

The dependency injection flows as follows:
1. `resolve_session_for_pane(pane, claude_home)` receives the base path.
2. It constructs `claude_home.join("projects").join(&encoded_path)`.
3. It passes the resulting `project_dir` to `session::find_session_file()` (unchanged).

Tests create temp directory trees matching Claude Code's project directory structure and pass the temp root as `claude_home`.

Tests verify:
- `find_session_file()` selects the most recently modified `.jsonl` file.
- `find_via_sessions_index()` parses the index and resolves paths.
- Prefix-matching enumeration (process host awareness) selects the right subdirectory.
- Rotation handling: truncate a session file, verify re-discovery.
- End-to-end `resolve_session_for_pane()` with injected `claude_home` and mocked `/proc` (via `ProcFs` trait).

Test count estimate: 6-8 tests.

#### 2C: `/proc` Walking (Same Namespace)

Spawn a child process with a known command, walk `/proc` from the parent PID, verify the child is found.

The current `find_claude_pid(shell_pid: u32)` hardcodes the "claude" cmdline match.
For testability, refactor to accept a predicate: `find_process_pid(shell_pid: u32, matcher: impl Fn(&str) -> bool)`.
The production caller passes `|cmdline| cmdline.contains("claude")`.
Tests can match on any command string.

```rust
#[test]
fn finds_child_process() {
    let child = Command::new("sleep").arg("60").spawn().unwrap();
    let found = find_process_pid(child.id(), |cmdline| cmdline.contains("sleep"));
    assert_eq!(found, Some(child.id()));
    child.kill().unwrap();
}
```

> NOTE(opus/sprack-verifiability): The predicate refactoring also benefits production code: it decouples the walk algorithm from the specific process being searched for, enabling reuse for non-Claude integrations.

This validates the walk algorithm within a single namespace.
The cross-namespace case is handled by Tier 3 mocks.

Test count estimate: 3-5 tests (direct child, nested grandchild, no match, dead process).

### Tier 3: Container-Boundary Tests (New, Mock-Based)

Tests that simulate cross-container scenarios using trait abstractions and fixtures.
These cannot exercise real container boundaries but verify the logic that would handle them.

#### 3A: ProcFs Trait Abstraction

Extract `/proc` interaction into a trait:

```rust
pub trait ProcFs {
    fn children(&self, pid: u32) -> Option<Vec<u32>>;
    fn cmdline(&self, pid: u32) -> Option<String>;
    fn cwd(&self, pid: u32) -> Option<PathBuf>;
}

pub struct RealProcFs;
impl ProcFs for RealProcFs { /* reads /proc */ }

pub struct MockProcFs {
    processes: HashMap<u32, MockProcess>,
}
impl ProcFs for MockProcFs { /* returns from in-memory tree */ }
```

`find_claude_pid` (renamed `find_process_pid` per Tier 2C) and `read_process_cwd` become generic over `impl ProcFs`.

`RealProcFs::children()` implements the `task/<tid>/children` fallback: it first tries `/proc/{pid}/children`, then falls back to `/proc/{pid}/task/{pid}/children`.
This fallback logic is itself tested via a dedicated test that mocks the primary path as missing.

Tests construct `MockProcFs` trees that simulate:
- Cross-namespace boundary (parent has no visible children).
- Primary children path absent, fallback `task/<tid>/children` path present.
- Process with target cmdline match at various tree depths.

Test count estimate: 5-7 tests.

#### 3B: Path Translation Fixtures

Unit tests for the path resolution chain with container/host path pairs:

```rust
#[test]
fn container_workspace_resolves_to_host_session_dir() {
    let lace_workspace = "/workspaces/lace";
    let host_claude_home = "/home/mjr/.claude";
    // Simulates: container Claude writes to -workspaces-lace-main
    // Host sprack resolves via bind mount
    let encoded = encode_project_path("/workspaces/lace/main");
    let expected = PathBuf::from(host_claude_home)
        .join("projects")
        .join(&encoded);
    assert_eq!(expected.to_str().unwrap(),
        "/home/mjr/.claude/projects/-workspaces-lace-main");
}
```

Test workspace prefix matching, multiple worktree disambiguation, and the `sessions-index.json` `fullPath` mismatch scenario.

Test count estimate: 4-6 tests.

#### 3C: PaneResolver Dispatch Tests (Contingent on Process Host Awareness)

> NOTE(opus/sprack-verifiability): This tier depends on the process host awareness proposal being implemented.
> The `PaneResolver` trait, `LaceContainerResolver`, and `LocalResolver` do not exist in the current codebase.
> The current resolution logic is a single code path in `resolve_session_for_pane()` that walks `/proc` and reads `$HOME`.
> These tests become actionable only after the resolver dispatch abstraction is introduced.

Test the `PaneResolver` trait dispatch logic once implemented:
- Pane with `lace_port` set: dispatches to `LaceContainerResolver`.
- Pane without `lace_port` and `current_command` containing "claude": dispatches to `LocalResolver`.
- Pane without `lace_port` and `current_command` not containing "claude": skipped.

These are pure logic tests on the classification function.

Test count estimate: 4-5 tests (deferred until resolver dispatch exists).

### Tier 4: TUI Snapshot Tests (New)

Use ratatui's `TestBackend` to render frames and assert on buffer contents.

#### 4A: Rendering Snapshots

A `test_app()` helper factory creates an `App` with an in-memory SQLite DB (via `sprack_db::open_db(None)`) and no `own_pane_id`, reducing boilerplate across all TUI tests:

```rust
fn test_app() -> App {
    let db = sprack_db::open_db(None).unwrap();
    App::new(db, None)
}

#[test]
fn renders_session_tree() {
    let backend = TestBackend::new(80, 24);
    let mut terminal = Terminal::new(backend).unwrap();
    let mut app = test_app();
    // Populate tree items directly for rendering tests
    app.tree_items = build_test_tree();
    terminal.draw(|f| render::render_frame(f, &mut app)).unwrap();
    let buffer = terminal.backend().buffer();
    insta::assert_snapshot!(buffer_to_string(buffer));
}
```

> NOTE(opus/sprack-verifiability): `refresh_from_db()` hardcodes `LayoutTier::Standard` for label construction.
> Tier-specific snapshot tests verify layout geometry changes (panel splits, area sizing) across tiers, but label content is always Standard-tier.
> To test tier-specific label formatting, either parameterize `refresh_from_db()` or test `build_tree()` directly with explicit tier arguments.

Snapshots cover:
- Empty state (no tmux data).
- Single session with multiple panes.
- Layout geometry at each tier (Compact, Standard, Wide, Full) via different `TestBackend` widths.
- Selected node highlighting.
- Stale heartbeat indicator.

> NOTE(opus/sprack-verifiability): The `insta` crate provides snapshot testing with automatic reference file management.
> Snapshots are stored as `.snap` files alongside tests and updated with `cargo insta review`.
> This is the standard approach for ratatui TUI testing.

Test count estimate: 8-12 tests.

#### 4B: Input Handling

`handle_key` and `handle_mouse` are pure functions on `App` state.
Test that key events produce expected state transitions:

```rust
#[test]
fn j_moves_selection_down() {
    let mut app = app_with_tree();
    handle_key(&mut app, KeyCode::Char('j'));
    assert_eq!(app.tree_state.selected(), vec![/* expected node */]);
}
```

Test count estimate: 10-15 tests covering all keybindings and mouse events.

## Container-Boundary Manual Validation Runbook

For scenarios that cannot be automated, a manual validation runbook:

### Prerequisites

- Host tmux server running.
- At least one lace devcontainer running with Claude Code active.
- sprack compiled and available on host.

### Checklist

1. **Container pane detection**: Run `sprack` on host. Verify panes connected to containers show Claude status (not "ssh").
2. **Multiple containers**: Start a second lace container. Verify both containers' Claude panes show independent summaries.
3. **Session file resolution**: Verify the session file path shown in the detail pane matches the actual `.jsonl` file under `~/.claude/projects/`.
4. **Bind mount path**: Verify that session files written by container-Claude are accessible from the host via the `~/.claude` bind mount.
5. **Mixed session**: Create a session with both local and container panes. Verify each pane type resolves correctly.
6. **Container restart**: Stop and restart a container. Verify sprack detects the state change.
7. **Stale summary**: Kill Claude Code in a container. Verify the summary shows staleness after the timeout period.

## Implementation Phases

### Phase 1: Mock Infrastructure (Foundation)

- Extract `ProcFs` trait from `proc_walk.rs`.
- Refactor `find_claude_pid` to `find_process_pid` with predicate parameter.
- Add `socket: Option<&str>` parameter to 4 tmux functions (`tmux_command`, `query_tmux_state`, `query_lace_options`, `read_lace_option`).
- Add `claude_home: &Path` parameter to `resolve_session_for_pane()` in `sprack-claude/src/main.rs`.
- Add `insta` dev-dependency for snapshot testing.
- Write 3-5 smoke tests per category to validate the mock infrastructure.

Estimated total new tests across all phases: ~60-80.
Expected additional `cargo test` runtime: ~20-30 seconds (dominated by tmux server startup in Tier 2A).

Deliverable: the abstractions exist and are proven by a small number of tests.
The existing 76 tests continue passing with no behavior change.

### Phase 2: Integration and Boundary Tests

- Write full Tier 2 integration tests (mock tmux server, synthetic `~/.claude`, `/proc` walking).
- Write full Tier 3 boundary mock tests (ProcFs mocks, path fixtures, resolver dispatch).
- Write manual validation runbook as a markdown file in the repo.

Deliverable: ~30-40 new automated tests covering the integration and boundary layers.
Manual runbook documented for cross-container scenarios.

### Phase 3: TUI Snapshot Tests

- Add `TestBackend` rendering snapshots for key visual states.
- Add input handling tests for all keybindings.
- Integrate `insta` snapshot review into the development workflow.

Deliverable: ~20-25 new tests.
Visual regressions are detectable via snapshot diffs.

## Test Infrastructure Requirements

### Dependencies

```toml
[dev-dependencies]
insta = { version = "1", features = ["redactions"] }
tempfile = "3"
```

### CI Considerations

All Tier 1-4 tests run in `cargo test` inside the devcontainer.
No special CI environment needed.
The devcontainer image already has tmux installed, which is the only external dependency.

Cross-container tests (manual runbook) are not automated in CI.
If CI is introduced later, a multi-container test job using Docker-in-Docker could automate some scenarios, but the cost-benefit is low given the small number of manual checks.

## Interaction with Other Proposals

| Proposal | Testing Impact |
|----------|---------------|
| Process host awareness | Tier 3A (ProcFs trait) and Tier 3B (path fixtures) test boundary logic. Tier 3C (PaneResolver dispatch) is contingent on this proposal introducing the resolver abstraction. Tier 2B (synthetic `~/.claude`) tests bind-mount session discovery. Manual runbook validates end-to-end. |
| Inline summaries | Tier 4A snapshots verify inline rendering at each tier. New format strings are tested via snapshot comparison. |
| Layout organization | Tier 2A (mock tmux) tests spatial field parsing. Tier 4A snapshots verify sorted pane order. |
| tmux IPC migration | Tier 2A must be updated if the tmux interaction layer changes. The socket parameter approach works with both raw `Command` and `tmux-interface-rs`. |
| Session cache | Tier 2B (synthetic `~/.claude`) tests cache ingestion. Existing unit tests in `jsonl.rs` extend to cover incremental byte-offset tracking. |

## Open Risks

1. **Mock fidelity**: Mock `/proc` trees and synthetic `~/.claude` directories may not capture all real-world edge cases (permission issues, symlinks, race conditions). Mitigated by the manual runbook for scenarios that matter most.

2. **Snapshot brittleness**: TUI snapshots break on any visual change, including intentional redesigns. Mitigated by `insta`'s review workflow: `cargo insta review` shows diffs and allows batch approval.

3. **tmux version sensitivity**: Mock tmux server tests run against the container's tmux version. Different tmux versions may produce different output for edge cases. Mitigated by the tmux-interface-rs migration (defers version handling to the library).

4. **Test execution time**: Integration tests that start tmux servers add ~1-2 seconds per test. With 8-12 tmux tests, this adds ~15-20 seconds to the test suite. Acceptable for the current scale. Tests should share a single tmux server per test module where possible.

5. **Abstraction cost**: Introducing testability abstractions changes several production code surfaces: `ProcFs` trait (3 methods), tmux socket parameterization (4 functions: `tmux_command`, `query_tmux_state`, `query_lace_options`, `read_lace_option`), `claude_home` injection in `resolve_session_for_pane`, and the predicate refactoring of `find_claude_pid` to `find_process_pid`. The total scope is moderate but each change is narrow and replaces a hard-coded default with a parameterized alternative. The production call sites pass the defaults, so runtime behavior is unchanged.
