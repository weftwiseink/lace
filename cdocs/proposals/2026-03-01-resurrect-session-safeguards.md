---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-01T10:00:00-06:00
task_list: wezterm/resurrect-hardening
type: proposal
state: archived
status: implementation_accepted
tags: [resurrect, wezterm, session-persistence, validation, crash-prevention, fork]
---

# Safeguarding resurrect.wezterm Session State on Save and Restore

> BLUF: Our fork of resurrect.wezterm needs save-side filtering and restore-side validation to prevent ghost tabs (SSH domain tabs stuck in "Connecting..." state with `cwd: ""` and zero pixel dimensions) from being serialized during periodic auto-save and then blindly restored, which caused a crash loop. This proposal adds pane health checks before serialization, per-entry validation before restoration, backup-on-overwrite, and a plan for adopting three of the six open upstream PRs. Phase 1 (immediate safety) can ship in a single commit; Phase 2 (comprehensive validation) follows; Phase 3 merges upstream PRs.

## Objective

Prevent corrupted or degraded session state from being saved or restored by the resurrect.wezterm plugin. The specific failure mode: periodic auto-save captures workspace state that includes ghost tabs from SSH domains, producing JSON with `cwd: ""` and zero-dimension panes. On restore, these entries spawn broken tabs that trigger mux server warnings and can cascade into a crash loop.

## Background

### The crash loop

Three problems interacted to produce the crash loop:

1. **No save-side filtering.** `workspace_state.get_workspace_state()` (line 50-61 of `workspace_state.lua`) iterates `wezterm.mux.all_windows()` and calls `window_state.get_window_state()` for every window in the active workspace. `get_window_state()` calls `tab_state.get_tab_state()` for every tab, which calls `pane_tree.create_pane_tree()` for every pane. No step checks whether a pane is healthy. The `insert_panes()` function in `pane_tree.lua` (line 73-142) does handle non-spawnable domains by logging a warning, but it still saves the pane with `cwd: ""` (line 86-87) -- it does not skip the pane or mark it as invalid.

2. **No restore-side validation.** `workspace_state.restore_workspace()` blindly iterates `workspace_state.window_states` and for each window, `window_state.restore_window()` iterates `window_state.tabs` and spawns tabs with `window:spawn_tab({ cwd = tab_state.pane_tree.cwd })`. When `cwd` is `""`, this spawns a shell in an undefined directory. When `domain` references a domain that no longer exists, this fails.

3. **No backup before overwrite.** `file_io.write_state()` overwrites the JSON file in place. If a periodic save fires during degraded state, the good previous save is destroyed.

### The pane_tree serialization path

The `insert_panes()` function in `pane_tree.lua` is the core serialization logic. For each pane node:

- It calls `root.pane:get_domain_name()` and checks `is_spawnable()`. If not spawnable, it logs a warning but continues -- the pane still gets serialized with whatever partial state it has.
- It calls `root.pane:get_current_working_dir()`. If this returns nil (as it does for ghost tabs stuck in "Connecting..."), it sets `root.cwd = ""`.
- It reads `pixel_height`, `pixel_width` from the pane dimensions. Ghost tabs that never rendered have zero dimensions.
- It reads scrollback text only for local domains. Remote domain panes get no text, but they do get serialized with their (possibly empty) cwd and (possibly stale) domain.

### The restore path

On restore, `window_state.restore_window()` spawns tabs with `window:spawn_tab({ cwd = ..., domain = ... })`. The `tab_state.restore_tab()` function then calls `pane:split()` to recreate pane tree splits. Both use the serialized `cwd` and `domain` values without checking them. An empty `cwd` causes the mux to spawn the shell in an arbitrary directory (typically `/`). A non-existent domain causes `spawn_tab` to fail.

### Fork details

Our fork lives at `git@github.com:micimize/resurrect.wezterm.git` with `upstream` pointing to `https://github.com/MLFlexer/resurrect.wezterm.git`. The fork is currently on commit `47ce553` (upstream HEAD), with no local divergence yet.

