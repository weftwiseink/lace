---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T21:30:00-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: wip
tags: [ratatui, testing, verification, mcp, snapshot_testing, rust]
---

# Ratatui Testing and Verification Strategy

> BLUF: ratatui has a mature testing story built on three layers: `TestBackend` for fast unit tests against in-memory buffers, `insta` snapshot testing for visual regression detection, and PTY-based integration testing via `ratatui-testlib` for real terminal behavior.
> For sprack, the recommended pyramid is: (1) unit-test individual widgets and the tree model against `TestBackend`, (2) snapshot-test full-frame renders with `insta`, (3) integration-test the poller-DB-TUI pipeline with in-memory SQLite and `TestBackend` together.
> No ratatui-specific MCP server exists today, but `TestBackend`'s `Display` implementation makes AI-assisted verification viable by rendering frames as plain text strings that can be inspected in-context.
> Style-aware snapshot assertions are an active gap: current snapshots capture text content but not colors.

## TestBackend: The Foundation

`TestBackend` is ratatui's in-memory backend that renders to a `Buffer` instead of a real terminal.
It implements the full `Backend` trait with `Infallible` error type: operations never fail.
This makes it the default choice for all unit-level widget and layout testing.

### Core API

```rust
use ratatui::{backend::TestBackend, Terminal, buffer::Buffer, layout::Rect};

// Create a terminal with an in-memory backend
let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();

// Draw widgets into the backend
terminal.draw(|frame| {
    frame.render_widget(&app, frame.area());
}).unwrap();

// Access the rendered buffer
let backend = terminal.backend();
```

### Assertion Methods

`TestBackend` provides several assertion helpers:

```rust
// Assert the full buffer matches expected content line-by-line
backend.assert_buffer_lines([
    "  HOSTS                     ",
    "  v lace (22425)            ",
    "    v editor                ",
    "      shell (nvim) [*]      ",
]);

// Assert against a constructed Buffer object
let expected = Buffer::with_lines(["expected line 1", "expected line 2"]);
backend.assert_buffer(&expected);

// Assert cursor position
backend.assert_cursor_position((0, 3));

// Assert scrollback state
backend.assert_scrollback_empty();
```

When assertions fail, the error output shows a detailed diff between expected and actual buffer contents, including position markers for divergent cells.

### Buffer and Cell Inspection

For fine-grained assertions, access the `Buffer` directly:

```rust
let buf = terminal.backend().buffer();

// Check a specific cell's content
assert_eq!(buf[(5, 0)].symbol(), "v");

// Check a cell's style
let cell = &buf[(10, 2)];
assert_eq!(cell.fg, Color::Green);
assert_eq!(cell.modifier, Modifier::BOLD);

// Use set_style for constructing expected buffers
let mut expected = Buffer::empty(Rect::new(0, 0, 20, 5));
expected.set_string(2, 0, "HOSTS", Style::default().fg(Color::White).bold());
```

### Widget-Level Testing Pattern

The idiomatic pattern is to render a single widget into a `Buffer` directly, bypassing `Terminal`:

```rust
#[test]
fn test_tree_node_rendering() {
    let area = Rect::new(0, 0, 28, 1);
    let mut buf = Buffer::empty(area);

    let node = TreeNode::new("editor", NodeKind::Window, true);
    node.render(area, &mut buf);

    assert_eq!(buf, Buffer::with_lines(["  v editor                  "]));
}
```

This is faster than constructing a full `Terminal` and is preferred for testing individual widget components.

## Snapshot Testing with insta

The `insta` crate provides snapshot testing: capture a reference output on first run, then assert future runs match it.
This is ratatui's officially recommended approach for visual regression testing.

### Setup

```toml
# Cargo.toml
[dev-dependencies]
insta = "1"
```

```bash
cargo install cargo-insta
```

### Usage

```rust
use insta::assert_snapshot;
use ratatui::{backend::TestBackend, Terminal};

#[test]
fn test_full_frame_render() {
    let app = App::with_test_data();
    let mut terminal = Terminal::new(TestBackend::new(28, 12)).unwrap();

    terminal.draw(|frame| {
        frame.render_widget(&app, frame.area());
    }).unwrap();

    // Captures terminal.backend()'s Display output as the snapshot
    assert_snapshot!(terminal.backend());
}
```

