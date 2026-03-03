---
review_of: cdocs/proposals/2026-03-01-resurrect-test-suite.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-01T19:30:00-06:00
task_list: wezterm/resurrect-hardening
type: review
state: archived
status: done
tags: [fresh_agent, test_plan, mock_fidelity, test_coverage, resurrect, wezterm]
---

# Review: resurrect.wezterm Test Suite Implementation

## Summary Assessment

The test suite implements 52 tests across 4 test files, covering the core validation, file I/O, and state management logic of the resurrect.wezterm fork's hardening changes. The implementation faithfully follows the proposal's test case matrix (48 of 50 proposed cases plus 4 bonus geometry helper tests) and the infrastructure is clean and well-isolated. The mock fidelity is adequate for the functions under test, and the `_RESURRECT_TESTING` conditional export pattern is sound. The most significant gap is the `test_load_json_corrupt_file` test, which wraps the call in `pcall` and accepts either nil return or an exception, making it non-deterministic in what it actually validates. Overall this is a strong first test suite for a plugin that previously had zero automated testing.

**Verdict: Accept** with non-blocking suggestions.

## Section-by-Section Findings

### Test Infrastructure (run_tests.lua, test_helper.lua)

The test runner and helper are well-structured. `test_helper.lua` correctly sets `_RESURRECT_TESTING = true` before any plugin requires, injects the mock wezterm via `package.preload`, and provides clean utility functions for file I/O, log inspection, and temp file management.

**Finding: temp file paths may collide across rapid successive runs.** `M.tmp_path()` uses `os.time()` (second-granularity) plus a per-process counter. If the test suite runs twice in the same second (unlikely for human use, possible in CI retry loops), paths could collide. Non-blocking because the counter differentiates within a single process.

**Finding: `run_tests.lua` duplicates package.path setup from `test_helper.lua`.** Lines 9-12 of `run_tests.lua` set `package.path` to find test modules, and then `test_helper.lua` does the same thing plus adds the `plugin/` paths. The runner's path setup is necessary so it can find `test_helper.lua` itself, but the overlap could confuse future maintainers. Non-blocking; a comment explaining this would suffice.

### Mock Fidelity (mock_wezterm.lua, mock_pane.lua)

The mock wezterm module covers all API surfaces exercised by the tested code paths. Using `dkjson` for `json_encode`/`json_parse` is the right call -- it provides real JSON serialization semantics rather than a stub.

**Finding: `mock_wezterm.mux` is missing `get_active_workspace`, `all_windows`, and `set_active_workspace`.** These are used by `workspace_state.lua`, which is loaded transitively. Since the test suite does not test workspace_state functions directly, this is not a current problem, but adding tests for workspace save-side filtering (proposal tests 49-50) would require extending the mock. Non-blocking.

**Finding: mock_pane's `make_pane_info` defaults `is_active` and `is_zoomed` to `false` via the `or false` pattern.** This means `opts.is_active = false` is indistinguishable from `opts.is_active = nil`. If a test needed to explicitly set a field to `false` for semantic reasons, the mock would not differentiate. In practice this is fine because `false` is the intended default, but the pattern `if opts.X == nil then true else opts.X end` would be more precise for boolean fields. Non-blocking.

**Finding: `mock_wezterm.shell_join_args` is implemented but not tested.** It provides a basic string join, which is a simplification of WezTerm's real shell quoting behavior. If tests for `default_on_pane_restore` are added later, this mock's fidelity would matter. Non-blocking for now.

### Test Isolation

Every test class uses `setUp` to call `helper.reset()`, which clears logs, events, and domain registrations on the mock. File I/O tests use `tearDown` to clean up temp files. State manager tests use `setUp`/`tearDown` with per-test temp directories.

**Finding: State manager tests use `os.execute('rm -rf ...')` for cleanup.** This is fine for test teardown but is platform-specific (Linux). If someone ran these tests on a non-Unix system, teardown would fail silently. Since the proposal targets Linux-only and WezTerm's embedded Lua is also Linux for this fork, this is acceptable. Non-blocking.

**Finding: File I/O tests properly use unique paths per test via `helper.tmp_path()`.** Tests do not share state files, which prevents cross-test contamination. The `tearDown` methods clean up both primary and `.bak` files.

### Test Coverage: is_pane_healthy (TestIsPaneHealthy)

All 10 proposed test cases are implemented. The tests directly exercise the exported `_is_pane_healthy` function with appropriate mock panes covering every branch:

- nil pane object
- nil cwd (returns nil from `get_current_working_dir`)
- empty cwd file_path
- nil cwd file_path (via method override)
- zero dimensions (both zero, one zero)
- non-spawnable domain
- missing domain (pcall catches error)
- healthy pane with spawnable domain

**Finding: Tests 1-10 align exactly with the source code's branch structure in lines 20-44 of `pane_tree.lua`.** Every conditional path has at least one test. Good coverage.

