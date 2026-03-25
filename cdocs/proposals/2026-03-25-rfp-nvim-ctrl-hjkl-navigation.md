---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-25T16:05:00-07:00
task_list: dotfiles/nvim-config
type: proposal
state: live
status: request_for_proposal
tags: [neovim, keybindings, tmux, wezterm]
---

# RFP: Fix ctrl+hjkl Navigation in Neovim

> BLUF: ctrl+hjkl for pane/split navigation is broken in neovim, both locally and in containers. Diagnose the conflict chain (neovim, tmux, wezterm) and fix it.

## Problem

ctrl+h/j/k/l is expected to navigate between neovim splits and tmux panes seamlessly (typically via a plugin like `vim-tmux-navigator` or `smart-splits.nvim`).
The keybindings are currently non-functional in both local and container neovim instances.
This suggests the issue is in the neovim or tmux config, not container-specific.

## Scope of Proposal

1. **Diagnose the binding chain**: Which layer is consuming or dropping ctrl+hjkl? (wezterm -> tmux -> neovim)
2. **Identify the navigation plugin in use**: Check the neovim config for tmux-navigator integrations.
3. **Fix the keybinding conflict**: Ensure ctrl+hjkl works for split navigation in neovim (both with and without tmux).

## Considerations

- wezterm may be intercepting ctrl+h (common: mapped to backspace in some terminals).
- tmux may have its own ctrl+hjkl bindings that shadow neovim's.
- The neovim config is deployed via chezmoi from `~/code/personal/dotfiles/dot_config/nvim/`.
- This is a dotfiles issue, not a lace issue, but affects the lace developer experience.
