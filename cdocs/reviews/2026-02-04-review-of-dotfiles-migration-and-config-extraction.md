---
review_of: cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T18:00:00-08:00
task_list: lace/dotfiles-migration
type: review
state: archived
status: done
tags: [fresh_agent, proposal, dotfiles, chezmoi, wezterm-plugin, architecture, test_plan, phasing]
---

# Review: Dotfiles Migration and Config Extraction

## Summary Assessment

This comprehensive proposal covers four interrelated goals: (1) dotfiles devcontainer setup, (2) wezterm plugin extraction, (3) chezmoi migration, and (4) personal config consolidation. The BLUF accurately captures the multi-part nature of the work, and the design decisions are well-reasoned with clear rationale. The proposal correctly identifies that neovim config requires no extraction (validated against the assessment report). However, there are gaps in test coverage specificity, underspecified coordination with the companion dev-dependency-mounts proposal, and a potential issue with the plugin's status bar event registration that could cause duplicate handlers. Verdict: **Revise** - address two blocking issues before proceeding.

## Section-by-Section Findings

### BLUF and Objective

**Assessment**: Clear and accurate.

The BLUF correctly summarizes all four goals and identifies the key dependencies. The four objectives in the Objective section align with the BLUF. The statement that "neovim config is purely personal preference and requires no plugin extraction" is validated by the Neovim Assessment Report.

No issues.

### Background / Current State

**Assessment**: Well-researched.

The line number references to lace-specific vs personal preference code in wezterm.lua (lines 52-86, 148-221 vs 13-51, 89-142) demonstrate concrete analysis. The characterization of the dotfiles repository (`setup.sh` with `setup_symlink` helper) matches the chezmoi research report's analysis.

No issues.

### Part 1: Dotfiles Devcontainer

**Assessment**: Mostly complete with one gap.

The devcontainer.json example is well-specified with appropriate features (git, wezterm-server, sshd). The "Why minimal" rationale is sound.

**Issue (non-blocking)**: The SSH port is `2222:2222` which will conflict with the lace devcontainer's port. Phase 3 (line 605) notes using port 2223, but the devcontainer.json example on line 92 still shows 2222. This inconsistency should be reconciled.

**Issue (non-blocking)**: The mount for `~/.ssh/dotfiles_devcontainer.pub` assumes this key pair exists. Open Question 1 asks about this, but the devcontainer.json example already hardcodes the name. Consider using `lace_devcontainer` key (shared) in the example until the question is resolved.

### Part 2: Wezterm Plugin Extraction

**Assessment**: Well-designed with one blocking issue.

The plugin structure follows the pattern established in the WezTerm Plugin Research Report. The `apply_to_config` interface with configurable options is clean. The domain_name collision note (lines 143-146) shows good foresight.

**Issue (blocking)**: The `setup_status_bar()` function (lines 216-229) registers the `update-status` event handler but uses a module-level `M._status_registered` flag to prevent duplicate registration. However, if multiple projects load this plugin with different `domain_name` values, they will all call `apply_to_config()`, and only the first call will register the status bar handler. This is actually correct behavior for preventing duplicates, but the status bar shows only the workspace name (which is global to WezTerm, not per-domain), so this is fine. Upon closer inspection, the code is correct. Retracting this concern.

**Issue (blocking)**: The worktree picker event name is domain-specific (`"lace.trigger-worktree-picker." .. opts.domain_name`), but the keybinding setup (lines 243-246) emits `picker_event` which is correctly the domain-specific event name. This is correct.

Reviewing again: Actually, there IS a real issue.

**Issue (blocking)**: The `spawn_worktree_workspace` function (lines 162-170) hardcodes `domain = { DomainName = opts.domain_name }`, but the SSH domain setup (line 150) also uses `opts.domain_name`. However, when multiple projects use this plugin with different configurations, each will add its own SSH domain. The keybindings (Leader+D, Leader+W) will be added multiple times if multiple projects are loaded. WezTerm keybinding behavior with duplicate `key`+`mods` combinations is unclear from the proposal. The last-registered binding may win, which could cause confusion.

