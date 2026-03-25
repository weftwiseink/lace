---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T21:00:00-07:00
task_list: terminal-management/sprack-startup-resilience
type: proposal
state: live
status: request_for_proposal
tags: [sprack, reliability, daemon_management, startup]
---

# Sprack Self-Healing Startup

> BLUF: The TUI startup flow should detect and recover from schema mismatches, stale processes, and race conditions without manual intervention.
> - Motivated By: manual verification failure during Phase 1A testing (schema v0 -> v1 migration)

## Objective

The current TUI startup has several failure modes that require manual intervention (`pkill`, `rm -rf`):

1. **Stale PID files** pointing to dead processes prevent the poller from starting.
2. **Old-binary pollers** running with schema v0 produce a DB the new TUI cannot read.
3. **Race conditions**: the TUI deletes a stale DB and restarts the poller, but the 2-second wait may not be enough for the poller to create and populate the DB.
4. **Fresh start after pkill**: if the poller doesn't create the DB within the timeout, the TUI errors out with "Database not found."

The goal is a startup sequence that converges to a working state in all these scenarios without user intervention.

## Scope

The full proposal should explore:

- A retry loop with backoff that waits for the poller to produce a valid DB (not just any DB file).
- Schema version validation at the TUI level with automatic recovery (stop old poller, delete stale DB, restart).
- PID file validation that detects and removes stale PID files (process dead but file remains).
- Whether the TUI should be able to run `init_schema` itself (read-write briefly for migration, then reopen read-only).
- Whether sprack-claude should also participate in schema migration or version checking.
- Timeout and retry parameters: how long to wait, how many retries, what to tell the user during the wait.
- Whether the poller should log its schema version on startup for debugging.

## Open Questions

1. Should the TUI open the DB read-write for schema migration, or should only the poller own schema creation?
   The poller-owns-schema model is cleaner but introduces the race condition.
2. Should the startup sequence show a "waiting for poller..." message in the TUI rather than on stderr?
3. Is 2 seconds sufficient for the poller to start, connect to tmux, and write the first snapshot?
   On slow systems or when tmux has many sessions, this might be tight.
4. Should there be a `sprack doctor` subcommand that diagnoses and fixes state issues independently of the TUI startup?
