---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-01T15:30:00-06:00
task_list: wezterm/resurrect-hardening
type: proposal
state: archived
status: implementation_accepted
tags: [resurrect, wezterm, testing, unit-tests, mocking, fork]
companion_to: 2026-03-01-resurrect-session-safeguards.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-01T19:30:00-06:00
  round: 1
---

# Unit Test Suite for resurrect.wezterm Fork

> BLUF: The resurrect.wezterm fork has no automated tests. We can add a lightweight test suite using LuaUnit (single-file, zero-dependency framework) and a hand-rolled `wezterm` mock module, targeting the pure-logic and data-validation functions we added in the hardening commit. Roughly 60% of our changes are testable without WezTerm runtime. The remaining 40% (mux operations, pane spawning, GUI interactions) requires either full WezTerm headless integration tests or stays manual. This proposal specifies the framework, mock strategy, file layout, and 30+ concrete test cases.

## Context

The hardening commit (`6fdc3fc`) added ~237 new lines across 6 files. The parent proposal (`2026-03-01-resurrect-session-safeguards.md`) noted that "Adding automated tests would require a WezTerm headless mode or mock framework, which is out of scope for this proposal." This companion proposal puts that mock framework in scope.

### Current test infrastructure

The plugin has exactly one test file: `plugin/resurrect/test/text.lua`. It is a manual WezTerm keybinding test that injects characters into a pane and saves window state. It requires a running WezTerm instance and human interaction. There is no CI, no test runner, no assertions.

### Why test now

The hardening changes are safety-critical: they decide whether panes get saved, whether tabs get restored, and whether backups get created. A regression in `is_pane_healthy()` could silently re-enable the crash loop. A regression in `validate_pane_tree()` could let corrupted state through to restore. These are exactly the kinds of pure-logic functions that benefit most from unit tests.

## Framework Choice: LuaUnit

### Why LuaUnit over busted

| Criterion | LuaUnit | busted |
|-----------|---------|--------|
| Dependencies | **Zero** -- single file `luaunit.lua` | Requires luarocks, penlight, lua-term, mediator_lua, say, luassert, lua-system |
| Installation | Copy one file into repo | `luarocks install busted` (not available on this system; luarocks is not installed) |
| Lua version | Works with Lua 5.1-5.4 and LuaJIT | Works but requires luarocks ecosystem |
| Output formats | Text, TAP, JUnit XML | Text, TAP, JUnit XML |
| Learning curve | xUnit-style (assertEqual, assertTrue) | BDD-style (describe/it/assert.are.equal) |
| Mocking built-in | No (but we need custom mocks anyway) | Yes (spy/stub/mock) but tightly coupled to busted runner |

**Decision: LuaUnit.** The zero-dependency property is decisive. We can vendor `luaunit.lua` into the repo and run tests with either `lua` or `luajit` -- both are available on this system. No package manager required.

WezTerm's embedded Lua is LuaJIT (5.1-compatible). We should run tests under `luajit` to match the runtime semantics, with `lua5.4` as a secondary target to catch version-specific issues.

### Installation

```sh
# Download luaunit.lua (single file, ~3800 lines, MIT license)
curl -o test/luaunit.lua https://raw.githubusercontent.com/bluebird75/luaunit/main/luaunit.lua
```

Or vendor it directly. It is a single file with no external requires.

### Running tests

```sh
# From the resurrect.wezterm repo root:
luajit test/run_tests.lua
# or
lua5.4 test/run_tests.lua

# Run a specific test file:
luajit test/test_pane_tree.lua

# Verbose output:
luajit test/run_tests.lua -v

# JUnit XML for CI:
luajit test/run_tests.lua -o junit -n test-results.xml
```

## Mock Strategy

### The problem

Every module in the plugin starts with `local wezterm = require("wezterm")`. The `wezterm` module is only available inside the WezTerm runtime -- it is a C/Rust module compiled into the binary, not a Lua file on disk. We cannot `require("wezterm")` from standalone Lua.

### The solution: `package.preload` injection

Lua's `require()` checks `package.preload[modname]` before searching the filesystem. We inject a mock `wezterm` module before any plugin code is loaded:

