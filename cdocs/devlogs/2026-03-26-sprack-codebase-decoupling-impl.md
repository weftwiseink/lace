---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T14:00:00-07:00
task_list: sprack/lace-decoupling
type: devlog
state: live
status: done
tags: [sprack, decoupling, architecture, container]
---

# Sprack Codebase Decoupling Implementation: Devlog

## Objective

Implement the remaining phases from `cdocs/proposals/2026-03-26-sprack-codebase-decoupling.md`.
The DB schema rename (`lace_port` to `lace_container`) and multi-directory event scanning are already landed.
The remaining work: rename all `lace_`-prefixed identifiers to `container_*` on the sprack side, delete the `LaceContainerResolver` and bind-mount prefix-matching code, re-enable git context for container panes, update TUI display, and final cleanup.

## Plan

1. **Phase 1: Remaining renames** across sprack-poll (diff.rs, main.rs, tmux.rs), sprack-db (lib.rs, types.rs, schema.rs, read.rs, write.rs), sprack TUI (tree.rs, test_render.rs), and sprack-claude (resolver.rs, main.rs).
2. **Phase 2: Container resolution rewrite** - delete `LaceContainerResolver`, bind-mount prefix-matching, replace with mount-based event resolution.
3. **Phase 3: Git context re-enablement** - extend git resolution gate to container panes using mount metadata and podman exec fallback.
4. **Phase 4: TUI display updates** - remove disabled git context block, ensure container name display.
5. **Phase 5: Final cleanup** - grep for remaining `lace_` references, update doc comments, remove stale TODOs.

## Testing Approach

`cargo check --workspace && cargo test --workspace` in `packages/sprack/` after every phase.
Commit after each passing phase.

## Implementation Notes

### Phase 1

Renamed all `lace_container/user/workspace` struct fields to `container_name/user/workspace` across all four crates.
Key renames: `LaceMeta` to `ContainerMeta`, `query_lace_options` to `query_container_options`, `build_lace_session_map` to `build_container_session_map`, `parse_lace_option` to `parse_tmux_option`.
The DB schema SQL columns were also renamed (`lace_container` to `container_name`, etc.).
One insta snapshot required update because the TUI session label changed from displaying `:22427` (port) to `[remote-app]` (container name).

### Phase 2

Deleted the `LaceContainerResolver`, `find_container_project_dir()`, `newest_jsonl_mtime()`, and all bind-mount prefix-matching code.
The new `resolve_container_pane_via_mount()` searches `event_dirs()` for hook bridge event files matching the workspace cwd, extracts `transcript_path` from `SessionStart` events when available, and falls back to `~/.claude/projects/` directory matching.
The `filetime` dev-dependency was removed since it was only used by the deleted tests.
Net deletion: ~215 lines removed, ~50 lines added.

### Phase 3

Extended the git resolution gate from `CacheKey::Pid` to also handle `CacheKey::ContainerSession`.
Added `resolve_container_git_state()` with two paths:
- Primary: reads `state.json` from `~/.local/share/sprack/lace/*/metadata/`, matching by `container_name` field inside the JSON.
- Fallback: runs `podman exec <container> git rev-parse` commands (~50ms per call).
Both paths gracefully degrade: missing data results in no git context, not errors.

### Phase 4

Replaced the disabled git context rendering block (5 lines of TODO comments) with 7 lines of rendering code.
Git context is now rendered unconditionally when `git_branch` is populated: `"on {branch}@{commit}"`.

### Phase 5

Updated README.md files, renamed `lace_dir` variables to `container_mounts_dir`, removed stale `LaceContainerResolver` reference in session.rs doc comments.
Final grep confirms no `lace_`-prefixed identifiers remain in source code (only `@lace_*` string literals for actual tmux option names and filesystem paths).

## Changes Made

| File | Description |
|------|-------------|
| `sprack-db/src/types.rs` | `lace_container/user/workspace` -> `container_name/user/workspace` |
| `sprack-db/src/schema.rs` | SQL column renames, migration comment update |
| `sprack-db/src/read.rs` | SQL query and row mapping updates |
| `sprack-db/src/write.rs` | INSERT statement and param binding updates |
| `sprack-db/src/lib.rs` | Test helper field name updates |
| `sprack-poll/src/tmux.rs` | `LaceMeta` -> `ContainerMeta`, function renames |
| `sprack-poll/src/diff.rs` | `compute_lace_meta_hash` -> `compute_container_meta_hash` |
| `sprack-poll/src/main.rs` | Variable renames, import updates |
| `sprack-claude/src/resolver.rs` | Deleted `LaceContainerResolver`, added mount-based resolution |
| `sprack-claude/src/main.rs` | Container git state resolution, variable renames |
| `sprack-claude/src/events.rs` | `lace_dir` -> `container_mounts_dir` |
| `sprack-claude/src/session.rs` | Doc comment update |
| `sprack-claude/Cargo.toml` | Removed `filetime` dev-dependency |
| `sprack/src/tree.rs` | Git context rendering, field name updates |
| `sprack/src/test_render.rs` | `make_session_lace` -> `make_session_container` |
| `sprack/src/snapshots/*.snap` | Updated insta snapshot for container name display |
| `README.md` | Updated to generic container grouping |
| `sprack-poll/README.md` | Updated module descriptions |

## Verification

```
cargo test --workspace
171 tests pass: 43 sprack, 95 sprack-claude, 14 sprack-db, 19 sprack-poll
```

All five phases committed individually with descriptive messages.
No `lace_`-prefixed identifiers remain in sprack source (verified by grep).
