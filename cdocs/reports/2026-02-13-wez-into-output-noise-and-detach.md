---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T10:15:00-08:00
task_list: lace/wez-into
type: report
state: archived
status: result_accepted
tags: [investigation, wez-into, wezterm, logging, detach, xkbcommon]
related_to:
  - cdocs/reports/2026-02-13-wez-into-start-failure-investigation.md
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
---

# Investigation: wez-into Output Noise and Terminal Detachment

> **BLUF:** Three sources of noise pollute `wez-into` output: (1) `ssh-keygen -R`
> stdout not being suppressed, (2) xkbcommon errors from WezTerm's older bundled
> libxkbcommon, and (3) WezTerm process stderr inherited via `exec`. The detach
> problem is solvable by switching from `exec wezterm connect` to
> `wezterm cli spawn --domain-name` when an existing WezTerm instance is running,
> which returns immediately and lets WezTerm manage its own logging to
> `$XDG_RUNTIME_DIR/wezterm/wezterm-gui-log-<PID>.txt`.

## Issue 1: ssh-keygen Output Leaking

### Root Cause

Line 294 of `wez-into`:
```bash
ssh-keygen -f "$LACE_KNOWN_HOSTS" -R "[localhost]:$port" 2>/dev/null || true
```

`ssh-keygen -R` writes informational messages to **stdout**, not stderr:
```
# Host [localhost]:22426 found: line 7
/home/mjr/.ssh/lace_known_hosts updated.
Original contents retained as /home/mjr/.ssh/lace_known_hosts.old
```

The `2>/dev/null` only suppresses stderr (the "not found" case). Stdout leaks.

### Fix

Change `2>/dev/null` to `&>/dev/null` (suppress both stdout and stderr).

### Secondary Issue: Comment Line Accumulation

Each `ssh-keyscan` run appends ~5 comment lines (`# localhost:PORT SSH-2.0-...`)
plus up to 3 key lines. `ssh-keygen -R` only removes key lines, not comments.
Over repeated invocations, `lace_known_hosts` accumulates dead comment lines
indefinitely. Fix: filter `ssh-keyscan` output to key lines only before appending.

## Issue 2: xkbcommon Noise

### Root Cause

WezTerm's AppImage bundles an older `libxkbcommon.so.0` that doesn't recognize
keysyms like `dead_hamza` from Fedora 43's newer XKB data. These errors go to
stderr of the `wezterm-gui` process, which is inherited via `exec`.

### Fix

Set `XKB_LOG_LEVEL=10` (critical only) before launching wezterm. This is the
standard suppression mechanism for libxkbcommon — it reads `XKB_LOG_LEVEL` at
init. Value `10` = critical only, suppressing ERROR-level messages.

The real fix is upgrading WezTerm, but that's outside scope.

## Issue 3: WezTerm Process Output and Terminal Attachment

### Current Behavior

`exec wezterm connect` replaces the shell process:
- Terminal is blocked until wezterm exits
- All wezterm stdout/stderr (xkb, lua logs, SSH client messages) goes to terminal
- Ctrl+C kills the connection

### WezTerm's Built-in Logging

WezTerm already writes structured logs to `$XDG_RUNTIME_DIR/wezterm/`:
- `wezterm-gui-log-<PID>.txt` — per-GUI-process logs
- Format: `HH:MM:SS.mmm  LEVEL  module > message`
- Verbosity controlled by `WEZTERM_LOG` env var (env_logger filter syntax)

These logs capture everything including SSH connection events, mux-server
startup, and config errors. They persist until manually cleaned.

### Detach Strategy: `wezterm cli spawn`

`wezterm cli spawn --domain-name "lace:$port" --new-window --workspace "$project"`

This creates a new window connected to the SSH domain via the **existing**
WezTerm GUI instance:
- Returns immediately (non-blocking)
- No stdout/stderr noise in the calling terminal
- Outputs the new pane-id on success
- WezTerm manages its own logging to the log files

Fallback to `exec wezterm connect` when no existing instance is running (cold
start case — rare in practice since WezTerm is typically already open).

Detection: `wezterm cli list &>/dev/null` succeeds when a running instance
exists.

### Log Access

Most recent log: `ls -t $XDG_RUNTIME_DIR/wezterm/wezterm-gui-log-*.txt | head -1`

Could add a `wez-into --log` convenience flag in the future.

## Issue 4: lace up Exit Code 1 with Minified Stack Trace

### Root Cause

The devcontainer CLI (`@devcontainers/cli`) exits 1 when any lifecycle phase
fails. The minified stack trace is from the bundled CLI — it's compiled/minified
JS with no source maps. The container DID start; the failure is likely from a
lifecycle hook (postStartCommand or similar) or feature installation issue.

### Current Handling

`wez-into` already treats non-zero `lace up` as a soft failure and proceeds to
discovery. This is correct. The issue is just noise — showing `tail -10` of a
minified stack trace is not actionable.

### Improvements

1. Show fewer lines of raw output (or none if discovery succeeds)
2. If the container IS discovered after a non-zero `lace up`, downgrade the
   warning to a one-liner instead of dumping the stack trace
3. Future: add `--json` to `lace up` that serializes the `UpResult` phases,
   enabling callers to distinguish "container started but postStart failed"
   from "container failed to start entirely"

## Recommendations

All fixes applied directly to `bin/wez-into`:

| Fix | Type | Impact |
|-----|------|--------|
| `ssh-keygen` stdout suppression | Bug fix | Eliminates known_hosts noise |
| Filter ssh-keyscan comments | Cleanup | Prevents file growth |
| `XKB_LOG_LEVEL=10` | Workaround | Eliminates xkb noise |
| `wezterm cli spawn` with fallback | Enhancement | Terminal returns immediately |
| Suppress lace up trace on successful discovery | UX | Reduces noise for soft failures |
