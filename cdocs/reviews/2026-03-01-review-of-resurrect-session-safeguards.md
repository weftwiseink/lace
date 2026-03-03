---
review_of: cdocs/proposals/2026-03-01-resurrect-session-safeguards.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-01T12:00:00-06:00
task_list: wezterm/resurrect-hardening
type: review
state: archived
status: done
tags: [resurrect, wezterm, session-persistence, validation, crash-prevention, fork, code-review]
---

# Review: Safeguarding resurrect.wezterm Session State on Save and Restore

## Summary Assessment

The proposal correctly diagnoses the crash loop root cause and proposes a sound layered defense (save-side filtering, restore-side validation, backup-on-overwrite). The analysis of the existing code paths is accurate -- I verified every line reference against the actual source at `/home/mjr/code/libraries/resurrect.wezterm/plugin/`. The phasing is sensible: Phase 1 can ship independently and would have prevented the observed crash loop. However, there are several issues ranging from blocking code correctness problems to minor gaps in edge case handling.

**Verdict: Accept with required modifications.** The overall architecture is correct. The specific issues identified below must be addressed before implementation.

## Section-by-Section Findings

### 1a. `is_pane_healthy()` -- Pane Health Check Function

**Finding [blocking]: The function signature takes `pane_info` (a `PaneInformation`) but the actual `PaneInformation` type in the plugin uses `.pane` as a field.**

Looking at the actual `insert_panes()` in `pane_tree.lua` (lines 73-142), the function receives a `root` parameter which is a `PaneInformation` object. The pane object is accessed as `root.pane` (line 78). The proposal's `is_pane_healthy()` function correctly accesses `pane_info.pane`, which matches this convention.

However, there is a subtle issue: the `PaneInformation` type alias at line 10 of `pane_tree.lua` is defined as `{left: integer, top: integer, height: integer, width: integer}` -- it does not include a `.pane` field. The actual WezTerm `PaneInformation` object (returned by `tab:panes_with_info()`) includes `.pane`, `.is_active`, `.is_zoomed`, `.left`, `.top`, `.width`, `.height` as runtime fields. The type annotation is incomplete in the plugin source, but the runtime behavior is what matters. The proposal's access pattern is correct for runtime behavior.

**Finding [blocking]: Check 3 (zero pixel dimensions) uses `pane:get_dimensions()` but the ghost tab symptom described is zero `pixel_width`/`pixel_height` from the `PaneInformation` struct, not from `pane:get_dimensions()`.**

In the existing `insert_panes()`, the code never calls `pane:get_dimensions()` to check pixel dimensions -- it reads `root.pane:get_dimensions().scrollback_rows` (line 106) for scrollback, but the pixel dimensions described in the crash scenario come from the `PaneInformation` fields (`root.width`, `root.height`, which are cell dimensions, not pixel dimensions). The WezTerm `pane:get_dimensions()` API returns `{cols, viewport_rows, scrollback_rows, physical_top, scrollback_top, pixel_width, pixel_height}`. The `PaneInformation` struct from `panes_with_info()` returns cell-level `width` and `height`, not pixels.

The question is: which dimensions are actually zero for ghost tabs? If it is the `PaneInformation.width`/`PaneInformation.height` (cell dimensions), then the check should be:

```lua
if pane_info.width == 0 and pane_info.height == 0 then
    return false, "zero cell dimensions (never rendered)"
end
```

If it is `pane:get_dimensions().pixel_width` and `.pixel_height`, then the proposal's version is correct. The proposal's background section (line 38) says "pixel_height, pixel_width from the pane dimensions" -- this is ambiguous. Since both the `PaneInformation` cell dimensions and `pane:get_dimensions()` pixel dimensions would be zero for a never-rendered ghost tab, the check should ideally test both, or at minimum test the `PaneInformation` cell dimensions since those are what's available without an extra API call:

```lua
-- Check from PaneInformation struct (no extra API call needed)
if pane_info.width == 0 and pane_info.height == 0 then
    return false, "zero cell dimensions (never rendered)"
end
```

**Finding [non-blocking]: Check 2 accesses `cwd.file_path` but should handle the case where `get_current_working_dir()` returns a URL object.**

