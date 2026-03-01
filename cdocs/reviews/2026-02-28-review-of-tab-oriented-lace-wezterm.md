---
review_of: cdocs/proposals/2026-02-28-tab-oriented-lace-wezterm.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-28T18:30:00-06:00
task_list: lace/wezterm-tab-mode
type: review
state: live
status: done
tags: [fresh_agent, architecture, wezterm_api_correctness, event_model, missing_validation]
---

# Review: Tab-Oriented Connection Mode for lace.wezterm

## Summary Assessment

This proposal adds a `connection_mode = "tab"` option to lace.wezterm so the project picker spawns tabs instead of workspaces, consolidating all devcontainer sessions into a single WezTerm window.
The overall architecture is sound and well-motivated: the BLUF is accurate, the phasing is reasonable, and the design decisions are well-justified.
However, the proposal relies on `mux-tab-added` as a tab-creation event, which does not exist in WezTerm's documented event API, and the discovery cache mechanism conflicts with WezTerm's module-reload semantics as documented in the plugin's own source comments.
The duplicate detection approach via `tabs_with_info()` has an API surface mismatch with the code used elsewhere in the proposal.

**Verdict: Revise.** Two blocking issues must be resolved: the nonexistent `mux-tab-added` event and the module-level cache invalidation problem. The remaining findings are non-blocking improvements.

## Section-by-Section Findings

### Frontmatter

**Non-blocking.** The `task_list` is `null`. This is technically valid but loses traceability. A value like `lace/wezterm-tab-mode` or `lace/wezterm-plugin` would link this to the existing workstream.

The `first_authored.by` is `"@claude"` rather than a specific model identifier (e.g., `@claude-opus-4-6`). Per the frontmatter spec, this should be a full API-valid model name.

### BLUF

The BLUF is well-constructed. It accurately conveys the key points: tab mode is opt-in, tab titles use `tab:set_title()`, the `format-tab-title` handler provides OSC immunity, and the CLI gets a fallback path. No surprises when reading the full proposal.

### Objective and Background

**Non-blocking.** The background section says "WezTerm has two relevant architectural facts" but then lists three items (numbered 1-3). Minor editing error.

The claim that `wezterm connect` always creates a new window is correct per the tab-oriented integration report and WezTerm docs.

### Proposed Solution: Duplicate Detection (Section 2)

**Blocking.** The duplicate detection code uses `mux_win:tabs_with_info()`:

```lua
for _, tab_info in ipairs(mux_win:tabs_with_info()) do
  for _, p in ipairs(tab_info.tab:panes()) do
```

The integration report's equivalent code uses `mux_window():tabs()` which returns tab objects directly (not wrapped in `tab_info` tables). The `tabs_with_info()` method is available on `MuxWindow` objects and returns a list of tables where each entry has `.tab`, `.index`, `.is_active`. Either approach works, but the proposal inconsistently mixes access patterns.

More importantly, this code iterates only the current window's tabs. If the user has multiple windows (e.g., the cold-start fallback created one, and they later open another), a tab in a different window for the same domain would not be detected. This is acceptable for the stated "single window" goal, but should be documented as a known limitation.

The actual correctness concern: `tab_info.tab:activate()` activates the tab within the mux but does not switch the GUI focus to that tab. For a tab in the current window this works naturally, but the behavior should be verified.

### Proposed Solution: `mux-tab-added` Event (Section 4)

**Blocking.** The proposal relies on `mux-tab-added` as the hook for setting tab titles after spawn:

```lua
wezterm.on("mux-tab-added", function(tab)
  for _, p in ipairs(tab:panes()) do
    local domain = p:get_domain_name()
    ...
```

WezTerm's documented event callbacks are: `mux-startup`, `mux-is-process-stateful`, `window-config-reloaded`, `window-focus-changed`, `pane-focus-changed`, `update-status`, `format-tab-title`, `format-window-title`, `user-var-changed`, `bell`, `open-uri`, and several others. **`mux-tab-added` is not among the documented WezTerm events.**

This is a critical gap. Without a reliable event that fires when a new tab is created, the proposal needs an alternative mechanism to set tab titles. Possible alternatives:

