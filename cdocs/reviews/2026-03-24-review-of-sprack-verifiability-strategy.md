---
review_of: cdocs/proposals/2026-03-24-sprack-verifiability-strategy.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:00:00-07:00
task_list: terminal-management/sprack-verifiability
type: review
state: live
status: done
tags: [fresh_agent, test_plan, architecture, mock_fidelity]
---

# Review: sprack Verifiability Strategy

## Summary Assessment

This proposal defines a four-tier testing strategy to close the significant gaps identified in the companion verifiability analysis report.
The tiered approach (unit, integration, container-boundary mocks, TUI snapshots) is well-structured and pragmatic.
The proposal accurately identifies what can and cannot be tested in-container and makes sound tradeoffs.
Two blocking issues: the `PaneResolver` dispatch tests reference an abstraction that does not exist in the current codebase, and the proposal's refactoring requirements for `find_claude_pid` and `resolve_session_for_pane` are underspecified given the scope of changes needed.
Verdict: **Revise**.

## Section-by-Section Findings

### BLUF

Clear and comprehensive.
Accurately summarizes the current state (76 unit tests), the gap (no integration/boundary/TUI tests), and the proposed solution (four tiers plus manual runbook).
No issues.

### Objective

Well-scoped.
The four numbered goals map cleanly to the four tiers.
No issues.

### Tier 1: Unit Tests (Existing)

Correct assessment.
The 76 existing tests are solid for their domain and require no changes.

### Tier 2A: Mock tmux Server

**[non-blocking]** The proposal correctly identifies that `query_tmux_state()` and `query_lace_options()` need parameterization via `socket: Option<&str>`.
However, looking at the actual code in `tmux.rs`, the `tmux_command()` helper is a private function that hardcodes `Command::new("tmux")`.
The refactoring is slightly more involved than presented: `tmux_command()` must accept an optional `-L socket` argument and thread it through both `query_tmux_state()` and `query_lace_options()` (which calls `read_lace_option()` per session).
The proposal should note this explicitly: it is 4 function signatures that change, not 2.

**[non-blocking]** The code example shows `with_test_tmux` as a helper function, but test cleanup on panic (tmux server left running) is not addressed.
A `Drop`-based RAII guard would be more robust than manual cleanup.

### Tier 2B: Synthetic `~/.claude` Directory

Sound approach.
The `claude_home: &Path` parameterization is the right abstraction.

**[blocking]** The proposal says "Add `claude_home` parameter to session discovery functions" but does not address the harder problem: `resolve_session_for_pane()` in `sprack-claude/src/main.rs` reads `$HOME` directly (`std::env::var("HOME")`) and constructs the `~/.claude/projects/` path inline (lines 203-207).
This is the primary callsite that needs refactoring, not just `session.rs`.
The session discovery functions in `session.rs` already take `project_dir: &Path` as input: they do not need a `claude_home` parameter.
What needs parameterization is `resolve_session_for_pane()` (or a new abstraction layer above it), which currently couples `/proc` walking with `$HOME`-based path construction.
The proposal should specify which functions actually change and how the dependency injection flows from the test harness through the call chain.

### Tier 2C: `/proc` Walking (Same Namespace)

The approach of spawning a child process and walking `/proc` is correct for single-namespace validation.

**[non-blocking]** The example code calls `find_claude_pid(child.id(), |cmdline| cmdline.contains("sleep"))`, but the actual signature is `find_claude_pid(shell_pid: u32) -> Option<u32>` with the "claude" string hardcoded in the implementation.
The example implies a predicate-based API that does not exist.
Either the proposal should note that `find_claude_pid` needs refactoring to accept a predicate, or the test should spawn a process whose cmdline contains "claude" (e.g., a script named `claude-test-dummy`).
The predicate approach is better for testability: recommend specifying it as the refactoring strategy.

### Tier 3A: ProcFs Trait Abstraction

The trait design is clean: 3 methods (`children`, `cmdline`, `cwd`) with `RealProcFs` and `MockProcFs` implementations.

**[non-blocking]** The proposal mentions `children` path at `task/<tid>/children` vs `<pid>/children` as a test scenario.
The current `find_claude_pid` implementation only reads `/proc/{pid}/children` and does not handle the `task/<tid>/children` fallback.
This is a known gap flagged in the analysis report.
The proposal should clarify whether the `ProcFs` trait is expected to abstract over this difference (i.e., `RealProcFs::children()` implements the fallback logic) or whether the fallback is a separate concern.
Recommend making it explicit: the `RealProcFs::children()` should try `/proc/{pid}/task/{pid}/children` as a fallback, and this behavior itself should be tested.

### Tier 3C: PaneResolver Dispatch Tests

**[blocking]** The proposal describes testing a `PaneResolver` trait with `LaceContainerResolver` and `LocalResolver` dispatch variants.
No such trait, enum, or dispatch logic exists in the current codebase.
The current code in `sprack-claude/src/main.rs` uses `find_claude_panes()` which simply filters panes by `current_command.contains("claude")`, followed by `resolve_session_for_pane()` which does a single-strategy `/proc` walk.
There is no resolver dispatch, no `PaneResolver` trait, and no `LaceContainerResolver` vs `LocalResolver` distinction.

