---
first_authored:
  by: "@claude-opus-4-6-20250625"
  at: 2026-03-28T09:55:00-07:00
task_list: sprack/recon-evaluation
type: report
state: live
status: wip
tags: [architecture, sprack, tooling_evaluation, claude_internals]
---

# Recon State Inspection Techniques: Comparison with Sprack-Claude

> BLUF: Recon and sprack-claude use fundamentally different strategies for determining Claude session state.
> Recon scans tmux pane content via `capture-pane` for real-time status (Working/Input/Idle), uses `~/.claude/sessions/{PID}.json` for session-to-process mapping, and handles `/clear` successor detection and `--resume` session recovery.
> Sprack-claude reads JSONL `stop_reason` fields for state, walks `/proc` for PID resolution, and supplements with hook bridge events for container sessions.
> Each approach has blind spots the other covers.
> The most valuable techniques sprack could adopt from recon are: `capture-pane` status detection as a secondary signal, `/clear` successor detection, and `--resume` session recovery via tmux environment variables.

## 1. Status Detection

### Recon: Pane Content Scanning

Recon's `pane_status()` function calls `tmux capture-pane -t <target> -p` and scans the last 10 non-empty lines bottom-up.
It looks for three patterns:

- **Working**: a line starting with a Unicode spinner character (dingbats range U+2720..U+2767, record symbol U+23FA, or middle dot U+00B7) that also contains an ellipsis (U+2026).
- **Input**: the last non-empty line contains "Esc to cancel", or any scanned line contains the selection prompt character (U+276F) followed by a digit.
- **Idle**: anything else.

A fourth state, **New**, is assigned when `capture-pane` yields Idle AND the session has zero tokens.

### Sprack-Claude: JSONL `stop_reason` Parsing

Sprack-claude's `extract_activity_state()` reads the last meaningful JSONL entry (filtering out sidechains, compact summaries, and metadata entry types) and maps its type and content to state:

- `assistant` with `stop_reason: null` -> Thinking
- `assistant` with `stop_reason: "tool_use"` -> ToolUse
- `assistant` with `stop_reason: "end_turn"` -> Idle
- `user` -> Waiting
- No meaningful entries -> Error

### Comparison

| Dimension | Recon (capture-pane) | Sprack-claude (JSONL) |
|-----------|---------------------|-----------------------|
| Latency | Real-time (current pane content) | Delayed by poll + JSONL flush |
| Granularity | Working/Input/Idle/New | Thinking/ToolUse/Idle/Waiting/Error |
| False positives | Spinner glyphs in user output | Stale `stop_reason: null` on aborted streams |
| TUI coupling | Breaks if Claude changes status bar rendering | Breaks if JSONL schema changes |
| Container support | Requires tmux pane on host | Works with any accessible JSONL file |
| Subagent visibility | None (reads one pane) | Detects via `isSidechain` and `agent_progress` entries |

The critical weakness of JSONL-only status detection is the stale `stop_reason: null` problem: when Claude is actively streaming, the JSONL contains an assistant entry with `stop_reason: null` (thinking).
If the stream is interrupted or Claude becomes idle without writing a final entry with `stop_reason: "end_turn"`, the JSONL still shows "thinking" indefinitely.
Sprack-claude mitigates this with a periodic `tail_read` refresh (every 5 cycles, ~10 seconds), but the root cause is that `stop_reason: null` is indistinguishable from "actively thinking" and "abandoned mid-stream."

Recon's `capture-pane` approach does not have this problem: it reads the current visual state of the TUI, which always reflects reality.
However, it is fragile to Claude Code UI changes (spinner characters, prompt text) and provides no information when the pane is not visible (e.g., container sessions accessed via podman exec).

> NOTE(opus/sprack/recon-evaluation): Sprack-claude's richer state taxonomy (Thinking vs ToolUse vs Waiting) is unavailable via pane scanning.
> The JSONL provides semantic state; the pane provides visual state.
> A dual-signal approach (JSONL primary, capture-pane as tiebreaker for ambiguous states) would be strictly more reliable than either alone.

### Recommendation

Add `capture-pane` as a **secondary signal** for local (non-container) panes.
When JSONL shows `stop_reason: null` (thinking) for longer than one poll cycle but `capture-pane` shows Idle, override the state to Idle.
This eliminates the stale-thinking false positive without losing JSONL's richer taxonomy.

