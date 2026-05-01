---
review_of: cdocs/proposals/2026-03-28-sprack-reliability-improvements.md
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-28T12:00:00-07:00
task_list: sprack/reliability-improvements
type: review
state: archived
status: done
tags: [fresh_agent, architecture, sprack, reliability]
---

# Review: Sprack Reliability Improvements

> BLUF: The proposal is well-scoped, internally consistent, and directly addresses the three most visible correctness issues in sprack-claude.
> The design is defensible and the implementation phases are logically ordered.
> Several gaps need attention before implementation: the `capture_pane_status()` signature in the sketch receives raw pane content but the integration calls it with a pane target string, state mutation occurs outside the proposed helper function, the `is_clear_born()` skeleton has a compile error, and the proposal omits the `pane_target` string needed to call `tmux capture-pane`.
> Verdict: Revise on three blocking issues.

## Summary Assessment

The proposal synthesizes three recon evaluation reports into three targeted improvements for sprack-claude: capture-pane as a secondary status signal, `/clear` successor detection, and `/model` command parsing.
The scoping is appropriate for a pre-parking workstream: no architectural changes, no new crates, focused on data-correctness.
The background section accurately reflects the source code (confirmed against `status.rs`, `session.rs`, `resolver.rs`, `main.rs`).
The main weaknesses are implementation sketch errors and an unresolved question about where the pane target string comes from in `process_claude_pane`.

## Section-by-Section Findings

### BLUF and Summary

The BLUF is accurate and well-framed.
The scope estimate (~150-200 lines across 4 files) looks plausible given the actual code structure.
The summary correctly references all three source reports and the exclusion NOTE for the turn count bug is appropriate.

### Background: Current Status Detection

Accurately describes `extract_activity_state()` and its behaviour.
The `SKIPPED_ENTRY_TYPES` list in `status.rs` is not in the Background, but its omission does not affect the design.
No issues here.

### Improvement 1: Capture-Pane Secondary Status Signal

**Blocking: Sketch API mismatch.**
The proposed `capture_pane_status(pane_target: &str) -> PaneVisualStatus` signature takes a target string and internally calls `tmux capture-pane`.
The integration sketch then calls `capture_pane_status(&pane_target)` from within `process_claude_pane`.
However, `process_claude_pane` currently receives a `&sprack_db::types::Pane` and a `container_session: Option<&Session>`.
The `Pane` struct has a `pane_id` field (e.g., `%0`), which is the correct tmux target string for `tmux capture-pane -t %0`.
The proposal never states that `pane.pane_id` is the pane target to use.
This needs to be explicit: either document the mapping (`pane_target = &pane.pane_id`) or update the sketch to show `capture_pane_status(&pane.pane_id)`.

**Blocking: State counter management is outside the helper.**
The integration sketch maintains `state.consecutive_idle_overrides` in `process_claude_pane` directly.
The proposed Phase 2 adds `resolve_status_with_pane()` in `status.rs` to encapsulate the override logic.
But the sketch in Improvement 1 shows the counter being mutated inline in `main.rs`, and the Phase 2 description then adds a separate `resolve_status_with_pane()` function.
These two descriptions are inconsistent: either the inline sketch is the implementation (and the Phase 2 helper is just a refactor of that sketch), or `resolve_status_with_pane()` takes the counter as a parameter and manages it.
The Phase 2 description says the function "takes the JSONL state, pane visual status, and consecutive count, returns the final state" — but that returns a `ProcessStatus`, not an updated counter.
The caller still needs to update the counter based on the returned state.
This is workable but the sketch leaves the counter management implicit.
The implementation phases should clarify where the counter lives (answer: `SessionFileState`) and who increments/resets it (answer: the caller, not the helper).

**Non-blocking: `PaneVisualStatus::Idle` vs `Unknown` for copy mode.**
The Edge Cases section says "pane in copy mode -> Idle or Unknown."
The proposal should decide which: returning `Unknown` is safer (no override applied), returning `Idle` could cause a spurious override if Claude is actually thinking but the pane is in copy mode.
`Unknown` is the safer choice and should be documented as the explicit decision.

