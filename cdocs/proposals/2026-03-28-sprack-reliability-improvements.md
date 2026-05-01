---
first_authored:
  by: "@claude-opus-4-6-20250625"
  at: 2026-03-28T10:48:00-07:00
task_list: sprack/reliability-improvements
type: proposal
state: live
status: review_ready
last_reviewed:
  status: revision_requested
  by: "@claude-sonnet-4-6"
  at: 2026-03-28T12:00:00-07:00
  round: 1
tags: [sprack, architecture, reliability]
---

# Sprack Reliability Improvements: Recon-Informed Pre-Parking Fixes

> BLUF: Three targeted improvements to sprack-claude before parking the workstream: (1) `capture-pane` as a secondary status signal to eliminate stale-thinking false positives, (2) `/clear` successor detection to fix session file staleness, and (3) `/model` command parsing for faster model switch detection and effort level tracking.
> Total estimated scope: ~150-200 lines across 4 files in the sprack-claude crate, plus ~80 lines of tests.
> These fixes address sprack's most visible correctness issues without architectural changes, leaving the codebase in a known-good state for eventual resumption.

## Summary

This proposal synthesizes findings from three recon evaluation reports into a concrete implementation plan:
- [State inspection techniques comparison](../reports/2026-03-28-recon-state-inspection-techniques.md): identifies capture-pane and /clear detection as high-value backports.
- [Session monitoring recommendations](../reports/2026-03-28-claude-session-monitoring-recommendations.md): frames these as pre-parking tasks.
- [Claude Code internals research](../reports/2026-03-08-gemini-claude-internals-research-report.md): confirms the JSONL state model and documents additional signals (lock files, stats-cache, AskUserQuestion detection) that inform edge case handling.

> NOTE(opus/sprack/reliability-improvements): This proposal deliberately excludes the turn count inflation bug.
> That fix involves wiring `ingestion_state` byte offset tracking into the ingest loop in `cache.rs`, which is a separate concern from status detection.
> It should be addressed in a dedicated proposal or as a standalone fix.

## Objective

Fix the three most impactful data-correctness issues in sprack-claude's session monitoring pipeline:

1. **Stale "Thinking" state**: when a Claude stream is interrupted or completes without writing a final `end_turn` entry, the JSONL shows `stop_reason: null` indefinitely. Sprack displays "Thinking" for sessions that are actually idle.
2. **Post-`/clear` session staleness**: when a user runs `/clear`, a new JSONL file is created but `sessions/{PID}.json` still points to the old session ID. Sprack continues reading the old (now-frozen) JSONL.
3. **Delayed model switch detection**: when a user runs `/model` to switch models or effort level, sprack shows the old model until the next assistant message arrives. The `/model` command output is already in the JSONL but sprack doesn't parse it.

## Background

### Current Status Detection (status.rs)

`extract_activity_state()` examines the last meaningful JSONL entry:
- `assistant` with `stop_reason: null` -> Thinking
- `assistant` with `stop_reason: "tool_use"` -> ToolUse
- `assistant` with `stop_reason: "end_turn"` -> Idle
- `user` entry -> Waiting
- No meaningful entries -> Error

The critical weakness: `stop_reason: null` is written when Claude begins streaming a response.
If the stream is interrupted (network error, context limit, crash) or if the JSONL flush is delayed, the null value persists and is indistinguishable from active thinking.
The periodic tail_read refresh (every 5 cycles / ~10 seconds) helps but does not solve this: if the file content hasn't changed, the stale entry remains the last meaningful one.

### Recon's Approach

Recon sidesteps this entirely by reading the terminal pane content via `tmux capture-pane -t <target> -p`.
It scans the last 10 non-empty lines for:
- Spinner characters (Unicode dingbats U+2720..U+2767, record symbol U+23FA, middle dot U+00B7) with ellipsis -> Working
- "Esc to cancel" or selection prompt (U+276F + digit) -> Input (awaiting user)
- Anything else -> Idle

This is real-time and always reflects the actual TUI state.
The downside is fragility: any change to Claude Code's TUI rendering breaks the detection.

### The Dual-Signal Approach

Neither JSONL-only nor pane-only detection is sufficient alone.
JSONL provides semantic state (Thinking vs ToolUse vs Waiting) but can go stale.
Pane content provides visual state (Working vs Input vs Idle) but lacks semantic granularity.

The proposed solution: JSONL remains primary, capture-pane acts as a tiebreaker for ambiguous states.

## Proposed Solution

### Improvement 1: Capture-Pane Secondary Status Signal

