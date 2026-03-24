---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T10:00:00-07:00
task_list: terminal-management/claude-sqlite-mirror
type: proposal
state: live
status: request_for_proposal
tags: [sprack, claude_code, sqlite, session_files, analytics, rust]
---

# RFP: Claude Code SQLite Mirror

> BLUF: sprack-claude extracts a narrow status slice (state, model, context %, last tool) from the tail of Claude Code JSONL session files.
> A full-fidelity SQLite mirror of all Claude Code session data would enable analytics, search, cost tracking, session replay, and cross-session context, while also simplifying sprack-claude into a thin reader of the mirror DB.
> This proposal requests design for the ingestion pipeline, schema, and integration points.

## Objective

Build a persistent SQLite mirror that ingests all Claude Code JSONL session files and exposes a normalized, queryable representation of conversations, messages, tool calls, token usage, model info, and subagent relationships.

The mirror serves two roles:

1. **Intermediate layer for sprack-claude**: sprack-claude reads the mirror DB for real-time status instead of parsing raw JSONL directly, reducing duplicated parsing logic and enabling richer status extraction.
2. **General-purpose analytics surface**: any tool can query the mirror for cost tracking, session search, usage patterns, tool frequency analysis, and session replay.

## Current State

sprack-claude (`packages/sprack/crates/sprack-claude/`) operates as a polling daemon that:

- Discovers Claude Code instances via tmux pane commands and `/proc` tree walking.
- Resolves pane PIDs to JSONL session files under `~/.claude/projects/<encoded-cwd>/`.
- Tail-reads the last 32KB of the active session file per poll cycle.
- Extracts a `ClaudeSummary` struct: `state`, `model`, `subagent_count`, `context_percent`, `last_tool`, `last_activity`.
- Writes the summary as JSON to `sprack-db`'s `process_integrations` table.

This design discards the vast majority of session data.
Only the most recent assistant entry's metadata is retained.
Historical messages, full tool call details, cumulative token usage, and conversation structure are lost.

## Prior Art

### claude-code-chat-explorer

