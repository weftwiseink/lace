---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-02T07:45:00-06:00
task_list: wezterm/wez-into
type: proposal
state: live
status: request_for_proposal
tags: [wez-into, devcontainer, ssh, tab-lifecycle, resilience, reconnect]
---

# wez-into Container Restart Resilience

> BLUF(opus/wezterm): When a devcontainer restarts, existing wez-into tabs become dead SSH connections. Investigate whether wez-into handles reconnection gracefully or accumulates ghost tabs, and design a lifecycle strategy.
>
> - **Motivated By:** `cdocs/proposals/2026-03-01-resurrect-session-safeguards.md`, `cdocs/reports/2026-02-28-sidecar-tui-approach-analysis.md`

## Objective

The `wez-into` tool connects to running devcontainers via direct SSH (tab-oriented, one tab per container). When a container restarts (rebuild, crash, `docker compose restart`), the SSH connection in the existing tab dies. Current behavior is unknown — does wez-into:

- Detect the dead tab and clean it up?
- Leave a dead tab that the user must close manually?
- Create a duplicate tab on the next `wez-into` invocation (since the duplicate-detection checks the tab title, not the connection state)?
- Trigger the same ghost-tab accumulation pattern that caused the crash loop we just fixed?

The resurrect hardening now prevents ghost tabs from corrupting saved state, but dead tabs still degrade the user experience.

## Scope

The full proposal should explore:

- What happens to an existing wez-into tab when its container restarts (observe actual behavior)
- Whether the duplicate-detection logic in wez-into correctly handles dead-but-titled tabs
- Whether wez-into should attempt automatic reconnection (poll for container readiness, then re-exec SSH)
- Whether a WezTerm `exec-domain` or `on-pane-output` callback could detect connection death and trigger reconnection
- Whether the SSH `ServerAliveInterval`/`ServerAliveCountMax` settings in the wez-into SSH command affect tab cleanup
- How other terminal multiplexers (tmux, zellij) handle remote session reconnection
- Whether a lightweight health-check mechanism (periodic `wezterm cli list` + title/state inspection) would be sufficient

## Known Requirements

- Dead container tabs should not accumulate silently
- Reconnection after container restart should be automatic or require at most one user action
- The duplicate-detection in wez-into must distinguish "tab exists and connected" from "tab exists but dead"
- Solution must work with the direct SSH approach (not SSH domains)

## Prior Art

- `wez-into` CLI at `src/wez_into.sh` — current tab creation and duplicate detection logic
- `cdocs/proposals/2026-03-01-resurrect-session-safeguards.md` — ghost tab root cause analysis
- `cdocs/reports/2026-02-28-sidecar-tui-approach-analysis.md` — comparison of connection approaches
- Resurrect fork hardening — `is_pane_healthy()` now filters dead SSH panes on save, but doesn't clean them up from the live tab bar

## Open Questions

1. Does `wezterm cli list` expose enough pane state to distinguish a live SSH connection from a dead one (e.g., exit code, process info, title change)?
2. Would a `wezterm.on("pane-exited")` callback be a viable hook for automatic reconnection or cleanup?
3. Should reconnection be wez-into's responsibility (CLI tool), wezterm config's responsibility (Lua callback), or the resurrect plugin's responsibility (restore-time check)?
4. Is there a risk of reconnection loops if the container keeps crashing?