```lua
-- test/mock_wezterm.lua
local mock = {}

-- Logging (capture for assertions)
mock._log = {}
function mock.log_warn(msg)  table.insert(mock._log, {level="warn",  msg=msg}) end
function mock.log_error(msg) table.insert(mock._log, {level="error", msg=msg}) end
function mock.log_info(msg)  table.insert(mock._log, {level="info",  msg=msg}) end

-- Events (capture for assertions)
mock._events = {}
function mock.emit(event, ...)
    table.insert(mock._events, {event=event, args={...}})
end

-- JSON (use bundled dkjson for real encode/decode)
local dkjson = require("dkjson")
function mock.json_encode(val) return dkjson.encode(val) end
function mock.json_parse(str)  return dkjson.decode(str) end

-- Mux (configurable per-test)
mock.mux = {}
mock.mux._domains = {}

function mock.mux.get_domain(name)
    local d = mock.mux._domains[name]
    if not d then
        error("domain '" .. tostring(name) .. "' not found")
    end
    return d
end

-- Platform detection (default to Linux)
mock.target_triple = "x86_64-unknown-linux-gnu"

-- Nerdfonts (used by fuzzy_loader, stub it)
mock.nerdfonts = setmetatable({}, {
    __index = function(_, k) return "<" .. k .. ">" end
})

-- Reset function for test isolation
function mock._reset()
    mock._log = {}
    mock._events = {}
    mock.mux._domains = {}
end

return mock
```

The test harness preloads this before requiring plugin modules:

```lua
-- test/test_helper.lua
local mock_wezterm = require("mock_wezterm")
package.preload["wezterm"] = function() return mock_wezterm end

-- Also need to set up package.path to find plugin modules
-- from the repo root, plugin/ contains the modules as "resurrect.X"
local repo_root = -- (determined at runtime)
package.path = repo_root .. "/plugin/?.lua;"
             .. repo_root .. "/plugin/?/init.lua;"
             .. repo_root .. "/test/?.lua;"
             .. package.path
```

### What needs to be mocked

Categorized by mock complexity:

#### Trivial (static stubs)

| Mock target | Used by | Notes |
|-------------|---------|-------|
| `wezterm.log_warn(msg)` | all modules | Capture to table |
| `wezterm.log_error(msg)` | file_io, state_manager, workspace_state | Capture to table |
| `wezterm.log_info(msg)` | state_manager | Capture to table |
| `wezterm.emit(event, ...)` | all modules | Capture to table |
| `wezterm.target_triple` | utils | String constant |
| `wezterm.nerdfonts.*` | fuzzy_loader | Metatable stub |

#### Medium (need real implementation or faithful fake)

| Mock target | Used by | Notes |
|-------------|---------|-------|
| `wezterm.json_encode(val)` | file_io | Use `dkjson.encode()` |
| `wezterm.json_parse(str)` | file_io | Use `dkjson.decode()` |
| `wezterm.mux.get_domain(name)` | pane_tree, validate_pane_tree | Return configurable domain objects |

#### Hard (need object mocks with method chains)

| Mock target | Used by | Notes |
|-------------|---------|-------|
| `pane:get_current_working_dir()` | is_pane_healthy, insert_panes | Return `{file_path = ...}` or nil |
| `pane:get_domain_name()` | is_pane_healthy, insert_panes | Return string |
| `pane:get_dimensions()` | insert_panes | Return `{scrollback_rows = N}` |
| `pane:pane_id()` | create_pane_tree (logging) | Return integer |
| `pane:get_lines_as_escapes(n)` | insert_panes | Return string |
| `pane:is_alt_screen_active()` | insert_panes | Return boolean |
| `pane:get_foreground_process_info()` | insert_panes | Return table |
| `domain:is_spawnable()` | is_pane_healthy, insert_panes, validate_pane_tree | Return boolean |

#### Not mocked (out of scope for unit tests)

| Mock target | Used by | Notes |
|-------------|---------|-------|
| `wezterm.mux.spawn_window(args)` | workspace_state restore | Integration test territory |
| `window:spawn_tab(args)` | window_state restore | Integration test territory |
| `pane:split(args)` | tab_state restore | Integration test territory |
| `wezterm.action_callback(fn)` | save actions | Integration test territory |
| `wezterm.gui.gui_windows()` | periodic_save, fuzzy_loader | Integration test territory |
| `wezterm.time.call_after(s, fn)` | periodic_save | Integration test territory |
| `wezterm.plugin.require(url)` | init.lua | Integration test territory |

