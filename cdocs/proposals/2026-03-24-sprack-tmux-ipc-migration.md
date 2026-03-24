---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T12:00:00-07:00
task_list: terminal-management/sprack-tmux-ipc
type: proposal
state: live
status: request_for_proposal
tags: [architecture, tmux, sprack, future_work]
---

# RFP: Sprack Tmux IPC Migration

> BLUF(opus/sprack-tmux-ipc): Sprack's tmux integration shells out to `tmux list-panes -a -F` with `||`-delimited format strings and parses stdout line-by-line on a 1-second poll loop.
> This works but has known fragility: delimiter collisions, format string parsing, tmux version sensitivity, and unnecessary polling when tmux can push state changes.
> This RFP explores migrating to `tmux-interface-rs` (typed Rust bindings), tmux control mode (`-C` flag, event-driven), or a hybrid of both.

## Objective

Replace sprack-poll's `std::process::Command`-based tmux interaction with a more robust integration layer that provides:

1. **Structured output**: Typed Rust representations of tmux state instead of string parsing with fragile delimiters.
2. **Event-driven updates**: Push-based notification of state changes instead of poll-sleep-poll.
3. **Better error handling**: Typed errors from a library instead of stderr string matching.
4. **Version resilience**: A maintained library that tracks tmux version differences instead of hardcoded format strings.

## Current Architecture

Sprack's tmux interaction spans two crates.

### sprack-poll (the daemon)

`sprack-poll/src/tmux.rs` defines a `TMUX_FORMAT` constant with 12 fields delimited by `||` (double pipe).
The `query_tmux_state()` function shells out to `tmux list-panes -a -F` and returns raw stdout.
`parse_tmux_output()` splits each line on `||` and builds a hierarchical `TmuxSnapshot` (sessions, windows, panes).
A separate function `query_lace_options()` runs `tmux show-options -qvt` per session to read lace metadata.

The main loop in `sprack-poll/src/main.rs` runs this query on a 1-second interval, hashes the raw output to detect changes, and writes to SQLite only when state differs.
SIGUSR1 from tmux hooks can trigger an immediate poll cycle.

### sprack (the TUI)

`sprack/src/tmux.rs` shells out to `tmux switch-client`, `select-window`, and `select-pane` for navigation.
These are fire-and-forget commands that chain tmux subcommands with `;`.

### Known Fragilities

- **Delimiter choice**: `||` was chosen because tmux 3.3a converts non-printable characters (including `\x1f` unit separator) to underscores.
  Double pipe is unlikely in session names but not impossible.
  A user naming a session `foo||bar` would break parsing.
- **Format string coupling**: The 12-field `TMUX_FORMAT` constant and `EXPECTED_FIELD_COUNT` must stay in sync manually.
  Adding or removing a field requires coordinated changes across the format string, the parser, and the `ParsedLine` struct.
- **Tmux version sensitivity**: Format variable names and behaviors can change across tmux versions.
  The code has no version detection or conditional format strings.
- **Per-session option queries**: `query_lace_options()` runs three `tmux show-options` commands per session, sequentially.
  With many sessions, this creates a burst of subprocesses per poll cycle.
- **Polling overhead**: Even with hash-based change detection, the daemon spawns `tmux list-panes` every second.
  Tmux control mode can push notifications on state change, eliminating unnecessary work.

## Candidate Approaches

### Approach A: tmux-interface-rs