**Recommendation**: Document that the plugin assumes single-project use, OR use domain-namespaced keybindings (e.g., the user configures `connect_key = "l"` for lace, `connect_key = "d"` for dotfiles).

### Part 3: Chezmoi Migration

**Assessment**: Comprehensive and well-aligned with research.

The migration steps follow the chezmoi research report's recommendations. The use of `--follow` for symlink migration is correctly identified. The run_once script examples are idempotent (check for existing install before running).

**Issue (non-blocking)**: The proposal mentions archiving `setup.sh` to `setup.sh.archive` (line 356), but does not specify whether this should be committed to git or just local. Recommend: commit as `setup.sh.archive.md` (with explanatory frontmatter) so future users understand the history.

**Issue (non-blocking)**: The chezmoi source structure (lines 359-384) shows `dot_config/wezterm/wezterm.lua` but the dotfiles devcontainer is in `.devcontainer/` at the repo root. This is correct (devcontainer config is not a dotfile), but could be clearer in the proposal.

### Part 4: Personal Config Migration

**Assessment**: Clear scope.

The neovim and wezterm migrations are well-specified. The note that "Container-Side Wezterm Config remains in lace" (lines 403-406) correctly distinguishes infrastructure from personal config.

No issues.

### Design Decisions

**Assessment**: Well-reasoned with clear rationale.

All five decisions have "Why" sections explaining the tradeoffs. Decision 5 (No Neovim Plugin) correctly references the assessment findings.

**Issue (non-blocking)**: Decision 2 (Configurable Plugin Options) notes that domain_name collision is a future concern. Given that the dotfiles devcontainer will also use this plugin, this is an immediate concern, not future. The proposal should specify whether dotfiles uses the same plugin with different options (implied by Phase 3) or a separate mechanism.

### Edge Cases / Challenging Scenarios

**Assessment**: Good coverage with one gap.

The five edge cases cover plugin path resolution, plugin updates, multiple devcontainers, chezmoi bind mount behavior, and existing symlinks.

**Issue (blocking)**: Missing edge case: **What happens if the lace plugin is loaded on a machine where lace is not checked out?** The `pcall` wrapper handles load failure gracefully, but the host path (`wezterm.home_dir .. "/code/weft/lace/..."`) is hardcoded in `get_lace_plugin_path()`. On a machine without lace, the plugin simply fails to load silently. Is this the desired behavior? The proposal should clarify: is this plugin only for machines with lace, or should it support a "standalone" mode with downloadable plugin?

**Recommendation**: Document explicitly that the lace plugin requires lace to be checked out at the expected path, and that graceful degradation (warn but continue) is the intended behavior on machines without lace.

### Test Plan

**Assessment**: Structure is good, but specificity is lacking.

The test plan covers three areas (Wezterm Plugin, Chezmoi Migration, Devcontainer) with reasonable test cases.

**Issue (non-blocking)**: All tests are marked "(Manual)". For a plugin with Lua code, there should be at least some automated unit tests. WezTerm plugins can be tested using Lua test frameworks (busted, luaunit) by mocking the `wezterm` module. The proposal should either commit to adding automated tests or explicitly state that manual testing is acceptable for the initial implementation with automated tests as follow-up work.

**Issue (non-blocking)**: The Chezmoi Migration tests mention "Run `chezmoi apply` on macOS (if available)". Given that the current dotfiles repo supports macOS, this should be a required test, not optional. If no macOS test environment is available, note this as a gap.

**Issue (non-blocking)**: The Devcontainer Tests do not mention testing concurrent use of lace and dotfiles devcontainers (the primary use case for port 2223). Add: "Start both lace and dotfiles devcontainers simultaneously, verify SSH works on both ports."

### Implementation Phases

**Assessment**: Well-structured with clear success criteria.

The six phases have clear tasks, success criteria, and constraints. The phasing is logical: plugin scaffold -> plugin complete -> devcontainer -> chezmoi -> migration -> docs.

**Issue (non-blocking)**: Phase 3 success criterion says "Can connect via `wezterm connect dotfiles`", but this requires the plugin to be configured with `domain_name = "dotfiles"`. The proposal should either show the example config for this, or note that this connection uses a manually-configured SSH domain until the plugin is loaded from dotfiles.