### Mock pane factory

A reusable factory for creating mock pane objects:

```lua
-- test/mock_pane.lua
local function make_pane(opts)
    opts = opts or {}
    local pane = {}

    function pane:get_current_working_dir()
        if opts.cwd == nil then return nil end
        return { file_path = opts.cwd }
    end

    function pane:get_domain_name()
        return opts.domain or "local"
    end

    function pane:get_dimensions()
        return {
            scrollback_rows = opts.scrollback_rows or 100,
            pixel_width = opts.pixel_width or 800,
            pixel_height = opts.pixel_height or 600,
        }
    end

    function pane:pane_id()
        return opts.pane_id or 0
    end

    function pane:get_lines_as_escapes(nlines)
        return opts.text or ""
    end

    function pane:is_alt_screen_active()
        return opts.alt_screen_active or false
    end

    function pane:get_foreground_process_info()
        return opts.process_info or {
            name = "bash", argv = {"bash"}, cwd = opts.cwd or "/tmp",
            executable = "/bin/bash"
        }
    end

    return pane
end

-- Factory for a PaneInformation table (the struct from tab:panes_with_info())
local function make_pane_info(opts)
    opts = opts or {}
    return {
        pane = make_pane(opts),
        left = opts.left or 0,
        top = opts.top or 0,
        width = opts.width or 80,
        height = opts.height or 24,
        is_active = opts.is_active or false,
        is_zoomed = opts.is_zoomed or false,
        pixel_width = opts.pixel_width or 800,
        pixel_height = opts.pixel_height or 600,
    }
end

-- Factory for a mock domain object
local function make_domain(opts)
    opts = opts or {}
    local domain = {}
    function domain:is_spawnable()
        if opts.spawnable == nil then return true end
        return opts.spawnable
    end
    return domain
end

return {
    make_pane = make_pane,
    make_pane_info = make_pane_info,
    make_domain = make_domain,
}
```

### JSON dependency: dkjson

We need a real JSON encoder/decoder for the mock `wezterm.json_encode` / `wezterm.json_parse`. `dkjson` is ideal: single file, pure Lua, zero dependencies, compatible with Lua 5.1-5.4 and LuaJIT. It is MIT-licensed.

```sh
curl -o test/dkjson.lua https://raw.githubusercontent.com/LuaDist/dkjson/master/dkjson.lua
```

This is the only external dependency for the test suite (besides `luaunit.lua` itself).

## File Structure

```
resurrect.wezterm/
  plugin/
    resurrect/
      pane_tree.lua
      window_state.lua
      workspace_state.lua
      state_manager.lua
      file_io.lua
      tab_state.lua
      utils.lua
      ...
  test/
    luaunit.lua          # vendored test framework (~3800 lines)
    dkjson.lua           # vendored JSON lib (~900 lines)
    mock_wezterm.lua     # wezterm module mock
    mock_pane.lua        # pane/domain object factories
    test_helper.lua      # package.path setup, preload injection
    run_tests.lua        # test runner (loads all test_*.lua)
    test_pane_tree.lua   # tests for pane_tree module
    test_file_io.lua     # tests for file_io module
    test_validate.lua    # tests for validate_pane_tree
    test_state_manager.lua # tests for state_manager load/save
    fixtures/
      healthy_workspace.json
      ghost_tab_workspace.json
      empty_cwd_pane_tree.json
      corrupt.json
      valid_window.json
```

### Naming convention

- Test files: `test/test_<module_name>.lua`
- Test classes: `Test<ModuleName>` (LuaUnit convention)
- Test methods: `test_<function>_<scenario>` (e.g., `test_is_pane_healthy_nil_pane`)
- Fixtures: `test/fixtures/<descriptive_name>.json`

### .gitignore additions

```
test-results.xml
test/fixtures/*.bak
```

## Test Cases

### 1. `pane_tree.lua` -- `is_pane_healthy()`

