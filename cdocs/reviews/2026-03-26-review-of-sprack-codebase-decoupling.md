---
review_of: cdocs/proposals/2026-03-26-sprack-codebase-decoupling.md
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T12:00:00-07:00
task_list: sprack/lace-decoupling
type: review
state: live
status: done
tags: [fresh_agent, architecture, code_deletion_audit, schema_migration, cross_proposal_consistency]
---

# Review: Sprack Codebase Decoupling

## Summary Assessment

This proposal catalogs the sprack Rust codebase's lace-specific code and specifies a six-phase refactoring to consume the new mount-based data channels from three companion proposals.
The code deletion inventory is thorough and largely accurate against the actual source: line numbers align, struct names match, and the scope of changes in each file is correctly identified.
The most significant finding is that the proposal misses several files containing lace-specific code: `sprack-poll/src/diff.rs`, `sprack-poll/src/main.rs`, `sprack-db/src/lib.rs` (test helpers), and `sprack/src/test_render.rs` all contain lace references that require updating.
Verdict: **Revise** to address the incomplete inventory and a few architectural clarifications.

## Section-by-Section Findings

### Frontmatter

**Non-blocking.** Frontmatter is well-formed and compliant with the spec.
The `status: wip` is appropriate for a proposal under review.
Tags are descriptive and relevant.

### BLUF

**Non-blocking.** The BLUF is strong: it names all four crates, gives a net line count estimate, and states the key outcome (container-agnostic monitoring).
The "~300 lines deleted, ~150 lines added" estimate is plausible given the source sizes but cannot be precisely verified without implementing the changes.

### Code Deletion Inventory: sprack-poll/src/tmux.rs (Section 1)

**Non-blocking (accuracy confirmed).** Line numbers verified against source:
- `LaceMeta` struct at lines 180-185: correct.
- `query_lace_options()` at lines 192-210: correct.
- `read_lace_option()` at lines 215-218: correct.
- `parse_lace_option()` at lines 223-230: correct.
- `to_db_types()` lace mapping at lines 251-257: correct.
- Test references at lines 672-804: correct. Tests `test_lace_options_parsing`, `test_lace_options_missing`, `test_to_db_types_maps_correctly`, `test_to_db_types_without_lace_meta` all contain lace-specific field references.

The NOTE callout resolving the `@lace_container` vs `@container_name` naming is a pragmatic decision.
The sprack-side generic naming with lace-branded tmux reads is the right trade-off for this stage.

### Code Deletion Inventory: sprack-db (Section 2)

**Non-blocking (accuracy confirmed).** All four files (`schema.rs`, `types.rs`, `read.rs`, `write.rs`) are correctly inventoried.
Line numbers verified:
- `schema.rs` line 52-54 (`lace_port`, `lace_user`, `lace_workspace` columns): correct.
- `schema.rs` line 11 (`CURRENT_SCHEMA_VERSION = 1`): correct.
- `types.rs` lines 19-23 (`lace_port`, `lace_user`, `lace_workspace` fields): correct.
- `read.rs` lines 76-88 (query and row mapping): correct.
- `write.rs` lines 113-122 (INSERT and params): correct.

### Code Deletion Inventory: Missing Files (BLOCKING)

**Blocking.** The inventory claims to be exhaustive but misses lace-specific code in four files:

1. **`sprack-poll/src/diff.rs`** (16 lace occurrences): Contains `compute_lace_meta_hash()` (line 33), accepts `HashMap<String, LaceMeta>`, and has four test functions (`test_lace_meta_hash_detects_change`, `test_lace_meta_hash_detects_no_change`) that construct `LaceMeta` structs with `port`, `user`, `workspace` fields. After the `LaceMeta` -> `ContainerMeta` rename, this file needs updating throughout. The `port: Option<u16>` field becomes `container_name: Option<String>`, changing the hash behavior (String vs u16).

2. **`sprack-poll/src/main.rs`** (28 lace occurrences): Imports `compute_lace_meta_hash`, `query_lace_options`, `LaceMeta` (lines 17-20). Uses `last_lace_hash`, `current_lace_hash`, `lace_changed`, `lace_meta` variable names (lines 59, 85-101). Test code constructs `LaceMeta` structs (lines 353-365, 399-400, etc.). All need renaming for consistency.

