---
first_authored:
  by: "@claude-opus-4-6-20250626"
  at: 2026-03-26T15:00:00-07:00
task_list: lace/fix-tmux-path-resolution
type: devlog
state: archived
status: done
tags: [tmux, lace-split, lace-paste-image, bug-fix]
---

# Fix lace-split and lace-paste-image in tmux run-shell Context: Devlog

## Objective

`lace-split` and `lace-paste-image` are broken when invoked from tmux keybindings.
Two root causes:

1. **PATH not set in tmux run-shell context.** tmux `run-shell` uses `/bin/sh` with a minimal system PATH that does not include `~/.local/bin` or `~/.cargo/bin`. The lace scripts are symlinked into `~/.local/bin` but unreachable.
2. **Symlink-unaware SCRIPT_DIR resolution.** `lace-split` computes `SCRIPT_DIR` from `BASH_SOURCE[0]`, which is the symlink path (`~/.local/bin/lace-split`), not the target. `lace-lib.sh` lives beside the real script, not beside the symlink.

Secondary goal: add fallback behavior so tmux keybindings degrade gracefully when lace scripts fail.

## Plan

1. Fix tmux.conf: add `set-environment -g PATH` to prepend `~/.local/bin` and `~/.cargo/bin` to the system PATH.
2. Fix `lace-split` and `lace-into`: resolve symlinks in SCRIPT_DIR computation so `lace-lib.sh` is found regardless of invocation path.
3. Add fallback behavior: modify tmux keybindings to fall back to standard split/paste when lace scripts fail.
4. Verify all fixes in the live tmux session.

## Testing Approach

Live verification in the running tmux session:
- `tmux run-shell 'lace-split -h'` should succeed.
- Alt+L keybinding in a lace session pane should produce a container-aware split.
- Alt+L in a local pane should produce a local split.
- If lace-split somehow fails, the fallback should produce a plain split.

## Debugging Process

### Phase 1: Root Cause Investigation

Evidence:
- `tmux run-shell 'echo $PATH'` returns minimal system PATH without `~/.local/bin` or `~/.cargo/bin`.
- `tmux run-shell 'lace-split -h'` fails with `sh: line 1: lace-split: command not found`.
- After manually fixing PATH via `set-environment`, lace-split is found but fails sourcing `lace-lib.sh` because `SCRIPT_DIR` resolves to the symlink directory (`~/.local/bin`) instead of the real script directory.

### Phase 2: Pattern Analysis

- `lace-disconnect-pane` has the same PATH issue but doesn't source `lace-lib.sh`, so it would work once PATH is fixed.
- `lace-paste-image` has a double problem: PATH misses both `~/.local/bin` (script location) and `~/.cargo/bin` (nu interpreter).
- The `SCRIPT_DIR` pattern `cd "$(dirname "${BASH_SOURCE[0]}")" && pwd` is common but does not resolve symlinks.

### Phase 3: Additional Discovery

`tmux show-option -pqv @lace_container` (without explicit `-t`) reads the "current" pane, which in `run-shell` context is determined by the triggering client.
When tested via `tmux run-shell -t '%17'` from a different client, the "current pane" is the caller's active pane, not `%17`.
The `-t` flag on `run-shell` only changes output destination, not command context.

Fix: pass `#{pane_id}` explicitly from the tmux keybinding and use `-t` in all tmux sub-commands within `lace-split`.
This makes the script work correctly regardless of which client or context triggers it.

### Phase 4: Fix and Verify

Three independent fixes applied and verified:

1. `set-environment -g PATH` in tmux.conf: provides `~/.local/bin`, `~/.cargo/bin`, and linuxbrew to all `run-shell` invocations.
2. Symlink-resolving `SCRIPT_DIR` in `lace-split`, `lace-into`, `lace-discover`: follows symlinks to find `lace-lib.sh` at the real script directory.
3. Explicit `-t #{pane_id}` in all tmux keybindings + `lace-split` `-t` parameter: reliable pane targeting.
4. `|| tmux split-window` / `|| tmux send-keys C-v` fallback in every keybinding: degrades to plain tmux behavior on script failure.

## Implementation Notes

The stale pre-migration metadata (`@lace_port` instead of `@lace_container`, `/workspaces/lace` instead of `/workspaces/lace/main`) on `lace-local` session was cleaned up.
This was left over from the SSH-based connection model.

## Changes Made

| File | Description |
|------|-------------|
| `bin/lace-split` | Added symlink resolution for SCRIPT_DIR, `-t pane_id` parameter for explicit targeting |
| `bin/lace-into` | Added symlink resolution for SCRIPT_DIR |
| `bin/lace-discover` | Added symlink resolution for SCRIPT_DIR |
| `dotfiles/dot_config/tmux/tmux.conf` | Added `set-environment -g PATH`, `-t #{pane_id}` to all lace keybindings, fallback `||` behavior |

> NOTE: The tmux.conf changes are in the dotfiles repo at `/var/home/mjr/code/personal/dotfiles/dot_config/tmux/tmux.conf`, not the lace repo.

## Verification

### lace-split container-aware split
```
Before: 1 panes
EXIT=0
After: 2 panes
--- Pane details ---
%29: cmd=podman
@lace_container lace
@lace_user node
@lace_workspace /workspaces/lace/main
%30: cmd=podman
@lace_container lace
@lace_user node
@lace_workspace /workspaces/lace/main
```

Both panes running podman exec (container entry), both with correct metadata propagated.

### Fallback behavior
```
Before: 1 panes
After: 2 panes
%17 dead=0 cmd=podman
%26 dead=0 cmd=nu
```

When lace-split fails (`false ||`), fallback creates a local split running nu (default shell).

### PATH resolution
```
PATH=/home/mjr/.local/bin:/home/mjr/.cargo/bin:/home/linuxbrew/.linuxbrew/bin:/usr/lib64/ccache:/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin
```

### Keybinding registration
All bindings correctly registered with `-t "#{pane_id}"` and `||` fallback.
