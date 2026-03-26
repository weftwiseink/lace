---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T15:00:00-07:00
task_list: sprack/devcontainer-feature
type: proposal
state: live
status: wip
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T16:00:00-07:00
  round: 1
tags: [sprack, devcontainer, architecture, container]
---

# Sprack Devcontainer Feature and Host-Side Integration

> BLUF: A new `sprack` devcontainer feature provides a bind mount at `/mnt/sprack/` inside the container, backed by `~/.local/share/sprack/lace/<project_name>/` on the host.
> The feature sets `SPRACK_EVENT_DIR=/mnt/sprack/claude-events` so the existing hook bridge writes events directly to host-visible storage, solving the fundamental problem that container-side hook events are invisible to the host-side sprack daemon.
> The mount also enables a container-side metadata writer for workdir and git state that hooks cannot capture.
> Host-side sprack-claude requires a discovery change: scanning `~/.local/share/sprack/lace/*/claude-events/` recursively instead of the single flat `~/.local/share/sprack/claude-events/` directory.
> A companion proposal covers migrating lace-into/lace-split from SSH to podman exec; sprack-claude code changes to consume the new per-project mount layout are pending follow-up work.

## Summary

This proposal covers three components:
1. A new devcontainer feature (`devcontainers/features/src/sprack/`) that declares the mount and sets the environment variable.
2. The event directory layout on the mount, preserving the existing per-session JSONL convention.
3. Host-side discovery changes to sprack-claude for reading events across multiple project mounts.

The feature also enables a container-side metadata script that writes workdir and git state to a JSON file on the mount, complementing hook events with state that hooks do not capture.

Key prior documents:
- `cdocs/reports/2026-03-26-sprack-lace-coupling-analysis.md`: inventories sprack's coupling to lace.
- `cdocs/reports/2026-03-26-podman-exec-state-sharing-analysis.md`: analyzes podman exec as a data source.
- `cdocs/proposals/2026-03-25-rfp-sprack-lace-decoupling.md`: explores pluggable container backends.

## Objective

Enable the sprack hook bridge to work inside lace containers by providing a shared filesystem path between container and host.
The hook bridge already respects `SPRACK_EVENT_DIR`; the only missing piece is the mount itself and the environment variable.

Secondary objective: enable container-side metadata writing (workdir, git state) that complements hook events.

## Background

The hook bridge (`packages/sprack/hooks/sprack-hook-bridge.sh`) captures Claude Code lifecycle events and writes per-session JSONL files.
On the host, it writes to `~/.local/share/sprack/claude-events/<session_id>.jsonl`.
Inside a container, the same script writes to the container filesystem, which is invisible to the host-side sprack-claude daemon.

The existing `claude-code` feature already demonstrates the mount declaration pattern: it declares `config` and `config-json` mounts with `target`, `recommendedSource`, `description`, and `sourceMustBe` fields in `customizations.lace.mounts`.
Lace's `MountPathResolver` handles source resolution, auto-creation, and settings overrides.

The hook bridge respects `SPRACK_EVENT_DIR` (line 14 of `sprack-hook-bridge.sh`):
```sh
EVENT_DIR="${SPRACK_EVENT_DIR:-$HOME/.local/share/sprack/claude-events}"
```

Setting this environment variable inside the container is sufficient to redirect events to the mount.

## Proposed Solution

### 1. Feature Structure

New feature at `devcontainers/features/src/sprack/`:

**`devcontainer-feature.json`:**

```json
{
    "id": "sprack",
    "version": "1.0.0",
    "name": "Sprack Integration",
    "description": "Provides a shared mount for sprack hook events and container metadata, enabling host-side tmux status bar integration with container Claude Code sessions.",
    "documentationURL": "https://github.com/weftwiseink/lace/tree/main/devcontainers/features/src/sprack",
    "options": {},
    "containerEnv": {
        "SPRACK_EVENT_DIR": "/mnt/sprack/claude-events"
    },
    "customizations": {
        "lace": {
            "mounts": {
                "data": {
                    "target": "/mnt/sprack",
                    "recommendedSource": "~/.local/share/sprack/lace/${lace.projectName}",
                    "description": "Shared directory for sprack hook events and container metadata. The hook bridge writes per-session JSONL event files here.",
                    "sourceMustBe": "directory"
                }
            }
        }
    }
}
```

