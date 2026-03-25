---
review_of: cdocs/proposals/2026-03-25-sprack-render-testability.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:00:00-07:00
task_list: terminal-management/sprack-render-testability
type: review
state: live
status: done
tags: [fresh_agent, test_plan, ratatui, architecture, verifiability]
---

# Review: sprack Render Testability

## Summary Assessment

This proposal addresses a genuine gap in sprack's test coverage: 119 existing tests but zero that exercise the render pipeline, which let three data-flow bugs ship undetected.
The technical approach is sound overall.
The core design decision (in-memory SQLite over a mock `App`) is well-reasoned and correctly targets the exact pipeline that was broken.
The proposal has two non-trivial technical inaccuracies in the test plan (tier width mismatches) and one underspecified area (how to access `refresh_from_db` for test construction), but these are tractable issues that do not require rethinking the approach.

Verdict: **Revise** - fix the tier width discrepancy and clarify the `test-support` feature gate mechanism before implementation.

## Section-by-Section Findings

### Frontmatter

**Non-blocking.** `first_authored.by` uses `@claude-opus-4-6` which is an abbreviated model name rather than the full API-valid model name specified by the frontmatter spec (e.g., `@claude-opus-4-6-20250116`).
The proposal also lacks a `last_reviewed` field, which is expected since it has not been reviewed before.

### BLUF

Well-constructed.
Establishes the problem (119 tests, zero render tests, three undetected bugs), the solution (insta + TestBackend snapshots, `--dump-rendered-tree` CLI flag), and the scope clearly.
No surprises when reading the full document.

### Background

Clearly connects this proposal to the parent verifiability strategy and the specific bugs that motivated it.
The three bugs are correctly characterized as data-flow issues in the DB-to-render pipeline.

### Proposed Solution - Feature 1: TestBackend + insta Snapshot Tests

**Non-blocking.** The tier widths in the test plan table (25, 50, 80, 120 cols) do not correspond to the actual `layout_tier` breakpoints in `layout.rs`:
- Compact: <30 cols (25 cols is correct for Compact)
- Standard: 30-59 cols (50 cols is correct for Standard)
- Wide: 60-99 cols (80 cols is correct for Wide)
- Full: 100+ cols (120 cols is correct for Full)

The column values chosen happen to work, but the proposal table says the detail panel appears at "Full (120 cols)" which is correct, while also saying "Wide (80 cols) - No" for detail panel, which is also correct.
However, the proposal's step 4 says "Create a `Terminal<TestBackend>` at a specific width/height" without noting that the actual rendered labels are hardcoded to `LayoutTier::Standard` at `refresh_from_db` time (which is correctly noted later in the "Important Design Decisions" section, but the implications for the test matrix are not reflected back into the test plan table).

### Proposed Solution - Feature 2: `--dump-rendered-tree` CLI Flag

**Non-blocking.** The proposal says `render_once_to_stdout` should create `Terminal<TestBackend>::new(cols, rows)`, but the actual API is `Terminal::new(TestBackend::new(cols, rows))`.
This is a minor notation issue since the type annotation `Terminal<TestBackend>` is used as a description rather than literal code, but could cause confusion during implementation.

**Non-blocking.** The proposal does not address what happens when `--dump-rendered-tree` is used without `--db-path` and no database exists at the default path.
Currently, `open_or_wait_for_db` starts the poller daemon and waits up to 5 seconds, which would be undesirable behavior for a one-shot render command.
The proposal should specify that `--dump-rendered-tree` requires `--db-path` or should have a fast-fail path when the default DB does not exist.

### Important Design Decisions

#### In-memory SQLite over `App::new_for_test`

Strong rationale.
The analysis correctly identifies that the bugs were in the pipeline, not in the rendering functions themselves, and that option (b) exercises that pipeline.

#### `open_test_db` accessibility

**Blocking.** The proposal identifies the problem correctly (`#[cfg(test)]` items are crate-private) but offers two solutions without committing to one: (a) expose via `test-support` feature flag, or (b) duplicate the 4-line helper.
The `test-support` feature flag approach is preferred but requires careful Cargo.toml wiring.
Specifically: `sprack` would need `sprack-db = { path = "../sprack-db", features = ["test-support"] }` under `[dev-dependencies]` (not `[dependencies]`), and the regular `[dependencies]` entry must remain without the feature.
This dual-dependency pattern (one entry in `[dependencies]`, another in `[dev-dependencies]` with additional features) is standard Rust practice, but the proposal does not specify this wiring.

Alternatively, since the helper is literally 4 lines, duplication is the simpler path and avoids feature flag complexity.
The proposal should pick one approach and specify the Cargo.toml changes.

#### `refresh_from_db` visibility

The proposal correctly identifies that `refresh_from_db` is private and needs to become `pub(crate)`.
This is accurate: the current code has `fn refresh_from_db(&mut self) -> Result<()>` with no visibility modifier.