`is_pane_healthy` is a local function, not exported. To test it, we test it indirectly through `create_pane_tree()`, which calls it as a pre-filter. Alternatively, we could export it on the module table under a `_private` key for testing. The indirect approach is preferred because it tests the actual integration path.

However, since LuaUnit does not have busted's `expose()`, and we want focused unit tests, we should export the function conditionally:

```lua
-- At the bottom of pane_tree.lua, add:
-- Export private functions for testing (only when _RESURRECT_TESTING is set)
if _RESURRECT_TESTING then
    pub._is_pane_healthy = is_pane_healthy
end
```

This pattern keeps the production API clean while allowing focused tests.

#### Test cases for `is_pane_healthy` (via `_is_pane_healthy` or via `create_pane_tree`)

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 1 | `test_healthy_pane_passes` | pane_info with cwd="/home/user", width=80, height=24, domain="local" (spawnable) | Returns `true, nil` | Unit |
| 2 | `test_nil_pane_object_fails` | pane_info with `pane = nil` | Returns `false, "nil pane object"` | Unit |
| 3 | `test_nil_cwd_fails` | pane with `get_current_working_dir()` returning nil | Returns `false, "no resolved cwd..."` | Unit |
| 4 | `test_empty_cwd_file_path_fails` | pane with `get_current_working_dir()` returning `{file_path = ""}` | Returns `false, "no resolved cwd..."` | Unit |
| 5 | `test_nil_cwd_file_path_fails` | pane with `get_current_working_dir()` returning `{file_path = nil}` | Returns `false, "no resolved cwd..."` | Unit |
| 6 | `test_zero_dimensions_fails` | pane_info with `width=0, height=0` | Returns `false, "zero cell dimensions..."` | Unit |
| 7 | `test_zero_width_nonzero_height_passes` | pane_info with `width=0, height=24` | Returns `true, nil` (only fails when BOTH are zero) | Unit |
| 8 | `test_nonspawnable_domain_fails` | pane with domain "ssh_dead", mock domain with `is_spawnable()` returning false | Returns `false, "domain ssh_dead is not spawnable"` | Unit |
| 9 | `test_missing_domain_passes` | pane with domain "nonexistent", `get_domain()` throws error, pcall catches it | Returns `true, nil` (domain lookup failure is not fatal -- the pane still has a cwd) | Unit |
| 10 | `test_spawnable_domain_passes` | pane with domain "local", mock domain with `is_spawnable()` returning true | Returns `true, nil` | Unit |

### 2. `pane_tree.lua` -- `create_pane_tree()` filtering

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 11 | `test_all_healthy_panes_builds_tree` | 3 pane_infos, all healthy, arranged in a row | Returns non-nil tree with correct spatial structure | Unit |
| 12 | `test_ghost_pane_filtered_out` | 2 pane_infos: one healthy, one with nil cwd | Returns tree with only the healthy pane, log_warn emitted for ghost | Unit |
| 13 | `test_all_unhealthy_returns_nil` | 2 pane_infos: both with nil cwd | Returns nil | Unit |
| 14 | `test_single_healthy_pane` | 1 healthy pane_info | Returns tree with that pane as root, no children | Unit |
| 15 | `test_empty_panes_list` | Empty table `{}` | Returns nil | Unit |
| 16 | `test_spatial_sorting_preserved` | 3 healthy panes at different positions, passed in wrong order | Tree root is the top-left pane | Unit |

### 3. `pane_tree.lua` -- `validate_pane_tree()`

