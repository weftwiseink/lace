---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T19:45:00-07:00
task_list: terminal-management/sprack-tui
type: proposal
state: live
status: wip
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T21:00:00-07:00
  round: 1
tags: [sprack, responsive_layout, input_model, claude_integration, daemon, sequencing, testing]
---

# sprack Implementation Roadmap and Design Refinements

> BLUF: This document is the implementation sequencing roadmap for sprack.
> Three phases, each with a distinct verification strategy: Phase A builds the tmux+DB foundation (unit-testable), Phase B builds the ratatui TUI with iterative visual feedback, Phase C adds the Claude Code detail panel (exploratory, qualitative summaries).
> Design refinements (responsive layout, widget composition, input model, daemon behavior) are inlined at the phase where they become relevant.

## Implementation Sequencing

### Phase A: Foundation (tmux + DB)

**Goal**: sprack-poll writes tmux state to SQLite, verifiable with `cargo test`.

**Crates built**: `sprack-db`, `sprack-poll`

**Work**:
1. Initialize Cargo workspace at `packages/sprack/`
2. Implement `sprack-db`: schema, `open_db`/`open_db_readonly`, typed query helpers, `DbSnapshot`
3. Implement `sprack-poll`: tmux CLI parsing, `to_db_types` mapping, hash-based diff, heartbeat writes
4. Wire SIGUSR1 handling with `signal-hook`
5. Add tmux hooks to `tmux.conf`

**Verification**: standard `cargo test`.
- sprack-db: in-memory SQLite, schema creation, round-trip read/write, CASCADE, `data_version` detection (14 tests)
- sprack-poll: mock tmux output via `TmuxSource` trait, verify parsing and DB writes (14 tests)
- Integration: temp-file SQLite, sprack-poll writes, verify `read_full_state` returns correct data

**Exit criteria**: `sprack-poll` running as a daemon, writing tmux state to `~/.local/share/sprack/state.db`, observable with `sqlite3 state.db "SELECT * FROM sessions"`.

### Phase B: TUI Shell (iterative visual)

**Goal**: tree view renders from DB, keyboard + mouse input works, tmux navigation works.

**Crates built**: `sprack` (TUI binary)

**Work**:
1. Basic tree rendering from `DbSnapshot` using `tui-tree-widget`
2. Responsive layout: breakpoint-based tier selection (compact/standard/wide/full)
3. Keyboard input (j/k/h/l/space/enter/q) via `tui-tree-widget`'s `TreeState` methods
4. Mouse input (click to select, double-click to focus, scroll)
5. tmux navigation commands on Enter/double-click
6. Self-filtering ($TMUX_PANE exclusion)
7. Container grouping by `@lace_port`
8. Daemon auto-start of sprack-poll
9. Visual styling: catppuccin theme, node state colors

**Verification**: layered approach.
- **Unit**: `TestBackend` rendering to buffer, `insta` snapshot tests for each layout tier. Validates tree structure, node ordering, text content. Does not validate visual polish.
- **Visual iteration**: run sprack in tmux, human reviews rendering, we iterate. This is the primary feedback loop for Phase B.
- **VHS scripts**: `.tape` files that produce GIF recordings and diffable text output. Useful for regression testing and async review.
- **Integration**: in-memory SQLite populated with test data, `TestBackend` renders the full frame, snapshot-compare.

> NOTE(opus/sprack-refinements): No ratatui MCP server exists.
> The decoupled SQLite architecture helps: data correctness is testable independently of rendering.
> Visual polish requires human-in-the-loop iteration.

**Exit criteria**: sprack renders a navigable tree, clicking/pressing Enter focuses panes in tmux, responsive layout adapts across widths.

### Phase C: Detail Panel + Claude Integration (exploratory)

**Goal**: Claude Code status visible in the tree and detail panel, with qualitative task summaries.

**Crates built**: `sprack-claude`

**Work**:
1. Pane-to-session-file resolution (PID walk, `sessions-index.json`)
2. JSONL tail-reading and status extraction
3. Process integration DB writes
4. TUI detail panel rendering (wide/full tiers)
5. Qualitative summary extraction (see below)

**Verification**: unit tests for JSONL parsing and status extraction, manual review of rendered summaries.

**Exit criteria**: Claude Code panes show colored status in the tree, detail panel shows task summary when selected.

## Widget Composition

sprack's UI is composed from ratatui's widget system, not hand-drawn ASCII characters.
See the [widget ecosystem report](../reports/2026-03-21-ratatui-widget-ecosystem.md) for the full catalog.

### Tree: `tui-tree-widget`

