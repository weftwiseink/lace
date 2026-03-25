---
review_of: cdocs/proposals/2026-03-24-sprack-tmux-ipc-migration.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T14:00:00-07:00
task_list: terminal-management/sprack-tmux-ipc
type: review
state: live
status: done
tags: [fresh_agent, architecture, tmux, correctness, dependency_evaluation]
---

# Review: Sprack Tmux IPC Migration

## Summary Assessment

This proposal migrates sprack-poll's tmux interaction from raw `Command::new("tmux")` with `||`-delimited format string parsing to `tmux-interface-rs`, fixing a correctness issue where user-chosen names containing `||` break parsing.
The document is thorough, well-structured, and demonstrates strong alignment with the existing codebase.
The most important finding is that the proposal's claim about the current delimiter (stating it uses `||`) does not match the actual codebase, which uses `||` but has a comment about unit separators: the proposal should verify this is not a documentation mismatch.
The evaluation plan and fallback strategy are well-considered, and the phased migration path is sound.
Verdict: **Revise** to address a small number of accuracy and completeness issues.

## Section-by-Section Findings

### BLUF

Well-written and comprehensive.
Covers the what (migrate to tmux-interface-rs), the why (delimiter collision correctness), the scope (both sprack-poll and TUI), and the explicit deferral of control mode with reasoning.
No issues.

### Objective

Clear and well-scoped.
The statement "No async runtime is introduced" is an important constraint that is substantiated later.

### Recommended Approach

**Non-blocking**: the numbered rationale for choosing Approach A is strong.
The reasoning is sound: polling works at this scale, the real problem is correctness, and control mode adds complexity without proportional benefit.
The NOTE about when control mode becomes valuable is well-placed.

One minor observation: the proposal references "Approach C" (hybrid) without ever defining approaches B or C formally.
The reader can infer Approach B is pure control mode and Approach C is hybrid, but explicitly naming them would improve readability.
Since this is a proposal for Approach A, this is a minor clarity issue rather than a gap.

### tmux-interface-rs Evaluation Plan

**Non-blocking**: the evaluation plan is methodical.
The acceptance criteria are specific and testable.
The fallback approaches are well-defined, with the single-field-per-call pattern being a particularly good fallback since it eliminates delimiters by construction.

**Non-blocking**: Step 5 ("Test against the tmux version in the dev container") should specify the expected tmux version for the record.
The devcontainer's tmux version is a known quantity; pinning it here aids future readers.

### Control Mode Analysis

Thorough and honest analysis.
The observation that control mode notifications carry minimal data (requiring supplementary queries anyway) is a strong argument for deferral.
The "When to Pursue" conditions are specific and measurable.
No issues.

### Architecture

**Blocking**: the proposal states sprack-poll uses `||` (double pipe) as the delimiter, and the `TMUX_FORMAT` constant in the codebase confirms this.
However, the module-level doc comment in `tmux.rs` says "unit-separator-delimited format string," which contradicts the actual `||` delimiter in the code.
The proposal should note this doc comment discrepancy and fix it as part of the migration (or note that it was an earlier version that used unit separators before switching to `||`).
This is blocking because a reviewer or implementer following the codebase doc comments would be confused about what delimiter is actually in use.

> NOTE(opus/sprack-tmux-ipc): Reading the codebase more carefully, the module doc says "unit-separator-delimited" but the code uses `||`.
> The `TMUX_FORMAT` comment explains the rationale: "tmux 3.3a converts non-printable characters (including `\x1f`) to underscores."
> So the doc comment is stale.
> This is a pre-existing bug, not introduced by the proposal, but the migration should fix it.

**Non-blocking**: the Mermaid diagram is clear and communicates the before/after well.
The "Key changes" list is specific enough to act on.

### Hash-Based Change Detection

**Non-blocking**: the recommendation to derive `Hash` on snapshot types (option 1) is correct and cleaner than string serialization.
The observation about eliminating false positives from whitespace differences is a real benefit.

One consideration: `DefaultHasher` is not guaranteed to be deterministic across Rust compiler versions or platforms.
For change detection within a single process run, this is fine (which is exactly how sprack-poll uses it).
But if hashes were ever persisted to disk or compared across processes, this would be a problem.
The current design does not persist hashes, so this is not an issue, but worth a brief note in the proposal.

### sprack TUI Integration

**Non-blocking**: the NOTE about verifying command chaining support is appropriate.
The fallback (separate library calls) is acceptable and the latency argument is convincing.

