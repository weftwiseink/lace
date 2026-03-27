---
first_authored:
  by: "@claude-opus-4-6-20250627"
  at: 2026-03-27T09:42:56-07:00
task_list: sprack/session-naming
type: report
state: live
status: wip
tags: [investigation, sprack, session_naming]
---

# Extracting Session Names from Claude Code JSONL Files

> BLUF: Container Claude sessions display as "claude/unnamed" because sprack-claude's naming data comes from `sessions-index.json` (absent in container project dirs) and the `slug` field on JSONL entries (absent in most container sessions).
> The JSONL file contains `custom-title` and `agent-name` entry types that carry the user-set session name, but sprack-claude does not parse them.
> These entries are emitted mid-file on each session resume (not at the start), and the 32KB tail-read window misses them in long sessions.
> A targeted scan for these entry types would solve the naming gap for local sessions; container sessions need a different approach since their JSONL files lack these entries entirely.

## Context / Background

Sprack's TUI shows each Claude Code pane with a session name.
The name resolution pipeline in `sprack-claude` has two sources:

1. **`customTitle` from `sessions-index.json`**: the primary source, set by the user via `/rename` in Claude Code.
2. **`slug` from JSONL entries**: the fallback, an auto-generated three-word identifier (e.g., "cuddly-wobbling-shannon") present on most entry lines.

When neither source yields a name, the TUI displays "unnamed".
Container sessions consistently hit this fallback because container project directories (`-workspace`, `-home-node`) lack `sessions-index.json` and most of their JSONL entries lack the `slug` field.

## Key Findings

### 1. JSONL message types carrying identity/naming info

Analysis of session file `ab47f36a-...` (1413 lines, 5.7MB) reveals these naming-relevant entry types:

| Entry type | Field | Description | Count in sample |
|---|---|---|---|
| `custom-title` | `customTitle` | User-set name via `/rename` | 6 |
| `agent-name` | `agentName` | Display name (mirrors customTitle when set) | 6 |
| Any entry | `slug` | Auto-generated 3-word ID, present on most entries | ~1300+ |
| Any entry | `sessionId` | UUID, present on most entries | ~1300+ |

Full type distribution in the sample session:

```
494  assistant
397  user
253  progress
130  queue-operation
 86  file-history-snapshot
 39  system
  6  custom-title
  6  agent-name
  2  last-prompt
```

### 2. `custom-title` and `agent-name` entries always appear as pairs

They are emitted together, always in `custom-title` then `agent-name` order, surrounded by `system` or `last-prompt` entries.
They appear in duplicate pairs (2 lines each time), likely one for the main thread and one for the sidechain system.
This means 6 `custom-title` entries represent 3 resume events, not 6 distinct name-sets.

### 3. Naming entries are emitted on session resume, not creation

In the sample session, naming entries appear at lines 1011, 1185, and 1205 (of 1413 total).
They appear after `system` or `last-prompt` entries that mark session resume boundaries.
They are NOT present in the first ~1000 lines of the session.

### 4. Name changes are possible mid-session

Two sessions in the corpus show multiple distinct names:
- `17d67ddf`: titles=`{'oversee', 'We\'ve been having some difficulty...'}`
- `b47af13e`: titles=`{'workspace-system-context', 'local'}`

The last `custom-title` entry represents the current name.

### 5. The 32KB tail window misses naming entries in long sessions

The default `tail_read` window is 32,768 bytes.
Of 19 sessions with naming entries in the lace project:

- **15 sessions**: last naming entry within 32KB of EOF (would be caught by tail_read)
- **4 sessions**: last naming entry >32KB from EOF (missed by tail_read)

The worst case is 3.6MB from EOF.
This means `tail_read` works for most sessions but fails for long-running ones with many tool calls after the last resume.

### 6. Container sessions lack all JSONL naming data

Across 10 container session files (`-workspace/*`, `-home-node/*`):
- **0** have `custom-title` entries
- **0** have `agent-name` entries
- **1** has `slug` fields (the rest have none)
- **0** have `sessions-index.json` in their project directory