`pane:get_current_working_dir()` returns a URL object with `.file_path`, `.host`, `.scheme`, etc. The proposal correctly accesses `.file_path`. However, for SSH domain panes, the URL may have a non-empty `.file_path` like `/home/user` even when the connection is stuck. The `cwd` nil check on line 71 is the real guard here; the `.file_path` check on line 75 is a secondary defense. This is fine as-is.

**Finding [non-blocking]: Check 4 (domain spawnable) partially duplicates the check already in `insert_panes()` at lines 79-81.**

The existing `insert_panes()` already checks `is_spawnable()` and logs a warning, but it continues serializing the pane with empty data rather than skipping it. The proposal's pre-filter in `create_pane_tree()` would run before `insert_panes()` is called, making the check in `insert_panes()` redundant for panes that pass the filter. This is acceptable -- belt-and-suspenders -- but worth noting that the existing check in `insert_panes()` could be simplified or removed once the pre-filter is in place.

**Finding [non-blocking]: Missing check for pane liveness.**

WezTerm panes have an `is_alt_screen_active()` method but no direct "is alive" check. However, a pane whose process has exited would still have a valid cwd and dimensions until the tab is closed. Ghost tabs from SSH domains are the primary concern, and those are caught by the cwd-nil check. A process-exit check is not needed for the immediate problem.

### 1b. Filter Unhealthy Panes in `create_pane_tree()`

**Finding [blocking]: The proposal filters panes before building the tree, but `create_pane_tree()` receives `PaneInformation` objects from `tab:panes_with_info()`, and removing panes from this list will break the spatial tree construction.**

The `insert_panes()` function builds a binary tree based on spatial relationships (left/top coordinates and width/height adjacency). It uses `is_right()` and `is_bottom()` to determine which panes are to the right or below the root, and `pop_connected_right()`/`pop_connected_bottom()` to find directly adjacent panes. If you filter out an unhealthy pane that sits between two healthy panes, the healthy panes may no longer be spatially adjacent, and the tree construction will produce an incorrect layout or miss panes entirely.

For example, consider a horizontal split: `[A | B | C]` where B is unhealthy. After filtering, you have `[A, C]`. A is the root. C is to the right of A, but `pop_connected_right(A, [C])` checks `root.left + root.width + 1 == pane.left`, which will fail because B's width occupied the space between A and C. C becomes unreachable in the tree.

This is a real problem for multi-pane layouts. For single-pane tabs (the most common case with ghost SSH tabs), filtering works correctly because the entire tab is skipped when `#healthy_panes == 0`.

**Recommendation:** For Phase 1, the filtering approach is acceptable because ghost tabs are almost always single-pane tabs (an SSH connection in "Connecting..." state). Document the limitation for multi-pane layouts and address it in Phase 2 by filtering within `insert_panes()` instead:

```lua
local function insert_panes(root, panes)
    if root == nil then
        return nil
    end

    -- Skip unhealthy panes during tree construction
    local healthy, reason = is_pane_healthy(root)
    if not healthy then
        wezterm.log_warn("resurrect: skipping unhealthy pane: " .. (reason or "unknown"))
        -- Try the next pane that would occupy this position
        if #panes > 0 then
            local next_root = table.remove(panes, 1)
            return insert_panes(next_root, panes)
        end
        return nil
    end

    -- ... existing serialization logic ...
end
```

This approach handles the spatial adjacency problem by skipping unhealthy nodes within the tree walk rather than pre-filtering the list.

### 1c. Filter Empty Tabs from Window State

**Finding [correct]: The logic is sound.** If `create_pane_tree()` returns nil (all panes unhealthy), the tab is skipped. The existing `get_window_state()` at line 8-25 of `window_state.lua` simply iterates tabs and stores them at index `i`. The proposal changes this to use `table.insert()`, which produces a contiguous array. This is correct.

**Finding [minor]: The `window_state.size` assignment changes behavior.**

In the existing code, `window_state.size = tabs[1].tab:get_size()` always sets size from the first tab. The proposal moves this inside a `#window_state.tabs > 0` guard, which is correct for preventing nil access. However, it still uses `tabs[1]` (the first raw tab from WezTerm) rather than `window_state.tabs[1]` (the first healthy tab). This is fine because `get_size()` returns the window's tab size, which should be the same regardless of which tab you ask. But if `tabs[1]` was the unhealthy tab, its `get_size()` might return zero dimensions. Consider using `window_state.tabs[1].pane_tree` to derive size, or just calling `window:active_tab():get_size()` instead.