**Non-blocking: The `PaneVisualStatus::Input` -> `Waiting` override is unconditional.**
If the JSONL says `ToolUse` (Claude is running a tool) but the pane briefly shows a selection prompt (e.g., an interactive shell tool asking for input), the override would clobber the JSONL state.
The proposal says "all other JSONL states pass through unchanged" but then shows `PaneVisualStatus::Input => ProcessStatus::Waiting` inside the `if jsonl_state == ProcessStatus::Thinking` branch.
Reading the sketch more carefully: the `PaneVisualStatus::Input` arm is inside the `Thinking`-only branch, so it only fires when JSONL says Thinking.
This is correct; the wording in the sketch is fine.
No issue.

### Improvement 2: /clear Successor Detection

**Blocking: `is_clear_born` has a compile error in the skeleton.**
The function signature is `fn is_clear_born(path: &Path) -> bool` but the body uses `?` on `fs::File::open(path).ok()?`.
`?` in a function returning `bool` is not valid Rust.
The correct pattern is either `if let Ok(file) = fs::File::open(path) { ... } else { return false; }` or returning `Option<bool>` internally and using `.unwrap_or(false)`.
This is a sketch, so the compile error is understandable, but it should be called out explicitly since an implementer copying the skeleton will hit it immediately.

**Non-blocking: sessions-index.json interaction.**
`find_clear_successor()` scans for JSONL files newer than the current file and checks for the `/clear` marker.
But `sessions-index.json` may already list the new session; `find_session_file()` in `session.rs` handles this through its two-tier strategy.
The proposal says to integrate into `LocalResolver::resolve()` after `find_session_file()`.
This is correct: `find_clear_successor()` is a supplementary check, not a replacement.
The integration note is accurate but could be more explicit about whether `find_session_file()` already handles new sessions without the `/clear` marker (answer: yes, via mtime comparison for files not in the sessions-index).
This is a documentation gap, not a design flaw.

