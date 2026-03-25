---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T16:30:00-07:00
task_list: terminal-management/sprack-verifiability
type: report
state: live
status: wip
tags: [sprack, testing, container, verification]
---

# sprack Verifiability Analysis

> BLUF: The 76 existing tests are all in-process unit tests covering data structures, parsing, and DB round-trips.
> No tests exercise tmux interaction, `/proc` walking against real processes, session file discovery against real Claude directories, TUI rendering output, or the poll-DB-TUI pipeline.
> The container development environment creates a fundamental paradox: the most critical features (container boundary crossing, process host awareness) are untestable by definition from inside the container where development happens.
> A layered strategy with mock abstractions, synthetic filesystem fixtures, and ratatui's `TestBackend` can close most gaps, but host-side and cross-container scenarios require manual validation or a dedicated CI environment.

## 1. Current Test Coverage Audit

### 1.1 sprack-db (14 tests)

| Test | What It Covers | Category |
|------|---------------|----------|
| Schema creation | All 5 tables exist after `init_schema` | Unit |
| Idempotent schema | Second `init_schema` call is a no-op | Unit |
| Round-trip sessions | Write + read equality for sessions | Unit |
| Round-trip full state | Sessions, windows, panes write/read | Unit |
| CASCADE delete | Deleting a session cascades to children | Unit |
| Integration upsert | Second write updates existing row | Unit |
| ProcessStatus round-trip | `Display`/`FromStr` symmetry | Unit |
| data_version detection | `PRAGMA data_version` changes after writes | Unit (file-backed) |
| Heartbeat round-trip | Write + read heartbeat | Unit |
| Empty state | Fresh DB returns empty vectors | Unit |
| Foreign key enforcement | Pane with missing window fails | Unit |
| WAL concurrent read/write | Simultaneous reader + writer | Unit (file-backed) |
| Integration FK enforcement | Integration with missing pane fails | Unit |
| WAL verification | `journal_mode` is `wal` | Unit (file-backed) |

**Coverage quality:** Strong for the DB layer.
In-memory and file-backed SQLite tests cover schema, constraints, concurrent access, and round-trips.
No gaps in this crate's domain.

### 1.2 sprack-poll (19 tests)

| Module | Tests | What They Cover | Category |
|--------|-------|----------------|----------|
| tmux.rs | 10 | Output parsing, lace option parsing, `to_db_types` conversion, snapshot helpers | Unit (string parsing) |
| diff.rs | 5 | Hash equality/inequality, lace meta hash detection | Unit |
| main.rs | 4 | Full cycle write, noop detection, heartbeat persistence, state replacement | Integration-like (in-process) |

**Coverage quality:** Good for parsing and change detection.
The main.rs tests are the closest thing to integration tests in the project: they parse synthetic tmux output, convert to DB types, write to SQLite, and verify the result.
However, they never call a real tmux server.
`query_tmux_state()` and `query_lace_options()` are untested because they shell out to tmux.

### 1.3 sprack-claude (20 tests)

| Module | Tests | What They Cover | Category |
|--------|-------|----------------|----------|
| jsonl.rs | 8 | JSON parsing, tail reads, incremental reads against temp files | Unit |
| status.rs | 10 | Activity state extraction, context percent, subagent count, tool extraction, summary serialization | Unit |
| proc_walk.rs | 3 | Path encoding only (`encode_project_path`) | Unit |
| session.rs | 0 | No tests | - |
| main.rs | 0 | No tests (manual integration only) | - |

**Coverage quality:** Mixed.
JSONL parsing and status extraction are well-tested.
`proc_walk.rs` has only path encoding tests: `find_claude_pid` and `read_process_cwd` are untested because they read `/proc`.
`session.rs` (`find_session_file`, `find_via_sessions_index`, `find_via_jsonl_listing`) has zero tests.
The main loop orchestration (`run_poll_cycle`, `resolve_session_for_pane`, `process_claude_pane`) is untested.

### 1.4 sprack TUI (23 tests)

| Module | Tests | What They Cover | Category |
|--------|-------|----------------|----------|
| tree.rs | 12 | Label truncation, NodeId display/hash, shared prefix detection, host grouping, self-filter, build_tree output | Unit |
| layout.rs | 8 | Tier thresholds, body layout split logic | Unit |
| app.rs | 2 | Heartbeat freshness (non-empty = fresh, empty = stale) | Unit |
| render.rs | 0 | No tests | - |
| input.rs | 0 | No tests | - |
| colors.rs | 0 | No tests | - |

**Coverage quality:** Good for tree building and layout math.
Rendering is completely untested: no `TestBackend` usage, no frame assertions.
Input handling is untested.
The main event loop (`App::run`) is untested.

## 2. Testing Gap Analysis

### 2.1 Integration Gaps (No External Dependencies Tested)

