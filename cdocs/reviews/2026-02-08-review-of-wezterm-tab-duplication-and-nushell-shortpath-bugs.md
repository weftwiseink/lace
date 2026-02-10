---
review_of: cdocs/proposals/2026-02-08-wezterm-tab-duplication-and-nushell-shortpath-bugs.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T07:55:00-08:00
task_list: dotfiles/bugfix
type: review
state: archived
status: done
tags: [fresh_agent, root_cause_analysis, wezterm, starship, config_correctness]
---

# Review: Fix WezTerm Tab Duplication and Nushell Shortpath Display Bugs

## Summary Assessment

This proposal diagnoses two user-facing config bugs and proposes targeted, minimal fixes. The Bug 2 (shortpath) root cause analysis is airtight -- confirmed by trace logging showing starship running the bash command through nushell's parser. The Bug 1 (tab duplication) root cause analysis is well-evidenced by the log showing 5 domain registrations, though there is one gap in the causal chain between `gui-startup` handler duplication and the specific symptom of "clicking + creates extra tabs." The proposed fixes are correct and use documented WezTerm patterns. Verdict: **Revise** -- two blocking issues need clarification before implementation.

## Section-by-Section Findings

### BLUF

Clear and well-structured. Correctly identifies both root causes and fixes in a single sentence each.

### Objective

**Non-blocking.** Objective 1 says "clicking the + new-tab button" but the `gui-startup` fix addresses startup behavior, not the + button specifically. The + button may have a separate mechanism (config reload triggering re-registration). Consider rewording to "WezTerm should create exactly one tab on startup, and clicking + should create exactly one additional tab."

### Background -- Bug 1

**Blocking (B1).** The causal chain has a gap. The proposal establishes:
1. Config is evaluated multiple times (5x per log evidence) -- confirmed.
2. Each evaluation registers a new `gui-startup` handler -- plausible.
3. All handlers fire when `gui-startup` triggers, creating 5 windows -- plausible.

However, the user's reported symptom is "clicking the + button creates 3-4 extra tabs," not "WezTerm starts with extra tabs." The proposal says: "The '+' button itself likely triggers a config reload, which re-evaluates the config and re-registers handlers." The word "likely" is doing a lot of work. If the + button does NOT trigger a config reload, the `gui-startup` guard alone would not fix the symptom.