Add a `tmux_status.rs` module to sprack-claude that:
1. Calls `tmux capture-pane -t <pane_target> -p` to read pane content.
2. Scans the last 10 non-empty lines for Working/Input/Idle indicators.
3. Returns a `PaneVisualStatus` enum: `Working`, `Input`, `Idle`, `Unknown`.

Integrate into `process_claude_pane()` in main.rs:
- After `extract_activity_state()` returns `Thinking`, check pane visual status.
- If the JSONL says Thinking but the pane says Idle for 2+ consecutive poll cycles, override to `Idle`.
- If the JSONL says Thinking but the pane says Input, override to `Waiting`.
- All other JSONL states pass through unchanged (ToolUse, Idle, Waiting, Error).

The consecutive-cycle requirement prevents false overrides during the brief moment when Claude has started thinking but the pane hasn't rendered the spinner yet.

```rust
// tmux_status.rs (new file)

pub enum PaneVisualStatus {
    Working,   // spinner + ellipsis visible
    Input,     // "Esc to cancel" or selection prompt
    Idle,      // no activity indicators
    Unknown,   // capture-pane failed or pane not accessible
}

/// Captures the visual status of a tmux pane.
/// `pane_id` is the tmux pane identifier (e.g., "%42") from the `pane_id` field
/// on the `Pane` struct, which maps to tmux's `#{pane_id}` format string.
pub fn capture_pane_status(pane_id: &str) -> PaneVisualStatus {
    // tmux capture-pane -t <pane_id> -p
    // scan last 10 non-empty lines
    // match spinner chars, "Esc to cancel", selection prompt
    // Return Unknown (not Idle) if pane is in copy mode or output is ambiguous
}
```

The caller in `process_claude_pane()` passes `pane.pane_id` (the `%N` identifier from sprack-poll's tmux query).

The status override logic lives in a dedicated function that owns both the state transition and the counter mutation:

```rust
// status.rs: new function

/// Resolves final status using JSONL as primary signal and pane visual as tiebreaker.
/// Mutates `consecutive_idle_overrides` on `state` to track the two-cycle delay.
/// Only called for local (non-container) panes.
pub fn resolve_status_with_pane(
    jsonl_state: ProcessStatus,
    visual: PaneVisualStatus,
    state: &mut SessionFileState,
) -> ProcessStatus {
    if jsonl_state != ProcessStatus::Thinking {
        state.consecutive_idle_overrides = 0;
        return jsonl_state;
    }
    match visual {
        PaneVisualStatus::Idle if state.consecutive_idle_overrides >= 1 => {
            state.consecutive_idle_overrides = 0;
            ProcessStatus::Idle
        }
        PaneVisualStatus::Idle => {
            state.consecutive_idle_overrides += 1;
            ProcessStatus::Thinking // wait one more cycle
        }
        PaneVisualStatus::Input => {
            state.consecutive_idle_overrides = 0;
            ProcessStatus::Waiting
        }
        _ => {
            state.consecutive_idle_overrides = 0;
            ProcessStatus::Thinking
        }
    }
}
```

```rust
// main.rs integration (sketch)

let jsonl_state = extract_activity_state(&entries);
let final_state = if container_name.is_none() {
    let visual = capture_pane_status(&pane.pane_id);
    resolve_status_with_pane(jsonl_state, visual, &mut state)
} else {
    state.consecutive_idle_overrides = 0;
    jsonl_state
};
```

> NOTE(opus/sprack/reliability-improvements): Capture-pane only works for local tmux panes.
> Container sessions accessed via `podman exec` may not have a directly-capturable pane (the pane shows the podman exec process, not Claude's TUI).
> For container panes, the override should not be applied: return `PaneVisualStatus::Unknown` and leave the JSONL state unchanged.

### Improvement 2: /clear Successor Detection

When resolving a session file, check whether a newer JSONL exists in the same project directory that was born from a `/clear` command.

Add a `find_clear_successor()` function to `session.rs`:

```rust
pub fn find_clear_successor(
    current_file: &Path,
    project_dir: &Path,
) -> Option<PathBuf> {
    let current_mtime = fs::metadata(current_file).ok()?.modified().ok()?;

    let mut candidates: Vec<(PathBuf, SystemTime)> = fs::read_dir(project_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension() == Some("jsonl".as_ref()))
        .filter(|e| e.path() != current_file)
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            (mtime > current_mtime).then(|| (e.path(), mtime))
        })
        .collect();

    candidates.sort_by_key(|(_, mtime)| *mtime);

    for (path, _) in candidates {
        if is_clear_born(&path) {
            return Some(path);
        }
    }
    None
}