Container sessions created via Claude inside devcontainers are unnamed by default and users rarely `/rename` them from within the container.
The `sessions-index.json` that would carry the `customTitle` is maintained by the Claude CLI on the host, but only for host-path-encoded project directories.

### 7. Current code already skips these entry types during state extraction

`status.rs` defines `SKIPPED_ENTRY_TYPES` which includes both `"agent-name"` and `"custom-title"`.
These are correctly excluded from activity state computation.
The `JsonlEntry` struct in `jsonl.rs` does NOT have fields for `customTitle` or `agentName`, so these entries are parsed as generic entries with `entry_type` set but naming data silently dropped.

## Analysis: How sprack-claude resolves names today

### Local panes (working)

```
resolve_session_for_pane()
  -> session::find_session_file(project_dir)
     -> find_via_sessions_index()  // reads sessions-index.json, extracts customTitle
     -> ResolvedSession { custom_title: Some("my-session") }
  -> SessionFileState { session_name: resolved.custom_title }
```

Then in `process_claude_pane()`:
```
status::build_summary(entries, session_state.session_name.as_deref())
  -> resolve_session_name(custom_title, slug)
     -> custom_title > slug > None
```

This works for local sessions when `sessions-index.json` has the `customTitle` field.
For local sessions without a `/rename`, it falls back to slug from JSONL entries.

### Container panes (broken)

```
resolve_container_pane()
  -> resolve_container_pane_via_mount(workspace, claude_home, host_cwd)
     -> finds session file via hook events or project dir listing
     -> SessionFileState { session_name: None }  // NO customTitle source
```

Container resolution never populates `session_name` because:
1. Container project dirs have no `sessions-index.json` to read `customTitle` from.
2. The `find_best_project_session()` fallback uses `find_via_jsonl_listing()` which returns a bare `PathBuf`, not a `ResolvedSession`.
3. Container JSONL files lack `custom-title`, `agent-name`, and usually `slug` entries.

## Feasibility Assessment: Parsing `custom-title` from JSONL

### Approach A: Scan JSONL for `custom-title` entries

Add `customTitle` and `agentName` as optional fields to `JsonlEntry`.
After `tail_read` or `incremental_read`, scan for the last `custom-title` entry.

**Problem**: tail_read's 32KB window misses naming entries in 4/19 sessions (21%).
Increasing the window to cover naming entries would mean reading megabytes of data, negating the performance benefit of tail-reading.

### Approach B: Targeted reverse scan for naming entries

Read the last N bytes of the file.
If no `custom-title` found, double N and retry, up to a reasonable limit.
The entries are small (~100 bytes each), so the scan target is compact.

**Advantages**: finds the name without reading the entire file.
**Disadvantages**: adds complexity; naming entries could be anywhere in the file.

### Approach C: One-time full scan, then cache

On first encounter of a session, do a full scan for `custom-title`.
Cache the result in `SessionFileState.session_name`.
On subsequent `incremental_read` calls, update if a new `custom-title` appears.

**Advantages**: always correct; incremental reads are cheap.
**Disadvantages**: the initial full scan is slow for large files (5.7MB in the sample).

### Approach D: Read from `sessions-index.json` for container sessions too

The host's `sessions-index.json` at the host-path-encoded project dir already has `customTitle`.
When resolving container sessions, also check the host project dir's `sessions-index.json`.

**Advantages**: no JSONL parsing changes needed; leverages existing infrastructure.
**Disadvantages**: requires matching the container session to the correct host project dir's index entry. The `find_via_sessions_index` function is already called for local sessions; extending it to container paths is the natural approach.

### Priority for name sources

1. `customTitle` from `sessions-index.json` (most authoritative, user-set)
2. `customTitle` from JSONL `custom-title` entry (same data, different source)
3. `agentName` from JSONL `agent-name` entry (usually identical to customTitle)
4. `slug` from JSONL entries (auto-generated, not meaningful to users)

## Refactors Needed

