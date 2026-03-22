---
review_of: cdocs/proposals/2026-03-21-tmux-return-and-lace-into.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T15:45:00-07:00
task_list: terminal-management/tmux-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, implementation_plan, test_plan, edge_cases, terminal_management]
---

# Review: Return to tmux and Create lace-into

## Summary Assessment

This proposal defines a concrete implementation plan for two deliverables: a modernized tmux.conf in the dotfiles repo and a `lace-into` CLI tool replacing `wez-into`.
The document is well-structured, with detailed code samples, a clear phasing strategy, and strong traceability to both the legacy tmux.conf and the companion analysis reports.
The most important finding is that the proposal understates a critical ergonomic regression: new tmux splits do not automatically SSH into the container, requiring manual reconnection per pane.
This is acknowledged in a NOTE callout but not elevated to the edge cases section or addressed in the implementation phases.

Verdict: **Revise** - two blocking issues related to the split-inheritance gap and a missing implementation detail, plus several non-blocking improvements.

## Section-by-Section Findings

### BLUF and Summary

The BLUF is effective: it names both deliverables, references the legacy config as foundation, and lists the key modernization additions.
The summary correctly frames the companion reports as the decision basis and scopes what is and is not covered.

**Finding 1 (non-blocking):** The BLUF mentions "856 lines of bash" for wez-into.
This is accurate against the current file.
The summary section has a blank line between the two companion report references (line 26-27), which is a minor formatting nit.

### Objective

Clear and well-scoped.
The four objectives map directly to the deliverables.

### Background

The background section provides good coverage of all four source components (legacy tmux.conf, vscode shell entrypoint, wez-into, lace-discover).

**Finding 2 (non-blocking):** The legacy tmux.conf background says "Alt-c copy mode" and lists "v to begin selection, clipboard integration."
The actual legacy config (line 60-62) binds `v` to `begin-selection` and `c` to `copy-pipe` (non-deselecting copy), not `y`.
The proposed config changes this to `y` for `copy-pipe-and-cancel`.
This is a deliberate improvement, but the background section implies the legacy config used standard vim-style yank, which it did not.
A NOTE callout acknowledging this deliberate deviation would add clarity.

### Proposed Solution: tmux.conf

The tmux.conf section is thorough, with inline code blocks that are directly implementable.

**Finding 3 (non-blocking):** The proposed `is_vim` detection uses `ps -o state= -o comm= -t '#{pane_tty}'`, which is an update from the legacy config's `echo "#{pane_current_command}" | grep ...` approach.
However, the proposal also lists `smart-splits.nvim` in the plugin stack.
If `smart-splits.nvim` is used with its tmux backend, the manual `is_vim` bindings become redundant: smart-splits handles the bidirectional navigation internally.
The proposal should clarify whether the manual `is_vim` bindings are intended as a fallback (in case smart-splits is not installed) or whether smart-splits replaces them entirely.
If the latter, the `is_vim` bindings should be removed from the proposed config to avoid confusion.

**Finding 4 (non-blocking):** The copy mode bindings use `wl-copy` as the clipboard command (line 173).
This is Wayland-specific.
The legacy config had both `wl-copy` and `xclip` (commented out) for X11.
The proposal should note this Wayland dependency or use a conditional / `tmux-yank` (which handles clipboard detection automatically).
Since `tmux-yank` is already in the plugin stack, the manual `copy-pipe-and-cancel "wl-copy"` binding may conflict with or duplicate yank's behavior.

**Finding 5 (non-blocking):** The `after-new-session` hook uses `echo "#{session_name}" | grep -iqE "^vscode"` inside `set-hook`.
The legacy config (line 168-171) does the same but assigns the grep to a variable first.
The proposed version inlines it into `if-shell`, which is cleaner.
However, the `TMUX_NESTED` conditional (lines 199-201) runs at config load time, not per-session.
If a user starts tmux normally and later wants a nested instance with `TMUX_NESTED`, the config would need to be re-sourced.
This is an edge case but worth a NOTE.

