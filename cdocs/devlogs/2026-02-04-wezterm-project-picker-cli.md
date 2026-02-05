---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:00:00-08:00
type: devlog
state: archived
status: done
tags: [wezterm, cli, project-picker, devcontainer]
---

# WezTerm Project Picker CLI Research

## Objective

Research WezTerm CLI capabilities to design a `wez-lace-into` command that provides an alternative entry point to the keyboard-chord-triggered project picker. The user wants a CLI command because keyboard chords are hard to remember.

## Background

The existing wezterm plugin at `/var/home/mjr/code/weft/lace/config/wezterm/lace-plugin/` provides:
- SSH domain configuration for devcontainer access
- Worktree picker triggered by `EmitEvent("lace.trigger-worktree-picker.lace")`
- Keybindings are currently disabled due to multi-project collision concerns

The RFP at `cdocs/proposals/2026-02-04-wezterm-project-picker.md` outlines the need for a project picker UI that works across multiple projects.

## Research Findings

### WezTerm CLI Capabilities

**Available CLI commands:**
```
wezterm cli list           # List windows, tabs, panes (JSON or table)
wezterm cli spawn          # Spawn command in new tab/window with domain
wezterm cli send-text      # Send text to a pane
wezterm cli activate-pane  # Focus a specific pane
wezterm connect <domain>   # Connect to a mux domain, opens new window
wezterm ssh <host>         # Establish SSH session
```

**Key findings:**

1. **`wezterm connect <domain>`** - Opens a new WezTerm window connected to a named domain. Supports `--workspace` flag to set workspace name.
   ```bash
   wezterm connect lace --workspace "lace"
   ```

2. **`wezterm cli spawn`** - Spawns into existing WezTerm instance with domain/cwd control:
   ```bash
   wezterm cli spawn --domain-name lace --cwd /workspace/main
   wezterm cli spawn --domain-name lace --new-window --workspace "lace"
   ```

3. **`wezterm cli list`** - Returns JSON with pane IDs, window IDs, workspace names, cwd, and domain info. Can detect existing connections.

4. **No direct event emission from CLI** - Cannot call `wezterm.emit()` or trigger `EmitEvent` from CLI. Events require an active pane context.

5. **`user-var-changed` pattern** - Can trigger events by sending escape sequences to a pane, but requires an existing terminal session.

### CLI Architecture Options

**Option A: Wrapper Script Around `wezterm connect`**

The simplest approach. `wez-lace-into` wraps `wezterm connect` with project-aware logic:

```bash
#!/bin/bash
# wez-lace-into <project>
# Example: wez-lace-into lace, wez-lace-into dotfiles

PROJECT="${1:-lace}"  # Default to lace

# Check if container is running
if ! docker ps --filter "label=devcontainer.local_folder=*/$PROJECT" -q | grep -q .; then
  echo "Container for $PROJECT is not running. Start with: lace up"
  exit 1
fi

# Connect to the appropriate domain
wezterm connect "$PROJECT" --workspace "$PROJECT"
```

Pros: Simple, no plugin changes needed
Cons: Opens new window each time; no picker UI; requires domain per project

**Option B: CLI Spawns Into Existing Instance**

Use `wezterm cli spawn` to create a new tab/pane in an existing WezTerm window:

```bash
#!/bin/bash
PROJECT="${1:-lace}"

# If wezterm is already running with mux, spawn into it
if wezterm cli list &>/dev/null; then
  wezterm cli spawn --domain-name "$PROJECT" --workspace "$PROJECT" --new-window
else
  # No existing instance, use connect
  wezterm connect "$PROJECT" --workspace "$PROJECT"
fi
```

Pros: Reuses existing WezTerm instance
Cons: Still no picker UI; just direct connection

**Option C: CLI Triggers Picker via User Variable**

If an existing WezTerm pane exists, send an escape sequence to trigger the picker:

```bash
#!/bin/bash
# Find a pane in the target workspace
PANE_ID=$(wezterm cli list --format json | jq -r '.[] | select(.workspace=="main") | .pane_id' | head -1)

if [[ -n "$PANE_ID" ]]; then
  # Send escape sequence to trigger picker
  printf "\033]1337;SetUserVar=lace-action=%s\007" "$(echo -n 'show-picker' | base64)" | \
    wezterm cli send-text --pane-id "$PANE_ID" --no-paste
else
  # No existing pane, fall back to direct connect
  wezterm connect lace
fi
```

