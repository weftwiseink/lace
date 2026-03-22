---
review_of: cdocs/devlogs/2026-03-21-tmux-migration-implementation.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T13:15:17-07:00
task_list: terminal-management/tmux-migration
type: review
state: live
status: done
tags: [self, architecture, implementation_fidelity, migration]
---

# Review: tmux Migration Implementation

## Summary Assessment

The devlog documents a four-phase migration from wezterm multiplexing to tmux, implementing the accepted proposal.
The implementation is faithful to the proposal across all phases: tmux.conf matches the spec, `lace-into`'s `do_connect()` matches the proposal's code sample verbatim, nushell cleanup is clean, and wezterm-server deletion is thorough.
The work went beyond the proposal's explicit scope in useful ways (CI workflow cleanup, lock file update, dotfiles devcontainer cleanup).
Verdict: **Accept**.

## Section-by-Section Findings

### Phase 1: tmux.conf + Strip Wezterm

**tmux.conf** (159 lines): All proposal sections are present and correctly combined: core settings, keybindings, pane titles, conditional UI, plugin stack.
The `lace-split` keybinding (Alt-S) was included here rather than Phase 2. The devlog correctly notes this deviation.
This is a sensible choice: the tmux.conf was being created fresh, and the keybinding belongs in the config file.

**Stripped wezterm.lua** (76 lines): Clean reduction from ~610 lines.
Retains font, colors, window settings, shell, and a single mouse binding.
Correctly removed: mux domains, plugins, ExecDomains, smart-splits, session logic, copy mode customization, status bar, keybindings.
`config.enable_tab_bar = false` is a good addition: with tmux managing windows, wezterm's tab bar is noise.

**TPM bootstrap script**: Correct chezmoi `run_once_after` naming convention. Minimal and correct.

**Theme archive**: The `archive/themes/slate-solarized.lua` preserves the full palette and color table as a reusable Lua module with return value, not just a dump. Good.

**Non-blocking**: The `inactive_pane_hsb` in the stripped wezterm config is vestigial: with tmux managing panes and wezterm having no tab bar or splits, wezterm will never have "inactive panes." Harmless but dead code.

### Phase 2: lace-into

**do_connect()**: Matches the proposal's code sample exactly, with the addition of dry-run handling.
SSH ControlMaster options are correct.
Session existence check, port disambiguation, `$TMUX` detection, `remain-on-exit`, `@lace_port`/`@lace_user` session options are all present.

**Multiplexer-agnostic code**: The git diff confirms rename detection (75% similarity), meaning the bulk of the script carried forward.
All wezterm references in the script are eliminated: no `wezterm`, `XKB_LOG_LEVEL`, `python3`, `ExecDomain`, or `mux` references remain.

**Help text**: Updated to tmux terminology. Examples use `lace-into` consistently.

**Dry-run output**: Shows both SSH args and tmux session commands. Informative.

**Non-blocking**: The `do_connect` prerequisite check for `tmux` on PATH (equivalent to the old `wezterm` check) is absent.
The function will fail with an opaque error if tmux is not installed.
The old wez-into had `if ! command -v wezterm &>/dev/null; then err "wezterm not found on PATH"; exit 1; fi`.
This is a minor gap: tmux is almost certainly installed if the user is running lace-into, and the `tmux new-session` failure message is reasonably clear.

### Phase 3: Nushell Config Updates

Clean removal of `wez-session.nu` and the pre-prompt hook (30 lines of hook code + 89 lines of module).
The `source wez-session.nu` line is gone from config.nu.
`wt-clone.nu` correctly preserved (not wezterm-specific despite the `wt-` prefix).
env.nu path comment updated.

The proposal mentioned adding "a tmux-aware startup hook" and "alias sshc" (Phase 3 steps 3-4), but neither was implemented.
This is acceptable: the proposal framed these as optional ("tmux-aware equivalents"), and tmux-resurrect handles session persistence at the tmux level, making a nushell hook unnecessary.

### Phase 4: Cleanup

Thorough cleanup:
- Feature source and test directories deleted.
- Lock file entry removed.
- CI workflow step removed.
- `lace.wezterm` repoMount removed from devcontainer.json.
- Dotfiles devcontainer.json cleaned up (not explicitly in the proposal's Phase 4 scope, but correct).

The verification section with grep results is valuable: it gives confidence that no stale references remain in config or scripts, and clearly explains why test fixture references are acceptable.

> NOTE(opus/terminal-management): The `standard.jsonc` test fixture at `packages/lace/src/__fixtures__/devcontainers/standard.jsonc` still references wezterm-server.
> This is correctly identified in the devlog's NOTE callout as mock data that doesn't depend on the actual feature directory.

### Devlog Quality

BLUF is clear and complete: states what was done, how many phases, which repos.
Commit listing at the end provides traceability.
The NOTE callout about test fixture references is well-placed and well-reasoned.
No "Issues Encountered and Solved" content, which is accurate for a straightforward implementation.

## Verdict

**Accept.**

The implementation is faithful to the proposal, the cleanup is thorough, and the devlog accurately documents the work.
The two non-blocking findings (vestigial `inactive_pane_hsb`, missing tmux prerequisite check) are minor.

## Action Items

1. [non-blocking] Consider removing `config.inactive_pane_hsb` from the stripped wezterm config: it has no effect with `enable_tab_bar = false` and no wezterm-level pane splitting.
2. [non-blocking] Consider adding a tmux prerequisite check in `do_connect()` (like the old wezterm check) for clearer error messaging when tmux is not installed.
