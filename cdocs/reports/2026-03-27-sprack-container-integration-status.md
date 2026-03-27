---
first_authored:
  by: "@claude-opus-4-6-20250855"
  at: 2026-03-27T11:05:00-07:00
task_list: sprack/session-status
type: report
state: live
status: wip
tags: [sprack, status, container, podman, verification, architecture]
---

# Sprack Container Integration Status After Podman Migration

> BLUF: The podman migration (40+ commits, 2026-03-26 to 2026-03-27) successfully replaced all SSH transport with podman exec and established the sprack devcontainer feature with mount-based event resolution.
> The infrastructure works: container entry, session detection, hook bridge, and daemon auto-start are functional.
> The TUI still displays incorrect data: duplicated sessions, wrong names (slugs instead of custom titles), wrong states ("thinking" when waiting/idle), and stale container sessions for processes that are not running.
> The root cause is not any single bug but a structural mismatch between sprack's heuristic JSONL resolution pipeline and the reality of multi-agent, multi-container environments.
> Autonomous agents cannot close the remaining gaps because there is no automated way to assert "the TUI should show exactly these sessions with these names and states."

## Context / Background

Over 2026-03-26 to 2026-03-27, a major migration session produced:

- **Podman-first core runtime**: `getPodmanCommand()` replacing all hardcoded `"docker"` calls.
- **SSH to podman exec**: All bin scripts (`lace-into`, `lace-split`, `lace-discover`) converted.
- **Sprack devcontainer feature**: Mount at `/mnt/sprack/` with `SPRACK_EVENT_DIR`.
- **Sprack codebase decoupling**: Renamed `lace_*` to `container_*`, rewrote resolver for mount-based event resolution.
- **Hook bridge auto-detect**: Container mount path detection for event file writing.
- **5 targeted fixes**: Periodic tail_read fallback, SessionEnd handling, current_command guard, sessions-index.json lookup, JSONL custom-title parsing.

Despite all this work, the sprack TUI continues to show data that does not match reality.

## 1. What Works

### Container Entry (podman exec)

`lace-into`, `lace-split`, and `lace-discover` use `podman exec` for container entry.
The lace container (`lace`) is running and accessible:

```
$ podman ps --format '{{.Names}} {{.Status}}'
lace Up 13 hours
```

Pane `%40` in the `lace` tmux session runs `podman exec -it --user node --workdir /workspaces/lace/main lace /bin/bash -l`.

### Container Detection in sprack-poll

`sprack-poll` detects the `container_name` on sessions.
The `LACE` host group appears in the TUI tree, correctly separated from `LOCAL`.

### Sprack Mount and Hook Bridge

The devcontainer feature mounts at `/mnt/sprack/` with `SPRACK_EVENT_DIR` set.
The hook bridge auto-detect logic resolves container mount paths for event file writing.

### Daemon Auto-Start and Heartbeat

`sprack-claude` starts automatically with the TUI.
Heartbeat freshness checks are functional.

### --dump-rendered-tree as Verification Tool

The `--dump-rendered-tree` flag renders the same tree as the interactive TUI using a `TestBackend`.
This is the strongest available verification endpoint.

## 2. What Doesn't Work: Sprack Output vs Reality

### Current Sprack Output

```
$ cargo run --bin sprack -- --dump-rendered-tree --cols 120 --rows 40

LACE
  lace (1w) [lace] attached
    nu (2 panes) *
        claude/cuddly-wobbling-shannon [waiting]
          opus-4-6 | 347K/1M | 0 subagents | 9 turns
          Agent:3
          on main@cd6434a
        claude/cuddly-wobbling-shannon [waiting]
          opus-4-6 | 347K/1M | 0 subagents | 9 turns
          Agent:3
          on main@cd6434a
LOCAL
  lace-local (3w) attached
    claude (1 panes) *
          ~/code/weft/lace/main/pa... (sprack) [183x30] pid:1239123
    nu (1 panes)
        * ~/code/weft/lace/main/pa... (nu) [183x98] pid:3325081
    claude (2 panes)
        claude/jaunty-seeking-crescent [idle]
          opus-4-6 | 71K/1M | 0 subagents | 16 turns
          Edit:9 Read:2
          on main@3cb40bf
        claude/jaunty-seeking-crescent [idle]
          opus-4-6 | 71K/1M | 0 subagents | 16 turns
          Edit:9 Read:2
          on main@3cb40bf
  main (1w)
    nu (1 panes) *
        * ~/code/weft/lace/main/pa... (nu) [200x98] pid:2431869
```

