---
review_of: cdocs/devlogs/2026-02-28-tab-oriented-lace-wezterm.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-28T22:00:00-06:00
task_list: lace/wezterm-tab-mode
type: review
state: archived
status: done
tags: [fresh_agent, code_correctness, edge_cases, race_conditions, verification_sufficiency, cli_robustness]
---

# Review: Tab-Oriented lace.wezterm Implementation (Devlog)

## Summary Assessment

This devlog documents the implementation of tab-oriented connection mode across three codebases: the lace.wezterm plugin, the user's dotfiles wezterm config, and the wez-into CLI script. The implementation successfully addressed both blocking issues identified in the prior proposal review (nonexistent `mux-tab-added` event and module-level cache invalidation), and the code quality across all three files is solid. The most significant concern is a stale cache problem in the discovery cache that could cause tab titles to display wrong project names after container port reassignment, and a subtlety in the CLI fallback path where `wezterm cli spawn` stderr suppression could mask errors unrelated to a missing mux. The verification evidence covers config parse correctness thoroughly but honestly acknowledges that the core runtime behaviors (tab creation, duplicate detection, title rendering) remain untested.

**Verdict: Accept with reservations.** The implementation is well-structured and the review-driven revisions demonstrate good engineering discipline. The blocking items below are survivable in practice but represent real failure modes that should be addressed before this is considered production-hardened.

## Section-by-Section Findings

### Plugin: Tab Mode Branching (init.lua lines 305-338)

**Non-blocking.** The branching logic is clean. The `if opts.connection_mode == "tab"` guard correctly separates tab and workspace code paths. The `else` branch preserves the original `SwitchToWorkspace` behavior unchanged, which is important for backward compatibility.

One observation: the `opts.connection_mode` value is not validated. If a user passes `connection_mode = "tabs"` (plural) or any other typo, the code silently falls through to workspace mode. A `wezterm.log_warn` for unrecognized values would prevent debugging headaches. This is minor.

### Plugin: Duplicate Tab Detection (init.lua lines 307-316)

**Non-blocking (correctness concern).** The duplicate detection iterates `mux_win:tabs()` and checks `p:get_domain_name()` against the target domain. This is correct for the stated single-window goal. Two observations:

1. The code uses `mux_win:tabs()` which returns tab objects directly. This is consistent with the integration report's recommendation and avoids the `tabs_with_info()` API surface mismatch flagged in the prior review. Good.

2. `tab:activate()` activates the tab within the mux but the behavior for GUI focus depends on whether the tab is in the currently-visible workspace. Within a single window/workspace, this works naturally. The prior review flagged this as needing verification; it remains in the "not yet verified" bucket, which is acceptable.

3. The iteration checks all panes within each tab (`tab:panes()`). If a tab has multiple panes and only one is connected to the lace domain, the duplicate detection still triggers. This is correct behavior -- a tab with even one pane on the target domain should be considered a match.

### Plugin: Discovery Cache (init.lua lines 258-264)

**Blocking (stale data).** The discovery cache is populated in `wezterm.GLOBAL.lace_discovery_cache` each time the picker runs. The cache maps `port -> project_name`. Two problems:

1. **Stale entries are never evicted.** If a container is stopped and later recreated on a different port, the old `port -> name` mapping persists in the cache indefinitely (until WezTerm process restart). If a different project subsequently claims the old port, the `format_tab_title` function will display the wrong project name for that tab. The cache population code does `wezterm.GLOBAL.lace_discovery_cache = wezterm.GLOBAL.lace_discovery_cache or {}` and then adds entries, but never removes entries that are no longer present in `discover_projects()`.

   **Fix:** Replace the incremental cache update with a full cache replacement each time the picker runs:

   ```lua
   local new_cache = {}
   for name, info in pairs(projects) do
     new_cache[info.port] = name
   end
   wezterm.GLOBAL.lace_discovery_cache = new_cache
   ```

   This ensures the cache always reflects the current state of running containers.

2. **Cache is only populated when the picker is invoked.** If a user connects via `wez-into` (CLI) without ever opening the picker, the cache is empty and `format_tab_title` falls through to the pane title for all lace tabs. This is documented behavior (the proposal notes that the cache is populated by the picker), but it means tab titles are wrong until the user opens the picker at least once. This is a design tradeoff, not a bug, but it is worth noting because the user might expect tab titles to work immediately after `wez-into` creates a tab.