- **A.** Use `wezterm.action_callback` wrapping `SpawnCommandInNewTab` to capture the new tab synchronously, then set its title. However, `perform_action` for `SpawnCommandInNewTab` does not return the new tab object.
- **B.** Use `pane-focus-changed` as a proxy: after spawning, the new tab's pane gets focus. The handler checks if the focused pane belongs to a lace domain and the tab has no title set, then sets it. This fires frequently (every focus change), so it must be lightweight.
- **C.** Use `format-tab-title` itself as the title-setting mechanism. Instead of calling `tab:set_title()` separately, the `format-tab-title` handler looks up the domain name against the discovery cache and returns the project name directly. This eliminates the need for `mux-tab-added` entirely, though it means the title is computed on every render rather than stored once.
- **D.** Use `wezterm.on("update-status", ...)` which fires on every status update. Check if any tab lacks a title and its pane is on a lace domain, then set it. Heavier-weight but reliable.

Option C is the cleanest and is essentially what the integration report recommends in Phase 2.

### Proposed Solution: Discovery Cache (Section 4, NOTE)

**Blocking.** The proposal states:

> This requires caching discovery results at the module level so `mux-tab-added` can look up the project name for a port.

The plugin source file (`plugin/init.lua`, lines 47-54) explicitly documents why module-level state is unreliable:

> WezTerm re-evaluates the config (and thus reloads the plugin module) multiple times per process. Module-level flags are reset on each evaluation, but wezterm.GLOBAL persists across evaluations within the same process.

A module-level `discovery_cache` table would be wiped on every config reload. The cache must use `wezterm.GLOBAL` instead:

```lua
wezterm.GLOBAL.lace_discovery_cache = wezterm.GLOBAL.lace_discovery_cache or {}
```

This is a straightforward fix but the proposal should specify it. The cache population in the picker callback would write to `wezterm.GLOBAL.lace_discovery_cache`, and the title handler would read from it.

### Proposed Solution: `format-tab-title` Handler (Section 3)

**Non-blocking.** The handler code is correct in isolation. The function signature matches WezTerm's documented `format-tab-title` event. The fallback from `tab.tab_title` to `tab.active_pane.title` is the standard pattern confirmed by the tab-title-pinning report.

However, the proposal registers this handler unconditionally when `connection_mode == "tab"`. The tab-title-pinning report (Open Questions, item 2) warns:

> Only one `format-tab-title` handler can be active. If the lace.wezterm plugin or any other plugin registers one, they will conflict.

The proposal acknowledges this in the "format-tab-title handler conflicts" edge case but doesn't resolve it architecturally. The recommended approach from the report is to register the handler in the user's config, not the plugin. This keeps control with the user and avoids plugin-vs-plugin conflicts.

**Recommendation:** The plugin should provide a `format_tab_title` helper function that the user calls from their own handler, rather than registering the event directly. For example:

```lua
-- In plugin:
function M.format_tab_title(tab_info, max_width)
  local title = tab_info.tab_title
  if not title or title == "" then
    title = tab_info.active_pane.title
  end
  return title
end

-- In user config:
wezterm.on("format-tab-title", function(tab, ...)
  local title = lace_plugin.format_tab_title(tab, max_width)
  return " " .. title .. " "
end)
```

### Proposed Solution: Status Bar Adaptation (Section 5)

**Non-blocking.** The proposal mentions adapting the `update-status` handler for tab mode. There is a pre-existing conflict here: both the plugin (`plugin/init.lua` line 325) and the user's wezterm config (line 464) register `update-status` handlers. In WezTerm's event model, the last handler registered wins. Currently the user's config loads after the plugin, so the user's handler takes effect. The plugin's status bar handler is effectively dead code.

The proposal should acknowledge this existing conflict and clarify which handler is authoritative in tab mode. The cleanest approach: remove the plugin's `update-status` handler entirely and let the user's config handle all status bar rendering, with the plugin providing helper functions if needed.

### CLI Changes: `wez-into` (Section 6)

**Non-blocking.** The proposed `do_connect` changes are reasonable. The `wezterm cli spawn --domain-name` with fallback to `wezterm connect` is the pattern recommended by the integration report.

Two observations:

1. The current `do_connect` (line 413 of `wez-into`) sets `XKB_LOG_LEVEL=10` and has a prerequisite check for `wezterm` on PATH. The proposal's replacement omits both. The `XKB_LOG_LEVEL` suppression is needed on Fedora to avoid xkbcommon noise, and the PATH check prevents a confusing error. These should be preserved.

2. The proposal's fallback path uses `wezterm connect "lace:$port" --workspace "$project"` which creates a workspace. This means the cold-start case still creates a workspace, but subsequent `wezterm cli spawn` calls create tabs in the default workspace (likely "main"). The user would end up with tabs scattered across two workspaces. The fallback should either: (a) use `--workspace main` to target the standard workspace, or (b) accept that the cold-start window will have its own workspace and document this mixed-mode behavior.