The tree widget handles collapse/expand indicators via configurable symbols:
```rust
let tree = Tree::new(&items)?
    .block(Block::bordered().title(" sprack "))
    .node_closed_symbol("▶ ")
    .node_open_symbol("▼ ")
    .node_no_children_symbol("  ")
    .highlight_style(Style::new().bold().on_dark_gray());
```

Each tree node is a styled `Text` built from `Span`s:
```rust
// A pane node with colored status indicator
let spans = vec![
    Span::styled("editor", Style::new().white()),
    Span::raw(" "),
    Span::styled("nvim", Style::new().dark_gray()),
    Span::raw(" "),
    Span::styled("●", Style::new().yellow().bold()), // thinking indicator
];
TreeItem::new("pane-%42", Line::from(spans))?
```

This replaces the ASCII mockups from earlier proposals.
The widget handles indentation, scrolling, and collapse state internally.

### Layout: `Block` + `Constraint`

```rust
fn render_frame(f: &mut Frame, app: &App) {
    let tier = LayoutTier::from_width(f.area().width);

    match tier {
        LayoutTier::Compact | LayoutTier::Standard => {
            // Tree only, full width
            let tree_area = f.area();
            render_tree(f, tree_area, app);
        }
        LayoutTier::Wide | LayoutTier::Full => {
            // Tree + detail panel
            let [tree_area, detail_area] = Layout::horizontal([
                Constraint::Min(25),
                Constraint::Fill(1),
            ]).areas(f.area());
            render_tree(f, tree_area, app);
            render_detail(f, detail_area, app, tier);
        }
    }
}
```

### Detail Panel: `Paragraph` in `Block`

The detail panel uses `Paragraph` with styled `Line`s inside a bordered `Block`:
```rust
fn render_detail(f: &mut Frame, area: Rect, app: &App, tier: LayoutTier) {
    let block = Block::bordered()
        .title(" detail ")
        .border_type(BorderType::Rounded);

    let lines = match &app.selected_integration {
        Some(integration) => build_detail_lines(integration, tier),
        None => vec![Line::from("Select a node".dark_gray())],
    };

    f.render_widget(Paragraph::new(lines).block(block), area);
}
```

### Theme: Catppuccin

The `catppuccin` crate's `ratatui` feature provides colors directly:
```rust
use catppuccin::MOCHA;

fn status_style(status: &ProcessStatus) -> Style {
    match status {
        ProcessStatus::Thinking => Style::new().fg(MOCHA.colors.yellow.into()).bold(),
        ProcessStatus::ToolUse  => Style::new().fg(MOCHA.colors.teal.into()).bold(),
        ProcessStatus::Idle     => Style::new().fg(MOCHA.colors.green.into()),
        ProcessStatus::Error    => Style::new().fg(MOCHA.colors.red.into()).bold(),
        ProcessStatus::Waiting  => Style::new().fg(MOCHA.colors.overlay0.into()),
        ProcessStatus::Complete => Style::new().fg(MOCHA.colors.surface1.into()),
    }
}
```

## Responsive Layout Tiers

| Tier | Width | Tree | Detail Panel | Status Display |
|------|-------|------|-------------|----------------|
| **Compact** | <30 cols | Truncated names, `●` status dots | None | Single colored dot per integration |
| **Standard** | 30-59 cols | Full names, inline `[thinking]` badges | None | Short status badge after node label |
| **Wide** | 60-99 cols | Full names + status | Summary lines | Process summary, path, last tool |
| **Full** | 100+ cols | Full names + status | Expanded detail | Task summary, subagent list, context %, model |

Each tier is a distinct render function, not parameterized scaling.
Tier selection is a single `match` on `area.width` at the top of the render loop.

## Input Model

### Keyboard

Six keys plus quit:

| Key | Action | `tui-tree-widget` method |
|-----|--------|-------------------------|
| `j` / `k` | Move cursor down / up | `tree_state.key_down()` / `key_up()` |
| `h` | Collapse or move to parent | `tree_state.key_left()` |
| `l` | Expand or move to first child | `tree_state.key_right()` |
| `Space` | Toggle collapse/expand | `tree_state.toggle_selected()` |
| `Enter` | Focus selected node in tmux | custom: build tmux command from `NodeId` |
| `q` | Quit | exit event loop |

### Mouse

| Action | Behavior |
|--------|----------|
| Left click on node | Select (move cursor, update detail panel) |
| Double-click on node | Focus in tmux (equivalent to Enter) |
| Left click on collapse indicator | Toggle collapse/expand |
| Scroll up/down | Scroll tree view |