### Test Coverage: create_pane_tree (TestCreatePaneTree, TestGeometry, TestPR127NilGuard)

Tests 11-16 are implemented. The `create_pane_tree` tests verify filtering behavior (ghost pane removal, all-unhealthy returns nil, empty list returns nil) and spatial sorting. The geometry tests verify horizontal splits, vertical splits, and L-shaped layouts.

**Finding: The geometry tests exercise `insert_panes` end-to-end.** They verify not just that a tree is produced, but that the spatial structure is correct (root.right, root.bottom point to the expected panes). This is good -- it catches regressions in `pop_connected_right`, `pop_connected_bottom`, `is_right`, and `is_bottom` indirectly.

**Finding: `TestGeometryHelpers` adds 4 bonus tests for the conditionally-exported private functions `_compare_pane_by_coord`, `_is_right`, and `_is_bottom`.** These were not in the proposal but are valuable for catching regressions in the sorting and adjacency logic without needing to construct full pane trees.

**Finding: The PR #127 test uses a 2x2 grid that should trigger the double-encounter case.** The test verifies no crash occurs, which is the primary assertion. However, it does not verify the resulting tree structure in detail -- it only checks `tree.cwd == "/tl"`. A more thorough assertion would verify that all 4 panes appear in the tree. Non-blocking because the primary purpose is crash prevention.

### Test Coverage: validate_pane_tree (TestValidatePaneTree)

All 13 proposed test cases (17-29) are implemented. The tests cover:
- nil tree, valid tree, empty cwd, nil cwd
- missing domain, non-spawnable domain, no domain field
- pruning invalid right/bottom subtrees, keeping valid subtrees
- deep pruning, pruning both subtrees, root invalid rejects whole tree

**Finding: This is the strongest section of the test suite.** Every validation branch is tested, including the recursive pruning behavior. The assertions check both the return value and the side effects (mutation of the tree, log messages). The log message assertions use `helper.find_log` to verify specific warning text, which provides good specificity.

### Test Coverage: file_io (TestWriteStateBackup, TestLoadJson, TestSanitizeJson)

All proposed file I/O tests (31-37, 42-45) are implemented.

**Finding (quality concern): `test_load_json_corrupt_file` wraps the call in `pcall` and accepts either outcome.** Lines 90-96 of `test_file_io.lua`:

```lua
local ok, result = pcall(file_io.load_json, self.path)
-- Either returns nil gracefully or throws (document which)
if ok then
    lu.assertNil(result)
end
-- If pcall caught an error, that's also acceptable (json_parse may throw)
```

This test passes regardless of whether `load_json` returns nil gracefully or throws an exception. It does not assert a specific behavior. Looking at the actual source code (`file_io.lua` lines 126-137), `load_json` uses pcall around `io.lines`, so file-read errors are caught. But then `json = sanitize_json(json)` followed by `wezterm.json_parse(json)` could throw if `dkjson.decode` throws on malformed input. The test should either (a) assert that `load_json` returns nil for corrupt input (documenting the expected behavior) or (b) assert that it throws a specific error. As written, it is a no-op assertion when the function throws. Non-blocking but worth fixing to document the actual contract.

**Finding: sanitize_json tests are solid.** They test null bytes, tabs, and newlines with specific `\u00XX` escape assertions. The `test_sanitize_no_control_chars` test verifies passthrough behavior. These directly test the conditionally-exported `_sanitize_json` function.

### Test Coverage: state_manager (TestLoadState)

All 4 proposed test cases (38-41) are implemented.

**Finding: `test_load_state_both_missing` asserts `next(result) == nil` (empty table).** This correctly matches the `return {}` on line 53 of `state_manager.lua`. Good -- it verifies the graceful degradation path.

**Finding: `test_load_state_primary_corrupt_backup_valid` exercises the full fallback chain.** It writes corrupt JSON to the primary path and valid JSON to the backup, then asserts the backup's content is returned. This is the most important scenario for crash loop prevention.

**Finding: State manager tests manipulate `state_manager.save_state_dir` directly.** This is a reasonable approach for test setup, but it means the tests depend on the internal structure of state file paths (subdirectory per type, `.json` extension). If the path construction in `get_file_path` changes, these tests would break. This is acceptable coupling for unit tests.

### Test Coverage: Gaps

**Finding: Proposal tests 49-50 (workspace_state save-side filtering) are not implemented.** The proposal classified these as "Integration" type. Given the complexity of mocking `wezterm.mux.all_windows()` and workspace iteration, omitting these is reasonable. However, `workspace_state.get_workspace_state()` (lines 74-90 of `workspace_state.lua`) contains the filtering logic that skips windows with no healthy tabs. This is testable with mock extensions and would be valuable. Non-blocking.

**Finding: No tests for `pane_tree.map()` or `pane_tree.fold()`.** These are used during restore (`tab_state.restore_tab` calls `fold`). While they are straightforward traversal functions, a regression in `fold` would break the entire restore path. A couple of tests would be cheap to add. Non-blocking.

