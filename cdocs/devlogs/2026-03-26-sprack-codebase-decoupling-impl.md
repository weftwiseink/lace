---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T14:00:00-07:00
task_list: sprack/lace-decoupling
type: devlog
state: live
status: wip
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

### Phase 2

### Phase 3

### Phase 4

### Phase 5

## Changes Made

| File | Description |
|------|-------------|

## Verification
