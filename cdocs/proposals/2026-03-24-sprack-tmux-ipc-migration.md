---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T12:00:00-07:00
task_list: terminal-management/sprack-tmux-ipc
type: proposal
state: live
status: wip
tags: [architecture, tmux, sprack]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T14:00:00-07:00
  round: 1
---

# Sprack Tmux IPC Migration

> BLUF(opus/sprack-tmux-ipc): Migrate sprack-poll's tmux interaction from raw `Command::new("tmux")` with `||`-delimited format string parsing to `tmux-interface-rs` for structured, type-safe command execution.
> Keep the existing synchronous poll loop architecture.
> Defer tmux control mode to a future iteration: the polling approach is adequate for sprack's small dataset (dozens of panes), and the primary value of this migration is correctness (eliminating delimiter collisions) rather than performance.
> The TUI's fire-and-forget navigation commands should also migrate to `tmux-interface-rs` for consistency.

## Objective

Eliminate the fragile `||`-delimited format string parsing in sprack-poll by adopting `tmux-interface-rs` for all tmux CLI interactions.
This fixes the core correctness issue (a session named `foo||bar` breaks parsing) while providing typed error handling and tmux version feature flags.

The migration preserves the existing poll-sleep-poll architecture, SIGUSR1 hook integration, and hash-based change detection.
No async runtime is introduced.

## Recommended Approach

Three approaches were considered:

- **Approach A: tmux-interface-rs only.** Replace raw `Command` calls with the tmux-interface-rs library. Keep the synchronous poll loop.
- **Approach B: Control mode only.** Use tmux's control mode (`tmux -CC attach`) for event-driven state updates. Requires async runtime and persistent connection management.
- **Approach C: Hybrid.** Control mode for event triggers, tmux-interface-rs for data queries. Combines complexity of both.

Approach A is the clear recommendation.
The rationale:

1. **Polling works fine.** sprack monitors dozens of panes at most. One `tmux list-panes` subprocess per second is negligible. The hash-based deduplication already avoids unnecessary DB writes. There is no performance problem to solve.

2. **The real problem is correctness.** The `||` delimiter can collide with user-chosen session names, window names, or pane titles. This is the only fragility that has practical consequences. tmux-interface-rs eliminates delimiter-based parsing entirely by providing structured output.

3. **Control mode is high cost, low value right now.** It requires a persistent connection, a custom text protocol parser, an async or threaded event loop, and careful handling of connection lifecycle (server restarts, detach/reattach). The benefit: eliminating one subprocess per second. Not worth it for sprack's scale.

4. **Approach C is strictly worse than A for the current use case.** It adds all the complexity of control mode while still needing tmux-interface-rs for actual data queries. Two interaction mechanisms to maintain, no clear benefit over polling at sprack's scale.

> NOTE(opus/sprack-tmux-ipc): Control mode becomes valuable if sprack needs sub-second latency for state changes or if the dataset grows to hundreds of sessions.
> A future proposal can layer control mode on top of the tmux-interface-rs foundation built here.

## tmux-interface-rs Evaluation Plan

Before committing to the migration, validate that `tmux-interface-rs` covers sprack's needs.

### Format Variables to Test

Sprack uses 12 format variables via `list-panes -a -F`:

| Variable | Used For |
|---|---|
| `session_name` | Session grouping and identity |
| `session_attached` | Attached indicator in TUI |
| `window_index` | Window ordering and targeting |
| `window_name` | Display label |
| `window_active` | Active window highlighting |
| `pane_id` | Unique pane identity (`%N` format) |
| `pane_title` | Display label |
| `pane_current_command` | Process name display |
| `pane_current_path` | Working directory display |
| `pane_pid` | Process identification |
| `pane_active` | Active pane highlighting |
| `pane_dead` | Dead pane detection |

### Evaluation Steps

1. Add `tmux-interface` as a dev-dependency in sprack-poll.
2. Write a test binary that calls `ListPanes` with `-a` flag and inspects the returned struct fields.
3. Confirm each of the 12 variables is accessible as a typed field on the output struct, or can be retrieved via a custom `-F` format string passed through the library.
4. Verify `ListSessions` and `ShowOptions` cover the lace metadata queries.
5. Test against the devcontainer's tmux version (3.3a) to confirm compatibility.

### Interaction with Layout Organization

> NOTE(opus/sprack-tmux-ipc): The [layout organization proposal](2026-03-24-sprack-layout-organization.md) extends the format string from 12 to 19 fields.
> If layout organization lands first, the evaluation must cover all 19 fields.
> If IPC migration lands first, layout organization adds new fields via tmux-interface-rs instead of extending the format string.
> Recommended sequencing: layout organization first, then IPC migration.

### Acceptance Criteria

