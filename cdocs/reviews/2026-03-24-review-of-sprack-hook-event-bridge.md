---
review_of: cdocs/proposals/2026-03-24-sprack-hook-event-bridge.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T21:30:00-07:00
task_list: terminal-management/sprack-hook-bridge
type: review
state: live
status: done
tags: [fresh_agent, architecture, sprack, hooks, data_bridge, cross_proposal_coherence]
---

# Review: Sprack Hook Event Bridge

## Summary Assessment

This proposal defines a hook-based event bridge that captures seven Claude Code lifecycle events and feeds structured JSON to sprack-claude via per-session JSONL event files.
The document is thorough, well-structured, and architecturally sound: the hook script is minimal and fast, the event reader reuses existing patterns, the `ClaudeSummary` extensions are backward-compatible, and the fallback behavior is clearly defined.
Cross-proposal coherence is strong: the document explicitly maps its data outputs to the inline summaries widget lines, integrates with the phasing plan's dependency graph, and defines a clear complementarity boundary with JSONL tail-reading.
The most significant finding is that the proposal assumes specific Claude Code hook input field names (e.g., `hook_event_name`, `compact_summary`, `agent_id`) without citing documentation for these schemas, creating a risk that the actual hook input format differs from what the script parses.
Verdict: **Revise** (one blocking issue, several non-blocking).

## Section-by-Section Findings

### BLUF

The BLUF is effective: it names the seven events, the file path convention, the data flow, the supplementary relationship with JSONL, and the fallback guarantee.
The phrase "supplements (not replaces)" is the critical framing and appears front-and-center.

**Non-blocking**: The BLUF is four sentences that run long.
Consider tightening the third sentence; the parenthetical "(not replaces)" is the key claim and the rest of the sentence repeats detail from the complementarity table later.

### Problem Statement

Clear articulation of three categories of high-value data that JSONL cannot provide (task list, session purpose, subagent lifecycle with identity).
The reference to the plugin analysis report properly grounds the recommendation in prior analysis.

**Non-blocking**: The claim "extracting structured task state requires parsing JSON-within-JSON, tracking create/update/complete transitions across the full session, and correlating task IDs" is accurate based on the codebase (`status.rs` has no task parsing), but it might slightly overstate the difficulty.
The session cache proposal also plans to ingest JSONL entries incrementally, which could eventually extract task data from JSONL without hooks.
A brief acknowledgment that hooks provide this data more cleanly rather than exclusively would be more precise.

### Architecture (Mermaid Diagram)

The flow diagram correctly shows the dual data path: hooks write to event files, JSONL is written by Claude Code, and sprack-claude reads both and writes to sprack-db.
The diagram is clear and the component boundaries are well-drawn.

No issues.

### Hook Command Script Section

The design decision to keep the script minimal (read, extract, append) is sound.
The NOTE about filtering `PostToolUse` early is important and well-placed.

**Non-blocking**: The section says "shell script (or small Rust binary)" but the implementation section later provides only a shell script.
The Rust binary option is mentioned in passing as a latency optimization.
Consider removing the "or Rust binary" from the architecture section to avoid suggesting two equally-considered paths, and keep it as a NOTE about a future optimization.

### Event File Format

Clean envelope design.
The common fields (`ts`, `event`, `session_id`, `cwd`, `data`) are well-chosen.

**Non-blocking**: The `ts` field is set by the hook script at write time using `date -u`.
This means the timestamp reflects when the script ran, not when Claude Code fired the event.
For most events the delta is negligible (under 25ms), but for `SessionEnd` (which has a 1.5s default timeout), a slow script could produce a timestamp that lags the actual event.
Consider documenting this explicitly, or noting that a future Rust implementation could use the hook input's own timestamp if one exists.

### Event Reader in sprack-claude

The incremental-read pattern reuse is the right call.
The two-strategy lookup (by `session_id` if known, or by `cwd` scan if not) handles the startup race.

**Blocking**: The fallback scan strategy ("scans all event files in the directory for one whose `cwd` matches the pane's resolved working directory and whose last modification time is recent") has an ambiguity.
If two Claude sessions share the same `cwd` (a scenario explicitly listed in Open Questions item 5), the scanner could match the wrong event file.
Open Question 5 says "SessionStart carries transcript_path, which can be correlated with the JSONL session file," but the fallback scan by definition runs when no SessionStart has been seen.
The proposal should either:
(a) Define the scan as matching on both `cwd` and recency, accepting that the wrong file may be matched briefly until `SessionStart` arrives, and documenting this as a known limitation.
(b) State that without a `SessionStart` event, the event reader produces no results for that pane (conservative fallback).
Option (b) is safer and simpler.
The current text leaves this edge case unresolved.

### ClaudeSummary Extensions

The three new fields (`tasks`, `session_summary`, `session_purpose`) are all `Option` types with `serde(default)`.
The backward compatibility analysis is correct: existing TUI code that deserializes `ClaudeSummary` from JSON will ignore unknown fields.

