---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T05:30:00-07:00
task_list: terminal-management/sprack-troubleshooting
type: devlog
state: live
status: review_ready
tags: [sprack, troubleshooting, widget_restyle, handoff]
---

# Sprack Troubleshooting and Widget Restyle Handoff

> BLUF: This session fixed three critical pipeline bugs, added render testability infrastructure, landed widget restyle Phase 1 (Claude session names + absolute token counts), and produced a comprehensive roadmap assessment.
> The next overseer should implement hook event wiring, session cache integration, tmux IPC migration, and container validation.

## What Was Done

### Commits (chronological)

| Commit | Description |
|--------|-------------|
| `ef53ac7` | **Phase 0 verifiability infrastructure**: extracted `ProcFs` trait, `find_process_pid` predicate refactoring, tmux socket parameterization, `claude_home` injection. Enables mock-based testing without real tmux/proc. |
| `5e4dd5a` | **Phase 1A layout organization**: spatial pane ordering by `pane_top`/`pane_left` coordinates instead of tmux b-tree structure. Exhaustive metadata fields in tmux format string (19 fields). |
| `6cb1b2a` | **Phase 1.5 hook event bridge**: shell script hook bridge capturing SessionStart, PostToolUse, SubagentStart/Stop, TaskCompleted, PostCompact, SessionEnd. Event reader and merge logic in `events.rs`. |
| `8db16bb` | **Hook bridge review fixes**: addressed review findings on the hook event bridge. |
| `2d3c921` | **Phase 2A inline summaries with rich Claude widget**: replaced the separate detail pane with inline tree-node summaries. Rich widget rendering for Claude pane status. |
| `a62b9a4` | **Schema version mismatch handling**: TUI gracefully handles mismatched DB schema from stale poller binary. |
| `09bc82d` | **Startup timeout increase**: bumped startup wait to 5s, filed self-healing RFP. |
| `139b8d0` | **Poller stderr logging**: redirect sprack-poll stderr to log file for startup diagnostics. |
| `8fbd497` | **Stale binary detection**: detect when sprack-poll binary produces wrong schema and surface the error. |
| `aade6bb` | **Widget restyle proposal + README**: Claude widget restyle proposal doc and git context TODO in README. |
| `0e77e50` | **Ctrl+C quit and click-to-expand**: TUI now handles Ctrl+C for quit and mouse clicks to expand non-leaf tree nodes. |
| `be7a72f` | **Phase 2B session cache schema**: `cache.rs` with `sprack_session_cache.db` schema and `ingest_new_entries` function. Not yet wired into poll loop. |
| `6e82014` | **Suppress dead_code warnings**: `#[allow(dead_code)]` on cache functions not yet wired. |
| `016ed94`, `61c4185` | **Misc fixes**: incremental corrections during debugging sessions. |
| `310c578` | **Phase 1 render testability**: `TestBackend` + 12 insta snapshot tests covering all 4 layout tiers, empty/error states, multi-session rendering, detail panel, poller health. |
| `b19fdc7` | **Phase 2 `--dump-rendered-tree`**: CLI flag for headless rendering. Expands all nodes, no detail pane, no footer. Enables agent-driven iteration. |
| `0506a5e` | **Phase 1 widget restyle**: session names and absolute token counts replace percentage-based display. |
| `45662d1` | **Claude session name display**: use `customTitle` from `sessions-index.json` as the tree node label instead of tmux session name. Improved dump output formatting. |

### Bugs Found and Fixed

**1. CASCADE delete wiping integrations** (`sprack-db/src/write.rs`):
`write_tmux_state` deletes all sessions before reinserting, and FK cascades wipe `process_integrations` every ~2 seconds.
Fix: save integrations, delete sessions, reinsert sessions, restore integrations.