fn is_clear_born(path: &Path) -> bool {
    // Read first ~2KB, check first 5 lines for:
    // <command-name>/clear</command-name>
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let reader = BufReader::new(file);
    for line in reader.lines().take(5).flatten() {
        if line.contains("<command-name>/clear</command-name>") {
            return true;
        }
    }
    false
}
```

Integration points:
- **Local panes (resolver.rs, `LocalResolver::resolve()`)**: after `find_best_project_session()` returns a file, call `find_clear_successor()`. If a successor exists, use it instead and reset `file_position` to 0.
- **Container panes (resolver.rs, `resolve_container_pane()`)**: same check after project directory resolution (tiers 2 and 3). Hook event resolution (tier 1) already provides the correct file path so the check is unnecessary there.
- **Cache invalidation**: add a `last_clear_check` timestamp to `SessionFileState`. Only run the directory scan every 30 seconds to avoid excessive I/O on each 2-second poll cycle.

### Improvement 3: /model Command Parsing

Extract model switches and effort levels from `/model` command output in JSONL entries.

When a user runs `/model` in Claude Code, the output is recorded as a user or system entry containing:
```
<local-command-stdout>Set model to Opus 4.6 (claude-opus-4-6) with max effort</local-command-stdout>
```

Add parsing to `status.rs`:

```rust
pub struct ModelOverride {
    pub model_id: String,
    pub effort: Option<String>, // "max", "high", "min"
}