- All format variables (12 current, or 19 if layout organization has landed) are accessible via the library's API (either as struct fields or via custom format strings).
- `show-options -qvt` equivalent is available for lace metadata queries.
- Error types distinguish "not found" from "server not running" (matching the existing `TmuxError` variants).
- The library compiles on the project's MSRV without feature flag conflicts.

### Fallback

If tmux-interface-rs does not cover the required format variables:

- **Partial coverage**: Use the library for command construction and error handling, but pass custom `-F` format strings. This still eliminates the subprocess boilerplate and stderr parsing while keeping custom format strings for fields the library does not parse.
- **No coverage**: Abandon the library and implement a minimal abstraction layer in sprack-poll that issues individual `tmux list-sessions`, `tmux list-windows -t`, and `tmux list-panes -t` commands with single-field `-F` format strings (one field per call, no delimiter needed). This trades more subprocesses per cycle for complete delimiter safety. At sprack's scale (dozens of panes), the overhead is still negligible.

> NOTE(opus/sprack-tmux-ipc): The single-field-per-call fallback is a viable permanent solution, not just a stopgap.
> It eliminates the delimiter problem entirely by construction, at the cost of ~36 subprocesses per cycle instead of 1.
> For dozens of panes, this completes in under 100ms.

## Control Mode Analysis

### Feasibility

Control mode (`tmux -CC attach`) is technically feasible for sprack-poll.
The relevant notifications map to sprack's data model:

- `%sessions-changed` covers session create/destroy.
- `%window-add`, `%window-close`, `%window-renamed` cover window lifecycle.
- `%window-pane-changed` covers active pane changes.
- `%session-renamed` covers session renames.

However, control mode notifications carry minimal data (typically just session/window IDs).
Sprack needs 12 fields per pane, so each notification would still require a supplementary `list-panes` query to get the full state.
The net architecture would be: control mode triggers a re-query, replacing the 1-second timer as the trigger.
The actual data fetching remains the same.

### When to Pursue

Defer control mode to a future proposal.
Conditions that would justify it:

- Sprack needs sub-second responsiveness to tmux state changes (latency-sensitive features).
- The poll loop becomes a measurable resource problem (hundreds of sessions, constrained environment).
- SIGUSR1 hook-based triggering proves unreliable and control mode notifications are a better signal source.

None of these conditions exist today.

## Architecture

### sprack-poll Integration

The migration replaces the internals of `sprack-poll/src/tmux.rs` while preserving its public API surface.

```mermaid
graph TD
    A[main.rs poll loop] -->|calls| B[query_tmux_state]
    A -->|calls| C[query_lace_options]
    B -->|returns| D[TmuxSnapshot]
    C -->|returns| E[HashMap of LaceMeta]
    A -->|calls| F[to_db_types]
    F -->|returns| G[DB type vectors]

    subgraph "Current: raw Command"
        B1[Command::new tmux list-panes -a -F] --> B2[split on || delimiter] --> B3[build TmuxSnapshot]
    end

    subgraph "Proposed: tmux-interface-rs"
        B4[tmux_interface::ListPanes -a] --> B5[map library structs to TmuxSnapshot]
    end
```

Key changes in `tmux.rs`:

- **Fix** the stale module doc comment: it says "unit-separator-delimited" but the code uses `||` delimiters. The original implementation tried unit separators (`\x1f`), but tmux 3.3a converts non-printable characters to underscores, so it was changed to `||`. The doc comment was never updated. This migration eliminates both the delimiter and the stale comment.
- **Remove** `TMUX_FORMAT` constant, `EXPECTED_FIELD_COUNT`, `parse_single_line()`, and the `ParsedLine` struct.
- **Replace** `tmux_command()` helper with tmux-interface-rs API calls.
- **Replace** `query_tmux_state()` implementation: call `ListPanes` via the library, map the returned structs directly to `TmuxSnapshot`. No raw string output, no delimiter splitting.
- **Replace** `query_lace_options()` implementation: call `ShowOptions` via the library instead of `tmux_command(&["show-options", ...])`.
- **Preserve** `TmuxSnapshot`, `TmuxSession`, `TmuxWindow`, `TmuxPane`, `LaceMeta` structs unchanged. These are the public API consumed by `main.rs` and `to_db_types()`.
- **Preserve** `to_db_types()` unchanged.
- **Preserve** `TmuxError` enum, mapping from tmux-interface-rs error types.

### Hash-Based Change Detection

The current approach hashes the raw tmux output string for change detection.
With tmux-interface-rs, there is no single raw string to hash.

Two options:

1. **Hash the `TmuxSnapshot` struct.** Derive `Hash` on `TmuxSnapshot`, `TmuxSession`, `TmuxWindow`, `TmuxPane`. Compare snapshot hashes between cycles. This is cleaner and decouples change detection from output format.
2. **Serialize to a canonical string and hash that.** Construct a deterministic string representation of the snapshot and hash it. More fragile, no benefit over option 1.