### Plugin: format_tab_title Helper (init.lua lines 422-439)

**Non-blocking (defensive concern).** The helper function is well-structured with a clear priority chain: explicit tab title, then cache lookup, then pane title fallback. Two observations:

1. The `tab_info.active_pane.domain_name` access assumes `active_pane` is never nil. In WezTerm's event model, the `TabInformation` object passed to `format-tab-title` always has an `active_pane` field, so this is safe. But if the tab has no panes (edge case during tab teardown), this could error. Adding a nil guard (`if tab_info.active_pane and tab_info.active_pane.domain_name`) would be strictly more robust.

2. The port extraction pattern `^lace:(%d+)$` correctly anchors both ends, preventing false matches on hypothetical domain names like `my-lace:22426` or `lace:22426:extra`.

### Plugin: Status Bar Removal

**Non-blocking.** The removal of the `setup_status_bar` function and the `enable_status_bar` option is clean. The devlog correctly notes this was dead code (the user's handler always won due to load order). The diff confirms the removal is complete -- no dangling references to `setup_status_bar` or `lace_status_registered` remain.

### User Config: format-tab-title Handler (wezterm.lua lines 385-391)

**Non-blocking (truncation edge case).** The handler's truncation logic:

```lua
if #title > max_width - 2 then
  title = title:sub(1, max_width - 5) .. "..."
end
return " " .. title .. " "
```

This has a subtle issue when `max_width` is very small (less than 5). If `max_width` is 4, then `max_width - 5 = -1`, and `title:sub(1, -1)` in Lua returns the entire string, then appends "...", making the title longer rather than shorter. In practice, WezTerm's `tab_max_width` is set to 40, so `max_width` will be at least 40, making this a non-issue for the current configuration. But if the user later reduces `tab_max_width`, this could produce unexpectedly long tab titles.

The tab-title-pinning report recommended `wezterm.truncate_right()` instead of manual substring truncation. That function handles edge cases better and respects Unicode grapheme boundaries.

Also, the handler returns a plain string (`" " .. title .. " "`), not a styled `FormatItem` table. This means lace tab titles lose the custom active/inactive styling defined in `config.colors.tab_bar`. The tab-title-pinning report's implementation sketch used `FormatItem` tables with `slate` palette colors. Returning a plain string means WezTerm applies default formatting, which in the retro tab bar mode actually respects `config.colors.tab_bar` -- so this may be fine. But it is worth verifying that the active/inactive tab distinction is visually preserved when the handler returns a plain string.

### User Config: Event Registration Placement (wezterm.lua lines 385-391)

**Non-blocking.** The `format-tab-title` handler is registered inside the `if ok then` block that guards the lace plugin load. This means if the lace plugin fails to load, no `format-tab-title` handler is registered, and WezTerm uses default tab rendering. This is correct -- the handler calls `lace_plugin.format_tab_title(tab)`, so it cannot function without the plugin.

However, this also means that for non-lace tabs (local shell, nvim, etc.), the handler controls title rendering. Since `lace_plugin.format_tab_title` falls through to `tab_info.active_pane.title` for non-lace tabs, this is functionally transparent. But it does mean every tab's title goes through the plugin's title resolution function and the truncation/padding logic. If the user later adds another plugin that wants to control tab titles, this handler would need to be refactored to compose multiple title sources.

### CLI: wez-into do_connect (lines 413-448)

**Blocking (error masking).** The `wezterm cli spawn --domain-name "lace:$port" 2>/dev/null` call suppresses all stderr. This means that if `wezterm cli spawn` fails for a reason other than "no running mux" (e.g., the domain name is unrecognized, SSH connection fails, mux server is overloaded), the error is silently swallowed and the fallback to `wezterm connect` fires. The fallback then creates a new window, which may not be what the user wants.

More concretely: if a WezTerm mux is running but the SSH domain connection fails (e.g., container sshd is not ready yet), `wezterm cli spawn` will fail with a nonzero exit code, stderr is suppressed, and the fallback creates a new window instead of reporting the actual error. The user gets a new window with a broken connection instead of an error message.

**Fix:** Capture stderr and check it before falling back:

```bash
local spawn_stderr
spawn_stderr=$(wezterm cli spawn --domain-name "lace:$port" 2>&1 >/dev/null) && {
  info "tab created for $project"
} || {
  if [[ "$spawn_stderr" == *"connect to the WezTerm multiplexer server"* ]] || \
     [[ "$spawn_stderr" == *"Connection refused"* ]]; then
    info "no running mux, falling back to wezterm connect..."
    wezterm connect "lace:$port" --workspace main &>/dev/null &
    disown
  else
    err "wezterm cli spawn failed: $spawn_stderr"
    exit 1
  fi
}
```

Alternatively, test for a running mux explicitly before attempting spawn:

```bash
if wezterm cli list &>/dev/null; then
  wezterm cli spawn --domain-name "lace:$port"
  info "tab created for $project"
else
  ...fallback...
fi
```

### CLI: Fallback Workspace Targeting

**Non-blocking.** The fallback `wezterm connect "lace:$port" --workspace main` correctly targets the "main" workspace, as recommended by the prior review. This ensures the cold-start window appears in "main" and subsequent `wezterm cli spawn` calls create tabs alongside it. The prior review's non-blocking item 5 is resolved.

### CLI: Behavioral Change (foreground vs background)

**Non-blocking (UX concern).** The original `do_connect` ran `wezterm connect ... &>/dev/null & disown`, which immediately returned control to the calling terminal. The new `wezterm cli spawn` path runs in the foreground (no backgrounding). If `wezterm cli spawn` takes time (e.g., SSH connection negotiation), the caller blocks. The fallback path still backgrounds `wezterm connect`, maintaining the original behavior for cold starts.

For interactive use from a terminal, this blocking is usually brief and acceptable. But for scripted use (e.g., calling `wez-into` from another automation tool), the caller may not expect to block. The original behavior was fully asynchronous. This is a minor UX regression that should be documented.

### CLI: `wezterm cli spawn` stdout

**Non-blocking.** `wezterm cli spawn` prints the new pane ID to stdout when successful. The current code does not suppress stdout, so the pane ID is printed to the terminal. This is harmless for interactive use but could interfere with scripted use. Adding `>/dev/null` or capturing the output would be cleaner:

```bash
if wezterm cli spawn --domain-name "lace:$port" >/dev/null 2>/dev/null; then
```

### Devlog: Verification Evidence

**Non-blocking (honest gaps).** The devlog's verification section is thorough for what it covers:

- Config parse check via `ls-fonts` stderr -- correct methodology per CLAUDE.md.
- Key binding diff -- correct second-layer defense.
- Mux health check -- confirms no crash from config changes.
- WezTerm log tail -- no errors post hot-reload.
- Deployed config match -- chezmoi source matches deployed.
- CLI syntax check and dry-run -- basic correctness.

The "Not Yet Verified" section is forthright about what was not tested:

- Picker creating tabs instead of workspaces
- Duplicate tab detection
- Tab title rendering
- Tab title immunity to OSC changes

These are the core behaviors of the feature. The devlog correctly identifies them as deferred to the next interactive session with a running devcontainer. This is acceptable for a devlog (the implementation is committed; runtime testing is a separate step) but it means the feature is not yet validated end-to-end.

### Devlog: Commit Tracking

**Non-blocking.** The three commits are clearly listed with hashes and descriptions. Cross-repo changes are tracked. The commit messages follow conventional commit format (`feat:`, `feat(wezterm):`, `feat(wez-into):`).

### Prior Review Blocking Items: Resolution

The prior review identified two blocking issues:

1. **`mux-tab-added` does not exist** -- Resolved. The implementation uses `format-tab-title` with a `wezterm.GLOBAL` discovery cache to resolve tab titles at render time, eliminating the need for any tab creation event. This is exactly what the review recommended.

2. **Module-level cache invalidation** -- Resolved. The cache uses `wezterm.GLOBAL.lace_discovery_cache`, consistent with existing `wezterm.GLOBAL.lace_picker_registered` patterns.

All seven non-blocking items from the prior review were also addressed:

3. `format_tab_title` exposed as a helper function (not a registered handler) -- Done.
4. `XKB_LOG_LEVEL`, PATH check, and dry-run ordering preserved -- Done.
5. Cold-start fallback targets `--workspace main` -- Done.
6. Cross-workspace edge case -- Documented in the proposal's edge cases section.
7. `update-status` handler conflict -- Resolved by removing the plugin's handler.
8. "Two/three" list mismatch -- Fixed in proposal revision (now says "three").
9. Frontmatter updated -- `task_list` and `first_authored.by` corrected.

## Additional Findings

### Race Condition: Discovery Cache and Tab Spawning

**Non-blocking (theoretical).** There is a subtle race between the discovery cache population and tab title rendering. The picker populates the cache, then spawns a tab. The `format-tab-title` handler reads the cache on the next render cycle. If WezTerm renders the tab bar between the spawn action and the cache population (impossible in the current code since cache is populated before spawn), the tab would briefly show the pane title. In the current implementation the cache is populated before the spawn, so this is not a real issue. Documenting for completeness.

### Discovery Cache Key Type

**Non-blocking (type safety).** The cache maps `info.port` (a number from Lua's `tonumber()` in `discover_projects()`) to project name. The `format_tab_title` function extracts the port with `tonumber(domain:match("^lace:(%d+)$"))`. Both sides use `tonumber()`, so the key types match. If `discover_projects` ever returned a port as a string, the lookup would fail silently. The current code is correct but this invariant is implicit.

### Plugin: `opts` Captured by Closure

**Non-blocking.** The picker event handler captures `opts` by closure reference at registration time. Since the handler is registered once (guarded by `wezterm.GLOBAL.lace_picker_registered`), the `opts` table from the first call to `setup_project_picker` is permanently bound. If the user changes `connection_mode` in their config and triggers a config reload, the handler still uses the original `opts`. This is the existing behavior for all picker options (not new to this change), but it means config reloads do not affect the picker's connection mode without a full WezTerm restart.

### Multiplexer Fan-Out in Tab Mode

**Non-blocking (user-facing behavior).** The proposal acknowledges that `multiplexing = "WezTerm"` causes remote mux tabs to appear in the local tab bar when connecting. In workspace mode, this was contained within a workspace namespace. In tab mode, all remote tabs appear in the shared tab bar. If a devcontainer's wezterm mux server has accumulated 5 tabs from a previous session, connecting creates 5 local tabs, not 1. The duplicate detection code checks for an existing tab with the target domain name, but after fan-out, multiple tabs will have that domain. Subsequent picker invocations will activate the first matching tab (the one found first in the iteration), which may not be the one the user expects.

This is a known limitation documented in the proposal. The practical impact depends on how many tabs accumulate on remote mux servers.

## Verdict

**Accept with reservations.** The implementation is well-structured, the prior review's blocking issues are fully resolved, and the code quality is good. The two blocking findings (stale cache and error masking) are real but survivable -- they cause cosmetic issues (wrong tab title after port reassignment) and suboptimal error handling (swallowed errors fallback to new window), not data loss or crashes. These should be addressed in a follow-up pass, ideally before the runtime behaviors are tested with a live devcontainer.

## Action Items

1. [blocking] Fix stale discovery cache entries: replace incremental cache update with full cache replacement in the picker callback. The current code never evicts entries for containers that are no longer running, which can cause `format_tab_title` to display wrong project names after port reassignment.

2. [blocking] Improve `wezterm cli spawn` error handling in `wez-into`: either check for a running mux explicitly before attempting spawn, or capture stderr and only fall back to `wezterm connect` for mux-not-running errors. The current `2>/dev/null` suppression masks all spawn failures, causing the fallback to fire inappropriately.

3. [non-blocking] Add validation for `connection_mode` option values. Log a warning if the value is neither `"workspace"` nor `"tab"`.

4. [non-blocking] Consider suppressing `wezterm cli spawn` stdout (it prints the new pane ID) for cleaner terminal output.

5. [non-blocking] Add a nil guard for `tab_info.active_pane` in `format_tab_title` to handle edge cases during tab teardown.

6. [non-blocking] Consider using `wezterm.truncate_right()` instead of manual `string.sub` for tab title truncation, to handle Unicode grapheme boundaries correctly.

7. [non-blocking] Document that the discovery cache is only populated by the picker, so tab titles from `wez-into`-created tabs will show pane titles until the picker is opened at least once.

8. [non-blocking] Verify that returning a plain string from `format-tab-title` preserves the active/inactive tab visual distinction defined in `config.colors.tab_bar` when using the retro tab bar.
