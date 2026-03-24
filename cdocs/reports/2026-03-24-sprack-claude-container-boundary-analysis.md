---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T09:45:00-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: review_ready
tags: [sprack, container, architecture, process_isolation]
---

# sprack-claude Container Boundary Analysis

> BLUF: sprack-claude does not work when running on the host while Claude Code runs inside a devcontainer.
> Three independent barriers prevent it: PID namespace isolation breaks `/proc` walking, filesystem path encoding mismatches break session file discovery, and the `~/.claude` bind mount means session files written by container-Claude use container-internal paths that the host cannot resolve.
> The only viable architecture is running all sprack components inside the container, with tmux also running inside the container (which is the current lace setup).

## 1. PID Namespace Isolation

sprack-claude resolves pane-to-session-file mappings by walking `/proc/<pane_pid>/children` recursively from the shell PID stored in the `panes` table.

> WARN(opus/sprack-claude-container): Docker containers run in a separate PID namespace by default.
> Container processes are visible in the host's `/proc` as host-remapped PIDs, but the parent-child relationships exposed by `/proc/<pid>/children` reflect the host PID namespace.

### What tmux sees vs what the host sees

tmux runs on the host and reports `pane_pid` values in the **host PID namespace**.
When a tmux pane's shell spawns Claude Code inside a container (via `docker exec` or SSH), the container process tree is:

```
Host PID namespace:
  tmux-server (host)
    └── bash (host, pane shell)
         └── docker-exec / ssh (host)
              └── [container boundary]
                   └── node (container PID 47, host PID 98234)
                        └── node "claude" (container PID 48, host PID 98235)
```

From the host's `/proc`, PID 98234 and 98235 exist, but `/proc/98234/children` shows `98235` (the host PID).
The `cmdline` at `/proc/98235/cmdline` would contain "claude", so the walk **would succeed** at finding the Claude PID on the host.

However, this only works if the container shares the host PID namespace (`--pid=host`).
By default, Docker uses a separate PID namespace.
In that case, `/proc/<host_pane_pid>/children` does not cross the container boundary: the pane shell on the host has no children visible via `/proc`, because the actual child processes are in a different namespace.

> NOTE(opus/sprack-claude-container): The lace devcontainer does not pass `--pid=host` in its `runArgs`.
> Container processes are in an isolated PID namespace (confirmed: container PID 1 ns `pid:[4026533546]` differs from host).

### `/proc/<pid>/children` availability

An additional complication: the current container kernel exposes `/proc/<pid>/children` only under `/proc/<pid>/task/<tid>/children`, not directly at `/proc/<pid>/children`.
The sprack-claude implementation reads `/proc/{pid}/children` directly, which fails silently (returns `None`, resolution chain aborts).

> WARN(opus/sprack-claude-container): Even inside the container, `/proc/<pid>/children` is not available at the expected path.
> The implementation reads `/proc/{pid}/children` but this kernel exposes it at `/proc/{pid}/task/{tid}/children`.
> This is a bug independent of the container boundary question - it affects in-container sprack-claude as well.

### Verdict: PID walking from host to container processes

If tmux runs on the host and Claude Code runs in the container, the pane PID from tmux is the host-side `docker exec` or SSH process, not the container shell.
The `/proc` walk from the host cannot traverse into the container's PID namespace to find the Claude process.
Even with `--pid=host`, the walk would find the Claude process by host PID, but the subsequent `cwd` read (step 2) returns the container-internal path, creating a path mismatch (see next section).

**Result: Broken.**

## 2. Filesystem Path Encoding Mismatch

After finding the Claude process PID, sprack-claude reads `/proc/<claude_pid>/cwd` to determine the working directory, then encodes it to find the session directory.

### The path divergence

The lace devcontainer mounts the host workspace:

```
source=/var/home/mjr/code/weft/lace -> target=/workspaces/lace
```

Claude Code running inside the container sees its cwd as `/workspaces/lace/main`.
Claude Code encodes this as `-workspaces-lace-main` for the session directory name.

If sprack-claude runs on the host and manages to read the Claude process's cwd (via `/proc`), it gets the container-internal path `/workspaces/lace/main`.
It then looks for `~/.claude/projects/-workspaces-lace-main/` under the **host's** `$HOME`.

The host's `~/.claude/projects/` directory contains entries encoded with host paths:
- `-var-home-mjr-code-weft-lace-main` (sessions created by host-side Claude)

The container's `~/.claude/projects/` directory contains entries encoded with container paths:
- `-workspaces-lace-main` (sessions created by container-side Claude)

