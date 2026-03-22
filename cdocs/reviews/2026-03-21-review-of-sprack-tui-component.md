---
review_of: cdocs/proposals/2026-03-21-sprack-tui-component.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T20:30:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [fresh_agent, architecture, tui, daemon_management, api_consistency]
---

# Review: sprack TUI Component Proposal

## Summary Assessment

This proposal covers the `sprack` TUI binary: application structure, responsive layout, tree rendering, input handling, DB reading, tmux navigation, self-filtering, daemon launching, and visual styling.
The overall quality is high: the proposal is thorough, well-structured, and demonstrates strong integration with the broader sprack ecosystem.
The most important findings are an API consistency gap (the TUI bypasses `sprack-db`'s `open_db()` to set up its own connection), a `ProcessStatus` enum mismatch between what the TUI renders and what `sprack-db` defines, and an underconsidered UX issue where click-to-focus prevents browse-without-switching.
Verdict: Revise. Three blocking issues require resolution before implementation.

## Section-by-Section Findings

### Frontmatter

Frontmatter is well-formed.
All required fields present.
Tags are descriptive and appropriate.
No issues.

### BLUF

The BLUF is comprehensive and covers the what, the how, and the phasing.
It is on the longer side but justified by the proposal's scope.
**Non-blocking.** No changes needed.

### Application Structure / Main Loop

The state diagram is clear and the 50ms tick loop is well-justified.
The module layout is clean and maps well to the proposal's sections.
**Non-blocking.** No issues.

### App State

The `App` struct uses `TreeState<NodeId>` from `tui-tree-widget`.
However, `sprack-db` also exports a `TreeState` struct (containing `Vec<Session>`, `Vec<Window>`, etc.).
This name collision will force either aliased imports or renaming in every file that uses both.

**Non-blocking.** Recommend renaming sprack-db's struct to `SprackState` or `DbSnapshot` to avoid confusion with the widget's `TreeState`. This is more naturally addressed in the sprack-db proposal, but worth flagging here since the TUI is the consumer that will feel the collision.

### DB Connection Setup

**Blocking.** The TUI opens its DB connection manually:

```rust
let db = Connection::open_with_flags(
    db_path,
    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_WAL,
)?;
```

This bypasses `sprack-db::open_db()`, which configures WAL mode, busy timeout (5 seconds), foreign keys, and schema initialization.
The proposal's stated principle (from sprack-db) is that "sprack-db is the only crate that contains SQL" and "all database interaction is mediated through its typed API."

The TUI needs read-only access, which is a valid differentiation.
The fix is to add a `sprack_db::open_db_readonly(path)` function that applies the same pragmas but opens read-only.
Alternatively, `open_db` could accept an `OpenMode` parameter.
Either way, the TUI should not contain raw `Connection::open_with_flags` calls.

### ProcessStatus Mismatch

**Blocking.** The TUI's visual styling section defines five process states: Thinking, Tool use, Idle, Error, Waiting.
The `sprack-db` proposal defines `ProcessStatus` as four variants: Running, Idle, Error, Complete.
These sets do not align.

- "Thinking" and "Tool use" from the TUI have no corresponding `ProcessStatus` variant.
- "Running" from sprack-db maps to what? Thinking? Tool use? Both?
- "Complete" from sprack-db has no visual representation in the TUI.
- "Waiting" from the TUI has no sprack-db variant.

This needs reconciliation.
The TUI's five-state model is richer and more useful for the intended use case (glancing at Claude Code status).
Recommend updating `sprack-db::ProcessStatus` to match the TUI's needs: `Thinking`, `ToolUse`, `Idle`, `Error`, `Waiting`, and possibly `Complete`.
Alternatively, the `summary` TEXT field could carry the detailed state while `ProcessStatus` stays coarse, but then the color-mapping logic becomes string-based, which is fragile.

### Responsive Layout

The four-tier system is well-designed.
Breakpoints at 30/60/100 are reasonable.
The decision to use distinct rendering functions per tier rather than parameterized scaling is sound for maintainability.

One inconsistency with the design refinements proposal: the refinements document says "At Standard width and above, the layout splits into two regions" (tree + detail panel).
The TUI component proposal says only Wide and Full tiers get a detail panel: Standard gets tree-only.
The TUI proposal's approach is more practical (30 cols is too narrow for a useful detail panel), but the refinements doc should be updated to match.

**Non-blocking.** The TUI proposal has the correct behavior. Flag for sync with the refinements doc.

### Text Truncation

The truncation function is correct and handles Unicode properly.
The priority ordering for what gets truncated first is sensible.
The note about truncating at `TreeItem` construction time is important: it means available width must be known before building the tree, which couples tree construction to layout tier.
The `build_tree` function signature reflects this correctly (takes `available_width` and `tier`).
**Non-blocking.** No issues.

### Input Handling / Mouse

**Blocking.** Left click on a node selects AND focuses in tmux.
This means browsing the tree with the mouse always triggers a tmux context switch.
There is no way to explore the tree to see what is running without disrupting your current tmux focus.

This is a significant UX issue.
Two alternatives:
1. Single-click selects (moves cursor, shows detail panel info), double-click or Enter focuses in tmux.
2. Single-click selects, Enter focuses. Click on an already-selected node focuses.

`tui-tree-widget`'s `click_at()` handles cursor movement.
The tmux focus command should only fire on an explicit "go" action (Enter key), not on every click.
The keyboard bindings already separate selection (j/k) from focus (Enter): mouse should follow the same pattern.

### tmux Navigation

The command construction table is clear.
The fire-and-forget execution via `spawn()` is appropriate for this use case.
The WARN callout about detached context is a good risk acknowledgment.

One minor concern: `spawn()` creates a child process that becomes a zombie if not `wait()`ed.
Since the TUI never calls `wait()` on these short-lived processes, they accumulate as zombies in the process table until the TUI exits.
On a long-running session with many navigations, this could add up.

**Non-blocking.** Consider using `status()` (blocking, waits for exit) instead of `spawn()` since tmux commands complete in <10ms, or spawn and immediately `wait()` in a fire-and-forget thread.

### Self-Filtering

The approach is correct and the edge cases are addressed.
The empty-window-after-filtering case is handled: window still shows.

**Non-blocking.** Consider whether a window with zero visible panes (all self-filtered) should be visually distinguished (e.g., dimmed) since it is effectively empty from the user's perspective.

### Daemon Launcher

The startup sequence diagram is clear.
PID file validation is thorough (four checks including binary verification via `/proc`).

The NOTE about process group inheritance is the right concern but the mitigation ("sufficient for Phase 3") is unconvincing because the daemon launcher IS Phase 3.
If the TUI's controlling terminal closes (e.g., tmux pane is killed), SIGHUP propagates to the process group, which includes the spawned daemons.
`stdin/stdout/stderr` being null prevents terminal-related issues but does not prevent signal propagation.

**Non-blocking.** The proposal already identifies this risk. For Phase 3, add `setsid()` or `pre_exec` with `libc::setsid()` to the `Command` builder to properly detach daemons. This is a one-line addition.

### Edge Cases

Thorough and well-considered.
The "DB Locked or Missing" section covers the cold-start scenario.
The TODO about auto-exit on tmux server down is a good future consideration.

One missing edge case: what happens when the terminal running sprack is in a tmux popup (not a regular pane)?
`$TMUX_PANE` is set for popups, but the popup pane ID is ephemeral and may not appear in `list-panes` output (popups are not part of the regular session/window/pane hierarchy).
Self-filtering would find no match, which is the correct behavior (no filtering needed for a pane that does not appear in the tree anyway).

**Non-blocking.** This is fine as-is; the edge case resolves correctly.

### Dependencies

Dependency versions are reasonable and well-justified.
The `unicode-width` note about transitive dependency is good practice.
**Non-blocking.** No issues.

### Test Plan

Comprehensive for unit and integration tests.
Manual verification scenarios cover the key user-facing behaviors.
The test for "selection fallback when selected node is destroyed" is important.

Missing test: zombie process accumulation from `focus_pane` spawns.
Missing test: layout tier transition during active rendering (resize mid-frame).

**Non-blocking.** These are nice-to-have, not blocking.

### Implementation Phasing

Phasing is logical: Phase 1 (read-only tree), Phase 2 (navigation + interaction), Phase 3 (responsive + mouse + daemon).
Dependencies between phases are correctly identified.
Phase 1 explicitly notes "no daemon launcher (manual start of sprack-poll)," which is the right approach.
**Non-blocking.** No issues.

### Writing Conventions

The proposal follows sentence-per-line formatting, uses colons over em-dashes, avoids emojis, and uses Mermaid for diagrams.
NOTE/WARN/TODO callouts have proper attribution.
History-agnostic framing is maintained.
**Non-blocking.** No issues.

## Verdict

**Revise.** Three blocking issues must be resolved:

1. The TUI bypasses `sprack-db`'s connection management API by using raw `Connection::open_with_flags`.
2. The `ProcessStatus` enum does not match between `sprack-db` and the TUI's rendering requirements.
3. Left-click should select, not select-and-focus: the mouse should follow the same select/focus separation as the keyboard.

## Action Items

1. [blocking] Replace manual `Connection::open_with_flags` with a `sprack_db::open_db_readonly()` function (or parameterized `open_db`). The TUI should not contain raw SQLite connection setup.
2. [blocking] Reconcile `ProcessStatus` variants between sprack-db and the TUI. The TUI needs at minimum: Thinking, ToolUse, Idle, Error, Waiting. Update sprack-db's enum to match, or document the mapping explicitly if a coarser enum is intentional.
3. [blocking] Separate mouse selection from tmux focus. Click should move the cursor (select); Enter should focus in tmux. This matches the keyboard's select/focus separation and prevents accidental context switches while browsing.
4. [non-blocking] Rename sprack-db's `TreeState` to avoid collision with `tui-tree-widget`'s `TreeState`. Suggested: `SprackState` or `DbSnapshot`.
5. [non-blocking] Sync the design refinements proposal regarding which tiers have a detail panel (Standard does not, only Wide and Full).
6. [non-blocking] Use `status()` or spawn-and-wait for tmux navigation commands to avoid zombie process accumulation.
7. [non-blocking] Add `setsid()` to daemon spawning to properly detach from the TUI's process group.
8. [non-blocking] Consider visually distinguishing windows where all panes are self-filtered (effectively empty).