**tmux interaction (sprack-poll):**
`query_tmux_state()` calls `tmux list-panes -a -F`, which requires a running tmux server.
`query_lace_options()` calls `tmux show-options` per session.
No test starts a tmux server, creates sessions/panes, and verifies the parse pipeline.

**`/proc` walking (sprack-claude):**
`find_claude_pid()` reads `/proc/<pid>/children` recursively.
`read_process_cwd()` reads `/proc/<pid>/cwd` symlink.
No test spawns a child process, walks `/proc` to find it, and verifies the resolution chain.

> NOTE(opus/sprack-verifiability): The `/proc/<pid>/children` path bug (must use `task/<tid>/children` on some kernels) was discovered manually during container boundary analysis, not by tests.
> A test that actually read `/proc` would have caught this.

**Session file discovery (sprack-claude):**
`find_session_file()` reads `sessions-index.json` or lists `.jsonl` files by mtime.
No test creates a synthetic `~/.claude/projects/` directory tree and verifies discovery.

**Poll-to-DB pipeline (sprack-poll + sprack-db):**
The sprack-poll main.rs tests parse synthetic strings and write to SQLite, covering `parse -> convert -> write -> read`.
The missing link: no test starts from `query_tmux_state()` (real tmux output) and verifies the full pipeline.

**DB-to-TUI pipeline (sprack-db + sprack):**
No test populates a DB and verifies that `App::refresh_from_db()` produces correct tree items.
No test renders a frame with `TestBackend` to verify visual output.

### 2.2 Container Boundary Gaps

**PID namespace isolation:**
sprack-claude's design assumes the Claude process is findable via `/proc/<pane_pid>/children`.
In the primary deployment (tmux on host, Claude Code in containers), pane PIDs are host-namespace PIDs.
The `/proc` walk from host PID cannot cross the container boundary.

There is no way to test this from inside the container without either:
- Nested containers (docker-in-docker)
- `--pid=host` namespace sharing
- Mock `/proc` filesystem

**Bind mount path resolution:**
Session files written by container-Claude use container-internal paths (`/home/node/.claude/...`).
Host-side resolution requires translating between host and container path encodings.
Testing this requires either actual host+container path divergence or synthetic path fixtures.

**Lace metadata resolution:**
The process host awareness strategy (derive session path from `@lace_workspace`) depends on lace tmux options.
Testing this end-to-end requires a tmux server with lace options set, plus a `~/.claude` directory with session files at the derived path.

### 2.3 TUI Rendering Gaps

**No snapshot tests:**
ratatui provides `backend::TestBackend` for offline rendering.
No test renders a frame and inspects the buffer contents.
Visual regressions are only detectable by running sprack manually.

**No input handling tests:**
`input::handle_key` and `input::handle_mouse` modify `App` state.
These are pure functions on `App` state and could be tested without a terminal.

## 3. The Container Boundary Testing Paradox

### 3.1 The Paradox

Development happens inside lace devcontainers.
The features that need testing are container-boundary features: detecting when a pane connects to a container, resolving session files across mount boundaries, translating paths between PID namespaces.

Testing container-boundary features from inside a container is paradoxical:
- Inside the container, there is only one PID namespace: no boundary to cross.
- Inside the container, paths are container-local: no translation needed.
- Inside the container, the `~/.claude` bind mount is transparent: no path mismatch.

The container boundary only manifests when there are two environments (host + container) with the boundary between them.

### 3.2 What Can Be Tested In-Container

| Feature | In-Container Testability | Strategy |
|---------|------------------------|----------|
| tmux output parsing | Full | Synthetic strings (existing) |
| DB schema and round-trips | Full | In-memory SQLite (existing) |
| JSONL parsing and status extraction | Full | Temp files (existing) |
| Path encoding (`encode_project_path`) | Full | Pure function (existing) |
| Session file discovery | Full | Synthetic `~/.claude` directory tree |
| Tree building from DB snapshot | Full | Synthetic `DbSnapshot` structs (existing) |
| Layout tier computation | Full | Pure function (existing) |
| TUI rendering | Full | `TestBackend` snapshots |
| Input handling | Full | `App` state mutations |
| `/proc` walking against local processes | Partial | Spawn child processes, walk `/proc` (single namespace only) |
| tmux integration | Full | Start tmux server in test, create sessions/panes |

### 3.3 What Cannot Be Tested In-Container

| Feature | Why Untestable | Mitigation |
|---------|---------------|------------|
| Cross-PID-namespace `/proc` walking | Requires two PID namespaces | Mock `/proc` filesystem, or nested container in CI |
| Host-to-container path translation | Requires host+container path divergence | Synthetic path fixtures, unit test with path pairs |
| `sessions-index.json` fullPath resolution across homes | Requires differing `$HOME` between writer and reader | Mock fixtures with container paths + host paths |
| lace-into SSH pane detection | Requires real lace-into sessions | Mock lace metadata in tmux options |
| Multi-container session aggregation | Requires multiple running containers | Synthetic DB state with multiple `lace_port` values |
| End-to-end: host tmux -> container Claude -> host TUI | Requires full lace deployment | Manual validation only |