Since `~/.claude` is bind-mounted from the host (`source=/home/mjr/.claude, target=/home/node/.claude`), both sets of directories exist in the same filesystem.
The host could theoretically read `-workspaces-lace-main` from its own `~/.claude/projects/` since the bind mount makes them the same directory.

> NOTE(opus/sprack-claude-container): Verified empirically: both `-workspaces-lace-main` and `-var-home-mjr-code-weft-lace-main` exist under `/home/node/.claude/projects/` inside the container, because the bind mount shares the directory bidirectionally.
> On the host, the same directories exist under `/home/mjr/.claude/projects/`.

### The resolution chain with bind mount

If sprack-claude on the host reads `/proc/<claude_pid>/cwd` and gets `/workspaces/lace/main`:
1. It encodes to `-workspaces-lace-main`
2. It constructs `$HOME/.claude/projects/-workspaces-lace-main/` using the **host** `$HOME` (e.g., `/home/mjr`)
3. It looks at `/home/mjr/.claude/projects/-workspaces-lace-main/`
4. Because of the bind mount, this directory **does exist** on the host

This part actually works, but only because of the `~/.claude` bind mount.

### Session file paths inside sessions-index.json

The `sessions-index.json` file contains `fullPath` entries with **absolute paths as seen by the process that wrote them**.
If Claude Code running inside the container creates a session, `fullPath` will be something like:
```
/home/node/.claude/projects/-workspaces-lace-main/abc123.jsonl
```

sprack-claude on the host would try to open this path, which does not exist on the host (`/home/node` does not exist on the host; the host user is `/home/mjr`).

> WARN(opus/sprack-claude-container): The `fullPath` in `sessions-index.json` uses the container's absolute path (`/home/node/.claude/...`).
> The host cannot resolve this path because the home directory differs.
> The fallback strategy (list `.jsonl` files by mtime) avoids this problem because it constructs paths relative to the project directory it already resolved.

**Result: Partially broken.** The primary session discovery (sessions-index.json) fails due to `fullPath` mismatch. The mtime-based fallback would work if the bind mount is present.

## 3. Session File Location and the Bind Mount

### Where Claude Code writes session files

Claude Code writes JSONL session files to `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/`.
In the lace devcontainer, `CLAUDE_CONFIG_DIR=/home/node/.claude` (set via `containerEnv`).

The session files are written at paths like:
```
/home/node/.claude/projects/-workspaces-lace-main/<session-uuid>.jsonl
```

### The bind mount makes files accessible

The devcontainer configuration mounts:
```
source=/home/mjr/.claude -> target=/home/node/.claude
```

This means session files written by container-Claude at `/home/node/.claude/projects/-workspaces-lace-main/` are physically stored at `/home/mjr/.claude/projects/-workspaces-lace-main/` on the host.

The files are readable from the host through the bind mount.

### But the path resolution chain is still broken

Even though the files are physically accessible, sprack-claude on the host cannot reach them through its normal resolution chain because:
1. The `/proc` walk cannot cross PID namespaces to find the Claude PID (Section 1)
2. The `fullPath` in `sessions-index.json` points to container-internal paths (Section 2)

**Result: Files are accessible, but the resolution chain to find them is broken.**

## 4. The Lace Mount Situation

The lace devcontainer declares a `claude-config` mount:

```json
"claude-config": {
  "target": "/home/node/.claude",
  "recommendedSource": "~/.claude",
  "description": "Claude Code credentials, session data, and settings"
}
```

Resolved mount assignment confirms: `source=/home/mjr/.claude -> target=/home/node/.claude`.

This mount shares the entire `~/.claude` directory between host and container.
Session files, credentials, settings, and project indexes are all shared.

The mount creates an interesting situation: both host-originated and container-originated session data coexist in the same directory tree, distinguished only by their encoded path prefixes (`-var-home-mjr-...` vs `-workspaces-lace-...`).

## 5. Alternative Architectures

### A. All sprack components inside the container

This is the architecture the proposal already assumes.

**Requirements:** tmux, sprack-poll, sprack-claude, and sprack-tui all run inside the container.

**Feasibility:**
- tmux is installed in the container Dockerfile (`apt-get install -y tmux`).
- `/proc` is the container's `/proc`, so PID walking works within the container.
- Claude Code's cwd resolves to `/workspaces/lace/main`, encoding to `-workspaces-lace-main`.
- `$HOME/.claude/projects/-workspaces-lace-main/` exists and contains the active session files.
- SQLite DB at `~/.local/share/sprack/state.db` is container-local.

**Problem:** `/proc/<pid>/children` is not available at the expected path in this kernel.
The file exists at `/proc/<pid>/task/<tid>/children` instead.
This is a bug that needs fixing regardless of architecture choice.