[tmux-interface-rs](https://github.com/AntonGepting/tmux-interface-rs) is a Rust library for communicating with tmux via CLI.
It wraps tmux commands in typed Rust structs and provides builder-pattern APIs for constructing commands.

**What it provides:**

- Typed command builders for `list-panes`, `list-sessions`, `list-windows`, `show-options`, etc.
- Parsed output structures for common commands.
- Feature flags for tmux version compatibility.
- Maintained crate (latest: 0.3.2 on crates.io).

**What it does not provide (likely):**

- Control mode support: the library communicates via CLI subcommands, not the `-C` protocol.
- Event-driven notifications: still requires polling.

**Migration path:**

- Replace `Command::new("tmux")` calls with `tmux_interface` API calls.
- Replace manual `||`-delimited parsing with the library's output parsing.
- Keep the existing poll loop architecture.

**Risk**: If the library's output parsing does not cover all 12 format variables sprack needs (e.g., `pane_pid`, `pane_dead`), custom format strings may still be required.

### Approach B: Raw tmux control mode (-C)

Tmux [control mode](https://github.com/tmux/tmux/wiki/Control-Mode) provides a line-based text protocol over stdin/stdout.
A client started with `tmux -C attach` receives asynchronous `%`-prefixed notifications for state changes.

**Key notification types:**

- `%sessions-changed`: Session created or destroyed.
- `%session-changed`: Attached session changed.
- `%window-add`, `%window-close`: Window lifecycle.
- `%window-renamed`, `%session-renamed`: Name changes.
- `%window-pane-changed`: Active pane changed in a window.
- `%pane-mode-changed`: Pane mode changed.

**What it provides:**

- True event-driven updates: no polling needed for most state changes.
- Bidirectional communication: send commands, receive structured responses.
- Low latency: state changes arrive as they happen.

**What it complicates:**

- Requires a long-lived connection to the tmux server (not subprocess-per-query).
- The control mode protocol is text-based and requires its own parser.
- Not all state is available via notifications: initial state must be queried, and some fields (like `pane_pid`, `pane_current_path`) may require supplementary queries.
- `-CC` (double C) is needed for programmatic use, as single `-C` leaves terminal in canonical mode.

**Migration path:**

- Replace the poll loop with an async event loop reading from a control mode connection.
- Build initial state via `list-panes -F` command sent through the control mode channel.
- Update state incrementally based on notifications.
- Fall back to full re-query for notifications that don't carry enough detail.

**Risk**: Significant architectural change from synchronous poll loop to async event stream.
The notification protocol does not provide all fields sprack needs, so supplementary queries are still required.

### Approach C: Hybrid (tmux-interface-rs + control mode)

Use tmux-interface-rs for typed command execution and output parsing.
Layer control mode on top for event-driven triggering.

**Architecture:**

- A control mode connection watches for `%sessions-changed`, `%window-add`, `%window-close`, and similar notifications.
- On notification, use tmux-interface-rs to run a targeted query (e.g., `list-panes` for a specific session) instead of a full re-query.
- Retain hash-based deduplication as a safety net.

**Benefits:**

- Event-driven without reimplementing tmux command parsing.
- Targeted queries reduce per-cycle work.
- Graceful degradation: if control mode connection drops, fall back to polling.

**Risk**: Two tmux interaction mechanisms to maintain.
Unclear whether tmux-interface-rs can be used over a control mode channel or only via separate subprocess calls.

## Scope

The full proposal should address:

- **Library evaluation**: Does tmux-interface-rs parse the 12 format variables sprack uses (`session_name`, `session_attached`, `window_index`, `window_name`, `window_active`, `pane_id`, `pane_title`, `pane_current_command`, `pane_current_path`, `pane_pid`, `pane_active`, `pane_dead`)?
  If not, what is the gap?
- **Control mode feasibility**: Which notifications map to sprack's data model?
  What supplementary queries are needed after each notification type?
- **Architecture choice**: Recommend one of the three approaches with rationale.
- **Async runtime implications**: Control mode requires long-lived I/O.
  sprack-poll is currently synchronous with `std::thread::sleep`.
  Does this require tokio or can it work with blocking I/O on a dedicated thread?
- **Migration path**: Can the migration be incremental (e.g., replace parsing first, then add event-driven later)?
- **sprack TUI commands**: The TUI's `focus_pane`/`focus_window`/`focus_session` calls in `sprack/src/tmux.rs` are simpler fire-and-forget commands.
  Should these also migrate to tmux-interface-rs, or is the current `Command::new("tmux")` approach adequate for write-only operations?
- **Lace option queries**: The per-session `tmux show-options` calls are a separate concern.
  Should these be batched, or can control mode provide option change notifications?

## Open Questions

1. **tmux-interface-rs format coverage**: Does the library's `ListPanes` command support custom `-F` format strings, or only predefined output parsing?
   If custom formats are needed, does the library still add value over raw `Command`?
2. **Control mode and tmux-interface-rs compatibility**: Can tmux-interface-rs send commands through a control mode channel, or does it always spawn subprocesses?
3. **Control mode stability**: How robust is the control mode connection across tmux server restarts, session creation/destruction, and detach/reattach cycles?
   sprack-poll already handles server absence with a 60-second timeout: how does control mode interact with that?
4. **Minimum tmux version**: What is the minimum tmux version that supports all needed control mode notifications?
   sprack currently has no minimum version requirement.
5. **SIGUSR1 hook integration**: The current design uses tmux hooks to send SIGUSR1 for immediate poll cycles.
   Control mode notifications would make this mechanism redundant.
   Can the transition happen cleanly, or do both mechanisms need to coexist during migration?
6. **Performance**: Is the current polling approach actually a problem in practice?
   The hash-based deduplication means DB writes only happen on change.
   The cost is one `tmux list-panes` subprocess per second.
   If this is negligible, the migration priority is lower and the focus shifts to correctness (delimiter safety) rather than performance.

## Prior Art

- [tmux-interface-rs](https://github.com/AntonGepting/tmux-interface-rs): Typed Rust bindings for tmux CLI commands.
- [tmux Control Mode wiki](https://github.com/tmux/tmux/wiki/Control-Mode): Official documentation for the `-C` protocol.
- [iTerm2](https://iterm2.com/documentation-tmux-integration.html): Uses tmux `-CC` mode for deep integration, demonstrating the viability of control mode for a terminal application.
- [tmux-rs](https://crates.io/crates/tmux-rs): A Rust port of tmux itself (not a client library, but useful for understanding internals).