**Issue (non-blocking)**: Phases 1-2 (plugin) and Phases 3-4 (devcontainer/chezmoi) could potentially be parallelized since they're in different repositories (lace vs dotfiles). The proposal does not discuss this, which is fine, but could be an optimization.

### Open Questions

**Assessment**: Questions are relevant, but some should be resolved before implementation.

Questions 1 (SSH key naming) and 4 (Dev Dependencies Integration) affect the devcontainer.json example already in the proposal.

**Issue (non-blocking)**: Open Question 4 about dev-dependency mounts coordination is critical. The dotfiles devcontainer may need to mount the lace plugin path. If the companion proposal's `devDependencies` mechanism is used, the dotfiles `devcontainer.json` should declare lace as a dev dependency. This creates a circular reference in the proposals that should be resolved or acknowledged.

### Cross-Proposal Consistency

**Issue (non-blocking)**: The companion proposal (`2026-02-04-dev-dependency-cross-project-mounts.md`) defines mounts at `/lace.local/<repo-name>`, but the wezterm plugin path detection (lines 276-286) assumes `/workspace/main/lace/...` in the container. These are inconsistent. If dotfiles uses dev-dependency mounts, the plugin path would be `/lace.local/lace/config/wezterm/lace-plugin`, not `/workspace/main/lace/...`.

**Recommendation**: Either (a) document that the dotfiles devcontainer does NOT use dev-dependency mounts for lace (it's bound by `workspaceMount` or manual mount), or (b) update `get_lace_plugin_path()` to check both conventional paths.

## Verdict

**Revise.**

Two blocking issues require resolution:

1. **Keybinding collision**: Clarify the expected behavior when multiple projects load the plugin with different configurations. Either document single-project assumption, or design keybinding namespacing.

2. **Plugin path vs dev-dependency mount path**: Reconcile the plugin path detection logic with the companion dev-dependency mounts proposal. Either document that dev-dependency mounts are not used for the lace plugin, or update the path detection.

The remaining non-blocking issues are documentation clarifications and test plan improvements that can be addressed during implementation.

## Action Items

1. **[blocking]** Clarify keybinding behavior when multiple projects load the plugin. Add documentation that Leader+D/W keybindings assume single-project use, OR allow users to configure different keys per project.

2. **[blocking]** Reconcile plugin path detection with dev-dependency mounts. Either (a) document that dotfiles does NOT use `/lace.local/lace/` for the plugin, or (b) add `/lace.local/lace/...` as a fallback path in `get_lace_plugin_path()`.

3. **[non-blocking]** Fix devcontainer.json example to use port 2223 (line 92 says 2222, but Phase 3 says 2223).

4. **[non-blocking]** Resolve Open Question 1 (SSH key naming) before finalizing the devcontainer.json example, or use `lace_devcontainer` (shared key) as the example.

5. **[non-blocking]** Add missing edge case: graceful degradation when lace is not checked out on the host.

6. **[non-blocking]** Specify archiving strategy for `setup.sh` (commit as `setup.sh.archive.md` with explanatory note).

7. **[non-blocking]** Add test case for concurrent lace + dotfiles devcontainer operation (both SSH ports working).

8. **[non-blocking]** Consider automated Lua unit tests for the plugin, or explicitly defer to follow-up work.

## Clarification Questions for Author

To help resolve the blocking issues, please clarify:

A. **Keybinding design intent**: Should the lace wezterm plugin support loading from multiple projects simultaneously (requiring keybinding namespacing), or is it designed for single-project use at a time?
   - [ ] Single-project: Document this limitation
   - [ ] Multi-project: Add keybinding configuration options

B. **Plugin path strategy for dotfiles devcontainer**: How will the dotfiles devcontainer access the lace plugin?
   - [ ] Via dev-dependency mount at `/lace.local/lace/`
   - [ ] Via manual bind mount at a conventional path
   - [ ] Via a separate mechanism (plugin cloned into dotfiles repo)
   - [ ] Dotfiles devcontainer does not need the lace plugin