Pros: Can trigger the full picker UI
Cons: Complex; requires active pane; escape sequences in pane output

**Option D: External Picker + CLI Action**

Use an external fuzzy finder (fzf, rofi, dmenu) for project selection, then execute the connection:

```bash
#!/bin/bash
# wez-lace-into: CLI project picker for lace devcontainers

# Discover available projects (configured domains from wezterm config)
PROJECTS=$(grep -E 'domain_name\s*=' ~/.config/wezterm/wezterm.lua | \
           sed 's/.*domain_name\s*=\s*"\([^"]*\)".*/\1/' | sort -u)

# Show picker
if [[ -n "$1" ]]; then
  PROJECT="$1"
else
  PROJECT=$(echo "$PROJECTS" | fzf --prompt="Select project: " --height=10)
fi

[[ -z "$PROJECT" ]] && exit 0

# Connect
wezterm connect "$PROJECT" --workspace "$PROJECT"
```

Pros: Familiar picker UX; no wezterm plugin changes
Cons: Requires fzf/rofi; separate from wezterm's built-in InputSelector

### Recommended Approach: Hybrid CLI

Combine the best aspects into a `wez-lace-into` script that:

1. **Discovers available projects** from a config file or by scanning running containers
2. **Shows a picker** if no argument given (using fzf or a simple menu)
3. **Reuses existing connections** if a workspace is already open
4. **Opens new workspace** via `wezterm connect` or `wezterm cli spawn`

```bash
#!/bin/bash
# wez-lace-into - Connect to lace devcontainer projects
#
# Usage:
#   wez-lace-into                # Show project picker
#   wez-lace-into <project>      # Connect to specific project
#   wez-lace-into --list         # List available projects

set -euo pipefail

# Config location for project registry
LACE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/lace"
PROJECTS_FILE="$LACE_CONFIG/projects.json"

# ... (implementation details in proposal)
```

### Integration with Multi-Project Plugin Design

The proposal at `cdocs/proposals/2026-02-04-lace-plugins-system.md` defines a plugin system where projects register themselves. The CLI can leverage this:

1. **Project registry** at `~/.config/lace/projects.json` lists configured projects with their:
   - SSH domain name
   - SSH port
   - Workspace path
   - Display name

2. **CLI reads registry** to build the picker menu

3. **CLI invokes wezterm** with appropriate domain/workspace

This keeps the CLI stateless and delegates project configuration to the plugin system.

## Implementation Plan

1. Create `bin/wez-lace-into` script
2. Define project registry format
3. Implement picker using select/fzf
4. Add connection logic with reuse detection
5. Document in wezterm plugin README

## Changes Made

- Created this devlog with WezTerm CLI research findings
- Completed the RFP at `cdocs/proposals/2026-02-04-wezterm-project-picker.md`
- Conducted two rounds of review (both documented in `cdocs/reviews/`)
- Key revision: consolidated configuration from separate `projects.json` to `settings.json` under `wezterm.projects`
- Added SSH Domain Registration section explaining multi-call `apply_to_config` approach

## Verification

- [x] Research completed: WezTerm CLI capabilities documented
- [x] Proposal completed with full specification
- [x] Review round 1: revision requested (blocking issues)
- [x] Review round 2: accepted

**Implementation verification (pending):**
- [ ] CLI can list available projects
- [ ] CLI picker shows project names
- [ ] CLI connects to correct SSH domain
- [ ] CLI reuses existing workspace when available
- [ ] Works without existing WezTerm instance

## Deliverables

1. **Devlog**: `cdocs/devlogs/2026-02-04-wezterm-project-picker-cli.md` (this file)
2. **Proposal**: `cdocs/proposals/2026-02-04-wezterm-project-picker.md` (accepted after round 2)
3. **Reviews**:
   - `cdocs/reviews/2026-02-04-review-of-wezterm-project-picker.md` (round 1)
   - `cdocs/reviews/2026-02-04-r2-review-of-wezterm-project-picker.md` (round 2)

## Next Steps (Implementation)

1. Extend `~/.config/lace/settings.json` schema with `wezterm.projects`
2. Update wezterm.lua to iterate over projects and call `apply_to_config`
3. Implement `lace.show-project-picker` event in lace-plugin
4. Create `bin/wez-lace-into` script
5. Test end-to-end with multiple projects
