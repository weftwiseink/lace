---
review_of: external/resurrect.wezterm@6fdc3fc
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-01T12:00:00-08:00
task_list: lace/resurrect-hardening
type: review
state: archived
status: done
tags: [fresh_agent, code_review, defensive_programming, error_handling, wezterm, plugin_fork]
---

# Review: resurrect.wezterm Fork Hardening (commit 6fdc3fc)

## Summary Assessment

This commit hardens the resurrect.wezterm plugin against ghost tabs (SSH panes stuck in "Connecting..."), degraded mux state, and corrupted save files.
The changes span six files and introduce save-side pane health filtering, restore-side pane tree validation with subtree pruning, backup-before-overwrite in file I/O, backup fallback on load, and degraded-state skipping in periodic save.
Overall quality is high: the defensive layers are well-placed, the code is readable, and the approach of filtering at save time while also validating at restore time provides defense in depth.
Two blocking issues exist: a potential nil dereference in `restore_tab` when all panes in a tree get pruned, and a race condition in the backup rename path.
Verdict: **Revise.**

## File-by-File Findings

### pane_tree.lua: `is_pane_healthy()`

The function checks four conditions: nil pane object, missing/empty cwd, zero cell dimensions, and non-spawnable domain.
These are the right failure modes for ghost tab detection.

**Finding: [non-blocking]** The zero-dimension check uses `and` (both width and height must be zero).
A pane with `width=0, height=80` would pass the health check.
This seems intentional (a narrow pane is still valid), but worth noting that a single zero dimension could indicate a partially-rendered pane.
The current check is defensible since WezTerm enforces minimum pane sizes, so a single-zero dimension in a real pane would be unusual but not necessarily ghost-like.

**Finding: [non-blocking]** The `pcall` around `wezterm.mux.get_domain()` is good defensive practice for domains that may have been removed.
However, if `pcall` returns `ok=true` but `domain` is nil (domain name exists but returns nil object), the function falls through to `return true`.
This is unlikely in practice but could be tightened with `if ok and domain and domain:is_spawnable()` (already present) vs the negated form.
The current logic is actually correct: `if ok and domain and not domain:is_spawnable()` returns false, otherwise falls through to true.
No issue.

### pane_tree.lua: `insert_panes()` nil pane guard

