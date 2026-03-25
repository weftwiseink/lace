---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T20:30:00-07:00
task_list: terminal-management/sprack-phase0-implementation
type: devlog
state: live
status: wip
tags: [sprack, testing, verifiability, implementation]
---

# Phase 0: Verifiability Infrastructure Implementation

> BLUF: Implementing the mock infrastructure from the verifiability strategy proposal.
> Four refactoring targets: ProcFs trait extraction, find_process_pid predicate refactoring, tmux socket parameterization, and claude_home injection.
> No new features: existing 76 tests must continue passing with no behavior change.

## Proposal Reference

[Verifiability strategy](../proposals/2026-03-24-sprack-verifiability-strategy.md), Phase 1 (mock infrastructure only).

## Scope

1. Extract `ProcFs` trait from `proc_walk.rs` with `RealProcFs` implementation.
2. Refactor `find_claude_pid` to `find_process_pid` with predicate parameter.
3. Add `socket: Option<&str>` parameter to 4 tmux functions.
4. Add `claude_home: &Path` parameter to `resolve_session_for_pane()`.
5. Add `insta` and `tempfile` dev-dependencies.
6. Write 3-5 smoke tests per category.

## Implementation Log

### ProcFs Trait Extraction

Starting with `proc_walk.rs`.
The current code reads `/proc/{pid}/children` directly.
The `RealProcFs` implementation adds the `task/<tid>/children` fallback documented in the verifiability strategy.

### Tmux Socket Parameterization

Four functions in `tmux.rs` need `socket: Option<&str>`:
- `tmux_command` (private helper)
- `query_tmux_state` (public)
- `query_lace_options` (public)
- `read_lace_option` (private)

Call sites in `sprack-poll/src/main.rs` pass `None` (no behavior change).

### claude_home Injection

`resolve_session_for_pane()` in `sprack-claude/src/main.rs` currently reads `$HOME` and joins `.claude`.
Refactored to accept `claude_home: &Path` parameter.
The `$HOME/.claude` construction moves to `run_poll_cycle`.

### Smoke Tests

Per-category smoke tests proving the abstractions work:
- `MockProcFs` with synthetic process trees
- Tmux socket threading (compile-time verification + arg construction)
- claude_home path injection with tempfile

## Results

All four refactoring targets completed with no behavior changes.
Test count: 76 original -> 88 total (12 new smoke tests).

New tests by category:
- 7 ProcFs trait tests (MockProcFs: direct child, grandchild, no match, unknown pid, custom predicate, cwd with mock, cwd unknown)
- 5 session discovery tests (jsonl listing, subdirectory filtering, sessions-index, sidechain filtering, empty dir)

The `RealProcFs::children()` implementation includes the `task/<tid>/children` fallback for kernel configurations that only expose children via the task subdirectory.

## Issues Encountered and Solved

No issues encountered.
All changes were mechanical: replacing hardcoded defaults with parameterized alternatives.
Existing 76 tests continued passing throughout with no modifications needed.