### Ground Truth from tmux

```
$ tmux list-panes -a -F '#{session_name}:#{window_name} #{pane_id} #{pane_current_command} #{pane_pid} #{pane_title}'

lace:nu %40 podman 2628608 node@9c3a11cb20e3: /workspaces/lace/main
lace:nu %44 nu 2064362 ~/code/weft/lace/main/packages/sprack
lace-local:claude %10 claude 3319923 podman-mig
lace-local:claude %31 target/debug/sprack 1239123 ~/code/weft/lace/main/packages/sprack> pkill
lace-local:nu %11 nu 3325081 ~/code/weft/lace/main/packages/lace
lace-local:claude %12 claude 43814 adopt-lace
lace-local:claude %14 claude 519061 copy-mtg
main:nu %0 nu 2431869 ~/code/weft/lace/main/packages/sprack
```

### Actual Process State

Three Claude processes are running locally in `lace-local`:

| Pane | PID | Custom Title | Actual State |
|------|-----|-------------|--------------|
| %10 | 2328805 (child of 3319923) | podman-mig | Running (this agent session) |
| %12 | 2617077 (child of 43814) | adopt-lace | Running (has playwright subprocess) |
| %14 | 2664978 (child of 519061) | copy-mtg | Running (has playwright subprocess) |

No Claude process is running inside the lace container:

```
$ podman exec lace ps aux | grep claude
(no output)
```

### Discrepancy Table

| # | Discrepancy | Sprack Shows | Reality |
|---|-------------|-------------|---------|
| D1 | Container session exists when no Claude is running | `claude/cuddly-wobbling-shannon [waiting]` under LACE | No Claude process in lace container. Only bash shells. |
| D2 | Container session is duplicated | Two identical entries for `cuddly-wobbling-shannon` | The `lace:nu` window has 2 panes (`%40` podman, `%44` nu). Sprack attaches the same stale integration to both. |
| D3 | Session name is a slug, not custom title | `cuddly-wobbling-shannon` | This is a stale auto-generated slug from a debugging session. No active session to name. |
| D4 | Local sessions show wrong names | `jaunty-seeking-crescent` | The three Claude panes have custom titles: `podman-mig`, `adopt-lace`, `copy-mtg`. |
| D5 | Only 2 of 3 local Claude sessions shown | Shows `jaunty-seeking-crescent` x2 | Three distinct Claude sessions exist in panes %10, %12, %14. |
| D6 | Local session state may be wrong | `[idle]` for `jaunty-seeking-crescent` | At least one of the three sessions (this agent) is actively running. |
| D7 | Local sessions are duplicated | Two identical `jaunty-seeking-crescent` entries | The `lace-local:claude` window has 3 panes (%10, %12, %14) plus %31 (sprack itself). Sprack shows 2 entries. |

## 3. Root Cause Analysis

### D1/D2: Container Shows Sessions When No Claude Is Running

The resolver (`resolve_container_pane`) uses a multi-tier heuristic to find JSONL session files.
It searches `~/.claude/projects/<encoded-path>/` for the most recently modified `.jsonl` file.
The `cuddly-wobbling-shannon` session file was written during a prior agent debugging session inside the container.
That file still exists and is the most recent JSONL under the project directory encoding.

The 60-second `CONTAINER_SESSION_MAX_AGE` mtime check should eventually invalidate this, but the resolver re-discovers the same stale file on the next cycle because it is still the most recent file.
There is no mechanism to confirm that a Claude process is actually running inside the container.

The duplication occurs because both panes in the `lace:nu` window (`%40` podman, `%44` nu) are candidates.
The resolver attaches the same stale session to both because both panes exist in a window that the host-group logic associates with the lace container.

> WARN(opus/session-status): The container resolver has no liveness check.
> It finds session files but cannot verify whether the process that wrote them is still running.
> This is the fundamental architectural gap: JSONL files are artifacts, not probes.

### D3/D4: Wrong Session Names (Slugs Instead of Custom Titles)