This is the most testable function. It operates on plain deserialized tables (no live pane objects), and the only `wezterm` dependency is `wezterm.mux.get_domain()` and `wezterm.log_warn()`.

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 17 | `test_nil_tree_invalid` | `nil` | Returns `false, "nil pane_tree"` | Unit |
| 18 | `test_valid_tree_passes` | `{cwd="/home/user", domain="local"}` with "local" domain mocked as spawnable | Returns `true, nil` | Unit |
| 19 | `test_empty_cwd_invalid` | `{cwd=""}` | Returns `false, "empty cwd"` | Unit |
| 20 | `test_nil_cwd_invalid` | `{cwd=nil}` | Returns `false, "empty cwd"` | Unit |
| 21 | `test_missing_domain_invalid` | `{cwd="/home/user", domain="gone"}` with `get_domain()` throwing | Returns `false, "domain 'gone' does not exist"` | Unit |
| 22 | `test_nonspawnable_domain_invalid` | `{cwd="/home/user", domain="ssh_dead"}` with domain.is_spawnable() returning false | Returns `false, "domain 'ssh_dead' is not spawnable"` | Unit |
| 23 | `test_no_domain_field_valid` | `{cwd="/home/user"}` (domain is nil -- local pane) | Returns `true, nil` | Unit |
| 24 | `test_prunes_invalid_right_subtree` | `{cwd="/ok", right={cwd=""}}` | Returns `true`, and `tree.right` is nil after call. Log message about pruning. | Unit |
| 25 | `test_prunes_invalid_bottom_subtree` | `{cwd="/ok", bottom={cwd=""}}` | Returns `true`, and `tree.bottom` is nil after call. Log message about pruning. | Unit |
| 26 | `test_keeps_valid_subtrees` | `{cwd="/ok", right={cwd="/ok2"}, bottom={cwd="/ok3"}}` | Returns `true`, both subtrees intact | Unit |
| 27 | `test_deep_pruning` | `{cwd="/ok", right={cwd="/ok2", bottom={cwd=""}}}` | Returns `true`, `tree.right` intact, `tree.right.bottom` pruned to nil | Unit |
| 28 | `test_prunes_both_subtrees` | `{cwd="/ok", right={cwd=""}, bottom={cwd=""}}` | Returns `true`, both `right` and `bottom` are nil | Unit |
| 29 | `test_root_invalid_rejects_whole_tree` | `{cwd="", right={cwd="/ok"}}` | Returns `false, "empty cwd"` (root itself is invalid) | Unit |

### 4. `pane_tree.lua` -- `insert_panes()` nil guard (PR #127)

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 30 | `test_nil_pane_field_returns_root_unchanged` | Call `create_pane_tree()` with a 2x2 symmetric grid layout (4 panes) where a pane would be encountered twice | Does not crash; returns a tree (exact structure may vary but no nil dereference) | Unit |

This test is tricky to construct because the double-encounter is geometry-dependent. We may need to build the exact geometry from issue #98.

### 5. `file_io.lua` -- backup before overwrite

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 31 | `test_write_state_creates_backup` | Write state to `/tmp/test_state.json`, then write again | `/tmp/test_state.json.bak` exists with original content | File I/O |
| 32 | `test_write_state_no_backup_on_first_write` | Write state to a new path that does not exist yet | No `.bak` file created | File I/O |
| 33 | `test_write_state_backup_contains_previous_content` | Write "v1" state, then write "v2" state | `.bak` contains "v1" JSON, primary contains "v2" JSON | File I/O |

### 6. `file_io.lua` -- `load_json()` error handling

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 34 | `test_load_json_valid_file` | Write valid JSON to a temp file | Returns parsed table | File I/O |
| 35 | `test_load_json_missing_file` | Path to a file that does not exist | Returns nil (no crash) | File I/O |
| 36 | `test_load_json_corrupt_file` | Write `{{{invalid` to a temp file | Returns nil (or crashes depending on json_parse behavior -- test documents which) | File I/O |
| 37 | `test_load_json_sanitizes_control_chars` | Write JSON with embedded `\x01` control character | Returns parsed table with control char escaped | File I/O |

### 7. `state_manager.lua` -- `load_state()` backup fallback

These tests require more extensive mocking (state_manager depends on file_io, which we can use with real files, plus wezterm.emit and save_state_dir).

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 38 | `test_load_state_primary_valid` | Valid `.json` file at expected path | Returns parsed state | Integration |
| 39 | `test_load_state_primary_missing_backup_valid` | No `.json`, valid `.json.bak` | Returns parsed state from backup, warning logged | Integration |
| 40 | `test_load_state_both_missing` | Neither `.json` nor `.json.bak` exist | Returns `{}`, error event emitted | Integration |
| 41 | `test_load_state_primary_corrupt_backup_valid` | Corrupt `.json`, valid `.json.bak` | Returns parsed state from backup | Integration |

### 8. `file_io.lua` -- `sanitize_json()`