**Non-blocking**: The proposal adds both `session_summary` and `session_purpose` to `ClaudeSummary`.
The inline summaries proposal references `session_purpose_or_title` as a single rendered field.
It is unclear from the data model what distinction is intended between `session_summary` (from `PostCompact`) and `session_purpose`.
The inline summaries proposal's line 4 says `session_purpose_or_title`, and the phasing plan says `session_purpose` comes from "first user message or custom title."
But this proposal does not define how `session_purpose` is populated: no hook event carries that data.
`PostCompact` carries `compact_summary`, which maps to `session_summary`.
Where does `session_purpose` come from?
If it is supposed to come from the JSONL custom title, it is not a hook-derived field and should not be listed in the "New fields from hook events" comment.
This is a cross-proposal naming inconsistency that should be clarified.

### Hook Configuration Template

The JSON template is correct and complete for all seven events.

**Non-blocking**: The template registers a bare command path (`~/.local/share/sprack/hooks/sprack-hook-bridge`) without specifying whether `~` expansion works in Claude Code's hook command resolution.
If Claude Code does not expand `~`, the hook will fail silently.
Consider using `$HOME` expansion or an absolute path, and noting the shell expansion behavior.

### Data Model

Each event type is well-specified with example JSON and field tables.
The WARN about sensitive data in `tool_input`/`tool_response` is a good forward-looking concern.

**Non-blocking**: The `SubagentStart` data struct includes only `agent_id` and `agent_type`.
The `SubagentStop` data struct adds `last_assistant_message`.
However, the hook script's case statement for `SubagentStart|SubagentStop` extracts all three fields for both events.
For `SubagentStart`, `last_assistant_message` will be `null` (the subagent has not yet produced output).
This is harmless but wastes a field.
Consider splitting the case statement or adding a comment noting the intentional null.

### Integration Points: Poll Loop

The modified poll cycle pseudocode is clear and shows the hook event reader as an additive step (2c + 2e) without modifying existing steps.
This is the correct integration approach.

No issues.

### Integration with Inline Summaries (Phase 2A)

The widget line mapping table correctly cross-references the inline summaries proposal.
The fallback contract ("when `tasks` is `None`, lines 2-4 are omitted and the widget falls back to single-line mode") aligns with the inline summaries proposal's stated behavior.

**Non-blocking**: The table shows line 4 sourced from `session_summary` or `session_purpose`.
This is the same ambiguity noted under ClaudeSummary Extensions.
Resolving the naming issue there resolves it here.

### Complementarity with JSONL Tail-Reading

The comparison table is comprehensive and accurate against the actual codebase (`status.rs` confirms model, context_percent, last_tool, and subagent_count are JSONL-derived).

No issues.

### Graceful Fallback

The five-point fallback specification is precise and testable.
"No errors, no warnings, no degraded state indicators" is the correct behavior.

No issues.

### Integration with Session Cache

The three storage options are clearly articulated.
The recommendation of in-memory state for Phase 1 is sound: event files are small, and re-reading from offset 0 on restart is fast.

No issues.

### Integration with Process Host Awareness

The `HookResolver` concept is well-defined.
The TODO about startup race handling is appropriately deferred.

**Non-blocking**: The priority order "HookResolver > LaceContainerResolver > LocalResolver" assumes these resolvers are mutually exclusive per pane.
In practice, a lace container pane could have both an event file (from hooks configured inside the container) and lace metadata (from tmux on the host).
The proposal should clarify that `HookResolver` takes priority when its match is unambiguous (matching `cwd`), and that the resolver chain short-circuits at the first successful match.

### Hook Script Implementation

The shell script is functional and correctly implements the filtering, extraction, and append logic.
The use of `set -euo pipefail` is appropriate.

**Blocking concern already covered above**: The script uses `echo "$INPUT" | jq -r '.hook_event_name // empty'` to extract the event name.
The plugin analysis report lists the hook input structure with fields like `session_id`, `cwd`, `tool_name`, etc., but does not explicitly confirm the field name `hook_event_name`.
The Claude Code hooks reference documentation (cited in the plugin analysis report) should be consulted to verify exact field names.
If the actual field is named differently (e.g., `event_name` or `hookEventName`), the script silently produces no output and exits 0, losing all events.
This is the same blocking concern as the schema verification issue.

> NOTE(opus/sprack-hook-bridge-review): The script also calls `jq` on `$INPUT` multiple times (once for each extracted field plus once for the data payload, plus the final construction).
> The NOTE in the proposal acknowledges this and gives a 15-25ms total budget.
> An alternative pattern: pipe `$INPUT` once to a single `jq` invocation that emits all needed fields as tab-separated values, and use bash `read` to capture them.
> This halves the jq invocations for the common case.

### Implementation Phases