> NOTE(opus/sprack-troubleshooting): The doc comment incorrectly attributes FK-skip to `INSERT OR IGNORE` when the Rust `let _ =` discard is doing the work.
> `INSERT OR IGNORE` does NOT suppress FK violations in SQLite; it only suppresses unique constraint violations.

**2. Dispatch logic routing local panes to container resolver** (`sprack-claude/src/main.rs`):
Local claude panes in lace sessions were unconditionally routed to the container resolver because lace session metadata was present.
Fix: try proc-walk first for any pane with "claude" in `current_command`, fall back to container resolver only if proc-walk fails.

**3. Non-ISO-8601 timestamp format** (`sprack-db/src/write.rs`):
`now_iso8601()` produced a non-standard format.
Fix: Howard Hinnant civil_from_days algorithm for correct ISO 8601 output.

**4. `sessions-index.json` parse format mismatch** (`sprack-claude/src/session.rs`):
Code tried to parse as a flat JSON array, but the actual format is `{version, entries}`.
Fix: try versioned format first, flat array as fallback.
Also added `customTitle` field extraction for Claude session names.

## Known Limitations

**Same-project session deduplication**: multiple Claude instances in the same project directory resolve to the same session file and show identical data.
The hook event bridge provides `session_id` which could enable PID-to-session mapping, but this is not wired yet.
See TODO comments in `resolver.rs`.

**Container panes**: `@lace_workspace` is empty on current lace sessions, so container-side resolution does not work.
The `LaceContainerResolver` code exists but has not been validated against a live lace deployment with Claude in containers.

**Daemon lifecycle**: sprack-claude holds stale DB file handles after sprack-poll restarts.
Must restart sprack-claude after rebuilding sprack-poll.
RFP filed at `cdocs/proposals/2026-03-25-sprack-daemon-lifecycle.md`.

## Sharp Edges and Pitfalls

**Nushell is the user's shell**: `pgrep`/`pkill` with `-f` can match themselves and cause exit code 144.
Use `kill <PID>` directly or iterate explicitly.

**WAL mode timing**: the `sqlite3` CLI may not see writes still in WAL.
Use `PRAGMA wal_checkpoint(PASSIVE)` or query while sprack-claude is running.

**Foreign keys are ON**: `sprack_db::open_db` enables FK enforcement.
`INSERT OR IGNORE` does NOT suppress FK violations in SQLite.

**`/proc/{pid}/children` path**: on Fedora, `/proc/{pid}/children` does not exist.
Must use `/proc/{pid}/task/{pid}/children`.
The `RealProcFs` fallback path handles this.

**Tree state not persisted**: when the TUI restarts, all nodes collapse to default.
The `--dump-rendered-tree` flag forces all nodes expanded.

**Hook events are forward-only**: only sessions started AFTER hooks are configured receive hook data.
Existing sessions do not retroactively get hook events.

## Next Implementation Work

Recommended order for the next overseer:

### 1. Finish Wiring: Hook Event Bridge

**Proposal**: `cdocs/proposals/2026-03-24-sprack-hook-event-bridge.md`

Shell script and event reader are done.
Remaining: wire multi-instance session-to-pane dedup using `session_id` from hook events to correlate specific Claude PIDs with their session files.
This solves the "all panes show same data" limitation.

Once hooks provide session identity, the mtime-based session file selection in `session.rs` becomes fallback-only.
Document `find_via_jsonl_listing` as fallback.
Hook bridge installed at `~/.local/share/sprack/hooks/sprack-hook-bridge`, configured in `~/.claude/settings.local.json`.

### 2. Finish Wiring: Session Cache

**Proposal**: `cdocs/proposals/2026-03-24-sprack-claude-incremental-session-cache.md`

`cache.rs` has schema (`sprack_session_cache.db`) and `ingest_new_entries`.
Functions are `#[allow(dead_code)]`.
Wire `ingest_new_entries` into the poll loop in `sprack-claude/main.rs`.
Populate extended `ClaudeSummary` fields: `user_turns`, `assistant_turns`, `tool_counts`, `context_trend`.