Two naming paths exist:

1. **sessions-index.json lookup** (Fix 4): Requires hook event files with a `session_id` to match against. The lace container has no active hook events (no Claude is running), so this path is never activated.
2. **JSONL custom-title parsing** (Fix 5): Scans JSONL entries for `custom-title` or `agent-name` type entries. The stale session file has a slug but no `/rename` was performed, so only the slug is available.

For local sessions, the same issue applies: the JSONL files for `jaunty-seeking-crescent` lack `/rename` entries.
The user-set custom titles (`podman-mig`, `adopt-lace`, `copy-mtg`) are set via Claude Code's `/rename` command, which writes a `custom-title` entry to the JSONL.
If the resolver picks the wrong session file (or one without a rename entry), the slug is displayed.

> NOTE(opus/session-status): tmux pane titles (visible via `#{pane_title}`) contain the custom names, but sprack does not read tmux pane titles for session naming.
> It relies entirely on JSONL content.
> This is a design choice, but it means sprack's naming is always at least one step behind what the user sees in tmux.

### D5/D7: Missing and Duplicated Local Sessions

The `lace-local:claude` window contains panes %10, %12, %14 (three Claude instances) and %31 (sprack itself).
Sprack shows only 2 entries, both named `jaunty-seeking-crescent`.
This suggests the resolver is matching multiple panes to the same session file rather than resolving each pane to its own distinct session.

The resolver uses PID-based resolution for local panes: it walks `/proc/<pid>` to find the Claude process, then resolves its session file.
If the PID tree walking fails or resolves to the same project directory for multiple panes, the same session file gets attached to multiple panes.

### D6: Wrong State

The `jaunty-seeking-crescent` session shows `[idle]`.
If this session file corresponds to an actually-running Claude session, the state should be `[thinking]` or `[waiting]`.
If it corresponds to a stale file, `[idle]` may be correct for the last known state but the session should not be displayed at all.

## 4. Autonomous Verification Limitations

This is the most critical finding.

### The Pattern of "Verified" Claims

During the podman migration session, agents repeatedly reported "verified" while the TUI showed incorrect data.
The pattern:

1. Agent implements a fix.
2. Agent runs `cargo test --workspace` (passes).
3. Agent queries `state.db` via sqlite3 (data looks correct).
4. Agent reports "verified."
5. User runs `--dump-rendered-tree` and sees duplicated, stale, or wrongly-named sessions.

This happened across 5 separate fix cycles.

### Why cargo test Passing Doesn't Mean the Integration Works

The test suite (186 tests) verifies algorithm correctness in isolation: "given these JSONL entries, extract this state" or "given this session-cache.db, resolve this name."
The tests use synthetic fixtures with clean, controlled data.
They do not test the full pipeline: tmux query -> PID resolution -> session file discovery -> JSONL parsing -> DB write -> TUI render.

The integration failures are emergent: they arise from the interaction between stale files, multiple agents, container boundaries, and heuristic resolution.
No unit test can reproduce "an agent's debugging session left a stale JSONL file that the resolver picks up instead of the user's session."

### Why state.db Queries Are Insufficient

`state.db` shows what sprack-claude has written.
The TUI applies additional logic: host-group filtering, tree building, pane deduplication, and label formatting.
A row can exist in `process_integrations` for a pane_id that maps to a different visual location than expected.
Agents querying `state.db` see data that looks correct but renders differently.

### What --dump-rendered-tree Catches vs Misses

`--dump-rendered-tree` catches rendering problems: duplicated entries, wrong names, wrong states as displayed.
It does not catch:
- **Semantic correctness**: it shows `cuddly-wobbling-shannon [waiting]` but cannot determine whether this is correct. An agent would need to cross-reference against tmux and process state.
- **Absence of sessions**: if a session is missing from the tree, the agent needs to know it should be there. This requires knowing the expected state.
- **Transient states**: the tree is a single-frame snapshot. State transitions that resolve within a poll cycle are invisible.

### The Fundamental Gap

There is no automated way to assert: "the TUI should show exactly 3 sessions named `podman-mig`, `adopt-lace`, and `copy-mtg` with states `thinking`, `idle`, and `idle`."

What would be needed:

1. **A mock harness** that synthesizes tmux state (sessions, windows, panes with specific PIDs and commands) plus JSONL session files, writes them to a temp directory, runs the full pipeline, and asserts on the rendered tree output.
2. **Integration snapshot tests** that go beyond the current `test_render.rs` (which writes pre-formatted data to `state.db`) to include the resolution and ingestion stages.
3. **A ground-truth endpoint** that sprack exposes (e.g., `--dump-state` as proposed in the verification gap report) producing structured JSON of what the TUI shows, enabling programmatic comparison against expected state.

Without this, verification requires a human to look at the `--dump-rendered-tree` output and judge whether it matches what they expect.

## 5. Outstanding RFPs and Relevance

### claude-code-sqlite-mirror (`cdocs/proposals/2026-03-24-claude-code-sqlite-mirror.md`)

**Status:** `request_for_proposal`
**Relevance: Medium.**
This would replace sprack-claude's direct JSONL parsing with reads from a normalized SQLite mirror.
It would simplify the resolution pipeline but does not solve the core problems: the mirror would still ingest from the same JSONL files, and the session-to-pane mapping heuristic would remain.
Most helpful for: eliminating the incremental-read caching bugs (Fix 1 target), enabling richer status extraction.

### sprack-liveness-error-surfacing (`cdocs/proposals/2026-03-26-rfp-sprack-liveness-error-surfacing.md`)

**Status:** `request_for_proposal`
**Relevance: High.**
Directly addresses D1 (container sessions shown when no Claude is running) and the broader trust problem.
Data freshness indicators and daemon health checks would make the TUI honest about staleness.
If the TUI showed `[stale 45s]` instead of `[waiting]`, the user would know the data is unreliable.
This is the highest-impact RFP for the current problems.

### sprack-daemon-lifecycle (`cdocs/proposals/2026-03-25-sprack-daemon-lifecycle.md`)

**Status:** `request_for_proposal`
**Relevance: Medium.**
Addresses daemon coordination problems (stale file handles, crash recovery) that are real but not the primary cause of current TUI inaccuracies.
The daemons are running; they are just producing wrong data.

### sprack-self-healing-startup (`cdocs/proposals/2026-03-24-sprack-self-healing-startup.md`)

**Status:** `request_for_proposal`
**Relevance: Low for current issues.**
Addresses startup resilience (schema migration, stale PIDs, race conditions).
The current session is past startup; the problems are in steady-state operation.

### sprack-podman-integration-testing (`cdocs/proposals/2026-03-24-sprack-podman-integration-testing.md`)

**Status:** `request_for_proposal`
**Relevance: High.**
A podman-in-podman test harness would enable automated end-to-end testing of the full pipeline across container boundaries.
This directly addresses the verification gap: it would allow writing tests that assert on rendered output given a specific container configuration.
Combined with `--dump-rendered-tree`, this could close the "agents report verified but TUI is wrong" loop.

## Recommendations

### Immediate (Low-effort, high-impact)

1. **Add container liveness check to resolver**: Before accepting a resolved session file for a container pane, verify that a Claude process is actually running inside the container (via `podman exec <container> pgrep claude`). If not, discard the resolution.
2. **Surface data freshness in the TUI**: Implement the simplest version of the liveness-error-surfacing RFP: show `[stale Ns]` when integration data is older than a threshold.

### Short-term

3. **Read tmux pane titles as a naming signal**: The custom titles (`podman-mig`, `adopt-lace`, `copy-mtg`) are already available via `#{pane_title}`. Using them as a fallback (or primary) naming source would immediately fix D4.
4. **Implement `--dump-state` for structured verification**: JSON output of the full TUI state, enabling programmatic assertions by agents and test harnesses.

### Medium-term

5. **Build the podman integration test harness**: This is the only path to closing the autonomous verification gap. Without it, every future sprack change requires manual human verification.
6. **Elaborate the liveness-error-surfacing RFP**: Full proposal with error categorization, daemon health checks, and stale integration cleanup with TTL.

### Priority Assessment

The liveness-error-surfacing RFP and container liveness checks have the highest impact-to-effort ratio.
The podman integration testing RFP has the highest long-term value but requires the most upfront investment.
The sqlite-mirror and daemon-lifecycle RFPs address real problems but are not on the critical path for current TUI accuracy issues.