Recommendation: option 1.
Add `#[derive(Hash)]` to the snapshot types and hash the struct directly.
This also eliminates the subtle bug where whitespace differences in raw output could cause false positives.

### sprack TUI Integration

The TUI's `focus_pane`, `focus_window`, and `focus_session` functions in `sprack/src/tmux.rs` use `Command::new("tmux")` with chained subcommands via `;` separators.
These should also migrate to tmux-interface-rs for consistency.

The TUI commands are simpler (fire-and-forget, no output parsing), so the migration is straightforward: replace `Command::new("tmux").args(...)` with the library's `SwitchClient`, `SelectWindow`, `SelectPane` builders.

> NOTE(opus/sprack-tmux-ipc): The `;` chaining of multiple tmux subcommands in a single `Command` invocation is a tmux-specific feature.
> Verify whether tmux-interface-rs supports command chaining or if each operation needs a separate library call.
> Separate calls are acceptable for fire-and-forget navigation: the latency difference is imperceptible.

## Delimiter Safety

tmux-interface-rs eliminates delimiter collisions by parsing tmux output through the library's own format handling rather than sprack's `||`-delimited string splitting.

If the library uses custom format strings internally, it controls the delimiter choice and parsing, so sprack no longer needs to worry about user content containing the delimiter.

If the fallback approach is needed (individual single-field queries), delimiter collisions are impossible by construction: each subprocess returns exactly one field value per line, with no delimiter between fields.

Either path eliminates the `foo||bar` session name problem completely.

## SIGUSR1 Hook Interaction

The SIGUSR1 signal mechanism is orthogonal to the tmux interaction layer and requires no changes.

The current flow:
1. Tmux hooks (set via `set-hook`) send SIGUSR1 to the sprack-poll PID on state changes.
2. `wait_for_signal()` in `main.rs` detects the signal and breaks out of the sleep interval.
3. The next poll cycle runs immediately.

The tmux-interface-rs migration only changes what happens inside the poll cycle (how tmux is queried and output is parsed).
The signal-based triggering, the sleep interval, and the `wait_for_signal()` function remain unchanged.

If control mode is added in a future iteration, SIGUSR1 hooks become redundant (control mode notifications replace them).
During that future transition, both mechanisms can coexist: SIGUSR1 is harmless when the poll loop is already running event-driven.
The hooks can be removed once control mode is stable.

## Async Runtime Decision

No async runtime is needed.

tmux-interface-rs communicates via synchronous subprocess calls, matching sprack-poll's existing blocking I/O model.
The poll loop in `main.rs` uses `std::thread::sleep` with periodic signal checks.
This architecture is simple, correct, and adequate for sprack's workload.

An async runtime (tokio) would only be justified for control mode's persistent connection, which is deferred.
Adding tokio for synchronous subprocess calls would be pure overhead.

## Migration Path

The migration is split into independently-landable steps.

### Step 1: Add tmux-interface-rs dependency and evaluate

- Add `tmux-interface` to `sprack-poll/Cargo.toml`.
- Write integration tests that call the library against a live tmux server.
- Verify coverage of all 12 format variables.
- Document any gaps.

This step can be reverted cleanly if the library does not meet needs.

### Step 2: Derive Hash on snapshot types

- Add `#[derive(Hash)]` to `TmuxSnapshot`, `TmuxSession`, `TmuxWindow`, `TmuxPane`.
- In `diff.rs`, add a `compute_snapshot_hash(snapshot: &TmuxSnapshot) -> u64` function that hashes the struct via `DefaultHasher`. The existing `compute_hash(&str)` remains for backward compatibility during the transition.
- In `main.rs`, move parsing before hashing: call `parse_tmux_output(&raw_output)` first, then `compute_snapshot_hash(&snapshot)` instead of `compute_hash(&raw_output)`.
- Remove the raw output string hashing path after Step 3 lands.

> NOTE(opus/sprack-tmux-ipc): `DefaultHasher` is not guaranteed stable across Rust compiler versions or platforms.
> This is fine for sprack-poll's use case: hashes are compared within a single process run and never persisted to disk.

This step should land together with or after Step 3, because landing it independently means parsing runs on every cycle (before the hash check), which is a minor efficiency regression.
The parsing cost for dozens of lines is negligible, but co-landing avoids the intermediate state.

### Step 3: Replace sprack-poll tmux interaction

- Rewrite `query_tmux_state()` to use tmux-interface-rs.
- Remove `TMUX_FORMAT`, `EXPECTED_FIELD_COUNT`, `parse_single_line()`, `ParsedLine`.
- Fix the stale module doc comment ("unit-separator-delimited" -> accurate description of the new tmux-interface-rs approach).
- Rewrite `query_lace_options()` to use the library's `ShowOptions`.
- Map library error types to `TmuxError`.
- Update all tests.

