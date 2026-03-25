---
review_of: cdocs/proposals/2026-03-24-sprack-process-host-awareness.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T15:30:00-07:00
task_list: terminal-management/sprack-process-host-awareness
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, cross_container, implementation_detail]
---

# Review: sprack Process Host Awareness

## Summary Assessment

This proposal addresses a real and well-characterized problem: sprack-claude cannot observe Claude Code instances running inside lace containers because `/proc` walking does not cross PID namespace boundaries.
The proposed `PaneResolver` trait with `LocalResolver` (existing `/proc` walk) and `LaceContainerResolver` (metadata + bind mount + mtime heuristic) is architecturally sound and appropriately scoped.
The proposal demonstrates strong understanding of the problem space, supported by two thorough companion reports.
Three blocking issues require resolution: the proposal contradicts the container boundary analysis without acknowledging the shift in deployment model assumptions, the `find_claude_panes` broadening logic has a correctness gap for the `DbSnapshot` join, and the `SessionFileState` refactoring needs more detail on backward-compatible cache invalidation.
Verdict: **Revise**.

## Section-by-Section Findings

### BLUF

The BLUF is clear, concise, and covers the key design decisions.
It correctly highlights that SSH probe is deferred.
**Non-blocking:** The BLUF mentions "no schema changes are required" but the Pane-Level vs Session-Level Metadata section discusses adding pane-level option reads to sprack-poll and storing overrides in an in-memory map.
This is not a schema change per se, but it is a behavioral change to sprack-poll that could be mentioned more precisely.

### Objective

Well-stated.
The five numbered conditions clearly define the deployment topology.
**Non-blocking:** Condition 4 ("the `~/.claude` directory is bind-mounted between host and containers") is a hard prerequisite for the entire design.
The proposal should explicitly state that this design does not degrade gracefully without the bind mount until the "Risk: bind mount not present" section much later.
Consider adding a brief dependency callout here.

### Architecture / Pane Classification

The Mermaid flowchart is clear and correctly shows the dispatch logic.
The classification using `lace_port` presence rather than `current_command: ssh` is the right call, and the NOTE explaining why is well-placed.

**Blocking:** The flowchart and classification logic reference checking `lace_port` on the pane, but the `Pane` struct in `sprack_db::types` has no `lace_port` field.
The lace metadata lives on the `Session` struct.
The proposal acknowledges this in the "Pane-Level vs Session-Level Metadata" section (recommending session-level reads for Phase 1), but the flowchart and classification text say "Pane has lace metadata?" which is misleading.
The flowchart should reflect the actual Phase 1 logic: check the pane's parent session for `lace_port`.

### Candidate Pane Discovery

**Blocking:** The proposal says `find_claude_panes` broadens to "also include panes whose parent session (or the pane itself) has `lace_port` set."
The current implementation in `main.rs` (line 83-97) reads a `DbSnapshot` via `read_full_state` and filters `snapshot.panes`.
But `snapshot.panes` is a `Vec<Pane>`, and `Pane` has `session_name` but no direct access to the parent `Session`'s `lace_port`.
The proposal needs to specify how this join is performed: iterate `snapshot.sessions` to build a `HashSet<String>` of lace session names, then filter panes whose `session_name` is in that set OR whose `current_command` contains "claude".
This is straightforward but the proposal should describe it explicitly because the current code does not have this join pattern.

### PaneResolver Trait

The trait design is clean.
The `ResolvedSession` struct with a polymorphic `cache_key: String` is a reasonable approach.

**Non-blocking:** The `resolve` method takes `&[Session]` as a parameter, which means the caller must pass the sessions list into every resolve call.
An alternative is to inject the sessions at resolver construction time (e.g., `LaceContainerResolver::new(session: &Session)`), which is slightly cleaner since the resolver only needs the one session associated with the pane.
This is a minor API design point, not blocking.

### LocalResolver

Correctly wraps existing logic.
No issues.

### LaceContainerResolver

The mtime-based session file discovery is well-reasoned and the code sample is clear.

**Non-blocking:** The 60-second mtime threshold for cache invalidation (line 105-106) is mentioned but not justified.
Why 60 seconds and not 30 or 120?
Claude Code writes to the session file on every tool use and assistant message, which at normal operating cadence means writes every few seconds.
60 seconds seems generous.
Consider documenting the rationale or making it configurable.

### Session File Discovery

The prefix-matching enumeration is the right approach.
The code sample is clear and correct.

**Non-blocking:** The `encode_project_path` function in `proc_walk.rs` (line 61-64) replaces all `/` with `-`.
The proposal correctly uses this for prefix construction.
However, the proposal should note that this encoding is not bijective: `/workspaces/lace-main` and `/workspaces/lace/main` would both encode to `-workspaces-lace-main`.
In practice this collision is extremely unlikely (workspace roots do not contain hyphens in the directory name in the lace convention), but it is worth a NOTE callout for completeness.

### Handling Multiple Worktrees

The analysis is correct for the common case.
The mtime heuristic selecting the most recently active session is reasonable.

**Non-blocking:** The proposal claims "a single pane runs a single Claude instance, and that instance's session file is the most recently modified one under that pane's workspace prefix."
This is true, but the resolver does not actually verify that the session file belongs to the specific pane.
If two lace panes connect to the same container (via `lace-into --pane` into the same session), both would resolve to the same most-recent session file.
This is acknowledged as a theoretical edge case in the NOTE, which is sufficient.