## 2. JSONL Incremental Parsing

### Recon

Recon's `parse_jsonl()` accepts the previous file size, previous token totals, and previous model.
If the file size is unchanged, it returns cached values immediately.
Otherwise, it seeks to `prev_file_size` and reads only new lines.

Key details:
- Uses `BufReader` with line-by-line reading (`read_line`), not bulk `read_to_string`.
- Pre-filters lines with string contains checks (`"type":"assistant"`, `"type":"user"`) before attempting JSON deserialization. This avoids parsing progress/system/metadata lines.
- Token values are **replaced** (not accumulated) on each assistant entry: `total_input = usage.input_tokens + cache_creation + cache_read`. This means the token count reflects the most recent message's context window usage, not cumulative session tokens.
- Extracts model changes from `/model` command output embedded in user/system JSONL entries by parsing `<local-command-stdout>Set model to...</local-command-stdout>` tags with ANSI stripping.
- Extracts effort level from the same `/model` output.

### Sprack-Claude

Sprack-claude's `jsonl.rs` provides three functions:
- `tail_read`: seeks to `file_length - max_bytes` (default 32KB), reads the chunk, discards the first partial line, deserializes all complete lines.
- `incremental_read`: seeks to last position, reads new data, updates position. Handles file shrinkage (rotation) by resetting to 0.
- `head_read`: reads the first N bytes to find session naming entries near the start.

Key details:
- Uses `read_to_string` for bulk reading, not line-by-line.
- Deserializes every line into the full `JsonlEntry` struct (no pre-filtering).
- Token counting is done in `status.rs`, not during parsing. The `extract_context_percent` function reads the most recent assistant message's usage, matching recon's "last entry wins" semantics.
- Periodically forces a full `tail_read` (every 5 poll cycles) to catch state transitions that incremental reading might miss.

### Comparison

Recon's line-by-line approach with string pre-filtering is more memory-efficient for very large files: it avoids buffering 32KB of text and deserializing entries that will be discarded.
However, sprack-claude's `tail_read` is simpler and more robust to partial writes (it discards the first potentially-incomplete line explicitly).

Recon's token semantics are subtly different: `input_tokens + cache_creation + cache_read` is treated as the total input token count.
Sprack-claude computes the same sum but labels it "context usage" (tokens_used), which is more accurate: it represents the current context window consumption, not cumulative input.

> NOTE(opus/sprack/recon-evaluation): Both implementations handle the same edge case: file size unchanged means no new data.
> Neither handles partial JSON lines written mid-flush, though this is extremely rare with Claude's atomic-write JSONL appends.

### Recommendation

No immediate changes needed.
Sprack-claude's approach is adequate.
The pre-filtering optimization from recon would save CPU on large sessions but the 32KB tail window already bounds the work.

## 3. Token and Model Tracking

### Recon

- **Token display**: `(input + output) / 1000` as "Nk" against the model's context window. This is `used / window`, counting both input and output tokens.
- **Model detection**: from JSONL assistant entries (primary) and from `/model` command stdout in user/system entries (secondary). The secondary path parses display names ("Opus 4.6") back to model IDs via `id_from_display_name()`.
- **Effort tracking**: extracted from `/model` output ("with max effort", "with min effort").
- **Context window**: hardcoded per-model lookup. Opus 4.6 is 1M, everything else is 200K.

### Sprack-Claude

- **Token display**: `input + cache_read + cache_creation` as `tokens_used`, against model context window as `tokens_max`. Output tokens are not included in the context percentage.
- **Model detection**: from the most recent non-sidechain assistant message's `model` field only. No `/model` command parsing.
- **Effort tracking**: not tracked.
- **Context window**: `model_context_window()` matches on model name substrings. Opus is 1M, everything else is 200K.
- **Additional data**: turn counts (user/assistant), tool usage frequency, context trend (rising/falling/stable) via the session cache DB.

### Comparison

| Data Point | Recon | Sprack-Claude |
|-----------|-------|---------------|
| Token ratio formula | (input + output) / window | (input + cache_read + cache_create) / window |
| Model from /model cmd | Yes | No |
| Effort level | Yes | No |
| Turn counts | No | Yes (cache DB) |
| Tool usage frequency | No | Yes (cache DB) |
| Context trend | No | Yes (cache DB) |
| Subagent count | No | Yes (agent_progress entries) |