3. The `refresh_host_key` call is moved before the dry-run check in the proposal, but in the original code (line 428), it happens after the dry-run early exit. The proposal's version would do a real `ssh-keyscan` even in dry-run mode. The original ordering is better.

### Design Decisions

The four design decisions are well-reasoned:

- **Default to workspace mode**: Correct. Backward compatibility is essential.
- **Duplicate detection by domain name**: Sound. Domain names are ground truth for active connections.
- **`format-tab-title` handler**: Correct mechanism per the tab-title-pinning report.
- **Fall back to `wezterm connect`**: Necessary for cold-start. The interaction with workspaces needs clarification (see above).

### Edge Cases

The edge cases section is thorough. The "container restart changes port" scenario correctly identifies that stale tabs must be manually closed. The "multiplexer fan-out" note is important: connecting to a WezTerm mux domain surfaces all remote tabs, which in tab mode means the local tab bar could suddenly gain several tabs from a previous session. The proposal acknowledges this but doesn't propose mitigation.

**Non-blocking.** One missing edge case: what happens when the user is in a workspace other than "main" and uses the picker? `SpawnCommandInNewTab` creates a tab in the current window's current workspace. If the user switches to the "scratch" workspace and then opens the picker, the lace tab appears in "scratch," not "main." This may be surprising. The duplicate detection also only checks the current mux window's tabs, so it wouldn't find a lace tab that was spawned in a different workspace if the user has since switched.

### Test Plan

**Non-blocking.** The test plan covers the core scenarios. Missing:

- Test the `mux-tab-added` (or replacement) title-setting mechanism with a remote mux domain that has pre-existing tabs (fan-out case).
- Test config reload behavior: after a config reload, does the discovery cache survive? Does the `format-tab-title` handler re-register correctly?
- Test that the `format-tab-title` handler does not degrade rendering performance (it fires on every tab bar repaint).

### Implementation Phases

The four-phase approach is reasonable and correctly orders the work: connection logic first, then title management, then status bar, then CLI. Phase 1 is the minimum viable change. Phase 2 depends on resolving the `mux-tab-added` issue.

**Non-blocking.** Phase 3 (status bar) should be merged with Phase 2 since both involve event handlers and are closely related. Four phases for this scope may be over-segmented.

## Verdict

**Revise.** The proposal's core architecture is sound, but two blocking issues must be resolved before implementation:

1. The `mux-tab-added` event does not exist in WezTerm. An alternative tab-title-setting mechanism is needed.
2. The module-level discovery cache is incompatible with WezTerm's config reload model. Must use `wezterm.GLOBAL`.

The non-blocking issues (handler conflicts, CLI detail preservation, cross-workspace edge cases) should be addressed but are not gating.

## Action Items

1. [blocking] Replace the `mux-tab-added` approach with a viable alternative for setting tab titles after spawn. Recommended: use `format-tab-title` to resolve titles from `wezterm.GLOBAL.lace_discovery_cache` by domain name, eliminating the need for a separate tab-creation event entirely.
2. [blocking] Change the discovery cache from module-level to `wezterm.GLOBAL.lace_discovery_cache`, consistent with the existing pattern in `plugin/init.lua` for `wezterm.GLOBAL.lace_domains_logged` and `wezterm.GLOBAL.lace_picker_registered`.
3. [non-blocking] Provide the `format-tab-title` logic as a plugin helper function rather than registering the event handler inside the plugin. Let the user's config own the event registration to avoid single-handler conflicts.
4. [non-blocking] Preserve `XKB_LOG_LEVEL=10`, the `wezterm` PATH check, and the correct dry-run ordering in the CLI's `do_connect` replacement.
5. [non-blocking] Clarify the cold-start fallback's workspace targeting: either explicitly use `--workspace main` or document the mixed workspace/tab behavior.
6. [non-blocking] Document the cross-workspace edge case: picker spawns tabs in the current workspace, and duplicate detection is scoped to the current mux window.
7. [non-blocking] Address the existing `update-status` handler conflict between the plugin and user config. Consider removing the plugin's handler.
8. [non-blocking] Fix the "two relevant architectural facts" / three-item list mismatch in the Background section.
9. [non-blocking] Update frontmatter: set `task_list` to a real workstream path and use a specific model name in `first_authored.by`.