3. **`sprack-db/src/lib.rs`** (6 lace occurrences): Test helper `make_test_session()` at line 110 constructs `Session` with `lace_port: None, lace_user: None, lace_workspace: None`. The round-trip test at lines 200-208 constructs `Session` with `lace_port: Some(2222)`. These must match the renamed struct fields.

4. **`sprack/src/test_render.rs`** (10 lace occurrences): `make_session_lace()` helper at line 113 constructs sessions with `lace_port`, `lace_user`, `lace_workspace`. Default session builder at line 99-101 sets these fields to `None`. Used in snapshot tests for multi-session rendering.

These four files should be added to the inventory tables, likely in Phase 1 (type renames) and Phase 6 (cleanup).

### Code Deletion Inventory: sprack-claude/src/resolver.rs (Section 3)

**Non-blocking (accuracy confirmed with one observation).** The line numbers for all items match:
- `CONTAINER_RECENCY_THRESHOLD` at line 19: correct.
- `WARNED_MISSING_WORKSPACE` at lines 23-24: correct.
- `find_candidate_panes()` at lines 31-64: correct.
- `build_lace_session_map()` at lines 67-75: correct.
- `LaceContainerResolver` at lines 131-164: correct.
- `resolve_container_pane()` at lines 170-198: correct.
- `find_container_project_dir()` at lines 208-243: correct.
- `newest_jsonl_mtime()` at lines 248-259: correct.
- Tests start at line 262 (proposal says 318-548). The test functions begin at line 262 with helpers, with actual test cases starting later. This is approximately correct, though the exact test line range could be tighter.

The observation that `encode_project_path()` in `proc_walk.rs` is retained is correct and properly noted.

### Code Deletion Inventory: sprack-claude/src/main.rs (Section 4)

**Non-blocking (accuracy mostly confirmed).** Key line references verified:
- `lace_sessions` at line 104: correct.
- `lace_session` at line 109: correct.
- `process_claude_pane()` lace_session parameter at lines 134-140: correct.
- Container resolution dispatch at lines 156-163: correct.
- `is_file()` check at lines 266-269: correct (actual location is lines 262-269).
- `is_session_cache_valid()` ContainerSession branch at lines 378-395: correct.
- Git context gate at line 335: correct.

### DB Schema Migration

**Non-blocking.** The drop-and-recreate approach is sound given the ephemeral nature of the DB.
The migration SQL is straightforward and the match arm extension (`0 | 1 => { ... }`) is clean.
One observation: the `SCHEMA_SQL` constant at `schema.rs` line 47 contains `PRAGMA user_version = 1;`. The proposal's new schema must update this to `PRAGMA user_version = 2;`. This is implied but not explicitly stated in the migration section.

### tmux Metadata Decoupling

**Non-blocking.** This section is well-structured.
The table of options is clear and the reasoning for keeping `@lace_container` as the concrete read with `container_name` as the generic field is sound.
The standalone tmux plugin sketch is appropriately scoped out of this proposal while demonstrating that the refactoring enables it.

### Git Context Re-enablement

**Non-blocking with one concern.** The two-approach strategy (mount metadata primary, podman exec fallback) is sound.

Concern: The `resolve_container_git_state()` code at line 438 assumes `container_name` matches the project directory name under `~/.local/share/sprack/lace/<project>/`. This is the same issue as Open Question 3 (`sanitizeContainerName` divergence). The proposal acknowledges this in the edge cases section but the code sample doesn't reflect the mitigation: it does a direct path join (`lace_dir.join(container_name)`) rather than scanning directories. The edge case section says event file lookup scans all directories, but the metadata file lookup does not. This should be called out more prominently in the git context section itself, not just in edge cases.

### Replacement Architecture Diagrams

**Non-blocking.** The Mermaid diagrams are clear and correctly represent the flow.
The decision to defer `ContainerBackend` trait extraction is pragmatic and well-justified.

### Edge Cases

**Non-blocking.** Thorough coverage of failure modes.
The concurrent v1/v2 scenario, missing sprack feature, multiple Claude sessions, and stale event files are all handled.

### Test Plan

**Non-blocking.** The 24-test plan covers the major scenarios.
It would benefit from one additional test: a test verifying the schema version 1 -> 2 migration on a DB that contains data (even though the data is dropped, confirming the migration path executes cleanly on a non-empty DB is worth a test).