Recon's token ratio includes output tokens, which is arguably incorrect for "context window usage" since output tokens consume a separate budget.
Sprack-claude's formula (input + cache variants) better represents context consumption.

Recon's `/model` command parsing is a useful technique sprack-claude lacks.
When a user switches models mid-session, the `/model` output is the first signal: it appears in the JSONL before the next assistant message.
Without it, sprack-claude shows the old model until the next assistant response arrives.

### Recommendation

Consider adding `/model` command parsing and effort tracking to sprack-claude's JSONL reader.
The parsing is straightforward: scan user/system entries for `<local-command-stdout>Set model to` and extract the model name and effort level.

## 4. Edge Case Handling

### /clear Successor Detection

Recon handles `/clear` explicitly.
When a user runs `/clear` in Claude Code, a new JSONL file is created in the same project directory, but `~/.claude/sessions/{PID}.json` still points to the old session ID.
This causes the session file lookup to find the stale pre-clear JSONL.

Recon's `find_clear_successor()` scans the project directory for unmatched JSONL files that are newer than the current file and contain `<command-name>/clear</command-name>` in their first 5 lines.
The `is_clear_born()` check prevents false positives from other new sessions in the same directory.

Sprack-claude has no `/clear` detection.
It relies on PID invalidation (the Claude process PID changes after `/clear` in some cases) or on the sessions-index.json being updated.
If the PID does not change (which is the common case: `/clear` does not restart the process), sprack-claude continues showing the old session data until the tail_read window catches up to the new file.

> WARN(opus/sprack/recon-evaluation): `/clear` is a real gap in sprack-claude.
> The cached session file path becomes stale, and without PID change or hook event, there is no trigger to re-resolve.
> Periodic re-resolution (e.g., every 30 seconds) would partially mitigate this, but `/clear`-marker scanning is the correct fix.

### --resume Session Recovery

Recon handles `claude --resume <session-id>` with a two-tier strategy:

1. **Primary**: read `RECON_RESUMED_FROM` from the tmux session environment. This variable is set by `recon resume` at session creation time. Zero-overhead, reliable for recon-launched sessions.
2. **Fallback**: parse `ps -p <pid> -o args=` for `--resume <session-id>`. Works for manually invoked `claude --resume` in any tmux pane.

The resumed session ID is used to locate the original JSONL file (which keeps the old filename even though the session file has a new ID).

Sprack-claude has no explicit resume handling.
It resolves sessions by PID -> cwd -> encoded project path -> most recent JSONL.
If a resumed session writes to the same project directory, sprack-claude finds it via mtime.
If the resumed session's project directory differs from the new process's cwd (unlikely but possible), it would be missed.

For container sessions, sprack-claude's hook bridge `SessionStart` event provides the transcript path directly, which handles resumption implicitly.

### PID Discovery

Recon uses `~/.claude/sessions/{PID}.json` as the primary PID-to-session mapping.
It discovers Claude processes via `tmux list-panes -a` and matches pane PIDs against the session files directory.
For shell panes (where the pane PID is bash/zsh, not claude), it falls back to `pgrep -P <pid>` to find a child with a corresponding session file.

Sprack-claude walks `/proc/<pid>/children` recursively (up to depth 5) looking for a child whose cmdline contains "claude."
This is more robust than `pgrep -P` (which only checks direct children) but slower (reads /proc for each candidate).
The `ProcFs` trait abstraction enables testing with mock process trees.

> NOTE(opus/sprack/recon-evaluation): Recon's PID discovery is simpler because it validates against session file existence rather than cmdline matching.
> This avoids false positives from processes named "claude" that are not Claude Code (e.g., a file named claude.py).
> However, the session file check adds a filesystem stat per child PID.

### Session Replacement (/new)

Sprack-claude explicitly handles session replacement: `is_session_cache_valid()` compares the cached Claude PID against the current Claude PID found by re-walking `/proc`.
If a user runs `/new` in Claude Code, the old process exits and a new one starts with a different PID.
The cache invalidation triggers re-resolution.

Recon handles this implicitly: `discover_sessions()` runs fresh each poll cycle, rebuilding the live session map from scratch.
There is no cache invalidation needed because there is no session cache.
The cost is higher per-cycle overhead (reading all session files and running tmux commands every 2 seconds).