## Proposed Solution

### Part 1: Save-side safeguards

#### 1a. Pane health check function

Add a `is_pane_healthy(pane_info)` function to `pane_tree.lua` that evaluates whether a pane should be included in serialized state:

```lua
--- Check if a pane is healthy enough to serialize
---@param pane_info PaneInformation
---@return boolean healthy
---@return string? reason -- why the pane was skipped (for logging)
local function is_pane_healthy(pane_info)
    local pane = pane_info.pane

    -- Check 1: pane object must exist
    if not pane then
        return false, "nil pane object"
    end

    -- Check 2: cwd must be resolvable (ghost tabs return nil)
    local cwd = pane:get_current_working_dir()
    if not cwd then
        return false, "no resolved cwd (likely stuck in Connecting...)"
    end
    if cwd.file_path == "" or cwd.file_path == nil then
        return false, "empty cwd file_path"
    end

    -- Check 3: dimensions must be non-zero (never-rendered tabs)
    local dims = pane:get_dimensions()
    if dims and dims.pixel_width == 0 and dims.pixel_height == 0 then
        return false, "zero pixel dimensions (never rendered)"
    end

    -- Check 4: domain must be spawnable
    local domain_name = pane:get_domain_name()
    local domain = wezterm.mux.get_domain(domain_name)
    if domain and not domain:is_spawnable() then
        return false, "domain " .. domain_name .. " is not spawnable"
    end

    return true, nil
end
```

#### 1b. Filter unhealthy panes in `create_pane_tree()`

Modify `create_pane_tree()` to run the health check before sorting and building the tree:

```lua
function pub.create_pane_tree(panes)
    -- Filter out unhealthy panes before building the tree
    local healthy_panes = {}
    for _, pane_info in ipairs(panes) do
        local healthy, reason = is_pane_healthy(pane_info)
        if healthy then
            table.insert(healthy_panes, pane_info)
        else
            wezterm.log_warn(
                "resurrect: skipping unhealthy pane "
                .. tostring(pane_info.pane and pane_info.pane:pane_id() or "nil")
                .. ": " .. (reason or "unknown")
            )
            wezterm.emit("resurrect.pane_tree.pane_skipped", pane_info, reason)
        end
    end

    if #healthy_panes == 0 then
        return nil
    end

    table.sort(healthy_panes, compare_pane_by_coord)
    local root = table.remove(healthy_panes, 1)
    return insert_panes(root, healthy_panes)
end
```

#### 1c. Filter empty tabs from window state

In `window_state.get_window_state()`, skip tabs whose `pane_tree` is nil (all panes were unhealthy):

```lua
function pub.get_window_state(window)
    local window_state = {
        title = window:get_title(),
        tabs = {},
    }

    local tabs = window:tabs_with_info()
    for _, tab in ipairs(tabs) do
        local tab_state = tab_state_mod.get_tab_state(tab.tab)
        if tab_state.pane_tree ~= nil then
            tab_state.is_active = tab.is_active
            table.insert(window_state.tabs, tab_state)
        else
            wezterm.log_warn("resurrect: skipping tab with no healthy panes: "
                .. tostring(tab.tab:get_title()))
        end
    end

    if #window_state.tabs > 0 then
        window_state.size = tabs[1].tab:get_size()
    end

    return window_state
end
```

#### 1d. Skip saving entirely if workspace is degraded

In `state_manager.periodic_save()`, check whether the state is worth saving before writing:

```lua
if opts.save_workspaces then
    local state = require("resurrect.workspace_state").get_workspace_state()
    -- Skip saving if no windows have any valid tabs
    local has_valid_content = false
    for _, win_state in ipairs(state.window_states) do
        if #win_state.tabs > 0 then
            has_valid_content = true
            break
        end
    end
    if has_valid_content then
        pub.save_state(state)
    else
        wezterm.log_warn("resurrect: periodic save skipped -- workspace has no valid tabs")
        wezterm.emit("resurrect.state_manager.periodic_save.skipped", "no valid tabs")
    end
end
```