The guard at lines 112-114 handles symmetric layouts where a pane can appear in both `right` and `bottom` lists (PR #127 reference).
When the pane has already been consumed, `root.pane` is nil.
Returning `root` early is correct: the node still needs to exist in the tree for spatial relationships, but it should not attempt domain/cwd resolution.

**Finding: [non-blocking]** The early return skips setting `root.pane = nil` on line 153, but since `root.pane` is already nil, this is harmless.

### pane_tree.lua: `create_pane_tree()` filtering

Filtering unhealthy panes before tree construction is documented as potentially breaking spatial adjacency in multi-pane layouts.
The comment acknowledges this and defends the tradeoff: ghost panes are almost always single-pane tabs.

**Finding: [non-blocking]** If a multi-pane tab has one ghost pane and two healthy panes, the healthy panes' spatial coordinates may no longer form a connected tree.
`pop_connected_right` and `pop_connected_bottom` rely on exact adjacency (`root.left + root.width + 1 == pane.left`), so a gap from a removed pane would cause the remaining panes to become disconnected children that never get inserted.
The resulting tree would have the correct root but missing splits.
This is acceptable given the documented tradeoff, but the failure mode is silent data loss (panes omitted without warning).
Consider logging when `#right + #bottom < #panes` in `insert_panes` to surface orphaned panes.

### pane_tree.lua: `validate_pane_tree()`

The restore-side validator checks cwd, domain existence, and domain spawnability.
It prunes invalid subtrees rather than rejecting the whole tree, which is the right approach for partial recovery.

**Finding: [blocking]** The function returns `true` for the root node after pruning its children.
If the root node itself has valid cwd/domain, but both `right` and `bottom` subtrees are pruned, the tree is still valid (a single-pane tab).
However, the caller in `window_state.lua` line 66 calls `validate_pane_tree(tab_state.pane_tree)` and only checks the boolean return.
The restored tree will have had its subtrees pruned in-place, which is correct, but `restore_tab` at `tab_state.lua` line 117-118 calls `pane_tree_mod.fold()` and then `acc.active_pane:activate()`.
If the pruned tree has no `is_active` node (the active pane was in a pruned subtree), `acc.active_pane` will be `nil`, causing a nil dereference on `:activate()`.
The `fold`'s initial accumulator sets `is_zoomed = false` but does not set `active_pane`, so `acc.active_pane` defaults to nil.

**Fix:** In `restore_tab`, after the fold, check `if acc.active_pane then acc.active_pane:activate() end`, or default `active_pane` to the root pane.

### window_state.lua: `get_window_state()` tab filtering

Lines 19-24 skip tabs whose `pane_tree` is nil (all panes unhealthy).
This is the correct save-side filter.

**Finding: [non-blocking]** If ALL tabs in a window are ghost tabs, `window_state.tabs` will be empty but `window_state.size` is set on line 28 only when `#window_state.tabs > 0`.
If the array is empty, `size` is nil.
This is fine: the caller (`workspace_state.lua` line 82) checks `#win_state.tabs > 0` before including the window.

### window_state.lua: `restore_window()` validation

The `validate_pane_tree` call and `goto continue` pattern is clean.
The `restored_count` tracking ensures the first valid tab reuses the existing tab object from opts.

**Finding: [non-blocking]** If all tabs in the window_state fail validation, `restored_count` stays 0 and `active_tab` stays nil.
The function will emit the `finished` event but will not have restored anything.
The window will contain whatever tab was there before.
This is acceptable behavior, but the caller has no way to know restoration was a no-op (no return value, no error event).
Consider emitting a `resurrect.error` event or returning a count.

### workspace_state.lua: `restore_workspace()` pcall wrapping

The pcall around each window restore is excellent.
It prevents one failed window from killing the entire workspace restore.
The `opts.tab = nil; opts.pane = nil` reset after failure prevents stale state contamination.

**Finding: [non-blocking]** The `opts.window` is not reset after failure.
If the second window fails to spawn (pcall catches the error), `opts.window` still points to the first window's mux_window.
The next iteration (window 3+) would hit the `i == 1 and opts.window` branch only if `i == 1`, which it won't be, so it goes to the `else` branch and spawns a new window.
Not a bug, but `opts.window` referring to a potentially corrupted window object could matter if future code reads it outside the loop.

**Finding: [non-blocking]** The nil-safe cwd extraction on line 39-40 (`window_state.tabs[1] and ... .pane_tree and ... .cwd or nil`) is good.
The `tabs` empty-check on line 21 runs before this, so `tabs[1]` should always exist at this point.
Belt-and-suspenders approach is fine.

**Finding: [non-blocking]** The PR #118 fix (setting active workspace after restore) on lines 64-67 is correct.
Without it, the workspace would be spawned but not activated, leaving the user on whatever workspace they were on before.

### file_io.lua: backup-before-overwrite

Lines 77-81 rename the existing file to `.bak` before writing.
This is the correct approach for crash-safe state persistence.

**Finding: [blocking]** `os.rename()` can fail (returns nil, error on failure), but the return value is not checked.
If rename fails (e.g., filesystem full, permissions), the code proceeds to overwrite the original file.
If the subsequent write also fails (or writes partial data), both the original and the backup are lost.

**Fix:** Check the rename return value. If rename fails, log a warning but still proceed with the write (the write might succeed even if rename failed). At minimum:
```lua
local ok, err = os.rename(file_path, file_path .. ".bak")
if not ok then
    wezterm.log_warn("resurrect: backup rename failed: " .. tostring(err))
end
```

**Finding: [non-blocking]** The `.bak` file is never cleaned up on successful write.
Over time, every state file accumulates a `.bak` companion.
This is acceptable for safety (the backup is always available), but the `.bak` files will show up in `load_json`'s directory listing if the fuzzy loader enumerates files by glob.
If the fuzzy loader uses a `.json` extension filter, this is not an issue.

**Finding: [non-blocking]** On line 92, the error message says "Decryption failed" but this is in the encryption write path.
This appears to be a copy-paste error from upstream (the decrypt error handler below), not introduced by this commit.
Consider fixing if touching this area: should say "Encryption failed" (which it does on line 91 in the emit, but the log_error on line 92 says "Decryption").

### state_manager.lua: `load_state()` backup fallback

Lines 44-56 try the `.bak` file when primary fails.
The `pcall` around `file_io.load_json` is defensive against corrupted backups.

**Finding: [non-blocking]** When the backup is successfully loaded, the `load_state.finished` event still fires on line 57.
This is correct (from the caller's perspective, the load succeeded), but there is no event to distinguish "loaded from backup" vs "loaded from primary."
Consider adding a `resurrect.state_manager.load_state.from_backup` event for observability.

### state_manager.lua: `periodic_save()` degraded-state skipping

The empty-window and empty-tab checks on lines 74-78 and 87-91 prevent saving degraded state.
This is the critical safety net: without it, a periodic save during a ghost-tab episode would overwrite good state with empty state.

**Finding: [non-blocking]** The `save_tabs` path (lines 96-103) does not have the same empty-check guard.
If `get_tab_state` returns a `tab_state` with `pane_tree = nil` (all panes unhealthy), `save_state` on line 102 will hit the `elseif state.pane_tree then` branch in `save_state` and skip the write.
So there is implicit protection, but it is not explicit.
Adding a comment or an explicit check would improve clarity.

**Finding: [non-blocking]** The tab-level periodic save does not check if the tab title is valid before calling `get_tab_state`.
The check `title ~= "" and title ~= nil` on line 100 prevents saving untitled tabs, which is correct.
However, `get_tab_state` will still be called and do work (building the pane tree) for tabs that ultimately get skipped by `save_state` due to nil `pane_tree`.
Minor inefficiency, not a correctness issue.

### tab_state.lua: No changes

This file has no modifications from upstream in this commit.
The `restore_tab` function at line 117-118 (`acc.active_pane:activate()`) is the site of the nil dereference risk identified in the `validate_pane_tree` finding above.

## Cross-Cutting Concerns

### Defense in Depth

The layered approach is sound: filter at save time (prevent bad state from being persisted), validate at restore time (handle state files created before the hardening or by other versions), backup before overwrite (recover from bad saves), and fallback to backup on load (recover from corruption).
Each layer catches failures the others might miss.

### Error Reporting Consistency

The code uses a mix of `wezterm.log_warn`, `wezterm.log_error`, `wezterm.log_info`, and `wezterm.emit("resurrect.error", ...)`.
The new code consistently uses `log_warn` for non-fatal skip conditions and emits error events for failures that users should act on.
This is consistent with the upstream pattern.

### API Surface

No public API changes: `create_pane_tree`, `validate_pane_tree`, `get_window_state`, `get_workspace_state`, `restore_window`, `restore_workspace`, `load_state`, `save_state`, and `periodic_save` all maintain their existing signatures.
`validate_pane_tree` is new but follows the same module pattern.
The `.bak` file convention is an implementation detail.

### Upstream PR Integration

The commit references PRs #127 (symmetric layout nil pane), #123 (implied by pane health checks), and #118 (active workspace activation).
These are sensible cherry-picks from upstream discussions, integrated cohesively rather than as isolated patches.

## Verdict

**Revise.** Two blocking issues need attention before this can be considered production-ready:

1. The nil dereference on `acc.active_pane:activate()` when the active pane is in a pruned subtree.
2. The unchecked `os.rename()` return in the backup path.

Both are straightforward fixes.
The rest of the hardening is well-designed and addresses the right failure modes.

## Action Items

1. [blocking] Guard `acc.active_pane:activate()` in `tab_state.lua` line 118 against nil. Either check for nil before calling, or default the accumulator's `active_pane` to the root pane in the fold.
2. [blocking] Check the return value of `os.rename()` in `file_io.lua` line 80. Log a warning on failure. Do not abort the write.
3. [non-blocking] Consider logging orphaned panes in `insert_panes` when the right+bottom partition does not account for all remaining panes, to surface silent data loss from filtered multi-pane tabs.
4. [non-blocking] Add an explicit nil-pane-tree guard in the `save_tabs` periodic save path for consistency with the workspace and window paths.
5. [non-blocking] Fix the "Decryption failed" log message on `file_io.lua` line 92 in the encryption write path (upstream copy-paste error).
6. [non-blocking] Consider emitting a distinct event when state is loaded from backup vs primary for operational observability.