## 5. Robustness Patterns

### Recon

- **No persistence**: no database, no cache files (except `parked.json`). Every poll cycle rebuilds state from scratch. This eliminates an entire class of stale-cache bugs at the cost of higher per-cycle I/O.
- **String pre-filtering before JSON parse**: `trimmed.contains("\"type\":\"assistant\"")` avoids deserializing lines that cannot contribute useful data. Pragmatic optimization.
- **Minute-resolution sorting**: `truncate_to_minute()` truncates timestamps to minute resolution before sorting sessions. This prevents the table from reordering on every poll cycle due to sub-second timestamp differences.
- **PID deduplication**: deduplicates by PID, not tmux session name. Multiple Claude instances in the same tmux session each get their own entry. This is correct but sprack does not face this issue due to its pane-level resolution.
- **Graceful fallbacks**: every external command (`tmux`, `git`, `ps`, `pgrep`) returns `None`/default on failure. No panics on subprocess errors.

### Sprack-Claude

- **Session cache with validation**: caches resolved session state keyed by pane ID, with explicit invalidation on PID change, file disappearance, or container session staleness (60-second mtime threshold).
- **Periodic tail_read refresh**: every 5 cycles forces a full tail_read instead of incremental, catching state transitions that incremental reading missed.
- **Write retry**: `write_integration_with_retry` retries once on SQLite write failure with 100ms delay. Handles transient WAL contention.
- **Deduplication by session file path**: prevents multiple panes resolving to the same session file from creating duplicate integrations. Local panes are processed first to prevent container path-leakage panes from stealing integrations.
- **Head-read fallback for session names**: when the 32KB tail window misses the session naming entry (written at file start), a one-time 8KB head_read fetches it.
- **PID file guard**: RAII-based PID file cleanup prevents stale PID files from blocking daemon restarts.
- **Container staleness detection**: container session files older than 60 seconds in a terminal state (Idle/Waiting/Error) are treated as inactive, preventing ghost integrations.

### Patterns Worth Adopting

1. **Capture-pane as secondary status signal** (from recon): resolves the stale `stop_reason: null` problem for local panes.
2. **`/clear` successor detection** (from recon): sprack-claude has no mechanism to detect `/clear` without a hook event. The `is_clear_born()` first-5-lines check is cheap and effective.
3. **`--resume` environment variable** (from recon): the `RECON_RESUMED_FROM` pattern of setting a tmux environment variable at launch time is a zero-cost signal for session recovery. Sprack's `recon launch` equivalent could set a similar variable.
4. **Minute-resolution sort stability** (from recon): if sprack-tui experiences table jitter from sub-second timestamp differences, this is a simple fix.
5. **String pre-filtering before deserialization** (from recon): for sessions with very large JSONL files, pre-checking for `"type":"assistant"` before calling `serde_json::from_str` would reduce CPU. Low priority given the 32KB tail window.

### Patterns Recon Could Learn From Sprack

For completeness, sprack-claude has several capabilities recon lacks:
- Container-aware session resolution (four-tier resolver).
- Hook bridge integration for task lists, session summaries, and subagent lifecycle.
- Persistent session cache DB for turn counts, tool usage, and context trend.
- Git state resolution without subprocess spawning (direct `.git/HEAD` file reads with mtime caching).
- Sidechain filtering to prevent subagent sessions from appearing as top-level sessions.

## Summary of Actionable Items

| Technique | Effort | Impact | Priority |
|-----------|--------|--------|----------|
| Capture-pane secondary status signal | Medium | Eliminates stale-thinking false positives | High |
| /clear successor detection | Low | Fixes a real gap in session tracking | High |
| --resume tmux env variable | Low | Zero-cost resume recovery for lace-launched sessions | Medium |
| /model command parsing | Low | Faster model switch detection | Low |
| Effort level tracking | Low | Informational only | Low |
| String pre-filtering in JSONL parser | Low | Minor CPU savings | Low |

> TODO(opus/sprack/recon-evaluation): Capture-pane integration requires deciding on the state-merging logic: when should pane state override JSONL state?
> The simplest rule is: if JSONL says Thinking and pane says Idle for 2+ consecutive cycles, override to Idle.
> More complex rules could use pane state to disambiguate ToolUse (pane shows spinner) from Waiting (pane shows prompt).