### 3. Implement Refactor: tmux IPC Migration

**Proposal**: `cdocs/proposals/2026-03-24-sprack-tmux-ipc-migration.md`

Replace raw `Command::new("tmux")` with `tmux-interface-rs`.
Affects `sprack-poll/src/tmux.rs` primarily.
The `||` delimiter is fragile, and the extended 19-field format string makes parsing even more brittle.
The tmux socket parameterization from Phase 0 provides the injection point.

### 4. Validate: Process Host Awareness

**Proposal**: `cdocs/proposals/2026-03-24-sprack-process-host-awareness.md`

`LaceContainerResolver` code exists in `resolver.rs`.
The dispatch fix from this session (local claude first, container fallback) is in place.
Remaining: validate against a live lace deployment with Claude running inside a container.
The `@lace_workspace` tmux option must be populated for container resolution to work.
Check how lace sets this.

## Deferred Items

Not for the next session:

- Git context collection (RFP in widget restyle proposal, Phase 2-3)
- `2026-03-24-sprack-self-healing-startup` (startup sequence resilience)
- `2026-03-25-sprack-daemon-lifecycle` (runtime lifecycle coordination)
- `2026-03-24-sprack-ssh-integration` (SSH pane enrichment)
- `2026-03-24-sprack-podman-integration-testing` (CI-level container testing)

## Testing and Troubleshooting Guidance

**Snapshot tests**: 12 insta snapshot tests in `crates/sprack/src/test_render.rs` cover all 4 layout tiers, empty/error states, multi-session rendering, detail panel, and poller health.
Run `cargo insta review` after format changes.

**Headless rendering**: `cargo run -p sprack -- --dump-rendered-tree --cols 120 --rows 30` renders one frame to stdout with all nodes expanded, no detail pane, no footer.
Useful for agent-driven iteration without a live TUI.

**DB inspection**:

```sql
sqlite3 ~/.local/share/sprack/state.db \
  "SELECT pane_id, status, json_extract(summary, '$.model'),
          json_extract(summary, '$.tokens_used'),
          json_extract(summary, '$.session_name')
   FROM process_integrations WHERE status <> 'error';"
```

**Proc debugging**: to trace why a pane is not resolving, walk `/proc/{pane_pid}/task/{pane_pid}/children` recursively, checking cmdline at each level.
The claude process is typically a grandchild of the tmux pane shell (`nu -> nu -> claude`).

## Subagent Usage Recommendations

- Use **opus** for implementation subagents.
- For 3+ independent implementation tasks, dispatch in parallel with clear file-ownership boundaries.
- Always have subagents run `cargo test` after changes.
- Use `/review` subagent (sonnet) after implementation to catch issues.
- Instruct subagents to commit after each phase.
- The `--dump-rendered-tree` flag is useful for verifying rendering changes without a live TUI.

## Key Source Files

| File | Purpose |
|------|---------|
| `sprack-claude/src/main.rs` | Poll loop, dispatch logic, integration writes |
| `sprack-claude/src/resolver.rs` | Local + container session resolution |
| `sprack-claude/src/session.rs` | Session file discovery, `sessions-index.json` parsing |
| `sprack-claude/src/status.rs` | `ClaudeSummary` construction from JSONL entries |
| `sprack-claude/src/events.rs` | Hook event reader and merge |
| `sprack-claude/src/cache.rs` | Session cache schema and ingestion (not wired) |
| `sprack-db/src/write.rs` | DB writes including integration save/restore |
| `sprack/src/tree.rs` | Tree construction, pane label formatting, rich widget |
| `sprack/src/render.rs` | Frame rendering, detail panel, `buffer_to_string` |
| `sprack/src/test_render.rs` | Snapshot tests |
| `sprack/src/main.rs` | CLI entry, `--dump-rendered-tree`, daemon auto-start |