### Pane-Level vs Session-Level Metadata

The phased approach (Phase 1: session-level only, Phase 2: pane-level) is pragmatic.

**Non-blocking:** The "supplementary in-memory map" approach for Phase 2 pane-level overrides adds complexity without persistence.
If sprack-poll restarts, the overrides are lost until the next poll cycle re-queries tmux.
This is fine given the 2-second poll interval, but worth noting.

### SSH Probe (Strategy 4B)

Correctly deferred.
The security and performance analysis is thorough.

**Non-blocking:** The SSH command shown uses `pgrep -n claude` which returns the newest matching process.
If multiple Claude instances run in the container, this returns only one.
Since the probe is deferred, this is not blocking, but the limitation should be documented when the probe is eventually implemented.

### Schema Changes

The claim "none required" is correct for Phase 1.
The NOTE about future pane-level columns is appropriate.

### Implementation Phases

The three phases are well-structured and appropriately scoped.

**Blocking:** Phase 1 step 4 says "Extract `find_via_jsonl_listing` as a public function for use by `LaceContainerResolver`."
Currently `find_via_jsonl_listing` in `session.rs` (line 107) is a private function.
The proposal should clarify that `LaceContainerResolver` should call `find_session_file` (the public entry point), not `find_via_jsonl_listing` directly.
The issue is that `find_session_file` tries `sessions-index.json` first, and the proposal explicitly states that the container resolver should skip `sessions-index.json`.
So the proposal needs to either:
(a) Extract `find_via_jsonl_listing` as public (as stated), or
(b) Add a new public function like `find_session_file_by_mtime` that skips the index.
Option (a) is fine but the proposal should explain *why* the container resolver cannot use `find_session_file`: because `sessions-index.json` contains container-internal `fullPath` entries that do not resolve on the host.
This rationale exists in the NOTE on line 108-109 but should be elevated to the implementation step itself.

### Test Plan

The test plan is comprehensive for a proposal.
Unit tests, integration tests with mock filesystem, and manual verification are all appropriate.

**Non-blocking:** The unit test for "Prefix encoding" says to test that `encode_project_path("/workspaces/lace")` produces `-workspaces-lace`.
This test already exists in `proc_walk.rs` for `/workspaces/lace/main`.
The suggestion to add the workspace-root case (without trailing subdirectory) is good but should acknowledge the existing tests.

### Open Risks and Mitigations

The four risks are well-identified and mitigations are appropriate.

**Non-blocking:** The "prefix matching returns stale directories" mitigation suggests a 5-minute recency threshold.
The proposal should specify whether this threshold applies only to the `LaceContainerResolver` or also to the `LocalResolver`.
Since `LocalResolver` uses PID-based validation (process alive), the threshold is container-specific.
Make this explicit.

## Deployment Model Contradiction

**Blocking:** The container boundary analysis report concludes "do not pursue host-side sprack-claude" and "the only viable architecture is running all sprack components inside the container."
This proposal takes the opposite position: sprack-claude runs on the host and reaches into containers via the bind mount.
The proposal references the boundary analysis in its problem report but does not explicitly acknowledge or rebut its conclusion.

The deployment model shift is justified (the user's actual setup has tmux on the host, not in the container), and the problem report's Section 5 ("Which Deployment Model is Actual?") explains why.
But the proposal itself should include a brief section or NOTE acknowledging that the container boundary analysis reached a different conclusion, and why this proposal's approach is valid despite that: the bind mount provides file-level access without needing `/proc` traversal, which the boundary analysis did not consider as a standalone strategy.

## Verdict

**Revise.**
The core design is sound and well-analyzed.
Three blocking issues must be addressed:

1. The Mermaid flowchart and pane classification text should reflect Phase 1 reality (session-level `lace_port` check, not pane-level).
2. The `find_claude_panes` broadening must specify the session-to-pane join pattern.
3. Phase 1 step 4 must clarify why `find_via_jsonl_listing` needs to be public (the `fullPath` mismatch) rather than just stating it.
4. The proposal should acknowledge the deployment model shift from the container boundary analysis conclusion.

## Action Items

1. [blocking] Update the Mermaid flowchart decision node from "Pane has lace metadata?" to "Pane's session has lace_port?" to reflect Phase 1 logic.
2. [blocking] In "Candidate pane discovery", specify the join pattern: build a set of lace session names from `snapshot.sessions`, then filter panes by `session_name` membership OR `current_command` containing "claude".
3. [blocking] In Phase 1 step 4, add a sentence explaining that `find_via_jsonl_listing` must be extracted as public because `find_session_file` tries `sessions-index.json` first, whose `fullPath` entries use container-internal paths that do not resolve on the host.
4. [blocking] Add a NOTE callout (in Architecture or Objective) acknowledging that the container boundary analysis recommended all-in-container architecture, and explaining why this proposal takes a different approach: the bind mount allows file-level session discovery without `/proc` traversal, and the user's actual deployment has tmux on the host.
5. [non-blocking] In Objective, add a dependency note that the `~/.claude` bind mount is a hard prerequisite for this design.
6. [non-blocking] Document the rationale for the 60-second mtime cache invalidation threshold in LaceContainerResolver.
7. [non-blocking] Add a NOTE about the non-bijective nature of the path encoding (hyphenated directory names could collide with path separators).
8. [non-blocking] In the stale directory risk mitigation, clarify that the 5-minute recency threshold is container-resolver-specific.