`sanitize_json` is a local function. Like `is_pane_healthy`, we'd need conditional export or indirect testing through `write_state` / `load_json`.

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 42 | `test_sanitize_no_control_chars` | Normal JSON string | Returns unchanged | Unit |
| 43 | `test_sanitize_null_byte` | JSON with `\x00` | Replaced with `\u0000` | Unit |
| 44 | `test_sanitize_newline_in_value` | JSON with literal `\n` in a string value | Replaced with `\u000A` | Unit |
| 45 | `test_sanitize_tab_char` | JSON with `\t` | Replaced with `\u0009` | Unit |

### 9. Pure geometry functions (indirect testing through `create_pane_tree`)

These are all local functions (`is_right`, `is_bottom`, `compare_pane_by_coord`, `pop_connected_right`, `pop_connected_bottom`). Testing them indirectly through `create_pane_tree` with known geometries:

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 46 | `test_two_panes_horizontal_split` | Two panes: left=(0,0,40,24), right=(41,0,39,24) | Tree: root.right is the right pane, no bottom | Unit |
| 47 | `test_two_panes_vertical_split` | Two panes: top=(0,0,80,11), bottom=(0,12,80,11) | Tree: root.bottom is the bottom pane, no right | Unit |
| 48 | `test_three_panes_l_shape` | Three panes: TL=(0,0,40,11), BL=(0,12,40,11), R=(41,0,39,24) | Tree: root at TL, root.right=R, root.bottom=BL | Unit |

### 10. `workspace_state.lua` -- save-side filtering

These require mocking `wezterm.mux.all_windows()` and `wezterm.mux.get_active_workspace()`, which is deeper mock territory. Classify as integration tests.

| # | Test name | Setup | Assertion | Type |
|---|-----------|-------|-----------|------|
| 49 | `test_empty_windows_filtered_on_save` | Mock workspace with 2 windows, one having all ghost tabs | `workspace_state.window_states` has length 1 | Integration |
| 50 | `test_fully_degraded_workspace_empty` | Mock workspace where all windows have all ghost tabs | `workspace_state.window_states` has length 0 | Integration |

## What Is NOT Testable Without WezTerm Runtime

The following functions or paths require WezTerm's mux server, GUI window objects, or runtime features that cannot be faithfully mocked:

1. **`window_state.restore_window()`** -- calls `window:spawn_tab()`, `tab:activate()`, `tab:set_zoomed()`, `window:set_title()`. These are mux operations with side effects on the WezTerm process tree.

2. **`workspace_state.restore_workspace()`** -- calls `wezterm.mux.spawn_window()` and `wezterm.mux.set_active_workspace()`.

3. **`tab_state.restore_tab()`** -- calls `pane:split()` and `pane:activate()`.

4. **`state_manager.periodic_save()`** -- calls `wezterm.time.call_after()` and `wezterm.gui.gui_windows()`.

5. **`fuzzy_loader.fuzzy_load()`** -- calls `wezterm.action.InputSelector()` and `window:perform_action()`.

6. **`file_io.write_state()` with encryption** -- calls `wezterm.run_child_process()` through the encryption module.

7. **`init.lua`** -- calls `wezterm.plugin.require()` which is WezTerm's plugin loading system.

These remain manual test scenarios as described in the parent proposal. A future WezTerm headless integration test harness could cover some of these.

## Implementation Plan

### Phase 1: Infrastructure (test harness, mocks, vendored deps)

Create the test directory structure and the foundational files:

1. `test/luaunit.lua` -- vendor LuaUnit
2. `test/dkjson.lua` -- vendor dkjson
3. `test/mock_wezterm.lua` -- wezterm module mock
4. `test/mock_pane.lua` -- pane/domain object factories
5. `test/test_helper.lua` -- package.path setup, preload injection, utility functions
6. `test/run_tests.lua` -- test runner that discovers and runs all `test_*.lua` files

Conditional test export in production code:

```lua
-- pane_tree.lua (at bottom, before return)
if _RESURRECT_TESTING then
    pub._is_pane_healthy = is_pane_healthy
end
```

```lua
-- file_io.lua (at bottom, before return)
if _RESURRECT_TESTING then
    pub._sanitize_json = sanitize_json
end
```

