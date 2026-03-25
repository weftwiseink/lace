---
review_of: cdocs/proposals/2026-03-24-sprack-claude-incremental-session-cache.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:00:00-07:00
task_list: terminal-management/sprack-claude-session-cache
type: review
state: live
status: done
tags: [fresh_agent, architecture, sprack, sqlite, incremental, test_plan]
---

# Review: Sprack-Claude Incremental Session Cache

## Summary Assessment

This proposal addresses a real and well-understood problem: sprack-claude's tail-reading approach discards session history every poll cycle, producing thin summaries that miss conversation structure, cumulative tool usage, and context trends.
The proposed solution, a lightweight SQLite session cache with byte-offset tracking, is well-scoped and grounded in the existing codebase.
The schema design is sound and the incremental ingestion approach directly extends the existing `incremental_read` function in `jsonl.rs`.

The most important finding is that the workspace-path session resolution section conflates the pane's `current_path` with the session's `lace_workspace` in a way that obscures the actual lookup mechanics, and the `isCompactSummary` handling is claimed as a requirement but is not fully specified.

**Verdict: Revise.** Two blocking issues and several non-blocking improvements.

## Section-by-Section Findings

### BLUF

Clear and accurate.
Correctly positions the proposal as a subset of the full mirror RFP, not a full mirror.

### Relationship to the Full Mirror RFP

The comparison table is effective.
The framing as "what the mirror RFP calls 'intermediate layer'" is grounded: the mirror RFP's section on sprack-claude integration explicitly describes this role.