### 1d. Skip Saving When Workspace is Degraded

**Finding [correct but mislocated]: The proposal places this logic in `state_manager.periodic_save()`, but the actual periodic save at lines 53-91 of `state_manager.lua` calls `pub.save_state(require("resurrect.workspace_state").get_workspace_state())`.**

The `save_state()` function (line 26-34) dispatches based on state type. The check should be either in `save_state()` itself or inline in `periodic_save()` as proposed. The proposal's approach of inlining in `periodic_save()` works but creates a second code path -- manual saves via `save_state()` would not benefit from this check. Consider putting the "has valid content" check in `save_state()` instead so both periodic and manual saves are protected.

**Finding [non-blocking]: The proposal only checks `save_workspaces` but `periodic_save()` also has `save_windows` and `save_tabs` branches.**

The degraded-state check should apply to all three branches, not just workspaces. A ghost tab could also corrupt window or tab state files.

### 1e. Backup Before Overwrite

**Finding [correct]: The `os.rename()` approach is correct and atomic on Linux (same filesystem).**

One concern: the plugin's state directory is inside the plugin path (`plugin_path .. "/state/"`). If the state file and `.bak` are on the same filesystem (they will be), `os.rename()` is atomic. Good.

**Finding [non-blocking]: The backup happens before `sanitize_json()` in the proposal, but the actual `write_state()` at lines 72-95 of `file_io.lua` calls `wezterm.json_encode(state)` first, then `sanitize_json()`. If `json_encode` throws (e.g., on circular references), the backup was already created but the new write never happens -- which is actually the desired behavior (old state preserved).**

This is correct. No change needed.

**Finding [non-blocking]: The proposal does not handle the encryption path.**

The existing `write_state()` has two branches: encrypted and unencrypted. The backup logic should happen before either branch. The proposal's placement (before `json_encode`) is correct for both paths since it runs before the branch point.

### 2a. `validate_pane_tree()` -- Restore-Side Validation

**Finding [blocking]: The validation mutates the pane_tree in place (setting `pane_tree.right = nil` or `pane_tree.bottom = nil` during pruning) but returns a boolean.**

The caller in section 2b checks `local valid, reason = pane_tree_mod.validate_pane_tree(tab_state.pane_tree)`. If the root node itself is invalid, the function returns `false` and the tab is skipped -- correct. But if only a subtree is invalid, the function prunes it (mutation) and returns `true` -- also correct. The dual behavior (mutate + return status) is a code smell but functionally sound.

**Finding [non-blocking]: The domain existence check uses `wezterm.mux.get_domain(pane_tree.domain)` but the `domain` field in the serialized JSON is a string like `"local"` or `"SSH:hostname"`. The `get_domain()` API takes a domain name string and returns a domain object or nil.** This is correct usage.

**Finding [non-blocking]: Missing validation of `cwd` format.**

The check `pane_tree.cwd == ""` catches the ghost tab case, but a cwd like `"file:///home/user"` (a URL instead of a path) could also cause problems. In the existing serialization code (line 88), `root.cwd` is set from `root.pane:get_current_working_dir().file_path`, which should always be a path string (not a URL). So this edge case should not arise from the plugin's own serialization. It could arise from hand-edited JSON, but that is an extreme edge case.

### 2b. Filter Invalid Tabs During Window Restore

**Finding [blocking]: The `goto continue` pattern skips tabs but the first-tab logic uses `restored_count` instead of `i`, which is correct. However, the existing `restore_window()` code at line 82 of `window_state.lua` calls `active_tab:activate()` unconditionally.**

If all tabs are invalid and `restored_count == 0`, `active_tab` is nil and `active_tab:activate()` will crash. The proposal should add a nil guard:

```lua
if active_tab then
    active_tab:activate()
end
```

The proposal's code on line 313 does include this guard (`if active_tab then`). This is correct and is actually a fix for a latent bug in the existing code where if `is_active` is not set on any tab, `active_tab` would also be nil.

**Finding [non-blocking]: The proposal changes the first-tab detection from `i == 1` to `restored_count == 1`.**

