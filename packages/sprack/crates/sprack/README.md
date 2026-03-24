# sprack

TUI binary and user-facing entry point for the sprack tmux sidecar.
Renders a responsive collapsible tree of tmux sessions, windows, and panes with real-time process integration status from a local SQLite database.

## Features

- Responsive layout: adapts from narrow sidebar (~28 cols) to wider viewports with detail panels.
- Polls `PRAGMA data_version` at 50ms intervals, rebuilds tree only when DB changes.
- Self-filters its own tmux pane from the tree via `$TMUX_PANE`.
- Auto-starts `sprack-poll` if not already running.
- Keyboard navigation (j/k/h/l/Space/Enter/q) and mouse support.
- Catppuccin color theme.

## Modules

- `app`: main event loop, tree state, DB polling.
- `tree`: builds `tui-tree-widget` tree items from `DbSnapshot`.
- `render`: frame rendering, status bar, detail panel.
- `layout`: responsive breakpoint logic.
- `input`: keyboard and mouse event handling.
- `tmux`: tmux CLI commands for navigation (select-pane, switch-client).
- `daemon`: auto-starts sprack-poll, health checking.
- `colors`: catppuccin-to-ratatui color bridge.

## Usage

```sh
sprack
sprack --db-path /tmp/test.db
```

See the [main sprack README](../../README.md) for full project documentation.