#### 1e. Backup before overwrite

In `file_io.write_state()`, rename the existing file to `.bak` before writing the new state:

```lua
function pub.write_state(file_path, state, event_type)
    wezterm.emit("resurrect.file_io.write_state.start", file_path, event_type)

    -- Backup existing state before overwriting
    local existing = io.open(file_path, "r")
    if existing then
        existing:close()
        os.rename(file_path, file_path .. ".bak")
    end

    local json_state = wezterm.json_encode(state)
    json_state = sanitize_json(json_state)
    -- ... rest of write logic unchanged ...
end
```

This gives exactly one backup generation. If the new write also produces bad state, the `.bak` still holds the last-known-good state. A future enhancement could keep N generations, but one is sufficient to prevent the immediate crash loop.

### Part 2: Restore-side safeguards

#### 2a. Validate pane_tree entries before restoring

Add a `validate_pane_tree(pane_tree)` function to `pane_tree.lua`:

```lua
--- Validate a deserialized pane_tree before attempting to restore it
---@param pane_tree pane_tree
---@return boolean valid
---@return string? reason
function pub.validate_pane_tree(pane_tree)
    if pane_tree == nil then
        return false, "nil pane_tree"
    end

    -- cwd must be non-empty
    if not pane_tree.cwd or pane_tree.cwd == "" then
        return false, "empty cwd"
    end

    -- domain must exist if specified
    if pane_tree.domain then
        local domain = wezterm.mux.get_domain(pane_tree.domain)
        if not domain then
            return false, "domain '" .. pane_tree.domain .. "' does not exist"
        end
        if not domain:is_spawnable() then
            return false, "domain '" .. pane_tree.domain .. "' is not spawnable"
        end
    end

    -- Recursively validate children
    if pane_tree.right then
        local valid, reason = pub.validate_pane_tree(pane_tree.right)
        if not valid then
            -- Prune the invalid subtree rather than failing entirely
            wezterm.log_warn("resurrect: pruning invalid right pane: " .. reason)
            pane_tree.right = nil
        end
    end

    if pane_tree.bottom then
        local valid, reason = pub.validate_pane_tree(pane_tree.bottom)
        if not valid then
            wezterm.log_warn("resurrect: pruning invalid bottom pane: " .. reason)
            pane_tree.bottom = nil
        end
    end

    return true, nil
end
```

#### 2b. Filter invalid tabs during window restore

In `window_state.restore_window()`, validate each tab_state before restoring it:

```lua
function pub.restore_window(window, window_state, opts)
    wezterm.emit("resurrect.window_state.restore_window.start")
    if opts == nil then opts = {} end

    if window_state.title then
        window:set_title(window_state.title)
    end

    local active_tab
    local restored_count = 0
    for i, tab_state in ipairs(window_state.tabs) do
        -- Validate the pane tree before attempting restore
        local valid, reason = pane_tree_mod.validate_pane_tree(tab_state.pane_tree)
        if not valid then
            wezterm.log_warn("resurrect: skipping tab '" .. (tab_state.title or "untitled")
                .. "' during restore: " .. reason)
            wezterm.emit("resurrect.window_state.tab_skipped", tab_state, reason)
            goto continue
        end

        restored_count = restored_count + 1
        local tab
        if restored_count == 1 and opts.tab then
            tab = opts.tab
        else
            local spawn_tab_args = { cwd = tab_state.pane_tree.cwd }
            if tab_state.pane_tree.domain then
                spawn_tab_args.domain = { DomainName = tab_state.pane_tree.domain }
            end
            tab, opts.pane, _ = window:spawn_tab(spawn_tab_args)
        end

        if restored_count == 1 and opts.close_open_tabs then
            close_all_other_tabs(window, tab)
        end

        tab_state_mod.restore_tab(tab, tab_state, opts)
        if tab_state.is_active then
            active_tab = tab
        end

        if tab_state.is_zoomed then
            tab:set_zoomed(true)
        end

        ::continue::
    end

    if active_tab then
        active_tab:activate()
    end
    wezterm.emit("resurrect.window_state.restore_window.finished")
end
```