This is correct. Without this change, skipping tab 1 (invalid) would mean tab 2 tries to use `opts.tab` (the existing tab for reuse) at `i == 2` which would fail the `i == 1` check, and a new tab would be spawned unnecessarily. With `restored_count == 1`, the first valid tab reuses the existing tab. Good.

**Finding [non-blocking]: The `close_open_tabs` logic also needs the same `restored_count` treatment.**

Line 68 of the existing code has `if i == 1 and opts.close_open_tabs then`. The proposal changes this to `if restored_count == 1 and opts.close_open_tabs then` (line 297). Correct.

### 2c. Graceful Error Handling in `restore_workspace()`

**Finding [blocking]: The proposal shows `pcall` around the per-window logic with `-- ... existing per-window restore logic ...` placeholder, but the existing `restore_workspace()` at lines 19-44 of `workspace_state.lua` has complex logic for the first window vs. subsequent windows.**

For `i == 1`, it reuses `opts.window` and optionally resizes it. For `i > 1`, it calls `wezterm.mux.spawn_window()`. If the pcall catches an error from `spawn_window()` for window 2, the state (`opts.tab`, `opts.pane`, `opts.window`) is not updated, which means window 3 would try to use stale state. This is a real concern.

The fix: each iteration inside the pcall should be self-contained with respect to opts mutation, or the opts should be reset on error:

```lua
if not ok then
    -- Reset opts to prevent stale state from affecting subsequent windows
    opts.tab = nil
    opts.pane = nil
    -- opts.window stays as-is (it was the last successfully created window)
end
```

Additionally, on line 35 of `workspace_state.lua`, the code accesses `window_state.tabs[1].pane_tree.cwd` for the `spawn_window_args`. If `window_state.tabs` is empty (all tabs were pruned by the restore-side validation), this will crash inside the pcall, which is caught but the error message should be clear.

### 2d. Restore from Backup on Load Failure

**Finding [correct]: The fallback logic is sound.** The existing `load_state()` at lines 40-49 of `state_manager.lua` calls `file_io.load_json()`, which returns nil on parse failure. The proposal adds a `.bak` fallback. This is clean and correct.

**Finding [non-blocking]: `load_json()` at lines 99-126 of `file_io.lua` uses `io.lines()` which throws if the file does not exist.** The function has no pcall around `io.lines()`. If the `.bak` file does not exist, `load_json()` would throw rather than returning nil. The proposal should wrap the backup load attempt in pcall:

```lua
local ok, bak_json = pcall(file_io.load_json, bak_path)
if ok and bak_json then
    json = bak_json
else
    wezterm.emit("resurrect.error", "Invalid json (both primary and backup): " .. file_path)
    return {}
end
```

## Open PR Assessment Review

### PR #127 (nil pane access in symmetric layouts) -- Adopt as-is

**Agree.** I verified the problem: in `insert_panes()`, a pane can appear in both the `right` and `bottom` lists (lines 122-129) because `is_right()` and `is_bottom()` are not mutually exclusive. When a pane is processed through one branch, `root.pane` is set to nil (line 115). If it is then processed through the other branch, `root.pane:get_domain_name()` (line 78) crashes. The nil guard is the correct fix. This is independent of the proposal's changes and should be merged first.

### PR #123 (module require fix) -- Adopt with modifications

**Agree with the assessment.** The circular dependency concern is valid but mitigated by lazy require inside `wezterm.action_callback`. The `tab_state.lua` file at line 124 already does `local resurrect = require("resurrect")` inside a callback, and line 142 does `resurrect.state_manager.save_state(state)` -- this is the pattern PR #123 fixes. The existing code has an inconsistency: line 98 uses `resurrect.save_state(state)` (via init.lua's re-export) while line 142 uses `resurrect.state_manager.save_state(state)`. PR #123 should normalize both.

### PR #118 (workspace name fix) -- Adopt as-is

**Agree.** The existing `restore_workspace()` does not call `set_active_workspace()` after spawning into a named workspace. This means the workspace name is set on the window but the mux does not switch to it. The fix is minimal and correct.

### PR #134 (Windows compatibility) -- Skip

**Agree.** Linux-only environment.

### PR #130 (Fix #125, mkdir replacement) -- Skip

**Agree.** The `io.open(tmp, "w")` approach is fundamentally broken for creating directories. The existing `mkdir -p` is correct on Linux.