### Minimal (Approach D only): extend container resolution to check sessions-index.json

**Scope**: ~20 lines in `resolver.rs`.

In `resolve_container_pane_via_mount()` and `find_best_project_session()`, after finding the session file path, check if a `sessions-index.json` exists in the same project directory and extract `customTitle` for the matching session entry.

Changes:
- `find_best_project_session()`: return `ResolvedSession` instead of `Option<PathBuf>`.
- `resolve_container_pane_via_mount()`: populate `session_name` on `SessionFileState`.

### Moderate (Approach D + C): add JSONL `custom-title` parsing as fallback

**Scope**: ~40 lines across `jsonl.rs` and `status.rs`.

Changes:
- `jsonl.rs`: add `custom_title: Option<String>` and `agent_name: Option<String>` fields to `JsonlEntry` (with serde rename).
- `status.rs`: add `extract_custom_title(entries) -> Option<String>` that scans entries in reverse for the last `custom-title` entry.
- `status.rs`: update `resolve_session_name()` to accept JSONL-derived custom_title as a third tier.
- `main.rs`: on initial tail_read, if no session_name yet, do a separate targeted scan of the file head for `custom-title` entries (or accept the 32KB window limitation).

### Full (Approach D + C + name change tracking)

**Scope**: ~60 lines.

Additional changes:
- `main.rs`: during `incremental_read`, check new entries for `custom-title` and update `session_state.session_name` if found.
- This handles mid-session renames without any scan.

## Pitfalls

### Duplicate pairs

`custom-title` and `agent-name` always appear in duplicate pairs per resume event.
This is harmless for name extraction: taking the last entry always gives the correct current name regardless of duplicates.

### Name changes mid-session

Two sessions show different names over their lifetime.
The correct behavior is to use the most recent `custom-title` value.
Incremental reads naturally handle this: if a new `custom-title` entry arrives, it overwrites the cached name.

### Container sessions: JSONL has no naming data

The core problem for container sessions is not JSONL parsing.
Container JSONL files have zero `custom-title` entries, zero `agent-name` entries, and usually zero `slug` fields.
The fix must come from outside the JSONL: either `sessions-index.json` (Approach D) or hook events carrying the session name.

### The `sessions-index.json` gap for containers

Container sessions under `-workspace` and `-home-node` have no `sessions-index.json`.
However, if the container mounts `~/.claude` from the host (which the sprack devcontainer feature does), the session file on disk is the same file the host's Claude CLI writes to.
The host-path-encoded project directory (e.g., `-var-home-mjr-code-weft-lace-main`) DOES have `sessions-index.json` with `customTitle`.
The challenge is matching the container session file to the correct host project directory entry.

The `hook_session_id` from `SessionStart` events could serve as the matching key: look up the session ID in the host project directory's `sessions-index.json`.

### Performance of full-file scans

The sample JSONL file is 5.7MB.
A line-by-line scan looking only for `"type":"custom-title"` lines (no full JSON parse) would take under 10ms.
A full `serde_json` parse of every line would take ~50-100ms.
Since this only happens once per session (on first discovery), either approach is acceptable.

## Recommendations

1. **Start with Approach D**: extend container resolution to check `sessions-index.json` from the host project directory, using the session ID as a matching key. This addresses the container naming problem at its root with minimal code change.

2. **Add JSONL `custom-title` parsing as a secondary source**: add the `customTitle` and `agentName` fields to `JsonlEntry`, extract them during `incremental_read`, and use them as a fallback when `sessions-index.json` is unavailable. This provides defense-in-depth and handles edge cases where the index is stale.

3. **Do not increase the tail_read window**: the 32KB window is sized for performance. Instead, rely on incremental reads to pick up naming entries as they arrive, and accept that the initial tail_read may miss them.

4. **For long-running sessions that predate these changes**: consider a one-time targeted reverse scan on initial session discovery, reading chunks from the end of the file until a `custom-title` entry is found or a size limit is reached. This is low priority since incremental reads will catch future naming events.
