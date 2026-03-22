---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-22T00:15:00-07:00
task_list: session-management/in-container-splits
type: proposal
state: live
status: wip
tags: [tmux, lace-into, keybindings, session-management]
---

# In-Container Splits for Alt+HJKL in Lace Sessions

> BLUF: Alt+HJKL splits in lace tmux sessions create local panes instead of container panes.
> Fix: make Alt+HJKL conditionally dispatch to SSH splits (like Alt+S) when `@lace_port` is set, preserving local split behavior in non-lace sessions.
> Alt+S becomes redundant and can be removed or repurposed.

## Summary

When a user creates splits in a lace tmux session (one created by `lace-into`), they expect all panes to be inside the container.
The current keybinding scheme has two groups:

1. **Alt+HJKL** (lines 57-60 of `tmux.conf`): always creates local splits using `#{pane_current_path}`
2. **Alt+S** (lines 109-130 of `tmux.conf`): conditionally creates SSH splits into the container when `@lace_port` is set, falling back to local splits otherwise

The user must remember to use Alt+S instead of Alt+HJKL for container splits, which is an extra cognitive burden and inconsistent with the expectation that "everything in a lace session is container-side."

This proposal folds the Alt+S conditional SSH split logic into Alt+HJKL, making the primary split bindings container-aware.

## Objective

Make Alt+HJKL splits container-aware in lace sessions:

- **Lace session** (`@lace_port` set): Alt+HJKL creates SSH panes into the container in the specified direction
- **Non-lace session** (`@lace_port` unset): Alt+HJKL creates local splits (current behavior)

Secondarily: remove or repurpose Alt+S now that Alt+HJKL handles both cases.

## Background

### Current tmux.conf Split Architecture

The split bindings use two distinct mechanisms:

**Alt+HJKL (local splits):**
```tmux
bind -n M-l split-window -h -c '#{pane_current_path}'
bind -n M-h split-window -h -c '#{pane_current_path}' \; swap-pane -U
bind -n M-j split-window -v -c '#{pane_current_path}'
bind -n M-k split-window -v -c '#{pane_current_path}' \; swap-pane -U
```

**Alt+S (conditional SSH split):**
```tmux
bind -n M-S run-shell '\
  port=$(tmux show-option -qv @lace_port); \
  user=$(tmux show-option -qv @lace_user); \
  ws=$(tmux show-option -qv @lace_workspace); \
  if [ -n "$port" ]; then \
    ...build SSH command and split-window -h...; \
  else \
    tmux split-window -h -c "#{pane_current_path}"; \
  fi'
```

The directional semantics differ:
- Alt+L: `split-window -h` (split right)
- Alt+H: `split-window -h` + `swap-pane -U` (split left)
- Alt+J: `split-window -v` (split down)
- Alt+K: `split-window -v` + `swap-pane -U` (split up)

Alt+S always splits horizontally (`split-window -h`) with no directional control.

### Session Options Set by lace-into

`lace-into` stores connection metadata as tmux session-level user options when creating a session:

```bash
tmux set-option -t "$project" @lace_port "$port"
tmux set-option -t "$project" @lace_user "$user"
tmux set-option -t "$project" @lace_workspace "$workspace"
```

These options are available to any keybinding via `tmux show-option -qv`.

### tmux `if-shell` for Conditional Dispatch

tmux's `if-shell` command runs a shell command and dispatches to one of two tmux command strings based on the exit code:

```tmux
if-shell 'tmux show-option -qv @lace_port | grep -q .' \
  'lace-aware split command' \
  'local split command'
```

The test `tmux show-option -qv @lace_port | grep -q .` succeeds (exit 0) when `@lace_port` has a non-empty value, and fails (exit 1) when the option is unset or empty.

> NOTE(opus/in-container-splits): `if-shell` runs asynchronously by default.
> This is fine for our use case: the split command executes in the shell callback and does not depend on synchronous return.

## Proposed Solution

### 1. Replace Alt+HJKL with Conditional Split Bindings

Each Alt+HJKL binding becomes an `if-shell` dispatch that tests `@lace_port` and runs either an SSH split or a local split.

The SSH split command follows the same template as the existing Alt+S binding, with two changes:
- The split direction varies per binding (not always `-h`)
- Directional modifiers (`swap-pane -U`) are preserved for Alt+H and Alt+K

#### Helper Script: `lace-split`

To avoid duplicating the SSH command template four times in `tmux.conf`, extract the SSH split logic into a helper script.

**File:** `bin/lace-split` (in the lace repo, on PATH alongside `lace-into`)