### Delimiter Safety

Clean section.
The argument is sound: either the library handles delimiter choice internally, or the single-field-per-call fallback eliminates delimiters entirely.
No issues.

### SIGUSR1 Hook Interaction

**Non-blocking**: this section correctly identifies that the signal mechanism is orthogonal to the tmux interaction layer.
The forward-looking note about SIGUSR1 hooks becoming redundant under control mode is helpful.

### Async Runtime Decision

Clear and well-reasoned.
The statement "Adding tokio for synchronous subprocess calls would be pure overhead" is correct.
No issues.

### Migration Path

**Non-blocking**: Step 2 says "Update `diff.rs` accordingly" but does not specify what changes are needed.
Looking at the codebase, `diff.rs` has `compute_hash(data: &str) -> u64` which hashes a string.
The migration to struct hashing would require either:
(a) changing `compute_hash` to accept `&TmuxSnapshot` (requires `Hash` derive), or
(b) adding a new function like `compute_snapshot_hash(&TmuxSnapshot) -> u64`.
The proposal should specify which approach and how `main.rs` changes (it currently passes `&raw_output` to `compute_hash`).

**Non-blocking**: the proposal says Step 2 "is independent of the tmux-interface-rs migration and can land first."
This is partially true: the `Hash` derive can land first, but actually using struct hashing requires that `query_tmux_state()` returns a `TmuxSnapshot` instead of a raw string.
Currently `query_tmux_state()` returns `Result<String, TmuxError>`, and `main.rs` hashes the raw string before calling `parse_tmux_output()`.
If Step 2 lands before Step 3, the hashing would need to happen after parsing (i.e., hash the parsed struct), which means `parse_tmux_output()` runs on every cycle regardless of whether state changed.
This is a minor efficiency regression (parsing ~dozens of lines is fast), but the proposal should acknowledge it.

### Lace Option Queries

Clean section.
The TODO about batching at scale is well-placed.
The observation that control mode does not provide option-change notifications is important context.

### TUI Commands

No issues.
The rationale for consistency is sound.

### Implementation Phases

Clean three-phase structure.
The outcomes are clearly stated.

### Test Plan

**Non-blocking**: the comparison test ("runs both old and new query paths against the same tmux server and asserts output equivalence") is a strong verification approach.
Consider keeping the old code behind a feature flag during the transition to enable this comparison test, then removing it after validation.

### Open Risks

**Non-blocking**: Risk 2 mentions "latest version 0.3.2" for tmux-interface-rs.
The proposal should verify this version number is current at implementation time.
Crate version numbers change; the risk assessment should be about the maintenance trajectory (commit frequency, issue response time) rather than a snapshot version number.

**Non-blocking**: Risk 4 correctly identifies that the hash migration causes a one-time full rewrite.
The "benign: the DB write is idempotent" reasoning is sound.

## Verdict

**Revise**.
One blocking issue to resolve:

1. The codebase's `tmux.rs` module doc comment says "unit-separator-delimited" while the code uses `||`.
   The proposal should acknowledge this pre-existing doc comment discrepancy and include fixing it as part of the migration scope (Step 3).

The remaining findings are non-blocking suggestions that would improve clarity.

## Action Items

1. [blocking] Acknowledge the stale module doc comment in `sprack-poll/src/tmux.rs` (says "unit-separator-delimited" but code uses `||`) and include fixing it in the migration scope. This is a pre-existing issue, but the proposal should own it since the migration touches this exact code.
2. [non-blocking] Specify what changes `diff.rs` needs in Step 2: either modify `compute_hash` to accept `&TmuxSnapshot` or add a new `compute_snapshot_hash` function. Show how `main.rs` changes from hashing the raw string to hashing the parsed struct.
3. [non-blocking] Acknowledge that Step 2 (struct hashing) landing before Step 3 means parsing runs on every cycle (minor efficiency regression), or reorder to make Step 2 and Step 3 land together.
4. [non-blocking] Pin the devcontainer's tmux version in the evaluation plan (Step 5) for future reference.
5. [non-blocking] Briefly note that `DefaultHasher` is not cross-process-stable (irrelevant for current design, but useful context for future readers).
6. [non-blocking] Consider naming Approaches B and C explicitly in the "Recommended Approach" section for clarity, even though only A is recommended.
7. [non-blocking] Frame Risk 2 (tmux-interface-rs maintenance) around maintenance trajectory rather than a snapshot version number.
