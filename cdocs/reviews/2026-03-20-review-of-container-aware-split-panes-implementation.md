---
review_of: cdocs/devlogs/2026-03-20-container-aware-split-panes-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T16:30:00-07:00
task_list: wezterm/split-pane-regression
type: review
state: live
status: done
tags: [fresh_agent, runtime_validated, architecture, dead_code, test_coverage]
---

# Review: Container-Aware Split Panes Implementation

## Summary Assessment

This devlog documents the implementation of ExecDomain-based container-aware split panes for the lace WezTerm integration, fixing a regression where Alt-HJKL splits in container tabs opened host shells.
The implementation follows the proposal closely, with one documented deviation (bypass binding syntax) caught by validation tooling.
The verification evidence is strong for the core mechanism (5 panes across 2 containers, ExecDomain confirmation, cross-container isolation) but has notable gaps around fallback paths and dead code cleanup.
Verdict: Revise, with two blocking items around dead code and a missing proposal-specified fallback.

## Section-by-Section Findings

### Frontmatter

**Non-blocking.** Status is `wip` but the devlog describes completed work with verification.
Should be `review_ready` (or `done` if all manual tests pass).

### Objective

Clear and concise.
Links to the proposal, states the goal, and names the mechanism.
No issues.

### Plan

Accurately reflects the proposal's five phases.
No issues.

### Phase 1: ExecDomain Registration

The implementation in `plugin/init.lua` matches the proposal closely.
The code is well-structured: `build_ssh_args`, `make_exec_fixup`, `setup_exec_domains` are cleanly factored.
The `tostring(port)` fix for GLOBAL string-key requirements (discovered during Phase 5 testing) is properly applied throughout: `make_exec_fixup` (line 234), `setup_port_domains` (lines 332, 344), and `get_connection_info` (lines 665, 672).
No issues.

### Phase 2: Picker and wez-into

The picker correctly uses `mux_win:spawn_tab({ domain = { DomainName = "lace:" .. project.port } })` (plugin line 540-542).
The picker also updates `lace_port_users` in GLOBAL at selection time (plugin lines 521-523), which is good: this ensures the ExecDomain fixup uses the freshly-discovered user.

The `wez-into` `do_connect` correctly uses `wezterm cli spawn --domain-name "lace:$port"` (line 553) and falls back to `wezterm connect "lace-mux:$port"` (line 558).

**Blocking: Dead code.** The `resolve_workspace_folder` function (lines 458-479) is now dead code.
It was used by the old raw-SSH `do_connect` to resolve the CWD for the SSH command.
With ExecDomain, workspace resolution is handled by the plugin's `resolve_port_workspaces` and the ExecDomain fixup.
The function is defined but never called anywhere in the script.
The devlog says "Removed `workspace_dir` resolution (now handled by ExecDomain fixup)" but the function definition was not actually removed.

**Blocking: Missing proposal-specified fallback.**
The proposal's Phase 2, item 4 states: "Add fallback in wez-into: if `--domain-name` fails (domain not registered), fall back to raw SSH args."
The current implementation falls back to `wezterm connect "lace-mux:$port"` (the cold-start/mux path), not to raw SSH args.
This matters for the edge case in the proposal's "Plugin not loaded" section: if the plugin fails to load, ExecDomains are not registered, and `wezterm cli spawn --domain-name lace:$port` fails.
The current fallback (`wezterm connect lace-mux:$port`) would also fail if the plugin is not loaded, since SSH mux domains are also registered by the plugin.
The fallback should reconstruct raw SSH args (using `resolve_user_for_port`, the SSH key, and workspace folder) as a last resort.
This is a robustness concern rather than a correctness concern for the normal path, but it is explicitly called out in the proposal as a requirement.

### Phase 3: Bypass Bindings

The NOTE callout documenting the deviation from the proposal is well-written.
The proposal incorrectly specified `domain = "DefaultDomain"` as a direct `SplitPane` field; the correct syntax is `command = { domain = "DefaultDomain" }`.
This was caught by `ls-fonts` parse check, demonstrating the validation workflow's value.
The devlog's `show-keys` evidence confirms the bindings are registered correctly.
No issues.

### Phase 4: Documentation

The Connection Domain Architecture block comment (plugin lines 50-79) is thorough and clearly explains all three domain types, their purposes, and the rationale for abandoning workspace mode.
Good use of inline attribution.
No issues.

### Phase 5: End-to-End Testing and Verification

The test evidence covers the following scenarios from the proposal's test plan:

| Proposal Test | Devlog Evidence | Assessment |
|---|---|---|
| Core: splits in container tabs | ExecDomain spawn + split for port 22427 | Covered |
| Multi-container routing | Two containers (22427, 22426), verified isolation | Covered |
| Config reload resilience | "All 5 panes survived config file touch + reload" | Covered |
| wez-into dry-run | Dry-run output shown | Covered (dry-run only) |
| Bypass bindings | show-keys output | Partial: key registration verified, not keyboard test |
| Fallback (local tabs) | Not mentioned | Not covered |
| Cold-start fallback | Not mentioned | Not covered |

