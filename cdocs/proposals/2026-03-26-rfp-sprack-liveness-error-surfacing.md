---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T22:30:00-07:00
task_list: sprack/liveness
type: proposal
state: live
status: request_for_proposal
tags: [sprack, ux, observability, daemon_lifecycle]
---

# RFP: Sprack Liveness and Error Surfacing Improvements

> BLUF: The sprack TUI displays `[poller: ok]` even when daemons are stale or not running, giving users a false impression of health.
> The interface needs to be responsive to disconnection state, daemon liveness, and data freshness so users can trust what they see.
>
> - **Motivated By:** `cdocs/reports/2026-03-26-sprack-tui-verification-gap.md`

## Objective

Make the sprack TUI an honest indicator of system health.
Currently, stale data, dead daemons, and resolution failures are invisible or misleading.
Users (and automated agents) cannot distinguish "everything is working" from "data is 5 minutes old and daemons crashed."

## Scope

The full proposal should explore:

- **Daemon health checks**: Are sprack-poll and sprack-claude actually running and writing fresh data? The TUI should detect dead PIDs, stale PID files, and daemons that are running but not producing output.
- **Data freshness indicators**: How old is the last poll cycle? The last claude resolution? The status bar should show a timestamp or staleness warning (e.g., `[poller: ok 2s ago]` vs `[poller: stale 45s]` vs `[poller: dead]`).
- **Error surfacing**: When container session resolution fails, show WHY (e.g., "no session file found at /path", "hook bridge not configured", "mount not present") instead of just `[error]` or silently dropping the pane.
- **Daemon auto-restart**: When `cargo run -p sprack` or `cargo run --bin sprack` starts the TUI, it should reliably start (or restart) the poll and claude daemons. Investigate whether the current `start_sprack_poll` / `start_sprack_claude` in `daemon.rs` is working correctly after the recent refactors.
- **Stale integration cleanup**: The `process_integrations` table has no TTL. Stale entries from crashed sessions or debugging persist indefinitely. Define a cleanup strategy.
- **`--dump-rendered-tree` as health check**: Could this flag also emit daemon health and data freshness metadata for automated verification?

## Open Questions

1. Should the status bar differentiate between "daemon not running" and "daemon running but producing no data"?
2. What is the right staleness threshold before the TUI warns? 5 seconds? 10?
3. Should the TUI attempt daemon restart automatically, or just report the problem and let the user restart?
4. How should resolution errors propagate to the TUI? Per-pane error messages, a global error log, or both?
5. Is `[poller: ok]` currently derived from actual daemon health, or is it just "the DB file exists"?