### 3.4 Mock Strategies for Untestable Scenarios

**Mock `/proc` filesystem:**
Create a trait `ProcFs` with methods `children(pid) -> Vec<u32>` and `cmdline(pid) -> String`.
The real implementation reads `/proc`.
The test implementation uses an in-memory tree.
This allows testing the walk algorithm without real processes.

**Synthetic `~/.claude` directory tree:**
Create a temp directory with the structure:
```
$TMPDIR/claude-test/
  projects/
    -workspaces-lace-main/
      sessions-index.json
      session-uuid-1.jsonl
      session-uuid-2.jsonl
```
Point `find_session_file()` at this directory.
This tests the full discovery pipeline without a real Claude installation.

**Mock tmux server:**
Start a real `tmux -L test-socket new-session -d` in the test.
Create windows and panes.
Run `query_tmux_state()` against the test socket.
Tear down after test.
This requires tmux to be installed in the container (it is).

> WARN(opus/sprack-verifiability): The mock tmux strategy requires modifying `query_tmux_state()` to accept a socket path parameter, or setting `TMUX_TMPDIR` to isolate the test server.
> The current implementation hard-codes the default tmux socket.

## 4. Feature Verifiability Matrix

| Crate | Feature | In-Container Test | Requires Host | Requires Manual |
|-------|---------|-------------------|---------------|-----------------|
| sprack-db | Schema, CRUD, constraints | Yes (existing) | No | No |
| sprack-db | WAL concurrent access | Yes (existing) | No | No |
| sprack-poll | tmux output parsing | Yes (existing) | No | No |
| sprack-poll | Real tmux server query | Yes (mock server) | No | No |
| sprack-poll | Lace metadata reading | Yes (mock server) | No | No |
| sprack-poll | Change detection (hash diff) | Yes (existing) | No | No |
| sprack-claude | JSONL parsing | Yes (existing) | No | No |
| sprack-claude | Status extraction | Yes (existing) | No | No |
| sprack-claude | Path encoding | Yes (existing) | No | No |
| sprack-claude | Session file discovery | Yes (synthetic tree) | No | No |
| sprack-claude | `/proc` walk (same namespace) | Yes (spawn child) | No | No |
| sprack-claude | `/proc` walk (cross namespace) | No | Yes | Yes |
| sprack-claude | Process host awareness | Partially (mock metadata) | Yes (full) | Yes |
| sprack | Tree building | Yes (existing) | No | No |
| sprack | Layout computation | Yes (existing) | No | No |
| sprack | TUI rendering | Yes (TestBackend) | No | No |
| sprack | Input handling | Yes (state mutations) | No | No |
| sprack | End-to-end pipeline | Yes (mock tmux + DB) | No | No |
| All | Container boundary crossing | No | Yes | Yes |
| All | Multi-container aggregation | Partially (mock DB state) | Yes (full) | Yes |

## 5. CI Environment Considerations

The container development environment can run all in-container tests via `cargo test`.
No CI infrastructure exists for sprack.

A CI pipeline would need:
1. A container image with tmux installed (the devcontainer image already has this).
2. A tmux server started before test execution (for integration tests).
3. The ratatui `TestBackend` for rendering tests (no external dependencies).

Cross-container tests would require either:
- Docker-in-docker capability in CI (to spawn nested containers).
- A pre-configured multi-container environment.
- Acceptance that cross-container scenarios are manual-only.

Given the complexity, the pragmatic approach is: automate everything testable in-container, accept that cross-container scenarios are manual-only, and invest in mock abstractions that make the in-container tests as faithful as possible to the real deployment.

## 6. Summary of Findings

1. **76 tests, all unit-level.** No integration tests that exercise external dependencies (tmux, `/proc`, filesystem).
2. **Session file discovery has zero tests.** `session.rs` is entirely untested.
3. **`/proc` walking has only path encoding tests.** The actual walk logic is untested.
4. **TUI rendering has zero tests.** `render.rs`, `input.rs`, and `colors.rs` are untested.
5. **The container boundary paradox is real.** Cross-namespace scenarios cannot be tested from inside a single container.
6. **Most gaps are closable in-container.** Mock tmux servers, synthetic filesystem trees, `TestBackend` snapshots, and trait-based `/proc` abstraction can cover the majority of untested code.
7. **Cross-container testing requires infrastructure investment or manual validation.** No shortcut exists for testing features that inherently require two environments.