The `_RESURRECT_TESTING` global is set by `test_helper.lua` before any plugin modules are required.

### Phase 2: Core validation tests

Write tests for the highest-value targets:

1. `test/test_validate.lua` -- 13 test cases for `validate_pane_tree()` (tests 17-29)
2. `test/test_pane_tree.lua` -- 16 test cases for `is_pane_healthy()` and `create_pane_tree()` (tests 1-16, 30, 46-48)
3. `test/test_file_io.lua` -- 10 test cases for backup logic, load_json, sanitize_json (tests 31-37, 42-45)

### Phase 3: State manager and integration tests

1. `test/test_state_manager.lua` -- 4 test cases for `load_state()` backup fallback (tests 38-41)
2. `test/fixtures/` -- JSON fixture files for load/parse tests

### Phase 4: CI integration (optional, future)

If the fork adds GitHub Actions CI:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: leafo/gh-actions-lua@v10
        with:
          luaVersion: "luajit-2.1"
      - run: luajit test/run_tests.lua -o junit -n test-results.xml
      - uses: mikepenz/action-junit-report@v4
        with:
          report_paths: test-results.xml
```

## Test Runner Skeleton

```lua
-- test/run_tests.lua
--
-- Discovers and runs all test_*.lua files in the test/ directory.

-- Determine paths
local script_path = arg[0]:match("(.*/)")  or "./"
local repo_root = script_path:match("(.*)test/") or "./"

-- Set testing flag BEFORE any requires
_RESURRECT_TESTING = true

-- Set up package.path
package.path = repo_root .. "plugin/?.lua;"
             .. repo_root .. "plugin/?/init.lua;"
             .. repo_root .. "test/?.lua;"
             .. package.path

-- Inject wezterm mock
local mock_wezterm = require("mock_wezterm")
package.preload["wezterm"] = function() return mock_wezterm end

-- Also preload dev.wezterm stub so init.lua doesn't crash
-- (we don't test init.lua, but if anything transitively requires it)
package.preload["dev.wezterm"] = function()
    return { setup = function() return repo_root .. "plugin" end }
end

-- Load test files
require("test_validate")
require("test_pane_tree")
require("test_file_io")
require("test_state_manager")

-- Run
local lu = require("luaunit")
os.exit(lu.LuaUnit.run())
```

## Risk Assessment

### Low risk
- Adding test files has zero impact on plugin runtime behavior.
- Conditional export behind `_RESURRECT_TESTING` global has no production impact (the global is never set outside tests).
- Vendored dependencies (luaunit, dkjson) are MIT-licensed, stable, and well-maintained.

### Medium risk
- Mock fidelity: if our mock pane objects diverge from real WezTerm pane behavior, tests may pass but production fails. Mitigation: keep mocks minimal and document assumptions.
- LuaJIT vs Lua 5.4 semantics: WezTerm uses LuaJIT but our test infrastructure can run on either. Minor differences in `goto` handling, integer division, etc. Mitigation: run tests under LuaJIT as primary target.

### Not a risk
- The `package.preload` injection is a standard Lua pattern used by busted, lunit, and many other test frameworks. It does not affect any code that does not call `require("wezterm")`.

## Open Questions

1. **Should `_is_pane_healthy` be exported or tested only indirectly?** Direct export gives cleaner tests; indirect-only gives better encapsulation. Recommendation: export under `_RESURRECT_TESTING` guard as described.

2. **Should we test `utils.lua` functions?** Functions like `deepcopy`, `tbl_deep_extend`, `strip_format_esc_seq` are pure and highly testable. They are not part of the hardening changes, but adding tests would be low-effort and high-value. Recommendation: add in a follow-up, not in the initial test suite.

3. **Should we vendor dkjson or write a minimal JSON encoder?** dkjson is battle-tested and handles edge cases (Unicode, nested tables, special values). A minimal encoder would be brittle. Recommendation: vendor dkjson.

4. **Should tests run in CI on the fork?** The fork has no CI currently. Adding it is orthogonal to writing the tests. The tests should work as `luajit test/run_tests.lua` from the repo root. CI can come later. Recommendation: defer CI to Phase 4.