> TODO(opus/sprack-claude-container): Fix proc_walk to try `/proc/{pid}/task/{pid}/children` as fallback when `/proc/{pid}/children` does not exist.

**Verdict: This works (after the children path fix), and is the correct architecture.**

### B. sprack-claude on host reads container filesystem via docker/mount

sprack-claude on the host could bypass `/proc` entirely and use a different resolution strategy:
1. Instead of walking `/proc`, query tmux for the pane's `current_command` and `current_path`.
2. Map the container path to the host path using known mount mappings.
3. Read session files from the host's `~/.claude/projects/` using the container-encoded path.

**Problems:**
- Requires knowledge of container mount mappings (fragile, non-portable).
- `current_path` from tmux shows the path as seen by the process in the pane; if the pane runs inside the container, tmux on the host would show the host-side path of the docker exec process, not the container-internal path.
- The session directory encoding depends on what path Claude Code sees, which is the container-internal path.

**Verdict: Feasible but fragile, requires mount translation layer.**

### C. Split architecture: poll on host, claude in container

Since tmux runs on the host, sprack-poll must run where tmux runs.
sprack-claude needs `/proc` access to container processes.
This suggests: sprack-poll on host, sprack-claude inside container.

**Problems:**
- The SQLite DB must be shared between host (sprack-poll writes) and container (sprack-claude reads/writes, TUI reads).
- The DB path `~/.local/share/sprack/state.db` differs between host and container `$HOME`.
- Requires another bind mount for the sprack state directory.
- pane PIDs in the DB are host PIDs (written by host sprack-poll), but sprack-claude inside the container would try to resolve them against the container's `/proc`, which shows different PIDs.

> WARN(opus/sprack-claude-container): The split architecture has a fundamental PID namespace mismatch.
> sprack-poll on the host writes host PIDs to the DB.
> sprack-claude in the container reads those PIDs and looks them up in the container's `/proc`.
> Host PIDs do not exist in the container's PID namespace.

**Verdict: Broken by PID namespace mismatch. Would require `--pid=host` on the container.**

### D. All sprack + tmux inside the container

If tmux also runs inside the container, all components share the same PID namespace and filesystem.
The host connects to the container's tmux via SSH or socket forwarding.

This is the existing lace architecture: tmux inside the container, wezterm on the host connects via SSH.

**Verdict: This is the current design. It works.**

## 6. The sprack-poll Angle

sprack-poll reads tmux state via `tmux list-panes -a`.
It must run in the same environment as the tmux server.

In the lace architecture, tmux runs inside the container (installed via Dockerfile, started by the container init).
Therefore sprack-poll runs inside the container.

The pane PIDs reported by tmux are container-namespace PIDs.
sprack-claude runs inside the same container and sees the same PID namespace.
The `/proc` walk from pane PID to Claude PID operates entirely within the container.

There is no split required.

> NOTE(opus/sprack-claude-container): The proposal's "Container Filesystem Isolation" section already states the correct conclusion: "sprack-claude runs inside the same container as Claude Code."
> The WARN callout in the proposal correctly identifies the failure mode: "If sprack-claude runs on the host but Claude Code runs in a container, `/proc` PIDs will not match."

## Summary of Failure Modes

| Barrier | Host-to-Container | All-in-Container |
|---------|-------------------|------------------|
| PID namespace isolation | Broken: cannot walk `/proc` across namespace boundary | Works: same namespace |
| `/proc/<pid>/children` path | N/A (walk fails before this) | Bug: must use `task/<tid>/children` fallback |
| Path encoding mismatch | Broken: host cwd vs container cwd | Works: consistent paths |
| `sessions-index.json` fullPath | Broken: container paths unresolvable on host | Works: paths resolve locally |
| Session file access | Works (via bind mount) | Works (local filesystem) |
| SQLite DB sharing (split arch) | Requires extra bind mount + PID translation | Works: single DB |

## Recommendations

1. **Keep the all-in-container architecture.** No changes needed to the deployment model.
2. **Fix the `/proc/<pid>/children` path.** The `proc_walk.rs` implementation must handle the case where `/proc/{pid}/children` does not exist but `/proc/{pid}/task/{pid}/children` does. This is a real bug: the current implementation silently fails to find Claude processes even inside the container.
3. **Do not pursue host-side sprack-claude.** The PID namespace and path encoding barriers make it fundamentally unworkable without `--pid=host` and a mount translation layer.
4. **Document the constraint.** The proposal's WARN callout is correct but could be more explicit about why: it is not just PID mismatch, but three independent barriers.