Click-to-select uses `tui-tree-widget`'s `click_at(position)` method.
Double-click detection requires a timing-based state machine (~300ms threshold) since crossterm does not emit double-click events natively.

## Claude Code Integration: Qualitative Summaries

The primary value of the Claude integration is not "thinking vs idle" status dots.
It is: **what is Claude working on, and how is it going?**

### Summary Tiers

| Tier | Example |
|------|---------|
| Compact | `●` (yellow = active) |
| Standard | `[refactoring auth]` |
| Wide | `refactoring auth middleware (3/7 tasks, 42% ctx)` |
| Full | Task: refactor auth middleware. Progress: 3/7 tasks done. Current: implementing JWT validation. 3 subagents active. 42% context. |

### Data Sources for Qualitative Summary

1. **Task list**: Claude Code's `TaskCreate`/`TaskUpdate` entries in the JSONL. Extract the current task list, count completed vs total, surface the in-progress task subject.
2. **Custom title**: Claude Code's `custom-title` entries in the JSONL. These are user-visible session titles that often describe the work.
3. **Agent names**: `agent-name` entries provide names for subagent sessions.
4. **Last user message**: the most recent `user` entry's content gives context for what was asked.

> NOTE(opus/sprack-refinements): Task list extraction from JSONL is straightforward: filter for entries where `message.content` contains `tool_use` blocks with `name: "TaskCreate"` or `name: "TaskUpdate"`, parse the input parameters.
> This gives us structured task data without needing an LLM summarizer.

### Future: Summary Agent

For deeper qualitative summaries (e.g., "Claude is struggling with a type mismatch in the auth module"), a small LLM summarizer could periodically read the last N exchanges and produce a one-line summary.
This is deferred: the JSONL-based approach provides sufficient quality for Phase C.

## Daemon Auto-Start

The `sprack` binary auto-starts companion daemons on launch.
See [sprack-tui proposal](2026-03-21-sprack-tui-component.md) for implementation details.

On launch:
1. Check PID files in `~/.local/share/sprack/`
2. Validate PIDs (process exists, correct binary via `/proc`)
3. Spawn missing daemons with `setsid()` for process group detachment
4. Start TUI

On quit: TUI exits, daemons continue running.

Configuration in `~/.config/sprack/config.toml`:
```toml
[poll]
interval_ms = 1000
db_path = "~/.local/share/sprack/state.db"

[summarizers]
enabled = ["claude"]

[claude]
poll_interval_ms = 2000
session_dir = "~/.claude/projects"
```

## Testing Strategy

| Phase | Primary Verification | Tools |
|-------|---------------------|-------|
| A (Foundation) | Unit tests, integration tests | `cargo test`, in-memory SQLite, mock `TmuxSource` |
| B (TUI) | Snapshot tests + human visual review | `TestBackend` + `insta`, VHS tape scripts, manual tmux iteration |
| C (Claude) | Unit tests for parsing + manual summary review | `cargo test` for JSONL parsing, manual review of rendered summaries |

See the [testing and verification report](../reports/2026-03-21-ratatui-testing-and-verification.md) for detailed tool analysis.

### TestBackend + insta (Phase B)

```rust
#[test]
fn test_compact_tier_renders_tree() {
    let backend = TestBackend::new(28, 20);
    let mut terminal = Terminal::new(backend).unwrap();
    let app = App::with_test_data(); // pre-populated DbSnapshot

    terminal.draw(|f| render_frame(f, &app)).unwrap();

    insta::assert_snapshot!(terminal.backend());
}
```

Snapshot files capture text content (not colors/styles).
Style assertions require direct `Buffer` cell inspection for critical cases (e.g., "thinking indicator is yellow").

## Related Documents

| Document | Role |
|----------|------|
| [sprack Roadmap](2026-03-21-sprack-tmux-sidecar-tui.md) | High-level architecture, resolved decisions |
| [sprack-db](2026-03-21-sprack-db.md) | Component: shared SQLite library |
| [sprack-poll](2026-03-21-sprack-poll.md) | Component: tmux poller daemon |
| [sprack-tui](2026-03-21-sprack-tui-component.md) | Component: TUI binary |
| [sprack-claude](2026-03-21-sprack-claude.md) | Component: Claude Code summarizer |
| [Widget Ecosystem Report](../reports/2026-03-21-ratatui-widget-ecosystem.md) | Widget catalog, composition patterns, catppuccin |
| [Responsive Layout Report](../reports/2026-03-21-ratatui-responsive-layout-patterns.md) | Constraint system, breakpoint patterns |
| [Testing Report](../reports/2026-03-21-ratatui-testing-and-verification.md) | TestBackend, insta, VHS, integration testing |