> NOTE(opus/sprack-devcontainer-feature): The `${lace.projectName}` variable in `recommendedSource` requires extending `MountPathResolver.resolveValidatedSource()` to support project-name substitution.
> See the "Source path resolution" design decision section for the full analysis and phasing recommendation.

**`install.sh`:**

```sh
#!/bin/sh
set -eu

# Ensure the mount point exists inside the container.
mkdir -p /mnt/sprack/claude-events
mkdir -p /mnt/sprack/metadata

# Ensure the container user can write to the mount.
chown -R "$_REMOTE_USER:$_REMOTE_USER" /mnt/sprack

echo "Sprack integration directories created."
```

The feature has no build-time dependencies.
It only needs the mount to exist at runtime (provided by lace's mount resolution) and the environment variable to be set (provided by `containerEnv`).

### 2. Event Directory Layout

The mount is organized as:

```
/mnt/sprack/                          # container-side mount point
  claude-events/                      # SPRACK_EVENT_DIR target
    <session_id_1>.jsonl              # per-session event files (written by hook bridge)
    <session_id_2>.jsonl
  metadata/                           # container-side metadata (written by metadata script)
    state.json                        # current workdir, git branch, git commit
```

On the host, this maps to:

```
~/.local/share/sprack/lace/
  <project_name_1>/                   # per-project directory
    claude-events/
      <session_id>.jsonl
    metadata/
      state.json
  <project_name_2>/
    claude-events/
      ...
```

The `claude-events/` subdirectory preserves the existing convention: the hook bridge writes `$SPRACK_EVENT_DIR/<session_id>.jsonl`, which lands in `claude-events/<session_id>.jsonl` because `SPRACK_EVENT_DIR` points to `/mnt/sprack/claude-events`.

### 3. Host-Side Discovery

sprack-claude currently reads events from a single directory (`~/.local/share/sprack/claude-events/`).
With per-project mounts, event files are distributed across `~/.local/share/sprack/lace/*/claude-events/`.

The discovery change in sprack-claude:

**Current** (in `events.rs`):
```rust
pub fn default_event_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".local/share/sprack/claude-events"))
}
```

**Proposed**: Replace `default_event_dir()` with a function that returns multiple event directories:

```rust
/// Returns all event directories: the default flat directory plus per-project mounts.
pub fn event_dirs() -> Vec<PathBuf> {
    let home = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => return Vec::new(),
    };

    let mut dirs = Vec::new();

    // Legacy/local: flat event directory for host-side sessions.
    let flat_dir = home.join(".local/share/sprack/claude-events");
    if flat_dir.is_dir() {
        dirs.push(flat_dir);
    }

    // Per-project: lace container mounts.
    let lace_dir = home.join(".local/share/sprack/lace");
    if let Ok(entries) = std::fs::read_dir(&lace_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let events_dir = entry.path().join("claude-events");
            if events_dir.is_dir() {
                dirs.push(events_dir);
            }
        }
    }

    dirs
}
```

The call site in `main.rs` (lines 238-307) changes from scanning one directory to scanning all returned directories.
The `find_event_file` and `find_event_file_by_session_id` functions already accept an `event_dir: &Path` parameter, so no signature changes are needed: the caller iterates over `event_dirs()` and tries each.

Priority order: per-project directories are searched before the legacy flat directory.
If the same session ID exists in both (e.g., a session that was active before and after the mount was configured), the per-project match wins as it is more likely to be current.

> NOTE(opus/sprack-devcontainer-feature): The host-side sprack-claude code changes are follow-up work, not part of this feature proposal.
> This proposal defines the mount contract; a separate implementation session handles the Rust changes.
> The existing flat directory continues to work for host-side sessions.

### 4. Container-Side Metadata Writer

Hooks provide event-driven data (session lifecycle, tool use, task progress) but miss continuous state like the current working directory between hook events, or git branch/commit changes.

A lightweight metadata script runs periodically or on-demand inside the container and writes to the mount:

**`/mnt/sprack/metadata/state.json`:**

```json
{
  "ts": "2026-03-26T22:00:00Z",
  "container_name": "lace-dev",
  "workdir": "/workspaces/lace/main",
  "git_branch": "feat/sprack-mount",
  "git_commit_short": "a1b2c3d",
  "git_dirty": true
}
```

`state.json` is container-scoped, not session-scoped: it reflects whichever shell prompt ran most recently, regardless of which Claude session (if any) is active.
The `container_name` field is the Docker/podman container name (from `hostname` or `$HOSTNAME` inside the container).
This field is required for the sprack codebase decoupling proposal to match metadata files to containers, since the mount directory name (`lace.projectName`) may not match the container name (`sanitizeContainerName()`).
This is appropriate because it captures the container's current state, which is the information sprack needs for display.

This metadata script could be:
- A cron job or systemd timer inside the container (heavyweight, requires setup)
- A shell function invoked by the shell prompt (PROMPT_COMMAND / precmd) to update on every command
- A small watcher script started by the feature's entrypoint

The prompt-hook approach is the lightest:

```sh
# In container shell init (e.g., added by feature entrypoint or chezmoi dotfiles):
__sprack_metadata() {
    local dir="/mnt/sprack/metadata"
    [ -d "$dir" ] || return
    local branch commit dirty
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=""
    commit=$(git rev-parse --short HEAD 2>/dev/null) || commit=""
    dirty=$(git diff --quiet 2>/dev/null && echo false || echo true)
    printf '{"ts":"%s","workdir":"%s","git_branch":"%s","git_commit_short":"%s","git_dirty":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PWD" "$branch" "$commit" "$dirty" > "$dir/state.json"
}
# Bash:
PROMPT_COMMAND="__sprack_metadata;${PROMPT_COMMAND:-}"
# Or via the feature entrypoint setting a profile.d script.
```

> NOTE(opus/sprack-devcontainer-feature): The metadata writer is a secondary concern.
> The primary value of this feature is enabling hook event visibility.
> The metadata writer can be implemented as a follow-up phase or left as an opt-in enhancement.
> A prompt hook adds ~10-30ms per command (git operations are the bottleneck).
> For users with fast NVMe-backed containers, this is negligible; for slow I/O, it could be noticeable.
> Consider gating the metadata writer behind a feature option (e.g., `"enableMetadataWriter": { "type": "boolean", "default": false }`).

## Important Design Decisions

### Mount point at `/mnt/sprack/` (not inside `~/.claude` or `~/.local/share`)

The user's `~/.claude` directory is already bind-mounted via the `claude-code` feature.
Sprack events are not Claude Code configuration; co-locating them inside `~/.claude` would conflate two concerns and risk interference with Claude Code's own file management.

`/mnt/sprack/` is a clean namespace under `/mnt/` (a conventional location for auxiliary mounts in containers).
It is consistent with `lace-fundamentals` mounts under `/mnt/lace/` (dotfiles, screenshots).

### Per-project host directories (not a single flat directory)

The user requirement specifies `~/.local/share/sprack/lace/<project_name>/`.
This is the correct choice for several reasons:
- Multiple containers can run simultaneously, each writing events for different sessions.
  A single flat directory would intermix events from all projects with no way to attribute them.
- Project-scoped directories enable project-aware cleanup: when a project is decommissioned, `rm -rf ~/.local/share/sprack/lace/<project>/` removes all its data without affecting other projects.
- The directory name (`<project_name>`) correlates with the tmux session name, enabling direct lookup by sprack-claude when a pane's session is known.

### `SPRACK_EVENT_DIR` points to the `claude-events/` subdirectory, not the mount root

The hook bridge writes `$SPRACK_EVENT_DIR/<session_id>.jsonl`.
If `SPRACK_EVENT_DIR` pointed to `/mnt/sprack/`, event files would land at `/mnt/sprack/<session_id>.jsonl`, polluting the mount root and conflicting with the `metadata/` subdirectory.

Setting `SPRACK_EVENT_DIR=/mnt/sprack/claude-events` preserves the expected file layout within a clean subdirectory.

### Source path resolution: `recommendedSource` with project name substitution

The ideal host path is `~/.local/share/sprack/lace/<project_name>/`.
The mount resolver currently does not support `${lace.projectName}` substitution in `recommendedSource`.
It supports `${_REMOTE_USER}` in target paths (via `resolveTargetVariables`), but `recommendedSource` is used for `sourceMustBe` validation, not variable substitution.

Three approaches, in order of preference:

1. **Extend `MountPathResolver` to support `${lace.projectName}` in `recommendedSource`**: Small, targeted change to `resolveValidatedSource()`.
   Adds project-name awareness to the mount system, which benefits any future feature that needs project-scoped host directories.
   This is the recommended approach.

2. **Use the default path derivation**: Without `recommendedSource`, the resolver falls back to `~/.config/lace/<projectId>/mounts/sprack/data`.
   This works but places files under `~/.config/lace/` instead of `~/.local/share/sprack/`, which is semantically wrong (these are runtime data, not configuration).

3. **Require a settings override**: Users configure `settings.mounts["sprack/data"].source = "~/.local/share/sprack/lace/<project_name>"`.
   This defeats zero-config ergonomics but works immediately without any mount resolver changes.

> NOTE(opus/sprack-devcontainer-feature): Approach 1 is small: ~10-15 lines in `resolveValidatedSource()` plus tests.
> `MountPathResolver` already has `projectId`; adding `projectName` awareness and a `replace()` call before `expandPath` is the full scope.
> This should be part of Phase 1 (feature scaffold) rather than deferred to a separate phase, avoiding the ergonomic regression of requiring manual settings overrides.

## Edge Cases / Challenging Scenarios

### Multiple Claude sessions in the same container

Multiple Claude Code instances can run in the same container (e.g., in different tmux panes).
Each writes to a unique `<session_id>.jsonl` file.
Since session IDs are globally unique UUIDs, there is no collision risk within the shared `claude-events/` directory.

### Container rebuild clears mount contents

When `sourceMustBe: "directory"` is set and the host directory exists, the mount persists across container rebuilds.
Event files from previous sessions remain on the host.
This is desirable: sprack can observe the last known state of a session even after the container that produced it is gone.

Stale event files should be cleaned up periodically.
The session file's mtime and the `SessionEnd` event in the JSONL provide signals for garbage collection.
This is existing behavior (sprack already needs to handle stale files in the flat directory).

### Mount not present (feature not installed)

If the `sprack` feature is not in the devcontainer config, the mount does not exist and `SPRACK_EVENT_DIR` is not set.
The hook bridge falls back to `$HOME/.local/share/sprack/claude-events` inside the container, which is the current (broken) behavior for containers.
No regression.

### Permissions

The mount is created by `install.sh` as root, then the bind mount overlay provides the host directory.
The container user needs write access to `/mnt/sprack/`.
`install.sh` should `chown` the mount point to `$_REMOTE_USER`.
The host directory is created by lace's `MountPathResolver` (or `mkdir -p` in install.sh) and owned by the host user.

### Metadata writer and prompt hook performance

The `__sprack_metadata` prompt hook runs `git rev-parse` and `git diff --quiet` on every prompt.
For large repositories, `git diff --quiet` can take 50-100ms.
Mitigation: throttle writes (only update if more than N seconds since last write), or use `git status --porcelain --untracked-files=no` which is faster.

### `containerEnv` vs. `remoteEnv`

`containerEnv` sets environment variables for all processes in the container, including the shell.
`remoteEnv` only applies when connecting via VS Code remote.
Since Claude Code hooks fire from the Claude process (not via VS Code), `containerEnv` is correct.

## Integration with Companion Proposals

> NOTE(opus/sprack-devcontainer-feature): A companion proposal covers migrating lace-into/lace-split from SSH to podman exec.
> That migration changes how panes connect to containers but does not affect the mount: bind mounts are container-level configuration, not connection-level.
> The sprack mount works identically whether the pane connects via SSH or podman exec.

> NOTE(opus/sprack-devcontainer-feature): Sprack-claude code changes to consume the new per-project mount layout are follow-up work.
> This proposal defines the mount contract and feature structure; the Rust implementation in `events.rs` and `main.rs` is a separate, dependent implementation session.
> The existing flat event directory continues to work for host-side (non-container) sessions.

## Test Plan

### Feature build and install

1. Validate `devcontainer-feature.json` schema: feature metadata, `containerEnv`, `customizations.lace.mounts` structure.
2. `install.sh` creates `/mnt/sprack/claude-events` and `/mnt/sprack/metadata` directories.
3. `install.sh` sets correct ownership (`$_REMOTE_USER`).

### Mount resolution (lace unit tests)

4. `MountPathResolver` resolves `sprack/data` mount with settings override pointing to `~/.local/share/sprack/lace/<project>/`.
5. `MountPathResolver` validates that the resolved source exists and is a directory.
6. Auto-injection adds `${lace.mount(sprack/data)}` to the config's `mounts` array.

### Hook bridge integration (end-to-end)

7. Inside a container with the sprack feature installed, `echo $SPRACK_EVENT_DIR` returns `/mnt/sprack/claude-events`.
8. Running the hook bridge with a mock event writes to `/mnt/sprack/claude-events/<session_id>.jsonl`.
9. The file is visible from the host at `~/.local/share/sprack/lace/<project>/claude-events/<session_id>.jsonl`.

### Host-side discovery (sprack-claude unit tests)

10. `event_dirs()` returns both the flat directory and per-project directories.
11. `find_event_file_by_session_id` finds a file in a per-project directory.
12. `find_event_file` (cwd-based scan) searches across all project directories.

### Metadata writer (if implemented)

13. Prompt hook writes valid JSON to `/mnt/sprack/metadata/state.json`.
14. Host-side reader parses the metadata file correctly.
15. Throttling prevents excessive writes.

## Verification Methodology

The hook bridge is a shell script, testable with mock inputs:

```sh
# In container:
echo '{"hook_event_name":"SessionStart","session_id":"test-123","cwd":"/workspaces/lace","model":"opus"}' | \
  /path/to/sprack-hook-bridge.sh

# Verify on host:
cat ~/.local/share/sprack/lace/<project>/claude-events/test-123.jsonl
# Should contain: {"ts":"...","event":"SessionStart","session_id":"test-123",...}
```

For Rust changes, existing tests in `events.rs` use `tempfile::tempdir()` and can be extended to test multi-directory scanning.

## Implementation Phases

### Phase 1: Feature scaffold and project-name mount resolution

Create `devcontainers/features/src/sprack/`:
- `devcontainer-feature.json` with mount declaration and `containerEnv`.
- `install.sh` with directory creation and ownership.
- `README.md` (auto-generated or minimal).

Extend `MountPathResolver.resolveValidatedSource()` to support `${lace.projectName}` substitution in `recommendedSource`.
This is ~10-15 lines plus tests and eliminates the need for manual settings overrides.

Acceptance criteria: `devcontainer-feature.json` passes schema validation.
`install.sh` creates the expected directories with correct ownership.
Mount resolves to `~/.local/share/sprack/lace/<project>/` without user configuration.

### Phase 2: Mount source resolution

Configure the mount source path for testing.
Start with a settings override (approach 3 from design decisions).
Verify end-to-end: container writes to `/mnt/sprack/claude-events/`, host sees the file.

Acceptance criteria: A test devcontainer with the sprack feature writes events visible on the host.

### Phase 3: Host-side discovery in sprack-claude

Extend `events.rs` with `event_dirs()` function.
Update `main.rs` event scanning to iterate over multiple directories.
Add unit tests for multi-directory discovery.

Acceptance criteria: sprack-claude finds event files in per-project directories.
Existing flat-directory behavior is preserved for host-side sessions.
All existing tests pass.

### Phase 4: Container metadata writer (optional)

Implement the prompt-hook metadata script.
Add it to the feature's install or entrypoint.
Gate behind a feature option.

Acceptance criteria: `state.json` on the mount contains current workdir and git state.
Host-side sprack can read it.