**Non-blocking: Missing test evidence for local tab splits.**
The proposal's "Fallback (local tabs)" test (open a local tab, Alt-J, verify local shell) is not covered.
This is low risk since `SplitPane` without domain override defaults to `CurrentPaneDomain` which would be the local domain, but it would be good to confirm no regression in local-tab behavior.

**Non-blocking: Missing cold-start test.**
The proposal's "Cold-start fallback" test (kill WezTerm, run `wez-into`, verify `wezterm connect lace-mux:$port`) is not executed.
Given the mux domain rename from `lace:` to `lace-mux:`, this is a moderate-risk gap.

**Non-blocking: Bypass binding verification.**
The devlog correctly notes that bypass bindings require manual keyboard testing.
The `show-keys` diff confirms registration, which is sufficient for config correctness.

### Debugging Process

The debugging section is clear and well-structured.
The investigation of stale domain registrations after config reload is a valuable finding: WezTerm's mux server retains domain registrations across config reloads, requiring a SIGHUP for domain renames to take effect.
The `tostring(port)` discovery is also well-documented with the root cause ("can only index objects using string values") and the fix.

> NOTE(opus/split-pane-review): The stale domain registry issue is documented as a "one-time deployment requirement."
> This should be noted in the plugin README or a deployment checklist, not just in the devlog.
> Future users upgrading from pre-ExecDomain versions would encounter this silently.

### Changes Made Table

Accurate and complete.
The three files listed match the actual changes reviewed.

### Commits Table

Seven commits across three repos.
Reasonable granularity for phased implementation.

**Non-blocking.** The commit for Phase 3 (bypass bindings, `49222f7`) is in the dotfiles repo, which is external to the lace repo.
The devlog should note that reviewing this commit requires access to the dotfiles repo.

### Verification Section

The verification summary is well-structured.
The "Remaining manual testing" list is honest about what was not automated.

### Code Quality Assessment (plugin/init.lua)

The code is clean and well-factored.
Specific observations:

1. Good separation of concerns: utility helpers, ExecDomain infrastructure, discovery, picker, and public API are clearly delineated with section headers.
2. The `make_exec_fixup` closure correctly captures `port` and `default_user` at registration time while reading `port_users` and `port_workspaces` from GLOBAL at spawn time.
This means the fixup always uses the latest user/workspace data.
3. The log-once guards using `wezterm.GLOBAL` flags (`lace_exec_domains_logged`, `lace_domains_logged`) are correct: they prevent log spam on config re-evaluation while still registering domains every time.
4. The `get_connection_info` public API does a reverse lookup through the discovery cache, which is O(n) in the number of cached entries.
For the expected cardinality (< 10 projects), this is fine.

**Non-blocking: `resolve_user_for_port` still called in wez-into.**
`do_connect` resolves the user at line 504 (`user=$(resolve_user_for_port "$port")`) but never uses the result.
The ExecDomain fixup handles user resolution.
The `user` variable is only used in the info message at line 532 ("connecting to $project as $user on port $port...").
This is harmless but misleading: it queries `lace-discover` for a value that the ExecDomain fixup may override.

### Writing Convention Compliance

The devlog follows sentence-per-line formatting, uses NOTE callouts with proper attribution, and avoids emojis.
The BLUF is implicit in the Objective section rather than being a formal `> BLUF:` block.

**Non-blocking.** Missing explicit `> BLUF:` block at the top of the document.

## Verdict

**Revise.**
Two blocking issues must be addressed before acceptance:

1. Dead code: `resolve_workspace_folder` function in `wez-into` is defined but never called.
2. Missing fallback: The proposal specifies a raw-SSH-args fallback in `wez-into` when ExecDomain spawn fails (plugin not loaded).
The current fallback to `wezterm connect lace-mux:$port` does not cover this case since SSH mux domains are also registered by the plugin.

The core implementation is solid, the debugging narrative is clear, and the verification evidence for the primary use case is convincing.
The non-blocking items are improvements worth considering but do not block acceptance.

## Action Items

1. [blocking] Remove the dead `resolve_workspace_folder` function from `bin/wez-into` (lines 454-479), or add a comment explaining why it is retained.
2. [blocking] Add raw-SSH-args fallback to `wez-into` `do_connect` as specified in proposal Phase 2, item 4. When `wezterm cli spawn --domain-name` fails and `wezterm connect lace-mux:` is not viable, reconstruct SSH args and fall back to `wezterm cli spawn -- ssh ...`.
3. [non-blocking] Execute the cold-start fallback test from the proposal (kill WezTerm, run `wez-into`, verify `lace-mux:` domain works). Document the result.
4. [non-blocking] Execute the local-tab split test (open local tab, Alt-J, verify local shell). Document the result.
5. [non-blocking] Add a `> BLUF:` line at the top of the devlog.
6. [non-blocking] Note the stale domain registry deployment requirement in plugin documentation (README or inline), not just in the devlog.
7. [non-blocking] Remove or annotate the unused `user` variable resolution in `do_connect` (line 504) since ExecDomain fixup handles user resolution at spawn time.
8. [non-blocking] Update devlog status from `wip` to `review_ready` (or `done` after manual tests pass).
