---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-22T00:00:00-07:00
task_list: terminal-management/sprack-implementation
type: devlog
state: live
status: wip
tags: [sprack, implementation, rust, ratatui, tmux, sqlite]
---

# sprack Implementation

> BLUF: This devlog guides the implementation of sprack, a tmux sidecar TUI, from scaffold through working prototype.
> Three phases: A (sprack-db + sprack-poll, unit-testable), B (sprack TUI, iterative visual), C (sprack-claude, exploratory).
> The Cargo workspace at `packages/sprack/` is scaffolded and builds clean.
> The implementation manager should drive subagents through each phase, verifying at each step, and keep iterating until Phase B produces a solid working tmux interface.


## Environment

Verified 2026-03-22:
- Rust 1.94.0, clippy, rustfmt, rust-analyzer
- tmux 3.3a, sqlite3 3.40.1
- Cargo workspace at `packages/sprack/` builds clean (4 crates: sprack-db, sprack-poll, sprack, sprack-claude)
- Git bare repo with worktree layout at `/workspaces/lace/` (main worktree at `/workspaces/lace/main`)

## Reference Documents

| Document | Path | Role |
|----------|------|------|
| **Sequencing roadmap** | `cdocs/proposals/2026-03-21-sprack-design-refinements.md` | Phase definitions, verification strategy, exit criteria |
| **sprack-db spec** | `cdocs/proposals/2026-03-21-sprack-db.md` | Schema, types, query helpers, 14 tests |
| **sprack-poll spec** | `cdocs/proposals/2026-03-21-sprack-poll.md` | tmux parsing, hash diff, SIGUSR1, daemon lifecycle |
| **sprack TUI spec** | `cdocs/proposals/2026-03-21-sprack-tui-component.md` | Responsive layout, tree widget, input, navigation |
| **sprack-claude spec** | `cdocs/proposals/2026-03-21-sprack-claude.md` | Session file reading, status extraction, JSONL parsing |
| **Rust style guide** | `cdocs/reports/2026-03-21-sprack-rust-style-guide.md` | Naming, function decomposition, error handling, testing |
| **Widget ecosystem** | `cdocs/reports/2026-03-21-ratatui-widget-ecosystem.md` | tui-tree-widget, catppuccin, composition patterns |
| **Responsive layout** | `cdocs/reports/2026-03-21-ratatui-responsive-layout-patterns.md` | Constraint system, breakpoints, mouse support |
| **Testing strategy** | `cdocs/reports/2026-03-21-ratatui-testing-and-verification.md` | TestBackend, insta, VHS, integration testing |
| **Architecture roadmap** | `cdocs/proposals/2026-03-21-sprack-tmux-sidecar-tui.md` | High-level architecture, resolved decisions |

## Worktree Strategy

The repo uses a bare-repo worktree layout.
Create feature worktrees for implementation phases to isolate work:

```bash
# From the bare repo root
cd /workspaces/lace
git worktree add sprack-phase-a main  # or from the current branch
```

Subagents can use `isolation: "worktree"` to get isolated copies automatically.
For the implementation manager, consider one worktree per phase to keep main clean.

## Phase A: Foundation (sprack-db + sprack-poll)

### Phase A Checklist

- [ ] **A1**: sprack-db schema implementation (5 tables, `init_schema`)
- [ ] **A2**: sprack-db types (`Session`, `Window`, `Pane`, `Integration`, `ProcessStatus`, `DbSnapshot`)
- [ ] **A3**: sprack-db connection management (`open_db`, `open_db_readonly`, WAL verification)
- [ ] **A4**: sprack-db write helpers (`write_tmux_state`, `write_heartbeat`, `write_integration`)
- [ ] **A5**: sprack-db read helpers (`read_full_state`, `check_data_version`, `read_heartbeat`, `read_integrations`)
- [ ] **A6**: sprack-db tests (14 tests per proposal)
- [ ] **A7**: sprack-poll tmux CLI parsing (`TmuxSource` trait, format string, `\x1f` delimiter)
- [ ] **A8**: sprack-poll `to_db_types` mapping
- [ ] **A9**: sprack-poll hash-based diff
- [ ] **A10**: sprack-poll main loop + heartbeat
- [ ] **A11**: sprack-poll SIGUSR1 handling (`signal-hook`)
- [ ] **A12**: sprack-poll daemon lifecycle (PID file, SIGTERM, tmux server detection)
- [ ] **A13**: sprack-poll tests (14 tests per proposal)
- [ ] **A14**: Integration test: poll writes to file DB, read back via sprack-db
- [ ] **A15**: Manual validation: `sprack-poll` running, `sqlite3 state.db "SELECT * FROM sessions"` shows data
- [ ] **A16**: `cargo clippy` clean, `cargo fmt -- --check` clean

