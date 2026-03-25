---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T18:00:00-07:00
task_list: terminal-management/sprack-proposal-coherence
type: review
state: live
status: wip
tags: [sprack, architecture, cross_review, coherence]
---

# Cross-Coherence Review: Sprack Proposal Set

> BLUF: Six proposals form a coherent improvement arc for sprack, with three integration conflicts requiring resolution and two coordination gaps that need explicit ordering constraints.
> The most significant conflict is between the tmux IPC migration (replaces format string parsing) and layout organization (extends format string to 19 fields): these must be sequenced, not parallelized.
> The session cache and inline summaries proposals both extend `ClaudeSummary` in complementary but uncoordinated ways.
> Overall the proposals are architecturally compatible and no fundamental design conflicts exist.

## Documents Reviewed

| # | Proposal | Key Change |
|---|----------|------------|
| 1 | Process host awareness | PaneResolver trait, LaceContainerResolver via bind mount |
| 2 | Inline summaries | Per-tier format strings, detail pane removed at wide |
| 3 | Layout organization | (pane_top, pane_left) sort, 19-field format string, schema v1 |
| 4 | tmux IPC migration | tmux-interface-rs replaces raw Command + delimiter parsing |
| 5 | Session cache | Separate session-cache.db, incremental JSONL ingestion |
| 6 | Verifiability strategy | ProcFs trait, mock tmux, TestBackend snapshots |

## Integration Conflicts

### Conflict 1: Format String Extension vs IPC Migration [BLOCKING]

**Layout organization** extends the tmux format string from 12 to 19 fields and adds `EXPECTED_FIELD_COUNT = 19`.
**tmux IPC migration** replaces format string parsing entirely with tmux-interface-rs structured queries.

These are incompatible if executed in parallel:
- If layout org lands first, IPC migration must migrate 19 fields (not 12) to tmux-interface-rs queries.
- If IPC migration lands first, layout org's format string extension is irrelevant: the new fields are added as tmux-interface-rs field requests instead.

**Resolution**: Explicit ordering constraint.
Either (a) do layout org first, then IPC migration migrates the 19-field format, or (b) do IPC migration first, then layout org adds new fields via tmux-interface-rs.
Option (b) is cleaner: the IPC migration eliminates the delimiter fragility first, and layout org adds fields through the structured API.
Both proposals should reference this ordering.

### Conflict 2: ClaudeSummary Schema Divergence [NON-BLOCKING]

**Inline summaries** defines format strings for the current `ClaudeSummary` fields: `state`, `subagent_count`, `context_percent`, `last_tool`, `error_message`.

**Session cache** adds new fields to `ClaudeSummary`: `user_turns`, `assistant_turns`, `tool_counts: Option<HashMap<String, u32>>`, `context_trend: Option<String>`.

The inline summaries format strings do not account for these new fields.
Neither proposal references the other's changes to the struct.

**Resolution**: Inline summaries should define format strings for the session cache fields at Wide and Full tiers.
Suggested additions:
- Wide: `{turns}t` after context percentage (e.g., `42% ctx 15t`).
- Full: `{turns}t {tool_counts_summary}` (e.g., `42% ctx 15t R:47 E:12`).
- Context trend indicator: arrow character or keyword in the context percentage display (e.g., `42%^` for rising).

This is non-blocking because the new `ClaudeSummary` fields are `Option` types: the inline summaries code can ignore them until implemented.

### Conflict 3: Duplicate Workspace-Path Resolution Logic [NON-BLOCKING]

**Process host awareness** defines `LaceContainerResolver` with `find_container_project_dir()` for workspace-path-based session discovery.

**Session cache** defines a "Session Discovery Without /proc" section with its own workspace-path resolution logic that overlaps with `LaceContainerResolver`.

Both proposals describe the same mechanism (encode `lace_workspace` prefix, enumerate `~/.claude/projects/`, select by mtime) but with different code locations:
- Process host awareness: `resolve.rs` in sprack-claude.
- Session cache: inline in the modified poll cycle.

**Resolution**: The session cache should explicitly defer to process host awareness for the resolution step.
Its "Session Discovery Without /proc" section should be reframed as "use the PaneResolver from the process host awareness proposal" rather than re-describing the algorithm.

