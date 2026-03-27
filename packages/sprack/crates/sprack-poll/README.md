# sprack-poll

tmux state poller daemon for the sprack ecosystem.
Queries tmux via `list-panes -a -F`, parses the output, and writes full state replacement to SQLite in a single transaction.
Uses hash-based diffing to skip DB writes when tmux state is unchanged.

## Behavior

- Polls tmux state every 1 second by default.
- Accepts SIGUSR1 from tmux hooks for immediate poll cycles (<50ms latency).
- Writes a heartbeat timestamp on every cycle (even no-op cycles) for TUI staleness detection.
- Queries container session options (`@lace_container`, `@lace_user`, `@lace_workspace`) for container grouping.
- Self-terminates after 60 seconds if the tmux server is absent.
- Enforces single-instance via PID file at `~/.local/share/sprack/poll.pid`.

## Modules

- `tmux`: tmux CLI interaction, output parsing, container option queries.
- `diff`: hash-based change detection to avoid unnecessary DB writes.

## Usage

Usually auto-started by the `sprack` TUI binary.
Can also be run directly:

```sh
sprack-poll
```

See the [main sprack README](../../README.md) for full project documentation.
