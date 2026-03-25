---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-25T12:00:00-07:00
task_list: terminal-management/sprack-daemon-lifecycle
type: proposal
state: live
status: request_for_proposal
tags: [sprack, reliability, daemon_management, process_supervision]
---

# Sprack Daemon Lifecycle Management

> BLUF: sprack's multi-daemon architecture (sprack-poll, sprack-claude) has no coordination between process lifecycles.
> Restarting one daemon without the other causes silent data pipeline failures: sprack-claude holds stale file handles to deleted DB files, and neither daemon recovers without manual intervention.
> The current PID file approach provides no cleanup guarantees under SIGKILL and no automatic restart capability.

> NOTE(opus/sprack-daemon-lifecycle): Related but distinct from `2026-03-24-sprack-self-healing-startup.md`, which covers TUI startup sequence resilience (schema migration, initial poller wait).
> This RFP addresses ongoing runtime lifecycle coordination between daemons after startup.

## Objective

Establish a reliable daemon lifecycle management strategy for the sprack daemon ensemble (sprack-poll, sprack-claude, and future daemons).
The system should handle crashes, restarts, and inter-daemon dependencies without manual intervention.

## Scope

The full proposal should explore:

- **Stale file handle detection and recovery**: when sprack-poll restarts and recreates the DB, sprack-claude continues reading from deleted files (visible as `(deleted)` entries in `/proc/PID/fd`).
  The proposal should address whether sprack-claude should detect this condition and reopen the DB, or whether a coordinated restart is the correct recovery path.
- **Process supervision strategy**: whether to use systemd user units, a lightweight supervisor process, or a self-supervising approach where daemons monitor each other.
  Tradeoffs between external supervision (systemd) and internal coordination (a sprack-supervisor binary or watchdog thread).
- **Coordinated restart**: restarting sprack-poll should trigger sprack-claude to reopen its DB connection (or restart entirely).
  Mechanisms to explore: filesystem watches on the DB path, Unix signals between daemons, a shared coordination file, or IPC.
- **PID file robustness**: the current manual PID file management has no cleanup on SIGKILL and is susceptible to race conditions.
  Alternatives: `pidfd_open` for process liveness checks, advisory file locks (`flock`) that auto-release on process death, or removing PID files entirely in favor of process-group supervision.
- **Automatic restart on crash**: currently a crashed daemon stays dead until manually restarted.
  The proposal should define restart policy (immediate, backoff, max retries) and who is responsible for restart (systemd, a supervisor, or the TUI itself).
- **Dependency ordering**: sprack-claude depends on sprack-poll's DB output.
  The proposal should define the startup and shutdown ordering, and what happens when the dependency graph is violated at runtime.

## Open Questions

1. Should sprack adopt systemd user units as the supervision layer, or is an internal solution preferable given that sprack already manages its own startup from the TUI?
2. Is coordinated restart (restart both daemons together) simpler and more reliable than incremental recovery (sprack-claude detects stale handles and reopens)?
3. Should there be a single `sprack-supervisor` process that owns the lifecycle of all daemons, replacing the current approach where the TUI launches daemons directly?
4. How should the supervision strategy interact with the TUI's own lifecycle?
   If the user closes the TUI, should daemons keep running (for background data collection) or shut down?
5. What is the right boundary between this proposal and the existing self-healing startup RFP?
   Should startup resilience be folded into a unified lifecycle management proposal?