### Phase A Subagent Templates

#### A-Part1: sprack-db (tasks A1-A6)

```
Implement sprack-db, the shared SQLite library crate for the sprack project.

## Context
Read these files BEFORE writing any code:
- cdocs/proposals/2026-03-21-sprack-db.md (THE SPEC - follow it closely)
- cdocs/reports/2026-03-21-sprack-rust-style-guide.md (naming, structure, error handling conventions)
- packages/sprack/crates/sprack-db/src/lib.rs (current scaffold - replace the placeholder)
- packages/sprack/crates/sprack-db/Cargo.toml (dependencies already configured)

## What to build
The sprack-db proposal is the authoritative spec. Implement it faithfully:

1. Module structure: lib.rs (re-exports, open_db), schema.rs (CREATE TABLE), types.rs (structs/enums), write.rs, read.rs, error.rs
2. Five tables: sessions, windows, panes, process_integrations, poller_heartbeat
3. Types: Session, Window, Pane, Integration, ProcessStatus (6 variants: Thinking, ToolUse, Idle, Error, Waiting, Complete), DbSnapshot
4. All types derive Debug, Clone, PartialEq, Eq. Session/Window/Pane also derive Hash.
5. open_db() with WAL verification (return WalActivationFailed if not "wal")
6. open_db_readonly() for TUI read-only access
7. Write helpers: write_tmux_state (DELETE CASCADE + INSERT all), write_heartbeat, write_integration
8. Read helpers: read_full_state, check_data_version, read_heartbeat, read_integrations
9. Error type: SprackDbError with Sqlite, Io, InvalidStatus, WalActivationFailed variants
10. 14 unit tests (see Test Plan in the proposal)

## Style
- Follow the Rust style guide strictly: semantic names, small functions, early returns, no deep nesting
- Doc comments on all public items
- One concern per module
- Public API at top of file, private helpers below

## Validation
Run these and fix any issues:
- cargo test -p sprack-db (all 14 tests pass)
- cargo clippy -p sprack-db (no warnings)
- cargo fmt -- --check (clean)
```

#### A-Part2: sprack-poll (tasks A7-A15)

```
Implement sprack-poll, the tmux state poller daemon for the sprack project.

## Context
Read these files BEFORE writing any code:
- cdocs/proposals/2026-03-21-sprack-poll.md (THE SPEC - follow it closely)
- cdocs/reports/2026-03-21-sprack-rust-style-guide.md (naming, structure conventions)
- packages/sprack/crates/sprack-poll/Cargo.toml (dependencies)
- packages/sprack/crates/sprack-db/src/ (the library you'll use for DB access)

## What to build
The sprack-poll proposal is the authoritative spec:

1. Module structure: main.rs (entry, daemon lifecycle), tmux.rs (TmuxSource trait, CLI parsing), diff.rs (hash-based diff)
2. TmuxSource trait: abstraction over tmux CLI for testability. Real impl shells out, test impl returns canned output.
3. Format string: tmux list-panes -a -F with \x1f delimiters, 12 format variables
4. Parse output into internal structs, then to_db_types() maps to sprack-db types
5. Hash-based diff: hash raw tmux output, skip DB write on match. BUT always re-read lace options.
6. Main loop: poll -> parse -> diff -> write -> heartbeat -> wait_for_signal(interval)
7. SIGUSR1 via signal-hook (not tokio): immediate re-poll on signal
8. Daemon lifecycle: PID file at ~/.local/share/sprack/poll.pid, SIGTERM/SIGINT shutdown, tmux server detection
9. Lace metadata: per-session show-options for @lace_port, @lace_user, @lace_workspace
10. Tests: 14 tests per proposal (parsing, diff, round-trip via TmuxSource mock)

## Integration validation
After unit tests pass:
1. cargo build -p sprack-poll
2. Start sprack-poll manually: ./target/debug/sprack-poll
3. In another terminal: sqlite3 ~/.local/share/sprack/state.db "SELECT * FROM sessions"
4. Create a new tmux session, verify it appears in the DB within 1-2 seconds
5. Kill sprack-poll, verify PID file is cleaned up

## Validation
- cargo test -p sprack-poll (all tests pass)
- cargo clippy -p sprack-poll (no warnings)
- cargo fmt -- --check (clean)
- Manual: sprack-poll writes live tmux state to SQLite
```

### Phase A Review Checklist