This section appears to be testing an abstraction proposed in the process host awareness proposal, not something that exists or is introduced by this proposal.
The proposal should either:
1. Explicitly state that Tier 3C depends on the process host awareness proposal being implemented first and describe the expected interface.
2. Remove Tier 3C and note it as a future addition contingent on resolver dispatch being implemented.

### Tier 4A: TUI Rendering Snapshots

Good approach using `TestBackend` and `insta`.

**[non-blocking]** The example code creates an `App` with `App::new(/* test config */)`, but `App::new()` requires a `Connection` and `Option<String>`.
The test would need an in-memory SQLite DB initialized with `sprack_db::open_db(None)`.
A `test_app()` helper factory should be specified, since most TUI tests will need this boilerplate.

**[non-blocking]** The proposal mentions testing "Inline summaries at each layout tier (Compact, Standard, Wide, Full)" but the current `refresh_from_db()` hardcodes `LayoutTier::Standard` for label construction (see `app.rs` line 137).
TUI snapshot tests at different tiers would need either: (a) a way to override the tier for label building, or (b) acceptance that label content is always Standard-tier while only layout geometry changes per tier.
This interaction should be acknowledged.

### Tier 4B: Input Handling

Correct approach.
`handle_key` and `handle_mouse` are indeed pure state transformations on `App` and are directly testable.
No issues with the strategy.

### Container-Boundary Manual Validation Runbook

Thorough and practical.
The 7-item checklist covers the key scenarios.

**[non-blocking]** Item 6 ("Container restart") is not purely a container-boundary test: it also validates daemon resilience.
This could be tested in-container by simulating DB state transitions (integration row present, then pane disappears, then reappears).
Consider splitting the manual-only aspect (container lifecycle) from the testable aspect (state transition handling).

### Implementation Phases

The three-phase approach is reasonable.

**[non-blocking]** Phase 1 says "Write 3-5 smoke tests per category to validate the mock infrastructure."
With 3 categories (ProcFs trait, tmux socket, claude_home), that is 9-15 tests.
Phase 2 says "~30-40 new automated tests."
The total across all phases comes to ~60-80 new tests.
The proposal should note the estimated total and the expected impact on `cargo test` runtime (the Open Risks section estimates 15-20s for tmux tests alone; the total added time is not estimated).

### Interaction with Other Proposals

The cross-reference table is useful.

**[non-blocking]** The "Process host awareness" row references "PaneResolver dispatch" which, per the Tier 3C finding above, does not exist yet.
This reinforces that Tier 3C is contingent on another proposal.

### Open Risks

Well-identified.
The 5 risks with mitigations are realistic and honest.

**[non-blocking]** Risk 5 (abstraction cost) understates the refactoring scope.
Beyond the `ProcFs` trait (3 methods), the proposal requires parameterizing `tmux_command` (4 functions), adding a `claude_home` injection path through `resolve_session_for_pane`, and potentially adding a predicate to `find_claude_pid`.
The total surface area of production code changes is larger than "narrow."
This is not a reason to avoid the work, but the risk description should be accurate.

## Verdict

**Revise.** The testing strategy is fundamentally sound and well-structured.
Two blocking issues require correction:

1. Tier 3C (PaneResolver Dispatch) tests an abstraction that does not exist in the codebase and is not introduced by this proposal.
2. Tier 2B's refactoring description misidentifies which functions need parameterization: `session.rs` already accepts `&Path`; the real target is `resolve_session_for_pane()` in `main.rs` and its `$HOME` coupling.

Several non-blocking items would improve clarity around the actual scope of production code refactoring required.

## Action Items

1. [blocking] Fix Tier 3C: either mark it as contingent on the process host awareness proposal (with explicit dependency) or remove it from this proposal's scope and note it as future work.
2. [blocking] Fix Tier 2B refactoring description: specify that `resolve_session_for_pane()` in `sprack-claude/src/main.rs` is the function that needs dependency injection for `claude_home`, not the `session.rs` functions which already accept `&Path`. Describe how the injected path flows from test harness through the call chain.
3. [non-blocking] Tier 2A: note that 4 function signatures change (`tmux_command`, `query_tmux_state`, `query_lace_options`, `read_lace_option`), not 2. Add a note about RAII-based tmux server cleanup.
4. [non-blocking] Tier 2C: reconcile the example code's predicate-based `find_claude_pid` API with the actual hardcoded "claude" string. Recommend specifying whether the function will be refactored to accept a predicate.
5. [non-blocking] Tier 3A: clarify whether `RealProcFs::children()` implements the `task/<tid>/children` fallback, and note that this fallback logic should itself be tested.
6. [non-blocking] Tier 4A: acknowledge the `LayoutTier::Standard` hardcoding in `refresh_from_db()` and its impact on tier-specific snapshot tests. Specify a `test_app()` helper pattern.
7. [non-blocking] Open Risks: update Risk 5 to reflect the full scope of production code changes (tmux parameterization, home path injection, potential predicate refactoring).