## Coordination Gaps

### Gap 1: Schema Versioning Across Proposals

**Layout organization** introduces `PRAGMA user_version = 1` with drop-and-recreate migration.
**Session cache** creates a separate `session-cache.db` with its own schema.
**Process host awareness** says "no schema changes required."

These are compatible: layout org owns `state.db` versioning, session cache owns `session-cache.db` independently, and process host awareness avoids `state.db` changes.

However, if a future proposal adds pane-level lace columns (process host awareness Phase 2 mentions this possibility), that would require `user_version = 2` for `state.db`.
The layout organization proposal should note that future schema changes will increment `user_version` additively, not reset.

**Status**: No conflict, but worth documenting the versioning convention.

### Gap 2: Verifiability Proposal Dependencies

The verifiability strategy's Tier 3C (PaneResolver dispatch tests) depends on process host awareness.
The verifiability strategy's mock tmux socket parameterization must work with both raw `Command` (current) and `tmux-interface-rs` (post-migration).

Both dependencies are acknowledged in the verifiability proposal with NOTE callouts, but neither the process host awareness nor the tmux IPC migration proposals reference the verifiability strategy's requirements.

**Status**: The verifiability strategy is correctly contingent.
No changes needed, but implementation should coordinate: the ProcFs trait and socket parameterization are shared abstractions that both the feature proposals and test infrastructure consume.

## Architectural Alignment Assessment

### Data Flow Consistency

All proposals maintain the same data flow architecture:

```
tmux -> sprack-poll -> state.db -> sprack TUI
                                -> sprack-claude -> process_integrations -> sprack TUI
                                                 -> session-cache.db (new)
```

No proposal breaks this pipeline.
The session cache adds a new DB but does not alter the existing flow.

### Trait Boundaries

Two new traits are introduced:
- `ProcFs` (verifiability strategy): abstracts `/proc` filesystem access.
- `PaneResolver` (process host awareness): abstracts pane-to-session resolution.

These are complementary: `ProcFs` is consumed by `LocalResolver` (which walks `/proc`), while `LaceContainerResolver` bypasses `/proc` entirely.
The trait boundaries are clean and do not overlap.

### Shared Type: ClaudeSummary

Three proposals touch `ClaudeSummary`:
- **Inline summaries**: reads it in the TUI for format strings.
- **Session cache**: extends it with new fields in sprack-claude.
- **Process host awareness**: does not modify it (produces the same summary format).

`ClaudeSummary` should be defined in one canonical location.
Currently it is defined in `sprack-claude/src/status.rs`.
The inline summaries proposal needs to parse it in the TUI crate, which requires either:
- Re-exporting from `sprack-db` (the shared dependency).
- Adding `sprack-claude` as a dependency of `sprack` (circular risk).
- Defining a separate `ClaudeSummaryView` type in the TUI.

The inline summaries proposal acknowledges this: "Add `serde` and `serde_json` as dependencies to the `sprack` crate, or re-export `ClaudeSummary` from `sprack-db`."

**Recommendation**: Move `ClaudeSummary` to `sprack-db` as the canonical location, since both `sprack-claude` (writes it) and `sprack` TUI (reads it) already depend on `sprack-db`.

## Verdict

**Accept with conditions.**

The proposal set is architecturally coherent.
Three specific actions resolve the identified conflicts:

1. **[BLOCKING]** Add ordering constraint: tmux IPC migration before layout organization, OR layout organization before tmux IPC migration, with explicit cross-references in both proposals.
   Recommended order: layout org first (it is simpler and unblocks TUI improvements), then IPC migration migrates the extended format.

2. **[NON-BLOCKING]** Session cache should defer to process host awareness for workspace-path resolution rather than re-describing it.

3. **[NON-BLOCKING]** Inline summaries should add format string placeholders for session cache fields (`user_turns`, `context_trend`, `tool_counts`), marked as "rendered when available."

4. **[NON-BLOCKING]** Move `ClaudeSummary` to `sprack-db` as the canonical type shared between sprack-claude and the TUI.