After Phase A subagents complete:

1. [ ] `cargo test --workspace` passes (all tests across all crates)
2. [ ] `cargo clippy --workspace` clean
3. [ ] `cargo fmt -- --check` clean
4. [ ] sprack-db: 14+ tests covering schema, round-trips, CASCADE, data_version, WAL
5. [ ] sprack-poll: 14+ tests covering parsing, diff, heartbeat
6. [ ] Manual: `sprack-poll` writes live tmux state to `~/.local/share/sprack/state.db`
7. [ ] Manual: `sqlite3 state.db "SELECT * FROM sessions"` shows current tmux sessions
8. [ ] Code review: naming follows style guide, small functions, no deep nesting
9. [ ] No `.unwrap()` in library code, `.expect()` only in main.rs with clear messages

## Phase B: TUI Shell (sprack)

### Phase B Checklist

- [ ] **B1**: Basic tree rendering from `DbSnapshot` using `tui-tree-widget`
- [ ] **B2**: Layout tier system (Compact/Standard/Wide/Full breakpoints)
- [ ] **B3**: Keyboard input (j/k/h/l/space/enter/q)
- [ ] **B4**: Mouse input (click select, double-click focus, scroll)
- [ ] **B5**: tmux navigation on Enter/double-click (`switch-client`, `select-window`, `select-pane`)
- [ ] **B6**: Self-filtering via `$TMUX_PANE`
- [ ] **B7**: Container grouping by `@lace_port`
- [ ] **B8**: Daemon auto-start of sprack-poll
- [ ] **B9**: Catppuccin theme, ProcessStatus colors
- [ ] **B10**: `TestBackend` + `insta` snapshot tests for each tier
- [ ] **B11**: Manual validation: run sprack in tmux, navigate tree, verify tmux focus changes
- [ ] **B12**: `cargo clippy` clean, `cargo fmt -- --check` clean

### Phase B Subagent Template

```
Implement the sprack TUI binary, the user-facing tree view for tmux sessions.

## Context
Read these files BEFORE writing any code:
- cdocs/proposals/2026-03-21-sprack-tui-component.md (THE SPEC)
- cdocs/reports/2026-03-21-ratatui-widget-ecosystem.md (widget composition, catppuccin)
- cdocs/reports/2026-03-21-ratatui-responsive-layout-patterns.md (constraints, breakpoints)
- cdocs/reports/2026-03-21-sprack-rust-style-guide.md (code conventions)
- cdocs/reports/2026-03-21-ratatui-testing-and-verification.md (TestBackend, insta)
- packages/sprack/crates/sprack-db/src/ (the library you read from)
- packages/sprack/crates/sprack-poll/src/ (writes data you consume)

## What to build
1. App struct with tui-tree-widget TreeState, DbSnapshot, layout tier, connection
2. Main loop: 50ms tick, check data_version, rebuild tree on change, handle input events
3. Tree: HostGroup > TmuxSession > TmuxWindow > TmuxPane, built from DbSnapshot
4. Each node: styled Spans (not ASCII >/v, use tui-tree-widget's configurable symbols)
5. Four layout tiers: Compact (<30), Standard (30-59), Wide (60-99), Full (100+)
6. Wide/Full: tree + detail panel (Paragraph in bordered Block)
7. Input: j/k/h/l/space/enter/q via TreeState methods, mouse via click_at()
8. Enter/double-click: build tmux command from selected NodeId, execute via Command::status()
9. Self-filter: exclude $TMUX_PANE from tree
10. Container grouping: group sessions by @lace_port
11. Daemon launcher: check PID files, spawn sprack-poll if missing, setsid() for detach
12. Theme: catppuccin mocha colors for ProcessStatus states

## Critical: widget composition, not ASCII art
Use tui-tree-widget's node_open_symbol("▼ "), node_closed_symbol("▶ "), highlight_style().
Use Span::styled() for per-node colored text.
Use Block::bordered() with titles for panels.
See the widget ecosystem report for concrete code patterns.

## Iterative development
This crate needs visual iteration. Build incrementally:
1. First: render any tree from test data, verify with TestBackend
2. Then: read from real DB, render real tmux state
3. Then: add keyboard navigation
4. Then: add tmux focus commands
5. Then: add responsive layout tiers
6. Then: add mouse support
7. Then: add container grouping and visual polish

At each step, run sprack in tmux and verify visually.

## Validation
- cargo test -p sprack (snapshot tests pass)
- cargo clippy -p sprack (no warnings)
- Manual: run sprack in a tmux pane, verify tree shows sessions/windows/panes
- Manual: press Enter on a pane, verify tmux focuses that pane
- Manual: resize the pane, verify layout tier changes
```