**Finding 6 (non-blocking):** The plugin list includes `tmux-plugins/tmux-battery` in the legacy config but the proposal drops it without comment.
The legacy status bar format used `#{battery_percentage}#{battery_remain}`.
If catppuccin replaces the status bar entirely, this is fine, but worth noting the battery indicator is intentionally dropped.

### Proposed Solution: lace-into

**Finding 7 (blocking):** The `do_connect()` function creates a tmux session with `tmux new-session -d -s "$project" "${ssh_base[@]}"`.
This passes the SSH command as the session's initial command.
When the SSH connection terminates (container restart, network drop), the pane dies and the session may close (depending on `remain-on-exit` settings).
The proposal does not set `remain-on-exit` or `destroy-unattached` for lace-into sessions.
Without `remain-on-exit on`, a dead SSH connection kills the pane, losing the session layout.
This should be addressed explicitly: either set `remain-on-exit on` in `do_connect()` or document the expected behavior.

**Finding 8 (blocking):** The proposal's most significant trade-off - new splits not automatically SSHing into the container - is buried in a NOTE callout at line 376-379.
This is a daily-use regression from wez-into's ExecDomain behavior, where every split in a tab automatically connected to the same container.
The proposal suggests "a tmux keybinding or shell alias can automate this" but does not include this in the implementation phases.
This should be elevated to either:
  (a) A concrete implementation item in Phase 2 (e.g., a `lace-split` tmux keybinding that creates a new pane and runs SSH to the current session's container), or
  (b) An explicit "Known Limitations" section that frames this as a conscious Phase 1 trade-off with a follow-up task.

Without this, users migrating from wez-into will hit a sharp ergonomic cliff on their first `Alt-H` split.

**Finding 9 (non-blocking):** The session name conflict mitigation (lines 478-483) describes disambiguating with `project-22426`, but the `do_connect()` code sample does not implement this.
The code checks `tmux has-session` and attaches if it exists, but does not verify the existing session's SSH port matches.
This is a gap between the prose description and the implementation sample.

**Finding 10 (non-blocking):** The SSH `ControlPath` uses `$HOME/.ssh/lace-ctrl-%C`.
The `%C` token expands to a hash of the connection parameters.
However, if the user manually SSHs to the same container from a different context, the ControlMaster socket may conflict or not be reused as expected.
A more specific path like `$HOME/.ssh/lace-ctrl-%r@%h-%p` would make the socket naming more predictable and debuggable.

### Important Design Decisions

This section is well-structured and covers the key choices.

**Finding 11 (non-blocking):** The "Nushell as Default Shell" section has a TODO about `wez-session.nu` needing a tmux equivalent.
This is addressed in Phase 3 but the TODO callout lacks the full attribution format: `TODO(opus/terminal-management)` is present but the TODO text could be more actionable by referencing Phase 3 explicitly.

### Edge Cases / Challenging Scenarios

**Finding 12 (non-blocking):** The "Container Restart Mid-Session" section says SSH `ControlPersist=600` "keeps the master connection alive for 10 minutes after the last client disconnects."
This is slightly misleading: `ControlPersist=600` keeps the master open for 10 minutes after the last *multiplexed* client disconnects, not after the container restarts.
If the container process dies, the TCP connection breaks regardless of ControlPersist.
ControlPersist helps when the user closes a pane voluntarily and wants to reconnect quickly, not when the remote host goes away.

**Finding 13 (non-blocking):** The edge cases section does not address what happens when tmux is already running with a server that has different config (e.g., during the migration period when both wezterm and tmux are in use, or when an existing tmux session from a different config is active).
`tmux new-session` inherits the running server's config, not the user's tmux.conf at that moment.
This could cause confusion during the transition period.

**Finding 14 (non-blocking):** Missing edge case: what happens when `lace-into` is called from inside a tmux session that is itself inside a container (nested tmux via SSH)?
The `$TMUX` check on line 301 would detect the inner tmux, but `switch-client` would switch within the inner server, not the outer one.
This may be an unlikely scenario but is worth noting given the vscode nesting patterns in the legacy config.

### Test Plan

**Finding 15 (non-blocking):** The test plan is comprehensive for the happy path but lacks negative/failure testing:
- No test for container restart mid-session (edge case 1).
- No test for SSH key mismatch or expired ControlMaster socket.
- No test for `lace-into` when tmux server is not running (should it auto-start?).
- No test for concurrent `lace-into` calls to the same project (race on session creation).
The `tmux has-session` check and `tmux new-session -d` are not atomic: two concurrent calls could both pass the check and both attempt to create the session.

**Finding 16 (non-blocking):** Test plan item 3 says "verify tmux session is created with SSH pane to container, pane title is set."
This should also verify the SSH connection is functional (e.g., run a command in the pane and check output), not just that the pane exists.

### Implementation Phases

The four-phase structure is logical and the constraints are well-defined.

**Finding 17 (non-blocking):** Phase 4 step 4 says "Update `bin/wez-into` help text to note deprecation in favor of `lace-into`."
This contradicts the Phase 2 constraint "Do not modify `bin/wez-into`."
Phase 4's constraint relaxes this ("Do not remove wez-into"), but the contradiction with Phase 2 should be noted or the deprecation notice should be clearly scoped to Phase 4 only.

**Finding 18 (non-blocking):** Phase 4 step 5 says "Add `lace-into` to PATH (symlink in `~/.local/bin/` or chezmoi script)."
The proposal does not specify which approach is preferred.
Given that wez-into is in `bin/` within the lace repo and appears to be found via `$SCRIPT_DIR`, the same pattern should apply to lace-into.
If chezmoi manages the symlink, this should be a Phase 1 item (since the tmux.conf is already chezmoi-managed), not Phase 4.

### Frontmatter

**Finding 19 (non-blocking):** The frontmatter is valid.
`status: review_ready` is correct for this stage.
The `task_list` uses `terminal-management/tmux-migration` which is consistent with the companion reports' `terminal-management/zellij-migration`.
The tag set is appropriate.

### Writing Conventions

**Finding 20 (non-blocking):** Several instances of history-agnostic framing violations:
- Line 54: "Legacy tmux.conf" - acceptable since it references the archived file.
- Line 146: "Updated is_vim detection for modern ps output" - the word "Updated" implies a change from a prior state. Should be "Uses ps-based is_vim detection" or similar.
- The proposal generally handles history-agnostic framing well in the body, with the changes framed in NOTE callouts where needed.

## Verdict

**Revise** - The proposal is solid in structure and scope but has two blocking issues that should be resolved before implementation:

1. The split-inheritance regression (new panes not auto-SSHing to the container) needs to be elevated from a buried NOTE to either a concrete implementation item or an explicit known-limitations section with a follow-up task.
2. The `do_connect()` function needs to address `remain-on-exit` behavior for SSH panes that lose connectivity.

## Action Items

1. [blocking] Elevate the split-inheritance gap from the NOTE callout at line 376 to either: (a) a concrete keybinding/automation in Phase 2 implementation, or (b) a prominent "Known Limitations" section with a tracked follow-up. The current NOTE buries a daily-use regression.
2. [blocking] Address `remain-on-exit` behavior in `do_connect()`. When SSH dies, panes should not silently vanish. Either set `remain-on-exit on` for lace-into sessions or document the expected behavior and recovery path.
3. [non-blocking] Clarify the relationship between manual `is_vim` bindings and `smart-splits.nvim`. If smart-splits handles navigation, the manual bindings are redundant.
4. [non-blocking] Resolve the `wl-copy` Wayland dependency in copy mode bindings. Consider relying on `tmux-yank` (already in the plugin stack) instead of manual `copy-pipe-and-cancel`.
5. [non-blocking] Implement the session-name-conflict disambiguation described in prose (lines 478-483) in the `do_connect()` code sample, or remove the claim.
6. [non-blocking] Correct the `ControlPersist` description in edge cases: it does not help with container restarts (the TCP connection breaks regardless).
7. [non-blocking] Add negative test cases: container restart mid-session, SSH key mismatch, concurrent `lace-into` calls, tmux server not running.
8. [non-blocking] Resolve the Phase 2 vs Phase 4 contradiction regarding wez-into modification.
9. [non-blocking] Fix history-agnostic framing: "Updated is_vim detection" should be reworded.