There are two distinct scenarios that need separate analysis:
- **Startup extra tabs:** Caused by multiple `gui-startup` handler registrations. The GLOBAL guard fixes this.
- **"+" button extra tabs:** The mechanism is unclear. The + button fires `SpawnTab` by default. If config is NOT reloaded on + click, the extra tabs have a different cause (possibly the `update-status` handler in the fallback path at line 148 of wezterm.lua, or duplicate keybinding registration by the plugin's `setup_keybindings` which appends a Ctrl+Shift+P binding on every evaluation).

The proposal should explicitly reproduce and distinguish these two symptoms during Phase 1 before asserting the fix.

**Blocking (B2).** The proposal claims `gui-startup` "fires once" but all N handlers execute. This needs verification. WezTerm's event system may replace previous handlers on re-registration (last-writer-wins) rather than accumulate them. If WezTerm replaces handlers, the `gui-startup` would only fire once with one handler, which would NOT cause extra tabs. The 5x domain registration log entries are evidence of 5 config evaluations, but each evaluation's `wezterm.on("gui-startup", ...)` call might be replacing the prior handler rather than adding a new one.

The proposal should add a diagnostic step in Phase 1 to confirm whether handlers accumulate: add a `wezterm.log_info("gui-startup handler firing")` inside the handler, restart WezTerm, and count how many times the message appears in the log. If it appears once, handlers are replaced and the root cause for extra tabs is elsewhere.

### Background -- Bug 2

Excellent. The root cause chain is fully confirmed by trace evidence: `STARSHIP_SHELL=nu` causes starship to run the bash command through `nu`, which exits 1 with `nu::parser::error`. The fix (`shell = ["bash", "-c"]`) is correct per starship's documentation for custom modules.

### Proposed Solution -- Fix 1

The `wezterm.GLOBAL` guard pattern is correct and documented. Code snippet is clean and minimal.

**Non-blocking.** The `update-status` handler in the `else` branch (plugin load failure fallback, line 148 of wezterm.lua) also lacks a GLOBAL guard. If the plugin fails to load on some evaluations but succeeds on others, this handler could accumulate too. Worth noting even if the plugin currently always succeeds.

### Proposed Solution -- Fix 2

Correct. Adding `shell = ["bash", "-c"]` is the standard starship approach for custom commands that use shell-specific syntax.

### Proposed Solution -- Secondary Fix (Plugin Guards)

**Non-blocking.** The `setup_keybindings` function (line 239 of init.lua) is NOT guarded and has no proposed guard. Each config evaluation appends a new Ctrl+Shift+P keybinding entry to `config.keys`. After 5 evaluations, there are 5 identical keybinding entries. While WezTerm likely deduplicates these, it is worth adding a guard or at least noting the omission.

Similarly, the `apply_to_config` function itself is called on every evaluation. The `setup_keybindings` call inside it does `table.insert(config.keys, ...)` unconditionally. With the `config_builder()` creating a fresh config each evaluation, this is likely fine (each evaluation gets a fresh `config.keys` table). But the proposal should explicitly state this assumption.

### Design Decisions

All three decisions are sound and well-reasoned. D2 (explicit shell over removing STARSHIP_SHELL) is the right call -- `STARSHIP_SHELL` serves broader purposes beyond just custom module execution.

### Edge Cases

E1 and E3 are correct. E2 is accurate but could note that this is a development-only concern (production users do full restarts after plugin updates anyway).

### Implementation Phases

Phase ordering is good -- reproduce first, fix the simpler bug (starship) second, then tackle the more complex one (wezterm).

**Non-blocking.** Phase 1 verification of the tab bug could be more specific. Instead of "Click the + button / Count new tabs created (expect 1 new, likely see 3-4 new)," suggest also checking: (a) what happens when you press Alt+Shift+N (the keybinding for new tab), (b) whether the extra tabs appear at startup too, and (c) whether the log shows gui-startup handler messages.

### Test Plan

Adequate coverage. Test 7 (log check for single domain registration) is the key regression test for the plugin guard fix.

**Non-blocking.** Missing a test for the starship fix under bash (regression test): verify that `STARSHIP_SHELL=bash starship module custom.dir` still works after adding the `shell` option. It should, since `shell` overrides the default for that module only, but worth confirming.

## Verdict

**Revise.** Two blocking findings need addressing before implementation:

1. **(B1)** Clarify the causal link between `gui-startup` duplication and the "+" button symptom. The proposal should separate startup tab duplication from + button tab duplication, and Phase 1 should explicitly diagnose which scenario is occurring.

2. **(B2)** Add a diagnostic step to verify that WezTerm event handlers accumulate rather than replace. The entire Bug 1 fix depends on this assumption. A single log line inside the gui-startup handler, checked after restart, would confirm or refute it.

## Action Items

1. [blocking] Separate the analysis of "extra tabs at startup" from "extra tabs on + click." Add a hypothesis for each scenario and a Phase 1 diagnostic step to distinguish them.
2. [blocking] Add a diagnostic step to Phase 1 that confirms gui-startup handlers accumulate (fire N times) rather than replace (fire once). Log from inside the handler and count occurrences after restart.
3. [non-blocking] Note that the `update-status` fallback handler (wezterm.lua line 148) also lacks a GLOBAL guard.
4. [non-blocking] Note that `setup_keybindings` in the plugin is not guarded and appends duplicate keybindings on each evaluation. Either guard it or explain why it is safe (fresh config per evaluation).
5. [non-blocking] Add a bash regression test for the starship fix: verify `STARSHIP_SHELL=bash starship module custom.dir` still works after the change.
6. [non-blocking] Reword Objective 1 to cover both startup and + button scenarios.