**Finding: No tests for the `os.rename` error handling path in `write_state`.** The previous review identified "unchecked os.rename" as a blocking issue, and commit 489bddc added `local ok, err = os.rename(...)` with a warning. The current test `test_write_state_creates_backup` verifies the happy path (rename succeeds), but there is no test for the case where `os.rename` fails (e.g., permissions error). Testing this would require making `os.rename` fail, which is tricky in a unit test without monkey-patching. Non-blocking, but documenting this as a known gap is worthwhile.

**Finding: No tests for `tab:active_pane()` returning nil in `restore_tab`.** The previous review identified "nil active_pane in restore_tab" as a blocking issue. Looking at `tab_state.lua` line 105, the code still calls `tab:active_pane():split(split_args)` without a nil guard. The note says commit 489bddc fixed this, but the current code does not show a nil guard. This appears to be a code issue rather than a test gap, but the test suite should include a test documenting this edge case if and when it is fixed. Non-blocking for the test suite review, but the underlying code fix should be verified separately.

### The _RESURRECT_TESTING Conditional Export Pattern

The pattern is implemented in both `pane_tree.lua` (lines 292-298) and `file_io.lua` (lines 147-150). It exports private functions only when the global `_RESURRECT_TESTING` is set, which `test_helper.lua` sets before any requires.

**Finding: The pattern is sound.** The global is never set outside tests (it is not referenced anywhere in the non-test code). The exported names use underscore prefixes (`_is_pane_healthy`, `_sanitize_json`, `_compare_pane_by_coord`, `_is_right`, `_is_bottom`) to signal they are internal. The conditional block is placed at the bottom of each module, right before `return pub`, so it does not affect the module's structure.

**Finding: `pane_tree.lua` exports more private functions than `file_io.lua`.** The pane_tree module exports `_is_pane_healthy`, `_compare_pane_by_coord`, `_is_right`, and `_is_bottom`. The proposal only specified `_is_pane_healthy` and `_sanitize_json`. The extra exports enable the `TestGeometryHelpers` bonus tests. This is a good extension -- more direct testability for internal geometry logic.

### Proposal Accuracy

The proposal specified LuaJIT as the primary runtime, noting "WezTerm uses LuaJIT (5.1-compatible)." The implementation corrected this to Lua 5.4 with a note in `run_tests.lua`: "WezTerm uses Lua 5.4 (via mlua), not LuaJIT." This is an important correction -- WezTerm indeed uses mlua which embeds Lua 5.4, not LuaJIT. The test runner shebang is `#!/usr/bin/env lua5.4`.

**Finding: The proposal's Lua version claim was wrong, and the implementation correctly fixed it.** The test suite runs under `lua5.4` which matches WezTerm's actual runtime. Good.

### dkjson Dependency

The test suite vendors `dkjson.lua` as specified in the proposal. This provides real JSON encode/decode for the mock wezterm module, which is critical for the file I/O tests that round-trip through JSON.

**Finding: No issues observed with the dkjson integration.** The mock wezterm module requires it directly, and it works with Lua 5.4.

## Verdict

**Accept.** The test suite is well-implemented, closely follows the proposal, and provides meaningful coverage of the hardening changes. All 52 tests pass. The test infrastructure is clean, isolation is good, and the mock fidelity is appropriate for the tested code paths. The non-blocking findings below identify areas for improvement but none block acceptance.

## Action Items

1. [non-blocking] Strengthen `test_load_json_corrupt_file` to assert a specific outcome rather than accepting either nil return or exception. Run the test manually without pcall to determine the actual behavior, then assert that behavior explicitly.

2. [non-blocking] Add a comment to the PR #127 test explaining what tree structure is expected for the 2x2 grid, even if only the root cwd is asserted. This helps future maintainers understand what the test is verifying.

3. [non-blocking] Add tests for `pane_tree.map()` and `pane_tree.fold()` -- these are simple traversal functions but they are in the critical restore path, and a couple of tests would be low-effort.

4. [non-blocking] Verify whether the "nil active_pane in restore_tab" fix from commit 489bddc actually landed in `tab_state.lua`. The current source at line 105 still shows `tab:active_pane():split(split_args)` without a nil guard. If the fix was applied differently (e.g., the caller ensures `active_pane` is never nil by validating earlier), document that reasoning. If the fix is missing, add a nil guard and a corresponding test.

5. [non-blocking] Consider extending mock_wezterm with `mux.all_windows()`, `mux.get_active_workspace()`, and `mux.set_active_workspace()` stubs to enable future workspace_state tests (proposal tests 49-50).

6. [non-blocking] Document the `os.rename` failure path as a known test gap. The error handling code exists in `file_io.lua` line 80-82 but there is no test for it because triggering a rename failure is difficult in a unit test.

7. [non-blocking] Add a comment to `run_tests.lua` explaining why it sets `package.path` independently from `test_helper.lua` (it needs to find `test_helper.lua` itself before the helper can set up the full path).
