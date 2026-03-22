---
review_of: cdocs/devlogs/2026-03-21-sprack-implementation-prep.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-22T03:00:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [self, implementation_review, devcontainer, rust]
---

# Review: sprack Implementation Prep Devlog

## Summary Assessment

The implementation correctly delivers the proposal's core objective: Rust toolchain, tmux, sqlite3, and a Cargo workspace scaffold in the lace devcontainer.
All 11 of 12 test plan items pass (cargo-insta is reasonably deferred).
The implementation surfaced two real issues: one fixed (rustlang group membership) and one pre-existing (SSH port allocation regression).

Two gaps were found during review: missing `Cargo.lock` commit and missing `target/` in `.gitignore`.
Both are now fixed.
Verdict: **Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF and Objective

Clear and accurate.
The BLUF correctly surfaces both the success and the two issues, with appropriate severity distinction.

### Work Log (Phases 1-4)

The phase descriptions are concise and match the actual diffs.
Phase 4 honestly notes that two rebuilds were required.

**Non-blocking:** Phase 2 could note which workspace dependencies each crate declared vs which are workspace-level only (e.g., `tui-tree-widget` and `catppuccin` are workspace-level but not used by any crate yet).
This is fine for a scaffold but worth noting.

### Issues Encountered and Solved

Both issues are well-documented with symptom, root cause, and fix.
The "proper fix (deferred)" note for Issue 1 is valuable: it identifies the architectural solution and traces it to specific functions.

Issue 2's characterization as "pre-existing lace issue" was initially misleading: investigation revealed it is a regression from commit `7f6ca1d` (wezterm-server deletion), not a pre-existing bug.
The devlog should be updated to reflect this.

**Blocking (resolved):** The devlog stated Issue 2 was "pre-existing" but it is actually a regression.
This has been corrected in the conversation context, and a fix is being implemented via the lace-sshd wrapper feature.

### Verification Record

Thorough.
The table format with specific version numbers and PASS/FAIL is clear and auditable.
Container ID is recorded for traceability.

**Blocking (resolved):** `Cargo.lock` was not committed.
For a workspace with binary crates (`sprack`, `sprack-poll`, `sprack-claude`), `Cargo.lock` should be tracked per Rust convention.
Fixed: committed in `ed31aca`.

**Blocking (resolved):** `target/` was not in `.gitignore`.
The build cache (`packages/sprack/target/`, hundreds of files) could be accidentally committed.
Fixed: added `target/` to `.gitignore` in `ed31aca`.

### Proposal Test Plan Checklist

11 of 12 items checked.
Item 10 (cargo-insta) is deferred with clear rationale (compile-from-source time, postCreateCommand is the right venue).

**Non-blocking:** The proposal's Step 3 mentions `rustup component add rust-analyzer`, but the implementation relies on the Rust feature's `profile: "default"` including it.
This worked (rust-analyzer is on PATH), but the deviation from the proposal is not noted in the devlog.

## Verdict

**Accept.**
The implementation delivers what the proposal specified.
The two blocking issues found during review (Cargo.lock and .gitignore) are resolved.
The SSH port regression is being addressed by a parallel implementation effort (lace-sshd wrapper feature).

## Action Items

1. [resolved] Commit `Cargo.lock` for reproducible builds. Done in `ed31aca`.
2. [resolved] Add `target/` to `.gitignore`. Done in `ed31aca`.
3. [non-blocking] Update devlog Issue 2 to characterize as regression from `7f6ca1d`, not "pre-existing."
4. [non-blocking] Note in devlog that rust-analyzer was included via `profile: "default"` rather than explicit `rustup component add` as proposed.
5. [non-blocking] Consider noting which workspace dependencies are currently unused scaffolding vs actively consumed.