One concern: the claim "the full mirror can later wrap this cache's `ingestion_state` table to avoid re-parsing bytes" is aspirational but assumes the full mirror will share the same database file or have cross-DB access.
If the full mirror uses a separate `claude-mirror.db` (as the RFP's open question #1 suggests), the `ingestion_state` table would need to be migrated or the full mirror would maintain its own byte offsets.
This is non-blocking but the dependency should be explicit.

### Objective

The six objectives are concrete and testable.
Each maps to a specific schema table or code change.

### Schema Design

The schema is well-designed for the stated purpose.

**`ingestion_state`**: appropriate. The `file_size` column for rotation detection is a good addition over the in-memory `position` variable in `jsonl::incremental_read`.

**`session_metadata`**: mostly sound, but `last_context_pct` stores only the most recent value as an integer.
The `context_history` table stores the per-message series.
This is slightly redundant: `last_context_pct` could be derived from the most recent `context_history` row.
Non-blocking, but worth noting that the redundancy is intentional (avoids a join on every poll cycle for the summary).

**`tool_usage`**: clean. The composite primary key is correct.

**`context_history`**: the NOTE about compaction for long sessions is honest.
The `(session_id, recorded_at)` primary key uses a timestamp string, which is slightly fragile for ordering guarantees if two assistant messages share the same second.
A sequence number or rowid-based ordering would be more robust.
Non-blocking.

**`subagent_tracking`**: the `tool_use_id` column name is overloaded.
In the JSONL, `toolUseID` on `agent_progress` entries refers to the tool call that *spawned* the subagent, while `parentToolUseID` on sidechain entries refers to the *parent's* tool call.
These are the same ID, but the proposal's data source section (Subagent Tracking) uses both without clarifying they refer to the same edge.
Ensure the schema documentation makes this relationship explicit.

### Incremental Reading

The pseudocode is clear and matches the existing `incremental_read` semantics well.

**Blocking issue**: the "Current approach (replaced)" section describes the tail-reading behavior using history-agnostic framing ("replaced"), but then says "Problems: re-reads the same 32KB every cycle, loses all history beyond the tail window, restarts from scratch on process restart."
This framing is fine for a proposal, but the section heading says "(replaced)" which implies it has already been replaced.
Per writing conventions, the proposal should frame this as the current state and describe the cache approach as the proposed design, not imply a transition has already happened.

> NOTE(opus/review): The heading "Current approach (replaced)" is ambiguous: it could mean "this is what is being replaced" or "this was already replaced."
> Reframing as "Current approach" with the cache approach as "Proposed approach" would be clearer.

**First-read bootstrap**: the WARN callout about latency is appropriate.
However, the proposal does not specify what happens to the poll cycle during bootstrap.
If a 10MB file takes 100-500ms to parse, does the poll cycle block?
The 2-second poll interval has some headroom, but bootstrapping multiple large sessions simultaneously could exceed it.
Non-blocking, but the mitigation (background thread) should be mentioned as a phase 1 concern, not deferred.

### Session Discovery Without /proc

**Blocking issue**: the workspace-path resolution step 1 says "Read `lace_workspace` from the session record."
In the codebase, `lace_workspace` is a field on `sprack_db::types::Session`, not on `sprack_db::types::Pane`.
The `Pane` struct has `session_name` which can be used to look up the parent session, but the proposal describes this as if `lace_workspace` is directly available from the pane.
The resolution path needs to explicitly state: "look up the pane's parent session via `pane.session_name`, read `session.lace_workspace`."

Step 2 says "Combine with `pane.current_path` to get the effective cwd."
This is underspecified.
`pane.current_path` for a container pane reflects the path *inside the container* (e.g., `/workspaces/lace/main`), while `lace_workspace` is the container's workspace root (e.g., `/workspaces/lace`).
The "combining" step needs to explain what it means: is `pane.current_path` used directly as the cwd for encoding, or is it combined with `lace_workspace` in some way?
Looking at the existing `encode_project_path` usage, it takes the Claude process's cwd directly.
For container panes, the pane's `current_path` *is* the effective cwd (it reflects the container-side path), so step 2's "combine" language is misleading: `pane.current_path` should be used directly as the cwd to encode, and `lace_workspace` is only needed to *identify* this as a container pane (not for path construction).

Step 4 says "Look up `~/.claude/projects/<encoded_path>/` on the host filesystem (accessible via the bind mount)."
This assumes `~/.claude` is bind-mounted from the host, which is stated as risk #5.
But the proposal does not specify *whose* `~/.claude` is being accessed.
For container panes, the Claude Code process's `~/.claude` is inside the container.
The session files need to be accessible from the host where sprack-claude runs.
This requires the bind mount to expose the container's `~/.claude/projects/` to the host.
The proposal should specify the expected mount path or explain how the host-side path is derived.

### Subagent Tracking

The three-source ingestion model (agent_progress, sidechain assistant, completion detection) is correct and matches the JSONL structure visible in `jsonl.rs`.

The NOTE about completion detection being imperfect is honest.
The staleness heuristic (60 seconds) is a reasonable fallback.

### Integration with sprack-claude Main Loop

The modified poll cycle pseudocode is clear.
The `ClaudeSummary` changes are backward-compatible via `Option` types.

One observation: `tool_counts: Option<HashMap<String, u32>>` will serialize as a JSON object inside the summary JSON column.
The TUI will need to handle this nested object.
This is fine but should be mentioned in the TUI backward compatibility risk.

### Module Structure

The `cache.rs` module boundary is clean.
Preserving `jsonl.rs` for file reading and adding `cache.rs` for SQLite persistence follows good separation of concerns.

### Extensibility Toward Full Mirror

The four extension points (messages, content blocks, FTS5, standalone daemon) are credible.
The claim "no existing columns need renaming or type changes" is supportable given the schema design.

### Separate DB Recommendation

The four reasons (write contention, size trajectory, failure isolation, independent lifecycle) are well-argued.
This directly answers open question #1 from the full mirror RFP.

### Implementation Phases

Three phases is appropriate.
Phase 1 (populate but don't consume) is a good de-risking strategy.
Phase 2 (cache-backed summaries) is the value delivery.
Phase 3 (subagent lifecycle and context trends) is additive.

### Test Plan

Comprehensive.
The nine test categories cover the critical paths.
The "concurrent access" test is particularly valuable for validating WAL mode behavior.

### Open Risks

Risk #3 (compact summary entries) is the most concerning.
The proposal acknowledges that `JsonlEntry` does not parse `isCompactSummary`, but does not specify the fix.
The ingestion logic depends on skipping these entries to avoid double-counting.
This should be addressed in phase 1: add `is_compact_summary: Option<bool>` to `JsonlEntry` and filter during ingestion.

Risk #4 (multiple sessions per file) is real.
The "use the most recent one and log a warning" approach loses data from earlier sessions in the file.
For the session cache's purposes (real-time status), this is acceptable, but it should be noted as a limitation that the full mirror must handle differently.

## Verdict

**Revise.** The proposal is technically sound and well-scoped, but has two blocking issues that need resolution before implementation.

## Action Items

1. [blocking] Clarify the workspace-path resolution section: explicitly state that `lace_workspace` is looked up via `pane.session_name -> Session.lace_workspace`, not directly from the pane. Specify whether `pane.current_path` is used directly as the cwd to encode (likely yes), and remove the ambiguous "combine" language. Address how the host accesses container-side `~/.claude/projects/` (bind mount path specifics or a reference to the process-host-awareness proposal for this detail).
2. [blocking] Specify the `isCompactSummary` handling concretely: add `is_compact_summary` field to `JsonlEntry` struct in `jsonl.rs`, and describe the filtering logic in the ingestion pipeline. This is a prerequisite for correct turn/token counting and should be part of phase 1.
3. [non-blocking] Reframe the "Current approach (replaced)" heading to "Current approach" to avoid implying the transition has already happened. The cache approach section can remain as "Proposed approach" or "Cache approach."
4. [non-blocking] Add a note about poll cycle blocking during first-read bootstrap, especially for the scenario where multiple large session files are discovered simultaneously. Consider mentioning whether phase 1 should include async/threaded bootstrap or whether the blocking behavior is acceptable.
5. [non-blocking] Clarify in the `ingestion_state` / full mirror extensibility section that the full mirror sharing this table requires either co-locating in the same DB file or a migration strategy. The current framing assumes seamless sharing without addressing the separate-DB boundary.
6. [non-blocking] Consider using an integer sequence number instead of timestamp string for the `context_history` primary key to avoid ordering ambiguity when two assistant messages share the same second.