pub fn extract_model_override(entries: &[JsonlEntry]) -> Option<ModelOverride> {
    // Scan entries in reverse for the most recent /model command output
    for entry in entries.iter().rev() {
        if entry.entry_type == "user" || entry.entry_type == "system" {
            // Check raw content for <local-command-stdout>Set model to...
            // 1. Strip ANSI escape codes
            // 2. Extract model ID from parenthetical: "Set model to Opus 4.6 (claude-opus-4-6)"
            //    Regex: r"Set model to .+? \(([^)]+)\)"  -> capture group 1 is the model ID
            // 3. Extract effort if present: "with (max|high|min) effort"
            //    Regex: r"with (max|high|min) effort"  -> capture group 1 is effort level
        }
    }
    None
}
```

The model ID is extracted directly from the parenthetical in the output string (e.g., `(claude-opus-4-6)`), not from a display name lookup table.
This is robust to new model releases since Claude Code always includes the API model ID in the parenthetical.

Integration:
- In `process_claude_pane()`, call `extract_model_override()` after JSONL parsing.
- If a model override is found and differs from the assistant message's model, use the override.
- Store the override in `SessionFileState` so it persists across poll cycles until a new assistant message confirms the switch.
- Add `effort_level` to `ClaudeSummary` as a new optional field.

## Important Design Decisions

**1. Capture-pane is opt-in for container panes.**
Container panes run `podman exec` and the visible content is the container's shell/claude, relayed through podman.
The pane content may not accurately reflect Claude's state (e.g., podman exec output interleaved with Claude's TUI).
For safety, capture-pane override only applies to panes where `container_name` is `None`.

**2. Two-cycle delay before Thinking -> Idle override.**
A single capture-pane reading of "Idle" while JSONL says "Thinking" could be a transient race: Claude just started thinking but the spinner hasn't appeared yet.
Requiring 2 consecutive cycles (4 seconds) eliminates this false positive.
This delay is acceptable: the alternative (no override) leaves the display stale indefinitely.

**3. /clear check is rate-limited, not per-cycle.**
Scanning a project directory every 2 seconds is wasteful.
A 30-second interval is sufficient: `/clear` is a low-frequency user action, and a 30-second delay in detecting it is acceptable.
The rate limit is per-session, tracked via `last_clear_check` on `SessionFileState`.

**4. Model override is advisory, not authoritative.**
The `/model` command output is used only until the next assistant message provides the actual model ID.
This prevents stale overrides from persisting if parsing fails or the display name mapping is wrong.

**5. No new external dependencies.**
All three improvements use existing primitives: `Command::new("tmux")` for capture-pane, `fs::read_dir` for /clear detection, string parsing for /model.
No new crates are introduced.

## Edge Cases / Challenging Scenarios

### Capture-Pane

- **Pane in copy mode or scrolled**: `capture-pane` returns the visible viewport, which may show historical output, not the current status bar. Mitigation: scan from the bottom up and only check the last 10 lines. If none match any pattern, return `Unknown` rather than `Idle`.
- **Claude TUI rendering changes**: if Anthropic changes the spinner characters or "Esc to cancel" text, detection breaks silently. Mitigation: this is the same risk recon takes; the override is a best-effort improvement, not a correctness guarantee. JSONL remains the primary signal.
- **Multiple Claude instances in one pane**: not possible (tmux panes are 1:1 with processes). Not an edge case.
- **Pane closed between status check and capture**: `tmux capture-pane` returns an error. Return `Unknown`, no override applied.

### /clear Successor

- **Multiple /clear in rapid succession**: each `/clear` creates a new JSONL. `find_clear_successor()` returns the newest clear-born file, which is correct.
- **Non-clear new JSONL in same directory**: subagent sessions also create new JSONL files in the project directory. The `is_clear_born()` check (first 5 lines contain `/clear` marker) distinguishes these. Subagent files do not have the `/clear` command marker.
- **Concurrent sessions in same project**: two Claude instances in the same project directory produce two active JONLs. The PID-based resolution (local) or hook event resolution (container) disambiguates, so `/clear` detection only runs after the correct session file is already identified. The successor search is scoped to "newer than the currently-resolved file."
- **Session file rotated/deleted**: `find_clear_successor()` handles missing files via `.ok()` chains. Returns `None`, no override.

### /model Command Parsing

- **User types `/model` without changing anything**: the output still contains "Set model to..." with the current model. The parsed model matches the existing one, no change.
- **ANSI escape codes in output**: recon strips ANSI codes before parsing. We should do the same. A simple regex `\x1b\[[0-9;]*m` covers the common cases.
- **Effort level not present**: older Claude versions or certain model switches may not include "with X effort". The effort field is `Option<String>`, defaults to `None`.

## Test Plan

### Unit Tests (status.rs)

1. **capture-pane parsing**: feed known pane content strings to `capture_pane_status()` and verify Working/Input/Idle/Unknown classification.
   - Pane with spinner + ellipsis -> Working
   - Pane with "Esc to cancel" -> Input
   - Pane with selection prompt (U+276F + digit) -> Input
   - Pane with normal code output -> Idle
   - Empty pane -> Unknown
   - Pane in copy mode (no spinner, no prompt) -> Unknown

2. **status override logic**: test the two-cycle delay mechanism.
   - JSONL=Thinking, Pane=Idle, cycle 1 -> Thinking (not yet)
   - JSONL=Thinking, Pane=Idle, cycle 2 -> Idle (override)
   - JSONL=Thinking, Pane=Working -> Thinking (no override)
   - JSONL=Thinking, Pane=Input -> Waiting (immediate override)
   - JSONL=ToolUse, Pane=Idle -> ToolUse (no override, JSONL is not Thinking)

3. **/clear detection**: test `is_clear_born()` and `find_clear_successor()`.
   - File with `/clear` marker in line 3 -> true
   - File without marker -> false
   - Project dir with no newer files -> None
   - Project dir with newer clear-born file -> Some(path)
   - Project dir with newer non-clear file (subagent) -> None

4. **/model parsing**: test `extract_model_override()`.
   - Entry with "Set model to Opus 4.6 (claude-opus-4-6) with max effort" -> ModelOverride { model_id: "claude-opus-4-6", effort: Some("max") }
   - Entry with "Set model to Sonnet 4.6 (claude-sonnet-4-6)" (no effort) -> ModelOverride { model_id: "claude-sonnet-4-6", effort: None }
   - Entry with ANSI codes -> stripped and parsed correctly
   - No /model entries -> None

### Integration Tests

5. **End-to-end override**: mock a `SessionFileState` through multiple poll cycles with stale Thinking JSONL + Idle pane, verify the state transitions correctly after 2 cycles.

6. **Clear successor in resolver**: create a temp directory with old JSONL + newer clear-born JSONL, call `find_clear_successor()`, verify it returns the correct path.

## Verification Methodology

For each improvement, verification follows the same pattern:

1. **Unit tests**: `cargo test -p sprack-claude` must pass with the new tests.
2. **Manual verification**: run sprack-claude alongside a live Claude session and:
   - For capture-pane: let a Claude session go idle, verify sprack shows Idle (not stuck on Thinking). Then start a new prompt, verify sprack shows Thinking/ToolUse promptly.
   - For /clear: run `/clear` in a Claude session, verify sprack picks up the new session within ~30 seconds.
   - For /model: run `/model sonnet` in a Claude session, verify sprack shows "sonnet" before the next assistant message.
3. **Regression**: verify existing tests pass. Run `cargo clippy -p sprack-claude` for lint cleanliness.
4. **Render tree check**: use `sprack --dump-rendered-tree` to confirm the TUI renders the new fields (effort level) correctly.

> WARN(opus/sprack/reliability-improvements): Manual verification of capture-pane requires a real tmux session with Claude running.
> The unit tests mock the tmux command output, but the end-to-end behavior (timing, pane content format) can only be verified live.

## Implementation Phases

### Phase 1: Capture-Pane Status Module

**Files:** `src/tmux_status.rs` (new), `src/main.rs` (mod declaration)

1. Create `tmux_status.rs` with `PaneVisualStatus` enum and `capture_pane_status()` function.
2. Implement pane content scanning: call `tmux capture-pane -t <target> -p`, collect output lines, scan last 10 non-empty lines bottom-up.
3. Implement character matching for Working (spinner + ellipsis), Input ("Esc to cancel", U+276F), Idle (fallback).
4. Return `Unknown` on any error (command failure, empty output).
5. Write unit tests for the parsing logic with known pane content fixtures.

**Success criteria:** `capture_pane_status()` correctly classifies all test fixtures. No external command execution in tests (mock the tmux output).

### Phase 2: Status Override Integration

**Files:** `src/main.rs`, `src/status.rs` (new `resolve_status_with_pane()` function)

1. Add `consecutive_idle_overrides: u32` field to `SessionFileState`.
2. Add `resolve_status_with_pane()` in `status.rs` that takes the JSONL state, pane visual status, and mutable `SessionFileState` ref. The function owns both the state transition decision and the `consecutive_idle_overrides` counter mutation.
3. In `process_claude_pane()`, after `extract_activity_state()`, call `capture_pane_status()` for local (non-container) panes.
4. Apply the two-cycle delay logic via `resolve_status_with_pane()`.
5. Skip capture-pane for container panes (`container_name.is_some()`).
6. Write unit tests for the override logic (all combinations of JSONL state x pane state x cycle count).

**Success criteria:** override logic passes all unit tests. Manual verification shows correct Thinking -> Idle transition for idle sessions.

### Phase 3: /clear Successor Detection

**Files:** `src/session.rs` (new functions), `src/resolver.rs` (integration), `src/main.rs` (cache field)

1. Add `find_clear_successor()` and `is_clear_born()` to `session.rs`.
2. Add `last_clear_check: Option<Instant>` to `SessionFileState`.
3. Add a `check_clear_successor()` helper that gates on `last_clear_check`: if `None` or 30+ seconds elapsed, call `find_clear_successor()` and update `last_clear_check` to `Instant::now()`. Returns `Option<PathBuf>`.
4. Call `check_clear_successor()` in `process_claude_pane()` after session file resolution, before JSONL reading. This is the single integration point for both local and container paths. Skip for container panes resolved via tier 1 (hook events), since the hook already provides the correct file.
5. If a successor is found, update `session_file`, reset `file_position` to 0, reset `last_entries`, clear `session_name`.
6. Write unit tests with temp directories containing old + clear-born JSONL files.

**Success criteria:** `find_clear_successor()` correctly identifies clear-born successors and ignores subagent files. Integration test shows session file switching.

### Phase 4: /model Command Parsing

**Files:** `src/status.rs` (new functions), `src/main.rs` (integration)

1. Add `ModelOverride` struct and `extract_model_override()` to `status.rs`.
2. Add ANSI stripping utility (simple regex `\x1b\[[0-9;]*m` or byte-level filter).
3. Parse model ID from parenthetical via regex `r"Set model to .+? \(([^)]+)\)"`. No display name mapping table needed.
4. Add `model_override: Option<ModelOverride>` and `effort_level: Option<String>` to `SessionFileState`.
5. In `process_claude_pane()`, call `extract_model_override()` after JSONL parsing.
6. Use the override model if present and no assistant message provides a newer model.
7. Add `effort_level` to `ClaudeSummary` JSON output.
8. Write unit tests for parsing with and without ANSI codes, with and without effort levels.

**Success criteria:** model override correctly parsed from test fixtures. `effort_level` appears in ClaudeSummary when present. Existing tests unaffected.

### Phase 5: Verification and Cleanup

**Files:** all modified files

1. Run full test suite: `cargo test -p sprack-claude`.
2. Run `cargo clippy -p sprack-claude` and fix any warnings.
3. Manual verification of all three improvements against a live Claude session.
4. Verify `sprack --dump-rendered-tree` renders correctly with new fields.
5. Commit with detailed message referencing this proposal.
