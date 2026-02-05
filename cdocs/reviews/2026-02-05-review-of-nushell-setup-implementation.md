---
review_of: cdocs/devlogs/2026-02-05-nushell-setup-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T18:00:00-08:00
task_list: lace/dotfiles-migration
type: review
state: live
status: done
tags: [self, implementation_review, nushell, version_compatibility, config_loading]
---

# Review: Nushell Configuration Setup Implementation

## Summary Assessment

This devlog documents the implementation of Phase 1 of the nushell configuration setup: creating 9 config files, deploying them, fixing 3 version-compatibility issues, setting WezTerm's default shell, and committing. The implementation is solid -- all 10 verification tests pass, startup time is excellent at 153ms, and the three fixes applied during debugging were correct and well-documented. The most important finding is a factual inaccuracy in the "Note on `-c` vs `-l -c` mode" section that should be corrected before the devlog is marked done. Verdict: **Revise** (one blocking finding).

## Section-by-Section Findings

### Objective

Clear and correctly scoped. References the parent proposal. No issues.

### Plan

Well-structured 8-step plan. Matches what was actually executed. No issues.

### Implementation Notes (Steps 1-5)

Steps 1-5 are straightforward and accurately documented. The carapace note (already installed via linuxbrew) is useful context.

### Step 6: Debugging and Fixes

This is the most valuable section of the devlog. All three fixes are correct:

1. **`char escape` -> `ansi escape`**: Verified that `ansi escape` produces byte 0x1b. Correct fix.
2. **`get -i` -> `get -o`**: Correct per nushell v0.106.0 deprecation. The `-i` flag was a warning, not an error, but config loading treats parser warnings as fatal in some contexts.
3. **`2>` -> `err>`**: Correct. Nushell has its own redirection syntax.

**Non-blocking:** The devlog should note that these three findings represent bugs in the proposal that should be fed back. The proposal's `status: review_ready` passed review without catching these because the proposal was reviewed for design, not for syntax correctness against the specific nushell version. This is a useful lesson for future proposals that contain runnable code blocks.

### Step 7: WezTerm Configuration

Correctly placed in a new "Shell" section. The wezterm.lua change is minimal and appropriate.

### Step 8: Commits

Clean separation between nushell config (commit 1) and wezterm + archive changes (commit 2). The commit messages are descriptive and follow the repo's conventional commit style.

### Verification Results

All 10 tests pass. The test coverage is good, covering environment, config, aliases, completions, utilities, and performance. No issues with the results themselves.

### Note on `-c` vs `-l -c` mode

**Blocking.** The devlog states: "When running `nu -c` (without `-l`), nushell v0.110.0 does not load env.nu or config.nu -- it uses defaults and inherits from the parent shell environment. The `-l` (login) flag is required for config files to load. This is the expected mode when WezTerm launches nushell via `default_prog`, since terminal shells are login shells."

This contains two inaccuracies:

1. The claim that `-l` is required for config loading is misleading. Nushell loads env.nu and config.nu in **interactive** mode (when attached to a PTY), not specifically in login mode. The `-c` flag runs in non-interactive mode, which skips config loading. The `-l` flag in testing happened to also trigger interactive-like config loading, but the actual mechanism is interactivity, not login status. WezTerm's `default_prog` launches nushell attached to a PTY, so it will be interactive and config will load -- but NOT because it is a login shell. WezTerm does not pass `-l` to `default_prog`.

2. The statement "terminal shells are login shells" is incorrect. WezTerm's `default_prog` spawns a non-login interactive shell by default. Login shells are only created when the shell is the first process in a session (e.g., via `ssh` or `login`). This means `login.nu` will NOT be executed in normal WezTerm usage. This does not matter for the current config (login.nu only has commented-out tmux code), but the misconception could cause confusion later if login.nu is used for real logic.

**Fix:** Rewrite this section to correctly distinguish interactive vs. login vs. `-c` modes. Specifically: nushell loads config in interactive mode (PTY-attached), WezTerm provides interactive mode, and `-l` is not involved.

### Deviations from Proposal

Well-documented. The characterization of these as "nushell version compatibility fixes" is accurate. The statement that they "preserve the original behavior" is correct.

### Open Items

The three listed items are appropriate. The LESS_TERMCAP verification is a good catch -- `ansi escape` is correct but worth manual verification in `man`.

## Verdict

**Revise.** The implementation itself is correct and complete. The single blocking issue is a factual inaccuracy in the devlog's documentation of nushell's config loading behavior. Fix the "Note on `-c` vs `-l -c` mode" section, then the devlog can be marked `done`.

## Action Items

1. [blocking] Rewrite the "Note on `-c` vs `-l -c` mode" section to correctly describe that config loading depends on interactivity (PTY attachment), not login status. Clarify that WezTerm spawns an interactive non-login shell, and that `login.nu` will not execute in normal WezTerm usage.
2. [non-blocking] Consider adding a note to the proposal's errata or feeding back the three syntax fixes (`char escape`, `get -i`, `2>`) so the proposal is updated if it is referenced again.
3. [non-blocking] Update devlog status from `wip` to `done` after addressing the blocking finding.