[drewburchfield/claude-code-chat-explorer](https://github.com/drewburchfield/claude-code-chat-explorer) is a self-hosted web interface that:

- Ingests JSONL session files into SQLite with FTS5 full-text search.
- Provides project-organized conversation browsing.
- Displays token counts, model info, and activity timelines per session.
- Addresses the 30-day default retention window in Claude Code.

> NOTE(opus/claude-sqlite-mirror): claude-code-chat-explorer validates the core pattern: JSONL-to-SQLite ingestion with a web reader.
> The mirror proposed here differs in being a daemon (continuous ingestion) rather than a one-shot importer, and targets programmatic access rather than a web UI.

### Other Tools

- [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts): tools for publishing Claude Code session transcripts, demonstrates JSONL parsing patterns.
- [withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser): web tool for converting JSONL logs to readable Markdown.
- [Aider chat history in SQLite](https://github.com/Aider-AI/aider/pull/1860): Aider stores chat interactions in SQLite with Datasette integration, demonstrating the analytics value of structured AI chat storage.
- [DuckDB-based JSONL analysis](https://liambx.com/blog/claude-code-log-analysis-with-duckdb): analytical queries over raw JSONL using DuckDB, validating the demand for queryable session data.

## Scope

The full proposal should address the following areas.

### Session Discovery and Lifecycle

- Enumerate all project directories under `~/.claude/projects/`.
- Parse `sessions-index.json` per project for session metadata (session ID, sidechain status, mtime).
- Detect new session files, rotated files, and deleted files.
- Handle the session continuation pattern: session ID changes mid-file when a continuation inherits prefix messages from a parent session.
- Track session state: active (currently being written), complete (no longer growing), archived (past retention window).

### Incremental JSONL Ingestion

- Maintain per-file read positions (byte offset) to avoid re-parsing entire files.
- Handle file rotation (file shrinks): reset position and re-ingest.
- Skip `isCompactSummary: true` records (synthetic summaries, not real conversation).
- Deduplicate entries that appear in both parent and continuation session files.
- Handle malformed lines gracefully (skip and log, never abort).

> NOTE(opus/claude-sqlite-mirror): sprack-claude's `jsonl.rs` already implements tail-reading and incremental reading.
> The mirror needs full-file incremental reading (not tail-only) since it preserves all history.

### Schema Design

The schema should normalize the JSONL append-only log into relational tables.
Key entities:

- **projects**: encoded path, decoded path, first seen, last seen.
- **sessions**: session UUID, project FK, slug/human name, git branch, cwd, start time, end time, parent session FK (for continuations), is_sidechain.
- **messages**: session FK, sequence number, role (user/assistant/system), timestamp, raw JSON (for lossless storage).
- **assistant_details**: message FK, model, stop_reason.
- **token_usage**: message FK, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens.
- **content_blocks**: message FK, block index, block type (text/tool_use/thinking), text content (nullable), tool name (nullable), tool use ID (nullable).
- **tool_results**: message FK, tool_use_id, is_error, content summary.
- **subagent_progress**: session FK, tool_use_id, timestamp.
- **ingestion_state**: file path, last byte offset, last modified time (for incremental reads).

> NOTE(opus/claude-sqlite-mirror): Storing raw JSON per message enables lossless round-tripping.
> The normalized columns are for query performance; the raw JSON is the source of truth.

### Subagent Relationship Tracking

Claude Code's subagent (sidechain) model creates nested conversations:

- Main conversation dispatches a tool call with a `toolUseID`.
- Sidechain entries reference that ID via `parentToolUseID`.
- Progress entries with `data.type: "agent_progress"` track active subagents.

The mirror should model this as a tree: sessions contain messages, tool calls spawn subagent sessions, subagent sessions contain their own messages.

### sprack-claude Integration

With the mirror in place, sprack-claude simplifies to:

1. Identify active Claude panes (existing logic).
2. Query the mirror DB for the latest status of the corresponding session.
3. Write the `ClaudeSummary` to `process_integrations` (existing logic).

The JSONL parsing, tail-reading, and status extraction logic moves into the mirror daemon.

### Query Use Cases

The schema should efficiently support:

- **Cost tracking**: sum token usage across sessions, grouped by project/day/model.
- **Tool frequency**: count tool calls by name, find most-used tools.
- **Session search**: FTS5 full-text search across message content.
- **Session replay**: ordered retrieval of all messages in a session with subagent nesting.
- **Context usage trends**: track context window fill over time within a session.
- **Cross-session context**: find previous sessions that touched the same files or topics.

## Open Questions

1. **Separate DB or shared?** Should the mirror use its own SQLite database (e.g., `~/.local/share/sprack/claude-mirror.db`) or extend `sprack-db`'s `state.db`? A separate DB avoids bloating the fast-polling state DB with historical data, but adds another file to manage. The mirror DB could grow to hundreds of MB for heavy users.

2. **Same daemon or standalone?** Should the mirror ingestion run inside sprack-claude (which already discovers sessions) or as a separate binary? sprack-claude polls every 2 seconds for real-time status; the mirror could poll less frequently (e.g., 10-30 seconds) since historical completeness is more important than latency.

3. **Schema granularity for content blocks**: Should text content blocks store full text, or just metadata? Full text enables FTS5 search but significantly increases DB size. A hybrid approach (metadata in columns, full text in a separate FTS table) may be appropriate.

4. **Session rotation and retention**: Claude Code deletes sessions older than 30 days by default. Should the mirror preserve data beyond the JSONL retention window? If so, the mirror becomes the archival layer, not just a cache.

5. **Concurrency model**: The mirror writes frequently; sprack-claude and analytics tools read. WAL mode handles this well for a single writer, but should the schema be designed for eventual multi-writer support (e.g., separate ingestion processes per project)?

6. **Message deduplication**: Session continuations copy prefix messages from the parent session. The mirror needs a deduplication strategy: ingest only from the canonical source (the originating session file) and skip duplicates in continuations, or deduplicate at query time?

7. **Thinking block content**: Claude Code JSONL includes thinking/reasoning blocks. These can be large. Should they be stored, stored but excluded from FTS, or dropped entirely?

8. **Backfill strategy**: On first run, the mirror needs to ingest all existing session files. For users with months of history, this could be a significant initial load. Should backfill run at reduced priority, or should there be a separate `--backfill` command?

## Success Criteria for Full Proposal

1. Complete SQLite schema with CREATE TABLE statements, indexes, and FTS5 configuration.
2. Ingestion pipeline design: file discovery, incremental parsing, deduplication, error handling.
3. Daemon architecture: poll interval, concurrency, signal handling, PID management.
4. Migration path for sprack-claude: how it transitions from direct JSONL reading to mirror queries.
5. Query examples for each use case (cost tracking, search, replay, analytics).
6. Size estimates: expected DB size per session, per month of usage.
7. Test plan covering ingestion correctness, incremental updates, rotation handling, and deduplication.