### Phase B Review Checklist

1. [ ] `cargo test --workspace` passes
2. [ ] `cargo clippy --workspace` clean
3. [ ] Tree renders real tmux state from SQLite DB
4. [ ] j/k navigates, h/l collapses/expands, Space toggles, Enter focuses in tmux
5. [ ] Mouse click selects, double-click focuses, scroll works
6. [ ] Layout adapts across widths (try 25, 40, 70, 120 cols)
7. [ ] Container sessions grouped under host groups
8. [ ] sprack-poll auto-starts when sprack launches
9. [ ] Self-filtering: sprack's own pane not in tree
10. [ ] Catppuccin colors applied, active pane highlighted

### Phase B Iteration Protocol

Phase B requires human visual feedback. After initial implementation:

1. Run `sprack` in a tmux pane
2. Take notes on visual issues (alignment, truncation, colors, responsiveness)
3. Fix issues, rebuild, re-run
4. Repeat until the tree view is solid and all navigation works correctly
5. Only then move to Phase C

> WARN(opus/sprack-implementation): Do not skip visual verification in Phase B.
> TestBackend validates structure but not aesthetics.
> A working TUI that looks wrong is not a working TUI.

## Phase C: Claude Integration (sprack-claude)

### Phase C Checklist

- [ ] **C1**: Pane detection (`current_command LIKE '%claude%'`)
- [ ] **C2**: PID walk (`/proc/<pid>/children`, `/proc/<pid>/cwd`)
- [ ] **C3**: Path encoding (cwd to `~/.claude/projects/<encoded>/` directory)
- [ ] **C4**: Session discovery via `sessions-index.json` (with non-recursive fallback)
- [ ] **C5**: JSONL tail-reading (seek to end, read backward)
- [ ] **C6**: Status extraction (activity state, subagent count, context %, last tool, model)
- [ ] **C7**: Qualitative summary (task list extraction from TaskCreate/TaskUpdate entries)
- [ ] **C8**: DB writes to `process_integrations`
- [ ] **C9**: TUI detail panel renders integration data
- [ ] **C10**: Daemon lifecycle (PID file, auto-start from TUI)
- [ ] **C11**: Tests for JSONL parsing, path encoding, status extraction
- [ ] **C12**: Manual: panes running Claude show status in sprack tree

### Phase C Subagent Template

```
Implement sprack-claude, the Claude Code summarizer for the sprack project.

## Context
Read these files BEFORE writing any code:
- cdocs/proposals/2026-03-21-sprack-claude.md (THE SPEC)
- cdocs/reports/2026-03-21-sprack-rust-style-guide.md (code conventions)
- packages/sprack/crates/sprack-db/src/ (shared types, write_integration)
- packages/sprack/crates/sprack/src/ (TUI reads integrations for display)

## What to build
1. Module structure: main.rs (daemon loop), resolve.rs (pane-to-session mapping), parse.rs (JSONL reading), status.rs (metric extraction)
2. Pane detection: query panes table for current_command containing "claude"
3. PID walk: /proc/<pid>/children recursive, find claude process, read /proc/<pid>/cwd
4. Path encoding: replace / with - to derive ~/.claude/projects/<encoded>/
5. Session discovery: parse sessions-index.json (filter sidechains), fallback to non-recursive .jsonl listing
6. JSONL tail-reading: seek to end, read 8KB chunks backward, parse last N entries
7. Status extraction: activity state, subagent count (heuristic), context %, last tool, model
8. Qualitative summary: extract TaskCreate/TaskUpdate tool_use entries for task progress
9. Write ClaudeSummary as JSON to process_integrations.summary field
10. Daemon: PID file, 2s poll interval, SIGTERM shutdown

## Key detail: qualitative summaries
The primary value is not "thinking vs idle" - it's "what is Claude working on?"
Extract task lists from TaskCreate/TaskUpdate tool_use blocks in the JSONL.
Surface: current task subject, completed/total count, in-progress task.

## Validation
- cargo test -p sprack-claude (parsing, encoding, status extraction tests)
- cargo clippy -p sprack-claude (no warnings)
- Manual: run sprack-claude while this Claude session is active
- Manual: check sqlite3 state.db "SELECT * FROM process_integrations"
- Manual: verify sprack TUI shows Claude status in tree and detail panel
```

## Progress Log

Update this section as implementation proceeds.

### [date]: Phase A started

TODO(opus/sprack-implementation): Update as work proceeds.