#### 2c. Graceful error handling in restore_workspace

Wrap the restore in pcall to prevent one bad window_state from aborting the entire restore:

```lua
function pub.restore_workspace(workspace_state, opts)
    if workspace_state == nil then return end

    wezterm.emit("resurrect.workspace_state.restore_workspace.start")
    if opts == nil then opts = {} end

    local restore_errors = {}
    for i, window_state in ipairs(workspace_state.window_states) do
        local ok, err = pcall(function()
            -- ... existing per-window restore logic ...
        end)
        if not ok then
            table.insert(restore_errors, {
                window_index = i,
                error = tostring(err),
            })
            wezterm.log_error("resurrect: failed to restore window " .. i .. ": " .. tostring(err))
            wezterm.emit("resurrect.error", "Window " .. i .. " restore failed: " .. tostring(err))
        end
    end

    if #restore_errors > 0 then
        wezterm.emit("resurrect.workspace_state.restore_workspace.partial",
            #workspace_state.window_states - #restore_errors,
            #restore_errors)
    end
    wezterm.emit("resurrect.workspace_state.restore_workspace.finished")
end
```

#### 2d. Restore from backup on load failure

In `state_manager.load_state()`, if the primary JSON fails to parse, try the `.bak` file:

```lua
function pub.load_state(name, type)
    wezterm.emit("resurrect.state_manager.load_state.start", name, type)
    local file_path = get_file_path(name, type)
    local json = file_io.load_json(file_path)
    if not json then
        -- Try backup
        local bak_path = file_path .. ".bak"
        wezterm.log_warn("resurrect: primary state file invalid, trying backup: " .. bak_path)
        json = file_io.load_json(bak_path)
        if not json then
            wezterm.emit("resurrect.error", "Invalid json (both primary and backup): " .. file_path)
            return {}
        end
        wezterm.log_info("resurrect: restored from backup: " .. bak_path)
    end
    wezterm.emit("resurrect.state_manager.load_state.finished", name, type)
    return json
end
```

## Open PR Assessment

### PR #127 -- `fix(pane_tree): prevent nil pane access in symmetric layouts` (tdragon)

**What it does:** Adds a nil guard for `root.pane` at the top of `insert_panes()` in `pane_tree.lua`. In symmetric pane layouts (e.g., 2x2 grids), a pane node can be processed through both the right and bottom branches, and since `root.pane` is set to nil after first processing, the second encounter crashes.