On first run, `insta` creates a `.snap` file under `snapshots/`:

```
---
source: src/tests.rs
expression: terminal.backend()
---
" HOSTS                      "
" v lace (22425)             "
"   v editor                 "
"     shell (nvim) [*]       "
"   > terminal (2)           "
"   > logs                   "
" v dotfiles (22430)         "
"   > editor                 "
"   > shell                  "
" > local                    "
"   scratch (nu)             "
"                            "
```

### Review Workflow

```bash
# Run tests: new/changed snapshots are flagged as pending
cargo test

# Interactive review: accept or reject each change
cargo insta review
```

`cargo insta review` presents a diff for each changed snapshot.
This fits naturally into a PR workflow: reviewers see snapshot diffs in the changeset.

### Limitations

The `TestBackend`'s `Display` implementation renders text content only, not styles or colors.
[Issue #1402](https://github.com/ratatui/ratatui/issues/1402) tracks adding style-aware `Display` output.
A PR (#2099) reportedly addresses this, but it is not yet merged as of this writing.

> NOTE(opus/sprack-tui): For sprack's narrow sidebar (28 cols), text content is the primary correctness signal.
> Style assertions can be added via direct `Cell` inspection in unit tests until style-aware snapshots land.

### Recommended Snapshot Dimensions

Use fixed dimensions matching sprack's actual layout for realistic snapshots:
- Sidebar mode: 28 columns x 24 rows (typical tmux pane height)
- Test a few key heights (12, 24, 40) to verify scroll behavior

## Visual and Recording Tools

Several tools can capture terminal output for visual review outside of automated testing.

### VHS (charmbracelet/vhs)

A scriptable terminal recorder that produces GIFs, MP4s, or plain text output from declarative `.tape` files.

```tape
Output sprack-demo.gif
Set Width 400
Set Height 600
Set FontSize 14

Type "sprack"
Enter
Sleep 2s
Type "j"
Sleep 500ms
Type "j"
Sleep 500ms
Enter
Sleep 2s
```

Key capability for testing: VHS can output `.txt` or `.ascii` files alongside GIFs.
These text captures can be stored as golden files in git and diffed between runs.
A [GitHub Action](https://github.com/charmbracelet/vhs-action) exists for CI integration.

Requirements: `ttyd` and `ffmpeg` must be available.

### termshot

Renders ANSI escape code output into a high-fidelity screenshot image.
Useful for documentation and PR descriptions, less useful for automated testing.

### asciinema

Records terminal sessions as JSON `.cast` files (text + timing, not video).
The `agg` tool converts casts to GIF.
Useful for documentation but not for assertion-based testing.

### Practical Assessment for sprack

VHS is the most useful of these for sprack's purposes:
- `.tape` scripts can exercise navigation flows end-to-end
- Text output provides diffable golden files
- GIF output provides visual review artifacts for PRs
- CI integration is straightforward

However, VHS operates at the process level (spawning the binary), so it tests the full stack including terminal rendering.
It complements rather than replaces `TestBackend`-based testing.

## Integration Testing: The Poller-DB-TUI Pipeline

sprack's multi-process architecture (poller writes SQLite, TUI reads SQLite) requires testing the integration contract.

### Strategy: In-Memory SQLite + TestBackend

The key insight: sprack's components communicate exclusively through SQLite.
This means integration tests can:

1. Create an in-memory SQLite database with the sprack schema
2. Write test fixture data (sessions, windows, panes) directly via `sprack-db`
3. Construct the TUI `App` with that database connection
4. Render into `TestBackend` and assert on the output

```rust
#[test]
fn test_tree_reflects_db_state() {
    // 1. In-memory DB with schema
    let db = sprack_db::open_memory().unwrap();
    sprack_db::init_schema(&db).unwrap();

    // 2. Insert test fixtures
    sprack_db::insert_session(&db, &Session {
        name: "editor".into(),
        attached: true,
        lace_port: Some(22425),
        ..Default::default()
    }).unwrap();
    sprack_db::insert_pane(&db, &Pane {
        session: "editor".into(),
        window: "main".into(),
        command: "nvim".into(),
        active: true,
        ..Default::default()
    }).unwrap();

    // 3. Build app from DB
    let app = App::from_db(&db).unwrap();

    // 4. Render and assert
    let mut terminal = Terminal::new(TestBackend::new(28, 12)).unwrap();
    terminal.draw(|f| f.render_widget(&app, f.area())).unwrap();

    terminal.backend().assert_buffer_lines([
        " HOSTS                      ",
        " v lace (22425)             ",
        "   v editor                 ",
        "     main (nvim) [*]        ",
        // ...
    ]);
}
```

This tests the full data path (DB read, tree construction, rendering) without spawning separate processes.

### Testing data_version Change Detection

The `PRAGMA data_version` polling loop can be tested by:

1. Opening two connections to the same file-based (not in-memory) temp DB
2. Writing from connection A
3. Asserting that the TUI's change-detection logic (reading `data_version` from connection B) triggers a refresh

```rust
#[test]
fn test_data_version_change_detection() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");

    let writer = sprack_db::open(&db_path).unwrap();
    let reader = sprack_db::open(&db_path).unwrap();
    sprack_db::init_schema(&writer).unwrap();

    let v1 = sprack_db::data_version(&reader).unwrap();
    sprack_db::insert_session(&writer, &test_session()).unwrap();
    let v2 = sprack_db::data_version(&reader).unwrap();

    assert_ne!(v1, v2, "data_version should change after external write");
}
```

> NOTE(opus/sprack-tui): In-memory SQLite (`":memory:"`) uses a private cache, so `PRAGMA data_version` does not increment across connections.
> File-based temp databases are required for testing cross-connection change detection.

### Testing the Poller

`sprack-poll` can be tested by:

1. Mocking tmux output: inject canned `list-panes` output instead of calling `tmux`
2. Running the poller's parse-and-write logic against an in-memory DB
3. Asserting the DB contents match expected state

The tmux interface should be behind a trait so tests can substitute a mock:

```rust
trait TmuxSource {
    fn list_panes(&self) -> Result<Vec<PaneInfo>>;
    fn show_options(&self, session: &str) -> Result<SessionOptions>;
}

struct RealTmux;        // calls tmux CLI
struct MockTmux { ... } // returns canned data
```

## MCP Server for Ratatui

No ratatui-specific MCP server exists as of this writing.
Web searches for "ratatui mcp server" and "terminal ui mcp" return only tangentially related projects:

- **mcp-probe**: a TUI *built with* ratatui for debugging MCP servers (not an MCP server for ratatui)
- **nereid**: a Mermaid diagram tool combining a ratatui TUI with an MCP server (domain-specific, not generalizable)

### Why This Matters Less Than Expected

The absence of a ratatui MCP server is less of a gap than it initially appears, for two reasons:

1. **TestBackend's Display output is plain text.**
   An AI agent can read snapshot files or `TestBackend` output directly.
   The text representation of sprack's tree is semantically meaningful (not just pixel data), so an agent can reason about correctness without visual rendering.

2. **The sprack architecture decouples data from presentation.**
   An agent can query the SQLite database directly to verify data correctness, then check that the rendered output matches via snapshots.
   This is more reliable than trying to interact with a live TUI through an MCP bridge.

### Future Possibility

A generic "terminal viewport MCP tool" that reads a tmux pane's content via `capture-pane` could provide live TUI inspection.
This is not ratatui-specific and would work for any TUI running in tmux:

```bash
tmux capture-pane -t %42 -p  # prints pane content as plain text
```

This could be wrapped as an MCP tool for development-time AI verification.

## ratatui's Own Testing Patterns

The ratatui project itself uses these patterns:

1. **Widget unit tests**: render a widget into a `Buffer` directly, assert with `assert_eq!(buf, expected)`.
   This is the dominant pattern in the ratatui source for testing built-in widgets like `List`, `Table`, `Paragraph`.

2. **Separation of logic and rendering**: application state mutation is tested independently of widget rendering.
   The ratatui documentation explicitly recommends defining state-mutation methods on the `App` struct rather than inlining them in event handlers.

3. **Fixed-size buffers**: all tests use deterministic terminal dimensions.
   Widget behavior at boundary sizes (0-width, 1-row) is explicitly tested.

4. **Debug widget state**: the ratatui docs describe a pattern for toggling debug overlays in the TUI itself, rendering widget state as text for visual inspection during development.

## CI/CD Considerations

### ratatui Tests Run Headless

`TestBackend` requires no terminal, no PTY, no display server.
Standard `cargo test` works in any CI environment (GitHub Actions, etc.) without special setup.

Snapshot tests with `insta` also run headlessly: they compare text strings, not rendered pixels.

### CI Configuration for sprack

```yaml
# .github/workflows/test.yml (illustrative)
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --workspace
```

No special dependencies needed for unit and snapshot tests.

For VHS-based visual tests (optional):

```yaml
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: charmbracelet/vhs-action@v2
        with:
          path: tests/tapes/demo.tape
```

### Snapshot Review in PRs

Configure `insta` to fail CI when snapshots are pending review:

```toml
# .config/insta.yaml (or insta.yaml at project root)
behavior:
  unsorted_maps: true
  # Fail in CI if snapshots need updating
  update_mode: no
```

This ensures that snapshot changes are intentional and reviewed.

## Recommended Testing Pyramid for sprack

### Layer 1: Unit Tests (TestBackend + Buffer assertions)

**What**: individual widgets, tree node rendering, layout calculations, state mutations.
**How**: render to `Buffer` directly, assert with `assert_buffer_lines` or `assert_eq`.
**Coverage target**: all widget variants, edge cases (empty tree, single node, deep nesting, long names, narrow widths).

This is the bulk of the test suite.
Fast (sub-millisecond per test), no I/O, deterministic.

### Layer 2: Snapshot Tests (insta)

**What**: full-frame renders of the complete TUI at key states.
**How**: render `App` into `TestBackend`, `assert_snapshot!`.
**Coverage target**: initial empty state, populated tree, expanded/collapsed states, cursor at various positions, search filter active.

Snapshots serve as visual regression guards.
They catch unexpected layout shifts that cell-level assertions might miss.

### Layer 3: Integration Tests (SQLite + TestBackend)

**What**: the data pipeline from DB fixtures through tree construction to rendered output.
**How**: in-memory SQLite with test data, construct `App`, render to `TestBackend`.
**Coverage target**: DB schema contract, tree construction from DB rows, `data_version` change detection, host grouping logic.

### Layer 4: Poller Tests (Mock tmux + SQLite assertions)

**What**: `sprack-poll`'s parse-and-write logic.
**How**: mock `TmuxSource` trait, run poller logic, assert DB contents.
**Coverage target**: format string parsing, session option extraction, hash-based skip logic, heartbeat writes.

### Optional: VHS Visual Tests

**What**: end-to-end visual verification of the running binary.
**How**: `.tape` files exercising navigation, text output as golden files.
**When**: for documentation, PR review artifacts, or periodic visual audits. Not required for every CI run.

## Sources

- [TestBackend API docs](https://docs.rs/ratatui/latest/ratatui/backend/struct.TestBackend.html)
- [ratatui snapshot testing recipe](https://ratatui.rs/recipes/testing/snapshots/)
- [ratatui testing overview](https://ratatui.rs/recipes/testing/)
- [ratatui rendering under the hood](https://ratatui.rs/concepts/rendering/under-the-hood/)
- [ratatui-testlib](https://lib.rs/crates/ratatui-testlib)
- [insta snapshot testing](https://insta.rs/)
- [ratatui issue #1402: style-aware Display](https://github.com/ratatui/ratatui/issues/1402)
- [VHS terminal recorder](https://github.com/charmbracelet/vhs)
- [termshot](https://github.com/homeport/termshot)
- [asciinema](https://asciinema.org/)
- [sprack design overview](2026-03-21-sprack-design-overview.md)
