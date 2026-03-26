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

## Implementation Notes

## Changes Made

| File | Description |
|------|-------------|

## Verification
