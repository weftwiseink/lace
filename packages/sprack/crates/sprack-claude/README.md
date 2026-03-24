# sprack-claude

Claude Code summarizer daemon for the sprack ecosystem.
Detects Claude Code instances running in tmux panes, reads their JSONL session files, and writes structured status to the shared SQLite `process_integrations` table.

## Behavior

- Polls every 2 seconds.
- Identifies Claude Code panes by filtering for `current_command` containing "claude".
- Resolves pane PID to Claude Code session file by walking `/proc` (Linux-specific).
- Uses tail-seeking for initial reads and incremental reads for subsequent cycles.
- Writes `ClaudeSummary` JSON to `process_integrations.summary`: activity state, model, subagent count, context usage percentage, last tool used.
- Cleans stale integrations when Claude Code exits a pane.
- Enforces single-instance via PID file at `~/.local/share/sprack/claude.pid`.

## Key Types

- `ClaudeSummary`: structured status written as JSON to the integrations table.
  Fields: `state`, `model`, `subagent_count`, `context_percent`, `last_tool`, `error_message`, `last_activity`.

## Modules

- `proc_walk`: `/proc` filesystem traversal for PID-to-session-file resolution.
- `session`: session file discovery and state caching.
- `jsonl`: JSONL parsing with tail-seek and incremental read strategies.
- `status`: derives `ClaudeSummary` from parsed session entries.

## Usage

```sh
sprack-claude &
```

See the [main sprack README](../../README.md) for full project documentation.