#### `buffer_to_string` helper

Verified correct against ratatui 0.28.1's API.
`Buffer` implements `Index<P: Into<Position>>` and `(u16, u16)` implements `Into<Position>`, so `buffer[(x, y)]` compiles.
`Cell::symbol()` returns `&str`, confirmed.

The NOTE about stripping ANSI styling is appropriate.
Plain-text snapshots are sufficient for the stated goal (data-flow regression detection).

#### `--dump-rendered-tree` does not start the event loop

Clean separation.
The listed constraints (no raw mode, no heartbeat, single point-in-time) are all correct consequences of the design.

### Test Plan - Snapshot Tests

**Non-blocking.** The "Selected node highlighting" test says "Assert: the selected pane has highlight styling applied."
Since `buffer_to_string` strips styling, this assertion cannot be verified with plain-text snapshots.
The proposal should either note this limitation or specify a style-aware assertion for this specific test.

**Non-blocking.** The "Stale poller indicator" test sets `poller_healthy = false` on the App.
This requires direct field assignment on `App`, which is fine since all fields are `pub`.
However, the test should also verify the "stale" variant (where `last_heartbeat` is `Some(...)` but `poller_healthy` is false), not just the "not started" variant.
The proposal mentions both `"[poller: not started]"` and `"[poller: stale ...]"` but does not distinguish them as separate test cases.

**Non-blocking.** The test plan does not include a test for the multi-line "rich widget" rendering path (`format_rich_widget`), which is triggered when `tasks` or `session_summary` is present in the `ClaudeSummary`.
This is a significant rendering code path at `Wide`/`Full` tiers.
Adding a test case that includes tasks and session_summary data would improve coverage of this branch.

### Test Plan - `--dump-rendered-tree` Tests

Adequate for the feature's scope.
The integration test with `--db-path <test-db>` is the right approach.

### Verification Methodology

Step 4 (re-introduce a bug and verify test failure) is a strong validation technique.
This directly demonstrates the proposal's core value proposition.

### Implementation Phases

**Non-blocking.** Phase 1 Task 1 says `insta = { workspace = true }`.
The workspace `Cargo.toml` declares `insta = "1"` and `sprack-db` already has `insta` as a dev-dependency.
However, the `sprack` crate's `Cargo.toml` does not currently have a `[dev-dependencies]` section at all.
The proposal should note that a `[dev-dependencies]` section must be added.

Phase 1 Task 3 says to create `crates/sprack/src/test_render.rs` as a `#[cfg(test)]` module.
This file would need to be declared in `main.rs` (or `lib.rs`, but sprack is a binary crate) with `#[cfg(test)] mod test_render;`.
Since sprack is a binary crate (`main.rs`), adding test modules requires this declaration.

Phase 2 success criteria are clear and verifiable.

### Writing Conventions Compliance

**Non-blocking.** The document generally follows writing conventions well: BLUF is present, sentence-per-line formatting is mostly observed, no emojis.
A few sentences run long (particularly in the "Important Design Decisions" section) but are not egregious.
No em-dashes detected; colons are used appropriately.

One minor violation: the phrase "Two approaches were considered" in the design decisions section uses past tense framing rather than present tense.
Per the history-agnostic framing rule, this should be phrased as "Two approaches exist" or similar.

## Verdict

**Revise.**

The proposal is technically solid and addresses a real testing gap.
The TestBackend + insta approach is correct for ratatui 0.28.1.
The in-memory SQLite design decision is the right call.
However, the `open_test_db` accessibility mechanism needs a definitive choice (feature flag vs. duplication) with the corresponding Cargo.toml changes specified, since this is a prerequisite the implementer will hit immediately.

## Action Items

1. [blocking] Choose and specify the `open_test_db` accessibility mechanism: either commit to the `test-support` feature flag with the exact `[dependencies]` / `[dev-dependencies]` Cargo.toml entries for both `sprack-db` and `sprack`, or commit to duplicating the helper.
2. [non-blocking] Add a test case for the `format_rich_widget` multi-line rendering path (pane with `tasks` and `session_summary` in `ClaudeSummary` at Wide/Full tier).
3. [non-blocking] Note that the "Selected node highlighting" test cannot verify styling with plain-text snapshots; either add a style-aware assertion or adjust the test description.
4. [non-blocking] Split the stale poller test into two cases: `last_heartbeat = None` (not started) and `last_heartbeat = Some(...)` with `poller_healthy = false` (stale).
5. [non-blocking] Specify behavior of `--dump-rendered-tree` when no `--db-path` is provided and the default database does not exist (fast-fail vs. poller startup).
6. [non-blocking] Note that a `[dev-dependencies]` section must be added to `crates/sprack/Cargo.toml` and a `#[cfg(test)] mod test_render;` declaration added to `main.rs`.
7. [non-blocking] Fix past-tense framing in the design decisions section ("Two approaches were considered" should use present tense per history-agnostic convention).
