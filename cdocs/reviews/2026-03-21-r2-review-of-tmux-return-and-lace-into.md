---
review_of: cdocs/proposals/2026-03-21-tmux-return-and-lace-into.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T17:30:00-07:00
task_list: terminal-management/tmux-migration
type: review
state: live
status: done
tags: [rereview_agent, architecture, implementation_plan, test_plan, terminal_management]
---

# Review (Round 2): Return to tmux and Create lace-into

## Summary Assessment

This proposal defines a modernized tmux.conf and a `lace-into` CLI tool replacing `wez-into`.
All nine action items from the round 1 review have been substantively addressed: the two blocking issues (split-inheritance regression and `remain-on-exit` gap) are resolved with concrete implementations, and the seven non-blocking items show careful integration rather than minimal patches.
The most notable new concern is a path-hardcoding fragility in the `lace-split` keybinding, which duplicates SSH paths that exist as variables in the `lace-into` script.

Verdict: **Accept** with minor non-blocking suggestions.

## Round 1 Resolution Assessment

### Blocking Items

**Item 1 (split-inheritance regression):** Fully resolved.
The proposal adds a `lace-split` keybinding (`Alt-S`, lines 410-425) that reads `@lace_port`/`@lace_user` session options and SSHs into the container automatically.
Phase 2 steps 9-10 integrate the option storage and keybinding into the implementation plan.
A "Known Limitations" section (lines 541-545) explicitly frames the trade-off: `Alt-H/J/K/L` remain local, `Alt-S` provides container-aware splits, and the absence of true domain identity is acknowledged.
This is a strong resolution that addresses both the implementation gap and the documentation gap.

**Item 2 (`remain-on-exit` in `do_connect()`):** Fully resolved.
Line 330 sets `remain-on-exit on` after session creation.
The edge cases section (lines 504-505) describes the recovery path: "Pane is dead" message with `prefix + R` for respawn.
The phrasing is clear and actionable.

### Non-Blocking Items

**Item 3 (is_vim vs smart-splits):** Resolved.
Lines 151-153 add a comment explaining the manual bindings are a fallback when smart-splits is not installed.

**Item 4 (wl-copy / tmux-yank conflict):** Resolved.
Lines 176-177 remove manual `copy-pipe-and-cancel` bindings and defer clipboard handling to tmux-yank, which auto-detects the platform clipboard tool.

**Item 5 (session-name-conflict disambiguation):** Resolved.
Lines 307-323 implement port verification via `@lace_port` and fall back to `project-${port}` on mismatch.
The code matches the prose description.

**Item 6 (ControlPersist description):** Resolved.
Lines 507-508 add a NOTE callout with the correct explanation: ControlPersist helps with voluntary disconnects, not container crashes.

**Item 7 (negative test cases):** Resolved.
Test cases 11-14 (lines 575-578) cover container restart, tmux server not running, concurrent calls, and lace-split fallback.

**Item 8 (Phase 2 vs Phase 4 contradiction):** Resolved.
Phase 4 step 4 (line 660) explicitly scopes the wez-into deprecation notice to Phase 4 with a clarifying parenthetical.

**Item 9 ("Updated is_vim" framing):** Resolved.
The section header reads "Keybindings (Preserved from Legacy)" and the is_vim comment uses present-tense framing.

## New Findings

### lace-split Path Hardcoding

**Finding 1 (non-blocking):** The `lace-split` keybinding (lines 415-416) hardcodes SSH paths (`$HOME/.config/lace/ssh/id_ed25519`, `$HOME/.ssh/lace_known_hosts`), while `do_connect()` references these via `$LACE_SSH_KEY` and `$LACE_KNOWN_HOSTS` variables (lines 293-294).
Since the tmux keybinding runs in a shell context outside the `lace-into` script, it cannot access those variables.
This means the paths are duplicated across two locations.
If the paths change in `lace-into`, the tmux.conf keybinding silently breaks.

Possible mitigations: (a) define the paths as tmux environment variables set by `lace-into` during session creation, (b) have the keybinding invoke `lace-into --split` instead of raw SSH, or (c) accept the duplication and add a NOTE callout documenting the coupling.
None of these are blocking for the proposal, but the coupling should be acknowledged.

### lace-split Direction Limitation

**Finding 2 (non-blocking):** `Alt-S` only creates horizontal splits (`split-window -h`).
The existing `Alt-H/J/K/L` scheme provides splits in all four directions.
Users accustomed to directional container splits may want `Alt-S` variants for vertical and directional splits.
This is a reasonable Phase 1 simplification, but a NOTE callout or mention in Known Limitations would set expectations.

### Unused Environment Variable in `new-session`

**Finding 3 (non-blocking):** Line 329 passes `-e "LACE_PORT=$port"` to `tmux new-session`, setting an environment variable in the session.
Nothing in the proposal reads this environment variable: the `lace-split` keybinding reads the `@lace_port` user option instead.
The `-e "LACE_PORT=$port"` is redundant and could be removed for clarity, or it could be documented as intentionally available for user scripts.

### Minor Formatting

**Finding 4 (non-blocking):** A few double blank lines appear in the document (after line 31, after line 55, after line 103, etc.).
These are minor formatting nits that do not affect readability.

## Verdict

**Accept.**
All blocking and non-blocking items from round 1 are resolved.
The revisions are well-integrated: the `lace-split` keybinding, `@lace_port`/`@lace_user` session options, `remain-on-exit`, Known Limitations section, and expanded test cases form a coherent whole rather than isolated patches.
The new findings are minor and non-blocking.
The proposal is ready for implementation.

## Action Items

1. [non-blocking] Acknowledge the path duplication between `lace-split` keybinding and `lace-into` constants. Consider setting tmux environment variables during session creation or invoking `lace-into --split` from the keybinding to eliminate the coupling.
2. [non-blocking] Note in Known Limitations that `Alt-S` only creates horizontal container splits. Vertical container splits require manual SSH or a future keybinding extension.
3. [non-blocking] Remove or document the `-e "LACE_PORT=$port"` in the `new-session` call, since nothing reads the environment variable (the `@lace_port` user option is used instead).
4. [non-blocking] Clean up double blank lines in the document body.