### Step 4: Replace sprack TUI tmux commands

- Add `tmux-interface` to `sprack/Cargo.toml`.
- Rewrite `focus_pane`, `focus_window`, `focus_session` to use library command builders.
- Verify navigation works via manual testing.

## Lace Option Queries

The per-session `query_lace_options()` function runs three `tmux show-options` commands per session, sequentially.
With tmux-interface-rs, these calls use the library's `ShowOptions` builder instead of raw `Command`, but the query pattern remains the same: three calls per session.

Batching optimization is not worth pursuing now.
For typical usage (2-5 sessions), this is 6-15 subprocesses per cycle, completing in under 50ms.
The overhead is negligible compared to the 1-second poll interval.

Control mode does not provide option-change notifications, so even with a future control mode migration, lace option queries would still require explicit calls.

> TODO(opus/sprack-tmux-ipc): If session count grows beyond ~20, consider batching lace option queries.
> One approach: `tmux show-options -g` to read all global options, then per-session overrides only.
> Another: set all lace metadata as session environment variables and read them via `show-environment -t`.

## TUI Commands

The TUI's fire-and-forget tmux commands (`switch-client`, `select-window`, `select-pane`) should migrate to tmux-interface-rs.

Rationale:
- Consistency: all tmux interaction goes through one library, reducing the number of interaction patterns to understand and maintain.
- Error handling: the library provides typed errors instead of raw exit codes.
- Version resilience: if tmux changes command syntax, the library handles it.

The TUI commands are low risk and low effort to migrate.
The current `;`-chained multi-command invocation may need to become separate library calls (one per tmux command), which is acceptable: the latency of three sequential subprocesses for navigation is imperceptible to the user.

## Implementation Phases

### Phase 1: Foundation (Steps 1-2)

- Evaluate tmux-interface-rs coverage.
- Derive Hash on snapshot types, migrate change detection.
- Outcome: validated library choice and improved change detection, with no behavioral changes visible to users.

### Phase 2: sprack-poll Migration (Step 3)

- Replace all tmux interaction in sprack-poll with tmux-interface-rs.
- Remove delimiter-based parsing entirely.
- Outcome: delimiter collision bug is fixed, typed errors and version resilience are gained.

### Phase 3: TUI Migration (Step 4)

- Replace tmux commands in the TUI crate.
- Outcome: consistent tmux interaction across both crates.

## Test Plan

### Unit Tests

- All existing `tmux.rs` unit tests are rewritten to test the new tmux-interface-rs-based implementation.
- Snapshot struct hashing tests verify that `#[derive(Hash)]` produces deterministic, change-sensitive hashes.
- `to_db_types()` tests remain unchanged (the function signature does not change).

### Integration Tests

- Live tmux server tests verify that tmux-interface-rs returns the same data as the current format string approach for a known tmux state.
- A comparison test runs both the old and new query paths against the same tmux server and asserts output equivalence.
- `diff.rs` tests verify that hash-based change detection works correctly with struct hashing.

### Manual Verification

- Run sprack-poll with the new implementation and confirm the TUI displays the same state as with the old implementation.
- Create a session with `||` in the name and confirm it is parsed correctly (the original bug that motivated this work).
- Test SIGUSR1 triggering to confirm immediate poll cycles still work.
- Test tmux server absence and restart to confirm error handling and the 60-second timeout.
- Test TUI navigation (Enter on session/window/pane nodes) after migrating to tmux-interface-rs.

## Open Risks

1. **tmux-interface-rs format coverage gap.** The library may not expose all 12 format variables sprack needs as typed fields. Mitigation: the fallback approach (custom format strings through the library, or single-field-per-call queries) is well-defined and eliminates the delimiter problem regardless.

2. **tmux-interface-rs maintenance.** The crate is maintained but has a small user base. Evaluate commit frequency, issue response time, and tmux version tracking before committing. If it becomes unmaintained, sprack would need to fork or revert to direct `Command` calls with the single-field-per-call pattern. Mitigation: the migration is contained to `tmux.rs` in both crates, so reverting is localized.

3. **tmux version compatibility.** tmux-interface-rs uses feature flags for version-specific behavior. Sprack has no minimum tmux version requirement. If the library's version detection does not match the user's tmux version, queries may fail. Mitigation: test against tmux versions in common use (3.2+), document minimum supported version.

4. **Hash migration correctness.** Switching from raw-string hashing to struct hashing changes what constitutes a "change." Fields that were previously ignored in the raw output (e.g., trailing whitespace) may cause a one-time full rewrite on upgrade. This is benign: the DB write is idempotent.

5. **Command chaining in TUI.** If tmux-interface-rs does not support `;`-chained commands, the TUI migration requires three sequential subprocess calls for pane focus. The latency impact is expected to be negligible but should be measured.