```bash
#!/bin/bash
# lace-split -- Create a tmux split pane SSH'd into the current lace session's container.
#
# Usage: lace-split [-h|-v] [-U]
#   -h    Horizontal split (default)
#   -v    Vertical split
#   -U    Swap pane upward after split (for left/up directions)
#
# Reads @lace_port, @lace_user, @lace_workspace from the current tmux session.
# If @lace_port is unset, falls back to a local split.

set -euo pipefail

SPLIT_FLAG="-h"
SWAP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h) SPLIT_FLAG="-h"; shift ;;
    -v) SPLIT_FLAG="-v"; shift ;;
    -U) SWAP=true; shift ;;
    *) shift ;;
  esac
done

port=$(tmux show-option -qv @lace_port)
user=$(tmux show-option -qv @lace_user)
ws=$(tmux show-option -qv @lace_workspace)

if [ -z "$port" ]; then
  # Not a lace session: local split
  tmux split-window "$SPLIT_FLAG" -c "#{pane_current_path}"
  if [ "$SWAP" = true ]; then
    tmux swap-pane -U
  fi
  exit 0
fi

# Build SSH command
ssh_cmd="ssh -o IdentityFile=$HOME/.config/lace/ssh/id_ed25519 \
     -o IdentitiesOnly=yes \
     -o UserKnownHostsFile=$HOME/.ssh/lace_known_hosts \
     -o StrictHostKeyChecking=no \
     -o ControlMaster=auto \
     -o \"ControlPath=$HOME/.ssh/lace-ctrl-%C\" \
     -o ControlPersist=600 \
     -t -p $port ${user:-node}@localhost"

if [ -n "$ws" ]; then
  ssh_cmd="$ssh_cmd \"cd $ws && exec \\\$SHELL -l\""
fi

tmux split-window "$SPLIT_FLAG" "$ssh_cmd"
if [ "$SWAP" = true ]; then
  tmux swap-pane -U
fi
```

#### tmux.conf Bindings

Replace the four Alt+HJKL bindings with calls to `lace-split`:

```tmux
# Pane creation: container-aware in lace sessions, local otherwise
bind -n M-l run-shell 'lace-split -h'
bind -n M-h run-shell 'lace-split -h -U'
bind -n M-j run-shell 'lace-split -v'
bind -n M-k run-shell 'lace-split -v -U'
```

> NOTE(opus/in-container-splits): An alternative approach uses inline `if-shell` without a helper script.
> This duplicates the SSH command template four times, making the config harder to maintain.
> The helper script approach is preferred for DRY and testability.

### 2. Remove Alt+S

With Alt+HJKL now handling container-aware splits in all four directions, Alt+S is redundant.
Remove the Alt+S binding and its associated comment block (lines 102-130 of `tmux.conf`).

> NOTE(opus/in-container-splits): If there is a desire to keep Alt+S as a quick "split right into container" shortcut (muscle memory), it can be retained as an alias for `lace-split -h`.
> This proposal recommends removal to reduce keybinding surface area.

### 3. Alternative: Inline `if-shell` (No Helper Script)

If adding a helper script to PATH is undesirable, the conditional logic can be inlined in `tmux.conf` using `run-shell`:

```tmux
bind -n M-l run-shell '\
  port=$(tmux show-option -qv @lace_port); \
  if [ -n "$port" ]; then \
    user=$(tmux show-option -qv @lace_user); \
    ws=$(tmux show-option -qv @lace_workspace); \
    remote_cmd=""; \
    if [ -n "$ws" ]; then remote_cmd="cd $ws && exec \\$SHELL -l"; fi; \
    tmux split-window -h \
      "ssh -o IdentityFile=$HOME/.config/lace/ssh/id_ed25519 \
           -o IdentitiesOnly=yes \
           -o UserKnownHostsFile=$HOME/.ssh/lace_known_hosts \
           -o StrictHostKeyChecking=no \
           -o ControlMaster=auto \
           -o \"ControlPath=$HOME/.ssh/lace-ctrl-%C\" \
           -o ControlPersist=600 \
           -t -p $port ${user:-node}@localhost $remote_cmd"; \
  else \
    tmux split-window -h -c "#{pane_current_path}"; \
  fi'
```

This would need to be repeated (with appropriate `-h`/`-v` and `swap-pane -U` variations) for all four directions.
The inline approach trades PATH dependency for config verbosity.

## Important Design Decisions

### Helper Script vs. Inline

The helper script approach (`lace-split`) is recommended because:

1. **DRY**: The SSH command template exists in one place, not four
2. **Testable**: `lace-split --help` or dry-run flags can be added for debugging
3. **Consistent**: Follows the pattern of `lace-into` and `lace-discover` as standalone tools
4. **Maintainable**: SSH options, key paths, and workspace logic change in one file

The trade-off: `lace-split` must be on PATH.
Since `lace-into` and `lace-discover` already need to be on PATH, this is not a new requirement.

### `run-shell` vs. `if-shell`

Both tmux mechanisms work for conditional dispatch.
`run-shell` with an inline shell script is more flexible (can set variables, build commands dynamically).
`if-shell` is cleaner for simple condition/true/false dispatch.

With the helper script approach, `run-shell 'lace-split -h'` is the simplest form: all logic lives in the script.

### Preserving Directional Semantics

The `swap-pane -U` trick for Alt+H (split left) and Alt+K (split up) works by:
1. Creating a split in the default direction (right for `-h`, down for `-v`)
2. Swapping the new pane "upward" in the pane layout, effectively moving it to the other side