**Non-blocking: `last_clear_check` type.**
The proposal says `last_clear_check: Option<Instant>` on `SessionFileState`.
`std::time::Instant` is the correct type for measuring elapsed time.
The existing `SessionFileState` uses `SystemTime` for git mtime fields.
`Instant` is not serializable but `SessionFileState` is not serialized either (it's a runtime cache), so `Instant` is fine here.
No issue, but noting the consistency: the existing code uses `SystemTime` for mtimes and `u32` for cycle counts.
An `Instant` field is a different idiom; consider documenting the reason (`Instant` is monotonic and suitable for rate-limiting; `SystemTime` is for comparing with filesystem mtimes).

### Improvement 3: /model Command Parsing

**Non-blocking: Model ID extraction from display name is fragile.**
The proposal acknowledges this with a NOTE.
The recon technique extracts the model ID from the parenthetical `(claude-opus-4-6)` in the command output, not from a hardcoded display-name table.
The regex pattern `Set model to <display_name> (<model_id>)` is more robust than the table in the proposal.
The proposal's table is adequate for known models and the NOTE covers the failure mode.
Worth adding: the implementation should prefer extracting from the parenthetical if present, falling back to the table only if not.

**Non-blocking: `extract_model_override` scans all entries in reverse.**
For a large tail window (32KB), this could scan thousands of entries.
Practically the `/model` command is rare; the cost is negligible.
Not a blocker.

**Non-blocking: `effort_level: Option<String>` on `SessionFileState` vs `ClaudeSummary`.**
The proposal adds `effort_level` to `ClaudeSummary`.
The `ClaudeSummary` struct (confirmed in `status.rs`) uses `#[serde(default)]` for optional fields, so adding a new field is backward-compatible.
The proposal does not show the `ClaudeSummary` struct update explicitly, but Phase 4 step 7 lists it.
No issue.

### Edge Cases

**Non-blocking: Subagent JSONL in `/clear` detection.**
The proposal says subagent files do not have the `/clear` marker.
Confirmed from the code: subagent JSONL files are stored in subdirectories (not the project root), so `find_via_jsonl_listing()` in `session.rs` already filters them out.
The `find_clear_successor()` would also scan only the project root directory by design.
This edge case is actually a non-issue for local sessions.
For container sessions where the project directory contains both main and subagent JSONL files at the root level (different behaviour than local sessions), the `is_clear_born()` check is the correct guard.

**Non-blocking: ANSI stripping approach.**
The proposal says "a simple regex `\x1b\[[0-9;]*m` covers the common cases."
This covers SGR sequences (color/style) but not other escape types (cursor movement, OSC, etc.).
For `/model` command output, SGR is the only concern.
The scope is appropriate.

### Test Plan

The test plan covers all the proposed cases.
One gap: there is no test for the `/clear` successor detection interacting with `sessions-index.json` — specifically, what happens when the clear-born JSONL is already in the index (expected: `find_session_file()` finds it before `find_clear_successor()` runs, so the check is redundant but harmless).
This is a documentation gap in the test plan, not a missing test (the case is already handled by existing `find_session_file()` tests).

### Implementation Phases

The phases are well-ordered: pure parsing (Phase 1), integration (Phase 2), resolver changes (Phase 3), model parsing (Phase 4), cleanup (Phase 5).
Dependencies flow correctly: Phase 2 depends on Phase 1, Phase 3 is independent of 1-2, Phase 4 is independent of 1-3.

One concern: Phase 3 adds `last_clear_check: Option<Instant>` to `SessionFileState`, which is used in the main poll loop.
The proposal says to add the field to `SessionFileState` in `session.rs`, but `session.rs` has no mutable state at runtime (it's a data structure module).
The rate-limiting logic that reads `last_clear_check` belongs in `main.rs` (in `process_claude_pane`) or in a thin wrapper.
The phase description correctly lists `main.rs` as the integration point but does not show where `last_clear_check` is checked and updated.
This should be made explicit.

### Verification Methodology

The WARN callout about manual verification requiring a real tmux+Claude session is accurate and appropriate.
The `--dump-rendered-tree` step for effort level rendering is a good addition.

## Verdict

**Revise.** Three blocking issues must be addressed:

1. The `pane_target` string used in `capture_pane_status()` is never mapped to `pane.pane_id` in the integration sketch.
2. The `is_clear_born` skeleton has a `?` operator in a `bool`-returning function, which does not compile.
3. The state counter management across the Improvement 1 inline sketch and the Phase 2 `resolve_status_with_pane()` description is inconsistent and needs clarification.

None of these are fundamental design problems; all are sketch-level gaps that would surface immediately during implementation.
The non-blocking suggestions are worth considering but do not block acceptance.

## Action Items

1. [blocking] Document `pane_target = pane.pane_id` explicitly in the Improvement 1 integration sketch and Phase 2 description. Show `capture_pane_status(&pane.pane_id)` in the `process_claude_pane` integration.
2. [blocking] Fix the `is_clear_born` skeleton: replace `?` with `if let Ok(...) { ... } else { return false; }` to produce valid Rust.
3. [blocking] Clarify the `consecutive_idle_overrides` counter lifecycle: document that it lives on `SessionFileState`, is incremented/reset in `process_claude_pane`, and that `resolve_status_with_pane()` is a pure function that takes the count and returns a new status (not a mutable update).
4. [non-blocking] Decide and document `PaneVisualStatus::Unknown` as the return value for copy-mode panes (rather than leaving it as "Idle or Unknown").
5. [non-blocking] Prefer extracting the model ID from the parenthetical `(claude-opus-4-6)` in `/model` output rather than a hardcoded display-name table. Fall back to the table only when the parenthetical is absent.
6. [non-blocking] Add a clarifying note in the Phase 3 integration: where in `process_claude_pane` is `last_clear_check` checked and updated (show the rate-limit gate pseudo-code).
