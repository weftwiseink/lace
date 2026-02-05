---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-02T08:30:00-08:00
task_list: lace/devcontainer-workflow
type: devlog
state: archived
status: done
tags: [devcontainer, wezterm, developer-experience, workflow-automation]
---

# Open Lace Workspace: Smart Mode Enhancements (Handoff)

## Context

The `bin/open-lace-workspace` script was implemented per proposal `cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md` and accepted by the user. This devlog captures the state of the implementation and scopes follow-up work to make the script "smarter."

### Current state

The script (`bin/open-lace-workspace`) handles:
- Dual-mode stdin detection (piped vs standalone)
- `devcontainer up` JSON parsing with jq/grep fallback
- Graceful handling of lifecycle hook failures (error outcome + containerId = warn and proceed)
- SSH readiness polling (1s interval, 15 attempts)
- Backgrounded `wezterm connect lace` with early-failure detection
- Prerequisite validation (wezterm, SSH key, devcontainer CLI)

### Known issues from implementation

1. **postStartCommand mux server failure**: `wezterm-mux-server --daemonize 2>/dev/null || true` fails on container restart when the pid lock from a previous instance persists. `devcontainer up` reports this as outcome "error" despite `|| true`. The script now handles this gracefully (warn + proceed), but the root cause in `postStartCommand` is unaddressed.

2. **Exit code 4 rarely reachable**: `wezterm connect` opens a window with an error dialog for mux failures rather than exiting non-zero. The 2-second liveness check catches immediate SSH/config failures but not mux negotiation failures.

3. **No existing connection detection**: Running the script twice opens two windows. No deduplication.

## Follow-up Work: Smart Mode

User-requested enhancements for a follow-up session:

### 1. `--rebuild` flag

Add a `--rebuild` option that passes `--build-no-cache` (or `--rebuild`) to `devcontainer up`. Currently the user must use piped mode to control flags:

```bash
# Current (verbose)
devcontainer up --workspace-folder . --build-no-cache | ./bin/open-lace-workspace

# Desired
./bin/open-lace-workspace --rebuild
```

**Implementation notes:**
- Parse args with a simple `while` loop or `getopts`
- `--rebuild` maps to `devcontainer up --workspace-folder "$REPO_ROOT" --rebuild` (the devcontainer CLI `--rebuild` flag forces image rebuild)
- Only relevant in standalone mode; in piped mode the caller already controls flags
- Consider also supporting `--no-cache` as an alias

### 2. Interactive reconnect vs rebuild prompt

When a container is already running (detected via `docker ps` or `devcontainer up` returning immediately), prompt the user:

```
Container is already running.
  [r] Reconnect (open WezTerm window)
  [b] Rebuild (stop, rebuild, reconnect)
  [q] Quit
```

**Implementation notes:**
- Detect "container already running" from `devcontainer up` returning quickly with success
- Alternative: check `docker ps --filter "label=devcontainer.local_folder=$REPO_ROOT"` before running `devcontainer up`
- The prompt requires stdin to be a TTY (`[ -t 0 ]`), so this only works in standalone mode. In piped mode, always reconnect (current behavior).
- Use `read -r -n 1` for single-keypress input
- Reconnect = skip `devcontainer up`, go straight to SSH check + `wezterm connect`
- Rebuild = run `devcontainer up --rebuild`, then proceed normally

### 3. Existing WezTerm connection detection

Before opening a new window, check if there's already a WezTerm window connected to the `lace` domain.

**Implementation notes:**
- `wezterm cli list --format json` on the host shows all tabs/panes including remote domains
- Filter for entries where the domain is "lace" or the workspace name matches
- If found, offer to focus the existing window instead of opening a new one
- Focusing an existing window: `wezterm cli activate-tab --tab-id <id>` or similar
- Caveat: `wezterm cli list` requires a running wezterm mux on the host (the `unix_domains` config). If no host mux is running, this will fail. Guard with a timeout or `|| true`.
- This feature may depend on the host wezterm being started with `wezterm start --front-end MuxServer` or having `default_gui_startup_args = { "connect", "unix" }` uncommented in the config

### Suggested approach

These three features are relatively independent and could be implemented in sequence:

1. `--rebuild` flag (simplest, no interactivity required)
2. Interactive prompt (requires TTY detection, simple read loop)
3. Connection detection (requires understanding wezterm cli list output format, most complex)

Each could be a separate commit. A proposal may be warranted for #2 and #3 since they change the script's behavioral contract (from "always open a new window" to "conditionally reuse or prompt").

## Files Reference

| File | Role |
|------|------|
| `bin/open-lace-workspace` | The script to enhance |
| `config/wezterm/wezterm.lua` | WezTerm config (SSH domain, unix domain) |
| `.devcontainer/devcontainer.json` | Container config (postStartCommand) |
| `cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md` | Original proposal (accepted) |
| `cdocs/devlogs/2026-02-01-open-lace-workspace-implementation.md` | Implementation devlog |
| `cdocs/proposals/2026-02-01-deeper-wezterm-devcontainer-integration.md` | Related future work proposal (if exists) |