### PR #128 (NixOS path sanitization) -- Skip

**Agree.** Not relevant to the environment.

## Risks and Gaps Not Covered

### Gap 1: `format_tab_title` handler crash

The proposal mentions that ghost tabs "trigger a nil crash in the `format_tab_title` handler" but does not address hardening the `format_tab_title` handler itself. Even if save/restore are fixed, a ghost tab created by a new SSH connection attempt (before any save happens) can still crash the tab title handler. The `format_tab_title` handler should be independently hardened with nil guards. This is outside the scope of the resurrect plugin fork but should be tracked as a companion fix in the wezterm config.

### Gap 2: The `active_tab:activate()` crash in existing code

Line 82 of the existing `window_state.lua` calls `active_tab:activate()` unconditionally. If no tab has `is_active = true` in the saved state, `active_tab` is nil and this crashes. The proposal's version (section 2b) adds a nil guard, which is correct. But this is also a latent bug in the existing upstream code that could be fixed independently.

### Gap 3: `workspace_state.restore_workspace()` accesses `window_state.tabs[1]` without checking

Line 35 of `workspace_state.lua`:
```lua
cwd = window_state.tabs[1].pane_tree.cwd,
```

If `window_state.tabs` is empty (all tabs pruned), this crashes. The restore-side validation in Phase 2 should add a guard here, or the window should be skipped if it has no valid tabs.

### Gap 4: Race between periodic save and manual save

If a manual save fires at the same moment as a periodic save, both will try to rename the `.bak` and write the file. On Linux, `os.rename()` is atomic but the sequence (rename + write) is not. Two concurrent saves could both rename, with the second rename overwriting the first's `.bak`. This is unlikely (WezTerm Lua runs single-threaded per mux) but worth documenting.

### Gap 5: No validation of `window_state.size`

Ghost windows could have zero-dimension `size` fields. When restoring, `set_inner_size(0, 0)` or `spawn_window({width=0, height=0})` could cause undefined behavior. Consider validating `window_state.size` during restore.

## Phasing Assessment

**Phase 1 can ship independently.** It adds save-side filtering and backup-on-overwrite, which would have prevented the observed crash loop. The changes are additive (new functions, new guard clauses) and do not modify existing control flow for healthy workspaces. The risk is low.

**Phase 2 depends on Phase 1** for the backup infrastructure but is otherwise independent. The restore-side changes are more invasive (modifying control flow in `restore_window()` and `restore_workspace()`) and carry medium risk. The `goto continue` pattern and `restored_count` tracking need careful testing.

**Phase 3 (PR adoptions) is correctly sequenced.** PR #127 should be merged first because it fixes a crash that is independent of ghost tabs and could interact with the tree construction changes. PR #123 touches the same files as Phase 1, so merging after Phase 1 minimizes conflict resolution. PR #118 touches `workspace_state.lua` which Phase 2 modifies, so it goes last.

**One concern with phasing:** The proposal does not specify whether each phase is a single commit or multiple commits. Given that Phase 1 touches 4 files, a single commit is appropriate since the changes are logically coupled. Phase 2 (also 4 files) could be split into two commits: validation functions + restore filtering.

## Required Modifications Before Implementation

1. **Clarify dimension check in `is_pane_healthy()`**: Use `PaneInformation` cell dimensions (`pane_info.width`, `pane_info.height`) instead of or in addition to `pane:get_dimensions()` pixel dimensions.

2. **Document the multi-pane layout limitation**: The pre-filter approach in `create_pane_tree()` can break spatial adjacency for multi-pane tabs. Phase 1 is acceptable for single-pane ghost tabs, but Phase 2 should move the filtering into `insert_panes()`.

3. **Guard against empty `window_state.tabs` in `restore_workspace()`**: Add a check before accessing `window_state.tabs[1].pane_tree.cwd` on line 35 of `workspace_state.lua`.

4. **Wrap backup `load_json()` in pcall**: The `io.lines()` call in `load_json()` throws on missing files. The `.bak` fallback must handle this.

5. **Extend the degraded-state skip to `save_windows` and `save_tabs` branches**: The proposal only covers `save_workspaces`.

6. **Track `format_tab_title` hardening as a companion task**: The crash loop's proximate cause was the title handler, not just the bad restore data.