This must work for both local and SSH splits.
The helper script applies `swap-pane -U` after the `split-window` command, which works regardless of whether the split pane runs a local shell or an SSH command.

### `#{pane_current_path}` in SSH Splits

Local splits use `#{pane_current_path}` to inherit the working directory.
SSH splits use `@lace_workspace` to set the remote working directory.

These are independent: `#{pane_current_path}` refers to the local filesystem path, which is meaningless inside the container.
The SSH split command uses `cd $workspace` on the remote side instead.

If `@lace_workspace` is unset, the SSH split lands in the remote user's home directory.

### Removing Alt+S

Alt+S was the only container-aware split binding.
With Alt+HJKL now conditionally container-aware, Alt+S is fully redundant.

Keeping Alt+S as an alias adds no functionality but occupies a keybinding slot and adds maintenance surface.
Users who have built muscle memory for Alt+S can transition to Alt+L (identical behavior: split right into container).

## Edge Cases

### `lace-split` Not on PATH

If `lace-split` is not installed or not on PATH, `run-shell 'lace-split -h'` fails silently (tmux shows a brief error in the status line).
No split is created.

Mitigation: install `lace-split` alongside `lace-into` (same `bin/` directory, same symlink/PATH setup).

### `@lace_workspace` Unset

If `lace-into` is run against a container where `lace-discover` does not return a workspace path, `@lace_workspace` is empty.
The SSH split lands in the remote user's home directory.

This is acceptable: the user can `cd` manually.
It matches the behavior of SSH without a remote command.

### SSH Connection Failure

If the container is stopped or the SSH port is unreachable, the SSH split opens a pane that immediately shows the SSH error and exits.
With `remain-on-exit failed` (set by `lace-into`), the pane shows a "Pane is dead" indicator.

The user can respawn the pane (prefix + R) after fixing the container.

### Non-Lace tmux Sessions

Sessions created without `lace-into` (e.g., plain `tmux new-session`) do not have `@lace_port` set.
Alt+HJKL falls back to local splits with `#{pane_current_path}` inheritance.
Behavior is identical to the current bindings.

### Nested tmux (TMUX_NESTED)

In nested tmux contexts (vscode sessions), keybindings may be suppressed by the outer tmux.
This is an existing concern not introduced by this change.

## Test Plan

### 1. Lace Session: Container Splits

1. Start a devcontainer: `lace-into --start <project>`
2. Press Alt+L in the lace session
3. **Verify**: new pane opens with a container shell (check `hostname` or `whoami`)
4. **Verify**: `pwd` shows the workspace directory (if `@lace_workspace` was set)
5. Press Alt+J
6. **Verify**: vertical split also lands in the container
7. Press Alt+H
8. **Verify**: split appears to the left, inside the container
9. Press Alt+K
10. **Verify**: split appears above, inside the container

### 2. Non-Lace Session: Local Splits

1. Create a plain tmux session: `tmux new-session -s test`
2. Press Alt+L
3. **Verify**: local nushell shell opens in the current directory
4. Press Alt+J
5. **Verify**: local nushell shell opens in the current directory (vertical split)

### 3. Alt+S Removal Verification

1. In a lace session, press Alt+S
2. **Verify**: no split occurs (binding removed), or a status line error appears briefly
3. Confirm no regression from the removal

### 4. Fallback When lace-split Missing

1. Temporarily rename `lace-split` so it is not on PATH
2. Press Alt+L in any session
3. **Verify**: tmux briefly shows an error in the status line, no split created
4. Restore `lace-split`

### 5. SSH Failure Handling

1. Stop the container: `docker stop <container>`
2. Press Alt+L in the lace session
3. **Verify**: pane opens, SSH fails, pane shows error or "Pane is dead"
4. Restart the container and respawn pane (prefix + R)
5. **Verify**: pane reconnects successfully

## Implementation Phases

### Phase 1: Create `bin/lace-split` Helper Script

**Files**: `bin/lace-split` (new, in the lace repo)

1. Create `bin/lace-split` with the script from the Proposed Solution
2. Make it executable
3. Test manually: `lace-split -h`, `lace-split -v`, `lace-split -v -U`
4. Verify local fallback: run in a non-lace session, confirm local split
5. Verify SSH split: run in a lace session, confirm container split

### Phase 2: Update `tmux.conf` Keybindings

**Files**: `~/code/personal/dotfiles/dot_config/tmux/tmux.conf` (chezmoi-managed)

1. Replace Alt+HJKL bindings (lines 57-60) with `run-shell 'lace-split ...'` calls
2. Remove the Alt+S binding and its comment block (lines 102-130)
3. `chezmoi apply` to deploy
4. Reload tmux config: `tmux source-file ~/.config/tmux/tmux.conf`
5. Run test plan items 1-5

### Phase 3: PATH and Installation

**Files**: installation/symlink documentation

1. Ensure `lace-split` is symlinked to `~/.local/bin/` alongside `lace-into` and `lace-discover`
2. Verify all three tools are on PATH
3. End-to-end test: fresh tmux session, `lace-into <project>`, Alt+HJKL splits, verify container shells
