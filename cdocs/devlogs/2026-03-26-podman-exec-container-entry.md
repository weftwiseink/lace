---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T14:28:00-07:00
task_list: lace/podman-migration
type: devlog
state: live
status: wip
tags: [podman, ssh, migration, lace_into]
---

# Podman Exec Container Entry: Devlog

## Objective

Implement the accepted proposal at `cdocs/proposals/2026-03-26-podman-exec-container-entry.md`.
Replace SSH with `podman exec` as the container entry transport across all six bin scripts (`lace-into`, `lace-split`, `lace-discover`, `lace-disconnect-pane`, `lace-paste-image`, `lace-inspect`) and the `lace-fundamentals` devcontainer feature.
Shift container identity from `@lace_port` (SSH port) to `@lace_container` (container name).

## Plan

Five phases, each committed independently:

1. **Foundation**: `resolve_runtime()` helper, `$RUNTIME` usage in all scripts, add `container_name` to `lace-discover` output.
2. **Core transport swap**: Rewrite `lace-discover` (label-based, no port requirement), `lace-into` (podman exec), `lace-split` (`@lace_container`), `lace-disconnect-pane`, sprack `lace_port` -> `lace_container` rename, test harness.
3. **Ancillary scripts**: `lace-paste-image` (podman cp), `lace-inspect` (exec connectivity), `lace-into --status`/`--dry-run`/`--help`.
4. **Feature cleanup**: Remove sshd from `lace-fundamentals`, bump to 2.0.0.
5. **Host-side cleanup**: Remove SSH key/known_hosts references.

## Testing Approach

Each phase verified via:
- Automated: `bin/test/test-lace-into.sh` (updated in Phase 2)
- Manual: tmux-based integration tests in a separate `test-podman` session (not clobbering user's `lace` session)
- Cargo: `cargo check --workspace` after Rust changes in sprack

## Implementation Notes

*Updated as work progresses.*

## Changes Made

| File | Description |
|------|-------------|

## Verification

*Pasted evidence after each phase.*
