---
review_of: cdocs/proposals/2026-03-21-sprack-claude.md
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T22:15:00-07:00
task_list: terminal-management/sprack-tui
type: review
state: live
status: done
tags: [rereview_agent, architecture, process_integration, session_file_parsing, correctness]
---

# Round 2 Review: sprack-claude: Claude Code Summarizer

## Summary Assessment

This is a round 2 review focused on the two blocking issues identified in the round 1 review.
Both blocking issues have been resolved: session file discovery uses a two-tier `sessions-index.json` + non-recursive fallback strategy, and the path encoding description correctly states that the leading `/` becomes a leading `-`.
All five non-blocking suggestions from round 1 were also addressed.
Verdict: **Accept.**

## Prior Action Item Resolution

### Round 1 Blocking Items

1. **[blocking] Session file discovery:** RESOLVED.
   Step 4 now documents `sessions-index.json` as the primary discovery mechanism with fields (`sessionId`, `fullPath`, `fileMtime`, `modified`, `isSidechain`, `gitBranch`, `projectPath`), sidechain filtering, and mtime-based selection.
   The fallback is explicitly non-recursive `.jsonl` listing at the project directory root.
   A WARN callout at line 144 reinforces that subagent files must not be matched.
   The resolution chain flowchart (line 89) is updated to reflect the two-tier strategy.
   Four new test cases cover this logic: `test_parse_sessions_index`, `test_sessions_index_missing`, `test_sessions_index_corrupt`, `test_session_discovery_ignores_subagents`.

2. **[blocking] Path encoding text:** RESOLVED.
   Lines 121-122 now read: "Claude Code encodes the project path by replacing all `/` with `-`. The leading `/` becomes a leading `-`."
   This matches both the code (`path_str.replace('/', "-")`) and the examples.
   The incorrect "stripping the leading separator" text is gone.

### Round 1 Non-Blocking Items

3. **Skip list expansion:** RESOLVED. Line 296 includes `file-history-snapshot`, `hook_progress`, and meta `user` entries in the skip list.
4. **`parse().ok(?)` fix:** RESOLVED. Line 419 uses `let Some(child_pid) = child_str.parse::<u32>().ok() else { continue }` instead of `?`.
5. **`cache_creation_input_tokens`:** RESOLVED. Line 325 includes it in the formula. A NOTE callout (lines 329-330) explains why.
6. **Session discovery tests:** RESOLVED. Lines 565-568 add four relevant unit tests.
7. **Filesystem subagent detection alternative:** ADDRESSED. Lines 315-318 document the filesystem-based approach as an alternative alongside the JSONL-based heuristic.

## New Observations

### Directory Structure Documentation

The directory structure diagram (lines 133-142) is a valuable addition.
It clearly shows the separation between root-level `.jsonl` files and subagent files in subdirectories, making the rationale for non-recursive search self-evident.

### Session File Rotation (Edge Case Section)

The edge case section at lines 591-593 describes re-checking modification times to detect session rotation.
This is now consistent with the two-tier strategy: the primary check would be against `sessions-index.json` (which Claude Code updates when creating new sessions), with the mtime fallback as backup.
The text could be slightly more explicit about this, but the design intent is clear enough and consistent with Step 4.

This is **non-blocking**.

### Sidechain Filtering Completeness

The `sessions-index.json` parsing (lines 149-153) filters out sidechain entries.
The JSONL tail-reading section (lines 298-299) separately filters sidechain entries in the activity state derivation.
These are two complementary filters at different levels: file selection and entry parsing.
This is correct and thorough.

## Verdict

**Accept.**

Both blocking issues from round 1 are fully resolved.
All non-blocking suggestions were addressed with care.
The proposal is thorough, internally consistent, and ready for implementation.

## Action Items

1. [non-blocking] Consider making the session rotation edge case (line 591-593) explicitly reference the `sessions-index.json` primary check, for consistency with Step 4.
