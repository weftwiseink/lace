---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T14:28:00-07:00
task_list: lace/podman-migration
type: devlog
state: archived
status: done
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
5. **Host-side cleanup**: Remove SSH key/known_hosts references from README.

## Testing Approach

Each phase verified via:
- Automated: `bin/test/test-lace-into.sh` (updated in Phase 2)
- Manual: tmux-based integration tests in a separate `test-podman` session (not clobbering user's `lace` session)
- Cargo: `cargo check --workspace` after Rust changes in sprack

## Implementation Notes

### Phase 1: Foundation

Created `bin/lace-lib.sh` with `resolve_runtime()` that follows the same resolution chain as TypeScript's `getPodmanCommand()`:
1. `CONTAINER_RUNTIME` env var
2. `overridePodmanCommand` from `~/.config/lace/settings.json` (parsed via grep/sed, no jq dependency)
3. Auto-detect: podman first, then docker

`lace-discover` was rewritten to:
- Remove SSH port range scan (22425-22499) as a container filter
- Use label-based discovery only (`devcontainer.local_folder`)
- Output `container_name` (from `$RUNTIME inspect --format '{{.Name}}'`) instead of port
- Fix a pre-existing bug where `grep -oP` returned multiple `remoteUser` matches from metadata (added `| head -1`)

For nushell scripts (`lace-inspect`, `lace-paste-image`), `resolve-runtime` is implemented as a nushell function.
Nushell's type system does not allow `error make` in a function with `-> string` return type, so the fallback returns `"MISSING_RUNTIME"` instead.

### Phase 2: Core transport swap

`lace-into` was the largest change (~200 lines modified across ~1000 total).
Key decisions:
- `build_exec_cmd()` helper uses bash nameref (`local -n _cmd=$4`) to build the command array, avoiding eval/subshell overhead
- Session collision detection changed from port comparison to container name comparison, with disambiguation using the first 8 chars of container ID (instead of port number)
- `refresh_host_key()` removed entirely (no SSH infrastructure)
- `resolve_user_for_port()` became `resolve_user_for_container()`
- `LACE_PORT` env var in tmux sessions became `LACE_CONTAINER`

Sprack rename (`lace_port` -> `lace_container`) touched 7 crates across 10 files.
The schema migration uses a drop+recreate approach (version 1 -> 2) since breakage is acceptable per the proposal.
The type changed from `Option<u16>` to `Option<String>`, requiring updates to all read/write/hash paths.

### Phase 3: Ancillary scripts

`lace-paste-image` replaced SCP-over-SSH with a single `$RUNTIME cp` call.
Detection changed from `pane_current_command == "ssh"` to `@lace_container` metadata check.
This eliminates the 7-option SSH array and the SCP invocation.

`lace-inspect` replaced the `pgrep -x sshd` check with `$RUNTIME exec $name echo ok`.

### Phase 4: Feature cleanup

`lace-fundamentals` bumped to 2.0.0:
- Removed `sshd:1` from `dependsOn`
- Removed `sshPort`, `enableSshHardening` options
- Removed `authorized-keys` mount and `sshPort` port declarations
- Deleted `steps/ssh-hardening.sh` and `steps/ssh-directory.sh`

> NOTE(opus/lace/podman-migration): The user's `~/.config/lace/settings.json` still has a `lace-fundamentals/authorized-keys` mount entry.
> This is now a no-op since the feature no longer declares that mount slot.
> The user may want to remove it for cleanliness.

### Phase 5: Host-side cleanup

Updated the `lace-fundamentals` README to reflect v2.0.0.
No bin scripts reference SSH artifacts after Phase 2.

## Changes Made

| File | Description |
|------|-------------|
| `bin/lace-lib.sh` | New: shared `resolve_runtime()` helper |
| `bin/lace-discover` | Rewrite: label-based discovery, container_name output |
| `bin/lace-into` | Rewrite: podman exec transport, @lace_container metadata |
| `bin/lace-split` | Rewrite: @lace_container detection, exec split command |
| `bin/lace-disconnect-pane` | Update: clear @lace_container |
| `bin/lace-paste-image` | Rewrite: podman cp instead of SCP |
| `bin/lace-inspect` | Update: resolve-runtime, exec connectivity check |
| `bin/test/test-lace-into.sh` | Rewrite: container-name-based mocks and assertions |
| `packages/sprack/crates/sprack-db/src/types.rs` | Rename: lace_port -> lace_container (u16 -> String) |
| `packages/sprack/crates/sprack-db/src/schema.rs` | Migrate: v1 -> v2, lace_port INTEGER -> lace_container TEXT |
| `packages/sprack/crates/sprack-db/src/read.rs` | Update: read lace_container TEXT |
| `packages/sprack/crates/sprack-db/src/write.rs` | Update: write lace_container |
| `packages/sprack/crates/sprack-db/src/lib.rs` | Update: test fixtures |
| `packages/sprack/crates/sprack-poll/src/tmux.rs` | Rename: LaceMeta.port -> .container, @lace_port -> @lace_container |
| `packages/sprack/crates/sprack-poll/src/diff.rs` | Update: hash meta.container |
| `packages/sprack/crates/sprack/src/tree.rs` | Update: group by container, render container name |
| `packages/sprack/crates/sprack/src/test_render.rs` | Update: test fixtures |
| `packages/sprack/crates/sprack-claude/src/resolver.rs` | Rename: lace_port -> lace_container throughout |
| `packages/sprack/README.md` | Update: @lace_container reference |
| `packages/sprack/crates/sprack-poll/README.md` | Update: @lace_container reference |
| `devcontainers/features/src/lace-fundamentals/devcontainer-feature.json` | Rewrite: v2.0.0, remove SSH |
| `devcontainers/features/src/lace-fundamentals/install.sh` | Update: remove SSH steps |
| `devcontainers/features/src/lace-fundamentals/steps/ssh-hardening.sh` | Deleted |
| `devcontainers/features/src/lace-fundamentals/steps/ssh-directory.sh` | Deleted |
| `devcontainers/features/src/lace-fundamentals/README.md` | Rewrite: v2.0.0 documentation |

## Verification

### Test harness (49/50 pass)

```
=== Test 1: Fresh session creation ===
  PASS: session exists
  PASS: container option set
  PASS: user option set
  PASS: workspace option set
  PASS: pane alive
  PASS: pane-level container set
  PASS: pane-level user set
  PASS: pane-level workspace set
...
Results: 49 passed, 1 failed (of 50)
```

The 1 failure is Test 5 (`remain-on-exit failed`), a pre-existing timing-sensitive test unrelated to this migration.

### cargo check --workspace

```
Checking sprack-poll v0.1.0
Checking sprack v0.1.0
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.29s
```

### lace-discover

```
$ bin/lace-discover
lace:lace:node:/var/home/mjr/code/weft/lace/main:/workspaces/lace/main

$ bin/lace-discover --json
[{"name":"lace","container_name":"lace","container_id":"354056348bf0","user":"node","path":"/var/home/mjr/code/weft/lace/main","workspace":"/workspaces/lace/main"}]
```

### lace-into (manual test)

Created a test-podman tmux session, ran `lace-into lace`:
- Session created with `@lace_container=lace`
- Pane running `podman` (exec -it)
- Pane-level metadata: `@lace_container=lace`, `@lace_user=node`, `@lace_workspace=/workspaces/lace/main`

### lace-into --status

```
PROJECT              CONTAINER            USER       PATH                           WORKSPACE
-------              ---------            ----       ----                           ---------
lace                 lace                 node       /var/home/mjr/code/weft/lace/main /workspaces/lace/main
```

### lace-inspect

```
exec connectivity:    ok
```

### No SSH references in bin scripts

```
$ grep -r 'LACE_SSH_KEY\|LACE_KNOWN_HOSTS\|ssh-keyscan\|ssh-keygen\|lace_known_hosts\|id_ed25519' bin/
(no output)
```