**Assessment:** This is a real bug (issue #98) that multiple users have hit. The fix is minimal, correct, and matches the plugin's style. It adds 7 lines. The guard returns `root` early if `root.pane` is already nil, which is the right behavior since the node was already processed.

**Decision: Adopt as-is.** This is a correctness fix orthogonal to our validation work, and it prevents a crash that can happen independently of ghost tabs.

### PR #123 -- `Fix/module resurrect not found` (userux)

**What it does:** Fixes circular/broken `require("resurrect")` calls in `tab_state.lua` and `window_state.lua` by replacing them with direct `require("resurrect.state_manager")`.

**Assessment:** This fixes issues #117 and #119. The code is straightforward. However, it introduces `require("resurrect.state_manager")` at the module top level in both `tab_state.lua` and `window_state.lua`, which could create a circular dependency since `state_manager.lua` requires these modules transitively through `periodic_save()`. In practice, since the require happens inside `wezterm.action_callback` (lazy), this should be safe, but it warrants testing. The PR also has an extra blank line in `window_state.lua` that is cosmetic noise.

**Decision: Adopt with minor modifications.** Clean up the extra blank line. Verify no circular dependency issues in our setup.

### PR #118 -- `Fix workspace name when restoring a workspace` (fvalenza)

**What it does:** After restoring a workspace, either sets the active workspace (if `spawn_in_workspace` is true) or renames the current workspace to the restored workspace name. This fixes issue #114 where restored workspaces lose their names.

**Assessment:** Small, focused fix (5 lines added). The logic is correct: when spawning in a workspace, the workspace name is set by `spawn_window_args.workspace`, but `set_active_workspace()` is needed to switch to it. When restoring in-place, `rename_workspace()` preserves the name. Matches plugin style.

**Decision: Adopt as-is.** This improves the restore path and is compatible with our validation changes.

### PR #134 -- `fix: Windows compatibility for paths and file names` (lowjoel)

**What it does:** Three Windows-specific fixes: path separator construction, reserved character escaping in filenames, and fixing the `mkdir` command (Windows `mkdir` does not have `/p` flag).

**Assessment:** We run on Linux exclusively, so this PR has no functional impact on our setup. The changes are correct for Windows but irrelevant to our use case.

**Decision: Skip.** Not relevant to our platform. Could revisit if we ever contribute back upstream.

### PR #130 -- `Fix #125` (vike2000)

**What it does:** Replaces `os.execute('mkdir -p ...')` with a pure-Lua directory creation approach using `io.open` to avoid pop-up windows on certain platforms. Also removes `"github"` and the username from `dev.setup` keywords.

**Assessment:** The `ensure_folder_exists` rewrite is questionable -- it tries to create directories by opening a temporary file, which does not actually create parent directories. The logic is fundamentally flawed: `io.open(tmp, "w")` cannot create a directory that does not exist. On Linux, `mkdir -p` works correctly and is the right approach. The keyword change is a separate concern related to the dev.wezterm plugin.

**Decision: Skip.** The core approach is broken on Linux. The `mkdir -p` approach in the existing code is correct for our platform.

### PR #128 -- Sanitize `/nix/store/*` paths (andreystepanov)

**What it does:** Strips NixOS-specific store paths from `process_info.executable` and `process_info.argv` for vim/nvim/gvim before saving state. Prevents non-portable nix store paths from being saved into session state.

**Assessment:** Well-documented, well-commented code. However, it is NixOS-specific and adds 87 lines of platform-specific logic inline in `pane_tree.lua`'s `insert_panes()` function. We do not use NixOS. If adopted, it should be refactored into a separate sanitization module rather than inlining in the pane tree builder.

**Decision: Skip.** Not relevant to our environment. The sanitization concept is sound but the implementation is too platform-specific.

## Design Decisions

### Why filter on save rather than only on restore?

Both are necessary, but save-side filtering is more important because:

1. It prevents corruption of the backup. If we only validate on restore, a bad periodic save still destroys the good state file.
2. It keeps state files clean and inspectable. Ghost tab entries in JSON files are confusing when debugging.
3. It reduces the attack surface for restore bugs -- the restore code only needs to handle well-formed entries.

### Why backup-on-overwrite rather than versioned history?

One `.bak` file is the simplest approach that solves the immediate problem. Versioned history (keeping N generations) adds complexity around cleanup, naming, and disk usage. If the single backup proves insufficient, we can add rotation later.

### Why prune invalid subtrees rather than rejecting the whole tab?

During restore, if a pane tree root is valid but one split is invalid (e.g., `right.cwd` is empty), we prune just that subtree rather than skipping the entire tab. This preserves as much of the layout as possible. A tab with one working pane is better than no tab at all.

### Why pcall around per-window restore?

A workspace can have multiple windows. If one window's state is corrupted but another's is fine, we should restore what we can. Without pcall, a single failure aborts the entire workspace restore.

## Edge Cases

### All panes in a tab are unhealthy

If every pane in a tab fails the health check, `create_pane_tree()` returns nil, `get_tab_state()` returns a tab_state with `pane_tree = nil`, and the window_state builder skips that tab. This is correct -- a tab with no valid panes should not be saved.

### All tabs in a window are unhealthy

If every tab is skipped, the window_state has `tabs = {}` and `size` is not set. The periodic save skip logic catches this and does not write the file.

### Domain exists at save time but not at restore time

The save-side health check verifies the domain is spawnable at save time. The restore-side validation re-checks at restore time. If a domain was valid when saved but no longer exists (e.g., an SSH domain that was removed), the restore validation catches it and either prunes the subtree or skips the tab.

### Race condition: state changes between health check and serialization

A pane could become unhealthy between the health check and the actual serialization. This window is very small (microseconds) since both happen in the same Lua event handler. Even if it occurs, the worst case is that an unhealthy pane slips through the save filter -- the restore-side validation would catch it.

### Backup file gets corrupted too

If the `.bak` file is also invalid (e.g., disk corruption), `load_state()` returns `{}` and the caller gets an empty table. The restore functions already handle nil/empty state gracefully (they no-op).

## Implementation Phases

### Phase 1: Immediate safety (prevents crash loop recurrence)

**Scope:** Save-side pane health check + backup before overwrite.

**Files changed:**
- `plugin/resurrect/pane_tree.lua` -- add `is_pane_healthy()`, modify `create_pane_tree()` to filter
- `plugin/resurrect/window_state.lua` -- skip tabs with nil pane_tree in `get_window_state()`
- `plugin/resurrect/state_manager.lua` -- skip periodic save when no valid tabs
- `plugin/resurrect/file_io.lua` -- backup before overwrite in `write_state()`

**Risk:** Low. These changes only skip writing bad data. The save path produces the same output for healthy workspaces, so no behavioral change in the normal case.

### Phase 2: Robust restore validation

**Scope:** Restore-side pane_tree validation, tab filtering during restore, pcall around per-window restore, backup fallback on load.

**Files changed:**
- `plugin/resurrect/pane_tree.lua` -- add `validate_pane_tree()`
- `plugin/resurrect/window_state.lua` -- validate before restore, use restored_count instead of i for first-tab logic
- `plugin/resurrect/workspace_state.lua` -- pcall around per-window restore
- `plugin/resurrect/state_manager.lua` -- fallback to `.bak` in `load_state()`

**Risk:** Medium. Changes the restore control flow. Must verify that the `goto continue` pattern and `restored_count` tracking work correctly when tabs are skipped. The pcall in workspace restore must not swallow errors that should propagate.

### Phase 3: Upstream PR adoptions

**Merge order:**

1. **PR #127** (nil pane access in symmetric layouts) -- independent fix, merge first. No conflicts with our changes.
2. **PR #123** (module require fix) -- also independent, but touches `tab_state.lua` and `window_state.lua` which we also modify. Merge after Phase 1 to resolve conflicts once.
3. **PR #118** (workspace name fix) -- touches `workspace_state.lua` which we modify in Phase 2. Merge after Phase 2.

**Risk:** Low for each individual PR. Conflict resolution is mechanical since our changes are additive (new functions, new guard clauses) while the PRs fix existing logic.

## Testing Strategy

### Manual testing for Phase 1

1. Create a workspace with healthy tabs. Save state. Verify JSON is well-formed.
2. Connect to an SSH domain, leave a tab in "Connecting..." state. Trigger periodic save. Verify the ghost tab is NOT in the saved JSON.
3. Verify the `.bak` file is created alongside the `.json` file.
4. Corrupt the `.json` file. Load state. Verify fallback to `.bak` works.

### Manual testing for Phase 2

1. Manually edit a saved JSON file to set `cwd: ""` on one tab. Restore. Verify the bad tab is skipped and the rest restore correctly.
2. Manually edit a saved JSON file to reference a non-existent domain. Restore. Verify graceful degradation.
3. Save a workspace with multiple windows. Corrupt one window's state in the JSON. Restore. Verify the healthy window restores while the broken one is skipped.

### Automated testing considerations

The plugin has no test framework beyond the `test/text.lua` file which is a manual WezTerm keybinding test. Adding automated tests would require a WezTerm headless mode or mock framework, which is out of scope for this proposal. The `resurrect.error` and `resurrect.*.skipped` events provide hook points for observability.