Four phases, logically sequenced, with clear deliverables and effort estimates.
Phase 1 through Phase 3 build incrementally.
Phase 4 (settings template and documentation) is a good capstone.

**Non-blocking**: Phase 2 lists `find_event_file(event_dir, cwd) -> Option<PathBuf>` as a deliverable, but the function signature does not include `session_id` as a parameter.
Given the two-strategy lookup described earlier (by `session_id` first, by `cwd` fallback), the function signature should accept both.

### Open Questions

The resolved questions are well-argued.
The deferred questions are appropriately scoped.

**Non-blocking**: Open Question 4 (event file lifecycle management) proposes "delete event files older than 7 days on startup."
This is reasonable but has a subtle issue: if sprack-claude restarts frequently (e.g., during development), it cleans up on every start.
If it runs for weeks without restart, cleanup never happens.
A better approach: run cleanup once per hour during the poll loop (check elapsed time since last cleanup, delete files older than threshold).
This is a minor implementation detail but worth noting.

**Non-blocking**: Open Question 6 mentions disk I/O pressure on NFS-mounted home directories as a timeout risk.
The mitigation (switch to Rust binary) is reasonable, but a simpler intermediate mitigation is to write to `/tmp/sprack-events/` (local tmpfs) and have sprack-claude read from there.
This avoids NFS latency entirely for the event write path.

### Future Work

The clauthier packaging, event file rotation, HookResolver, and expanded PostToolUse filtering sections are all reasonable future directions.
None are under-specified for their level of deferral.

No issues.

### Relationship to Other Proposals

The cross-reference table is accurate.
The relationship descriptions are precise: "consumer," "depends on," "provides an alternative resolution strategy," "shares or parallels."

**Non-blocking**: The table references `2026-03-24-workspace-system-context.md` with "Hooks could also deliver workspace context; shared distribution mechanism."
This is vague.
The workspace system context proposal is an RFP exploring delivery mechanisms (MCP, skills, CLAUDE.md, env vars).
If the hook bridge's distribution mechanism (a command hook installed at a known path) is being suggested as a reusable pattern, that should be stated explicitly.
Otherwise, the connection is too speculative for the cross-reference table.

### Frontmatter

The `first_authored.by` field uses `@claude-opus-4-6`, which is a shortened model name.
The frontmatter spec says to use the "full API-valid model name" (e.g., `@claude-opus-4-6-20250605`).
This is a minor mechanical issue.

### Writing Convention Compliance

- BLUF is present and well-formed.
- Sentence-per-line formatting is mostly followed, with occasional compound sentences that could be split.
- Callout syntax is correctly used (NOTE, WARN, TODO with attribution).
- History-agnostic framing is maintained throughout.
- No emojis.
- Mermaid is used for the architecture diagram.
- Punctuation conventions are followed (colons preferred over em-dashes).

## Verdict

**Revise.**
One blocking issue (event file fallback scan ambiguity for multiple sessions sharing the same `cwd`) and one near-blocking concern (hook input field name verification: if the actual Claude Code hook input schema uses different field names than `hook_event_name`, the entire bridge silently fails).
The non-blocking issues are refinements that improve precision and cross-proposal coherence.

## Action Items

1. **[blocking]** Resolve the event file fallback scan ambiguity when multiple sessions share the same `cwd` and no `SessionStart` has been seen. Either define conservative fallback (no results until `SessionStart` arrives) or explicitly document the matching ambiguity as a known limitation with bounded impact.

2. **[blocking]** Verify the Claude Code hook input field names against the actual hook reference documentation. The script assumes `hook_event_name`, `session_id`, `cwd`, `tool_name`, `compact_summary`, `agent_id`, `agent_type`, `task_id`, `task_subject`, `task_description`, `transcript_path`, `reason`, and `last_assistant_message`. If any of these differ from the actual schema, the bridge silently produces empty/missing data. Add a NOTE with a link to the authoritative schema source, or add a validation step in Phase 1 testing that dumps raw hook stdin to verify the actual field names.

3. **[non-blocking]** Clarify the distinction between `session_summary` and `session_purpose` in the `ClaudeSummary` extensions. Currently, `session_summary` maps to `PostCompact.compact_summary`, but `session_purpose` has no defined data source from hook events. If it comes from JSONL (custom title), it should not be listed under "New fields from hook events."

4. **[non-blocking]** Verify whether Claude Code expands `~` in hook command paths. If not, the configuration template should use `$HOME` or an absolute path.

5. **[non-blocking]** Update `find_event_file` function signature in Phase 2 deliverables to accept both `session_id: Option<&str>` and `cwd: &str`, matching the two-strategy lookup design.

6. **[non-blocking]** Consider improving the event file lifecycle management from "delete on startup" to periodic cleanup during the poll loop, avoiding the gap where long-running instances never clean up.

7. **[non-blocking]** Update the `first_authored.by` field to the full API-valid model name per the frontmatter spec.
