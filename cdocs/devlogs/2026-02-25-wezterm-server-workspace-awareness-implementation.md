---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T20:30:00-06:00
task_list: lace/wezterm-server
type: devlog
state: live
status: wip
tags: [wezterm-server, devcontainer, workspace, mux-server, entrypoint, containerEnv, cleanup, implementation]
related_to:
  - cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md
---

# Workspace-Aware wezterm-server Implementation: Devlog

## Objective

Implement the accepted proposal
(`cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md`) to make
the wezterm-server devcontainer feature self-starting and workspace-aware,
eliminating the per-project `.devcontainer/wezterm.lua` and its associated
infrastructure.

Three phases:
1. **Feature changes** -- static config + entrypoint in `install.sh`, bump version
2. **Lace changes** -- auto-inject `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME`
3. **Cleanup** -- remove legacy `.devcontainer/wezterm.lua`, its mount, Dockerfile mkdir, postStartCommand

## Plan

1. Phase 1: Modify wezterm-server feature (`install.sh`, `devcontainer-feature.json`, `README.md`, tests)
2. Review Phase 1 via `/cdocs:review`
3. Phase 2: Add env var injection to `generateExtendedConfig()` in `up.ts`, add tests
4. Review Phase 2 via `/cdocs:review`
5. Phase 3: Remove legacy files and references, update tests
6. Review Phase 3 via `/cdocs:review`
7. Full verification pass

## Testing Approach

- **Phase 1:** Shell-based feature tests (existing `devcontainer features test` harness) +
  manual `install.sh` validation via docker
- **Phase 2:** Vitest integration tests in `up-mount.integration.test.ts` following existing patterns
- **Phase 3:** Grep-based orphan reference checks + `lace up --skip-devcontainer-up` E2E verification
- Each phase validated empirically before proceeding to next

## Implementation Notes

*(Updated as work proceeds)*

## Changes Made

| File | Phase | Description |
|------|-------|-------------|

## Verification

*(Filled in as phases complete)*