### Implementation Phases

**Non-blocking with one dependency concern.** The six phases are well-ordered.
Phase 1 (renames) is correctly independent.
Phases 2-3 correctly build on each other.
Phase 4 can run in parallel with Phase 2-3 (only depends on Phase 1), which is noted.

Concern: Phase 5 depends on "Phase 3 (mount-based resolution), Phase 4 (TUI rendering enabled)" but Phase 4 only says "Depends on: Phase 1". This means Phases 2-3 and Phase 4 can run independently, but Phase 5 needs all of them. The dependency graph is correct but could be stated as a Mermaid diagram for clarity.

### Open Questions

**Blocking (Open Question 3).** The `lace.projectName` vs `sanitizeContainerName()` divergence is a real correctness risk.
The proposal acknowledges this but describes it as an open question rather than specifying a resolution.
Since this affects the metadata file lookup (Approach A for git context), it needs to be resolved or the metadata lookup needs to fall through to a directory scan.

The proposal's mitigation in the edge cases section (event file lookup scans all directories by content) only covers event resolution, not metadata resolution.
The git context `resolve_container_git_state()` function does a direct path join.
Either:
(a) The sprack devcontainer feature proposal should guarantee that the directory name matches `sanitizeContainerName()` output, or
(b) `resolve_container_git_state()` should scan `~/.local/share/sprack/lace/*/metadata/state.json` and match by some other criterion (container name inside the state.json), or
(c) The metadata writer should include the container name in `state.json` so sprack can match it.

This should be promoted from an open question to a design decision with a specific resolution.

### Writing Conventions

**Non-blocking.** The document mostly follows conventions well.
Sentence-per-line is used throughout.
BLUF is present and strong.
NOTE callouts have proper attribution.
No emojis.
One minor punctuation issue: the document uses em-dash-like constructs in a few places (e.g., "the TUI shows `[lace-dev]` or similar") but these are within code context and acceptable.

## Verdict

**Revise.** Two blocking issues:

1. The code deletion inventory is incomplete: four files with lace-specific code are missing (`diff.rs`, `sprack-poll/main.rs`, `sprack-db/lib.rs`, `test_render.rs`). For a proposal whose stated purpose is an "exhaustive" inventory, these omissions must be addressed.

2. Open Question 3 (project directory name divergence) needs a concrete resolution rather than remaining open, since it directly affects the correctness of the git context metadata lookup.

All other findings are non-blocking improvements.

## Action Items

1. [blocking] Add `sprack-poll/src/diff.rs` to the inventory: `compute_lace_meta_hash()`, `LaceMeta` imports, and all test `LaceMeta` constructors need renaming. The hash function's behavior changes because `port: Option<u16>` becomes `container_name: Option<String>`.
2. [blocking] Add `sprack-poll/src/main.rs` to the inventory: imports (`compute_lace_meta_hash`, `query_lace_options`, `LaceMeta`), variable names (`last_lace_hash`, `lace_meta`, etc.), and test `LaceMeta` constructors.
3. [blocking] Add `sprack-db/src/lib.rs` to the inventory: `make_test_session()` and round-trip test session constructors reference `lace_port`/`lace_user`/`lace_workspace`.
4. [blocking] Add `sprack/src/test_render.rs` to the inventory: `make_session_lace()` helper and default session builders reference `lace_port`/`lace_user`/`lace_workspace`.
5. [blocking] Resolve Open Question 3: specify how `resolve_container_git_state()` handles the case where `container_name` does not match the project directory name. Either guarantee alignment in the sprack devcontainer feature proposal or add a scanning fallback to the git metadata lookup.
6. [non-blocking] Explicitly note that `SCHEMA_SQL` must update `PRAGMA user_version = 1` to `PRAGMA user_version = 2` (currently line 47 of `schema.rs`).
7. [non-blocking] Add a Phase 1 acceptance criterion: no `LaceMeta` type name remaining in any crate (currently it appears in `diff.rs` and `main.rs` of sprack-poll).
8. [non-blocking] Consider adding a Mermaid dependency graph for the six implementation phases.
9. [non-blocking] Add a schema migration test case: version 1 DB with existing data (rows in sessions table) successfully migrates to version 2.
