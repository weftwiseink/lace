---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-25T16:05:00-07:00
task_list: lace/session-management
type: proposal
state: archived
status: evolved
tags: [tmux, sprack, session_management, lace_into]
---

# RFP: Stale tmux Lace Metadata After Container Rebuild

> BLUF: After a container rebuild that changes the SSH port, tmux session-level `@lace_port` becomes stale, causing all subsequent pane splits and reconnections to fail with "connection refused." This needs a reliable invalidation or refresh mechanism.

## Problem

`lace-into` sets tmux session and pane options (`@lace_port`, `@lace_user`, `@lace_workspace`) when connecting to a container.
When the container is rebuilt, the SSH port often changes (lace allocates from a range).
The tmux session persists across rebuilds, retaining the old port.
Every pane split via `lace-split` and every `lace-into --pane` reattach inherits the stale port, producing immediate "connection refused" failures.

Current workaround: manually run `tmux set-option -t <project> @lace_port <new-port>`.
This is fragile and non-obvious.

## Scope of Proposal

Address one or more of:

1. **Detection**: How should lace (or sprack) detect that a session's metadata is stale?
2. **Refresh**: How should stale metadata be updated? Push (container notifies host) vs. pull (host polls or checks on demand)?
3. **Architecture**: Should this live in `lace-into` (pre-connect validation), `lace-split` (per-split validation), sprack (centralized state), or a combination?

## Current Architecture

`lace-into` sets metadata at two levels:
- **Session-level**: `tmux set-option -t "$project" @lace_port "$port"` (plus `@lace_user`, `@lace_workspace`)
- **Pane-level**: `tmux set-option -p -t "$pane_id" @lace_port "$port"` (same three fields)

sprack-poll already reads session-level metadata via `tmux show-options -qvt $session @lace_port` and stores it in the `sessions` table (`lace_port`, `lace_user`, `lace_workspace` columns).
sprack-poll does NOT currently read pane-level metadata (acknowledged as Phase 2 in the sprack-process-host-awareness proposal).

Metadata flow is read-only in sprack: sprack copies from tmux, never writes back.
Only `lace-into` writes metadata to tmux.

## Considerations

- **sprack as authoritative source**: sprack-poll already has the session-level metadata in SQLite.
  If sprack also read the *actual* current port from `lace discover` or Docker inspection, it could detect staleness and either update tmux metadata or expose the discrepancy to consumers.
  See `cdocs/proposals/2026-03-24-sprack-ssh-integration.md` and `cdocs/proposals/2026-03-24-sprack-process-host-awareness.md` for related designs.
- **lace-discover validation**: `lace discover` can query the current port for a project.
  A lightweight check in `lace-split` or `lace-into` could call `lace discover <project> --json` and compare against the tmux metadata.
- **Performance**: Any per-split validation adds latency. A `lace discover` call takes ~200ms.
  Caching or event-driven updates (sprack push) would avoid this.
  sprack-poll runs on a 1-second interval, so staleness detection there would have minimal additional cost.
- **Session vs. pane metadata**: Session-level metadata is set by `lace-into` for convenience.
  Pane-level is set for split propagation (and is what `lace-split` now checks exclusively).
  Both levels need updating when the port changes.
- **Bidirectional sync**: If sprack detects staleness, it could write corrected metadata back to tmux options, or it could invalidate/remove stale entries so `lace-split` fails fast with a clear message.
- **Graceful degradation**: If the container is down entirely (not just port-changed), the split should fail with a clear message, not silently create a dead pane.

## `@lace_workspace` Flakiness

A related but distinct failure mode: the `lace` tmux session sometimes has `@lace_port` set but `@lace_workspace` is empty.
This causes sprack-claude's `LaceContainerResolver` to fail silently: `resolve()` returns `None` on the very first line (`self.session.lace_workspace.as_deref()?`), and the convenience function `resolve_container_pane()` does the same.
The pane appears as a valid lace session candidate (because `lace_port` is set), but resolution produces "no session file found" with no error or log.

This is a different category from port staleness: the metadata is not *stale*, it is *incomplete*.
The likely root cause is a race condition or ordering issue in `lace-into` where `@lace_port` is set before `@lace_workspace`, or `@lace_workspace` fails to be set at all due to an early exit or error in the connection flow.

### Impact on Sprack

- `find_candidate_panes()` filters on `lace_port.is_some()`, so the pane is included as a candidate.
- `resolve_container_pane()` immediately returns `None` due to the missing workspace.
- The pane is silently dropped from session resolution with no diagnostic output.
- From the user's perspective, the container's Claude session simply does not appear in sprack.

### Considerations

- **Validation at ingest**: sprack-poll could log a warning when `lace_port` is set but `lace_workspace` is empty, making the inconsistency visible.
- **Defensive filtering**: `find_candidate_panes()` could require *both* `lace_port` and `lace_workspace` to be `Some`, preventing silent downstream failures.
- **Root cause in lace-into**: The fix may belong in `lace-into` itself, ensuring all three metadata fields are set atomically or rolled back together.
- **Retry/backfill**: sprack-poll could re-query lace options for sessions where `lace_port` is set but `lace_workspace` is missing, catching transient races on the next poll cycle.

This issue should be addressed alongside port staleness, as both represent incomplete or incorrect tmux metadata causing silent resolution failures.
